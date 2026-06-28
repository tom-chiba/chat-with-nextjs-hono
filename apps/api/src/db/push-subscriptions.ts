import type { PushSubscriptionInput } from "@repo/shared";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "./index";
import { pushSubscriptions, roomMembers } from "./schema";

export async function upsertPushSubscription(
  db: Db,
  userId: string,
  subscription: PushSubscriptionInput,
) {
  const now = new Date();
  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updatedAt: now,
      },
    });
}

export async function deletePushSubscription(
  db: Db,
  userId: string,
  endpoint: string,
) {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.userId, userId),
      ),
    );
}

export async function deletePushSubscriptionByEndpoint(
  db: Db,
  endpoint: string,
) {
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function listPushSubscriptionsForRoomMembers(
  db: Db,
  {
    roomId,
    senderUserId,
    excludeUserIds,
  }: {
    roomId: string;
    senderUserId: string;
    excludeUserIds?: Set<string>;
  },
) {
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      userId: pushSubscriptions.userId,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(
      roomMembers,
      eq(roomMembers.userId, pushSubscriptions.userId),
    )
    .where(
      and(
        eq(roomMembers.roomId, roomId),
        ne(pushSubscriptions.userId, senderUserId),
      ),
    );

  if (!excludeUserIds?.size) return rows;
  return rows.filter((row) => !excludeUserIds.has(row.userId));
}
