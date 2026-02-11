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
  ChannelWebappPayload,
  ClubApiMapRow,
  ClubSyncPayload,
  CreateMatchPayload,
  DbAnalitika,
  DbMatch,
  DbPrediction,
  DbTeamMatchStat,
  AdminPredictionAccuracyMatch,
  AdminPredictionAccuracyUser,
  FactionKey,
  MatchResultExactGuessUser,
  FactionStat,
  FactionBranchSlug,
  FactionPredictionsStatsPayload,
  FixturePayload,
  FixturesResult,
  TeamFixturesResult,
  TeamFixturesSource,
  GeocodeResult,
  MatchResultNotification,
  MatchResultOutcome,
  MatchResultPayload,
  MatchResultPredictionStats,
  MatchConfirmPayload,
  ManualOddsPayload,
  NicknamePayload,
  OddsDebugInfo,
  OddsDebugFixture,
  OddsTeamSearchDetail,
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
  VenueUpdate
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
import {
  deleteMessage,
  getUpdateMessage,
  handleUpdate,
  sendMessage,
  sendMessageWithResult,
  sendPhoto,
  sendPhotoWithResult
} from "./services/telegram";
import { formatClubName } from "./utils/clubs";
import { createAdminJwt, verifyAdminJwt } from "./services/adminSession";
import { TEAM_SLUG_ALIASES } from "../../shared/teamSlugAliases";

const STARTING_POINTS = 100;
const PREDICTION_CUTOFF_MS = 0;
const PREDICTION_REMINDER_BEFORE_CLOSE_MS = 60 * 60 * 1000;
const PREDICTION_REMINDER_WINDOW_MS = 5 * 60 * 1000;
const CHANNEL_WEBAPP_CHAT = "@football_rada";
const CHANNEL_WEBAPP_IMAGE = "for_chanel1.png";
const CHANNEL_WEBAPP_BUTTON_TEXT = "ВІДКРИТИ";
const CHANNEL_WEBAPP_BUTTON_URL = "https://t.me/football_rada_bot";
const MATCH_START_DIGEST_DELAY_MS = 60 * 1000;
const MISSED_PREDICTION_PENALTY = -1;
const MATCH_RESULT_NOTIFICATION_BATCH_SIZE = 120;
const MATCH_RESULT_NOTIFICATION_CONCURRENCY = 8;
const MATCH_RESULT_NOTIFICATION_MAX_ATTEMPTS = 8;
const MATCH_RESULT_NOTIFICATION_LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const ANNOUNCEMENT_QUEUE_BATCH_SIZE = 100;
const ANNOUNCEMENT_QUEUE_CONCURRENCY = 6;
const ANNOUNCEMENT_QUEUE_MAX_ATTEMPTS = 5;
const ANNOUNCEMENT_QUEUE_LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const MATCHES_ANNOUNCEMENT_IMAGE = "new_prediction.png";
const TEAM_ID_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ANALITIKA_LEAGUE_ID = "english-premier-league";
const ANALITIKA_HEAD_TO_HEAD_LIMIT = 10;
const ANALITIKA_STATIC_TTL_DAYS = 365;
const TEAM_SEARCH_ALIASES: Record<string, string> = {
  inter: "Inter Milan",
  milan: "AC Milan",
  "como1907": "Como",
  "como 1907": "Como",
  "como-1907": "Como",
  racing: "Real Racing Club de Santander",
  racingsantander: "Real Racing Club de Santander",
  parissaintgermain: "Paris Saint Germain",
  psg: "Paris Saint Germain",
  parissaintgermainfc: "Paris Saint Germain",
  parissatgermain: "Paris Saint Germain",
  asmonaco: "Monaco"
};
const TEAM_MATCH_ALIASES: Record<string, string> = {
  inter: "intermilan",
  milan: "acmilan",
  racing: "realracingclubdesantander",
  racingsantander: "realracingclubdesantander",
  parisstgermain: "parissaintgermain",
  psg: "parissaintgermain",
  parissaintgermainfc: "parissaintgermain"
};

const KNOWN_TEAM_IDS: Record<string, number> = {
  asmonaco: 200,
  monaco: 200
};

const KNOWN_API_TEAM_IDS: Record<string, number> = {
  "as-monaco": 200
};

const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_BLOCK_MS = 15 * 60 * 1000;
const adminLoginState = new Map<string, { attempts: number; firstAttempt: number; blockedUntil?: number }>();

type AdminAccessError = "missing_token" | "invalid_token" | "token_expired" | "missing_secret" | "bad_initData";

async function authorizePresentationAdminAccess(
  supabase: SupabaseClient | null,
  env: Env,
  request: Request,
  initData?: string
): Promise<{ ok: true; user?: TelegramUser } | { ok: false; error: AdminAccessError }> {
  const token = getAdminBearerToken(request);
  if (!token) {
    return { ok: false, error: "missing_token" };
  }
  const secret = env.ADMIN_JWT_SECRET?.trim();
  if (!secret) {
    return { ok: false, error: "missing_secret" };
  }
  const verification = await verifyAdminJwt(token, secret);
  if (!verification.ok) {
    const error = verification.error === "expired" ? "token_expired" : "invalid_token";
    return { ok: false, error };
  }
  if (initData) {
    const auth = await authenticateInitData(initData, env.BOT_TOKEN);
    if (!auth.ok || !auth.user) {
      return { ok: false, error: "bad_initData" };
    }
    await storeUser(supabase, auth.user);
    return { ok: true, user: auth.user };
  }
  return { ok: true };
}

function adminAccessErrorStatus(error: AdminAccessError): number {
  return error === "missing_secret" ? 500 : 401;
}

type ClassicoFaction = "real_madrid" | "barcelona";
const CLASSICO_FACTIONS: ClassicoFaction[] = ["real_madrid", "barcelona"];
const ALL_FACTION_BRANCHES: FactionBranchSlug[] = [
  "real_madrid",
  "barcelona",
  "atletico-madrid",
  "bayern-munchen",
  "borussia-dortmund",
  "chelsea",
  "manchester-city",
  "liverpool",
  "arsenal",
  "manchester-united",
  "paris-saint-germain",
  "milan",
  "juventus",
  "inter",
  "napoli",
  "dynamo-kyiv",
  "shakhtar"
];

const FACTION_DISPLAY_NAMES: Record<FactionBranchSlug, string> = {
  real_madrid: "Реал Мадрид",
  barcelona: "Барселона",
  "atletico-madrid": "Атлетіко",
  "bayern-munchen": "Баварія",
  "borussia-dortmund": "Боруссія Дортмунд",
  chelsea: "Челсі",
  "manchester-city": "Манчестер Сіті",
  liverpool: "Ліверпуль",
  arsenal: "Арсенал",
  "manchester-united": "Манчестер Юнайтед",
  "paris-saint-germain": "ПСЖ",
  milan: "Мілан",
  juventus: "Ювентус",
  inter: "Інтер",
  napoli: "Наполі",
  "dynamo-kyiv": "Динамо Київ",
  shakhtar: "Шахтар"
};

const NO_FACTION_LABEL = "без фракції";

const teamIdCache = new Map<string, { id: number; name: string; updatedAt: number }>();

const ANALITIKA_TEAMS = [
  { slug: "arsenal", name: "Arsenal" },
  { slug: "aston-villa", name: "Aston Villa" },
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
  { slug: "newcastle", name: "Newcastle United" },
  { slug: "real-madrid", name: "Real Madrid" }
];

const TEAM_NAME_ALIASES: Record<string, string[]> = {
  "newcastle": ["Newcastle", "Newcastle United"],
  "newcastle united": ["Newcastle", "Newcastle United"],
  "leeds": ["Leeds", "Leeds United"],
  "leeds united": ["Leeds", "Leeds United"]
};

const CLASSICO_CHAT_ENV: Record<ClassicoFaction, keyof Env> = {
  real_madrid: "FACTION_CHAT_REAL",
  barcelona: "FACTION_CHAT_BARCA"
};

const EXTRA_FACTION_CHAT_CONFIG: Array<{ slug: Exclude<FactionBranchSlug, ClassicoFaction>; envKey: keyof Env }> = [
  { slug: "atletico-madrid", envKey: "FACTION_CHAT_ATLETICO" },
  { slug: "bayern-munchen", envKey: "FACTION_CHAT_BAYERN" },
  { slug: "borussia-dortmund", envKey: "FACTION_CHAT_DORTMUND" },
  { slug: "manchester-city", envKey: "FACTION_CHAT_MANCHESTER_CITY" },
  { slug: "paris-saint-germain", envKey: "FACTION_CHAT_PSG" },
  { slug: "liverpool", envKey: "FACTION_CHAT_LIVERPOOL" },
  { slug: "arsenal", envKey: "FACTION_CHAT_ARSENAL" },
  { slug: "chelsea", envKey: "FACTION_CHAT_CHELSEA" },
  { slug: "milan", envKey: "FACTION_CHAT_MILAN" },
  { slug: "manchester-united", envKey: "FACTION_CHAT_MANCHESTER_UNITED" },
  { slug: "juventus", envKey: "FACTION_CHAT_JUVENTUS" },
  { slug: "inter", envKey: "FACTION_CHAT_INTER" },
  { slug: "napoli", envKey: "FACTION_CHAT_NAPOLI" },
  { slug: "dynamo-kyiv", envKey: "FACTION_CHAT_DYNAMO_KYIV" },
  { slug: "shakhtar", envKey: "FACTION_CHAT_SHAKHTAR" }
];

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

type FactionChatRef = {
  chatId?: number;
  chatUsername?: string;
  threadId?: number | null;
  label: string;
};

type FactionChatRefs = {
  classico: Partial<Record<ClassicoFaction, FactionChatRef>>;
  bySlug: Partial<Record<FactionBranchSlug, FactionChatRef>>;
  general?: FactionChatRef;
};

function parseChatRef(value: string | undefined, label: string): FactionChatRef | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/^https?:\/\//, "").replace(/^@/, "");
  const numericThreadMatch =
    normalized.match(/^t\.me\/(-?\d+)\/(\d+)$/i) ??
    normalized.match(/^(-?\d+)\/(\d+)$/) ??
    normalized.match(/^(-?\d+):(\d+)$/);
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

  if (/^-?\d+$/.test(normalized)) {
    return { chatId: Number(normalized), threadId: null, label };
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
  const classico: Partial<Record<ClassicoFaction, FactionChatRef>> = {};
  const bySlug: Partial<Record<FactionBranchSlug, FactionChatRef>> = {};
  CLASSICO_FACTIONS.forEach((slug) => {
    const ref = parseChatRef(env[CLASSICO_CHAT_ENV[slug]], slug);
    if (ref) {
      classico[slug] = ref;
      bySlug[slug] = ref;
    }
  });
  EXTRA_FACTION_CHAT_CONFIG.forEach((config) => {
    const ref = parseChatRef(env[config.envKey], config.slug);
    if (ref) {
      bySlug[config.slug] = ref;
    }
  });
  return {
    classico,
    bySlug,
    general: parseChatRef(env.FACTION_CHAT_GENERAL, "general")
  };
}

