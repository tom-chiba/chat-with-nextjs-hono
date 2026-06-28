/**
 * チャットの共有型。FE / BE（Worker・Durable Object）で共有する。
 *
 * 型・検証・パースは zod スキーマを単一情報源とし、公開型は `z.infer` で導出する。
 * 入力制約（最大長など）の定数もスキーマに織り込み、検証の二重管理を避ける。
 */

import { z } from "zod";

/** ルーム内のメンバーロール。owner は編集・削除・メンバー管理が可能。 */
export type RoomRole = "owner" | "member";

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
  /** 自分のロール。UI でオーナー専用操作の出し分けに使う。 */
  myRole: RoomRole;
};

/** ルームメンバー。メンバー管理 UI と API レスポンスで共有する。 */
export type RoomMember = {
  userId: string;
  userName: string;
  role: RoomRole;
  /** ミリ秒エポック（`room_members.joined_at`）。 */
  joinedAt: number;
};

/* ===== 入力制約の定数（スキーマと共有する単一情報源） ===== */

/** WebSocket で送る body の最大長（文字数）。 */
export const MAX_MESSAGE_LENGTH = 2000;

/** ルーム名の最大長（文字数）。 */
export const MAX_ROOM_NAME_LENGTH = 50;

/** メッセージ履歴 1 ページの既定/最大件数。 */
export const MESSAGE_PAGE_SIZE = 30;
export const MESSAGE_PAGE_SIZE_MAX = 100;

/** WebSocket 接続直後にサーバが送る初期履歴の件数。 */
export const HISTORY_LIMIT = 50;

/* ===== 共有スキーマ（型・検証の単一情報源） ===== */

/**
 * クライアントに配信する 1 メッセージのスキーマ。
 * DB の `messages` 行に送信者名（`userName`）を付与した形。
 */
export const chatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  userId: z.string(),
  userName: z.string(),
  body: z.string(),
  /** ミリ秒エポック（`messages.created_at`）。 */
  createdAt: z.number(),
  /** ミリ秒エポック。未編集なら null。 */
  editedAt: z.number().nullable(),
  /** ミリ秒エポック。削除されていなければ null。 */
  deletedAt: z.number().nullable(),
});

/**
 * クライアントに配信する 1 メッセージ。
 *
 * - `editedAt` は編集された時刻。未編集なら null。
 * - `deletedAt` は論理削除された時刻。削除されていれば `body` は空文字で配信される。
 */
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * メッセージ本文（WS 送信 / REST 編集）の検証スキーマ。
 * 前後空白を除去し、空・上限超過を弾く。出力は trim 済みの本文。
 */
export const messageBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MESSAGE_LENGTH);

/** ルーム名（作成 / 改名）の検証スキーマ。trim 済みを返す。 */
export const roomNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ROOM_NAME_LENGTH);

/** クライアント → サーバ。 */
export const clientMessageSchema = z.object({
  type: z.literal("message"),
  body: messageBodySchema,
});
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** クライアントが分岐に使う想定のエラーコード。 */
export const serverErrorCodeSchema = z.enum(["rate_limited"]);
export type ServerErrorCode = z.infer<typeof serverErrorCodeSchema>;

/** サーバ → クライアント。 */
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("history"), messages: z.array(chatMessageSchema) }),
  z.object({ type: z.literal("message"), message: chatMessageSchema }),
  /** 既存メッセージの更新（編集・論理削除）。クライアントは id でマッチして差し替える。 */
  z.object({ type: z.literal("update"), message: chatMessageSchema }),
  z.object({
    type: z.literal("error"),
    code: serverErrorCodeSchema,
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * 本文中の `@<name>` を検出する正規表現。
 *
 * - 行頭または直前が空白の `@` だけを拾う（メールアドレス `a@example.com` を誤検出しないため）。
 * - 区切り（空白・改行・主要な句読点・全角句点）の直前まで `<name>` として拾う。
 * - 表示名に英数・日本語・記号が含まれうるため、終端記号以外は許容する。
 * - グローバル付きで状態を持つため、利用側で `matchAll` を使うこと。
 */
export const MENTION_PATTERN = /(?<=^|\s)@([^\s@、。,.!?！？]+)/g;

/** 本文から `@<name>` の `<name>` 候補を列挙する（重複は維持）。 */
export function parseMentionCandidates(body: string): string[] {
  return [...body.matchAll(MENTION_PATTERN)].map((m) => m[1] ?? "");
}

/**
 * 本文中の URL を検出する正規表現。
 *
 * - `http://` または `https://` で始まり、空白に当たるまでを 1 つの URL として扱う。
 * - 末尾に句読点や閉じ括弧が付いている可能性は tokenize 側で剥がす。
 */
export const URL_PATTERN = /https?:\/\/[^\s]+/g;

const TRAILING_PUNCT = /[)\].,!?:;'"、。！？]+$/;

export type MessageBodyToken =
  | { type: "text"; value: string }
  | { type: "mention"; value: string }
  | { type: "link"; value: string };

/**
 * メッセージ本文をテキスト / メンション (`@<name>`) / リンク (`http(s)://...`) に分割する。
 *
 * URL に末尾の句読点（例: `https://example.com.` の `.`）が含まれていた場合は剥がして
 * 後続の text トークンへ送る。同位置のメンションと URL は URL を優先する想定だが、現状の
 * 正規表現では衝突しない（URL は空白で区切られ、メンションは `@` 開始のため）。
 */
export function tokenizeMessageBody(body: string): MessageBodyToken[] {
  const tokens: MessageBodyToken[] = [];
  // 両方の正規表現にマッチした位置を順序付きに集める。
  type RawMatch = { start: number; end: number; type: "mention" | "link"; value: string };
  const matches: RawMatch[] = [];
  for (const m of body.matchAll(new RegExp(MENTION_PATTERN.source, "g"))) {
    const start = m.index ?? 0;
    matches.push({ start, end: start + m[0].length, type: "mention", value: m[0] });
  }
  for (const m of body.matchAll(new RegExp(URL_PATTERN.source, "g"))) {
    const start = m.index ?? 0;
    let value = m[0];
    const trailing = value.match(TRAILING_PUNCT)?.[0] ?? "";
    if (trailing) value = value.slice(0, value.length - trailing.length);
    if (value.length === 0) continue;
    matches.push({ start, end: start + value.length, type: "link", value });
  }
  matches.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue; // 重なりは先勝ち
    if (m.start > cursor) {
      tokens.push({ type: "text", value: body.slice(cursor, m.start) });
    }
    tokens.push({ type: m.type, value: m.value });
    cursor = m.end;
  }
  if (cursor < body.length) {
    tokens.push({ type: "text", value: body.slice(cursor) });
  }
  return tokens;
}
