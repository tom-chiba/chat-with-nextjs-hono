import { beforeEach, describe, expect, test, vi } from "vitest";

// Better Auth クライアントの passkey メソッドをモックし、応答を差し替えられるようにする。
const { listUserPasskeys, addPasskey, deletePasskey } = vi.hoisted(() => ({
  listUserPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    passkey: { listUserPasskeys, addPasskey, deletePasskey },
  },
}));

import {
  addPasskey as addPasskeyWrapper,
  deletePasskey as deletePasskeyWrapper,
  listPasskeys,
} from "@/lib/passkeys";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPasskeys", () => {
  test("成功時はパスキー配列を返す", async () => {
    listUserPasskeys.mockResolvedValue({
      data: [{ id: "pk-1" }],
      error: null,
    });
    await expect(listPasskeys()).resolves.toEqual([{ id: "pk-1" }]);
  });

  test("data が null のときは空配列を返す", async () => {
    listUserPasskeys.mockResolvedValue({ data: null, error: null });
    await expect(listPasskeys()).resolves.toEqual([]);
  });

  test("error.message があればそれを、無ければ固定文言を投げる", async () => {
    listUserPasskeys.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    await expect(listPasskeys()).rejects.toThrow("boom");

    listUserPasskeys.mockResolvedValue({ data: null, error: {} });
    await expect(listPasskeys()).rejects.toThrow("パスキーの取得に失敗しました");
  });
});

describe("addPasskey", () => {
  test("名前ありのときは { name } を渡す", async () => {
    addPasskey.mockResolvedValue({ data: {}, error: null });
    await addPasskeyWrapper("My Key");
    expect(addPasskey).toHaveBeenCalledWith({ name: "My Key" });
  });

  test("名前なしのときは undefined を渡す", async () => {
    addPasskey.mockResolvedValue({ data: {}, error: null });
    await addPasskeyWrapper();
    expect(addPasskey).toHaveBeenCalledWith(undefined);
  });

  test("error があれば message 優先で投げる", async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { message: "cancelled" },
    });
    await expect(addPasskeyWrapper("x")).rejects.toThrow("cancelled");

    addPasskey.mockResolvedValue({ data: null, error: {} });
    await expect(addPasskeyWrapper("x")).rejects.toThrow("パスキーの登録に失敗しました");
  });
});

describe("deletePasskey", () => {
  test("id を渡して解決する", async () => {
    deletePasskey.mockResolvedValue({ data: {}, error: null });
    await expect(deletePasskeyWrapper("pk-1")).resolves.toBeUndefined();
    expect(deletePasskey).toHaveBeenCalledWith({ id: "pk-1" });
  });

  test("error があれば message 優先で、無ければ固定文言を投げる", async () => {
    deletePasskey.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    await expect(deletePasskeyWrapper("pk-1")).rejects.toThrow("not found");

    deletePasskey.mockResolvedValue({ data: null, error: {} });
    await expect(deletePasskeyWrapper("pk-1")).rejects.toThrow("パスキーの削除に失敗しました");
  });
});
