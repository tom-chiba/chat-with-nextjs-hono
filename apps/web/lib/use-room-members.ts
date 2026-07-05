"use client";

import type { RoomMember } from "@repo/shared";
import { useEffect, useMemo, useState } from "react";
import { addRoomMember, listRoomMembers, removeRoomMember } from "@/lib/rooms";

/**
 * ルームのメンバー一覧と追加・削除操作を束ねるフック。
 *
 * ChatRoom のヘッダー（アバタースタック）とメンバーシートが同じ状態を参照できるよう、
 * フェッチ・楽観更新のロジックをコンポーネントから分離した単一情報源とする。
 */
export type RoomMembersState = {
  members: RoomMember[];
  loading: boolean;
  error: string | null;
  /** 自分がオーナーか（追加・削除ボタンの出し分けに使う）。 */
  isOwner: boolean;
  draftEmail: string;
  setDraftEmail: (value: string) => void;
  adding: boolean;
  /** 削除処理中のメンバー userId（ボタンの二度押し抑止に使う）。 */
  removingUserId: string | null;
  submitAdd: (e: React.FormEvent) => void;
  submitRemove: (member: RoomMember) => void;
};

export function useRoomMembers(roomId: string, currentUserId: string): RoomMembersState {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [draftEmail, setDraftEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.role === "owner",
    [currentUserId, members],
  );

  const loadMembers = async (signal: { active: boolean }) => {
    try {
      const list = await listRoomMembers(roomId);
      if (!signal.active) return;
      setMembers(list);
      setError(null);
    } catch (err) {
      if (signal.active) {
        setError(err instanceof Error ? err.message : "メンバー一覧の取得に失敗しました");
      }
    } finally {
      if (signal.active) setLoading(false);
    }
  };

  useEffect(() => {
    const signal = { active: true };
    setLoading(true);
    void loadMembers(signal);
    return () => {
      signal.active = false;
    };
    // roomId 変更時のみ読み込む。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = draftEmail.trim();
    if (!email || adding) return;

    setAdding(true);
    setError(null);
    try {
      await addRoomMember(roomId, email);
      setDraftEmail("");
      await loadMembers({ active: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "メンバーの追加に失敗しました");
    } finally {
      setAdding(false);
    }
  };

  const submitRemove = async (member: RoomMember) => {
    if (!window.confirm(`${member.userName} をこのルームから削除しますか？`)) {
      return;
    }

    setRemovingUserId(member.userId);
    setError(null);
    try {
      await removeRoomMember(roomId, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "メンバーの削除に失敗しました");
    } finally {
      setRemovingUserId(null);
    }
  };

  return {
    members,
    loading,
    error,
    isOwner,
    draftEmail,
    setDraftEmail,
    adding,
    removingUserId,
    submitAdd,
    submitRemove,
  };
}
