CREATE TABLE "suggestion_votes" (
	"suggestion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"vote" integer NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_votes_suggestion_id_user_id_pk" PRIMARY KEY("suggestion_id","user_id"),
	CONSTRAINT "suggestion_votes_vote" CHECK ("suggestion_votes"."vote" in (-1, 1)),
	CONSTRAINT "suggestion_votes_remark_len" CHECK ("suggestion_votes"."remark" is null or char_length("suggestion_votes"."remark") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_votes_user" ON "suggestion_votes" USING btree ("user_id");