import {
  type ChatMessage,
  isEmailLike,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
} from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validator } from "hono/validator";
import { type AuthEnv, createAuth } from "./auth";
import {
  getMessageById,
  listMessages,
  softDeleteMessage,
  toChatMessage,
  updateMessageBody,
} from "./db/messages";
import {
  deletePushSubscription,
  upsertPushSubscription,
} from "./db/push-subscriptions";
import {
  createRoomWithOwner,
  deleteRoom,
  findUserByEmail,
  getRoomMembership,
  listRoomMembers,
  listRoomsForUser,
  markRoomRead,
  updateRoomName,
} from "./db/rooms";
import { roomMembers } from "./db/schema";
import { requireMember, requireOwner, requireSession } from "./guards";
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

/** ルーム削除時に、対応する DO へ接続中の全 WebSocket をクローズさせる。 */
async function disconnectRoomAll(env: Bindings, roomId: string) {
  const room = (env as unknown as { ROOM?: RoomNamespaceBinding }).ROOM;
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/disconnect-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** メッセージ編集 / 削除を、対応する DO 経由で接続中の全 WebSocket に配信する。 */
async function broadcastMessageUpdate(
  env: Bindings,
  roomId: string,
  message: ChatMessage,
) {
  const room = (env as unknown as { ROOM?: RoomNamespaceBinding }).ROOM;
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/broadcast-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
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
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      })(c, next),
);

// Better Auth のハンドラをマウント（サインアップ / ログイン / ログアウト / メール検証など）。
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// 注: WebSocket ルート（`/ws/room/:roomId`）は Worker ランタイム専用 API（Durable Object への
// フォワード）を使うため、FE が型解決しない `worker.ts` 側で `app` に登録する。

