/**
 * 共有パッケージのエントリポイント。
 * Hono RPC の共有型やドメイン型を今後ここに集約する。
 */

export const APP_NAME = "chat-with-nextjs-hono" as const;

export type {
  ChatMessage,
  ClientMessage,
  Room,
  ServerMessage,
} from "./chat";
export {
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MENTION_PATTERN,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  parseMentionCandidates,
} from "./chat";
