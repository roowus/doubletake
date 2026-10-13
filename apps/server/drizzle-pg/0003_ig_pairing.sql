CREATE TABLE "ig_pairing_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "ig_links" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "sender_id" text NOT NULL,
  "ig_username" text,
  "created_at" text NOT NULL,
  "revoked_at" text
);--> statement-breakpoint
ALTER TABLE "ig_pairing_codes" ADD CONSTRAINT "ig_pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ig_links" ADD CONSTRAINT "ig_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "ig_links_sender_id_unique" ON "ig_links" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "ig_pairing_codes_user_idx" ON "ig_pairing_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ig_links_user_idx" ON "ig_links" USING btree ("user_id");
