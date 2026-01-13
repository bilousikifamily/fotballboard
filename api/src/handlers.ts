import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";
import type {
  AnalitikaDataType,
  AnalitikaDebugInfo,
  AnalitikaPayload,
  AnalitikaRefreshPayload,
  AnalitikaStaticRow,
  AnalitikaTeam,
  AnalitikaUpsert,
  AnnouncementPayload,
  AvatarPayload,
  CreateMatchPayload,
  DbAnalitika,
  DbMatch,
  DbPrediction,
  DbTeamMatchStat,
  FactionKey,
  FactionStat,
  FixturePayload,
  FixturesResult,
  GeocodeResult,
  MatchResultNotification,
  MatchResultOutcome,
  MatchResultPayload,
  MatchConfirmPayload,
  NicknamePayload,
  OddsDebugInfo,
  OddsDebugFixture,
  OddsFetchResult,
  OddsSaveResult,
  OddsStoreFailure,
  OddsStoreResult,
  OnboardingPayload,
  PredictionPayload,
  PredictionReminderMatch,
  PredictionResult,
  PredictionRow,
  PredictionStats,
  PredictionView,
  ProfileStats,
  StoredUser,
  TeamPayload,
  TeamsResult,
  TelegramUser,
  TelegramUpdate,
  TelegramMessage,
  UserOnboarding,
  UserOnboardingRow,
  UserStats,
  VenueUpdate,
  WeatherCacheEntry,
  WeatherDebugInfo,
  WeatherDetailedResult,
  WeatherFetchDebug,
  WeatherFetchResult,
  WeatherForecastResult,
  WeatherRefreshMatch,
  WeatherResult
} from "./types";
import { authenticateInitData, getInitDataFromHeaders, validateInitData } from "./auth";
import { corsHeaders, corsResponse, jsonResponse, readJson } from "./http";
import { UKRAINIAN_CLUB_NAMES } from "./data/clubNamesUk";
import {
  buildApiPath,
  fetchApiFootball,
  getApiFootballBase,
  getApiFootballTimezone,
  logFixturesFallback,
  logFixturesSearch
} from "./services/apiFootball";
import { deleteMessage, getUpdateMessage, handleUpdate, sendMessage, sendPhoto } from "./services/telegram";
import { TEAM_SLUG_ALIASES } from "../../shared/teamSlugAliases";

const STARTING_POINTS = 100;
const PREDICTION_CUTOFF_MS = 0;
const PREDICTION_REMINDER_BEFORE_CLOSE_MS = 60 * 60 * 1000;
const PREDICTION_REMINDER_WINDOW_MS = 15 * 60 * 1000;
const MISSED_PREDICTION_PENALTY = -1;
const MATCHES_ANNOUNCEMENT_MESSAGE = "На тебе вже чекають прогнози на сьогоднішні матчі.";
const TEAM_ID_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ANALITIKA_LEAGUE_ID = "english-premier-league";
const ANALITIKA_HEAD_TO_HEAD_LIMIT = 10;
const ANALITIKA_STATIC_TTL_DAYS = 365;
const TEAM_SEARCH_ALIASES: Record<string, string> = {
  inter: "Inter Milan",
  milan: "AC Milan"
};
const TEAM_MATCH_ALIASES: Record<string, string> = {
  inter: "intermilan",
  milan: "acmilan"
};

const teamIdCache = new Map<string, { id: number; name: string; updatedAt: number }>();
const WEATHER_PROVIDER_PRIMARY = "open-meteo";
const WEATHER_PROVIDER_FALLBACK = "weatherapi";
const WEATHER_UNITS = "metric";
const WEATHER_LANG = "uk";
const WEATHER_DB_REFRESH_MIN = 60;
const WEATHER_DB_LOOKAHEAD_HOURS = 24;
const WEATHER_DB_REFRESH_LIMIT = 24;

const ANALITIKA_TEAMS = [
  { slug: "arsenal", name: "Arsenal" },
  { slug: "barcelona", name: "Barcelona" },
  { slug: "chelsea", name: "Chelsea" },
  { slug: "fiorentina", name: "Fiorentina" },
  { slug: "inter", name: "Inter" },
  { slug: "leeds", name: "Leeds" },
  { slug: "liverpool", name: "Liverpool" },
  { slug: "manchester-city", name: "Manchester City" },
  { slug: "manchester-united", name: "Manchester United" },
  { slug: "milan", name: "Milan" },
  { slug: "napoli", name: "Napoli" },
  { slug: "newcastle", name: "Newcastle" },
  { slug: "real-madrid", name: "Real Madrid" }
];

const weatherCache = new Map<string, WeatherCacheEntry>();
const weatherInFlight = new Map<string, Promise<WeatherFetchResult>>();
const weatherRateLimiter = createRateLimiter();
const weatherCooldownUntilMs = new Map<string, number>();

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function logFixturesSearch(env: Env, payload: {
  source: string;
  path: string;
  params: Record<string, string | number | undefined>;
  fixturesCount: number;
  reason?: string;
}): void {
  const url = `${getApiFootballBase(env)}${payload.path}`;
  const params = Object.entries(payload.params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const reason = payload.reason ? ` reason=${payload.reason}` : "";
  console.info(`fixtures.search source=${payload.source} url=${url} ${params} result.fixtures=${payload.fixturesCount}${reason}`);
}

function logFixturesFallback(reason: string, context: Record<string, string | number | undefined>): void {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`fixtures.fallback reason=${reason} ${details}`);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthcheck") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/auth") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const body = await readJson<{ initData?: string }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const initData = body?.initData?.trim();
      if (!initData) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const valid = await validateInitData(initData, env.BOT_TOKEN);
      if (!valid.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      let isAdmin = false;
      let stats: UserStats | null = null;
      let profileStats: ProfileStats | null = null;
      let onboarding: UserOnboarding | null = null;
      if (valid.user) {
        await storeUser(supabase, valid.user, { markLastSeen: true });
        if (supabase) {
          isAdmin = await checkAdmin(supabase, valid.user.id);
          stats = await getUserStats(supabase, valid.user.id);
          profileStats = await getProfileStats(supabase, valid.user.id);
          onboarding = await getUserOnboarding(supabase, valid.user.id);
        }
      }

      return jsonResponse(
        {
          ok: true,
          user: valid.user,
          admin: isAdmin,
          points_total: stats?.points_total ?? STARTING_POINTS,
          rank: stats?.rank ?? null,
          profile: profileStats,
          onboarding
        },
        200,
        corsHeaders()
      );
    }

    if (url.pathname === "/api/onboarding") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<OnboardingPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const nickname = normalizeNickname(body.nickname);
      if (!nickname) {
        return jsonResponse({ ok: false, error: "bad_nickname" }, 400, corsHeaders());
      }

      const classicoChoice = normalizeClassicoChoice(body.classico_choice);
      if (body.classico_choice !== undefined && body.classico_choice !== null && classicoChoice === null) {
        return jsonResponse({ ok: false, error: "bad_classico_choice" }, 400, corsHeaders());
      }

      const uaClubId = normalizeClubId(body.ua_club_id);
      if (body.ua_club_id !== undefined && body.ua_club_id !== null && uaClubId === null) {
        return jsonResponse({ ok: false, error: "bad_ua_club" }, 400, corsHeaders());
      }

      const euClubId = normalizeClubId(body.eu_club_id);
      if (body.eu_club_id !== undefined && body.eu_club_id !== null && euClubId === null) {
        return jsonResponse({ ok: false, error: "bad_eu_club" }, 400, corsHeaders());
      }

      const avatarChoice = normalizeAvatarChoice(body.avatar_choice);
      if (body.avatar_choice !== undefined && body.avatar_choice !== null && body.avatar_choice !== "" && avatarChoice === null) {
        return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
      }

      const onboardingSelections = { classicoChoice, uaClubId, euClubId };
      if (avatarChoice && !isAvatarChoiceAllowed(avatarChoice, onboardingSelections)) {
        return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
      }

      let logoOrder: string[] | null = null;
      if (body.logo_order !== undefined) {
        logoOrder = normalizeLogoOrder(body.logo_order, onboardingSelections);
        if (!logoOrder) {
          return jsonResponse({ ok: false, error: "bad_logo_order" }, 400, corsHeaders());
        }
        if (logoOrder.length !== getExpectedLogoCount(onboardingSelections)) {
          return jsonResponse({ ok: false, error: "bad_logo_order" }, 400, corsHeaders());
        }
      }

      const saved = await saveUserOnboarding(supabase, auth.user.id, {
        classico_choice: classicoChoice,
        ua_club_id: uaClubId,
        eu_club_id: euClubId,
        nickname,
        avatar_choice: avatarChoice,
        logo_order: logoOrder
      });
      if (!saved) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/avatar") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<AvatarPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const avatarChoice = normalizeAvatarChoice(body.avatar_choice);
      if (body.avatar_choice !== undefined && body.avatar_choice !== null && body.avatar_choice !== "" && avatarChoice === null) {
        return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
      }

      if (avatarChoice) {
        const onboarding = await getUserOnboarding(supabase, auth.user.id);
        if (!onboarding) {
          return jsonResponse({ ok: false, error: "user_not_found" }, 404, corsHeaders());
        }

        if (
          !isAvatarChoiceAllowed(avatarChoice, {
            classicoChoice: onboarding.classico_choice ?? null,
            uaClubId: onboarding.ua_club_id ?? null,
            euClubId: onboarding.eu_club_id ?? null
          })
        ) {
          return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
        }
      }

      const saved = await saveUserAvatarChoice(supabase, auth.user.id, avatarChoice);
      if (!saved) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/logo-order") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<LogoOrderPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const onboarding = await getUserOnboarding(supabase, auth.user.id);
      if (!onboarding) {
        return jsonResponse({ ok: false, error: "user_not_found" }, 404, corsHeaders());
      }

      const onboardingSelections = {
        classicoChoice: onboarding.classico_choice ?? null,
        uaClubId: onboarding.ua_club_id ?? null,
        euClubId: onboarding.eu_club_id ?? null
      };
      const logoOrder = normalizeLogoOrder(body.logo_order, onboardingSelections);
      if (!logoOrder) {
        return jsonResponse({ ok: false, error: "bad_logo_order" }, 400, corsHeaders());
      }
      if (logoOrder.length !== getExpectedLogoCount(onboardingSelections)) {
        return jsonResponse({ ok: false, error: "bad_logo_order" }, 400, corsHeaders());
      }

      const saved = await saveUserLogoOrder(supabase, auth.user.id, logoOrder);
      if (!saved) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/nickname") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<NicknamePayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const nickname = normalizeNickname(body.nickname);
      if (!nickname) {
        return jsonResponse({ ok: false, error: "bad_nickname" }, 400, corsHeaders());
      }

      const saved = await saveUserNickname(supabase, auth.user.id, nickname);
      if (!saved) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/leaderboard" || url.pathname === "/api/users") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const initData = getInitDataFromHeaders(request);
      const auth = await authenticateInitData(initData, env.BOT_TOKEN);
      if (!auth.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      if (auth.user) {
        await storeUser(supabase, auth.user);
      }

      const limit = parseLimit(url.searchParams.get("limit"), 10, 200);
      const users = await listLeaderboard(supabase, limit);
      if (!users) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, users }, 200, corsHeaders());
    }

    if (url.pathname === "/api/analitika") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const initData = getInitDataFromHeaders(request);
      const auth = await authenticateInitData(initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const teamSlug = normalizeTeamSlug(url.searchParams.get("team"));
      const team = resolveTeamMatchStatsTeam(teamSlug);
      if (!team) {
        return jsonResponse({ ok: false, error: "bad_team" }, 400, corsHeaders());
      }

      const limit = 5;
      const items = await listTeamMatchStats(supabase, team.name, limit);
      if (!items) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, items }, 200, corsHeaders());
    }

    if (url.pathname === "/api/analitika/refresh") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      return jsonResponse({ ok: false, error: "disabled" }, 410, corsHeaders());
    }

    if (url.pathname === "/api/matches") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      if (request.method === "GET") {
        const initData = getInitDataFromHeaders(request);
        const auth = await authenticateInitData(initData, env.BOT_TOKEN);
        if (!auth.ok) {
          return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
        }

        if (auth.user) {
          await storeUser(supabase, auth.user);
        }

        const date = url.searchParams.get("date") || undefined;
        const matches = await listMatches(supabase, date);
        if (!matches) {
          return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
        }

      let matchesWithPrediction = matches;
      if (auth.user && matches.length) {
        const predicted = await listUserPredictedMatches(
          supabase,
          auth.user.id,
          matches.map((match) => match.id)
        );
        matchesWithPrediction = matches.map((match) => ({
          ...match,
          has_prediction: predicted.has(match.id)
        }));
      }

      const matchesWithCountdown = matchesWithPrediction.map((match) => ({
        ...match,
        prediction_closes_at: getPredictionCloseAt(match.kickoff_at)
      }));

      return jsonResponse({ ok: true, matches: matchesWithCountdown }, 200, corsHeaders());
    }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const body = await readJson<CreateMatchPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      const match = await createMatch(supabase, auth.user.id, body);
      if (!match) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      if (env.API_FOOTBALL_KEY && match.status === "scheduled") {
        ctx.waitUntil(fetchAndStoreOdds(env, supabase, match));
      }

      return jsonResponse({ ok: true, match }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/pending") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const initData = getInitDataFromHeaders(request);
      const auth = await authenticateInitData(initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      const matches = await listPendingMatches(supabase);
      if (!matches) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, matches }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/confirm") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<MatchConfirmPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      const matchId = parseInteger(body.match_id);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const match = await getMatch(supabase, matchId);
      if (!match) {
        return jsonResponse({ ok: false, error: "match_not_found" }, 404, corsHeaders());
      }

      if (match.status !== "pending") {
        return jsonResponse({ ok: false, error: "match_not_pending" }, 409, corsHeaders());
      }

      const { data, error } = await supabase
        .from("matches")
        .update({ status: "scheduled" })
        .eq("id", matchId)
        .select(
          "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at"
        )
        .single();
      if (error || !data) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      const confirmedMatch = data as DbMatch;
      if (env.API_FOOTBALL_KEY) {
        ctx.waitUntil(fetchAndStoreOdds(env, supabase, confirmedMatch));
      }

      return jsonResponse({ ok: true, match: confirmedMatch }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/odds") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<{ initData?: string; match_id?: number | string; debug?: boolean }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      if (!env.API_FOOTBALL_KEY) {
        return jsonResponse({ ok: false, error: "missing_api_key" }, 500, corsHeaders());
      }

      const matchId = parseInteger(body.match_id);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const match = await getMatch(supabase, matchId);
      if (!match) {
        return jsonResponse({ ok: false, error: "match_not_found" }, 404, corsHeaders());
      }

      const oddsResult = await fetchAndStoreOdds(env, supabase, match, { debug: body.debug === true });
      if (!oddsResult.ok) {
        return jsonResponse(
          { ok: false, error: oddsResult.reason, detail: oddsResult.detail, debug: oddsResult.debug },
          200,
          corsHeaders()
        );
      }
      return jsonResponse({ ok: true, debug: oddsResult.debug }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/weather") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const initDataHeader = getInitDataFromHeaders(request);
      const auth = await authenticateInitData(initDataHeader, env.BOT_TOKEN);
      if (!auth.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const matchIdParam = url.searchParams.get("match_id");
      const matchId = parseInteger(matchIdParam);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const match = await getMatch(supabase, matchId);
      if (!match) {
        return jsonResponse({ ok: false, error: "match_not_found" }, 404, corsHeaders());
      }

      const debug = url.searchParams.get("debug") === "1";
      const weather = await fetchMatchWeatherDetailed(env, supabase, match);
      if (!weather.ok) {
        return jsonResponse(
          debug
            ? { ok: false, error: weather.reason, debug: weather.debug }
            : { ok: false, error: weather.reason },
          200,
          corsHeaders()
        );
      }

      return jsonResponse(
        debug
          ? {
              ok: true,
              rain_probability: weather.rainProbability,
              weather_condition: weather.condition ?? null,
              weather_temp_c: weather.tempC ?? null,
              weather_timezone: weather.timezone ?? null,
              debug: weather.debug
            }
          : {
              ok: true,
              rain_probability: weather.rainProbability,
              weather_condition: weather.condition ?? null,
              weather_temp_c: weather.tempC ?? null,
              weather_timezone: weather.timezone ?? null
            },
        200,
        corsHeaders()
      );
    }

    if (url.pathname === "/api/predictions") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      if (request.method === "GET") {
        const initDataHeader = getInitDataFromHeaders(request);
        const auth = await authenticateInitData(initDataHeader, env.BOT_TOKEN);
        if (!auth.ok) {
          return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
        }

        const matchIdParam = url.searchParams.get("match_id");
        const matchId = parseInteger(matchIdParam);
        if (matchId === null) {
          return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
        }

        const predictions = await listPredictions(supabase, matchId);
        if (!predictions) {
          return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
        }

        return jsonResponse({ ok: true, predictions }, 200, corsHeaders());
      }

      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const body = await readJson<PredictionPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const matchId = parseInteger(body.match_id);
      if (!matchId) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const match = await getMatch(supabase, matchId);
      if (!match) {
        return jsonResponse({ ok: false, error: "match_not_found" }, 404, corsHeaders());
      }

      if (match.status === "finished") {
        return jsonResponse({ ok: false, error: "match_finished" }, 400, corsHeaders());
      }
      if (match.status !== "scheduled") {
        return jsonResponse({ ok: false, error: "match_not_ready" }, 400, corsHeaders());
      }

      if (!canPredict(match.kickoff_at)) {
        return jsonResponse({ ok: false, error: "prediction_closed" }, 400, corsHeaders());
      }

      const existing = await findPrediction(supabase, auth.user.id, matchId);
      if (existing) {
        return jsonResponse({ ok: false, error: "already_predicted" }, 409, corsHeaders());
      }

      const prediction = await insertPrediction(supabase, auth.user.id, matchId, body);
      if (!prediction) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, prediction }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/result") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<MatchResultPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      const matchId = parseInteger(body.match_id);
      const homeScore = parseInteger(body.home_score);
      const awayScore = parseInteger(body.away_score);
      const homeRating = parseRating(body.home_avg_rating);
      const awayRating = parseRating(body.away_avg_rating);
      if (matchId === null || homeScore === null || awayScore === null) {
        return jsonResponse({ ok: false, error: "bad_score" }, 400, corsHeaders());
      }
      if (homeRating === null || awayRating === null) {
        return jsonResponse({ ok: false, error: "bad_rating" }, 400, corsHeaders());
      }

      const result = await applyMatchResult(supabase, matchId, homeScore, awayScore, homeRating, awayRating);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      if (result.notifications.length) {
        await notifyUsersAboutMatchResult(env, result.notifications);
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/matches/announcement") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      const body = await readJson<AnnouncementPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const auth = await authenticateInitData(body.initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);
      const isAdmin = await checkAdmin(supabase, auth.user.id);
      if (!isAdmin) {
        return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
      }

      const users = await listAllUserIds(supabase);
      if (!users) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      for (const user of users) {
        await sendPhoto(
          env,
          user.id,
          buildWebappImageUrl(env, "new_predictions.png"),
          MATCHES_ANNOUNCEMENT_MESSAGE,
          {
            inline_keyboard: [[{ text: "ПРОГОЛОСУВАТИ", web_app: { url: env.WEBAPP_URL } }]]
          }
        );
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/tg/webhook") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const update = await readJson<TelegramUpdate>(request);
      if (!update) {
        return new Response("Bad Request", { status: 400 });
      }

      const message = getUpdateMessage(update);
      if (message) {
        const supabase = createSupabaseClient(env);
        await handleFactionChatModeration(message, env, supabase);
      }

      await handleUpdate(update, env);
      return new Response("ok");
    }

    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handlePredictionReminders(env));
    ctx.waitUntil(handleWeatherRefresh(env));
  }
};

function createSupabaseClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "tg-webapp-worker" } }
  });
}

type FactionChatRef = {
  chatId?: number;
  chatUsername?: string;
  threadId?: number | null;
  label: string;
};

type FactionChatRefs = {
  real?: FactionChatRef;
  barca?: FactionChatRef;
  general?: FactionChatRef;
};

function parseChatRef(value: string | undefined, label: string): FactionChatRef | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/^https?:\/\//, "").replace(/^@/, "");
  const numericThreadMatch = normalized.match(/^t\.me\/(-?\d+)\/(\d+)$/i) ?? normalized.match(/^(-?\d+)\/(\d+)$/);
  if (numericThreadMatch) {
    const rawChatId = numericThreadMatch[1];
    const threadId = Number(numericThreadMatch[2]);
    const chatId =
      rawChatId.startsWith("-100") || rawChatId.startsWith("-")
        ? Number(rawChatId)
        : Number(`-100${rawChatId}`);
    return {
      chatId,
      threadId: Number.isFinite(threadId) ? threadId : null,
      label
    };
  }

  if (/^-?\d+$/.test(raw)) {
    return { chatId: Number(raw), threadId: null, label };
  }
  const privateMatch = normalized.match(/^t\.me\/c\/(\d+)(?:\/(\d+))?/i);
  if (privateMatch) {
    const internalId = privateMatch[1];
    const threadId = privateMatch[2] ? Number(privateMatch[2]) : null;
    return {
      chatId: Number(`-100${internalId}`),
      threadId: Number.isFinite(threadId ?? NaN) ? threadId : null,
      label
    };
  }

  const publicMatch = normalized.match(/^t\.me\/([a-z0-9_]{5,})(?:\/(\d+))?/i);
  if (publicMatch) {
    const threadId = publicMatch[2] ? Number(publicMatch[2]) : null;
    return {
      chatUsername: publicMatch[1].toLowerCase(),
      threadId: Number.isFinite(threadId ?? NaN) ? threadId : null,
      label
    };
  }

  if (/^[a-z0-9_]{5,}$/i.test(normalized)) {
    return { chatUsername: normalized.toLowerCase(), threadId: null, label };
  }

  return null;
}

function getFactionChatRefs(env: Env): FactionChatRefs {
  return {
    real: parseChatRef(env.FACTION_CHAT_REAL, "real_madrid"),
    barca: parseChatRef(env.FACTION_CHAT_BARCA, "barcelona"),
    general: parseChatRef(env.FACTION_CHAT_GENERAL, "general")
  };
}

function matchChatRef(message: TelegramMessage, ref: FactionChatRef): boolean {
  const chatId = message.chat?.id;
  const chatUsername = message.chat?.username?.toLowerCase();
  const matchesChat =
    (ref.chatId !== undefined && chatId === ref.chatId) ||
    (!!ref.chatUsername && !!chatUsername && ref.chatUsername === chatUsername);
  if (!matchesChat) {
    return false;
  }
  if (ref.threadId !== null && ref.threadId !== undefined) {
    return message.message_thread_id === ref.threadId;
  }
  return true;
}

function formatFactionName(faction: "real_madrid" | "barcelona"): string {
  return faction === "real_madrid" ? "Реал" : "Барселона";
}

function formatUserDisplay(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  const username = user.username ? `@${user.username}` : null;
  if (name && username) {
    return `${name} (${username})`;
  }
  if (name) {
    return name;
  }
  if (username) {
    return username;
  }
  return `id:${user.id}`;
}

async function getUserClassicoChoice(
  supabase: SupabaseClient,
  userId: number
): Promise<"real_madrid" | "barcelona" | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("classico_choice")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load user faction", error);
      return null;
    }

    if (data?.classico_choice === "real_madrid" || data?.classico_choice === "barcelona") {
      return data.classico_choice;
    }
  } catch (error) {
    console.error("Failed to load user faction", error);
  }
  return null;
}

async function handleFactionChatModeration(
  message: TelegramMessage,
  env: Env,
  supabase: SupabaseClient | null
): Promise<void> {
  const from = message.from;
  const chatId = message.chat?.id;
  const messageId = message.message_id;
  if (!from || !chatId || !messageId || from.is_bot) {
    return;
  }

  const refs = getFactionChatRefs(env);
  const inReal = refs.real && matchChatRef(message, refs.real);
  const inBarca = refs.barca && matchChatRef(message, refs.barca);
  const targetFaction = inReal ? "real_madrid" : inBarca ? "barcelona" : null;
  if (!targetFaction) {
    return;
  }

  if (!supabase) {
    console.error("Failed to moderate faction chat: missing_supabase");
    return;
  }

  const userFaction = await getUserClassicoChoice(supabase, from.id);
  if (!userFaction || userFaction === targetFaction) {
    return;
  }

  await deleteMessage(env, chatId, messageId);

  const targetLabel = formatFactionName(targetFaction);
  const userLabel = formatUserDisplay(from);
  const userFactionLabel = formatFactionName(userFaction);

  const directMessage = `Твоє повідомлення видалено: це чат фракції ${targetLabel}. Твоя фракція: ${userFactionLabel}.`;
  await sendMessage(env, from.id, directMessage);

  if (refs.general) {
    const generalChatTarget =
      refs.general.chatId ?? (refs.general.chatUsername ? `@${refs.general.chatUsername}` : null);
    if (!generalChatTarget) {
      return;
    }
    const generalText = `Порушення у чаті ${targetLabel}: ${userLabel} (${userFactionLabel}) написав у чужій гілці. Повідомлення видалено.`;
    await sendMessage(env, generalChatTarget, generalText);
  }
}

async function storeUser(
  supabase: SupabaseClient | null,
  user: TelegramUser,
  options: { markLastSeen?: boolean } = {}
): Promise<void> {
  if (!supabase) {
    return;
  }

  try {
    const now = new Date().toISOString();
    const payload = {
      id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      photo_url: user.photo_url ?? null,
      updated_at: now,
      ...(options.markLastSeen ? { last_seen_at: now } : {})
    };

    const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
    if (error) {
      console.error("Failed to store user", error);
    }
  } catch (error) {
    console.error("Failed to store user", error);
  }
}

async function listLeaderboard(supabase: SupabaseClient, limit?: number | null): Promise<StoredUser[] | null> {
  try {
    let query = supabase
      .from("users")
      .select(
        "id, username, first_name, last_name, photo_url, points_total, updated_at, last_seen_at, nickname, avatar_choice"
      )
      .order("points_total", { ascending: false })
      .order("updated_at", { ascending: false });
    if (typeof limit === "number") {
      query = query.limit(limit);
    }
    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch users", error);
      return null;
    }

    return (data as StoredUser[]) ?? [];
  } catch (error) {
    console.error("Failed to fetch users", error);
    return null;
  }
}

async function listAnalitika(
  supabase: SupabaseClient,
  teamSlug: string,
  season?: number | null
): Promise<DbAnalitika[] | null> {
  try {
    let query = supabase
      .from("analitika")
      .select("id, cache_key, team_slug, data_type, league_id, season, payload, fetched_at, expires_at")
      .eq("team_slug", teamSlug);
    if (season) {
      query = query.eq("season", season);
    }
    const { data, error } = await query.order("data_type", { ascending: true }).order("fetched_at", { ascending: false });
    if (error) {
      console.error("Failed to list analitika", error);
      return null;
    }
    return (data as DbAnalitika[]) ?? [];
  } catch (error) {
    console.error("Failed to list analitika", error);
    return null;
  }
}

async function listTeamMatchStats(
  supabase: SupabaseClient,
  teamName: string,
  limit?: number | null
): Promise<DbTeamMatchStat[] | null> {
  try {
    let query = supabase
      .from("team_match_stats")
      .select("id, team_name, opponent_name, match_date, is_home, team_goals, opponent_goals, avg_rating")
      .eq("team_name", teamName)
      .order("match_date", { ascending: false });
    if (typeof limit === "number") {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Failed to list team_match_stats", error);
      return null;
    }
    return (data as DbTeamMatchStat[]) ?? [];
  } catch (error) {
    console.error("Failed to list team_match_stats", error);
    return null;
  }
}

async function refreshAnalitika(
  env: Env,
  supabase: SupabaseClient,
  teamSlugs?: string[]
): Promise<
  | { ok: true; updated: number; warnings: string[]; debug: AnalitikaDebugInfo }
  | { ok: false; error: string; detail?: string; debug: AnalitikaDebugInfo }
> {
  const debug: AnalitikaDebugInfo = {
    league_slug: ANALITIKA_LEAGUE_ID,
    api_league_id: null,
    season: null,
    timezone: null,
    teams: [],
    statuses: {},
    counts: {},
    samples: {}
  };
  if (!env.API_FOOTBALL_KEY) {
    return { ok: false, error: "missing_api_key", debug };
  }

  const timezone = getApiFootballTimezone(env);
  if (!timezone) {
    return { ok: false, error: "missing_timezone", debug };
  }
  debug.timezone = timezone;

  const leagueId = resolveApiLeagueId(env, ANALITIKA_LEAGUE_ID);
  if (!leagueId) {
    return { ok: false, error: "missing_league_mapping", debug };
  }
  debug.api_league_id = leagueId;

  const staticKeys = [
    buildAnalitikaStaticKey("league", ANALITIKA_LEAGUE_ID),
    ...ANALITIKA_TEAMS.map((team) => buildAnalitikaStaticKey("team", team.slug))
  ];
  const staticRows = await getAnalitikaStatic(supabase, staticKeys);
  const leagueStaticKey = buildAnalitikaStaticKey("league", ANALITIKA_LEAGUE_ID);
  const leagueStatic = staticRows.get(leagueStaticKey) ?? null;
  if (!isAnalitikaStaticFresh(leagueStatic)) {
    await upsertAnalitikaStatic(supabase, [
      buildAnalitikaStaticRow(
        leagueStaticKey,
        { league_slug: ANALITIKA_LEAGUE_ID, api_league_id: leagueId, timezone },
        ANALITIKA_STATIC_TTL_DAYS
      )
    ]);
  }

  const seasonOverride = parseEnvNumber(env.ANALITIKA_SEASON, 0);
  const season = seasonOverride > 0 ? seasonOverride : resolveSeasonForDate(new Date(), timezone);
  debug.season = season;
  const seasonRange = getSeasonDateRange(season, timezone);
  const allTeamsResult = await resolveAnalitikaTeamsWithCache(env, supabase, staticRows);
  if (!allTeamsResult.ok) {
    return { ok: false, error: allTeamsResult.error, detail: allTeamsResult.detail, debug };
  }

  const h2hTeams = allTeamsResult.teams;
  const teams = filterRequestedTeams(h2hTeams, teamSlugs);
  if (!teams) {
    return { ok: false, error: "bad_team", debug };
  }
  debug.teams = h2hTeams.map((team) => ({ slug: team.slug, name: team.name, team_id: team.teamId ?? null }));
  const warnings: string[] = [];
  const nowIso = new Date().toISOString();
  const updates: AnalitikaUpsert[] = [];

  const standingsResult = await fetchLeagueStandings(env, leagueId, season);
  debug.statuses.standings = standingsResult.status;
  if (!standingsResult.ok) {
    warnings.push(`standings_status_${standingsResult.status}`);
  } else {
    const count = getApiResponseCount(standingsResult.payload);
    debug.counts.standings = count;
    debug.samples.standings_teams = extractStandingsTeamSample(standingsResult.payload);
    if (!count) {
      warnings.push("standings_empty_response");
    }
  }

  const topScorersResult = await fetchTopPlayers(env, leagueId, season, "scorers");
  debug.statuses.top_scorers = topScorersResult.status;
  if (!topScorersResult.ok) {
    warnings.push(`top_scorers_status_${topScorersResult.status}`);
  } else {
    const count = getApiResponseCount(topScorersResult.payload);
    debug.counts.top_scorers = count;
    if (!count) {
      warnings.push("top_scorers_empty_response");
    }
  }

  const topAssistsResult = await fetchTopPlayers(env, leagueId, season, "assists");
  debug.statuses.top_assists = topAssistsResult.status;
  if (!topAssistsResult.ok) {
    warnings.push(`top_assists_status_${topAssistsResult.status}`);
  } else {
    const count = getApiResponseCount(topAssistsResult.payload);
    debug.counts.top_assists = count;
    if (!count) {
      warnings.push("top_assists_empty_response");
    }
  }

  let headToHeadPayload: AnalitikaPayload | null = null;
  if (h2hTeams.length >= 2) {
    const h2hResult = await fetchHeadToHeadSeason(
      env,
      h2hTeams[0].teamId,
      h2hTeams[1].teamId,
      seasonRange.from,
      seasonRange.to,
      timezone
    );
    debug.statuses.head_to_head = h2hResult.status;
    if (h2hResult.ok) {
      const count = getApiResponseCount(h2hResult.payload);
      debug.counts.head_to_head = count;
      if (!count) {
        warnings.push("head_to_head_empty_response");
      }
      headToHeadPayload = buildHeadToHeadPayload(h2hResult.payload);
    } else {
      warnings.push(`head_to_head_status_${h2hResult.status}`);
    }
  } else {
    warnings.push("head_to_head_missing_team");
  }

  for (const team of teams) {
    const teamStatsResult = await fetchTeamStats(env, team.teamId, leagueId, season);
    if (!debug.statuses.team_stats) {
      debug.statuses.team_stats = {};
    }
    debug.statuses.team_stats[team.slug] = teamStatsResult.status;
    if (!debug.counts.team_stats) {
      debug.counts.team_stats = {};
    }
    debug.counts.team_stats[team.slug] = teamStatsResult.ok ? getApiResponseCount(teamStatsResult.payload) : 0;
    if (teamStatsResult.ok) {
      if (!debug.counts.team_stats[team.slug]) {
        warnings.push(`team_stats_empty_response_${team.slug}`);
      }
      const payload = buildTeamStatsPayload(teamStatsResult.payload);
      updates.push(
        buildAnalitikaUpsert(team.slug, "team_stats", ANALITIKA_LEAGUE_ID, season, payload, nowIso)
      );
    } else {
      warnings.push(`team_stats_${team.slug}_status_${teamStatsResult.status}`);
    }

    if (standingsResult.ok) {
      const row = findStandingsRow(standingsResult.payload, team.teamId);
      if (row) {
        updates.push(
          buildAnalitikaUpsert(
            team.slug,
            "standings",
            ANALITIKA_LEAGUE_ID,
            season,
            buildStandingsPayload(row),
            nowIso
          )
        );
        updates.push(
          buildAnalitikaUpsert(
            team.slug,
            "standings_home_away",
            ANALITIKA_LEAGUE_ID,
            season,
            buildHomeAwayPayload(row),
            nowIso
          )
        );
      } else {
        warnings.push(`standings_missing_team_${team.slug}`);
      }
    }

    if (topScorersResult.ok) {
      updates.push(
        buildAnalitikaUpsert(
          team.slug,
          "top_scorers",
          ANALITIKA_LEAGUE_ID,
          season,
          buildTopPlayersPayload(topScorersResult.payload),
          nowIso
        )
      );
    }

    if (topAssistsResult.ok) {
      updates.push(
        buildAnalitikaUpsert(
          team.slug,
          "top_assists",
          ANALITIKA_LEAGUE_ID,
          season,
          buildTopPlayersPayload(topAssistsResult.payload),
          nowIso
        )
      );
    }

    if (headToHeadPayload) {
      updates.push(
        buildAnalitikaUpsert(team.slug, "head_to_head", ANALITIKA_LEAGUE_ID, season, headToHeadPayload, nowIso)
      );
    }
  }

  if (!updates.length) {
    return { ok: false, error: "api_error", detail: "no_data", debug };
  }

  const upserted = await upsertAnalitika(supabase, updates);
  if (!upserted) {
    return { ok: false, error: "db_error", debug };
  }

  return { ok: true, updated: updates.length, warnings, debug };
}

