alter table matches add column if not exists rain_probability int;
alter table matches add column if not exists weather_fetched_at timestamptz;
