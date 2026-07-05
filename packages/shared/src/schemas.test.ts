import { expect, test } from "vitest";
import {
  chatMessageSchema,
  clientMessageSchema,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  messageBodySchema,
  roomNameSchema,
  serverMessageSchema,
} from "./chat";
import { emailSchema } from "./policy";

const validChatMessage = {
  id: "m1",
  roomId: "r1",
  userId: "u1",
  userName: "Alice",
  body: "hello",
  createdAt: 1,
  editedAt: null,
  deletedAt: null,
};

test("messageBodySchema は前後空白を除去して返す", () => {
  expect(messageBodySchema.parse("  hi  ")).toBe("hi");
});

test("messageBodySchema は空・空白のみを弾く", () => {
  expect(messageBodySchema.safeParse("").success).toBe(false);
  expect(messageBodySchema.safeParse("   ").success).toBe(false);
});

test("messageBodySchema は上限ちょうどを許可し超過を弾く", () => {
  expect(messageBodySchema.safeParse("a".repeat(MAX_MESSAGE_LENGTH)).success).toBe(true);
  expect(messageBodySchema.safeParse("a".repeat(MAX_MESSAGE_LENGTH + 1)).success).toBe(false);
});

test("messageBodySchema は書記素数で上限を判定する（絵文字は 1 文字）", () => {
  // 絵文字は String.length では 2 だが、書記素数で MAX ちょうどまで許可する。
  expect(messageBodySchema.safeParse("😀".repeat(MAX_MESSAGE_LENGTH)).success).toBe(true);
  expect(messageBodySchema.safeParse("😀".repeat(MAX_MESSAGE_LENGTH + 1)).success).toBe(false);
  // ZWJ 結合絵文字は String.length では 1 文字あたり 8 と最も乖離が大きいが、
  // 書記素数では 1 文字として上限ちょうどまで許可する。
  expect(messageBodySchema.safeParse("👨‍👩‍👧".repeat(MAX_MESSAGE_LENGTH)).success).toBe(true);
  expect(messageBodySchema.safeParse("👨‍👩‍👧".repeat(MAX_MESSAGE_LENGTH + 1)).success).toBe(false);
  // 肌色修飾（ZWJ とは別の結合形態）も書記素数で 1 文字として判定する。
  expect(messageBodySchema.safeParse("👍🏽".repeat(MAX_MESSAGE_LENGTH)).success).toBe(true);
  expect(messageBodySchema.safeParse("👍🏽".repeat(MAX_MESSAGE_LENGTH + 1)).success).toBe(false);
});

test("roomNameSchema は trim・空・上限超過を扱う", () => {
  expect(roomNameSchema.parse("  部屋  ")).toBe("部屋");
  expect(roomNameSchema.safeParse("   ").success).toBe(false);
  expect(roomNameSchema.safeParse("あ".repeat(MAX_ROOM_NAME_LENGTH)).success).toBe(true);
  expect(roomNameSchema.safeParse("あ".repeat(MAX_ROOM_NAME_LENGTH + 1)).success).toBe(false);
  // 絵文字も書記素数で判定する。
  expect(roomNameSchema.safeParse("😀".repeat(MAX_ROOM_NAME_LENGTH)).success).toBe(true);
  expect(roomNameSchema.safeParse("😀".repeat(MAX_ROOM_NAME_LENGTH + 1)).success).toBe(false);
});

test("emailSchema は trim して妥当なメールのみ通す", () => {
  expect(emailSchema.parse("  a@example.com  ")).toBe("a@example.com");
  expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  expect(emailSchema.safeParse("a@b").success).toBe(false);
});

test("clientMessageSchema は body を trim し非 message 型を弾く", () => {
  const ok = clientMessageSchema.safeParse({ type: "message", body: " hi " });
  expect(ok.success && ok.data.body).toBe("hi");
  expect(clientMessageSchema.safeParse({ type: "ping", body: "x" }).success).toBe(false);
  expect(clientMessageSchema.safeParse({ type: "message", body: "  " }).success).toBe(false);
});

