"use client";

import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { useRoomChat } from "@/lib/use-room-chat";

const STATUS_LABEL = {
  connecting: "接続中…",
  open: "接続済み",
  closed: "切断（再接続中…）",
} as const;

/** 単一ルームのチャット UI（一覧 + 入力 + 接続状態）。 */
export function ChatRoom({
  roomId = "general",
  currentUserId,
}: {
  roomId?: string;
  currentUserId: string;
}) {
  const { messages, status, send } = useRoomChat(roomId);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新着で最下部へスクロール。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    send(body);
    setDraft("");
  };

  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
      <div style={{ fontSize: 12, color: "#666" }}>
        ルーム: {roomId} / 状態: {STATUS_LABEL[status]}
      </div>

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
        {messages.length === 0 && (
          <p style={{ color: "#999" }}>まだメッセージはありません。</p>
        )}
        {messages.map((m) => {
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
                }}
              >
                {m.body}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="メッセージを入力"
          maxLength={MAX_MESSAGE_LENGTH}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={status !== "open" || draft.trim().length === 0}>
          送信
        </button>
      </form>
    </div>
  );
}
