import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth } from "./auth";
import { meApp } from "./routes/me";
import { pushApp } from "./routes/push";
import { roomsApp } from "./routes/rooms";
import type { Bindings } from "./types";

export type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

// Web（別サブドメイン = 別オリジン）からの Cookie 認証クロスオリジン呼び出しを許可する。
// WebSocket の upgrade は CORS の対象外で、101 応答にヘッダを付けると干渉するためスキップする。
app.use("*", (c, next) =>
  c.req.header("upgrade")?.toLowerCase() === "websocket"
    ? next()
    : cors({
        origin: c.env.WEB_URL,
        credentials: true,
        allowHeaders: ["Content-Type"],
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      })(c, next),
);

// Better Auth のハンドラをマウント（サインアップ / ログイン / ログアウト / メール検証など）。
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// 注: WebSocket ルート（`/ws/room/:roomId`）は Worker ランタイム専用 API（Durable Object への
// フォワード）を使うため、FE が型解決しない `worker.ts` 側で `app` に登録する。

// RPC 用に型を共有するルートはチェーンして合成し、その型をエクスポートする。
// 機能別のサブアプリ（me / push / rooms）を `.route()` でマウントする。パス構造は
// マウント前と同一なので FE 側の RPC 呼び出し・型は不変。
// 認証・認可は `guards.ts` の関数で行う。失敗時の応答はハンドラが return するため
// RPC 型（AppType）に 401/403/404 が保持される（ミドルウェア化すると型から落ちる）。
const routes = app
  .get("/health", (c) => c.json({ status: "ok" } as const))
  .route("/me", meApp)
  .route("/push", pushApp)
  .route("/rooms", roomsApp);

export default app;
export type AppType = typeof routes;
