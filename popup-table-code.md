# Код попапа та таблиці/графіка

## 1. JavaScript код (з main.ts)

### Змінні для попапа
```typescript
let teamGraphPopup: HTMLDivElement | null = null;
let teamGraphBodyEl: HTMLElement | null = null;
let teamGraphTitleEl: HTMLElement | null = null;
```

### Функція відкриття попапа
```typescript
async function openTeamGraphPopup(teamSlug: string | null, teamName: string): Promise<void> {
  ensureTeamGraphPopup();
  if (!teamGraphPopup || !teamGraphBodyEl || !teamGraphTitleEl) {
    return;
  }
  const slug = teamSlug ?? normalizeTeamSlugValue(teamName) ?? teamName.toLowerCase();
  
  try {
    const stats = await loadTeamGraphStats(slug);
    // Перевіряємо, чи є хоча б 5 матчів перед відкриттям попапу
    if (!stats || stats.length < 5) {
      return;
    }
    
    teamGraphTitleEl.textContent = `ІСТОРІЯ ${teamName.toUpperCase()}`;
    teamGraphBodyEl.innerHTML = renderTeamMatchStatsList(stats, slug);
    teamGraphPopup.classList.remove("is-hidden");
    document.body.classList.add("admin-layout-popup-open");
    teamGraphPopup.focus();
  } catch {
    // У разі помилки не відкриваємо попап
    return;
  }
}
```

### Функція закриття попапа
```typescript
function closeTeamGraphPopup(): void {
  if (!teamGraphPopup) {
    return;
  }
  teamGraphPopup.classList.add("is-hidden");
  document.body.classList.remove("admin-layout-popup-open");
}
```

### Функція створення попапа
```typescript
function ensureTeamGraphPopup(): void {
  if (teamGraphPopup) {
    return;
  }
  const popup = document.createElement("div");
  popup.className = "admin-layout__team-graph-popup is-hidden";
  popup.tabIndex = -1;
  popup.innerHTML = `
    <div class="admin-layout__team-graph-backdrop" data-team-graph-close></div>
    <div class="admin-layout__team-graph-panel" role="dialog" aria-modal="true">
      <div class="admin-layout__team-graph-header">
        <span data-team-graph-title></span>
        <button class="team-graph-close" type="button" data-team-graph-close aria-label="Закрити">×</button>
      </div>
      <div class="admin-layout__team-graph-body" data-team-graph-body></div>
    </div>
  `;
  document.body.appendChild(popup);
  teamGraphPopup = popup;
  teamGraphBodyEl = popup.querySelector<HTMLElement>("[data-team-graph-body]");
  teamGraphTitleEl = popup.querySelector<HTMLElement>("[data-team-graph-title]");
  popup.querySelectorAll<HTMLElement>("[data-team-graph-close]").forEach((el) => {
    el.addEventListener("click", closeTeamGraphPopup);
  });
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeTeamGraphPopup();
    }
  });
}
```

### Функція завантаження даних
```typescript
async function loadTeamGraphStats(teamSlug: string): Promise<TeamMatchStat[] | null> {
  if (import.meta.env.DEV && DEV_BYPASS) {
    return getDevTeamGraphStats(teamSlug);
  }
  if (!apiBase || !initData) {
    return null;
  }
  return fetchAnalitikaTeam(teamSlug);
}
```

## 2. Функція рендерингу графіка (з analitika.ts)

