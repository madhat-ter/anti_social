-- Screen time is gone (owner, 2026-11-11; RFC §10.10 records what it was). The half hour, the
-- lock and the admins' switch are removed from the site; this drops what it kept: each member's
-- minutes and lock, and the switch itself.
drop table if exists screen_time;
--> statement-breakpoint
delete from settings where key = 'screen_time';