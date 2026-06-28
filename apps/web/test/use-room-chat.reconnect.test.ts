import type { ChatMessage, ServerMessage } from "@repo/shared";
import { MESSAGE_PAGE_SIZE } from "@repo/shared";
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

/** createdAt が start..start+count-1、id が `m{createdAt}` の連続メッセージ。 */
function seq(start: number, count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => msg(`m${start + i}`, start + i));
}

/** void で起動した非同期処理（REST 補完）のマイクロタスクを十分に解決させる。 */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
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

test("欠落区間が複数ページに跨る場合は boundary までページングして補完する", async () => {
  // 1 ページ目は満杯（30件）で継続し、2 ページ目で boundary(m1) に到達して停止する。
  fetchMessages
    .mockResolvedValueOnce(seq(70, MESSAGE_PAGE_SIZE)) // m70..m99
    .mockResolvedValueOnce(seq(1, MESSAGE_PAGE_SIZE)); // m1..m30（先頭が boundary）
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("m1", 1)] });
  });

  await reconnect();
  await act(async () => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m100", 100)],
    });
  });
  await flush();

  // 1 ページ目は oldestIncoming(m100)、2 ページ目はカーソル前進で m70 を起点に取得。
  expect(fetchMessages.mock.calls).toEqual([
    ["room-1", { createdAt: 100, id: "m100" }],
    ["room-1", { createdAt: 70, id: "m70" }],
  ]);
  // boundary 到達で 3 ページ目は呼ばれない。
  expect(fetchMessages).toHaveBeenCalledTimes(2);
  const ids = result.current.messages.map((m) => m.id);
  expect(ids).toHaveLength(MESSAGE_PAGE_SIZE * 2 + 1);
  expect(ids[0]).toBe("m1");
  expect(ids.at(-1)).toBe("m100");
});

test("補完で同一ページが返り続けてもカーソル不前進ガードで停止する", async () => {
  // サーバが退行して常に同じ満杯ページを返す異常系。無限ループしないこと。
  fetchMessages.mockResolvedValue(seq(70, MESSAGE_PAGE_SIZE)); // 毎回 m70..m99
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("m1", 1)] });
  });

  await reconnect();
  await act(async () => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m100", 100)],
    });
  });
  await flush();

  // 1 回目で m70 までカーソル前進、2 回目は同じ m70 が先頭で不前進 → 停止。
  expect(fetchMessages).toHaveBeenCalledTimes(2);
  expect(result.current.messages.at(-1)?.id).toBe("m100");
});

test("同一ミリ秒・id 違いの境界でも欠落を検出して補完する", async () => {
  // a と c は同じ createdAt=100。間の b（同 createdAt）が切断中に投稿された想定。
  fetchMessages.mockResolvedValue([msg("b", 100)]);
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("a", 100)] });
  });

  await reconnect();
  await act(async () => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("c", 100)] });
  });
  await flush();

  // createdAt 単独比較（100 > 100 = false）では検出できないケース。
  expect(fetchMessages).toHaveBeenCalledWith("room-1", {
    createdAt: 100,
    id: "c",
  });
  expect(result.current.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
});

test("欠落補完の REST が失敗してもクラッシュせず受信済みは保持する", async () => {
  fetchMessages.mockRejectedValue(new Error("network"));
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("m1", 1)] });
  });

  await reconnect();
  await act(async () => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({ type: "history", messages: [msg("m9", 9)] });
  });
  await flush();

  expect(fetchMessages).toHaveBeenCalled();
  // 補完は失敗したが history マージ分は残る。
  expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m9"]);
});

test("update は既存 id を差し替え、未ロードの未知 id は無視する", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m1", 1), msg("m2", 2)],
    });
  });
  act(() => {
    MockWebSocket.latest.receive({
      type: "update",
      message: { ...msg("m2", 2), body: "edited", editedAt: 5 },
    });
  });
  act(() => {
    // 表示範囲外の古いメッセージへの update。孤立挿入してはならない。
    MockWebSocket.latest.receive({
      type: "update",
      message: { ...msg("unknown", 0), body: "ghost" },
    });
  });

  expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  const edited = result.current.messages.find((m) => m.id === "m2");
  expect(edited?.body).toBe("edited");
  expect(edited?.editedAt).toBe(5);
});

test("新着 message は時系列位置に挿入し、重複 id は排除する", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));

  act(() => {
    MockWebSocket.latest.open();
    MockWebSocket.latest.receive({
      type: "history",
      messages: [msg("m1", 1), msg("m3", 3)],
    });
  });
  act(() => {
    MockWebSocket.latest.receive({ type: "message", message: msg("m2", 2) });
  });
  act(() => {
    // 同一 id の再送は重複させない。
    MockWebSocket.latest.receive({ type: "message", message: msg("m2", 2) });
  });

  expect(result.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
});
