/**
 * セキュリティ・レート制限関連の定数。FE/BE で共有する。
 */

import { z } from "zod";

/** パスワードの最小長。 */
export const MIN_PASSWORD_LENGTH = 12;
/** パスワードの最大長。誤入力 / DoS 防止のため上限を設ける。 */
export const MAX_PASSWORD_LENGTH = 128;

/** WebSocket メッセージ送信のレート制限ウィンドウ（ミリ秒）。 */
export const WS_RATE_LIMIT_WINDOW_MS = 10_000;
/** ウィンドウ内で許可される 1 ユーザーあたりの最大送信件数。 */
export const WS_RATE_LIMIT_MAX = 20;

/**
 * メールアドレスらしさの最小チェック用パターン。
 * 厳密な RFC 検証はせず、「空白を含まない local@domain.tld」程度に留める
 * （存在確認は別途行う前提で、明らかな誤入力を弾く目的）。
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 値が {@link EMAIL_PATTERN} に一致すれば true。FE/BE 双方の入力検証で共有する。 */
export const isEmailLike = (value: string) => EMAIL_PATTERN.test(value);

/**
 * メールアドレス入力（メンバー追加など）の検証スキーマ。
 * 前後空白を除去し、{@link EMAIL_PATTERN} に一致しない値を弾く。出力は trim 済み。
 */
export const emailSchema = z.string().trim().refine(isEmailLike);
