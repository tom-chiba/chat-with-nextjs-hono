# 引き継ぎメモ（HANDOFF）

このファイルは Issue / コード / README には現れない「決定の背景・外部設定・未検証事項・ハマりどころ・進め方の慣習」をまとめたもの。再開時にまず読む。

最終更新: 2026-06-14（#1〜#6, #10 完了 + 本番デプロイ実施時点）

---

## 1. 進捗サマリ

| # | 内容 | 状態 | PR |
| --- | --- | --- | --- |
| 1 | モノレポ基盤（Turborepo + pnpm workspace + TS + oxc） | ✅ 完了 | #12 |
| 2 | apps/api: Hono + Cloudflare Workers | ✅ 完了 | #13 |
| 3 | apps/web: Next.js + Vercel | ✅ 完了 | #14 |
| 4 | DB: Cloudflare D1 + Drizzle | ✅ 完了 | #15 |
| 5 | 認証: Better Auth（メール+パスワード）+ Resend | ✅ 完了 | #16 |
| 6 | API: Hono RPC 型共有 | ✅ 完了 | #17 |
| 7 | 双方向通信: WebSocket チャット | ⬜ 未着手 | — |
| 8 | チャット機能（ルーム / メッセージ） | ⬜ 未着手 | — |
| 9 | PWA 対応 | ⬜ 未着手 | — |
| 10 | テスト基盤（Vitest / RTL / Playwright） | ✅ 完了 | — |
| 11 | CI（GitHub Actions） | ⬜ 未着手 | — |

推奨順序: **#10 テスト基盤が入ったので #7/#8** に進む。WebSocket / チャット機能をテストで固めながら実装できる。#11 CI は #10 の `pnpm test` / `pnpm test:e2e` をそのまま流せる。

---

## 2. 進め方の慣習（このリポジトリの運用）

- **1 Issue = 1 ブランチ = 1 PR**。ブランチ名は `feat/<番号>-<topic>`。
- PR 本文に `Closes #<番号>`、**squash merge** + ブランチ削除。
- マージ前に **`/code-review`（自前）と `/codex:review`（Codex）の二重レビュー**を実施し、指摘は原則その PR 内で修正してからマージ。
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude ...` トレーラ。
- `main` は常に `pnpm lint` / `pnpm typecheck` が通る状態を維持。

---

## 3. アーキテクチャ上の決定とその理由（コードからは読み取りにくいもの）

- **DB は `apps/api` に集約**（`packages/db` に切り出していない）。D1 バインディング・wrangler マイグレーション・Better Auth がすべて Worker 側に集まるため。将来スキーマを他で共有する必要が出たら `packages/db` へ抽出する。
- **認証テーブル（user/session/account/verification）は Better Auth 専用スキーマ**（`apps/api/src/db/auth-schema.ts`）。手書きしている都合上、**Better Auth のバージョンを上げたらフィールド差分に注意**（理想は `@better-auth/cli generate` 相当との整合確認）。
- **`messages.user_id` は `user.id` への FK**（#5 で追加）。`rooms`/`messages` は `apps/api/src/db/schema.ts`。
- **created_at は `unixepoch('subsec') * 1000` のミリ秒精度**。秒精度だと同一秒のメッセージで順序が衝突するため。#8 で一覧を出すときは **`ORDER BY (created_at, id)` のタイブレーク**を推奨。
- **D1 は FK の ON DELETE cascade を実際に enforce する**（ローカル miniflare で確認済み。PRAGMA 不要）。
- **`D1Database` はグローバルではなく明示 import**（`@cloudflare/workers-types` から）。RPC 型を FE が解決する際、web 側 tsconfig に worker グローバルが無くても型解決できるようにするため。
- **Hono RPC の型は `@repo/api` のソースから共有**（ビルド .d.ts を介さない）。TypeScript はモジュール解決をソースファイル位置基準で行うため、web が間接的に読む `resend`/`drizzle-orm` は api 側 node_modules から解決され、**web に server 依存を足す必要はない**（web の追加依存は `@repo/api` + `hono` のみ）。
- **RPC クライアントは `credentials: "include"` 必須**（`apps/web/lib/rpc.ts`）。別サブドメイン API へ Cookie を送るため。

### テスト基盤の決定（#10・非自明）

- **依存バージョン共有**: `vitest` は pnpm catalog（`^4.1.8`）で一元化。各パッケージは `catalog:` 参照。
- **apps/api は `@cloudflare/vitest-pool-workers`（workerd 内実行）**。**vitest 4 系で API が変わった**:
  旧 `defineWorkersConfig` / `@cloudflare/vitest-pool-workers/config` サブパスは**廃止**。
  現行は `import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers"`（メインエントリ）で、
  `cloudflareTest({ wrangler, miniflare })` を **Vite プラグイン**として `plugins` に渡す（`apps/api/vitest.config.ts`）。
  バージョンは **pool-workers `^0.16.14` ↔ vitest `^4.1.0`** で peer 整合（Safe-chain が 0.16.15 を隠すため 0.16.14 を採用）。
