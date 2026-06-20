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
};

type VerificationEmailError = {
  message?: string;
  name?: string;
  statusCode?: number;
};

function normalizeVerificationEmailError(
  error: unknown,
): VerificationEmailError {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message:
        typeof record.message === "string" ? record.message : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
      statusCode:
        typeof record.statusCode === "number" ? record.statusCode : undefined,
    };
  }
  return { message: String(error) };
}

function emailDomain(email: string) {
  return email.split("@").at(1) ?? "unknown";
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
      console.error("Verification email delivery failed", {
        recipientDomain: emailDomain(to),
        error: normalizeVerificationEmailError(error),
      });
      return;
    }
  } catch (error) {
    console.error("Verification email delivery failed", {
      recipientDomain: emailDomain(to),
      error: normalizeVerificationEmailError(error),
    });
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
    },
    emailVerification: {
      sendOnSignUp: true,
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
  });
}

export type Auth = ReturnType<typeof createAuth>;
