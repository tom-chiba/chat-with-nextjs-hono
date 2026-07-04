import type { MessageAttachment } from "@repo/shared";

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
 * 画像を 1 枚アップロードし、作成された添付メタデータを返す。
 * 送信（WebSocket）に先行して呼び、得た id をメッセージの `attachmentIds` に載せる。
 * multipart のため RPC クライアントではなく fetch で直接送る（Cookie は include）。
 */
export async function uploadAttachment(
  roomId: string,
  file: File,
): Promise<MessageAttachment> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(
    `${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments`,
    { method: "POST", body: form, credentials: "include" },
  );
  if (!res.ok) {
    if (res.status === 413) throw new Error("画像サイズが大きすぎます");
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
export async function deleteAttachment(
  roomId: string,
  attachmentId: string,
): Promise<void> {
  try {
    await fetch(
      `${API_BASE}/rooms/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE", credentials: "include" },
    );
  } catch {
    // ベストエフォート。
  }
}
