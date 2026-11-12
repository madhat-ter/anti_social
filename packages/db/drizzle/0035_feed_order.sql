-- RFC §10.23: the home feed is mixed for everyone unless a member chooses newest first in Settings.
ALTER TABLE "users" ADD COLUMN "feed_order" text DEFAULT 'mixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_feed_order" CHECK ("users"."feed_order" in ('mixed', 'newest'));
