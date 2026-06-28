"use client";

import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { markRoomRead } from "@/lib/rooms";
import { useMessageActions } from "@/lib/use-message-actions";
import { useRoomChat } from "@/lib/use-room-chat";
import { MessageList } from "./message-list";
import { RoomMembers } from "./room-members";

const STATUS_LABEL = {
  connecting: "接続中…",
  open: "接続済み",
  closed: "切断（再接続中…）",
} as const;

/**
 * 単一ルームのチャット UI（一覧 + 入力 + 接続状態 + 過去ログ読み込み）。
 *
 * 親は `key={roomId}` で本コンポーネントを再マウントし、ルーム切替時に状態を初期化する。
 * メッセージ（履歴・新着・過去ログ）は `useRoomChat` が id 一意・時系列ソートの
 * 単一リストとして一元管理し、描画は `MessageList` に委譲する。
 */
export function ChatRoom({
  roomId,
  currentUserId,
  onRead,
  onBack,
}: {
  roomId: string;
  currentUserId: string;
  /** 既読化が完了した際に呼ばれる（一覧側の未読バッジ更新用）。 */
  onRead?: () => void;
  /** モバイル時の「← 一覧へ」ボタン押下で呼ばれる（デスクトップでは表示されない）。 */
  onBack?: () => void;
}) {
  const {
    messages,
    status,
    send,
    errorMessage,
    clearError,
    loadOlder,
    hasMore,
    loadingMore,
  } = useRoomChat(roomId);
  const {
    editingId,
    editDraft,
    setEditDraft,
    actionError,
    startEdit,
    cancelEdit,
    submitEdit,
    submitDelete,
  } = useMessageActions(roomId);
  const [draft, setDraft] = useState("");

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  /** 直近で既読化した末尾メッセージ ID。同じ末尾での冗長な既読 POST を防ぐ。 */
  const lastReadIdRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;
    // 過去ログ読み込み・欠落補完で先頭が増えても末尾が同じなら既読は不要。
    if (latest.id === lastReadIdRef.current) return;
    lastReadIdRef.current = latest.id;
    let cancelled = false;
    void markRoomRead(roomId, latest.createdAt)
      .then(() => {
        if (!cancelled) onReadRef.current?.();
      })
      .catch(() => {
        // 既読更新失敗は致命ではないので握りつぶす（次の更新でリカバリされる）。
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    send(body);
    setDraft("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter は改行、IME 変換中の Enter は確定なので送信しない。
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(e);
  };

  return (
    <div className="chat">
      <div className="chat-top">
        {onBack && (
          <button
            type="button"
            className="mobile-only"
            onClick={onBack}
            aria-label="ルーム一覧へ戻る"
          >
            ← 一覧
          </button>
        )}
        <div className="chat-status">
          <span
            className={`presence-dot${status === "open" ? " is-open" : ""}`}
            aria-hidden="true"
          />
          状態: {STATUS_LABEL[status]}
        </div>
      </div>

      <RoomMembers roomId={roomId} currentUserId={currentUserId} />

      <MessageList
        messages={messages}
        currentUserId={currentUserId}
        hasMore={hasMore}
        loadOlder={loadOlder}
        loadingMore={loadingMore}
        editingId={editingId}
        editDraft={editDraft}
        onEditDraftChange={setEditDraft}
        onStartEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSubmitEdit={(m) => void submitEdit(m)}
        onSubmitDelete={(m) => void submitDelete(m)}
      />

      {actionError && <p className="action-error">{actionError}</p>}

      {errorMessage && (
        <div role="alert" className="warn">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="エラー表示を閉じる"
            className="warn-close"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={submit} className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="メッセージを入力（Shift+Enter で改行）"
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={status !== "open" || draft.trim().length === 0}
        >
          送信
        </button>
      </form>
    </div>
  );
}
