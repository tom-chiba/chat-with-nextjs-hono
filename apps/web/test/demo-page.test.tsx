import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import DemoPage from "@/app/demo/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** window.matchMedia を「pointer: coarse に一致（タッチ端末）」として差し替える。 */
function stubCoarsePointer() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("coarse"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** コンポーザーの入力欄にメッセージを打ち込んで送信する。 */
function sendMessage(body: string) {
  fireEvent.change(screen.getByPlaceholderText(/メッセージを入力/), {
    target: { value: body },
  });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
}

test("初期状態で選択ルームのメッセージとメンバーを表示する", () => {
  render(<DemoPage />);
  expect(screen.getByText("デモモード")).toBeInTheDocument();
  // r1（雑談）の既存メッセージ。
  expect(screen.getByText("おはようございます！今日もよろしくお願いします。")).toBeInTheDocument();
  expect(screen.getByText("今日")).toBeInTheDocument();
});

test("既存メッセージのあるルームへ送信しても日付区切りは1つのまま", () => {
  render(<DemoPage />);
  // r1（雑談）には既存メッセージがあり、先頭に「今日」の日付区切りが 1 つある。
  expect(screen.getAllByText("今日")).toHaveLength(1);
  // 送信メッセージも同じ暦日として扱うため、区切りは増えず 1 つのまま
  // （createdAt を揃えて先頭以外に区切りを出さない不変条件をピン留めする）。
  sendMessage("追記です");
  expect(screen.getByText("追記です")).toBeInTheDocument();
  expect(screen.getAllByText("今日")).toHaveLength(1);
});

test("空の入力では送信ボタンが無効", () => {
  render(<DemoPage />);
  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText(/メッセージを入力/), {
    target: { value: "こんにちは" },
  });
  expect(screen.getByRole("button", { name: "送信" })).toBeEnabled();
});

test("メッセージ送信で自分の発言として追加される", () => {
  render(<DemoPage />);
  sendMessage("はじめまして");
  expect(screen.getByText("はじめまして")).toBeInTheDocument();
  // 送信者「あなた」として表示される。
  expect(screen.getByText("あなた")).toBeInTheDocument();
  // 送信後は入力欄がクリアされる。
  expect((screen.getByPlaceholderText(/メッセージを入力/) as HTMLTextAreaElement).value).toBe("");
});

test("初期選択ルーム（雑談）には未読バッジが出ない", () => {
  render(<DemoPage />);
  // 在室中のルームは既読扱い。未読バッジ 2 は未選択のプロジェクトA に付く。
  const chatRoom = screen.getByRole("button", { name: /雑談/ });
  expect(chatRoom.textContent).not.toContain("2");
  expect(screen.getByRole("button", { name: /プロジェクトA/ }).textContent).toContain("2");
});

