import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// workerd 内でテストを実行する。wrangler.jsonc の DB バインディングを miniflare が提供するため、
// 本番 database_id は不要。マイグレーションはセットアップファイルでテスト用 D1 に適用する。
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // マイグレーション SQL をセットアップ用にテスト専用バインディングで渡す。
          bindings: {
            TEST_MIGRATIONS: migrations,
            // createAuth / CORS が参照する env。テスト用ダミー値（実送信はしない）。
            BETTER_AUTH_SECRET: "test-secret",
            BETTER_AUTH_URL: "http://localhost:8787",
            WEB_URL: "http://localhost:3000",
            RESEND_API_KEY: "test-resend-key",
            EMAIL_FROM: "test@example.com",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
