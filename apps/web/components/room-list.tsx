"use client";

import type { Room } from "@repo/shared";
import { MAX_ROOM_NAME_LENGTH } from "@repo/shared";
import { useEffect, useRef, useState } from "react";
import { createRoom, listRooms } from "@/lib/rooms";

/** ルーム一覧 + 作成フォーム。選択中ルームを親に通知する。 */
export function RoomList({
  selectedRoomId,
  onSelect,
}: {
  selectedRoomId: string | null;
  onSelect: (roomId: string) => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  // onSelect / selectedRoomId は最新値を ref 経由で参照し、初回マウント時のみ読み込む。
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedRoomId);
  selectedRef.current = selectedRoomId;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listRooms();
        if (!active) return;
        // ロード中にユーザーが作成したルーム（prev に prepend 済み）は、サーバ
        // スナップショットに含まれていなくても消さないようマージする。
        setRooms((prev) => {
          const ids = new Set(list.map((r) => r.id));
          const localOnly = prev.filter((r) => !ids.has(r.id));
          return [...localOnly, ...list];
        });
        // 未選択なら先頭ルームを自動選択する。
        const first = list[0];
        if (first && selectedRef.current === null) {
          onSelectRef.current(first.id);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "読み込みに失敗しました");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
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
            return (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={() => onSelect(room.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: active ? "#4a90d9" : "#ddd",
                    background: active ? "#eaf3fb" : "#fff",
                    cursor: "pointer",
                    fontWeight: active ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {room.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