// RPC 用に型を共有するルートはチェーンして定義し、その型をエクスポートする。
// 認証・認可は `guards.ts` の関数で行う。失敗時の応答はハンドラが return するため
// RPC 型（AppType）に 401/403/404 が保持される（ミドルウェア化すると型から落ちる）。
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
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    return c.json({ user: s.user });
  })
  .post("/push/subscriptions", async (c) => {
    // 設定不備（503）はセッション検証より先に返す。
    if (!hasPushConfig(c.env)) {
      return c.json({ error: "push is not configured" } as const, 503);
    }
    const s = await requireSession(c);
    if (!s.ok) return s.res;

    const json = await c.req.json().catch(() => undefined);
    if (!isPushSubscriptionInput(json)) {
      return c.json({ error: "invalid push subscription" } as const, 400);
    }

    await upsertPushSubscription(s.db, s.user.id, json);
    return c.json({ ok: true } as const, 201);
  })
  .delete("/push/subscriptions", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;

    const json = (await c.req.json().catch(() => ({}))) as { endpoint?: unknown };
    const endpoint = typeof json.endpoint === "string" ? json.endpoint : "";
    if (!endpoint) {
      return c.json({ error: "invalid endpoint" } as const, 400);
    }

    await deletePushSubscription(s.db, s.user.id, endpoint);
    return c.json({ ok: true } as const);
  })
  // 自分が所属するルーム一覧（新しい順）。要セッション。
  .get("/rooms", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const rows = await listRoomsForUser(s.db, s.user.id);
    return c.json({
      rooms: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.getTime(),
        unreadCount: Number(r.unreadCount ?? 0),
        myRole: r.role,
      })),
    });
  })
  // ルーム作成。要セッション。id はサーバ採番（UUID）。
  .post("/rooms", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const json = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof json.name === "string" ? json.name.trim() : "";
    if (name.length === 0 || name.length > MAX_ROOM_NAME_LENGTH) {
      return c.json({ error: "invalid room name" } as const, 400);
    }
    // createdAt は明示採番し、DB 既定値への往復なしで正確な値を返す。
    const createdAt = Date.now();
    const id = crypto.randomUUID();
    await createRoomWithOwner(s.db, {
      id,
      name,
      ownerId: s.user.id,
      createdAt: new Date(createdAt),
    });
    return c.json(
      {
        room: {
          id,
          name,
          createdAt,
          unreadCount: 0,
          myRole: "owner" as const,
        },
      },
      201,
    );
  })
  // ルーム名変更。オーナーのみ。
  .patch(
    "/rooms/:roomId",
    // RPC クライアントに json ボディ型を伝えるため validator を通す。
    validator("json", (value: { name?: string }) => value),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const own = await requireOwner(c, s.db, s.user.id, roomId);
      if (!own.ok) return own.res;

      const json = c.req.valid("json");
      const name = typeof json.name === "string" ? json.name.trim() : "";
      if (name.length === 0 || name.length > MAX_ROOM_NAME_LENGTH) {
        return c.json({ error: "invalid room name" } as const, 400);
      }

      await updateRoomName(s.db, roomId, name);
      return c.json({ room: { id: roomId, name } } as const);
    },
  )
  // ルーム削除。オーナーのみ。messages/room_members は FK の CASCADE で削除される。
  .delete("/rooms/:roomId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const own = await requireOwner(c, s.db, s.user.id, roomId);
    if (!own.ok) return own.res;

    await deleteRoom(s.db, roomId);
    // 既存接続を切る（FK CASCADE 後の WS が古い状態のままになるのを防ぐ）。
    await disconnectRoomAll(c.env, roomId);
    return c.json({ ok: true } as const);
  })
  // 自分の lastReadAt を進める。`at` は既読化したい時刻のミリ秒。
  .post(
    "/rooms/:roomId/read",
    // RPC クライアントに json ボディ型を伝えるため validator を通す。
    validator("json", (value: { at?: number }) => value),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const mem = await requireMember(c, s.db, s.user.id, roomId);
      if (!mem.ok) return mem.res;

      const json = c.req.valid("json");
      const atMs = typeof json.at === "number" ? json.at : Date.now();
      if (!Number.isFinite(atMs) || atMs < 0) {
        return c.json({ error: "invalid at" } as const, 400);
      }

      await markRoomRead(s.db, roomId, s.user.id, new Date(atMs));
      return c.json({ ok: true } as const);
    },
  )
  // ルームメンバー一覧。所属メンバーのみ閲覧可。
  .get("/rooms/:roomId/members", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    const members = await listRoomMembers(s.db, roomId);
    return c.json({
      members: members.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        role: m.role,
        joinedAt: m.joinedAt.getTime(),
      })),
    });
  })
  // オーナーがメールアドレスで登録済みユーザーをルームへ追加する。
  .post(
    "/rooms/:roomId/members",
    // RPC クライアントに json ボディ型を伝えるため validator を通す。
    validator("json", (value: { email?: string }) => value),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const own = await requireOwner(c, s.db, s.user.id, roomId);
      if (!own.ok) return own.res;

      const json = c.req.valid("json");
      const email = typeof json.email === "string" ? json.email.trim() : "";
      if (!isEmailLike(email)) {
        return c.json({ error: "invalid email" } as const, 400);
      }
      const target = await findUserByEmail(s.db, email);
      if (!target) {
        return c.json({ error: "user not found" } as const, 404);
      }
      const userId = target.id;

      const existing = await getRoomMembership(s.db, roomId, userId);
      if (existing.status === "member") {
        return c.json(
          { error: "user is already a member", role: existing.role } as const,
          409,
        );
      }

      const joinedAt = Date.now();
      await s.db
        .insert(roomMembers)
        .values({
          roomId,
          userId,
          role: "member",
          joinedAt: new Date(joinedAt),
          // 参加時点では過去のメッセージを未読としない（既読位置 = 参加時刻）。
          lastReadAt: new Date(joinedAt),
        })
        .onConflictDoNothing();

      return c.json({ member: { userId, role: "member", joinedAt } }, 201);
    },
  )
  // オーナーがメンバーを外す。自分自身の owner 権限削除は拒否する。
  .delete("/rooms/:roomId/members/:userId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const targetUserId = c.req.param("userId");
    const own = await requireOwner(c, s.db, s.user.id, roomId);
    if (!own.ok) return own.res;

    const target = await getRoomMembership(s.db, roomId, targetUserId);
    if (target.status !== "member") {
      return c.json({ error: "member not found" } as const, 404);
    }
    if (target.role === "owner") {
      return c.json({ error: "owner cannot be removed" } as const, 400);
    }

    await s.db
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
  // メッセージ編集。本人のみ。論理削除済みは編集不可。
  .patch(
    "/rooms/:roomId/messages/:messageId",
    validator("json", (value: { body?: string }) => value),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const messageId = c.req.param("messageId");
      const mem = await requireMember(c, s.db, s.user.id, roomId);
      if (!mem.ok) return mem.res;

      const json = c.req.valid("json");
      const body = typeof json.body === "string" ? json.body.trim() : "";
      if (body.length === 0 || body.length > MAX_MESSAGE_LENGTH) {
        return c.json({ error: "invalid body" } as const, 400);
      }

      const existing = await getMessageById(s.db, messageId);
      if (!existing || existing.roomId !== roomId) {
        return c.json({ error: "message not found" } as const, 404);
      }
      if (existing.userId !== s.user.id) {
        return c.json({ error: "forbidden" } as const, 403);
      }
      if (existing.deletedAt) {
        return c.json({ error: "message is deleted" } as const, 410);
      }

      const editedAt = new Date();
      await updateMessageBody(s.db, messageId, body, editedAt);

      const updated = toChatMessage({
        ...existing,
        userName: s.user.name,
        body,
        editedAt,
      });
      await broadcastMessageUpdate(c.env, roomId, updated);
      return c.json({ message: updated } as const);
    },
  )
  // メッセージ削除（論理削除）。本人のみ。
  .delete("/rooms/:roomId/messages/:messageId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const messageId = c.req.param("messageId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    const existing = await getMessageById(s.db, messageId);
    if (!existing || existing.roomId !== roomId) {
      return c.json({ error: "message not found" } as const, 404);
    }
    if (existing.userId !== s.user.id) {
      return c.json({ error: "forbidden" } as const, 403);
    }
    if (existing.deletedAt) {
      return c.json({ ok: true } as const);
    }

    const deletedAt = new Date();
    await softDeleteMessage(s.db, messageId, deletedAt);

    const updated = toChatMessage({
      ...existing,
      userName: s.user.name,
      body: "",
      deletedAt,
    });
    await broadcastMessageUpdate(c.env, roomId, updated);
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
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const mem = await requireMember(c, s.db, s.user.id, roomId);
      if (!mem.ok) return mem.res;

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

      const list = await listMessages(s.db, { roomId, limit, before });
      return c.json({ messages: list });
    },
  );

export default app;
export type AppType = typeof routes;
