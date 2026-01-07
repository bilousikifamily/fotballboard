import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STARTING_POINTS = 100;
const PREDICTION_CUTOFF_MS = 60 * 60 * 1000;
const PREDICTION_REMINDER_BEFORE_CLOSE_MS = 60 * 60 * 1000;
const PREDICTION_REMINDER_WINDOW_MS = 15 * 60 * 1000;
const MISSED_PREDICTION_PENALTY = -1;
const MATCHES_ANNOUNCEMENT_MESSAGE = "На тебе вже чекають прогнози на сьогоднішні матчі.";

interface Env {
  BOT_TOKEN: string;
  WEBAPP_URL: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_FOOTBALL_KEY?: string;
  API_FOOTBALL_BASE?: string;
  API_FOOTBALL_LEAGUE_MAP?: string;
  API_FOOTBALL_DEBUG?: string;
}

function fetchApiFootball(env: Env, path: string): Promise<Response> {
  const base = env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
  return fetch(`${base}${path}`, {
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY ?? ""
    }
  });
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
      let onboarding: UserOnboarding | null = null;
      if (valid.user) {
        await storeUser(supabase, valid.user);
        if (supabase) {
          isAdmin = await checkAdmin(supabase, valid.user.id);
          stats = await getUserStats(supabase, valid.user.id);
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

        return jsonResponse({ ok: true, matches: matchesWithPrediction }, 200, corsHeaders());
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

      const body = await readJson<{ initData?: string; match_id?: number | string }>(request);
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

      await fetchAndStoreOdds(env, supabase, match);
      return jsonResponse({ ok: true }, 200, corsHeaders());
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
    const { count, error: countError } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .gt("points_total", points);

    if (countError) {
      return { points_total: points, rank: null };
    }

    return { points_total: points, rank: (count ?? 0) + 1 };
  } catch {
    return null;
  }
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
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score"
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

async function fetchAndStoreOdds(env: Env, supabase: SupabaseClient, match: DbMatch): Promise<void> {
  const leagueId = resolveApiLeagueId(env, match.league_id ?? null);
  if (!leagueId) {
    console.warn("Odds skipped: missing league mapping", match.league_id);
    return;
  }

  const kickoffDate = parseKyivDate(match.kickoff_at);
  if (!kickoffDate) {
    console.warn("Odds skipped: bad kickoff date");
    return;
  }

  const season = resolveSeasonForDate(kickoffDate);
  const dateParam = formatKyivDateString(kickoffDate);
  const fixtureId = await findFixtureId(env, leagueId, season, dateParam, match.home_team, match.away_team);
  if (!fixtureId) {
    console.warn("Odds skipped: fixture not found", match.id);
    return;
  }

  const odds = await fetchOdds(env, fixtureId);
  if (!odds) {
    console.warn("Odds skipped: no odds", match.id);
    return;
  }

  await saveMatchOdds(supabase, match.id, leagueId, fixtureId, odds);
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

function resolveSeasonForDate(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
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

function formatKyivDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function findFixtureId(
  env: Env,
  leagueId: number,
  season: number,
  dateParam: string,
  homeTeam: string,
  awayTeam: string
): Promise<number | null> {
  const fixtures = await fetchFixtures(env, leagueId, season, dateParam);
  if (env.API_FOOTBALL_DEBUG === "1") {
    console.info("fixtures count", fixtures.length, { leagueId, season, dateParam });
  }
  if (!fixtures.length) {
    return null;
  }

  const normalizedHome = normalizeTeamName(homeTeam);
  const normalizedAway = normalizeTeamName(awayTeam);
  if (env.API_FOOTBALL_DEBUG === "1") {
    console.info("match target", { homeTeam, awayTeam, normalizedHome, normalizedAway });
  }
  const match = fixtures.find((item) => {
    const homeName = item.teams?.home?.name ?? "";
    const awayName = item.teams?.away?.name ?? "";
    if (env.API_FOOTBALL_DEBUG === "1") {
      console.info("match candidate", {
        homeName,
        awayName,
        normalizedHome: normalizeTeamName(homeName),
        normalizedAway: normalizeTeamName(awayName)
      });
    }
    return (
      isTeamMatch(normalizedHome, normalizeTeamName(homeName))
      && isTeamMatch(normalizedAway, normalizeTeamName(awayName))
    );
  });

  return match?.fixture?.id ?? null;
}

async function fetchFixtures(
  env: Env,
  leagueId: number,
  season: number,
  dateParam: string
): Promise<Array<{ fixture?: { id?: number }; teams?: { home?: { name?: string }; away?: { name?: string } } }>> {
  const dateResponse = await fetchApiFootball(
    env,
    `/fixtures?date=${encodeURIComponent(dateParam)}&league=${leagueId}&season=${season}`
  );
  if (dateResponse.ok) {
    const payload = (await dateResponse.json()) as {
      response?: Array<{ fixture?: { id?: number }; teams?: { home?: { name?: string }; away?: { name?: string } } }>;
    };
    if (env.API_FOOTBALL_DEBUG === "1") {
      console.info("fixtures date response", payload.response?.length ?? 0);
    }
    if (payload.response?.length) {
      return payload.response;
    }
  }

  const from = addDateDays(dateParam, -1);
  const to = addDateDays(dateParam, 1);
  const rangeResponse = await fetchApiFootball(
    env,
    `/fixtures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&league=${leagueId}&season=${season}`
  );
  if (!rangeResponse.ok) {
    console.warn("API-Football fixtures error", rangeResponse.status);
    return [];
  }

  const rangePayload = (await rangeResponse.json()) as {
    response?: Array<{ fixture?: { id?: number }; teams?: { home?: { name?: string }; away?: { name?: string } } }>;
  };
  if (env.API_FOOTBALL_DEBUG === "1") {
    console.info("fixtures range response", rangePayload.response?.length ?? 0, { from, to });
  }
  return rangePayload.response ?? [];
}

function addDateDays(dateParam: string, delta: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateParam.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) {
    return dateParam;
  }
  const baseUtc = Date.UTC(year, month - 1, day, 12);
  const nextDate = new Date(baseUtc + delta * 24 * 60 * 60 * 1000);
  return formatKyivDateString(nextDate);
}

async function fetchOdds(env: Env, fixtureId: number): Promise<unknown | null> {
  const response = await fetchApiFootball(env, `/odds?fixture=${fixtureId}`);
  if (!response.ok) {
    console.warn("API-Football odds error", response.status);
    return null;
  }
  const payload = (await response.json()) as { response?: unknown[] };
  return payload.response ?? null;
}

async function saveMatchOdds(
  supabase: SupabaseClient,
  matchId: number,
  leagueId: number,
  fixtureId: number,
  odds: unknown
): Promise<void> {
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
  }
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
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score"
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
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score"
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
