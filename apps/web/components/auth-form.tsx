"use client";

import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "login" | "signup";

/**
 * 最小のログイン / サインアップフォーム。
 * サインアップ時はメール検証が必要（`requireEmailVerification`）。
 */
export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    if (mode === "signup") {
      // 検証リンクのリダイレクト先（callbackURL）を FE 自身に向ける。
      // 未指定だと API ドメインのルートに飛んで 404 になる。
      const result = await signUp.email({
        email,
        password,
        name,
        callbackURL: window.location.origin,
      });
      setPending(false);
      if (result.error) {
        setError(result.error.message ?? "サインアップに失敗しました");
        return;
      }
      setMessage("確認メールを送信しました。メール内のリンクで認証してからログインしてください。");
      setMode("login");
      return;
    }

    const result = await signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "ログインに失敗しました");
    }
    // 成功時は useSession が更新され、ページ側でチャットに切り替わる。
  };

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 320 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setMode("login")}
          aria-pressed={mode === "login"}
          style={{ fontWeight: mode === "login" ? "bold" : "normal" }}
        >
          ログイン
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          aria-pressed={mode === "signup"}
          style={{ fontWeight: mode === "signup" ? "bold" : "normal" }}
        >
          サインアップ
        </button>
      </div>

      {mode === "signup" && (
        <input
          type="text"
          placeholder="表示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <input
        type="email"
        placeholder="メールアドレス"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="パスワード（8文字以上）"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        required
      />

      <button type="submit" disabled={pending}>
        {pending ? "送信中…" : mode === "login" ? "ログイン" : "登録"}
      </button>

      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
