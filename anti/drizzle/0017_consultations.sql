CREATE TABLE "consult_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_user_id" uuid,
	"consultation_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "consult_flags_one_target" CHECK (("consult_flags"."offer_user_id" is null) <> ("consult_flags"."consultation_id" is null))
);
--> statement-breakpoint
CREATE TABLE "consult_offers" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"minutes" integer DEFAULT 60 NOT NULL,
	"pricing" text DEFAULT 'free' NOT NULL,
	"price_note" text,
	"payment_url" text,
	"contact" text DEFAULT '' NOT NULL,
	"blocked_at" timestamp with time zone,
	"hidden_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consult_offers_pricing" CHECK ("consult_offers"."pricing" in ('free', 'paid')),
	CONSTRAINT "consult_offers_description_len" CHECK (char_length("consult_offers"."description") <= 500),
	CONSTRAINT "consult_offers_contact_len" CHECK (char_length("consult_offers"."contact") <= 300)
);
--> statement-breakpoint
CREATE TABLE "consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultant_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"topic_label" text NOT NULL,
	"need" text NOT NULL,
	"when_text" text DEFAULT '' NOT NULL,
	"minutes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pricing" text,
	"price_note" text,
	"payment_url" text,
	"requester_contact" text,
	"consultant_contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"revealed_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"contacts_hidden_at" timestamp with time zone,
	"thanks" text,
	"thanks_at" timestamp with time zone,
	"thanks_hidden" boolean DEFAULT false NOT NULL,
	CONSTRAINT "consultations_status" CHECK ("consultations"."status" in ('pending', 'accepted', 'revealed', 'done', 'declined', 'expired', 'closed')),
	CONSTRAINT "consultations_pricing" CHECK ("consultations"."pricing" is null or "consultations"."pricing" in ('free', 'paid')),
	CONSTRAINT "consultations_need_len" CHECK (char_length("consultations"."need") between 1 and 1000),
	CONSTRAINT "consultations_when_len" CHECK (char_length("consultations"."when_text") <= 200),
	CONSTRAINT "consultations_thanks_len" CHECK ("consultations"."thanks" is null or char_length("consultations"."thanks") between 1 and 300),
	CONSTRAINT "consultations_two_people" CHECK ("consultations"."consultant_id" <> "consultations"."requester_id")
);
--> statement-breakpoint
ALTER TABLE "consult_flags" ADD CONSTRAINT "consult_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consult_flags" ADD CONSTRAINT "consult_flags_offer_user_id_users_id_fk" FOREIGN KEY ("offer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consult_flags" ADD CONSTRAINT "consult_flags_consultation_id_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consult_offers" ADD CONSTRAINT "consult_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consult_flags_offer_once" ON "consult_flags" USING btree ("user_id","offer_user_id") WHERE offer_user_id is not null and resolved_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "consult_flags_request_once" ON "consult_flags" USING btree ("user_id","consultation_id") WHERE consultation_id is not null and resolved_at is null;--> statement-breakpoint
CREATE INDEX "consultations_consultant" ON "consultations" USING btree ("consultant_id","created_at");--> statement-breakpoint
CREATE INDEX "consultations_requester" ON "consultations" USING btree ("requester_id","created_at");