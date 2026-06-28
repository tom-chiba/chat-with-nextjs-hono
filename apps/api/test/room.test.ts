import { env } from "cloudflare:test";
import type { ServerMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH, WS_RATE_LIMIT_MAX } from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import { messages, roomMembers, rooms, user } from "../src/db/schema";

/** テスト用にユーザー行を作成（messages.user_id の FK を満たすため）。 */
async function seedUser(id: string, name: string) {
  const db = createDb(env.DB);
  await db
    .insert(user)
    .values({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

/** テスト用にルームと所属を作成する。 */
async function seedRoom(roomId: string, memberIds: string[]) {
  const db = createDb(env.DB);
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

/** 受信メッセージをキューに溜め、1 件ずつ await で取り出すヘルパ。 */
function readQueue(ws: WebSocket) {
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data as string) as ServerMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return () =>
    new Promise<ServerMessage>((resolve) => {
      const msg = queue.shift();
      if (msg) resolve(msg);
      else waiters.push(resolve);
    });
}

/**
 * DO へ upgrade リクエストを送り、accept した WebSocket と次メッセージ取得関数を返す。
 * 表示名は DO が DB から解決するため、ヘッダでは userId のみ渡す。
 */
async function connect(roomId: string, userId: string) {
  const stub = env.ROOM.get(env.ROOM.idFromName(roomId));
  const res = await stub.fetch(
    new Request(`https://example.com/ws/room/${roomId}`, {
      headers: {
        Upgrade: "websocket",
        "X-User-Id": userId,
        "X-Room-Id": roomId,
      },
    }),
  );
  const ws = res.webSocket;
  if (!ws) throw new Error("WebSocket がレスポンスに含まれていません");
  const next = readQueue(ws);
  ws.accept();
  return { ws, next };
}

describe("RoomDO", () => {
  beforeEach(async () => {
    // 表示名は DB から解決されるため、非 Latin-1（日本語）でも壊れないことを併せて確認する。
    await seedUser("alice", "アリス");
    await seedUser("bob", "Bob");
  });

  test("接続直後に履歴（初回は空）を受け取る", async () => {
    await seedRoom("room-history", ["alice"]);
    const { next } = await connect("room-history", "alice");
    const first = await next();
    expect(first.type).toBe("history");
    if (first.type === "history") {
      expect(first.messages).toEqual([]);
    }
  });

  test("発言が同じルームの全接続へブロードキャストされ D1 に保存される", async () => {
    await seedRoom("room-broadcast", ["alice", "bob"]);
    const a = await connect("room-broadcast", "alice");
    expect((await a.next()).type).toBe("history");
    const b = await connect("room-broadcast", "bob");
    expect((await b.next()).type).toBe("history");

    a.ws.send(JSON.stringify({ type: "message", body: "こんにちは" }));

    const received = await b.next();
    expect(received.type).toBe("message");
    if (received.type === "message") {
      expect(received.message.body).toBe("こんにちは");
      expect(received.message.userId).toBe("alice");
      expect(received.message.userName).toBe("アリス");
      expect(received.message.roomId).toBe("room-broadcast");
    }

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, "room-broadcast"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("こんにちは");
    expect(rows[0]?.userId).toBe("alice");
  });

  test("空文字や非 message 型は無視される", async () => {
    await seedRoom("room-ignore", ["alice"]);
    const a = await connect("room-ignore", "alice");
    expect((await a.next()).type).toBe("history");

    a.ws.send(JSON.stringify({ type: "message", body: "   " }));
    a.ws.send(JSON.stringify({ type: "ping" }));
    a.ws.send(
      JSON.stringify({ type: "message", body: "a".repeat(MAX_MESSAGE_LENGTH + 1) }),
    );
    a.ws.send(JSON.stringify({ type: "message", body: "有効" }));

    // 無視された 3 件は配信されず、有効な 1 件だけが届く。
    const received = await a.next();
    expect(received.type).toBe("message");
    if (received.type === "message") {
      expect(received.message.body).toBe("有効");
    }

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, "room-ignore"));
    expect(rows).toHaveLength(1);
  });

  test("WS 送信の長さ判定は書記素数で行う（絵文字は 1 文字）", async () => {
    await seedRoom("room-emoji-len", ["alice"]);
    const a = await connect("room-emoji-len", "alice");
    expect((await a.next()).type).toBe("history");

    // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
    // 超過（MAX+1）は無視され、境界ちょうど（MAX）は配信・保存される。
    a.ws.send(
      JSON.stringify({ type: "message", body: "😀".repeat(MAX_MESSAGE_LENGTH + 1) }),
    );
    a.ws.send(
      JSON.stringify({ type: "message", body: "😀".repeat(MAX_MESSAGE_LENGTH) }),
    );

    const received = await a.next();
    expect(received.type).toBe("message");
    if (received.type === "message") {
      expect(received.message.body).toBe("😀".repeat(MAX_MESSAGE_LENGTH));
    }

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, "room-emoji-len"));
    expect(rows).toHaveLength(1);
  });

  test("接続後にメンバーから外れたユーザーの発言は保存しない", async () => {
    await seedRoom("room-removed-member", ["alice", "bob"]);
    const b = await connect("room-removed-member", "bob");
    expect((await b.next()).type).toBe("history");

    const db = createDb(env.DB);
    await db
      .delete(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, "room-removed-member"),
          eq(roomMembers.userId, "bob"),
        ),
      );

    b.ws.send(JSON.stringify({ type: "message", body: "削除後の発言" }));
    await scheduler.wait(10);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, "room-removed-member"));
    expect(rows).toHaveLength(0);
  });

  test("レート制限を超えた送信は error を返し DB に保存しない", async () => {
    await seedRoom("room-rate-limit", ["alice"]);
    const a = await connect("room-rate-limit", "alice");
    expect((await a.next()).type).toBe("history");

    // 上限まで送信。すべて message として配信される。
    for (let i = 0; i < WS_RATE_LIMIT_MAX; i += 1) {
      a.ws.send(JSON.stringify({ type: "message", body: `msg-${i}` }));
      const received = await a.next();
      expect(received.type).toBe("message");
    }

    // 次の 1 件はレート制限に当たり、error が返る。
    a.ws.send(JSON.stringify({ type: "message", body: "overflow" }));
    const rejected = await a.next();
    expect(rejected.type).toBe("error");
    if (rejected.type === "error") {
      expect(rejected.code).toBe("rate_limited");
    }

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.roomId, "room-rate-limit"));
    expect(rows).toHaveLength(WS_RATE_LIMIT_MAX);
    expect(rows.find((r) => r.body === "overflow")).toBeUndefined();
  });
});
