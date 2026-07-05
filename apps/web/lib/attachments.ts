import type { AllowedImageMimeType, MessageAttachment } from "@repo/shared";
import { ALLOWED_IMAGE_MIME_TYPES, isAllowedImageMimeType } from "@repo/shared";

/** API のベース URL（rpc.ts と同じ環境変数を使う）。 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/**
 * 添付画像の配信 URL。`<img src>` から直接参照する。
 * 別サブドメインだが same-site のためセッション Cookie は自動送信される。
 */
export function attachmentUrl(roomId: string, attachmentId: string): string {
  return `${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * Canvas でブラウザデコード可能かつ webp 化する価値が高い MIME（このどれかだけ変換する）。
 * GIF はアニメーションが 1 フレーム目に潰れるため、WebP は変換不要なため除外する。
 *
 * `satisfies AllowedImageMimeType[]` で、変換対象が必ず allowlist の部分集合になることを
 * コンパイル時に担保する（allowlist から外れた MIME を誤って足すと型エラー）。Set 自体は
 * `Set<string>` とし、任意の `file.type`（string）で `.has` を引けるようにする。
 */
const WEBP_CONVERTIBLE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/avif",
] satisfies AllowedImageMimeType[]);

/** webp へエンコードする際の品質（0-1）。保存効率が目的のため lossy とする。 */
const WEBP_QUALITY = 0.82;

/**
 * ファイル名の拡張子を差し替える（拡張子が無ければ付与する）。末尾の「ドット＋非ドット/
 * 非パス区切り文字列」を拡張子とみなす。変換後 File の命名の単一実装。
 * @param ext 付与する拡張子（先頭ドットなし。例: "webp"）
 */
function replaceExtension(name: string, ext: string): string {
  return `${name.replace(/\.[^./\\]+$/, "")}.${ext}`;
}

/**
 * アップロード前に、変換価値が高くブラウザでデコードできる形式を webp へ変換する。
 *
 * - 対象は JPEG / PNG / BMP / AVIF。GIF（アニメ喪失）と WebP（変換不要）、および
 *   デコードできない形式はそのまま返す。
 * - `createImageBitmap` で EXIF の向きを適用してデコードし、Canvas で webp へ再エンコードする。
 * - サイズ逆転フォールバック: 変換後が元以上（AVIF 等で起こりうる）なら元を採用する。
 * - デコード / エンコードに失敗した場合も元をそのまま返し、アップロードは継続する。
 */
export async function convertToWebpIfBeneficial(file: File): Promise<File> {
  if (!WEBP_CONVERTIBLE_MIME_TYPES.has(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY),
    );
    // toBlob が null（webp エンコード非対応）、または変換で小さくならないなら元を採用。
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], replaceExtension(file.name, "webp"), { type: "image/webp" });
  } catch {
    return file;
  }
}

/**
 * HEIC/HEIF として扱う MIME。allowlist（保存・配信できる形式）には **含めない**（生のまま
 * 保存・配信しないため）。これらは Chrome/Firefox がデコードできないため、必ず webp
 * （不可なら PNG）へ変換してから保存する。
 */
const HEIC_MIME_TYPES = new Set<string>(["image/heic", "image/heif"]);

/**
 * HEIC/HEIF として扱う拡張子（先頭ドットなし・小文字）。判定パターンと accept 属性の
 * 単一情報源。Chrome/Firefox は HEIC の `file.type` を空文字で返すことがあり、MIME だけでは
 * 拾えないため拡張子でも判定する。
 */
const HEIC_EXTENSIONS = ["heic", "heif"] as const;
const HEIC_EXTENSION_PATTERN = new RegExp(`\\.(${HEIC_EXTENSIONS.join("|")})$`, "i");

/**
 * ファイルが HEIC/HEIF か（MIME か拡張子のいずれかで判定）。
 * FE の受け入れ判定（accept 済みでも `file.type` が空になりうる）と、変換経路の分岐で共有する。
 */
export function isHeicLike(file: File): boolean {
  return HEIC_MIME_TYPES.has(file.type) || HEIC_EXTENSION_PATTERN.test(file.name);
}

/**
 * ファイル選択・貼り付け・ドロップで添付として受理する画像かの述語（入力形式の単一情報源）。
 *
 * 保存・配信 allowlist（{@link isAllowedImageMimeType}）に加え、HEIC/HEIF も受理する
 * （アップロード前に必ず webp/PNG へ変換されるため）。accept 属性と受け入れ判定で共有する。
 */
export function isAcceptableInputImage(file: File): boolean {
  return isAllowedImageMimeType(file.type) || isHeicLike(file);
}

/**
 * `<input type=file>` の accept 属性値（`isAcceptableInputImage` と同じ入力形式の集合を表す）。
 * allowlist の MIME に加え、HEIC/HEIF は MIME・拡張子の両方で許可する（Chrome/Firefox 等は
 * `.heic` を MIME で認識せずファイル選択に出ないことがあるため拡張子も要る）。
 */
export const IMAGE_INPUT_ACCEPT = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...HEIC_MIME_TYPES,
  ...HEIC_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

/**
 * HEIC/HEIF を WASM デコーダ（`heic2any`）で PNG へデコードする。デコーダは必要時のみ
 * dynamic import し、メインバンドルへ載せない。デコード不能なバリアント等では例外を投げ、
 * 呼び出し側でアップロード不可として扱う（元の HEIC は Chrome/Firefox で表示できないため
 * フォールバック採用しない）。
 */
async function decodeHeicToPng(file: File): Promise<File> {
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/png" });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  if (!blob) throw new Error("HEIC のデコードに失敗しました");
  return new File([blob], replaceExtension(file.name, "png"), { type: "image/png" });
}

/**
 * アップロード前処理のエントリ。形式に応じて変換経路へ振り分ける。
 *
 * - HEIC/HEIF: WASM で PNG へデコード → 既存の Canvas webp encode へ合流させ webp 化する。
 *   webp 化できない場合（Canvas 非対応・サイズ逆転など）もデコード済みの PNG を返す。
 *   webp・PNG いずれも全ブラウザで表示可能。デコード自体に失敗した場合は例外を投げ、
 *   アップロードさせない（生 HEIC は Chrome/Firefox で表示できずフォールバック採用できないため）。
 * - それ以外: {@link convertToWebpIfBeneficial}（best-effort。失敗しても元を返す）。
 *
 * 戻り値の `changed` は「バイト列が変わったか（＝プレビューを作り直す必要があるか）」。
 * 参照同一性という実装詳細を呼び出し側に漏らさないため、明示的なフラグとして返す。
 */
export async function prepareAttachmentForUpload(
  file: File,
): Promise<{ file: File; changed: boolean }> {
  if (isHeicLike(file)) {
    // HEIC は必ずデコード（別 File）を経るため、バイト列は必ず変わる。
    const decoded = await decodeHeicToPng(file);
    return { file: await convertToWebpIfBeneficial(decoded), changed: true };
  }
  const converted = await convertToWebpIfBeneficial(file);
  return { file: converted, changed: converted !== file };
}

/**
 * 画像を 1 枚アップロードし、作成された添付メタデータを返す。
 * 送信（WebSocket）に先行して呼び、得た id をメッセージの `attachmentIds` に載せる。
 * multipart のため RPC クライアントではなく fetch で直接送る（Cookie は include）。
 */
export async function uploadAttachment(roomId: string, file: File): Promise<MessageAttachment> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 429)
      throw new Error("アップロードが多すぎます。少し待ってから再度お試しください");
    // 413 は 1 ファイルのサイズ超過と累積ストレージ上限の両方で返る。
    if (res.status === 413) throw new Error("画像サイズまたは保存容量の上限に達しました");
    if (res.status === 415) throw new Error("対応していない画像形式です");
    throw new Error("画像のアップロードに失敗しました");
  }
  const data = (await res.json()) as { attachment: MessageAttachment };
  return data.attachment;
}

/**
 * まだ送信していない添付をサーバから削除する（サムネイルの × 削除時）。
 * 送信前の取り消しで R2 実体・DB 行を残さないために呼ぶ。失敗は握りつぶす
 * （最終的にサーバ側の孤児 TTL クリーンアップで回収されるため、UI を止めない）。
 */
export async function deleteAttachment(roomId: string, attachmentId: string): Promise<void> {
  try {
    await fetch(
      `${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE", credentials: "include" },
    );
  } catch {
    // ベストエフォート。
  }
}
