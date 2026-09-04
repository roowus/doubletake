ALTER TABLE `collections` ADD `share_token` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_share_token_idx` ON `collections` (`share_token`);
