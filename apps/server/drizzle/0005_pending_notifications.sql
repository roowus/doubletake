CREATE TABLE `pending_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text NOT NULL
);
