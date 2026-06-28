"use client";

import type { ChatMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH, tokenizeMessageBody } from "@repo/shared";
import { Fragment, useEffect, useRef, useState } from "react";
import { deleteMessage, editMessage, markRoomRead } from "@/lib/rooms";
import { formatDay } from "@/lib/datetime";
import { useRoomChat } from "@/lib/use-room-chat";
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
 * ライブ分（履歴 + 新着）は WebSocket フックから、それより古い分は REST で取得して前方に連結する。
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
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  /** 直近で最下部スクロール判定に使ったライブ末尾 ID。 */
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
    const latestId = messages[messages.length - 1]?.id ?? null;
    if (latestId === lastSeenLiveIdRef.current) return;
    const isInitial = lastSeenLiveIdRef.current === null;
    lastSeenLiveIdRef.current = latestId;
    if (latestId && (isInitial || stickToBottomRef.current)) {
      bottomRef.current?.scrollIntoView({
        behavior: isInitial ? "auto" : "smooth",
      });
    }
  }, [messages]);

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;
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

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditDraft(m.body);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const submitEdit = async (m: ChatMessage) => {
    const body = editDraft.trim();
    if (body.length === 0 || body === m.body) {
      cancelEdit();
      return;
    }
    try {
      await editMessage(roomId, m.id, body);
      // WS の update 配信で自分にも反映されるため、ここではフォームを閉じるだけ。
      cancelEdit();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "編集に失敗しました");
    }
  };

  const submitDelete = async (m: ChatMessage) => {
    if (!window.confirm("このメッセージを削除しますか？")) return;
    try {
      await deleteMessage(roomId, m.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "削除に失敗しました");
    }
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

        {messages.map((m, idx) => {
          const mine = m.userId === currentUserId;
          const isDeleted = m.deletedAt !== null;
          const isEditing = editingId === m.id;
          const prev = messages[idx - 1];
          // 日付が変わる境目に区切りを挿入する（実在する時系列構造のみ）。
          const showDivider =
            !prev || formatDay(prev.createdAt) !== formatDay(m.createdAt);
          // 同一送信者の連続メッセージは名前を先頭のみに集約する。
          const grouped =
            !showDivider && prev !== undefined && prev.userId === m.userId;
          return (
            <Fragment key={m.id}>
              {showDivider && (
                <div className="date-divider">{formatDay(m.createdAt)}</div>
              )}
              <div
                className={`msg${mine ? " is-mine" : ""}${
                  grouped ? " is-grouped" : ""
                }`}
              >
                {!grouped && <span className="msg-author">{m.userName}</span>}
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitEdit(m);
                    }}
                    className="edit-form"
                  >
                    <textarea
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      maxLength={MAX_MESSAGE_LENGTH}
                      rows={2}
                    />
                    <div className="edit-actions">
                      <button type="submit">保存</button>
                      <button type="button" onClick={cancelEdit}>
                        取消
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    className={`bubble${mine ? " is-mine" : ""}${
                      isDeleted ? " is-deleted" : ""
                    }`}
                  >
                    {isDeleted
                      ? "（このメッセージは削除されました）"
                      : tokenizeMessageBody(m.body).map((seg, i) => {
                          if (seg.type === "mention") {
                            return (
                              <span key={i} className="mention">
                                {seg.value}
                              </span>
                            );
                          }
                          if (seg.type === "link") {
                            return (
                              <a
                                key={i}
                                href={seg.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="msg-link"
                              >
                                {seg.value}
                              </a>
                            );
                          }
                          return seg.value;
                        })}
                    {m.editedAt !== null && !isDeleted && (
                      <span className="msg-edited" title="編集済み">
                        （編集済み）
                      </span>
                    )}
                  </div>
                )}
                {mine && !isDeleted && !isEditing && (
                  <div className="msg-actions">
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      aria-label="メッセージを編集"
                      className="btn-quiet msg-action"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitDelete(m)}
                      aria-label="メッセージを削除"
                      className="btn-quiet btn-danger msg-action"
                    >
                      削除
                    </button>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

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
