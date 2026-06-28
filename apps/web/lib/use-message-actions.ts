"use client";

import type { ChatMessage } from "@repo/shared";
import { useState } from "react";
import { deleteMessage, editMessage } from "@/lib/rooms";

/**
 * メッセージの編集・削除フローを扱うフック。
 * 編集中の対象 id・下書き・操作エラーを保持し、開始/取消/保存/削除の操作を提供する。
 *
 * 編集・削除の結果は WebSocket の `update` 配信で一覧へ反映されるため、
 * ここでは API 呼び出しとフォーム開閉・エラー表示のみを担う。
 */
export function useMessageActions(roomId: string) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const startEdit = (m: ChatMessage) => {
    setEditingId(m.id);
    setEditDraft(m.body);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const submitEdit = async (m: ChatMessage) => {
    const body = editDraft.trim();
    if (body.length === 0 || body === m.body) {
      cancelEdit();
      return;
    }
    try {
      await editMessage(roomId, m.id, body);
      // WS の update 配信で自分にも反映されるため、ここではフォームを閉じるだけ。
      cancelEdit();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "編集に失敗しました");
    }
  };

  const submitDelete = async (m: ChatMessage) => {
    if (!window.confirm("このメッセージを削除しますか？")) return;
    try {
      await deleteMessage(roomId, m.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  return {
    editingId,
    editDraft,
    setEditDraft,
    actionError,
    startEdit,
    cancelEdit,
    submitEdit,
    submitDelete,
  };
}
