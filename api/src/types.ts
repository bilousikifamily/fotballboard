export type AnalitikaDataType =
  | "team_stats"
  | "standings"
  | "standings_home_away"
  | "top_scorers"
  | "top_assists"
  | "head_to_head";

export type WeatherCacheEntry = {
  value: number | null;
  condition: string | null;
  tempC: number | null;
  timezone: string | null;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
  isError?: boolean;
  statusCode?: number | null;
};

export type OddsStoreFailure =
  | "missing_league_mapping"
  | "missing_timezone"
  | "bad_kickoff_date"
  | "team_not_found"
  | "fixture_not_found"
  | "api_error"
  | "odds_empty"
  | "db_error";

export type OddsDebugFixture = { id?: number; home?: string; away?: string; homeId?: number; awayId?: number };

export type OddsTeamSearchDetail = {
  query: string;
  status: number;
  candidates: string[];
};

export type OddsDebugInfo = {
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
  homeTeamSearchDetails?: OddsTeamSearchDetail[];
  awayTeamSearchDetails?: OddsTeamSearchDetail[];
  headtoheadCount?: number;
  headtoheadStatus?: number;
  headtoheadSample?: OddsDebugFixture[];
  leagueFixturesCount?: number;
  leagueFixturesSource?: "date" | "range" | "none" | "headtohead";
  leagueFixturesSample?: OddsDebugFixture[];
  leagueDateStatus?: number;
  leagueRangeStatus?: number;
  fixtureId?: number | null;
  fallbackReason?: string;
};

export type OddsStoreResult =
  | { ok: true; debug?: OddsDebugInfo }
  | { ok: false; reason: OddsStoreFailure; detail?: string; debug?: OddsDebugInfo };

export type OddsFetchResult =
  | { ok: true; odds: unknown }
  | { ok: false; reason: "api_error" | "odds_empty"; detail?: string };

export type OddsSaveResult =
  | { ok: true }
  | { ok: false; detail?: string };

export type VenueUpdate = {
  venue_name?: string | null;
  venue_city?: string | null;
  tournament_name?: string | null;
  tournament_stage?: string | null;
};

export type WeatherResult =
  | { ok: true; rainProbability: number | null; condition: string | null; tempC: number | null; timezone: string | null }
  | { ok: false; reason: "missing_location" | "bad_kickoff" | "api_error" | "rate_limited" };

export type WeatherDebugInfo = {
  venue_city?: string | null;
  venue_name?: string | null;
  venue_lat?: number | null;
  venue_lon?: number | null;
  kickoff_at?: string | null;
  rain_probability?: number | null;
  weather_fetched_at?: string | null;
  cache_used?: boolean;
  cache_age_min?: number | null;
  cache_state?: "fresh" | "stale" | "miss";
  weather_key?: string | null;
  is_stale?: boolean;
  rate_limited_locally?: boolean;
  retry_after_sec?: number | null;
  attempts?: number | null;
  status_code?: number | null;
  cooldown_until?: string | null;
  target_time?: string | null;
  date_string?: string | null;
  geocode_city?: string | null;
  geocode_ok?: boolean;
  geocode_status?: number | null;
  forecast_status?: number | null;
  time_index?: number | null;
};

export type FixturePayload = {
  fixture?: { id?: number; date?: string; venue?: { name?: string; city?: string } };
  league?: { id?: number; name?: string; round?: string };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
};

export type FixturesResult = {
  fixtures: FixturePayload[];
  source: "date" | "range" | "headtohead" | "none";
  dateStatus: number;
  rangeStatus?: number;
};

export type TeamPayload = { team?: { id?: number; name?: string } };

export type TeamsResult = {
  teams: TeamPayload[];
  status: number;
};

export type WeatherForecastResult = {
  ok: boolean;
  value: number | null;
  condition: string | null;
  tempC: number | null;
  timezone: string | null;
  cacheState: "fresh" | "stale" | "miss";
  isStale: boolean;
  rateLimitedLocally: boolean;
  key: string;
  provider: string;
  debug: WeatherFetchDebug;
  attempts?: number;
  retryAfterSec?: number | null;
  statusCode?: number | null;
  cooldownUntil?: string | null;
};

export type WeatherDetailedResult =
  | { ok: true; rainProbability: number | null; condition: string | null; tempC: number | null; timezone: string | null; debug: WeatherDebugInfo }
  | { ok: false; reason: "missing_location" | "bad_kickoff" | "api_error" | "rate_limited"; debug: WeatherDebugInfo };

export type GeocodeResult = { ok: true; lat: number; lon: number; status: number } | { ok: false; status: number };

export type WeatherFetchDebug = {
  target_time: string | null;
  date_string: string | null;
  forecast_status: number | null;
  time_index: number | null;
};

export type WeatherFetchResult =
  | {
      ok: true;
      value: number | null;
      condition: string | null;
      tempC: number | null;
      timezone: string | null;
      debug: WeatherFetchDebug;
      attempts: number;
      retryAfterSec?: number | null;
      status?: number | null;
    }
  | {
      ok: false;
      condition: string | null;
      tempC: number | null;
      timezone: string | null;
      debug: WeatherFetchDebug;
      attempts: number;
      retryAfterSec?: number | null;
      status?: number | null;
    };

export interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string;
  entities?: Array<{ type?: string; offset?: number; length?: number }>;
  from?: TelegramUser & { is_bot?: boolean };
  chat?: { id?: number; type?: string; title?: string; username?: string };
  message_thread_id?: number;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
}

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

export interface StoredUser {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  admin?: boolean | null;
  points_total?: number | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
  faction_club_id?: string | null;
  onboarding_completed_at?: string | null;
}

export interface UserStats {
  points_total: number;
  rank: number | null;
}

