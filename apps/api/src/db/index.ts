import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";

/**
 * D1 バインディングから Drizzle クライアントを生成する。
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export { schema };
export type Db = ReturnType<typeof createDb>;
