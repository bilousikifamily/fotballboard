import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STARTING_POINTS = 100;
const PREDICTION_CUTOFF_MS = 0;
const PREDICTION_REMINDER_BEFORE_CLOSE_MS = 60 * 60 * 1000;
const PREDICTION_REMINDER_WINDOW_MS = 15 * 60 * 1000;
const MISSED_PREDICTION_PENALTY = -1;
const MATCHES_ANNOUNCEMENT_MESSAGE = "На тебе вже чекають прогнози на сьогоднішні матчі.";
const TEAM_ID_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const teamIdCache = new Map<string, { id: number; name: string; updatedAt: number }>();
const WEATHER_PROVIDER_PRIMARY = "open-meteo";
const WEATHER_PROVIDER_FALLBACK = "weatherapi";
const WEATHER_UNITS = "metric";
const WEATHER_LANG = "uk";
const WEATHER_DB_REFRESH_MIN = 60;
const WEATHER_DB_LOOKAHEAD_HOURS = 24;
const WEATHER_DB_REFRESH_LIMIT = 24;

type WeatherCacheEntry = {
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

const weatherCache = new Map<string, WeatherCacheEntry>();
const weatherInFlight = new Map<string, Promise<WeatherFetchResult>>();
const weatherRateLimiter = createRateLimiter();
const weatherCooldownUntilMs = new Map<string, number>();

interface Env {
  BOT_TOKEN: string;
  WEBAPP_URL: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_FOOTBALL_KEY?: string;
  API_FOOTBALL_BASE?: string;
  API_FOOTBALL_LEAGUE_MAP?: string;
  API_FOOTBALL_DEBUG?: string;
  API_FOOTBALL_TIMEZONE?: string;
  WEATHER_CACHE_TTL_MIN?: string;
  WEATHER_STALE_TTL_H?: string;
  WEATHER_RATE_LIMIT_PER_5S?: string;
  WEATHER_RATE_LIMIT_PER_MIN?: string;
  WEATHER_RETRY_MAX_ATTEMPTS?: string;
  WEATHER_RETRY_BASE_DELAY_MS?: string;
  WEATHER_RETRY_DELAY_CAP_MS?: string;
  WEATHER_DB_REFRESH_MIN?: string;
  WEATHER_DB_LOOKAHEAD_H?: string;
  WEATHER_DB_REFRESH_LIMIT?: string;
  WEATHERAPI_KEY?: string;
  WEATHERAPI_BASE?: string;
}

function fetchApiFootball(env: Env, path: string): Promise<Response> {
  const base = env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
  return fetch(`${base}${path}`, {
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY ?? ""
    }
  });
}

function getApiFootballBase(env: Env): string {
  return env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
}

function getApiFootballTimezone(env: Env): string | null {
  const value = env.API_FOOTBALL_TIMEZONE?.trim();
  if (!value || value.length > 64) {
    return null;
  }
  return value;
}

function buildApiPath(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

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
        await storeUser(supabase, valid.user);
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

      if (env.API_FOOTBALL_KEY) {
        ctx.waitUntil(fetchAndStoreOdds(env, supabase, match));
      }

      return jsonResponse({ ok: true, match }, 200, corsHeaders());
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
      if (matchId === null || homeScore === null || awayScore === null) {
        return jsonResponse({ ok: false, error: "bad_score" }, 400, corsHeaders());
      }

      const result = await applyMatchResult(supabase, matchId, homeScore, awayScore);
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
        await sendMessage(env, user.id, MATCHES_ANNOUNCEMENT_MESSAGE);
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

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-InitData"
  };
}

function corsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers
  };
  return new Response(JSON.stringify(data), { status, headers: baseHeaders });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function getInitDataFromHeaders(request: Request): string | null {
  return request.headers.get("X-Telegram-InitData")?.trim() || null;
}

async function authenticateInitData(
  initData: string | null,
  botToken: string
): Promise<{ ok: boolean; user?: TelegramUser }> {
  if (!initData) {
    return { ok: false };
  }

  return validateInitData(initData, botToken);
}

async function validateInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser }>{
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false };
  }

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") {
      continue;
    }
    pairs.push([key, value]);
  }

  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join("\n");

  const computedHash = await computeTelegramHash(dataCheckString, botToken);
  if (!timingSafeEqual(hash.toLowerCase(), computedHash)) {
    return { ok: false };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: true };
  }

  let userParsed: TelegramUser | null = null;
  try {
    userParsed = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: true };
  }

  if (!userParsed) {
    return { ok: true };
  }

  const safeUser: TelegramUser = {
    id: userParsed.id,
    username: userParsed.username,
    first_name: userParsed.first_name,
    last_name: userParsed.last_name,
    photo_url: userParsed.photo_url
  };

  return { ok: true, user: safeUser };
}

async function computeTelegramHash(dataCheckString: string, botToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", key, encoder.encode(botToken));
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
  return bufferToHex(signature);
}

function createSupabaseClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "X-Client-Info": "tg-webapp-worker" } }
  });
}

async function storeUser(supabase: SupabaseClient | null, user: TelegramUser): Promise<void> {
  if (!supabase) {
    return;
  }

  try {
    const payload = {
      id: user.id,
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      photo_url: user.photo_url ?? null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
    if (error) {
      console.error("Failed to store user", error);
    }
  } catch (error) {
    console.error("Failed to store user", error);
  }
}

async function listLeaderboard(supabase: SupabaseClient, limit: number): Promise<StoredUser[] | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, first_name, last_name, photo_url, points_total, updated_at, nickname, avatar_choice")
      .order("points_total", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(limit);

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
      query = query.gt("points", 1);
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
      .select("points, matches!inner(kickoff_at, status)")
      .eq("user_id", userId)
      .eq("matches.status", "finished")
      .order("kickoff_at", { referencedTable: "matches", ascending: false })
      .limit(5);
    if (error || !data) {
      return [];
    }
    return (data as Array<{ points?: number | null }>).map((row) => ({
      hit: (row.points ?? 0) > 1
    }));
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
        status: "scheduled",
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

type OddsStoreFailure =
  | "missing_league_mapping"
  | "missing_timezone"
  | "bad_kickoff_date"
  | "team_not_found"
  | "fixture_not_found"
  | "api_error"
  | "odds_empty"
  | "db_error";

type OddsDebugFixture = { id?: number; home?: string; away?: string; homeId?: number; awayId?: number };

type OddsDebugInfo = {
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

type OddsStoreResult =
  | { ok: true; debug?: OddsDebugInfo }
  | { ok: false; reason: OddsStoreFailure; detail?: string; debug?: OddsDebugInfo };

type OddsFetchResult =
  | { ok: true; odds: unknown }
  | { ok: false; reason: "api_error" | "odds_empty"; detail?: string };

type OddsSaveResult =
  | { ok: true }
  | { ok: false; detail?: string };

type VenueUpdate = {
  venue_name?: string | null;
  venue_city?: string | null;
  tournament_name?: string | null;
  tournament_stage?: string | null;
};

type WeatherResult =
  | { ok: true; rainProbability: number | null; condition: string | null; tempC: number | null; timezone: string | null }
  | { ok: false; reason: "missing_location" | "bad_kickoff" | "api_error" | "rate_limited" };

type WeatherDebugInfo = {
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

type FixturePayload = {
  fixture?: { id?: number; date?: string; venue?: { name?: string; city?: string } };
  league?: { id?: number; name?: string; round?: string };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
};

type FixturesResult = {
  fixtures: FixturePayload[];
  source: "date" | "range" | "headtohead" | "none";
  dateStatus: number;
  rangeStatus?: number;
};

type TeamPayload = {
  team?: { id?: number; name?: string };
};

type TeamsResult = {
  teams: TeamPayload[];
  status: number;
};

async function resolveTeamId(env: Env, teamName: string): Promise<{ id: number | null; source: "search" | "cache" | "none" }> {
  const normalized = normalizeTeamName(teamName);
  const searchResult = await fetchTeamsBySearch(env, teamName);
  const teamId = findTeamIdInList(teamName, searchResult.teams);
  if (teamId) {
    teamIdCache.set(normalized, { id: teamId, name: teamName, updatedAt: Date.now() });
    return { id: teamId, source: "search" };
  }

  const cached = teamIdCache.get(normalized);
  if (cached && Date.now() - cached.updatedAt < TEAM_ID_CACHE_TTL_MS) {
    return { id: cached.id, source: "cache" };
  }

  return { id: null, source: "none" };
}

function findTeamIdInList(teamName: string, teams: TeamPayload[]): number | null {
  const normalizedTarget = normalizeTeamName(teamName);
  for (const entry of teams) {
    const apiName = entry.team?.name ?? "";
    const normalizedApi = normalizeTeamName(apiName);
    if (isTeamMatch(normalizedTarget, normalizedApi)) {
      return entry.team?.id ?? null;
    }
  }
  return null;
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

type WeatherForecastResult = {
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

type WeatherDetailedResult =
  | { ok: true; rainProbability: number | null; condition: string | null; tempC: number | null; timezone: string | null; debug: WeatherDebugInfo }
  | { ok: false; reason: "missing_location" | "bad_kickoff" | "api_error" | "rate_limited"; debug: WeatherDebugInfo };


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

type GeocodeResult = { ok: true; lat: number; lon: number; status: number } | { ok: false; status: number };

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

type WeatherFetchDebug = {
  target_time: string | null;
  date_string: string | null;
  forecast_status: number | null;
  time_index: number | null;
};

type WeatherFetchResult =
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

function isTeamMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.includes(right) || right.includes(left);
}

async function listMatches(supabase: SupabaseClient, date?: string): Promise<DbMatch[] | null> {
  try {
    let query = supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at"
      )
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
  awayScore: number
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

function parseLimit(value: string | null, fallback: number, max: number): number {
  if (!value) {
    return fallback;
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

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = getUpdateMessage(update);
  if (!message || !message.chat?.id) {
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const command = extractCommand(text, message.entities);
  if (!command) {
    return;
  }

  if (command === "start" || command === "app" || command === "webapp") {
    await sendMessage(env, message.chat.id, "Готово ✅ Натисни кнопку, щоб відкрити WebApp", {
      inline_keyboard: [[{ text: "Open WebApp", web_app: { url: env.WEBAPP_URL } }]]
    });
  }
}

function getUpdateMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
}

function extractCommand(
  text: string,
  entities?: Array<{ type?: string; offset?: number; length?: number }>
): string | null {
  const commandFromStart = extractCommandToken(text);
  if (commandFromStart) {
    return commandFromStart;
  }
  if (!entities || entities.length === 0) {
    return null;
  }
  for (const entity of entities) {
    if (entity.type !== "bot_command") {
      continue;
    }
    const offset = entity.offset ?? 0;
    const length = entity.length ?? 0;
    if (length <= 1) {
      continue;
    }
    const token = text.slice(offset, offset + length);
    const parsed = extractCommandToken(token);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function extractCommandToken(token: string): string | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const raw = token.split(/\s+/)[0]?.slice(1).split("@")[0]?.trim().toLowerCase();
  return raw || null;
}

async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function notifyUsersAboutMatchResult(
  env: Env,
  notifications: MatchResultNotification[]
): Promise<void> {
  for (const notification of notifications) {
    const message = formatMatchResultMessage(notification);
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
        await sendMessage(env, user.id, message);
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
      .select("id, home_team, away_team, kickoff_at")
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
  return `До закриття прийому прогнозів на матч:\n${match.home_team} — ${match.away_team}\nзалишилась 1 година...`;
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

interface TelegramUpdate {
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

interface TelegramMessage {
  message_id?: number;
  text?: string;
  entities?: Array<{ type?: string; offset?: number; length?: number }>;
  chat?: { id?: number };
}

interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

interface StoredUser {
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
  classico_choice?: string | null;
  ua_club_id?: string | null;
  eu_club_id?: string | null;
  onboarding_completed_at?: string | null;
}

interface UserStats {
  points_total: number;
  rank: number | null;
}

type FactionKey = "classico_choice" | "eu_club_id" | "ua_club_id";

interface PredictionResult {
  hit: boolean;
}

interface PredictionStats {
  total: number;
  hits: number;
  accuracy_pct: number;
  streak: number;
  last_results: PredictionResult[];
}

interface FactionStat {
  key: FactionKey;
  value: string;
  members: number;
  rank: number | null;
}

interface ProfileStats {
  prediction: PredictionStats;
  factions: FactionStat[];
}

interface CreateMatchPayload {
  initData?: string;
  home_team?: string;
  away_team?: string;
  league_id?: string;
  home_club_id?: string;
  away_club_id?: string;
  kickoff_at?: string;
}

interface PredictionPayload {
  initData?: string;
  match_id: number | string;
  home_pred: number | string;
  away_pred: number | string;
}

interface MatchResultPayload {
  initData?: string;
  match_id: number | string;
  home_score: number | string;
  away_score: number | string;
}

interface AnnouncementPayload {
  initData?: string;
}

interface DbMatch {
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
  reminder_sent_at?: string | null;
  api_league_id?: number | null;
  api_fixture_id?: number | null;
  odds_json?: unknown | null;
  odds_fetched_at?: string | null;
  has_prediction?: boolean;
}

interface DbPrediction {
  id: number;
  user_id: number;
  match_id: number;
  home_pred: number;
  away_pred: number;
  points?: number | null;
}

interface PredictionRow {
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

interface PredictionView {
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

interface UserOnboarding {
  classico_choice?: string | null;
  ua_club_id?: string | null;
  eu_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  logo_order?: string[] | null;
  completed: boolean;
}

interface UserOnboardingRow {
  classico_choice?: string | null;
  ua_club_id?: string | null;
  eu_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  logo_order?: string[] | null;
  onboarding_completed_at?: string | null;
}

interface OnboardingPayload {
  initData?: string;
  classico_choice?: string | null;
  ua_club_id?: string | null;
  eu_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  logo_order?: string[] | null;
}

interface AvatarPayload {
  initData?: string;
  avatar_choice?: string | null;
}

interface LogoOrderPayload {
  initData?: string;
  logo_order?: string[] | null;
}

interface NicknamePayload {
  initData?: string;
  nickname?: string | null;
}

interface MatchResultNotification {
  user_id: number;
  delta: number;
  total_points: number;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}

interface MatchResultOutcome {
  ok: boolean;
  notifications: MatchResultNotification[];
}

interface PredictionReminderMatch {
  id: number;
  home_team: string;
  away_team: string;
  kickoff_at: string;
}

interface WeatherRefreshMatch {
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
