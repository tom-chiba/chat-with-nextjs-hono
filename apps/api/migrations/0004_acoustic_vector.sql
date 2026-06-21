ALTER TABLE `room_members` ADD `last_read_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `room_members` SET `last_read_at` = `joined_at`;
