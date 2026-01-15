import { ALL_CLUBS, type MatchLeagueId } from "../data/clubs";
import { formatClubName, findClubLeague } from "../features/clubs";
import { normalizeTeamSlugValue } from "../features/analitika";
import type { TeamMatchStat } from "../types";

export const STORAGE_KEY = "presentation.matches";
export const STORAGE_UPDATED_KEY = "presentation.matches.updated";

export type PresentationMatch = {
  id: string;
  homeLeague: MatchLeagueId;
  awayLeague: MatchLeagueId;
  homeClub: string;
  awayClub: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  note?: string;
  createdAt: number;
  venueCity?: string | null;
  venueName?: string | null;
  rainProbability?: number | null;
  weatherCondition?: string | null;
  weatherTempC?: number | null;
  weatherTimezone?: string | null;
  predictions?: PresentationPrediction[];
  homeRecentMatches?: TeamMatchStat[];
  awayRecentMatches?: TeamMatchStat[];
};

export type PresentationPredictionUser = {
  nickname?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type PresentationPrediction = {
  home_pred: number;
  away_pred: number;
  points: number | null;
  user: PresentationPredictionUser | null;
};

type MatchTemplate = {
  homeLeague: MatchLeagueId;
  awayLeague: MatchLeagueId;
  homeClub: string;
  awayClub: string;
  homeProb: number;
  drawProb: number;
  awayProb: number;
  hoursFromNow: number;
  note?: string;
};

const DEFAULT_TEMPLATES: MatchTemplate[] = [
  {
    homeLeague: "english-premier-league",
    awayLeague: "english-premier-league",
    homeClub: "arsenal",
    awayClub: "chelsea",
    homeProb: 62,
    drawProb: 22,
    awayProb: 16,
    hoursFromNow: 2,
    note: "Матч дня"
  },
  {
    homeLeague: "la-liga",
    awayLeague: "la-liga",
    homeClub: "barcelona",
    awayClub: "real-madrid",
    homeProb: 47,
    drawProb: 28,
    awayProb: 25,
    hoursFromNow: 8,
    note: "Класико"
  },
  {
    homeLeague: "serie-a",
    awayLeague: "serie-a",
    homeClub: "napoli",
    awayClub: "juventus",
    homeProb: 55,
    drawProb: 25,
    awayProb: 20,
    hoursFromNow: 26,
    note: "Італійський бій"
  }
];

const MATCH_LEAGUES = Object.keys(ALL_CLUBS) as MatchLeagueId[];

export function createDefaultMatches(): PresentationMatch[] {
  const now = Date.now();
  return DEFAULT_TEMPLATES.map((template, index) => ({
    id: `default-${index + 1}`,
    homeLeague: template.homeLeague,
    awayLeague: template.awayLeague,
    homeClub: template.homeClub,
    awayClub: template.awayClub,
    homeTeam: formatClubName(template.homeClub),
    awayTeam: formatClubName(template.awayClub),
    kickoff: new Date(now + template.hoursFromNow * 60 * 60 * 1000).toISOString(),
    homeProbability: clampProbability(template.homeProb),
    drawProbability: clampProbability(template.drawProb),
    awayProbability: clampProbability(template.awayProb),
    note: template.note,
    venueCity: null,
    venueName: null,
    rainProbability: null,
    weatherCondition: null,
    weatherTempC: null,
    weatherTimezone: null,
    predictions: [],
    homeRecentMatches: [],
    awayRecentMatches: [],
    createdAt: now + index
  }));
}

export function loadPresentationMatches(): PresentationMatch[] {
  if (typeof window === "undefined") {
    return createDefaultMatches();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const defaults = createDefaultMatches();
    savePresentationMatches(defaults);
    return defaults;
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid storage payload");
    }
    const sanitized = parsed
      .map((item) => ensureMatch(item))
      .filter((match): match is PresentationMatch => Boolean(match));
    if (!sanitized.length) {
      const defaults = createDefaultMatches();
      savePresentationMatches(defaults);
      return defaults;
    }
    return sanitized;
  } catch {
    const defaults = createDefaultMatches();
    savePresentationMatches(defaults);
    return defaults;
  }
}

