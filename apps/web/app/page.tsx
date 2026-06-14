"use client";

import { APP_NAME } from "@repo/shared";
import { AuthForm } from "@/components/auth-form";
import { ChatRoom } from "@/components/chat-room";
import { signOut, useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();

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
          <ChatRoom currentUserId={session.user.id} />
        </>
      ) : (
        <AuthForm />
      )}
    </main>
  );
}
