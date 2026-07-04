import type { ChatMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { editMessage } from "@/lib/rooms";
import { useMessageActions } from "@/lib/use-message-actions";

vi.mock("@/lib/rooms", () => ({
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
}));

const mockedEditMessage = vi.mocked(editMessage);

const message: ChatMessage = {
  id: "m1",
  roomId: "r1",
  userId: "u1",
  userName: "Alice",
  body: "before",
  attachments: [],
  createdAt: 1,
  editedAt: null,
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedEditMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("submitEdit は本文が上限を超えていると editMessage を呼ばない", async () => {
  const { result } = renderHook(() => useMessageActions("r1"));
  act(() => {
    result.current.startEdit(message);
  });
  act(() => {
    // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
    result.current.setEditDraft("😀".repeat(MAX_MESSAGE_LENGTH + 1));
  });
  await act(async () => {
    await result.current.submitEdit(message);
  });

  expect(mockedEditMessage).not.toHaveBeenCalled();
});

test("submitEdit は本文が上限ちょうど（絵文字）なら editMessage を呼ぶ", async () => {
  const { result } = renderHook(() => useMessageActions("r1"));
  act(() => {
    result.current.startEdit(message);
  });
  act(() => {
    result.current.setEditDraft("😀".repeat(MAX_MESSAGE_LENGTH));
  });
  await act(async () => {
    await result.current.submitEdit(message);
  });

  expect(mockedEditMessage).toHaveBeenCalledTimes(1);
});
