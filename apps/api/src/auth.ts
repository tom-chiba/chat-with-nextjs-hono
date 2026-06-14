import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { D1Database } from "@cloudflare/workers-types";
import { Resend } from "resend";
import { createDb, schema } from "./db";

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
        const { error } = await resend.emails.send({
          from: env.EMAIL_FROM,
          to: user.email,
          subject: "メールアドレスの確認",
          text: `以下のリンクからメールアドレスを確認してください:\n${url}`,
        });
        // Resend は API エラー時も throw せず { error } を返すため、明示的に失敗させる。
        if (error) {
          throw new Error(`検証メールの送信に失敗しました: ${error.message}`);
        }
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