export type FactionKey = "faction_club_id";

export interface PredictionResult {
  hit: boolean;
  points: number;
}

export interface PredictionStats {
  total: number;
  hits: number;
  accuracy_pct: number;
  streak: number;
  last_results: PredictionResult[];
}

export interface FactionStat {
  key: FactionKey;
  value: string;
  members: number;
  rank: number | null;
}

export interface ProfileStats {
  prediction: PredictionStats;
  factions: FactionStat[];
}

export type FactionBranchSlug =
  | "real_madrid"
  | "barcelona"
  | "liverpool"
  | "arsenal"
  | "chelsea"
  | "milan"
  | "manchester-united";

export interface AnalitikaRefreshPayload {
  initData?: string;
  team?: string;
  debug?: boolean;
}

export interface AnalitikaTeam {
  slug: string;
  name: string;
  teamId: number;
}

export type AnalitikaPayload = Record<string, unknown> | { entries: Array<Record<string, unknown>> };

export type AnalitikaUpsert = {
  cache_key: string;
  team_slug: string;
  data_type: AnalitikaDataType;
  league_id: string;
  season: number;
  payload: AnalitikaPayload;
  fetched_at: string;
  expires_at: string | null;
};

export type AnalitikaDebugInfo = {
  league_slug: string;
  api_league_id: number | null;
  season: number | null;
  timezone: string | null;
  teams: Array<{ slug: string; name: string; team_id: number | null }>;
  statuses: {
    standings?: number;
    top_scorers?: number;
    top_assists?: number;
    head_to_head?: number;
    team_stats?: Record<string, number>;
  };
  counts: {
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

export type AnalitikaStaticRow = {
  key: string;
  payload: unknown;
  fetched_at: string;
  expires_at?: string | null;
};

export interface CreateMatchPayload {
  initData?: string;
  home_team?: string;
  away_team?: string;
  league_id?: string;
  home_club_id?: string;
  away_club_id?: string;
  kickoff_at?: string;
}

export interface PredictionPayload {
  initData?: string;
  match_id: number | string;
  home_pred: number | string;
  away_pred: number | string;
}

export interface MatchResultPayload {
  initData?: string;
  match_id: number | string;
  home_score: number | string;
  away_score: number | string;
  home_avg_rating?: number | string;
  away_avg_rating?: number | string;
}

export interface MatchConfirmPayload {
  initData?: string;
  match_id: number | string;
}

export interface AnnouncementPayload {
  initData?: string;
}

export interface DbMatch {
  id: number;
  home_team: string;
  away_team: string;
  league_id?: string | null;
  home_club_id?: string | null;
  away_club_id?: string | null;
  kickoff_at: string;
  status: string;
  start_digest_sent_at?: string | null;
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
  reminder_sent_at?: string | null;
  api_league_id?: number | null;
  api_fixture_id?: number | null;
  odds_json?: unknown | null;
  odds_fetched_at?: string | null;
  has_prediction?: boolean;
}

export interface DbAnalitika {
  id: number;
  cache_key: string;
  team_slug: string;
  data_type: string;
  league_id?: string | null;
  season?: number | null;
  payload: unknown;
  fetched_at: string;
  expires_at?: string | null;
}

export interface DbTeamMatchStat {
  id: string;
  team_name: string;
  opponent_name: string;
  match_date: string;
  is_home?: boolean | null;
  team_goals?: number | string | null;
  opponent_goals?: number | string | null;
  avg_rating?: number | string | null;
}

export interface DbPrediction {
  id: number;
  user_id: number;
  match_id: number;
  home_pred: number;
  away_pred: number;
  points?: number | null;
}

export interface PredictionRow {
  id: number;
  user_id: number;
  home_pred: number;
  away_pred: number;
  points?: number | null;
  created_at?: string | null;
  users?: {
    id: number;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    photo_url?: string | null;
    nickname?: string | null;
    points_total?: number | null;
  } | null;
}

export interface PredictionView {
  id: number;
  user_id: number;
  home_pred: number;
  away_pred: number;
  points: number;
  user: {
    id: number;
    username?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    photo_url?: string | null;
    nickname?: string | null;
    points_total?: number | null;
  } | null;
}

export interface UserOnboarding {
  faction_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  completed: boolean;
}

export interface UserOnboardingRow {
  faction_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  onboarding_completed_at?: string | null;
}

export interface OnboardingPayload {
  initData?: string;
  faction_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
}

export interface AvatarPayload {
  initData?: string;
  avatar_choice?: string | null;
}

export interface NicknamePayload {
  initData?: string;
  nickname?: string | null;
}

export interface MatchResultNotification {
  user_id: number;
  delta: number;
  total_points: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  prediction_stats: MatchResultPredictionStats;
}

export interface MatchResultExactGuessUser {
  user_id: number;
  nickname?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  faction_club_id?: string | null;
}

export interface MatchResultPredictionStats {
  total_predictions: number;
  result_support_percent: number;
  exact_guessers: MatchResultExactGuessUser[];
}

export interface MatchResultOutcome {
  ok: boolean;
  notifications: MatchResultNotification[];
}

export interface PredictionReminderMatch {
  id: number;
  home_team: string;
  away_team: string;
  home_club_id?: string | null;
  away_club_id?: string | null;
  kickoff_at: string;
}

export interface WeatherRefreshMatch {
  id: number;
  kickoff_at: string;
  venue_name?: string | null;
  venue_city?: string | null;
  venue_lat?: number | null;
  venue_lon?: number | null;
  rain_probability?: number | null;
  weather_fetched_at?: string | null;
  weather_condition?: string | null;
  weather_temp_c?: number | null;
  weather_timezone?: string | null;
}
