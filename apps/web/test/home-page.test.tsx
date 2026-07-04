import { render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import Home from "@/app/page";
import { useSession } from "@/lib/auth-client";

// トップは「設定系 UI が退避され、導線だけ残る」ことの確認に集中する。
// 重量級の子コンポーネントは差し替える。
vi.mock("@/lib/auth-client", () => ({
  useSession: vi.fn(),
}));
vi.mock("@/components/auth-form", () => ({
  AuthForm: () => <div>auth-form</div>,
}));
vi.mock("@/components/chat-room", () => ({
  ChatRoom: () => <div>chat-room</div>,
}));
vi.mock("@/components/room-list", () => ({
  RoomList: forwardRef(function RoomList() {
    return <div>room-list</div>;
  }),
}));

const mockedUseSession = vi.mocked(useSession);

beforeEach(() => {
  vi.clearAllMocks();
});

test("ログイン時は設定への導線を表示し、設定系 UI はトップに置かない", () => {
  mockedUseSession.mockReturnValue({
    data: { user: { id: "u1", name: "たろう", email: "taro@example.com" } },
    isPending: false,
  } as unknown as ReturnType<typeof useSession>);

  render(<Home />);

  // 設定への歯車リンク（/settings 遷移）だけが導線として残る。
  const link = screen.getByRole("link", { name: "設定" });
  expect(link).toHaveAttribute("href", "/settings");

  // トップ本体はルーム一覧・チャットに集中する。
  expect(screen.getByText("room-list")).toBeInTheDocument();

  // 退避済みの設定系 UI がトップに残っていないこと。
  // これらの子コンポーネントはあえて mock せず、トップへ再追加する回帰が
  // 起きれば実コンポーネントの目印テキストが現れて検出できるようにする。
  expect(screen.queryByText(/としてログイン中/)).not.toBeInTheDocument();
  expect(screen.queryByText("表示名を変更")).not.toBeInTheDocument(); // ProfileForm
  expect(screen.queryByText("メールアドレスを変更")).not.toBeInTheDocument(); // EmailChangeForm
  expect(screen.queryByRole("button", { name: /通知/ })).not.toBeInTheDocument(); // PushNotificationControl
  expect(
    screen.queryByRole("heading", { name: "パスキー" }),
  ).not.toBeInTheDocument(); // PasskeyManager
  expect(
    screen.queryByRole("button", { name: "ログアウト" }),
  ).not.toBeInTheDocument();
});

test("未ログイン時は AuthForm を表示し、設定導線は出さない", () => {
  mockedUseSession.mockReturnValue({
    data: null,
    isPending: false,
  } as unknown as ReturnType<typeof useSession>);

  render(<Home />);

  expect(screen.getByText("auth-form")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "設定" })).not.toBeInTheDocument();
});
