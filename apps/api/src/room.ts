import { DurableObject } from "cloudflare:workers";
import {
  type ChatMessage,
  type ServerMessage,
  MAX_MESSAGE_LENGTH,
  parseMentionCandidates,
} from "@repo/shared";
import { eq } from "drizzle-orm";
import { createDb } from "./db";
import { listMessages } from "./db/messages";
import { getRoomMembership, listRoomMembers } from "./db/rooms";
import { messages, user } from "./db/schema";
import { sendMessagePushNotifications } from "./push";

/** 接続ごとに WebSocket へ添付する送信者情報（ハイバネ復帰後も保持される）。 */
type SocketAttachment = {
  userId: string;
  userName: string;
  roomId: string;
};

/** 接続直後に返す履歴の件数。 */
const HISTORY_LIMIT = 50;
const DISCONNECT_MEMBER_PATH = "/disconnect-member";
const ROOM_MEMBER_REMOVED_CLOSE_CODE = 1008;
const ROOM_MEMBER_REMOVED_CLOSE_REASON = "removed from room";

/**
 * 1 ルーム = 1 インスタンスのチャットルーム Durable Object。
 * WebSocket Hibernation API で接続を保持し、発言を D1 に保存して全員へ配信する。
 * Worker からのみ到達し、本人情報は upgrade リクエストのヘッダで信頼する。
 */
export class RoomDO extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === DISCONNECT_MEMBER_PATH) {
      return this.disconnectMember(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const userId = request.headers.get("X-User-Id");
    const roomId = request.headers.get("X-Room-Id");
    if (!userId || !roomId) {
      return new Response("Missing identity headers", { status: 400 });
    }

    // 表示名は DB から解決する（ヘッダで非 Latin-1 を運べないため）。
    const userName = await this.resolveUserName(userId);
    if (!userName) {
      return new Response("Unknown user", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation API: 接続をこの DO にバインドし、送信者情報を添付する。
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, userName, roomId } satisfies SocketAttachment);

    // 接続直後に直近の履歴を送る（UI が空にならないように）。
    const history = await this.recentMessages(roomId);
    server.send(
      JSON.stringify({ type: "history", messages: history } satisfies ServerMessage),
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    let body: unknown;
    try {
      const parsed = JSON.parse(text) as { type?: unknown; body?: unknown };
      if (parsed.type !== "message") return;
      body = parsed.body;
    } catch {
      return;
    }

    if (typeof body !== "string") return;
    const trimmed = body.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) return;

    const { userId, userName, roomId } = attachment;
    const db = createDb(this.env.DB);
    const membership = await getRoomMembership(db, roomId, userId);
    if (membership.status !== "member") {
      ws.close(1008, "not a room member");
      return;
    }

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      roomId,
      userId,
      userName,
      body: trimmed,
      createdAt: Date.now(),
    };

    await db.insert(messages).values({
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      body: message.body,
      createdAt: new Date(message.createdAt),
    });

    const payload = JSON.stringify({
      type: "message",
      message,
    } satisfies ServerMessage);
    const activeUserIds = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const socketAttachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (socketAttachment?.roomId === roomId) {
        activeUserIds.add(socketAttachment.userId);
      }
      socket.send(payload);
    }

    // 本文の `@<name>` をルームメンバー名と突き合わせ、メンションされた userId を解決する。
    const mentionedUserIds = await resolveMentionedUserIds(db, roomId, trimmed);

    await sendMessagePushNotifications({
      db,
      env: this.env,
      message,
      excludeUserIds: activeUserIds,
      mentionedUserIds,
    });
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // クローズハンドシェイクを完了させる。ただし 1005/1006 など予約コードは
    // Close フレームに設定できず close() が例外を投げるため、正常コードに丸める。
    const safeCode = code >= 1000 && code <= 4999 && code !== 1004 &&
      code !== 1005 && code !== 1006 && code !== 1015
      ? code
      : 1000;
    ws.close(safeCode, "closing");
  }

  /** userId から表示名を解決する（存在しなければ null）。 */
  private async resolveUserName(userId: string): Promise<string | null> {
    const db = createDb(this.env.DB);
    const rows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  /** ルームの直近メッセージを古い順で返す。 */
  private async recentMessages(roomId: string): Promise<ChatMessage[]> {
    const db = createDb(this.env.DB);
    return listMessages(db, { roomId, limit: HISTORY_LIMIT });
  }


  private async disconnectMember(request: Request): Promise<Response> {
    const json = (await request.json().catch(() => ({}))) as { userId?: unknown };
    const userId = typeof json.userId === "string" ? json.userId : "";
    if (!userId) {
      return Response.json({ error: "invalid user id" } as const, { status: 400 });
    }

    let closed = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.userId !== userId) continue;

      socket.close(
        ROOM_MEMBER_REMOVED_CLOSE_CODE,
        ROOM_MEMBER_REMOVED_CLOSE_REASON,
      );
      closed += 1;
    }

    return Response.json({ closed } as const);
  }
}

/**
 * 本文の `@<name>` をルームメンバー名と突き合わせ、メンションされた userId を返す。
 * 完全一致のみ。最長一致のためメンバー名は長い順に評価する。
 */
async function resolveMentionedUserIds(
  db: ReturnType<typeof createDb>,
  roomId: string,
  body: string,
): Promise<Set<string>> {
  const candidates = parseMentionCandidates(body);
  if (candidates.length === 0) return new Set();

  const members = await listRoomMembers(db, roomId);
  // 表示名 → userId のマップ。同名は最初の 1 件のみ採用（任意性に依存しない MVP）。
  const nameToUserId = new Map<string, string>();
  for (const m of members) {
    if (!nameToUserId.has(m.userName)) nameToUserId.set(m.userName, m.userId);
  }
  // 最長一致: 長いメンバー名から順にスキャンして本文にあるか確かめる。
  const sortedNames = [...nameToUserId.keys()].toSorted(
    (a, b) => b.length - a.length,
  );

  const hits = new Set<string>();
  for (const cand of candidates) {
    const matched = sortedNames.find((name) => cand.startsWith(name));
    if (!matched) continue;
    const userId = nameToUserId.get(matched);
    if (userId) hits.add(userId);
  }
  return hits;
}
