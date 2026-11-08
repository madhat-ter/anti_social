CREATE TABLE "collab_flags" (
	"user_id" uuid NOT NULL,
	"collab_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "collab_flags_user_id_collab_id_pk" PRIMARY KEY("user_id","collab_id")
);
--> statement-breakpoint
CREATE TABLE "event_interests" (
	"event_id" uuid NOT NULL,
	"interest" text NOT NULL,
	CONSTRAINT "event_interests_event_id_interest_pk" PRIMARY KEY("event_id","interest")
);
--> statement-breakpoint
CREATE TABLE "event_invites" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_invites_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_requests" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "event_requests_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "requirements" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "join_mode" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "collab_flags" ADD CONSTRAINT "collab_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_flags" ADD CONSTRAINT "collab_flags_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_interest_interests_slug_fk" FOREIGN KEY ("interest") REFERENCES "public"."interests"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invites" ADD CONSTRAINT "event_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collab_flags_open" ON "collab_flags" USING btree ("collab_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "event_interests_interest" ON "event_interests" USING btree ("interest");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_join_mode" CHECK (("events"."join_mode" in ('open', 'approve')));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_requirements_len" CHECK (char_length("events"."requirements") <= 500);