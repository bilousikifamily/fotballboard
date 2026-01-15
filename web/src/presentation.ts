import { escapeAttribute, escapeHtml } from "./utils/escape";
import { formatKyivDateTime, formatKyivDateShort } from "./formatters/dates";
import { formatPredictionName } from "./formatters/names";
import { formatClubName, getClubLogoPath, resolveLogoLeagueId } from "./features/clubs";
import {
  normalizeRainProbability,
  formatRainProbability,
  formatTemperature,
  getWeatherIcon,
  renderTeamLogo
} from "./screens/matches";
import {
  getPresentationUpdatedAt,
  loadPresentationMatches,
  mergePresentationMatches,
  PresentationMatch,
  savePresentationMatches,
  STORAGE_KEY
} from "./presentation/storage";
import type { PresentationPredictionUser } from "./presentation/storage";
import type { PredictionUser, TeamMatchStat } from "./types";
import { fetchPresentationMatches } from "./presentation/remote";

const root = document.querySelector<HTMLElement>("#presentation");
if (!root) {
  throw new Error("Presentation root element is missing");
}

const matchList = root.querySelector<HTMLElement>("[data-match-list]");
const emptyState = root.querySelector<HTMLElement>("[data-empty-state]");
const updatedLabel = root.querySelector<HTMLElement>("[data-last-updated]");
const formatter = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" });
const API_BASE =
  import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");

function render(): void {
  const matches = loadPresentationMatches();
  if (!matchList || !updatedLabel || !emptyState) {
    return;
  }

  if (!matches.length) {
    matchList.innerHTML = "";
    emptyState.classList.remove("is-hidden");
  } else {
    emptyState.classList.add("is-hidden");
    matchList.innerHTML = matches.map(renderMatchCard).join("");
  }

  updatedLabel.textContent = `Оновлено ${formatter.format(getPresentationUpdatedAt())}`;
}

function renderMatchCard(match: PresentationMatch): string {
  const homeName = match.homeTeam || formatClubName(match.homeClub);
  const awayName = match.awayTeam || formatClubName(match.awayClub);
  const leagueForLogos = resolveLogoLeagueId(match.homeLeague ?? match.awayLeague ?? null);
  const logoLeague = leagueForLogos ?? match.homeLeague ?? match.awayLeague ?? "english-premier-league";
  const homeLogo = match.homeClub && logoLeague ? getClubLogoPath(logoLeague, match.homeClub) : null;
  const awayLogo = match.awayClub && logoLeague ? getClubLogoPath(logoLeague, match.awayClub) : null;
  const rainPercent = normalizeRainProbability(match.rainProbability ?? null);
  const rainLabel = formatRainProbability(rainPercent);
  const weatherIcon = getWeatherIcon(match.weatherCondition ?? null);
  const tempLabel = formatTemperature(match.weatherTempC ?? null);
  const noteMarkup = match.note
    ? `<span class="presentation-note">${escapeHtml(match.note)}</span>`
    : `<span class="presentation-note">Прогноз</span>`;

  return `
    <article class="presentation-match-card">
      <header class="presentation-match-card__header">
        <div class="presentation-match-card__time">
          <strong>${escapeHtml(formatKyivDateTime(match.kickoff))}</strong>
          ${match.venueCity ? `<span>· ${escapeHtml(match.venueCity.toUpperCase())}</span>` : ""}
        </div>
        ${noteMarkup}
      </header>
      <div class="presentation-match-card__teams">
        <div class="presentation-match-team">
          ${renderTeamLogo(homeName, homeLogo)}
          <strong>${escapeHtml(homeName)}</strong>
        </div>
        <span class="presentation-match-card__vs">vs</span>
        <div class="presentation-match-team">
          ${renderTeamLogo(awayName, awayLogo)}
          <strong>${escapeHtml(awayName)}</strong>
        </div>
      </div>
      <div class="presentation-match-weather">
        <div class="presentation-match-weather__temp">
          <span>${escapeHtml(tempLabel)}</span>
          ${match.weatherTimezone ? `<span>${escapeHtml(match.weatherTimezone)}</span>` : ""}
        </div>
        <div class="presentation-match-weather__rain">
          <span class="presentation-weather-icon" aria-hidden="true">${weatherIcon}</span>
          <div class="presentation-match-weather__bar">
            <span style="width: ${rainPercent ?? 0}%"></span>
          </div>
          <span>${escapeHtml(rainLabel)}</span>
        </div>
      </div>
      <div class="presentation-probabilities">
        ${renderProbability("Господарі", match.homeProbability, "home")}
        ${renderProbability("Нічия", match.drawProbability, "draw")}
        ${renderProbability("Гості", match.awayProbability, "away")}
      </div>
      <div class="presentation-match-predictions">
        <p class="presentation-section-title">Прогнози користувачів</p>
        ${renderPredictions(match.predictions)}
      </div>
      <div class="presentation-match-history">
        <div class="presentation-history-column">
          <p class="presentation-section-title">Останні 5 — ${escapeHtml(homeName)}</p>
          ${renderHistoryRows(match.homeRecentMatches)}
        </div>
        <div class="presentation-history-column">
          <p class="presentation-section-title">Останні 5 — ${escapeHtml(awayName)}</p>
          ${renderHistoryRows(match.awayRecentMatches)}
        </div>
      </div>
    </article>
  `;
}

