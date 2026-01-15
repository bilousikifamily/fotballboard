import { ALL_CLUBS, type MatchLeagueId } from "../data/clubs";

export const STORAGE_KEY = "presentation.matches";
export const STORAGE_UPDATED_KEY = "presentation.matches.updated";

export type PresentationMatch = {
  id: string;
  homeLeague: MatchLeagueId;
  awayLeague: MatchLeagueId;
  homeClub: string;
  awayClub: string;
  kickoff: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  note?: string;
  createdAt: number;
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
    kickoff: new Date(now + template.hoursFromNow * 60 * 60 * 1000).toISOString(),
    homeProbability: clampProbability(template.homeProb),
    drawProbability: clampProbability(template.drawProb),
    awayProbability: clampProbability(template.awayProb),
    note: template.note,
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

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id.trim() : generateMatchId(),
    homeLeague,
    awayLeague,
    homeClub,
    awayClub,
    kickoff,
    homeProbability: clampProbability(Number(value.homeProbability)),
    drawProbability: clampProbability(Number(value.drawProbability)),
    awayProbability: clampProbability(Number(value.awayProbability)),
    note: typeof value.note === "string" && value.note.trim() ? value.note.trim() : undefined,
    createdAt: Number.isFinite(Number(value.createdAt))
      ? Number(value.createdAt)
      : Date.now()
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
