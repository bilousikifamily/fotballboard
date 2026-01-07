create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  admin boolean not null default false,
  points_total int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
