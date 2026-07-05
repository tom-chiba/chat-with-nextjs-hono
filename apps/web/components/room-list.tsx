"use client";

import type { Room } from "@repo/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { isRoomNameTooLong, ROOM_NAME_TOO_LONG_MESSAGE } from "@/lib/length";
import { createRoom, deleteRoom as apiDeleteRoom, listRooms, updateRoomName } from "@/lib/rooms";
import { mergeRooms } from "@/lib/room-list";

export type RoomListHandle = {
  /** 未読件数を含むルーム一覧をサーバから取り直す。選択中ルーム既読化後に親から呼ぶ。 */
  refresh: () => void;
  /** 指定ルームの未読を 0 として即時反映する（refresh の到達前の楽観更新）。 */
  markRoomReadLocally: (roomId: string) => void;
};

/** ルーム一覧 + 作成フォーム。選択中ルームを親に通知する。 */
export const RoomList = forwardRef<
  RoomListHandle,
  {
    selectedRoomId: string | null;
    onSelect: (roomId: string | null) => void;
    /** 選択中ルーム名が変わるたびに呼ばれる（ヘッダー表示・URL 初期選択に対応）。 */
    onSelectedNameChange?: (name: string | null) => void;
  }
>(function RoomList({ selectedRoomId, onSelect, onSelectedNameChange }, ref) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // 長さ判定はサーバと同じく書記素数で行う。
  const draftTooLong = isRoomNameTooLong(draft);
  const editDraftTooLong = isRoomNameTooLong(editDraft);

  // onSelect / selectedRoomId は最新値を ref 経由で参照し、初回マウント時のみ読み込む。
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedRoomId);
  selectedRef.current = selectedRoomId;
  const onSelectedNameChangeRef = useRef(onSelectedNameChange);
  onSelectedNameChangeRef.current = onSelectedNameChange;

  // 選択中ルーム名を親へ通知する。ユーザー選択・URL 初期選択・ルーム名編集の
  // いずれでも rooms / selectedRoomId が変わればヘッダー表示が追従する。
  useEffect(() => {
    const selected = rooms.find((r) => r.id === selectedRoomId) ?? null;
    onSelectedNameChangeRef.current?.(selected?.name ?? null);
  }, [rooms, selectedRoomId]);

  const fetchRooms = async (signal: { active: boolean }) => {
    try {
      const list = await listRooms();
      if (!signal.active) return;
      // ロード中にユーザーが作成したルーム（prev に prepend 済み）は、サーバ
      // スナップショットに含まれていなくても消さないようマージする。サーバと
      // 同じソート規則で並べ、反映時に位置がジャンプしないようにする。
      setRooms((prev) => mergeRooms(prev, list));
      const first = list[0];
      if (first && selectedRef.current === null) {
        onSelectRef.current(first.id);
      }
    } catch (e) {
      if (signal.active) {
        setError(e instanceof Error ? e.message : "読み込みに失敗しました");
      }
    } finally {
      if (signal.active) setLoading(false);
    }
  };

  const refreshSignal = useRef({ active: true });
  refreshSignal.current.active = true;

  useImperativeHandle(ref, () => ({
    refresh: () => {
      void fetchRooms(refreshSignal.current);
    },
    markRoomReadLocally: (roomId) => {
      setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)));
    },
  }));

  useEffect(() => {
    const signal = { active: true };
    void fetchRooms(signal);
    return () => {
      signal.active = false;
    };
    // 初回マウント時のみ読み込む（refresh は ref 経由で呼ばれる）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (name.length === 0 || creating || isRoomNameTooLong(name)) return;
    setCreating(true);
    setError(null);
    try {
      const room = await createRoom(name);
      setDraft("");
      setRooms((prev) => [room, ...prev]);
      onSelect(room.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (room: Room) => {
    setEditingId(room.id);
    setEditDraft(room.name);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const submitEdit = async (room: Room) => {
    const name = editDraft.trim();
    if (name.length === 0 || name === room.name) {
      cancelEdit();
      return;
    }
    if (isRoomNameTooLong(name)) return;
    setActionError(null);
    try {
      await updateRoomName(room.id, name);
      setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, name } : r)));
      cancelEdit();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "更新に失敗しました");
    }
  };

  const submitDelete = async (room: Room) => {
    if (!window.confirm(`ルーム「${room.name}」を削除しますか？`)) return;
    setActionError(null);
    try {
      await apiDeleteRoom(room.id);
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
      if (selectedRoomId === room.id) {
        // 削除したルームが選択中なら別ルームへ移すか、残り 0 件なら選択を外す。
        const next = rooms.find((r) => r.id !== room.id) ?? null;
        onSelect(next?.id ?? null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "削除に失敗しました");
    }
  };

  return (
    <div className="roomlist">
      <strong className="eyebrow">ルーム</strong>

      <form onSubmit={submit} className="roomlist-create">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="新しいルーム名"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={creating || draft.trim().length === 0 || draftTooLong}>
          作成
        </button>
      </form>

      {draftTooLong && <p className="action-error">{ROOM_NAME_TOO_LONG_MESSAGE}</p>}
      {error && <p className="action-error">{error}</p>}
      {actionError && <p className="action-error">{actionError}</p>}

      {loading ? (
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          読み込み中…
        </p>
      ) : rooms.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
          ルームがありません。作成してください。
        </p>
      ) : (
        <ul className="room-items">
          {rooms.map((room) => {
            const active = room.id === selectedRoomId;
            const isOwner = room.myRole === "owner";
            const isEditing = editingId === room.id;
            return (
              <li key={room.id}>
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitEdit(room);
                    }}
                    className="room-edit"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="submit" disabled={editDraftTooLong}>
                      保存
                    </button>
                    <button type="button" onClick={cancelEdit}>
                      取消
                    </button>
                    {editDraftTooLong && (
                      <p className="action-error">{ROOM_NAME_TOO_LONG_MESSAGE}</p>
                    )}
                  </form>
                ) : (
                  <div className="room-row">
                    <button
                      type="button"
                      onClick={() => onSelect(room.id)}
                      className={`room-link${active ? " is-active" : ""}`}
                    >
                      <span className="room-name">{room.name}</span>
                      {room.unreadCount > 0 && (
                        <span className="unread-badge" aria-label={`未読 ${room.unreadCount} 件`}>
                          {room.unreadCount > 99 ? "99+" : room.unreadCount}
                        </span>
                      )}
                    </button>
                    {isOwner && (
                      <>
                        <button
                          type="button"
                          aria-label="ルーム名を編集"
                          title="ルーム名を編集"
                          onClick={() => startEdit(room)}
                          className="btn-quiet room-action"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          aria-label="ルームを削除"
                          title="ルームを削除"
                          onClick={() => void submitDelete(room)}
                          className="btn-quiet btn-danger room-action"
                        >
                          削除
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
