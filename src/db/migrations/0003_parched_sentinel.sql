ALTER TABLE "plans" ADD COLUMN "paystack_plan_code" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "paystack_email_token" text;