ALTER TABLE "builds" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "builds" SET "user_id" = "projects"."owner_id" FROM "projects" WHERE "projects"."id" = "builds"."project_id" AND "builds"."user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "builds" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "builds" ADD COLUMN "last_dispatch_attempt_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "builds" ADD CONSTRAINT "builds_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builds_user_id_idx" ON "builds" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "builds_one_active_per_user" ON "builds" USING btree ("user_id") WHERE "builds"."state" in ('queued', 'streaming');