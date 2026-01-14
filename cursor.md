## Архітектура проєкту

Проєкт складається з **двох основних частин**:

- **`api/`** – бекенд на Cloudflare Workers, який:

  - надає HTTP‑API для вебклієнта (`/api/auth`, `/api/matches`, `/api/predictions`, `/api/leaderboard`, `/api/profile`, `/api/analitika`, `/healthcheck`);
  - приймає Telegram Webhook (`/tg/webhook`);
  - працює з базою даних Supabase (таблиці `users`, `matches`, `predictions`, `missed_predictions` + додаткові таблиці для аналітики/погоди/коефіцієнтів);
  - інтегрується з зовнішніми сервісами: **API‑Football** та **Telegram Bot API**.

- **`web/`** – фронтенд‑WebApp на Vite, який:
  - запускається всередині **Telegram WebApp**;
  - відмальовує екрани матчів, таблиці лідерів, адмін‑інтерфейс, аналітику;
  - спілкується з бекендом через REST‑ендпоїнти `api/`;
  - зберігає частину стану на клієнті (кеши, таймери, локальні преференції).

### 1. Бекенд (`api/`)

- **`src/index.ts`**

  - Вихідна точка Cloudflare Worker: реекспортує основний обробник з `handlers.ts`.

- **`src/handlers.ts`**

  - Центральний роутер та бізнес‑логіка:
    - розбір HTTP‑запитів та маршрутів:
      - `GET /healthcheck`;
      - `POST /api/auth`;
      - `GET /api/leaderboard`;
      - `GET /api/matches`, `GET /api/matches/pending`;
      - `POST /api/matches`, `POST /api/matches/result`, `POST /api/matches/confirm`, `POST /api/matches/announcement`;
      - `POST /api/predictions`, `GET /api/predictions`;
      - `POST /api/onboarding`, `POST /api/avatar`, `POST /api/logo-order`, `POST /api/nickname`;
      - `GET/POST /api/analitika*` та `GET/POST /api/odds*` (оновлення/читання аналітики, коефіцієнтів);
      - `POST /tg/webhook` – обробка оновлень Telegram.
    - зв’язок з Supabase (через HTTP‑запити до Supabase REST / RPC);
    - застосування доменної логіки:
      - нарахування/списання балів за прогноз;
      - підрахунок статистики, таблиці лідерів;
      - обробка аналітичних даних та кешів (погода, odds, API‑Football).

- **`src/types.ts`**

  - Спільні типи для бекенда (TS‑інтерфейси для:
    - `TelegramUpdate`, `TelegramMessage`, `TelegramUser`;
    - `StoredUser`, `DbMatch`, `DbPrediction`, `PredictionView`, `ProfileStats`, `UserOnboarding*`;
    - аналітики (`Analitika*`), odds, погоди (`Weather*`), службових результатів (`*_Result`)).
  - Визначає payload’и для всіх основних бекенд‑ендпоїнтів (`CreateMatchPayload`, `PredictionPayload`, `MatchResultPayload`, `OnboardingPayload` тощо).

- **`src/auth.ts`**

  - Перевірка `initData` Telegram WebApp за HMAC‑алгоритмом:
    - валідація підпису;
    - парсинг користувача Telegram;
    - пошук/створення користувача в Supabase;
    - повернення `StoredUser`, прав адміна, початкових статистик/онбордингу.

- **`src/http.ts`**

  - HTTP‑утиліти:
    - побудова JSON‑відповідей з коректними CORS‑заголовками;
    - уніфіковані обгортки для помилок (`{ ok: false, error }`);
    - хелпери для обробки preflight‑запитів.

- **`src/env.ts`**

  - Опис середовища Cloudflare Worker:
    - типізація змінних середовища (`BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEBAPP_URL` тощо);
    - зручний доступ до них з коду.

- **`src/services/apiFootball.ts`**

  - Інтеграція з **API‑Football**:
    - отримання фікстур, команд, статистики;
    - розрахунок/оновлення коефіцієнтів та аналітичних даних;
    - перетворення зовнішніх структур у внутрішні типи (`FixturesResult`, `TeamsResult`, `Odds*`).

