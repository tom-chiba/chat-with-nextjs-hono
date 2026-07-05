import { describe, expect, test } from "vitest";
import { type MentionMember, resolveMentions } from "../src/mentions";

const members: MentionMember[] = [
  { userId: "u-chiba", userName: "千葉" },
  { userId: "u-chiba-san", userName: "千葉さん" },
  { userId: "u-bob", userName: "Bob" },
];

describe("resolveMentions", () => {
  test("最長一致で表示名を解決する（千葉さん を 千葉 より優先）", () => {
    expect(resolveMentions(["千葉さん"], members)).toEqual(new Set(["u-chiba-san"]));
  });

  test("短い名前は短い名前にマッチする", () => {
    expect(resolveMentions(["千葉"], members)).toEqual(new Set(["u-chiba"]));
  });

  test("前方一致で解決する（候補がメンバー名で始まれば採用）", () => {
    expect(resolveMentions(["千葉さんへ"], members)).toEqual(new Set(["u-chiba-san"]));
  });

  test("複数候補をまとめて解決する", () => {
    expect(resolveMentions(["Bob", "千葉さん"], members)).toEqual(
      new Set(["u-bob", "u-chiba-san"]),
    );
  });

  test("一致しない候補は無視する", () => {
    expect(resolveMentions(["unknown"], members)).toEqual(new Set());
  });

  test("候補が空なら空集合を返す", () => {
    expect(resolveMentions([], members)).toEqual(new Set());
  });

  test("同名は最初の 1 件のみ採用する", () => {
    const dup: MentionMember[] = [
      { userId: "first", userName: "同名" },
      { userId: "second", userName: "同名" },
    ];
    expect(resolveMentions(["同名"], dup)).toEqual(new Set(["first"]));
  });
});
