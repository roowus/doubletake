ALTER TABLE "chats" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "collection_items" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "credential_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "item_tags" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "place_geo" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "run_events" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE INDEX "chats_user_created_idx" ON "chats" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cost_ledger_user_created_idx" ON "cost_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_client_id_null_idx" ON "items" USING btree ("client_id") WHERE user_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "items_user_client_idx" ON "items" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "items_user_created_idx" ON "items" USING btree ("user_id","created_at" DESC NULLS LAST);