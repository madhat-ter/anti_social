-- RFC §10.21: Events and Collabs become one place. A collab gains a `kind`: an activity keeps
-- going with no end, a project is a team with roles and a finish. Every collab that existed
-- before this migration is a project (the host can switch it).
alter table collabs add column if not exists kind text not null default 'project';
--> statement-breakpoint
alter table collabs add column if not exists meets text not null default '';
--> statement-breakpoint
alter table collabs alter column team_max drop not null;
--> statement-breakpoint
alter table collabs add column if not exists quiet_nudged_at timestamptz;
--> statement-breakpoint
alter table collabs drop constraint if exists collabs_kind;
--> statement-breakpoint
alter table collabs add constraint collabs_kind check (kind in ('activity', 'project'));
--> statement-breakpoint
alter table collabs drop constraint if exists collabs_team_max;
--> statement-breakpoint
-- a project team is 2-20; an activity may have no limit, or one the host sets
alter table collabs add constraint collabs_team_max check (
  (kind = 'project' and team_max between 2 and 20)
  or (kind = 'activity' and (team_max is null or team_max between 2 and 1000)));
--> statement-breakpoint
alter table collabs drop constraint if exists collabs_meets_len;
--> statement-breakpoint
alter table collabs add constraint collabs_meets_len check (char_length(meets) <= 120);
--> statement-breakpoint
alter table collabs drop constraint if exists collabs_activity_status;
--> statement-breakpoint
-- an activity runs or ends: it never has a "team set" in between
alter table collabs add constraint collabs_activity_status check (kind = 'project' or status in ('recruiting', 'finished'));
--> statement-breakpoint
alter table collab_members add column if not exists slot text;
--> statement-breakpoint
alter table collab_requests add column if not exists slot text;
--> statement-breakpoint
alter table collab_requests add column if not exists reminded_at timestamptz;
--> statement-breakpoint
alter table event_requests add column if not exists reminded_at timestamptz;
--> statement-breakpoint
-- RFC §10.21: co-hosts on an event. `events.host_id` is still the host; this table holds the rest.
create table if not exists event_hosts (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
--> statement-breakpoint
alter table users add column if not exists collab_intro_seen_at timestamptz;
--> statement-breakpoint
-- Members from before see the one-time "Events and Collabs are one place now" strip; members who
-- join from now on are given a value and never see it.
alter table users alter column collab_intro_seen_at set default now();
