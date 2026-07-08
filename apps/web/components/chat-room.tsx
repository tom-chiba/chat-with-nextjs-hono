"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initialOf, MAX_AVATARS } from "@/lib/avatar";
import { markRoomRead } from "@/lib/rooms";
import { useMessageActions } from "@/lib/use-message-actions";
import { useRoomChat } from "@/lib/use-room-chat";
import { useRoomMembers } from "@/lib/use-room-members";
import { Composer } from "./composer";
import { HamburgerIcon } from "./icons";
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
  roomName,
  currentUserId,
  onRead,
  onOpenRooms,
}: {
  roomId: string;
  /** ヘッダーに表示するルーム名（一覧ロード前は null になり得る）。 */
  roomName: string | null;
  currentUserId: string;
  /** 既読化が完了した際に呼ばれる（一覧側の未読バッジ更新用）。 */
  onRead?: () => void;
  /** ヘッダーのハンバーガー押下で呼ばれる（モバイルのルーム一覧ドロワーを開く）。 */
  onOpenRooms?: () => void;
}) {
  const {
    messages,
    pending,
    status,
    send,
    retry,
    discard,
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
  const members = useRoomMembers(roomId, currentUserId);
  const [membersOpen, setMembersOpen] = useState(false);

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

  return (
    <div className="chat">
      <div className="chat-header">
        {onOpenRooms && (
          <button
            type="button"
            className="icon-btn chat-hamburger mobile-only"
            onClick={onOpenRooms}
            aria-label="ルーム一覧を開く"
          >
            <HamburgerIcon />
          </button>
        )}

        <div className="chat-heading">
          <span
            className={`presence-dot${status === "open" ? " is-open" : ""}`}
            title={STATUS_LABEL[status]}
            aria-hidden="true"
          />
          <span className="chat-room-name">{roomName ?? "ルーム"}</span>
          <span className="sr-only" role="status">
            状態: {STATUS_LABEL[status]}
          </span>
        </div>

        {/* メンバー取得前・失敗時も導線を残す（シートを開けば error を確認できる）。 */}
        <button
          type="button"
          className="member-avatars"
          onClick={() => setMembersOpen(true)}
          aria-label={
            members.members.length > 0
              ? `メンバー ${members.members.length} 人を表示`
              : "メンバーを表示"
          }
        >
          {members.members.length > 0 ? (
            <>
              {members.members.slice(0, MAX_AVATARS).map((m) => (
                <span key={m.userId} className="avatar" aria-hidden="true">
                  {initialOf(m.userName)}
                </span>
              ))}
              {members.members.length > MAX_AVATARS && (
                <span className="avatar avatar-more" aria-hidden="true">
                  +{members.members.length - MAX_AVATARS}
                </span>
              )}
            </>
          ) : (
            <span className="member-avatars-icon" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
          )}
        </button>
      </div>

      <MessageList
        messages={messages}
        pending={pending}
        onRetryPending={retry}
        onDiscardPending={discard}
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

      <Composer roomId={roomId} onSend={send} />

      {membersOpen && (
        <>
          {/* 背面のバックドロップ。クリックで閉じる。 */}
          <button
            type="button"
            className="sheet-backdrop"
            aria-label="メンバー一覧を閉じる"
            onClick={() => setMembersOpen(false)}
          />
          <RoomMembers {...members} onClose={() => setMembersOpen(false)} />
        </>
      )}
    </div>
  );
}
