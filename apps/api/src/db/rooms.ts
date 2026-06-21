import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./index";
import { messages, roomMembers, rooms, user } from "./schema";

export type RoomRole = "owner" | "member";

export type CreateRoomWithOwnerInput = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
};

export type RoomMembership =
  | { status: "member"; role: RoomRole }
  | { status: "not_found" }
  | { status: "forbidden" };

export async function listRoomsForUser(db: Db, userId: string) {
  return db
    .select({
      id: rooms.id,
      name: rooms.name,
      createdAt: rooms.createdAt,
      role: roomMembers.role,
      // 自分が書いたものは未読としない。lastReadAt より新しい他人のメッセージ件数。
      unreadCount: sql<number>`(
        SELECT COUNT(*) FROM ${messages}
        WHERE ${messages.roomId} = ${rooms.id}
          AND ${messages.createdAt} > ${roomMembers.lastReadAt}
          AND ${messages.userId} != ${roomMembers.userId}
      )`,
    })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(eq(roomMembers.userId, userId))
    .orderBy(desc(rooms.createdAt), desc(rooms.id));
}

export async function updateRoomName(db: Db, roomId: string, name: string) {
  await db.update(rooms).set({ name }).where(eq(rooms.id, roomId));
}

export async function deleteRoom(db: Db, roomId: string) {
  await db.delete(rooms).where(eq(rooms.id, roomId));
}

/**
 * 自分のメンバー行の `lastReadAt` を `at` まで進める。
 * 後退（巻き戻し）はしない。
 */
export async function markRoomRead(
  db: Db,
  roomId: string,
  userId: string,
  at: Date,
) {
  await db
    .update(roomMembers)
    .set({ lastReadAt: at })
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        eq(roomMembers.userId, userId),
        lt(roomMembers.lastReadAt, at),
      ),
    );
}

export async function getRoomById(db: Db, roomId: string) {
  const rows = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  return rows[0] ?? null;
}

export async function createRoomWithOwner(
  db: Db,
  { id, name, ownerId, createdAt }: CreateRoomWithOwnerInput,
) {
  await db.batch([
    db.insert(rooms).values({ id, name, createdAt }),
    db.insert(roomMembers).values({
      roomId: id,
      userId: ownerId,
      role: "owner",
      joinedAt: createdAt,
      lastReadAt: createdAt,
    }),
  ]);
}

export async function getRoomMembership(
  db: Db,
  roomId: string,
  userId: string,
): Promise<RoomMembership> {
  const rows = await db
    .select({ role: roomMembers.role })
    .from(rooms)
    .leftJoin(
      roomMembers,
      and(eq(roomMembers.roomId, rooms.id), eq(roomMembers.userId, userId)),
    )
    .where(eq(rooms.id, roomId))
    .limit(1);

  const row = rows[0];
  if (!row) return { status: "not_found" };
  if (!row.role) return { status: "forbidden" };
  return { status: "member", role: row.role };
}

export async function requireRoomOwner(db: Db, roomId: string, userId: string) {
  const membership = await getRoomMembership(db, roomId, userId);
  return membership.status === "member" && membership.role === "owner"
    ? ({ status: "owner" } as const)
    : membership;
}

export async function listRoomMembers(db: Db, roomId: string) {
  return db
    .select({
      userId: roomMembers.userId,
      userName: user.name,
      role: roomMembers.role,
      joinedAt: roomMembers.joinedAt,
    })
    .from(roomMembers)
    .innerJoin(user, eq(roomMembers.userId, user.id))
    .where(eq(roomMembers.roomId, roomId))
    .orderBy(desc(roomMembers.joinedAt), desc(roomMembers.userId));
}

export async function userExists(db: Db, userId: string) {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  return rows.length > 0;
}
