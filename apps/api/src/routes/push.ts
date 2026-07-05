import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@repo/shared";
import { Hono } from "hono";
import { deletePushSubscription, upsertPushSubscription } from "../db/push-subscriptions";
import { requireSession } from "../guards";
import { hasPushConfig } from "../push";
import type { Bindings } from "../types";

/** `/push/*`: VAPID 公開鍵の取得と購読の登録 / 解除。 */
export const pushApp = new Hono<{ Bindings: Bindings }>()
  .get("/vapid-public-key", (c) => {
    if (!hasPushConfig(c.env)) {
      return c.json({ error: "push is not configured" } as const, 503);
    }
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY } as const);
  })
  .post("/subscriptions", async (c) => {
    // 設定不備（503）はセッション検証より先に返す。
    if (!hasPushConfig(c.env)) {
      return c.json({ error: "push is not configured" } as const, 503);
    }
    const s = await requireSession(c);
    if (!s.ok) return s.res;

    // 設定不備（503）・未認証（401）を先に返したいので、検証はハンドラ内で行う。
    const parsed = pushSubscriptionSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "invalid push subscription" } as const, 400);
    }

    await upsertPushSubscription(s.db, s.user.id, parsed.data);
    return c.json({ ok: true } as const, 201);
  })
  .delete("/subscriptions", async (c) => {
    const s = await requireSession(c);
    if (!s.ok) return s.res;

    const parsed = pushUnsubscribeSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json({ error: "invalid endpoint" } as const, 400);
    }

    await deletePushSubscription(s.db, s.user.id, parsed.data.endpoint);
    return c.json({ ok: true } as const);
  });
