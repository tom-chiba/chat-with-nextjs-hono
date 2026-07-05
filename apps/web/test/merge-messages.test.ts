import type { ChatMessage } from "@repo/shared";
import { expect, test } from "vitest";
import { mergeMessages } from "@/lib/messages";

function msg(id: string, createdAt: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    roomId: "room-1",
    userId: "user-1",
    userName: "user-1",
    body: `body-${id}`,
    attachments: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

test("id で一意化し createdAt 昇順に並べる", () => {
  const merged = mergeMessages([msg("a", 3), msg("b", 1)], [msg("c", 2)]);
  expect(merged.map((m) => m.id)).toEqual(["b", "c", "a"]);
});

test("同一 id は incoming（最新版）を優先する", () => {
  const edited = msg("a", 1, { body: "edited", editedAt: 5 });
  const merged = mergeMessages([msg("a", 1)], [edited]);
  expect(merged).toHaveLength(1);
  expect(merged[0]?.body).toBe("edited");
  expect(merged[0]?.editedAt).toBe(5);
});

test("createdAt 同値は id でタイブレークする", () => {
  const merged = mergeMessages([msg("b", 1)], [msg("a", 1)]);
  expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
});

test("incoming が空なら既存をそのまま返す", () => {
  const existing = [msg("a", 1)];
  expect(mergeMessages(existing, [])).toBe(existing);
});

test("元配列を破壊しない", () => {
  const existing = [msg("a", 2), msg("b", 1)];
  mergeMessages(existing, [msg("c", 3)]);
  expect(existing.map((m) => m.id)).toEqual(["a", "b"]);
});
