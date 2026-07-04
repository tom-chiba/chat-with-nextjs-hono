import { roomNameInputSchema, roomReadSchema } from "@repo/shared";
import { Hono } from "hono";
import {
  createRoomWithOwner,
  deleteRoom,
  listRoomsForUser,
  markRoomRead,
  updateRoomName,
} from "../db/rooms";
import { requireOwner, requireMember, requireSession } from "../guards";
import { disconnectRoomAll } from "../realtime";
import type { Bindings } from "../types";
import { jsonValidator } from "../validators";
import { membersApp } from "./members";
import { attachmentsApp } from "./attachments";
import { messagesApp } from "./messages";

/** `/rooms`: ルームの一覧 / 作成 / 更新 / 削除 / 既読、メンバー・メッセージのサブルート。 */
export const roomsApp = new Hono<{ Bindings: Bindings }>()
  // 自分が所属するルーム一覧（新しい順）。要セッション。
  .get("/", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const rows = await listRoomsForUser(s.db, s.user.id);
    return c.json({
      rooms: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt.getTime(),
        unreadCount: Number(r.unreadCount ?? 0),
        myRole: r.role,
      })),
    });
  })
  // ルーム作成。要セッション。id はサーバ採番（UUID）。
  .post("/", jsonValidator(roomNameInputSchema, "invalid room name"), async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const { name } = c.req.valid("json");
    // createdAt は明示採番し、DB 既定値への往復なしで正確な値を返す。
    const createdAt = Date.now();
    const id = crypto.randomUUID();
    await createRoomWithOwner(s.db, {
      id,
      name,
      ownerId: s.user.id,
      createdAt: new Date(createdAt),
    });
    return c.json(
      {
        room: {
          id,
          name,
          createdAt,
          unreadCount: 0,
          myRole: "owner" as const,
        },
      },
      201,
    );
  })
  // ルーム名変更。オーナーのみ。
  .patch(
    "/:roomId",
    jsonValidator(roomNameInputSchema, "invalid room name"),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const own = await requireOwner(c, s.db, s.user.id, roomId);
      if (!own.ok) return own.res;

      const { name } = c.req.valid("json");
      await updateRoomName(s.db, roomId, name);
      return c.json({ room: { id: roomId, name } } as const);
    },
  )
  // ルーム削除。オーナーのみ。messages/room_members は FK の CASCADE で削除される。
  .delete("/:roomId", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;
    const roomId = c.req.param("roomId");
    const own = await requireOwner(c, s.db, s.user.id, roomId);
    if (!own.ok) return own.res;

    await deleteRoom(s.db, roomId);
    // 既存接続を切る（FK CASCADE 後の WS が古い状態のままになるのを防ぐ）。
    await disconnectRoomAll(c.env, roomId);
    return c.json({ ok: true } as const);
  })
  // 自分の lastReadAt を進める。`at` は既読化したい時刻のミリ秒。
  .post(
    "/:roomId/read",
    jsonValidator(roomReadSchema, "invalid at"),
    async (c) => {
      const s = await requireSession(c);
      if (!s.ok) return s.res;
      const roomId = c.req.param("roomId");
      const mem = await requireMember(c, s.db, s.user.id, roomId);
      if (!mem.ok) return mem.res;

      // 省略時は現在時刻を既読位置にする。
      const { at } = c.req.valid("json");
      await markRoomRead(s.db, roomId, s.user.id, new Date(at ?? Date.now()));
      return c.json({ ok: true } as const);
    },
  )
  // members / messages / attachments は自身の path に `/:roomId/...` を含むため `/` でマウントする。
  .route("/", membersApp)
  .route("/", messagesApp)
  .route("/", attachmentsApp);
