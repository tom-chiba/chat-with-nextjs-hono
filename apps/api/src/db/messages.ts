import type { ChatMessage } from "@repo/shared";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./index";
import { messages } from "./schema";

/** メッセージ一覧のキーセットカーソル（この位置より「古い」ものを返す）。 */
export type MessageCursor = { createdAt: number; id: string };

/** DB 行（`Date` ベース）を API 公開型 {@link ChatMessage}（ミリ秒エポック）へ変換する。 */
type ChatMessageRow = {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * DB 行を {@link ChatMessage} へ変換する単一の変換点。
 * 論理削除済みなら本文を伏せ（空文字）、`editedAt` も隠す。チャット履歴に穴を
 * 作らないため行は残し、「削除済み」プレースホルダとして返す。
 */
export function toChatMessage(row: ChatMessageRow): ChatMessage {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    userName: row.userName,
    body: deleted ? "" : row.body,
    createdAt: row.createdAt.getTime(),
    editedAt: deleted ? null : (row.editedAt?.getTime() ?? null),
    deletedAt: row.deletedAt?.getTime() ?? null,
  };
}

/**
 * ルームのメッセージを古い順（昇順）で返す。
 *
 * 並びは `(created_at, id)` のタイブレーク付き。同一ミリ秒のメッセージでも
 * 安定した順序になり、`cursor` を使ったキーセットページネーションが破綻しない。
 * `cursor` を渡すと、その位置より厳密に古いメッセージだけを返す。
 *
 * 論理削除されたメッセージ（`deleted_at` あり）はクライアントに「削除済み」として返す。
 * 本文は空、`editedAt` も伏せる。チャット履歴に穴を作らないため、行ごと省くのではなく
 * プレースホルダとして残す。
 */
export async function listMessages(
  db: Db,
  opts: { roomId: string; limit: number; before?: MessageCursor },
): Promise<ChatMessage[]> {
  const { roomId, limit, before } = opts;

  const olderThanCursor = before
    ? or(
        lt(messages.createdAt, new Date(before.createdAt)),
        and(
          eq(messages.createdAt, new Date(before.createdAt)),
          lt(messages.id, before.id),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: messages.id,
      roomId: messages.roomId,
      userId: messages.userId,
      body: messages.body,
      createdAt: messages.createdAt,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      // 送信時のスナップショットを返す。改名しても過去メッセージは固定。
      userName: messages.senderName,
    })
    .from(messages)
    .where(and(eq(messages.roomId, roomId), olderThanCursor))
    // 直近 limit 件を取りたいので降順で取得し、最後に昇順へ反転する。
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);

  return rows.map(toChatMessage).toReversed();
}

/**
 * 1 件のメッセージを取得する（編集 / 削除の所有者チェック用）。
 * 行が無ければ null。
 */
export async function getMessageById(db: Db, messageId: string) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  return rows[0] ?? null;
}

/** メッセージ本文を更新する。`editedAt` も同時に更新する。 */
export async function updateMessageBody(
  db: Db,
  messageId: string,
  body: string,
  editedAt: Date,
) {
  await db
    .update(messages)
    .set({ body, editedAt })
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
}

/** メッセージを論理削除する。本文は空文字に書き換える。 */
export async function softDeleteMessage(
  db: Db,
  messageId: string,
  deletedAt: Date,
) {
  await db
    .update(messages)
    .set({ body: "", deletedAt })
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
}
