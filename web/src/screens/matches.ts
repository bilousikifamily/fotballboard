import type { Match } from "../types";
import { escapeAttribute, escapeHtml } from "../utils/escape";
import { getMatchPredictionCloseAtMs } from "../features/predictionTime";
import { renderMatchAnalitika } from "../features/analitika";
import { getMatchTeamInfo } from "../features/clubs";
import { renderMatchOdds } from "../features/odds";

export function normalizeRainProbability(value: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function formatRainProbability(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value}%`;
}

export function formatTemperature(value: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—°C";
  }
  return `${Math.round(value)}°C`;
}

export function formatTimeInZone(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function getWeatherIcon(condition: string | null): string {
  if (condition === "thunderstorm") {
    return "⛈️";
  }
  if (condition === "snow") {
    return "🌨️";
  }
  return "🌧️";
}

export function renderTeamLogo(
  name: string,
  logo: string | null,
  fallbackLogo: string | null = null
): string {
  const alt = escapeAttribute(name);
  if (!logo) {
    return `<div class="match-logo match-logo-fallback" role="img" aria-label="${alt}"></div>`;
  }
  const fallbackAttr = fallbackLogo
    ? ` onerror="this.onerror=null;this.src='${escapeAttribute(fallbackLogo)}'"`
    : "";
  return `<img class="match-logo" src="${escapeAttribute(logo)}" alt="${alt}"${fallbackAttr} />`;
}

export function renderMatchesList(matches: Match[]): string {
  if (!matches.length) {
    return `
      <article class="match match-empty">
        <p class="muted">Немає матчів на цю дату.</p>
      </article>
    `;
  }

  return matches.map((match) => renderMatchCard(match)).join("");
}

export function renderPendingMatchesList(matches: Match[]): string {
  if (!matches.length) {
    return `<p class="muted small">Немає матчів для підтвердження.</p>`;
  }

  return matches
    .map((match) => {
      const preview = renderMatchCard(match, { preview: true });
      return `
        <div class="admin-pending-card" data-admin-pending-card data-match-id="${match.id}">
          ${preview}
          <div class="admin-pending-actions">
            <button class="button secondary small-button" type="button" data-admin-fetch-odds="${match.id}">
              КОЕФІЦІЄНТИ
            </button>
            <button class="button small-button" type="button" data-admin-confirm-match="${match.id}">
              ПІДТВЕРДИТИ
            </button>
          </div>
          <p class="muted small" data-admin-pending-status data-match-id="${match.id}"></p>
        </div>
      `;
    })
    .join("");
}

function resolveMatchTimezone(match: Match): string | null {
  if (match.weather_timezone) {
    return match.weather_timezone;
  }
  switch (match.league_id) {
    case "english-premier-league":
    case "fa-cup":
      return "Europe/London";
    case "la-liga":
    case "copa-del-rey":
      return "Europe/Madrid";
    case "serie-a":
    case "coppa-italia":
      return "Europe/Rome";
    case "bundesliga":
    case "dfb-pokal":
      return "Europe/Berlin";
    case "ligue-1":
    case "coupe-de-france":
      return "Europe/Paris";
    case "ukrainian-premier-league":
      return "Europe/Kyiv";
    default:
      return null;
  }
}

type MatchRenderOptions = {
  preview?: boolean;
};

function renderMatchCard(match: Match, options: MatchRenderOptions = {}): string {
  const {
    homeName,
    awayName,
    homeLogo,
    awayLogo,
    homeLogoFallback,
    awayLogoFallback
  } = getMatchTeamInfo(match);
  const homeLogoMarkup = renderTeamLogo(homeName, homeLogo, homeLogoFallback);
  const awayLogoMarkup = renderTeamLogo(awayName, awayLogo, awayLogoFallback);
  const city = match.venue_city ?? match.venue_name ?? "";
  const cityLabel = city ? city.toUpperCase() : "";
  const kyivTime = formatTimeInZone(match.kickoff_at, "Europe/Kyiv");
  const localTimezone = resolveMatchTimezone(match);
  const localTime = localTimezone ? formatTimeInZone(match.kickoff_at, localTimezone) : null;
  const tempValue = formatTemperature(match.weather_temp_c ?? null);
  const cityMarkup = city
    ? `<span class="match-meta-sep">·</span><span class="match-city">${escapeHtml(cityLabel)}</span>`
    : "";
  const localTimeMarkup = localTime
    ? `<span class="match-time-alt" data-match-local-time data-match-id="${match.id}">(${escapeHtml(localTime)})</span>`
    : "";
  const rainPercent = normalizeRainProbability(match.rain_probability ?? null);
  const rainValue = formatRainProbability(rainPercent);
  const rainIcon = getWeatherIcon(match.weather_condition ?? null);
  const rainBarWidth = rainPercent ?? 0;
  const rainMarkup = `
    <div class="match-weather-row" data-match-rain data-match-id="${match.id}" aria-label="Дощ: ${rainValue}">
      <span class="match-weather-icon" data-match-rain-icon aria-hidden="true">${rainIcon}</span>
      <span class="match-weather-bar" aria-hidden="true">
        <span class="match-weather-bar-fill" data-match-rain-fill style="width: ${rainBarWidth}%"></span>
      </span>
      <span class="match-weather-value" data-match-rain-value>${rainValue}</span>
    </div>
  `;
  const tournamentName = match.tournament_name?.trim() ?? "";
  const tournamentStage = match.tournament_stage ? formatTournamentStage(match.tournament_stage) : "";
  const oddsMarkup = renderMatchOdds(match, homeName, awayName);
  const hasCompetition = Boolean(tournamentName || tournamentStage);
  const hasOdds = Boolean(oddsMarkup.trim());
  const competitionClass = hasOdds ? "" : " is-solo";
  const competitionMarkup = hasCompetition
    ? `
      <div class="match-competition${competitionClass}">
        ${tournamentName ? `<span class="match-competition-name">${escapeHtml(tournamentName)}</span>` : ""}
        ${tournamentStage ? `<span class="match-competition-stage">${escapeHtml(tournamentStage)}</span>` : ""}
      </div>
    `
    : "";
  const oddsBlock = hasCompetition || hasOdds
    ? `
      <div class="match-odds${hasCompetition ? " has-competition" : ""}">
        ${competitionMarkup}
        ${oddsMarkup}
      </div>
    `
    : "";
  const matchAnalitika = renderMatchAnalitika(match.id, homeName, awayName);
  const finished = match.status === "finished";
  const closeAtMs = getMatchPredictionCloseAtMs(match);
  const closed = finished || (closeAtMs !== null && Date.now() > closeAtMs);
  const predicted = Boolean(match.has_prediction);
  const isPreview = options.preview === true;
  const isPending = match.status === "pending";
  const result =
    finished && match.home_score !== null && match.away_score !== null
      ? `
        <div class="match-scoreline">
          ${homeLogoMarkup}
          <div class="match-result">${match.home_score}:${match.away_score}</div>
          ${awayLogoMarkup}
        </div>
      `
      : "";
  const statusLine = isPreview && isPending
    ? `<p class="muted small status-pending">Очікує підтвердження.</p>`
    : finished
      ? `<p class="muted small">Матч завершено.</p>`
      : closed
        ? `<p class="muted small status-closed">Прогнози закрито.</p>`
        : "";
  const form = closed || predicted
    ? ""
    : `
      <form class="prediction-form" data-prediction-form data-match-id="${match.id}" ${
        isPreview ? "data-prediction-preview='true'" : ""
      }>
        <div class="score-row">
          ${homeLogoMarkup}
          <div class="score-controls">
            <div class="score-control" data-score-control>
              <button class="score-btn" type="button" data-score-inc>+</button>
              <div class="score-value" data-score-value>0</div>
              <button class="score-btn" type="button" data-score-dec>-</button>
              <input type="hidden" name="home_pred" value="0" />
            </div>
            <span class="score-separator">:</span>
            <div class="score-control" data-score-control>
              <button class="score-btn" type="button" data-score-inc>+</button>
              <div class="score-value" data-score-value>0</div>
              <button class="score-btn" type="button" data-score-dec>-</button>
              <input type="hidden" name="away_pred" value="0" />
            </div>
          </div>
          ${awayLogoMarkup}
        </div>
        <p class="match-odds-score muted small is-hidden" data-match-odds-score></p>
        <p class="muted small" data-prediction-status></p>
        <button class="button small-button prediction-submit" type="submit">ПРОГОЛОСУВАТИ</button>
      </form>
    `;
  const countdown = closed || predicted || isPreview
    ? ""
    : `<p class="prediction-countdown muted small" data-prediction-countdown data-match-id="${match.id}"></p>`;

  return `
    <div class="match-item ${predicted ? "has-prediction" : ""}${isPreview ? " is-preview" : ""}">
      <div class="match-time">
        <div class="match-time-row">
          <span class="match-time-value" data-match-kyiv-time data-match-id="${match.id}">${escapeHtml(kyivTime)}</span>
          ${cityMarkup}
          ${localTimeMarkup}
          <span class="match-meta-sep">·</span>
          <span class="match-temp" data-match-temp data-match-id="${match.id}">${escapeHtml(tempValue)}</span>
        </div>
        ${rainMarkup}
      </div>
      <article class="match">
        ${oddsBlock}
        <div class="match-header">
          ${result}
        </div>
        <div class="match-average" data-match-average data-match-id="${match.id}"></div>
        ${closed ? "" : statusLine}
        ${form}
        <div class="predictions" data-predictions data-match-id="${match.id}" ${
          predicted ? "data-auto-open='true'" : ""
        }></div>
        ${closed ? statusLine : ""}
      </article>
      ${matchAnalitika}
      ${countdown}
    </div>
  `;
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
