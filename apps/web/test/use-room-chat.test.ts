import { afterEach, expect, test } from "vitest";
import { roomWebSocketUrl } from "@/lib/use-room-chat";

const original = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = original;
});

test("未設定時は localhost の ws にフォールバックする", () => {
  delete process.env.NEXT_PUBLIC_API_URL;
  expect(roomWebSocketUrl("general")).toBe(
    "ws://localhost:8787/ws/room/general",
  );
});

test("https の API URL は wss に変換される", () => {
  process.env.NEXT_PUBLIC_API_URL = "https://chat.api.tom-chiba.com";
  expect(roomWebSocketUrl("general")).toBe(
    "wss://chat.api.tom-chiba.com/ws/room/general",
  );
});

test("roomId は URL エンコードされる", () => {
  process.env.NEXT_PUBLIC_API_URL = "https://chat.api.tom-chiba.com";
  expect(roomWebSocketUrl("a/b c")).toBe(
    "wss://chat.api.tom-chiba.com/ws/room/a%2Fb%20c",
  );
});
