-- RFC §10.22: monologues. A post can carry one recording (a song, a thought, a yap), drawn as a
-- cassette. The recording is uploaded first (post_id null while it waits), then posted with a
-- title and a kind. Deleting the post erases the sound (the API removes the stored file).
create table if not exists monologues (
  id uuid primary key default gen_random_uuid(),
  post_id uuid unique references posts(id) on delete cascade,
  uploader_id uuid not null references users(id) on delete cascade,
  audio_key text not null,
  content_type text not null,
  size_bytes integer not null,
  duration_ms integer not null,
  peaks jsonb not null,
  source text not null,
  title text,
  kind text,
  created_at timestamptz not null default now(),
  constraint monologues_duration check (duration_ms between 1000 and 301000),
  constraint monologues_kind check (kind is null or kind in ('song', 'thought', 'yap')),
  constraint monologues_title_len check (title is null or char_length(title) between 1 and 80),
  constraint monologues_source check (source in ('recorded', 'uploaded')),
  constraint monologues_posted check (post_id is null or (title is not null and kind is not null))
);
--> statement-breakpoint
create index if not exists monologues_uploader on monologues (uploader_id);
--> statement-breakpoint
-- the Monologue page keeps its own "new since" line, apart from the feed's
alter table users add column if not exists monologues_seen_through timestamptz;
