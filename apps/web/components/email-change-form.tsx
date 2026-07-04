"use client";

import { useState } from "react";
import { changeEmail } from "@/lib/auth-client";

/**
 * 自分のメールアドレスを変更する小さいフォーム。
 *
 * 「メールアドレスを変更」ボタンで入力欄に切り替わり、保存で Better Auth の
 * `changeEmail` を叩く。ログイン中ユーザーは検証済みのため、まず現アドレスへ
 * 承認メールが届き（本人確認）、承認後に新アドレスへ確認メールが届く二段階フロー。
 * そのためこの時点ではまだアドレスは変わらず、確認メール送信の案内だけを出す。
 */
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const cancel = () => {
    setDraft("");
    setEditing(false);
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const newEmail = draft.trim();
    if (newEmail.length === 0) return;
    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    // 承認リンクのリダイレクト先（callbackURL）を FE 自身に向ける。
    // 未指定だと API ドメインのルートに飛んで 404 になる。
    const result = await changeEmail({
      newEmail,
      callbackURL: window.location.origin,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error.message ?? "メールアドレスの変更に失敗しました");
      return;
    }
    setEditing(false);
    setDraft("");
    setSent(true);
  };

  if (!editing) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setDraft("");
            setEditing(true);
          }}
          className="btn-quiet"
          aria-label="メールアドレスを編集"
        >
          メールアドレスを変更
        </button>
        {sent && (
          <span className="action-notice" role="status">
            確認のため、現在のメールアドレス（{currentEmail}
            ）に承認メールを送信しました。メール内のリンクを開くと、新しいアドレス宛に確認メールが届きます。
          </span>
        )}
      </>
    );
  }

  return (
    <form onSubmit={save} className="profile-form">
      <input
        type="email"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        required
        disabled={saving}
        placeholder="新しいメールアドレス"
      />
      <button type="submit" disabled={saving || draft.trim().length === 0}>
        {saving ? "送信中…" : "確認メールを送る"}
      </button>
      <button type="button" onClick={cancel} disabled={saving}>
        キャンセル
      </button>
      {error && <span className="action-error">{error}</span>}
    </form>
  );
}
