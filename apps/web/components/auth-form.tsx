"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/shared";
import { useState } from "react";
import {
  requestPasswordReset,
  signIn,
  signUp,
} from "@/lib/auth-client";

type Mode = "login" | "signup" | "forgot";

/**
 * 最小のログイン / サインアップフォーム。
 * サインアップ時はメール検証が必要（`requireEmailVerification`）。
 * パスワードを忘れた場合は forgot モードでリセットメールを発行する。
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

    if (mode === "forgot") {
      // パスワードリセットのトークン付き URL は API 側で発行され、redirectTo に飛ばされる。
      const result = await requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setPending(false);
      if (result.error) {
        setError(result.error.message ?? "メール送信に失敗しました");
        return;
      }
      setMessage(
        "パスワード再設定用のメールを送信しました。メール内のリンクから再設定してください。",
      );
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
      {mode !== "forgot" && (
        <input
          type="password"
          placeholder={`パスワード（${MIN_PASSWORD_LENGTH}文字以上）`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      )}

      <button type="submit" disabled={pending}>
        {pending
          ? "送信中…"
          : mode === "login"
            ? "ログイン"
            : mode === "signup"
              ? "登録"
              : "再設定メールを送る"}
      </button>

      {mode === "login" ? (
        <button
          type="button"
          onClick={() => {
            setMode("forgot");
            setError(null);
            setMessage(null);
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "#1e6fdf",
            textDecoration: "underline",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            justifySelf: "start",
          }}
        >
          パスワードを忘れた方
        </button>
      ) : mode === "forgot" ? (
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
            setMessage(null);
          }}
          style={{
            background: "transparent",
            border: "none",
            color: "#1e6fdf",
            textDecoration: "underline",
            cursor: "pointer",
            fontSize: 12,
            padding: 0,
            justifySelf: "start",
          }}
        >
          ログインに戻る
        </button>
      ) : null}

      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
