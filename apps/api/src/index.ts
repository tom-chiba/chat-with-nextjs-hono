import { Hono } from "hono";
import { cors } from "hono/cors";
import { type AuthEnv, createAuth } from "./auth";

/**
 * Cloudflare Workers の環境バインディング。
 */
export type Bindings = AuthEnv;

const app = new Hono<{ Bindings: Bindings }>();

// 認証エンドポイントは Web からの Cookie 認証クロスオリジン呼び出しを許可する。
app.use("/api/auth/*", (c, next) =>
  cors({
    origin: c.env.WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  })(c, next),
);

// Better Auth のハンドラをマウント（サインアップ / ログイン / ログアウト / メール検証など）。
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

app.get("/health", (c) => c.json({ status: "ok" } as const));

// 保護ルートの例：有効なセッションが無ければ 401。
app.get("/me", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "unauthorized" } as const, 401);
  }
  return c.json({ user: session.user });
});

export default app;