function formatFactionChatUrl(ref: FactionChatRef | undefined | null): string | null {
  if (!ref) {
    return null;
  }
  if (ref.chatUsername) {
    const base = `https://t.me/${ref.chatUsername}`;
    return ref.threadId ? `${base}/${ref.threadId}` : base;
  }
  if (typeof ref.chatId === "number") {
    const normalized = String(ref.chatId).replace(/^-100/, "").replace(/^-/, "");
    if (!normalized) {
      return null;
    }
    const base = `https://t.me/c/${normalized}`;
    return ref.threadId ? `${base}/${ref.threadId}` : base;
  }
  return null;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Real-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isLoginBlocked(ip: string): boolean {
  const entry = adminLoginState.get(ip);
  if (!entry) {
    return false;
  }
  const now = Date.now();
  if (entry.blockedUntil) {
    if (entry.blockedUntil > now) {
      return true;
    }
    adminLoginState.delete(ip);
    return false;
  }
  if (now - entry.firstAttempt > ADMIN_LOGIN_WINDOW_MS) {
    adminLoginState.delete(ip);
    return false;
  }
  return false;
}

function recordFailedLoginAttempt(ip: string): void {
  const now = Date.now();
  const entry = adminLoginState.get(ip);
  if (!entry || now - entry.firstAttempt > ADMIN_LOGIN_WINDOW_MS) {
    adminLoginState.set(ip, { attempts: 1, firstAttempt: now });
    return;
  }
  const updated = {
    attempts: entry.attempts + 1,
    firstAttempt: entry.firstAttempt,
    blockedUntil: entry.blockedUntil
  };
  if (!updated.blockedUntil && updated.attempts >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    updated.blockedUntil = now + ADMIN_LOGIN_BLOCK_MS;
  }
  adminLoginState.set(ip, updated);
}

function resetLoginAttempts(ip: string): void {
  adminLoginState.delete(ip);
}

function getAdminBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) {
    return null;
  }
  const [scheme, token] = header.trim().split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthcheck") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/admin/login") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const clientIp = getClientIp(request);
      const userAgent = request.headers.get("User-Agent") ?? "";
      if (isLoginBlocked(clientIp)) {
        console.warn("Admin login rate limited", { ip: clientIp });
        return jsonResponse({ ok: false, error: "rate_limited" }, 429, corsHeaders());
      }

      const body = await readJson<{ username?: string; password?: string }>(request);
      if (!body) {
        recordFailedLoginAttempt(clientIp);
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      const expectedUsername = env.PRESENTATION_ADMIN_USERNAME?.trim();
      const expectedPassword = env.PRESENTATION_ADMIN_PASSWORD?.trim();
      const jwtSecret = env.ADMIN_JWT_SECRET?.trim();
      if (!expectedUsername || !expectedPassword || !jwtSecret) {
        console.error("Admin login is not configured");
        return jsonResponse({ ok: false, error: "server_error" }, 500, corsHeaders());
      }

      if (!username || !password || username !== expectedUsername || password !== expectedPassword) {
        recordFailedLoginAttempt(clientIp);
        console.warn("Admin login failed", { ip: clientIp, userAgent });
        return jsonResponse({ ok: false, error: "invalid_credentials" }, 401, corsHeaders());
      }

      const token = await createAdminJwt({ sub: expectedUsername, scope: "admin" }, jwtSecret);
      resetLoginAttempts(clientIp);
      console.info("Admin login success", { ip: clientIp, userAgent });
      return jsonResponse({ ok: true, token }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/bot-logs") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const limit = parseLimit(url.searchParams.get("limit"), 50, 200);
      const since = Number(url.searchParams.get("since") ?? "");

      let query = supabase
        .from("debug_updates")
        .select("id, chat_id, thread_id, message_id, user_id, text, created_at")
        .eq("update_type", "bot_log");

      if (Number.isFinite(since)) {
        query = query.gt("id", since).order("id", { ascending: true });
      } else {
        query = query.order("id", { ascending: false });
      }

      const { data, error } = await query.limit(limit);
      if (error) {
        console.error("Failed to fetch bot logs", error);
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, logs: data ?? [] }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/chat-threads") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const limit = parseLimit(url.searchParams.get("limit"), 40, 200);
      const { data, error } = await supabase
        .from("admin_chat_threads")
        .select(
          "user_id, chat_id, direction, sender, message_type, last_text, last_message_at, username, first_name, last_name, nickname, photo_url, last_seen_at"
        )
        .order("last_message_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("Failed to fetch admin chat threads", error);
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, threads: data ?? [] }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/chat-debug") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const userIdRaw = url.searchParams.get("user_id") ?? "";
      const chatIdRaw = url.searchParams.get("chat_id") ?? "";
      const userId = Number(userIdRaw || chatIdRaw);
      if (!Number.isFinite(userId) || userId <= 0) {
        return jsonResponse({ ok: false, error: "invalid_user_id" }, 400, corsHeaders());
      }

      let supabaseHost: string | null = null;
      try {
        supabaseHost = env.SUPABASE_URL ? new URL(env.SUPABASE_URL).hostname : null;
      } catch {
        supabaseHost = env.SUPABASE_URL ?? null;
      }

      const [{ count: userCount, error: userError }, { count: chatCount, error: chatError }] = await Promise.all([
        supabase
          .from("bot_message_logs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        supabase
          .from("bot_message_logs")
          .select("id", { count: "exact", head: true })
          .eq("chat_id", userId)
      ]);

      if (userError || chatError) {
        console.error("Failed to fetch admin chat debug counts", { userError, chatError });
      }

      return jsonResponse(
        {
          ok: true,
          supabase_host: supabaseHost,
          user_id: userId,
          counts: { by_user_id: userCount ?? 0, by_chat_id: chatCount ?? 0 }
        },
        200,
        corsHeaders()
      );
    }

    if (url.pathname === "/api/admin/chat-messages") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const userIdRaw = url.searchParams.get("user_id") ?? "";
      const chatIdRaw = url.searchParams.get("chat_id") ?? "";
      const userId = Number(userIdRaw || chatIdRaw);
      if (!Number.isFinite(userId) || userId <= 0) {
        return jsonResponse({ ok: false, error: "invalid_user_id" }, 400, corsHeaders());
      }

      const limit = parseLimit(url.searchParams.get("limit"), 50, 200);
      const beforeId = Number(url.searchParams.get("before") ?? "");
      const selectFields =
        "id, chat_id, user_id, user_nickname, admin_id, thread_id, message_id, direction, sender, message_type, text, delivery_status, error_code, http_status, error_message, payload, created_at";

      let userQuery = supabase
        .from("bot_message_logs")
        .select(selectFields)
        .eq("user_id", userId)
        .order("id", { ascending: false });

      let chatQuery = supabase
        .from("bot_message_logs")
        .select(selectFields)
        .eq("chat_id", userId)
        .order("id", { ascending: false });

      if (Number.isFinite(beforeId)) {
        userQuery = userQuery.lt("id", beforeId);
        chatQuery = chatQuery.lt("id", beforeId);
      }

      const [{ data: userData, error: userError }, { data: chatData, error: chatError }] = await Promise.all([
        userQuery.limit(limit),
        chatQuery.limit(limit)
      ]);

      if (userError && chatError) {
        console.error("Failed to fetch admin chat messages", { userError, chatError });
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }
      if (userError) {
        console.error("Failed to fetch admin chat messages by user_id", userError);
      }
      if (chatError) {
        console.error("Failed to fetch admin chat messages by chat_id", chatError);
      }

      const merged = new Map<number, typeof userData extends Array<infer T> ? T : never>();
      for (const row of userData ?? []) {
        if (typeof row?.id === "number") {
          merged.set(row.id, row);
        }
      }
      for (const row of chatData ?? []) {
        if (typeof row?.id === "number") {
          merged.set(row.id, row);
        }
      }

      const messages = Array.from(merged.values())
        .sort((a, b) => (typeof b.id === "number" && typeof a.id === "number" ? b.id - a.id : 0))
        .slice(0, limit);

      return jsonResponse({ ok: true, messages }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/chat-send") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }

      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const secret = env.ADMIN_JWT_SECRET?.trim();
      if (!secret) {
        return jsonResponse({ ok: false, error: "missing_secret" }, 500, corsHeaders());
      }
      const verification = await verifyAdminJwt(adminBearer, secret);
      if (!verification.ok) {
        const status = adminAccessErrorStatus("invalid_token");
        return jsonResponse({ ok: false, error: "invalid_token" }, status, corsHeaders());
      }

      const body = await readJson<{ user_id?: number; text?: string }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }
      const userId = typeof body.user_id === "number" ? body.user_id : Number(body.user_id ?? "");
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!Number.isFinite(userId) || userId <= 0) {
        return jsonResponse({ ok: false, error: "invalid_user_id" }, 400, corsHeaders());
      }
      if (!text) {
        return jsonResponse({ ok: false, error: "empty_text" }, 400, corsHeaders());
      }

      await sendMessage(env, userId, text, undefined, undefined, undefined, verification.claims.sub);
      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/prediction-accuracy") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const limit = parseLimit(url.searchParams.get("limit"), 120, 300) ?? 120;
      const monthParam = url.searchParams.get("month");
      const month = isValidKyivMonthString(monthParam) ? monthParam : null;
      const stats = await getPredictionAccuracyStats(supabase, limit, month);
      if (!stats) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, matches: stats.matches, users: stats.users }, 200, corsHeaders());
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
          const seasonMonth = resolveSeasonMonthForNow(env);
          profileStats = await getProfileStats(supabase, valid.user.id, seasonMonth);
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

      const auth = await authenticateWithDevBypass(request, env, body.initData);
      if (!auth.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const nickname = normalizeNickname(body.nickname);
      if (!nickname) {
        return jsonResponse({ ok: false, error: "bad_nickname" }, 400, corsHeaders());
      }

      const factionClubId = normalizeClubId(body.faction_club_id);
      if (!factionClubId) {
        return jsonResponse({ ok: false, error: "bad_faction_choice" }, 400, corsHeaders());
      }

      const avatarChoice = normalizeAvatarChoice(body.avatar_choice);
      if (body.avatar_choice !== undefined && body.avatar_choice !== null && body.avatar_choice !== "" && avatarChoice === null) {
        return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
      }

      const existingOnboarding = await getUserOnboarding(supabase, auth.user.id);
      const wasOnboarded = Boolean(existingOnboarding?.completed);

      const onboardingSelections = { factionClubId };
      if (avatarChoice && !isAvatarChoiceAllowed(avatarChoice, onboardingSelections)) {
        return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
      }

      const saved = await saveUserOnboarding(supabase, auth.user.id, {
        faction_club_id: factionClubId,
        nickname,
        avatar_choice: avatarChoice,
      });
      if (!saved) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      await maybeGrantFreeMonthOnOnboarding(supabase, auth.user.id);

      const factionSlug = normalizeFactionChoice(factionClubId);
      if (!wasOnboarded && factionSlug) {
        await notifyFactionChatNewDeputy(env, supabase, auth.user, factionSlug, { nickname });
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

        if (!isAvatarChoiceAllowed(avatarChoice, { factionClubId: onboarding.faction_club_id ?? null })) {
          return jsonResponse({ ok: false, error: "bad_avatar_choice" }, 400, corsHeaders());
        }
      }

      const saved = await saveUserAvatarChoice(supabase, auth.user.id, avatarChoice);
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
      const adminBearer = getAdminBearerToken(request);
      if (adminBearer) {
        const authResult = await authorizePresentationAdminAccess(supabase, env, request, initData);
        if (!authResult.ok) {
          const status = adminAccessErrorStatus(authResult.error);
          return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
        }
      } else {
        const auth = await authenticateWithDevBypass(request, env, initData);
        if (!auth.ok) {
          return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
        }
        await storeUser(supabase, auth.user);
      }

      const limit = parseLimit(url.searchParams.get("limit"), 10, 200);
      const users = await listLeaderboard(supabase, limit);
      if (!users) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse({ ok: true, users }, 200, corsHeaders());
    }

    if (url.pathname === "/api/faction-members") {
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
      const auth = await authenticateWithDevBypass(request, env, initData);
      if (!auth.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const parsedLimit = parseLimit(url.searchParams.get("limit"), 6, 50);
      const limit = parsedLimit ?? 6;

      const factionId = await getUserFactionClubId(supabase, auth.user.id);
      if (!factionId) {
        return jsonResponse({ ok: true, faction: null, members: [] }, 200, corsHeaders());
      }

      const members = await listFactionMembers(supabase, factionId, limit);
      if (!members) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      const factionRank = await getFactionLeaderboardRank(supabase, factionId);
      return jsonResponse({ ok: true, faction: factionId, members, faction_rank: factionRank }, 200, corsHeaders());
    }

    if (url.pathname === "/api/faction-chat-preview") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      const body = await readJson<{ initData?: string; limit?: number }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }
      const initData = body.initData?.trim();
      if (!initData) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const auth = await authenticateInitData(initData, env.BOT_TOKEN);
      if (!auth.ok || !auth.user) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const supabase = createSupabaseClient(env);
      if (!supabase) {
        return jsonResponse({ ok: false, error: "missing_supabase" }, 500, corsHeaders());
      }

      await storeUser(supabase, auth.user);

      const userFaction = await getUserFactionSlug(supabase, auth.user.id);
      if (!userFaction) {
        return jsonResponse({ ok: false, error: "faction_not_selected" }, 400, corsHeaders());
      }

      const refs = getFactionChatRefs(env);
      const chatRef = refs.bySlug[userFaction];
    if (!chatRef || typeof chatRef.chatId !== "number") {
      return jsonResponse({ ok: false, error: "chat_not_configured" }, 400, corsHeaders());
    }

    const rawLimit = typeof body.limit === "number" ? Math.floor(body.limit) : 2;
    const limit = Math.min(Math.max(rawLimit, 1), 3);
    const messages = await listFactionDebugMessages(supabase, userFaction, chatRef, limit);

    return jsonResponse(
      {
        ok: true,
        faction: userFaction,
        messages
      },
      200,
      corsHeaders()
    );
  }

  if (url.pathname === "/api/match-faction-predictions") {
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

    const body = await readJson<{ initData?: string; match_id?: number; faction?: string }>(request);
    if (!body) {
      return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
    }

    const auth = await authenticateInitData(body.initData ?? "", env.BOT_TOKEN);
    if (!auth.ok || !auth.user) {
      return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
    }
    await storeUser(supabase, auth.user);

    const isAdminUser = await checkAdmin(supabase, auth.user.id);
    if (!isAdminUser) {
      return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
    }

    const matchId = Number(body.match_id);
    if (!Number.isInteger(matchId)) {
      return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
    }

    const normalizedFaction = normalizeFactionChoice(body.faction ?? "");
    if (!normalizedFaction) {
      return jsonResponse({ ok: false, error: "bad_faction" }, 400, corsHeaders());
    }

    const result = await sendMatchFactionPredictions(env, supabase, matchId, normalizedFaction);
    if (result.ok) {
      return jsonResponse({ ok: true }, 200, corsHeaders());
    }
    const status = result.error === "no_predictions" ? 200 : 500;
    return jsonResponse({ ok: false, error: result.error }, status, corsHeaders());
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
      const auth = await authenticateWithDevBypass(request, env, initData);
      if (!auth.ok) {
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

    if (url.pathname === "/api/presentation/matches") {
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

      const dateParam = url.searchParams.get("date");
      const date = isValidKyivDateString(dateParam) ? dateParam : getKyivDateString();
      const matches = await listMatches(supabase, date);
      if (!matches) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      const scheduledMatches = matches.filter((match) => match.status === "scheduled");
      const matchIds = scheduledMatches.map((match) => match.id);
      const predictionLists = await listPresentationPredictions(
        supabase,
        matchIds,
        PRESENTATION_PREDICTION_LIMIT
      );
      const teamStatsCache = new Map<string, DbTeamMatchStat[]>();

      const payload = [];
      for (const match of scheduledMatches) {
        const homeClub = normalizeTeamSlug(match.home_club_id ?? match.home_team) ?? match.home_team;
        const awayClub = normalizeTeamSlug(match.away_club_id ?? match.away_team) ?? match.away_team;
        
        // Extract probabilities from API Football odds_json
        const oddsProbabilities = extractOddsProbabilitiesFromMatch(match);
        
        const homeStats = await fetchPresentationTeamStats(
          supabase,
          teamStatsCache,
          match.home_team,
          PRESENTATION_RECENT_MATCHES_LIMIT
        );
        const awayStats = await fetchPresentationTeamStats(
          supabase,
          teamStatsCache,
          match.away_team,
          PRESENTATION_RECENT_MATCHES_LIMIT
        );
        payload.push({
          ...match,
          home_club_id: homeClub,
          away_club_id: awayClub,
          home_probability: oddsProbabilities?.home ?? DEFAULT_PRESENTATION_PROBABILITIES.home,
          draw_probability: oddsProbabilities?.draw ?? DEFAULT_PRESENTATION_PROBABILITIES.draw,
          away_probability: oddsProbabilities?.away ?? DEFAULT_PRESENTATION_PROBABILITIES.away,
          predictions: predictionLists.get(match.id) ?? [],
          home_recent_matches: homeStats,
          away_recent_matches: awayStats
        });
      }

      return jsonResponse({ ok: true, matches: payload }, 200, corsHeaders());
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
      const adminBearer = getAdminBearerToken(request);
      let isAdmin = false;
      let adminAuthResult: { ok: true; user?: TelegramUser } | { ok: false; error: AdminAccessError } | null = null;
      if (adminBearer) {
        adminAuthResult = await authorizePresentationAdminAccess(supabase, env, request, initData);
        if (!adminAuthResult.ok) {
          const status = adminAccessErrorStatus(adminAuthResult.error);
          return jsonResponse({ ok: false, error: adminAuthResult.error }, status, corsHeaders());
        }
        isAdmin = true;
      }

      let auth: { ok: true; user?: TelegramUser };
      if (isAdmin) {
        auth = adminAuthResult!;
      } else {
        const devAuth = await authenticateWithDevBypass(request, env, initData);
        if (!devAuth.ok) {
          return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
        }
        auth = devAuth;
        await storeUser(supabase, auth.user);
      }

        const date = url.searchParams.get("date") || undefined;
        // Для адміна завантажуємо всі матчі (включаючи "pending")
        const matches = isAdmin 
          ? await listAllMatches(supabase, date)
          : await listMatches(supabase, date);
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

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const match = await createMatch(supabase, authResult.user?.id ?? null, body);
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
      const authResult = await authorizePresentationAdminAccess(supabase, env, request, initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
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

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
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

      const body = await readJson<{
        initData?: string;
        match_id?: number | string;
        debug?: boolean;
      }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
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

    if (url.pathname === "/api/matches/odds/manual") {
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

      const body = await readJson<ManualOddsPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const matchId = parseInteger(body.match_id);
      if (matchId === null) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const homeOdd = parseOddNumber(body.home_odd);
      const drawOdd = parseOddNumber(body.draw_odd);
      const awayOdd = parseOddNumber(body.away_odd);
      if (!homeOdd || !drawOdd || !awayOdd) {
        return jsonResponse({ ok: false, error: "bad_odds" }, 400, corsHeaders());
      }

      const update = {
        odds_manual_home: homeOdd,
        odds_manual_draw: drawOdd,
        odds_manual_away: awayOdd,
        odds_manual_updated_at: new Date().toISOString()
      };

      try {
        const { data, error } = await supabase
          .from("matches")
          .update(update)
          .eq("id", matchId)
          .select(
            "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at, odds_manual_home, odds_manual_draw, odds_manual_away, odds_manual_updated_at"
          )
          .single();
        if (error || !data) {
          return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
        }
        return jsonResponse({ ok: true, match: data as DbMatch }, 200, corsHeaders());
      } catch (error) {
        console.error("Failed to update manual odds", error);
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }
    }

    if (url.pathname === "/api/clubs/sync") {
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

      const body = await readJson<ClubSyncPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const initData = body.initData?.trim() ?? "";
      const adminBearer = getAdminBearerToken(request);
      if (adminBearer) {
        const authResult = await authorizePresentationAdminAccess(supabase, env, request, initData || undefined);
        if (!authResult.ok) {
          const status = adminAccessErrorStatus(authResult.error);
          return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
        }
      } else if (initData) {
        const auth = await authenticateInitData(initData, env.BOT_TOKEN);
        if (!auth.ok || !auth.user) {
          return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
        }

        await storeUser(supabase, auth.user);
        const isAdmin = await checkAdmin(supabase, auth.user.id);
        if (!isAdmin) {
          return jsonResponse({ ok: false, error: "forbidden" }, 403, corsHeaders());
        }
      } else {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }

      if (!env.API_FOOTBALL_KEY) {
        return jsonResponse({ ok: false, error: "missing_api_key" }, 500, corsHeaders());
      }

      const normalizedLeagueId = normalizeLeagueId(body.league_id ?? null);
      if (body.league_id && !normalizedLeagueId) {
        return jsonResponse({ ok: false, error: "bad_league" }, 400, corsHeaders());
      }

      const explicitApiLeagueId = parseInteger(body.api_league_id);
      const apiLeagueId = explicitApiLeagueId ?? resolveApiLeagueId(env, normalizedLeagueId);
      if (!apiLeagueId) {
        return jsonResponse({ ok: false, error: "missing_league_mapping" }, 400, corsHeaders());
      }

      let season = parseInteger(body.season);
      if (!season) {
        const timezone = getApiFootballTimezone(env);
        if (!timezone) {
          return jsonResponse({ ok: false, error: "missing_timezone" }, 400, corsHeaders());
        }
        season = resolveSeasonForDate(new Date(), timezone);
      }

      const teamsResult = await fetchTeamsByLeague(env, apiLeagueId, season);
      if (!teamsResult.teams.length) {
        return jsonResponse(
          { ok: false, error: "api_error", detail: `teams_status_${teamsResult.status}` },
          502,
          corsHeaders()
        );
      }

      const nowIso = new Date().toISOString();
      const rows = teamsResult.teams
        .map((entry) => buildClubApiMapRow(entry, normalizedLeagueId ?? null, season, nowIso))
        .filter((entry): entry is ClubApiMapRow => Boolean(entry));

      if (!rows.length) {
        return jsonResponse({ ok: false, error: "teams_empty" }, 200, corsHeaders());
      }

      try {
        const { error } = await supabase.from("club_api_map").upsert(rows, { onConflict: "api_team_id" });
        if (error) {
          return jsonResponse({ ok: false, error: "db_error", detail: error.message }, 500, corsHeaders());
        }
      } catch (error) {
        console.error("Failed to upsert club_api_map", error);
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      return jsonResponse(
        {
          ok: true,
          updated: rows.length,
          teams_total: teamsResult.teams.length,
          league_id: normalizedLeagueId ?? null,
          api_league_id: apiLeagueId,
          season
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
        const auth = await authenticateWithDevBypass(request, env, initDataHeader);
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

      const timezone = getApiFootballTimezone(env) ?? "Europe/Kyiv";
      const seasonMonth = resolveSeasonMonthForMatch(match.kickoff_at, timezone);
      const prediction = await insertPrediction(supabase, auth.user.id, matchId, body, seasonMonth);
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

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
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

      const timezone = getApiFootballTimezone(env) ?? "Europe/Kyiv";
      const result = await applyMatchResult(supabase, matchId, homeScore, awayScore, homeRating, awayRating, timezone);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      let notificationsToSend = result.notifications;
      if (notificationsToSend.length === 0) {
        notificationsToSend = await buildMatchResultNotificationsForResend(supabase, matchId, timezone);
      }

      await logDebugUpdate(supabase, "match_result_notifications_count", {
        matchId,
        error: `count=${notificationsToSend.length}`
      });

      if (notificationsToSend.length) {
        await enqueueMatchResultNotifications(env, supabase, notificationsToSend);
        ctx.waitUntil(handleMatchResultNotificationQueue(env));
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/match-result-notify") {
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

      const adminBearer = getAdminBearerToken(request);
      if (!adminBearer) {
        return jsonResponse({ ok: false, error: "missing_token" }, 401, corsHeaders());
      }
      const authResult = await authorizePresentationAdminAccess(supabase, env, request);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const secret = env.ADMIN_JWT_SECRET?.trim();
      if (!secret) {
        return jsonResponse({ ok: false, error: "missing_secret" }, 500, corsHeaders());
      }
      const verification = await verifyAdminJwt(adminBearer, secret);
      if (!verification.ok) {
        const status = adminAccessErrorStatus("invalid_token");
        return jsonResponse({ ok: false, error: "invalid_token" }, status, corsHeaders());
      }

      const body = await readJson<{ match_id?: number }>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }
      const matchId = parseInteger(body.match_id);
      if (!matchId) {
        return jsonResponse({ ok: false, error: "bad_match_id" }, 400, corsHeaders());
      }

      const timezone = getApiFootballTimezone(env) ?? "Europe/Kyiv";
      const notifications = await buildMatchResultNotificationsForResend(supabase, matchId, timezone);
      await logDebugUpdate(supabase, "match_result_resend_notifications", {
        matchId,
        error: `count=${notifications.length}`
      });

      if (notifications.length) {
        await enqueueMatchResultNotifications(env, supabase, notifications);
        ctx.waitUntil(handleMatchResultNotificationQueue(env));
      }

      return jsonResponse({ ok: true, count: notifications.length }, 200, corsHeaders());
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

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      await logDebugUpdate(supabase, "announcement_request");

      const scheduledMatches = await listScheduledMatches(supabase);
      if (scheduledMatches === null) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      const kyivDay = getKyivDateString();
      const kyivRange = getKyivDayRange(kyivDay);
      const todayMatches =
        kyivRange && scheduledMatches.length
          ? filterMatchesByRange(scheduledMatches, kyivRange)
          : scheduledMatches;
      if (todayMatches.length === 0) {
        return jsonResponse({ ok: true }, 200, corsHeaders());
      }

      const users = await listAllUserIds(supabase);
      if (!users) {
        return jsonResponse({ ok: false, error: "db_error" }, 500, corsHeaders());
      }

      await enqueueMatchesAnnouncement(supabase, users, todayMatches, kyivDay);
      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/admin/channel-webapp") {
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

      const body = await readJson<ChannelWebappPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const caption = body.caption?.trim() || undefined;
      const result = await sendPhotoWithResult(
        env,
        CHANNEL_WEBAPP_CHAT,
        buildWebappImageUrl(env, CHANNEL_WEBAPP_IMAGE),
        caption,
        {
          inline_keyboard: [[{ text: CHANNEL_WEBAPP_BUTTON_TEXT, url: CHANNEL_WEBAPP_BUTTON_URL }]]
        }
      );
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: "telegram_error", status: result.status, body: result.body },
          502,
          corsHeaders()
        );
      }

      return jsonResponse({ ok: true }, 200, corsHeaders());
    }

    if (url.pathname === "/api/faction-predictions-stats") {
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

      const body = await readJson<FactionPredictionsStatsPayload>(request);
      if (!body) {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const authResult = await authorizePresentationAdminAccess(supabase, env, request, body.initData);
      if (!authResult.ok) {
        const status = adminAccessErrorStatus(authResult.error);
        return jsonResponse({ ok: false, error: authResult.error }, status, corsHeaders());
      }

      const result = await sendFactionPredictionsStats(supabase, env);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.error }, 500, corsHeaders());
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

      const supabase = createSupabaseClient(env);
      if (supabase) {
        await insertDebugUpdate(supabase, update);
        await insertIncomingPrivateMessageLog(supabase, update);
      } else {
        console.error("Supabase not configured; /pay will not work");
      }
      await enforceFactionChatPermissions(env, supabase, update);
      await handleUpdate(update, env, supabase);
      return new Response("ok");
    }

    return new Response("Not Found", { status: 404 });
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handlePredictionReminders(env));
    ctx.waitUntil(handleMatchStartDigests(env));
    ctx.waitUntil(handleSubscriptionExpiryReminders(env));
    ctx.waitUntil(handleMatchResultNotificationQueue(env));
    ctx.waitUntil(handleAnnouncementQueue(env));
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

function isDevBypassRequest(request: Request, env: Env): boolean {
  if (env.DEV_BYPASS !== "1") {
    return false;
  }
  const url = new URL(request.url);
  const hostname = url.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  if (url.searchParams.get("dev") === "1") {
    return true;
  }
  const headerToken = request.headers.get("x-dev-bypass");
  return Boolean(env.DEV_BYPASS_TOKEN && headerToken === env.DEV_BYPASS_TOKEN);
}

function getDevUser(): TelegramUser {
  return {
    id: 1,
    first_name: "Dev",
    last_name: "User",
    username: "dev"
  };
}

async function authenticateWithDevBypass(
  request: Request,
  env: Env,
  initData?: string | null
): Promise<{ ok: true; user: TelegramUser } | { ok: false }> {
  if (isDevBypassRequest(request, env)) {
    return { ok: true, user: getDevUser() };
  }
  const initDataValue = initData ?? getInitDataFromHeaders(request);
  if (!initDataValue) {
    return { ok: false };
  }
  const auth = await authenticateInitData(initDataValue, env.BOT_TOKEN);
  if (!auth.ok || !auth.user) {
    return { ok: false };
  }
  return { ok: true, user: auth.user };
}

async function insertDebugUpdate(supabase: SupabaseClient, update: TelegramUpdate): Promise<void> {
  const updateType = resolveUpdateType(update);
  const message = getUpdateMessage(update);
  const record = {
    update_type: updateType,
    chat_id: message?.chat?.id ?? null,
    thread_id: message?.message_thread_id ?? null,
    message_id: message?.message_id ?? null,
    user_id: message?.from?.id ?? null,
    text: message?.text ?? null,
    created_at: new Date().toISOString()
  };
  try {
    const { error } = await supabase.from("debug_updates").insert(record);
    if (error) {
      console.error("Failed to insert debug update", error);
    }
  } catch (error) {
    console.error("Failed to insert debug update", error);
  }
}

async function insertIncomingPrivateMessageLog(supabase: SupabaseClient, update: TelegramUpdate): Promise<void> {
  if (!update.message) {
    return;
  }
  const message = update.message;
  if (!message.chat || message.chat.type !== "private") {
    return;
  }
  if (message.from?.is_bot) {
    return;
  }
  const chatId = message.chat.id ?? null;
  const userId = message.from?.id ?? message.chat.id ?? null;
  if (typeof chatId !== "number" || chatId <= 0) {
    return;
  }
  const text = message.text?.trim() ?? null;
  const messageType = text ? "text" : "system";
  try {
    const { error } = await supabase.from("bot_message_logs").insert({
      chat_id: chatId,
      user_id: userId,
      user_nickname: message.from?.username ?? null,
      admin_id: null,
      thread_id: message.message_thread_id ?? null,
      message_id: message.message_id ?? null,
      direction: "in",
      sender: "user",
      message_type: messageType,
      text,
      payload: null,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error("Failed to insert incoming bot message log", error);
    }
  } catch (error) {
    console.error("Failed to insert incoming bot message log", error);
  }
}

async function insertDebugAudit(
  supabase: SupabaseClient,
  payload: {
    update_type: string;
    chat_id?: number | null;
    thread_id?: number | null;
    message_id?: number | null;
    user_id?: number | null;
    text?: string | null;
  }
): Promise<void> {
  const record = {
    update_type: payload.update_type,
    chat_id: payload.chat_id ?? null,
    thread_id: payload.thread_id ?? null,
    message_id: payload.message_id ?? null,
    user_id: payload.user_id ?? null,
    text: payload.text ?? null,
    created_at: new Date().toISOString()
  };
  try {
    const { error } = await supabase.from("debug_updates").insert(record);
    if (error) {
      console.error("Failed to insert debug audit", error);
    }
  } catch (error) {
    console.error("Failed to insert debug audit", error);
  }
}

async function insertBotDebugMessage(
  supabase: SupabaseClient,
  chatId: number | null,
  threadId: number | null,
  text: string
): Promise<void> {
  const normalizedText = text.trim();
  if (!normalizedText || typeof chatId !== "number") {
    return;
  }
  await insertDebugAudit(supabase, {
    update_type: "message",
    chat_id: chatId,
    thread_id: typeof threadId === "number" ? threadId : null,
    message_id: null,
    user_id: null,
    text: normalizedText
  });
}

async function handleSubscriptionExpiryReminders(env: Env): Promise<void> {
  if (getKyivHour() !== 18) {
    return;
  }
  const kyivDate = getKyivDateString();
  const range = getKyivDayRange(kyivDate);
  if (!range) {
    return;
  }
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Subscription reminders skipped: missing supabase");
    return;
  }

  const { data: users, error } = await supabase
    .from("users")
    .select("id, subscription_expires_at")
    .gte("subscription_expires_at", range.start)
    .lte("subscription_expires_at", range.end);
  if (error) {
    console.error("Failed to load subscription reminders users", error);
    return;
  }

  const userRows = (users as Array<{ id: number; subscription_expires_at: string | null }>) ?? [];
  const userIds = userRows.map((row) => row.id).filter((id): id is number => typeof id === "number");
  if (!userIds.length) {
    return;
  }

  const reminded = await loadReminderUserIds(supabase, range, userIds);
  const webappBaseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  const imageUrl = `${webappBaseUrl}/images/subscription.png`;
  const caption =
    "ЗАВТРА РОЗПОЧИНАЄТЬСЯ НАСТУПНА КАДЕНЦІЯ.\nБАЖАЄШ ДОЛУЧИТИСЬ ДО ФУТБОЛЬНОЇ РАДИ?";

  for (const userId of userIds) {
    if (reminded.has(userId)) {
      continue;
    }
    try {
      await sendPhoto(env, userId, imageUrl, caption, {
        inline_keyboard: [[{ text: "ПРИЄДНАТИСЬ", callback_data: "subscription_pay" }]]
      });
      await supabase.from("debug_updates").insert({
        update_type: "subscription_reminder",
        chat_id: userId,
        thread_id: null,
        message_id: null,
        user_id: userId,
        text: "reminder_sent",
        created_at: new Date().toISOString()
      });
    } catch (sendError) {
      console.error("Failed to send subscription reminder", { userId, sendError });
    }
  }
}

async function maybeGrantFreeMonthOnOnboarding(
  supabase: SupabaseClient,
  userId: number
): Promise<void> {
  const { data, error } = await supabase
    .from("users")
    .select("subscription_expires_at, subscription_free_month_used")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load subscription state for onboarding", error);
    return;
  }

  const freeMonthUsed = data?.subscription_free_month_used === true;
  if (freeMonthUsed) {
    return;
  }

  const expiresAtValue = data?.subscription_expires_at ?? null;
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
  const targetExpiry = computeCurrentMonthExpiry();
  const nextExpiry =
    expiresAt && expiresAt.getTime() > targetExpiry.getTime() ? expiresAt : targetExpiry;

  const { error: updateError } = await supabase
    .from("users")
    .update({
      subscription_expires_at: nextExpiry.toISOString(),
      subscription_free_month_used: true
    })
    .eq("id", userId);
  if (updateError) {
    console.error("Failed to grant free month on onboarding", updateError);
  }
}

async function loadReminderUserIds(
  supabase: SupabaseClient,
  range: { start: string; end: string },
  userIds: number[]
): Promise<Set<number>> {
  if (!userIds.length) {
    return new Set();
  }
  const { data, error } = await supabase
    .from("debug_updates")
    .select("user_id")
    .eq("update_type", "subscription_reminder")
    .gte("created_at", range.start)
    .lte("created_at", range.end)
    .in("user_id", userIds);
  if (error) {
    console.error("Failed to load subscription reminder logs", error);
    return new Set();
  }
  const reminded = new Set<number>();
  (data as Array<{ user_id?: number | null }> | null)?.forEach((row) => {
    if (typeof row.user_id === "number") {
      reminded.add(row.user_id);
    }
  });
  return reminded;
}

function resolveUpdateType(update: TelegramUpdate): string {
  if (update.pre_checkout_query) {
    return "pre_checkout_query";
  }
  if (update.message) {
    return "message";
  }
  if (update.edited_message) {
    return "edited_message";
  }
  if (update.channel_post) {
    return "channel_post";
  }
  if (update.edited_channel_post) {
    return "edited_channel_post";
  }
  return "unknown";
}

function formatFactionName(faction: FactionBranchSlug | "general"): string {
  if (faction === "general") {
    return "Загальний чат";
  }
  return FACTION_DISPLAY_NAMES[faction] ?? faction;
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

async function notifyFactionChatNewDeputy(
  env: Env,
  supabase: SupabaseClient,
  user: TelegramUser,
  faction: FactionBranchSlug,
  options?: { nickname?: string | null }
): Promise<void> {
  const refs = getFactionChatRefs(env);
  const targetRef = refs.bySlug[faction];
  if (!targetRef) {
    return;
  }
  const chatTarget = targetRef.chatId ?? (targetRef.chatUsername ? `@${targetRef.chatUsername}` : null);
  if (!chatTarget) {
    return;
  }
  const nicknameCandidate = options?.nickname?.trim();
  const username = user.username?.trim();
  const mention = username && nicknameCandidate
    ? `@${username} - ${nicknameCandidate}`
    : nicknameCandidate || formatUserDisplay(user);
  const message = `У ФРАКЦІЮ ПРИЄДНАВСЯ НОВИЙ ДЕПУТАТ:\n${mention}`;
  await sendMessage(env, chatTarget, message, undefined, undefined, targetRef.threadId ?? undefined);
  await insertBotDebugMessage(
    supabase,
    typeof targetRef.chatId === "number" ? targetRef.chatId : null,
    targetRef.threadId ?? null,
    message
  );
}

async function getUserClassicoChoice(
  supabase: SupabaseClient,
  userId: number
): Promise<"real_madrid" | "barcelona" | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("faction_club_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load user faction", error);
      return null;
    }

    return normalizeClassicoChoice(data?.faction_club_id ?? null);
  } catch (error) {
    console.error("Failed to load user faction", error);
  }
  return null;
}

