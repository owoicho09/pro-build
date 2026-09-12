CREATE TABLE IF NOT EXISTS "password_reset_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "password_reset_otps_email_idx" ON "password_reset_otps" USING btree ("email","created_at");