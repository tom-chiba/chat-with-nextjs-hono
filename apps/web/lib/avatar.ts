/** アバタースタックに並べるメンバーの最大数。超過分は "+N" にまとめる。 */
export const MAX_AVATARS = 3;

/**
 * 表示名の先頭コードポイント（サロゲートペアは割らない）を返す。空文字なら "?"。
 * 分割は Array.from のコードポイント単位のため、ZWJ・地域指標などの書記素クラスタは
 * 境界で割れる（アバターのイニシャル表示という用途では許容する）。
 */
export function initialOf(name: string): string {
  return Array.from(name)[0] ?? "?";
}
