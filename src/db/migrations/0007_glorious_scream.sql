ALTER TABLE "builds" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "dispatch_attempts" integer DEFAULT 0 NOT NULL;