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

/** ルーム名を変更する（オーナー専用）。 */
export async function updateRoomName(
  roomId: string,
  name: string,
): Promise<void> {
  const res = await client.rooms[":roomId"].$patch({
    param: { roomId },
    json: { name },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("オーナーのみ編集できます");
    if (res.status === 400) throw new Error("ルーム名が不正です");
    throw new Error("ルーム名の更新に失敗しました");
  }
}

/** ルームを削除する（オーナー専用）。 */
export async function deleteRoom(roomId: string): Promise<void> {
  const res = await client.rooms[":roomId"].$delete({ param: { roomId } });
  if (!res.ok) {
    if (res.status === 403) throw new Error("オーナーのみ削除できます");
    if (res.status === 404) throw new Error("ルームが見つかりませんでした");
    throw new Error("ルームの削除に失敗しました");
  }
}

/**
 * 自分のルーム既読位置を `at`（ミリ秒）まで進める。
 * サーバ側で「より新しい場合のみ」更新するため、巻き戻しは起きない。
 */
export async function markRoomRead(roomId: string, at: number): Promise<void> {
  const res = await client.rooms[":roomId"].read.$post({
    param: { roomId },
    json: { at },
  });
  if (!res.ok) throw new Error("既読更新に失敗しました");
}

/** メッセージ本文を編集する（本人のみ）。 */
export async function editMessage(
  roomId: string,
  messageId: string,
  body: string,
): Promise<void> {
  const res = await client.rooms[":roomId"].messages[":messageId"].$patch({
    param: { roomId, messageId },
    json: { body },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("本人のみ編集できます");
    if (res.status === 400) throw new Error("メッセージ本文が不正です");
    if (res.status === 410) throw new Error("削除済みのため編集できません");
    throw new Error("メッセージの編集に失敗しました");
  }
}

/** メッセージを削除する（本人のみ・論理削除）。 */
export async function deleteMessage(
  roomId: string,
  messageId: string,
): Promise<void> {
  const res = await client.rooms[":roomId"].messages[":messageId"].$delete({
    param: { roomId, messageId },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("本人のみ削除できます");
    throw new Error("メッセージの削除に失敗しました");
  }
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
