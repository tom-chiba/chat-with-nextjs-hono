import type { Room } from "@repo/shared";
import { expect, test } from "vitest";
import { mergeRooms } from "@/lib/room-list";

function room(id: string, createdAt: number, overrides: Partial<Room> = {}): Room {
  return {
    id,
    name: `room-${id}`,
    createdAt,
    unreadCount: 0,
    myRole: "member",
    ...overrides,
  };
}

test("localOnly と list を createdAt 降順に並べる", () => {
  const merged = mergeRooms([room("a", 3)], [room("b", 1), room("c", 2)]);
  expect(merged.map((r) => r.id)).toEqual(["a", "c", "b"]);
});

test("サーバ未反映の自作ルーム（localOnly）を取りこぼさない", () => {
  // prev の "x" はサーバスナップショットに含まれないが残る。
  const merged = mergeRooms([room("x", 5), room("a", 2)], [room("a", 2)]);
  expect(merged.map((r) => r.id)).toEqual(["x", "a"]);
});

test("サーバ反映後も位置がジャンプしない（同一順序）", () => {
  // localOnly だった "new"(createdAt 9) が list に入っても先頭のまま。
  const before = mergeRooms([room("new", 9)], [room("old", 1)]);
  const after = mergeRooms(before, [room("new", 9), room("old", 1)]);
  expect(before.map((r) => r.id)).toEqual(after.map((r) => r.id));
  expect(after.map((r) => r.id)).toEqual(["new", "old"]);
});

test("createdAt 同値は id 降順でタイブレークする", () => {
  const merged = mergeRooms([], [room("a", 1), room("b", 1)]);
  expect(merged.map((r) => r.id)).toEqual(["b", "a"]);
});

test("createdAt 同値でもサーバ反映前後で位置がジャンプしない", () => {
  // 既存ルームと同一ミリ秒に作成された自作ルーム。localOnly の間も
  // list 反映後も id 降順で位置が決まり、順序が変わらないことを確認する。
  const before = mergeRooms([room("zzz", 5)], [room("aaa", 5)]);
  const after = mergeRooms(before, [room("zzz", 5), room("aaa", 5)]);
  expect(before.map((r) => r.id)).toEqual(after.map((r) => r.id));
  expect(after.map((r) => r.id)).toEqual(["zzz", "aaa"]);
});

test("複数の localOnly も createdAt 降順（同値は id 降順）で整列する", () => {
  // 連続作成で未反映の自作ルームが積み上がるケース。
  const merged = mergeRooms([room("b", 5), room("a", 5), room("c", 9)], [room("old", 1)]);
  expect(merged.map((r) => r.id)).toEqual(["c", "b", "a", "old"]);
});

test("list 側の最新情報（未読件数など）を優先する", () => {
  const merged = mergeRooms([room("a", 1, { unreadCount: 3 })], [room("a", 1, { unreadCount: 0 })]);
  expect(merged).toHaveLength(1);
  expect(merged[0]?.unreadCount).toBe(0);
});

test("元配列を破壊しない", () => {
  const prev = [room("a", 2), room("b", 1)];
  mergeRooms(prev, [room("c", 3)]);
  expect(prev.map((r) => r.id)).toEqual(["a", "b"]);
});
