import {
  isAllowedImageMimeType,
  MAX_ATTACHMENT_BYTES,
} from "@repo/shared";
import { Hono } from "hono";
import {
  createAttachment,
  deleteUnlinkedAttachment,
  getAttachmentById,
} from "../db/attachments";
import { getMessageById } from "../db/messages";
import { requireMember, requireSession } from "../guards";
import type { Bindings } from "../types";

/** R2 に保存するオブジェクトキー。ルームごとに名前空間を切る。 */
function attachmentR2Key(roomId: string, attachmentId: string): string {
  return `rooms/${roomId}/${attachmentId}`;
}

/**
 * `/rooms/:roomId/attachments`: 画像添付の先行アップロードと配信。
 *
 * アップロードはメッセージ送信に先行する。ここで R2 に保存して attachment 行
 * （`messageId` は null）を作り、返した id を WebSocket のメッセージ送信に添える。
 * `:roomId` を自身の path に含め、`roomsApp` に `/` でマウントして合成する
 * （messages / members と同じ方式）。
 */
export const attachmentsApp = new Hono<{ Bindings: Bindings }>()
  // 画像を 1 枚アップロードする。multipart の `file` フィールドを受け取る。要メンバー。
  .post("/:roomId/attachments", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: "invalid form data" } as const, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file is required" } as const, 400);
    }
    if (!isAllowedImageMimeType(file.type)) {
      return c.json({ error: "unsupported media type" } as const, 415);
    }
    if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "file too large" } as const, 413);
    }

    const id = crypto.randomUUID();
    const r2Key = attachmentR2Key(roomId, id);
    // ArrayBuffer で渡す（ReadableStream は型ソース差でストリーム型の変性が合わないため）。
    // 上限 10 MiB とサイズ検証済みなので一括読み込みで問題ない。
    await c.env.ATTACHMENTS.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    try {
      await createAttachment(s.db, {
        id,
        roomId,
        userId: s.user.id,
        r2Key,
        mimeType: file.type,
        size: file.size,
      });
    } catch (e) {
      // DB 記録に失敗したら、参照できない R2 実体を残さないよう put を巻き戻す。
      await c.env.ATTACHMENTS.delete(r2Key);
      throw e;
    }

    return c.json(
      { attachment: { id, mimeType: file.type, size: file.size } } as const,
      201,
    );
  })
  // 未送信の添付を取り消す（サムネイルの × 削除）。要メンバー。自分の未紐付けのみ削除可。
  .delete("/:roomId/attachments/:attachmentId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    const attachmentId = c.req.param("attachmentId");
    const r2Key = await deleteUnlinkedAttachment(s.db, {
      id: attachmentId,
      roomId,
      userId: s.user.id,
    });
    // 対象が無い（他人・別ルーム・既にメッセージへ紐付け済み・存在しない）は 404。
    if (!r2Key) {
      return c.json({ error: "not found" } as const, 404);
    }
    await c.env.ATTACHMENTS.delete(r2Key);
    return c.json({ ok: true } as const);
  })
  // 添付画像の実体を配信する。要メンバー（ルームの所属者だけが取得できる）。
  .get("/:roomId/attachments/:attachmentId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    const attachmentId = c.req.param("attachmentId");
    const attachment = await getAttachmentById(s.db, attachmentId);
    // URL の roomId と実体の roomId が一致しないアクセスは弾く（他ルームからの取得防止）。
    if (!attachment || attachment.roomId !== roomId) {
      return c.json({ error: "not found" } as const, 404);
    }
    // 紐付くメッセージが論理削除済みなら、フィード同様に添付も伏せる（直接取得も 404）。
    if (attachment.messageId) {
      const message = await getMessageById(s.db, attachment.messageId);
      if (!message || message.deletedAt !== null) {
        return c.json({ error: "not found" } as const, 404);
      }
    }

    const object = await c.env.ATTACHMENTS.get(attachment.r2Key);
    if (!object) {
      return c.json({ error: "not found" } as const, 404);
    }

    // ArrayBuffer で返す（R2 の ReadableStream 型は web 側 tsc の DOM 型と衝突するため）。
    // 添付は上限 10 MiB なので一括読み出しで問題ない。
    const body = await object.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", attachment.mimeType);
    headers.set("Content-Length", String(attachment.size));
    // 添付は不変（id ごとに 1 実体）。長期キャッシュを許可する。
    headers.set("Cache-Control", "private, max-age=31536000, immutable");
    headers.set("Content-Disposition", "inline");
    // 申告 MIME のみで inline 配信するため、ブラウザの content sniffing を止める。
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(body, { headers });
  });
