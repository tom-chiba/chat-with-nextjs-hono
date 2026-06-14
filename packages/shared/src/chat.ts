/**
 * チャットの共有型。FE / BE（Worker・Durable Object）で共有する。
 */

/**
 * クライアントに配信する 1 メッセージ。
 * DB の `messages` 行に送信者名（`userName`）を付与した形。
 */
export type ChatMessage = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  /** ミリ秒エポック（`messages.created_at`）。 */
  createdAt: number;
};

/** クライアント → サーバ。 */
export type ClientMessage = { type: "message"; body: string };

/** サーバ → クライアント。 */
export type ServerMessage =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage };

/** WebSocket で送る body の最大長（文字数）。 */
export const MAX_MESSAGE_LENGTH = 2000;
