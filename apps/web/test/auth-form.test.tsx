import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AuthForm } from "@/components/auth-form";
import { requestPasswordReset, sendVerificationEmail, signIn, signUp } from "@/lib/auth-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/auth-client", () => ({
  signIn: { email: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));

const mockedSignInEmail = vi.mocked(signIn.email);
const mockedSignUpEmail = vi.mocked(signUp.email);
const mockedRequestPasswordReset = vi.mocked(requestPasswordReset);
const mockedSendVerificationEmail = vi.mocked(sendVerificationEmail);

const EMAIL = "user@example.com";
const PASSWORD = "password1234"; // MIN_PASSWORD_LENGTH(12) を満たす

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * フォームの送信ボタンを押す。
 * ログインモードではタブ「ログイン」と送信ボタン「ログイン」が同名になるため、
 * type="submit" のボタンに限定して押下する。
 */
function submitForm(name: string) {
  const submitButton = screen
    .getAllByRole("button", { name })
    .find((button) => (button as HTMLButtonElement).type === "submit");
  if (!submitButton) throw new Error(`submit button not found: ${name}`);
  fireEvent.click(submitButton);
}

/** 指定モードで必須項目を埋める。 */
function fillCredentials({ withName = false }: { withName?: boolean } = {}) {
  if (withName) {
    fireEvent.change(screen.getByPlaceholderText("表示名"), {
      target: { value: "テスト太郎" },
    });
  }
  fireEvent.change(screen.getByPlaceholderText("メールアドレス"), {
    target: { value: EMAIL },
  });
  fireEvent.change(screen.getByPlaceholderText(/パスワード/), {
    target: { value: PASSWORD },
  });
}

test("サインアップ成功で検証待ちの案内と対象アドレスを表示する", async () => {
  mockedSignUpEmail.mockResolvedValue({ error: null } as never);

  render(<AuthForm />);
  fireEvent.click(screen.getByRole("button", { name: "サインアップ" }));
  fillCredentials({ withName: true });
  submitForm("登録");

  expect(await screen.findByText("メールアドレスの確認が必要です")).toBeInTheDocument();
  expect(screen.getByText(EMAIL)).toBeInTheDocument();
  expect(mockedSignUpEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      email: EMAIL,
      password: PASSWORD,
      name: "テスト太郎",
      callbackURL: window.location.origin,
    }),
  );
});

test("未検証ログイン(403)は汎用エラーではなく専用案内を表示する", async () => {
  mockedSignInEmail.mockResolvedValue({
    error: { status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
  } as never);

  render(<AuthForm />);
  fillCredentials();
  submitForm("ログイン");

  expect(await screen.findByText("メールアドレスの確認が必要です")).toBeInTheDocument();
  expect(screen.getByText(EMAIL)).toBeInTheDocument();
  // 汎用エラー・サーバ生メッセージは出さない。
  expect(screen.queryByText("ログインに失敗しました")).not.toBeInTheDocument();
  expect(screen.queryByText("Email not verified")).not.toBeInTheDocument();
});

test("403 以外のログイン失敗は従来どおり汎用エラーを表示する", async () => {
  mockedSignInEmail.mockResolvedValue({
    error: { status: 401, message: "認証情報が正しくありません" },
  } as never);

  render(<AuthForm />);
  fillCredentials();
  submitForm("ログイン");

  expect(await screen.findByText("認証情報が正しくありません")).toBeInTheDocument();
  expect(screen.queryByText("メールアドレスの確認が必要です")).not.toBeInTheDocument();
});

test("EMAIL_NOT_VERIFIED 以外の 403 は検証案内ではなく汎用エラーにする", async () => {
  mockedSignInEmail.mockResolvedValue({
    error: { status: 403, code: "USER_BANNED", message: "アカウントが停止されています" },
  } as never);

  render(<AuthForm />);
  fillCredentials();
  submitForm("ログイン");

  expect(await screen.findByText("アカウントが停止されています")).toBeInTheDocument();
  expect(screen.queryByText("メールアドレスの確認が必要です")).not.toBeInTheDocument();
});

test("タブを切り替えると検証待ちの案内をクリアする", async () => {
  mockedSignInEmail.mockResolvedValue({
    error: { status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
  } as never);

  render(<AuthForm />);
  fillCredentials();
  submitForm("ログイン");

  // 未検証ログインで案内が表示される。
  expect(await screen.findByText("メールアドレスの確認が必要です")).toBeInTheDocument();

  // サインアップタブへ切り替えると、文脈に合わない案内は消える。
  fireEvent.click(screen.getByRole("button", { name: "サインアップ" }));
  expect(screen.queryByText("メールアドレスの確認が必要です")).not.toBeInTheDocument();
});

test("再送ボタンで確認メールを再送し成功メッセージを表示する", async () => {
  mockedSignInEmail.mockResolvedValue({
    error: { status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" },
  } as never);
  mockedSendVerificationEmail.mockResolvedValue({ error: null } as never);

  render(<AuthForm />);
  fillCredentials();
  submitForm("ログイン");

  fireEvent.click(await screen.findByRole("button", { name: "確認メールを再送する" }));

  await waitFor(() => {
    expect(mockedSendVerificationEmail).toHaveBeenCalledWith({
      email: EMAIL,
      callbackURL: window.location.origin,
    });
  });
  expect(
    await screen.findByText("確認メールを再送しました。受信箱をご確認ください。"),
  ).toBeInTheDocument();
});

test("ログインモードでは「デモを試す」からゲストデモへ遷移する", () => {
  render(<AuthForm />);
  fireEvent.click(screen.getByRole("button", { name: "デモを試す" }));
  expect(push).toHaveBeenCalledWith("/demo");
});

test("サインアップ/パスワード忘れモードでは「デモを試す」を出さない", () => {
  render(<AuthForm />);
  // ログインモードでは出る。
  expect(screen.getByRole("button", { name: "デモを試す" })).toBeInTheDocument();

  // サインアップへ切り替えると隠れる。
  fireEvent.click(screen.getByRole("button", { name: "サインアップ" }));
  expect(screen.queryByRole("button", { name: "デモを試す" })).not.toBeInTheDocument();

  // ログインへ戻り、パスワード忘れへ進むと再び隠れる。
  fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  fireEvent.click(screen.getByRole("button", { name: "パスワードを忘れた方" }));
  expect(screen.queryByRole("button", { name: "デモを試す" })).not.toBeInTheDocument();
});

test("パスワード忘れ導線は検証案内に影響しない", async () => {
  mockedRequestPasswordReset.mockResolvedValue({ error: null } as never);

  render(<AuthForm />);
  fireEvent.click(screen.getByRole("button", { name: "パスワードを忘れた方" }));
  fireEvent.change(screen.getByPlaceholderText("メールアドレス"), {
    target: { value: EMAIL },
  });
  submitForm("再設定メールを送る");

  expect(
    await screen.findByText(
      "パスワード再設定用のメールを送信しました。メール内のリンクから再設定してください。",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("メールアドレスの確認が必要です")).not.toBeInTheDocument();
});