- **D1 マイグレーションはテスト内で適用**: `vitest.config.ts` の `miniflare.bindings.TEST_MIGRATIONS` に
  `readD1Migrations("migrations")` を渡し、`apps/api/test/apply-migrations.ts`（setupFile）で
  `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`。**miniflare が DB を提供するため本番 `database_id` 不要**。
- **`cloudflare:test` の env 型は `Cloudflare.Env`**（`ProvidedEnv` ではない）。`apps/api/test/env.d.ts` で
  `declare global { namespace Cloudflare { interface Env extends AuthEnv {...} } }` と宣言マージして型付け。
  tsconfig の `types` に **`@cloudflare/vitest-pool-workers/types`**（`cloudflare:test` の宣言はこのサブパス）を追加。
- **認証 env**: テスト時は `.dev.vars` の値が使われる（無くても `vitest.config.ts` のダミー値で動く）。実メール送信はしない。
- **apps/web は Vitest + RTL + jsdom**。`page.tsx` は仮実装のため対象にせず、`test/smoke.test.tsx` で
  RTL/jsdom 基盤の疎通のみ確認（UI 実装時に本テスト追加）。`vitest.setup.ts` で `@testing-library/jest-dom/vitest`。
- **Playwright は turbo test の外**（ブラウザ要）。ルートの `pnpm test:e2e` で実行。
  **webServer は専用ポート 3100 に固定**（既定 3000 は他プロジェクトと衝突しやすいため。`next dev --port 3100`）。
- **`turbo.json` の `test` は `dependsOn: []`**（vitest は事前 build 不要）。`typecheck` は従来どおり `^build` 依存。

### 生成ファイルの扱い（重要・非自明）

- `apps/api/worker-configuration.d.ts`（`wrangler types` 生成）→ **コミットする**（自己完結。CI で前処理なく typecheck が通る）。`wrangler.jsonc` 変更後は `pnpm --filter @repo/api cf-typegen` で再生成。
- `apps/web/next-env.d.ts`（Next 生成）→ **gitignore する**。Next 16 のこのファイルは `import "./.next/types/routes.d.ts"`（ビルド生成物）を含み、コミットするとクリーンな CI で `tsc` が失敗するため。
- `apps/api/migrations/`（drizzle-kit 生成 SQL + meta）→ **コミットする**。
- `apps/api/.wrangler/`（ローカル D1 状態）→ gitignore。

### tsconfig の決定

- `base.json` から **`declaration` は削除済み**。noEmit 下で未使用な上、better-auth クライアント型の再エクスポートで TS2883（宣言ポータビリティ）エラーを誘発したため。将来 `.d.ts` を出すライブラリパッケージは各自の tsconfig で有効化する。
- 依存バージョンは **pnpm catalog** で一元化（`pnpm-workspace.yaml` の `catalog:` に `typescript` / `@types/node`）。各パッケージは `catalog:` 参照。

---

## 4. Cookie / CORS のドメイン戦略（外部に書いていない前提）

- **FE/BE はサブドメインを分けるが、ルートドメインは揃える予定**（例: `app.example.com` / `api.example.com`）。
- これは same-site（登録可能ドメインが同一）なので、Better Auth デフォルトの **`SameSite=Lax` のままで Cookie が送信される**。`SameSite=None` や `crossSubDomainCookies` の設定は不要。
- ただし **CORS は別オリジン扱い**になるため必要。API 側は全ルートに CORS を適用済み（`origin = WEB_URL`, `credentials: true`）。FE 側は `credentials: "include"` で送信。
- ローカル開発は `localhost:3000` ↔ `localhost:8787` で same-site のため動作する。

---

## 5. 本番デプロイ（2026-06-14 実施済み）

初回デプロイ完了。構成は以下。再デプロイは `pnpm --filter @repo/api run deploy`（FE は Vercel が GitHub push で自動）。

- **ドメイン**: FE `https://chat.tom-chiba.com`（Vercel）/ BE `https://chat.api.tom-chiba.com`（Workers カスタムドメイン）。同一ルートドメイン `tom-chiba.com` なので §4 のとおり `SameSite=Lax` で Cookie が通る。
- **Cloudflare D1（本番）**: DB 名 `chat-db` / `database_id` は `wrangler.jsonc` にコミット済み（`0da6cb37-...`）。マイグレーション適用済み。スキーマ変更時は `pnpm --filter @repo/api db:migrate:remote`。
- **wrangler.jsonc の env 方針**: 秘匿不要な `BETTER_AUTH_URL` / `WEB_URL` / `EMAIL_FROM` は **`vars`（コミット対象）**。秘匿値の **`BETTER_AUTH_SECRET` / `RESEND_API_KEY` のみ `wrangler secret`**。同名を secret と vars に二重登録すると衝突するため、vars 化したものは `wrangler secret delete` 済み。
- **Resend**: 送信ドメイン検証済み、`EMAIL_FROM = no-reply@tom-chiba.com`。検証メール送信を本番で確認済み。
- **Vercel（apps/web）**: Root Directory = `apps/web`。環境変数は **`NEXT_PUBLIC_API_URL = https://chat.api.tom-chiba.com` のみ**（FE に秘匿情報なし）。`NEXT_PUBLIC_` はビルド時埋め込みのため値変更時は再デプロイ要。
- **カスタムドメインの TLS**: `chat.api.tom-chiba.com` は2階層サブドメインで Universal SSL 対象外。Workers カスタムドメインが専用証明書を自動発行（今回は約90秒で有効化）。多階層は数分かかることがある。