- **`src/services/telegram.ts`**

  - Інтеграція з **Telegram Bot API**:
    - відправка повідомлень користувачам (наприклад, сповіщення про результат матчу, зміну балів);
    - обробка payload’ів Webhook (`TelegramUpdate`);
    - побудова inline‑клавіатур / WebApp‑кнопок.

- **`src/data/clubNamesUk.ts`**

  - Мапа назв клубів для української локалізації (узгодження з фронтенд‑словником).

- **`supabase/schema.sql`**
  - Повний SQL‑снапшот схеми:
    - `users`, `matches`, `predictions`, `missed_predictions` та інші таблиці, пов’язані з аналітикою, odds, погодно‑матчевою інформацією.
  - Служить як джерело правди для даних та орієнтир для доменної моделі.

### 2. Фронтенд (`web/`)

- **`src/main.ts`**

  - Головний файл застосунку:
    - ініціалізація Telegram WebApp (`window.Telegram.WebApp`), читання `initData`;
    - виклик `fetchAuth` для авторизації та отримання поточного користувача, його статистики та онбордингу;
    - визначення глобальних змінних стану: `isAdmin`, `currentUserId`, `matchesById`, кеші погоди, кеш аналітики та ін.;
    - організація екранів:
      - список матчів + форми прогнозів;
      - таблиця лідерів;
      - адмін‑екран користувачів;
      - перегляд аналітики по командам/лігам;
    - керування UI‑станом:
      - завантаження/помилки;
      - таймери (countdown до закриття прогнозів);
      - анімаційне інтро (preloader‑відео).

- **`src/types.ts`**

  - Фронтенд‑типи, синхронізовані з API:
    - `AuthResponse`, `MatchesResponse`, `LeaderboardResponse` тощо;
    - моделі `Match`, `PredictionView`, `LeaderboardUser`, `ProfileStatsPayload`, `OnboardingInfo` та ін.;
    - типи для аналітики (`AnalitikaItem`, `TeamMatchStat`, `OddsRefreshDebug`).

- **`src/api/*`**

  - Тонкі клієнти до бекенд‑ендпоїнтів:
    - **`client.ts`** – базовий `fetch`‑wrapper:
      - підстановка `X-Telegram-InitData`;
      - розбір JSON‑відповідей;
      - єдине місце для обробки HTTP‑помилок.
    - **`auth.ts`** – `fetchAuth(apiBase, initData)` -> `AuthResponse`.
    - **`matches.ts`** – запити матчів, створення/підтвердження матчу, результати, погода.
    - **`predictions.ts`** – створення прогнозів та завантаження списку прогнозів по матчу.
    - **`leaderboard.ts`** – завантаження таблиці лідерів.
    - **`profile.ts`** – онбординг, нікнейм, аватар, порядок логотипів.
    - **`analitika.ts`** – оновлення/отримання даних API‑Football/аналітики.

- **`src/screens/*`**

  - Рендеринг сторінок/великих блоків UI:
    - **`matches.ts`**:
      - функції форматування погоди (`normalizeRainProbability`, `formatRainProbability`, `formatTemperature`, `formatTimeInZone`, `getWeatherIcon`);
      - побудова HTML для списку матчів / карток матчу (`renderMatchesList`, `renderPendingMatchesList`, `renderMatchCard`);
      - показ форми прогнозу, статусних повідомлень, odds‑блоку та аналітики матчу.
    - **`leaderboard.ts`**:
      - рендеринг таблиці лідерів (`renderLeaderboardList`);
      - відображення помилок завантаження (`renderUsersError`).
    - **`adminUsers.ts`**:
      - адмінський перегляд сесій/користувачів, пов’язаних з прогнозами/балами.