function renderProbability(label: string, value: number, type: "home" | "draw" | "away"): string {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return `
    <div class="presentation-probability" data-type="${type}">
      <div class="presentation-probability__label">
        <span>${escapeHtml(label)}</span>
        <strong>${safeValue}%</strong>
      </div>
      <div class="presentation-probability__bar">
        <span style="width: ${safeValue}%"></span>
      </div>
    </div>
  `;
}

function renderPredictions(predictions?: PresentationMatch["predictions"]): string {
  if (!predictions?.length) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }
  return `
    <div class="presentation-predictions-list">
      ${predictions
        .map((prediction) => {
          const user = toPredictionUser(prediction.user);
          const label = formatPredictionName(user);
          return `
            <div class="presentation-prediction-row">
              <span>${escapeHtml(label)}</span>
              <strong>${prediction.home_pred}:${prediction.away_pred}</strong>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderHistoryRows(items?: TeamMatchStat[]): string {
  if (!items?.length) {
    return `<p class="muted small">Немає даних.</p>`;
  }
  return items
    .map((item) => {
      const dateLabel = item.match_date ? formatKyivDateShort(item.match_date) : "—";
      const opponent = item.opponent_name ?? "—";
      const score = formatHistoryScore(item);
      const outcomeClass = getHistoryOutcomeClass(item);
      return `
        <div class="presentation-history-row ${escapeAttribute(outcomeClass)}">
          <span class="history-date">${escapeHtml(dateLabel)}</span>
          <span class="history-opponent">${escapeHtml(opponent)}</span>
          <span class="history-score">${escapeHtml(score)}</span>
        </div>
      `;
    })
    .join("");
}

function formatHistoryScore(item: TeamMatchStat): string {
  const home = parseHistoryNumber(item.team_goals);
  const away = parseHistoryNumber(item.opponent_goals);
  if (home === null || away === null) {
    return "—";
  }
  return `${home}:${away}`;
}

function getHistoryOutcomeClass(item: TeamMatchStat): string {
  const home = parseHistoryNumber(item.team_goals);
  const away = parseHistoryNumber(item.opponent_goals);
  if (home === null || away === null) {
    return "is-missing";
  }
  if (home > away) {
    return "is-win";
  }
  if (home < away) {
    return "is-loss";
  }
  return "is-draw";
}

function parseHistoryNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPredictionUser(user: PresentationPredictionUser | null | undefined): PredictionUser | null {
  if (!user) {
    return null;
  }
  return {
    id: 0,
    nickname: user.nickname ?? null,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    photo_url: null,
    points_total: null
  };
}

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    render();
  }
});

window.addEventListener("focus", () => {
  void ensureRemoteMatches();
});

render();
void ensureRemoteMatches();

async function ensureRemoteMatches(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const remoteMatches = await fetchPresentationMatches(API_BASE);
  if (!remoteMatches.length) {
    return;
  }
  const existing = loadPresentationMatches();
  const merged = mergePresentationMatches(existing, remoteMatches);
  savePresentationMatches(merged);
  render();
}
