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

const CURRENT_MATCH_INDEX_KEY = "presentation.currentMatchIndex";
const PRESENTATION_VIEW_MODE_KEY = "presentation.viewMode";

type PresentationViewMode = "normal" | "average" | "chart";

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

function getCurrentMatchIndex(matchesLength: number): number {
  if (typeof window === "undefined" || matchesLength === 0) {
    return 0;
  }
  const stored = window.localStorage.getItem(CURRENT_MATCH_INDEX_KEY);
  const parsed = stored ? Number(stored) : 0;
  const index = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  // Ensure index is within bounds
  return Math.min(index, Math.max(0, matchesLength - 1));
}

function getViewMode(): PresentationViewMode {
  if (typeof window === "undefined") {
    return "normal";
  }
  const stored = window.localStorage.getItem(PRESENTATION_VIEW_MODE_KEY);
  if (stored === "average" || stored === "chart") {
    return stored;
  }
  return "normal";
}

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
    const currentIndex = getCurrentMatchIndex(matches.length);
    const currentMatch = matches[currentIndex];
    const viewMode = getViewMode();
    
    if (currentMatch) {
      matchList.innerHTML = renderMatchCard(currentMatch, viewMode);
      // Trigger animation by adding class after a brief delay
      requestAnimationFrame(() => {
        const card = matchList.querySelector<HTMLElement>(".presentation-match-card");
        if (card) {
          card.classList.add("is-visible");
        }
      });
    } else {
      matchList.innerHTML = "";
      emptyState.classList.remove("is-hidden");
    }
  }

  updatedLabel.textContent = `Оновлено ${formatter.format(getPresentationUpdatedAt())}`;
}

function renderMatchCard(match: PresentationMatch, viewMode: PresentationViewMode = "normal"): string {
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
  const venueName = typeof match.venueName === "string" ? match.venueName.trim() : "";
  const venueCity = typeof match.venueCity === "string" ? match.venueCity.trim() : "";
  const venueCityLabel = venueCity ? venueCity.toUpperCase() : "";
  const venueMarkup =
    venueName || venueCity
      ? `<p class="presentation-match-card__venue">${
          venueName ? `<span class="presentation-match-card__venue-name">${escapeHtml(venueName)}</span>` : ""
        }${venueCity ? `<span class="presentation-match-card__venue-city">${escapeHtml(
          venueCityLabel
        )}</span>` : ""}</p>`
      : "";
  const noteMarkup = match.note
    ? `<span class="presentation-note">${escapeHtml(match.note)}</span>`
    : `<span class="presentation-note">Прогноз</span>`;

  const isChartMode = viewMode === "chart";
  const isAverageMode = viewMode === "average";
  const showNormalContent = viewMode === "normal";

  // Extract average score for average mode
  const averageScoreHtml = renderAveragePredictionScore(match.predictions);
  const averageScoreText = averageScoreHtml.replace(/<[^>]*>/g, "").trim();

  return `
    <article class="presentation-match-card" data-view-mode="${viewMode}">
      ${showNormalContent || isAverageMode ? `
        <header class="presentation-match-card__header">
          <div class="presentation-match-card__time">
            <strong>${escapeHtml(formatKyivDateTime(match.kickoff))}</strong>
          </div>
          <div class="presentation-match-card__meta">
            ${venueMarkup}
            ${noteMarkup}
          </div>
        </header>
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
            <strong>${escapeHtml(homeName)}</strong>
          </div>
          ${averageScoreHtml}
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
            <strong>${escapeHtml(awayName)}</strong>
          </div>
        </div>
      ` : ""}
      ${isChartMode ? `
        <header class="presentation-match-card__header">
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
        </header>
      ` : ""}
      ${showNormalContent ? `
        <div class="presentation-match-weather">
          <div class="presentation-match-weather__temp">
            <span>${escapeHtml(tempLabel)}</span>
            ${match.weatherTimezone ? `<span>${escapeHtml(match.weatherTimezone.toUpperCase())}</span>` : match.venueCity ? `<span>${escapeHtml(match.venueCity.toUpperCase())}</span>` : ""}
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
      ` : ""}
      ${isAverageMode ? `
        <div class="presentation-average-prediction-large">
          <p class="presentation-section-title">Середній прогноз</p>
          <div class="presentation-average-prediction-score">${averageScoreHtml}</div>
        </div>
      ` : ""}
      ${showNormalContent || isChartMode ? `
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
      ` : ""}
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
  // Limit to last 5 matches
  const recentMatches = items.slice(0, 5);
  const scores = recentMatches.map((item) => {
    const teamGoals = parseHistoryNumber(item.team_goals) ?? 0;
    const opponentGoals = parseHistoryNumber(item.opponent_goals) ?? 0;
    return { teamGoals, opponentGoals };
  });
  
  // Calculate max goals for scaling the graph
  const maxGoals = Math.max(
    1,
    ...scores.map((s) => Math.max(s.teamGoals, s.opponentGoals))
  );
  
  return `
    <div class="presentation-history-graph">
      ${recentMatches
        .map((item) => {
          const dateLabel = item.match_date ? formatKyivDateShort(item.match_date) : "—";
          const opponent = item.opponent_name ?? "—";
          const score = formatHistoryScore(item);
          const outcomeClass = getHistoryOutcomeClass(item);
          const teamGoals = parseHistoryNumber(item.team_goals) ?? 0;
          const opponentGoals = parseHistoryNumber(item.opponent_goals) ?? 0;
          const teamHeight = maxGoals > 0 ? (teamGoals / maxGoals) * 100 : 0;
          const opponentHeight = maxGoals > 0 ? (opponentGoals / maxGoals) * 100 : 0;
          
          return `
            <div class="presentation-history-graph-item">
              <div class="presentation-history-graph-bars">
                <div class="presentation-history-graph-bar ${escapeAttribute(outcomeClass)}" style="height: ${teamHeight}%">
                  <span class="presentation-history-graph-value">${teamGoals}</span>
                </div>
                <div class="presentation-history-graph-bar opponent" style="height: ${opponentHeight}%">
                  <span class="presentation-history-graph-value">${opponentGoals}</span>
                </div>
              </div>
              <div class="presentation-history-graph-label">
                <span class="history-date">${escapeHtml(dateLabel)}</span>
                <span class="history-opponent">${escapeHtml(opponent)}</span>
                <span class="history-score ${escapeAttribute(outcomeClass)}">${escapeHtml(score)}</span>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAveragePredictionScore(predictions?: PresentationMatch["predictions"]): string {
  if (!predictions?.length) {
    return `<span class="presentation-match-card__vs">vs</span>`;
  }
  const sumHome = predictions.reduce((acc, prediction) => acc + prediction.home_pred, 0);
  const sumAway = predictions.reduce((acc, prediction) => acc + prediction.away_pred, 0);
  const total = predictions.length;
  const formatValue = (value: number): string => {
    const rounded = Number((value).toFixed(1));
    return Number.isFinite(rounded) ? rounded.toString().replace(/\.0$/, "") : "0";
  };
  const averageHome = sumHome / total;
  const averageAway = sumAway / total;
  return `<span class="presentation-match-card__score">${formatValue(averageHome)}:${formatValue(averageAway)}</span>`;
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
  if (
    event.key === STORAGE_KEY ||
    event.key === CURRENT_MATCH_INDEX_KEY ||
    event.key === PRESENTATION_VIEW_MODE_KEY
  ) {
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