```typescript
export function renderTeamMatchStatsList(items: TeamMatchStat[], teamSlug: string): string {
  const teamLabel = resolveTeamLabel(teamSlug);
  if (!items.length) {
    return `<p class="muted">Немає даних для ${escapeHtml(teamLabel)}.</p>`;
  }
  const orderedItems = items.slice().reverse();
  const ratingValues = orderedItems
    .map((item) => parseTeamMatchRating(item.avg_rating))
    .filter((value): value is number => value !== null);
  const minRating = ratingValues.length ? Math.min(...ratingValues) : 6.0;
  const maxRating = ratingValues.length ? Math.max(...ratingValues) : 7.5;
  const hasSpan = maxRating > minRating;
  const ratingSpan = hasSpan ? maxRating - minRating : 1;
  const pointsCount = orderedItems.length;
  const edgePad = pointsCount > 1 ? 8 : 0;
  const xSpan = 100 - edgePad * 2;
  const points = orderedItems.map((item, index) => {
    const ratingValue = parseTeamMatchRating(item.avg_rating);
    const clamped = ratingValue === null ? null : Math.min(maxRating, Math.max(minRating, ratingValue));
    const y = clamped === null ? 100 : hasSpan ? ((maxRating - clamped) / ratingSpan) * 100 : 50;
    const x = pointsCount > 1 ? edgePad + (index / (pointsCount - 1)) * xSpan : 50;
    const opponent = item.opponent_name || "—";
    const opponentLogo = resolveClubLogoByName(opponent);
    const scoreLabel = formatTeamMatchScoreLabel(item);
    const dateLabel = item.match_date ? formatKyivDateShort(item.match_date) : "";
    const homeAway = getHomeAwayLabel(item) ?? "";
    const outcomeClass = getTeamMatchOutcomeClass(item);
    return {
      x,
      y,
      opponent,
      opponentLogo,
      scoreLabel,
      dateLabel,
      homeAway,
      outcomeClass,
      ratingValue
    };
  });
  const polyline = points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const gridLines = points
    .map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === points.length - 1;
      const dateMeta = `
        <span class="analitika-line-date">
          ${point.dateLabel ? `<span>${escapeHtml(point.dateLabel)}</span>` : ""}
          ${point.homeAway ? `<span class="analitika-line-homeaway">${escapeHtml(point.homeAway)}</span>` : ""}
        </span>
      `;
      return `
        <span class="analitika-line-gridline" style="--x:${point.x}%" data-is-first="${isFirst}" data-is-last="${isLast}">
          ${point.dateLabel || point.homeAway ? dateMeta : ""}
        </span>
      `;
    })
    .join("");
  const pointMarkup = points
    .map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === points.length - 1;
      const isTopThird = point.y < 33;
      const isBottomThird = point.y > 67;
      const badgePosition = isTopThird ? "below" : isBottomThird ? "above" : "below";
      const badgeSide = isFirst ? "right" : isLast ? "left" : "center";
      
      const ariaLabel = [
        point.dateLabel,
        point.homeAway.toLowerCase(),
        `vs ${point.opponent}`,
        point.scoreLabel,
        point.ratingValue !== null ? `рейтинг ${point.ratingValue.toFixed(1)}` : ""
      ].filter(Boolean).join(", ");
      
      const score = `<span class="analitika-line-score ${escapeAttribute(point.outcomeClass)}" data-badge-position="${escapeAttribute(badgePosition)}" data-badge-side="${escapeAttribute(badgeSide)}">${escapeHtml(
        point.scoreLabel
      )}</span>`;
      return `
        <div 
          class="analitika-line-point" 
          style="--x:${point.x}%; --y:${point.y}%;"
          data-is-first="${isFirst}"
          data-is-last="${isLast}"
          role="img"
          aria-label="${escapeAttribute(ariaLabel)}"
        >
          <div class="analitika-line-content">
            <div class="analitika-line-logo">
              ${renderTeamLogo(point.opponent, point.opponentLogo)}
            </div>
            ${score}
          </div>
        </div>
      `;
    })
    .join("");
  
  // Знаходимо фактичні екстремуми серед точок (найвища та найнижча точки за координатою y)
  const pointsWithRating = points.filter((p) => p.ratingValue !== null);
  let maxPoint: typeof points[0] | null = null;
  let minPoint: typeof points[0] | null = null;
  
  if (pointsWithRating.length > 0) {
    maxPoint = pointsWithRating[0];
    minPoint = pointsWithRating[0];
    
    for (const point of pointsWithRating) {
      if (point.y < maxPoint.y) {
        maxPoint = point;
      }
      if (point.y > minPoint.y) {
        minPoint = point;
      }
    }
  }
  
  // Використовуємо фактичні екстремуми для міток осі Y
  const actualMaxRating = maxPoint?.ratingValue ?? maxRating;
  const actualMinRating = minPoint?.ratingValue ?? minRating;
  const actualMidRating = (actualMaxRating + actualMinRating) / 2;
  
  // Використовуємо фактичні позиції y екстремумів
  const maxY = maxPoint?.y ?? (hasSpan ? ((maxRating - maxRating) / ratingSpan) * 100 : 50);
  const minY = minPoint?.y ?? (hasSpan ? ((maxRating - minRating) / ratingSpan) * 100 : 50);
  // Середнє значення обчислюємо як середнє між фактичними екстремумами
  const midY = (maxY + minY) / 2;
  
  const axisLabels = [
    { value: actualMaxRating, y: maxY },
    { value: actualMidRating, y: midY },
    { value: actualMinRating, y: minY }
  ]
    .map((item) => `<span style="--y:${item.y}%">${item.value.toFixed(1)}</span>`)
    .join("");

  return `
    <section class="analitika-card is-graph" aria-label="${escapeAttribute(`${teamLabel} — останні матчі`)}">
      <div class="analitika-card-body">
        <div class="analitika-line">
          <div class="analitika-line-axis">
            ${axisLabels}
          </div>
          <div class="analitika-line-canvas">
            <div class="analitika-line-plot">
              <div class="analitika-line-grid">${gridLines}</div>
              <svg class="analitika-line-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${polyline}"></polyline>
              </svg>
              ${pointMarkup}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}
