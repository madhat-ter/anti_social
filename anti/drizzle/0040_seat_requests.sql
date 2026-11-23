-- RFC §10.25: someone with no invite and nobody inside to ask can ask for a seat from the landing
-- page. No account: a typed name, one way to reach them (sealed like members' contact details,
-- RFC §10.7) and a few words if they want. Only admins see it. An admin's "Not now" erases the
-- row; one that was answered with an invite is erased 30 days later.
CREATE TABLE "seat_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "contact_enc" text NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "invited_at" timestamp with time zone,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "seat_requests_name_len" CHECK (char_length("name") between 1 and 40),
  CONSTRAINT "seat_requests_note_len" CHECK (char_length("note") <= 500)
);--> statement-breakpoint
CREATE INDEX "seat_requests_created" ON "seat_requests" ("created_at");
