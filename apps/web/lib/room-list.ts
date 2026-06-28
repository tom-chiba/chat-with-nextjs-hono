import type { Room } from "@repo/shared";

/**
 * ルームの `(createdAt, id)` 降順比較。
 * サーバ `listRoomsForUser`（apps/api db/rooms.ts）の `desc(createdAt), desc(id)` と同一に保つこと。
 * 規則がずれると、楽観的に追加したルームがサーバ反映時に別位置へジャンプする。
 */
export function compareRooms(a: Room, b: Room): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * サーバ取得分（`list`）へ、まだ反映されていない自作ルーム（`localOnly`）を
 * 取りこぼさずマージし、`compareRooms`（降順）で並べて返す。
 * ソートを通すことで、localOnly がサーバ反映で `list` 側へ移っても位置が変わらない。
 */
export function mergeRooms(prev: Room[], list: Room[]): Room[] {
  const fromServer = new Map(list.map((r) => [r.id, r]));
  const localOnly = prev.filter((r) => !fromServer.has(r.id));
  return [...localOnly, ...list].toSorted(compareRooms);
}
