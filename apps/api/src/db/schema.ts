import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/**
 * チャットルーム。
 */
export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
});

/**
 * ルームの所属メンバー。
 *
 * `lastReadAt` は当該メンバーがそのルームで「最後に既読化した時刻」。これより
 * 新しい他人のメッセージを未読としてカウントする。新規参加直後は `joinedAt`
 * と同値で未読 0 となる。
 */
export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
    lastReadAt: integer("last_read_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("room_members_user_id_joined_at_idx").on(t.userId, t.joinedAt),
  ],
);

/**
 * ルーム内のメッセージ。
 *
 * `senderName` は送信時点の送信者表示名のスナップショット。送信者が後で改名しても
 * 過去メッセージの表示名は固定される（`user.name` を都度 JOIN しない）。
 *
 * 編集すると `editedAt` に時刻が入る（初回投稿時は null）。
 * 削除は論理削除で、`deletedAt` に時刻、`body` は空文字に書き換える。
 */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("messages_room_id_created_at_idx").on(t.roomId, t.createdAt)],
);

/**
 * メッセージに添付された画像。実体は R2（`ATTACHMENTS` バケット）に `r2Key` で保存し、
 * ここにはメタデータのみ持つ。
 *
 * アップロードはメッセージ送信に先行する（先に R2 へ put して attachment を作り、
 * その id を WebSocket のメッセージ送信に添える）。そのため `messageId` は投稿確定まで
 * null で、確定時に紐付ける。`userId`/`roomId` はアップロード者と対象ルームで、
 * 未紐付け（orphan）状態でも配信・削除の認可判定に使う。
 */
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    /**
     * メッセージ内の表示順（0 始まり）。送信時に指定順で採番する。並行アップロードの
     * 完了順に依存せず、ライブ配信と履歴再読込で同じ並びを保証するために持つ。
     * 未紐付け（アップロード直後）は 0。
     */
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
  },
  (t) => [index("attachments_message_id_idx").on(t.messageId)],
);

/**
 * Web Push の購読情報。
 *
 * endpoint はブラウザ側で一意に払い出される URL。失効時の掃除を単純にするため主キーにする。
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`),
  },
  (t) => [
    index("push_subscriptions_user_id_idx").on(t.userId),
  ],
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type RoomMember = typeof roomMembers.$inferSelect;
export type NewRoomMember = typeof roomMembers.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
