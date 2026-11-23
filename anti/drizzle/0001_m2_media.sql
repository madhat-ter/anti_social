ALTER TABLE "post_images" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_images" ALTER COLUMN "position" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "post_images" ADD COLUMN "uploader_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "post_images" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_images_post" ON "post_images" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_images_uploader" ON "post_images" USING btree ("uploader_id");