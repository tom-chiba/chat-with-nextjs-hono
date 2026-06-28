import { parseMentionCandidates } from "@repo/shared";
import type { Db } from "./db";
import { listRoomMembers } from "./db/rooms";

/** メンション解決に必要なメンバー情報（表示名 → userId の対応）。 */
export type MentionMember = {
  userId: string;
  userName: string;
};

/**
 * `@<name>` 候補をメンバーの表示名と突き合わせ、メンションされた userId を返す純関数。
 *
 * - 完全一致のみ（候補の先頭からメンバー名に一致するか）。
 * - 最長一致のためメンバー名は長い順に評価する（例: `千葉さん` を `千葉` より優先）。
 * - 同名は最初の 1 件のみ採用する（任意性に依存しない MVP）。
 */
export function resolveMentions(
  candidates: string[],
  members: MentionMember[],
): Set<string> {
  if (candidates.length === 0) return new Set();

  const nameToUserId = new Map<string, string>();
  for (const m of members) {
    if (!nameToUserId.has(m.userName)) nameToUserId.set(m.userName, m.userId);
  }
  // 最長一致: 長いメンバー名から順にスキャンして本文にあるか確かめる。
  const sortedNames = [...nameToUserId.keys()].toSorted(
    (a, b) => b.length - a.length,
  );

  const hits = new Set<string>();
  for (const cand of candidates) {
    const matched = sortedNames.find((name) => cand.startsWith(name));
    if (!matched) continue;
    const userId = nameToUserId.get(matched);
    if (userId) hits.add(userId);
  }
  return hits;
}

/**
 * 本文の `@<name>` をルームメンバー名と突き合わせ、メンションされた userId を返す。
 * 本文に候補が無ければメンバー照会を省く。
 */
export async function resolveMentionedUserIds(
  db: Db,
  roomId: string,
  body: string,
): Promise<Set<string>> {
  const candidates = parseMentionCandidates(body);
  if (candidates.length === 0) return new Set();

  const members = await listRoomMembers(db, roomId);
  return resolveMentions(candidates, members);
}
