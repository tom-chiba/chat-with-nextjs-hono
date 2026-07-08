import {
  messageEditSchema,
  messagesQuerySchema,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
} from "@repo/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { Db } from "../db";
import { deleteAttachmentsForMessage, listAttachmentsForMessages } from "../db/attachments";
import {
  getMessageById,
  listMessages,
  softDeleteMessage,
  toChatMessage,
  updateMessageBody,
} from "../db/messages";
import { requireMemberSession } from "../guards";
import { broadcastMessageUpdate } from "../realtime";
import type { Bindings } from "../types";
import { jsonValidator, queryValidator } from "../validators";

/**
 * 編集・削除対象メッセージの所有者チェック（取得→ルーム一致→本人確認）。
 * 論理削除済みかどうかの扱いは編集/削除で異なるため、呼び出し側で判定する。
 */
async function loadOwnMessage(
  c: Context<{ Bindings: Bindings }>,
  db: Db,
  roomId: string,
  messageId: string,
  userId: string,
) {
  const existing = await getMessageById(db, messageId);
  if (!existing || existing.roomId !== roomId) {
    return { ok: false as const, res: c.json({ error: "message not found" } as const, 404) };
  }
  if (existing.userId !== userId) {
    return { ok: false as const, res: c.json({ error: "forbidden" } as const, 403) };
  }
  return { ok: true as const, message: existing };
}

/**
 * `/rooms/:roomId/messages`: メッセージ履歴の取得と編集 / 削除。
 * `:roomId` を自身の path に含めることで RPC 型・param 型を保ったまま、
 * `roomsApp` に `/` でマウントして合成する。
 */
export const messagesApp = new Hono<{ Bindings: Bindings }>()
  // ルームのメッセージ履歴（古い順）。`before`/`beforeId` で過去ページをたどる。要セッション。
  .get("/:roomId/messages", queryValidator(messagesQuerySchema), async (c) => {
    const roomId = c.req.param("roomId");
    const s = await requireMemberSession(c, roomId);
    if (!s.ok) return s.res;

    const q = c.req.valid("query");
    const rawLimit = Number(q.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), MESSAGE_PAGE_SIZE_MAX)
        : MESSAGE_PAGE_SIZE;

    const beforeMs = Number(q.before);
    const before =
      Number.isFinite(beforeMs) && q.before && q.beforeId
        ? { createdAt: beforeMs, id: q.beforeId }
        : undefined;

    const list = await listMessages(s.db, { roomId, limit, before });
    return c.json({ messages: list });
  })
  // メッセージ編集。本人のみ。論理削除済みは編集不可。
  .patch(
    "/:roomId/messages/:messageId",
    jsonValidator(messageEditSchema, "invalid body"),
    async (c) => {
      const roomId = c.req.param("roomId");
      const messageId = c.req.param("messageId");
      const s = await requireMemberSession(c, roomId);
      if (!s.ok) return s.res;

      const { body } = c.req.valid("json");
      const own = await loadOwnMessage(c, s.db, roomId, messageId, s.user.id);
      if (!own.ok) return own.res;
      const existing = own.message;
      if (existing.deletedAt) {
        return c.json({ error: "message is deleted" } as const, 410);
      }

      const editedAt = new Date();
      await updateMessageBody(s.db, messageId, body, editedAt);

      // 編集は本文のみ変更する。添付は変わらないので、配信 update に元の添付を含める
      // （渡さないと `toChatMessage` の既定 [] になり、編集直後に画像が消えてしまう）。
      const attachments =
        (await listAttachmentsForMessages(s.db, [messageId])).get(messageId) ?? [];
      const updated = toChatMessage(
        {
          ...existing,
          userName: existing.senderName,
          body,
          editedAt,
        },
        attachments,
      );
      await broadcastMessageUpdate(c.env, roomId, updated);
      return c.json({ message: updated } as const);
    },
  )
  // メッセージ削除（論理削除）。本人のみ。
  .delete("/:roomId/messages/:messageId", async (c) => {
    const roomId = c.req.param("roomId");
    const messageId = c.req.param("messageId");
    const s = await requireMemberSession(c, roomId);
    if (!s.ok) return s.res;

    const own = await loadOwnMessage(c, s.db, roomId, messageId, s.user.id);
    if (!own.ok) return own.res;
    const existing = own.message;
    if (existing.deletedAt) {
      return c.json({ ok: true } as const);
    }

    const deletedAt = new Date();
    await softDeleteMessage(s.db, messageId, deletedAt);

    // 論理削除では本文・添付ともに伏せる（配信でも隠す）。添付の実体は残しても参照
    // されないため、行と R2 実体をここで回収する。
    const r2Keys = await deleteAttachmentsForMessage(s.db, messageId);
    if (r2Keys.length > 0) await c.env.ATTACHMENTS.delete(r2Keys);

    const updated = toChatMessage({
      ...existing,
      userName: existing.senderName,
      body: "",
      deletedAt,
    });
    await broadcastMessageUpdate(c.env, roomId, updated);
    return c.json({ ok: true } as const);
  });
