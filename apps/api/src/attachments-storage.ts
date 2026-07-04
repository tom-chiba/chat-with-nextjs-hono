import type { Db } from "./db";
import {
  deleteAttachmentsByIds,
  listOrphanAttachments,
} from "./db/attachments";

/**
 * 添付の R2 実体操作に必要な最小インターフェース。
 *
 * `@cloudflare/workers-types` の `R2Bucket` と `wrangler types` 生成の `R2Bucket` は
 * 型ソースが異なり相互代入で不整合になり得るため、使う操作だけを構造型で受ける
 * （呼び出し側の実バケットはどちらの型でも構造的に満たす）。
 */
export type AttachmentBucket = {
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
};

/**
 * 送信も削除もされないまま残った孤児添付（`messageId` が null かつ `cutoff` より前）を
 * R2 実体・DB 行ともに回収する。scheduled（cron）から定期実行する想定。回収件数を返す。
 */
export async function cleanupOrphanAttachments(
  db: Db,
  bucket: AttachmentBucket,
  cutoff: number,
): Promise<number> {
  const orphans = await listOrphanAttachments(db, cutoff);
  if (orphans.length === 0) return 0;
  // R2 を先に消し、成功したら DB 行を消す（DB を先に消すと R2 が孤児になるため）。
  await bucket.delete(orphans.map((o) => o.r2Key));
  await deleteAttachmentsByIds(
    db,
    orphans.map((o) => o.id),
  );
  return orphans.length;
}

/**
 * 指定ルームに属する添付の R2 実体をプレフィックス（`rooms/<roomId>/`）で全削除する。
 * ルーム削除時、DB 側は FK cascade で消えるが R2 実体は残るため、これで回収する。
 */
export async function deleteRoomAttachmentObjects(
  bucket: AttachmentBucket,
  roomId: string,
): Promise<void> {
  const prefix = `rooms/${roomId}/`;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length > 0) await bucket.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
