/**
 * 共有パッケージのエントリポイント。
 * Hono RPC の共有型やドメイン型を今後ここに集約する。
 */

export const APP_NAME = "chat-with-nextjs-hono" as const;

export type {
  ChatMessage,
  ClientMessage,
  ServerMessage,
} from "./chat";
export { MAX_MESSAGE_LENGTH } from "./chat";
