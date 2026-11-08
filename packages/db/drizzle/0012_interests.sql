CREATE TABLE "interests" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interests_slug" CHECK ("interests"."slug" ~ '^[a-z0-9-]{2,30}$'),
	CONSTRAINT "interests_label_len" CHECK (char_length("interests"."label") between 2 and 30)
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" uuid NOT NULL,
	"interest" text NOT NULL,
	CONSTRAINT "user_interests_user_id_interest_pk" PRIMARY KEY("user_id","interest")
);
--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_interest_interests_slug_fk" FOREIGN KEY ("interest") REFERENCES "public"."interests"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_interests_interest" ON "user_interests" USING btree ("interest");