async function getUserStats(supabase: SupabaseClient, userId: number): Promise<UserStats | null> {
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("points_total")
      .eq("id", userId)
      .maybeSingle();

    if (userError || !userData) {
      return null;
    }

    const points = typeof userData.points_total === "number" ? userData.points_total : STARTING_POINTS;
    const { data: higherPoints, error: countError } = await supabase
      .from("users")
      .select("points_total")
      .gt("points_total", points);

    if (countError) {
      return { points_total: points, rank: null };
    }

    const distinctHigher = new Set(
      (higherPoints as Array<{ points_total?: number | null }> | null)?.map((row) => row.points_total).filter(
        (value): value is number => typeof value === "number"
      ) ?? []
    );

    return { points_total: points, rank: distinctHigher.size + 1 };
  } catch {
    return null;
  }
}

async function getPredictionStats(supabase: SupabaseClient, userId: number): Promise<PredictionStats> {
  const total = await countPredictions(supabase, userId);
  const hits = await countPredictions(supabase, userId, true);
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const lastResults = await listRecentPredictionResults(supabase, userId);
  let streak = 0;
  for (const entry of lastResults) {
    if (!entry.hit) {
      break;
    }
    streak += 1;
  }
  return {
    total,
    hits,
    accuracy_pct: accuracy,
    streak,
    last_results: lastResults
  };
}

async function countPredictions(
  supabase: SupabaseClient,
  userId: number,
  hitsOnly = false
): Promise<number> {
  try {
    let query = supabase
      .from("predictions")
      .select("id, matches!inner(status)", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("matches.status", "finished");
    if (hitsOnly) {
      query = query.gt("points", 0);
    }
    const { count } = await query;
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.error("Failed to count predictions", error);
    return 0;
  }
}

async function listRecentPredictionResults(supabase: SupabaseClient, userId: number): Promise<PredictionResult[]> {
  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("id, points, matches!inner(kickoff_at, status)")
      .eq("user_id", userId)
      .eq("matches.status", "finished")
      .not("points", "is", null)
      .order("kickoff_at", { foreignTable: "matches", ascending: true })
      .order("id", { ascending: true });
    if (error || !data) {
      return [];
    }
    return (data as Array<{ points?: number | null }>).map((row) => {
      const points = typeof row.points === "number" ? row.points : 0;
      return {
        hit: points > 0,
        points
      };
    });
  } catch (error) {
    console.error("Failed to list recent prediction results", error);
    return [];
  }
}

async function getFactionStats(supabase: SupabaseClient, userId: number): Promise<FactionStat[]> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("classico_choice, eu_club_id, ua_club_id, points_total")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      return [];
    }
    const points = typeof data.points_total === "number" ? data.points_total : STARTING_POINTS;
    const order: Array<FactionKey> = ["classico_choice", "eu_club_id", "ua_club_id"];
    const entries: FactionStat[] = [];
    for (const key of order) {
      const value = (data as Record<string, string | null | undefined>)[key];
      if (!value) {
        continue;
      }
      const members = await countFactionMembers(supabase, key, value);
      const rank = await getFactionRank(supabase, key, value, points);
      entries.push({ key, value, members, rank });
    }
    return entries;
  } catch (error) {
    console.error("Failed to build faction stats", error);
    return [];
  }
}

async function countFactionMembers(supabase: SupabaseClient, key: FactionKey, value: string): Promise<number> {
  try {
    const { count } = await supabase.from("users").select("id", { count: "exact", head: true }).eq(key, value);
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.error("Failed to count faction members", error);
    return 0;
  }
}

async function getFactionRank(
  supabase: SupabaseClient,
  key: FactionKey,
  value: string,
  points: number
): Promise<number | null> {
  try {
    const { data: higherPoints, error } = await supabase
      .from("users")
      .select("points_total")
      .eq(key, value)
      .gt("points_total", points);
    if (error) {
      return null;
    }
    const distinctHigher = new Set(
      (higherPoints as Array<{ points_total?: number | null }> | null)?.map((row) => row.points_total).filter(
        (entry): entry is number => typeof entry === "number"
      ) ?? []
    );
    return distinctHigher.size + 1;
  } catch (error) {
    console.error("Failed to compute faction rank", error);
    return null;
  }
}

async function getProfileStats(supabase: SupabaseClient, userId: number): Promise<ProfileStats> {
  const [prediction, factions] = await Promise.all([
    getPredictionStats(supabase, userId),
    getFactionStats(supabase, userId)
  ]);
  return { prediction, factions };
}

async function getUserOnboarding(supabase: SupabaseClient, userId: number): Promise<UserOnboarding | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("classico_choice, ua_club_id, eu_club_id, nickname, avatar_choice, logo_order, onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    const completedAt = (data as UserOnboardingRow).onboarding_completed_at ?? null;
    return {
      classico_choice: data.classico_choice ?? null,
      ua_club_id: data.ua_club_id ?? null,
      eu_club_id: data.eu_club_id ?? null,
      nickname: data.nickname ?? null,
      avatar_choice: data.avatar_choice ?? null,
      logo_order: (data as UserOnboardingRow).logo_order ?? null,
      completed: Boolean(completedAt)
    };
  } catch {
    return null;
  }
}

async function listPredictions(supabase: SupabaseClient, matchId: number): Promise<PredictionView[] | null> {
  try {
    const { data, error } = await supabase
      .from("predictions")
      .select(
        "id, user_id, home_pred, away_pred, points, created_at, users (id, username, first_name, last_name, photo_url, nickname, points_total)"
      )
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch predictions", error);
      return null;
    }

    return (data as PredictionRow[]).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      home_pred: row.home_pred,
      away_pred: row.away_pred,
      points: row.points ?? 0,
      user: row.users
        ? {
          id: row.users.id,
          username: row.users.username ?? null,
          first_name: row.users.first_name ?? null,
          last_name: row.users.last_name ?? null,
          photo_url: row.users.photo_url ?? null,
          nickname: row.users.nickname ?? null,
          points_total: row.users.points_total ?? null
        }
        : null
    }));
  } catch (error) {
    console.error("Failed to fetch predictions", error);
    return null;
  }
}

async function checkAdmin(supabase: SupabaseClient, userId: number): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("admin")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      return false;
    }

    return Boolean((data as { admin?: boolean | null }).admin);
  } catch {
    return false;
  }
}

async function createMatch(
  supabase: SupabaseClient,
  userId: number,
  payload: CreateMatchPayload
): Promise<DbMatch | null> {
  const kickoffAt = payload.kickoff_at?.trim();
  if (!kickoffAt) {
    return null;
  }

  const leagueId = normalizeLeagueId(payload.league_id);
  const homeClubId = normalizeClubId(payload.home_club_id);
  const awayClubId = normalizeClubId(payload.away_club_id);

  let home = payload.home_team?.trim() ?? "";
  let away = payload.away_team?.trim() ?? "";

  if (leagueId || homeClubId || awayClubId) {
    if (!leagueId || !homeClubId || !awayClubId) {
      return null;
    }
    if (homeClubId === awayClubId) {
      return null;
    }
    if (!home) {
      home = formatClubLabel(homeClubId);
    }
    if (!away) {
      away = formatClubLabel(awayClubId);
    }
  }

  if (!home || !away) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("matches")
      .insert({
        home_team: home,
        away_team: away,
        league_id: leagueId ?? null,
        home_club_id: homeClubId ?? null,
        away_club_id: awayClubId ?? null,
        kickoff_at: kickoffAt,
        status: "pending",
        created_by: userId
      })
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone"
      )
      .single();

    if (error) {
      console.error("Failed to create match", error);
      return null;
    }

    return data as DbMatch;
  } catch (error) {
    console.error("Failed to create match", error);
    return null;
  }
}

async function fetchAndStoreOdds(
  env: Env,
  supabase: SupabaseClient,
  match: DbMatch,
  options?: { debug?: boolean }
): Promise<OddsStoreResult> {
  const debug = options?.debug
    ? { leagueId: match.league_id ?? null, kickoffAt: match.kickoff_at ?? null }
    : undefined;
  const timezone = getApiFootballTimezone(env);
  if (debug) {
    debug.timezone = timezone ?? undefined;
  }
  if (!timezone) {
    console.warn("Odds skipped: missing timezone");
    return { ok: false, reason: "missing_timezone", debug };
  }
  const leagueId = resolveApiLeagueId(env, match.league_id ?? null);
  if (debug) {
    debug.apiLeagueId = leagueId;
  }
  if (!leagueId) {
    console.warn("Odds skipped: missing league mapping", match.league_id);
    return { ok: false, reason: "missing_league_mapping", debug };
  }

  const kickoffDate = parseKyivDate(match.kickoff_at);
  if (!kickoffDate) {
    console.warn("Odds skipped: bad kickoff date");
    return { ok: false, reason: "bad_kickoff_date", debug };
  }

  const season = resolveSeasonForDate(kickoffDate, timezone);
  const dateParam = formatDateString(kickoffDate, timezone);
  if (debug) {
    debug.season = season;
    debug.date = dateParam;
  }

  const homeTeamResult = await resolveTeamId(env, match.home_team);
  const awayTeamResult = await resolveTeamId(env, match.away_team);
  if (debug) {
    debug.homeTeamId = homeTeamResult.id;
    debug.awayTeamId = awayTeamResult.id;
    debug.homeTeamSource = homeTeamResult.source;
    debug.awayTeamSource = awayTeamResult.source;
    debug.homeTeamQuery = homeTeamResult.query;
    debug.awayTeamQuery = awayTeamResult.query;
    debug.homeTeamSearchStatus = homeTeamResult.status;
    debug.awayTeamSearchStatus = awayTeamResult.status;
    debug.homeTeamMatchedName = homeTeamResult.matchedName ?? null;
    debug.awayTeamMatchedName = awayTeamResult.matchedName ?? null;
    debug.homeTeamMatchScore = homeTeamResult.matchScore ?? null;
    debug.awayTeamMatchScore = awayTeamResult.matchScore ?? null;
    debug.homeTeamQueryAttempts = homeTeamResult.queryAttempts;
    debug.awayTeamQueryAttempts = awayTeamResult.queryAttempts;
    debug.homeTeamSearchAttempts = homeTeamResult.searchAttempts;
    debug.awayTeamSearchAttempts = awayTeamResult.searchAttempts;
    debug.homeTeamCandidates = homeTeamResult.candidates;
    debug.awayTeamCandidates = awayTeamResult.candidates;
  }
  if (!homeTeamResult.id || !awayTeamResult.id) {
    console.warn("Odds skipped: team id not found", { home: match.home_team, away: match.away_team });
    return { ok: false, reason: "team_not_found", debug };
  }

  const from = addDateDays(dateParam, -1, timezone);
  const to = addDateDays(dateParam, 1, timezone);
  const headToHeadResult = await fetchHeadToHeadFixtures(
    env,
    homeTeamResult.id,
    awayTeamResult.id,
    from,
    to,
    timezone
  );
  if (debug) {
    debug.headtoheadCount = headToHeadResult.fixtures.length;
    debug.headtoheadStatus = headToHeadResult.dateStatus;
    debug.headtoheadSample = headToHeadResult.fixtures.slice(0, 3).map((item) => ({
      id: item.fixture?.id,
      home: item.teams?.home?.name,
      away: item.teams?.away?.name,
      homeId: item.teams?.home?.id,
      awayId: item.teams?.away?.id
    }));
  }

  let selectedFixture = selectFixture(
    headToHeadResult.fixtures,
    homeTeamResult.id,
    awayTeamResult.id,
    leagueId,
    dateParam,
    timezone
  );
  if (!selectedFixture) {
    const fallbackReason = headToHeadResult.fixtures.length ? "headtohead_no_match" : "headtohead_empty";
    if (debug) {
      debug.fallbackReason = fallbackReason;
    }
    logFixturesFallback(fallbackReason, {
      teams: `${homeTeamResult.id}-${awayTeamResult.id}`,
      from,
      to,
      league: leagueId,
      season,
      timezone
    });
    const leagueResult = await fetchFixturesByLeague(env, leagueId, season, dateParam, timezone);
    if (debug) {
      debug.leagueFixturesCount = leagueResult.fixtures.length;
      debug.leagueFixturesSource = leagueResult.source;
      debug.leagueDateStatus = leagueResult.dateStatus;
      if (leagueResult.rangeStatus !== undefined) {
        debug.leagueRangeStatus = leagueResult.rangeStatus;
      }
      debug.leagueFixturesSample = leagueResult.fixtures.slice(0, 3).map((item) => ({
        id: item.fixture?.id,
        home: item.teams?.home?.name,
        away: item.teams?.away?.name,
        homeId: item.teams?.home?.id,
        awayId: item.teams?.away?.id
      }));
    }
    selectedFixture = selectFixture(
      leagueResult.fixtures,
      homeTeamResult.id,
      awayTeamResult.id,
      leagueId,
      dateParam,
      timezone
    );
  }

  const fixtureId = selectedFixture?.fixture?.id ?? null;
  if (debug) {
    debug.fixtureId = fixtureId ?? null;
  }
  if (!fixtureId) {
    console.warn("Odds skipped: fixture not found", match.id);
    return { ok: false, reason: "fixture_not_found", debug };
  }

  await saveMatchVenue(supabase, match, selectedFixture);

  const oddsResult = await fetchOdds(env, fixtureId);
  if (!oddsResult.ok) {
    console.warn("Odds skipped:", oddsResult.reason, match.id);
    return { ok: false, reason: oddsResult.reason, detail: oddsResult.detail, debug };
  }

  const saveResult = await saveMatchOdds(supabase, match.id, leagueId, fixtureId, oddsResult.odds);
  if (!saveResult.ok) {
    return { ok: false, reason: "db_error", detail: saveResult.detail, debug };
  }
  return { ok: true, debug };
}

function resolveApiLeagueId(env: Env, leagueId: string | null): number | null {
  if (!leagueId) {
    return null;
  }

  const customMap = parseLeagueMap(env.API_FOOTBALL_LEAGUE_MAP);
  if (customMap && leagueId in customMap) {
    return customMap[leagueId];
  }

  const defaults: Record<string, number> = {
    "english-premier-league": 39,
    "la-liga": 140,
    "serie-a": 135,
    bundesliga: 78,
    "ligue-1": 61
  };

  return defaults[leagueId] ?? null;
}

function parseLeagueMap(value?: string): Record<string, number> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const map: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(parsed)) {
      const numberValue = Number(rawValue);
      if (Number.isFinite(numberValue)) {
        map[key] = numberValue;
      }
    }
    return Object.keys(map).length ? map : null;
  } catch (error) {
    console.warn("Invalid API_FOOTBALL_LEAGUE_MAP", error);
    return null;
  }
}

function parseKyivDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function resolveSeasonForDate(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  const year = Number(values.year);
  const month = Number(values.month);
  if (!year || !month) {
    return date.getUTCFullYear();
  }
  return month >= 7 ? year : year - 1;
}

function formatDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getSeasonDateRange(season: number, timeZone: string): { from: string; to: string } {
  const start = new Date(Date.UTC(season, 6, 1, 12));
  const end = new Date(Date.UTC(season + 1, 5, 30, 12));
  return {
    from: formatDateString(start, timeZone),
    to: formatDateString(end, timeZone)
  };
}

function buildAnalitikaCacheKey(
  teamSlug: string,
  dataType: AnalitikaDataType,
  leagueId: string,
  season: number
): string {
  return `team:${teamSlug}:${dataType}:${leagueId}:${season}`;
}

function buildAnalitikaStaticKey(scope: "team" | "league", slug: string): string {
  return `${scope}:${slug}`;
}

function getAnalitikaTtlHours(dataType: AnalitikaDataType): number {
  switch (dataType) {
    case "standings":
    case "standings_home_away":
    case "top_scorers":
    case "top_assists":
      return 6;
    case "team_stats":
    case "head_to_head":
    default:
      return 24;
  }
}

function buildAnalitikaUpsert(
  teamSlug: string,
  dataType: AnalitikaDataType,
  leagueId: string,
  season: number,
  payload: AnalitikaPayload,
  fetchedAt: string
): AnalitikaUpsert {
  const ttlHours = getAnalitikaTtlHours(dataType);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  return {
    cache_key: buildAnalitikaCacheKey(teamSlug, dataType, leagueId, season),
    team_slug: teamSlug,
    data_type: dataType,
    league_id: leagueId,
    season,
    payload,
    fetched_at: fetchedAt,
    expires_at: expiresAt
  };
}

async function upsertAnalitika(
  supabase: SupabaseClient,
  rows: AnalitikaUpsert[]
): Promise<boolean> {
  try {
    const { error } = await supabase.from("analitika").upsert(rows, { onConflict: "cache_key" });
    if (error) {
      console.error("Failed to upsert analitika", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to upsert analitika", error);
    return false;
  }
}

function buildAnalitikaStaticRow(
  key: string,
  payload: Record<string, unknown>,
  ttlDays: number
): AnalitikaStaticRow {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    key,
    payload,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt
  };
}

function isAnalitikaStaticFresh(row: AnalitikaStaticRow | null): boolean {
  if (!row) {
    return false;
  }
  if (!row.expires_at) {
    return true;
  }
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }
  return Date.now() < expiresAt.getTime();
}

