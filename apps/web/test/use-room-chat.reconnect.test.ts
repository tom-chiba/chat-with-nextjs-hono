import type { ChatMessage, ServerMessage } from "@repo/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// REST 補完（fetchMessages）をモックして欠落区間補完を検証する。
const { fetchMessages } = vi.hoisted(() => ({ fetchMessages: vi.fn() }));
vi.mock("@/lib/rooms", () => ({ fetchMessages }));

import { useRoomChat } from "@/lib/use-room-chat";

function msg(id: string, createdAt: number): ChatMessage {
  return {
    id,
    roomId: "room-1",
    userId: "user-1",
    userName: "user-1",
    body: `body-${id}`,
    createdAt,
    editedAt: null,
    deletedAt: null,
  };
}

/** new WebSocket() を捕捉し、open / message / close を手動で発火できるモック。 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static reset() {
    MockWebSocket.instances = [];
  }
  static get latest(): MockWebSocket {
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!ws) throw new Error("no socket created");
    return ws;
  }

  readyState = 0;
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
  private emit(type: string, ev: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", {});
  }
  receive(data: ServerMessage) {
    this.emit("message", { data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMessages.mockReset();
  MockWebSocket.reset();
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** close → 再接続タイマー進行で新しいソケットを生成させる。 */
async function reconnect() {
  await act(async () => {
    MockWebSocket.latest.close();
    await vi.advanceTimersByTimeAsync(20_000);
  });
}

test("再接続 history が重なる場合はマージで前方を保持し補完しない", async () => {
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m1", 1), msg("m2", 2), msg("m3", 3)],
    });
  });
  act(() => {
    MockWebSocket.latest.receive({ type: "message", message: msg("m4", 4) });
  });

  await reconnect();
  act(() => {
    MockWebSocket.latest.open();
    // 直近 history が m2〜m4 と重なる（欠落なし）。
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m2", 2), msg("m3", 3), msg("m4", 4)],
    });
  });

  expect(result.current.messages.map((m) => m.id)).toEqual([
    "m1",
    "m2",
    "m3",
    "m4",
  ]);
  expect(fetchMessages).not.toHaveBeenCalled();
});

test("再接続 history が旧表示と重ならない欠落区間は REST で補完する", async () => {
  fetchMessages.mockResolvedValue([msg("m4", 4), msg("m5", 5), msg("m6", 6)]);
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m1", 1), msg("m2", 2), msg("m3", 3)],
    });
  });

  await reconnect();
  await act(async () => {
    MockWebSocket.latest.open();
    // 直近 history が m7〜m9。旧最新 m3 との間（m4〜m6）が欠落区間。
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m7", 7), msg("m8", 8), msg("m9", 9)],
    });
    // void で起動した REST 補完のマイクロタスクを解決させる。
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(fetchMessages).toHaveBeenCalledWith("room-1", {
    createdAt: 7,
    id: "m7",
  });
  expect(result.current.messages.map((m) => m.id)).toEqual([
    "m1",
    "m2",
    "m3",
    "m4",
    "m5",
    "m6",
    "m7",
    "m8",
    "m9",
  ]);
});

test("loadOlder は先頭より古い分を取得してマージする", async () => {
  fetchMessages.mockResolvedValue([msg("m0", 0)]);
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m1", 1), msg("m2", 2)],
    });
  });

  await act(async () => {
    await result.current.loadOlder();
  });

  expect(fetchMessages).toHaveBeenCalledWith("room-1", {
    createdAt: 1,
    id: "m1",
  });
  expect(result.current.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  // 1 ページが MESSAGE_PAGE_SIZE 未満なので、これ以上の履歴なしとする。
  expect(result.current.hasMore).toBe(false);
});
