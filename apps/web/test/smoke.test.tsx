import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

// RTL + jsdom 基盤が動くことを確認する最小テスト。
// page.tsx は仮実装のため対象にせず、UI 実装時に本テストを追加する。
test("RTL がコンポーネントをレンダリングできる", () => {
  render(<div>ok</div>);
  expect(screen.getByText("ok")).toBeInTheDocument();
});