> ローカル開発用の secret は `apps/api/.dev.vars`（サンプル `.dev.vars.example`）。テストは miniflare のダミー値でも動く。

---

## 6. 実環境での検証結果（2026-06-14・解消済み）

- **認証フルフロー**: signup（`POST /api/auth/sign-up/email`）→ 200 + user 行作成 → **検証メール受信** を本番で確認済み（`requireEmailVerification: true` のため signup 時点では `token:null`/`emailVerified:false` が正常）。
- **本番クロスサブドメインの Cookie/CORS 実挙動**: `/health` 200・`/me` 401・FE オリジンからの CORS preflight 204（`allow-origin: https://chat.tom-chiba.com` / `allow-credentials: true`）を確認済み。
- 残: verify リンク→login→`/me` が user を返すところまでの通し（メール到達まで確認済みなので残りは UI 実装と合わせて）。

---

## 7. ローカル開発のハマりどころ

- **mise**: 初回は `mise trust` が必要。node 24 / pnpm 11.6.0 をピン留め（`mise.toml`）。
- **pnpm の build スクリプト**: pnpm 11 は build スクリプトをデフォルト無効化。`pnpm-workspace.yaml` の `allowBuilds` で `esbuild` / `workerd` を許可済み（`sharp` は不要のため無効）。
- **npm の最新版確認**: 環境の Safe-chain が最低公開経過日数で新しいバージョンを隠す。正確な最新版は `npm view <pkg> versions --json --safe-chain-skip-minimum-package-age` で確認する（pnpm の最新が 10 系に見えて実は 11 系だった事例あり）。
- **wrangler dev のポート衝突**: 終了し損ねた `workerd` がポートを掴んで `Address already in use` になることがある。`pkill -9 -f wrangler; pkill -9 -f workerd; lsof -ti tcp:<port> | xargs -r kill -9` で掃除。
- **ローカル D1 マイグレーション**: `pnpm --filter @repo/api db:migrate:local`。スキーマ変更後は `db:generate` → `db:migrate:local`。
- **Hono アプリの軽い疎通確認**: Node 24 のネイティブ型ストリッピングで `node --experimental-strip-types -e "import app from './src/index.ts'; ..."` のように `app.request()` を直接叩ける。

---

## 8. 主要ファイルの地図

```
apps/api/
  src/index.ts          # Hono エントリ。CORS / Better Auth マウント / RPC ルート(/health,/me) / AppType export
  src/auth.ts           # createAuth(env): Better Auth 設定（Drizzle アダプタ・メール検証・Resend）
  src/db/index.ts       # createDb(d1): Drizzle クライアント
  src/db/schema.ts      # rooms / messages（+ auth-schema 再export）
  src/db/auth-schema.ts # Better Auth テーブル
  wrangler.jsonc        # D1 バインディング DB（database_id はプレースホルダ）
  drizzle.config.ts     # drizzle-kit 設定（sqlite）
  migrations/           # 生成 SQL（コミット対象）
  vitest.config.ts      # cloudflareTest プラグイン + D1 マイグレーション注入
  test/                 # apply-migrations.ts(setup) / env.d.ts(型) / index.test.ts(/health,/me)
apps/web/
  app/                  # App Router（layout / page / globals.css）
  lib/auth-client.ts    # Better Auth クライアント（signIn/signUp/signOut/useSession）
  lib/rpc.ts            # hc<AppType> RPC クライアント（credentials: include）
  vitest.config.ts      # RTL + jsdom / vitest.setup.ts で jest-dom
  test/smoke.test.tsx   # RTL/jsdom 疎通の最小テスト
packages/
  shared/               # @repo/shared（共有型・ドメイン）。src/index.test.ts
  typescript-config/    # base / nextjs / workers
playwright.config.ts    # E2E。webServer で next dev を 3100 で起動
e2e/smoke.spec.ts       # トップページ表示のスモーク
```

### テストの動かし方

- ユニット/コンポーネント: `pnpm test`（= `turbo test`）。単体は `pnpm --filter @repo/api test` など。
- E2E: 初回のみ `npx playwright install chromium`、以降 `pnpm test:e2e`（next dev を 3100 で自動起動）。
