import { expect, test } from "vitest";

// #146 の回帰防止。auth-client は better-auth の動的パス Proxy のメンバーを再エクスポート
// する。かつて `.bind()` を挟んでいたため、これらが「呼び出し可能な関数」ではなく Promise
// （typeof "object"）に化け、モジュール評価時に不正な fetch を誘発していた（機序の詳細は
// lib/auth-client.ts のコメント参照）。実モジュールを評価し、各ヘルパーが関数として解決
// されることを検証する。旧 `.bind` 実装ではこの typeof 検査が "object" を返して落ちる。
test("auth-client の認証系ヘルパーが関数として解決される（#146）", async () => {
  const mod = await import("@/lib/auth-client");

  for (const name of [
    "signIn",
    "signUp",
    "signOut",
    "useSession",
    "requestPasswordReset",
    "resetPassword",
    "sendVerificationEmail",
    "changeEmail",
  ] as const) {
    expect(typeof mod[name]).toBe("function");
  }
});
