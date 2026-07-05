"use client";

import { APP_NAME, MAX_ATTACHMENTS_PER_MESSAGE } from "@repo/shared";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

/**
 * ゲストデモ（デザイン 1a の入り口から遷移する先）。
 *
 * アカウント登録なしでチャットの主要機能（ルーム切替・作成、メッセージ送受信、
 * 編集・削除、メンバー表示、画像添付のダミー）を試せる。状態はすべてこのページの
 * 中だけで保持し、サーバーへの保存・送信は一切行わない（API/WebSocket 非依存）。
 * 実チャットと見た目を揃えるため、globals.css の既存クラスをそのまま流用する。
 */

const GUEST_ID = "guest";
/** アバタースタックに並べるメンバーの最大数。超過分は "+N" にまとめる。 */
const MAX_AVATARS = 3;

type DemoRoom = { id: string; name: string; unread: number };
type DemoAttachment = { id: string };
type DemoMessage = {
  id: string;
  userId: string;
  userName: string;
  body: string;
  attachments: DemoAttachment[];
  edited: boolean;
  deleted: boolean;
};
type DemoMember = { userId: string; userName: string; role: string };
type DemoThumb = { id: string };

// 初期選択は r1（雑談）。在室中のルームは既読とみなすため未読は 0 とし、
// 未読バッジは未選択の別ルームに置いてデモで見せる。
const INITIAL_ROOMS: DemoRoom[] = [
  { id: "r1", name: "雑談", unread: 0 },
  { id: "r2", name: "プロジェクトA", unread: 2 },
  { id: "r3", name: "お知らせ", unread: 0 },
];

const INITIAL_MESSAGES: Record<string, DemoMessage[]> = {
  r1: [
    {
      id: "m1",
      userId: "u1",
      userName: "アオイ",
      body: "おはようございます！今日もよろしくお願いします。",
      attachments: [],
      edited: false,
      deleted: false,
    },
    {
      id: "m2",
      userId: "u1",
      userName: "アオイ",
      body: "資料を共有しますね。",
      attachments: [{ id: "att1" }],
      edited: false,
      deleted: false,
    },
    {
      id: "m3",
      userId: "u2",
      userName: "ユウキ",
      body: "ありがとうございます、確認します！",
      attachments: [],
      edited: false,
      deleted: false,
    },
  ],
  r2: [
    {
      id: "m4",
      userId: "u2",
      userName: "ユウキ",
      body: "進捗どうですか？",
      attachments: [],
      edited: false,
      deleted: false,
    },
    {
      id: "m5",
      userId: "u2",
      userName: "ユウキ",
      body: "今週中に一次レビューお願いしたいです。",
      attachments: [],
      edited: false,
      deleted: false,
    },
  ],
  r3: [],
};

const MEMBERS: DemoMember[] = [
  { userId: "u1", userName: "アオイ", role: "owner" },
  { userId: "u2", userName: "ユウキ", role: "member" },
  { userId: GUEST_ID, userName: "あなた", role: "member" },
];

/** 表示名の先頭 1 文字（サロゲートペア・結合文字を割らない）を返す。 */
function initialOf(name: string): string {
  return Array.from(name)[0] ?? "?";
}

