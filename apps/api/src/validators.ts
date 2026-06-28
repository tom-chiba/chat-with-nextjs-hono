import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

/**
 * JSON ボディを zod で実検証する validator。検証失敗時は既存の応答形に合わせて
 * `{ error: message }` を 400 で返す（RPC 型にも 400 応答が保持される）。
 */
export const jsonValidator = <T extends ZodType>(schema: T, message: string) =>
  zValidator("json", schema, (result, c) =>
    result.success ? undefined : c.json({ error: message } as const, 400),
  );

/** クエリを zod で実検証する validator。失敗時は 400 を返す。 */
export const queryValidator = <T extends ZodType>(schema: T) =>
  zValidator("query", schema, (result, c) =>
    result.success ? undefined : c.json({ error: "invalid query" } as const, 400),
  );
