import type { ChatMessage, ClientMessage, ServerMessage } from "@repo/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// REST 補完は本テストでは使わないが、import 解決のためモックする。
vi.mock("@/lib/rooms", () => ({ fetchMessages: vi.fn() }));

import { useRoomChat } from "@/lib/use-room-chat";

function msg(id: string, createdAt: number, body = `body-${id}`): ChatMessage {
  return {
    id,
    roomId: "room-1",
    userId: "user-1",
    userName: "user-1",
    body,
    attachments: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
  };
}

/** send() を捕捉し、open/message/close を手動発火できるモック。 */
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
  sent: ClientMessage[] = [];
  private listeners: Record<string, ((ev: unknown) => void)[]> = {};

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
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
  MockWebSocket.reset();
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("OPEN 中の送信は pending(sending) を作り nonce 付きで送出する", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });

  act(() => {
    result.current.send("やあ");
  });

  expect(result.current.pending).toHaveLength(1);
  const p = result.current.pending[0];
  expect(p?.status).toBe("sending");
  expect(p?.body).toBe("やあ");
  // 送出されたペイロードに本文と pending の nonce が乗る。
  expect(MockWebSocket.latest.sent).toHaveLength(1);
  expect(MockWebSocket.latest.sent[0]).toMatchObject({
    type: "message",
    body: "やあ",
    nonce: p?.nonce,
  });
});

test("nonce 一致の message 受信で pending を確定除去し messages に載せる", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("hi");
  });
  const nonce = result.current.pending[0]?.nonce as string;

  act(() => {
    MockWebSocket.latest.receive({
      type: "message",
      message: msg("m1", 1, "hi"),
      nonce,
    });
  });

  expect(result.current.pending).toHaveLength(0);
  expect(result.current.messages.map((m) => m.id)).toEqual(["m1"]);
});

test("nonce 無しの message 受信は messages に載るが pending には触れない", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("自分の保留");
  });
  expect(result.current.pending).toHaveLength(1);

  // 他クライアントの発言（nonce 無し）が届いても自分の保留は確定除去されない。
  act(() => {
    MockWebSocket.latest.receive({
      type: "message",
      message: msg("other", 1, "他者の発言"),
    });
  });

  expect(result.current.messages.map((m) => m.id)).toEqual(["other"]);
  expect(result.current.pending).toHaveLength(1);
  expect(result.current.pending[0]?.status).toBe("sending");
});

test("nonce 一致の error で pending を failed にし本文を保持する", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("速すぎる");
  });
  const nonce = result.current.pending[0]?.nonce as string;

  act(() => {
    MockWebSocket.latest.receive({
      type: "error",
      code: "rate_limited",
      message: "早すぎます",
      nonce,
    });
  });

  expect(result.current.pending).toHaveLength(1);
  expect(result.current.pending[0]?.status).toBe("failed");
  expect(result.current.pending[0]?.body).toBe("速すぎる");
  expect(result.current.errorMessage).toBe("早すぎます");
});

test("切断中の送信は queued になり再接続 open で flush される", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  // open していない（readyState 0 = 非 OPEN）。
  act(() => {
    result.current.send("あとで送る");
  });

  expect(result.current.pending[0]?.status).toBe("queued");
  expect(MockWebSocket.latest.sent).toHaveLength(0);

  const nonce = result.current.pending[0]?.nonce;
  act(() => {
    MockWebSocket.latest.open();
  });

  expect(result.current.pending[0]?.status).toBe("sending");
  expect(MockWebSocket.latest.sent).toHaveLength(1);
  expect(MockWebSocket.latest.sent[0]).toMatchObject({
    body: "あとで送る",
    nonce,
  });
});

test("nonce 一致の error は該当 pending のみ failed にし他は巻き込まない", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("1番目");
    result.current.send("2番目");
  });
  const secondNonce = result.current.pending[1]?.nonce as string;

  act(() => {
    MockWebSocket.latest.receive({
      type: "error",
      code: "rate_limited",
      message: "早すぎます",
      nonce: secondNonce,
    });
  });

  // 2番目だけ failed、1番目は sending のまま。
  const first = result.current.pending.find((p) => p.body === "1番目");
  const second = result.current.pending.find((p) => p.body === "2番目");
  expect(first?.status).toBe("sending");
  expect(second?.status).toBe("failed");
});

