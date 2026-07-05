import { beforeEach, describe, expect, test, vi } from "vitest";
import heic2any from "heic2any";
import {
  convertToWebpIfBeneficial,
  isAcceptableInputImage,
  isHeicLike,
  prepareAttachmentForUpload,
} from "@/lib/attachments";

// WASM デコーダは重く（1.3MB）DOM に依存するため、実体を読み込まずモックする。
vi.mock("heic2any", () => ({ default: vi.fn() }));
const mockHeic2any = vi.mocked(heic2any);

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

/**
 * HEIC/HEIF 判定。Chrome/Firefox は `.heic` の `file.type` を空文字にすることがあるため、
 * MIME だけでなく拡張子でも拾えることを検証する。
 */
describe("isHeicLike", () => {
  test("MIME image/heic を HEIC と判定する", () => {
    expect(isHeicLike(new File([], "x", { type: "image/heic" }))).toBe(true);
  });

  test("MIME image/heif を HEIC と判定する", () => {
    expect(isHeicLike(new File([], "x", { type: "image/heif" }))).toBe(true);
  });

  test("MIME が空でも拡張子 .heic で判定する（大文字も許容）", () => {
    expect(isHeicLike(new File([], "photo.HEIC", { type: "" }))).toBe(true);
  });

  test("拡張子 .heif で判定する", () => {
    expect(isHeicLike(new File([], "photo.heif", { type: "" }))).toBe(true);
  });

  test("JPEG は HEIC ではない", () => {
    expect(isHeicLike(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  test("PNG は HEIC ではない", () => {
    expect(isHeicLike(new File([], "a.png", { type: "image/png" }))).toBe(false);
  });
});

/**
 * 入力受理判定。保存・配信 allowlist の形式に加え、HEIC/HEIF（変換前提）も受理する。
 */
describe("isAcceptableInputImage", () => {
  test("allowlist の MIME（JPEG）を受理する", () => {
    expect(isAcceptableInputImage(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(true);
  });

  test("HEIC を受理する（allowlist 外だが変換前提で入力可）", () => {
    expect(isAcceptableInputImage(new File([], "a.heic", { type: "image/heic" }))).toBe(true);
  });

  test("MIME が空でも拡張子 .heic なら受理する", () => {
    expect(isAcceptableInputImage(new File([], "a.heic", { type: "" }))).toBe(true);
  });

  test("非画像は受理しない", () => {
    expect(isAcceptableInputImage(new File([], "a.txt", { type: "text/plain" }))).toBe(false);
  });
});

/**
 * アップロード前処理の振り分け。HEIC は WASM デコード（heic2any をモック）を通り、
 * デコード失敗は例外として伝播する（アップロード不可）。非 HEIC はデコーダを呼ばない。
 * webp エンコード自体は jsdom に Canvas が無いため、ここでは検証対象外。
 */
describe("prepareAttachmentForUpload", () => {
  beforeEach(() => {
    mockHeic2any.mockReset();
  });

  test("HEIC は heic2any でデコードし webp 変換経路へ渡す（changed=true）", async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    mockHeic2any.mockResolvedValue(png);
    const heic = new File([new Uint8Array([0, 0, 0])], "photo.heic", { type: "image/heic" });

    const result = await prepareAttachmentForUpload(heic);

    expect(mockHeic2any).toHaveBeenCalledOnce();
    // jsdom には createImageBitmap が無いため webp 化はフォールバックし、デコード済み PNG が返る。
    expect(result.file.type).toBe("image/png");
    expect(result.file.name).toBe("photo.png");
    expect(result.changed).toBe(true);
  });

  test("heic2any が配列で返す場合は先頭 Blob を採用する", async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    mockHeic2any.mockResolvedValue([png]);
    const heic = new File([new Uint8Array([0, 0, 0])], "photo.heic", { type: "image/heic" });

    const result = await prepareAttachmentForUpload(heic);

    expect(mockHeic2any).toHaveBeenCalledOnce();
    expect(result.file.name).toBe("photo.png");
  });

  test("HEIC デコード失敗はアップロード不可として例外を投げる", async () => {
    mockHeic2any.mockRejectedValue(new Error("unsupported"));
    const heic = new File([new Uint8Array([0])], "photo.heic", { type: "image/heic" });

    await expect(prepareAttachmentForUpload(heic)).rejects.toThrow();
  });

  test("デコード結果が空（画像なし）ならアップロード不可として例外を投げる", async () => {
    mockHeic2any.mockResolvedValue([]);
    const heic = new File([new Uint8Array([0])], "photo.heic", { type: "image/heic" });

    await expect(prepareAttachmentForUpload(heic)).rejects.toThrow();
  });

  test("HEIC 以外は heic2any を使わず元ファイルを返す（jsdom ではフォールバック・changed=false）", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8])], "a.jpg", { type: "image/jpeg" });

    const result = await prepareAttachmentForUpload(jpeg);

    expect(mockHeic2any).not.toHaveBeenCalled();
    expect(result.file).toBe(jpeg);
    expect(result.changed).toBe(false);
  });
});
