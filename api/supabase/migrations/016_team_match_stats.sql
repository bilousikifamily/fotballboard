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
