# chat-with-nextjs-hono

PWA を使った軽量チャットツール。

## 技術スタック

| レイヤー | 採用技術 |
| --- | --- |
| フロントエンド | Next.js / TypeScript / Vercel |
| バックエンド | Hono / TypeScript / Cloudflare Workers |
| DB | Cloudflare D1 / Drizzle |
| API | Hono RPC |
| 認証 | Better Auth（メール + パスワード） |
| メール | Resend |
| 双方向通信 | WebSocket |
| モノレポ | Turborepo / pnpm workspace |
| バージョン管理 | git / mise / pnpm |
| Lint / Format | oxc (Oxlint) |
| テスト | Vitest / React Testing Library / Playwright |

## リポジトリ構成（予定）

```
.
├── apps/
│   ├── web/   # Next.js (Vercel)
│   └── api/   # Hono (Cloudflare Workers)
└── packages/  # 共有パッケージ（型・設定など）
```

## 開発

前提: [mise](https://mise.jdx.dev/) を導入済みであること。

```bash
# ツール（node / pnpm）の導入
mise install

# 依存インストール
pnpm install

# Lint / Format（oxlint）
pnpm lint
pnpm lint:fix

# 型チェック（turbo 経由で各パッケージ）
pnpm typecheck

# テスト
pnpm test
```

### モノレポ構成

| ワークスペース | 内容 |
| --- | --- |
| `apps/web` | Next.js（Vercel） |
| `apps/api` | Hono（Cloudflare Workers） |
| `packages/shared` | 共有型・ドメインロジック（Hono RPC 型など） |
| `packages/typescript-config` | 共有 TypeScript 設定（base / nextjs / workers） |

### ローカル起動

```bash
# フロントエンド（Next.js）
pnpm --filter @repo/web dev

# バックエンド（Hono / wrangler）
pnpm --filter @repo/api dev
```

### DB（Cloudflare D1 + Drizzle）

スキーマは `apps/api/src/db/schema.ts`、マイグレーションは `apps/api/migrations/`。

```bash
# スキーマ変更後にマイグレーション SQL を生成
pnpm --filter @repo/api db:generate

# ローカル D1 に適用（.wrangler/ 配下の sqlite）
pnpm --filter @repo/api db:migrate:local

# 本番 D1 に適用（事前に `wrangler d1 create` で database_id を取得し wrangler.jsonc を更新）
pnpm --filter @repo/api db:migrate:remote
```

### 認証（Better Auth + Resend）

メール+パスワード認証。Better Auth を `apps/api` の `/api/auth/*` にマウントし、メール検証リンクを Resend で送信する。

ローカル開発では `apps/api/.dev.vars`（`.dev.vars.example` をコピー）に以下を設定する。

| 変数 | 用途 |
| --- | --- |
| `BETTER_AUTH_SECRET` | セッション署名用シークレット |
| `BETTER_AUTH_URL` | API のベース URL（dev: `http://localhost:8787`） |
| `WEB_URL` | フロントの origin（CORS / 信頼オリジン、dev: `http://localhost:3000`） |
| `RESEND_API_KEY` | Resend API キー（メール実送信時に必要） |
| `EMAIL_FROM` | 送信元アドレス（Resend で検証済みのもの） |

フロントは `apps/web/lib/auth-client.ts`（`NEXT_PUBLIC_API_URL` で API を指定）から `signIn` / `signUp` / `signOut` / `useSession` を利用する。

### デプロイ（Vercel: apps/web）

モノレポのため、Vercel プロジェクト側で以下を設定する。

- **Root Directory**: `apps/web`
- Framework Preset: Next.js（自動検出）
- ビルド/インストールは Vercel がワークスペースを認識して実行（`pnpm install` / `next build`）