test("複数の queued は open で積んだ順に全件 flush され全て sending になる", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  // 非 OPEN のまま 3 件積む。
  act(() => {
    result.current.send("1番目");
    result.current.send("2番目");
    result.current.send("3番目");
  });
  expect(result.current.pending.every((p) => p.status === "queued")).toBe(true);
  expect(MockWebSocket.latest.sent).toHaveLength(0);

  act(() => {
    MockWebSocket.latest.open();
  });

  // 積んだ順に全件送出される。
  expect(MockWebSocket.latest.sent.map((m) => m.body)).toEqual(["1番目", "2番目", "3番目"]);
  expect(result.current.pending.every((p) => p.status === "sending")).toBe(true);
});

test("open の flush は queued のみ対象で failed は再送しない", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  // 1 件送って sending → 切断で failed 化。
  act(() => {
    result.current.send("失敗する");
  });
  act(() => {
    MockWebSocket.latest.close();
  });
  expect(result.current.pending[0]?.status).toBe("failed");

  // 再接続前（非 OPEN）に新規送信を積む → queued。
  act(() => {
    result.current.send("あとで送る");
  });

  // 再接続。flush 対象は queued のみで、failed は送出されない。
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  act(() => {
    MockWebSocket.latest.open();
  });

  expect(MockWebSocket.latest.sent.map((m) => m.body)).toEqual(["あとで送る"]);
  const failed = result.current.pending.find((p) => p.body === "失敗する");
  expect(failed?.status).toBe("failed");
});

test("retry 後に nonce 一致 message が来れば pending を確定除去する", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("確定したい");
  });
  const nonce = result.current.pending[0]?.nonce as string;
  // 切断で failed → 再接続 → retry。
  act(() => {
    MockWebSocket.latest.close();
  });
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.retry(nonce);
  });
  expect(result.current.pending[0]?.status).toBe("sending");

  // エコー（nonce 一致）到達で確定除去。
  act(() => {
    MockWebSocket.latest.receive({
      type: "message",
      message: msg("m1", 1, "確定したい"),
      nonce,
    });
  });
  expect(result.current.pending).toHaveLength(0);
  expect(result.current.messages.map((m) => m.id)).toEqual(["m1"]);
});

test("切断中の retry は送出せず queued に戻す", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("再送対象");
  });
  const nonce = result.current.pending[0]?.nonce as string;
  act(() => {
    MockWebSocket.latest.close();
  });
  expect(result.current.pending[0]?.status).toBe("failed");
  const sentBefore = MockWebSocket.latest.sent.length;

  // 非 OPEN のまま retry → 送出されず queued に戻る。
  act(() => {
    result.current.retry(nonce);
  });

  expect(result.current.pending[0]?.status).toBe("queued");
  expect(MockWebSocket.latest.sent.length).toBe(sentBefore);
});

test("送出中(sending)に切断されると failed になる", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("宙ぶらりん");
  });
  expect(result.current.pending[0]?.status).toBe("sending");

  act(() => {
    MockWebSocket.latest.close();
  });

  expect(result.current.pending[0]?.status).toBe("failed");
  expect(result.current.pending[0]?.body).toBe("宙ぶらりん");
});

test("retry は failed を再送して sending に戻す", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("再送したい");
  });
  const nonce = result.current.pending[0]?.nonce as string;
  // 切断で failed 化。
  act(() => {
    MockWebSocket.latest.close();
  });
  expect(result.current.pending[0]?.status).toBe("failed");

  // 再接続のソケットを開く。
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  act(() => {
    MockWebSocket.latest.open();
  });
  const sentBefore = MockWebSocket.latest.sent.length;

  act(() => {
    result.current.retry(nonce);
  });

  expect(result.current.pending[0]?.status).toBe("sending");
  expect(MockWebSocket.latest.sent.length).toBe(sentBefore + 1);
  expect(MockWebSocket.latest.sent.at(-1)).toMatchObject({
    body: "再送したい",
    nonce,
  });
});

test("discard は pending を取り除く", () => {
  const { result } = renderHook(() => useRoomChat("room-1"));
  act(() => {
    MockWebSocket.latest.open();
  });
  act(() => {
    result.current.send("やめる");
  });
  const nonce = result.current.pending[0]?.nonce as string;

  act(() => {
    result.current.discard(nonce);
  });

  expect(result.current.pending).toHaveLength(0);
});
