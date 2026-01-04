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

alter table users add column if not exists admin boolean default false;
alter table users add column if not exists points_total int default 100;
alter table users add column if not exists created_at timestamptz default now();

alter table matches add column if not exists status text default 'scheduled';
alter table matches add column if not exists home_score int;
alter table matches add column if not exists away_score int;
alter table matches add column if not exists created_by bigint references users(id);

alter table predictions add column if not exists points int default 0;
alter table predictions add column if not exists updated_at timestamptz default now();

create unique index if not exists predictions_user_match_unique on predictions (user_id, match_id);
