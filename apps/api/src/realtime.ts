import type { ChatMessage } from "@repo/shared";
import type { Bindings } from "./types";

/**
 * ルームの Durable Object（`RoomDO`）へ Worker から到達するための最小インターフェース。
 * 共有 `Bindings` には載せず、ここでだけ参照する（理由は `worker.ts` のコメント参照）。
 */
type RoomNamespaceBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

function getRoom(env: Bindings) {
  return (env as unknown as { ROOM?: RoomNamespaceBinding }).ROOM;
}

/** ルームから特定メンバーの接続中 WebSocket を、対応する DO 経由でクローズさせる。 */
export async function disconnectRoomMember(
  env: Bindings,
  roomId: string,
  userId: string,
) {
  const room = getRoom(env);
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/disconnect-member", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
  );
}

/** ルーム削除時に、対応する DO へ接続中の全 WebSocket をクローズさせる。 */
export async function disconnectRoomAll(env: Bindings, roomId: string) {
  const room = getRoom(env);
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/disconnect-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** メッセージ編集 / 削除を、対応する DO 経由で接続中の全 WebSocket に配信する。 */
export async function broadcastMessageUpdate(
  env: Bindings,
  roomId: string,
  message: ChatMessage,
) {
  const room = getRoom(env);
  if (!room) return;

  const stub = room.get(room.idFromName(roomId));
  await stub.fetch(
    new Request("https://room.internal/broadcast-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
}
