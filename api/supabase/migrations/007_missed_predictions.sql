create table if not exists missed_predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);
