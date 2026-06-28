/**
 * ミリ秒エポックをローカルタイムゾーンの `YYYY/MM/DD` に整形する。
 *
 * チャットの日付区切り（同じ暦日のメッセージをまとめる）の判定に使う。
 * 月・日はゼロ埋めし、文字列比較で日付跨ぎを検出できるようにする。
 */
export function formatDay(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}/${month}/${day}`;
}
