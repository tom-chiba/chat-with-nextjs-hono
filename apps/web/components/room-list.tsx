"use client";

import type { Room } from "@repo/shared";
import { MAX_ROOM_NAME_LENGTH } from "@repo/shared";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  createRoom,
  deleteRoom as apiDeleteRoom,
  listRooms,
  updateRoomName,
} from "@/lib/rooms";

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
  }
>(function RoomList({ selectedRoomId, onSelect }, ref) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // onSelect / selectedRoomId は最新値を ref 経由で参照し、初回マウント時のみ読み込む。
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedRoomId);
  selectedRef.current = selectedRoomId;

  const fetchRooms = async (signal: { active: boolean }) => {
    try {
      const list = await listRooms();
      if (!signal.active) return;
      // ロード中にユーザーが作成したルーム（prev に prepend 済み）は、サーバ
      // スナップショットに含まれていなくても消さないようマージする。
      setRooms((prev) => {
        const fromServer = new Map(list.map((r) => [r.id, r]));
        const localOnly = prev.filter((r) => !fromServer.has(r.id));
        return [...localOnly, ...list];
      });
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
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)),
      );
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
    if (name.length === 0 || creating) return;
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
    setActionError(null);
    try {
      await updateRoomName(room.id, name);
      setRooms((prev) =>
        prev.map((r) => (r.id === room.id ? { ...r, name } : r)),
      );
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
    <div style={{ display: "grid", gap: 8, minWidth: 180, alignContent: "start" }}>
      <strong style={{ fontSize: 14 }}>ルーム</strong>

      <form onSubmit={submit} style={{ display: "flex", gap: 4 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="新しいルーム名"
          maxLength={MAX_ROOM_NAME_LENGTH}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" disabled={creating || draft.trim().length === 0}>
          作成
        </button>
      </form>

      {error && <p style={{ color: "#c00", fontSize: 12 }}>{error}</p>}
      {actionError && (
        <p style={{ color: "#c00", fontSize: 12 }}>{actionError}</p>
      )}

      {loading ? (
        <p style={{ color: "#999", fontSize: 12 }}>読み込み中…</p>
      ) : rooms.length === 0 ? (
        <p style={{ color: "#999", fontSize: 12 }}>
          ルームがありません。作成してください。
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
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
                    style={{ display: "flex", gap: 4 }}
                  >
                    <input
                      type="text"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      maxLength={MAX_ROOM_NAME_LENGTH}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="submit">保存</button>
                    <button type="button" onClick={cancelEdit}>
                      取消
                    </button>
                  </form>
                ) : (
                  <div style={{ display: "flex", alignItems: "stretch", gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => onSelect(room.id)}
                      style={{
                        flex: 1,
                        textAlign: "left",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid",
                        borderColor: active ? "#4a90d9" : "#ddd",
                        background: active ? "#eaf3fb" : "#fff",
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {room.name}
                      </span>
                      {room.unreadCount > 0 && (
                        <span
                          aria-label={`未読 ${room.unreadCount} 件`}
                          style={{
                            background: "#e74c3c",
                            color: "#fff",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "1px 6px",
                            minWidth: 18,
                            textAlign: "center",
                            flexShrink: 0,
                          }}
                        >
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
                          style={{
                            padding: "2px 6px",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          aria-label="ルームを削除"
                          title="ルームを削除"
                          onClick={() => void submitDelete(room)}
                          style={{
                            padding: "2px 6px",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "#c00",
                          }}
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
