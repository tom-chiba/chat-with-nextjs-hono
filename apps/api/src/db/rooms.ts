import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./index";
import { roomMembers, rooms, user } from "./schema";

export type RoomRole = "owner" | "member";

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
    })
    .from(roomMembers)
    .innerJoin(rooms, eq(roomMembers.roomId, rooms.id))
    .where(eq(roomMembers.userId, userId))
    .orderBy(desc(rooms.createdAt), desc(rooms.id));
}

export async function getRoomById(db: Db, roomId: string) {
  const rows = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
  return rows[0] ?? null;
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
