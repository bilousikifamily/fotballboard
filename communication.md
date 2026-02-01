# Комунікація бота

Цей файл описує всі повідомлення, які бот надсилає у приватні чати та гілки фракцій, а також де це реалізовано в коді.

## Приватний чат (DM)

### /start, /app, /webapp

- Тип: фото + підпис + кнопка WebApp.
- Текст:
  "Кожен депутат Футбольної Ради\nмає долучитись до ФРАКЦІЇ.\n\nБез фракції:\n— нема голосу\n— нема комунікації\n— нема впливу"
- Зображення: `beginig_fraction1.png`
- Кнопка: `ОБРАТИ ФРАКЦІЮ` (URL = `env.WEBAPP_URL`)
- Джерело: `api/src/services/telegram.ts` (`handleUpdate`).

### Анонс матчів (адмінська розсилка)

- Тип: фото + список матчів + кнопка WebApp.
- Текст: перелік матчів, по одному в рядок: `HOME - AWAY`.
- Зображення: `new_prediction.png`
- Кнопка: `ПРОГОЛОСУВАТИ` (URL = `env.WEBAPP_URL`)
- Умова: надсилається тільки користувачам, у яких є матчі без прогнозу на сьогодні.
- Джерело: `api/src/handlers.ts` (`/api/matches/announcement`, `buildMatchesAnnouncementCaption`).

### Нагадування про прогноз (за 1 годину)

- Тип: текст + кнопка WebApp.
- Текст:
  "{HOME} — {AWAY}\nрозпочнеться через 1 годину.\nтвоя фракція розраховує на твій голос."
- Кнопка: `ПРОГОЛОСУВАТИ` (URL = `env.WEBAPP_URL`)
- Джерело: `api/src/handlers.ts` (`handlePredictionReminders`, `formatPredictionReminderMessage`).

### Результат матчу + статистика

- Тип: фото з підписом або текст без фото (залежить від дельти очок).
- Перший рядок:
  `{HOME} {HOME_SCORE}:{AWAY_SCORE} {AWAY}`
- Блок статистики:
  - `{PERCENT}% депутатів проголосували за {TARGET}`
  - `Вгадав рахунок:` або `Вгадали рахунок:`
  - Далі по одному рядку на кожного: `{USER_LABEL} ({ФРАКЦІЯ})`
- `TARGET`:
  - Нічия -> `НІЧИЮ`
  - Перемога господарів -> назва господарів
  - Перемога гостей -> назва гостей
- Зображення для дельти очок:
  - `+1golosok.png`, `-1golosok.png`, `+5goloskov.png`
- Кнопка під фото: `ПОДИВИТИСЬ ТАБЛИЦЮ` (URL = `env.WEBAPP_URL?tab=leaderboard`)
- Якщо зображення немає, надсилається лише текст без кнопки.
- Джерело: `api/src/handlers.ts` (`notifyUsersAboutMatchResult`, `buildMatchResultCaption`).

## Гілки фракцій (форумні треди у групі)

### Новий депутат у фракції

- Тип: текст.
- Текст:
  "У ФРАКЦІЮ ПРИЄДНАВСЯ НОВИЙ ДЕПУТАТ:\n{MENTION}"
- `MENTION`: `@username` або nickname, або `first last (@username)`.
- Джерело: `api/src/handlers.ts` (`notifyFactionChatNewDeputy`).

### Дайджест прогнозів на старті матчу

- Тип: текст.
- Формат:
  - Перший рядок: `{HOME} {AVG_HOME} : {AVG_AWAY} {AWAY}`
  - Далі список: `{USER_LABEL} — {HOME_PRED}:{AWAY_PRED}`
- Якщо у фракції немає прогнозів, повідомлення не надсилається.
- Обмеження: між матчами є пауза 1 хвилина, щоб знизити навантаження.
- Джерело: `api/src/handlers.ts` (`handleMatchStartDigests`, `buildMatchStartDigestMessage`).

### Ручна відправка прогнозів у гілку фракції (адмінка)

- Тип: текст.
- Формат:
  - Перший рядок: `{HOME} {AVG_HOME} : {AVG_AWAY} {AWAY}`
  - Далі список: `{USER_LABEL} — {HOME_PRED}:{AWAY_PRED}`
- Якщо у фракції немає прогнозів, повідомлення не надсилається (`error: no_predictions`).
- Джерело: `api/src/handlers.ts` (`/api/match-faction-predictions`, `buildFactionPredictionsMessage`).
