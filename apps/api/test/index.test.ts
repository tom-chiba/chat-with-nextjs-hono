import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";
import app from "../src/index";
// WS ルートは worker.ts 側で app に登録される。default export は同一の app インスタンス。
import workerApp from "../src/worker";

describe("API ルート", () => {
  test("GET /health は 200 で status ok を返す", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /me はセッション無しで 401 を返す", async () => {
    const res = await app.request("/me", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("WS /ws/room/:id は正しい Origin でもセッション無しなら 401 を返す", async () => {
    const res = await workerApp.request(
      "/ws/room/general",
      { headers: { Upgrade: "websocket", Origin: env.WEB_URL } },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  test("WS /ws/room/:id は許可外 Origin で 403 を返す", async () => {
    const res = await workerApp.request(
      "/ws/room/general",
      { headers: { Upgrade: "websocket", Origin: "https://evil.example.com" } },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden origin" });
  });

  test("WS /ws/room/:id は upgrade ヘッダ無しで 426 を返す", async () => {
    const res = await workerApp.request("/ws/room/general", {}, env);
    expect(res.status).toBe(426);
  });
});
