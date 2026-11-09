-- RFC §10.17: pet looks are endless, not a fixed 100 per species. Any variant number draws a face.
alter table pets drop constraint if exists pets_avatar_variant_check;
--> statement-breakpoint
alter table pets add constraint pets_avatar_variant_check check (avatar_variant >= 0 and avatar_variant <= 1000000);
