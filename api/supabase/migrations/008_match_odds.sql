alter table matches
  add column if not exists api_league_id int,
  add column if not exists api_fixture_id bigint,
  add column if not exists odds_json jsonb,
  add column if not exists odds_fetched_at timestamptz;