```

### Допоміжні функції для рендерингу графіка
```typescript
function parseTeamMatchRating(value: number | string | null | undefined): number | null {
  const numeric = parseTeamMatchNumber(value);
  if (numeric === null) {
    return null;
  }
  const clamped = Math.max(0, Math.min(10, numeric));
  return Math.round(clamped * 10) / 10;
}

function formatTeamMatchScoreLabel(item: TeamMatchStat): string {
  const teamGoals = parseTeamMatchNumber(item.team_goals);
  const opponentGoals = parseTeamMatchNumber(item.opponent_goals);
  if (teamGoals === null || opponentGoals === null) {
    return "—";
  }
  if (item.is_home === false) {
    return `${opponentGoals}:${teamGoals}`;
  }
  return `${teamGoals}:${opponentGoals}`;
}

function getTeamMatchOutcomeClass(item: TeamMatchStat): string {
  const teamGoals = parseTeamMatchNumber(item.team_goals);
  const opponentGoals = parseTeamMatchNumber(item.opponent_goals);
  if (teamGoals === null || opponentGoals === null) {
    return "is-missing";
  }
  if (teamGoals > opponentGoals) {
    return "is-win";
  }
  if (teamGoals < opponentGoals) {
    return "is-loss";
  }
  return "is-draw";
}

function getHomeAwayLabel(item: TeamMatchStat): string | null {
  if (item.is_home === true) {
    return "ВДОМА";
  }
  if (item.is_home === false) {
    return "ВИЇЗД";
  }
  return null;
}

function parseTeamMatchNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function renderTeamLogo(name: string, logo: string | null): string {
  const alt = escapeAttribute(name);
  return logo
    ? `<img class="match-logo" src="${escapeAttribute(logo)}" alt="${alt}" />`
    : `<div class="match-logo match-logo-fallback" role="img" aria-label="${alt}"></div>`;
}
```

## 3. CSS стилі для попапа (з adminLayout.css)

```css
body.admin-layout-active.admin-layout-popup-open {
  touch-action: auto;
}

.admin-layout__team-graph-popup {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  z-index: 5000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease;
}

.admin-layout__team-graph-popup:not(.is-hidden) {
  opacity: 1;
  pointer-events: auto;
}

.admin-layout__team-graph-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(8px);
}

.admin-layout__team-graph-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-height: 100dvh;
  background: rgba(8, 10, 16, 0.98);
  overflow: hidden;
  pointer-events: auto;
}

.admin-layout__team-graph-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  max-height: 64px;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 16px 10px;
  background: rgba(8, 10, 16, 0.98);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.admin-layout__team-graph-header>span {
  flex: 1;
  text-align: center;
}

.admin-layout__team-graph-header .team-graph-close {
  position: absolute;
  right: 20px;
}

