/**
 * API（Cloudflare Workers）のベース URL（http/https）。
 * 環境変数で指定し、未設定時は開発用ローカルへフォールバックする。
 * テストで環境変数を差し替えて検証できるよう、呼び出しの都度評価する。
 */
export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
}

/** API のベース URL（http/https）を WebSocket 用（ws/wss）に変換し、path を連結する。 */
export function apiWebSocketUrl(path: string): string {
  return `${apiBaseUrl().replace(/^http/, "ws")}${path}`;
}
