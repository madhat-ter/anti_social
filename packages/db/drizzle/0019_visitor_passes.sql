CREATE TABLE "visitor_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"opened_at" timestamp with time zone,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "visitor_passes_label_len" CHECK (char_length("visitor_passes"."label") <= 80)
);
--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_passes_code" ON "visitor_passes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_passes_token" ON "visitor_passes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "visitor_passes_created" ON "visitor_passes" USING btree ("created_at");