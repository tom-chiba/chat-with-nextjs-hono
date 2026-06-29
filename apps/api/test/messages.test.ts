import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import { listMessages } from "../src/db/messages";
import { messages, rooms, user } from "../src/db/schema";

const ROOM = "room-paging";

/** ユーザー + ルーム + 連番メッセージを投入する。 */
async function seed() {
  const db = createDb(env.DB);
  await db
    .insert(user)
    .values({
      id: "alice",
      name: "アリス",
      email: "alice@example.com",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
  await db
    .insert(rooms)
    .values({ id: ROOM, name: ROOM })
    .onConflictDoNothing();

  // createdAt 昇順で 5 件。一部は同一ミリ秒にしてタイブレークを確認する。
  // テスト間でストレージが残っても壊れないよう冪等に投入する。
  await db
    .insert(messages)
    .values([
      { id: "m1", roomId: ROOM, userId: "alice", senderName: "アリス", body: "1", createdAt: new Date(1000) },
      { id: "m2", roomId: ROOM, userId: "alice", senderName: "アリス", body: "2", createdAt: new Date(1000) },
      { id: "m3", roomId: ROOM, userId: "alice", senderName: "アリス", body: "3", createdAt: new Date(2000) },
      { id: "m4", roomId: ROOM, userId: "alice", senderName: "アリス", body: "4", createdAt: new Date(3000) },
      { id: "m5", roomId: ROOM, userId: "alice", senderName: "アリス", body: "5", createdAt: new Date(4000) },
    ])
    .onConflictDoNothing();
}

describe("listMessages（ページネーション）", () => {
  beforeEach(seed);

  test("limit 件を新しい側から取り、昇順で返す", async () => {
    const db = createDb(env.DB);
    const page = await listMessages(db, { roomId: ROOM, limit: 2 });
    expect(page.map((m) => m.id)).toEqual(["m4", "m5"]);
    expect(page[0]?.userName).toBe("アリス");
  });

  test("before カーソルより古い 1 ページを返す", async () => {
    const db = createDb(env.DB);
    const first = await listMessages(db, { roomId: ROOM, limit: 2 });
    const oldest = first[0]; // m4
    if (!oldest) throw new Error("先頭メッセージが取得できませんでした");
    const older = await listMessages(db, {
      roomId: ROOM,
      limit: 2,
      before: { createdAt: oldest.createdAt, id: oldest.id },
    });
    expect(older.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  test("同一ミリ秒は id でタイブレークし重複・欠落しない", async () => {
    const db = createDb(env.DB);
    // m3 より古い分を辿る。m3 の createdAt=2000、m1/m2 は 1000。
    const older = await listMessages(db, {
      roomId: ROOM,
      limit: 10,
      before: { createdAt: 2000, id: "m3" },
    });
    expect(older.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  test("送信者が改名しても過去メッセージの表示名は固定される（スナップショット）", async () => {
    const db = createDb(env.DB);
    // 送信後にユーザーが改名しても、保存済み sender_name は追随しない。
    await db.update(user).set({ name: "アリス改" }).where(eq(user.id, "alice"));

    const page = await listMessages(db, { roomId: ROOM, limit: 5 });
    expect(page.every((m) => m.userName === "アリス")).toBe(true);
  });
});
