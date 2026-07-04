import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import {
  attachToMessage,
  createAttachment,
  listAttachmentsForMessages,
} from "../src/db/attachments";
import { listMessages, toChatMessage } from "../src/db/messages";
import { messages, rooms, user } from "../src/db/schema";

const ROOM = "room-attach";
const OTHER_ROOM = "room-attach-other";

async function seed() {
  const db = createDb(env.DB);
  await db
    .insert(user)
    .values([
      {
        id: "alice",
        name: "アリス",
        email: "alice-attach@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "bob",
        name: "ボブ",
        email: "bob-attach@example.com",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(rooms)
    .values([
      { id: ROOM, name: ROOM },
      { id: OTHER_ROOM, name: OTHER_ROOM },
    ])
    .onConflictDoNothing();
}

/** 未紐付けの添付を 1 件作る（アップロード直後の状態）。 */
async function makeUpload(
  id: string,
  opts?: { roomId?: string; userId?: string },
) {
  const db = createDb(env.DB);
  await createAttachment(db, {
    id,
    roomId: opts?.roomId ?? ROOM,
    userId: opts?.userId ?? "alice",
    r2Key: `rooms/${opts?.roomId ?? ROOM}/${id}`,
    mimeType: "image/png",
    size: 123,
  });
}

async function insertMessage(id: string) {
  const db = createDb(env.DB);
  await db
    .insert(messages)
    .values({
      id,
      roomId: ROOM,
      userId: "alice",
      senderName: "アリス",
      body: "本文",
      createdAt: new Date(1000),
    })
    .onConflictDoNothing();
}

describe("attachToMessage", () => {
  beforeEach(seed);

  test("自分がアップロードした未紐付け添付を指定順で紐付ける", async () => {
    const db = createDb(env.DB);
    await makeUpload("a1");
    await makeUpload("a2");
    await insertMessage("msg-1");

    const attached = await attachToMessage(db, {
      messageId: "msg-1",
      attachmentIds: ["a2", "a1"], // 指定順が保たれること
      roomId: ROOM,
      userId: "alice",
    });
    expect(attached.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(attached[0]?.mimeType).toBe("image/png");
  });

  test("他人・別ルーム・既紐付けの添付は横取りしない", async () => {
    const db = createDb(env.DB);
    await makeUpload("mine");
    await makeUpload("bob-owned", { userId: "bob" });
    await makeUpload("other-room", { roomId: OTHER_ROOM });
    await insertMessage("msg-2");

    const attached = await attachToMessage(db, {
      messageId: "msg-2",
      attachmentIds: ["mine", "bob-owned", "other-room"],
      roomId: ROOM,
      userId: "alice",
    });
    expect(attached.map((a) => a.id)).toEqual(["mine"]);
  });
});

describe("listAttachmentsForMessages / toChatMessage", () => {
  beforeEach(seed);

  test("メッセージ配信に添付が同梱される", async () => {
    const db = createDb(env.DB);
    await makeUpload("g1");
    await insertMessage("msg-3");
    await attachToMessage(db, {
      messageId: "msg-3",
      attachmentIds: ["g1"],
      roomId: ROOM,
      userId: "alice",
    });

    const map = await listAttachmentsForMessages(db, ["msg-3"]);
    expect(map.get("msg-3")?.map((a) => a.id)).toEqual(["g1"]);
  });

  test("論理削除済みメッセージは添付を伏せる", () => {
    const msg = toChatMessage(
      {
        id: "d1",
        roomId: ROOM,
        userId: "alice",
        userName: "アリス",
        body: "x",
        createdAt: new Date(1000),
        editedAt: null,
        deletedAt: new Date(2000),
      },
      [{ id: "hidden", mimeType: "image/png", size: 1 }],
    );
    expect(msg.attachments).toEqual([]);
    expect(msg.body).toBe("");
  });

  test("listMessages が添付付きで返す", async () => {
    const db = createDb(env.DB);
    await makeUpload("l1");
    await insertMessage("msg-4");
    await attachToMessage(db, {
      messageId: "msg-4",
      attachmentIds: ["l1"],
      roomId: ROOM,
      userId: "alice",
    });

    const page = await listMessages(db, { roomId: ROOM, limit: 50 });
    const found = page.find((m) => m.id === "msg-4");
    expect(found?.attachments.map((a) => a.id)).toEqual(["l1"]);
  });
});

describe("R2 バケット（ATTACHMENTS binding）", () => {
  test("put した実体を get で取り出せる", async () => {
    const key = "rooms/room-attach/roundtrip";
    await env.ATTACHMENTS.put(key, new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: "image/png" },
    });
    const object = await env.ATTACHMENTS.get(key);
    expect(object).not.toBeNull();
    const bytes = new Uint8Array((await object?.arrayBuffer()) ?? new ArrayBuffer(0));
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
