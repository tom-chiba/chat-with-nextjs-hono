"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMessageTooLong, MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";
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

/** 既読化 POST のデバウンス遅延（ミリ秒）。連投・履歴ロード時の冗長な POST を抑える。 */
const READ_DEBOUNCE_MS = 200;

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
  /** 直近でサーバへ送った既読位置（末尾メッセージの createdAt, ミリ秒）。 */
  const lastReadAtRef = useRef(0);
  /** 直近で観測した末尾メッセージの createdAt。デバウンス発火時に最新値を送る。 */
  const latestAtRef = useRef(0);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 保留中の既読化を送出する。タブ非表示中は送らず保留し、既読位置が進んで
   * いなければ何もしない。連投・初回履歴ロードでの冗長な POST を抑制する。
   */
  const flushRead = useCallback(() => {
    if (readTimerRef.current) {
      clearTimeout(readTimerRef.current);
      readTimerRef.current = null;
    }
    // 非表示中は送らず保留（visibilitychange で復帰時に最新値で 1 回送る）。
    if (typeof document !== "undefined" && document.hidden) return;
    const at = latestAtRef.current;
    if (at <= lastReadAtRef.current) return;
    const prev = lastReadAtRef.current;
    lastReadAtRef.current = at;
    void markRoomRead(roomId, at)
      .then(() => onReadRef.current?.())
      .catch(() => {
        // 既読更新失敗は致命ではない。次回送れるよう送信位置を巻き戻す。
        if (lastReadAtRef.current === at) lastReadAtRef.current = prev;
      });
  }, [roomId]);

  // ライブ更新ごとに即時 POST せず、200ms デバウンスでまとめて 1 回だけ送る。
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;
    latestAtRef.current = latest.createdAt;
    // 過去ログ読み込み・欠落補完で先頭が増えても末尾が進んでいなければ不要。
    if (latest.createdAt <= lastReadAtRef.current) return;
    if (readTimerRef.current) clearTimeout(readTimerRef.current);
    readTimerRef.current = setTimeout(flushRead, READ_DEBOUNCE_MS);
  }, [messages, flushRead]);

  // タブ復帰時に保留分を送出し、アンマウント時にも残った既読を送り切る。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) flushRead();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushRead();
    };
  }, [flushRead]);

  // 長さ判定はサーバと同じく書記素数で行う（絵文字・結合文字を 1 文字として数える）。
  const draftTooLong = isMessageTooLong(draft);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (body.length === 0 || isMessageTooLong(body)) return;
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

      {draftTooLong && <p className="action-error">{MESSAGE_TOO_LONG_MESSAGE}</p>}

      <form onSubmit={submit} className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="メッセージを入力（Shift+Enter で改行）"
          rows={2}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={status !== "open" || draft.trim().length === 0 || draftTooLong}
        >
          送信
        </button>
      </form>
    </div>
  );
}
