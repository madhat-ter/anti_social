CREATE TABLE "project_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"layout" text DEFAULT 'full' NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	CONSTRAINT "project_images_layout" CHECK ("project_images"."layout" in ('full', 'left', 'right')),
	CONSTRAINT "project_images_position" CHECK ("project_images"."position" between 0 and 9)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"year" integer,
	"role" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"duration" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_title_len" CHECK (char_length("projects"."title") between 1 and 80),
	CONSTRAINT "projects_summary_len" CHECK (char_length("projects"."summary") <= 200),
	CONSTRAINT "projects_body_len" CHECK (char_length("projects"."body") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "project_images" ADD CONSTRAINT "project_images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_images_project" ON "project_images" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "projects_owner" ON "projects" USING btree ("user_id","position");