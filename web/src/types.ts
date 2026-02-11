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

export type AdminLoginResponse =
  | { ok: true; token: string }
  | { ok: false; error: string };

export type BotLogEntry = {
  id: number;
  chat_id: number | null;
  thread_id: number | null;
  message_id: number | null;
  user_id: number | null;
  text: string | null;
  created_at: string | null;
};

export type BotLogsResponse =
  | { ok: true; logs: BotLogEntry[] }
  | { ok: false; error: string };

export type AdminChatThread = {
  user_id: number | null;
  chat_id: number | null;
  direction: string | null;
  sender: string | null;
  message_type: string | null;
  last_text: string | null;
  last_message_at: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  photo_url?: string | null;
  last_seen_at?: string | null;
};

export type AdminChatMessage = {
  id: number;
  chat_id: number | null;
  user_id: number | null;
  user_nickname?: string | null;
  admin_id: string | null;
  thread_id: number | null;
  message_id: number | null;
  direction: "in" | "out";
  sender: "bot" | "admin" | "user";
  message_type: string;
  text: string | null;
  delivery_status?: string | null;
  error_code?: number | null;
  http_status?: number | null;
  error_message?: string | null;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};

export type AdminChatThreadsResponse =
  | { ok: true; threads: AdminChatThread[] }
  | { ok: false; error: string };

export type AdminChatMessagesResponse =
  | { ok: true; messages: AdminChatMessage[] }
  | { ok: false; error: string };

export type AdminChatSendResponse =
  | { ok: true }
  | { ok: false; error: string };

export type PredictionAccuracyMatch = {
  match_id: number;
  home_team: string;
  away_team: string;
  league_id?: string | null;
  home_club_id?: string | null;
  away_club_id?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  kickoff_at: string;
  total_predictions: number;
  hits: number;
  accuracy_pct: number;
  avg_home_pred: number;
  avg_away_pred: number;
};

export type PredictionAccuracyUser = {
  user_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  photo_url?: string | null;
  avatar_choice?: string | null;
  total_predictions: number;
  hits: number;
  accuracy_pct: number;
};

export type PredictionAccuracyResponse =
  | { ok: true; matches: PredictionAccuracyMatch[]; users: PredictionAccuracyUser[] }
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

export type FactionBranchSlug =
  | "real_madrid"
  | "barcelona"
  | "atletico-madrid"
  | "bayern-munchen"
  | "borussia-dortmund"
  | "chelsea"
  | "manchester-city"
  | "liverpool"
  | "arsenal"
  | "manchester-united"
  | "paris-saint-germain"
  | "milan"
  | "juventus"
  | "inter"
  | "napoli"
  | "dynamo-kyiv"
  | "shakhtar";

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

export type ChannelWebappResponse =
  | { ok: true }
  | { ok: false; error: string; status?: number; body?: string };

export type MatchResultNotifyResponse =
  | { ok: true; count: number }
  | { ok: false; error: string };

export type ManualOddsResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

export type FactionPredictionsStatsResponse =
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

export type ClubSyncResponse =
  | {
      ok: true;
      updated: number;
      teams_total: number;
      league_id?: string | null;
      api_league_id?: number | null;
      season?: number | null;
    }
  | { ok: false; error: string; detail?: string };

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

export type OddsTeamSearchDetail = {
  query: string;
  status: number;
  candidates: string[];
};

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
  homeClubId?: string | null;
  awayClubId?: string | null;
  homeTeamNormalized?: string | null;
  awayTeamNormalized?: string | null;
  homeTeamKnownId?: number | null;
  awayTeamKnownId?: number | null;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
  homeTeamSource?: "search" | "cache" | "db" | "none";
  awayTeamSource?: "search" | "cache" | "db" | "none";
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
  headtoheadSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueFixturesCount?: number;
  leagueFixturesSource?: "date" | "range" | "none" | "headtohead";
  leagueFixturesSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueDateStatus?: number;
  leagueRangeStatus?: number;
  fixtureId?: number | null;
  fallbackReason?: string;
  teamFixturesCount?: number;
  teamFixturesSource?: "team_home" | "team_away";
  teamFixturesStatus?: number;
  teamFixturesSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
};

export type LeaderboardUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  faction_club_id?: string | null;
  points_total?: number | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
};

export type FactionMember = Pick<
  LeaderboardUser,
  "id" | "username" | "first_name" | "last_name" | "nickname" | "points_total" | "photo_url" | "avatar_choice"
>;

export type FactionMembersResponse =
  | { ok: true; faction: string | null; members: FactionMember[]; faction_rank?: number | null }
  | { ok: false; error: string };

export type FactionChatPreviewMessage = {
  id: number;
  faction: FactionBranchSlug;
  text: string;
  nickname: string | null;
  author: string | null;
  created_at: string;
};

export type FactionChatPreviewResponse =
  | {
      ok: true;
      faction: FactionBranchSlug;
      messages: FactionChatPreviewMessage[];
    }
  | { ok: false; error: string };

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
  odds_json?: unknown | null;
  odds_fetched_at?: string | null;
  odds_manual_home?: number | null;
  odds_manual_draw?: number | null;
  odds_manual_away?: number | null;
  odds_manual_updated_at?: string | null;
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
  faction_club_id?: string | null;
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
  completed?: boolean;
};

export type AvatarOption = {
  choice: string;
  name: string;
  logo: string;
};
