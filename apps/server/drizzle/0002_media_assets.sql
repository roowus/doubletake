ALTER TABLE `extractions` ADD `duration_ms` integer;
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration_s` real,
	`width` integer,
	`height` integer,
	`frame_ts_s` real,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_assets_item_idx` ON `media_assets` (`item_id`);
