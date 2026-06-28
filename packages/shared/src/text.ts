/**
 * 文字列ユーティリティ。FE / BE（Worker・Durable Object）で共有する。
 */

/**
 * 文字列の長さを「書記素クラスタ数」で数える。
 *
 * `String.prototype.length`（UTF-16 コードユニット数）はサロゲートペア（絵文字など）を
 * 2 と数え、`[...str].length`（符号点数）も ZWJ 結合絵文字（👨‍👩‍👧 など）を複数と数えるため、
 * いずれも「体感の文字数」と乖離する。`Intl.Segmenter` の grapheme 単位で数えることで
 * 結合絵文字や肌色修飾も 1 文字として扱い、入力欄の見た目と一致させる。
 *
 * grapheme 分割は locale 非依存のため locale は指定しない。`Intl.Segmenter` の生成は
 * コストがあるため、呼び出しごとではなくモジュールスコープで 1 度だけ生成して使い回す。
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function countGraphemes(str: string): number {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(str)) count++;
  return count;
}
