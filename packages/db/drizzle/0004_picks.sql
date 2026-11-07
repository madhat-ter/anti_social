CREATE TYPE "public"."suggestion_kind" AS ENUM('movie', 'book', 'place', 'food');--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "suggestion_kind" NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "suggestions_title_len" CHECK (char_length("suggestions"."title") between 1 and 80),
	CONSTRAINT "suggestions_note_len" CHECK ("suggestions"."note" is null or char_length("suggestions"."note") <= 140)
);
--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestions_author" ON "suggestions" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "suggestions_live" ON "suggestions" USING btree ("created_at") WHERE deleted_at is null;