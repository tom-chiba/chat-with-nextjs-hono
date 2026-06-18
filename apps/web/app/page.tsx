"use client";

import { APP_NAME } from "@repo/shared";
import { useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { ChatRoom } from "@/components/chat-room";
import { RoomList } from "@/components/room-list";
import { signOut, useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();
  const [roomId, setRoomId] = useState<string | null>(null);

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>{APP_NAME}</h1>

      {isPending ? (
        <p>読み込み中…</p>
      ) : session ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span>{session.user.name} としてログイン中</span>
            <button type="button" onClick={() => signOut()}>
              ログアウト
            </button>
          </div>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <RoomList selectedRoomId={roomId} onSelect={setRoomId} />
            {roomId ? (
              // key でルーム切替時に ChatRoom を再マウントし、状態を初期化する。
              <ChatRoom
                key={roomId}
                roomId={roomId}
                currentUserId={session.user.id}
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
