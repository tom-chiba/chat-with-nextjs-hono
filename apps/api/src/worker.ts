/**
 * Cloudflare Workers の実エントリ。
 * Hono app（default export）と Durable Object クラス（`RoomDO`）を公開する。
 * RPC 型を共有する FE は `./index` を読むため、Worker ランタイム専用のコード
 * （Durable Object フォワード・`RoomDO`）はこのファイルに分離している。
 */
import { cleanupOrphanAttachments } from "./attachments-storage";
import { createAuth } from "./auth";
import { createDb } from "./db";
import { getRoomMembership } from "./db/rooms";
import app from "./index";

/**
 * 孤児添付（アップロードしたまま送信も削除もされなかったもの）を回収する猶予時間。
 * これより古い未紐付け添付を scheduled（cron）で削除する。
 */
const ORPHAN_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

// WebSocket 接続。セッションを検証し、ルームの Durable Object へ本人情報付きでフォワードする。
app.get("/ws/room/:roomId", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.json({ error: "expected websocket upgrade" } as const, 426);
  }

  // WebSocket ハンドシェイクは CORS の保護を受けないため、Origin を明示検証して
  // 別オリジンからの Cookie 付きなりすまし接続を防ぐ。
  if (c.req.header("Origin") !== c.env.WEB_URL) {
    return c.json({ error: "forbidden origin" } as const, 403);
  }

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

  // ROOM は共有 Bindings には載せず、ここで Worker ランタイムのグローバル型に統一して扱う
  // （npm の @cloudflare/workers-types と生成ランタイム型の Request 不一致を避けるため）。
  const room = (c.env as unknown as { ROOM: DurableObjectNamespace }).ROOM;
  const stub = room.get(room.idFromName(roomId));

  // DO は Worker からのみ到達するため、検証済みの userId をヘッダで渡して信頼する。
  // 表示名は非 Latin-1（日本語・絵文字）だと Headers.set が throw するためヘッダに載せず、
  // DO 側で userId から DB 解決する。
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-User-Id", session.user.id);
  headers.set("X-Room-Id", roomId);

  return stub.fetch(new Request(c.req.raw, { headers }));
});

// テスト用に Hono インスタンス（WS ルート登録済み）を名前付きでも公開する。
export { app as workerApp };

export default {
  fetch: app.fetch,
  // 定期実行: 期限切れの孤児添付を R2・DB から回収する。
  async scheduled(_controller, env, ctx) {
    const db = createDb(env.DB);
    const cutoff = Date.now() - ORPHAN_ATTACHMENT_TTL_MS;
    ctx.waitUntil(cleanupOrphanAttachments(db, env.ATTACHMENTS, cutoff));
  },
} satisfies ExportedHandler<Env>;
export { RoomDO } from "./room";