export function savePresentationMatches(matches: PresentationMatch[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
  window.localStorage.setItem(STORAGE_UPDATED_KEY, String(Date.now()));
}

export function getPresentationUpdatedAt(): number {
  if (typeof window === "undefined") {
    return Date.now();
  }
  const value = window.localStorage.getItem(STORAGE_UPDATED_KEY);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

export function generateMatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `match-${Math.random().toString(36).slice(2, 9)}`;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveProbability(
  remoteValue: number | null | undefined,
  previousValue: number | null | undefined,
  fallback: number
): number {
  if (typeof remoteValue === "number" && Number.isFinite(remoteValue)) {
    return clampProbability(remoteValue);
  }
  if (typeof previousValue === "number" && Number.isFinite(previousValue)) {
    return clampProbability(previousValue);
  }
  return clampProbability(fallback);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ensureMatch(value: unknown): PresentationMatch | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const homeLeague = normalizeLeague(value.homeLeague);
  const awayLeague = normalizeLeague(value.awayLeague);
  const homeClub =
    typeof value.homeClub === "string" && value.homeClub.trim() ? value.homeClub.trim() : null;
  const awayClub =
    typeof value.awayClub === "string" && value.awayClub.trim() ? value.awayClub.trim() : null;
  const kickoff = normalizeKickoff(value.kickoff);
  if (!homeLeague || !awayLeague || !homeClub || !awayClub || !kickoff) {
    return null;
  }

  const homeTeam =
    typeof value.homeTeam === "string" && value.homeTeam.trim()
      ? value.homeTeam.trim()
      : formatClubName(homeClub);
  const awayTeam =
    typeof value.awayTeam === "string" && value.awayTeam.trim()
      ? value.awayTeam.trim()
      : formatClubName(awayClub);

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : generateMatchId(),
    homeLeague,
    awayLeague,
    homeClub,
    awayClub,
    homeTeam,
    awayTeam,
    kickoff,
    homeProbability: clampProbability(Number(value.homeProbability)),
    drawProbability: clampProbability(Number(value.drawProbability)),
    awayProbability: clampProbability(Number(value.awayProbability)),
    note: typeof value.note === "string" && value.note.trim() ? value.note.trim() : undefined,
    createdAt: Number.isFinite(Number(value.createdAt))
      ? Number(value.createdAt)
      : Date.now()
    ,
    venueCity: typeof value.venueCity === "string" ? value.venueCity.trim() : null,
    venueName: typeof value.venueName === "string" ? value.venueName.trim() : null,
    rainProbability: normalizeNumber(value.rainProbability),
    weatherCondition: typeof value.weatherCondition === "string" ? value.weatherCondition.trim() : null,
    weatherTempC: normalizeNumber(value.weatherTempC),
    weatherTimezone: typeof value.weatherTimezone === "string" ? value.weatherTimezone.trim() : null,
    predictions: ensurePresentationPredictions(value.predictions),
    homeRecentMatches: ensureTeamMatchStats(value.homeRecentMatches),
    awayRecentMatches: ensureTeamMatchStats(value.awayRecentMatches)
  };
}

function normalizeLeague(value: unknown): MatchLeagueId | null {
  if (typeof value !== "string") {
    return null;
  }
  if (MATCH_LEAGUES.includes(value as MatchLeagueId)) {
    return value as MatchLeagueId;
  }
  return null;
}

function normalizeKickoff(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

const REMOTE_MATCH_PREFIX = "match-";
const DEFAULT_REMOTE_PROBABILITIES = { home: 51, draw: 25, away: 24 };

export type PresentationRemoteMatch = {
  id: number;
  home_team: string;
  away_team: string;
  home_club_id?: string | null;
  away_club_id?: string | null;
  league_id?: string | null;
  kickoff_at: string;
  note?: string | null;
  home_probability?: number | null;
  draw_probability?: number | null;
  away_probability?: number | null;
  venue_city?: string | null;
  venue_name?: string | null;
  rain_probability?: number | null;
  weather_condition?: string | null;
  weather_temp_c?: number | null;
  weather_timezone?: string | null;
  predictions?: PresentationRemotePrediction[];
  home_recent_matches?: TeamMatchStat[];
  away_recent_matches?: TeamMatchStat[];
};

type PresentationRemotePrediction = {
  home_pred?: number | null;
  away_pred?: number | null;
  points?: number | null;
  user?: {
    nickname?: string | null;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
};

export function mergePresentationMatches(
  existing: PresentationMatch[],
  remoteMatches: PresentationRemoteMatch[]
): PresentationMatch[] {
  const existingById = new Map<string, PresentationMatch>();
  existing.forEach((match) => existingById.set(match.id, match));

  const merged: PresentationMatch[] = remoteMatches.map((remote) => {
    const remoteId = buildRemoteMatchId(remote.id);
    const previous = existingById.get(remoteId) ?? null;
    return buildPresentationMatchFromRemote(remote, previous);
  });

  const extras = existing.filter((match) => !match.id.startsWith(REMOTE_MATCH_PREFIX));
  return [...merged, ...extras];
}

function buildPresentationMatchFromRemote(
  remote: PresentationRemoteMatch,
  previous: PresentationMatch | null
): PresentationMatch {
  const homeClub = deriveClubSlug(remote.home_club_id, remote.home_team);
  const awayClub = deriveClubSlug(remote.away_club_id, remote.away_team);
  const homeLeague = resolveRemoteLeague(remote.league_id ?? null, homeClub, awayClub) ?? previous?.homeLeague ?? MATCH_LEAGUES[0];
  const awayLeague =
    resolveRemoteLeague(remote.league_id ?? null, awayClub, homeClub) ?? previous?.awayLeague ?? homeLeague;
  const kickoff = normalizeKickoff(remote.kickoff_at) || previous?.kickoff || new Date().toISOString();
  const note = previous?.note ?? (typeof remote.note === "string" && remote.note.trim() ? remote.note.trim() : undefined);
  const homeTeam =
    typeof remote.home_team === "string" && remote.home_team.trim()
      ? remote.home_team.trim()
      : previous?.homeTeam ?? formatClubName(homeClub);
  const awayTeam =
    typeof remote.away_team === "string" && remote.away_team.trim()
      ? remote.away_team.trim()
      : previous?.awayTeam ?? formatClubName(awayClub);
  const remotePredictions = ensurePresentationPredictions(remote.predictions);
  const predictions = remotePredictions.length ? remotePredictions : previous?.predictions ?? [];
  const homeRecentMatches = ensureTeamMatchStats(remote.home_recent_matches ?? previous?.homeRecentMatches ?? []);
  const awayRecentMatches = ensureTeamMatchStats(remote.away_recent_matches ?? previous?.awayRecentMatches ?? []);

  return {
    id: buildRemoteMatchId(remote.id),
    homeLeague,
    awayLeague,
    homeClub,
    awayClub,
    homeTeam,
    awayTeam,
    kickoff,
    homeProbability: resolveProbability(
      remote.home_probability,
      previous?.homeProbability,
      DEFAULT_REMOTE_PROBABILITIES.home
    ),
    drawProbability: resolveProbability(
      remote.draw_probability,
      previous?.drawProbability,
      DEFAULT_REMOTE_PROBABILITIES.draw
    ),
    awayProbability: resolveProbability(
      remote.away_probability,
      previous?.awayProbability,
      DEFAULT_REMOTE_PROBABILITIES.away
    ),
    note,
    venueCity: typeof remote.venue_city === "string" ? remote.venue_city.trim() : null,
    venueName: typeof remote.venue_name === "string" ? remote.venue_name.trim() : null,
    rainProbability: normalizeNumber(remote.rain_probability),
    weatherCondition: typeof remote.weather_condition === "string" ? remote.weather_condition.trim() : null,
    weatherTempC: normalizeNumber(remote.weather_temp_c),
    weatherTimezone: typeof remote.weather_timezone === "string" ? remote.weather_timezone.trim() : null,
    predictions,
    homeRecentMatches,
    awayRecentMatches,
    createdAt: previous?.createdAt ?? Date.now()
  };
}

function resolveRemoteLeague(leagueId: string | null, primaryClub: string, secondaryClub: string): MatchLeagueId | null {
  const normalizedLeague = normalizeLeague(leagueId);
  if (normalizedLeague) {
    return normalizedLeague;
  }
  const candidate = primaryClub ? findClubLeague(primaryClub) : null;
  if (candidate) {
    return candidate;
  }
  if (secondaryClub) {
    const fallback = findClubLeague(secondaryClub);
    if (fallback) {
      return fallback;
    }
  }
  return null;
}

function buildRemoteMatchId(matchId: number): string {
  return `${REMOTE_MATCH_PREFIX}${matchId}`;
}

function deriveClubSlug(value: string | null | undefined, fallbackName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  const normalized = normalizeTeamSlugValue(fallbackName);
  return normalized || fallbackName;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function ensurePresentationPredictions(value: unknown): PresentationPrediction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }
      const home = normalizeNumber(item.home_pred);
      const away = normalizeNumber(item.away_pred);
      if (home === null || away === null) {
        return null;
      }
      return {
        home_pred: home,
        away_pred: away,
        points: normalizeNumber(item.points),
        user: ensurePredictionUser(item.user)
      };
    })
    .filter((entry): entry is PresentationPrediction => Boolean(entry));
}

