"use client";

import { APP_NAME } from "@repo/shared";
import Link from "next/link";
import { useRef, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { ChatRoom } from "@/components/chat-room";
import { RoomList, type RoomListHandle } from "@/components/room-list";
import { useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();
  const [roomId, setRoomId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });
  const roomListRef = useRef<RoomListHandle>(null);

  return (
    <main className="page">
      <header className="page-header">
        <h1 className="wordmark">{APP_NAME}</h1>
        {session ? (
          <Link href="/settings" className="icon-link" aria-label="設定">
            {/* 歯車アイコン。設定系 UI はトップから退避し、この導線に集約する。 */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        ) : null}
      </header>

      {isPending ? (
        <p className="muted">読み込み中…</p>
      ) : session ? (
        <div className="app-shell" data-mobile-pane={roomId ? "chat" : "list"}>
          <div className="roomlist-pane">
            <RoomList
              ref={roomListRef}
              selectedRoomId={roomId}
              onSelect={setRoomId}
            />
          </div>
          <div className="chat-pane">
            {roomId ? (
              // key でルーム切替時に ChatRoom を再マウントし、状態を初期化する。
              <ChatRoom
                key={roomId}
                roomId={roomId}
                currentUserId={session.user.id}
                onBack={() => setRoomId(null)}
                onRead={() => {
                  // 自ルームの未読を 0 に楽観反映し、他ルーム分は再取得で同期する。
                  roomListRef.current?.markRoomReadLocally(roomId);
                  roomListRef.current?.refresh();
                }}
              />
            ) : (
              <p className="muted">
                ルームを選択するか、新しく作成してください。
              </p>
            )}
          </div>
        </div>
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
