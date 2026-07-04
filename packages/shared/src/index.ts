/**
 * 共有パッケージのエントリポイント。
 * Hono RPC の共有型やドメイン型を今後ここに集約する。
 */

export const APP_NAME = "chat" as const;

export type {
  AllowedImageMimeType,
  ChatMessage,
  ClientMessage,
  MessageAttachment,
  MessageBodyToken,
  Room,
  RoomMember,
  RoomRole,
  ServerErrorCode,
  ServerMessage,
} from "./chat";
export {
  ALLOWED_IMAGE_MIME_TYPES,
  allowedImageMimeTypeSchema,
  chatMessageSchema,
  clientMessageSchema,
  HISTORY_LIMIT,
  isAllowedImageMimeType,
  isWithinMessageLength,
  isWithinRoomNameLength,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MENTION_PATTERN,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
  messageAttachmentSchema,
  messageBodySchema,
  nonceSchema,
  parseMentionCandidates,
  roomNameSchema,
  sendMessageBodySchema,
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
  ATTACHMENT_UPLOAD_RATE_MAX,
  ATTACHMENT_UPLOAD_RATE_WINDOW_MS,
  EMAIL_PATTERN,
  emailSchema,
  isEmailLike,
  MAX_ATTACHMENT_STORAGE_BYTES_PER_USER,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  WS_RATE_LIMIT_MAX,
  WS_RATE_LIMIT_WINDOW_MS,
} from "./policy";
export { countGraphemes } from "./text";
