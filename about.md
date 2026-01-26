# About This Repo (for devs and AI agents)

This project has two main parts:

- api/ - Cloudflare Worker (backend)
- web/ - Vite WebApp (frontend)

Use this file as a map for where to make changes.

## Frontend (web/)

Entry points and core files:

- `web/src/main.ts` - app bootstrap, state wiring, event handlers, routing between screens.
- `web/src/style.css` and `web/src/styles/` - global and component-level styles used by both the SPA and presentation views.
- `web/src/types.ts` - shared TypeScript definitions consumed across screens and features.
- `web/src/presentation.ts` and `web/src/presentation/` - presentation-only flows with bespoke navigation or static layouts.

### Folder intents

- `web/src/screens/` – full-page compositions that blend routing, layout, and features (matches list, leaderboard, admin users, etc.).
- `web/src/features/` – reusable UI helpers and blocks: analytics cards, odds formatting, prediction timers, faction ranking helpers, slug resolvers, etc.
- `web/src/api/` – typed clients for every backend route handled by the Cloudflare Worker.
- `web/src/utils/` + `web/src/formatters/` – side-by-side utility folders for low-level helpers such as escaping, time math, date formatting, and shared string routines.
- `web/src/data/` – static fixtures like club metadata and faction chat links imported by features/screens.
- `web/src/presentation/` – isolated presentation flow (scripts, static templates, custom styles) that sometimes borrows from `features` or `utils` without routing through `main.ts`.

### Feature and screen breakdown

- `web/src/screens/matches.ts` – matches list screen wiring features and API data.
- `web/src/screens/leaderboard.ts` – leaderboard view.
- `web/src/screens/adminUsers.ts` – admin user management view used in the admin panel.
- `web/src/features/analitika.ts` – analytics UI blocks.
- `web/src/features/odds.ts` – odds parsing and rendering helpers.
- `web/src/features/clubs.ts` – club name formatting helpers shared between frontend and backend data.
- `web/src/features/predictionTime.ts` – prediction cutoff helpers (countdowns, time validation).
- `web/src/features/factionRanking.ts` – faction ranking helpers for screens and presentations.
- `web/src/features/teamSlugs.ts` – slug helpers used across screens.
- `web/src/api/client.ts` – fetch wrapper used internally by all `web/src/api/*` modules.
- API modules for authentication, matches, predictions, leaderboard, profile, analitika.
- `web/src/formatters/` – string/date helper collection.
- `web/src/utils/` – escaping/time helpers.
- `web/src/data/` – static data for clubs and faction chat links.

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
- `api/src/utils/` - miscellaneous helpers (e.g., `clubs.ts` for shared club data/formatting).

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
