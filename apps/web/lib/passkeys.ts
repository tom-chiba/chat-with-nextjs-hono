import { authClient } from "./auth-client";

/** パスキー（WebAuthn）1 件分。型は passkey プラグインの推論定義に追従する。 */
export type Passkey = typeof authClient.$Infer.Passkey;

// Better Auth クライアントは失敗を例外ではなく `{ data, error }` で返す。
// 各ラッパーは error.message（あれば）を優先し、無ければ固定の日本語文言で throw する
// （auth-form.tsx のメール認証と同じ様式に揃える）。呼び出し側は try/catch で扱う。

/** 自分の登録済みパスキー一覧を取得する。 */
export async function listPasskeys(): Promise<Passkey[]> {
  const { data, error } = await authClient.passkey.listUserPasskeys();
  if (error) throw new Error(error.message ?? "パスキーの取得に失敗しました");
  return data ?? [];
}

/**
 * 新しいパスキーを登録する（要ログインセッション）。
 * 内部でブラウザの WebAuthn 登録セレモニーを起動する。
 */
export async function addPasskey(name?: string): Promise<void> {
  const { error } = await authClient.passkey.addPasskey(name ? { name } : undefined);
  if (error) throw new Error(error.message ?? "パスキーの登録に失敗しました");
}

/** 登録済みパスキーを 1 件削除する。 */
export async function deletePasskey(id: string): Promise<void> {
  const { error } = await authClient.passkey.deletePasskey({ id });
  if (error) throw new Error(error.message ?? "パスキーの削除に失敗しました");
}
