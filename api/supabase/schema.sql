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
alter table if exists users add column if not exists created_at timestamptz default now();

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
  user_nickname text,
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

alter table if exists match_result_notification_jobs
  add column if not exists user_nickname text;

create table if not exists bot_message_deliveries (
  id bigserial primary key,
  context text not null,
  telegram_method text,
  chat_id text,
  user_id bigint,
  user_nickname text,
  message_id bigint,
  status text not null,
  attempt int,
  telegram_status int,
  telegram_body text,
  error text,
  payload jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists bot_message_deliveries_user_id_idx on bot_message_deliveries (user_id);
create index if not exists bot_message_deliveries_status_created_idx on bot_message_deliveries (status, created_at);
create index if not exists bot_message_deliveries_chat_id_idx on bot_message_deliveries (chat_id);

create or replace function public.apply_match_result_atomic(
  p_match_id bigint,
  p_home_score integer,
  p_away_score integer,
  p_kickoff_at timestamptz,
  p_season_month text,
  p_starting_points integer default 100,
  p_missed_penalty integer default -1
)
returns table(user_id bigint, delta integer, total_points integer)
language plpgsql
as $$
begin
  update public.matches
  set home_score = p_home_score,
      away_score = p_away_score,
      status = 'finished'
  where id = p_match_id;
  if not found then
    raise exception 'match_not_found';
  end if;

  return query
  with prediction_changes as (
    select
      p.id,
      p.user_id,
      coalesce(p.points, 0) as current_points,
      case
        when p.home_pred = p_home_score and p.away_pred = p_away_score then 5
        when
          (case when p.home_pred = p.away_pred then 0 when p.home_pred > p.away_pred then 1 else -1 end) =
          (case when p_home_score = p_away_score then 0 when p_home_score > p_away_score then 1 else -1 end)
        then 1
        else -1
      end as new_points
    from public.predictions p
    where p.match_id = p_match_id
  ),
  updated_predictions as (
    update public.predictions p
    set points = c.new_points
    from prediction_changes c
    where p.id = c.id
      and p.points is distinct from c.new_points
    returning c.user_id, (c.new_points - c.current_points)::integer as delta
  ),
  prediction_deltas as (
    select user_id, sum(delta)::integer as delta
    from updated_predictions
    group by user_id
  ),
  updated_prediction_users as (
    update public.users u
    set points_total = coalesce(u.points_total, p_starting_points) + d.delta,
        updated_at = now()
    from prediction_deltas d
    where u.id = d.user_id
      and d.delta <> 0
    returning u.id::bigint as user_id, d.delta::integer as delta, u.points_total::integer as total_points
  )
  select user_id, delta, total_points
  from updated_prediction_users;

  return query
  with penalty_candidates as (
    select u.id
    from public.users u
    where u.faction_club_id is not null
      and (u.created_at is null or u.created_at < p_kickoff_at)
      and not exists (
        select 1
        from public.predictions p
        where p.match_id = p_match_id
          and p.user_id = u.id
      )
      and not exists (
        select 1
        from public.missed_predictions mp
        where mp.match_id = p_match_id
          and mp.user_id = u.id
      )
  ),
  inserted_penalties as (
    insert into public.missed_predictions (user_id, match_id, season_month)
    select id, p_match_id, p_season_month
    from penalty_candidates
    returning user_id
  ),
  updated_penalty_users as (
    update public.users u
    set points_total = coalesce(u.points_total, p_starting_points) + p_missed_penalty,
        updated_at = now()
    from inserted_penalties p
    where u.id = p.user_id
    returning u.id::bigint as user_id, p_missed_penalty::integer as delta, u.points_total::integer as total_points
  )
  select user_id, delta, total_points
  from updated_penalty_users;
end;
$$;
