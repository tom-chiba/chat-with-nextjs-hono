import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { EmailChangeForm } from "@/components/email-change-form";
import { changeEmail } from "@/lib/auth-client";

vi.mock("@/lib/auth-client", () => ({
  changeEmail: vi.fn(),
}));

const mockedChangeEmail = vi.mocked(changeEmail);

const CURRENT_EMAIL = "old@example.com";

beforeEach(() => {
  vi.clearAllMocks();
});

/** 「メールアドレスを変更」ボタンを押して入力欄を開く。 */
function openForm() {
  fireEvent.click(screen.getByRole("button", { name: "メールアドレスを編集" }));
}

test("変更に成功すると承認メール送信の案内を表示し、changeEmail を呼ぶ", async () => {
  mockedChangeEmail.mockResolvedValue({ data: { status: true }, error: null });

  render(<EmailChangeForm currentEmail={CURRENT_EMAIL} />);
  openForm();

  fireEvent.change(screen.getByPlaceholderText("新しいメールアドレス"), {
    target: { value: "new@example.org" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認メールを送る" }));

  expect(await screen.findByRole("status")).toHaveTextContent(CURRENT_EMAIL);
  expect(mockedChangeEmail).toHaveBeenCalledWith({
    newEmail: "new@example.org",
    callbackURL: window.location.origin,
  });
});

test("現在と同じメールアドレスなら送信せずにフォームを閉じる", async () => {
  render(<EmailChangeForm currentEmail={CURRENT_EMAIL} />);
  openForm();

  fireEvent.change(screen.getByPlaceholderText("新しいメールアドレス"), {
    // 大文字小文字が違っても同一とみなす。
    target: { value: "OLD@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認メールを送る" }));

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "メールアドレスを編集" }),
    ).toBeInTheDocument(),
  );
  expect(mockedChangeEmail).not.toHaveBeenCalled();
});

test("API エラー時はエラーメッセージを表示する", async () => {
  mockedChangeEmail.mockResolvedValue({
    data: null,
    error: { message: "このメールアドレスは使用できません" },
  });

  render(<EmailChangeForm currentEmail={CURRENT_EMAIL} />);
  openForm();

  fireEvent.change(screen.getByPlaceholderText("新しいメールアドレス"), {
    target: { value: "taken@example.org" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認メールを送る" }));

  expect(
    await screen.findByText("このメールアドレスは使用できません"),
  ).toBeInTheDocument();
});
