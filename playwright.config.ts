import { defineConfig, devices } from "@playwright/test";

// E2E スモーク。turbo test とは別に `pnpm test:e2e` で実行する（ブラウザが必要なため）。
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // next dev を自動起動する。既定の 3000 は他プロジェクトと衝突しやすいため E2E 専用ポートに固定する。
  webServer: {
    command: "pnpm --filter @repo/web exec next dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
