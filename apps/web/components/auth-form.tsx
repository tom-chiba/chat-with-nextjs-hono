"use client";

import { MIN_PASSWORD_LENGTH } from "@repo/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  requestPasswordReset,
  sendVerificationEmail,
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
  // メール未検証で確認が必要な状態のとき、対象アドレスを保持する。
  // セットされている間は検証待ちの案内と「確認メールを再送」を表示する。
  const [verifyEmail, setVerifyEmail] = useState<string | null>(null);
  // WebAuthn 非対応ブラウザではパスキー UI を出さず、メール+パスワードのみにフォールバックする。
  const [passkeySupported, setPasskeySupported] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setPasskeySupported(
      typeof window !== "undefined" && Boolean(window.PublicKeyCredential),
    );
  }, []);

  const signInWithPasskey = async () => {
    setPending(true);
    setMessage(null);
    setError(null);
    const result = await signIn.passkey();
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "パスキーでのログインに失敗しました");
    }
    // 成功時は useSession が更新され、ページ側でチャットに切り替わる。
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);
    setVerifyEmail(null);

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
      // 検証待ちの案内を表示し、認証後に使うログインタブへ切り替える。
      setVerifyEmail(email);
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
      // メール未検証は code "EMAIL_NOT_VERIFIED"（HTTP 403）で返る。汎用エラーに
      // せず、検証が必要な旨と再送導線を出す（サーバ側は sendOnSignIn で再送もされる）。
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        setVerifyEmail(email);
        return;
      }
      setError(result.error.message ?? "ログインに失敗しました");
    }
    // 成功時は useSession が更新され、ページ側でチャットに切り替わる。
  };

  const resendVerification = async () => {
    if (!verifyEmail) return;
    setPending(true);
    setMessage(null);
    setError(null);
    const result = await sendVerificationEmail({
      email: verifyEmail,
      callbackURL: window.location.origin,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "確認メールの再送に失敗しました");
      return;
    }
    setMessage("確認メールを再送しました。受信箱をご確認ください。");
  };

  // タブ/導線でモードを切り替える際は、前モードの一時的なフィードバック
  // （検証案内・成功/失敗メッセージ）を持ち越さない。
  const changeMode = (next: Mode) => {
    setMode(next);
    setMessage(null);
    setError(null);
    setVerifyEmail(null);
  };

  return (
    <form onSubmit={submit} className="form-card">
      <div className="auth-tabs">
        <button
          type="button"
          onClick={() => changeMode("login")}
          aria-pressed={mode === "login"}
          className={`tab${mode === "login" ? " is-active" : ""}`}
        >
          ログイン
        </button>
        <button
          type="button"
          onClick={() => changeMode("signup")}
          aria-pressed={mode === "signup"}
          className={`tab${mode === "signup" ? " is-active" : ""}`}
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

      {mode === "login" && passkeySupported && (
        <button
          type="button"
          onClick={signInWithPasskey}
          disabled={pending}
          className="btn-quiet"
        >
          パスキーでログイン
        </button>
      )}

      {mode === "login" ? (
        <button
          type="button"
          onClick={() => changeMode("forgot")}
          className="btn-link"
        >
          パスワードを忘れた方
        </button>
      ) : mode === "forgot" ? (
        <button
          type="button"
          onClick={() => changeMode("login")}
          className="btn-link"
        >
          ログインに戻る
        </button>
      ) : null}

      {/* アカウント登録なしでチャットを試せるゲストデモへの入り口（デザイン 1a）。
          ログイン導線を主にしつつ、その下に控えめなサブボタンとして置く。 */}
      {mode === "login" && (
        <>
          <div className="auth-or">または</div>
          <button
            type="button"
            onClick={() => router.push("/demo")}
            className="btn-outline"
          >
            デモを試す
          </button>
        </>
      )}

      {verifyEmail && (
        <div className="verify-notice" role="status">
          <p className="verify-notice-title">メールアドレスの確認が必要です</p>
          <p>
            <strong>{verifyEmail}</strong>{" "}
            宛に確認メールを送信しました。メール内のリンクを開いて認証を完了してから、ログインしてください。
          </p>
          <p className="verify-notice-hint">
            メールが届かない場合は、迷惑メールフォルダもご確認ください。
          </p>
          <button
            type="button"
            onClick={resendVerification}
            disabled={pending}
            className="btn-quiet"
          >
            確認メールを再送する
          </button>
        </div>
      )}

      {message && <p className="form-success">{message}</p>}
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
