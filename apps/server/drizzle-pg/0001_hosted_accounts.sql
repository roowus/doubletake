-- Hosted mode (ADR 0032): accounts, sessions, BYOK credential vault, OAuth state.
-- Hand-written additive migration; idempotent so it can apply on top of any 0000 state.
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" text,
	"password_hash" text,
	"google_sub" text,
	"display_name" text,
	"created_at" text NOT NULL,
	"disabled_at" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text DEFAULT 'browser' NOT NULL,
	"label" text,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"revoked_at" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text,
	"label" text,
	"sealed_key" text NOT NULL,
	"meta" text,
	"monthly_cap_usd" double precision,
	"per_run_cap_usd" double precision,
	"last_used_at" text,
	"revoked_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text,
	"return_to" text,
	"code_verifier" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credentials_user_idx" ON "credentials" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_states_created_idx" ON "oauth_states" ("created_at");
