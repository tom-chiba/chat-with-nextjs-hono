import {
  MAX_ROOM_NAME_LENGTH,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
} from "@repo/shared";
import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { validator } from "hono/validator";
import { type AuthEnv, createAuth } from "./auth";
import { createDb } from "./db";
import { listMessages } from "./db/messages";
import { rooms } from "./db/schema";

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

// Web（別サブドメイン = 別オリジン）からの Cookie 認証クロスオリジン呼び出しを許可する。
// WebSocket の upgrade は CORS の対象外で、101 応答にヘッダを付けると干渉するためスキップする。
app.use("*", (c, next) =>
  c.req.header("upgrade")?.toLowerCase() === "websocket"
    ? next()
    : cors({
        origin: c.env.WEB_URL,
        credentials: true,
        allowHeaders: ["Content-Type"],
        allowMethods: ["GET", "POST", "OPTIONS"],
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
  // 保護ルートの例：有効なセッションが無ければ 401。
  .get("/me", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }
    return c.json({ user: session.user });
  })
  // ルーム一覧（新しい順）。要セッション。
  .get("/rooms", async (c) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "unauthorized" } as const, 401);
    }
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(rooms)
      .orderBy(desc(rooms.createdAt), desc(rooms.id));
    return c.json({
      rooms: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.getTime(),
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
    await db.insert(rooms).values({ id, name, createdAt: new Date(createdAt) });
    return c.json({ room: { id, name, createdAt } }, 201);
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
      const list = await listMessages(db, { roomId, limit, before });
      return c.json({ messages: list });
    },
  );

export default app;
export type AppType = typeof routes;
