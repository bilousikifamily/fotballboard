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

alter table if exists users add column if not exists subscription_expires_at timestamptz;
alter table if exists users add column if not exists subscription_paid_months int;
alter table if exists users add column if not exists subscription_free_month_used boolean default false;

create unique index if not exists club_api_map_slug_unique on club_api_map (slug);
create unique index if not exists club_api_map_api_team_id_unique on club_api_map (api_team_id);
create index if not exists club_api_map_normalized_name_idx on club_api_map (normalized_name);

alter table if exists matches add column if not exists start_digest_sent_at timestamptz;
alter table if exists matches add column if not exists odds_manual_home double precision;
alter table if exists matches add column if not exists odds_manual_draw double precision;
alter table if exists matches add column if not exists odds_manual_away double precision;
alter table if exists matches add column if not exists odds_manual_updated_at timestamptz;
