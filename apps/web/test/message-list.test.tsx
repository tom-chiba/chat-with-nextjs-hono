import type { ChatMessage } from "@repo/shared";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MessageList } from "@/components/message-list";
import type { PendingMessage } from "@/lib/use-room-chat";

function msg(id: string, createdAt: number): ChatMessage {
  return {
    id,
    roomId: "r1",
    userId: "u1",
    userName: "U1",
    body: `body-${id}`,
    attachments: [],
    createdAt,
    editedAt: null,
    deletedAt: null,
  };
}

function pending(nonce: string): PendingMessage {
  return { nonce, body: `pending-${nonce}`, status: "failed", createdAt: 1 };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  // jsdom は scrollIntoView 未実装のためスタブする。
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderList(messages: ChatMessage[], pendings: PendingMessage[]) {
  return render(
    <MessageList
      messages={messages}
      pending={pendings}
      onRetryPending={() => {}}
      onDiscardPending={() => {}}
      currentUserId="u1"
      hasMore={false}
      loadOlder={() => {}}
      loadingMore={false}
      editingId={null}
      editDraft=""
      onEditDraftChange={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSubmitDelete={() => {}}
    />,
  );
}

test("保留が末尾に滞留していても messages 伸長で最下部へ追従する", () => {
  // 初回描画で 1 回追従。
  const { rerender } = renderList([msg("m1", 1)], []);
  const afterInitial = scrollIntoView.mock.calls.length;
  expect(afterInitial).toBeGreaterThanOrEqual(1);

  // 送信失敗の保留が末尾に滞留（nonce が末尾鍵になる）。
  rerender(
    <MessageList
      messages={[msg("m1", 1)]}
      pending={[pending("p1")]}
      onRetryPending={() => {}}
      onDiscardPending={() => {}}
      currentUserId="u1"
      hasMore={false}
      loadOlder={() => {}}
      loadingMore={false}
      editingId={null}
      editDraft=""
      onEditDraftChange={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSubmitDelete={() => {}}
    />,
  );
  const afterPending = scrollIntoView.mock.calls.length;

  // 保留が滞留したまま他者の新着が届く。複合鍵なら messages 伸長を検知して追従する。
  rerender(
    <MessageList
      messages={[msg("m1", 1), msg("m2", 2)]}
      pending={[pending("p1")]}
      onRetryPending={() => {}}
      onDiscardPending={() => {}}
      currentUserId="u1"
      hasMore={false}
      loadOlder={() => {}}
      loadingMore={false}
      editingId={null}
      editDraft=""
      onEditDraftChange={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSubmitDelete={() => {}}
    />,
  );

  // messages が m2 で伸びた分、追従の scrollIntoView が増える（回帰防止）。
  expect(scrollIntoView.mock.calls.length).toBeGreaterThan(afterPending);
});
