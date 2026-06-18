import type { ChatMessage, Room } from "@repo/shared";
import { MESSAGE_PAGE_SIZE } from "@repo/shared";
import { client } from "./rpc";

/** ルーム一覧（新しい順）を取得する。 */
export async function listRooms(): Promise<Room[]> {
  const res = await client.rooms.$get();
  if (!res.ok) throw new Error("ルーム一覧の取得に失敗しました");
  const data = await res.json();
  return data.rooms;
}

/** ルームを作成して作成済みルームを返す。 */
export async function createRoom(name: string): Promise<Room> {
  const res = await client.rooms.$post({ json: { name } });
  if (!res.ok) throw new Error("ルームの作成に失敗しました");
  const data = await res.json();
  return data.room;
}

/**
 * ルームのメッセージ履歴を古い順で取得する。
 * `before` を渡すと、その位置より古い 1 ページを取得する（過去ログ読み込み用）。
 */
export async function fetchMessages(
  roomId: string,
  before?: { createdAt: number; id: string },
): Promise<ChatMessage[]> {
  const res = await client.rooms[":roomId"].messages.$get({
    param: { roomId },
    query: {
      limit: String(MESSAGE_PAGE_SIZE),
      before: before ? String(before.createdAt) : undefined,
      beforeId: before ? before.id : undefined,
    },
  });
  if (!res.ok) throw new Error("メッセージ履歴の取得に失敗しました");
  const data = await res.json();
  return data.messages;
}
