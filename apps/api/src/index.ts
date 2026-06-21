import {
  MAX_ROOM_NAME_LENGTH,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
} from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validator } from "hono/validator";
import { type AuthEnv, createAuth } from "./auth";
import { createDb } from "./db";
import { listMessages } from "./db/messages";
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "./db/push-subscriptions";
import {
  createRoomWithOwner,
  getRoomMembership,
  listRoomMembers,
  listRoomsForUser,
  markRoomRead,
  requireRoomOwner,
  userExists,
} from "./db/rooms";
import { roomMembers } from "./db/schema";
import { hasPushConfig } from "./push";

/** クエリ値（string | string[] | undefined）から単一の文字列だけを取り出す。 */
const pickQuery = (v: string | string[] | undefined) =>
  typeof v === "string" ? v : undefined;

/**
 * Cloudflare Workers の環境バインディング。
 *
 * 注: Worker の実エントリは `worker.ts`（Hono app に WS ルートを足し `RoomDO` を export）。
 * このファイルは FE が RPC 型を解決するエントリでもあるため、Worker ランタイム専用の型
 * （`ROOM: DurableObjectNamespace` など）はここに持ち込まず `worker.ts` 側で扱う。
 */
export type Bindings = AuthEnv;

const app = new Hono<{ Bindings: Bindings }>();

function isPushSubscriptionInput(value: unknown): value is {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = record.keys;
  if (!keys || typeof keys !== "object") return false;
  const keyRecord = keys as Record<string, unknown>;
  return (
    typeof record.endpoint === "string" &&
    record.endpoint.length > 0 &&
    typeof keyRecord.p256dh === "string" &&
    keyRecord.p256dh.length > 0 &&
    typeof keyRecord.auth === "string" &&
    keyRecord.auth.length > 0
  );
}

type RoomNamespaceBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

async function disconnectRoomMember(
  env: Bindings,
  roomId: string,
  userId: string,
) {
  const room = (env as unknown as { ROOM?: RoomNamespaceBinding }).ROOM;
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/disconnect-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
  );
}

// Web（別サブドメイン = 別オリジン）からの Cookie 認証クロスオリジン呼び出しを許可する。
// WebSocket の upgrade は CORS の対象外で、101 応答にヘッダを付けると干渉するためスキップする。
app.use("*", (c, next) =>
  c.req.header("upgrade")?.toLowerCase() === "websocket"
    ? next()
    : cors({
        origin: c.env.WEB_URL,
        credentials: true,
        allowHeaders: ["Content-Type"],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      })(c, next),
);

// Better Auth のハンドラをマウント（サインアップ / ログイン / ログアウト / メール検証など）。
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// 注: WebSocket ルート（`/ws/room/:roomId`）は Worker ランタイム専用 API（Durable Object への
// フォワード）を使うため、FE が型解決しない `worker.ts` 側で `app` に登録する。

