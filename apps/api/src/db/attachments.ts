import type { MessageAttachment } from "@repo/shared";
import { allowedImageMimeTypeSchema } from "@repo/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { attachments } from "./schema";

/** DB の attachment 行を API 公開型 {@link MessageAttachment} へ変換する。 */
function toMessageAttachment(row: {
  id: string;
  mimeType: string;
  size: number;
}): MessageAttachment {
  return {
    id: row.id,
    // DB は allowlist で書き込むため実質必ず通るが、念のため型を絞る。
    mimeType: allowedImageMimeTypeSchema.parse(row.mimeType),
    size: row.size,
  };
}

/**
 * まだメッセージに紐付いていない（`messageId` が null の）アップロード済み添付を 1 件作成する。
 * 実体は呼び出し側が R2 に put 済みで、ここはメタデータのみ記録する。
 */
export async function createAttachment(
  db: Db,
  a: {
    id: string;
    roomId: string;
    userId: string;
    r2Key: string;
    mimeType: string;
    size: number;
  },
): Promise<void> {
  await db.insert(attachments).values(a);
}

/** id で添付を 1 件取得する（配信・削除の認可判定用）。無ければ null。 */
export async function getAttachmentById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * アップロード済みの未紐付け添付をメッセージへ紐付ける。
 *
 * 指定 id のうち「同一ルーム・同一アップロード者・未紐付け（messageId が null）」の
 * ものだけを対象に `messageId` をセットする。他人の添付や既に他メッセージに紐付いた
 * 添付は対象外となり、結果として横取りを防ぐ。紐付いた添付行を返す。
 */
export async function attachToMessage(
  db: Db,
  opts: {
    messageId: string;
    attachmentIds: string[];
    roomId: string;
    userId: string;
  },
): Promise<MessageAttachment[]> {
  const { messageId, attachmentIds, roomId, userId } = opts;
  if (attachmentIds.length === 0) return [];

  const updated = await db
    .update(attachments)
    .set({ messageId })
    .where(
      and(
        inArray(attachments.id, attachmentIds),
        eq(attachments.roomId, roomId),
        eq(attachments.userId, userId),
        isNull(attachments.messageId),
      ),
    )
    .returning({
      id: attachments.id,
      mimeType: attachments.mimeType,
      size: attachments.size,
      createdAt: attachments.createdAt,
    });

  // 送信時に指定された順序（attachmentIds）を保って返す。
  const byId = new Map(updated.map((r) => [r.id, r]));
  return attachmentIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map(toMessageAttachment);
}

/**
 * 複数メッセージの添付をまとめて取得し、messageId ごとにまとめて返す。
 * 添付は `created_at, id` 昇順（＝アップロード順に近い安定順）で並べる。
 */
export async function listAttachmentsForMessages(
  db: Db,
  messageIds: string[],
): Promise<Map<string, MessageAttachment[]>> {
  const result = new Map<string, MessageAttachment[]>();
  if (messageIds.length === 0) return result;

  const rows = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      mimeType: attachments.mimeType,
      size: attachments.size,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds));

  rows.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  for (const row of rows) {
    if (row.messageId === null) continue;
    const list = result.get(row.messageId) ?? [];
    list.push(toMessageAttachment(row));
    result.set(row.messageId, list);
  }
  return result;
}
