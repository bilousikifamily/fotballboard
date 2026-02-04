create table if not exists club_api_map (
  id bigserial primary key,
  slug text,
  league_id text,
  name text,
  normalized_name text not null,
  api_team_id int not null,
  api_team_name text,
  api_team_code text,
  api_team_country text,
  api_team_logo text,
  api_team_founded int,
  api_team_national boolean,
  season int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_match_stats (
  id uuid primary key,
  match_date timestamptz not null,
  home_team_name text not null,
  away_team_name text not null,
  home_goals int4,
  away_goals int4,
  home_avg_rating numeric,
  away_avg_rating numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists users add column if not exists subscription_expires_at timestamptz;
alter table if exists users add column if not exists subscription_paid_months int;
alter table if exists users add column if not exists subscription_free_month_used boolean default false;

create unique index if not exists club_api_map_slug_unique on club_api_map (slug);
create unique index if not exists club_api_map_api_team_id_unique on club_api_map (api_team_id);
create index if not exists club_api_map_normalized_name_idx on club_api_map (normalized_name);

create index if not exists team_match_stats_match_date_idx on team_match_stats (match_date);
create index if not exists team_match_stats_home_team_name_idx on team_match_stats (home_team_name);
create index if not exists team_match_stats_away_team_name_idx on team_match_stats (away_team_name);

alter table if exists matches add column if not exists start_digest_sent_at timestamptz;
alter table if exists matches add column if not exists odds_manual_home double precision;
alter table if exists matches add column if not exists odds_manual_draw double precision;
alter table if exists matches add column if not exists odds_manual_away double precision;
alter table if exists matches add column if not exists odds_manual_updated_at timestamptz;

alter table if exists predictions add column if not exists season_month text;
alter table if exists missed_predictions add column if not exists season_month text;

create index if not exists predictions_season_month_idx on predictions (season_month);
create index if not exists missed_predictions_season_month_idx on missed_predictions (season_month);

create table if not exists match_result_notification_jobs (
  id bigserial primary key,
  job_key text not null,
  user_id bigint not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists match_result_notification_jobs_job_key_uidx
  on match_result_notification_jobs (job_key);
create index if not exists match_result_notification_jobs_status_next_attempt_idx
  on match_result_notification_jobs (status, next_attempt_at);
create index if not exists match_result_notification_jobs_locked_at_idx
  on match_result_notification_jobs (locked_at);
