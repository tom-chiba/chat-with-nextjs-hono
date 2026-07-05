import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PendingMessageItem } from "@/components/pending-message-item";
import type { PendingMessage } from "@/lib/use-room-chat";

function pending(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    nonce: "n1",
    body: "本文",
    status: "sending",
    createdAt: 1,
    ...overrides,
  };
}

function renderItem(p: PendingMessage) {
  const onRetry = vi.fn();
  const onDiscard = vi.fn();
  render(<PendingMessageItem pending={p} onRetry={onRetry} onDiscard={onDiscard} />);
  return { onRetry, onDiscard };
}

test("送信中は注記を出し再送 / 破棄ボタンを出さない", () => {
  renderItem(pending({ status: "sending" }));
  expect(screen.getByText("送信中…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "再送" })).not.toBeInTheDocument();
});

test("送信待ち（切断中）は再接続後に送る旨を注記する", () => {
  renderItem(pending({ status: "queued" }));
  expect(screen.getByText("送信待ち（再接続後に送信します）")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "再送" })).not.toBeInTheDocument();
});

test("失敗時は本文を保持し、再送 / 破棄でコールバックを nonce 付きで呼ぶ", () => {
  const { onRetry, onDiscard } = renderItem(
    pending({ status: "failed", body: "失敗本文", nonce: "abc" }),
  );
  expect(screen.getByText("送信に失敗しました")).toBeInTheDocument();
  // 本文は失われず残る。
  expect(screen.getByText("失敗本文")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "再送" }));
  expect(onRetry).toHaveBeenCalledWith("abc");

  fireEvent.click(screen.getByRole("button", { name: "破棄" }));
  expect(onDiscard).toHaveBeenCalledWith("abc");
});
