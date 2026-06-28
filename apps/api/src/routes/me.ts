import { Hono } from "hono";
import { requireSession } from "../guards";
import type { Bindings } from "../types";

/** `/me`: 現在のセッションユーザー。保護ルートの例（無セッションなら 401）。 */
export const meApp = new Hono<{ Bindings: Bindings }>().get("/", async (c) => {
  const s = await requireSession(c);
  if (!s.ok) return s.res;
  return c.json({ user: s.user });
});