function ensurePredictionUser(value: unknown): PresentationPredictionUser | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const user: PresentationPredictionUser = {
    nickname: typeof value.nickname === "string" ? value.nickname : undefined,
    username: typeof value.username === "string" ? value.username : undefined,
    first_name: typeof value.first_name === "string" ? value.first_name : undefined,
    last_name: typeof value.last_name === "string" ? value.last_name : undefined
  };
  if (user.nickname || user.username || user.first_name || user.last_name) {
    return user;
  }
  return null;
}

function ensureTeamMatchStats(value: unknown): TeamMatchStat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }
      const id =
        typeof item.id === "string"
          ? item.id
          : typeof item.id === "number"
            ? String(item.id)
            : null;
      const matchDate = typeof item.match_date === "string" ? item.match_date : null;
      if (!id || !matchDate) {
        return null;
      }
      return {
        id,
        team_name: typeof item.team_name === "string" ? item.team_name : "",
        opponent_name: typeof item.opponent_name === "string" ? item.opponent_name : "",
        match_date: matchDate,
        is_home: typeof item.is_home === "boolean" ? item.is_home : null,
        team_goals: item.team_goals ?? null,
        opponent_goals: item.opponent_goals ?? null,
        avg_rating: item.avg_rating ?? null
      };
    })
    .filter((entry): entry is TeamMatchStat => Boolean(entry));
}
