"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDay } from "@/lib/datetime";
import { authClient } from "@/lib/auth-client";

const MAX_PASSKEY_NAME_LENGTH = 50;

type Passkey = {
  id: string;
  name?: string | null;
  createdAt: string;
};

/**
 * 登録済みパスキー（WebAuthn）の一覧表示・追加・削除を行う設定セクション。
 *
 * パスキーの登録には既存セッションが必要なため、ログイン後の設定画面でのみ表示する。
 * WebAuthn 非対応ブラウザではフォールバックの案内のみ出し、操作 UI は出さない。
 *
 * 一覧は `useListPasskeys` の atom クエリではなく `$fetch` で明示的に取得する。
 * atom クエリはセッション変化直後に保留状態へ張り付くことがあり、追加・削除後の
 * 再取得もこちらで明示的に行う方が挙動が安定するため。
 */
export function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: fetchError } = await authClient.$fetch<Passkey[]>(
        "/passkey/list-user-passkeys",
        { method: "GET" },
      );
      if (fetchError) {
        setError("パスキーの取得に失敗しました");
        return;
      }
      setPasskeys(data ?? []);
    } catch {
      setError("パスキーの取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
    setSupported(isSupported);
    if (isSupported) {
      void load();
    }
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    const result = await authClient.passkey.addPasskey(
      trimmed.length > 0 ? { name: trimmed } : undefined,
    );
    setBusy(false);
    if (result?.error) {
      setError(result.error.message ?? "パスキーの登録に失敗しました");
      return;
    }
    setName("");
    await load();
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const { error: fetchError } = await authClient.$fetch(
        "/passkey/delete-passkey",
        { method: "POST", body: { id } },
      );
      if (fetchError) {
        setError("パスキーの削除に失敗しました");
        return;
      }
      await load();
    } catch {
      setError("パスキーの削除に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <section className="passkey-manager">
        <h2 className="passkey-manager-title">パスキー</h2>
        <p className="muted">このブラウザはパスキーに対応していません。</p>
      </section>
    );
  }

  return (
    <section className="passkey-manager">
      <h2 className="passkey-manager-title">パスキー</h2>

      {passkeys === null ? (
        <p className="muted">読み込み中…</p>
      ) : passkeys.length > 0 ? (
        <ul className="passkey-list">
          {passkeys.map((p) => (
            <li key={p.id} className="passkey-item">
              <span className="passkey-name">{p.name || "名称未設定"}</span>
              <span className="muted">
                {formatDay(new Date(p.createdAt).getTime())}
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={busy}
                className="btn-quiet"
                aria-label="このパスキーを削除"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">登録済みのパスキーはありません。</p>
      )}

      <form onSubmit={add} className="passkey-add">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_PASSKEY_NAME_LENGTH}
          placeholder="パスキー名（任意）"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          {busy ? "処理中…" : "パスキーを追加"}
        </button>
      </form>

      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
