alter table users add column if not exists classico_choice text;
alter table users add column if not exists ua_club_id text;
alter table users add column if not exists eu_club_id text;
alter table users add column if not exists nickname text;
alter table users add column if not exists onboarding_completed_at timestamptz;
