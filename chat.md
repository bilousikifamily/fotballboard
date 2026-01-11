# Telegram Bot Message Templates

These templates are used for text communication in the Telegram bot for this project.

## /start and related commands
- Message: `Готово ✅ Натисни кнопку, щоб відкрити WebApp`
- Button label: `Open WebApp`
- Source: `api/src/services/telegram.ts`

## Match announcements
- Message: `На тебе вже чекають прогнози на сьогоднішні матчі.`
- Source: `api/src/handlers.ts`

## Prediction reminder (1 hour before close)
- Message:
```
До закриття прийому прогнозів на матч:
<b>{HOME_TEAM_UK}</b> — <b>{AWAY_TEAM_UK}</b>
залишилась 1 година...
```
- Use Ukrainian team names from `teams.md` (column “Ukrainian alternative”), rendered in uppercase and bold.
- Source: `api/src/handlers.ts`

## Match result points
- Positive points: `Тобі нараховано {points} {points_label}`
- Negative points: `Ти втратив {points} {points_label}`
- `points_label` uses Ukrainian pluralization for “бал/бали/балів”
- Source: `api/src/handlers.ts`


- Button labels: 
`ПРОГОЛОСУВАТИ`
`ЗАЙТИ У ФУТБОЛЬНУ РАДУ`
