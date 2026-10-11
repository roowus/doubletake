CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"path" text NOT NULL,
	"bytes" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" text,
	"brain_session_id" text,
	"brain_adapter" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chats_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"collection_id" text NOT NULL,
	"item_id" text NOT NULL,
	"added_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"manual" integer DEFAULT 0 NOT NULL,
	"auto" integer DEFAULT 0 NOT NULL,
	"hidden" integer DEFAULT 0 NOT NULL,
	"share_token" text
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cost_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"day" text NOT NULL,
	"adapter" text NOT NULL,
	"model" text,
	"cost_usd" double precision NOT NULL,
	"run_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" text,
	"revoked_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"run_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"attributes" text DEFAULT '{}' NOT NULL,
	"url" text,
	"confidence" double precision,
	"starred" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"tool" text,
	"model" text,
	"cost_usd" double precision,
	"duration_ms" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_accounts" (
	"ig_user_id" text PRIMARY KEY NOT NULL,
	"username" text,
	"access_token_enc" text NOT NULL,
	"expires_at" text,
	"refreshed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"raw" text NOT NULL,
	"item_id" text,
	"sender_id" text,
	"received_at" text NOT NULL,
	"processed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "item_tags" (
	"item_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"confidence" double precision
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_url" text,
	"canonical_url" text,
	"platform" text NOT NULL,
	"channel" text NOT NULL,
	"note" text,
	"text" text,
	"focus" text DEFAULT 'whole' NOT NULL,
	"mode_requested" text DEFAULT 'auto' NOT NULL,
	"mode_effective" text,
	"question_type" text,
	"category" text,
	"status" text DEFAULT 'new' NOT NULL,
	"title" text,
	"client_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_s" double precision,
	"width" integer,
	"height" integer,
	"frame_ts_s" double precision,
	"source" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"structured" text,
	"run_id" text,
	"created_at" text NOT NULL,
	"read_at" text
);
--> statement-breakpoint
CREATE TABLE "pending_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "place_geo" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"label" text,
	"provider" text NOT NULL,
	"resolved_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"kind" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" text,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"kind" text DEFAULT 'research' NOT NULL,
	"mode" text NOT NULL,
	"adapter" text NOT NULL,
	"model" text,
	"pinned" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"user_message" text,
	"started_at" text,
	"finished_at" text,
	"cost_usd" double precision,
	"tokens_in" integer,
	"tokens_out" integer,
	"error" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'auto' NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "todos" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"note" text,
	"attributes" text DEFAULT '{}' NOT NULL,
	"chat_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"done_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_events" ADD CONSTRAINT "ig_events_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tags" ADD CONSTRAINT "item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "todos" ADD CONSTRAINT "todos_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_pk" ON "collection_items" USING btree ("collection_id","item_id");--> statement-breakpoint
CREATE INDEX "collection_items_item_idx" ON "collection_items" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_share_token_idx" ON "collections" USING btree ("share_token");--> statement-breakpoint
CREATE INDEX "cost_ledger_day" ON "cost_ledger" USING btree ("day");--> statement-breakpoint
CREATE INDEX "entities_kind_name" ON "entities" USING btree ("kind","name");--> statement-breakpoint
CREATE INDEX "ig_events_item_idx" ON "ig_events" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_tags_pk" ON "item_tags" USING btree ("item_id","tag_id");--> statement-breakpoint
CREATE INDEX "items_dedupe" ON "items" USING btree ("canonical_url","focus","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_client_id_idx" ON "items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "media_assets_item_idx" ON "media_assets" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "messages_chat" ON "messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_run" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_status" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "todos_done_created_idx" ON "todos" USING btree ("done_at","created_at");