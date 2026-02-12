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
alter table if exists users add column if not exists bot_blocked boolean default false;
alter table if exists users add column if not exists bot_blocked_at timestamptz;

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

create table if not exists bot_message_logs (
  id bigserial primary key,
  chat_id bigint,
  user_id bigint,
  user_nickname text,
  admin_id text,
  thread_id int4,
  message_id int4,
  direction text not null,
  sender text not null,
  message_type text not null,
  text text,
  delivery_status text,
  error_code int4,
  http_status int4,
  error_message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

alter table if exists bot_message_logs add column if not exists user_nickname text;
alter table if exists bot_message_logs add column if not exists admin_id text;
alter table if exists bot_message_logs add column if not exists direction text;
alter table if exists bot_message_logs add column if not exists sender text;
alter table if exists bot_message_logs add column if not exists delivery_status text;
alter table if exists bot_message_logs add column if not exists error_code int4;
alter table if exists bot_message_logs add column if not exists http_status int4;
alter table if exists bot_message_logs add column if not exists error_message text;

create index if not exists bot_message_logs_chat_id_idx on bot_message_logs (chat_id);
create index if not exists bot_message_logs_user_id_idx on bot_message_logs (user_id);
create index if not exists bot_message_logs_created_at_idx on bot_message_logs (created_at);
create index if not exists bot_message_logs_user_created_idx on bot_message_logs (user_id, created_at);

create table if not exists announcement_queue (
  id bigserial primary key,
  job_key text not null,
  user_id bigint not null,
  caption text,
  match_ids int4[] not null,
  status text not null,
  attempts int4 not null default 0,
  max_attempts int4 not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists announcement_queue_job_key_uidx
  on announcement_queue (job_key);
create index if not exists announcement_queue_status_next_attempt_idx
  on announcement_queue (status, next_attempt_at);
create index if not exists announcement_queue_locked_at_idx
  on announcement_queue (locked_at);

create table if not exists announcement_audit (
  id bigserial primary key,
  user_id bigint,
  chat_id bigint,
  status text not null,
  reason text,
  caption text,
  match_ids int4[],
  error_code int4,
  http_status int4,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists announcement_audit_user_id_idx on announcement_audit (user_id);
create index if not exists announcement_audit_created_at_idx on announcement_audit (created_at);

create or replace view admin_chat_threads as
select distinct on (log.user_id)
  log.user_id,
  log.chat_id,
  log.direction,
  log.sender,
  log.message_type,
  log.text as last_text,
  log.created_at as last_message_at,
  users.username,
  users.first_name,
  users.last_name,
  users.nickname,
  users.photo_url,
  users.last_seen_at
from bot_message_logs log
left join users on users.id = log.user_id
where log.user_id is not null
order by log.user_id, log.created_at desc;
