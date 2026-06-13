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

> セットアップ手順は基盤構築後に追記します。
