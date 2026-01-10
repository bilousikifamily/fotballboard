create table if not exists analitika_static (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz
);

create index if not exists analitika_static_expires_at_idx on analitika_static (expires_at);
