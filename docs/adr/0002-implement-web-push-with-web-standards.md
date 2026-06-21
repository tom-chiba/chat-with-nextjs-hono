# 0002: Web Push は Web 標準 API で実装する

- ステータス: 採択
- 日付: 2026-06-21

## 背景

Cloudflare Workers は Web 標準 API を中心に動く実行環境である。

従来の Node.js 向け `web-push` ライブラリは、Node.js 固有の暗号化モジュールや HTTP モジュールに依存する可能性があり、Workers ランタイムとの互換性リスクがある。

Issue #47 で Web Push / Push API によるバックグラウンド通知を追加するにあたり、Workers 環境で安定して動く実装方針を決める必要があった。

## 決定

Web Push 送信は Node.js 向け `web-push` ライブラリに依存せず、Web 標準 API で自前実装する。

具体的には、アプリケーション側は `PushSender` 抽象に依存し、Cloudflare Workers 向け実装として `crypto.subtle` と `fetch` を使う。

暗号化と送信形式は RFC 8030 / RFC 8291 / RFC 8292 に沿わせる。

VAPID 鍵は環境ごとに 1 ペアを発行する。公開鍵は環境変数、秘密鍵は Cloudflare Workers secret として管理する。

## 影響

Node.js 固有 API への依存を避けられるため、Workers ランタイムとの互換性を保ちやすくなる。

一方で、Web Push の暗号化処理を自前で保持するため、RFC 準拠をテストで継続的に確認する必要がある。

Push 通知送信はチャット投稿の補助機能として扱い、通知送信失敗や破損 subscription がチャット投稿本体を失敗させないようにする。

## 代替案

- Node.js 向け `web-push` ライブラリを使う
  - 実装量は減るが、Workers ランタイムとの互換性リスクが残るため採用しない。

## 参照

- [Issue #47: 機能: Push 通知対応](https://github.com/tom-chiba/chat-with-nextjs-hono/issues/47)
- [RFC 8030: Generic Event Delivery Using HTTP Push](https://www.rfc-editor.org/rfc/rfc8030.html)
- [RFC 8291: Message Encryption for Web Push](https://www.rfc-editor.org/rfc/rfc8291.html)
- [RFC 8292: Voluntary Application Server Identification for Web Push](https://www.rfc-editor.org/rfc/rfc8292.html)
