import { describe, expect, test } from "vitest";
import { convertToWebpIfBeneficial } from "@/lib/attachments";

/**
 * `convertToWebpIfBeneficial` のガードとフォールバックを検証する。
 *
 * 実際の webp エンコード（`createImageBitmap` + Canvas `toBlob`）は jsdom に無いため
 * ここでは検証できない（実ブラウザで別途確認する）。本テストは Canvas に触れない
 * 分岐のみを対象とする:
 * - 変換対象外（GIF / WebP / 非画像）はそのまま返す。
 * - 変換対象でもデコードできない環境（jsdom には createImageBitmap が無い）では、
 *   例外を握りつぶして元ファイルを返し、アップロードを止めない。
 */
describe("convertToWebpIfBeneficial", () => {
  test("GIF は変換せず同一 File を返す（アニメーション保持）", async () => {
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
    expect(await convertToWebpIfBeneficial(gif)).toBe(gif);
  });

  test("WebP は変換不要でそのまま返す", async () => {
    const webp = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], "b.webp", {
      type: "image/webp",
    });
    expect(await convertToWebpIfBeneficial(webp)).toBe(webp);
  });

  test("非画像 MIME はそのまま返す", async () => {
    const txt = new File(["hello"], "c.txt", { type: "text/plain" });
    expect(await convertToWebpIfBeneficial(txt)).toBe(txt);
  });

  test("デコードできない場合は元ファイルを返す（例外を伝播しない）", async () => {
    // jsdom には createImageBitmap が無いため、変換対象でもデコードに失敗する。
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "d.png", {
      type: "image/png",
    });
    expect(await convertToWebpIfBeneficial(png)).toBe(png);
  });
});
