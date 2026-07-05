import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

/**
 * フロントエンド用の Better Auth クライアント。
 * API（Cloudflare Workers）の URL を環境変数で指定する。
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
  plugins: [passkeyClient()],
});

// authClient は better-auth クライアントの動的パス Proxy（内部で @better-fetch を呼ぶ）で、
// これらのメンバーは実メソッドではなくプロパティアクセスで解決される。過去に
// `authClient.requestPasswordReset.bind(authClient)` としていたが、`.bind` までパス
// セグメントとして横取りされ、モジュール評価時に不正な fetch
// （'[object Promise]' is not a valid HTTP method / 404 /api/auth/fetch-options/method/to-upper-case）
// が走っていた（#146）。分割代入なら get トラップがプロパティを 1 回解決するだけで
// この罠を踏まず、apply トラップは this に依存しないため bind も不要。まとめて再エクスポートする。
export const {
  signIn,
  signUp,
  signOut,
  useSession,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  changeEmail,
} = authClient;
