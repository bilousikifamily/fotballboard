# About This Repo (for devs and AI agents)

This project has two main parts:

- api/ - Cloudflare Worker (backend)
- web/ - Vite WebApp (frontend)

Use this file as a map for where to make changes.

## Frontend (web/)

Entry points and core files:

- `web/src/main.ts` - app bootstrap, state wiring, event handlers, routing between screens.
- `web/src/style.css` - global styles.
- `web/src/types.ts` - shared frontend types.

Feature and screen structure:

- `web/src/screens/` - page level rendering.
  - `web/src/screens/matches.ts` - matches list screen.
  - `web/src/screens/leaderboard.ts` - leaderboard screen.
- `web/src/features/` - reusable feature renderers and logic.
  - `web/src/features/analitika.ts` - analytics UI blocks.
  - `web/src/features/odds.ts` - odds parsing and rendering.
  - `web/src/features/clubs.ts` - club name formatting helpers.
  - `web/src/features/predictionTime.ts` - prediction cutoff helpers.
- `web/src/api/` - API clients for the Worker.
  - `web/src/api/client.ts` - fetch wrapper.
  - `web/src/api/auth.ts`, `web/src/api/matches.ts`, `web/src/api/predictions.ts`, `web/src/api/leaderboard.ts`, `web/src/api/profile.ts`, `web/src/api/analitika.ts`.
- `web/src/formatters/` - small string/date format helpers.
- `web/src/utils/` - tiny utilities (escaping, time helpers).
- `web/src/data/` - static data (clubs list).

Where to change what:

- UI layout or rendering -> `web/src/screens/*` or `web/src/features/*`.
- API calls -> `web/src/api/*`.
- Types -> `web/src/types.ts` (frontend only).
- Formatting -> `web/src/formatters/*`.

## Backend (api/)

Entry points and shared helpers:

- `api/src/index.ts` - Worker entry (exports the handler).
- `api/src/handlers.ts` - all routes and business logic live here.
- `api/src/types.ts` - shared API types and payload shapes.
- `api/src/http.ts` - CORS and JSON helpers.
- `api/src/auth.ts` - Telegram initData validation.
- `api/src/env.ts` - Worker env shape.

External integrations:

- `api/src/services/apiFootball.ts` - API-Football utilities.
- `api/src/services/telegram.ts` - Telegram webhook helpers.

Database:

- `api/supabase/migrations/` - schema migrations.
- `api/supabase/schema.sql` - full schema snapshot.

Where to change what:

- New or updated endpoints -> `api/src/handlers.ts`.
- Auth or CORS changes -> `api/src/auth.ts` or `api/src/http.ts`.
- API-Football changes -> `api/src/services/apiFootball.ts`.
- Telegram bot behavior -> `api/src/services/telegram.ts`.
- Types for request/response payloads -> `api/src/types.ts`.

## Typical change flow

- Add or change endpoint:
  - Update `api/src/handlers.ts` and types in `api/src/types.ts`.
  - Add or update client in `web/src/api/*`.
  - Update UI in `web/src/screens/*` or `web/src/features/*`.

- UI-only change:
  - Update `web/src/screens/*` or `web/src/features/*`.
  - If needed, adjust `web/src/style.css`.

## Notes for agents

- Prefer small, focused edits and keep logic unchanged unless requested.
- Keep types and helpers in their dedicated files instead of expanding `web/src/main.ts` or `api/src/handlers.ts`.
- If you need to add new shared helpers, place them in `web/src/utils/` or `web/src/formatters/` (frontend) and `api/src/http.ts` or `api/src/services/*` (backend).
