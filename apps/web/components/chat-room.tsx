"use client";

import type { ChatMessage } from "@repo/shared";
import {
  MAX_MESSAGE_LENGTH,
  MESSAGE_PAGE_SIZE,
  tokenizeMessageBody,
} from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import {
  deleteMessage,
  editMessage,
  fetchMessages,
  markRoomRead,
} from "@/lib/rooms";
import { useRoomChat } from "@/lib/use-room-chat";

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
  const { messages: live, status, send, errorMessage, clearError } =
    useRoomChat(roomId);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
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
    const latestId = live[live.length - 1]?.id ?? null;
    if (latestId === lastSeenLiveIdRef.current) return;
    const isInitial = lastSeenLiveIdRef.current === null;
    lastSeenLiveIdRef.current = latestId;
    if (latestId && (isInitial || stickToBottomRef.current)) {
      bottomRef.current?.scrollIntoView({
        behavior: isInitial ? "auto" : "smooth",
      });
    }
  }, [live]);

  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  useEffect(() => {
    const latest = live[live.length - 1];
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
  }, [roomId, live]);

  const all = [...older, ...live];

  const loadOlder = async () => {
    const oldest = all[0];
    if (loadingMore || !oldest) return;
    setLoadingMore(true);
    try {
      const page = await fetchMessages(roomId, {
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
      setOlder((prev) => [...page, ...prev]);
      if (page.length < MESSAGE_PAGE_SIZE) setHasMore(false);
    } catch {
      // 取得失敗時はボタンを残し、再試行できるようにする。
    } finally {
      setLoadingMore(false);
    }
  };

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
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
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
        <div style={{ fontSize: 12, color: "#666" }}>
          状態: {STATUS_LABEL[status]}
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
          height: "min(60vh, 360px)",
          overflowY: "auto",
          display: "grid",
          gap: 6,
          alignContent: "start",
        }}
      >
        {all.length === 0 ? (
          <p style={{ color: "#999" }}>まだメッセージはありません。</p>
        ) : hasMore ? (
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            style={{ justifySelf: "center", fontSize: 12 }}
          >
            {loadingMore ? "読み込み中…" : "過去のメッセージを読み込む"}
          </button>
        ) : (
          <p style={{ textAlign: "center", color: "#bbb", fontSize: 12 }}>
            これ以上の履歴はありません
          </p>
        )}

        {all.map((m) => {
          const mine = m.userId === currentUserId;
          const isDeleted = m.deletedAt !== null;
          const isEditing = editingId === m.id;
          return (
            <div key={m.id} style={{ textAlign: mine ? "right" : "left" }}>
              <span style={{ fontSize: 12, color: "#888" }}>{m.userName}</span>
              {isEditing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitEdit(m);
                  }}
                  style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}
                >
                  <textarea
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={2}
                    style={{
                      flex: 1,
                      maxWidth: 400,
                      resize: "vertical",
                      fontFamily: "inherit",
                      fontSize: "inherit",
                    }}
                  />
                  <div style={{ display: "grid", gap: 2 }}>
                    <button type="submit">保存</button>
                    <button type="button" onClick={cancelEdit}>
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  style={{
                    display: "inline-block",
                    background: isDeleted
                      ? "#f5f5f5"
                      : mine
                        ? "#dcf8c6"
                        : "#f1f1f1",
                    borderRadius: 8,
                    padding: "4px 8px",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    textAlign: "left",
                    color: isDeleted ? "#999" : "inherit",
                    fontStyle: isDeleted ? "italic" : "normal",
                  }}
                >
                  {isDeleted
                    ? "（このメッセージは削除されました）"
                    : tokenizeMessageBody(m.body).map((seg, i) => {
                        if (seg.type === "mention") {
                          return (
                            <span
                              key={i}
                              style={{
                                background: "#fff3a0",
                                color: "#5a4500",
                                borderRadius: 4,
                                padding: "0 2px",
                                fontWeight: 600,
                              }}
                            >
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
                              style={{
                                color: "#1e6fdf",
                                textDecoration: "underline",
                              }}
                            >
                              {seg.value}
                            </a>
                          );
                        }
                        return seg.value;
                      })}
                  {m.editedAt !== null && !isDeleted && (
                    <span
                      style={{ fontSize: 10, color: "#888", marginLeft: 4 }}
                      title="編集済み"
                    >
                      （編集済み）
                    </span>
                  )}
                </div>
              )}
              {mine && !isDeleted && !isEditing && (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    justifyContent: "flex-end",
                    marginTop: 2,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    aria-label="メッセージを編集"
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      border: "1px solid #ddd",
                      borderRadius: 4,
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitDelete(m)}
                    aria-label="メッセージを削除"
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      border: "1px solid #ddd",
                      borderRadius: 4,
                      background: "#fff",
                      cursor: "pointer",
                      color: "#c00",
                    }}
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {actionError && (
        <p style={{ color: "#c00", fontSize: 12, margin: 0 }}>{actionError}</p>
      )}

      {errorMessage && (
        <div
          role="alert"
          style={{
            background: "#fff3cd",
            color: "#7a5d00",
            border: "1px solid #f5d77a",
            padding: "6px 8px",
            borderRadius: 6,
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="エラー表示を閉じる"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="メッセージを入力（Shift+Enter で改行）"
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          style={{ flex: 1, resize: "vertical", fontFamily: "inherit", fontSize: "inherit" }}
        />
        <button
          type="submit"
          disabled={status !== "open" || draft.trim().length === 0}
        >
          送信
        </button>
      </form>
    </div>
  );
}
