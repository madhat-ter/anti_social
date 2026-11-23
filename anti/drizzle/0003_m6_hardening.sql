CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rate_limits_window" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "flags_open" ON "flags" USING btree ("post_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "notif_push_queue" ON "notifications" USING btree ("created_at") WHERE pushed_at is null;--> statement-breakpoint
-- Existing notifications predate Web Push: never fan them out.
UPDATE "notifications" SET "pushed_at" = "created_at";