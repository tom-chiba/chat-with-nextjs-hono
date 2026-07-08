import type { Context } from "hono";
import { type AuthEnv, createAuth } from "./auth";
import { type Db, createDb } from "./db";
import { getRoomMembership, requireRoomOwner } from "./db/rooms";

/**
 * 認証・認可のガード関数群。
 *
 * Hono のミドルウェア（`createMiddleware`）が返すレスポンスは RPC の型（`AppType`）に
 * 含まれず、クライアント側の `res.status` narrowing が壊れる。そこで「ハンドラ内で呼び、
 * 失敗時の `c.json(...)` をハンドラ自身が return する」関数として提供し、401/403/404 を
 * RPC 型に残す。成功時は後続が使う値（user / db）を返す。
 *
 * 注: ガードの呼び出しは型では強制されない。新しい保護ルートでは、メンバー/オーナー確認が
 * 必要な場合は合成ヘルパの `requireMemberSession` / `requireOwnerSession` を、セッションのみで
 * 良い場合は `requireSession` を先頭で呼ぶこと。
 */

type GuardCtx = Context<{ Bindings: AuthEnv }>;

/**
 * 有効なセッションを要求する。未認証なら 401 レスポンスを `res` で返す。
 * 成功時は認証ユーザーとリクエストスコープの DB ハンドルを返す。
 */
export async function requireSession(c: GuardCtx) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return { ok: false as const, res: c.json({ error: "unauthorized" } as const, 401) };
  }
  return { ok: true as const, user: session.user, db: createDb(c.env.DB) };
}

/**
 * `roomId` の所属メンバーであることを要求する。ルームが無ければ 404、
 * メンバーでなければ 403 を `res` で返す。
 */
async function requireMember(c: GuardCtx, db: Db, userId: string, roomId: string) {
  const membership = await getRoomMembership(db, roomId, userId);
  if (membership.status === "not_found") {
    return { ok: false as const, res: c.json({ error: "room not found" } as const, 404) };
  }
  if (membership.status === "forbidden") {
    return { ok: false as const, res: c.json({ error: "forbidden" } as const, 403) };
  }
  return { ok: true as const };
}

/**
 * `roomId` のオーナーであることを要求する。ルームが無ければ 404、
 * オーナーでなければ 403 を `res` で返す。
 */
async function requireOwner(c: GuardCtx, db: Db, userId: string, roomId: string) {
  const owner = await requireRoomOwner(db, roomId, userId);
  if (owner.status === "not_found") {
    return { ok: false as const, res: c.json({ error: "room not found" } as const, 404) };
  }
  if (owner.status !== "owner") {
    return { ok: false as const, res: c.json({ error: "forbidden" } as const, 403) };
  }
  return { ok: true as const };
}

/**
 * `roomId` のメンバーであることを要求する合成ヘルパ。セッション確認とメンバー確認を
 * 一度に行い、失敗時は最初に失敗した方の `res` を返す。成功時は `requireSession` と
 * 同じ形（`user` / `db`）を返す。
 */
export async function requireMemberSession(c: GuardCtx, roomId: string) {
  const s = await requireSession(c);
  if (!s.ok) return s;
  const mem = await requireMember(c, s.db, s.user.id, roomId);
  if (!mem.ok) return mem;
  return s;
}

/**
 * `roomId` のオーナーであることを要求する合成ヘルパ。セッション確認とオーナー確認を
 * 一度に行い、失敗時は最初に失敗した方の `res` を返す。成功時は `requireSession` と
 * 同じ形（`user` / `db`）を返す。
 */
export async function requireOwnerSession(c: GuardCtx, roomId: string) {
  const s = await requireSession(c);
  if (!s.ok) return s;
  const own = await requireOwner(c, s.db, s.user.id, roomId);
  if (!own.ok) return own;
  return s;
}
