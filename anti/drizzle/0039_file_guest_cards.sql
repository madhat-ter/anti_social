-- RFC §10.24: a card made by someone outside anti, on a member's public share page. There is no
-- maker account: maker_id is null and guest_name is the name they typed. Such a card is sent at
-- once (it waits in the member's tray) and may always show on the share page.
ALTER TABLE "file_cards" ALTER COLUMN "maker_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file_cards" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "file_cards" ADD CONSTRAINT "file_cards_maker_or_guest" CHECK (
  ("maker_id" is not null and "guest_name" is null)
  or ("maker_id" is null and char_length("guest_name") between 1 and 40)
);
