import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { APP_NAME, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@repo/shared";
import { Resend } from "resend";
import { createDb, schema } from "./db";

type ResendEmailSender = Pick<Resend["emails"], "send">;

/**
 * 認証に必要な環境バインディング。
 */
export type AuthEnv = {
  DB: D1Database;
  /**
   * 画像添付の実体を保存する R2 バケット（`wrangler.jsonc` の `ATTACHMENTS`）。
   * 型は `@cloudflare/workers-types` の `R2Bucket`（`D1Database` と同様、
   * web 側の tsc からも解決できるパッケージ型を使う）。
   */
  ATTACHMENTS: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

type ResendErrorShape = {
  message?: string;
  name?: string;
  statusCode?: number;
};

class VerificationEmailDeliveryError extends Error {
  constructor() {
    super("Verification email delivery failed");
    this.name = "VerificationEmailDeliveryError";
  }
}

class PasswordResetEmailDeliveryError extends Error {
  constructor() {
    super("Password reset email delivery failed");
    this.name = "PasswordResetEmailDeliveryError";
  }
}

class ChangeEmailConfirmationEmailDeliveryError extends Error {
  constructor() {
    super("Change email confirmation email delivery failed");
    this.name = "ChangeEmailConfirmationEmailDeliveryError";
  }
}

const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function maskEmailAddresses(value: string) {
  return value.replace(emailAddressPattern, "[email]");
}

function normalizeResendError(error: unknown): ResendErrorShape {
  if (error instanceof Error) {
    return { message: maskEmailAddresses(error.message), name: error.name };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message:
        typeof record.message === "string"
          ? maskEmailAddresses(record.message)
          : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      statusCode:
        typeof record.statusCode === "number" ? record.statusCode : undefined,
    };
  }
  return { message: maskEmailAddresses(String(error)) };
}

function emailDomain(email: string) {
  return email.split("@").at(1) ?? "unknown";
}

function isRecipientSuppressionError(error: ResendErrorShape) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.statusCode === 422 &&
    error.name === "validation_error" &&
    (message.includes("suppress") ||
      message.includes("bounce") ||
      message.includes("complaint"))
  );
}

function logEmailFailure(
  logLabel: string,
  to: string,
  error: ResendErrorShape,
) {
  console.error(logLabel, {
    recipientDomain: emailDomain(to),
    error,
  });
}

async function sendAuthEmailWithResend({
  emailSender,
  from,
  to,
  subject,
  text,
  logLabel,
  ErrorCtor,
}: {
  emailSender: ResendEmailSender;
  from: string;
  to: string;
  subject: string;
  text: string;
  /** console.error の第 1 引数。既存テストが文字列マッチしているため明示で渡す。 */
  logLabel: string;
  ErrorCtor: new () => Error;
}) {
  try {
    const { error } = await emailSender.send({ from, to, subject, text });
    if (error) {
      const normalized = normalizeResendError(error);
      logEmailFailure(logLabel, to, normalized);
      if (isRecipientSuppressionError(normalized)) {
        return;
      }
      throw new ErrorCtor();
    }
  } catch (error) {
    if (error instanceof ErrorCtor) {
      throw error;
    }
    const normalized = normalizeResendError(error);
    logEmailFailure(logLabel, to, normalized);
    throw new ErrorCtor();
  }
}

export async function sendVerificationEmailWithResend({
  emailSender,
  from,
  to,
  url,
}: {
  emailSender: ResendEmailSender;
  from: string;
  to: string;
  url: string;
}) {
  await sendAuthEmailWithResend({
    emailSender,
    from,
    to,
    subject: "メールアドレスの確認",
    text: `以下のリンクからメールアドレスを確認してください:\n${url}`,
    logLabel: "Verification email delivery failed",
    ErrorCtor: VerificationEmailDeliveryError,
  });
}

export async function sendPasswordResetEmailWithResend({
  emailSender,
  from,
  to,
  url,
}: {
  emailSender: ResendEmailSender;
  from: string;
  to: string;
  url: string;
}) {
  await sendAuthEmailWithResend({
    emailSender,
    from,
    to,
    subject: "パスワードの再設定",
    text: `以下のリンクからパスワードを再設定してください（リンクは一定時間で失効します）:\n${url}\n\n身に覚えがない場合はこのメールを無視してください。`,
    logLabel: "Password reset email delivery failed",
    ErrorCtor: PasswordResetEmailDeliveryError,
  });
}

