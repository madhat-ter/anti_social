CREATE TYPE "public"."gender" AS ENUM('woman', 'man', 'nonbinary', 'undisclosed');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" "gender";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthday" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthday_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "setup_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "checklist_dismissed_at" timestamp with time zone;