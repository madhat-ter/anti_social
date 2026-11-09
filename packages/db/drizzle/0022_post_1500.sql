ALTER TABLE "posts" DROP CONSTRAINT "posts_body_len";--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_body_len" CHECK (char_length("posts"."body") <= 1500);