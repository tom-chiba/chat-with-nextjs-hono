import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import { createRoomWithOwner } from "../src/db/rooms";
import { roomMembers, rooms, session, user } from "../src/db/schema";
import app from "../src/index";
// WS ルートは worker.ts 側で app に登録される。default export は同一の app インスタンス。
import workerApp from "../src/worker";

async function signCookieValue(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return `${value}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function createSession(userId: string, name = userId) {
  const db = createDb(env.DB);
  const now = new Date();
  await db
    .insert(user)
    .values({
      id: userId,
      name,
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const token = `token-${userId}-${crypto.randomUUID()}`;
  await db.insert(session).values({
    id: `session-${crypto.randomUUID()}`,
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });

  return { Cookie: `better-auth.session_token=${await signCookieValue(token)}` };
}

async function seedRoom({
  roomId,
  ownerId,
  memberIds = [],
}: {
  roomId: string;
  ownerId: string;
  memberIds?: string[];
}) {
  const db = createDb(env.DB);
  await db.insert(rooms).values({ id: roomId, name: roomId }).onConflictDoNothing();
  await db
    .insert(roomMembers)
    .values([
      { roomId, userId: ownerId, role: "owner" },
      ...memberIds.map((userId) => ({ roomId, userId, role: "member" as const })),
    ])
    .onConflictDoNothing();
}

describe("API ルート", () => {
  test("GET /health は 200 で status ok を返す", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /me はセッション無しで 401 を返す", async () => {
    const res = await app.request("/me", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("GET /rooms はセッション無しで 401 を返す", async () => {
    const res = await app.request("/rooms", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("POST /rooms はセッション無しで 401 を返す", async () => {
    const res = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "雑談" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("GET /rooms/:roomId/messages はセッション無しで 401 を返す", async () => {
    const res = await app.request("/rooms/general/messages", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("WS /ws/room/:id は正しい Origin でもセッション無しなら 401 を返す", async () => {
    const res = await workerApp.request(
      "/ws/room/general",
      { headers: { Upgrade: "websocket", Origin: env.WEB_URL } },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("WS /ws/room/:id は許可外 Origin で 403 を返す", async () => {
    const res = await workerApp.request(
      "/ws/room/general",
      { headers: { Upgrade: "websocket", Origin: "https://evil.example.com" } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden origin" });
  });

  test("WS /ws/room/:id は upgrade ヘッダ無しで 426 を返す", async () => {
    const res = await workerApp.request("/ws/room/general", {}, env);
    expect(res.status).toBe(426);
  });

  test("POST /rooms は作成者を owner メンバーにして、一覧は所属ルームだけ返す", async () => {
    const headers = await createSession("owner-create", "Owner");

    const createRes = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "限定ルーム" }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ room: { id: string; name: string } }>();

    const listRes = await app.request("/rooms", { headers }, env);
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{ rooms: { id: string; name: string }[] }>();
    expect(list.rooms).toContainEqual(
      expect.objectContaining({ id: created.room.id, name: "限定ルーム" }),
    );

    const db = createDb(env.DB);
    const members = await db
      .select()
      .from(roomMembers)
      .where(eq(roomMembers.roomId, created.room.id));
    expect(members).toContainEqual(
      expect.objectContaining({ userId: "owner-create", role: "owner" }),
    );
  });

  test("ルーム作成時の owner 登録に失敗したら rooms 行を rollback する", async () => {
    const db = createDb(env.DB);

    await expect(
      createRoomWithOwner(db, {
        id: "orphan-rollback",
        name: "orphan rollback",
        ownerId: "missing-owner",
        createdAt: new Date(),
      }),
    ).rejects.toThrow();

    const orphanRooms = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, "orphan-rollback"));
    expect(orphanRooms).toHaveLength(0);
  });

  test("GET /rooms は未所属ルームを返さない", async () => {
    const ownerHeaders = await createSession("rooms-owner", "Owner");
    await createSession("rooms-other", "Other");
    await seedRoom({ roomId: "visible-room", ownerId: "rooms-owner" });
    await seedRoom({ roomId: "hidden-room", ownerId: "rooms-other" });

    const res = await app.request("/rooms", { headers: ownerHeaders }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ rooms: { id: string }[] }>();
    expect(body.rooms.map((room) => room.id)).toContain("visible-room");
    expect(body.rooms.map((room) => room.id)).not.toContain("hidden-room");
  });

  test("GET /rooms/:roomId/messages は未所属を 403、存在しないルームを 404 にする", async () => {
    const ownerHeaders = await createSession("messages-owner", "Owner");
    const otherHeaders = await createSession("messages-other", "Other");
    await seedRoom({ roomId: "private-messages", ownerId: "messages-owner" });

    const forbidden = await app.request(
      "/rooms/private-messages/messages",
      { headers: otherHeaders },
      env,
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });

    const missing = await app.request(
      "/rooms/missing-room/messages",
      { headers: ownerHeaders },
      env,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "room not found" });
  });

  test("オーナーだけがメンバーを追加でき、追加されたメンバーは履歴を取得できる", async () => {
    const ownerHeaders = await createSession("member-owner", "Owner");
    const memberHeaders = await createSession("member-new", "Member");
    const otherHeaders = await createSession("member-other", "Other");
    await seedRoom({ roomId: "member-room", ownerId: "member-owner" });

    const denied = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...otherHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "member-new" }),
      },
      env,
    );
    expect(denied.status).toBe(403);

    const added = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "member-new" }),
      },
      env,
    );
    expect(added.status).toBe(201);

    const duplicate = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "member-new" }),
      },
      env,
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: "user is already a member",
      role: "member",
    });

    const history = await app.request(
      "/rooms/member-room/messages",
      { headers: memberHeaders },
      env,
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ messages: [] });
  });

  test("WS /ws/room/:id は存在しないルームと未所属ユーザーを拒否する", async () => {
    const ownerHeaders = await createSession("ws-owner", "Owner");
    const otherHeaders = await createSession("ws-other", "Other");
    await seedRoom({ roomId: "ws-private", ownerId: "ws-owner" });

    const missing = await workerApp.request(
      "/ws/room/ws-missing",
      { headers: { ...ownerHeaders, Upgrade: "websocket", Origin: env.WEB_URL } },
      env,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "room not found" });

    const forbidden = await workerApp.request(
      "/ws/room/ws-private",
      { headers: { ...otherHeaders, Upgrade: "websocket", Origin: env.WEB_URL } },
      env,
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
  });
});
