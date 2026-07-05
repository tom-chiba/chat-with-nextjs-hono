"use client";

import type { RoomMembersState } from "@/lib/use-room-members";

/**
 * メンバー一覧シートの本体。
 *
 * 状態・操作は {@link RoomMembersState}（`useRoomMembers`）から受け取る presentational
 * コンポーネント。ChatRoom のヘッダーにあるアバタースタックと同じ情報源を共有し、
 * オーバーレイ（モバイル=ボトムシート／デスクトップ=右ドックパネル）として表示される。
 */
export function RoomMembers({
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
  onClose,
}: RoomMembersState & { onClose: () => void }) {
  return (
    <div className="member-sheet" role="dialog" aria-modal="true" aria-label="メンバー一覧">
      <div className="member-sheet-head">
        <strong className="eyebrow">メンバー {loading ? "" : `(${members.length})`}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="メンバー一覧を閉じる"
          className="warn-close"
        >
          ✕
        </button>
      </div>

      <div className="members-body">
        {error && <p className="action-error">{error}</p>}

        {loading ? (
          <p className="muted" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
            読み込み中…
          </p>
        ) : (
          <ul className="member-items">
            {members.map((member) => {
              const canRemove = isOwner && member.role !== "owner";
              return (
                <li key={member.userId} className="member-row">
                  <span className="member-name">{member.userName}</span>
                  <span className="role-tag">{member.role}</span>
                  {canRemove && (
                    <button
                      type="button"
                      onClick={() => submitRemove(member)}
                      disabled={removingUserId === member.userId}
                      className="btn-quiet btn-danger"
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
          <form onSubmit={submitAdd} className="member-add">
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
    </div>
  );
}
