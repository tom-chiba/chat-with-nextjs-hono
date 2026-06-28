"use client";

import type { ChatMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH, tokenizeMessageBody } from "@repo/shared";
import { formatDay } from "@/lib/datetime";

/**
 * メッセージ 1 件の描画。
 * 前メッセージとの関係から日付区切り・送信者名の集約を判定し、
 * 本文（メンション/リンクのトークン化）・編集フォーム・編集/削除アクションを描く。
 */
export function MessageItem({
  message,
  prevMessage,
  currentUserId,
  isEditing,
  editDraft,
  onEditDraftChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onSubmitDelete,
}: {
  message: ChatMessage;
  prevMessage: ChatMessage | undefined;
  currentUserId: string;
  isEditing: boolean;
  editDraft: string;
  onEditDraftChange: (value: string) => void;
  onStartEdit: (m: ChatMessage) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (m: ChatMessage) => void;
  onSubmitDelete: (m: ChatMessage) => void;
}) {
  const mine = message.userId === currentUserId;
  const isDeleted = message.deletedAt !== null;
  // 日付が変わる境目に区切りを挿入する（実在する時系列構造のみ）。
  const showDivider =
    !prevMessage ||
    formatDay(prevMessage.createdAt) !== formatDay(message.createdAt);
  // 同一送信者の連続メッセージは名前を先頭のみに集約する。
  const grouped =
    !showDivider &&
    prevMessage !== undefined &&
    prevMessage.userId === message.userId;

  return (
    <>
      {showDivider && (
        <div className="date-divider">{formatDay(message.createdAt)}</div>
      )}
      <div
        className={`msg${mine ? " is-mine" : ""}${grouped ? " is-grouped" : ""}`}
      >
        {!grouped && <span className="msg-author">{message.userName}</span>}
        {isEditing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmitEdit(message);
            }}
            className="edit-form"
          >
            <textarea
              autoFocus
              value={editDraft}
              onChange={(e) => onEditDraftChange(e.target.value)}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={2}
            />
            <div className="edit-actions">
              <button type="submit">保存</button>
              <button type="button" onClick={onCancelEdit}>
                取消
              </button>
            </div>
          </form>
        ) : (
          <div
            className={`bubble${mine ? " is-mine" : ""}${
              isDeleted ? " is-deleted" : ""
            }`}
          >
            {isDeleted
              ? "（このメッセージは削除されました）"
              : tokenizeMessageBody(message.body).map((seg, i) => {
                  if (seg.type === "mention") {
                    return (
                      <span key={i} className="mention">
                        {seg.value}
                      </span>
                    );
                  }
                  if (seg.type === "link") {
                    return (
                      <a
                        key={i}
                        href={seg.value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="msg-link"
                      >
                        {seg.value}
                      </a>
                    );
                  }
                  return seg.value;
                })}
            {message.editedAt !== null && !isDeleted && (
              <span className="msg-edited" title="編集済み">
                （編集済み）
              </span>
            )}
          </div>
        )}
        {mine && !isDeleted && !isEditing && (
          <div className="msg-actions">
            <button
              type="button"
              onClick={() => onStartEdit(message)}
              aria-label="メッセージを編集"
              className="btn-quiet msg-action"
            >
              編集
            </button>
            <button
              type="button"
              onClick={() => onSubmitDelete(message)}
              aria-label="メッセージを削除"
              className="btn-quiet btn-danger msg-action"
            >
              削除
            </button>
          </div>
        )}
      </div>
    </>
  );
}
