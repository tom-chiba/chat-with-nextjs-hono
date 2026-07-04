import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import {
  deletePushSubscription,
  listPushSubscriptionsForRoomMembers,
  upsertPushSubscription,
} from "../src/db/push-subscriptions";
import { roomMembers, rooms, user } from "../src/db/schema";
import { sendMessagePushNotifications, type PushSender } from "../src/push";

async function seedRoomWithMembers(roomId: string, memberIds: string[]) {
  const db = createDb(env.DB);
  const now = new Date();
  await db
    .insert(user)
    .values(
      memberIds.map((id) => ({
        id,
        name: id,
        email: `${id}@example.com`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
  await db.insert(rooms).values({ id: roomId, name: roomId }).onConflictDoNothing();
  await db
    .insert(roomMembers)
    .values(
      memberIds.map((userId, index) => ({
        roomId,
        userId,
        role: index === 0 ? ("owner" as const) : ("member" as const),
      })),
    )
    .onConflictDoNothing();
}

describe("push subscription helpers", () => {
  test("購読登録は endpoint 単位で upsert され、解除できる", async () => {
    await seedRoomWithMembers("push-upsert", ["alice"]);
    const db = createDb(env.DB);

    await upsertPushSubscription(db, "alice", {
      endpoint: "https://push.example.com/1",
      keys: { p256dh: "old-key", auth: "old-auth" },
    });
    await upsertPushSubscription(db, "alice", {
      endpoint: "https://push.example.com/1",
      keys: { p256dh: "new-key", auth: "new-auth" },
    });

    const rows = await listPushSubscriptionsForRoomMembers(db, {
      roomId: "push-upsert",
      senderUserId: "nobody",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: "https://push.example.com/1",
      userId: "alice",
      p256dh: "new-key",
      auth: "new-auth",
    });

    await deletePushSubscription(db, "alice", "https://push.example.com/1");
    const afterDelete = await listPushSubscriptionsForRoomMembers(db, {
      roomId: "push-upsert",
      senderUserId: "nobody",
    });
    expect(afterDelete).toEqual([]);
  });

  test("送信者と接続中ユーザーを通知対象から除外する", async () => {
    await seedRoomWithMembers("push-targets", ["alice", "bob", "carol"]);
    const db = createDb(env.DB);
    for (const userId of ["alice", "bob", "carol"]) {
      await upsertPushSubscription(db, userId, {
        endpoint: `https://push.example.com/${userId}`,
        keys: { p256dh: `key-${userId}`, auth: `auth-${userId}` },
      });
    }

    const rows = await listPushSubscriptionsForRoomMembers(db, {
      roomId: "push-targets",
      senderUserId: "alice",
      excludeUserIds: new Set(["bob"]),
    });

    expect(rows.map((row) => row.userId)).toEqual(["carol"]);
  });

  test("壊れた subscription の例外は他の通知送信を妨げず削除する", async () => {
    await seedRoomWithMembers("push-send-errors", [
      "push-error-sender",
      "push-error-broken",
      "push-error-ok",
    ]);
    const db = createDb(env.DB);
    await upsertPushSubscription(db, "push-error-broken", {
      endpoint: "https://push.example.com/broken",
      keys: { p256dh: "broken-key", auth: "broken-auth" },
    });
    await upsertPushSubscription(db, "push-error-ok", {
      endpoint: "https://push.example.com/ok",
      keys: { p256dh: "ok-key", auth: "ok-auth" },
    });

    const sent: string[] = [];
    const pushSender: PushSender = {
      async send(subscription) {
        if (subscription.endpoint.endsWith("/broken")) {
          throw new Error("invalid subscription");
        }
        sent.push(subscription.endpoint);
        return { status: "sent" };
      },
    };

    await sendMessagePushNotifications({
      db,
      env,
      message: {
        id: "push-error-message",
        roomId: "push-send-errors",
        userId: "push-error-sender",
        userName: "Sender",
        body: "hello",
        attachments: [],
        createdAt: Date.now(),
        editedAt: null,
        deletedAt: null,
      },
      pushSender,
    });

    expect(sent).toEqual(["https://push.example.com/ok"]);
    const rows = await listPushSubscriptionsForRoomMembers(db, {
      roomId: "push-send-errors",
      senderUserId: "push-error-sender",
    });
    expect(rows.map((row) => row.endpoint)).toEqual(["https://push.example.com/ok"]);
  });
});
