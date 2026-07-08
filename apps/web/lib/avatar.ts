/** アバタースタックに並べるメンバーの最大数。超過分は "+N" にまとめる。 */
export const MAX_AVATARS = 3;

/** 表示名の先頭 1 文字（サロゲートペア・結合文字を割らない）を返す。 */
export function initialOf(name: string): string {
  return Array.from(name)[0] ?? "?";
}
