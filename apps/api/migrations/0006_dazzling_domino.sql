-- DEFAULT '' は既存行に NOT NULL カラムを追加するための移行専用。schema.ts では
-- default を持たせず、新規 insert に senderName を型で必須化している（直後に
-- 現在の user.name でバックフィルする）。
ALTER TABLE `messages` ADD `sender_name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `messages` SET `sender_name` = COALESCE((SELECT `name` FROM `user` WHERE `user`.`id` = `messages`.`user_id`), '');
