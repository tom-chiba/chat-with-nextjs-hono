/**
 * REST API 境界の入力検証スキーマ。FE/BE で共有し、検証を単一情報源化する。
 *
 * 本文・ルーム名・メールの制約スキーマはそれぞれの定義元（`chat.ts` / `policy.ts`）に
 * 置き、ここでは「リクエストボディ / クエリの形」を組み立てる。
 */

import { z } from "zod";
import { messageBodySchema, roomNameSchema } from "./chat";
import { emailSchema } from "./policy";

/** POST /rooms・PATCH /rooms/:roomId のボディ。 */
export const roomNameInputSchema = z.object({ name: roomNameSchema });

/** PATCH /rooms/:roomId/messages/:messageId のボディ。 */
export const messageEditSchema = z.object({ body: messageBodySchema });

/** POST /rooms/:roomId/members のボディ。 */
export const memberAddSchema = z.object({ email: emailSchema });

/**
 * POST /rooms/:roomId/read のボディ。
 * `at` は既読化したい時刻のミリ秒。省略可（既定値の補完はハンドラ側で現在時刻を使う）。
 */
export const roomReadSchema = z.object({
  at: z.number().finite().nonnegative().optional(),
});

/**
 * GET /rooms/:roomId/messages のクエリ。
 * 値は文字列のまま受け取り、数値への変換と上限クランプはハンドラ側で行う。
 *
 * `before`/`beforeId` はキーセットカーソルの組で、片方だけでは位置を特定できない。
 * 片方だけ指定された場合に黙ってカーソルを無視して最新ページへフォールバックすると
 * 意図しない結果になるため、両方指定 or 両方未指定のみを許可する（部分指定は 400）。
 * ハンドラは空文字を falsy としてカーソル無効に扱うため、未指定と空文字を同じ「欠如」とみなす。
 */
export const messagesQuerySchema = z
  .object({
    before: z.string().optional(),
    beforeId: z.string().optional(),
    limit: z.string().optional(),
  })
  .refine(
    (q) => {
      const hasBefore = q.before !== undefined && q.before !== "";
      const hasBeforeId = q.beforeId !== undefined && q.beforeId !== "";
      return hasBefore === hasBeforeId;
    },
    { message: "before and beforeId must be provided together" },
  );

/** Web Push の購読情報（POST /push/subscriptions）。 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Push 購読解除（DELETE /push/subscriptions）。 */
export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().min(1),
});
