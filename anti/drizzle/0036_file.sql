-- RFC §10.24, the File: each member's drawer of 12 pages, one card a page. A card has a headline,
-- 1-20 photos (each with an optional caption) and a description. maker_id = for_id is the member's
-- own card; otherwise it is a card made for someone (sent_at: handed over; declined_at: quietly
-- turned down; public_ok: the maker allows it on the public share page).
CREATE TABLE "file_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "maker_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "for_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "headline" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "sent_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "public_ok" boolean DEFAULT false NOT NULL,
  "hidden_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "file_cards_headline_len" CHECK (char_length("headline") between 1 and 60),
  CONSTRAINT "file_cards_description_len" CHECK (char_length("description") <= 1200)
);--> statement-breakpoint
CREATE INDEX "file_cards_for" ON "file_cards" ("for_id");--> statement-breakpoint
CREATE INDEX "file_cards_maker" ON "file_cards" ("maker_id");--> statement-breakpoint
CREATE TABLE "file_card_photos" (
  "id" uuid PRIMARY KEY NOT NULL,
  "card_id" uuid NOT NULL REFERENCES "file_cards"("id") ON DELETE CASCADE,
  "r2_key" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "caption" text DEFAULT '' NOT NULL,
  CONSTRAINT "file_card_photos_position" CHECK ("position" between 0 and 19),
  CONSTRAINT "file_card_photos_caption_len" CHECK (char_length("caption") <= 140)
);--> statement-breakpoint
CREATE INDEX "file_card_photos_card" ON "file_card_photos" ("card_id", "position");--> statement-breakpoint
CREATE TABLE "file_pages" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "card_id" uuid REFERENCES "file_cards"("id") ON DELETE SET NULL,
  CONSTRAINT "file_pages_pk" PRIMARY KEY ("user_id", "position"),
  CONSTRAINT "file_pages_position" CHECK ("position" between 0 and 11),
  CONSTRAINT "file_pages_label_len" CHECK (char_length("label") <= 14)
);--> statement-breakpoint
CREATE UNIQUE INDEX "file_pages_card" ON "file_pages" ("card_id") WHERE "card_id" is not null;