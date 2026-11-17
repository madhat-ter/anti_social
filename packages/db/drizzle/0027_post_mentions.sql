-- RFC §10.16: @mentions. The post body stays plain text; who was really mentioned lives here,
-- written when the post is saved, so links survive a handle change and edits can diff.
create table if not exists post_mentions (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
--> statement-breakpoint
create index if not exists post_mentions_user on post_mentions(user_id, created_at);
