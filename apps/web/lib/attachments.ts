import type { AllowedImageMimeType, MessageAttachment } from "@repo/shared";

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
    const name = `${file.name.replace(/\.[^./\\]+$/, "")}.webp`;
    return new File([blob], name, { type: "image/webp" });
  } catch {
    return file;
  }
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
