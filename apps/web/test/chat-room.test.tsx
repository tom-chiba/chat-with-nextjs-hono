import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChatRoom } from "@/components/chat-room";
import { MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";

const send = vi.fn();

vi.mock("@/lib/use-room-chat", () => ({
  useRoomChat: () => ({
    messages: [],
    status: "open",
    send,
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

// 子コンポーネントは独自に API を呼ぶため、入力欄の検証に集中できるよう差し替える。
vi.mock("@/components/message-list", () => ({
  MessageList: () => <div data-testid="message-list" />,
}));
vi.mock("@/components/room-members", () => ({
  RoomMembers: () => <div data-testid="room-members" />,
}));

function renderChatRoom() {
  return render(<ChatRoom roomId="r1" currentUserId="u1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("送信本文が上限を超えると送信ボタンを無効化し注記を表示する", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText(
    "メッセージを入力（Shift+Enter で改行）",
  );
  // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH + 1) },
  });

  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  expect(screen.getByText(MESSAGE_TOO_LONG_MESSAGE)).toBeInTheDocument();
});

test("送信本文が上限ちょうど（絵文字）なら送信でき注記を出さない", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText(
    "メッセージを入力（Shift+Enter で改行）",
  );
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH) },
  });

  expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
  expect(screen.queryByText(MESSAGE_TOO_LONG_MESSAGE)).not.toBeInTheDocument();
});

test("上限超過のまま Enter で送信しても send を呼ばない", () => {
  renderChatRoom();
  const textarea = screen.getByPlaceholderText(
    "メッセージを入力（Shift+Enter で改行）",
  );
  fireEvent.change(textarea, {
    target: { value: "😀".repeat(MAX_MESSAGE_LENGTH + 1) },
  });
  fireEvent.keyDown(textarea, { key: "Enter" });

  expect(send).not.toHaveBeenCalled();
});
