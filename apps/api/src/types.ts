import type { AuthEnv } from "./auth";

/**
 * Cloudflare Workers の環境バインディング。
 *
 * 注: Worker の実エントリは `worker.ts`（Hono app に WS ルートを足し `RoomDO` を export）。
 * `index.ts` は FE が RPC 型を解決するエントリでもあるため、Worker ランタイム専用の型
 * （`ROOM: DurableObjectNamespace` など）はここに持ち込まず `worker.ts` 側で扱う。
 */
export type Bindings = AuthEnv;
