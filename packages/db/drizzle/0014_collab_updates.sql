ALTER TABLE "events" ADD COLUMN "collab_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience" text DEFAULT 'anyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "collab_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_collab_id_collabs_id_fk" FOREIGN KEY ("collab_id") REFERENCES "public"."collabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_collab" ON "events" USING btree ("collab_id") WHERE collab_id is not null;--> statement-breakpoint
CREATE INDEX "posts_collab" ON "posts" USING btree ("collab_id","created_at") WHERE collab_id is not null;--> statement-breakpoint
CREATE INDEX "posts_event" ON "posts" USING btree ("event_id","created_at") WHERE event_id is not null;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_audience" CHECK (("events"."audience" = 'anyone') or ("events"."audience" = 'team' and "events"."collab_id" is not null));