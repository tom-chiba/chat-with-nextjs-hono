import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { signOut, useSession } from "@/lib/auth-client";

// 設定ページ自身のロジック（認証ガード・構成・ログアウト）に集中するため、
// 各設定セクションと router は差し替える。個々のフォームの挙動は別テストで担保する。
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/components/profile-form", () => ({
  ProfileForm: () => <div>profile-form</div>,
}));
vi.mock("@/components/email-change-form", () => ({
  EmailChangeForm: () => <div>email-change-form</div>,
}));
vi.mock("@/components/push-notification-control", () => ({
  PushNotificationControl: () => <div>push-control</div>,
}));
vi.mock("@/components/passkey-manager", () => ({
  PasskeyManager: () => <div>passkey-manager</div>,
}));

const mockedUseSession = vi.mocked(useSession);
const mockedSignOut = vi.mocked(signOut);

const SESSION = {
  data: { user: { id: "u1", name: "たろう", email: "taro@example.com" } },
  isPending: false,
} as unknown as ReturnType<typeof useSession>;

beforeEach(() => {
  vi.clearAllMocks();
});

test("読み込み中はローディングのみ表示し、リダイレクトしない", () => {
  mockedUseSession.mockReturnValue({
    data: null,
    isPending: true,
  } as unknown as ReturnType<typeof useSession>);

  render(<SettingsPage />);

  expect(screen.getByText("読み込み中…")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "設定" })).not.toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
});

test("未ログインならトップへリダイレクトし、設定 UI を描画しない", async () => {
  mockedUseSession.mockReturnValue({
    data: null,
    isPending: false,
  } as unknown as ReturnType<typeof useSession>);

  render(<SettingsPage />);

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  expect(screen.queryByRole("heading", { name: "設定" })).not.toBeInTheDocument();
});

test("ログイン時は設定系 UI 一式とユーザー名を表示する", () => {
  mockedUseSession.mockReturnValue(SESSION);

  render(<SettingsPage />);

  expect(screen.getByRole("heading", { name: "設定" })).toBeInTheDocument();
  expect(screen.getByText("たろう としてログイン中")).toBeInTheDocument();
  expect(screen.getByText("profile-form")).toBeInTheDocument();
  expect(screen.getByText("email-change-form")).toBeInTheDocument();
  expect(screen.getByText("push-control")).toBeInTheDocument();
  expect(screen.getByText("passkey-manager")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "← トップへ戻る" })).toHaveAttribute("href", "/");
});

test("ログアウトすると signOut を呼び、トップへ遷移する", async () => {
  mockedUseSession.mockReturnValue(SESSION);
  mockedSignOut.mockResolvedValue(undefined as never);

  render(<SettingsPage />);
  fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));

  await waitFor(() => expect(mockedSignOut).toHaveBeenCalled());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
});
