"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { resetPassword } from "@/lib/auth-client";

/**
 * パスワード再設定ページ。
 *
 * メールに記載のリンクから token をクエリで受け取り、新しいパスワードを設定する。
 * useSearchParams は Suspense 境界を要するため、内側を別コンポーネントに切り出す。
 */
export default function ResetPasswordPage() {
  return (
    <main className="page">
      <h1 className="page-title">パスワード再設定</h1>
      <Suspense fallback={<p className="muted">読み込み中…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const errorParam = searchParams.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    errorParam ? "リンクが無効か期限切れです。再度メールから取得してください。" : null,
  );
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <p className="form-error">
          token が見つかりません。メール内のリンクから開き直してください。
        </p>
        <Link href="/">トップへ戻る</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <p className="form-success">パスワードを再設定しました。</p>
        <Link href="/">ログインへ</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("確認用パスワードが一致しません。");
      return;
    }
    setPending(true);
    const result = await resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "再設定に失敗しました");
      return;
    }
    setDone(true);
  };

  return (
    <form onSubmit={submit} className="form-card">
      <input
        type="password"
        placeholder={`新しいパスワード（${MIN_PASSWORD_LENGTH}文字以上）`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={MIN_PASSWORD_LENGTH}
        required
        autoComplete="new-password"
      />
      <input
        type="password"
        placeholder="確認用にもう一度入力"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        minLength={MIN_PASSWORD_LENGTH}
        required
        autoComplete="new-password"
      />
      <button type="submit" disabled={pending}>
        {pending ? "送信中…" : "パスワードを再設定"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
