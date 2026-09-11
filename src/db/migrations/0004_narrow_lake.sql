CREATE TABLE IF NOT EXISTS "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"description" text,
	"category" text NOT NULL,
	"thumbnail_url" text,
	"is_premium" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"build_prompt" text NOT NULL,
	"system_instructions" text,
	"source_v0_project_id" text,
	"source_v0_chat_id" text,
	"source_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "template_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "templates_slug_idx" ON "templates" USING btree ("slug");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
