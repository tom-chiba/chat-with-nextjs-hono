import { env } from "cloudflare:test";
import type { ServerMessage } from "@repo/shared";
import {
  ATTACHMENT_UPLOAD_RATE_MAX,
  MAX_ATTACHMENT_STORAGE_BYTES_PER_USER,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
} from "@repo/shared";
import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { createDb } from "../src/db";
import { attachToMessage, createAttachment } from "../src/db/attachments";
import { softDeleteMessage } from "../src/db/messages";
import { createRoomWithOwner } from "../src/db/rooms";
import {
  attachments,
  messages,
  pushSubscriptions,
  roomMembers,
  rooms,
  session,
  user,
} from "../src/db/schema";
import app from "../src/index";
// WS ルートは worker.ts 側で app に登録される。workerApp は同一の Hono インスタンス。
import { workerApp } from "../src/worker";

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

function waitForClose(ws: WebSocket) {
  return new Promise<CloseEvent>((resolve) => {
    ws.addEventListener("close", (event) => resolve(event), { once: true });
  });
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

  test("GET /push/vapid-public-key は未設定なら 503 を返す", async () => {
    const unconfiguredEnv = {
      ...env,
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
    };
    const res = await app.request("/push/vapid-public-key", {}, unconfiguredEnv);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "push is not configured" });
  });

  test("Push Subscription はログインユーザーだけ登録・解除できる", async () => {
    const configuredEnv = {
      ...env,
      VAPID_PUBLIC_KEY: "test-public-key",
      VAPID_PRIVATE_KEY: "test-private-key",
    };
    const headers = await createSession("push-user", "Push User");

    const unauthorized = await app.request(
      "/push/subscriptions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.com/unauthorized",
          keys: { p256dh: "key", auth: "auth" },
        }),
      },
      configuredEnv,
    );
    expect(unauthorized.status).toBe(401);

    const createRes = await app.request(
      "/push/subscriptions",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.com/push-user",
          keys: { p256dh: "key", auth: "auth" },
        }),
      },
      configuredEnv,
    );
    expect(createRes.status).toBe(201);
    expect(await createRes.json()).toEqual({ ok: true });

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, "push-user"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpoint: "https://push.example.com/push-user",
      p256dh: "key",
      auth: "auth",
    });

    const deleteRes = await app.request(
      "/push/subscriptions",
      {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/push-user" }),
      },
      configuredEnv,
    );
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ ok: true });

    const afterDelete = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, "push-user"));
    expect(afterDelete).toEqual([]);
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

  test("GET /rooms/:roomId/messages は before/beforeId の部分指定を 400 にし、両方指定でカーソルが効く", async () => {
    const ownerHeaders = await createSession("cursor-owner", "Owner");
    await seedRoom({ roomId: "cursor-room", ownerId: "cursor-owner" });

    const db = createDb(env.DB);
    const { messages: messagesTable } = await import("../src/db/schema");
    await db.insert(messagesTable).values([
      { id: "c1", roomId: "cursor-room", userId: "cursor-owner", senderName: "Owner", body: "1", createdAt: new Date(1000) },
      { id: "c2", roomId: "cursor-room", userId: "cursor-owner", senderName: "Owner", body: "2", createdAt: new Date(2000) },
      { id: "c3", roomId: "cursor-room", userId: "cursor-owner", senderName: "Owner", body: "3", createdAt: new Date(3000) },
    ]);

    // before だけ → 400（カーソルを黙って無視せずエラーにする）。
    const beforeOnly = await app.request(
      "/rooms/cursor-room/messages?before=3000",
      { headers: ownerHeaders },
      env,
    );
    expect(beforeOnly.status).toBe(400);
    expect(await beforeOnly.json()).toEqual({ error: "invalid query" });

    // beforeId だけ → 400。
    const beforeIdOnly = await app.request(
      "/rooms/cursor-room/messages?beforeId=c3",
      { headers: ownerHeaders },
      env,
    );
    expect(beforeIdOnly.status).toBe(400);
    expect(await beforeIdOnly.json()).toEqual({ error: "invalid query" });

    // before が空文字（実質欠如）+ beforeId → 400。
    // 空文字はハンドラで falsy としてカーソル無効になるため、未指定と同じく欠如扱いで弾く。
    const emptyBefore = await app.request(
      "/rooms/cursor-room/messages?before=&beforeId=c3",
      { headers: ownerHeaders },
      env,
    );
    expect(emptyBefore.status).toBe(400);
    expect(await emptyBefore.json()).toEqual({ error: "invalid query" });

    // 両方未指定 → 200 で最新ページ（全件昇順）。
    const noCursor = await app.request(
      "/rooms/cursor-room/messages",
      { headers: ownerHeaders },
      env,
    );
    expect(noCursor.status).toBe(200);
    const noCursorBody = await noCursor.json<{ messages: { id: string }[] }>();
    expect(noCursorBody.messages.map((m) => m.id)).toEqual(["c1", "c2", "c3"]);

    // 両方指定 → 200 でカーソルより古いページが返る。
    const paged = await app.request(
      "/rooms/cursor-room/messages?before=3000&beforeId=c3",
      { headers: ownerHeaders },
      env,
    );
    expect(paged.status).toBe(200);
    const pagedBody = await paged.json<{ messages: { id: string }[] }>();
    expect(pagedBody.messages.map((m) => m.id)).toEqual(["c1", "c2"]);
  });

  test("オーナーだけがメンバーをメールアドレスで追加でき、追加されたメンバーは履歴を取得できる", async () => {
    const ownerHeaders = await createSession("member-owner", "Owner");
    const memberHeaders = await createSession("member-new", "Member");
    const otherHeaders = await createSession("member-other", "Other");
    await seedRoom({ roomId: "member-room", ownerId: "member-owner" });

    // createSession はメールを `${userId}@example.com` で作る。
    const denied = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...otherHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "member-new@example.com" }),
      },
      env,
    );
    expect(denied.status).toBe(403);

    // 大文字を混ぜても case-insensitive で解決できる。
    const added = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "Member-New@Example.com" }),
      },
      env,
    );
    expect(added.status).toBe(201);
    expect(await added.json()).toEqual({
      member: {
        userId: "member-new",
        role: "member",
        joinedAt: expect.any(Number),
      },
    });

    const duplicate = await app.request(
      "/rooms/member-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "member-new@example.com" }),
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

  test("メンバー追加は不正なメール形式を 400、未登録メールを 404 にする", async () => {
    const ownerHeaders = await createSession("addmember-owner", "Owner");
    await seedRoom({ roomId: "addmember-room", ownerId: "addmember-owner" });

    const invalid = await app.request(
      "/rooms/addmember-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid email" });

    const notFound = await app.request(
      "/rooms/addmember-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      },
      env,
    );
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: "user not found" });
  });

  test("GET /rooms/:roomId/members はメンバー一覧を返し、未所属を 403 にする", async () => {
    const ownerHeaders = await createSession("list-owner", "List Owner");
    await createSession("list-member", "List Member");
    const otherHeaders = await createSession("list-other", "List Other");
    await seedRoom({
      roomId: "list-room",
      ownerId: "list-owner",
      memberIds: ["list-member"],
    });

    const res = await app.request(
      "/rooms/list-room/members",
      { headers: ownerHeaders },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      members: { userId: string; userName: string; role: string }[];
    }>();
    expect(body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "list-owner",
          userName: "List Owner",
          role: "owner",
        }),
        expect.objectContaining({
          userId: "list-member",
          userName: "List Member",
          role: "member",
        }),
      ]),
    );

    // 未所属ユーザーは一覧を閲覧できない。
    const forbidden = await app.request(
      "/rooms/list-room/members",
      { headers: otherHeaders },
      env,
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
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

  test("DELETE /rooms/:roomId/members/:userId は対象ユーザーの既存 WS を close する", async () => {
    const ownerHeaders = await createSession("delete-owner", "Owner");
    const memberHeaders = await createSession("delete-member", "Member");
    await seedRoom({
      roomId: "delete-close-room",
      ownerId: "delete-owner",
      memberIds: ["delete-member"],
    });

    const connected = await workerApp.request(
      "/ws/room/delete-close-room",
      {
        headers: {
          ...memberHeaders,
          Upgrade: "websocket",
          Origin: env.WEB_URL,
        },
      },
      env,
    );
    expect(connected.status).toBe(101);

    const ws = connected.webSocket;
    if (!ws) throw new Error("WebSocket がレスポンスに含まれていません");
    const next = readQueue(ws);
    const close = waitForClose(ws);
    ws.accept();
    expect((await next()).type).toBe("history");

    const removed = await app.request(
      "/rooms/delete-close-room/members/delete-member",
      { method: "DELETE", headers: ownerHeaders },
      env,
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    const closeEvent = await close;
    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toBe("removed from room");
  });

  test("PATCH /rooms/:roomId はオーナーのみ名前を変更できる", async () => {
    const ownerHeaders = await createSession("rename-owner", "Rename Owner");
    const memberHeaders = await createSession("rename-member", "Rename Member");
    await seedRoom({
      roomId: "rename-room",
      ownerId: "rename-owner",
      memberIds: ["rename-member"],
    });

    const forbidden = await app.request(
      "/rooms/rename-room",
      {
        method: "PATCH",
        headers: { ...memberHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新しい名前" }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);

    const invalid = await app.request(
      "/rooms/rename-room",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "   " }),
      },
      env,
    );
    expect(invalid.status).toBe(400);

    const ok = await app.request(
      "/rooms/rename-room",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新しい名前" }),
      },
      env,
    );
    expect(ok.status).toBe(200);

    const db = createDb(env.DB);
    const row = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, "rename-room"));
    expect(row[0]?.name).toBe("新しい名前");
  });

  test("DELETE /rooms/:roomId はオーナーのみ削除できて WS も閉じる", async () => {
    const ownerHeaders = await createSession("delete-owner", "Delete Owner");
    const memberHeaders = await createSession("delete-member", "Delete Member");
    await seedRoom({
      roomId: "delete-room",
      ownerId: "delete-owner",
      memberIds: ["delete-member"],
    });

    // メンバーは削除不可
    const forbidden = await app.request(
      "/rooms/delete-room",
      { method: "DELETE", headers: memberHeaders },
      env,
    );
    expect(forbidden.status).toBe(403);

    // 存在しないルームは 404
    const missing = await app.request(
      "/rooms/no-such-room",
      { method: "DELETE", headers: ownerHeaders },
      env,
    );
    expect(missing.status).toBe(404);

    // 接続中の WS を用意（削除時に切られることを確認）
    const wsRes = await workerApp.request(
      "/ws/room/delete-room",
      {
        headers: {
          ...memberHeaders,
          Upgrade: "websocket",
          Origin: env.WEB_URL,
        },
      },
      env,
    );
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket;
    if (!ws) throw new Error("expected webSocket on response");
    ws.accept();
    const close = waitForClose(ws);

    const ok = await app.request(
      "/rooms/delete-room",
      { method: "DELETE", headers: ownerHeaders },
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const closeEvent = await close;
    expect(closeEvent.code).toBe(1001);
    expect(closeEvent.reason).toBe("room deleted");

    const db = createDb(env.DB);
    const remaining = await db
      .select()
      .from(rooms)
      .where(eq(rooms.id, "delete-room"));
    expect(remaining).toHaveLength(0);
    const members = await db
      .select()
      .from(roomMembers)
      .where(eq(roomMembers.roomId, "delete-room"));
    expect(members).toHaveLength(0);
  });

  test("PATCH /rooms/:roomId/messages/:messageId は本人のみ編集できる", async () => {
    const ownerHeaders = await createSession("msg-edit-owner", "Owner");
    const otherHeaders = await createSession("msg-edit-other", "Other");
    await seedRoom({
      roomId: "msg-edit-room",
      ownerId: "msg-edit-owner",
      memberIds: ["msg-edit-other"],
    });

    const db = createDb(env.DB);
    const messageId = "msg-1";
    await db.insert(rooms).values({ id: "msg-edit-room", name: "edit" }).onConflictDoNothing();
    const { messages: messagesTable } = await import("../src/db/schema");
    await db.insert(messagesTable).values({
      id: messageId,
      roomId: "msg-edit-room",
      userId: "msg-edit-owner",
      senderName: "Owner",
      body: "before",
      createdAt: new Date(),
    });

    // 他人は 403
    const forbidden = await app.request(
      `/rooms/msg-edit-room/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { ...otherHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "hijacked" }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);

    // 空本文は 400
    const invalid = await app.request(
      `/rooms/msg-edit-room/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "  " }),
      },
      env,
    );
    expect(invalid.status).toBe(400);

    const ok = await app.request(
      `/rooms/msg-edit-room/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "after" }),
      },
      env,
    );
    expect(ok.status).toBe(200);

    const row = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, messageId));
    expect(row[0]?.body).toBe("after");
    expect(row[0]?.editedAt).not.toBeNull();
  });

  test("DELETE /rooms/:roomId/messages/:messageId は本人のみ論理削除する", async () => {
    const ownerHeaders = await createSession("msg-del-owner", "Owner");
    const otherHeaders = await createSession("msg-del-other", "Other");
    await seedRoom({
      roomId: "msg-del-room",
      ownerId: "msg-del-owner",
      memberIds: ["msg-del-other"],
    });

    const db = createDb(env.DB);
    const { messages: messagesTable } = await import("../src/db/schema");
    await db.insert(messagesTable).values({
      id: "msg-del-1",
      roomId: "msg-del-room",
      userId: "msg-del-owner",
      senderName: "Owner",
      body: "secret",
      createdAt: new Date(),
    });

    // 他人は 403
    const forbidden = await app.request(
      "/rooms/msg-del-room/messages/msg-del-1",
      { method: "DELETE", headers: otherHeaders },
      env,
    );
    expect(forbidden.status).toBe(403);

    const ok = await app.request(
      "/rooms/msg-del-room/messages/msg-del-1",
      { method: "DELETE", headers: ownerHeaders },
      env,
    );
    expect(ok.status).toBe(200);

    const row = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, "msg-del-1"));
    expect(row[0]?.body).toBe("");
    expect(row[0]?.deletedAt).not.toBeNull();
  });

  test("編集の応答は現在名でなく送信時スナップショット名を返し、削除でも維持される", async () => {
    // 送信後に改名したユーザーを再現する: 現在名は「新名」だが、メッセージの
    // sender_name は送信時の「旧名」。編集/削除でこのスナップショットが
    // 操作者の現在名へ先祖返りしないことを検証する。
    const ownerHeaders = await createSession("snap-owner", "新名");
    await seedRoom({ roomId: "snap-room", ownerId: "snap-owner" });

    const db = createDb(env.DB);
    const { messages: messagesTable } = await import("../src/db/schema");
    await db
      .insert(messagesTable)
      .values({
        id: "snap-1",
        roomId: "snap-room",
        userId: "snap-owner",
        senderName: "旧名",
        body: "before",
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    const edited = await app.request(
      "/rooms/snap-room/messages/snap-1",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "after" }),
      },
      env,
    );
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as {
      message: { userName: string };
    };
    expect(editedBody.message.userName).toBe("旧名");

    const deleted = await app.request(
      "/rooms/snap-room/messages/snap-1",
      { method: "DELETE", headers: ownerHeaders },
      env,
    );
    expect(deleted.status).toBe(200);
    // 論理削除後も sender_name 列はスナップショットを保持する。
    const row = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, "snap-1"));
    expect(row[0]?.senderName).toBe("旧名");
  });

  test("GET /rooms は myRole を返す", async () => {
    const ownerHeaders = await createSession("role-owner", "Role Owner");
    const memberHeaders = await createSession("role-member", "Role Member");
    await seedRoom({
      roomId: "role-room",
      ownerId: "role-owner",
      memberIds: ["role-member"],
    });

    const ownerRes = await app.request("/rooms", { headers: ownerHeaders }, env);
    const ownerBody = await ownerRes.json<{
      rooms: { id: string; myRole: string }[];
    }>();
    expect(
      ownerBody.rooms.find((r) => r.id === "role-room")?.myRole,
    ).toBe("owner");

    const memberRes = await app.request(
      "/rooms",
      { headers: memberHeaders },
      env,
    );
    const memberBody = await memberRes.json<{
      rooms: { id: string; myRole: string }[];
    }>();
    expect(
      memberBody.rooms.find((r) => r.id === "role-room")?.myRole,
    ).toBe("member");
  });

  test("ルーム作成/改名は名前の上限超過を 400、境界長を許可する", async () => {
    const ownerHeaders = await createSession("len-owner", "Owner");

    const tooLong = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "あ".repeat(MAX_ROOM_NAME_LENGTH + 1) }),
      },
      env,
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid room name" });

    const boundary = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "あ".repeat(MAX_ROOM_NAME_LENGTH) }),
      },
      env,
    );
    expect(boundary.status).toBe(201);

    await seedRoom({ roomId: "len-room", ownerId: "len-owner" });
    const renameTooLong = await app.request(
      "/rooms/len-room",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "い".repeat(MAX_ROOM_NAME_LENGTH + 1) }),
      },
      env,
    );
    expect(renameTooLong.status).toBe(400);
  });

  test("ルーム作成・改名の長さ判定は書記素数で行う（絵文字は 1 文字）", async () => {
    // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
    // 旧実装（UTF-16 長）では境界ちょうどでも弾かれていたケースを許可することを保証する。
    const ownerHeaders = await createSession("emoji-owner", "Owner");

    const boundary = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "😀".repeat(MAX_ROOM_NAME_LENGTH) }),
      },
      env,
    );
    expect(boundary.status).toBe(201);

    const tooLong = await app.request(
      "/rooms",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) }),
      },
      env,
    );
    expect(tooLong.status).toBe(400);

    // 改名（PATCH）も作成と同じスキーマを共有するが、別ルートのため境界（許可）/
    // 超過（拒否）の両方向を経路として確認する。
    await seedRoom({ roomId: "emoji-rename-room", ownerId: "emoji-owner" });

    const renameBoundary = await app.request(
      "/rooms/emoji-rename-room",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "😀".repeat(MAX_ROOM_NAME_LENGTH) }),
      },
      env,
    );
    expect(renameBoundary.status).toBe(200);

    const renameTooLong = await app.request(
      "/rooms/emoji-rename-room",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) }),
      },
      env,
    );
    expect(renameTooLong.status).toBe(400);
  });

  test("メッセージ編集は本文の上限超過を 400、境界長を許可する", async () => {
    const ownerHeaders = await createSession("editlen-owner", "Owner");
    await seedRoom({ roomId: "editlen-room", ownerId: "editlen-owner" });

    const db = createDb(env.DB);
    const { messages: messagesTable } = await import("../src/db/schema");
    await db.insert(messagesTable).values({
      id: "editlen-msg",
      roomId: "editlen-room",
      userId: "editlen-owner",
      senderName: "Owner",
      body: "before",
      createdAt: new Date(),
    });

    const tooLong = await app.request(
      "/rooms/editlen-room/messages/editlen-msg",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "a".repeat(MAX_MESSAGE_LENGTH + 1) }),
      },
      env,
    );
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid body" });

    const boundary = await app.request(
      "/rooms/editlen-room/messages/editlen-msg",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "a".repeat(MAX_MESSAGE_LENGTH) }),
      },
      env,
    );
    expect(boundary.status).toBe(200);
  });

  test("メッセージ編集の長さ判定は書記素数で行う（絵文字は 1 文字）", async () => {
    // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
    // 旧実装（UTF-16 長）では境界ちょうどでも弾かれていたケースを許可することを保証する。
    const ownerHeaders = await createSession("emojiedit-owner", "Owner");
    await seedRoom({ roomId: "emojiedit-room", ownerId: "emojiedit-owner" });

    const db = createDb(env.DB);
    const { messages: messagesTable } = await import("../src/db/schema");
    await db.insert(messagesTable).values({
      id: "emojiedit-msg",
      roomId: "emojiedit-room",
      userId: "emojiedit-owner",
      senderName: "Owner",
      body: "before",
      createdAt: new Date(),
    });

    const boundary = await app.request(
      "/rooms/emojiedit-room/messages/emojiedit-msg",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "😀".repeat(MAX_MESSAGE_LENGTH) }),
      },
      env,
    );
    expect(boundary.status).toBe(200);

    const tooLong = await app.request(
      "/rooms/emojiedit-room/messages/emojiedit-msg",
      {
        method: "PATCH",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "😀".repeat(MAX_MESSAGE_LENGTH + 1) }),
      },
      env,
    );
    expect(tooLong.status).toBe(400);
  });

  test("POST /rooms/:roomId/read は at を検証し既読位置を進める", async () => {
    const memberHeaders = await createSession("read-user", "Reader");
    await createSession("read-owner", "Owner");
    await seedRoom({
      roomId: "read-room",
      ownerId: "read-owner",
      memberIds: ["read-user"],
    });

    // at 指定 → その時刻が保存される。
    const at = 1_000_000;
    const withAt = await app.request(
      "/rooms/read-room/read",
      {
        method: "POST",
        headers: { ...memberHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ at }),
      },
      env,
    );
    expect(withAt.status).toBe(200);

    const db = createDb(env.DB);
    const afterAt = await db
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, "read-room"),
          eq(roomMembers.userId, "read-user"),
        ),
      );
    expect(afterAt[0]?.lastReadAt?.getTime()).toBe(at);

    // at 省略 → 現在時刻にフォールバックして進む。
    const omitted = await app.request(
      "/rooms/read-room/read",
      {
        method: "POST",
        headers: { ...memberHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(omitted.status).toBe(200);
    const afterOmit = await db
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, "read-room"),
          eq(roomMembers.userId, "read-user"),
        ),
      );
    expect(afterOmit[0]?.lastReadAt?.getTime() ?? 0).toBeGreaterThan(at);

    // 不正な at（負数・非数値）は 400。
    for (const bad of [{ at: -1 }, { at: "now" }]) {
      const res = await app.request(
        "/rooms/read-room/read",
        {
          method: "POST",
          headers: { ...memberHeaders, "Content-Type": "application/json" },
          body: JSON.stringify(bad),
        },
        env,
      );
      expect(res.status).toBe(400);
    }

    // 未所属ユーザーは 403。
    const outsiderHeaders = await createSession("read-outsider", "Outsider");
    const forbidden = await app.request(
      "/rooms/read-room/read",
      {
        method: "POST",
        headers: { ...outsiderHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ at }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);
  });

  test("Push 購読は不正ボディを 400 にし、未設定は検証より先に 503 を返す", async () => {
    const configuredEnv = {
      ...env,
      VAPID_PUBLIC_KEY: "test-public-key",
      VAPID_PRIVATE_KEY: "test-private-key",
    };
    const headers = await createSession("push-invalid-user", "Push User");

    // keys 欠落 → 400。
    const missingKeys = await app.request(
      "/push/subscriptions",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/x" }),
      },
      configuredEnv,
    );
    expect(missingKeys.status).toBe(400);
    expect(await missingKeys.json()).toEqual({
      error: "invalid push subscription",
    });

    // endpoint 空文字 → 400。
    const emptyEndpoint = await app.request(
      "/push/subscriptions",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "", keys: { p256dh: "k", auth: "a" } }),
      },
      configuredEnv,
    );
    expect(emptyEndpoint.status).toBe(400);

    // 未設定 env では不正ボディでも 503（設定不備）を先に返す。
    const unconfigured = await app.request(
      "/push/subscriptions",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ bogus: true }),
      },
      { ...env, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined },
    );
    expect(unconfigured.status).toBe(503);

    // DELETE は endpoint 欠落で 400。
    const badDelete = await app.request(
      "/push/subscriptions",
      {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      configuredEnv,
    );
    expect(badDelete.status).toBe(400);
    expect(await badDelete.json()).toEqual({ error: "invalid endpoint" });
  });

  test("メンバー追加は前後空白付きメールを trim して解決する", async () => {
    const ownerHeaders = await createSession("trim-owner", "Owner");
    await createSession("trim-target", "Target");
    await seedRoom({ roomId: "trim-room", ownerId: "trim-owner" });

    const added = await app.request(
      "/rooms/trim-room/members",
      {
        method: "POST",
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "  trim-target@example.com  " }),
      },
      env,
    );
    expect(added.status).toBe(201);

    // trim 後のメールで実ユーザーが解決され、メンバー行が追加されたことを確認する。
    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(roomMembers)
      .where(
        and(
          eq(roomMembers.roomId, "trim-room"),
          eq(roomMembers.userId, "trim-target"),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});


// 1x1 PNG（テスト用の最小画像）。
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);

function pngFile(name = "x.png") {
  return new File([PNG_1X1], name, { type: "image/png" });
}

/** owner ユーザー行を先に作ってからルームを作る（room_members の FK を満たす）。 */
async function seedRoomOwned(roomId: string, ownerId: string) {
  await createSession(ownerId); // user 行を作る（返る session は使わない）
  await seedRoom({ roomId, ownerId });
}

/** 添付をメッセージに紐付ける（配信テスト用の前提づくり）。 */
async function linkAttachmentToMessage(
  attachmentId: string,
  roomId: string,
  userId: string,
) {
  const db = createDb(env.DB);
  const messageId = `msg-${crypto.randomUUID()}`;
  await db.insert(messages).values({
    id: messageId,
    roomId,
    userId,
    senderName: userId,
    body: "本文",
    createdAt: new Date(),
  });
  await attachToMessage(db, {
    messageId,
    attachmentIds: [attachmentId],
    roomId,
    userId,
  });
  return messageId;
}

describe("画像添付ルート", () => {
  test("POST はセッション無しで 401", async () => {
    await seedRoomOwned("att-401", "att-owner");
    const form = new FormData();
    form.set("file", pngFile());
    const res = await app.request(
      "/rooms/att-401/attachments",
      { method: "POST", body: form },
      env,
    );
    expect(res.status).toBe(401);
  });

  test("POST は非メンバーに 403", async () => {
    await seedRoomOwned("att-403", "att-owner2");
    const headers = await createSession("att-outsider");
    const form = new FormData();
    form.set("file", pngFile());
    const res = await app.request(
      "/rooms/att-403/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("POST は file 欠落で 400", async () => {
    await seedRoomOwned("att-400", "att-u400");
    const headers = await createSession("att-u400");
    const res = await app.request(
      "/rooms/att-400/attachments",
      { method: "POST", headers, body: new FormData() },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("POST は非対応 MIME に 415", async () => {
    await seedRoomOwned("att-415", "att-u415");
    const headers = await createSession("att-u415");
    const form = new FormData();
    form.set("file", new File(["hello"], "x.txt", { type: "text/plain" }));
    const res = await app.request(
      "/rooms/att-415/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(415);
  });

  test("POST は空ファイルに 413", async () => {
    await seedRoomOwned("att-413", "att-u413");
    const headers = await createSession("att-u413");
    const form = new FormData();
    form.set("file", new File([], "x.png", { type: "image/png" }));
    const res = await app.request(
      "/rooms/att-413/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(413);
  });

  test("POST 成功で 201・R2 保存・未紐付け行を作る", async () => {
    await seedRoomOwned("att-ok", "att-uok");
    const headers = await createSession("att-uok");
    const form = new FormData();
    form.set("file", pngFile());
    const res = await app.request(
      "/rooms/att-ok/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attachment: { id: string; mimeType: string; size: number };
    };
    expect(body.attachment.mimeType).toBe("image/png");
    expect(body.attachment.size).toBe(PNG_1X1.byteLength);

    const db = createDb(env.DB);
    const row = (
      await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, body.attachment.id))
    )[0];
    expect(row?.messageId).toBeNull();
    expect(row?.roomId).toBe("att-ok");
    const object = await env.ATTACHMENTS.get(row?.r2Key ?? "");
    expect(object).not.toBeNull();
  });

  test("GET は実体を配信し nosniff を付ける", async () => {
    await seedRoomOwned("att-get", "att-uget");
    const headers = await createSession("att-uget");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-get/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    await linkAttachmentToMessage(attachment.id, "att-get", "att-uget");

    const res = await app.request(
      `/rooms/att-get/attachments/${attachment.id}`,
      { headers },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(PNG_1X1.byteLength);
  });

  test("GET は URL の roomId と実体不一致で 404", async () => {
    await seedRoomOwned("att-r1", "att-ur");
    await seedRoom({ roomId: "att-r2", ownerId: "att-ur" });
    const headers = await createSession("att-ur");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-r1/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const res = await app.request(
      `/rooms/att-r2/attachments/${attachment.id}`,
      { headers },
      env,
    );
    expect(res.status).toBe(404);
  });

  test("GET は紐付くメッセージが論理削除済みなら 404", async () => {
    await seedRoomOwned("att-del", "att-udel");
    const headers = await createSession("att-udel");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-del/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const messageId = await linkAttachmentToMessage(
      attachment.id,
      "att-del",
      "att-udel",
    );
    await softDeleteMessage(createDb(env.DB), messageId, new Date());

    const res = await app.request(
      `/rooms/att-del/attachments/${attachment.id}`,
      { headers },
      env,
    );
    expect(res.status).toBe(404);
  });

  test("GET は非メンバーに 403", async () => {
    await seedRoomOwned("att-getf", "att-ugetf");
    const ownerHeaders = await createSession("att-ugetf");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-getf/attachments",
      { method: "POST", headers: ownerHeaders, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    await linkAttachmentToMessage(attachment.id, "att-getf", "att-ugetf");

    const outsider = await createSession("att-outsider2");
    const res = await app.request(
      `/rooms/att-getf/attachments/${attachment.id}`,
      { headers: outsider },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("PATCH 編集後も添付を保持して配信する", async () => {
    await seedRoomOwned("att-edit", "att-uedit");
    const headers = await createSession("att-uedit");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-edit/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const messageId = await linkAttachmentToMessage(
      attachment.id,
      "att-edit",
      "att-uedit",
    );

    const res = await app.request(
      `/rooms/att-edit/messages/${messageId}`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: "編集後の本文" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as {
      message: { body: string; attachments: { id: string }[] };
    };
    expect(message.body).toBe("編集後の本文");
    // 編集で添付が消えない（既定の [] で上書きされない）。
    expect(message.attachments.map((a) => a.id)).toEqual([attachment.id]);
  });

  test("DELETE は未送信添付を R2・DB とも取り消す", async () => {
    await seedRoomOwned("att-unsend", "att-uunsend");
    const headers = await createSession("att-uunsend");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-unsend/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };

    const del = await app.request(
      `/rooms/att-unsend/attachments/${attachment.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(del.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(0);
    expect(
      await env.ATTACHMENTS.get(`rooms/att-unsend/${attachment.id}`),
    ).toBeNull();
  });

  test("DELETE は送信済み（紐付け済み）添付には 404 を返す", async () => {
    await seedRoomOwned("att-linked", "att-ulinked");
    const headers = await createSession("att-ulinked");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-linked/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    await linkAttachmentToMessage(attachment.id, "att-linked", "att-ulinked");

    const del = await app.request(
      `/rooms/att-linked/attachments/${attachment.id}`,
      { method: "DELETE", headers },
      env,
    );
    expect(del.status).toBe(404);
  });

  test("メッセージ削除で添付の R2・DB 実体を回収する", async () => {
    await seedRoomOwned("att-msgdel", "att-umsgdel");
    const headers = await createSession("att-umsgdel");
    const form = new FormData();
    form.set("file", pngFile());
    const up = await app.request(
      "/rooms/att-msgdel/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const messageId = await linkAttachmentToMessage(
      attachment.id,
      "att-msgdel",
      "att-umsgdel",
    );

    const del = await app.request(
      `/rooms/att-msgdel/messages/${messageId}`,
      { method: "DELETE", headers },
      env,
    );
    expect(del.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachment.id));
    expect(rows).toHaveLength(0);
    expect(
      await env.ATTACHMENTS.get(`rooms/att-msgdel/${attachment.id}`),
    ).toBeNull();
  });

  test("POST は累積ストレージ上限を超えると 413", async () => {
    await seedRoomOwned("att-quota", "att-uquota");
    const headers = await createSession("att-uquota");
    // 上限ちょうどを消費する行を直接投入（R2 実体は不要、DB 合計だけ見る）。
    const db = createDb(env.DB);
    await createAttachment(db, {
      id: "quota-filler",
      roomId: "att-quota",
      userId: "att-uquota",
      r2Key: "rooms/att-quota/quota-filler",
      mimeType: "image/png",
      size: MAX_ATTACHMENT_STORAGE_BYTES_PER_USER,
    });

    const form = new FormData();
    form.set("file", pngFile());
    const res = await app.request(
      "/rooms/att-quota/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(413);
  });

  test("POST はアップロードのレート上限を超えると 429", async () => {
    await seedRoomOwned("att-rate", "att-urate");
    const headers = await createSession("att-urate");
    // 直近ウィンドウ内に上限件数の行を直接投入（createdAt 既定＝now）。
    const db = createDb(env.DB);
    for (let i = 0; i < ATTACHMENT_UPLOAD_RATE_MAX; i += 1) {
      await createAttachment(db, {
        id: `rate-${i}`,
        roomId: "att-rate",
        userId: "att-urate",
        r2Key: `rooms/att-rate/rate-${i}`,
        mimeType: "image/png",
        size: 1,
      });
    }

    const form = new FormData();
    form.set("file", pngFile());
    const res = await app.request(
      "/rooms/att-rate/attachments",
      { method: "POST", headers, body: form },
      env,
    );
    expect(res.status).toBe(429);
  });
});
