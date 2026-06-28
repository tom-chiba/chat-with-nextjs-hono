import { expect, test } from "vitest";
import { countGraphemes } from "./text";

test("countGraphemes は絵文字・結合文字を 1 文字として数える", () => {
  expect(countGraphemes("abc")).toBe(3);
  expect(countGraphemes("あいう")).toBe(3);
  // サロゲートペア（String.length は 2）。
  expect("😀".length).toBe(2);
  expect(countGraphemes("😀")).toBe(1);
  // ZWJ 結合絵文字（family。符号点数では複数）。
  expect([..."👨‍👩‍👧"].length).toBeGreaterThan(1);
  expect(countGraphemes("👨‍👩‍👧")).toBe(1);
  // 肌色修飾も 1 文字。
  expect(countGraphemes("👍🏽")).toBe(1);
});

test("countGraphemes は空文字で 0 を返す", () => {
  expect(countGraphemes("")).toBe(0);
});
