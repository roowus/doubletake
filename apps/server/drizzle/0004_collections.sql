CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`item_id` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_items_pk` ON `collection_items` (`collection_id`,`item_id`);
--> statement-breakpoint
CREATE INDEX `collection_items_item_idx` ON `collection_items` (`item_id`);
