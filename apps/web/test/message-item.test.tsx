import type { ChatMessage } from "@repo/shared";
import { MAX_MESSAGE_LENGTH } from "@repo/shared";
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MessageItem } from "@/components/message-item";
import { MESSAGE_TOO_LONG_MESSAGE } from "@/lib/length";

const baseMessage: ChatMessage = {
  id: "m1",
  roomId: "r1",
  userId: "u1",
  userName: "Alice",
  body: "hello",
  attachments: [],
  createdAt: 1,
  editedAt: null,
  deletedAt: null,
};

function renderEditing(editDraft: string) {
  return render(
    <MessageItem
      message={baseMessage}
      prevMessage={undefined}
      currentUserId="u1"
      isEditing={true}
      editDraft={editDraft}
      onEditDraftChange={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSubmitDelete={() => {}}
    />,
  );
}

test("編集本文が上限を超えると保存ボタンを無効化し注記を表示する", () => {
  // 絵文字は String.length では上限の 2 倍だが、書記素数で 1 文字あたり 1 と数えるため
  // 「書記素数が上限 +1」のときだけ超過になることを確認する。
  renderEditing("😀".repeat(MAX_MESSAGE_LENGTH + 1));

  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByText(MESSAGE_TOO_LONG_MESSAGE)).toBeInTheDocument();
});

test("編集本文が上限ちょうど（絵文字）なら保存でき注記を出さない", () => {
  renderEditing("😀".repeat(MAX_MESSAGE_LENGTH));

  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  expect(screen.queryByText(MESSAGE_TOO_LONG_MESSAGE)).not.toBeInTheDocument();
});
