"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDay } from "@/lib/datetime";
import { type Passkey, addPasskey, deletePasskey, listPasskeys } from "@/lib/passkeys";

const MAX_PASSKEY_NAME_LENGTH = 50;

/**
 * 登録済みパスキー（WebAuthn）の一覧表示・追加・削除を行う設定セクション。
 *
 * パスキーの登録には既存セッションが必要なため、ログイン後の設定画面でのみ表示する。
 * WebAuthn 非対応ブラウザではフォールバックの案内のみ出し、操作 UI は出さない。
 *
 * 一覧は `useListPasskeys` の atom クエリではなく `listPasskeys()` で明示的に取得する。
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
      setPasskeys(await listPasskeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスキーの取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    const isSupported = typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
    setSupported(isSupported);
    if (isSupported) {
      void load();
    }
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addPasskey(name.trim() || undefined);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスキーの登録に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deletePasskey(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "パスキーの削除に失敗しました");
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
                {/* createdAt は型上 Date だが API 応答(JSON)では ISO 文字列で届くため new Date で正規化する。 */}
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
