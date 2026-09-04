CREATE TABLE `ig_accounts` (
	`ig_user_id` text PRIMARY KEY NOT NULL,
	`username` text,
	`access_token_enc` text NOT NULL,
	`expires_at` text,
	`refreshed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ig_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`raw` text NOT NULL,
	`item_id` text,
	`sender_id` text,
	`received_at` text NOT NULL,
	`processed_at` text,
	`error` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ig_events_item_idx` ON `ig_events` (`item_id`);
