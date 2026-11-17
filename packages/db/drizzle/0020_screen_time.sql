CREATE TABLE "screen_time" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"used_s" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "screen_time" ADD CONSTRAINT "screen_time_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;