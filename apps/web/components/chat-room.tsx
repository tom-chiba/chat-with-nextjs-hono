"use client";

import type { ChatMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH, MESSAGE_PAGE_SIZE } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { fetchMessages } from "@/lib/rooms";
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
}: {
  roomId: string;
  currentUserId: string;
}) {
  const { messages: live, status, send } = useRoomChat(roomId);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新着（ライブ）でのみ最下部へスクロールする。過去ログ連結では位置を保つ。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [live]);

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

  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
      <div style={{ fontSize: 12, color: "#666" }}>状態: {STATUS_LABEL[status]}</div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
          height: 360,
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
          return (
            <div key={m.id} style={{ textAlign: mine ? "right" : "left" }}>
              <span style={{ fontSize: 12, color: "#888" }}>{m.userName}</span>
              <div
                style={{
                  display: "inline-block",
                  background: mine ? "#dcf8c6" : "#f1f1f1",
                  borderRadius: 8,
                  padding: "4px 8px",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                  textAlign: "left",
                }}
              >
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

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
