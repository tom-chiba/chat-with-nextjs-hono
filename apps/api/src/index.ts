import { Hono } from "hono";

/**
 * Cloudflare Workers の環境バインディング。
 * シークレット等は今後ここに追加する（#5）。
 */
export type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" } as const));

export default app;
