import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import type { AuthEnv } from "../src/auth";

// cloudflare:test の env（Cloudflare.Env）をプロジェクトのバインディングで型付けする。
// 認証 env と、vitest.config.ts の miniflare.bindings で渡すマイグレーションを追加する。
declare global {
  namespace Cloudflare {
    interface Env extends AuthEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
