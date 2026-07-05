import { describe, expect, test } from "vitest";
import { formatDay } from "@/lib/datetime";

// formatDay はローカルタイムゾーン依存のため、ローカル日時から生成した
// エポックで検証し、実行環境の TZ に依らず安定するようにする。
const localEpoch = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, m - 1, d, hh, mm).getTime();

describe("formatDay", () => {
  test("YYYY/MM/DD でゼロ埋めして返す", () => {
    expect(formatDay(localEpoch(2026, 6, 28))).toBe("2026/06/28");
    expect(formatDay(localEpoch(2026, 1, 5))).toBe("2026/01/05");
  });

  test("同じ暦日は時刻が違っても同じ文字列になる", () => {
    expect(formatDay(localEpoch(2026, 6, 28, 0, 1))).toBe(
      formatDay(localEpoch(2026, 6, 28, 23, 59)),
    );
  });

  test("日付跨ぎ・年跨ぎは異なる文字列になる", () => {
    expect(formatDay(localEpoch(2026, 6, 28, 23, 59))).not.toBe(
      formatDay(localEpoch(2026, 6, 29, 0, 0)),
    );
    expect(formatDay(localEpoch(2025, 12, 31))).toBe("2025/12/31");
    expect(formatDay(localEpoch(2026, 1, 1))).toBe("2026/01/01");
  });
});
