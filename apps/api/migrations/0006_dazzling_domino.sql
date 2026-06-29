ALTER TABLE `messages` ADD `sender_name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `messages` SET `sender_name` = COALESCE((SELECT `name` FROM `user` WHERE `user`.`id` = `messages`.`user_id`), '');
