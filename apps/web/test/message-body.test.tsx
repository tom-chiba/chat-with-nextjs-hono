import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MessageBody } from "@/components/message-body";

test("メンションは span.mention、リンクは a.msg-link に描画する", () => {
  render(<MessageBody body="hi @alice see https://example.com end" />);

  const mention = screen.getByText("@alice");
  expect(mention.tagName).toBe("SPAN");
  expect(mention).toHaveClass("mention");

  const link = screen.getByRole("link", { name: "https://example.com" });
  expect(link).toHaveClass("msg-link");
  expect(link).toHaveAttribute("href", "https://example.com");
  // 外部リンクは新規タブ + noopener。
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("プレーンテキストはそのまま描画する", () => {
  render(<MessageBody body="ただのテキスト" />);
  expect(screen.getByText("ただのテキスト")).toBeInTheDocument();
});
