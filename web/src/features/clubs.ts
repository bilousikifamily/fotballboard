import {
  CLUB_REGISTRY,
  EU_CLUBS,
  type AllLeagueId,
  type LeagueId,
  type LogoLeagueId,
  type MatchLeagueId
} from "../data/clubs";
import type { Match } from "../types";
import { normalizeTeamSlugValue } from "./teamSlugs";

const CLUB_NAME_OVERRIDES: Record<string, string> = {
  "as-monaco": "AS Monaco",
  "as-saint-etienne": "AS Saint-Etienne",
  "fc-heidenheim": "FC Heidenheim",
  "le-havre-ac": "Le Havre AC",
  "mainz-05": "Mainz 05",
  "paris-saint-germain": "Paris Saint-Germain",
  "rc-lens": "RC Lens",
  "rc-strasbourg-alsace": "RC Strasbourg Alsace",
  "rb-leipzig": "RB Leipzig",
  "st-pauli": "St. Pauli",
  "vfb-stuttgart": "VfB Stuttgart",
  "vfl-bochum": "VfL Bochum",
  "lnz-cherkasy": "LNZ Cherkasy",
  "west-ham": "West Ham",
  "nottingham-forest": "Nottingham Forest"
};

export function formatClubName(slug: string): string {
  const override = CLUB_NAME_OVERRIDES[slug];
  if (override) {
    return override;
  }
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function isAllLeagueId(value: MatchLeagueId): value is AllLeagueId {
  return (
    value === "ukrainian-premier-league" ||
    value === "english-premier-league" ||
    value === "la-liga" ||
    value === "serie-a" ||
    value === "bundesliga" ||
    value === "ligue-1"
  );
}

export function resolveLogoLeagueId(leagueId: MatchLeagueId | null): LogoLeagueId | null {
  if (!leagueId) {
    return null;
  }
  if (isAllLeagueId(leagueId)) {
    return leagueId;
  }
  switch (leagueId) {
    case "fa-cup":
      return "english-premier-league";
    case "copa-del-rey":
      return "la-liga";
    case "coppa-italia":
      return "serie-a";
    case "dfb-pokal":
      return "bundesliga";
    case "coupe-de-france":
      return "ligue-1";
  }
  return null;
}

const UEFA_LOGO_LEAGUE_MAP: Record<MatchLeagueId, LogoLeagueId> = {
  "uefa-champions-league": "champions-league",
  "uefa-europa-league": "europa-league",
  "uefa-europa-conference-league": "conference-league"
};

const UEFA_LOGO_SLUGS: Record<MatchLeagueId, ReadonlySet<string>> = {
  "uefa-champions-league": new Set([
    "sporting",
    "benfica",
    "pafos",
    "slavia-praga",
    "bodo-glimt",
    "psv",
<<<<<<< HEAD
    "karabakh",
    "porto",
    "rangers",
    "feyenoord",
    "panathinaikos"
=======
    "kairat-almaty"
>>>>>>> bbafe59 (апдейт по клубам)
  ]),
  "uefa-europa-league": new Set(["fenerbahce", "young-boys"]),
  "uefa-europa-conference-league": new Set()
};

const UEFA_LOGO_SLUG_OVERRIDES: Partial<Record<MatchLeagueId, Record<string, LogoLeagueId>>> = {
  "uefa-europa-league": {
    "fenerbahce": "champions-league",
    "young-boys": "champions-league",
    "porto": "champions-league",
    "rangers": "champions-league",
    "feyenoord": "champions-league",
    "panathinaikos": "champions-league"
  }
};

function isUefaLogoSlug(slug: string): boolean {
  for (const set of Object.values(UEFA_LOGO_SLUGS)) {
    if (set.has(slug)) {
      return true;
    }
  }
  return false;
}

export function getChampionsClubLogo(slug: string | null): string | null {
  if (!slug || !isUefaLogoSlug(slug)) {
    return null;
  }
  return getClubLogoPath("champions-league", slug);
}

const CLUB_LOGO_FILE_OVERRIDES: Partial<Record<LogoLeagueId, Record<string, string>>> = {
  "la-liga": {
    "real-oviedo": "oviedo"
  },
  "champions-league": {
    "slavia-praga": "slavia",
    "kairat-almaty": "kairat"
  }
};

function getUefaLogoLeague(clubSlug: string | null, leagueId: MatchLeagueId | null): LogoLeagueId | null {
  if (!clubSlug || !leagueId) {
    return null;
  }
  const overrideLeague = UEFA_LOGO_SLUG_OVERRIDES[leagueId]?.[clubSlug];
  if (overrideLeague) {
    return overrideLeague;
  }
  const allowedSlugs = UEFA_LOGO_SLUGS[leagueId];
  if (!allowedSlugs || !allowedSlugs.has(clubSlug)) {
    return null;
  }
  return UEFA_LOGO_LEAGUE_MAP[leagueId] ?? null;
}

export function resolveTeamLogoLeague(clubSlug: string | null, leagueId: MatchLeagueId | null): LogoLeagueId | null {
  const resolvedLeague = resolveLogoLeagueId(leagueId);
  if (resolvedLeague) {
    return resolvedLeague;
  }
  const specialLeague = getUefaLogoLeague(clubSlug, leagueId);
  if (specialLeague) {
    return specialLeague;
  }
  if (!clubSlug) {
    return null;
  }
  return findClubLeague(clubSlug);
}

export function getClubLogoPath(leagueId: LogoLeagueId, clubId: string): string {
  const overrides = CLUB_LOGO_FILE_OVERRIDES[leagueId];
  const fileId = overrides?.[clubId] ?? clubId;
  return `/logos/football-logos/${leagueId}/${fileId}.png`;
}

export function getClassicoLogoSlug(choice: "real_madrid" | "barcelona" | null): string | null {
  if (choice === "real_madrid") {
    return "real-madrid";
  }
  if (choice === "barcelona") {
    return "barcelona";
  }
  return null;
}

export function getAvatarLogoPath(choice: string | null | undefined): string | null {
  if (!choice) {
    return null;
  }
  const match = /^([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(choice.trim());
  if (!match) {
    return null;
  }
  return getClubLogoPath(match[1], match[2]);
}

export function getUkrainianClubName(slug: string | null | undefined): string | null {
  if (!slug) {
    return null;
  }
  return UKRAINIAN_CLUB_NAMES[slug] ?? null;
}

export function findEuropeanClubLeague(clubId: string): LeagueId | null {
  const entries = Object.entries(EU_CLUBS) as Array<[LeagueId, string[]]>;
  for (const [leagueId, clubs] of entries) {
    if (clubs.includes(clubId)) {
      return leagueId;
    }
  }
  return null;
}

export function findClubLeague(clubId: string): AllLeagueId | null {
  return CLUB_REGISTRY[clubId]?.leagueId ?? null;
}

function deriveClubSlugFromName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeTeamSlugValue(value);
  if (!normalized) {
    return null;
  }
  if (CLUB_REGISTRY[normalized]) {
    return normalized;
  }
  if (isUefaLogoSlug(normalized)) {
    return normalized;
  }

  const segments = normalized.split("-").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  for (let length = segments.length; length > 0; length--) {
    for (let start = 0; start <= segments.length - length; start++) {
      const candidate = segments.slice(start, start + length).join("-");
      if (CLUB_REGISTRY[candidate]) {
        return candidate;
      }
    }
  }
  return null;
}

export function getMatchTeamInfo(match: Match): {
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeLogoFallback: string | null;
  awayLogoFallback: string | null;
  homeSlug: string | null;
  awaySlug: string | null;
} {
  const homeClubId = match.home_club_id ?? null;
  const awayClubId = match.away_club_id ?? null;
  const homeSlug = homeClubId ?? deriveClubSlugFromName(match.home_team);
  const awaySlug = awayClubId ?? deriveClubSlugFromName(match.away_team);
  const resolvedHomeSlug = homeSlug ?? null;
  const resolvedAwaySlug = awaySlug ?? null;
  const matchLeagueId = (match.league_id as MatchLeagueId | null) ?? null;
  const homeName = homeSlug ? formatClubName(homeSlug) : match.home_team;
  const awayName = awaySlug ? formatClubName(awaySlug) : match.away_team;

  const homeLogoLeague = resolveTeamLogoLeague(homeSlug, matchLeagueId);
  const awayLogoLeague = resolveTeamLogoLeague(awaySlug, matchLeagueId);
  const homeBaseLeague = homeSlug ? findClubLeague(homeSlug) : null;
  const awayBaseLeague = awaySlug ? findClubLeague(awaySlug) : null;
  const resolvedHomeLeague = homeLogoLeague ?? homeBaseLeague;
  const resolvedAwayLeague = awayLogoLeague ?? awayBaseLeague;
  const homeLogo = homeSlug && resolvedHomeLeague ? getClubLogoPath(resolvedHomeLeague, homeSlug) : null;
  const awayLogo = awaySlug && resolvedAwayLeague ? getClubLogoPath(resolvedAwayLeague, awaySlug) : null;
  const homeLogoFallback =
    homeSlug && homeBaseLeague && resolvedHomeLeague && resolvedHomeLeague !== homeBaseLeague
      ? getClubLogoPath(homeBaseLeague, homeSlug)
      : null;
  const awayLogoFallback =
    awaySlug && awayBaseLeague && resolvedAwayLeague && resolvedAwayLeague !== awayBaseLeague
      ? getClubLogoPath(awayBaseLeague, awaySlug)
      : null;

  return {
    homeName,
    awayName,
    homeLogo,
    awayLogo,
    homeLogoFallback,
    awayLogoFallback,
    homeSlug: resolvedHomeSlug,
    awaySlug: resolvedAwaySlug
  };
}
