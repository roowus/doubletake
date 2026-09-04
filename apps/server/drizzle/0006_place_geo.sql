CREATE TABLE `place_geo` (
	`query` text PRIMARY KEY NOT NULL,
	`lat` real,
	`lon` real,
	`label` text,
	`provider` text NOT NULL,
	`resolved_at` text NOT NULL
);
