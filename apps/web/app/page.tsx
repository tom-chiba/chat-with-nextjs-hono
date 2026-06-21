"use client";

import { APP_NAME } from "@repo/shared";
import { useRef, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { ChatRoom } from "@/components/chat-room";
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
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>{APP_NAME}</h1>

      {isPending ? (
        <p>読み込み中…</p>
      ) : session ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span>{session.user.name} としてログイン中</span>
            <PushNotificationControl />
            <button type="button" onClick={() => signOut()}>
              ログアウト
            </button>
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <RoomList
              ref={roomListRef}
              selectedRoomId={roomId}
              onSelect={setRoomId}
            />
            {roomId ? (
              // key でルーム切替時に ChatRoom を再マウントし、状態を初期化する。
              <ChatRoom
                key={roomId}
                roomId={roomId}
                currentUserId={session.user.id}
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
        </>
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