// RPC 用に型を共有するルートはチェーンして定義し、その型をエクスポートする。
const routes = app
  .get("/health", (c) => c.json({ status: "ok" } as const))
  .get("/push/vapid-public-key", (c) => {
    if (!hasPushConfig(c.env)) {
      return c.json({ error: "push is not configured" } as const, 503);
    }
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY } as const);
  })
  // 保護ルートの例：有効なセッションが無ければ 401。
  .get("/me", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }
    return c.json({ user: session.user });
  })
  .post("/push/subscriptions", async (c) => {
    if (!hasPushConfig(c.env)) {
      return c.json({ error: "push is not configured" } as const, 503);
    }

    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }

    const json = await c.req.json().catch(() => undefined);
    if (!isPushSubscriptionInput(json)) {
      return c.json({ error: "invalid push subscription" } as const, 400);
    }

    const db = createDb(c.env.DB);
    await upsertPushSubscription(db, session.user.id, json);
    return c.json({ ok: true } as const, 201);
  })
  .delete("/push/subscriptions", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }

    const json = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
    const endpoint = typeof json.endpoint === "string" ? json.endpoint : "";
    if (!endpoint) {
      return c.json({ error: "invalid endpoint" } as const, 400);
    }

    const db = createDb(c.env.DB);
    await deletePushSubscription(db, session.user.id, endpoint);
    return c.json({ ok: true } as const);
  })
  // 自分が所属するルーム一覧（新しい順）。要セッション。
  .get("/rooms", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }
    const db = createDb(c.env.DB);
    const rows = await listRoomsForUser(db, session.user.id);
    return c.json({
      rooms: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.getTime(),
        unreadCount: Number(r.unreadCount ?? 0),
      })),
    });
  })
  // ルーム作成。要セッション。id はサーバ採番（UUID）。
  .post("/rooms", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }
    const json = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof json.name === "string" ? json.name.trim() : "";
    if (name.length === 0 || name.length > MAX_ROOM_NAME_LENGTH) {
      return c.json({ error: "invalid room name" } as const, 400);
    }
    // createdAt は明示採番し、DB 既定値への往復なしで正確な値を返す。
    const createdAt = Date.now();
    const id = crypto.randomUUID();
    const db = createDb(c.env.DB);
    await createRoomWithOwner(db, {
      id,
      name,
      ownerId: session.user.id,
      createdAt: new Date(createdAt),
    });
    return c.json(
      { room: { id, name, createdAt, unreadCount: 0 } },
      201,
    );
  })
  // 自分の lastReadAt を進める。`at` は既読化したい時刻のミリ秒。
  .post(
    "/rooms/:roomId/read",
    // RPC クライアントに json ボディ型を伝えるため validator を通す。
    validator("json", (value: { at?: number }) => value),
    async (c) => {
      const auth = createAuth(c.env);
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) {
        return c.json({ error: "unauthorized" } as const, 401);
      }

      const roomId = c.req.param("roomId");
      const db = createDb(c.env.DB);
      const membership = await getRoomMembership(db, roomId, session.user.id);
      if (membership.status === "not_found") {
        return c.json({ error: "room not found" } as const, 404);
      }
      if (membership.status === "forbidden") {
        return c.json({ error: "forbidden" } as const, 403);
      }

      const json = c.req.valid("json");
      const atMs = typeof json.at === "number" ? json.at : Date.now();
      if (!Number.isFinite(atMs) || atMs < 0) {
        return c.json({ error: "invalid at" } as const, 400);
      }

      await markRoomRead(db, roomId, session.user.id, new Date(atMs));
      return c.json({ ok: true } as const);
    },
  )
  // ルームメンバー一覧。所属メンバーのみ閲覧可。
  .get("/rooms/:roomId/members", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }

    const roomId = c.req.param("roomId");
    const db = createDb(c.env.DB);
    const membership = await getRoomMembership(db, roomId, session.user.id);
    if (membership.status === "not_found") {
      return c.json({ error: "room not found" } as const, 404);
    }
    if (membership.status === "forbidden") {
      return c.json({ error: "forbidden" } as const, 403);
    }

    const members = await listRoomMembers(db, roomId);
    return c.json({
      members: members.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        role: m.role,
        joinedAt: m.joinedAt.getTime(),
      })),
    });
  })
  // オーナーが既存ユーザーをルームへ追加する。
  .post("/rooms/:roomId/members", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }

    const roomId = c.req.param("roomId");
    const db = createDb(c.env.DB);
    const owner = await requireRoomOwner(db, roomId, session.user.id);
    if (owner.status === "not_found") {
      return c.json({ error: "room not found" } as const, 404);
    }
    if (owner.status !== "owner") {
      return c.json({ error: "forbidden" } as const, 403);
    }

    const json = (await c.req.json().catch(() => ({}))) as { userId?: unknown };
    const userId = typeof json.userId === "string" ? json.userId.trim() : "";
    if (userId.length === 0) {
      return c.json({ error: "invalid user id" } as const, 400);
    }
    if (!(await userExists(db, userId))) {
      return c.json({ error: "user not found" } as const, 404);
    }

    const existing = await getRoomMembership(db, roomId, userId);
    if (existing.status === "member") {
      return c.json(
        { error: "user is already a member", role: existing.role } as const,
        409,
      );
    }

    const joinedAt = Date.now();
    await db
      .insert(roomMembers)
      .values({
        roomId,
        userId,
        role: "member",
        joinedAt: new Date(joinedAt),
      })
      .onConflictDoNothing();

    return c.json({ member: { userId, role: "member", joinedAt } }, 201);
  })
  // オーナーがメンバーを外す。自分自身の owner 権限削除は拒否する。
  .delete("/rooms/:roomId/members/:userId", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }

    const roomId = c.req.param("roomId");
    const targetUserId = c.req.param("userId");
    const db = createDb(c.env.DB);
    const owner = await requireRoomOwner(db, roomId, session.user.id);
    if (owner.status === "not_found") {
      return c.json({ error: "room not found" } as const, 404);
    }
    if (owner.status !== "owner") {
      return c.json({ error: "forbidden" } as const, 403);
    }

    const target = await getRoomMembership(db, roomId, targetUserId);
    if (target.status !== "member") {
      return c.json({ error: "member not found" } as const, 404);
    }
    if (target.role === "owner") {
      return c.json({ error: "owner cannot be removed" } as const, 400);
    }

    await db
      .delete(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, targetUserId),
        ),
      );
    await disconnectRoomMember(c.env, roomId, targetUserId);

    return c.json({ ok: true } as const);
  })
  // ルームのメッセージ履歴（古い順）。`before`/`beforeId` で過去ページをたどる。要セッション。
  .get(
    "/rooms/:roomId/messages",
    // query を明示バリデートして RPC クライアントに型を伝える（未バリデートだと hc が query を受け取れない）。
    validator("query", (value) => ({
      before: pickQuery(value.before),
      beforeId: pickQuery(value.beforeId),
      limit: pickQuery(value.limit),
    })),
    async (c) => {
      const auth = createAuth(c.env);
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) {
        return c.json({ error: "unauthorized" } as const, 401);
      }
      const roomId = c.req.param("roomId");
      const q = c.req.valid("query");

      const rawLimit = Number(q.limit);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MESSAGE_PAGE_SIZE_MAX)
          : MESSAGE_PAGE_SIZE;

      const beforeMs = Number(q.before);
      const before =
        Number.isFinite(beforeMs) && q.before && q.beforeId
          ? { createdAt: beforeMs, id: q.beforeId }
          : undefined;

      const db = createDb(c.env.DB);
      const membership = await getRoomMembership(db, roomId, session.user.id);
      if (membership.status === "not_found") {
        return c.json({ error: "room not found" } as const, 404);
      }
      if (membership.status === "forbidden") {
        return c.json({ error: "forbidden" } as const, 403);
      }

      const list = await listMessages(db, { roomId, limit, before });
      return c.json({ messages: list });
    },
  );

export default app;
export type AppType = typeof routes;