async function getUserFactionSlug(supabase: SupabaseClient, userId: number): Promise<FactionBranchSlug | null> {
  const factionId = await getUserFactionClubId(supabase, userId);
  return normalizeFactionChoice(factionId);
}

async function getUserFactionClubId(supabase: SupabaseClient, userId: number): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("faction_club_id")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load user faction", error);
      return null;
    }

    const factionId = (data?.faction_club_id ?? "").trim();
    return factionId || null;
  } catch (error) {
    console.error("Failed to load user faction", error);
    return null;
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
        "id, username, first_name, last_name, photo_url, points_total, updated_at, last_seen_at, nickname, avatar_choice, faction_club_id"
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

async function getPredictionAccuracyStats(
  supabase: SupabaseClient,
  limit: number,
  month: string | null = null
): Promise<{ matches: AdminPredictionAccuracyMatch[]; users: AdminPredictionAccuracyUser[] } | null> {
  try {
    let query = supabase
      .from("matches")
      .select("id, home_team, away_team, league_id, home_club_id, away_club_id, home_score, away_score, kickoff_at")
      .eq("status", "finished")
      .order("kickoff_at", { ascending: false });

    if (month) {
      const monthRange = getKyivMonthRange(month);
      if (!monthRange) {
        return { matches: [], users: [] };
      }
      query = query.gte("kickoff_at", monthRange.start).lte("kickoff_at", monthRange.end).limit(1000);
    } else {
      query = query.limit(limit);
    }

    const { data: matchesData, error: matchesError } = await query;

    if (matchesError) {
      console.error("Failed to fetch finished matches for prediction accuracy", matchesError);
      return null;
    }

    const matches = (matchesData as Array<{
      id?: number | null;
      home_team?: string | null;
      away_team?: string | null;
      league_id?: string | null;
      home_club_id?: string | null;
      away_club_id?: string | null;
      home_score?: number | null;
      away_score?: number | null;
      kickoff_at?: string | null;
    }> | null | undefined) ?? [];

    const matchIds = matches
      .map((match) => (typeof match.id === "number" ? match.id : null))
      .filter((value): value is number => typeof value === "number");

    if (matchIds.length === 0) {
      return { matches: [], users: [] };
    }

    const { data: predictionsData, error: predictionsError } = await supabase
      .from("predictions")
      .select(
        "match_id, user_id, home_pred, away_pred, points, users(id, username, first_name, last_name, nickname, photo_url, avatar_choice)"
      )
      .in("match_id", matchIds);

    if (predictionsError) {
      console.error("Failed to fetch predictions for prediction accuracy", predictionsError);
      return null;
    }

    const predictions =
      (predictionsData as Array<{
        match_id?: number | null;
        user_id?: number | null;
        home_pred?: number | null;
        away_pred?: number | null;
        points?: number | null;
        users?:
          | {
              id?: number | null;
              username?: string | null;
              first_name?: string | null;
              last_name?: string | null;
              nickname?: string | null;
              photo_url?: string | null;
              avatar_choice?: string | null;
            }
          | Array<{
              id?: number | null;
              username?: string | null;
              first_name?: string | null;
              last_name?: string | null;
              nickname?: string | null;
              photo_url?: string | null;
              avatar_choice?: string | null;
            }>
          | null;
      }> | null | undefined) ?? [];

    const matchStats = new Map<number, { total: number; hits: number; homePredSum: number; awayPredSum: number }>();
    const usersMap = new Map<
      number,
      {
        user: AdminPredictionAccuracyUser;
        total: number;
        hits: number;
      }
    >();

    for (const prediction of predictions) {
      const matchId = typeof prediction.match_id === "number" ? prediction.match_id : null;
      const userId = typeof prediction.user_id === "number" ? prediction.user_id : null;
      if (!matchId || !userId) {
        continue;
      }
      const points = typeof prediction.points === "number" ? prediction.points : 0;
      const hit = points > 0;
      const homePred = typeof prediction.home_pred === "number" ? prediction.home_pred : 0;
      const awayPred = typeof prediction.away_pred === "number" ? prediction.away_pred : 0;

      const matchStat = matchStats.get(matchId) ?? { total: 0, hits: 0, homePredSum: 0, awayPredSum: 0 };
      matchStat.total += 1;
      if (hit) {
        matchStat.hits += 1;
      }
      matchStat.homePredSum += homePred;
      matchStat.awayPredSum += awayPred;
      matchStats.set(matchId, matchStat);

      const rawUser = Array.isArray(prediction.users) ? prediction.users[0] ?? null : prediction.users ?? null;
      const baseUser: AdminPredictionAccuracyUser = usersMap.get(userId)?.user ?? {
        user_id: userId,
        username: null,
        first_name: null,
        last_name: null,
        nickname: null,
        photo_url: null,
        avatar_choice: null,
        total_predictions: 0,
        hits: 0,
        accuracy_pct: 0
      };
      if (rawUser) {
        baseUser.username = rawUser.username ?? baseUser.username ?? null;
        baseUser.first_name = rawUser.first_name ?? baseUser.first_name ?? null;
        baseUser.last_name = rawUser.last_name ?? baseUser.last_name ?? null;
        baseUser.nickname = rawUser.nickname ?? baseUser.nickname ?? null;
        baseUser.photo_url = rawUser.photo_url ?? baseUser.photo_url ?? null;
        baseUser.avatar_choice = rawUser.avatar_choice ?? baseUser.avatar_choice ?? null;
      }

      const userBucket = usersMap.get(userId) ?? { user: baseUser, total: 0, hits: 0 };
      userBucket.total += 1;
      if (hit) {
        userBucket.hits += 1;
      }
      usersMap.set(userId, userBucket);
    }

    const formattedMatches: AdminPredictionAccuracyMatch[] = matches
      .map((match) => {
        const id = typeof match.id === "number" ? match.id : null;
        const homeTeam = typeof match.home_team === "string" ? match.home_team : "";
        const awayTeam = typeof match.away_team === "string" ? match.away_team : "";
        const kickoffAt = typeof match.kickoff_at === "string" ? match.kickoff_at : "";
        if (!id || !homeTeam || !awayTeam || !kickoffAt) {
          return null;
        }
        const stats = matchStats.get(id) ?? { total: 0, hits: 0, homePredSum: 0, awayPredSum: 0 };
        const accuracy = stats.total > 0 ? Math.round((stats.hits / stats.total) * 100) : 0;
        const avgHomePred = stats.total > 0 ? Number((stats.homePredSum / stats.total).toFixed(1)) : 0;
        const avgAwayPred = stats.total > 0 ? Number((stats.awayPredSum / stats.total).toFixed(1)) : 0;
        return {
          match_id: id,
          home_team: homeTeam,
          away_team: awayTeam,
          league_id: match.league_id ?? null,
          home_club_id: match.home_club_id ?? null,
          away_club_id: match.away_club_id ?? null,
          home_score: typeof match.home_score === "number" ? match.home_score : null,
          away_score: typeof match.away_score === "number" ? match.away_score : null,
          kickoff_at: kickoffAt,
          total_predictions: stats.total,
          hits: stats.hits,
          accuracy_pct: accuracy,
          avg_home_pred: avgHomePred,
          avg_away_pred: avgAwayPred
        };
      })
      .filter((row): row is AdminPredictionAccuracyMatch => Boolean(row));

    const formattedUsers: AdminPredictionAccuracyUser[] = Array.from(usersMap.values())
      .map((entry) => {
        const accuracy = entry.total > 0 ? Math.round((entry.hits / entry.total) * 100) : 0;
        return {
          ...entry.user,
          total_predictions: entry.total,
          hits: entry.hits,
          accuracy_pct: accuracy
        };
      })
      .sort((a, b) => {
        if (b.accuracy_pct !== a.accuracy_pct) {
          return b.accuracy_pct - a.accuracy_pct;
        }
        if (b.total_predictions !== a.total_predictions) {
          return b.total_predictions - a.total_predictions;
        }
        return resolveAccuracyUserSortLabel(a).localeCompare(resolveAccuracyUserSortLabel(b), "uk");
      });

    return { matches: formattedMatches, users: formattedUsers };
  } catch (error) {
    console.error("Failed to build prediction accuracy stats", error);
    return null;
  }
}

function resolveAccuracyUserSortLabel(user: AdminPredictionAccuracyUser): string {
  const nickname = user.nickname?.trim();
  if (nickname) {
    return nickname.toLowerCase();
  }
  const username = user.username?.trim();
  if (username) {
    return username.toLowerCase();
  }
  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  if (fullName) {
    return fullName.toLowerCase();
  }
  return String(user.user_id);
}

async function listFactionMembers(
  supabase: SupabaseClient,
  factionId: string,
  limit?: number | null
): Promise<StoredUser[] | null> {
  try {
    let query = supabase
      .from("users")
      .select(
        "id, username, first_name, last_name, photo_url, points_total, updated_at, last_seen_at, nickname, avatar_choice, faction_club_id"
      )
      .eq("faction_club_id", factionId)
      .order("points_total", { ascending: false })
      .order("updated_at", { ascending: false });
    if (typeof limit === "number") {
      query = query.limit(limit);
    }
    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch faction members", error);
      return null;
    }

    return (data as StoredUser[]) ?? [];
  } catch (error) {
    console.error("Failed to fetch faction members", error);
    return null;
  }
}

async function getFactionLeaderboardRank(supabase: SupabaseClient, factionId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("faction_club_id, points_total")
      .not("faction_club_id", "is", null)
      .order("points_total", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("Failed to fetch faction rank", error);
      return null;
    }
    const seen = new Set<string>();
    let lastPoints: number | null = null;
    let rank = 0;
    for (const row of (data as Array<{ faction_club_id: string | null; points_total: number | null }>) ?? []) {
      const rawFaction = row.faction_club_id?.trim();
      if (!rawFaction) {
        continue;
      }
      const normalized = rawFaction.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      const points = typeof row.points_total === "number" ? row.points_total : STARTING_POINTS;
      if (lastPoints === null || points !== lastPoints) {
        rank += 1;
        lastPoints = points;
      }
      seen.add(normalized);
      if (normalized === factionId.toLowerCase()) {
        return rank <= 5 ? rank : null;
      }
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch faction rank", error);
    return null;
  }
}

type DebugUpdateRow = {
  id: number;
  chat_id: number | null;
  thread_id: number | null;
  user_id: number | null;
  text: string | null;
  created_at: string | null;
};

function formatStoredUserLabel(user: StoredUser | null, fallbackId: number | null): string | null {
  if (user) {
    const nickname = (user.nickname ?? "").trim();
    if (nickname) {
      return nickname;
    }
    const telegramUser: TelegramUser = {
      id: user.id ?? 0,
      username: user.username ?? undefined,
      first_name: user.first_name ?? undefined,
      last_name: user.last_name ?? undefined
    };
    const display = formatUserDisplay(telegramUser);
    if (display) {
      return display;
    }
  }
  return typeof fallbackId === "number" ? `id:${fallbackId}` : null;
}

async function listFactionDebugMessages(
  supabase: SupabaseClient,
  faction: FactionBranchSlug,
  ref: FactionChatRef,
  limit: number
): Promise<
  Array<{
    id: number;
    text: string;
    author: string | null;
    nickname: string | null;
    created_at: string;
  }>
> {
  if (typeof ref.chatId !== "number") {
    return [];
  }
  try {
    let query = supabase
      .from("debug_updates")
      .select("id, chat_id, thread_id, user_id, text, created_at")
      .eq("update_type", "message")
      .eq("chat_id", ref.chatId)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 5));
    if (typeof ref.threadId === "number") {
      query = query.eq("thread_id", ref.threadId);
    } else {
      query = query.is("thread_id", null);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Failed to load debug updates", error);
      return [];
    }
    const rows = (data as DebugUpdateRow[]) ?? [];
    const userIds = Array.from(
      new Set(rows.map((row) => row.user_id).filter((id): id is number => typeof id === "number"))
    );
    const usersById = new Map<number, StoredUser>();
    if (userIds.length) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, username, first_name, last_name, nickname")
        .in("id", userIds);
      if (usersError) {
        console.error("Failed to load debug update users", usersError);
      } else {
        (users as StoredUser[]).forEach((user) => {
          if (typeof user.id === "number") {
            usersById.set(user.id, user);
          }
        });
      }
    }

    return rows
      .map((row) => {
        const normalizedText = (row.text ?? "").trim();
        if (!normalizedText) {
          return null;
        }
        const user = typeof row.user_id === "number" ? usersById.get(row.user_id) ?? null : null;
        const author = user
          ? formatStoredUserLabel(user, row.user_id ?? null)
          : row.user_id === null
            ? "СЕКРЕТАР"
            : formatStoredUserLabel(null, row.user_id ?? null);
        return {
          id: row.id,
          text: normalizedText,
          author,
          nickname: user?.nickname ?? null,
          created_at: row.created_at ?? new Date().toISOString()
        };
      })
      .filter((item): item is { id: number; text: string; author: string | null; nickname: string | null; created_at: string } => Boolean(item))
      .slice(0, limit);
  } catch (error) {
    console.error("Failed to load debug updates", error);
    return [];
  }
}

function matchChatRef(ref: FactionChatRef | undefined | null, message: TelegramMessage): boolean {
  if (!ref || !message.chat) {
    return false;
  }
  const chatIdMatches =
    typeof ref.chatId === "number" && typeof message.chat.id === "number" && ref.chatId === message.chat.id;
  const usernameMatches =
    ref.chatUsername &&
    message.chat.username &&
    ref.chatUsername.toLowerCase() === message.chat.username.toLowerCase();
  if (!chatIdMatches && !usernameMatches) {
    return false;
  }
  const threadId = message.message_thread_id ?? null;
  if (typeof ref.threadId === "number") {
    return threadId === ref.threadId;
  }
  return threadId === null;
}

function matchChatRefAnyThread(ref: FactionChatRef | undefined | null, message: TelegramMessage): boolean {
  if (!ref || !message.chat) {
    return false;
  }
  const chatIdMatches =
    typeof ref.chatId === "number" && typeof message.chat.id === "number" && ref.chatId === message.chat.id;
  const usernameMatches =
    ref.chatUsername &&
    message.chat.username &&
    ref.chatUsername.toLowerCase() === message.chat.username.toLowerCase();
  if (!chatIdMatches && !usernameMatches) {
    return false;
  }
  if (typeof ref.threadId !== "number") {
    return true;
  }
  const threadId = message.message_thread_id ?? null;
  return threadId === ref.threadId;
}

function matchChatRefByChat(
  ref: FactionChatRef | undefined | null,
  chat: { id?: number; username?: string } | null | undefined
): boolean {
  if (!ref || !chat) {
    return false;
  }
  const chatIdMatches = typeof ref.chatId === "number" && typeof chat.id === "number" && ref.chatId === chat.id;
  const usernameMatches =
    ref.chatUsername && chat.username && ref.chatUsername.toLowerCase() === chat.username.toLowerCase();
  return chatIdMatches || usernameMatches;
}
function getExcludedThreadRefs(env: Env): FactionChatRef[] {
  const excludedThreads = env.FACTION_CHAT_EXCLUDED_THREADS?.trim();
  if (!excludedThreads) {
    return [];
  }
  return excludedThreads
    .split(",")
    .map((ref) => parseChatRef(ref.trim(), "excluded"))
    .filter((ref): ref is FactionChatRef => ref !== null);
}

function getAllowedWriterRefs(env: Env): FactionChatRef[] {
  const allowedWriters = env.FACTION_CHAT_ALLOWED_WRITERS?.trim();
  if (!allowedWriters) {
    return [];
  }
  return allowedWriters
    .split(",")
    .map((ref) => parseChatRef(ref.trim(), "allowed-writer"))
    .filter((ref): ref is FactionChatRef => ref !== null);
}

