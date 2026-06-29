"use client";

import type { ChatMessage } from "@repo/shared";
import { formatDay } from "@/lib/datetime";
import { isMessageTooLong, MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";
import { MessageBody } from "./message-body";

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
  // 長さ判定はサーバと同じく書記素数で行う。
  const editTooLong = isMessageTooLong(editDraft);
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
              rows={2}
            />
            {editTooLong && (
              <p className="action-error">{MESSAGE_TOO_LONG_MESSAGE}</p>
            )}
            <div className="edit-actions">
              <button type="submit" disabled={editTooLong}>
                保存
              </button>
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
            {isDeleted ? (
              "（このメッセージは削除されました）"
            ) : (
              <MessageBody body={message.body} />
            )}
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
