alter table if exists users
  add column if not exists last_seen_at timestamptz;
