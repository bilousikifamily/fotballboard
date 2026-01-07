# fotballboarding

## Structure

```
tg-webapp-starter/
  api/    # Cloudflare Worker
  web/    # Vite WebApp
```

## Requirements

- Node.js 18+
- Cloudflare account + Wrangler

## Env / secrets

- `BOT_TOKEN` (Worker secret)
- `SUPABASE_URL` (Worker secret)
- `SUPABASE_SERVICE_ROLE_KEY` (Worker secret)
- `WEBAPP_URL` (Worker var: Cloudflare Pages URL)
- `VITE_API_BASE` (Web env: Worker URL)

## Secrets setup (Cloudflare Workers)

```
cd api
npx wrangler login
npx wrangler secret put BOT_TOKEN
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

## Supabase schema

Run this SQL in Supabase (SQL editor):

```sql
create table if not exists users (
  id bigint primary key,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  admin boolean not null default false,
  points_total int not null default 100,
  classico_choice text,
  ua_club_id text,
  eu_club_id text,
  nickname text,
  avatar_choice text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  id bigserial primary key,
  home_team text not null,
  away_team text not null,
  league_id text,
  home_club_id text,
  away_club_id text,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled',
  home_score int,
  away_score int,
  created_by bigint references users(id),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  home_pred int not null,
  away_pred int not null,
  points int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create table if not exists missed_predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);
```

If you already have a `users` table, run:

```sql
alter table users add column if not exists admin boolean default false;
alter table users add column if not exists points_total int default 100;
alter table users add column if not exists created_at timestamptz default now();
alter table users add column if not exists classico_choice text;
alter table users add column if not exists ua_club_id text;
alter table users add column if not exists eu_club_id text;
alter table users add column if not exists nickname text;
alter table users add column if not exists avatar_choice text;
alter table users add column if not exists onboarding_completed_at timestamptz;
alter table matches add column if not exists league_id text;
alter table matches add column if not exists home_club_id text;
alter table matches add column if not exists away_club_id text;
alter table matches add column if not exists reminder_sent_at timestamptz;
create table if not exists missed_predictions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  match_id bigint not null references matches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);
```

For incremental updates, you can also run:

```
api/supabase/migrations
```

## 1) Create a bot (BotFather)

1. Open BotFather in Telegram.
2. Run `/newbot` and follow steps.
3. Copy the bot token.

## 2) Deploy the Worker (api)

```
cd api
npm install

# set WebApp URL (Cloudflare Pages URL)
# update wrangler.toml or pass as --var
npx wrangler deploy --var WEBAPP_URL=https://your-pages-domain.pages.dev
```

## 3) Deploy the WebApp (web)

```
cd web
npm install

# build
npm run build
```

Deploy `web/dist` to Cloudflare Pages.
You can use the Pages dashboard or CLI:

```
# optional
npx wrangler pages deploy dist --project-name tg-webapp-web
```

Set `VITE_API_BASE` to your Worker URL in the Pages environment variables.

## 4) Set Telegram webhook

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>/tg/webhook
```

## 5) Local development (optional)

```
# terminal 1
cd api
npm run dev -- --var WEBAPP_URL=http://localhost:5173

# terminal 2
cd web
VITE_API_BASE=http://localhost:8787 npm run dev
```

For real Telegram WebApp testing, you need a public URL (Cloudflare Tunnel or ngrok) for both the Worker and WebApp.

## Endpoints

- `GET /healthcheck` -> `{ ok: true }`
- `POST /api/auth` -> validates Telegram `initData`
- `GET /api/leaderboard` -> list users by points (requires `X-Telegram-InitData`)
- `GET /api/matches?date=YYYY-MM-DD` -> list matches (Kyiv time, requires `X-Telegram-InitData`)
- `POST /api/matches` -> admin creates match
- `POST /api/predictions` -> user submits prediction
- `POST /api/onboarding` -> save onboarding profile data
- `POST /api/avatar` -> update avatar logo choice
- `POST /api/matches/result` -> admin sets final score + awards points
- `POST /tg/webhook` -> Telegram updates

## Notes

- The WebApp never sees the bot token.
- `/api/auth` validates `initData` using Telegram HMAC algorithm.
