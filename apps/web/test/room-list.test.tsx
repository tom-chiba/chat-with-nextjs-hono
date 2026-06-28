import { MAX_ROOM_NAME_LENGTH } from "@repo/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RoomList } from "@/components/room-list";
import { ROOM_NAME_TOO_LONG_MESSAGE } from "@/lib/length";
import { createRoom, listRooms, updateRoomName } from "@/lib/rooms";

vi.mock("@/lib/rooms", () => ({
  listRooms: vi.fn(),
  createRoom: vi.fn(),
  deleteRoom: vi.fn(),
  updateRoomName: vi.fn(),
}));

const mockedListRooms = vi.mocked(listRooms);
const mockedCreateRoom = vi.mocked(createRoom);
const mockedUpdateRoomName = vi.mocked(updateRoomName);

const ownerRoom = {
  id: "r1",
  name: "部屋",
  createdAt: 1,
  unreadCount: 0,
  myRole: "owner" as const,
};

/** オーナーのルームを 1 件表示し、改名フォームを開いてその入力欄を返す。 */
async function openEditForm() {
  mockedListRooms.mockResolvedValue([ownerRoom]);
  render(<RoomList selectedRoomId="r1" onSelect={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "ルーム名を編集" }));
  return screen.getByDisplayValue("部屋");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedListRooms.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderRoomList() {
  render(<RoomList selectedRoomId={null} onSelect={vi.fn()} />);
  // 初回マウントの listRooms 解決を待ってから検証する。
  return screen.findByPlaceholderText("新しいルーム名");
}

test("ルーム名が上限を超えると作成ボタンを無効化し注記を表示する", async () => {
  const input = await renderRoomList();
  // 絵文字は String.length では上限の 2 倍だが、書記素数では 1 文字あたり 1。
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) },
  });

  expect(screen.getByRole("button", { name: "作成" })).toBeDisabled();
  expect(screen.getByText(ROOM_NAME_TOO_LONG_MESSAGE)).toBeInTheDocument();
});

test("ルーム名が上限ちょうど（絵文字）なら作成でき注記を出さない", async () => {
  const input = await renderRoomList();
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH) },
  });

  expect(screen.getByRole("button", { name: "作成" })).toBeEnabled();
  expect(screen.queryByText(ROOM_NAME_TOO_LONG_MESSAGE)).not.toBeInTheDocument();
});

test("上限超過のまま作成フォームを submit しても createRoom を呼ばない", async () => {
  const input = await renderRoomList();
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) },
  });
  fireEvent.submit(input);

  expect(mockedCreateRoom).not.toHaveBeenCalled();
});

test("改名が上限を超えると保存ボタンを無効化し注記を表示する", async () => {
  const input = await openEditForm();
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) },
  });

  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  expect(screen.getByText(ROOM_NAME_TOO_LONG_MESSAGE)).toBeInTheDocument();
});

test("改名が上限ちょうど（絵文字）なら保存でき注記を出さない", async () => {
  const input = await openEditForm();
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH) },
  });

  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
  expect(screen.queryByText(ROOM_NAME_TOO_LONG_MESSAGE)).not.toBeInTheDocument();
});

test("改名が上限超過のまま submit しても updateRoomName を呼ばない", async () => {
  const input = await openEditForm();
  fireEvent.change(input, {
    target: { value: "😀".repeat(MAX_ROOM_NAME_LENGTH + 1) },
  });
  fireEvent.submit(input);

  expect(mockedUpdateRoomName).not.toHaveBeenCalled();
});
