"use client";

import type { RoomMember } from "@repo/shared";
import { useEffect, useMemo, useState } from "react";
import {
  addRoomMember,
  listRoomMembers,
  removeRoomMember,
} from "@/lib/rooms";

export function RoomMembers({
  roomId,
  currentUserId,
}: {
  roomId: string;
  currentUserId: string;
}) {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [draftEmail, setDraftEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myRole = useMemo(
    () => members.find((m) => m.userId === currentUserId)?.role ?? "member",
    [currentUserId, members],
  );
  const isOwner = myRole === "owner";

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
    if (!window.confirm(`${member.userName} をこのルームから削除しますか？`)) return;

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

  return (
    <details
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: "8px 10px",
        background: "#fff",
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
        メンバー {loading ? "" : `(${members.length})`}
      </summary>

      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {error && <p style={{ color: "#c00", fontSize: 12, margin: 0 }}>{error}</p>}

        {loading ? (
          <p style={{ color: "#999", fontSize: 12, margin: 0 }}>読み込み中…</p>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 4,
            }}
          >
            {members.map((member) => {
              const canRemove = isOwner && member.role !== "owner";
              return (
                <li
                  key={member.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 30,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{member.userName}</span>
                  </span>
                  <span style={{ color: "#777", fontSize: 12 }}>{member.role}</span>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => void submitRemove(member)}
                      disabled={removingUserId === member.userId}
                      style={{
                        padding: "2px 6px",
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        background: "#fff",
                        color: "#c00",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      削除
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {isOwner && (
          <form onSubmit={submitAdd} style={{ display: "flex", gap: 4 }}>
            <input
              type="email"
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="追加するメンバーのメールアドレス"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="submit" disabled={adding || draftEmail.trim().length === 0}>
              追加
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
