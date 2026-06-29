import {
  messageEditSchema,
  messagesQuerySchema,
  MESSAGE_PAGE_SIZE,
  MESSAGE_PAGE_SIZE_MAX,
} from "@repo/shared";
import { Hono } from "hono";
import {
  getMessageById,
  listMessages,
  softDeleteMessage,
  toChatMessage,
  updateMessageBody,
} from "../db/messages";
import { requireMember, requireSession } from "../guards";
import { broadcastMessageUpdate } from "../realtime";
import type { Bindings } from "../types";
import { jsonValidator, queryValidator } from "../validators";

/**
 * `/rooms/:roomId/messages`: メッセージ履歴の取得と編集 / 削除。
 * `:roomId` を自身の path に含めることで RPC 型・param 型を保ったまま、
 * `roomsApp` に `/` でマウントして合成する。
 */
export const messagesApp = new Hono<{ Bindings: Bindings }>()
  // ルームのメッセージ履歴（古い順）。`before`/`beforeId` で過去ページをたどる。要セッション。
  .get("/:roomId/messages", queryValidator(messagesQuerySchema), async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

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
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const messageId = c.req.param("messageId");
      const mem = await requireMember(c, s.db, s.user.id, roomId);
      if (!mem.ok) return mem.res;

      const { body } = c.req.valid("json");
      const existing = await getMessageById(s.db, messageId);
      if (!existing || existing.roomId !== roomId) {
        return c.json({ error: "message not found" } as const, 404);
      }
      if (existing.userId !== s.user.id) {
        return c.json({ error: "forbidden" } as const, 403);
      }
      if (existing.deletedAt) {
        return c.json({ error: "message is deleted" } as const, 410);
      }

      const editedAt = new Date();
      await updateMessageBody(s.db, messageId, body, editedAt);

      const updated = toChatMessage({
        ...existing,
        userName: existing.senderName,
        body,
        editedAt,
      });
      await broadcastMessageUpdate(c.env, roomId, updated);
      return c.json({ message: updated } as const);
    },
  )
  // メッセージ削除（論理削除）。本人のみ。
  .delete("/:roomId/messages/:messageId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const messageId = c.req.param("messageId");
    const mem = await requireMember(c, s.db, s.user.id, roomId);
    if (!mem.ok) return mem.res;

    const existing = await getMessageById(s.db, messageId);
    if (!existing || existing.roomId !== roomId) {
      return c.json({ error: "message not found" } as const, 404);
    }
    if (existing.userId !== s.user.id) {
      return c.json({ error: "forbidden" } as const, 403);
    }
    if (existing.deletedAt) {
      return c.json({ ok: true } as const);
    }

    const deletedAt = new Date();
    await softDeleteMessage(s.db, messageId, deletedAt);

    const updated = toChatMessage({
      ...existing,
      userName: existing.senderName,
      body: "",
      deletedAt,
    });
    await broadcastMessageUpdate(c.env, roomId, updated);
    return c.json({ ok: true } as const);
  });
