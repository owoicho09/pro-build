ALTER TABLE "builds" ADD COLUMN "repair_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "validation_error" text;