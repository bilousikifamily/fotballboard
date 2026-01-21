# Екран 4 — верстка

Фіксований адмінський екран займає весь доступний viewport, торкаючись таббару знизу. Основна структура:

- `html, body` — `height: 100%`, `body.admin-layout-active` ↦ `display: flex; flex-direction: column; overflow: hidden`.
- `#app` — флекс-item (`flex: 1`) з `overflow: hidden` для усередненого екрану.
- `.screen--admin-layout` — займає висоту `100dvh - tabbar offset` і знаходиться над таббаром.

## Розкладка

1. **Верхній ряд (світло-сірий)** — `div.admin-layout__top`, 4% висоти (чистий фон як у дзвінку Telegram).
2. **Хедер (синій, 16% висоти)** — `div.admin-layout__header`.
   - Вирівняно `flex-column`, центровані дата-світчери з іконками (копія `date-switcher` з `/screens/matches.ts`).
   - Під датою вставлений блок `div.match-time.admin-layout__time`, який показує час (Kyiv), місто (у верхньому рядку), локальний час у дужках, температуру і графічну смугу опадів з іконкою.
3. **Контейнер стадій (один `div.admin-layout__body`)** — чотири колонки `grid-template-columns: 10% 40% 40% 10%`.
   - Бокові (чорно-фонові) колонки — кнопки перемикання (prev/next) з круглими стрілками.
   - Центральна ліва (`.admin-layout__center--left`) та права колонки (`.admin-layout__center--right`) — фон `#ff3b3b` і `#8b0000`, `overflow: visible`, `position: relative`.
   - Логотипи (`renderTeamLogo`) обгорнуті в `.admin-layout__logo-frame`: повна ширина колонки, `display: grid`, `place-items: center`, логотип абсолютний, центрований, займає `40vw`, `max-width/max-height: 40vw`, розташований на `z-index: 2`.
   - Нижче логотипів (на `bottom:12%`, `z-index:3`) плаваючі блоки `admin-layout__score-panel`:
     * Білий напівпрозорий фон, заокруглені кути, тінь.
     * Всередині горизонтальний `score-control` з кнопками `+`/`-` і значенням, оформлений у стилі `predictions.css` (круглі кнопки, середній значок).
     * У кожному блоці також є прихований `<input>` з `name="home_pred"` або `away_pred`.
4. **Нижній ряд (синій + пагінація)** — `div.admin-layout__footer` з круглими точками (`.admin-layout__dot`), текуще положення матчів відображається як набір точок.

## Стили

- Основний фон `.admin-layout` — `#7f7f7f`.
- Таббар на цьому екрані — `#ff0000` з прозорим бордером і власними кольорами кнопок.
- Блоки погоди й часу в хедері використовують `match-time-row`, `match-weather-row` із `predictions.css`.
- Кнопки перемикання матчів мають вихідну `#fff` іконку в колі, відповідно `tabbar` стилю.
