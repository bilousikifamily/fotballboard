# Бекенд Telegram-бота

## Де знаходиться бот
- Код бота живе у `fotballboard/api/` (Cloudflare Worker).
- Вхідні точки:
  - `fotballboard/api/src/index.ts` — експортує Worker.
  - `fotballboard/api/src/handlers.ts` — усі HTTP-роути, webhook та планові задачі.
  - `fotballboard/api/src/services/telegram.ts` — парсинг команд і відправка повідомлень.

## Стек і середовище
- Мова: TypeScript (ESM).
- Платформа: Cloudflare Workers (через `wrangler`).
- База даних: Supabase (через `@supabase/supabase-js`).
- Інтеграції: Telegram Bot API, API-Football, провайдери погоди (open-meteo + weatherapi).

## Як працює Telegram-частина
- Webhook: `POST /tg/webhook` у `fotballboard/api/src/handlers.ts`.
- Обробка апдейту: `handleUpdate()` у `fotballboard/api/src/services/telegram.ts`.
- Модерація чатів фракцій:
  - `handleFactionChatModeration()` у `fotballboard/api/src/handlers.ts`.
  - Видаляє повідомлення з чужих фракційних гілок та надсилає попередження.
- Підтримувані команди: `/start`, `/app`, `/webapp`.
  - Відповідь: повідомлення з кнопкою WebApp, URL береться з `env.WEBAPP_URL`.
- Відправка повідомлень: `sendMessage()` викликає `https://api.telegram.org/bot<BOT_TOKEN>/sendMessage`.

### Нотифікації про результат матчу
- Нарахування/списання балів відбувається у `applyMatchResult()` в `fotballboard/api/src/handlers.ts`.
- Для кожного користувача рахується **дельта балів** `delta = newPoints - currentPoints`:
  - якщо `delta === 0` → користувачу **не надсилається** нова нотифікація;
  - якщо `delta !== 0` → створюється `MatchResultNotification` і через `notifyUsersAboutMatchResult()` відправляється повідомлення/картинка.
- Важливо: якщо результат матчу перерахували вдруге, але сума балів не змінилась (залишилась, наприклад, `+5` як і раніше), нове повідомлення в боті **не приходить**, бо `delta` дорівнює 0.

## Основні функції бекенду для бота/вебапки
- Авторизація користувача через Telegram initData:
  - `POST /api/auth` (валідація підпису у `fotballboard/api/src/auth.ts`).
- Онбординг/профіль/прогнози/матчі/таблиці:
  - Усі маршрути описані у `fotballboard/api/src/handlers.ts`.
- Адмін-розсилка:
  - `POST /api/matches/announcement` — відправляє повідомлення всім користувачам через Telegram.

## Планові задачі (cron)
У `fotballboard/api/src/handlers.ts` через `scheduled`:
- Нагадування про прогнози перед матчами.
- Оновлення/рефреш погоди для матчів.

## Зовнішні інтеграції
- API-Football:
  - `fotballboard/api/src/services/apiFootball.ts` (формування запитів, таймзона, базовий URL).
- Погода:
  - Логіка вибору провайдера та кешування реалізована в `fotballboard/api/src/handlers.ts`.

## Змінні середовища (ключові)
Оголошені у `fotballboard/api/src/env.ts`:
- `BOT_TOKEN`, `WEBAPP_URL`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `API_FOOTBALL_*`.
- `WEATHER_*`, `WEATHERAPI_*`.
- Чати для модерації:
  - `FACTION_CHAT_REAL`, `FACTION_CHAT_BARCA` (посилання на гілки/чати фракцій).
  - `FACTION_CHAT_GENERAL` (посилання на загальний чат).

## Де правити логіку бота
- Telegram-команди/відповіді: `fotballboard/api/src/services/telegram.ts`.
- Webhook/роути: `fotballboard/api/src/handlers.ts`.
- Перевірка Telegram initData: `fotballboard/api/src/auth.ts`.
