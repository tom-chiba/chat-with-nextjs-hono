import type { AppType } from "@repo/api";
import { hc } from "hono/client";

/**
 * 型安全な API クライアント（Hono RPC）。
 * API（Cloudflare Workers）の URL を環境変数で指定する。
 */
export const client = hc<AppType>(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
);

/**
 * ヘルスチェック。戻り値は API 側の定義から型推論される（{ status: "ok" }）。
 */
export async function fetchHealth() {
  const res = await client.health.$get();
  return res.json();
}

/**
 * 現在のセッションユーザーを取得（要 Cookie）。
 * 401 のときと user を返すときの union 型が API から推論される。
 */
export async function fetchMe() {
  const res = await client.me.$get();
  return res.json();
}
