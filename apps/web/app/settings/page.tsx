"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EmailChangeForm } from "@/components/email-change-form";
import { PasskeyManager } from "@/components/passkey-manager";
import { ProfileForm } from "@/components/profile-form";
import { PushNotificationControl } from "@/components/push-notification-control";
import { signOut, useSession } from "@/lib/auth-client";

/**
 * 設定ページ。
 *
 * トップページの軽快さを保つため、チャット閲覧に必須でない設定系 UI
 * （表示名・メール・通知・パスキー・ログアウト）はこのページに集約する。
 * ログインが前提のため、未ログイン時はトップへ送り返す。
 */
export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) router.replace("/");
  }, [isPending, session, router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  if (isPending) {
    return (
      <main className="page">
        <p className="muted">読み込み中…</p>
      </main>
    );
  }

  // リダイレクト確定までの一瞬、設定 UI を描画しないためのガード。
  if (!session) return null;

  return (
    <main className="page">
      <div className="util-row">
        <Link href="/" className="btn-link">
          ← トップへ戻る
        </Link>
      </div>
      <h1 className="page-title">設定</h1>

      <div className="util-row">
        <span>{session.user.name} としてログイン中</span>
        <ProfileForm currentName={session.user.name} />
        <EmailChangeForm currentEmail={session.user.email} />
        <PushNotificationControl />
        <button type="button" onClick={handleSignOut}>
          ログアウト
        </button>
      </div>
      <PasskeyManager />
    </main>
  );
}