.team-graph-close {
  background: transparent;
  border: 0;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  transition: opacity 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.team-graph-close:hover {
  opacity: 0.7;
}

.team-graph-close:active {
  opacity: 0.5;
}

.admin-layout__team-graph-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.admin-layout__team-graph-body .analitika-card {
  width: 100%;
  max-width: 980px;
  margin: 0;
}

.admin-layout__team-graph-body .analitika-line {
  max-width: 100%;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .admin-layout__team-graph-body .analitika-line {
    max-width: min(980px, calc(100% - 40px));
  }
}

@media (max-width: 480px) {
  .admin-layout__team-graph-body {
    padding: 16px;
  }

  .admin-layout__team-graph-body .analitika-line-canvas {
    height: 50vh;
    max-height: 400px;
    min-height: 300px;
  }

  .admin-layout__team-graph-body .analitika-line-plot {
    padding: 20px 20px 60px;
  }

  .admin-layout__team-graph-body .analitika-line {
    --line-logo-size: clamp(36px, 8vw, 44px);
  }

  .admin-layout__team-graph-body .analitika-line-score {
    font-size: 0.65rem;
    padding: 3px 6px;
  }
}

@media (max-width: 360px) {
  .admin-layout__team-graph-body .analitika-line-canvas {
    height: 45vh;
    max-height: 350px;
    min-height: 280px;
  }

  .admin-layout__team-graph-body .analitika-line-plot {
    padding: 16px 16px 56px;
  }

  .admin-layout__team-graph-body .analitika-line {
    --line-logo-size: 36px;
  }

  .admin-layout__team-graph-body .analitika-line-score {
    font-size: 0.6rem;
    padding: 2px 5px;
  }

  .admin-layout__team-graph-body .analitika-line-date {
    font-size: 0.65rem;
  }

  .admin-layout__team-graph-body .analitika-line-homeaway {
    font-size: 0.6rem;
  }

  .admin-layout__team-graph-body .analitika-line-gridline:not([data-is-first="true"]):not([data-is-last="true"]):nth-child(even) .analitika-line-date {
    opacity: 0.7;
  }

  .admin-layout__team-graph-body .analitika-line-gridline[data-is-first="true"] .analitika-line-date,
  .admin-layout__team-graph-body .analitika-line-gridline[data-is-last="true"] .analitika-line-date {
    opacity: 1;
    font-weight: 500;
  }
}
```

## 4. CSS стилі для графіка/таблиці (з predictions.css)

```css
.analitika-line {
  display: inline-flex;
  align-items: stretch;
  justify-content: center;
  --line-logo-size: clamp(40px, 7vw, 56px);
  --line-score-gap: 6px;
  width: 100%;
  max-width: 100%;
  overflow: visible;
  gap: 4px;
}

.analitika-line-axis {
  position: relative;
  font-size: 0.75rem;
  color: var(--muted);
  padding: 44px 8px 64px;
  width: 56px;
  flex-shrink: 0;
  min-height: 0;
  align-self: stretch;
  margin-right: 8px;
}

.analitika-line-axis > span {
  position: absolute;
  left: 8px;
  transform: translateY(-50%);
  top: var(--y, 0);
  transition: top 0.2s ease;
}

.analitika-line-canvas {
  position: relative;
  width: min(980px, 100%);
  max-width: 100%;
  height: 50vh;
  max-height: 500px;
  min-height: 300px;
  overflow: visible;
  padding: 0;
  box-sizing: border-box;
  margin-inline: auto;
  flex: 1;
  min-width: 0;
}

@media (max-width: 480px) {
  .analitika-line-canvas {
    height: 50vh;
    max-height: 400px;
    min-height: 300px;
  }
  
  .analitika-line-plot {
    padding: 20px 16px 60px;
  }
  
  .analitika-line-axis {
    padding: 20px 8px 60px;
    margin-right: 6px;
  }
  
  .analitika-line {
    --line-logo-size: clamp(36px, 8vw, 44px);
  }
  
  .analitika-line-score {
    font-size: 0.65rem;
    padding: 3px 6px;
  }
}

@media (max-width: 360px) {
  .analitika-line-canvas {
    height: 45vh;
    max-height: 350px;
    min-height: 280px;
  }
  
  .analitika-line-plot {
    padding: 16px 12px 56px;
  }
  
  .analitika-line-axis {
    padding: 16px 8px 56px;
    margin-right: 4px;
  }
  
  .analitika-line {
    --line-logo-size: 36px;
  }
  
  .analitika-line-score {
    font-size: 0.6rem;
    padding: 2px 5px;
  }
  
  .analitika-line-date {
    font-size: 0.65rem;
  }
  
  .analitika-line-homeaway {
    font-size: 0.6rem;
  }
  
  .analitika-line-gridline:not([data-is-first="true"]):not([data-is-last="true"]):nth-child(even) .analitika-line-date {
    opacity: 0.7;
  }
  
  .analitika-line-gridline[data-is-first="true"] .analitika-line-date,
  .analitika-line-gridline[data-is-last="true"] .analitika-line-date {
    opacity: 1;
    font-weight: 500;
  }
}

.analitika-line-plot {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: visible;
  padding: 44px 30px 64px;
  box-sizing: border-box;
}

.analitika-line-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.analitika-line-gridline {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--x);
  width: 1px;
  background: rgba(255, 255, 255, 0.06);
  pointer-events: none;
}

