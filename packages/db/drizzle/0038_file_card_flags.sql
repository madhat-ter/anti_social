-- RFC §10.24: reports on a File card, the same shape and lifecycle as reports on a project.
CREATE TABLE "file_card_flags" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "card_id" uuid NOT NULL REFERENCES "file_cards"("id") ON DELETE CASCADE,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolution" text,
  CONSTRAINT "file_card_flags_pk" PRIMARY KEY ("user_id", "card_id")
);--> statement-breakpoint
CREATE INDEX "file_card_flags_open" ON "file_card_flags" ("card_id") WHERE "resolved_at" is null;