test("ルームを切り替えると未読バッジがクリアされる", () => {
  render(<DemoPage />);
  // プロジェクトA には未読 2 件のバッジがある。
  expect(screen.getByText("2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /プロジェクトA/ }));
  expect(screen.queryByText("2")).not.toBeInTheDocument();
});

test("ルームを作成して選択状態にする", () => {
  render(<DemoPage />);
  fireEvent.change(screen.getByLabelText("新しいルーム名"), {
    target: { value: "新規ルーム" },
  });
  fireEvent.click(screen.getByRole("button", { name: "作成" }));
  // ヘッダーのルーム名に反映される（一覧とヘッダーで 2 箇所以上）。
  expect(screen.getAllByText("新規ルーム").length).toBeGreaterThan(0);
  // 作成直後は空ルームのため空状態メッセージが出る。
  expect(screen.getByText("まだメッセージはありません。")).toBeInTheDocument();
});

test("自分のメッセージを編集できる", () => {
  render(<DemoPage />);
  sendMessage("編集前");
  fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));
  const editArea = screen.getByDisplayValue("編集前");
  fireEvent.change(editArea, { target: { value: "編集後" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByText("編集後")).toBeInTheDocument();
  expect(screen.getByText("（編集済み）")).toBeInTheDocument();
});

test("自分のメッセージを削除するとプレースホルダになる", () => {
  render(<DemoPage />);
  sendMessage("消します");
  fireEvent.click(screen.getByRole("button", { name: "メッセージを削除" }));
  expect(screen.getByText("（このメッセージは削除されました）")).toBeInTheDocument();
  expect(screen.queryByText("消します")).not.toBeInTheDocument();
});

test("画像添付ダミーは最大 4 枚まで追加できる", () => {
  render(<DemoPage />);
  // ＋メニューから 1 枚目を追加する。
  fireEvent.click(screen.getByRole("button", { name: "画像を添付" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "画像を追加（デモ用ダミー）" }));
  // 以降は末尾の「＋」ボタンから追加し、4 枚に達したら「＋」は消える。
  fireEvent.click(screen.getByLabelText("画像を追加"));
  fireEvent.click(screen.getByLabelText("画像を追加"));
  fireEvent.click(screen.getByLabelText("画像を追加"));
  expect(screen.getAllByLabelText("添付を削除")).toHaveLength(4);
  expect(screen.queryByLabelText("画像を追加")).not.toBeInTheDocument();
  // 上限到達後は、ペーパークリップのメニュー項目も無効化される。
  fireEvent.click(screen.getByRole("button", { name: "画像を添付" }));
  expect(screen.getByRole("menuitem", { name: "画像を追加（デモ用ダミー）" })).toBeDisabled();
});

test("メンバー一覧を開いて役割を表示する", () => {
  render(<DemoPage />);
  fireEvent.click(screen.getByRole("button", { name: /メンバー/ }));
  const dialog = screen.getByRole("dialog", { name: "メンバー一覧" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByText("owner")).toBeInTheDocument();
  expect(screen.getAllByText("member")).toHaveLength(2);
});

test("Enter キーでメッセージを送信する", () => {
  render(<DemoPage />);
  const textarea = screen.getByPlaceholderText(/メッセージを入力/);
  fireEvent.change(textarea, { target: { value: "エンターで送信" } });
  fireEvent.keyDown(textarea, { key: "Enter" });
  expect(screen.getByText("エンターで送信")).toBeInTheDocument();
});

test("Shift+Enter では送信しない（改行扱い）", () => {
  render(<DemoPage />);
  const textarea = screen.getByPlaceholderText(/メッセージを入力/);
  fireEvent.change(textarea, { target: { value: "改行する" } });
  fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
  // 自分の発言は追加されない。
  expect(screen.queryByText("あなた")).not.toBeInTheDocument();
});

test("IME 変換確定中の Enter では送信しない", () => {
  render(<DemoPage />);
  const textarea = screen.getByPlaceholderText(/メッセージを入力/);
  fireEvent.change(textarea, { target: { value: "へんかんちゅう" } });
  fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
  expect(screen.queryByText("あなた")).not.toBeInTheDocument();
});

test("タッチ端末では Enter で送信せず改行する", () => {
  stubCoarsePointer();
  render(<DemoPage />);
  // プレースホルダから Shift+Enter の案内が消える。
  const textarea = screen.getByPlaceholderText("メッセージを入力");
  fireEvent.change(textarea, { target: { value: "スマホで改行" } });
  // fireEvent は preventDefault されなければ true を返す。改行（既定動作）を
  // 握りつぶしていないこと＝送信していないことを確認する。
  const notPrevented = fireEvent.keyDown(textarea, { key: "Enter" });
  expect(notPrevented).toBe(true);
  // 送信されないため自分の発言は追加されない。
  expect(screen.queryByText("あなた")).not.toBeInTheDocument();
});

test("タッチ端末でも送信ボタンからは送信できる", () => {
  stubCoarsePointer();
  render(<DemoPage />);
  const textarea = screen.getByPlaceholderText("メッセージを入力");
  fireEvent.change(textarea, { target: { value: "ボタンで送る" } });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
  expect(screen.getByText("ボタンで送る")).toBeInTheDocument();
});

test("同一送信者の連続発言では送信者名を集約する", () => {
  render(<DemoPage />);
  // r1 は先頭 2 件が「アオイ」の連続。著者名の表示は先頭のみ = 1 回。
  expect(screen.getAllByText("アオイ")).toHaveLength(1);
});

test("他者のメッセージには編集/削除アクションが出ない", () => {
  render(<DemoPage />);
  // 初期メッセージはすべて他者（アオイ/ユウキ）で、自分の発言はまだない。
  expect(screen.queryByRole("button", { name: "メッセージを編集" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "メッセージを削除" })).not.toBeInTheDocument();
});

test("添付のみ（本文なし）で送信でき、送信後にサムネがクリアされる", () => {
  render(<DemoPage />);
  // 初期状態では添付画像プレースホルダは 1 件（アオイの m2）のみ。
  expect(screen.getAllByText("image")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "画像を添付" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "画像を追加（デモ用ダミー）" }));
  // 本文が空でも添付があれば送信ボタンは有効。
  const send = screen.getByRole("button", { name: "送信" });
  expect(send).toBeEnabled();
  fireEvent.click(send);
  // 自分のメッセージとして添付が増え、コンポーザーのサムネはクリアされる。
  expect(screen.getByText("あなた")).toBeInTheDocument();
  expect(screen.getAllByText("image")).toHaveLength(2);
  expect(screen.queryByLabelText("添付を削除")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
});

test("メンバー一覧を閉じられる", () => {
  render(<DemoPage />);
  fireEvent.click(screen.getByRole("button", { name: /メンバー/ }));
  expect(screen.getByRole("dialog", { name: "メンバー一覧" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("✕"));
  expect(screen.queryByRole("dialog", { name: "メンバー一覧" })).not.toBeInTheDocument();
});

test("編集を空文字で保存しても削除されず編集モードを抜ける", () => {
  render(<DemoPage />);
  sendMessage("残るはず");
  fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));
  fireEvent.change(screen.getByDisplayValue("残るはず"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByText("残るはず")).toBeInTheDocument();
  expect(screen.queryByText("（このメッセージは削除されました）")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "メッセージを編集" })).toBeInTheDocument();
});

test("編集を取消すと変更が破棄される", () => {
  render(<DemoPage />);
  sendMessage("元のまま");
  fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));
  fireEvent.change(screen.getByDisplayValue("元のまま"), {
    target: { value: "書き換え途中" },
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByText("元のまま")).toBeInTheDocument();
  expect(screen.queryByText("書き換え途中")).not.toBeInTheDocument();
});

