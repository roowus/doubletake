CREATE TABLE `todos` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`note` text,
	`attributes` text DEFAULT '{}' NOT NULL,
	`chat_id` text,
	`done_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `todos_done_created_idx` ON `todos` (`done_at`,`created_at`);
