"use client";

import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  isAllowedImageMimeType,
} from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { uploadAttachment } from "@/lib/attachments";
import { isMessageTooLong, MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";
import type { PendingAttachment } from "@/lib/use-room-chat";

/** input の accept 属性（許可 MIME を列挙）。 */
const ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(",");

/** コンポーザー内でアップロード中/済みの添付を追跡するローカル状態。 */
type LocalAttachment = {
  localId: string;
  previewUrl: string;
  mimeType: string;
  status: "uploading" | "ready" | "error";
  /** アップロード完了後に採番される添付 id。 */
  remoteId?: string;
};

/**
 * メッセージ入力欄（添付バー方式）。
 *
 * 「＋」から画像を選ぶ / 入力欄への貼り付け・ドラッグ＆ドロップで画像を添付できる。
 * 選んだ画像は即アップロードしてサムネイル列に並べ、送信時にアップロード済みの
 * 添付 id を本文と一緒に送る。切断中でも送信はローカルキューに積まれる。
 */
export function Composer({
  roomId,
  onSend,
}: {
  roomId: string;
  onSend: (
    body: string,
    opts?: { attachmentIds?: string[]; attachments?: PendingAttachment[] },
  ) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  /** ドラッグ enter/leave のネスト相殺用カウンタ（子要素間の leave で誤消灯しない）。 */
  const dragDepth = useRef(0);

  // アンマウント時、未送信で残っているプレビュー URL を解放する。
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) URL.revokeObjectURL(a.previewUrl);
    };
  }, []);

  const draftTooLong = isMessageTooLong(draft);
  const uploading = attachments.some((a) => a.status === "uploading");
  const readyAttachments = attachments.filter((a) => a.status === "ready");
  const canSend =
    !draftTooLong &&
    !uploading &&
    (draft.trim().length > 0 || readyAttachments.length > 0);

  /** 選ばれた画像を検証し、アップロードを開始してサムネイル列へ追加する。 */
  const addFiles = (files: File[]) => {
    const images = files.filter((f) => isAllowedImageMimeType(f.type));
    if (images.length === 0) return;
    const remaining = MAX_ATTACHMENTS_PER_MESSAGE - attachments.length;
    if (remaining <= 0) return;

    for (const file of images.slice(0, remaining)) {
      const localId = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        { localId, previewUrl, mimeType: file.type, status: "uploading" },
      ]);
      void uploadAttachment(roomId, file)
        .then((a) => {
          setAttachments((prev) =>
            prev.map((x) =>
              x.localId === localId
                ? { ...x, status: "ready", remoteId: a.id }
                : x,
            ),
          );
        })
        .catch(() => {
          setAttachments((prev) =>
            prev.map((x) =>
              x.localId === localId ? { ...x, status: "error" } : x,
            ),
          );
        });
    }
  };

  const removeAttachment = (localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const body = draft.trim();
    const ready = attachments.filter((a) => a.status === "ready" && a.remoteId);
    // 送信に載らない添付（アップロード中/失敗）は保留バブルへ渡らないため、ここで
    // プレビュー URL を解放する。ready の URL は送信中バブルが参照するので解放しない。
    for (const a of attachments) {
      if (a.status !== "ready" || !a.remoteId) URL.revokeObjectURL(a.previewUrl);
    }
    if (ready.length > 0) {
      onSend(body, {
        attachmentIds: ready.map((a) => a.remoteId as string),
        attachments: ready.map((a) => ({
          previewUrl: a.previewUrl,
          mimeType: a.mimeType,
        })),
      });
    } else {
      onSend(body);
    }
    setDraft("");
    setAttachments([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter は改行、IME 変換中の Enter は確定なので送信しない。
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit(e);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => isAllowedImageMimeType(f.type))) {
      e.preventDefault();
      addFiles(files);
    }
  };

  return (
    <div
      className={`composer-wrap${dragOver ? " is-dragover" : ""}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragOver(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragOver && (
        <div className="composer-dropzone" aria-hidden="true">
          ここに画像をドロップ
        </div>
      )}

      {attachments.length > 0 && (
        <div className="composer-thumbs">
          {attachments.map((a) => (
            <div
              key={a.localId}
              className={`composer-thumb${a.status === "error" ? " is-error" : ""}${a.status === "uploading" ? " is-uploading" : ""}`}
            >
              {/* biome-ignore lint/nursery/noImgElement: プレビューは data/blob URL のため next/image は使わない */}
              <img src={a.previewUrl} alt="" />
              <button
                type="button"
                className="composer-thumb-remove"
                onClick={() => removeAttachment(a.localId)}
                aria-label="添付を削除"
              >
                ×
              </button>
            </div>
          ))}
          {attachments.length < MAX_ATTACHMENTS_PER_MESSAGE && (
            <button
              type="button"
              className="composer-thumb-add"
              onClick={() => fileInputRef.current?.click()}
              aria-label="画像を追加"
            >
              +
            </button>
          )}
        </div>
      )}

      <form onSubmit={submit} className="composer">
        <div className="composer-attach">
          <button
            type="button"
            className={`icon-btn${menuOpen ? " is-active" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="画像を添付"
            aria-expanded={menuOpen}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                className="composer-menu-backdrop"
                aria-label="メニューを閉じる"
                onClick={() => setMenuOpen(false)}
              />
              <div className="composer-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  写真・動画を選択
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="composer-menu-camera"
                  onClick={() => {
                    setMenuOpen(false);
                    cameraInputRef.current?.click();
                  }}
                >
                  写真を撮る
                  <span className="composer-menu-note">モバイルのみ</span>
                </button>
              </div>
            </>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="メッセージを入力（Shift+Enter で改行）"
          rows={2}
        />
        <button
          type="submit"
          className="btn-primary"
          // 切断中も送信を許可する（ローカルキューに積み、再接続時に flush する）。
          disabled={!canSend}
        >
          送信
        </button>

        {/* 実ファイル選択の隠し input（メニュー / 追加ボタンから起動）。 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept={ACCEPT}
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </form>

      {draftTooLong && (
        <p className="action-error">{MESSAGE_TOO_LONG_MESSAGE}</p>
      )}
    </div>
  );
}