test("clientMessageSchema は nonce を任意で受け付ける", () => {
  // nonce 無し（旧クライアント）も許容する。
  expect(clientMessageSchema.safeParse({ type: "message", body: "hi" }).success).toBe(true);
  const withNonce = clientMessageSchema.safeParse({
    type: "message",
    body: "hi",
    nonce: "abc-123",
  });
  expect(withNonce.success && withNonce.data.nonce).toBe("abc-123");
  // 空 nonce は弾く（相関キーとして無意味なため）。
  expect(clientMessageSchema.safeParse({ type: "message", body: "hi", nonce: "" }).success).toBe(
    false,
  );
});

test("clientMessageSchema は本文空でも添付があれば許可し、両方空は弾く", () => {
  // 本文空 + 添付あり → OK（画像のみ送信）。
  expect(
    clientMessageSchema.safeParse({
      type: "message",
      body: "",
      attachmentIds: ["a1"],
    }).success,
  ).toBe(true);
  // 本文空 + 添付なし → reject（本文または添付が必要）。
  expect(clientMessageSchema.safeParse({ type: "message", body: "" }).success).toBe(false);
  // 空白のみ本文 + 添付なし → trim して空になり reject。
  expect(clientMessageSchema.safeParse({ type: "message", body: "   " }).success).toBe(false);
});

test("clientMessageSchema は attachmentIds の枚数上限と空要素を検証する", () => {
  const ids = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => `a${i}`);
  // 上限ちょうど → OK。
  expect(
    clientMessageSchema.safeParse({ type: "message", body: "x", attachmentIds: ids }).success,
  ).toBe(true);
  // 上限超過 → reject。
  expect(
    clientMessageSchema.safeParse({
      type: "message",
      body: "x",
      attachmentIds: [...ids, "over"],
    }).success,
  ).toBe(false);
  // 空文字の id → reject。
  expect(
    clientMessageSchema.safeParse({
      type: "message",
      body: "x",
      attachmentIds: [""],
    }).success,
  ).toBe(false);
});

test("chatMessageSchema は attachments 省略時に空配列を補う", () => {
  const parsed = chatMessageSchema.safeParse(validChatMessage);
  expect(parsed.success && parsed.data.attachments).toEqual([]);
});

test("chatMessageSchema は editedAt/deletedAt の null と数値を許容する", () => {
  expect(chatMessageSchema.safeParse(validChatMessage).success).toBe(true);
  expect(
    chatMessageSchema.safeParse({ ...validChatMessage, editedAt: 5, deletedAt: 9 }).success,
  ).toBe(true);
  // 型違反（id が数値）は弾く。
  expect(chatMessageSchema.safeParse({ ...validChatMessage, id: 1 }).success).toBe(false);
});

test("serverMessageSchema は 4 種の正常メッセージを通す", () => {
  const cases = [
    { type: "history", messages: [validChatMessage] },
    { type: "message", message: validChatMessage },
    { type: "update", message: validChatMessage },
    { type: "error", code: "rate_limited", message: "slow down" },
  ];
  for (const c of cases) {
    expect(serverMessageSchema.safeParse(c).success).toBe(true);
  }
});

test("serverMessageSchema は message / error の nonce を任意で通す", () => {
  const msg = serverMessageSchema.safeParse({
    type: "message",
    message: validChatMessage,
    nonce: "n1",
  });
  expect(msg.success && msg.data.type === "message" && msg.data.nonce).toBe("n1");
  const err = serverMessageSchema.safeParse({
    type: "error",
    code: "rate_limited",
    message: "slow down",
    nonce: "n2",
  });
  expect(err.success && err.data.type === "error" && err.data.nonce).toBe("n2");
});

test("serverMessageSchema は未知 type・壊れた形状・不正 code を安全に弾く", () => {
  expect(serverMessageSchema.safeParse({ type: "bogus" }).success).toBe(false);
  // message 欠落。
  expect(serverMessageSchema.safeParse({ type: "message" }).success).toBe(false);
  // history 配列内に壊れた要素が 1 つでもあれば全体を弾く。
  expect(
    serverMessageSchema.safeParse({
      type: "history",
      messages: [validChatMessage, { id: 1 }],
    }).success,
  ).toBe(false);
  // 未知のエラーコード。
  expect(
    serverMessageSchema.safeParse({
      type: "error",
      code: "unknown",
      message: "x",
    }).success,
  ).toBe(false);
});
