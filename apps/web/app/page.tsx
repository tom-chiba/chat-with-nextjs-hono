"use client";

import { APP_NAME } from "@repo/shared";
import Link from "next/link";
import { lazy, Suspense, useRef, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import type { RoomListHandle } from "@/components/room-list";
import { useSession } from "@/lib/auth-client";

// 認証後にしか描画しないチャット系コンポーネントは別チャンクへ分割し、
// 未認証（AuthForm 表示）時の初期 JS 転送量を抑える。これらは session 確定後
// （クライアント）にしか描画されないため SSR されず、遅延読み込みで問題ない。
// next/dynamic ではなく React.lazy を使うのは、RoomList が ref 経由の命令的
// ハンドル（refresh / markRoomReadLocally）を公開しており、next/dynamic の
// ラッパは ref を内部コンポーネントへ転送しない（React.lazy は転送する）ため。
const ChatRoom = lazy(() =>
  import("@/components/chat-room").then((m) => ({ default: m.ChatRoom })),
);
const RoomList = lazy(() =>
  import("@/components/room-list").then((m) => ({ default: m.RoomList })),
);

export default function Home() {
  const { data: session, isPending } = useSession();
  const [roomId, setRoomId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });
  const [roomName, setRoomName] = useState<string | null>(null);
  // モバイルのルーム一覧ドロワーの開閉。デスクトップでは常設サイドバーのため無視される。
  const [roomsDrawerOpen, setRoomsDrawerOpen] = useState(false);
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
        <div className="app-shell" data-drawer={roomsDrawerOpen ? "open" : "closed"}>
          {/* モバイルのドロワー背面。開いている間だけ描画し、クリックで閉じる。 */}
          {roomsDrawerOpen && (
            <button
              type="button"
              className="drawer-backdrop mobile-only"
              aria-label="ルーム一覧を閉じる"
              onClick={() => setRoomsDrawerOpen(false)}
            />
          )}
          <div className="roomlist-pane">
            {/* 遅延読み込み中の一瞬を埋める。ペインごとに境界を分け、ルーム選択で
                ChatRoom を読み込む間もルーム一覧が消えないようにする。 */}
            <Suspense fallback={<p className="muted">読み込み中…</p>}>
              <RoomList
                ref={roomListRef}
                selectedRoomId={roomId}
                onSelect={(id) => {
                  setRoomId(id);
                  // 選択したらドロワーを閉じ、チャット全画面へ戻す（モバイル）。
                  setRoomsDrawerOpen(false);
                }}
                onSelectedNameChange={setRoomName}
              />
            </Suspense>
          </div>
          <div className="chat-pane">
            {roomId ? (
              // key でルーム切替時に ChatRoom を再マウントし、状態を初期化する。
              <Suspense fallback={<p className="muted">読み込み中…</p>}>
                <ChatRoom
                  key={roomId}
                  roomId={roomId}
                  roomName={roomName}
                  currentUserId={session.user.id}
                  onOpenRooms={() => setRoomsDrawerOpen(true)}
                  onRead={() => {
                    // 自ルームの未読を 0 に楽観反映し、他ルーム分は再取得で同期する。
                    roomListRef.current?.markRoomReadLocally(roomId);
                    roomListRef.current?.refresh();
                  }}
                />
              </Suspense>
            ) : (
              <div className="chat-empty">
                <p className="muted">ルームを選択するか、新しく作成してください。</p>
                <button
                  type="button"
                  className="mobile-only"
                  onClick={() => setRoomsDrawerOpen(true)}
                >
                  ルーム一覧を開く
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
