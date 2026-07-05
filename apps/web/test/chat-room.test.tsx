import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatRoom } from "@/components/chat-room";
import { MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";
import { markRoomRead } from "@/lib/rooms";

const send = vi.fn();
// useRoomChat が返す messages / status をテストごとに差し替えられるよう保持する。
const chatState = vi.hoisted(() => ({
  messages: [] as { id: string; createdAt: number }[],
  status: "open" as "connecting" | "open" | "closed",
}));

vi.mock("@/lib/use-room-chat", () => ({
  useRoomChat: () => ({
    messages: chatState.messages,
    pending: [],
    status: chatState.status,
    send,
    retry: vi.fn(),
    discard: vi.fn(),
    errorMessage: null,
    clearError: vi.fn(),
    loadOlder: vi.fn(),
    hasMore: false,
    loadingMore: false,
  }),
}));

vi.mock("@/lib/use-message-actions", () => ({
  useMessageActions: () => ({
    editingId: null,
    editDraft: "",
    setEditDraft: vi.fn(),
    actionError: null,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    submitEdit: vi.fn(),
    submitDelete: vi.fn(),
  }),
}));

vi.mock("@/lib/rooms", () => ({
  markRoomRead: vi.fn().mockResolvedValue(undefined),
}));

// メンバー取得はフックへ委譲済み。入力欄・既読ロジックの検証に集中するため差し替える。
vi.mock("@/lib/use-room-members", () => ({
  useRoomMembers: () => ({
    members: [],
    loading: false,
    error: null,
    isOwner: false,
    draftEmail: "",
    setDraftEmail: vi.fn(),
    adding: false,
    removingUserId: null,
    submitAdd: vi.fn(),
    submitRemove: vi.fn(),
  }),
}));

// 子コンポーネントは独自に API を呼ぶため、入力欄の検証に集中できるよう差し替える。
vi.mock("@/components/message-list", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/room-members", () => ({
  RoomMembers: () => <div data-testid="room-members" />,
}));

function renderChatRoom() {
  return render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  chatState.messages = [];
  chatState.status = "open";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // 後続テストへ漏れないよう JSDOM 既定の表示状態へ戻す。
  setDocumentHidden(false);
});

const markRoomReadMock = vi.mocked(markRoomRead);

/** document.hidden を固定する（後始末は afterEach で false に戻す）。 */
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

test("送信本文が上限を超えると送信ボタンを無効化し注記を表示する", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText("メッセージを入力（Shift+Enter で改行）");
  // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH + 1) },
  });

  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  expect(screen.getByText(MESSAGE_TOO_LONG_MESSAGE)).toBeInTheDocument();
});

test("送信本文が上限ちょうど（絵文字）なら送信でき注記を出さない", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText("メッセージを入力（Shift+Enter で改行）");
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH) },
  });

  expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  expect(screen.queryByText(MESSAGE_TOO_LONG_MESSAGE)).not.toBeInTheDocument();
});

test("切断中でも本文があれば送信ボタンは有効（ローカルキューへ積む）", () => {
  chatState.status = "closed";
  renderChatRoom();
  const textarea = screen.getByPlaceholderText("メッセージを入力（Shift+Enter で改行）");
  fireEvent.change(textarea, { target: { value: "切断中でも送る" } });

  const button = screen.getByRole("button", { name: "送信" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(send).toHaveBeenCalledWith("切断中でも送る");
});

test("上限超過のまま Enter で送信しても send を呼ばない", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText("メッセージを入力（Shift+Enter で改行）");
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH + 1) },
  });
  fireEvent.keyDown(textarea, { key: "Enter" });

  expect(send).not.toHaveBeenCalled();
});

test("連投メッセージは 200ms デバウンスで末尾だけ 1 回既読化する", () => {
  vi.useFakeTimers();
  chatState.messages = [{ id: "m1", createdAt: 100 }];
  const { rerender } = render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);

  // デバウンス窓内で連続して新着が届く。
  chatState.messages = [...chatState.messages, { id: "m2", createdAt: 200 }];
  rerender(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
  chatState.messages = [...chatState.messages, { id: "m3", createdAt: 300 }];
  rerender(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);

  expect(markRoomReadMock).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);

  expect(markRoomReadMock).toHaveBeenCalledTimes(1);
  expect(markRoomReadMock).toHaveBeenCalledWith("r1", 300);
});

test("末尾が進んでいなければ既読 API を呼ばない", () => {
  vi.useFakeTimers();
  chatState.messages = [{ id: "m2", createdAt: 200 }];
  const { rerender } = render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
  vi.advanceTimersByTime(200);
  expect(markRoomReadMock).toHaveBeenCalledTimes(1);

  // 過去ログが先頭に増えても末尾の createdAt は変わらない。
  chatState.messages = [{ id: "m1", createdAt: 100 }, ...chatState.messages];
  rerender(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
  vi.advanceTimersByTime(200);

  expect(markRoomReadMock).toHaveBeenCalledTimes(1);
});

test("タブ非表示中は保留し、復帰時に最新値で 1 回送る", () => {
  vi.useFakeTimers();
  setDocumentHidden(true);
  chatState.messages = [{ id: "m1", createdAt: 100 }];
  render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
  vi.advanceTimersByTime(200);

  // 非表示中は送らない。
  expect(markRoomReadMock).not.toHaveBeenCalled();

  setDocumentHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));

  expect(markRoomReadMock).toHaveBeenCalledTimes(1);
  expect(markRoomReadMock).toHaveBeenCalledWith("r1", 100);
});

test("デバウンス確定前にアンマウントされても保留分を送り切る", () => {
  vi.useFakeTimers();
  chatState.messages = [{ id: "m1", createdAt: 100 }];
  const { unmount } = render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);

  // タイマー発火前にアンマウント。
  expect(markRoomReadMock).not.toHaveBeenCalled();
  unmount();

  expect(markRoomReadMock).toHaveBeenCalledTimes(1);
  expect(markRoomReadMock).toHaveBeenCalledWith("r1", 100);
});

test("既読 API 失敗時は送信位置を巻き戻して次の発火で再送する", async () => {
  vi.useFakeTimers();
  markRoomReadMock.mockRejectedValueOnce(new Error("network"));
  chatState.messages = [{ id: "m1", createdAt: 100 }];
  const { rerender } = render(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);

  await vi.advanceTimersByTimeAsync(200);
  expect(markRoomReadMock).toHaveBeenCalledTimes(1);

  // 同じ末尾でライブ更新が走ると、巻き戻し済みのため改めて送られる。
  chatState.messages = [{ id: "m1", createdAt: 100 }];
  rerender(<ChatRoom roomId="r1" roomName={null} currentUserId="u1" />);
  await vi.advanceTimersByTimeAsync(200);

  expect(markRoomReadMock).toHaveBeenCalledTimes(2);
  expect(markRoomReadMock).toHaveBeenNthCalledWith(2, "r1", 100);
});
