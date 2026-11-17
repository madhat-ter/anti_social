-- Visitor passes are gone (owner, 2026-11-17). The functions name the table, so they go first.
drop function if exists open_visitor_pass(text, text);--> statement-breakpoint
drop function if exists create_visitor_pass(uuid, text, text);--> statement-breakpoint
drop table if exists visitor_passes;
