/**
 * セキュリティ・レート制限関連の定数。FE/BE で共有する。
 */

/** パスワードの最小長。 */
export const MIN_PASSWORD_LENGTH = 12;
/** パスワードの最大長。誤入力 / DoS 防止のため上限を設ける。 */
export const MAX_PASSWORD_LENGTH = 128;

/** WebSocket メッセージ送信のレート制限ウィンドウ（ミリ秒）。 */
export const WS_RATE_LIMIT_WINDOW_MS = 10_000;
/** ウィンドウ内で許可される 1 ユーザーあたりの最大送信件数。 */
export const WS_RATE_LIMIT_MAX = 20;
