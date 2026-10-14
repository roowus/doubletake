CREATE TABLE IF NOT EXISTS "ig_prompts" (
	"sender_id" text PRIMARY KEY NOT NULL,
	"last_prompt_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ig_prompt_optouts" (
	"sender_id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
