create table if not exists analitika (
  id bigserial primary key,
  cache_key text not null,
  team_slug text not null,
  data_type text not null,
  league_id text,
  season int,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create unique index if not exists analitika_cache_key_unique on analitika (cache_key);
create index if not exists analitika_team_slug_idx on analitika (team_slug);
create index if not exists analitika_expires_at_idx on analitika (expires_at);
