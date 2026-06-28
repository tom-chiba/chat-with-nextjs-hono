import { describe, expect, test } from "vitest";
import manifest from "@/app/manifest";

// Web App Manifest がインストール可能性に必要な要素を満たすことを確認する。
describe("manifest", () => {
  const m = manifest();

  test("standalone 表示・start_url・テーマ色を持つ", () => {
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.theme_color).toBe("#2f4fd6");
    expect(m.name).toBeTruthy();
  });

  test("192px と 512px のアイコンと maskable を含む", () => {
    const sizes = m.icons?.map((i) => i.sizes) ?? [];
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
