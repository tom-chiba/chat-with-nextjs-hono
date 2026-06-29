import { DurableObject } from "cloudflare:workers";
import {
  type ChatMessage,
  type ServerMessage,
  clientMessageSchema,
  HISTORY_LIMIT,
} from "@repo/shared";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./db";
import { listMessages } from "./db/messages";
import { getRoomMembership } from "./db/rooms";
import { messages, user } from "./db/schema";
import { resolveMentionedUserIds } from "./mentions";
import { sendMessagePushNotifications } from "./push";
import { RateLimiter } from "./rate-limiter";

/** 接続ごとに WebSocket へ添付する送信者情報（ハイバネ復帰後も保持される）。 */
type SocketAttachment = {
  userId: string;
  userName: string;
  roomId: string;
};

const DISCONNECT_MEMBER_PATH = "/disconnect-member";
const DISCONNECT_ALL_PATH = "/disconnect-all";
const BROADCAST_UPDATE_PATH = "/broadcast-update";
const ROOM_MEMBER_REMOVED_CLOSE_CODE = 1008;
const ROOM_MEMBER_REMOVED_CLOSE_REASON = "removed from room";
const ROOM_DELETED_CLOSE_CODE = 1001;
const ROOM_DELETED_CLOSE_REASON = "room deleted";

/**
 * 1 ルーム = 1 インスタンスのチャットルーム Durable Object。
 * WebSocket Hibernation API で接続を保持し、発言を D1 に保存して全員へ配信する。
 * Worker からのみ到達し、本人情報は upgrade リクエストのヘッダで信頼する。
 */
export class RoomDO extends DurableObject<Env> {
  /**
   * ユーザーごとの送信レート制限。DO は単一インスタンスのため in-memory で十分。
   */
  private readonly rateLimiter = new RateLimiter();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === DISCONNECT_MEMBER_PATH) {
      return this.disconnectMember(request);
    }
    if (request.method === "POST" && url.pathname === DISCONNECT_ALL_PATH) {
      return this.disconnectAll();
    }
    if (request.method === "POST" && url.pathname === BROADCAST_UPDATE_PATH) {
      return this.broadcastUpdate(request);
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
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    // スキーマで実検証する。body は trim 済み・長さ検証済みで返る。
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const trimmed = parsed.data.body;
    // 楽観送信の相関キー。配信・拒否でそのままエコーし、送信側が確定 / 失敗を対応づける。
    const nonce = parsed.data.nonce;

    const { userId, userName, roomId } = attachment;
    const db = createDb(this.env.DB);
    const membership = await getRoomMembership(db, roomId, userId);
    if (membership.status !== "member") {
      ws.close(1008, "not a room member");
      return;
    }

    const now = Date.now();
    if (!this.rateLimiter.allow(userId, now)) {
      // 自分にだけエラーを返し、メッセージは破棄する（接続は維持）。
      ws.send(
        JSON.stringify({
          type: "error",
          code: "rate_limited",
          message: "メッセージの送信が早すぎます。少し待ってから再度お試しください。",
          nonce,
        } satisfies ServerMessage),
      );
      return;
    }

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      roomId,
      userId,
      userName,
      body: trimmed,
      createdAt: now,
      editedAt: null,
      deletedAt: null,
    };

    await db.insert(messages).values({
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      senderName: message.userName,
      body: message.body,
      createdAt: new Date(message.createdAt),
    });

    const payload = JSON.stringify({
      type: "message",
      message,
      nonce,
    } satisfies ServerMessage);
    const activeUserIds = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const socketAttachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (socketAttachment?.roomId === roomId) {
        activeUserIds.add(socketAttachment.userId);
      }
      socket.send(payload);
    }

    // 通知（メンション解決 + Push 送信）は配信完了後にバックグラウンドで起動する。
    this.firePushNotifications(db, message, activeUserIds);
  }

  /**
   * メンション解決と Push 送信を WS ハンドラから切り離してバックグラウンド実行する。
   *
   * 発言の保存・配信はこの時点で完了しており、通知はベストエフォート。`ctx.waitUntil` で
   * ハンドラをブロックせずに走らせ、失敗してもクライアントへは何も返せないため例外は
   * 握りつぶす（個別の Push 失敗は `sendMessagePushNotifications` 内でログ済み）。
   */
  private firePushNotifications(
    db: Db,
    message: ChatMessage,
    excludeUserIds: Set<string>,
  ): void {
    this.ctx.waitUntil(
      (async () => {
        try {
          // 本文の `@<name>` をルームメンバー名と突き合わせ、メンション先を解決する。
          const mentionedUserIds = await resolveMentionedUserIds(
            db,
            message.roomId,
            message.body,
          );
          await sendMessagePushNotifications({
            db,
            env: this.env,
            message,
            excludeUserIds,
            mentionedUserIds,
          });
        } catch (error) {
          console.error("Push notification pipeline failed", error);
        }
      })(),
    );
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

  /** ルーム削除時に、この DO に接続中の全 WebSocket を閉じる。 */
  private async disconnectAll(): Promise<Response> {
    let closed = 0;
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(ROOM_DELETED_CLOSE_CODE, ROOM_DELETED_CLOSE_REASON);
      closed += 1;
    }
    return Response.json({ closed } as const);
  }

  /**
   * REST 経由のメッセージ編集 / 削除を、接続中の全 WebSocket に `update` として配信する。
   * 同じルームに属するソケットだけが対象。
   */
  private async broadcastUpdate(request: Request): Promise<Response> {
    const json = (await request.json().catch(() => ({}))) as {
      message?: ChatMessage;
    };
    if (!json.message) {
      return Response.json({ error: "invalid message" } as const, {
        status: 400,
      });
    }
    const payload = JSON.stringify({
      type: "update",
      message: json.message,
    } satisfies ServerMessage);

    let delivered = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.roomId !== json.message.roomId) continue;
      socket.send(payload);
      delivered += 1;
    }
    return Response.json({ delivered } as const);
  }
}
