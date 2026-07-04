# ライブラリを使う際

context7 を活用して最新の情報を調べたうえで利用すること

## Hono

- `hono` で実行可能な CLI を活用すること
- `hono -h` でヘルプを確認可能

## Better Auth

- better-auth MCP を活用すること

# 動作確認する際

playwright-cli を活用して動作を確認すること

## ローカルサーバー（dev サーバー等）の起動・停止

- `pnpm dev` などの長時間プロセスは `nohup` や `&` でデタッチせず、バックグラウンド実行（`run_in_background`）で起動すること。デタッチするとプロセスがタスクツリーから外れてオーファン化し、サンドボックス内からは `kill` できず（Seatbelt がシグナル送信を拒否）回収不能になる
- 停止は `kill` ではなく `TaskStop`（タスク ID 指定）で行うこと。孫プロセス（wrangler が spawn する workerd 等）までツリーごと回収され、ポートも解放される

# プロダクト方針

これから記載

# 作業の進め方

- push 前の修正分に関しては amend や rebase も活用して過去の commit を改変し、 Git tree をきれいに保つこと
