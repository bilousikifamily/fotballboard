alter table if exists users
  add column if not exists last_seen_at timestamptz;

update users
set last_seen_at = updated_at
where last_seen_at is null;
