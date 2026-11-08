ALTER TABLE "portfolios" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "cover_width" integer;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "cover_height" integer;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "font" text DEFAULT 'archivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "bg" text DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "accent" text DEFAULT 'red' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_font" CHECK ("portfolios"."font" in ('archivo', 'mono', 'hand'));--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_bg" CHECK ("portfolios"."bg" in ('paper', 'ink'));--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_accent" CHECK ("portfolios"."accent" in ('red', 'blue', 'green', 'yellow', 'violet', 'orange'));