test("送信前に添付を削除でき、上限で消えた「+」が再表示される", () => {
  render(<DemoPage />);
  fireEvent.click(screen.getByRole("button", { name: "画像を添付" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "画像を追加（デモ用ダミー）" }));
  fireEvent.click(screen.getByLabelText("画像を追加"));
  fireEvent.click(screen.getByLabelText("画像を追加"));
  fireEvent.click(screen.getByLabelText("画像を追加"));
  // 4 枚で「+」は消える。
  expect(screen.getAllByLabelText("添付を削除")).toHaveLength(4);
  expect(screen.queryByLabelText("画像を追加")).not.toBeInTheDocument();
  // 1 枚削除すると 3 枚になり「+」が再表示される。
  const [firstThumb] = screen.getAllByLabelText("添付を削除");
  if (!firstThumb) throw new Error("添付サムネが見つかりません");
  fireEvent.click(firstThumb);
  expect(screen.getAllByLabelText("添付を削除")).toHaveLength(3);
  expect(screen.getByLabelText("画像を追加")).toBeInTheDocument();
});

test("空白のみのルーム名では作成されない", () => {
  render(<DemoPage />);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  fireEvent.change(screen.getByLabelText("新しいルーム名"), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: "作成" }));
  // ルームは増えない。
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test("ルームごとにメッセージが分離し、切替で編集モードも解除される", () => {
  render(<DemoPage />);
  // r1（雑談）で送信し、編集を開始する。
  sendMessage("r1の発言");
  fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }));
  expect(screen.getByDisplayValue("r1の発言")).toBeInTheDocument();
  // プロジェクトA（r2）へ切替: r1 の発言は見えず、編集モードも解除される。
  fireEvent.click(screen.getByRole("button", { name: /プロジェクトA/ }));
  expect(screen.queryByText("r1の発言")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("r1の発言")).not.toBeInTheDocument();
  expect(screen.getByText("進捗どうですか？")).toBeInTheDocument();
  // r1 へ戻すと発言は保持されている。
  fireEvent.click(screen.getByRole("button", { name: /雑談/ }));
  expect(screen.getByText("r1の発言")).toBeInTheDocument();
});

test("「デモを終了」でトップへ遷移する", () => {
  render(<DemoPage />);
  fireEvent.click(screen.getByRole("button", { name: "デモを終了" }));
  expect(push).toHaveBeenCalledWith("/");
});
