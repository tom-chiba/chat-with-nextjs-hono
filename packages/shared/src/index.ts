/**
 * 共有パッケージのエントリポイント。
 * Hono RPC の共有型やドメイン型を今後ここに集約する。
 */

export const APP_NAME = "chat-with-nextjs-hono" as const;

export type {
  ChatMessage,
  ClientMessage,
  MessageBodyToken,
  Room,
  RoomMember,
  RoomRole,
  ServerErrorCode,
  ServerMessage,
} from "./chat";
export {
  HISTORY_LIMIT,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MENTION_PATTERN,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  URL_PATTERN,
  parseMentionCandidates,
  tokenizeMessageBody,
} from "./chat";
export {
  EMAIL_PATTERN,
  isEmailLike,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  WS_RATE_LIMIT_WINDOW_MS,
  WS_RATE_LIMIT_MAX,
} from "./policy";
