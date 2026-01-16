create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  admin boolean not null default false,
  points_total int not null default 100,
  faction_club_id text,
  nickname text,
  avatar_choice text,
  logo_order text[],
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists matches (
  id bigserial primary key,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled',
  home_score int,
  away_score int,
  created_by bigint references users(id),
  start_digest_sent_at timestamptz,
  reminder_sent_at timestamptz,
  api_league_id int,
  api_fixture_id bigint,
  odds_json jsonb,
  odds_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  home_pred int not null,
  away_pred int not null,
  points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create table if not exists missed_predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);

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

create table if not exists analitika_static (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists analitika_static_expires_at_idx on analitika_static (expires_at);

create table if not exists team_match_stats (
  id uuid primary key,
  team_name text not null,
  opponent_name text not null,
  match_date timestamptz not null,
  is_home boolean not null default false,
  team_goals int,
  opponent_goals int,
  avg_rating numeric
);

create index if not exists team_match_stats_team_name_idx on team_match_stats (team_name);
create index if not exists team_match_stats_match_date_idx on team_match_stats (match_date);
