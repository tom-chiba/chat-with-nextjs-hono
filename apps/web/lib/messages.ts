import type { ChatMessage } from "@repo/shared";

/**
 * メッセージの `(createdAt, id)` 昇順比較。
 * サーバ `listMessages`（apps/api db/messages.ts）のソート規則と同一に保つこと。
 * 規則がずれると表示順やマージ・欠落検出が静かに破綻する。
 */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 既存メッセージへ受信分を id で一意化しながらマージし、`compareMessages`（昇順）で返す。
 * 同一 id は受信分（incoming）を優先し、編集・削除の最新版を反映する。
 */
export function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].toSorted(compareMessages);
}
