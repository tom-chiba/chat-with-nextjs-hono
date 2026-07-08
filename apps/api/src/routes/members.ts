import { memberAddSchema } from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { findUserByEmail, getRoomMembership, listRoomMembers } from "../db/rooms";
import { roomMembers } from "../db/schema";
import { requireMemberSession, requireOwnerSession } from "../guards";
import { disconnectRoomMember } from "../realtime";
import type { Bindings } from "../types";
import { jsonValidator } from "../validators";

/**
 * `/rooms/:roomId/members`: ルームメンバーの一覧 / 追加 / 削除。
 * `:roomId` を自身の path に含めることで RPC 型・param 型を保ったまま、
 * `roomsApp` に `/` でマウントして合成する。
 */
export const membersApp = new Hono<{ Bindings: Bindings }>()
  // ルームメンバー一覧。所属メンバーのみ閲覧可。
  .get("/:roomId/members", async (c) => {
    const roomId = c.req.param("roomId");
    const s = await requireMemberSession(c, roomId);
    if (!s.ok) return s.res;

    const members = await listRoomMembers(s.db, roomId);
    return c.json({
      members: members.map((m) => ({
        userId: m.userId,
        userName: m.userName,
        role: m.role,
        joinedAt: m.joinedAt.getTime(),
      })),
    });
  })
  // オーナーがメールアドレスで登録済みユーザーをルームへ追加する。
  .post("/:roomId/members", jsonValidator(memberAddSchema, "invalid email"), async (c) => {
    const roomId = c.req.param("roomId");
    const s = await requireOwnerSession(c, roomId);
    if (!s.ok) return s.res;

    const { email } = c.req.valid("json");
    const target = await findUserByEmail(s.db, email);
    if (!target) {
      return c.json({ error: "user not found" } as const, 404);
    }
    const userId = target.id;

    const existing = await getRoomMembership(s.db, roomId, userId);
    if (existing.status === "member") {
      return c.json({ error: "user is already a member", role: existing.role } as const, 409);
    }

    const joinedAt = Date.now();
    await s.db
      .insert(roomMembers)
      .values({
        roomId,
        userId,
        role: "member",
        joinedAt: new Date(joinedAt),
        // 参加時点では過去のメッセージを未読としない（既読位置 = 参加時刻）。
        lastReadAt: new Date(joinedAt),
      })
      .onConflictDoNothing();

    return c.json({ member: { userId, role: "member", joinedAt } }, 201);
  })
  // オーナーがメンバーを外す。自分自身の owner 権限削除は拒否する。
  .delete("/:roomId/members/:userId", async (c) => {
    const roomId = c.req.param("roomId");
    const targetUserId = c.req.param("userId");
    const s = await requireOwnerSession(c, roomId);
    if (!s.ok) return s.res;

    const target = await getRoomMembership(s.db, roomId, targetUserId);
    if (target.status !== "member") {
      return c.json({ error: "member not found" } as const, 404);
    }
    if (target.role === "owner") {
      return c.json({ error: "owner cannot be removed" } as const, 400);
    }

    await s.db
      .delete(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, targetUserId)));
    await disconnectRoomMember(c.env, roomId, targetUserId);

    return c.json({ ok: true } as const);
  });