async function enforceFactionChatPermissions(
  env: Env,
  supabase: SupabaseClient | null,
  update: TelegramUpdate
): Promise<void> {
  const message = getUpdateMessage(update);
  if (
    !message ||
    typeof message.chat?.id !== "number" ||
    typeof message.from?.id !== "number" ||
    typeof message.message_id !== "number"
  ) {
    return;
  }

  const excludedRefs = getExcludedThreadRefs(env);
  for (const excludedRef of excludedRefs) {
    if (matchChatRef(excludedRef, message)) {
      return;
    }
  }

  const allowedWriterRefs = getAllowedWriterRefs(env);
  for (const allowedRef of allowedWriterRefs) {
    if (matchChatRefByChat(allowedRef, message.sender_chat)) {
      return;
    }
    if (matchChatRefAnyThread(allowedRef, message)) {
      return;
    }
  }

  const refs = getFactionChatRefs(env);
  if (matchChatRef(refs.general, message)) {
    return;
  }

  let userFaction: FactionBranchSlug | null = null;
  if (supabase) {
    userFaction = await getUserFactionSlug(supabase, message.from.id);
  }
  if (userFaction && matchChatRef(refs.bySlug[userFaction], message)) {
    return;
  }

  // Знаходимо, яка фракція відповідає за цей чат
  let chatFaction: FactionBranchSlug | null = null;
  for (const [slug, ref] of Object.entries(refs.bySlug)) {
    if (ref && matchChatRef(ref, message)) {
      chatFaction = slug as FactionBranchSlug;
      break;
    }
  }

  if (!chatFaction) {
    return;
  }

  if (!supabase) {
    return;
  }

  // Перевіряємо, чи було попереднє попередження для цього користувача
  const { data: previousWarning } = await supabase
    .from("debug_updates")
    .select("id")
    .eq("user_id", message.from.id)
    .eq("update_type", "faction_warning")
    .order("created_at", { ascending: false })
    .limit(1);

  const chatFactionName = formatFactionName(chatFaction);
  const userFactionName = userFaction ? formatFactionName(userFaction) : NO_FACTION_LABEL;

  // Видаляємо повідомлення
  try {
    await deleteMessage(env, message.chat.id, message.message_id);
  } catch (error) {
    console.error("Failed to delete message", error);
  }

  if (previousWarning && previousWarning.length > 0) {
    // Було попереднє попередження - віднімаємо бал
    const { data: userData } = await supabase
      .from("users")
      .select("points_total")
      .eq("id", message.from.id)
      .maybeSingle();

    if (userData) {
      const currentPoints = typeof userData.points_total === "number" ? userData.points_total : STARTING_POINTS;
      const nextPoints = Math.max(0, currentPoints - 1);
      const now = new Date().toISOString();

      await supabase
        .from("users")
        .update({ points_total: nextPoints, updated_at: now })
        .eq("id", message.from.id);

      const penaltyMessage = `Я ПОПЕРЕДЖАВ.\n\n-1 ГОЛОС`;

      try {
        await sendMessage(env, message.from.id, penaltyMessage);
      } catch (error) {
        console.error("Failed to send penalty message", error);
      }
    }
  } else {
    // Перше попередження - надсилаємо попередження і зберігаємо запис
    const warningMessage = `⚠️ ПОПЕРЕДЖЕННЯ! ⚠️\n\nТи пишеш у чаті фракції ${chatFactionName.toUpperCase()},\nа твоя фракція ${userFactionName.toUpperCase()}\n\nНаступного разу буде -1 ГОЛОС`;

    try {
      await sendMessage(env, message.from.id, warningMessage);
      
      // Зберігаємо запис про попередження
      await supabase.from("debug_updates").insert({
        update_type: "faction_warning",
        chat_id: message.chat.id,
        thread_id: message.message_thread_id ?? null,
        message_id: message.message_id,
        user_id: message.from.id,
        text: null,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error("Failed to send warning message", error);
    }
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
    const nameCandidates = resolveTeamNameAliases(teamName);
    type DbTeamMatchRow = {
      id: string;
      match_date: string;
      home_team_name: string;
      away_team_name: string;
      home_goals?: number | string | null;
      away_goals?: number | string | null;
      home_avg_rating?: number | string | null;
      away_avg_rating?: number | string | null;
    };
    let query = supabase
      .from("team_match_stats")
      .select(
        "id, match_date, home_team_name, away_team_name, home_goals, away_goals, home_avg_rating, away_avg_rating"
      )
      .or(
        [
          `home_team_name.in.(${nameCandidates.map((item) => `"${item.replace(/"/g, '\\"')}"`).join(",")})`,
          `away_team_name.in.(${nameCandidates.map((item) => `"${item.replace(/"/g, '\\"')}"`).join(",")})`
        ].join(",")
      )
      .order("match_date", { ascending: false });
    if (typeof limit === "number") {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("Failed to list v2 team_match_stats, trying legacy schema", error);
      return await listTeamMatchStatsLegacy(supabase, teamName, limit);
    }
    const rows = (data as DbTeamMatchRow[]) ?? [];
    const normalizedCandidates = new Set(nameCandidates.map((name) => name.trim().toLowerCase()));
    const items = rows.map((row) => {
      const isHome = normalizedCandidates.has(row.home_team_name.trim().toLowerCase());
      return {
        id: row.id,
        team_name: isHome ? row.home_team_name : row.away_team_name,
        opponent_name: isHome ? row.away_team_name : row.home_team_name,
        match_date: row.match_date,
        is_home: isHome,
        team_goals: isHome ? row.home_goals : row.away_goals,
        opponent_goals: isHome ? row.away_goals : row.home_goals,
        avg_rating: isHome ? row.home_avg_rating : row.away_avg_rating
      } satisfies DbTeamMatchStat;
    });
    return items;
  } catch (error) {
    console.warn("Failed to list v2 team_match_stats, trying legacy schema", error);
    return await listTeamMatchStatsLegacy(supabase, teamName, limit);
  }
}

async function listTeamMatchStatsLegacy(
  supabase: SupabaseClient,
  teamName: string,
  limit?: number | null
): Promise<DbTeamMatchStat[] | null> {
  try {
    const nameCandidates = resolveTeamNameAliases(teamName);
    let query = supabase
      .from("team_match_stats")
      .select("id, team_name, opponent_name, match_date, is_home, team_goals, opponent_goals, avg_rating")
      .in("team_name", nameCandidates)
      .order("match_date", { ascending: false });
    if (typeof limit === "number") {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Failed to list legacy team_match_stats", error);
      return null;
    }
    return (data as DbTeamMatchStat[]) ?? [];
  } catch (error) {
    console.error("Failed to list legacy team_match_stats", error);
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

async function getPredictionStats(
  supabase: SupabaseClient,
  userId: number,
  seasonMonth: string | null
): Promise<PredictionStats> {
  const total = await countPredictions(supabase, userId, false, seasonMonth);
  const hits = await countPredictions(supabase, userId, true, seasonMonth);
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const lastResults = await listRecentPredictionResults(supabase, userId, seasonMonth);
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
  hitsOnly = false,
  seasonMonth: string | null = null
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
    if (seasonMonth) {
      query = query.eq("season_month", seasonMonth);
    }
    const { count } = await query;
    return typeof count === "number" ? count : 0;
  } catch (error) {
    console.error("Failed to count predictions", error);
    return 0;
  }
}

async function listRecentPredictionResults(
  supabase: SupabaseClient,
  userId: number,
  seasonMonth: string | null
): Promise<PredictionResult[]> {
  try {
    let predictionsQuery = supabase
      .from("predictions")
      .select("id, match_id, points, matches!inner(kickoff_at, status)")
      .eq("user_id", userId)
      .eq("matches.status", "finished");
    if (seasonMonth) {
      predictionsQuery = predictionsQuery.eq("season_month", seasonMonth);
    }

    let missedQuery = supabase
      .from("missed_predictions")
      .select("id, match_id, matches!inner(kickoff_at, status)")
      .eq("user_id", userId)
      .eq("matches.status", "finished");
    if (seasonMonth) {
      missedQuery = missedQuery.eq("season_month", seasonMonth);
    }

    const [predictionsResult, missedResult] = await Promise.all([predictionsQuery, missedQuery]);

    if (predictionsResult.error || missedResult.error) {
      return [];
    }

    const resultsByMatch = new Map<number, { kickoffAt: string; points: number; hit: boolean; orderId: number }>();

    const predictionRows =
      (predictionsResult.data as Array<{
        id?: number | null;
        match_id?: number | null;
        points?: number | null;
        matches?: { kickoff_at?: string | null } | null;
      }> | null | undefined) ?? [];
    for (const row of predictionRows) {
      const matchId = typeof row.match_id === "number" ? row.match_id : null;
      const kickoffAt = row.matches?.kickoff_at ?? null;
      if (!matchId || !kickoffAt) {
        continue;
      }
      const points = typeof row.points === "number" ? row.points : 0;
      resultsByMatch.set(matchId, {
        kickoffAt,
        points,
        hit: points > 0,
        orderId: typeof row.id === "number" ? row.id : 0
      });
    }

    const missedRows =
      (missedResult.data as Array<{
        id?: number | null;
        match_id?: number | null;
        matches?: { kickoff_at?: string | null } | null;
      }> | null | undefined) ?? [];
    for (const row of missedRows) {
      const matchId = typeof row.match_id === "number" ? row.match_id : null;
      const kickoffAt = row.matches?.kickoff_at ?? null;
      if (!matchId || !kickoffAt || resultsByMatch.has(matchId)) {
        continue;
      }
      resultsByMatch.set(matchId, {
        kickoffAt,
        points: MISSED_PREDICTION_PENALTY,
        hit: false,
        orderId: typeof row.id === "number" ? row.id : 0
      });
    }

    return Array.from(resultsByMatch.values())
      .sort((a, b) => {
        if (a.kickoffAt === b.kickoffAt) {
          return a.orderId - b.orderId;
        }
        return a.kickoffAt.localeCompare(b.kickoffAt);
      })
      .map((row) => ({ hit: row.hit, points: row.points }));
  } catch (error) {
    console.error("Failed to list recent prediction results", error);
    return [];
  }
}

async function getFactionStats(supabase: SupabaseClient, userId: number): Promise<FactionStat[]> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("faction_club_id, points_total")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      return [];
    }
    const points = typeof data.points_total === "number" ? data.points_total : STARTING_POINTS;
    const order: Array<FactionKey> = ["faction_club_id"];
    const entries: FactionStat[] = [];
    for (const key of order) {
      const value = (data as Record<string, string | null | undefined>)[key];
      if (!value) {
        continue;
      }
      const members = await countFactionMembers(supabase, key, value);
      const rank = await getMemberRankInFaction(supabase, key, value, points);
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

async function getMemberRankInFaction(
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

async function getProfileStats(
  supabase: SupabaseClient,
  userId: number,
  seasonMonth: string | null
): Promise<ProfileStats> {
  const [prediction, factions] = await Promise.all([
    getPredictionStats(supabase, userId, seasonMonth),
    getFactionStats(supabase, userId)
  ]);
  return { prediction, factions };
}

async function getUserOnboarding(supabase: SupabaseClient, userId: number): Promise<UserOnboarding | null> {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("faction_club_id, nickname, avatar_choice, onboarding_completed_at")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    const completedAt = (data as UserOnboardingRow).onboarding_completed_at ?? null;
    const factionClubId = data.faction_club_id ?? null;
    const nickname = (data.nickname ?? "").trim();
    // Вважаємо онбординг повністю завершеним тільки коли заповнені всі кроки.
    const isFullyCompleted =
      Boolean(completedAt) &&
      Boolean(factionClubId) &&
      nickname.length >= 2;

    return {
      faction_club_id: factionClubId,
      nickname: nickname || null,
      avatar_choice: data.avatar_choice ?? null,
      completed: isFullyCompleted
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
        "id, user_id, home_pred, away_pred, points, created_at, users (id, username, first_name, last_name, photo_url, nickname, points_total, faction_club_id)"
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
              points_total: row.users.points_total ?? null,
              faction_club_id: row.users.faction_club_id ?? null
            }
        : null
    }));
  } catch (error) {
    console.error("Failed to fetch predictions", error);
    return null;
  }
}

async function getMatchById(supabase: SupabaseClient, matchId: number): Promise<DbMatch | null> {
  try {
    const { data, error } = await supabase.from("matches").select("*").eq("id", matchId).maybeSingle();
    if (error || !data) {
      if (!error && data === null) {
        return null;
      }
      console.error("Failed to fetch match by id", error);
      return null;
    }
    return data as DbMatch;
  } catch (error) {
    console.error("Failed to fetch match by id", error);
    return null;
  }
}

async function listFactionPredictions(
  supabase: SupabaseClient,
  matchId: number,
  faction: FactionBranchSlug
): Promise<PredictionView[]> {
  const predictions = await listPredictions(supabase, matchId);
  if (!predictions) {
    return [];
  }
  return predictions.filter(
    (prediction) =>
      normalizeFactionChoice(prediction.user?.faction_club_id) === faction
  );
}

function formatMatchKickoff(match: DbMatch): string {
  try {
    const date = new Date(match.kickoff_at);
    if (!date || Number.isNaN(date.getTime())) {
      return "час невідомий";
    }
    return date.toLocaleString("uk-UA", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Kyiv"
    });
  } catch {
    return "час невідомий";
  }
}

function formatPredictionUser(prediction: PredictionView): string {
  const nickname = prediction.user?.nickname?.trim();
  if (nickname) {
    return nickname.toUpperCase();
  }
  const username = prediction.user?.username?.trim();
  if (username) {
    return `@${username.toUpperCase()}`;
  }
  return `id:${prediction.user_id}`;
}

function getMatchTeamLabel(match: DbMatch, kind: "home" | "away"): string {
  const slug = kind === "home" ? match.home_club_id : match.away_club_id;
  const teamName = kind === "home" ? match.home_team : match.away_team;
  const label = teamName ?? slug ?? "";
  return resolveUkrainianClubName(label, slug ?? null);
}