function extractTeamIdFromStatic(row: AnalitikaStaticRow | null): number | null {
  if (!row) {
    return null;
  }
  const payload = toRecord(row.payload);
  const raw = payload?.api_team_id ?? payload?.team_id;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getAnalitikaStatic(
  supabase: SupabaseClient,
  keys: string[]
): Promise<Map<string, AnalitikaStaticRow>> {
  const map = new Map<string, AnalitikaStaticRow>();
  if (!keys.length) {
    return map;
  }
  try {
    const { data, error } = await supabase
      .from("analitika_static")
      .select("key, payload, fetched_at, expires_at")
      .in("key", keys);
    if (error) {
      console.error("Failed to read analitika_static", error);
      return map;
    }
    (data as AnalitikaStaticRow[] | null)?.forEach((row) => {
      map.set(row.key, row);
    });
    return map;
  } catch (error) {
    console.error("Failed to read analitika_static", error);
    return map;
  }
}

async function upsertAnalitikaStatic(
  supabase: SupabaseClient,
  rows: AnalitikaStaticRow[]
): Promise<boolean> {
  if (!rows.length) {
    return true;
  }
  try {
    const { error } = await supabase.from("analitika_static").upsert(rows, { onConflict: "key" });
    if (error) {
      console.error("Failed to upsert analitika_static", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to upsert analitika_static", error);
    return false;
  }
}

async function resolveAnalitikaTeamsWithCache(
  env: Env,
  supabase: SupabaseClient,
  staticRows: Map<string, AnalitikaStaticRow>
): Promise<{ ok: true; teams: AnalitikaTeam[] } | { ok: false; error: string; detail?: string }> {
  const targets = ANALITIKA_TEAMS;
  const updates: AnalitikaStaticRow[] = [];
  const resolved: AnalitikaTeam[] = [];

  for (const team of targets) {
    const key = buildAnalitikaStaticKey("team", team.slug);
    const cached = staticRows.get(key) ?? null;
    let teamId = isAnalitikaStaticFresh(cached) ? extractTeamIdFromStatic(cached) : null;
    if (!teamId) {
      const resolvedTeam = await resolveTeamId(env, team.name);
      if (!resolvedTeam.id) {
        return { ok: false, error: "team_not_found", detail: team.slug };
      }
      teamId = resolvedTeam.id;
      updates.push(
        buildAnalitikaStaticRow(key, { api_team_id: teamId, name: team.name, slug: team.slug }, ANALITIKA_STATIC_TTL_DAYS)
      );
    }
    resolved.push({ slug: team.slug, name: team.name, teamId });
  }

  if (updates.length) {
    await upsertAnalitikaStatic(supabase, updates);
  }

  return { ok: true, teams: resolved };
}

function filterRequestedTeams(
  teams: AnalitikaTeam[],
  requested?: string[]
): AnalitikaTeam[] | null {
  if (!requested || !requested.length) {
    return teams;
  }
  const set = new Set(requested);
  const filtered = teams.filter((team) => set.has(team.slug));
  return filtered.length === requested.length ? filtered : null;
}

async function resolveAnalitikaTeams(
  env: Env,
  teamSlugs?: string[]
): Promise<{ ok: true; teams: AnalitikaTeam[] } | { ok: false; error: string; detail?: string }> {
  const requested = teamSlugs?.length
    ? teamSlugs
    : ANALITIKA_TEAMS.map((team) => team.slug);
  const targets = requested
    .map((slug) => ANALITIKA_TEAMS.find((entry) => entry.slug === slug))
    .filter((entry): entry is { slug: string; name: string } => Boolean(entry));
  if (!targets.length) {
    return { ok: false, error: "bad_team" };
  }

  const resolved: AnalitikaTeam[] = [];
  for (const team of targets) {
    const resolvedTeam = await resolveTeamId(env, team.name);
    if (!resolvedTeam.id) {
      return { ok: false, error: "team_not_found", detail: team.slug };
    }
    resolved.push({ slug: team.slug, name: team.name, teamId: resolvedTeam.id });
  }

  return { ok: true, teams: resolved };
}

async function fetchApiFootballPayload(
  env: Env,
  path: string
): Promise<{ ok: true; payload: unknown; status: number } | { ok: false; status: number }> {
  const response = await fetchApiFootball(env, path);
  const status = response.status;
  if (!response.ok) {
    return { ok: false, status };
  }
  try {
    const payload = (await response.json()) as unknown;
    return { ok: true, payload, status };
  } catch (error) {
    console.warn("API-Football payload parse error", error);
    return { ok: false, status };
  }
}

async function fetchTeamStats(
  env: Env,
  teamId: number,
  leagueId: number,
  season: number
): Promise<{ ok: true; payload: unknown; status: number } | { ok: false; status: number }> {
  const path = buildApiPath("/teams/statistics", { team: teamId, league: leagueId, season });
  return fetchApiFootballPayload(env, path);
}

async function fetchLeagueStandings(
  env: Env,
  leagueId: number,
  season: number
): Promise<{ ok: true; payload: unknown; status: number } | { ok: false; status: number }> {
  const path = buildApiPath("/standings", { league: leagueId, season });
  return fetchApiFootballPayload(env, path);
}

async function fetchTopPlayers(
  env: Env,
  leagueId: number,
  season: number,
  type: "scorers" | "assists"
): Promise<{ ok: true; payload: unknown; status: number } | { ok: false; status: number }> {
  const endpoint = type === "scorers" ? "/players/topscorers" : "/players/topassists";
  const path = buildApiPath(endpoint, { league: leagueId, season });
  return fetchApiFootballPayload(env, path);
}

async function fetchHeadToHeadSeason(
  env: Env,
  homeTeamId: number,
  awayTeamId: number,
  from: string,
  to: string,
  timezone: string
): Promise<{ ok: true; payload: unknown; status: number } | { ok: false; status: number }> {
  const h2h = `${homeTeamId}-${awayTeamId}`;
  const path = buildApiPath("/fixtures/headtohead", {
    h2h,
    from,
    to,
    last: ANALITIKA_HEAD_TO_HEAD_LIMIT,
    timezone
  });
  return fetchApiFootballPayload(env, path);
}

function buildTeamStatsPayload(payload: unknown): AnalitikaPayload {
  const response = toRecord(payload)?.response ?? payload;
  const record = toRecord(response);
  const goals = toRecord(record?.goals);
  const goalsFor = toRecord(goals?.for);
  const goalsAgainst = toRecord(goals?.against);
  const goalsForTotal = toRecord(goalsFor?.total);
  const goalsAgainstTotal = toRecord(goalsAgainst?.total);
  const cleanSheet = toRecord(record?.clean_sheet);
  const shots = toRecord(record?.shots);
  const possession = record?.ball_possession ?? record?.possession ?? null;

  return {
    gf: extractStatValue(goalsForTotal?.total),
    ga: extractStatValue(goalsAgainstTotal?.total),
    xg: null,
    ppda: null,
    shots: extractStatValue(shots?.total ?? shots?.shots_total),
    shots_on_target: extractStatValue(shots?.on ?? shots?.on_target),
    possession: extractStatValue(possession),
    clean_sheets: extractStatValue(cleanSheet?.total ?? cleanSheet?.home ?? cleanSheet?.away)
  };
}

function findStandingsRow(payload: unknown, teamId: number): Record<string, unknown> | null {
  const response = toRecord(payload)?.response;
  if (!Array.isArray(response) || !response.length) {
    return null;
  }
  const league = toRecord(response[0])?.league;
  const standings = toRecord(league)?.standings;
  if (!Array.isArray(standings) || !standings.length) {
    return null;
  }
  const rows = Array.isArray(standings[0]) ? standings[0] : [];
  const row = rows.find((entry) => {
    const team = toRecord(entry)?.team;
    return toRecord(team)?.id === teamId;
  });
  return toRecord(row);
}

function buildStandingsPayload(row: Record<string, unknown>): AnalitikaPayload {
  const all = toRecord(row.all);
  const goals = toRecord(all?.goals);
  return {
    rank: extractStatValue(row.rank),
    points: extractStatValue(row.points),
    played: extractStatValue(all?.played),
    wins: extractStatValue(all?.win),
    draws: extractStatValue(all?.draw),
    losses: extractStatValue(all?.lose),
    gf: extractStatValue(goals?.for),
    ga: extractStatValue(goals?.against),
    gd: extractStatValue(row.goalsDiff ?? row.goals_diff),
    form: extractStatValue(row.form)
  };
}

function buildHomeAwayPayload(row: Record<string, unknown>): AnalitikaPayload {
  return {
    home: buildHomeAwayRow(toRecord(row.home)),
    away: buildHomeAwayRow(toRecord(row.away))
  };
}

function buildHomeAwayRow(row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) {
    return {};
  }
  const goals = toRecord(row.goals);
  return {
    played: extractStatValue(row.played),
    wins: extractStatValue(row.win),
    draws: extractStatValue(row.draw),
    losses: extractStatValue(row.lose),
    gf: extractStatValue(goals?.for),
    ga: extractStatValue(goals?.against),
    points: extractStatValue(row.points),
    form: extractStatValue(row.form)
  };
}

function buildTopPlayersPayload(payload: unknown): AnalitikaPayload {
  const response = toRecord(payload)?.response;
  if (!Array.isArray(response)) {
    return { entries: [] };
  }
  const entries = response.slice(0, 10).map((entry) => {
    const record = toRecord(entry);
    const player = toRecord(record?.player);
    const stats = Array.isArray(record?.statistics) ? record?.statistics[0] : null;
    const statsRecord = toRecord(stats);
    const team = toRecord(statsRecord?.team);
    const goals = toRecord(statsRecord?.goals);
    const games = toRecord(statsRecord?.games);
    return {
      player: { name: player?.name ?? "" },
      team: { name: team?.name ?? "" },
      goals: extractStatValue(goals?.total),
      assists: extractStatValue(goals?.assists),
      rating: extractStatValue(games?.rating),
      minutes: extractStatValue(games?.minutes)
    };
  });
  return { entries };
}

function buildHeadToHeadPayload(payload: unknown): AnalitikaPayload {
  const response = toRecord(payload)?.response;
  if (!Array.isArray(response)) {
    return { entries: [] };
  }
  const entries = response.slice(0, ANALITIKA_HEAD_TO_HEAD_LIMIT).map((entry) => {
    const record = toRecord(entry);
    const fixture = toRecord(record?.fixture);
    const teams = toRecord(record?.teams);
    const home = toRecord(teams?.home);
    const away = toRecord(teams?.away);
    const goals = toRecord(record?.goals);
    const league = toRecord(record?.league);
    return {
      date: fixture?.date ?? "",
      home: home?.name ?? "",
      away: away?.name ?? "",
      score: formatScore(goals?.home, goals?.away),
      league: league?.name ?? ""
    };
  });
  return { entries };
}

function formatScore(home: unknown, away: unknown): string {
  const homeValue = extractStatValue(home);
  const awayValue = extractStatValue(away);
  if (homeValue === null || awayValue === null) {
    return "—";
  }
  return `${homeValue}:${awayValue}`;
}

function extractStatValue(value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  if ("total" in record) {
    return extractStatValue(record.total);
  }
  if ("value" in record) {
    return extractStatValue(record.value);
  }
  if ("avg" in record) {
    return extractStatValue(record.avg);
  }
  if ("average" in record) {
    return extractStatValue(record.average);
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getApiResponseCount(payload: unknown): number {
  const record = toRecord(payload);
  const response = record?.response;
  if (Array.isArray(response)) {
    return response.length;
  }
  if (response && typeof response === "object") {
    return Object.keys(response as Record<string, unknown>).length ? 1 : 0;
  }
  const results = record?.results;
  const parsedResults = typeof results === "number" ? results : Number(results);
  return Number.isFinite(parsedResults) ? parsedResults : 0;
}

function extractStandingsTeamSample(payload: unknown, limit = 6): Array<{ id: number | null; name: string }> {
  const response = toRecord(payload)?.response;
  if (!Array.isArray(response) || !response.length) {
    return [];
  }
  const league = toRecord(response[0])?.league;
  const standings = toRecord(league)?.standings;
  if (!Array.isArray(standings) || !standings.length) {
    return [];
  }
  const rows = Array.isArray(standings[0]) ? standings[0] : [];
  return rows.slice(0, limit).map((row) => {
    const team = toRecord(toRecord(row)?.team);
    const id = typeof team?.id === "number" ? team.id : Number(team?.id);
    return {
      id: Number.isFinite(id) ? id : null,
      name: typeof team?.name === "string" ? team.name : ""
    };
  });
}

async function resolveTeamId(
  env: Env,
  teamName: string
): Promise<{
  id: number | null;
  source: "search" | "cache" | "none";
  query: string;
  status: number;
  candidates: Array<{ id?: number; name?: string }>;
  matchedName?: string | null;
  matchScore?: number | null;
  queryAttempts?: string[];
  searchAttempts?: number[];
}> {
  const normalized = normalizeTeamKey(teamName);
  const queries = getTeamSearchQueries(teamName);
  const queryAttempts: string[] = [];
  const searchAttempts: number[] = [];
  let lastCandidates: Array<{ id?: number; name?: string }> = [];
  let lastQuery = queries[0] ?? teamName;
  let lastStatus = 0;
  let lastMatchName: string | null = null;
  let lastMatchScore: number | null = null;

  for (const query of queries) {
    const searchResult = await fetchTeamsBySearch(env, query);
    const match = findTeamIdInList(teamName, searchResult.teams);
    const candidates = searchResult.teams.slice(0, 5).map((entry) => ({
      id: entry.team?.id,
      name: entry.team?.name
    }));
    queryAttempts.push(query);
    searchAttempts.push(searchResult.status);
    lastCandidates = candidates;
    lastQuery = query;
    lastStatus = searchResult.status;
    lastMatchName = match.name ?? null;
    lastMatchScore = match.score ?? null;

    if (match.id) {
      teamIdCache.set(normalized, { id: match.id, name: match.name ?? teamName, updatedAt: Date.now() });
      return {
        id: match.id,
        source: "search",
        query,
        status: searchResult.status,
        candidates,
        matchedName: match.name ?? null,
        matchScore: match.score ?? null,
        queryAttempts,
        searchAttempts
      };
    }
  }

  const cached = teamIdCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < TEAM_ID_CACHE_TTL_MS) {
    return {
      id: cached.id,
      source: "cache",
      query: lastQuery,
      status: lastStatus,
      candidates: lastCandidates,
      matchedName: lastMatchName,
      matchScore: lastMatchScore,
      queryAttempts,
      searchAttempts
    };
  }

  return {
    id: null,
    source: "none",
    query: lastQuery,
    status: lastStatus,
    candidates: lastCandidates,
    matchedName: lastMatchName,
    matchScore: lastMatchScore,
    queryAttempts,
    searchAttempts
  };
}

function findTeamIdInList(
  teamName: string,
  teams: TeamPayload[]
): { id: number | null; name: string | null; score: number | null } {
  const normalizedTarget = normalizeTeamKey(teamName);
  let bestScore = -Infinity;
  let bestId: number | null = null;
  let bestName: string | null = null;

  for (const entry of teams) {
    const apiName = entry.team?.name ?? "";
    const normalizedApi = normalizeTeamKey(apiName);
    const score = getTeamMatchScore(normalizedTarget, normalizedApi, teamName, apiName);
    if (score <= bestScore) {
      continue;
    }
    const rawId = entry.team?.id ?? null;
    const id = typeof rawId === "number" ? rawId : Number(rawId);
    bestId = Number.isFinite(id) ? id : null;
    bestName = apiName || null;
    bestScore = score;
  }

  if (!Number.isFinite(bestScore) || bestScore <= 0) {
    return { id: null, name: bestName, score: Number.isFinite(bestScore) ? bestScore : null };
  }

  return { id: bestId, name: bestName, score: bestScore };
}

async function fetchTeamsBySearch(env: Env, teamName: string): Promise<TeamsResult> {
  const path = buildApiPath("/teams", { search: teamName });
  const response = await fetchApiFootball(env, path);
  const status = response.status;
  if (!response.ok) {
    console.warn("API-Football teams search error", response.status);
    return { teams: [], status };
  }
  try {
    const payload = (await response.json()) as { response?: TeamPayload[] };
    return { teams: payload.response ?? [], status };
  } catch (error) {
    console.warn("API-Football teams search parse error", error);
    return { teams: [], status };
  }
}

async function fetchHeadToHeadFixtures(
  env: Env,
  homeTeamId: number,
  awayTeamId: number,
  from: string,
  to: string,
  timezone: string
): Promise<FixturesResult> {
  const h2h = `${homeTeamId}-${awayTeamId}`;
  const path = buildApiPath("/fixtures/headtohead", { h2h, from, to, timezone });
  const response = await fetchApiFootball(env, path);
  const status = response.status;
  if (!response.ok) {
    console.warn("API-Football headtohead error", response.status);
    logFixturesSearch(env, { source: "headtohead", path, params: { h2h, from, to, timezone }, fixturesCount: 0 });
    return { fixtures: [], source: "headtohead", dateStatus: status };
  }
  try {
    const payload = (await response.json()) as { response?: FixturePayload[] };
    const fixtures = payload.response ?? [];
    logFixturesSearch(env, { source: "headtohead", path, params: { h2h, from, to, timezone }, fixturesCount: fixtures.length });
    return { fixtures, source: "headtohead", dateStatus: status };
  } catch (error) {
    console.warn("API-Football headtohead parse error", error);
    logFixturesSearch(env, { source: "headtohead", path, params: { h2h, from, to, timezone }, fixturesCount: 0 });
    return { fixtures: [], source: "headtohead", dateStatus: status };
  }
}

async function fetchFixturesByLeague(
  env: Env,
  leagueId: number,
  season: number,
  dateParam: string,
  timezone: string
): Promise<FixturesResult> {
  const datePath = buildApiPath("/fixtures", { date: dateParam, league: leagueId, season, timezone });
  const dateResponse = await fetchApiFootball(env, datePath);
  const dateStatus = dateResponse.status;
  if (dateResponse.ok) {
    const payload = (await dateResponse.json()) as { response?: FixturePayload[] };
    const fixtures = payload.response ?? [];
    logFixturesSearch(env, {
      source: "league_date",
      path: datePath,
      params: { date: dateParam, league: leagueId, season, timezone },
      fixturesCount: fixtures.length
    });
    if (fixtures.length) {
      return { fixtures, source: "date", dateStatus };
    }
  } else {
    logFixturesSearch(env, {
      source: "league_date",
      path: datePath,
      params: { date: dateParam, league: leagueId, season, timezone },
      fixturesCount: 0
    });
  }

  const from = addDateDays(dateParam, -1, timezone);
  const to = addDateDays(dateParam, 1, timezone);
  const rangePath = buildApiPath("/fixtures", { from, to, league: leagueId, season, timezone });
  const rangeResponse = await fetchApiFootball(env, rangePath);
  const rangeStatus = rangeResponse.status;
  if (!rangeResponse.ok) {
    console.warn("API-Football fixtures error", rangeResponse.status);
    logFixturesSearch(env, {
      source: "league_range",
      path: rangePath,
      params: { from, to, league: leagueId, season, timezone },
      fixturesCount: 0
    });
    return { fixtures: [], source: "none", dateStatus, rangeStatus };
  }

  const rangePayload = (await rangeResponse.json()) as { response?: FixturePayload[] };
  const fixtures = rangePayload.response ?? [];
  logFixturesSearch(env, {
    source: "league_range",
    path: rangePath,
    params: { from, to, league: leagueId, season, timezone },
    fixturesCount: fixtures.length,
    reason: "league_date_empty"
  });
  return { fixtures, source: "range", dateStatus, rangeStatus };
}

function selectFixture(
  fixtures: FixturePayload[],
  homeTeamId: number,
  awayTeamId: number,
  leagueId: number,
  dateParam: string,
  timezone: string
): FixturePayload | null {
  const filtered = fixtures.filter((item) => {
    const fixtureHomeId = item.teams?.home?.id ?? null;
    const fixtureAwayId = item.teams?.away?.id ?? null;
    if (!fixtureHomeId || !fixtureAwayId) {
      return false;
    }
    return (
      (fixtureHomeId === homeTeamId && fixtureAwayId === awayTeamId)
      || (fixtureHomeId === awayTeamId && fixtureAwayId === homeTeamId)
    );
  });
  if (!filtered.length) {
    return null;
  }

  const leagueFiltered = filtered.filter((item) => item.league?.id === leagueId);
  const dateFiltered = (leagueFiltered.length ? leagueFiltered : filtered).filter((item) => {
    const fixtureDate = item.fixture?.date;
    const matchDate = fixtureDate ? getDateStringInZone(fixtureDate, timezone) : null;
    return matchDate === dateParam;
  });

  return dateFiltered[0] ?? leagueFiltered[0] ?? filtered[0] ?? null;
}

function getDateStringInZone(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDateDays(dateParam: string, delta: number, timeZone: string): string {
  const [yearRaw, monthRaw, dayRaw] = dateParam.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) {
    return dateParam;
  }
  const baseUtc = Date.UTC(year, month - 1, day, 12);
  const nextDate = new Date(baseUtc + delta * 24 * 60 * 60 * 1000);
  return formatDateString(nextDate, timeZone);
}

async function fetchOdds(env: Env, fixtureId: number): Promise<OddsFetchResult> {
  const response = await fetchApiFootball(env, `/odds?fixture=${fixtureId}`);
  if (!response.ok) {
    console.warn("API-Football odds error", response.status);
    return { ok: false, reason: "api_error", detail: `status_${response.status}` };
  }
  let payload: { response?: unknown[] } | null = null;
  try {
    payload = (await response.json()) as { response?: unknown[] };
  } catch (error) {
    console.warn("API-Football odds parse error", error);
    return { ok: false, reason: "api_error" };
  }
  const odds = payload?.response ?? null;
  if (!odds || (Array.isArray(odds) && !odds.length)) {
    return { ok: false, reason: "odds_empty" };
  }
  return { ok: true, odds };
}

async function saveMatchOdds(
  supabase: SupabaseClient,
  matchId: number,
  leagueId: number,
  fixtureId: number,
  odds: unknown
): Promise<OddsSaveResult> {
  const { error } = await supabase
    .from("matches")
    .update({
      api_league_id: leagueId,
      api_fixture_id: fixtureId,
      odds_json: odds,
      odds_fetched_at: new Date().toISOString()
    })
    .eq("id", matchId);

  if (error) {
    console.error("Failed to store odds", error);
    return { ok: false, detail: error.message ?? "db_error" };
  }
  return { ok: true };
}

async function saveMatchVenue(
  supabase: SupabaseClient,
  match: DbMatch,
  fixture: FixturePayload | null
): Promise<void> {
  if (!fixture) {
    return;
  }
  const venueName = fixture.fixture?.venue?.name?.trim() ?? "";
  const venueCity = fixture.fixture?.venue?.city?.trim() ?? "";
  const tournamentName = fixture.league?.name?.trim() ?? "";
  const tournamentStage = fixture.league?.round?.trim() ?? "";
  const update: VenueUpdate = {};
  if (venueName && venueName !== (match.venue_name ?? "")) {
    update.venue_name = venueName;
  }
  if (venueCity && venueCity !== (match.venue_city ?? "")) {
    update.venue_city = venueCity;
  }
  if (tournamentName && tournamentName !== (match.tournament_name ?? "")) {
    update.tournament_name = tournamentName;
  }
  if (tournamentStage && tournamentStage !== (match.tournament_stage ?? "")) {
    update.tournament_stage = tournamentStage;
  }
  if (!Object.keys(update).length) {
    return;
  }
  const { error } = await supabase.from("matches").update(update).eq("id", match.id);
  if (error) {
    console.error("Failed to store match venue", error);
  }
}

async function saveMatchCoordinates(
  supabase: SupabaseClient,
  matchId: number,
  lat: number,
  lon: number
): Promise<void> {
  const { error } = await supabase
    .from("matches")
    .update({ venue_lat: lat, venue_lon: lon })
    .eq("id", matchId);
  if (error) {
    console.error("Failed to store match coordinates", error);
  }
}

async function saveMatchWeatherCache(
  supabase: SupabaseClient,
  matchId: number,
  rainProbability: number | null,
  condition: string | null,
  tempC: number | null,
  timezone: string | null
): Promise<void> {
  const { error } = await supabase
    .from("matches")
    .update({
      rain_probability: rainProbability,
      weather_condition: condition,
      weather_temp_c: tempC,
      weather_timezone: timezone,
      weather_fetched_at: new Date().toISOString()
    })
    .eq("id", matchId);
  if (error) {
    console.error("Failed to store match weather", error);
  }
}

async function fetchWeatherForecast(
  env: Env,
  lat: number,
  lon: number,
  kickoffAt: string
): Promise<WeatherForecastResult> {
  const bucket = getUtcHourBucket(kickoffAt);
  if (!bucket) {
    return {
      ok: false,
      value: null,
      condition: null,
      tempC: null,
      timezone: null,
      cacheState: "miss",
      isStale: false,
      rateLimitedLocally: false,
      key: "",
      provider: WEATHER_PROVIDER_PRIMARY,
      debug: { target_time: null, date_string: null, forecast_status: null, time_index: null }
    };
  }

  const primary = await fetchWeatherForecastWithProvider(env, WEATHER_PROVIDER_PRIMARY, lat, lon, bucket);
  const canFallback = Boolean(env.WEATHERAPI_KEY);
  const needsTimezone = primary.ok && !primary.isStale && !primary.timezone;
  const needsTemp = primary.ok && !primary.isStale && primary.tempC === null;

  if (!canFallback && (primary.ok || primary.isStale)) {
    return primary;
  }

  if (canFallback && (needsTimezone || needsTemp)) {
    const fallback = await fetchWeatherForecastWithProvider(env, WEATHER_PROVIDER_FALLBACK, lat, lon, bucket);
    if (fallback.ok || fallback.isStale) {
      return fallback;
    }
  }

  if (!canFallback) {
    return primary;
  }

  if (primary.ok || primary.isStale) {
    return primary;
  }

  const fallback = await fetchWeatherForecastWithProvider(env, WEATHER_PROVIDER_FALLBACK, lat, lon, bucket);
  return fallback.ok || fallback.isStale ? fallback : primary;
}

async function fetchWeatherForecastWithProvider(
  env: Env,
  provider: string,
  lat: number,
  lon: number,
  bucket: { keyTime: string; apiTime: string; dateString: string }
): Promise<WeatherForecastResult> {
  const debug: WeatherFetchDebug = {
    target_time: bucket.apiTime,
    date_string: bucket.dateString,
    forecast_status: null,
    time_index: null
  };
  const key = buildWeatherCacheKey(provider, lat, lon, bucket.keyTime);
  const now = Date.now();

  const cacheEntry = weatherCache.get(key) ?? null;
  if (cacheEntry && now <= cacheEntry.expiresAt) {
    if (cacheEntry.isError) {
      logWeatherFetch({
        key,
        cacheHit: true,
        cacheState: "fresh",
        outboundRequest: false,
        statusCode: cacheEntry.statusCode ?? null,
        latencyMs: 0,
        attempts: 0,
        retryAfterSec: null,
        isStale: false
      });
      return {
        ok: false,
        value: null,
        condition: null,
        tempC: null,
        timezone: null,
        cacheState: "fresh",
        isStale: false,
        rateLimitedLocally: true,
        key,
        provider,
        debug,
        statusCode: cacheEntry.statusCode ?? null
      };
    }
    logWeatherFetch({
      key,
      cacheHit: true,
      cacheState: "fresh",
      outboundRequest: false,
      statusCode: null,
      latencyMs: 0,
      attempts: 0,
      retryAfterSec: null,
      isStale: false
    });
    return {
      ok: true,
      value: cacheEntry.value,
      condition: cacheEntry.condition,
      tempC: cacheEntry.tempC,
      timezone: cacheEntry.timezone,
      cacheState: "fresh",
      isStale: false,
      rateLimitedLocally: false,
      key,
      provider,
      debug
    };
  }

  const staleEntry = cacheEntry && now <= cacheEntry.staleUntil ? cacheEntry : null;

  const cooldownUntilMs = weatherCooldownUntilMs.get(provider) ?? 0;
  if (now < cooldownUntilMs) {
    const cooldownUntil = new Date(cooldownUntilMs).toISOString();
    if (staleEntry) {
      logWeatherFetch({
        key,
        cacheHit: true,
        cacheState: "stale",
        outboundRequest: false,
        statusCode: null,
        latencyMs: 0,
        attempts: 0,
        retryAfterSec: null,
        isStale: true
      });
      return {
        ok: true,
        value: staleEntry.value,
        condition: staleEntry.condition,
        tempC: staleEntry.tempC,
        timezone: staleEntry.timezone,
        cacheState: "stale",
        isStale: true,
        rateLimitedLocally: true,
        key,
        provider,
        debug,
        cooldownUntil
      };
    }
    logWeatherFetch({
      key,
      cacheHit: false,
      cacheState: "miss",
      outboundRequest: false,
      statusCode: 429,
      latencyMs: 0,
      attempts: 0,
      retryAfterSec: null,
      isStale: false
    });
    return {
      ok: false,
      value: null,
      condition: null,
      tempC: null,
      timezone: null,
      cacheState: "miss",
      isStale: false,
      rateLimitedLocally: true,
      key,
      provider,
      debug,
      statusCode: 429,
      cooldownUntil
    };
  }

  const inFlight = weatherInFlight.get(key);
  if (inFlight) {
    const shared = await inFlight;
    if (shared.ok) {
      logWeatherFetch({
        key,
        cacheHit: false,
        cacheState: "miss",
        outboundRequest: false,
        statusCode: shared.status ?? null,
        latencyMs: 0,
        attempts: shared.attempts,
        retryAfterSec: shared.retryAfterSec ?? null,
        isStale: false
      });
      return {
        ok: true,
        value: shared.value,
        condition: shared.condition ?? null,
        tempC: shared.tempC ?? null,
        timezone: shared.timezone ?? null,
        cacheState: "miss",
        isStale: false,
        rateLimitedLocally: false,
        key,
        provider,
        debug: shared.debug,
        attempts: shared.attempts,
        retryAfterSec: shared.retryAfterSec ?? null,
        statusCode: shared.status ?? null
      };
    }
    if (staleEntry) {
      logWeatherFetch({
        key,
        cacheHit: true,
        cacheState: "stale",
        outboundRequest: false,
        statusCode: shared.status ?? null,
        latencyMs: 0,
        attempts: shared.attempts,
        retryAfterSec: shared.retryAfterSec ?? null,
        isStale: true
      });
      return {
        ok: true,
        value: staleEntry.value,
        condition: staleEntry.condition,
        tempC: staleEntry.tempC,
        timezone: staleEntry.timezone,
        cacheState: "stale",
        isStale: true,
        rateLimitedLocally: false,
        key,
        provider,
        debug: shared.debug,
        attempts: shared.attempts,
        retryAfterSec: shared.retryAfterSec ?? null,
        statusCode: shared.status ?? null
      };
    }
    return {
      ok: false,
      value: null,
      condition: null,
      tempC: null,
      timezone: null,
      cacheState: "miss",
      isStale: false,
      rateLimitedLocally: false,
      key,
      provider,
      debug: shared.debug,
      attempts: shared.attempts,
      retryAfterSec: shared.retryAfterSec ?? null,
      statusCode: shared.status ?? null
    };
  }

  if (!weatherRateLimiter.allow(env)) {
    if (staleEntry) {
      logWeatherFetch({
        key,
        cacheHit: true,
        cacheState: "stale",
        outboundRequest: false,
        statusCode: null,
        latencyMs: 0,
        attempts: 0,
        retryAfterSec: null,
        isStale: true
      });
      return {
        ok: true,
        value: staleEntry.value,
        condition: staleEntry.condition,
        tempC: staleEntry.tempC,
        timezone: staleEntry.timezone,
        cacheState: "stale",
        isStale: true,
        rateLimitedLocally: true,
        key,
        provider,
        debug
      };
    }
    logWeatherFetch({
      key,
      cacheHit: false,
      cacheState: "miss",
      outboundRequest: false,
      statusCode: null,
      latencyMs: 0,
      attempts: 0,
      retryAfterSec: null,
      isStale: false
    });
    return {
      ok: false,
      value: null,
      condition: null,
      tempC: null,
      timezone: null,
      cacheState: "miss",
      isStale: false,
      rateLimitedLocally: true,
      key,
      provider,
      debug
    };
  }

  const start = Date.now();
  const outboundPromise =
    provider === WEATHER_PROVIDER_FALLBACK
      ? fetchWeatherApiProbability(env, lat, lon, bucket)
      : fetchOpenMeteoProbability(env, lat, lon, bucket);
  weatherInFlight.set(key, outboundPromise);
  const result = await outboundPromise.finally(() => {
    weatherInFlight.delete(key);
  });

  const latencyMs = Date.now() - start;

  if (result.ok) {
    const ttlMin = getWeatherCacheTtlMin(env);
    const staleHours = getWeatherStaleTtlHours(env);
    const entry: WeatherCacheEntry = {
      value: result.value,
      condition: result.condition ?? null,
      tempC: result.tempC ?? null,
      timezone: result.timezone ?? null,
      fetchedAt: Date.now(),
      expiresAt: Date.now() + ttlMin * 60 * 1000,
      staleUntil: Date.now() + staleHours * 60 * 60 * 1000
    };
    weatherCache.set(key, entry);
    logWeatherFetch({
      key,
      cacheHit: false,
      cacheState: "miss",
      outboundRequest: true,
      statusCode: result.status ?? null,
      latencyMs,
      attempts: result.attempts,
      retryAfterSec: result.retryAfterSec ?? null,
      isStale: false
    });
    return {
      ok: true,
      value: result.value,
      condition: result.condition ?? null,
      tempC: result.tempC ?? null,
      timezone: result.timezone ?? null,
      cacheState: "miss",
      isStale: false,
      rateLimitedLocally: false,
      key,
      provider,
      debug: result.debug,
      attempts: result.attempts,
      retryAfterSec: result.retryAfterSec ?? null,
      statusCode: result.status ?? null
    };
  }

  if (result.status === 429) {
    const retryAfterMs = (result.retryAfterSec ?? 30) * 1000;
    const nextAllowed = Date.now() + Math.min(retryAfterMs, getWeatherRetryDelayCapMs(env));
    const existingCooldown = weatherCooldownUntilMs.get(provider) ?? 0;
    weatherCooldownUntilMs.set(provider, Math.max(existingCooldown, nextAllowed));
  }

  if (staleEntry) {
    logWeatherFetch({
      key,
      cacheHit: true,
      cacheState: "stale",
      outboundRequest: true,
      statusCode: result.status ?? null,
      latencyMs,
      attempts: result.attempts,
      retryAfterSec: result.retryAfterSec ?? null,
      isStale: true
    });
    return {
      ok: true,
      value: staleEntry.value,
      condition: staleEntry.condition,
      tempC: staleEntry.tempC,
      timezone: staleEntry.timezone,
      cacheState: "stale",
      isStale: true,
      rateLimitedLocally: false,
      key,
      provider,
      debug: result.debug,
      attempts: result.attempts,
      retryAfterSec: result.retryAfterSec ?? null,
      statusCode: result.status ?? null,
      cooldownUntil: (weatherCooldownUntilMs.get(provider) ?? 0)
        ? new Date(weatherCooldownUntilMs.get(provider) ?? 0).toISOString()
        : null
    };
  }

  const ttlMin = getWeatherCacheTtlMin(env);
  const staleHours = getWeatherStaleTtlHours(env);
  weatherCache.set(key, {
    value: null,
    condition: null,
    tempC: null,
    timezone: null,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + ttlMin * 60 * 1000,
    staleUntil: Date.now() + staleHours * 60 * 60 * 1000,
    isError: true,
    statusCode: result.status ?? null
  });
  logWeatherFetch({
    key,
    cacheHit: false,
    cacheState: "miss",
    outboundRequest: true,
    statusCode: result.status ?? null,
    latencyMs,
    attempts: result.attempts,
    retryAfterSec: result.retryAfterSec ?? null,
    isStale: false
  });
  return {
    ok: false,
    value: null,
    condition: null,
    tempC: null,
    timezone: null,
    cacheState: "miss",
    isStale: false,
    rateLimitedLocally: false,
    key,
    provider,
    debug: result.debug,
    attempts: result.attempts,
    retryAfterSec: result.retryAfterSec ?? null,
    statusCode: result.status ?? null,
    cooldownUntil: (weatherCooldownUntilMs.get(provider) ?? 0)
      ? new Date(weatherCooldownUntilMs.get(provider) ?? 0).toISOString()
      : null
  };
}

function buildWeatherCacheKey(provider: string, lat: number, lon: number, utcHour: string | null): string {
  if (!utcHour) {
    return "";
  }
  const latRounded = roundCoord(lat, 4);
  const lonRounded = roundCoord(lon, 4);
  return `weather:${provider}:${latRounded}:${lonRounded}:${utcHour}:${WEATHER_UNITS}:${WEATHER_LANG}`;
}

function roundCoord(value: number, digits: number): string {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded.toFixed(digits);
}

function getUtcHourBucket(value: string): { keyTime: string; apiTime: string; dateString: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const minutes = date.getUTCMinutes();
  const rounded = new Date(date.getTime());
  if (minutes >= 30) {
    rounded.setUTCHours(rounded.getUTCHours() + 1);
  }
  rounded.setUTCMinutes(0, 0, 0);
  const iso = rounded.toISOString();
  const dateString = iso.slice(0, 10);
  const hour = iso.slice(0, 13);
  return {
    keyTime: `${hour}:00Z`,
    apiTime: `${hour}:00`,
    dateString
  };
}

function getWeatherCacheTtlMin(env: Env): number {
  return parseEnvNumber(env.WEATHER_CACHE_TTL_MIN, 60);
}

function getWeatherStaleTtlHours(env: Env): number {
  return parseEnvNumber(env.WEATHER_STALE_TTL_H, 24);
}

function getWeatherRetryMaxAttempts(env: Env): number {
  return Math.max(1, parseEnvNumber(env.WEATHER_RETRY_MAX_ATTEMPTS, 4));
}

function getWeatherRetryBaseDelayMs(env: Env): number {
  return Math.max(0, parseEnvNumber(env.WEATHER_RETRY_BASE_DELAY_MS, 1000));
}

function getWeatherRetryDelayCapMs(env: Env): number {
  return Math.max(0, parseEnvNumber(env.WEATHER_RETRY_DELAY_CAP_MS, 30000));
}

function getWeatherRateLimitPer5s(env: Env): number {
  return Math.max(1, parseEnvNumber(env.WEATHER_RATE_LIMIT_PER_5S, 1));
}

function getWeatherRateLimitPerMin(env: Env): number {
  return Math.max(1, parseEnvNumber(env.WEATHER_RATE_LIMIT_PER_MIN, 10));
}

function getWeatherDbRefreshMin(env: Env): number {
  return Math.max(5, parseEnvNumber(env.WEATHER_DB_REFRESH_MIN, WEATHER_DB_REFRESH_MIN));
}

function getWeatherDbLookaheadHours(env: Env): number {
  return Math.max(1, parseEnvNumber(env.WEATHER_DB_LOOKAHEAD_H, WEATHER_DB_LOOKAHEAD_HOURS));
}

function getWeatherDbRefreshLimit(env: Env): number {
  return Math.max(1, parseEnvNumber(env.WEATHER_DB_REFRESH_LIMIT, WEATHER_DB_REFRESH_LIMIT));
}

function createRateLimiter(): {
  allow: (env: Env) => boolean;
} {
  let last5s: number[] = [];
  let lastMin: number[] = [];
  return {
    allow: (env: Env) => {
      const now = Date.now();
      const window5s = 5000;
      const windowMin = 60000;
      const limit5s = getWeatherRateLimitPer5s(env);
      const limitMin = getWeatherRateLimitPerMin(env);
      last5s = last5s.filter((ts) => now - ts < window5s);
      lastMin = lastMin.filter((ts) => now - ts < windowMin);
      if (last5s.length >= limit5s || lastMin.length >= limitMin) {
        return false;
      }
      last5s.push(now);
      lastMin.push(now);
      return true;
    }
  };
}

function logWeatherFetch(payload: {
  key: string;
  cacheHit: boolean;
  cacheState: "fresh" | "stale" | "miss";
  outboundRequest: boolean;
  statusCode: number | null;
  latencyMs: number;
  attempts: number;
  retryAfterSec: number | null;
  isStale: boolean;
}): void {
  console.info("weather.fetch", {
    key: payload.key,
    cache_hit: payload.cacheHit,
    cache_state: payload.cacheState,
    outbound_request: payload.outboundRequest,
    status_code: payload.statusCode,
    latency_ms: payload.latencyMs,
    attempts: payload.attempts,
    retry_after_sec: payload.retryAfterSec,
    is_stale: payload.isStale
  });
}
async function fetchMatchWeather(
  env: Env,
  supabase: SupabaseClient,
  match: DbMatch
): Promise<WeatherResult> {
  const detailed = await fetchMatchWeatherDetailed(env, supabase, match);
  if (!detailed.ok) {
    return { ok: false, reason: detailed.reason };
  }
  return {
    ok: true,
    rainProbability: detailed.rainProbability,
    condition: detailed.condition,
    tempC: detailed.tempC,
    timezone: detailed.timezone
  };
}

async function fetchMatchWeatherDetailed(
  env: Env,
  supabase: SupabaseClient,
  match: DbMatch
): Promise<WeatherDetailedResult> {
  const debug: WeatherDebugInfo = {
    venue_city: match.venue_city ?? null,
    venue_name: match.venue_name ?? null,
    venue_lat: match.venue_lat ?? null,
    venue_lon: match.venue_lon ?? null,
    kickoff_at: match.kickoff_at ?? null,
    rain_probability: match.rain_probability ?? null,
    weather_fetched_at: match.weather_fetched_at ?? null
  };
  if (!match.kickoff_at) {
    return { ok: false, reason: "bad_kickoff", debug };
  }

  let lat = match.venue_lat ?? null;
  let lon = match.venue_lon ?? null;
  const city = match.venue_city ?? match.venue_name ?? null;

  if ((!lat || !lon) && city) {
    debug.geocode_city = city;
    const geo = await geocodeCity(city);
    debug.geocode_status = geo.status;
    debug.geocode_ok = geo.ok;
    if (geo.ok) {
      lat = geo.lat;
      lon = geo.lon;
      debug.venue_lat = lat;
      debug.venue_lon = lon;
      await saveMatchCoordinates(supabase, match.id, geo.lat, geo.lon);
    }
  }

  if (!lat || !lon) {
    return { ok: false, reason: "missing_location", debug };
  }

  const forecast = await fetchWeatherForecast(env, lat, lon, match.kickoff_at);
  debug.cache_state = forecast.cacheState;
  debug.weather_key = forecast.key;
  debug.is_stale = forecast.isStale;
  debug.rate_limited_locally = forecast.rateLimitedLocally;
  debug.cache_used = forecast.cacheState !== "miss";
  debug.retry_after_sec = forecast.retryAfterSec ?? null;
  debug.attempts = forecast.attempts ?? null;
  debug.status_code = forecast.statusCode ?? null;
  debug.cooldown_until = forecast.cooldownUntil ?? null;
  debug.target_time = forecast.debug.target_time;
  debug.date_string = forecast.debug.date_string;
  debug.forecast_status = forecast.debug.forecast_status;
  debug.time_index = forecast.debug.time_index;
  if (!forecast.ok) {
    return { ok: false, reason: forecast.rateLimitedLocally ? "rate_limited" : "api_error", debug };
  }

  if (!forecast.isStale) {
    await saveMatchWeatherCache(
      supabase,
      match.id,
      forecast.value ?? null,
      forecast.condition ?? null,
      forecast.tempC ?? null,
      forecast.timezone ?? null
    );
  }
  return {
    ok: true,
    rainProbability: forecast.value,
    condition: forecast.condition ?? null,
    tempC: forecast.tempC ?? null,
    timezone: forecast.timezone ?? null,
    debug
  };
}

async function geocodeCity(city: string): Promise<GeocodeResult> {
  const trimmed = city.trim();
  if (!trimmed) {
    return { ok: false, status: 0 };
  }
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=uk&format=json`;
  const response = await fetch(url);
  const status = response.status;
  if (!response.ok) {
    console.warn("Open-Meteo geocoding error", response.status);
    return { ok: false, status };
  }
  try {
    const payload = (await response.json()) as { results?: Array<{ latitude?: number; longitude?: number }> };
    const first = payload.results?.[0];
    const lat = first?.latitude;
    const lon = first?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") {
      return { ok: false, status };
    }
    return { ok: true, lat, lon, status };
  } catch (error) {
    console.warn("Open-Meteo geocoding parse error", error);
    return { ok: false, status };
  }
}

async function fetchOpenMeteoProbability(
  env: Env,
  lat: number,
  lon: number,
  bucket: { apiTime: string; dateString: string }
): Promise<WeatherFetchResult> {
  const debug: WeatherFetchDebug = {
    target_time: bucket.apiTime,
    date_string: bucket.dateString,
    forecast_status: null,
    time_index: null
  };

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}` +
    `&longitude=${encodeURIComponent(String(lon))}` +
    "&hourly=precipitation_probability,weathercode&timezone=UTC" +
    `&start_date=${encodeURIComponent(bucket.dateString)}` +
    `&end_date=${encodeURIComponent(bucket.dateString)}`;

  const maxAttempts = getWeatherRetryMaxAttempts(env);
  const baseDelayMs = getWeatherRetryBaseDelayMs(env);
  const delayCapMs = getWeatherRetryDelayCapMs(env);
  let attempt = 0;
  let lastStatus: number | null = null;
  let lastRetryAfter: number | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const started = Date.now();
    const response = await fetch(url);
    lastStatus = response.status;
    debug.forecast_status = response.status;
    const retryAfterHeader = response.headers.get("Retry-After");
    lastRetryAfter = parseRetryAfterSeconds(retryAfterHeader);

    if (response.ok) {
      try {
        const payload = (await response.json()) as {
          hourly?: {
            time?: string[];
            precipitation_probability?: Array<number | null>;
            weathercode?: Array<number | null>;
            temperature_2m?: Array<number | null>;
          };
        };
        const times = payload.hourly?.time ?? [];
        const probabilities = payload.hourly?.precipitation_probability ?? [];
        const weatherCodes = payload.hourly?.weathercode ?? [];
        const temperatures = payload.hourly?.temperature_2m ?? [];
        const index = findClosestTimeIndex(times, bucket.apiTime);
        debug.time_index = index;
        if (index < 0 || index >= probabilities.length) {
          return {
            ok: true,
            value: null,
            condition: null,
            tempC: null,
            timezone: null,
            debug,
            attempts: attempt,
            retryAfterSec: lastRetryAfter,
            status: lastStatus
          };
        }
        const value = probabilities[index];
        const condition = normalizeOpenMeteoCondition(weatherCodes[index] ?? null);
        const tempC = temperatures[index] ?? null;
        return {
          ok: true,
          value: typeof value === "number" ? value : null,
          condition,
          tempC: typeof tempC === "number" ? tempC : null,
          timezone: null,
          debug,
          attempts: attempt,
          retryAfterSec: lastRetryAfter,
          status: lastStatus
        };
      } catch (error) {
        console.warn("Open-Meteo forecast parse error", error);
        return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
      }
    }

    if (!shouldRetryWeather(response.status) || attempt >= maxAttempts) {
      console.warn("Open-Meteo forecast error", response.status);
      return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
    }

    const waitMs = computeRetryDelayMs(baseDelayMs, attempt, lastRetryAfter, delayCapMs);
    await sleep(waitMs - (Date.now() - started));
  }

  return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
}

function shouldRetryWeather(status: number): boolean {
  return status === 429 || status === 408 || status === 502 || status === 503 || status === 504;
}

function computeRetryDelayMs(
  baseDelayMs: number,
  attempt: number,
  retryAfterSec: number | null,
  capMs: number
): number {
  const backoff = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = backoff * (Math.random() * 0.3);
  const delay = backoff + jitter;
  const retryAfterMs = retryAfterSec ? retryAfterSec * 1000 : 0;
  const combined = Math.max(retryAfterMs, delay);
  return Math.min(capMs, combined);
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const diffMs = date.getTime() - Date.now();
  return diffMs > 0 ? Math.ceil(diffMs / 1000) : 0;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findClosestTimeIndex(times: string[], target: string): number {
  if (!times.length) {
    return -1;
  }
  const targetMs = Date.parse(`${target}Z`);
  if (Number.isNaN(targetMs)) {
    return -1;
  }
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const value = Date.parse(`${times[i]}Z`);
    if (Number.isNaN(value)) {
      continue;
    }
    const diff = Math.abs(value - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function findClosestHourEntry<T extends { time_epoch?: number }>(
  hours: T[],
  targetEpochMs: number
): { entry: T | null; index: number } {
  if (!hours.length || Number.isNaN(targetEpochMs)) {
    return { entry: null, index: -1 };
  }
  const targetEpoch = Math.floor(targetEpochMs / 1000);
  let best: T | null = null;
  let bestIndex = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hours.length; i += 1) {
    const entry = hours[i];
    const epoch = entry.time_epoch;
    if (typeof epoch !== "number") {
      continue;
    }
    const diff = Math.abs(epoch - targetEpoch);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = entry;
      bestIndex = i;
    }
  }
  return { entry: best, index: bestIndex };
}

function normalizeOpenMeteoCondition(code: number | null): string | null {
  if (code === null || Number.isNaN(code)) {
    return null;
  }
  if (code === 0) {
    return "clear";
  }
  if (code === 1 || code === 2) {
    return "partly_cloudy";
  }
  if (code === 3) {
    return "cloudy";
  }
  if (code === 45 || code === 48) {
    return "fog";
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 86)) {
    return "rain";
  }
  if (code >= 71 && code <= 77) {
    return "snow";
  }
  if (code >= 95 && code <= 99) {
    return "thunderstorm";
  }
  return null;
}

function normalizeWeatherApiCondition(code: number | undefined, text: string | undefined): string | null {
  if (typeof code === "number") {
    if ([1087, 1273, 1276, 1279, 1282].includes(code)) {
      return "thunderstorm";
    }
    if (
      code === 1066 ||
      code === 1069 ||
      code === 1072 ||
      code === 1114 ||
      code === 1117 ||
      (code >= 1210 && code <= 1225) ||
      (code >= 1255 && code <= 1264)
    ) {
      return "snow";
    }
    if (
      code === 1063 ||
      code === 1150 ||
      code === 1153 ||
      (code >= 1180 && code <= 1201) ||
      (code >= 1240 && code <= 1246)
    ) {
      return "rain";
    }
    if (code === 1030 || code === 1135 || code === 1147) {
      return "fog";
    }
    if (code === 1009 || code === 1006) {
      return "cloudy";
    }
    if (code === 1003) {
      return "partly_cloudy";
    }
    if (code === 1000) {
      return "clear";
    }
  }

  const textValue = text?.toLowerCase() ?? "";
  if (!textValue) {
    return null;
  }
  if (textValue.includes("thunder")) {
    return "thunderstorm";
  }
  if (textValue.includes("snow") || textValue.includes("sleet")) {
    return "snow";
  }
  if (textValue.includes("rain") || textValue.includes("shower") || textValue.includes("drizzle")) {
    return "rain";
  }
  if (textValue.includes("fog") || textValue.includes("mist")) {
    return "fog";
  }
  if (textValue.includes("cloud")) {
    return textValue.includes("partly") ? "partly_cloudy" : "cloudy";
  }
  if (textValue.includes("clear") || textValue.includes("sunny")) {
    return "clear";
  }
  return null;
}

async function fetchWeatherApiProbability(
  env: Env,
  lat: number,
  lon: number,
  bucket: { apiTime: string; dateString: string }
): Promise<WeatherFetchResult> {
  const debug: WeatherFetchDebug = {
    target_time: bucket.apiTime,
    date_string: bucket.dateString,
    forecast_status: null,
    time_index: null
  };
  const key = env.WEATHERAPI_KEY?.trim();
  if (!key) {
    return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: 0 };
  }

  const base = env.WEATHERAPI_BASE?.trim() || "https://api.weatherapi.com";
  const maxAttempts = getWeatherRetryMaxAttempts(env);
  const baseDelayMs = getWeatherRetryBaseDelayMs(env);
  const delayCapMs = getWeatherRetryDelayCapMs(env);
  const daysAhead = getDaysAheadUtc(bucket.dateString);
  if (daysAhead === null || daysAhead > 10) {
    return { ok: true, value: null, condition: null, tempC: null, timezone: null, debug, attempts: 0, status: 0 };
  }
  const daysParam = Math.max(1, daysAhead + 1);
  const url =
    `${base}/v1/forecast.json?key=${encodeURIComponent(key)}` +
    `&q=${encodeURIComponent(`${lat},${lon}`)}` +
    `&days=${encodeURIComponent(String(daysParam))}` +
    "&aqi=no&alerts=no";

  let attempt = 0;
  let lastStatus: number | null = null;
  let lastRetryAfter: number | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(url);
    lastStatus = response.status;
    debug.forecast_status = response.status;
    const retryAfterHeader = response.headers.get("Retry-After");
    lastRetryAfter = parseRetryAfterSeconds(retryAfterHeader);

    if (response.ok) {
      try {
        const payload = (await response.json()) as {
          location?: { tz_id?: string };
          forecast?: {
            forecastday?: Array<{
              date?: string;
              hour?: Array<{
                time?: string;
                time_epoch?: number;
                chance_of_rain?: number | null;
                temp_c?: number | null;
                condition?: { code?: number; text?: string };
              }>;
            }>;
          };
        };
        const timezone = payload.location?.tz_id ?? null;
        const forecastDays = payload.forecast?.forecastday ?? [];
        const day = forecastDays.find((entry) => entry.date === bucket.dateString);
        const hours = day?.hour ?? [];
        const targetEpoch = Date.parse(`${bucket.keyTime}`);
        const closest = findClosestHourEntry(hours, targetEpoch);
        const value = closest.entry?.chance_of_rain;
        const tempC = closest.entry?.temp_c;
        const condition = normalizeWeatherApiCondition(closest.entry?.condition?.code, closest.entry?.condition?.text);
        debug.time_index = closest.index;
        return {
          ok: true,
          value: typeof value === "number" ? value : null,
          condition,
          tempC: typeof tempC === "number" ? tempC : null,
          timezone,
          debug,
          attempts: attempt,
          retryAfterSec: lastRetryAfter,
          status: lastStatus
        };
      } catch (error) {
        console.warn("WeatherAPI parse error", error);
        return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
      }
    }

    if (!shouldRetryWeather(response.status) || attempt >= maxAttempts) {
      console.warn("WeatherAPI error", response.status);
      return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
    }

    const waitMs = computeRetryDelayMs(baseDelayMs, attempt, lastRetryAfter, delayCapMs);
    await sleep(waitMs);
  }

  return { ok: false, condition: null, tempC: null, timezone: null, debug, attempts: attempt, retryAfterSec: lastRetryAfter, status: lastStatus };
}

