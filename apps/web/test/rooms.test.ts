import { beforeEach, describe, expect, test, vi } from "vitest";

// rpc クライアントをモックし、members.$post の応答を差し替えられるようにする。
const { post } = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/lib/rpc", () => ({
  client: {
    rooms: {
      ":roomId": {
        members: {
          $post: post,
        },
      },
    },
  },
}));

import { addRoomMember } from "@/lib/rooms";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addRoomMember", () => {
  test("成功時は email を json で送り解決する", async () => {
    post.mockResolvedValue({ ok: true });
    await expect(
      addRoomMember("room-1", "member@example.com"),
    ).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledWith({
      param: { roomId: "room-1" },
      json: { email: "member@example.com" },
    });
  });

  // 受け入れ条件「存在しない/既存/権限/不正をUIで判別できる」をステータス別文言で担保する。
  test.each([
    [403, "オーナーのみ追加できます"],
    [404, "そのメールアドレスのユーザーが見つかりません"],
    [409, "このユーザーは既にメンバーです"],
    [400, "メールアドレスの形式が正しくありません"],
    [500, "メンバーの追加に失敗しました"],
  ])("status %i は「%s」を投げる", async (status, message) => {
    post.mockResolvedValue({ ok: false, status });
    await expect(addRoomMember("room-1", "x@example.com")).rejects.toThrow(
      message,
    );
  });
});
