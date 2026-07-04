/**
 * 共有パッケージのエントリポイント。
 * Hono RPC の共有型やドメイン型を今後ここに集約する。
 */

export const APP_NAME = "chat" as const;

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
  chatMessageSchema,
  clientMessageSchema,
  HISTORY_LIMIT,
  isWithinMessageLength,
  isWithinRoomNameLength,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MENTION_PATTERN,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  messageBodySchema,
  nonceSchema,
  parseMentionCandidates,
  roomNameSchema,
  serverErrorCodeSchema,
  serverMessageSchema,
  tokenizeMessageBody,
  URL_PATTERN,
} from "./chat";
export {
  memberAddSchema,
  messageEditSchema,
  messagesQuerySchema,
  type PushSubscriptionInput,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  roomNameInputSchema,
  roomReadSchema,
} from "./inputs";
export {
  EMAIL_PATTERN,
  emailSchema,
  isEmailLike,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  WS_RATE_LIMIT_MAX,
  WS_RATE_LIMIT_WINDOW_MS,
} from "./policy";
export { countGraphemes } from "./text";
