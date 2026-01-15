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
const PRESENTATION_LAST5_TEAM_KEY = "presentation.last5Team";

type PresentationViewMode = 
  | "logos-only"      // НАСТУПНИЙ МАТЧ - only two logos
  | "stage"           // СТАДІЯ - tournament and stage
  | "weather"         // ПОГОДА - humidity and temperature
  | "probability"     // ЙМОВІРНІСТЬ - probability 1 / X / 2
  | "last5"           // ОСТАННІ 5 МАТЧІВ - filters for two teams
  | "average-score";  // СЕРЕДНІЙ РАХУНОК - logos and average score

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
    return "logos-only";
  }
  const stored = window.localStorage.getItem(PRESENTATION_VIEW_MODE_KEY);
  if (
    stored === "logos-only" ||
    stored === "stage" ||
    stored === "weather" ||
    stored === "probability" ||
    stored === "last5" ||
    stored === "average-score"
  ) {
    return stored;
  }
  return "logos-only";
}

function getLast5Team(): "home" | "away" {
  if (typeof window === "undefined") {
    return "home";
  }
  const stored = window.localStorage.getItem(PRESENTATION_LAST5_TEAM_KEY);
  return stored === "away" ? "away" : "home";
}

function setLast5Team(team: "home" | "away"): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PRESENTATION_LAST5_TEAM_KEY, team);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: PRESENTATION_LAST5_TEAM_KEY,
      newValue: team
    })
  );
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

function formatTournamentStage(stage: string): string {
  const trimmed = stage.trim();
  if (!trimmed) {
    return "";
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("quarter-final")) {
    return "ЧВЕРТЬФІНАЛ";
  }
  if (lower.includes("semi-final")) {
    return "ПІВФІНАЛ";
  }
  if (lower.includes("final")) {
    return "ФІНАЛ";
  }
  if (lower.includes("1/8")) {
    return "1/8 ФІНАЛУ";
  }
  if (lower.includes("1/4")) {
    return "1/4 ФІНАЛУ";
  }
  if (lower.includes("1/2")) {
    return "1/2 ФІНАЛУ";
  }
  const roundOfMatch = lower.match(/round\s+of\s+(\d+)/);
  if (roundOfMatch) {
    const roundNumber = Number.parseInt(roundOfMatch[1], 10);
    if (roundNumber === 16) {
      return "1/8 ФІНАЛУ";
    }
    if (roundNumber === 8) {
      return "1/4 ФІНАЛУ";
    }
    if (roundNumber === 4) {
      return "ПІВФІНАЛ";
    }
    if (roundNumber === 2) {
      return "ФІНАЛ";
    }
    if (roundNumber === 32) {
      return "1/16 ФІНАЛУ";
    }
  }
  const regularMatch = lower.match(/regular\s+season\s*-\s*(\d+)/);
  if (regularMatch) {
    return `${regularMatch[1]} РАУНД`;
  }
  return trimmed;
}

function renderMatchCard(match: PresentationMatch, viewMode: PresentationViewMode = "logos-only"): string {
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
  const tournamentName = match.tournamentName?.trim() ?? "";
  const tournamentStage = match.tournamentStage ? formatTournamentStage(match.tournamentStage) : "";
  
  // Extract average score for average mode
  const averageScoreHtml = renderAveragePredictionScore(match.predictions);
  
  // Determine which team to show for last5 mode
  const last5Team = getLast5Team();
  const last5Matches = last5Team === "home" ? match.homeRecentMatches : match.awayRecentMatches;
  const last5TeamName = last5Team === "home" ? homeName : awayName;

  // Mode-specific rendering
  if (viewMode === "logos-only") {
    // 1. НАСТУПНИЙ МАТЧ - only two logos
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
          </div>
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
          </div>
        </div>
      </article>
    `;
  }
  
  if (viewMode === "stage") {
    // 2. СТАДІЯ - tournament and stage
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <header class="presentation-match-card__header">
          <div class="presentation-match-card__stage">
            ${tournamentName ? `<div class="presentation-tournament-name">${escapeHtml(tournamentName.toUpperCase())}</div>` : ""}
            ${tournamentStage ? `<div class="presentation-tournament-stage">${escapeHtml(tournamentStage)}</div>` : ""}
          </div>
        </header>
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
          </div>
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
          </div>
        </div>
      </article>
    `;
  }
  
  if (viewMode === "weather") {
    // 3. ПОГОДА - humidity and temperature
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
          </div>
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
          </div>
        </div>
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
      </article>
    `;
  }
  
  if (viewMode === "probability") {
    // 4. ЙМОВІРНІСТЬ - probability 1 / X / 2
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
          </div>
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
          </div>
        </div>
        <div class="presentation-probabilities">
          ${renderProbability("1", match.homeProbability, "home")}
          ${renderProbability("X", match.drawProbability, "draw")}
          ${renderProbability("2", match.awayProbability, "away")}
        </div>
      </article>
    `;
  }
  
  if (viewMode === "last5") {
    // 5. ОСТАННІ 5 МАТЧІВ - filters for two teams, clicking switches team
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <header class="presentation-match-card__header">
          <div class="presentation-last5-filters">
            <button class="presentation-last5-filter ${last5Team === "home" ? "is-active" : ""}" data-last5-team="home">
              ${escapeHtml(homeName.toUpperCase())}
            </button>
            <button class="presentation-last5-filter ${last5Team === "away" ? "is-active" : ""}" data-last5-team="away">
              ${escapeHtml(awayName.toUpperCase())}
            </button>
          </div>
        </header>
        <div class="presentation-match-history">
          <div class="presentation-history-column">
            <p class="presentation-section-title">ОСТАННІ 5 МАТЧІВ — ${escapeHtml(last5TeamName)}</p>
            ${renderHistoryRows(last5Matches)}
          </div>
        </div>
      </article>
    `;
  }
  
  if (viewMode === "average-score") {
    // 6. СЕРЕДНІЙ РАХУНОК - logos and average score
    return `
      <article class="presentation-match-card" data-view-mode="${viewMode}">
        <div class="presentation-match-card__teams">
          <div class="presentation-match-team">
            ${renderTeamLogo(homeName, homeLogo)}
          </div>
          ${averageScoreHtml}
          <div class="presentation-match-team">
            ${renderTeamLogo(awayName, awayLogo)}
          </div>
        </div>
      </article>
    `;
  }
  
  // Fallback to logos-only
  return `
    <article class="presentation-match-card" data-view-mode="logos-only">
      <div class="presentation-match-card__teams">
        <div class="presentation-match-team">
          ${renderTeamLogo(homeName, homeLogo)}
        </div>
        <div class="presentation-match-team">
          ${renderTeamLogo(awayName, awayLogo)}
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
    event.key === PRESENTATION_VIEW_MODE_KEY ||
    event.key === PRESENTATION_LAST5_TEAM_KEY
  ) {
    renderWithHandlers();
  }
});

window.addEventListener("focus", () => {
  void ensureRemoteMatches();
});

// Setup event handlers for last5 filter buttons
function setupLast5Filters(): void {
  const filters = document.querySelectorAll<HTMLButtonElement>("[data-last5-team]");
  filters.forEach((button) => {
    button.addEventListener("click", () => {
      const team = button.dataset.last5Team;
      if (team === "home" || team === "away") {
        setLast5Team(team);
        render();
      }
    });
  });
}

// Setup event handlers after render
function renderWithHandlers(): void {
  render();
  // Setup handlers for dynamically rendered elements
  requestAnimationFrame(() => {
    setupLast5Filters();
  });
}

renderWithHandlers();
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
  renderWithHandlers();
}
