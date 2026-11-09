-- RFC §10.17: Pet Corner. A pet is a content identity owned by one member; it posts as itself.
create table if not exists pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  species text not null check (species in ('dog', 'cat', 'bird')),
  -- 0..99: which of the 100 drawn looks for this species (ignored when avatar_key is set)
  avatar_variant integer not null default 0 check (avatar_variant between 0 and 99),
  -- an uploaded picture; null means the drawn look
  avatar_key text,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists pets_owner on pets(owner_id, created_at);
--> statement-breakpoint
alter table posts add column pet_id uuid references pets(id) on delete cascade;
--> statement-breakpoint
alter table posts add column pet_label text check (pet_label in ('everyday', 'news', 'health'));
--> statement-breakpoint
create index if not exists posts_pet on posts(pet_id, created_at desc)
  where pet_id is not null and deleted_at is null and hidden_at is null;