export async function sendChangeEmailConfirmationWithResend({
  emailSender,
  from,
  to,
  newEmail,
  url,
}: {
  emailSender: ResendEmailSender;
  from: string;
  /** 承認リンクの送信先。なりすまし防止のため現在のメールアドレスに送る。 */
  to: string;
  /** 変更先の新しいメールアドレス（本文で本人に明示する）。 */
  newEmail: string;
  url: string;
}) {
  await sendAuthEmailWithResend({
    emailSender,
    from,
    to,
    subject: "メールアドレス変更の確認",
    text: `${newEmail} へのメールアドレス変更を承認するには、以下のリンクを開いてください（リンクは一定時間で失効します）:\n${url}\n\n身に覚えがない場合はこのメールを無視してください。`,
    logLabel: "Change email confirmation email delivery failed",
    ErrorCtor: ChangeEmailConfirmationEmailDeliveryError,
  });
}

/**
 * パスキー（WebAuthn）の RP ID / origin を FE オリジン（WEB_URL）から導出する。
 *
 * ブラウザの navigator.credentials が走るのは FE オリジンなので、RP ID は
 * そのホスト名に一致させ、origin は末尾スラッシュを除いた WEB_URL をそのまま使う。
 * 例) ローカル: http://localhost:3000  → rpID "localhost" / origin "http://localhost:3000"（http/localhost も WebAuthn 許容）
 *     本番:   https://chat.tom-chiba.com → rpID "chat.tom-chiba.com" / origin "https://chat.tom-chiba.com"
 */
export function resolveWebAuthnRp(webUrl: string): {
  rpID: string;
  origin: string;
} {
  const origin = webUrl.replace(/\/$/, "");
  return { rpID: new URL(origin).hostname, origin };
}

/**
 * リクエストごとの環境から Better Auth インスタンスを生成する。
 * Workers では D1 バインディングがリクエストスコープのため、都度生成する。
 */
export function createAuth(env: AuthEnv) {
  const db = createDb(env.DB);
  const resend = new Resend(env.RESEND_API_KEY);

  const { rpID, origin: webOrigin } = resolveWebAuthnRp(env.WEB_URL);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_URL],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    plugins: [
      passkey({
        rpID,
        rpName: APP_NAME,
        origin: webOrigin,
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // パスワード強度ポリシー：最低 12 文字、上限は誤入力/DoS 防止のため固定。
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // パスワード再設定リンクを Resend で送る。url は token / callbackURL 込み。
      async sendResetPassword({ user, url }) {
        await sendPasswordResetEmailWithResend({
          emailSender: resend.emails,
          from: env.EMAIL_FROM,
          to: user.email,
          url,
        });
      },
    },
    user: {
      // メールアドレスの変更。ログイン中ユーザーは検証済み（requireEmailVerification）
      // のため、sendChangeEmailConfirmation で現アドレスへ承認リンクを送る二段階フロー
      // になる（承認後、新アドレスへ emailVerification.sendVerificationEmail で検証メール）。
      changeEmail: {
        enabled: true,
        async sendChangeEmailConfirmation({ user, newEmail, url }) {
          await sendChangeEmailConfirmationWithResend({
            emailSender: resend.emails,
            from: env.EMAIL_FROM,
            to: user.email,
            newEmail,
            url,
          });
        },
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      // 検証完了後はそのままログイン状態にする（同一ルートドメインなので Cookie が通る）。
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await sendVerificationEmailWithResend({
          emailSender: resend.emails,
          from: env.EMAIL_FROM,
          to: user.email,
          url,
        });
      },
    },
    // ブルートフォース / スパム抑制。デフォルトは 10 秒 100 req。認証系は 60 秒 5 回に絞る。
    // 注: Workers のメモリは isolate 単位なので完全分散ではないが、同一 isolate 内の濫用は十分抑えられる。
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
        // メールアドレス変更：承認リンク送信の濫用（総当たり・スパム）を抑える。
        "/change-email": { window: 60, max: 5 },
        // パスキー：チャレンジ発行（generate-*-options）と検証（verify-*）の各
        // エンドポイントを総当たり抑制のため絞る。パス名は @better-auth/passkey の
        // 実エンドポイントに一致させる（完全一致でのみマッチするため）。
        "/passkey/generate-authenticate-options": { window: 60, max: 10 },
        "/passkey/verify-authentication": { window: 60, max: 10 },
        "/passkey/generate-register-options": { window: 60, max: 10 },
        "/passkey/verify-registration": { window: 60, max: 10 },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
