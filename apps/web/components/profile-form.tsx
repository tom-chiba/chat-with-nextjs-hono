"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

const MAX_NAME_LENGTH = 50;

/**
 * 自分の表示名を編集する小さいフォーム。
 *
 * 「編集」ボタンを押すと入力欄に切り替わり、保存で Better Auth の
 * `updateUser` を叩く。成功すれば `useSession()` 側がリフレッシュされる。
 */
export function ProfileForm({ currentName }: { currentName: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setDraft(currentName);
    setEditing(false);
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (name.length === 0 || name === currentName) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await authClient.updateUser({ name });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(currentName);
          setEditing(true);
        }}
        style={{ fontSize: "0.75rem" }}
        aria-label="表示名を編集"
      >
        表示名を変更
      </button>
    );
  }

  return (
    <form
      onSubmit={save}
      style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
    >
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={MAX_NAME_LENGTH}
        autoFocus
        disabled={saving}
        placeholder="新しい表示名"
      />
      <button type="submit" disabled={saving || draft.trim().length === 0}>
        {saving ? "保存中…" : "保存"}
      </button>
      <button type="button" onClick={cancel} disabled={saving}>
        キャンセル
      </button>
      {error && (
        <span style={{ color: "#c00", fontSize: 12 }}>{error}</span>
      )}
    </form>
  );
}
