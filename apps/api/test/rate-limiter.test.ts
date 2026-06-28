import { describe, expect, test } from "vitest";
import { RateLimiter } from "../src/rate-limiter";

describe("RateLimiter", () => {
  test("ウィンドウ内は上限まで許可し、超過を拒否する", () => {
    const limiter = new RateLimiter(1000, 3);
    expect(limiter.allow("u", 0)).toBe(true);
    expect(limiter.allow("u", 1)).toBe(true);
    expect(limiter.allow("u", 2)).toBe(true);
    // 4 件目はウィンドウ内なので拒否。
    expect(limiter.allow("u", 3)).toBe(false);
  });

  test("ウィンドウ経過後は古い記録が間引かれ再び許可される", () => {
    const limiter = new RateLimiter(1000, 2);
    expect(limiter.allow("u", 0)).toBe(true);
    expect(limiter.allow("u", 500)).toBe(true);
    expect(limiter.allow("u", 900)).toBe(false);
    // now=1001 では t=0 がウィンドウ外（cutoff=1）になり 1 枠空く。
    expect(limiter.allow("u", 1001)).toBe(true);
  });

  test("ユーザーごとに独立してカウントする", () => {
    const limiter = new RateLimiter(1000, 1);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 1)).toBe(false);
    // 別ユーザーは影響を受けない。
    expect(limiter.allow("b", 1)).toBe(true);
  });

  test("既定値（@repo/shared の WS_RATE_LIMIT_*）で生成できる", () => {
    const limiter = new RateLimiter();
    expect(limiter.allow("u", 0)).toBe(true);
  });
});