function formatAverageScore(predictions: PredictionView[]): string {
  if (!predictions.length) {
    return "0:0";
  }
  const { homes, aways } = predictions.reduce(
    (acc, prediction) => ({
      homes: acc.homes + prediction.home_pred,
      aways: acc.aways + prediction.away_pred
    }),
    { homes: 0, aways: 0 }
  );
  const averageHome = homes / predictions.length;
  const averageAway = aways / predictions.length;
  const format = (value: number): string => {
    const rounded = Number(value.toFixed(1));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  return `${format(averageHome)}:${format(averageAway)}`;
}

function buildFactionPredictionsMessage(
  match: DbMatch,
  faction: FactionBranchSlug,
  predictions: PredictionView[]
): string {
  const homeLabel = getMatchTeamLabel(match, "home") || "Домашня команда";
  const awayLabel = getMatchTeamLabel(match, "away") || "Гостьова команда";
  const averageScore = formatAverageScore(predictions);
  const prettyAverage = averageScore.replace(":", " : ");
  const header = `${homeLabel} ${prettyAverage}  ${awayLabel}`;
  if (predictions.length === 0) {
    return `${header}\n\nПоки що прогнози відсутні.`;
  }
  const rows = predictions
    .map((prediction) => `${prediction.home_pred}:${prediction.away_pred} — ${formatPredictionUser(prediction)}`)
    .join("\n");
  return `${header}\n\n${rows}`;
}

type SendMatchFactionPredictionsResult =
  | { ok: true }
  | { ok: false; error: "no_match" | "no_predictions" | "no_chat" | "no_target" };

async function sendMatchFactionPredictions(
  env: Env,
  supabase: SupabaseClient,
  matchId: number,
  faction: FactionBranchSlug
): Promise<SendMatchFactionPredictionsResult> {
  const match = await getMatchById(supabase, matchId);
  if (!match) {
    return { ok: false, error: "no_match" };
  }
  const predictions = await listFactionPredictions(supabase, matchId, faction);
  if (predictions.length === 0) {
    return { ok: false, error: "no_predictions" };
  }
  const refs = getFactionChatRefs(env);
  const chatRef = refs.bySlug[faction];
  if (!chatRef) {
    return { ok: false, error: "no_chat" };
  }
  const target =
    typeof chatRef.chatId === "number"
      ? chatRef.chatId
      : chatRef.chatUsername
        ? `@${chatRef.chatUsername}`
        : null;
  if (!target) {
    return { ok: false, error: "no_target" };
  }
  const message = buildFactionPredictionsMessage(match, faction, predictions);
  await sendMessage(env, target, message, undefined, undefined, chatRef.threadId ?? undefined);
  await insertBotDebugMessage(
    supabase,
    typeof chatRef.chatId === "number" ? chatRef.chatId : null,
    chatRef.threadId ?? null,
    message
  );
  return { ok: true };
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
  userId: number | null,
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
        created_by: userId ?? null
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
    debug.homeClubId = match.home_club_id ?? null;
    debug.awayClubId = match.away_club_id ?? null;
    debug.homeTeamNormalized = match.home_team ? normalizeTeamKey(match.home_team) : null;
    debug.awayTeamNormalized = match.away_team ? normalizeTeamKey(match.away_team) : null;
    debug.homeTeamKnownId = debug.homeTeamNormalized ? KNOWN_TEAM_IDS[debug.homeTeamNormalized] ?? null : null;
    debug.awayTeamKnownId = debug.awayTeamNormalized ? KNOWN_TEAM_IDS[debug.awayTeamNormalized] ?? null : null;
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

  const teamLookupOptions = { supabase, leagueId: match.league_id ?? null, season };
  const homeTeamResult = await resolveTeamId(env, match.home_team, match.home_club_id ?? undefined, teamLookupOptions);
  const awayTeamResult = await resolveTeamId(env, match.away_team, match.away_club_id ?? undefined, teamLookupOptions);
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
    debug.homeTeamSearchDetails = homeTeamResult.searchResponses;
    debug.awayTeamSearchDetails = awayTeamResult.searchResponses;
  }
  if (!homeTeamResult.id || !awayTeamResult.id) {
    console.warn("Odds skipped: team id not found", {
      match: `${match.home_team} vs ${match.away_team}`,
      league: match.league_id,
      date: dateParam,
      timezone,
      home: {
        query: homeTeamResult.query,
        status: homeTeamResult.status,
        candidates: homeTeamResult.candidates,
        searchDetails: homeTeamResult.searchResponses
      },
      away: {
        query: awayTeamResult.query,
        status: awayTeamResult.status,
        candidates: awayTeamResult.candidates,
        searchDetails: awayTeamResult.searchResponses
      }
    });
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
      debug.leagueFixturesSample = buildFixtureSample(leagueResult.fixtures);
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

  if (!selectedFixture) {
    logFixturesFallback("team_search", {
      teams: `${homeTeamResult.id}-${awayTeamResult.id}`,
      from,
      to,
      league: leagueId,
      season,
      timezone
    });
    const homeTeamFixtures = await fetchFixturesByTeam(
      env,
      homeTeamResult.id,
      season,
      from,
      to,
      timezone,
      "team_home"
    );
    if (debug) {
      debug.teamFixturesCount = homeTeamFixtures.fixtures.length;
      debug.teamFixturesSource = homeTeamFixtures.source;
      debug.teamFixturesStatus = homeTeamFixtures.dateStatus;
      debug.teamFixturesSample = buildFixtureSample(homeTeamFixtures.fixtures);
    }
    selectedFixture = selectFixture(
      homeTeamFixtures.fixtures,
      homeTeamResult.id,
      awayTeamResult.id,
      leagueId,
      dateParam,
      timezone
    );
    if (!selectedFixture) {
      const awayTeamFixtures = await fetchFixturesByTeam(
        env,
        awayTeamResult.id,
        season,
        from,
        to,
        timezone,
        "team_away"
      );
      if (debug) {
        debug.teamFixturesCount = awayTeamFixtures.fixtures.length;
        debug.teamFixturesSource = awayTeamFixtures.source;
        debug.teamFixturesStatus = awayTeamFixtures.dateStatus;
        debug.teamFixturesSample = buildFixtureSample(awayTeamFixtures.fixtures);
      }
      selectedFixture = selectFixture(
        awayTeamFixtures.fixtures,
        homeTeamResult.id,
        awayTeamResult.id,
        leagueId,
        dateParam,
        timezone
      );
    }
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

function getSeasonMonthForDate(date: Date, timeZone: string): string | null {
  try {
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
    const year = values.year;
    const month = values.month;
    if (!year || !month) {
      return null;
    }
    return `${year}-${month}`;
  } catch {
    return null;
  }
}

function resolveSeasonMonthForMatch(kickoffAt: string, timeZone: string): string | null {
  const kickoffDate = new Date(kickoffAt);
  if (Number.isNaN(kickoffDate.getTime())) {
    return null;
  }
  return getSeasonMonthForDate(kickoffDate, timeZone);
}

function resolveSeasonMonthForNow(env: Env): string | null {
  const timezone = getApiFootballTimezone(env) ?? "Europe/Kyiv";
  return getSeasonMonthForDate(new Date(), timezone);
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
      const resolvedTeam = await resolveTeamId(env, team.name, team.slug, {
        supabase,
        leagueId: ANALITIKA_LEAGUE_ID
      });
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
    const resolvedTeam = await resolveTeamId(env, team.name, team.slug);
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

function selectBestClubApiMapping(
  rows: ClubApiMapRow[],
  leagueId: string | null,
  season: number | null
): ClubApiMapRow | null {
  if (!rows.length) {
    return null;
  }
  let best = rows[0];
  let bestScore = -Infinity;
  for (const row of rows) {
    let score = 0;
    if (leagueId && row.league_id === leagueId) {
      score += 2;
    }
    if (season && row.season === season) {
      score += 1;
    }
    if (score > bestScore) {
      best = row;
      bestScore = score;
      continue;
    }
    if (score === bestScore) {
      const rowSeason = typeof row.season === "number" ? row.season : 0;
      const bestSeason = typeof best.season === "number" ? best.season : 0;
      if (rowSeason > bestSeason) {
        best = row;
      }
    }
  }
  return best;
}

async function findClubApiMapping(
  supabase: SupabaseClient,
  teamName: string,
  slug?: string,
  leagueId?: string | null,
  season?: number | null
): Promise<ClubApiMapRow | null> {
  const normalizedSlug = normalizeTeamSlug(slug ?? null);
  if (normalizedSlug) {
    try {
      const { data, error } = await supabase
        .from("club_api_map")
        .select(
          "slug, league_id, name, normalized_name, api_team_id, api_team_name, api_team_code, api_team_country, api_team_logo, api_team_founded, api_team_national, season"
        )
        .eq("slug", normalizedSlug)
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error("Failed to read club_api_map by slug", error);
      } else if (data) {
        return data as ClubApiMapRow;
      }
    } catch (error) {
      console.error("Failed to read club_api_map by slug", error);
    }
  }

  const candidates = buildNormalizedTeamCandidates(teamName, normalizedSlug ?? slug);
  if (!candidates.length) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("club_api_map")
      .select(
        "slug, league_id, name, normalized_name, api_team_id, api_team_name, api_team_code, api_team_country, api_team_logo, api_team_founded, api_team_national, season"
      )
      .in("normalized_name", candidates);
    if (error) {
      console.error("Failed to read club_api_map by name", error);
      return null;
    }
    const rows = (data as ClubApiMapRow[] | null) ?? [];
    return selectBestClubApiMapping(rows, leagueId ?? null, season ?? null);
  } catch (error) {
    console.error("Failed to read club_api_map by name", error);
    return null;
  }
}

async function resolveTeamId(
  env: Env,
  teamName: string,
  slug?: string,
  options?: { supabase?: SupabaseClient | null; leagueId?: string | null; season?: number | null }
): Promise<{
  id: number | null;
  source: "search" | "cache" | "db" | "none";
  query: string;
  status: number;
  candidates: Array<{ id?: number; name?: string }>;
  matchedName?: string | null;
  matchScore?: number | null;
  queryAttempts?: string[];
  searchAttempts?: number[];
  searchResponses: OddsTeamSearchDetail[];
}> {
  const normalized = normalizeTeamKey(teamName);
  const queries = getTeamSearchQueries(teamName, slug);
  const knownId = KNOWN_TEAM_IDS[normalized];
  if (knownId) {
    return {
      id: knownId,
      source: "cache",
      query: teamName,
      status: 0,
      candidates: [],
      matchedName: teamName,
      matchScore: 6,
      queryAttempts: [],
      searchAttempts: [],
      searchResponses: []
    };
  }
  const supabase = options?.supabase ?? null;
  if (supabase) {
    const mapping = await findClubApiMapping(supabase, teamName, slug, options?.leagueId ?? null, options?.season ?? null);
    if (mapping?.api_team_id) {
      const mappedName = mapping.api_team_name ?? mapping.name ?? teamName;
      teamIdCache.set(normalized, { id: mapping.api_team_id, name: mappedName, updatedAt: Date.now() });
      return {
        id: mapping.api_team_id,
        source: "db",
        query: mappedName,
        status: 0,
        candidates: [],
        matchedName: mappedName,
        matchScore: 6,
        queryAttempts: [],
        searchAttempts: [],
        searchResponses: []
      };
    }
  }
  const queryAttempts: string[] = [];
  const searchAttempts: number[] = [];
  let lastCandidates: Array<{ id?: number; name?: string }> = [];
  let lastQuery = queries[0] ?? teamName;
  let lastStatus = 0;
  let lastMatchName: string | null = null;
  let lastMatchScore: number | null = null;
  const searchResponses: OddsTeamSearchDetail[] = [];

  for (const query of queries) {
    const searchResult = await fetchTeamsBySearch(env, query);
    const match = findTeamIdInList(teamName, searchResult.teams);
    const candidates = searchResult.teams.slice(0, 5).map((entry) => ({
      id: entry.team?.id,
      name: entry.team?.name
    }));
    const candidateDescriptions = candidates
      .map((entry) => {
        const name = entry.name?.trim();
        if (name) {
          return entry.id !== undefined && entry.id !== null ? `${name} (${entry.id})` : name;
        }
        if (typeof entry.id === "number") {
          return `#${entry.id}`;
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
    searchResponses.push({
      query,
      status: searchResult.status,
      candidates: candidateDescriptions
    });
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
        searchAttempts,
        searchResponses
      };
    }
  }

  const slugKey = slug?.trim().toLowerCase();
  if (slugKey) {
    const knownTeamId = KNOWN_API_TEAM_IDS[slugKey];
    if (knownTeamId) {
      const label = formatClubLabel(slugKey);
      const matchedLabel = label || teamName;
      teamIdCache.set(normalized, { id: knownTeamId, name: matchedLabel, updatedAt: Date.now() });
      return {
        id: knownTeamId,
        source: "cache",
        query: matchedLabel,
        status: 0,
        candidates: [],
        matchedName: matchedLabel,
        matchScore: 6,
        queryAttempts,
        searchAttempts,
        searchResponses
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
      searchAttempts,
      searchResponses
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
    searchAttempts,
    searchResponses
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

async function fetchTeamsByLeague(env: Env, leagueId: number, season: number): Promise<TeamsResult> {
  const path = buildApiPath("/teams", { league: leagueId, season });
  const response = await fetchApiFootball(env, path);
  const status = response.status;
  if (!response.ok) {
    console.warn("API-Football teams league error", response.status);
    return { teams: [], status };
  }
  try {
    const payload = (await response.json()) as { response?: TeamPayload[] };
    return { teams: payload.response ?? [], status };
  } catch (error) {
    console.warn("API-Football teams league parse error", error);
    return { teams: [], status };
  }
}

function buildClubApiMapRow(
  entry: TeamPayload,
  leagueId: string | null,
  season: number,
  nowIso: string
): ClubApiMapRow | null {
  const team = toRecord(entry.team);
  const rawId = team?.id ?? null;
  const id = typeof rawId === "number" ? rawId : Number(rawId);
  if (!Number.isFinite(id)) {
    return null;
  }
  const name = typeof team?.name === "string" ? team.name.trim() : "";
  if (!name) {
    return null;
  }
  const normalizedName = normalizeTeamName(name);
  if (!normalizedName) {
    return null;
  }
  const code = typeof team?.code === "string" ? team.code : null;
  const country = typeof team?.country === "string" ? team.country : null;
  const logo = typeof team?.logo === "string" ? team.logo : null;
  const foundedRaw = team?.founded ?? null;
  const founded = typeof foundedRaw === "number" ? foundedRaw : Number(foundedRaw);
  const national = typeof team?.national === "boolean" ? team.national : null;
  const slug = normalizeClubKey(name);
  return {
    slug: slug || null,
    league_id: leagueId ?? null,
    name,
    normalized_name: normalizedName,
    api_team_id: id,
    api_team_name: name,
    api_team_code: code,
    api_team_country: country,
    api_team_logo: logo,
    api_team_founded: Number.isFinite(founded) ? founded : null,
    api_team_national: national,
    season,
    updated_at: nowIso
  };
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

async function fetchFixturesByTeam(
  env: Env,
  teamId: number,
  season: number,
  from: string,
  to: string,
  timezone: string,
  source: TeamFixturesSource
): Promise<TeamFixturesResult> {
  const path = buildApiPath("/fixtures", { from, to, team: teamId, season, timezone });
  const response = await fetchApiFootball(env, path);
  const status = response.status;
  if (!response.ok) {
    console.warn("API-Football team fixtures error", response.status);
    logFixturesSearch(env, {
      source,
      path,
      params: { from, to, team: teamId, season, timezone },
      fixturesCount: 0
    });
    return { fixtures: [], source, dateStatus: status };
  }
  try {
    const payload = (await response.json()) as { response?: FixturePayload[] };
    const fixtures = payload.response ?? [];
    logFixturesSearch(env, {
      source,
      path,
      params: { from, to, team: teamId, season, timezone },
      fixturesCount: fixtures.length
    });
    return { fixtures, source, dateStatus: status };
  } catch (error) {
    console.warn("API-Football team fixtures parse error", error);
    logFixturesSearch(env, {
      source,
      path,
      params: { from, to, team: teamId, season, timezone },
      fixturesCount: 0
    });
    return { fixtures: [], source, dateStatus: status };
  }
}

function buildFixtureSample(fixtures: FixturePayload[], limit = 3): OddsDebugFixture[] {
  return fixtures.slice(0, limit).map((item) => ({
    id: item.fixture?.id ?? null,
    home: item.teams?.home?.name,
    away: item.teams?.away?.name,
    homeId: item.teams?.home?.id ?? null,
    awayId: item.teams?.away?.id ?? null
  }));
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

function buildTeamSearchVariants(teamName: string): string[] {
  const trimmed = teamName.trim();
  if (!trimmed) {
    return [];
  }
  const normalized = trimmed.replace(/\s+/g, " ").trim();
  const variants = new Set<string>();
  const addVariant = (value: string): void => {
    const candidate = value.replace(/\s+/g, " ").trim();
    if (candidate && candidate !== normalized) {
      variants.add(candidate);
    }
  };
  if (/^as\s+/i.test(normalized)) {
    addVariant(normalized.replace(/^as\s+/i, ""));
  }
  if (/\s+fc$/i.test(normalized)) {
    addVariant(normalized.replace(/\s+fc$/i, ""));
  }
  if (/^as\s+/i.test(normalized) && /\s+fc$/i.test(normalized)) {
    addVariant(normalized.replace(/^as\s+/i, "").replace(/\s+fc$/i, ""));
  }
  return Array.from(variants);
}

function getTeamSearchQueries(teamName: string, slug?: string): string[] {
  const alias = getTeamSearchQuery(teamName);
  const queries: string[] = [];
  if (alias) {
    queries.push(alias);
  }
  if (slug) {
    const slugLabel = formatClubLabel(slug);
    if (slugLabel) {
      queries.push(slugLabel);
    }
  }
  if (teamName) {
    const normalizedName = teamName.trim();
    if (normalizedName) {
      queries.push(normalizedName);
      buildTeamSearchVariants(normalizedName).forEach((variant) => queries.push(variant));
    }
  }
  return Array.from(new Set(queries));
}

function buildNormalizedTeamCandidates(teamName: string, slug?: string): string[] {
  const queries = getTeamSearchQueries(teamName, slug);
  const candidates = new Set<string>();
  for (const query of queries) {
    const normalized = normalizeTeamName(query);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  return Array.from(candidates);
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
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at, odds_manual_home, odds_manual_draw, odds_manual_away, odds_manual_updated_at"
      )
      .in("status", ["scheduled", "started", "finished"])
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

async function listAllMatches(supabase: SupabaseClient, date?: string): Promise<DbMatch[] | null> {
  try {
    let query = supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at, odds_manual_home, odds_manual_draw, odds_manual_away, odds_manual_updated_at"
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
      console.error("Failed to list all matches", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list all matches", error);
    return null;
  }
}

async function listScheduledMatches(supabase: SupabaseClient): Promise<DbMatch[] | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select("id, home_team, away_team, home_club_id, away_club_id, kickoff_at")
      .eq("status", "scheduled")
      .order("kickoff_at", { ascending: true });

    if (error) {
      console.error("Failed to list scheduled matches", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list scheduled matches", error);
    return null;
  }
}

async function listPendingMatches(supabase: SupabaseClient): Promise<DbMatch[] | null> {
  try {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id, home_team, away_team, league_id, home_club_id, away_club_id, kickoff_at, status, home_score, away_score, venue_name, venue_city, venue_lat, venue_lon, tournament_name, tournament_stage, rain_probability, weather_fetched_at, weather_condition, weather_temp_c, weather_timezone, odds_json, odds_fetched_at, odds_manual_home, odds_manual_draw, odds_manual_away, odds_manual_updated_at"
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

async function hasSentAnnouncementToday(
  supabase: SupabaseClient,
  userId: number,
  caption: string
): Promise<boolean> {
  try {
    const kyivDay = getKyivDateString();
    const range = getKyivDayRange(kyivDay);
    if (!range) {
      return false;
    }
    const { data, error } = await supabase
      .from("bot_message_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("direction", "out")
      .eq("sender", "bot")
      .eq("message_type", "photo")
      .eq("delivery_status", "sent")
      .eq("text", caption)
      .gte("created_at", range.start)
      .lte("created_at", range.end)
      .limit(1);
    if (error) {
      console.error("Failed to check announcement history", error);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error("Failed to check announcement history", error);
    return false;
  }
}

function parseTelegramErrorDetails(body: string): { errorCode: number | null; errorMessage: string | null } {
  if (!body) {
    return { errorCode: null, errorMessage: null };
  }
  try {
    const payload = JSON.parse(body) as { error_code?: number; description?: string };
    return {
      errorCode: typeof payload.error_code === "number" ? payload.error_code : null,
      errorMessage: typeof payload.description === "string" ? payload.description : null
    };
  } catch {
    return { errorCode: null, errorMessage: null };
  }
}

function buildAnnouncementJobKey(kyivDay: string, userId: number, matchIds: number[]): string {
  const ids = [...matchIds].sort((a, b) => a - b).join(",");
  return `${kyivDay}:${userId}:${ids}`;
}

async function insertAnnouncementAudit(
  supabase: SupabaseClient,
  payload: {
    userId: number;
    chatId: number;
    status: "sent" | "failed" | "skipped";
    reason: string;
    caption: string | null;
    matchIds: number[];
    errorCode?: number | null;
    httpStatus?: number | null;
    errorMessage?: string | null;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("announcement_audit").insert({
      user_id: payload.userId,
      chat_id: payload.chatId,
      status: payload.status,
      reason: payload.reason,
      caption: payload.caption,
      match_ids: payload.matchIds,
      error_code: payload.errorCode ?? null,
      http_status: payload.httpStatus ?? null,
      error_message: payload.errorMessage ?? null,
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error("Failed to insert announcement audit", error);
    }
  } catch (error) {
    console.error("Failed to insert announcement audit", error);
  }
}

async function insertAnnouncementAudits(
  supabase: SupabaseClient,
  audits: Array<{
    userId: number;
    chatId: number;
    status: "sent" | "failed" | "skipped" | "queued";
    reason: string;
    caption: string | null;
    matchIds: number[];
    errorCode?: number | null;
    httpStatus?: number | null;
    errorMessage?: string | null;
  }>
): Promise<void> {
  if (!audits.length) {
    return;
  }
  try {
    const nowIso = new Date().toISOString();
    const records = audits.map((payload) => ({
      user_id: payload.userId,
      chat_id: payload.chatId,
      status: payload.status,
      reason: payload.reason,
      caption: payload.caption,
      match_ids: payload.matchIds,
      error_code: payload.errorCode ?? null,
      http_status: payload.httpStatus ?? null,
      error_message: payload.errorMessage ?? null,
      created_at: nowIso
    }));
    const { error } = await supabase.from("announcement_audit").insert(records);
    if (error) {
      console.error("Failed to insert announcement audits", error);
    }
  } catch (error) {
    console.error("Failed to insert announcement audits", error);
  }
}

async function enqueueMatchesAnnouncement(
  supabase: SupabaseClient,
  users: Array<{ id: number }>,
  todayMatches: DbMatch[],
  kyivDay: string
): Promise<void> {
  try {
    await logDebugUpdate(supabase, "announcement_enqueue_start", {
      error: `users=${users.length} matches=${todayMatches.length} kyiv_day=${kyivDay}`
    });

    const matchIds = todayMatches.map((match) => match.id);
    if (!matchIds.length) {
      await logDebugUpdate(supabase, "announcement_enqueue", {
        error: "total=0 queued=0 skipped_all_predicted=0 skipped_already_sent=0 enqueue_failed=0"
      });
      return;
    }

    const nowIso = new Date().toISOString();
    let skippedAllPredicted = 0;
    let skippedAlreadySent = 0;
    const queueRecords: Array<{
      job_key: string;
      user_id: number;
      caption: string;
      match_ids: number[];
      status: string;
      attempts: number;
      max_attempts: number;
      next_attempt_at: string;
      locked_at: null;
      last_error: null;
      sent_at: null;
      created_at: string;
      updated_at: string;
    }> = [];
    const queuedAudits: Array<{
      userId: number;
      chatId: number;
      status: "queued";
      reason: string;
      caption: string | null;
      matchIds: number[];
    }> = [];

    for (let startIndex = 0; startIndex < users.length; startIndex += 10) {
      const batch = users.slice(startIndex, startIndex + 10);
      await logDebugUpdate(supabase, "announcement_enqueue_batch_start", {
        error: `from=${startIndex} size=${batch.length}`
      });
      const batchUserIds = batch.map((user) => user.id);
      const { data: predictions, error: predictionsError } = await supabase
        .from("predictions")
        .select("user_id, match_id")
        .in("match_id", matchIds)
        .in("user_id", batchUserIds);
      if (predictionsError) {
        await logDebugUpdate(supabase, "announcement_enqueue_user_error", {
          error: `batch=${startIndex} predictions_error=${formatSupabaseError(predictionsError)}`
        });
        console.error("Failed to fetch predictions for batch", predictionsError);
        continue;
      }
      const predictedByUser = new Map<number, Set<number>>();
      for (const row of (predictions as Array<{ user_id: number; match_id: number }> | null) ?? []) {
        const set = predictedByUser.get(row.user_id) ?? new Set<number>();
        set.add(row.match_id);
        predictedByUser.set(row.user_id, set);
      }

      const kyivRange = getKyivDayRange(kyivDay);
      const logsQuery = supabase
        .from("bot_message_logs")
        .select("user_id, text")
        .in("user_id", batchUserIds)
        .eq("direction", "out")
        .eq("sender", "bot")
        .eq("message_type", "photo")
        .eq("delivery_status", "sent");
      const logsFiltered =
        kyivRange ? logsQuery.gte("created_at", kyivRange.start).lte("created_at", kyivRange.end) : logsQuery;
      const { data: sentLogs, error: sentLogsError } = await logsFiltered;
      if (sentLogsError) {
        await logDebugUpdate(supabase, "announcement_enqueue_user_error", {
          error: `batch=${startIndex} sent_logs_error=${formatSupabaseError(sentLogsError)}`
        });
        console.error("Failed to fetch sent logs for batch", sentLogsError);
        continue;
      }
      const sentByUser = new Map<number, Set<string>>();
      for (const row of (sentLogs as Array<{ user_id: number; text: string | null }> | null) ?? []) {
        if (!row.text) {
          continue;
        }
        const set = sentByUser.get(row.user_id) ?? new Set<string>();
        set.add(row.text);
        sentByUser.set(row.user_id, set);
      }

      for (const user of batch) {
        try {
          const predicted = predictedByUser.get(user.id) ?? new Set<number>();
          const missingMatches = todayMatches.filter((match) => !predicted.has(match.id));
          if (!missingMatches.length) {
            skippedAllPredicted += 1;
            await insertAnnouncementAudit(supabase, {
              userId: user.id,
              chatId: user.id,
              status: "skipped",
              reason: "all_predicted",
              caption: null,
              matchIds
            });
            continue;
          }
          const caption = buildMatchesAnnouncementCaption(missingMatches);
          const sentSet = sentByUser.get(user.id);
          if (sentSet && sentSet.has(caption)) {
            skippedAlreadySent += 1;
            await insertAnnouncementAudit(supabase, {
              userId: user.id,
              chatId: user.id,
              status: "skipped",
              reason: "already_sent_today",
              caption,
              matchIds: missingMatches.map((match) => match.id)
            });
            continue;
          }
          queueRecords.push({
            job_key: buildAnnouncementJobKey(kyivDay, user.id, missingMatches.map((match) => match.id)),
            user_id: user.id,
            caption,
            match_ids: missingMatches.map((match) => match.id),
            status: "pending",
            attempts: 0,
            max_attempts: ANNOUNCEMENT_QUEUE_MAX_ATTEMPTS,
            next_attempt_at: nowIso,
            locked_at: null,
            last_error: null,
            sent_at: null,
            created_at: nowIso,
            updated_at: nowIso
          });
          queuedAudits.push({
            userId: user.id,
            chatId: user.id,
            status: "queued",
            reason: "queued",
            caption,
            matchIds: missingMatches.map((match) => match.id)
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          await logDebugUpdate(supabase, "announcement_enqueue_user_error", {
            error: `user=${user.id} ${msg}`
          });
          console.error("Failed to enqueue announcement recipient", { userId: user.id, error });
        }
      }
      await logDebugUpdate(supabase, "announcement_enqueue_batch_end", {
        error: `from=${startIndex} size=${batch.length}`
      });
    }

    if (!queueRecords.length) {
      await logDebugUpdate(supabase, "announcement_enqueue", {
        error: `total=${users.length} queued=0 skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent} enqueue_failed=0`
      });
      await logDebugUpdate(supabase, "announcement_enqueue_end", {
        error: `total=${users.length} queued=0 skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent}`
      });
      return;
    }

    const { error } = await supabase
      .from("announcement_queue")
      .upsert(queueRecords, { onConflict: "job_key", ignoreDuplicates: true });
    if (error) {
      console.error("Failed to enqueue announcement jobs", error);
      await logDebugUpdate(supabase, "announcement_enqueue", {
        error: `total=${users.length} queued=0 skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent} enqueue_failed=${queuedAudits.length}`
      });
      await insertAnnouncementAudits(
        supabase,
        queuedAudits.map((audit) => ({
          ...audit,
          status: "failed",
          reason: "enqueue_failed",
          errorMessage: formatSupabaseError(error)
        }))
      );
      await logDebugUpdate(supabase, "announcement_enqueue_end", {
        error: `total=${users.length} queued=0 skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent} enqueue_failed=${queuedAudits.length}`
      });
      return;
    }

    await insertAnnouncementAudits(supabase, queuedAudits);
    await logDebugUpdate(supabase, "announcement_enqueue", {
      error: `total=${users.length} queued=${queuedAudits.length} skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent} enqueue_failed=0`
    });
    await logDebugUpdate(supabase, "announcement_enqueue_end", {
      error: `total=${users.length} queued=${queuedAudits.length} skipped_all_predicted=${skippedAllPredicted} skipped_already_sent=${skippedAlreadySent}`
    });
  } catch (error) {
    await logDebugUpdate(supabase, "announcement_enqueue_crash", { error: formatSupabaseError(error) });
    throw error;
  }
}

type AnnouncementJobRow = {
  id: number;
  user_id: number;
  caption: string | null;
  match_ids: number[];
  attempts: number | null;
  max_attempts: number | null;
};

async function handleAnnouncementQueue(env: Env): Promise<void> {
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Failed to process announcement queue: missing_supabase");
    return;
  }

  await releaseStaleAnnouncementLocks(supabase);

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcement_queue")
    .select("id, user_id, caption, match_ids, attempts, max_attempts")
    .in("status", ["pending", "retry"])
    .is("locked_at", null)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(ANNOUNCEMENT_QUEUE_BATCH_SIZE);

  if (error) {
    console.error("Failed to load announcement queue", error);
    return;
  }

  const jobs = (data as AnnouncementJobRow[] | null) ?? [];
  if (!jobs.length) {
    return;
  }

  let index = 0;
  const workerCount = Math.min(ANNOUNCEMENT_QUEUE_CONCURRENCY, jobs.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const job = jobs[index];
      index += 1;
      if (!job) {
        break;
      }
      const claimed = await claimAnnouncementJob(supabase, job.id);
      if (!claimed) {
        continue;
      }
      await processAnnouncementJob(env, supabase, job);
    }
  });
  await Promise.all(workers);
}

async function releaseStaleAnnouncementLocks(supabase: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString();
  const staleLockBeforeIso = new Date(Date.now() - ANNOUNCEMENT_QUEUE_LOCK_TIMEOUT_MS).toISOString();
  const { error } = await supabase
    .from("announcement_queue")
    .update({
      status: "retry",
      locked_at: null,
      next_attempt_at: nowIso,
      updated_at: nowIso
    })
    .eq("status", "processing")
    .lt("locked_at", staleLockBeforeIso);
  if (error) {
    console.error("Failed to release stale announcement locks", error);
  }
}

async function claimAnnouncementJob(supabase: SupabaseClient, jobId: number): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("announcement_queue")
    .update({
      status: "processing",
      locked_at: nowIso,
      updated_at: nowIso
    })
    .eq("id", jobId)
    .in("status", ["pending", "retry"])
    .is("locked_at", null)
    .select("id");

  if (error) {
    console.error("Failed to claim announcement job", error, { jobId });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function processAnnouncementJob(env: Env, supabase: SupabaseClient, job: AnnouncementJobRow): Promise<void> {
  const attempts = (job.attempts ?? 0) + 1;
  const maxAttempts = job.max_attempts ?? ANNOUNCEMENT_QUEUE_MAX_ATTEMPTS;
  const nowIso = new Date().toISOString();
  let finalized = false;
  let finalReason = "unknown";

  try {
    const caption = typeof job.caption === "string" ? job.caption : "";
    if (!caption || !Array.isArray(job.match_ids) || job.match_ids.length === 0) {
      await markAnnouncementJobFailed(supabase, job.id, attempts, "invalid_payload");
      finalized = true;
      finalReason = "invalid_payload";
      return;
    }

    const alreadySent = await hasSentAnnouncementToday(supabase, job.user_id, caption);
    if (alreadySent) {
      await markAnnouncementJobSkipped(supabase, job.id, attempts, "already_sent_today");
      await insertAnnouncementAudit(supabase, {
        userId: job.user_id,
        chatId: job.user_id,
        status: "skipped",
        reason: "already_sent_today",
        caption,
        matchIds: job.match_ids
      });
      finalized = true;
      finalReason = "already_sent_today";
      return;
    }

    const imageUrl = buildWebappImageUrl(env, MATCHES_ANNOUNCEMENT_IMAGE);
    const keyboard = { inline_keyboard: [[{ text: "ПРОГОЛОСУВАТИ", web_app: { url: buildWebappAdminLayoutUrl(env) } }]] };
    const result = await sendPhotoWithResult(env, job.user_id, imageUrl, caption, keyboard);

    if (result.ok) {
      const { error } = await supabase
        .from("announcement_queue")
        .update({
          status: "sent",
          attempts,
          locked_at: null,
          last_error: null,
          sent_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", job.id);
      if (error) {
        console.error("Failed to mark announcement job as sent", error, { jobId: job.id });
      }
      await insertAnnouncementAudit(supabase, {
        userId: job.user_id,
        chatId: job.user_id,
        status: "sent",
        reason: "sent",
        caption,
        matchIds: job.match_ids,
        httpStatus: result.status ?? null
      });
      finalized = true;
      finalReason = "sent";
      return;
    }

    const retryDelayMs = computeAnnouncementRetryDelayMs(result, attempts);
    if (retryDelayMs === null || attempts >= maxAttempts) {
      const parsed = parseTelegramErrorDetails(result.body);
      await markAnnouncementJobFailed(supabase, job.id, attempts, buildAnnouncementDeliveryError(result));
      await insertAnnouncementAudit(supabase, {
        userId: job.user_id,
        chatId: job.user_id,
        status: "failed",
        reason: "send_failed",
        caption,
        matchIds: job.match_ids,
        errorCode: parsed.errorCode,
        httpStatus: result.status ?? null,
        errorMessage: parsed.errorMessage ?? result.body
      });
      finalized = true;
      finalReason = "send_failed";
      return;
    }

    const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
    const { error } = await supabase
      .from("announcement_queue")
      .update({
        status: "retry",
        attempts,
        locked_at: null,
        next_attempt_at: nextAttemptAt,
        last_error: buildAnnouncementDeliveryError(result),
        updated_at: nowIso
      })
      .eq("id", job.id);
    if (error) {
      console.error("Failed to reschedule announcement job", error, { jobId: job.id });
    }
    finalized = true;
    finalReason = "retry";
  } catch (error) {
    console.error("Announcement job failed unexpectedly", error, { jobId: job.id });
  } finally {
    if (!finalized) {
      await markAnnouncementJobFailed(supabase, job.id, attempts, "processing_abort");
      await insertAnnouncementAudit(supabase, {
        userId: job.user_id,
        chatId: job.user_id,
        status: "failed",
        reason: "processing_abort",
        caption: typeof job.caption === "string" ? job.caption : null,
        matchIds: Array.isArray(job.match_ids) ? job.match_ids : []
      });
      await logDebugUpdate(supabase, "announcement_job_abort", {
        error: `job_id=${job.id} user_id=${job.user_id} reason=${finalReason}`
      });
    }
  }
}

async function markAnnouncementJobFailed(
  supabase: SupabaseClient,
  jobId: number,
  attempts: number,
  reason: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("announcement_queue")
    .update({
      status: "failed",
      attempts,
      locked_at: null,
      last_error: reason,
      updated_at: nowIso
    })
    .eq("id", jobId);
  if (error) {
    console.error("Failed to mark announcement job as failed", error, { jobId });
  }
}

async function markAnnouncementJobSkipped(
  supabase: SupabaseClient,
  jobId: number,
  attempts: number,
  reason: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("announcement_queue")
    .update({
      status: "skipped",
      attempts,
      locked_at: null,
      last_error: reason,
      updated_at: nowIso
    })
    .eq("id", jobId);
  if (error) {
    console.error("Failed to mark announcement job as skipped", error, { jobId });
  }
}

function computeAnnouncementRetryDelayMs(result: { status: number | null; body: string }, attempts: number): number | null {
  const status = result.status;
  if (status === 429) {
    const retryAfterSeconds = extractTelegramRetryAfterSeconds(result.body);
    if (retryAfterSeconds !== null) {
      return Math.max(1_000, (retryAfterSeconds + 1) * 1_000);
    }
    return 60_000;
  }
  if (status === null || status >= 500) {
    const retryBaseMs = 5_000;
    const power = Math.max(0, Math.min(attempts - 1, 6));
    return Math.min(15 * 60 * 1_000, retryBaseMs * 2 ** power);
  }
  return null;
}

function buildAnnouncementDeliveryError(result: { status: number | null; body: string }): string {
  const statusLabel = result.status === null ? "network_error" : String(result.status);
  const rawBody = result.body || "";
  const clippedBody = rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody;
  return `announcement status=${statusLabel} body=${clippedBody}`;
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

const DEFAULT_PRESENTATION_PROBABILITIES = { home: 50, draw: 25, away: 25 };
const PRESENTATION_PREDICTION_LIMIT = 4;
const PRESENTATION_RECENT_MATCHES_LIMIT = 5;

function normalizeOddsTeamName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isMatchWinnerBet(bet: { id?: number; name?: string }): boolean {
  if (bet.id === 1) {
    return true;
  }
  const name = bet.name?.toLowerCase() ?? "";
  return name.includes("match winner") || name.includes("match result") || name.includes("fulltime result");
}

function parseOddNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isOddsLabelMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function resolveThreeWayOdds(
  values: Array<{ value?: string; odd?: string | number }>,
  homeNormalized: string,
  awayNormalized: string
): { home: number; draw: number; away: number } | null {
  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;

  for (const entry of values) {
    const labelRaw = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!labelRaw) {
      continue;
    }
    const labelLower = labelRaw.toLowerCase();
    const labelNormalized = normalizeOddsTeamName(labelRaw);
    const oddValue = parseOddNumber(entry.odd);
    if (!oddValue) {
      continue;
    }

    if (labelLower === "home" || labelLower === "1") {
      home = oddValue;
      continue;
    }
    if (labelLower === "draw" || labelLower === "x") {
      draw = oddValue;
      continue;
    }
    if (labelLower === "away" || labelLower === "2") {
      away = oddValue;
      continue;
    }

    if (labelNormalized && isOddsLabelMatch(labelNormalized, homeNormalized)) {
      home = oddValue;
      continue;
    }
    if (labelNormalized && isOddsLabelMatch(labelNormalized, awayNormalized)) {
      away = oddValue;
      continue;
    }
  }

  if (!home || !draw || !away) {
    return null;
  }

  return { home, draw, away };
}

function toProbability(homeOdd: number, drawOdd: number, awayOdd: number): { home: number; draw: number; away: number } | null {
  const homeInv = 1 / homeOdd;
  const drawInv = 1 / drawOdd;
  const awayInv = 1 / awayOdd;
  const total = homeInv + drawInv + awayInv;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return {
    home: Math.round((homeInv / total) * 100),
    draw: Math.round((drawInv / total) * 100),
    away: Math.round((awayInv / total) * 100)
  };
}

function extractOddsProbabilitiesFromMatch(
  match: DbMatch
): { home: number; draw: number; away: number } | null {
  if (!match.odds_json || !Array.isArray(match.odds_json) || !match.odds_json.length) {
    const homeOdd = match.odds_manual_home;
    const drawOdd = match.odds_manual_draw;
    const awayOdd = match.odds_manual_away;
    if (homeOdd && drawOdd && awayOdd) {
      return toProbability(homeOdd, drawOdd, awayOdd);
    }
    return null;
  }

  const homeNormalized = normalizeOddsTeamName(match.home_team);
  const awayNormalized = normalizeOddsTeamName(match.away_team);

  for (const entry of match.odds_json) {
    const bookmakers = (entry as { bookmakers?: unknown }).bookmakers;
    if (!Array.isArray(bookmakers)) {
      continue;
    }
    for (const bookmaker of bookmakers) {
      const bets = (bookmaker as { bets?: unknown }).bets;
      if (!Array.isArray(bets) || !bets.length) {
        continue;
      }
      const preferred = bets.filter((bet) => isMatchWinnerBet(bet as { id?: number; name?: string }));
      const candidates = preferred.length ? preferred : bets;
      for (const bet of candidates) {
        const values = (bet as { values?: unknown }).values;
        if (!Array.isArray(values)) {
          continue;
        }
        const odds = resolveThreeWayOdds(values, homeNormalized, awayNormalized);
        if (odds) {
          const probabilities = toProbability(odds.home, odds.draw, odds.away);
          if (probabilities) {
            return probabilities;
          }
        }
      }
    }
  }

  const homeOdd = match.odds_manual_home;
  const drawOdd = match.odds_manual_draw;
  const awayOdd = match.odds_manual_away;
  if (homeOdd && drawOdd && awayOdd) {
    return toProbability(homeOdd, drawOdd, awayOdd);
  }

  return null;
}

async function aggregatePresentationPredictionPercentages(
  supabase: SupabaseClient,
  matchIds: number[]
): Promise<Map<number, { home: number; draw: number; away: number }>> {
  if (!matchIds.length) {
    return new Map();
  }

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("match_id, home_pred, away_pred")
      .in("match_id", matchIds);
    if (error) {
      console.error("Failed to fetch predictions for presentation", error);
      return new Map();
    }

    const counter = new Map<number, { home: number; draw: number; away: number }>();
    for (const entry of (data as DbPrediction[]) ?? []) {
      if (!entry.match_id) {
        continue;
      }
      const tally = counter.get(entry.match_id) ?? { home: 0, draw: 0, away: 0 };
      const outcome = getOutcome(entry.home_pred, entry.away_pred);
      if (outcome === "home") {
        tally.home++;
      } else if (outcome === "away") {
        tally.away++;
      } else {
        tally.draw++;
      }
      counter.set(entry.match_id, tally);
    }

    const result = new Map<number, { home: number; draw: number; away: number }>();
    for (const [matchId, totals] of counter.entries()) {
      const totalCount = totals.home + totals.draw + totals.away;
      if (!totalCount) {
        continue;
      }
      const homePercent = Math.round((totals.home / totalCount) * 100);
      const drawPercent = Math.round((totals.draw / totalCount) * 100);
      let awayPercent = 100 - homePercent - drawPercent;
      if (awayPercent < 0) {
        awayPercent = 0;
      }
      result.set(matchId, { home: homePercent, draw: drawPercent, away: awayPercent });
    }

    return result;
  } catch (error) {
    console.error("Failed to aggregate presentation predictions", error);
    return new Map();
  }
}

type PresentationPredictionUser = {
  nickname?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

async function listPresentationPredictions(
  supabase: SupabaseClient,
  matchIds: number[],
  limitPerMatch: number
): Promise<
  Map<number, Array<{ home_pred: number; away_pred: number; points: number | null; user: PresentationPredictionUser | null }>>
> {
  if (!matchIds.length) {
    return new Map();
  }

  type PredictionRecord = {
    match_id: number;
    home_pred: number;
    away_pred: number;
    points?: number | null;
    user_id: number;
  };

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("match_id, home_pred, away_pred, points, user_id, created_at")
      .in("match_id", matchIds)
      .order("match_id", { ascending: true })
      .order("points", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch presentation predictions", error);
      return new Map();
    }

    const grouped = new Map<number, PredictionRecord[]>();
    const userIds = new Set<number>();

    for (const entry of (data as PredictionRecord[]) ?? []) {
      const matchId = entry.match_id;
      const list = grouped.get(matchId) ?? [];
      if (list.length >= limitPerMatch) {
        continue;
      }
      list.push(entry);
      grouped.set(matchId, list);
      userIds.add(entry.user_id);
    }

    const userMap = new Map<number, StoredUser>();
    if (userIds.size) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, username, first_name, last_name, nickname")
        .in("id", Array.from(userIds));
      if (users && !usersError) {
        (users as StoredUser[]).forEach((user) => {
          userMap.set(user.id, user);
        });
      }
    }

    const result = new Map<
      number,
      Array<{ home_pred: number; away_pred: number; points: number | null; user: PresentationPredictionUser | null }>
    >();
    for (const [matchId, entries] of grouped.entries()) {
      const formatted = entries.map((entry) => {
        const userRecord = userMap.get(entry.user_id);
        const userPayload = userRecord
          ? {
              nickname: userRecord.nickname ?? null,
              username: userRecord.username ?? null,
              first_name: userRecord.first_name ?? null,
              last_name: userRecord.last_name ?? null
            }
          : null;
        return {
          home_pred: entry.home_pred,
          away_pred: entry.away_pred,
          points: entry.points ?? null,
          user: userPayload
        };
      });
      result.set(matchId, formatted);
    }

    return result;
  } catch (error) {
    console.error("Failed to fetch presentation predictions", error);
    return new Map();
  }
}

async function fetchPresentationTeamStats(
  supabase: SupabaseClient,
  cache: Map<string, DbTeamMatchStat[]>,
  teamName: string,
  limit: number
): Promise<DbTeamMatchStat[]> {
  if (!teamName) {
    return [];
  }
  if (cache.has(teamName)) {
    return cache.get(teamName) ?? [];
  }
  const stats = await listTeamMatchStats(supabase, teamName, limit);
  const normalized = stats ?? [];
  cache.set(teamName, normalized);
  return normalized;
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
  payload: PredictionPayload,
  seasonMonth: string | null
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
        season_month: seasonMonth ?? null,
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
  awayRating: number,
  timeZone: string
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
    console.error("Failed to update team_match_stats; continuing without stats update.");
    await logDebugUpdate(supabase, "team_match_stats_failed", { matchId });
  }

  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select(
      "id, user_id, home_pred, away_pred, points, users(id, username, first_name, last_name, nickname, faction_club_id)"
    )
    .eq("match_id", matchId);

  if (predError) {
    console.error("Failed to fetch predictions", predError);
    return { ok: false, notifications: [] };
  }

  const predictionRows = (predictions as PredictionRow[]) ?? [];
  const predictionStats = buildMatchResultPredictionStats(predictionRows, homeScore, awayScore);
  const deltas = new Map<number, number>();
  const updates: Array<{ id: number; points: number }> = [];
  const predictedUserIds = new Set<number>();

  for (const prediction of predictionRows) {
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
      const rawPoints = user.points_total;
      const parsedPoints = typeof rawPoints === "number" ? rawPoints : Number(rawPoints);
      const currentPoints = Number.isFinite(parsedPoints) ? parsedPoints : STARTING_POINTS;
      const nextPoints = currentPoints + delta;
      const { error } = await supabase
        .from("users")
        .update({ points_total: nextPoints, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        console.error("Failed to update user points", error);
        continue;
      }

      notifications.push({
        match_id: match.id,
        user_id: user.id,
        delta,
        total_points: nextPoints,
        home_team: match.home_team,
        away_team: match.away_team,
        home_score: homeScore,
        away_score: awayScore,
        prediction_stats: predictionStats
      });
    }
  }

  const seasonMonth = resolveSeasonMonthForMatch(match.kickoff_at, timeZone);
  const penaltyNotifications = await applyMissingPredictionPenalties(
    supabase,
    match,
    predictedUserIds,
    homeScore,
    awayScore,
    predictionStats,
    seasonMonth
  );
  notifications.push(...penaltyNotifications);

  return { ok: true, notifications };
}

async function buildMatchResultNotificationsForResend(
  supabase: SupabaseClient,
  matchId: number,
  timeZone: string
): Promise<MatchResultNotification[]> {
  const match = await getMatch(supabase, matchId);
  if (!match || match.home_score === null || match.away_score === null) {
    return [];
  }

  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select(
      "id, user_id, home_pred, away_pred, points, users(id, username, first_name, last_name, nickname, faction_club_id)"
    )
    .eq("match_id", matchId);

  if (predError) {
    console.error("Failed to fetch predictions for resend", predError);
    return [];
  }

  const predictionRows = (predictions as PredictionRow[]) ?? [];
  const predictionStats = buildMatchResultPredictionStats(predictionRows, match.home_score, match.away_score);
  const predictedUserIds = new Set(predictionRows.map((row) => row.user_id));

  const { data: penalties, error: penaltiesError } = await supabase
    .from("missed_predictions")
    .select("user_id")
    .eq("match_id", match.id);
  if (penaltiesError) {
    console.error("Failed to fetch missed_predictions for resend", penaltiesError);
  }
  const penalizedUserIds = new Set(
    (penalties as Array<{ user_id: number }> | null | undefined)?.map((row) => row.user_id) ?? []
  );

  const allUserIds = new Set<number>([...predictedUserIds, ...penalizedUserIds]);
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, points_total")
    .in("id", Array.from(allUserIds));
  if (usersError) {
    console.error("Failed to fetch users for resend", usersError);
    return [];
  }
  const pointsByUser = new Map<number, number>();
  for (const user of (users as StoredUser[]) ?? []) {
    const rawPoints = user.points_total;
    const parsedPoints = typeof rawPoints === "number" ? rawPoints : Number(rawPoints);
    const currentPoints = Number.isFinite(parsedPoints) ? parsedPoints : STARTING_POINTS;
    pointsByUser.set(user.id, currentPoints);
  }

  const notifications: MatchResultNotification[] = [];
  for (const prediction of predictionRows) {
    const delta = typeof prediction.points === "number" ? prediction.points : Number(prediction.points ?? 0);
    const safeDelta = Number.isFinite(delta) ? delta : 0;
    notifications.push({
      match_id: match.id,
      user_id: prediction.user_id,
      delta: safeDelta,
      total_points: pointsByUser.get(prediction.user_id) ?? STARTING_POINTS,
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: match.home_score,
      away_score: match.away_score,
      prediction_stats: predictionStats
    });
  }

  for (const userId of penalizedUserIds) {
    if (predictedUserIds.has(userId)) {
      continue;
    }
    notifications.push({
      match_id: match.id,
      user_id: userId,
      delta: MISSED_PREDICTION_PENALTY,
      total_points: pointsByUser.get(userId) ?? STARTING_POINTS,
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: match.home_score,
      away_score: match.away_score,
      prediction_stats: predictionStats
    });
  }

  return notifications;
}

async function upsertTeamMatchStats(
  supabase: SupabaseClient,
  match: DbMatch,
  homeScore: number,
  awayScore: number,
  homeRating: number,
  awayRating: number
): Promise<boolean> {
  const v2Ok = await upsertTeamMatchStatsV2(
    supabase,
    match,
    homeScore,
    awayScore,
    homeRating,
    awayRating
  );
  if (v2Ok) {
    return true;
  }
  return await upsertTeamMatchStatsLegacy(
    supabase,
    match,
    homeScore,
    awayScore,
    homeRating,
    awayRating
  );
}

async function upsertTeamMatchStatsV2(
  supabase: SupabaseClient,
  match: DbMatch,
  homeScore: number,
  awayScore: number,
  homeRating: number,
  awayRating: number
): Promise<boolean> {
  try {
    const matchDate = match.kickoff_at;
    const homeName = resolveAnalitikaTeamName(match.home_team, match.home_club_id ?? null);
    const awayName = resolveAnalitikaTeamName(match.away_team, match.away_club_id ?? null);
    const { data, error } = await supabase
      .from("team_match_stats")
      .select("id")
      .eq("home_team_name", homeName)
      .eq("away_team_name", awayName)
      .eq("match_date", matchDate)
      .limit(1);
    if (error) {
      console.error("Failed to check team_match_stats", error);
      await logDebugUpdate(supabase, "team_match_stats_check_failed", {
        matchId: match.id,
        error: formatSupabaseError(error)
      });
      return false;
    }
    const existingId = (data as Array<{ id?: string }> | null)?.[0]?.id ?? null;
    const payload = {
      match_date: matchDate,
      home_team_name: homeName,
      away_team_name: awayName,
      home_goals: homeScore,
      away_goals: awayScore,
      home_avg_rating: homeRating,
      away_avg_rating: awayRating,
      updated_at: new Date().toISOString()
    };
    if (existingId) {
      const { error: updateError } = await supabase
        .from("team_match_stats")
        .update(payload)
        .eq("id", existingId);
      if (updateError) {
        console.error("Failed to update team_match_stats", updateError);
        await logDebugUpdate(supabase, "team_match_stats_update_failed", {
          matchId: match.id,
          error: formatSupabaseError(updateError)
        });
        return false;
      }
      return true;
    }
    const { error: insertError } = await supabase
      .from("team_match_stats")
      .insert({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...payload
      });
    if (insertError) {
      console.error("Failed to insert team_match_stats", insertError);
      await logDebugUpdate(supabase, "team_match_stats_insert_failed", {
        matchId: match.id,
        error: formatSupabaseError(insertError)
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Failed to save team_match_stats", error);
    await logDebugUpdate(supabase, "team_match_stats_exception", {
      matchId: match.id,
      error: formatSupabaseError(error)
    });
    return false;
  }
}

async function upsertTeamMatchStatsLegacy(
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
        console.error("Failed to check legacy team_match_stats", error);
        await logDebugUpdate(supabase, "team_match_stats_legacy_check_failed", {
          matchId: match.id,
          error: formatSupabaseError(error)
        });
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
          console.error("Failed to update legacy team_match_stats", updateError);
          await logDebugUpdate(supabase, "team_match_stats_legacy_update_failed", {
            matchId: match.id,
            error: formatSupabaseError(updateError)
          });
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
        console.error("Failed to insert legacy team_match_stats", insertError);
        await logDebugUpdate(supabase, "team_match_stats_legacy_insert_failed", {
          matchId: match.id,
          error: formatSupabaseError(insertError)
        });
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("Failed to save legacy team_match_stats", error);
    await logDebugUpdate(supabase, "team_match_stats_legacy_exception", {
      matchId: match.id,
      error: formatSupabaseError(error)
    });
    return false;
  }
}

function formatSupabaseError(error: unknown): string {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  const payload = error as { code?: string; message?: string; details?: string; hint?: string };
  const parts: string[] = [];
  if (payload.code) {
    parts.push(`code=${payload.code}`);
  }
  if (payload.message) {
    parts.push(`message=${payload.message}`);
  }
  if (payload.details) {
    parts.push(`details=${payload.details}`);
  }
  if (payload.hint) {
    parts.push(`hint=${payload.hint}`);
  }
  if (parts.length > 0) {
    return parts.join(" ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function logDebugUpdate(
  supabase: SupabaseClient,
  event: string,
  payload: { matchId?: number; error?: string } = {}
): Promise<void> {
  try {
    const parts: string[] = [event];
    if (typeof payload.matchId === "number") {
      parts.push(`match_id=${payload.matchId}`);
    }
    if (payload.error) {
      parts.push(`error=${payload.error}`);
    }
    const text = parts.join(" ");
    await supabase.from("debug_updates").insert({
      update_type: "bot_log",
      chat_id: null,
      thread_id: null,
      message_id: null,
      user_id: null,
      text,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to write debug_updates log", error);
  }
}

async function applyMissingPredictionPenalties(
  supabase: SupabaseClient,
  match: DbMatch,
  predictedUserIds: Set<number>,
  homeScore: number,
  awayScore: number,
  predictionStats: MatchResultPredictionStats,
  seasonMonth: string | null
): Promise<MatchResultNotification[]> {
  try {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, points_total, faction_club_id, created_at");
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

    const matchKickoff = match.kickoff_at ? new Date(match.kickoff_at) : null;
    for (const user of (users as StoredUser[]) ?? []) {
      if (!user.faction_club_id) {
        continue;
      }
      if (matchKickoff && user.created_at) {
        const createdAt = new Date(user.created_at);
        if (!Number.isNaN(createdAt.getTime()) && createdAt > matchKickoff) {
          continue;
        }
      }
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
        .insert({ user_id: user.id, match_id: match.id, season_month: seasonMonth ?? null });
      if (insertError) {
        console.error("Failed to store missing prediction penalty", insertError);
        continue;
      }

      notifications.push({
        match_id: match.id,
        user_id: user.id,
        delta: MISSED_PREDICTION_PENALTY,
        total_points: nextPoints,
        home_team: match.home_team,
        away_team: match.away_team,
        home_score: homeScore,
        away_score: awayScore,
        prediction_stats: predictionStats
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
        faction_club_id: payload.faction_club_id ?? null,
        nickname: payload.nickname ?? null,
        avatar_choice: payload.avatar_choice ?? null,
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

function buildMatchResultPredictionStats(
  predictions: PredictionRow[],
  homeScore: number,
  awayScore: number
): MatchResultPredictionStats {
  const totalPredictions = predictions.length;
  const actualOutcome = getOutcome(homeScore, awayScore);
  let resultSupportCount = 0;
  const exactGuessers: MatchResultExactGuessUser[] = [];

  for (const prediction of predictions) {
    const predictionOutcome = getOutcome(prediction.home_pred, prediction.away_pred);
    if (predictionOutcome === actualOutcome) {
      resultSupportCount++;
    }
    if (prediction.home_pred === homeScore && prediction.away_pred === awayScore) {
      exactGuessers.push({
        user_id: prediction.user_id,
        nickname: prediction.users?.nickname ?? null,
        username: prediction.users?.username ?? null,
        first_name: prediction.users?.first_name ?? null,
        last_name: prediction.users?.last_name ?? null,
        faction_club_id: prediction.users?.faction_club_id ?? null
      });
    }
  }

  const resultSupportPercent =
    totalPredictions > 0 ? Math.round((resultSupportCount / totalPredictions) * 100) : 0;

  return {
    total_predictions: totalPredictions,
    result_support_percent: resultSupportPercent,
    exact_guessers: exactGuessers
  };
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

const FACTION_SLUG_ALIASES: Record<string, FactionBranchSlug> = {
  barcelona: "barcelona",
  barca: "barcelona",
  "atletico-madrid": "atletico-madrid",
  atletico: "atletico-madrid",
  "atletico madrid": "atletico-madrid",
  "atletico_madrid": "atletico-madrid",
  "bayern-munchen": "bayern-munchen",
  bayern: "bayern-munchen",
  "bayern_munchen": "bayern-munchen",
  "borussia-dortmund": "borussia-dortmund",
  dortmund: "borussia-dortmund",
  "borussia_dortmund": "borussia-dortmund",
  "manchester-city": "manchester-city",
  "manchester city": "manchester-city",
  "manchester_city": "manchester-city",
  "man-city": "manchester-city",
  mancity: "manchester-city",
  "paris-saint-germain": "paris-saint-germain",
  "paris_saint_germain": "paris-saint-germain",
  psg: "paris-saint-germain",
  real_madrid: "real_madrid",
  "real-madrid": "real_madrid",
  realmadrid: "real_madrid",
  liverpool: "liverpool",
  arsenal: "arsenal",
  chelsea: "chelsea",
  milan: "milan",
  juventus: "juventus",
  juve: "juventus",
  inter: "inter",
  "inter-milan": "inter",
  intermilan: "inter",
  napoli: "napoli",
  "dynamo-kyiv": "dynamo-kyiv",
  "dynamo_kyiv": "dynamo-kyiv",
  dynamo: "dynamo-kyiv",
  dinamo: "dynamo-kyiv",
  shakhtar: "shakhtar",
  "shakhtar-donetsk": "shakhtar",
  "manchester-united": "manchester-united",
  "manchester_united": "manchester-united",
  "manchester united": "manchester-united",
  "man-united": "manchester-united",
  manutd: "manchester-united",
  "man utd": "manchester-united"
};

function normalizeFactionChoice(value: unknown): FactionBranchSlug | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1] ?? normalized;
  const direct = FACTION_SLUG_ALIASES[candidate];
  if (direct) {
    return direct;
  }
  const hyphenated = candidate.replace(/[\s_]+/g, "-");
  const hyphenMatch = FACTION_SLUG_ALIASES[hyphenated];
  if (hyphenMatch) {
    return hyphenMatch;
  }
  const underscored = candidate.replace(/[\s-]+/g, "_");
  const underscoreMatch = FACTION_SLUG_ALIASES[underscored];
  if (underscoreMatch) {
    return underscoreMatch;
  }
  const compact = candidate.replace(/[\s_-]+/g, "");
  if (!compact) {
    return null;
  }
  for (const slug of ALL_FACTION_BRANCHES) {
    const slugCompact = slug.replace(/[\s_-]+/g, "");
    if (slugCompact === compact) {
      return slug;
    }
  }
  return null;
}

function normalizeClassicoChoice(value: unknown): ClassicoFaction | null {
  const slug = normalizeFactionChoice(value);
  if (!slug) {
    return null;
  }
  return CLASSICO_FACTIONS.includes(slug as ClassicoFaction) ? (slug as ClassicoFaction) : null;
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
  "como-1907": "Como 1907",
  "racing": "Racing Santander"
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
  selections: { factionClubId: string | null }
): boolean {
  const parts = avatarChoice.split("/");
  if (parts.length !== 2) {
    return false;
  }
  const clubId = parts[1];
  const allowed = new Set<string>();
  if (selections.factionClubId) {
    const normalized = selections.factionClubId.trim();
    if (normalized) {
      allowed.add(normalized);
      const classico = normalizeClassicoChoice(normalized);
      const slug = getClassicoSlug(classico);
      if (slug) {
        allowed.add(slug);
      }
    }
  }
  return allowed.has(clubId);
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

function filterMatchesByRange(matches: DbMatch[], range: { start: string; end: string }): DbMatch[] {
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return matches;
  }
  return matches.filter((match) => {
    if (!match.kickoff_at) {
      return false;
    }
    const kickoffMs = new Date(match.kickoff_at).getTime();
    if (!Number.isFinite(kickoffMs)) {
      return false;
    }
    return kickoffMs >= startMs && kickoffMs <= endMs;
  });
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

function getKyivDateString(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function getKyivHour(date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    hour12: false
  }).format(date);
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed : -1;
}

function isValidKyivDateString(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidKyivMonthString(value: string | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function getKyivStart(dateStr: string): Date {
  const base = new Date(`${dateStr}T00:00:00Z`);
  const offsetMs = getTimeZoneOffset(base, "Europe/Kyiv");
  return new Date(base.getTime() - offsetMs);
}

function getKyivMonthRange(monthStr: string): { start: string; end: string } | null {
  if (!isValidKyivMonthString(monthStr)) {
    return null;
  }
  const [yearRaw, monthRaw] = monthStr.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) {
    return null;
  }
  const lastDay = daysInMonth(year, month);
  const start = zonedTimeToUtc(year, month, 1, 0, 0, 0, "Europe/Kyiv");
  const end = zonedTimeToUtc(year, month, lastDay, 23, 59, 59, "Europe/Kyiv");
  return { start: start.toISOString(), end: end.toISOString() };
}

function computeCurrentMonthExpiry(base: Date = new Date()): Date {
  const { year, month } = getKyivYearMonth(base);
  const lastDay = daysInMonth(year, month);
  return zonedTimeToUtc(year, month, lastDay, 23, 59, 59, "Europe/Kyiv");
}

function getKyivYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  return { year, month };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMs = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offsetMs);
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

function buildMatchResultCaption(notification: MatchResultNotification): string {
  const lines: string[] = [];
  const resultLine = formatMatchResultLine(notification);
  const statsLines = buildMatchResultStatsLines(notification);

  if (resultLine) {
    lines.push(resultLine);
    if (statsLines.length > 0) {
      lines.push("");
    }
  }

  if (statsLines.length > 0) {
    lines.push(...statsLines);
  }

  return lines.join("\n");
}

function buildMatchResultStatsLines(notification: MatchResultNotification): string[] {
  const stats = notification.prediction_stats;
  if (!stats) {
    return [];
  }
  const supportTarget = buildMatchResultSupportTarget(notification);
  const lines = [`${stats.result_support_percent}% депутатів`, `проголосували за ${supportTarget}`];
  const guessers = stats.exact_guessers ?? [];
  if (guessers.length > 0) {
    const formattedGuessers = guessers.map(formatExactGuessLabel);
    const verb = guessers.length === 1 ? "Вгадав" : "Вгадали";
    lines.push("");
    lines.push(`${verb} рахунок:`);
    lines.push(...formattedGuessers);
  }
  return lines;
}

function buildMatchResultSupportTarget(notification: MatchResultNotification): string {
  const home = resolveUkrainianClubName(notification.home_team, null).toUpperCase();
  const away = resolveUkrainianClubName(notification.away_team, null).toUpperCase();
  if (notification.home_score === notification.away_score) {
    return "НІЧИЮ";
  }
  const team = notification.home_score > notification.away_score ? home : away;
  return escapeTelegramHtml(team);
}

function formatExactGuessLabel(user: MatchResultExactGuessUser): string {
  const label = formatPredictionUserLabel({
    id: user.user_id ?? null,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    nickname: user.nickname ?? null,
    faction_club_id: user.faction_club_id ?? null
  });
  const safeLabel = escapeTelegramHtml(label.toUpperCase());
  const factionLabel = escapeTelegramHtml(buildFactionLabel(user.faction_club_id));
  return `${safeLabel} (${factionLabel})`;
}

function buildFactionLabel(factionClubId?: string | null): string {
  if (!factionClubId) {
    return NO_FACTION_LABEL;
  }
  const normalized = normalizeFactionChoice(factionClubId);
  if (normalized) {
    return formatFactionName(normalized);
  }
  const trimmed = factionClubId.trim();
  return trimmed.length ? trimmed : NO_FACTION_LABEL;
}

type MatchResultDeliveryResult = { ok: boolean; status: number | null; body: string };

type MatchResultDeliveryAttempt = {
  context: "match_result_photo" | "match_result_text";
  result: MatchResultDeliveryResult;
};

type MatchResultNotificationJobRow = {
  id: number;
  user_id: number;
  payload: MatchResultNotification;
  attempts: number | null;
  max_attempts: number | null;
};

async function enqueueMatchResultNotifications(
  env: Env,
  supabase: SupabaseClient,
  notifications: MatchResultNotification[]
): Promise<void> {
  if (!notifications.length) {
    return;
  }

  await logDebugUpdate(supabase, "match_result_enqueue", {
    matchId: notifications[0]?.match_id,
    error: `count=${notifications.length}`
  });

  const now = new Date().toISOString();
  const records = notifications.map((notification) => ({
    job_key: buildMatchResultNotificationJobKey(notification),
    user_id: notification.user_id,
    payload: notification,
    status: "pending",
    attempts: 0,
    max_attempts: MATCH_RESULT_NOTIFICATION_MAX_ATTEMPTS,
    next_attempt_at: now,
    locked_at: null,
    last_error: null,
    sent_at: null,
    created_at: now,
    updated_at: now
  }));

  const { error } = await supabase
    .from("match_result_notification_jobs")
    .upsert(records, { onConflict: "job_key", ignoreDuplicates: true });

  if (!error) {
    return;
  }

  await logDebugUpdate(supabase, "match_result_enqueue_failed", {
    matchId: notifications[0]?.match_id,
    error: formatSupabaseError(error)
  });

  console.error("Failed to enqueue match result notifications", error);
  for (const notification of notifications) {
    const attempt = await sendMatchResultNotification(env, notification);
    if (!attempt.result.ok) {
      await logBotDeliveryFailure(supabase, notification.user_id, attempt.context, attempt.result);
    }
  }
}

async function handleMatchResultNotificationQueue(env: Env): Promise<void> {
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Failed to process match result queue: missing_supabase");
    return;
  }

  await releaseStaleMatchResultNotificationLocks(supabase);

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_result_notification_jobs")
    .select("id, user_id, payload, attempts, max_attempts")
    .in("status", ["pending", "retry"])
    .is("locked_at", null)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(MATCH_RESULT_NOTIFICATION_BATCH_SIZE);

  if (error) {
    console.error("Failed to load match result notification queue", error);
    return;
  }

  const jobs = (data as MatchResultNotificationJobRow[] | null) ?? [];
  if (!jobs.length) {
    return;
  }

  let index = 0;
  const workerCount = Math.min(MATCH_RESULT_NOTIFICATION_CONCURRENCY, jobs.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const job = jobs[index];
      index += 1;
      if (!job) {
        break;
      }
      const claimed = await claimMatchResultNotificationJob(supabase, job.id);
      if (!claimed) {
        continue;
      }
      await processMatchResultNotificationJob(env, supabase, job);
    }
  });
  await Promise.all(workers);
}

async function releaseStaleMatchResultNotificationLocks(supabase: SupabaseClient): Promise<void> {
  const nowIso = new Date().toISOString();
  const staleLockBeforeIso = new Date(Date.now() - MATCH_RESULT_NOTIFICATION_LOCK_TIMEOUT_MS).toISOString();
  const { error } = await supabase
    .from("match_result_notification_jobs")
    .update({
      status: "retry",
      locked_at: null,
      next_attempt_at: nowIso,
      updated_at: nowIso
    })
    .eq("status", "processing")
    .lt("locked_at", staleLockBeforeIso);
  if (error) {
    console.error("Failed to release stale match result notification locks", error);
  }
}

async function claimMatchResultNotificationJob(supabase: SupabaseClient, jobId: number): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("match_result_notification_jobs")
    .update({
      status: "processing",
      locked_at: nowIso,
      updated_at: nowIso
    })
    .eq("id", jobId)
    .in("status", ["pending", "retry"])
    .is("locked_at", null)
    .select("id");

  if (error) {
    console.error("Failed to claim match result notification job", error, { jobId });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function hasSentMatchResultNotification(
  supabase: SupabaseClient,
  payload: MatchResultNotification
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("bot_message_logs")
      .select("id")
      .eq("user_id", payload.user_id)
      .eq("direction", "out")
      .eq("sender", "bot")
      .eq("delivery_status", "sent")
      .eq("message_type", getMatchResultImageFile(payload.delta) ? "photo" : "text")
      .eq("payload->>kind", "match_result")
      .eq("payload->>match_id", String(payload.match_id))
      .eq("payload->>delta", String(payload.delta))
      .eq("payload->>home_score", String(payload.home_score))
      .eq("payload->>away_score", String(payload.away_score))
      .limit(1);
    if (error) {
      console.error("Failed to check match result duplicate", error);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error("Failed to check match result duplicate", error);
    return false;
  }
}

async function processMatchResultNotificationJob(
  env: Env,
  supabase: SupabaseClient,
  job: MatchResultNotificationJobRow
): Promise<void> {
  const attempts = (job.attempts ?? 0) + 1;
  const maxAttempts = job.max_attempts ?? MATCH_RESULT_NOTIFICATION_MAX_ATTEMPTS;
  const nowIso = new Date().toISOString();
  const payload = job.payload;

  let finalized = false;
  let finalReason = "unknown";

  try {
    if (!isMatchResultNotificationPayload(payload)) {
      await markMatchResultNotificationJobFailed(supabase, job.id, attempts, "invalid_payload");
      finalized = true;
      finalReason = "invalid_payload";
      return;
    }

    const alreadySent = await hasSentMatchResultNotification(supabase, payload);
    if (alreadySent) {
      const { error } = await supabase
        .from("match_result_notification_jobs")
        .update({
          status: "sent",
          attempts,
          locked_at: null,
          last_error: "duplicate_suppressed",
          sent_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", job.id);
      if (error) {
        console.error("Failed to mark duplicate match result job as sent", error, { jobId: job.id });
      }
      finalized = true;
      finalReason = "duplicate_suppressed";
      return;
    }

    const attempt = await sendMatchResultNotification(env, payload);
    if (attempt.result.ok) {
      const { error } = await supabase
        .from("match_result_notification_jobs")
        .update({
          status: "sent",
          attempts,
          locked_at: null,
          last_error: null,
          sent_at: nowIso,
          updated_at: nowIso
        })
        .eq("id", job.id);
      if (error) {
        console.error("Failed to mark match result notification job as sent", error, { jobId: job.id });
      }
      finalized = true;
      finalReason = "sent";
      return;
    }

    const retryDelayMs = computeMatchResultRetryDelayMs(attempt.result, attempts);
    if (retryDelayMs === null || attempts >= maxAttempts) {
      await markMatchResultNotificationJobFailed(
        supabase,
        job.id,
        attempts,
        buildMatchResultDeliveryError(attempt.context, attempt.result)
      );
      await logBotDeliveryFailure(supabase, job.user_id, attempt.context, attempt.result);
      finalized = true;
      finalReason = "failed";
      return;
    }

    const nextAttemptAt = new Date(Date.now() + retryDelayMs).toISOString();
    const { error } = await supabase
      .from("match_result_notification_jobs")
      .update({
        status: "retry",
        attempts,
        locked_at: null,
        next_attempt_at: nextAttemptAt,
        last_error: buildMatchResultDeliveryError(attempt.context, attempt.result),
        updated_at: nowIso
      })
      .eq("id", job.id);
    if (error) {
      console.error("Failed to reschedule match result notification job", error, { jobId: job.id });
    }
    finalized = true;
    finalReason = "retry";
  } catch (error) {
    console.error("Match result job failed unexpectedly", error, { jobId: job.id });
  } finally {
    if (!finalized) {
      await markMatchResultNotificationJobFailed(supabase, job.id, attempts, "processing_abort");
      await logDebugUpdate(supabase, "match_result_job_abort", {
        error: `job_id=${job.id} user_id=${job.user_id} reason=${finalReason}`
      });
    }
  }
}

async function markMatchResultNotificationJobFailed(
  supabase: SupabaseClient,
  jobId: number,
  attempts: number,
  reason: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("match_result_notification_jobs")
    .update({
      status: "failed",
      attempts,
      locked_at: null,
      last_error: reason,
      updated_at: nowIso
    })
    .eq("id", jobId);
  if (error) {
    console.error("Failed to mark match result notification job as failed", error, { jobId });
  }
}

async function sendMatchResultNotification(
  env: Env,
  notification: MatchResultNotification
): Promise<MatchResultDeliveryAttempt> {
  const extraPayload = {
    kind: "match_result",
    match_id: notification.match_id,
    user_id: notification.user_id,
    delta: notification.delta,
    home_score: notification.home_score,
    away_score: notification.away_score
  };
  const imageFile = getMatchResultImageFile(notification.delta);
  const caption = buildMatchResultCaption(notification) || formatMatchResultLine(notification);
  if (imageFile) {
    const result = await sendPhotoWithResult(
      env,
      notification.user_id,
      buildWebappImageUrl(env, imageFile),
      caption,
      {
        inline_keyboard: [
          [
            {
              text: "ПОДИВИТИСЬ ТАБЛИЦЮ",
              web_app: { url: buildWebappLeaderboardUrl(env) }
            }
          ]
        ]
      },
      undefined,
      undefined,
      true,
      extraPayload
    );
    return { context: "match_result_photo", result };
  }
  const result = await sendMessageWithResult(env, notification.user_id, caption, undefined, undefined, undefined, undefined, extraPayload);
  return { context: "match_result_text", result };
}

function isMatchResultNotificationPayload(payload: unknown): payload is MatchResultNotification {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const value = payload as Partial<MatchResultNotification>;
  if (
    typeof value.match_id !== "number" ||
    typeof value.user_id !== "number" ||
    typeof value.delta !== "number" ||
    typeof value.total_points !== "number" ||
    typeof value.home_team !== "string" ||
    typeof value.away_team !== "string" ||
    typeof value.home_score !== "number" ||
    typeof value.away_score !== "number"
  ) {
    return false;
  }
  const stats = value.prediction_stats;
  if (!stats || typeof stats !== "object") {
    return false;
  }
  const exactGuessers = (stats as Partial<MatchResultNotification["prediction_stats"]>).exact_guessers;
  return Array.isArray(exactGuessers);
}

function computeMatchResultRetryDelayMs(result: MatchResultDeliveryResult, attempts: number): number | null {
  const status = result.status;
  if (status === 429) {
    const retryAfterSeconds = extractTelegramRetryAfterSeconds(result.body);
    if (retryAfterSeconds !== null) {
      return Math.max(1_000, (retryAfterSeconds + 1) * 1_000);
    }
    return 60_000;
  }
  if (status === null || status >= 500) {
    const retryBaseMs = 5_000;
    const power = Math.max(0, Math.min(attempts - 1, 6));
    return Math.min(15 * 60 * 1_000, retryBaseMs * 2 ** power);
  }
  return null;
}

function extractTelegramRetryAfterSeconds(body: string): number | null {
  if (!body) {
    return null;
  }
  try {
    const payload = JSON.parse(body) as { parameters?: { retry_after?: number } };
    const rawValue = payload.parameters?.retry_after;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return Math.max(0, Math.floor(rawValue));
    }
  } catch {
    return null;
  }
  return null;
}

function buildMatchResultDeliveryError(context: string, result: MatchResultDeliveryResult): string {
  const statusLabel = result.status === null ? "network_error" : String(result.status);
  const rawBody = result.body || "";
  const clippedBody = rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody;
  return `${context} status=${statusLabel} body=${clippedBody}`;
}

function buildMatchResultNotificationJobKey(notification: MatchResultNotification): string {
  return [
    "match_result",
    notification.match_id,
    notification.user_id,
    notification.delta,
    notification.home_score,
    notification.away_score
  ].join(":");
}

async function logBotDeliveryFailure(
  supabase: SupabaseClient | null,
  userId: number,
  context: string,
  result: { ok: boolean; status: number | null; body: string }
): Promise<void> {
  if (!supabase) {
    return;
  }
  const statusLabel = result.status === null ? "network_error" : String(result.status);
  const rawBody = result.body || "";
  const clippedBody = rawBody.length > 500 ? `${rawBody.slice(0, 500)}…` : rawBody;
  const text = `${context} status=${statusLabel} body=${clippedBody}`;
  try {
    await supabase.from("debug_updates").insert({
      update_type: "bot_log",
      chat_id: userId,
      thread_id: null,
      message_id: null,
      user_id: userId,
      text,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to log bot delivery failure", error);
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
      const imageUrl = buildWebappImageUrl(env, "1 hour.png");
      for (const user of users) {
        await sendPhoto(
          env,
          user.id,
          imageUrl,
          message,
          {
            inline_keyboard: [[{ text: "ПРОГОЛОСУВАТИ", web_app: { url: buildWebappAdminLayoutUrl(env) } }]]
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

function formatAverageMatchPredictionScore(predictions: MatchPredictionRecord[]): string {
  if (!predictions.length) {
    return "0:0";
  }
  const { homes, aways } = predictions.reduce(
    (acc, prediction) => ({
      homes: acc.homes + prediction.home_pred,
      aways: acc.aways + prediction.away_pred
    }),
    { homes: 0, aways: 0 }
  );
  const averageHome = homes / predictions.length;
  const averageAway = aways / predictions.length;
  const format = (value: number): string => {
    const rounded = Number(value.toFixed(1));
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
  return `${format(averageHome)}:${format(averageAway)}`;
}

function buildMatchStartDigestMessage(
  match: DbMatch,
  _faction: FactionBranchSlug,
  predictions: MatchPredictionRecord[]
): string {
  const homeLabel = getMatchTeamLabel(match, "home") || "Домашня команда";
  const awayLabel = getMatchTeamLabel(match, "away") || "Гостьова команда";
  const averageScore = formatAverageMatchPredictionScore(predictions);
  const prettyAverage = averageScore.replace(":", " : ");
  const header = `${homeLabel} ${prettyAverage}  ${awayLabel}`;
  if (predictions.length === 0) {
    return `${header}\n\nПоки що прогнози відсутні.`;
  }
  const rows = predictions
    .map((prediction) => `${prediction.home_pred}:${prediction.away_pred} — ${formatPredictionUserLabel(prediction.user)}`)
    .join("\n");
  return `${header}\n\n${rows}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleMatchStartDigests(env: Env): Promise<void> {
  const supabase = createSupabaseClient(env);
  if (!supabase) {
    console.error("Failed to send match start digests: missing_supabase");
    return;
  }

  const matches = await listMatchesAwaitingStartDigest(supabase);
  if (!matches || matches.length === 0) {
    return;
  }

  const refs = getFactionChatRefs(env);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const predictions = await listMatchPredictionsWithUsers(supabase, match.id);
    if (!predictions || predictions.length === 0) {
      continue;
    }
    const grouped = groupMatchPredictionsByFaction(predictions);
    const now = new Date().toISOString();
    let anySent = false;

    for (const faction of ALL_FACTION_BRANCHES) {
      const factionPredictions = grouped[faction] ?? [];
      if (factionPredictions.length === 0) {
        continue;
      }
      const chatRef = refs.bySlug[faction];
      if (!chatRef) {
        continue;
      }
      const target =
        typeof chatRef.chatId === "number"
          ? chatRef.chatId
          : chatRef.chatUsername
            ? `@${chatRef.chatUsername}`
            : null;
      if (!target) {
        continue;
      }
      const message = buildMatchStartDigestMessage(match, faction, factionPredictions);
      await sendMessage(env, target, message, undefined, undefined, chatRef.threadId ?? undefined);
      await insertBotDebugMessage(
        supabase,
        typeof chatRef.chatId === "number" ? chatRef.chatId : null,
        chatRef.threadId ?? null,
        message
      );
      anySent = true;
    }

    const { error } = await supabase
      .from("matches")
      .update({ start_digest_sent_at: now })
      .eq("id", match.id)
      .is("start_digest_sent_at", null);
    if (error) {
      console.error("Failed to mark match start digest sent", error, { matchId: match.id, anySent });
    }

    if (index < matches.length - 1) {
      await sleep(MATCH_START_DIGEST_DELAY_MS);
    }
  }
}

function getPredictionReminderWindow(now: Date): { start: Date; end: Date } {
  const targetMs = now.getTime() + PREDICTION_REMINDER_BEFORE_CLOSE_MS;
  const halfWindow = Math.floor(PREDICTION_REMINDER_WINDOW_MS / 2);
  const start = new Date(targetMs - halfWindow);
  const end = new Date(targetMs + halfWindow);
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

type ClassicoFaction = "real_madrid" | "barcelona";

type MatchPredictionUser = {
  id?: number | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  faction_club_id?: string | null;
};

type MatchPredictionRecord = {
  home_pred: number;
  away_pred: number;
  user: MatchPredictionUser | null;
};

type PredictionsByFaction = Record<FactionBranchSlug, MatchPredictionRecord[]>;

async function listMatchesAwaitingStartDigest(supabase: SupabaseClient): Promise<DbMatch[] | null> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("matches")
      .select("id, home_team, away_team, home_club_id, away_club_id, kickoff_at, status")
      .eq("status", "scheduled")
      .lte("kickoff_at", now)
      .is("start_digest_sent_at", null)
      .order("kickoff_at", { ascending: true });

    if (error) {
      console.error("Failed to list matches for start digest", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to list matches for start digest", error);
    return null;
  }
}

async function listMatchPredictionsWithUsers(
  supabase: SupabaseClient,
  matchId: number
): Promise<MatchPredictionRecord[] | null> {
  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("home_pred, away_pred, users (id, username, first_name, last_name, nickname, faction_club_id)")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to fetch match predictions for start digest", error);
      return null;
    }

    const rows = (data as Array<{
      home_pred: number;
      away_pred: number;
      users?: {
        id?: number | null;
        username?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        nickname?: string | null;
        faction_club_id?: string | null;
      } | null;
    }>) ?? [];

    return rows.map((row) => ({
      home_pred: row.home_pred,
      away_pred: row.away_pred,
      user: row.users
        ? {
            id: row.users.id ?? null,
            username: row.users.username ?? null,
            first_name: row.users.first_name ?? null,
            last_name: row.users.last_name ?? null,
            nickname: row.users.nickname ?? null,
            faction_club_id: row.users.faction_club_id ?? null
          }
        : null
    }));
  } catch (error) {
    console.error("Failed to fetch match predictions for start digest", error);
    return null;
  }
}

function groupMatchPredictionsByFaction(predictions: MatchPredictionRecord[]): PredictionsByFaction {
  const grouped: PredictionsByFaction = ALL_FACTION_BRANCHES.reduce<PredictionsByFaction>(
    (acc, slug) => {
      acc[slug] = [];
      return acc;
    },
    {} as PredictionsByFaction
  );
  predictions.forEach((prediction) => {
    const normalized = normalizeFactionChoice(prediction.user?.faction_club_id);
    if (!normalized) {
      return;
    }
    const bucket = grouped[normalized];
    if (!bucket) {
      return;
    }
    bucket.push(prediction);
  });
  return grouped;
}

function formatPredictionUserLabel(user: MatchPredictionUser | null): string {
  if (!user) {
    return "Невідомий";
  }
  const nickname = (user.nickname ?? "").trim();
  if (nickname) {
    return nickname.toUpperCase();
  }
  const telegramUser: TelegramUser = {
    id: user.id ?? 0,
    username: user.username ?? undefined,
    first_name: user.first_name ?? undefined,
    last_name: user.last_name ?? undefined
  };
  const display = formatUserDisplay(telegramUser);
  return display ? display.toUpperCase() : "Невідомий";
}

function formatMatchPredictionLine(
  homeName: string,
  awayName: string,
  prediction: MatchPredictionRecord
): string {
  const userLabel = formatPredictionUserLabel(prediction.user);
  return `${homeName} ${prediction.home_pred}:${prediction.away_pred} ${awayName} (${userLabel})`;
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

    const normalized = ((users as Array<{ id: number | string }> | null | undefined) ?? [])
      .map((user) => {
        if (typeof user.id === "number" && Number.isFinite(user.id)) {
          return { id: user.id };
        }
        if (typeof user.id === "string") {
          const parsed = Number(user.id);
          if (Number.isFinite(parsed)) {
            return { id: parsed };
          }
        }
        return null;
      })
      .filter((user): user is { id: number } => Boolean(user));

    return normalized;
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
  return `${homeLabel} — ${awayLabel}\nпочинають матч через 1 годину`;
}

function formatAnnouncementMatchLine(match: DbMatch): string {
  const home = resolveUkrainianClubName(match.home_team, match.home_club_id ?? null);
  const away = resolveUkrainianClubName(match.away_team, match.away_club_id ?? null);
  return `${home} - ${away}`;
}

function buildMatchesAnnouncementCaption(matches: DbMatch[]): string {
  return matches.map(formatAnnouncementMatchLine).join("\n");
}

async function getMatchesLast24Hours(supabase: SupabaseClient): Promise<DbMatch[] | null> {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const { data, error } = await supabase
      .from("matches")
      .select("id, kickoff_at, status")
      .eq("status", "finished")
      .gte("kickoff_at", twentyFourHoursAgo.toISOString())
      .lte("kickoff_at", now.toISOString())
      .order("kickoff_at", { ascending: false });

    if (error) {
      console.error("Failed to fetch matches from last 24 hours", error);
      return null;
    }

    return (data as DbMatch[]) ?? [];
  } catch (error) {
    console.error("Failed to fetch matches from last 24 hours", error);
    return null;
  }
}

async function getPredictionsWithFactions(
  supabase: SupabaseClient,
  matchIds: number[]
): Promise<Array<{ points: number; faction_club_id: string | null }> | null> {
  if (!matchIds.length) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("points, users(faction_club_id)")
      .in("match_id", matchIds);

    if (error) {
      console.error("Failed to fetch predictions with factions", error);
      return null;
    }

    return (data as Array<{ points: number; users: { faction_club_id: string | null } | null }> | null)?.map(
      (row) => ({
        points: row.points ?? 0,
        faction_club_id: row.users?.faction_club_id ?? null
      })
    ) ?? [];
  } catch (error) {
    console.error("Failed to fetch predictions with factions", error);
    return null;
  }
}

function getEmojiForAccuracy(accuracy: number): string {
  if (accuracy >= 80) return "🔥🔥🔥";
  if (accuracy >= 50) return "👏🏻👏🏻👏🏻";
  if (accuracy >= 30) return "👍🏻👍🏻👍🏻";
  return "😅😅😅";
}

async function sendFactionPredictionsStats(
  supabase: SupabaseClient,
  env: Env
): Promise<{ ok: true } | { ok: false; error: string }> {
  const matches = await getMatchesLast24Hours(supabase);
  if (matches === null) {
    return { ok: false, error: "db_error" };
  }

  if (matches.length === 0) {
    return { ok: true };
  }

  const matchIds = matches.map((match) => match.id);
  const predictions = await getPredictionsWithFactions(supabase, matchIds);
  if (predictions === null) {
    return { ok: false, error: "db_error" };
  }

  if (predictions.length === 0) {
    return { ok: true };
  }

  // Групуємо прогнози за фракціями
  const predictionsByFaction = new Map<FactionBranchSlug, Array<{ points: number }>>();
  
  for (const prediction of predictions) {
    if (!prediction.faction_club_id) {
      continue;
    }
    
    const factionSlug = normalizeFactionChoice(prediction.faction_club_id);
    if (!factionSlug) {
      continue;
    }

    if (!predictionsByFaction.has(factionSlug)) {
      predictionsByFaction.set(factionSlug, []);
    }
    predictionsByFaction.get(factionSlug)!.push({ points: prediction.points });
  }

  if (predictionsByFaction.size === 0) {
    return { ok: true };
  }

  // Рахуємо успішність для кожної фракції окремо
  const refs = getFactionChatRefs(env);
  const sendPromises: Promise<void>[] = [];

  for (const [factionSlug, factionPredictions] of predictionsByFaction.entries()) {
    const ref = refs.bySlug[factionSlug];
    if (!ref) {
      continue;
    }

    const totalPredictions = factionPredictions.length;
    const hits = factionPredictions.filter((p) => p.points > 0).length;
    const accuracy = totalPredictions > 0 ? Math.round((hits / totalPredictions) * 100) : 0;
    const emoji = getEmojiForAccuracy(accuracy);

    const message = `УСПІШНІСТЬ ДЕПУТАТІВ ЗА ВЧОРА:\n\n${accuracy}% — ${emoji}`;

    const chatTarget = ref.chatId ?? (ref.chatUsername ? `@${ref.chatUsername}` : null);
    if (chatTarget) {
      sendPromises.push(
        (async () => {
          await sendMessage(env, chatTarget, message, undefined, undefined, ref.threadId ?? undefined);
          await insertBotDebugMessage(
            supabase,
            typeof ref.chatId === "number" ? ref.chatId : null,
            ref.threadId ?? null,
            message
          );
        })().catch((error) => {
          console.error(`Failed to send message to faction ${factionSlug}`, error);
        })
      );
    }
  }

  await Promise.all(sendPromises);

  return { ok: true };
}

function buildWebappImageUrl(env: Env, fileName: string): string {
  const baseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  return `${baseUrl}/images/${fileName}`;
}

function buildWebappLeaderboardUrl(env: Env): string {
  const baseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  return `${baseUrl}?tab=leaderboard`;
}

function buildWebappMatchesUrl(env: Env): string {
  const baseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  return `${baseUrl}?tab=matches`;
}

function buildWebappAdminLayoutUrl(env: Env): string {
  const baseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  return `${baseUrl}?tab=admin-layout`;
}

function getMatchResultImageFile(delta: number): string | null {
  if (delta === 1) {
    return "+1golosok.png";
  }
  if (delta === -1) {
    return "-1golosok.png";
  }
  if (delta === 5) {
    return "+5goloskov.png";
  }
  return null;
}

function formatMatchResultLine(notification: MatchResultNotification): string {
  const home = resolveUkrainianClubName(notification.home_team, null).toUpperCase();
  const away = resolveUkrainianClubName(notification.away_team, null).toUpperCase();
  const homeLabel = escapeTelegramHtml(home);
  const awayLabel = escapeTelegramHtml(away);
  const score = `${notification.home_score}:${notification.away_score}`;
  return `${homeLabel} ${score} ${awayLabel}`;
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

function resolveAnalitikaTeamName(teamName: string, clubId?: string | null): string {
  const slug = clubId?.trim();
  if (slug) {
    const entry = ANALITIKA_TEAMS.find((team) => team.slug === slug);
    if (entry) {
      return entry.name;
    }
  }
  return teamName;
}

function resolveTeamNameAliases(teamName: string): string[] {
  const normalized = teamName.trim().toLowerCase();
  const aliases = TEAM_NAME_ALIASES[normalized];
  if (!aliases) {
    return [teamName];
  }
  const unique = new Set<string>();
  [teamName, ...aliases].forEach((name) => {
    if (name && name.trim()) {
      unique.add(name);
    }
  });
  return Array.from(unique);
}
