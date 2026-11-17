ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'light' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme" CHECK ("users"."theme" in ('light', 'dark'));