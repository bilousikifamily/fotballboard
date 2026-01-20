import { CLUB_REGISTRY, EU_CLUBS, type AllLeagueId, type LeagueId, type MatchLeagueId } from "../data/clubs";
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

export function resolveLogoLeagueId(leagueId: MatchLeagueId | null): AllLeagueId | null {
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
    case "uefa-champions-league":
    case "uefa-europa-league":
    case "uefa-europa-conference-league":
      return null;
  }
  return null;
}

export function getClubLogoPath(leagueId: string, clubId: string): string {
  return `/logos/football-logos/${leagueId}/${clubId}.png`;
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

export function getMatchTeamInfo(match: Match): {
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
} {
  const homeClubId = match.home_club_id ?? null;
  const awayClubId = match.away_club_id ?? null;
  const matchLeagueId = (match.league_id as MatchLeagueId | null) ?? null;
  const homeSlug = homeClubId ?? normalizeTeamSlugValue(match.home_team);
  const awaySlug = awayClubId ?? normalizeTeamSlugValue(match.away_team);
  const resolvedLeague =
    resolveLogoLeagueId(matchLeagueId) ||
    (homeSlug ? findClubLeague(homeSlug) : null) ||
    (awaySlug ? findClubLeague(awaySlug) : null);

  const homeName = homeSlug ? formatClubName(homeSlug) : match.home_team;
  const awayName = awaySlug ? formatClubName(awaySlug) : match.away_team;

  const homeLogo = homeSlug && resolvedLeague ? getClubLogoPath(resolvedLeague, homeSlug) : null;
  const awayLogo = awaySlug && resolvedLeague ? getClubLogoPath(resolvedLeague, awaySlug) : null;

  return { homeName, awayName, homeLogo, awayLogo };
}
