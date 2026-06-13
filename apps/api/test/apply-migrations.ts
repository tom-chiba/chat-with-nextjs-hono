import { applyD1Migrations, env } from "cloudflare:test";

// 各テストファイルの実行前に、テスト用 D1 にマイグレーションを適用する。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
