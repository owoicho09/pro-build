ALTER TYPE "public"."usage_event_type" ADD VALUE 'repair_prompt_generation';--> statement-breakpoint
ALTER TYPE "public"."usage_event_type" ADD VALUE 'initial_generation';--> statement-breakpoint
ALTER TYPE "public"."usage_event_type" ADD VALUE 'continuation_generation';--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "generation_kind" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "provider_reference" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_provider_reference_idx" ON "usage_events" USING btree ("provider_reference") WHERE "usage_events"."provider_reference" is not null;