"use client";

import { APP_NAME } from "@repo/shared";
import { useRef, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { ChatRoom } from "@/components/chat-room";
import { ProfileForm } from "@/components/profile-form";
import { PushNotificationControl } from "@/components/push-notification-control";
import { RoomList, type RoomListHandle } from "@/components/room-list";
import { signOut, useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();
  const [roomId, setRoomId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("room");
  });
  const roomListRef = useRef<RoomListHandle>(null);

  return (
    <main style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{APP_NAME}</h1>

      {isPending ? (
        <p>読み込み中…</p>
      ) : session ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: "0.875rem" }}>
              {session.user.name} としてログイン中
            </span>
            <ProfileForm currentName={session.user.name} />
            <PushNotificationControl />
            <button type="button" onClick={() => signOut()}>
              ログアウト
            </button>
          </div>
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
                <p style={{ color: "#999" }}>
                  ルームを選択するか、新しく作成してください。
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