- **`src/features/*`**

  - Менші, перевикористовувані модулі з фокусом на бізнес‑логіці:
    - **`analitika.ts`**:
      - рендеринг аналітичних блоків (`renderMatchAnalitika`, `renderTeamMatchStatsList`);
      - кешування результатів API‑Football‑аналітики.
    - **`clubs.ts`**:
      - довідник клубів та допоміжні функції (`formatClubName`, `getClubLogoPath`, `getMatchTeamInfo`, `getAvatarLogoPath`, `findEuropeanClubLeague`);
      - узгодження назв/логотипів з бекендом (`league_id`, `club_id`).
    - **`odds.ts`**:
      - парсинг odds із бекенда, вивід коефіцієнтів, розрахунок ймовірностей (`extractCorrectScoreProbability`, `formatProbability`, `renderMatchOdds`).
    - **`predictionTime.ts`**:
      - обчислення дедлайнів для прогнозів (`getMatchPredictionCloseAtMs`);
      - утиліти для показу `countdown` (`formatCountdown`).

- **`src/formatters/*`**

  - Маленькі хелпери форматування:
    - **`dates.ts`** – форматування дат/часу у Києві (`formatKyivDateLabel`, `formatKyivDateTime`, `getKyivDateString`, `addKyivDays`).
    - **`names.ts`** – форматування імен/нікнеймів (`formatTelegramName`, `formatPredictionName`).

- **`src/utils/*`**

  - Технічні утиліти:
    - **`escape.ts`** – безпечний вивід у HTML (`escapeHtml`, `escapeAttribute`).
    - **`time.ts`** – конвертація часу у Київський (`toKyivISOString`) та допоміжні часо‑утиліти.

- **`src/data/clubs.ts`**

  - Статичний список клубів/ліг з id, слаґами, назвами та логотипами.

- **`src/style.css`**

  - Глобальні стилі:
    - макет застосунку, типографіка, кольорова схема;
    - стилі для інтро‑екрану;
    - компоненти матчів, таблиці лідерів, форм прогнозів, аналітичних блоків, адмін‑панелі.

- **`telegram.d.ts`**
  - Типи для `window.Telegram.WebApp` та суміжних об’єктів (допомагають коректно типізувати інтеграцію з Telegram WebApp API).

### 3. Спільні частини

- **`shared/teamSlugAliases.ts`**
  - Спільний між `api/` та `web/` словник‑аліаси для слаґів команд:
    - допомагає узгодити назви/слаґи між API‑Football, внутрішньою БД та фронтендом;
    - використовується при мапінгу odds/аналітики до конкретних матчів.

### 4. Потоки даних (high‑level)

- **Аутентифікація**:

  - Telegram WebApp передає `initData` у фронтенд;
  - `web/src/main.ts` викликає `fetchAuth` → `api/src/handlers.ts` → `api/src/auth.ts`;
  - бекенд валідує `initData`, читає/створює юзера в Supabase та повертає `AuthResponse` (профіль, статистика, онбординг, прапор `admin`).

- **Матчі та прогнози**:

  - фронтенд запитує `GET /api/matches` (`fetchMatches`), кешує в `matchesById`, відмальовує через `renderMatchesList`;
  - користувач надсилає прогноз через форму → `POST /api/predictions` (`postPrediction`);
  - бекенд:
    - зберігає запис у `predictions`;
    - при встановленні результату матчу (`POST /api/matches/result`) обчислює бали, оновлює `users.points_total` та створює `missed_predictions` для тих, хто не голосував.

- **Лідерборд та профіль**:

  - фронтенд викликає `GET /api/leaderboard`, рендерить таблицю (`renderLeaderboardList`);
  - профіль/онбординг змінюється через `POST /api/onboarding`, `POST /api/avatar`, `POST /api/logo-order`, `POST /api/nickname`, а відповіді оновлюють локальний стан.

- **Аналітика, погода та коефіцієнти**:
  - бекенд через `apiFootball.ts` та окремі сервіси тягне дані з API‑Football;
  - результати зберігаються в Supabase як аналітичні ряди (`DbAnalitika`, `DbTeamMatchStat`, odds, погода);
  - фронтенд через `analitika.ts`, `odds.ts`, рендери в `screens/matches.ts` показує статистику, коефіцієнти та прогноз погоди для кожного матчу.
