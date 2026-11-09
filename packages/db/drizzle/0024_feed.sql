CREATE TABLE "feed_visits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feed_visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"new_posts" integer NOT NULL,
	"caught_up_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "feed_seen_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_visits" ADD CONSTRAINT "feed_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_visits_user" ON "feed_visits" USING btree ("user_id","started_at");