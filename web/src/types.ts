export type AuthResponse =
  | {
      ok: true;
      user?: TelegramWebAppUser;
      admin?: boolean;
      points_total?: number;
      rank?: number | null;
      profile?: ProfileStatsPayload | null;
      onboarding?: OnboardingInfo | null;
    }
  | { ok: false; error: string };

export type LeaderboardResponse =
  | { ok: true; users: LeaderboardUser[] }
  | { ok: false; error: string };

export type MatchesResponse =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

export type PendingMatchesResponse =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

export type PredictionResponse =
  | { ok: true; prediction: unknown }
  | { ok: false; error: string };

export type PredictionsResponse =
  | { ok: true; predictions: PredictionView[] }
  | { ok: false; error: string };

export type MatchWeatherResponse =
  | {
      ok: true;
      rain_probability: number | null;
      weather_condition?: string | null;
      weather_temp_c?: number | null;
      weather_timezone?: string | null;
    }
  | { ok: false; error: string };

export type FactionEntry = {
  key: "faction_club_id";
  value: string;
  members: number;
  rank: number | null;
};

export type ProfileStatsPayload = {
  prediction: {
    total: number;
    hits: number;
    accuracy_pct: number;
    streak: number;
    last_results: Array<{ hit: boolean; points: number }>;
  };
  factions: FactionEntry[];
};

export type CreateMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

export type ConfirmMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

export type ResultResponse =
  | { ok: true }
  | { ok: false; error: string };

export type AnnouncementResponse =
  | { ok: true }
  | { ok: false; error: string };

export type AnalitikaItem = {
  id: number;
  cache_key: string;
  team_slug: string;
  data_type: string;
  league_id?: string | null;
  season?: number | null;
  payload: unknown;
  fetched_at: string;
  expires_at?: string | null;
};

export type AnalitikaResponse =
  | { ok: true; items: AnalitikaItem[] }
  | { ok: false; error: string };

export type AnalitikaRefreshResponse =
  | { ok: true; updated: number; warnings?: string[]; debug?: AnalitikaDebugInfo }
  | { ok: false; error: string; detail?: string; debug?: AnalitikaDebugInfo };

export type AnalitikaDebugInfo = {
  league_slug?: string;
  api_league_id?: number | null;
  season?: number | null;
  timezone?: string | null;
  teams?: Array<{ slug: string; name: string; team_id?: number | null }>;
  statuses?: {
    standings?: number;
    top_scorers?: number;
    top_assists?: number;
    head_to_head?: number;
    team_stats?: Record<string, number>;
  };
  counts?: {
    standings?: number;
    top_scorers?: number;
    top_assists?: number;
    head_to_head?: number;
    team_stats?: Record<string, number>;
  };
  samples?: {
    standings_teams?: Array<{ id: number | null; name: string }>;
  };
};

export type TeamMatchStat = {
  id: string;
  team_name: string;
  opponent_name: string;
  match_date: string;
  is_home?: boolean | null;
  team_goals?: number | string | null;
  opponent_goals?: number | string | null;
  avg_rating?: number | string | null;
};

export type TeamMatchStatsResponse =
  | { ok: true; items: TeamMatchStat[] }
  | { ok: false; error: string };

export type OddsRefreshResponse =
  | { ok: true; debug?: OddsRefreshDebug }
  | { ok: false; error: string; detail?: string; debug?: OddsRefreshDebug };

export type OddsRefreshDebug = {
  leagueId?: string | null;
  apiLeagueId?: number | null;
  kickoffAt?: string | null;
  season?: number;
  date?: string;
  timezone?: string;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
  homeTeamSource?: "search" | "cache" | "none";
  awayTeamSource?: "search" | "cache" | "none";
  homeTeamQuery?: string;
  awayTeamQuery?: string;
  homeTeamSearchStatus?: number;
  awayTeamSearchStatus?: number;
  homeTeamMatchedName?: string | null;
  awayTeamMatchedName?: string | null;
  homeTeamMatchScore?: number | null;
  awayTeamMatchScore?: number | null;
  homeTeamQueryAttempts?: string[];
  awayTeamQueryAttempts?: string[];
  homeTeamSearchAttempts?: number[];
  awayTeamSearchAttempts?: number[];
  homeTeamCandidates?: Array<{ id?: number; name?: string }>;
  awayTeamCandidates?: Array<{ id?: number; name?: string }>;
  headtoheadCount?: number;
  headtoheadStatus?: number;
  headtoheadSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueFixturesCount?: number;
  leagueFixturesSource?: "date" | "range" | "none" | "headtohead";
  leagueFixturesSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueDateStatus?: number;
  leagueRangeStatus?: number;
  fixtureId?: number | null;
  fallbackReason?: string;
};

export type LeaderboardUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  points_total?: number | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
};

export type Match = {
  id: number;
  home_team: string;
  away_team: string;
  league_id?: string | null;
  home_club_id?: string | null;
  away_club_id?: string | null;
  kickoff_at: string;
  status: string;
  home_score?: number | null;
  away_score?: number | null;
  venue_name?: string | null;
  venue_city?: string | null;
  venue_lat?: number | null;
  venue_lon?: number | null;
  tournament_name?: string | null;
  tournament_stage?: string | null;
  rain_probability?: number | null;
  weather_fetched_at?: string | null;
  weather_condition?: string | null;
  weather_temp_c?: number | null;
  weather_timezone?: string | null;
  odds_json?: unknown | null;
  odds_fetched_at?: string | null;
  has_prediction?: boolean;
  prediction_closes_at?: string | null;
};

export type PredictionUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  points_total?: number | null;
};

export type PredictionView = {
  id: number;
  user_id: number;
  home_pred: number;
  away_pred: number;
  points: number;
  user: PredictionUser | null;
};

export type UserStats = {
  rank: number | null;
  points: number;
};

export type OnboardingInfo = {
  faction_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  logo_order?: string[] | null;
  completed?: boolean;
};

export type LogoPosition = "center" | "left" | "right";

export type AvatarOption = {
  choice: string;
  name: string;
  logo: string;
};
