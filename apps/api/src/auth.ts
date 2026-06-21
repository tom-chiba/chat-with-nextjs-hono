import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { Resend } from "resend";
import { createDb, schema } from "./db";

type ResendEmailSender = Pick<Resend["emails"], "send">;

/**
 * 認証に必要な環境バインディング。
 */
export type AuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  WEB_URL: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

type VerificationEmailError = {
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

const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function maskEmailAddresses(value: string) {
  return value.replace(emailAddressPattern, "[email]");
}

function normalizeVerificationEmailError(
  error: unknown,
): VerificationEmailError {
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

function isRecipientSuppressionError(error: VerificationEmailError) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.statusCode === 422 &&
    error.name === "validation_error" &&
    (message.includes("suppress") ||
      message.includes("bounce") ||
      message.includes("complaint"))
  );
}

function logVerificationEmailFailure(to: string, error: VerificationEmailError) {
  console.error("Verification email delivery failed", {
    recipientDomain: emailDomain(to),
    error,
  });
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
  try {
    const { error } = await emailSender.send({
      from,
      to,
      subject: "メールアドレスの確認",
      text: `以下のリンクからメールアドレスを確認してください:\n${url}`,
    });
    if (error) {
      const normalizedError = normalizeVerificationEmailError(error);
      logVerificationEmailFailure(to, normalizedError);
      if (isRecipientSuppressionError(normalizedError)) {
        return;
      }
      throw new VerificationEmailDeliveryError();
    }
  } catch (error) {
    if (error instanceof VerificationEmailDeliveryError) {
      throw error;
    }
    const normalizedError = normalizeVerificationEmailError(error);
    logVerificationEmailFailure(to, normalizedError);
    throw new VerificationEmailDeliveryError();
  }
}

/**
 * リクエストごとの環境から Better Auth インスタンスを生成する。
 * Workers では D1 バインディングがリクエストスコープのため、都度生成する。
 */
export function createAuth(env: AuthEnv) {
  const db = createDb(env.DB);
  const resend = new Resend(env.RESEND_API_KEY);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_URL],
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // パスワード強度ポリシー：最低 12 文字、上限は誤入力/DoS 防止のため固定。
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
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
        "/forget-password": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
  });
}

/** パスワードの最小長（サーバ・クライアントで共有）。 */
export const MIN_PASSWORD_LENGTH = 12;
/** パスワードの最大長。誤入力 / DoS 防止のため上限を設ける。 */
export const MAX_PASSWORD_LENGTH = 128;

export type Auth = ReturnType<typeof createAuth>;