function getDaysAheadUtc(targetDate: string): number | null {
  const date = new Date(`${targetDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffMs = date.getTime() - todayUtc;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeTeamKey(value: string): string {
  const normalized = normalizeTeamName(value);
  return TEAM_MATCH_ALIASES[normalized] ?? normalized;
}

function getTeamSearchQuery(teamName: string): string {
  const normalized = normalizeTeamName(teamName);
  return TEAM_SEARCH_ALIASES[normalized] ?? teamName;
}

function getTeamSearchQueries(teamName: string): string[] {
  const alias = getTeamSearchQuery(teamName);
  const queries = [alias, teamName].filter(Boolean);
  return Array.from(new Set(queries));
}

function isWomenTeamName(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return (
    /(^|\s)(w|women|ladies|femenino|femminile)($|\s)/.test(lower)
    || lower.endsWith(" w")
  );
}

function isYouthTeamName(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return /(^|\s)u\d{2}($|\s)/.test(lower) || /(^|\s)primavera($|\s)/.test(lower);
}

function getTeamMatchScore(target: string, candidate: string, targetRaw: string, candidateRaw: string): number {
  if (!target || !candidate) {
    return 0;
  }
  let score = 0;
  if (candidate === target) {
    score += 6;
  }
  if (candidate.startsWith(target) || target.startsWith(candidate)) {
    score += 3;
  }
  if (candidate.includes(target) || target.includes(candidate)) {
    score += 1;
  }
  const targetWomen = isWomenTeamName(targetRaw);
  const candidateWomen = isWomenTeamName(candidateRaw);
  if (!targetWomen && candidateWomen) {
    score -= 5;
  }
  const targetYouth = isYouthTeamName(targetRaw);
  const candidateYouth = isYouthTeamName(candidateRaw);
  if (!targetYouth && candidateYouth) {
    score -= 3;
  }
  return score;
}

async function listMatches(supabase: SupabaseClient, date?: string): Promise<DbMatch[] | null> {
  try {
    let query = supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at"
      )
      .in("status", ["scheduled", "finished"])
      .order("kickoff_at", { ascending: true });

    if (date) {
      const range = getKyivDayRange(date);
      if (range) {
        query = query.gte("kickoff_at", range.start).lte("kickoff_at", range.end);
      }
    }

    const { data, error } = await query;
    if (error) {
      console.error("Failed to list matches", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list matches", error);
    return null;
  }
}

async function listPendingMatches(supabase: SupabaseClient): Promise<DbMatch[] | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at"
      )
      .eq("status", "pending")
      .order("id", { ascending: false });

    if (error) {
      console.error("Failed to list pending matches", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list pending matches", error);
    return null;
  }
}

async function listUserPredictedMatches(
  supabase: SupabaseClient,
  userId: number,
  matchIds: number[]
): Promise<Set<number>> {
  if (!matchIds.length) {
    return new Set();
  }

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("match_id")
      .eq("user_id", userId)
      .in("match_id", matchIds);

    if (error) {
      console.error("Failed to fetch user predictions", error);
      return new Set();
    }

    return new Set((data as Array<{ match_id: number }>).map((row) => row.match_id));
  } catch (error) {
    console.error("Failed to fetch user predictions", error);
    return new Set();
  }
}

async function getMatch(supabase: SupabaseClient, matchId: number): Promise<DbMatch | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage"
      )
      .eq("id", matchId)
      .single();
    if (error || !data) {
      return null;
    }

    return data as DbMatch;
  } catch {
    return null;
  }
}

function canPredict(kickoffAt?: string | null): boolean {
  if (!kickoffAt) {
    return false;
  }
  const kickoffMs = new Date(kickoffAt).getTime();
  if (Number.isNaN(kickoffMs)) {
    return false;
  }
  const cutoffMs = kickoffMs - PREDICTION_CUTOFF_MS;
  return Date.now() <= cutoffMs;
}

function getPredictionCloseAt(kickoffAt?: string | null): string | null {
  if (!kickoffAt) {
    return null;
  }
  const kickoffMs = new Date(kickoffAt).getTime();
  if (Number.isNaN(kickoffMs)) {
    return null;
  }
  return new Date(kickoffMs - PREDICTION_CUTOFF_MS).toISOString();
}

async function findPrediction(
  supabase: SupabaseClient,
  userId: number,
  matchId: number
): Promise<DbPrediction | null> {
  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("id, user_id, match_id, home_pred, away_pred, points")
      .eq("user_id", userId)
      .eq("match_id", matchId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as DbPrediction;
  } catch (error) {
    console.error("Failed to fetch prediction", error);
    return null;
  }
}

async function insertPrediction(
  supabase: SupabaseClient,
  userId: number,
  matchId: number,
  payload: PredictionPayload
): Promise<DbPrediction | null> {
  const home = parseInteger(payload.home_pred);
  const away = parseInteger(payload.away_pred);
  if (home === null || away === null) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("predictions")
      .insert({
        user_id: userId,
        match_id: matchId,
        home_pred: home,
        away_pred: away,
        updated_at: new Date().toISOString()
      })
      .select("id, user_id, match_id, home_pred, away_pred, points")
      .single();

    if (error) {
      console.error("Failed to save prediction", error);
      return null;
    }

    return data as DbPrediction;
  } catch (error) {
    console.error("Failed to save prediction", error);
    return null;
  }
}

async function applyMatchResult(
  supabase: SupabaseClient,
  matchId: number,
  homeScore: number,
  awayScore: number,
  homeRating: number,
  awayRating: number
): Promise<MatchResultOutcome> {
  const match = await getMatch(supabase, matchId);
  if (!match) {
    return { ok: false, notifications: [] };
  }

  const { error: updateError } = await supabase
    .from("matches")
    .update({
      home_score: homeScore,
      away_score: awayScore,
      status: "finished"
    })
    .eq("id", matchId);

  if (updateError) {
    console.error("Failed to update match", updateError);
    return { ok: false, notifications: [] };
  }

  const statsOk = await upsertTeamMatchStats(
    supabase,
    match,
    homeScore,
    awayScore,
    homeRating,
    awayRating
  );
  if (!statsOk) {
    return { ok: false, notifications: [] };
  }

  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select("id, user_id, home_pred, away_pred, points")
    .eq("match_id", matchId);

  if (predError) {
    console.error("Failed to fetch predictions", predError);
    return { ok: false, notifications: [] };
  }

  const deltas = new Map<number, number>();
  const updates: Array<{ id: number; points: number }> = [];
  const predictedUserIds = new Set<number>();

  for (const prediction of (predictions as DbPrediction[]) ?? []) {
    predictedUserIds.add(prediction.user_id);
    const currentPoints = prediction.points ?? 0;
    const newPoints = scorePrediction(
      prediction.home_pred,
      prediction.away_pred,
      homeScore,
      awayScore
    );
    if (newPoints !== currentPoints) {
      updates.push({ id: prediction.id, points: newPoints });
      const delta = newPoints - currentPoints;
      deltas.set(prediction.user_id, (deltas.get(prediction.user_id) ?? 0) + delta);
    }
  }

  for (const update of updates) {
    const { error } = await supabase.from("predictions").update({ points: update.points }).eq("id", update.id);
    if (error) {
      console.error("Failed to update prediction points", error);
    }
  }

  const notifications: MatchResultNotification[] = [];
  if (deltas.size > 0) {
    const userIds = Array.from(deltas.keys());
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, points_total")
      .in("id", userIds);

    if (usersError) {
      console.error("Failed to fetch users for scoring", usersError);
      return { ok: false, notifications: [] };
    }

    for (const user of (users as StoredUser[]) ?? []) {
      const delta = deltas.get(user.id) ?? 0;
      if (delta === 0) {
        continue;
      }
      const nextPoints = (user.points_total ?? 0) + delta;
      const { error } = await supabase
        .from("users")
        .update({ points_total: nextPoints, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        console.error("Failed to update user points", error);
        continue;
      }

      notifications.push({
        user_id: user.id,
        delta,
        total_points: nextPoints,
        home_team: match.home_team,
        away_team: match.away_team,
        home_score: homeScore,
        away_score: awayScore
      });
    }
  }

  const penaltyNotifications = await applyMissingPredictionPenalties(
    supabase,
    match,
    predictedUserIds,
    homeScore,
    awayScore
  );
  notifications.push(...penaltyNotifications);

  return { ok: true, notifications };
}

async function upsertTeamMatchStats(
  supabase: SupabaseClient,
  match: DbMatch,
  homeScore: number,
  awayScore: number,
  homeRating: number,
  awayRating: number
): Promise<boolean> {
  try {
    const matchDate = match.kickoff_at;
    const rows = [
      {
        team_name: match.home_team,
        opponent_name: match.away_team,
        is_home: true,
        team_goals: homeScore,
        opponent_goals: awayScore,
        avg_rating: homeRating
      },
      {
        team_name: match.away_team,
        opponent_name: match.home_team,
        is_home: false,
        team_goals: awayScore,
        opponent_goals: homeScore,
        avg_rating: awayRating
      }
    ];

    for (const row of rows) {
      const { data, error } = await supabase
        .from("team_match_stats")
        .select("id")
        .eq("team_name", row.team_name)
        .eq("opponent_name", row.opponent_name)
        .eq("match_date", matchDate)
        .eq("is_home", row.is_home)
        .limit(1);
      if (error) {
        console.error("Failed to check team_match_stats", error);
        return false;
      }
      const existingId = (data as Array<{ id?: string }> | null)?.[0]?.id ?? null;
      if (existingId) {
        const { error: updateError } = await supabase
          .from("team_match_stats")
          .update({
            team_goals: row.team_goals,
            opponent_goals: row.opponent_goals,
            avg_rating: row.avg_rating
          })
          .eq("id", existingId);
        if (updateError) {
          console.error("Failed to update team_match_stats", updateError);
          return false;
        }
        continue;
      }
      const { error: insertError } = await supabase
        .from("team_match_stats")
        .insert({
          id: crypto.randomUUID(),
          match_date: matchDate,
          team_name: row.team_name,
          opponent_name: row.opponent_name,
          is_home: row.is_home,
          team_goals: row.team_goals,
          opponent_goals: row.opponent_goals,
          avg_rating: row.avg_rating
        });
      if (insertError) {
        console.error("Failed to insert team_match_stats", insertError);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("Failed to save team_match_stats", error);
    return false;
  }
}

async function applyMissingPredictionPenalties(
  supabase: SupabaseClient,
  match: DbMatch,
  predictedUserIds: Set<number>,
  homeScore: number,
  awayScore: number
): Promise<MatchResultNotification[]> {
  try {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, points_total");
    if (usersError) {
      console.error("Failed to fetch users for missing prediction penalties", usersError);
      return [];
    }

    const { data: penalties, error: penaltiesError } = await supabase
      .from("missed_predictions")
      .select("user_id")
      .eq("match_id", match.id);
    if (penaltiesError) {
      console.error("Failed to fetch missing prediction penalties", penaltiesError);
      return [];
    }

    const penalizedUserIds = new Set(
      (penalties as Array<{ user_id: number }> | null | undefined)?.map((row) => row.user_id) ?? []
    );

    const notifications: MatchResultNotification[] = [];
    const now = new Date().toISOString();

    for (const user of (users as StoredUser[]) ?? []) {
      if (predictedUserIds.has(user.id) || penalizedUserIds.has(user.id)) {
        continue;
      }

      const currentPoints = typeof user.points_total === "number" ? user.points_total : STARTING_POINTS;
      const nextPoints = currentPoints + MISSED_PREDICTION_PENALTY;

      const { error: updateError } = await supabase
        .from("users")
        .update({ points_total: nextPoints, updated_at: now })
        .eq("id", user.id);
      if (updateError) {
        console.error("Failed to apply missing prediction penalty", updateError);
        continue;
      }

      const { error: insertError } = await supabase
        .from("missed_predictions")
        .insert({ user_id: user.id, match_id: match.id });
      if (insertError) {
        console.error("Failed to store missing prediction penalty", insertError);
        continue;
      }

      notifications.push({
        user_id: user.id,
        delta: MISSED_PREDICTION_PENALTY,
        total_points: nextPoints,
        home_team: match.home_team,
        away_team: match.away_team,
        home_score: homeScore,
        away_score: awayScore
      });
    }

    return notifications;
  } catch (error) {
    console.error("Failed to apply missing prediction penalties", error);
    return [];
  }
}

async function saveUserOnboarding(
  supabase: SupabaseClient,
  userId: number,
  payload: OnboardingPayload
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        classico_choice: payload.classico_choice ?? null,
        ua_club_id: payload.ua_club_id ?? null,
        eu_club_id: payload.eu_club_id ?? null,
        nickname: payload.nickname ?? null,
        avatar_choice: payload.avatar_choice ?? null,
        logo_order: payload.logo_order ?? null,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);
    if (error) {
      console.error("Failed to save onboarding", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to save onboarding", error);
    return false;
  }
}

async function saveUserAvatarChoice(
  supabase: SupabaseClient,
  userId: number,
  avatarChoice: string | null
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        avatar_choice: avatarChoice ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);
    if (error) {
      console.error("Failed to save avatar choice", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to save avatar choice", error);
    return false;
  }
}

async function saveUserLogoOrder(
  supabase: SupabaseClient,
  userId: number,
  logoOrder: string[]
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        logo_order: logoOrder,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);
    if (error) {
      console.error("Failed to save logo order", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to save logo order", error);
    return false;
  }
}

async function saveUserNickname(
  supabase: SupabaseClient,
  userId: number,
  nickname: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("users")
      .update({
        nickname,
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);
    if (error) {
      console.error("Failed to save nickname", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to save nickname", error);
    return false;
  }
}

function scorePrediction(homePred: number, awayPred: number, homeScore: number, awayScore: number): number {
  if (homePred === homeScore && awayPred === awayScore) {
    return 5;
  }
  return getOutcome(homePred, awayPred) === getOutcome(homeScore, awayScore) ? 1 : -1;
}

function getOutcome(home: number, away: number): "home" | "away" | "draw" {
  if (home === away) {
    return "draw";
  }
  return home > away ? "home" : "away";
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseRating(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 && value <= 10 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed >= 0 && parsed <= 10 ? parsed : null;
  }
  return null;
}

function normalizeClassicoChoice(value: unknown): "real_madrid" | "barcelona" | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value === "real_madrid" || value === "barcelona") {
    return value;
  }
  return null;
}

function normalizeClubId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  return /^[a-z0-9-]+$/.test(trimmed) ? trimmed : null;
}

const MATCH_LEAGUES = new Set([
  "ukrainian-premier-league",
  "uefa-champions-league",
  "uefa-europa-league",
  "uefa-europa-conference-league",
  "english-premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1",
  "fa-cup",
  "copa-del-rey",
  "coppa-italia",
  "dfb-pokal",
  "coupe-de-france"
]);

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
  "nottingham-forest": "Nottingham Forest",
  "como-1907": "Como 1907"
};

let ukrainianClubLookup: Map<string, string> | null = null;

function normalizeLeagueId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  return MATCH_LEAGUES.has(trimmed) ? trimmed : null;
}

function formatClubLabel(slug: string): string {
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

function normalizeClubKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getUkrainianClubLookup(): Map<string, string> {
  if (ukrainianClubLookup) {
    return ukrainianClubLookup;
  }
  const map = new Map<string, string>();
  Object.entries(UKRAINIAN_CLUB_NAMES).forEach(([slug, name]) => {
    const normalizedSlug = normalizeClubKey(slug);
    if (normalizedSlug && !map.has(normalizedSlug)) {
      map.set(normalizedSlug, name);
    }
    const label = formatClubLabel(slug);
    const normalizedLabel = normalizeClubKey(label);
    if (normalizedLabel && !map.has(normalizedLabel)) {
      map.set(normalizedLabel, name);
    }
  });
  ukrainianClubLookup = map;
  return map;
}

function resolveUkrainianClubName(label: string, slug?: string | null): string {
  if (slug) {
    const mapped = UKRAINIAN_CLUB_NAMES[slug];
    if (mapped) {
      return mapped.toUpperCase();
    }
  }
  const normalized = normalizeClubKey(label);
  const mapped = getUkrainianClubLookup().get(normalized);
  if (mapped) {
    return mapped.toUpperCase();
  }
  return label.toUpperCase();
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const AVATAR_LEAGUES = new Set([
  "la-liga",
  "ukrainian-premier-league",
  "english-premier-league",
  "serie-a",
  "bundesliga",
  "ligue-1"
]);

function normalizeAvatarChoice(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    return null;
  }
  const match = /^([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const leagueId = match[1];
  if (!AVATAR_LEAGUES.has(leagueId)) {
    return null;
  }
  return `${leagueId}/${match[2]}`;
}

function getClassicoSlug(choice: string | null): string | null {
  if (choice === "real_madrid") {
    return "real-madrid";
  }
  if (choice === "barcelona") {
    return "barcelona";
  }
  return null;
}

function isAvatarChoiceAllowed(
  avatarChoice: string,
  selections: { classicoChoice: string | null; uaClubId: string | null; euClubId: string | null }
): boolean {
  const parts = avatarChoice.split("/");
  if (parts.length !== 2) {
    return false;
  }
  const clubId = parts[1];
  const allowed = new Set<string>();
  const classicoSlug = getClassicoSlug(selections.classicoChoice);
  if (classicoSlug) {
    allowed.add(classicoSlug);
  }
  if (selections.uaClubId) {
    allowed.add(selections.uaClubId);
  }
  if (selections.euClubId) {
    allowed.add(selections.euClubId);
  }
  return allowed.has(clubId);
}

function normalizeLogoOrder(
  value: unknown,
  selections: { classicoChoice: string | null; uaClubId: string | null; euClubId: string | null }
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      return null;
    }
    const normalized = normalizeAvatarChoice(item);
    if (!normalized) {
      return null;
    }
    if (!isAvatarChoiceAllowed(normalized, selections)) {
      return null;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getExpectedLogoCount(selections: {
  classicoChoice: string | null;
  uaClubId: string | null;
  euClubId: string | null;
}): number {
  let count = 0;
  if (selections.classicoChoice) {
    count += 1;
  }
  if (selections.uaClubId) {
    count += 1;
  }
  if (selections.euClubId) {
    count += 1;
  }
  return count;
}

function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    return null;
  }
  return trimmed;
}

function parseLimit(value: string | null, fallback: number, max: number): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function getKyivDayRange(dateStr: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  const start = getKyivStart(dateStr);
  const nextDate = addDays(dateStr, 1);
  const end = new Date(getKyivStart(nextDate).getTime() - 1);

  return { start: start.toISOString(), end: end.toISOString() };
}

function getKyivStart(dateStr: string): Date {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const offsetMs = getTimeZoneOffset(base, "Europe/Kyiv");
  return new Date(base.getTime() - offsetMs);
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUTC - date.getTime();
}

function addDays(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

async function notifyUsersAboutMatchResult(
  env: Env,
  notifications: MatchResultNotification[]
): Promise<void> {
  for (const notification of notifications) {
    const message = formatMatchResultMessage(notification);
    const imageFile = getMatchResultImageFile(notification.delta);
    if (imageFile) {
      await sendPhoto(
        env,
        notification.user_id,
        buildWebappImageUrl(env, imageFile),
        message,
        {
          inline_keyboard: [[{ text: "ПОДИВИТИСЬ ТАБЛИЦЮ", web_app: { url: env.WEBAPP_URL } }]]
        }
      );
      continue;
    }
    await sendMessage(env, notification.user_id, message);
  }
}

async function handlePredictionReminders(env: Env): Promise<void> {
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Failed to send prediction reminders: missing_supabase");
    return;
  }

  const { start, end } = getPredictionReminderWindow(new Date());
  const matches = await listMatchesForPredictionReminders(supabase, start, end);
  if (!matches || matches.length === 0) {
    return;
  }

  for (const match of matches) {
    const users = await listUsersMissingPrediction(supabase, match.id);
    if (!users) {
      continue;
    }

    if (users.length > 0) {
      const message = formatPredictionReminderMessage(match);
      for (const user of users) {
        await sendMessage(
          env,
          user.id,
          message,
          {
            inline_keyboard: [[{ text: "ПРОГОЛОСУВАТИ", web_app: { url: env.WEBAPP_URL } }]]
          },
          "HTML"
        );
      }
    }

    const { error } = await supabase
      .from("matches")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", match.id)
      .is("reminder_sent_at", null);
    if (error) {
      console.error("Failed to mark prediction reminder sent", error);
    }
  }
}

async function handleWeatherRefresh(env: Env): Promise<void> {
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Failed to refresh weather: missing_supabase");
    return;
  }

  const now = new Date();
  const lookaheadHours = getWeatherDbLookaheadHours(env);
  const refreshMin = getWeatherDbRefreshMin(env);
  const limit = getWeatherDbRefreshLimit(env);
  const end = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);
  const staleBefore = new Date(now.getTime() - refreshMin * 60 * 1000);
  const matches = await listMatchesForWeatherRefresh(supabase, now, end, staleBefore, limit);
  if (!matches || matches.length === 0) {
    return;
  }

  for (const match of matches) {
    const result = await fetchMatchWeatherDetailed(env, supabase, match);
    if (!result.ok) {
      continue;
    }
  }
}

function getPredictionReminderWindow(now: Date): { start: Date; end: Date } {
  const leadMs = PREDICTION_CUTOFF_MS + PREDICTION_REMINDER_BEFORE_CLOSE_MS;
  const start = new Date(now.getTime() + leadMs);
  const end = new Date(start.getTime() + PREDICTION_REMINDER_WINDOW_MS);
  return { start, end };
}

async function listMatchesForPredictionReminders(
  supabase: SupabaseClient,
  start: Date,
  end: Date
): Promise<PredictionReminderMatch[] | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select("id, home_team, away_team, home_club_id, away_club_id, kickoff_at")
      .eq("status", "scheduled")
      .is("reminder_sent_at", null)
      .gte("kickoff_at", start.toISOString())
      .lt("kickoff_at", end.toISOString())
      .order("kickoff_at", { ascending: true });

    if (error) {
      console.error("Failed to list matches for reminders", error);
      return null;
    }

    return (data as PredictionReminderMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list matches for reminders", error);
    return null;
  }
}

async function listMatchesForWeatherRefresh(
  supabase: SupabaseClient,
  start: Date,
  end: Date,
  staleBefore: Date,
  limit: number
): Promise<WeatherRefreshMatch[] | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, kickoff_at, venue_name, venue_city, venue_lat, venue_lon, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone"
      )
      .eq("status", "scheduled")
      .gte("kickoff_at", start.toISOString())
      .lte("kickoff_at", end.toISOString())
      .or(`weather_fetched_at.is.null,weather_fetched_at.lt.${staleBefore.toISOString()}`)
      .order("kickoff_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("Failed to list matches for weather refresh", error);
      return null;
    }

    return (data as WeatherRefreshMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list matches for weather refresh", error);
    return null;
  }
}

async function listUsersMissingPrediction(
  supabase: SupabaseClient,
  matchId: number
): Promise<Array<{ id: number }> | null> {
  try {
    const { data: users, error: usersError } = await supabase.from("users").select("id");
    if (usersError) {
      console.error("Failed to fetch users for reminders", usersError);
      return null;
    }

    const { data: predictions, error: predError } = await supabase
      .from("predictions")
      .select("user_id")
      .eq("match_id", matchId);
    if (predError) {
      console.error("Failed to fetch predictions for reminders", predError);
      return null;
    }

    const predicted = new Set(
      (predictions as Array<{ user_id: number }> | null | undefined)?.map((row) => row.user_id) ?? []
    );
    return ((users as Array<{ id: number }> | null | undefined) ?? []).filter((user) => !predicted.has(user.id));
  } catch (error) {
    console.error("Failed to build reminder recipients", error);
    return null;
  }
}

async function listAllUserIds(
  supabase: SupabaseClient
): Promise<Array<{ id: number }> | null> {
  try {
    const { data: users, error: usersError } = await supabase.from("users").select("id");
    if (usersError) {
      console.error("Failed to fetch users for announcements", usersError);
      return null;
    }

    return (users as Array<{ id: number }> | null | undefined) ?? [];
  } catch (error) {
    console.error("Failed to fetch users for announcements", error);
    return null;
  }
}

function formatPredictionReminderMessage(match: PredictionReminderMatch): string {
  const home = resolveUkrainianClubName(match.home_team, match.home_club_id ?? null);
  const away = resolveUkrainianClubName(match.away_team, match.away_club_id ?? null);
  const homeLabel = escapeTelegramHtml(home);
  const awayLabel = escapeTelegramHtml(away);
  return `До закриття прийому прогнозів на матч:\n<b>${homeLabel}</b> — <b>${awayLabel}</b>\nзалишилась 1 година...`;
}

function buildWebappImageUrl(env: Env, fileName: string): string {
  const baseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  return `${baseUrl}/images/${fileName}`;
}

function getMatchResultImageFile(delta: number): string | null {
  if (delta === 1) {
    return "+1golos.png";
  }
  if (delta === -1) {
    return "-1golos.png";
  }
  if (delta === 5) {
    return "+5golosiv.png";
  }
  return null;
}

function formatMatchResultMessage(notification: MatchResultNotification): string {
  const absDelta = Math.abs(notification.delta);
  const pointsLabel = formatPointsLabel(absDelta);

  if (notification.delta > 0) {
    return `Тобі нараховано ${absDelta} ${pointsLabel}`;
  }

  return `Ти втратив ${absDelta} ${pointsLabel}`;
}

function formatPointsLabel(points: number): string {
  const absPoints = Math.abs(points);
  const mod10 = absPoints % 10;
  const mod100 = absPoints % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "бал";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "бали";
  }
  return "балів";
}

function normalizeTeamSlug(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/\s+/g, "-");
  return TEAM_SLUG_ALIASES[normalized] ?? normalized;
}

function resolveTeamMatchStatsTeam(teamSlug: string | null): { slug: string; name: string } | null {
  if (!teamSlug) {
    return null;
  }
  return ANALITIKA_TEAMS.find((team) => team.slug === teamSlug) ?? null;
}
