# Requests: зовнiшнi API та витрати запитiв

Цей файл описує **усi зовнiшнi API**, як вони використовуються у проєктi, i приблизну кiлькiсть запитiв.

## 1) API-Football (API-Sports)
- Base URL: `https://v3.football.api-sports.io`
- Auth: заголовок `x-apisports-key`
- Використання: `api/src/index.ts`

### Ендпоiнти i сценарii
- `GET /teams?search=...`
  - Пошук ID команди за назвою.
  - Використовується для odds i аналітики.
- `GET /fixtures/headtohead?h2h=HOMEID-AWAYID&from=...&to=...&last=...&timezone=...`
  - Для H2H в аналітиці.
  - Також використовується для пошуку фікстури при підтягуванні odds.
- `GET /fixtures?date=YYYY-MM-DD&league=...&season=...&timezone=...`
  - Фолбек при пошуку фікстури (odds).
- `GET /fixtures?from=...&to=...&league=...&season=...&timezone=...`
  - Додатковий фолбек при пошуку фікстури (odds).
- `GET /odds?fixture=...`
  - Коефіцієнти для конкретного фікстуру.
- `GET /teams/statistics?team=...&league=...&season=...`
  - Командна статистика сезону (GF/GA тощо).
- `GET /standings?league=...&season=...`
  - Таблиця, форма, домашні/виїзні показники.
- `GET /players/topscorers?league=...&season=...`
  - Топ-бомбардири.
- `GET /players/topassists?league=...&season=...`
  - Топ-асистенти.

### Вартість запитiв (приблизно)
**Аналітика (Manchester City + Chelsea, EPL, 1 сезон):**
- `/teams?search` × 2 (ID команд)
- `/standings` × 1
- `/teams/statistics` × 2
- `/players/topscorers` × 1
- `/players/topassists` × 1
- `/fixtures/headtohead` × 1 (H2H, last=10)
**Разом:** 8 запитів (може бути 6, якщо team ID в кеші).

**Odds для 1 матчу:**
- `/teams?search` × 2
- `/fixtures/headtohead` × 1
- `/fixtures?date=...` × 1
- `/fixtures?from=...&to=...` × 0 або 1 (якщо date порожнiй)
- `/odds?fixture=...` × 1
**Разом:** 5-6 запитів на матч.

> Примітка: доступність ендпоiнтiв залежить від плану API-Football. Якщо ендпоiнт недоступний, буде `status != 200`.

## 2) Open-Meteo (погода)
- Geocoding: `https://geocoding-api.open-meteo.com/v1/search`
- Forecast: `https://api.open-meteo.com/v1/forecast`
- Використання: `api/src/index.ts` (погода матчу)

### Сценарій
- Геокодинг міста → прогноз погоди на годину матчу.
- Кеш у БД + локальний in-memory кеш.

### Вартість запитів
- 1–2 запити на матч (геокодинг + прогноз).
- Якщо є кеш, запитів немає.

## 3) WeatherAPI (fallback)
- Base URL: `https://api.weatherapi.com`
- Використовується лише якщо `WEATHERAPI_KEY` задано.
- Підключається коли Open-Meteo не дає потрібних полів.

## 4) Telegram Bot API
- `POST https://api.telegram.org/bot<TOKEN>/sendMessage`
- Використання: оголошення та нагадування.
- Вартість: 1 запит на кожне повідомлення користувачу.

## 5) Supabase
- Використовується через `@supabase/supabase-js`
- Читання/запис в усiх ендпоiнтах Worker.
- Це внутрiшнє сховище, але технічно це зовнiшнi запити до Supabase API.

## Які ендпоiнти Worker викликають зовнiшнi API
- `POST /api/matches` -> API-Football (odds, якщо є ключ)
- `POST /api/matches/odds` -> API-Football
- `GET /api/matches/weather` -> Open-Meteo (+ WeatherAPI fallback)
- `POST /api/matches/announcement` -> Telegram sendMessage

## Аналітика через Supabase
- `GET /api/analitika` -> Supabase `team_match_stats` (без зовнішнього API)
