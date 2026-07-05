"use client";

import type { PendingMessage } from "@/lib/use-room-chat";
import { AttachmentGrid } from "./attachment-grid";
import { MessageBody } from "./message-body";

/** 保留状態ごとの注記文言。 */
const STATUS_NOTE: Record<PendingMessage["status"], string> = {
  sending: "送信中…",
  queued: "送信待ち（再接続後に送信します）",
  failed: "送信に失敗しました",
};

/**
 * 楽観送信中の保留メッセージ 1 件の描画。
 * 自分の発言として右寄せで仮表示し、状態（送信中 / 送信待ち / 失敗）を注記する。
 * 失敗時は本文を保持したまま「再送 / 破棄」を提示し、入力データを失わせない。
 */
export function PendingMessageItem({
  pending,
  onRetry,
  onDiscard,
}: {
  pending: PendingMessage;
  onRetry: (nonce: string) => void;
  onDiscard: (nonce: string) => void;
}) {
  const isFailed = pending.status === "failed";
  return (
    <div className="msg is-mine">
      <div className={`bubble is-mine is-pending${isFailed ? " is-failed" : ""}`}>
        {pending.attachments && pending.attachments.length > 0 && (
          <AttachmentGrid images={pending.attachments.map((a) => ({ src: a.previewUrl }))} />
        )}
        {pending.body.length > 0 && <MessageBody body={pending.body} />}
      </div>
      <div className={`pending-note${isFailed ? " is-failed" : ""}`}>
        <span>{STATUS_NOTE[pending.status]}</span>
        {isFailed && (
          <span className="pending-actions">
            <button
              type="button"
              onClick={() => onRetry(pending.nonce)}
              className="btn-quiet msg-action"
            >
              再送
            </button>
            <button
              type="button"
              onClick={() => onDiscard(pending.nonce)}
              className="btn-quiet btn-danger msg-action"
            >
              破棄
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
