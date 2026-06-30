import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PasskeyManager } from "@/components/passkey-manager";
import {
  type Passkey,
  addPasskey,
  deletePasskey,
  listPasskeys,
} from "@/lib/passkeys";

vi.mock("@/lib/passkeys", () => ({
  listPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

const mockedListPasskeys = vi.mocked(listPasskeys);
const mockedAddPasskey = vi.mocked(addPasskey);
const mockedDeletePasskey = vi.mocked(deletePasskey);

/** 表示に必要なフィールドだけ満たすパスキーを作る。 */
function passkey(over: Partial<Passkey> & { id: string }): Passkey {
  return { name: null, createdAt: new Date("2026-06-30"), ...over } as Passkey;
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom には WebAuthn が無いため、対応ブラウザとして振る舞わせる。
  vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("登録済みパスキーの一覧を表示する", async () => {
  mockedListPasskeys.mockResolvedValue([
    passkey({ id: "pk-1", name: "My Passkey" }),
  ]);

  render(<PasskeyManager />);

  expect(await screen.findByText("My Passkey")).toBeInTheDocument();
});

test("パスキーが無いときは空表示にする", async () => {
  mockedListPasskeys.mockResolvedValue([]);

  render(<PasskeyManager />);

  expect(
    await screen.findByText("登録済みのパスキーはありません。"),
  ).toBeInTheDocument();
});

test("パスキーを追加して一覧を再取得する", async () => {
  mockedListPasskeys
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([passkey({ id: "pk-1", name: "New Key" })]);
  mockedAddPasskey.mockResolvedValue();

  render(<PasskeyManager />);

  await screen.findByText("登録済みのパスキーはありません。");
  fireEvent.change(screen.getByPlaceholderText("パスキー名（任意）"), {
    target: { value: "New Key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "パスキーを追加" }));

  await waitFor(() => {
    expect(mockedAddPasskey).toHaveBeenCalledWith("New Key");
  });
  expect(await screen.findByText("New Key")).toBeInTheDocument();
  expect(mockedListPasskeys).toHaveBeenCalledTimes(2);
});

test("追加に失敗するとエラー文言を表示し再取得しない", async () => {
  mockedListPasskeys.mockResolvedValue([]);
  mockedAddPasskey.mockRejectedValue(new Error("パスキーの登録に失敗しました"));

  render(<PasskeyManager />);

  await screen.findByText("登録済みのパスキーはありません。");
  fireEvent.click(screen.getByRole("button", { name: "パスキーを追加" }));

  expect(
    await screen.findByText("パスキーの登録に失敗しました"),
  ).toBeInTheDocument();
  // 一覧の再取得は初回のみ（追加失敗時はリロードしない）。
  expect(mockedListPasskeys).toHaveBeenCalledTimes(1);
});

test("パスキーを削除して一覧を再取得する", async () => {
  mockedListPasskeys
    .mockResolvedValueOnce([passkey({ id: "pk-1", name: "My Passkey" })])
    .mockResolvedValueOnce([]);
  mockedDeletePasskey.mockResolvedValue();

  render(<PasskeyManager />);

  fireEvent.click(await screen.findByRole("button", { name: "このパスキーを削除" }));

  await waitFor(() => {
    expect(mockedDeletePasskey).toHaveBeenCalledWith("pk-1");
  });
  expect(screen.queryByText("My Passkey")).not.toBeInTheDocument();
});

test("取得に失敗するとエラー文言を表示する", async () => {
  mockedListPasskeys.mockRejectedValue(new Error("パスキーの取得に失敗しました"));

  render(<PasskeyManager />);

  expect(
    await screen.findByText("パスキーの取得に失敗しました"),
  ).toBeInTheDocument();
});

test("非対応ブラウザではフォールバックを表示する", () => {
  vi.stubGlobal("PublicKeyCredential", undefined);

  render(<PasskeyManager />);

  expect(
    screen.getByText("このブラウザはパスキーに対応していません。"),
  ).toBeInTheDocument();
  expect(mockedListPasskeys).not.toHaveBeenCalled();
});
