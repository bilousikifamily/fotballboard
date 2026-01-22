# Поточний стан (станом на код у repo)

## A) Схема БД (мінімум)

### Таблиці (за README + кодом)
- `users` (опис у `README.md`): `id` (PK, Telegram user id), `username`, `first_name`, `last_name`, `photo_url`, `admin`, `points_total`, `faction_club_id`, `nickname`, `avatar_choice`, `onboarding_completed_at`, `created_at`, `updated_at`.
- `matches` (опис у `README.md`): `id` (PK), `home_team`, `away_team`, `league_id`, `home_club_id`, `away_club_id`, `kickoff_at`, `status`, `home_score`, `away_score`, `created_by`, `reminder_sent_at`, `start_digest_sent_at`, `created_at`.
- `predictions` (опис у `README.md`): `id` (PK), `user_id`, `match_id`, `home_pred`, `away_pred`, `points`, `created_at`, `updated_at`, `unique (user_id, match_id)`.
- `missed_predictions` (опис у `README.md`): `id` (PK), `user_id`, `match_id`, `created_at`, `unique (user_id, match_id)`.
- `team_match_stats` (з коду `api/src/handlers.ts`): використані поля `id`, `team_name`, `opponent_name`, `match_date`, `is_home`, `team_goals`, `opponent_goals`, `avg_rating`.
- `club_api_map` (див. `api/supabase/schema.sql`): `id` (PK), `slug`, `league_id`, `name`, `normalized_name`, `api_team_id`, `api_team_name`, `api_team_code`, `api_team_country`, `api_team_logo`, `api_team_founded`, `api_team_national`, `season`, `created_at`, `updated_at`, унікальні індекси на `slug` і `api_team_id`.
- `analitika`, `analitika_static`, `debug_updates` (використовуються в `api/src/handlers.ts`; повна DDL у repo не знайдена).
- `users_duplicate` — у коді/SQL не знайдена; в repo немає звернень до цієї таблиці.

### Ключі/зв’язки (FK)
- `matches.created_by -> users.id` (в `README.md`, без правила `ON DELETE`).
- `predictions.user_id -> users.id` (`ON DELETE CASCADE`, `README.md`).
- `predictions.match_id -> matches.id` (`ON DELETE CASCADE`, `README.md`).
- `missed_predictions.user_id -> users.id` (`ON DELETE CASCADE`, `README.md`).
- `missed_predictions.match_id -> matches.id` (`ON DELETE CASCADE`, `README.md`).
- Для `team_match_stats`, `analitika`, `analitika_static`, `debug_updates`, `club_api_map` FK у repo не описані.

### RLS і політики
- У repo немає SQL з `RLS`/`POLICY` для цих таблиць (`api/supabase/schema.sql` містить лише `club_api_map` + alter для `matches`).
- Висновок: поточний стан RLS/політик потрібно перевірити безпосередньо в Supabase.

## B) Потоки в коді

### Де створюється/оновлюється `user`
- `api/src/handlers.ts`: `storeUser()` робить `upsert` при `/api/auth` (логін через Telegram initData) і в ряді endpointів (`/api/onboarding`, `/api/nickname`, `/api/predictions`, `/api/leaderboard` тощо).
- `api/src/handlers.ts`: `saveUserOnboarding`, `saveUserAvatarChoice`, `saveUserNickname` — `update` профільних полів.
- `api/src/handlers.ts`: оновлення `points_total` у скорінгу результатів і штрафів (`/api/matches/result`, `applyMissingPredictionPenalties`).
- Клієнтські виклики: `web/src/api/auth.ts`, `web/src/api/profile.ts`, `web/src/api/predictions.ts`.

### Де є “видалення”
- У коді немає endpointів/кнопок для видалення користувача або записів (`DELETE` не використовується).
- Є лише каскадне видалення на рівні БД для `predictions` і `missed_predictions`, якщо хтось видалить `users` або `matches` вручну.

### Де будуються лідерборди/списки юзерів (і фільтри)
- `/api/leaderboard` і `/api/users` -> `listLeaderboard` (`api/src/handlers.ts`):
  - сортування `points_total desc`, `updated_at desc`, опційний `limit`.
- `/api/faction-members` -> `listFactionMembers` (`api/src/handlers.ts`):
  - фільтр `faction_club_id = <current user>`, сортування як вище, `limit` (default 6).
- UI:
  - `web/src/screens/leaderboard.ts`, виклик у `web/src/main.ts`.
  - Адмінський список користувачів: `web/src/screens/adminUsers.ts` + `web/src/main.ts`.
  - Фракційний рейтинг: `web/src/features/factionRanking.ts` (агрегація/групування на фронті).

### Де відображаються матчі/прогнози (і як підтягується user)
- Матчі:
  - API: `/api/matches`, `/api/matches/pending` (`api/src/handlers.ts`, `listMatches`, `listPendingMatches`).
  - UI: `web/src/screens/matches.ts` (рендер), `web/src/main.ts` (завантаження через `web/src/api/matches.ts`).
- Прогнози:
  - API: `/api/predictions` (GET/POST) + `listPredictions` з джоіном `users` (`api/src/handlers.ts`).
  - UI: `web/src/main.ts` (`renderPredictionsPanel`, `loadPredictions`), `web/src/api/predictions.ts`.
- Presentation режим:
  - API: `/api/presentation/matches` (`api/src/handlers.ts`) повертає `matches` + `predictions` + `team_match_stats`.
  - UI: `web/src/presentation.ts`, `web/src/presentation/remote.ts`, `web/src/presentation/storage.ts`.

## C) Унікальність і поля PII

### Унікальність
- `users`: лише `id` (PK). `username`/`nickname` не є унікальними в SQL.
- `predictions`: `unique (user_id, match_id)`.
- `missed_predictions`: `unique (user_id, match_id)`.
- `club_api_map`: унікальні індекси на `slug`, `api_team_id`.

### PII (персональні дані)
- `users`: `id` (Telegram user id), `username`, `first_name`, `last_name`, `photo_url`, `nickname`.
- Додатково: `avatar_choice` може бути персоналізованим вибором, але не ідентифікує напряму.
- `initData` (Telegram) використовується лише для авторизації, у БД не зберігається.

### Анонімізація при видаленні
- У repo немає вимог або логіки для анонімізації/soft-delete.
- Немає поля `deleted` або подібного у схемі з `README.md`.

## D) Список точок ризику

- Видалення `users` призведе до каскадного видалення `predictions`/`missed_predictions` (втрата історії) і зникнення записів з лідерборду.
- `matches.created_by` посилається на `users` без `ON DELETE` (видалення юзера може блокуватися FK або створювати орфан, залежно від реальної схеми).
- Джоіни `predictions -> users` у відповідях API: код часто допускає `user: null`, але UI очікує наявні `nickname/username` для відображення (можливі порожні поля/поганий UX, якщо юзер відсутній).
- Є фонові процеси/cron (`api/wrangler.toml`) та інтеграції:
  - Telegram webhook/чати (`api/src/services/telegram.ts`, `/api/auth`).
  - API-Football (`api/src/services/apiFootball.ts`).
  - Нотифікації/нагадування/refresh (cron у Worker) працюють з `users`/`matches`/`predictions` і можуть збоїти, якщо юзерів не знайти.
- `users_duplicate` заявлена в задачі, але в repo відсутня: ризик розходження між реальною БД та кодом.
