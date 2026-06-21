/**
 * チャットの共有型。FE / BE（Worker・Durable Object）で共有する。
 */

/**
 * チャットルーム。DB の `rooms` 行をクライアント向けにシリアライズした形
 * （`createdAt` をミリ秒エポックにする）。
 */
export type Room = {
  id: string;
  name: string;
  /** ミリ秒エポック（`rooms.created_at`）。 */
  createdAt: number;
  /** 自分が書いたものを除く、未読のメッセージ件数。 */
  unreadCount: number;
};

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

/** ルーム名の最大長（文字数）。 */
export const MAX_ROOM_NAME_LENGTH = 50;

/** メッセージ履歴 1 ページの既定/最大件数。 */
export const MESSAGE_PAGE_SIZE = 30;
export const MESSAGE_PAGE_SIZE_MAX = 100;
