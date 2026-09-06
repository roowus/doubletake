ALTER TABLE `items` ADD `client_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `items_client_id_idx` ON `items` (`client_id`);