export default function DemoPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<DemoRoom[]>(INITIAL_ROOMS);
  const [messagesByRoom, setMessagesByRoom] =
    useState<Record<string, DemoMessage[]>>(INITIAL_MESSAGES);
  const [selectedRoomId, setSelectedRoomId] = useState("r1");
  const [roomDraft, setRoomDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [thumbs, setThumbs] = useState<DemoThumb[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // モバイルのルーム一覧ドロワーの開閉。デスクトップでは常設サイドバーのため無視される。
  const [roomsDrawerOpen, setRoomsDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // ルーム・メッセージ・添付ダミーの id 採番に使う連番。
  const [nextId, setNextId] = useState(100);

  const selectRoom = (id: string) => {
    setSelectedRoomId(id);
    setMembersOpen(false);
    setRoomsDrawerOpen(false);
    setEditingId(null);
    // 開いたルームの未読を 0 にする。
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, unread: 0 } : r)));
  };

  const createRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const name = roomDraft.trim();
    if (!name) return;
    const id = `r${nextId}`;
    setRooms((prev) => [{ id, name, unread: 0 }, ...prev]);
    setMessagesByRoom((prev) => ({ ...prev, [id]: [] }));
    setSelectedRoomId(id);
    setRoomDraft("");
    setNextId((n) => n + 1);
    setMembersOpen(false);
    setRoomsDrawerOpen(false);
    setEditingId(null);
  };

  const sendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const body = draft.trim();
    if (body.length === 0 && thumbs.length === 0) return;
    const msg: DemoMessage = {
      id: `m${nextId}`,
      userId: GUEST_ID,
      userName: "あなた",
      body,
      attachments: thumbs.map((t) => ({ id: t.id })),
      edited: false,
      deleted: false,
    };
    setMessagesByRoom((prev) => ({
      ...prev,
      [selectedRoomId]: [...(prev[selectedRoomId] ?? []), msg],
    }));
    setDraft("");
    setThumbs([]);
    setNextId((n) => n + 1);
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter は改行、IME 変換中の Enter は確定なので送信しない。
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    sendMessage();
  };

  const startEdit = (m: DemoMessage) => {
    setEditingId(m.id);
    setEditDraft(m.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };
  const submitEdit = (m: DemoMessage, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const body = editDraft.trim();
    // 空にした場合は編集をやめる（削除は専用の導線から行う）。
    if (body.length === 0) {
      cancelEdit();
      return;
    }
    setMessagesByRoom((prev) => ({
      ...prev,
      [selectedRoomId]: (prev[selectedRoomId] ?? []).map((x) =>
        x.id === m.id ? { ...x, body, edited: true } : x,
      ),
    }));
    setEditingId(null);
    setEditDraft("");
  };
  const deleteMessage = (m: DemoMessage) => {
    setMessagesByRoom((prev) => ({
      ...prev,
      [selectedRoomId]: (prev[selectedRoomId] ?? []).map((x) =>
        x.id === m.id ? { ...x, deleted: true } : x,
      ),
    }));
  };

  const addFakeThumb = () => {
    setMenuOpen(false);
    // 上限到達時は追加せず採番も進めない（無言の空振り・id 飛びを防ぐ）。
    if (thumbs.length >= MAX_ATTACHMENTS_PER_MESSAGE) return;
    setThumbs((prev) => [...prev, { id: `th${nextId}` }]);
    setNextId((n) => n + 1);
  };
  const removeThumb = (id: string) => {
    setThumbs((prev) => prev.filter((t) => t.id !== id));
  };

  const messages = messagesByRoom[selectedRoomId] ?? [];
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);
  const sendDisabled = draft.trim().length === 0 && thumbs.length === 0;

  return (
    <main className="page">
      <header className="page-header">
        <div className="demo-brand">
          <h1 className="wordmark">{APP_NAME}</h1>
          <span className="demo-badge">デモモード</span>
        </div>
        <button type="button" className="btn-quiet" onClick={() => router.push("/")}>
          デモを終了
        </button>
      </header>

      <div className="app-shell" data-drawer={roomsDrawerOpen ? "open" : "closed"}>
        {roomsDrawerOpen && (
          <button
            type="button"
            className="drawer-backdrop mobile-only"
            aria-label="ルーム一覧を閉じる"
            onClick={() => setRoomsDrawerOpen(false)}
          />
        )}

        <div className="roomlist-pane">
          <div className="roomlist">
            <strong className="eyebrow">ルーム</strong>
            <form className="roomlist-create" onSubmit={createRoom}>
              <input
                type="text"
                value={roomDraft}
                onChange={(e) => setRoomDraft(e.target.value)}
                placeholder="新しいルーム名"
                aria-label="新しいルーム名"
              />
              <button type="submit">作成</button>
            </form>
            <ul className="room-items">
              {rooms.map((room) => {
                const active = room.id === selectedRoomId;
                return (
                  <li key={room.id} className="room-row">
                    <button
                      type="button"
                      className={`room-link${active ? " is-active" : ""}`}
                      onClick={() => selectRoom(room.id)}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className="room-name">{room.name}</span>
                      {room.unread > 0 && <span className="unread-badge">{room.unread}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="chat-pane">
          <div className="chat">
            <div className="chat-header">
              <button
                type="button"
                className="icon-btn chat-hamburger mobile-only"
                onClick={() => setRoomsDrawerOpen(true)}
                aria-label="ルーム一覧を開く"
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
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>

              <div className="chat-heading">
                <span
                  className="presence-dot is-open"
                  title="デモ（常時接続扱い）"
                  aria-hidden="true"
                />
                <span className="chat-room-name">
                  {selectedRoom ? selectedRoom.name : "ルーム"}
                </span>
              </div>

              <button
                type="button"
                className="member-avatars"
                onClick={() => setMembersOpen(true)}
                aria-label={`メンバー ${MEMBERS.length} 人を表示`}
              >
                {MEMBERS.slice(0, MAX_AVATARS).map((m) => (
                  <span key={m.userId} className="avatar" aria-hidden="true">
                    {initialOf(m.userName)}
                  </span>
                ))}
                {MEMBERS.length > MAX_AVATARS && (
                  <span className="avatar avatar-more" aria-hidden="true">
                    +{MEMBERS.length - MAX_AVATARS}
                  </span>
                )}
              </button>
            </div>

            <div className="msg-scroll">
              {messages.length === 0 && <p className="empty-note">まだメッセージはありません。</p>}
              {messages.map((m, idx) => {
                const prev = messages[idx - 1];
                const mine = m.userId === GUEST_ID;
                const grouped = idx > 0 && prev?.userId === m.userId;
                const isEditing = editingId === m.id;
                return (
                  // Fragment で date-divider と .msg を .msg-scroll グリッドの
                  // 直接の子にする（.is-grouped の負マージンで連続発言を詰める前提）。
                  <Fragment key={m.id}>
                    {idx === 0 && <div className="date-divider">今日</div>}
                    <div className={`msg${mine ? " is-mine" : ""}${grouped ? " is-grouped" : ""}`}>
                      {!grouped && <span className="msg-author">{m.userName}</span>}
                      {isEditing ? (
                        <form className="edit-form" onSubmit={(e) => submitEdit(m, e)}>
                          <textarea
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={2}
                          />
                          <div className="edit-actions">
                            <button type="submit">保存</button>
                            <button type="button" onClick={cancelEdit}>
                              取消
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div
                          className={`bubble${mine ? " is-mine" : ""}${m.deleted ? " is-deleted" : ""}`}
                        >
                          {m.deleted ? (
                            "（このメッセージは削除されました）"
                          ) : (
                            <>
                              {m.attachments.length > 0 && (
                                <div className="attach-grid" data-count={m.attachments.length}>
                                  {m.attachments.map((a) => (
                                    <span key={a.id} className="attach-cell">
                                      <span className="demo-image">image</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {m.body.length > 0 && m.body}
                              {m.edited && (
                                <span className="msg-edited" title="編集済み">
                                  （編集済み）
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {mine && !m.deleted && !isEditing && (
                        <div className="msg-actions">
                          <button
                            type="button"
                            className="btn-quiet msg-action"
                            onClick={() => startEdit(m)}
                            aria-label="メッセージを編集"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            className="btn-quiet btn-danger msg-action"
                            onClick={() => deleteMessage(m)}
                            aria-label="メッセージを削除"
                          >
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>

            <div className="composer-wrap">
              {thumbs.length > 0 && (
                <div className="composer-thumbs">
                  {thumbs.map((t) => (
                    <div key={t.id} className="composer-thumb">
                      <span className="demo-image">image</span>
                      <button
                        type="button"
                        className="composer-thumb-remove"
                        onClick={() => removeThumb(t.id)}
                        aria-label="添付を削除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {thumbs.length < MAX_ATTACHMENTS_PER_MESSAGE && (
                    <button
                      type="button"
                      className="composer-thumb-add"
                      onClick={addFakeThumb}
                      aria-label="画像を追加"
                    >
                      +
                    </button>
                  )}
                </div>
              )}

              <form className="composer" onSubmit={sendMessage}>
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
                          onClick={addFakeThumb}
                          disabled={thumbs.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                        >
                          画像を追加（デモ用ダミー）
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder="メッセージを入力（Shift+Enter で改行）"
                  rows={2}
                />
                <button type="submit" className="btn-primary" disabled={sendDisabled}>
                  送信
                </button>
              </form>
            </div>
          </div>

          {membersOpen && (
            <>
              <button
                type="button"
                className="sheet-backdrop"
                aria-label="メンバー一覧を閉じる"
                onClick={() => setMembersOpen(false)}
              />
              <div
                className="member-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="メンバー一覧"
              >
                <div className="member-sheet-head">
                  <strong className="eyebrow">メンバー ({MEMBERS.length})</strong>
                  <button
                    type="button"
                    className="warn-close"
                    onClick={() => setMembersOpen(false)}
                    aria-label="メンバー一覧を閉じる"
                  >
                    ✕
                  </button>
                </div>
                <div className="members-body">
                  <ul className="member-items">
                    {MEMBERS.map((m) => (
                      <li key={m.userId} className="member-row">
                        <span className="member-name">{m.userName}</span>
                        <span className="role-tag">{m.role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
