import type { ChatMessage } from "@repo/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "./index";
import { messages, user } from "./schema";

/** メッセージ一覧のキーセットカーソル（この位置より「古い」ものを返す）。 */
export type MessageCursor = { createdAt: number; id: string };

/**
 * ルームのメッセージを古い順（昇順）で返す。
 *
 * 並びは `(created_at, id)` のタイブレーク付き。同一ミリ秒のメッセージでも
 * 安定した順序になり、`cursor` を使ったキーセットページネーションが破綻しない。
 * `cursor` を渡すと、その位置より厳密に古いメッセージだけを返す。
 */
export async function listMessages(
  db: Db,
  opts: { roomId: string; limit: number; before?: MessageCursor },
): Promise<ChatMessage[]> {
  const { roomId, limit, before } = opts;

  const olderThanCursor = before
    ? or(
        lt(messages.createdAt, new Date(before.createdAt)),
        and(
          eq(messages.createdAt, new Date(before.createdAt)),
          lt(messages.id, before.id),
        ),
      )
    : undefined;

  const rows = await db
    .select({
      id: messages.id,
      roomId: messages.roomId,
      userId: messages.userId,
      body: messages.body,
      createdAt: messages.createdAt,
      userName: user.name,
    })
    .from(messages)
    .innerJoin(user, eq(messages.userId, user.id))
    .where(and(eq(messages.roomId, roomId), olderThanCursor))
    // 直近 limit 件を取りたいので降順で取得し、最後に昇順へ反転する。
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);

  return rows
    .map((r) => ({
      id: r.id,
      roomId: r.roomId,
      userId: r.userId,
      userName: r.userName,
      body: r.body,
      createdAt: r.createdAt.getTime(),
    }))
    .toReversed();
}
