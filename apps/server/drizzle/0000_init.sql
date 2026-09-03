CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`bytes` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_message_at` text,
	`brain_session_id` text,
	`brain_adapter` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_item_id_unique` ON `chats` (`item_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`auto` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`adapter` text NOT NULL,
	`model` text,
	`cost_usd` real NOT NULL,
	`run_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cost_ledger_day` ON `cost_ledger` (`day`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`run_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`url` text,
	`confidence` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entities_kind_name` ON `entities` (`kind`,`name`);--> statement-breakpoint
CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`tool` text,
	`model` text,
	`cost_usd` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`confidence` real,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_tags_pk` ON `item_tags` (`item_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_url` text,
	`canonical_url` text,
	`platform` text NOT NULL,
	`channel` text NOT NULL,
	`note` text,
	`text` text,
	`focus` text DEFAULT 'whole' NOT NULL,
	`mode_requested` text DEFAULT 'auto' NOT NULL,
	`mode_effective` text,
	`question_type` text,
	`category` text,
	`status` text DEFAULT 'new' NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `items_dedupe` ON `items` (`canonical_url`,`focus`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`structured` text,
	`run_id` text,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_chat` ON `messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text NOT NULL,
	`keys` text,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_run` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`kind` text DEFAULT 'research' NOT NULL,
	`mode` text NOT NULL,
	`adapter` text NOT NULL,
	`model` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`user_message` text,
	`started_at` text,
	`finished_at` text,
	`cost_usd` real,
	`tokens_in` integer,
	`tokens_out` integer,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_status` ON `runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'auto' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);