.analitika-line-date {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translate(-50%, 60px);
  font-size: 0.7rem;
  color: var(--muted);
  white-space: nowrap;
  display: grid;
  justify-items: center;
  gap: 2px;
  text-align: center;
  min-width: 0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.analitika-line-homeaway {
  font-size: 0.65rem;
  color: var(--muted);
}

.analitika-line-path {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.analitika-line-path polyline {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 480px) {
  .analitika-line-path polyline {
    stroke-width: 1.1;
  }
}

.analitika-line-point {
  position: absolute;
  left: var(--x);
  top: var(--y);
  transform: translate(-50%, -50%);
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.analitika-line-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.analitika-line-logo {
  width: var(--line-logo-size);
  height: var(--line-logo-size);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.analitika-line-logo .match-logo,
.analitika-line-logo .match-logo-fallback {
  position: static !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  transform: none !important;
  left: auto !important;
  top: auto !important;
  object-fit: contain;
  display: block;
  border-radius: 10px;
}

.analitika-line-logo .match-logo:not(.admin-layout__big-logo),
.analitika-line-logo .match-logo-fallback:not(.admin-layout__big-logo) {
  width: 100% !important;
  height: 100% !important;
}

.analitika-line-score {
  position: relative;
  background: rgba(12, 12, 14, 0.95);
  color: var(--ink);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--outline-light);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  flex-shrink: 0;
  z-index: 4;
}

.analitika-line-score[data-badge-side="left"] {
  align-self: flex-start;
}

.analitika-line-score[data-badge-side="right"] {
  align-self: flex-end;
}

.analitika-line-score[data-badge-side="center"] {
  align-self: center;
}

.analitika-line-point[data-is-first="true"] .analitika-line-content {
  align-items: flex-start;
}

.analitika-line-point[data-is-last="true"] .analitika-line-content {
  align-items: flex-end;
}

.analitika-line-score.is-win {
  color: #5ad78f;
  border-color: rgba(90, 215, 143, 0.6);
}

.analitika-line-score.is-loss {
  color: #ff6c6c;
  border-color: rgba(255, 108, 108, 0.6);
}

.analitika-line-score.is-draw {
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.5);
}

.analitika-line-score.is-missing {
  color: var(--muted);
  border-color: rgba(255, 255, 255, 0.2);
}

.analitika-card {
  border-radius: 18px;
  background: rgba(11, 12, 14, 0.85);
  border: 1px solid var(--outline-light);
  padding: 14px;
  display: grid;
  gap: 10px;
  box-shadow: 0 0 0 1px var(--outline-dark) inset;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
}

.analitika-card-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.analitika-card-header h3 {
  margin: 0;
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.analitika-card-body {
  display: grid;
  gap: 8px;
}

.analitika-card.is-graph {
  background: none;
  border: none;
  box-shadow: none;
  padding: 0;
  border-radius: 0;
  overflow: visible;
  margin-top: 12px;
  margin-bottom: 12px;
}

.analitika-card.is-graph .analitika-card-body {
  padding: 0;
  overflow: visible;
}

.analitika-card.is-graph .analitika-line {
  width: 100%;
  max-width: 100%;
  margin: 0;
  overflow: visible;
}

.analitika-table-wrap {
  width: 100%;
  overflow-x: auto;
}

.analitika-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.analitika-table th,
.analitika-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--outline-dark);
  text-align: left;
  vertical-align: top;
}

.analitika-table th {
  color: var(--muted);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.analitika-table td {
  white-space: pre-line;
}
```

## 5. Приклад використання (з main.ts)

### Обробник кліку на логотип команди
```typescript
// Обробник кліку тільки на логотипі команди
const logo = frame.querySelector<HTMLElement>(".match-logo, .match-logo-fallback");
if (logo) {
  logo.addEventListener("click", () => {
    void openTeamGraphPopup(teamSlug, teamName);
  });
}
```

## Примітки

1. Попап відкривається при кліку на логотип команди в адмін-панелі
2. Попап показує графік останніх матчів команди з рейтингом
3. Графік відображає точки з логотипами команд-суперників та рахунками матчів
4. Попап можна закрити кнопкою "×" або клавішею Escape
5. Попап має адаптивний дизайн для різних розмірів екранів
