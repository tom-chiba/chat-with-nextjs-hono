import { createAuthClient } from "better-auth/react";

/**
 * フロントエンド用の Better Auth クライアント。
 * API（Cloudflare Workers）の URL を環境変数で指定する。
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
});

export const { signIn, signUp, signOut, useSession } = authClient;
