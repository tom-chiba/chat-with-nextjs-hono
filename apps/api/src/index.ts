import { Hono } from "hono";

/**
 * Cloudflare Workers の環境バインディング。
 * D1・シークレット等は今後ここに追加する（#4 / #5）。
 */
export type Bindings = Record<string, never>;

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) => c.json({ status: "ok" } as const));

export default app;
