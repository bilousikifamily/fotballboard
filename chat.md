# Telegram Bot Message Templates

These templates are used for text communication in the Telegram bot for this project.

## /start and related commands
- Message: `Кожен депутат Футбольної Ради представляє певні фракції.\n\nБез фракції:\n— нема голосу\n— нема впливу\n— нема комунікації`
- Image: `beginig.png`
- Button label: `ОБРАТИ ФРАКЦІЮ`
- Source: `api/src/services/telegram.ts`

## Match announcements
- Message: `На тебе вже чекають прогнози на сьогоднішні матчі.`
- Image: `new_predictions.png`
- Button label: `ПРОГОЛОСУВАТИ`
- Source: `api/src/handlers.ts`

## Prediction reminder (1 hour before close)
- Message:
```
До закриття прийому прогнозів на матч:
<b>{HOME_TEAM_UK}</b> — <b>{AWAY_TEAM_UK}</b>
залишилась 1 година...
```
- Use Ukrainian team names from `teams.md` (column “Ukrainian alternative”), rendered in uppercase and bold.
- Button label: `ПРОГОЛОСУВАТИ`
- Source: `api/src/handlers.ts`

## Match result points
- Caption with image: `<b>{HOME_TEAM_UK}</b> {HOME_SCORE}:{AWAY_SCORE} <b>{AWAY_TEAM_UK}</b>`
- Fallback text (коли нема зображення): 
  - Positive points: `Тобі нараховано {points} {points_label}`
  - Negative points: `Ти втратив {points} {points_label}`
- Images:
  - `+1golos.png` for +1
  - `-1golos.png` for -1
  - `+5golosiv.png` for +5
- Button label: `ПОДИВИТИСЬ ТАБЛИЦЮ`
- `points_label` uses Ukrainian pluralization for “бал/бали/балів”
- Source: `api/src/handlers.ts`
- Нотифікація надсилається лише тоді, коли поточна сума балів за матч **змінилась**:
  - якщо для користувача перерахунок результату не змінив суму (дельта `0`), нове повідомлення не приходить;
  - якщо дельта `+1`, `-1` або `+5`, бот відправляє відповідну картинку (`+1golos.png`, `-1golos.png`, `+5golosiv.png`) з підписом-результатом матчу.

## New deputy in faction chat
- Message:
```
У НАШІЙ ФРАКЦІЇ {FACTION_NAME} НОВИЙ ДЕПУТАТ:
{USER_LABEL}
```
- Faction names: `РЕАЛ`, `БАРСЕЛОНА`
- User label: `{first_name} {last_name} (@username)` (fallbacks to name/username/id)
- Source: `api/src/handlers.ts`

## Missed match + pending votes
- Message:
```
<b>{HOME_TEAM_UK}</b> - <b>{AWAY_TEAM_UK}</b>
ВЖЕ РОЗПОЧАЛИ ГРУ.
НА ЖАЛЬ БЕЗ ТВОГО ГОЛОСУ.

МАТЧІ ЯКІ ЧЕКАЮТЬ НА ТВІЙ ГОЛОС:
<b>{PENDING_1_HOME_UK} - {PENDING_1_AWAY_UK}</b>
<b>{PENDING_2_HOME_UK} - {PENDING_2_AWAY_UK}</b>
<b>{PENDING_3_HOME_UK} - {PENDING_3_AWAY_UK}</b>
```
- Use Ukrainian team names from `teams.md` (column “Ukrainian alternative”), rendered in uppercase and bold.


- Button labels: 
`ПРОГОЛОСУВАТИ`
`ЗАЙТИ У ФУТБОЛЬНУ РАДУ`
