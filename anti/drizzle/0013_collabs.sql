CREATE TABLE "collab_interests" (
	"collab_id" uuid NOT NULL,
	"interest" text NOT NULL,
	CONSTRAINT "collab_interests_collab_id_interest_pk" PRIMARY KEY("collab_id","interest")
);
--> statement-breakpoint
CREATE TABLE "collab_invites" (
	"collab_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collab_invites_collab_id_user_id_pk" PRIMARY KEY("collab_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collab_members" (
	"collab_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collab_members_collab_id_user_id_pk" PRIMARY KEY("collab_id","user_id"),
	CONSTRAINT "collab_members_role" CHECK ("collab_members"."role" in ('host', 'cohost', 'member'))
);
--> statement-breakpoint
CREATE TABLE "collab_requests" (
	"collab_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "collab_requests_collab_id_user_id_pk" PRIMARY KEY("collab_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"team_max" integer NOT NULL,
	"join_mode" text DEFAULT 'approve' NOT NULL,
	"status" text DEFAULT 'recruiting' NOT NULL,
	"price_note" text,
	"payment_url" text,
	"cover_key" text,
	"cover_width" integer,
	"cover_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "collabs_title_len" CHECK (char_length("collabs"."title") between 1 and 80),
	CONSTRAINT "collabs_team_max" CHECK ("collabs"."team_max" between 2 and 20),
	CONSTRAINT "collabs_join_mode" CHECK ("collabs"."join_mode" in ('open', 'approve')),
	CONSTRAINT "collabs_status" CHECK ("collabs"."status" in ('recruiting', 'closed', 'finished'))
);
--> statement-breakpoint
ALTER TABLE "collab_interests" ADD CONSTRAINT "collab_interests_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_interests" ADD CONSTRAINT "collab_interests_interest_interests_slug_fk" FOREIGN KEY ("interest") REFERENCES "public"."interests"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_invites" ADD CONSTRAINT "collab_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_members" ADD CONSTRAINT "collab_members_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_members" ADD CONSTRAINT "collab_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_requests" ADD CONSTRAINT "collab_requests_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_requests" ADD CONSTRAINT "collab_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collab_interests_interest" ON "collab_interests" USING btree ("interest");--> statement-breakpoint
CREATE INDEX "collab_members_user" ON "collab_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collabs_live" ON "collabs" USING btree ("created_at") WHERE deleted_at is null;