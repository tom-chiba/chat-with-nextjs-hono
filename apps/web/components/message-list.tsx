"use client";

import type { ChatMessage } from "@repo/shared";
import { useEffect, useRef } from "react";
import type { PendingMessage } from "@/lib/use-room-chat";
import { MessageItem } from "./message-item";
import { PendingMessageItem } from "./pending-message-item";

/**
 * メッセージ一覧の描画。
 * 空表示・過去ログ読み込みヘッダ・各メッセージ（{@link MessageItem}）に加え、
 * 楽観送信中の保留メッセージ（{@link PendingMessageItem}）を末尾へ並べ、
 * 最下部への自動スクロール追従（過去ログ閲覧中は抑止）を担う。
 */
export function MessageList({
  messages,
  pending,
  onRetryPending,
  onDiscardPending,
  currentUserId,
  hasMore,
  loadOlder,
  loadingMore,
  editingId,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onSubmitDelete,
}: {
  messages: ChatMessage[];
  pending: PendingMessage[];
  onRetryPending: (nonce: string) => void;
  onDiscardPending: (nonce: string) => void;
  currentUserId: string;
  hasMore: boolean;
  loadOlder: () => void;
  loadingMore: boolean;
  editingId: string | null;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onStartEdit: (m: ChatMessage) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (m: ChatMessage) => void;
  onSubmitDelete: (m: ChatMessage) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** 直近で最下部スクロール判定に使った末尾 ID（保留中は nonce）。 */
  const lastSeenLiveIdRef = useRef<string | null>(null);
  /** 最下部追従中かどうか（過去ログ閲覧中なら false）。スクロール中に追跡する。 */
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  };

  useEffect(() => {
    // 末尾は保留メッセージを優先（自分の送信直後に最下部へ追従させるため）。
    const latestId =
      pending[pending.length - 1]?.nonce ??
      messages[messages.length - 1]?.id ??
      null;
    if (latestId === lastSeenLiveIdRef.current) return;
    const isInitial = lastSeenLiveIdRef.current === null;
    lastSeenLiveIdRef.current = latestId;
    if (latestId && (isInitial || stickToBottomRef.current)) {
      bottomRef.current?.scrollIntoView({
        behavior: isInitial ? "auto" : "smooth",
      });
    }
  }, [messages, pending]);

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="msg-scroll">
      {messages.length === 0 ? (
        <p className="empty-note">まだメッセージはありません。</p>
      ) : hasMore ? (
        <button
          type="button"
          onClick={loadOlder}
          disabled={loadingMore}
          className="load-more"
        >
          {loadingMore ? "読み込み中…" : "過去のメッセージを読み込む"}
        </button>
      ) : (
        <p className="history-end">これ以上の履歴はありません</p>
      )}

      {messages.map((m, idx) => (
        <MessageItem
          key={m.id}
          message={m}
          prevMessage={messages[idx - 1]}
          currentUserId={currentUserId}
          isEditing={editingId === m.id}
          editDraft={editDraft}
          onEditDraftChange={onEditDraftChange}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onSubmitEdit={onSubmitEdit}
          onSubmitDelete={onSubmitDelete}
        />
      ))}
      {pending.map((p) => (
        <PendingMessageItem
          key={p.nonce}
          pending={p}
          onRetry={onRetryPending}
          onDiscard={onDiscardPending}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
