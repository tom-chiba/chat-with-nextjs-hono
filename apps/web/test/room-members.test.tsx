import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RoomMembers } from "@/components/room-members";
import {
  addRoomMember,
  listRoomMembers,
  removeRoomMember,
} from "@/lib/rooms";

vi.mock("@/lib/rooms", () => ({
  addRoomMember: vi.fn(),
  listRoomMembers: vi.fn(),
  removeRoomMember: vi.fn(),
}));

const mockedListRoomMembers = vi.mocked(listRoomMembers);
const mockedAddRoomMember = vi.mocked(addRoomMember);
const mockedRemoveRoomMember = vi.mocked(removeRoomMember);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("オーナーはメンバーを追加して一覧を再取得できる", async () => {
  mockedListRoomMembers
    .mockResolvedValueOnce([
      {
        userId: "owner-1",
        userName: "Owner",
        role: "owner",
        joinedAt: 1,
      },
    ])
    .mockResolvedValueOnce([
      {
        userId: "owner-1",
        userName: "Owner",
        role: "owner",
        joinedAt: 1,
      },
      {
        userId: "member-1",
        userName: "Member",
        role: "member",
        joinedAt: 2,
      },
    ]);
  mockedAddRoomMember.mockResolvedValue();

  render(<RoomMembers roomId="room-1" currentUserId="owner-1" />);

  fireEvent.click(await screen.findByText("メンバー (1)"));
  fireEvent.change(screen.getByPlaceholderText("追加するユーザーID"), {
    target: { value: "member-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "追加" }));

  await waitFor(() => {
    expect(mockedAddRoomMember).toHaveBeenCalledWith("room-1", "member-1");
  });
  expect(await screen.findByText("Member")).toBeInTheDocument();
  expect(mockedListRoomMembers).toHaveBeenCalledTimes(2);
});

test("オーナーは owner 以外のメンバーを削除できる", async () => {
  mockedListRoomMembers.mockResolvedValue([
    {
      userId: "owner-1",
      userName: "Owner",
      role: "owner",
      joinedAt: 1,
    },
    {
      userId: "member-1",
      userName: "Member",
      role: "member",
      joinedAt: 2,
    },
  ]);
  mockedRemoveRoomMember.mockResolvedValue();

  render(<RoomMembers roomId="room-1" currentUserId="owner-1" />);

  fireEvent.click(await screen.findByText("メンバー (2)"));
  fireEvent.click(screen.getByRole("button", { name: "削除" }));

  await waitFor(() => {
    expect(mockedRemoveRoomMember).toHaveBeenCalledWith("room-1", "member-1");
  });
  expect(screen.queryByText("Member")).not.toBeInTheDocument();
});

test("一般メンバーには追加フォームと削除ボタンを表示しない", async () => {
  mockedListRoomMembers.mockResolvedValue([
    {
      userId: "owner-1",
      userName: "Owner",
      role: "owner",
      joinedAt: 1,
    },
    {
      userId: "member-1",
      userName: "Member",
      role: "member",
      joinedAt: 2,
    },
  ]);

  render(<RoomMembers roomId="room-1" currentUserId="member-1" />);

  fireEvent.click(await screen.findByText("メンバー (2)"));

  expect(screen.queryByPlaceholderText("追加するユーザーID")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "削除" })).not.toBeInTheDocument();
});
