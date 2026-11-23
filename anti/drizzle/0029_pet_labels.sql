-- RFC §10.17: pet updates are Everyday, Advice, Health or Help ("News" became "Advice").
update posts set pet_label = 'advice' where pet_label = 'news';
--> statement-breakpoint
alter table posts drop constraint if exists posts_pet_label_check;
--> statement-breakpoint
alter table posts add constraint posts_pet_label_check
  check (pet_label in ('everyday', 'advice', 'health', 'help'));
