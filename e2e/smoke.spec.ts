import { expect, test } from "@playwright/test";

// トップページが開けることだけを確認するスモーク。
// ログイン→送信の本格フローは #8 チャット実装 + 実 Resend 検証後に追加する。
test("トップページが表示される", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "chat" }),
  ).toBeVisible();
});
