import "./style.css";
import { ALL_CLUBS, EU_CLUBS, type AllLeagueId, type LeagueId, type MatchLeagueId } from "./data/clubs";
import type {
  AdminChatMessage,
  AdminChatThread,
  AvatarOption,
  BotLogEntry,
  ClubSyncResponse,
  FactionEntry,
  FactionChatPreviewMessage,
  Match,
  OddsRefreshDebug,
  OddsRefreshResponse,
  OnboardingInfo,
  PredictionUser,
  PredictionView,
  ProfileStatsPayload,
  TeamMatchStat,
  UserStats
} from "./types";
import {
  fetchAdminChatMessages,
  fetchAdminChatThreads,
  fetchBotLogs,
  postMatchResultNotify,
  sendAdminChatMessage
} from "./api/admin";
import { fetchAuth } from "./api/auth";
import { fetchAnalitikaTeam as fetchAnalitikaTeamApi } from "./api/analitika";
import { fetchLeaderboard } from "./api/leaderboard";
import {
  fetchMatches,
  fetchPendingMatches,
  postClubSync,
  postConfirmMatch,
  postMatch,
  postMatchesAnnouncement,
  postOddsRefresh,
  postResult
} from "./api/matches";
import { postPrediction, fetchPredictions } from "./api/predictions";
import {
  fetchFactionChatPreview,
  fetchFactionMembers,
  postAvatarChoice,
  postNickname,
  postOnboarding
} from "./api/profile";
import { ANALITIKA_TEAM_SLUGS, renderTeamMatchStatsList } from "./features/analitika";
import { TEAM_SLUG_ALIASES } from "../../shared/teamSlugAliases";
import { findClubLeague, formatClubName, getAvatarLogoPath, getClubLogoPath, getMatchTeamInfo } from "./features/clubs";
import { normalizeTeamSlugValue } from "./features/teamSlugs";
import { extractCorrectScoreProbability, formatProbability, getMatchWinnerProbabilities } from "./features/odds";
import { formatCountdown, getMatchPredictionCloseAtMs } from "./features/predictionTime";
import {
  addKyivDays,
  formatKyivDateLabel,
  formatKyivDateTime,
  formatKyivMonthEndLabel,
  getKyivDateString
} from "./formatters/dates";
import { formatPredictionName, formatTelegramName } from "./formatters/names";
import {
  formatTimeInZone,
  renderPendingMatchesList,
  renderMatchesList,
  renderTeamLogo
} from "./screens/matches";
import { renderAdminChatMessages, renderAdminChatThreads, renderAdminUserSessions } from "./screens/adminUsers";
import {
  renderFactionMembersRows,
  renderFactionMembersSection,
  renderLeaderboardList,
  renderUsersError,
  updateFactionRankCache
} from "./features/factionRanking";
import { escapeAttribute, escapeHtml } from "./utils/escape";
import { toKyivISOString } from "./utils/time";
import { getFactionBranchChatUrl } from "./data/factionChatLinks";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let teamGraphPopup: HTMLDivElement | null = null;
let teamGraphBodyEl: HTMLElement | null = null;
let teamGraphTitleEl: HTMLElement | null = null;

const INTRO_SEEN_KEY = "intro_seen";
const INTRO_TIMEOUT_MS = 900;
const PRIMARY_FACTION_STORAGE_KEY = "football.primaryFaction";
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const shouldShowIntro = !prefersReducedMotion && !sessionStorage.getItem(INTRO_SEEN_KEY);
let introFinished = false;
let introOverlay: HTMLDivElement | null = null;
let introTimeoutId: number | null = null;

if (shouldShowIntro) {
  app.classList.add("app-hidden");
  mountIntro();
} else {
  app.classList.add("app-enter");
}

let apiBase = "";
const STARTING_POINTS = 100;
let leaderboardLoaded = false;
let currentDate = "";
let isAdmin = false;
let currentUserId: number | null = null;
let currentUser: TelegramWebAppUser | undefined;
let currentNickname: string | null = null;
let currentAvatarChoice: string | null = null;
let currentOnboarding: OnboardingInfo | null = null;
let currentProfileStats: ProfileStatsPayload | null = null;
let adminLayoutMatches: Match[] = [];
let adminLayoutIndex = 0;
let adminLayoutAverageMatchId: number | null = null;
let adminLayoutHasPrediction = false;
let adminLayoutIsFinished = false;
let adminLayoutVoteMatchId: number | null = null;
let factionMembersRequestVersion = 0;
let noticeRuleIndex = 0;
let predictionCountdownId: number | null = null;
let botLogsLoaded = false;
let lastBotLogId = 0;
const botLogs: BotLogEntry[] = [];
let adminChatThreads: AdminChatThread[] = [];
let adminChatSelectedUserId: number | null = null;
let adminChatMessages: AdminChatMessage[] = [];
let adminChatLoaded = false;
const analitikaTeamCache = new Map<string, TeamMatchStat[]>();
const analitikaTeamInFlight = new Map<string, Promise<TeamMatchStat[] | null>>();
const predictionsLoaded = new Set<number>();
const matchAveragesLoaded = new Set<number>();
const matchesById = new Map<number, Match>();
const adminLayoutAverageCache = new Map<number, { homeAvg: number; awayAvg: number; count: number }>();
const adminLayoutPredictionsCache = new Map<number, PredictionView[]>();
const TOP_PREDICTIONS_LIMIT = 4;
const FACTION_MEMBERS_LIMIT = 6;
const FACTION_CHAT_PREVIEW_LIMIT = 1;
const GENERAL_FACTION_CHAT_URL = "https://t.me/football_rada";
let factionChatPreviewRequestVersion = 0;
const EUROPEAN_LEAGUES: Array<{ id: LeagueId; label: string; flag: string }> = [
  { id: "english-premier-league", label: "АПЛ", flag: "🇬🇧" },
  { id: "la-liga", label: "Ла Ліга", flag: "🇪🇸" },
  { id: "serie-a", label: "Серія A", flag: "🇮🇹" },
  { id: "bundesliga", label: "Бундесліга", flag: "🇩🇪" },
  { id: "ligue-1", label: "Ліга 1", flag: "🇫🇷" }
];

const DEFAULT_ONBOARDING_LEAGUE: AllLeagueId = "english-premier-league";
const ONBOARDING_CLUBS: string[] = [
  "real-madrid",
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

const MATCH_LEAGUES: Array<{ id: MatchLeagueId; label: string }> = [
  { id: "ukrainian-premier-league", label: "УПЛ" },
  { id: "uefa-champions-league", label: "ЛЧ" },
  { id: "uefa-europa-league", label: "ЛЄ" },
  { id: "uefa-europa-conference-league", label: "ЛК" },
  { id: "english-premier-league", label: "АПЛ" },
  { id: "la-liga", label: "Ла Ліга" },
  { id: "serie-a", label: "Серія A" },
  { id: "bundesliga", label: "Бундесліга" },
  { id: "ligue-1", label: "Ліга 1" },
  { id: "fa-cup", label: "Кубок Англії" },
  { id: "copa-del-rey", label: "Кубок Іспанії" },
  { id: "coppa-italia", label: "Кубок Італії" },
  { id: "dfb-pokal", label: "Кубок Німеччини" },
  { id: "coupe-de-france", label: "Кубок Франції" }
];
const NOTICE_RULES = [
  "Вгаданий результат +1 голос",
  "Вгаданий рахунок +5 голосів",
  "Не вгаданий результат -1 голос"
];
const QUERY_TAB_PARAM = new URLSearchParams(window.location.search).get("tab") ?? null;
const DEV_BYPASS = import.meta.env.DEV && new URLSearchParams(window.location.search).get("dev") === "1";
const DEV_ADMIN = import.meta.env.DEV && new URLSearchParams(window.location.search).get("admin") === "1";
const DEV_ONBOARDING =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("onboarding") === "1";

const tg = window.Telegram?.WebApp;
if (tg?.ready) {
  tg.ready();
  if (tg.expand) {
    tg.expand();
  }
}

let initData = tg?.initData || "";
if (!initData) {
  if (DEV_BYPASS || DEV_ONBOARDING) {
    queueMicrotask(bootstrapDev);
  } else {
    renderMessage("Open in Telegram");
  }
} else {
  void bootstrap(initData);
}

function bootstrapDev(): void {
  renderLoading();

  apiBase = import.meta.env.VITE_API_BASE || "";
  isAdmin = DEV_ADMIN;
  currentUserId = 1;
  currentUser = {
    id: 1,
    first_name: "Dev",
    last_name: "User",
    username: "dev"
  };
  currentDate = getKyivDateString();

  const factionClubId = "dynamo-kyiv";
  const factionLeague = findClubLeague(factionClubId);
  currentOnboarding = {
    completed: !DEV_ONBOARDING,
    faction_club_id: factionClubId,
    nickname: "Dev",
    avatar_choice: null
  };
  currentNickname = currentOnboarding.nickname ?? null;
  currentAvatarChoice = getDefaultAvatarChoice({
    factionClubId,
    factionLeague
  });

  const stats: UserStats = {
    rank: 7,
    points: 128
  };
  const profile: ProfileStatsPayload = {
    prediction: {
      total: 24,
      hits: 11,
      accuracy_pct: 46,
      streak: 2,
      last_results: [
        { hit: true, points: 5 },
        { hit: false, points: -1 },
        { hit: true, points: 1 },
        { hit: false, points: -1 },
        { hit: true, points: 5 }
      ]
    },
    factions: [
      {
        key: "faction_club_id",
        value: factionClubId,
        members: 124,
        rank: 3
      }
    ]
  };

  if (currentOnboarding.completed) {
    document.body.classList.remove("onboarding-active");
    renderUser(currentUser, stats, isAdmin, currentDate, currentNickname, profile);
  } else {
    document.body.classList.add("onboarding-active");
    renderOnboarding(currentUser, stats, currentOnboarding);
  }

  if (apiBase) {
    void loadMatches(currentDate);
    return;
  }

  const matches = getDevMatches();
  matchesById.clear();
  matches.forEach((match) => {
    matchesById.set(match.id, match);
  });

  adminLayoutMatches = matches.slice();
  adminLayoutIndex = 0;
  adminLayoutHasPrediction = false;
  adminLayoutIsFinished = false;
  adminLayoutVoteMatchId = null;
  const adminLayoutHome = app.querySelector("[data-admin-layout-home]");
  if (adminLayoutHome) {
    updateAdminLayoutView();
  }

  const container = app.querySelector<HTMLElement>("[data-matches]");
  if (container) {
    container.innerHTML = renderMatchesList(matches);
    centerMatchList(container);
  }

  renderAdminMatchOptions(matches);
  setupMatchAnalitikaFilters();
  prefetchMatchAverages(matches);
  startPredictionCountdowns();

  if (isAdmin) {
    const list = app.querySelector<HTMLElement>("[data-admin-pending-list]");
    if (list) {
      const pendingMatches = matches.filter((match) => match.status === "pending");
      list.innerHTML = renderPendingMatchesList(pendingMatches);
    }
  }
}

function getStoredAdminToken(): string | undefined {
  return undefined;
}

function getDevMatches(): Match[] {
  const now = Date.now();
  const upcoming = new Date(now + 2 * 60 * 60 * 1000).toISOString();
  const closed = new Date(now - 1 * 60 * 60 * 1000).toISOString();
  const finished = new Date(now - 5 * 60 * 60 * 1000).toISOString();

  return [
    {
      id: 101,
      home_team: "Dynamo Kyiv",
      away_team: "Shakhtar",
      league_id: "ukrainian-premier-league",
      home_club_id: "dynamo-kyiv",
      away_club_id: "shakhtar",
      kickoff_at: upcoming,
      prediction_closes_at: upcoming,
      status: "scheduled",
      venue_city: "Kyiv",
      tournament_name: "Українська Прем'єр-ліга",
      tournament_stage: "Group stage",
      odds_json: [
        {
          bookmakers: [
            {
              bets: [
                {
                  values: [
                    { value: "1", odd: 1.8 },
                    { value: "X", odd: 3.2 },
                    { value: "2", odd: 4.5 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 102,
      home_team: "Arsenal",
      away_team: "Chelsea",
      league_id: "english-premier-league",
      home_club_id: "arsenal",
      away_club_id: "chelsea",
      kickoff_at: closed,
      prediction_closes_at: closed,
      status: "pending",
      venue_city: "London",
      has_prediction: true,
      tournament_name: "Premier League",
      tournament_stage: "Round of 16",
      odds_json: [
        {
          bookmakers: [
            {
              bets: [
                {
                  values: [
                    { value: "1", odd: 2.4 },
                    { value: "X", odd: 3.25 },
                    { value: "2", odd: 2.9 }
                  ]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 103,
      home_team: "Barcelona",
      away_team: "Real Madrid",
      league_id: "la-liga",
      home_club_id: "barcelona",
      away_club_id: "real_madrid",
      kickoff_at: finished,
      status: "finished",
      home_score: 2,
      away_score: 1,
      venue_city: "Barcelona",
      has_prediction: true
    }
  ];
}

async function bootstrap(data: string): Promise<void> {
  renderLoading();

  apiBase = import.meta.env.VITE_API_BASE || "";

  try {
    const { response, data: payload } = await fetchAuth(apiBase, data);
    if (!response.ok || !payload.ok) {
      renderMessage("Auth failed", "Please reopen the WebApp.");
      return;
    }

    isAdmin = Boolean(payload.admin);
    currentUserId = payload.user?.id ?? null;
    currentUser = payload.user;
    currentDate = getKyivDateString();

    const stats: UserStats = {
      rank: payload.rank ?? null,
      points: typeof payload.points_total === "number" ? payload.points_total : STARTING_POINTS
    };

    const onboarding = payload.onboarding ?? { completed: false };
    currentOnboarding = onboarding;
    currentNickname = onboarding.nickname ?? null;
    currentAvatarChoice = onboarding.avatar_choice ?? null;

    if (!onboarding.completed) {
      document.body.classList.add("onboarding-active");
      renderOnboarding(payload.user, stats, onboarding);
      return;
    }

    document.body.classList.remove("onboarding-active");
    renderUser(payload.user, stats, isAdmin, currentDate, currentNickname, payload.profile ?? null);
    await loadMatches(currentDate);
    if (isAdmin) {
      await loadPendingMatches();
      await loadAdminUserSessions();
    }
  } catch {
    renderMessage("Network error", "Check your connection and try again.");
  }
}

function mountIntro(): void {
  document.body.classList.add("intro-active");
  introOverlay = document.createElement("div");
  introOverlay.className = "intro-overlay";
  introOverlay.innerHTML = `
    <div class="intro-content">
      <video autoplay muted playsinline preload="auto">
        <source src="/preloader 24.webm" type="video/webm" />
      </video>
      <button class="intro-skip" type="button" aria-label="Пропустити інтро">Пропустити</button>
    </div>
  `;
  document.body.appendChild(introOverlay);

  const video = introOverlay.querySelector<HTMLVideoElement>("video");
  const skipButton = introOverlay.querySelector<HTMLButtonElement>(".intro-skip");
  if (!video) {
    finishIntro("missing-video");
    return;
  }

  let hasStarted = false;
  video.addEventListener("playing", () => {
    hasStarted = true;
  });
  video.addEventListener("ended", () => finishIntro("ended"));
  video.addEventListener("error", () => {
    if (import.meta.env.DEV) {
      console.warn("intro error");
    }
    finishIntro("error");
  });

  if (skipButton) {
    skipButton.addEventListener("click", () => finishIntro("skip"));
  }

  introOverlay.addEventListener("click", () => {
    finishIntro("skip");
  });

  introTimeoutId = window.setTimeout(() => {
    if (!hasStarted) {
      if (import.meta.env.DEV) {
        console.warn("intro timeout");
      }
      finishIntro("timeout");
    }
  }, INTRO_TIMEOUT_MS);
}

function finishIntro(reason: string): void {
  if (introFinished) {
    return;
  }
  introFinished = true;

  if (introTimeoutId !== null) {
    window.clearTimeout(introTimeoutId);
  }
  sessionStorage.setItem(INTRO_SEEN_KEY, "1");

  app.classList.add("app-enter");
  requestAnimationFrame(() => {
    app.classList.remove("app-hidden");
  });

  document.body.classList.remove("intro-active");

  if (import.meta.env.DEV) {
    console.info(`intro ended: ${reason}`);
  }

  if (!introOverlay) {
    return;
  }

  introOverlay.classList.add("is-fading");
  const removeOverlay = (): void => {
    introOverlay?.remove();
    introOverlay = null;
  };
  introOverlay.addEventListener("transitionend", removeOverlay, { once: true });
  window.setTimeout(removeOverlay, 260);
}

function renderLoading(): void {
  app.innerHTML = "";
}

function renderMessage(message: string, note = "This WebApp should be opened from Telegram."): void {
  const safeMessage = escapeHtml(message);
  const safeNote = escapeHtml(note);
  app.innerHTML = `
    <main class="card">
      <div class="placeholder"></div>
      <h1>${safeMessage}</h1>
      <p class="muted">${safeNote}</p>
    </main>
  `;
}

function renderOnboarding(
  user: TelegramWebAppUser | undefined,
  stats: UserStats,
  onboarding: OnboardingInfo
): void {
  const resolvedLeague = findClubLeague(onboarding.faction_club_id ?? "") ?? DEFAULT_ONBOARDING_LEAGUE;
  const state = {
    step: 1,
    factionClubId: onboarding.faction_club_id ?? null,
    factionLeague: resolvedLeague,
    nickname: onboarding.nickname ?? "",
    logoScrollTop: 0
  };

  const renderStep = (statusMessage = ""): void => {
    const stepTitle = state.step === 3 ? "ПЕРШИЙ МІСЯЦЬ" : `КРОК ${state.step}`;
    const headerTitle = getOnboardingTitle(state.step);
    const monthEndLabel = formatKyivMonthEndLabel(getKyivDateString()).toUpperCase();
    const header =
      state.step === 3
        ? `
      <div class="onboarding-header onboarding-header--promo">
        <span class="onboarding-step onboarding-step--promo">${stepTitle}</span>
        <div class="onboarding-free">БЕЗКОШТОВНО</div>
      </div>
    `
        : `
      <div class="onboarding-header">
        <span class="onboarding-step">${stepTitle}</span>
        <h1>${escapeHtml(headerTitle)}</h1>
      </div>
    `;

    let body = "";
    if (state.step === 1) {
      const clubs = ONBOARDING_CLUBS.map((clubId) => {
        const league = findClubLeague(clubId) ?? DEFAULT_ONBOARDING_LEAGUE;
        return renderClubChoice({
          id: clubId,
          name: formatClubName(clubId),
          logo: getClubLogoPath(league, clubId),
          selected: state.factionClubId === clubId,
          dataAttr: "data-faction-choice"
        });
      }).join("");
      body = `
        <div class="logo-grid">
          ${clubs}
        </div>
        <p class="muted small" data-onboarding-status>${escapeHtml(statusMessage)}</p>
      `;
    } else if (state.step === 2) {
      body = `
        <form class="onboarding-form" data-onboarding-form>
          <label class="field">
            <input type="text" name="nickname" maxlength="24" value="${escapeAttribute(
              state.nickname
            )}" required />
          </label>
          <p class="muted small" data-onboarding-status>${escapeHtml(statusMessage)}</p>
        </form>
      `;
    } else {
      body = "";
    }

    const panelClass =
      state.step === 3 ? "panel onboarding-panel onboarding-panel--promo" : "panel onboarding-panel";
    const actions =
      state.step === 3
        ? ""
        : `
      <div class="onboarding-actions">
        <button class="button ghost" type="button" data-onboarding-back ${
          state.step === 1 ? "disabled" : ""
        }>Назад</button>
        <button class="button" type="button" data-onboarding-next>Далі</button>
      </div>
    `;

    const promoWrapper =
      state.step === 3
        ? `
      <div class="onboarding-promo-stack">
        <img class="onboarding-rada" src="/images/rada.png" alt="" />
        <section class="${panelClass}">
          ${header}
          ${body}
          ${actions}
        </section>
      </div>
    `
        : `
      <section class="${panelClass}">
        ${header}
        ${body}
        ${actions}
      </section>
    `;
    const promoCta =
      state.step === 3
        ? `
      <div class="onboarding-actions onboarding-actions--below">
        <button class="button onboarding-cta" type="button" data-onboarding-join>ПРИЄДНАТИСЬ</button>
      </div>
    `
        : "";
    const urgencyBadge =
      state.step === 3
        ? `<div class="onboarding-urgency onboarding-urgency--below">ДО ${escapeHtml(
            monthEndLabel
          )}</div>`
        : "";

    app.innerHTML = `
      <main class="layout onboarding">
        ${promoWrapper}
        ${promoCta}
        ${urgencyBadge}
      </main>
    `;

    const logoGrid = app.querySelector<HTMLElement>(".logo-grid");
    if (logoGrid) {
      logoGrid.scrollTop = state.logoScrollTop;
      logoGrid.addEventListener("scroll", () => {
        state.logoScrollTop = logoGrid.scrollTop;
      });
    }

    const handleNicknameNext = (): void => {
      const nicknameInput = app.querySelector<HTMLInputElement>("input[name=nickname]");
      state.nickname = nicknameInput?.value ?? "";
      if (state.nickname.trim().length < 2) {
        renderStep("Нікнейм має містити мінімум 2 символи.");
        return;
      }
      state.step = 3;
      renderStep();
    };

    const nextButton = app.querySelector<HTMLButtonElement>("[data-onboarding-next]");
    if (nextButton) {
      nextButton.addEventListener("click", () => {
        if (state.step === 1 && !state.factionClubId) {
          renderStep("Оберіть фракцію, щоб продовжити.");
          return;
        }
        if (state.step === 2) {
          handleNicknameNext();
          return;
        }
        state.step = 2;
        renderStep();
      });
    }

    const backButton = app.querySelector<HTMLButtonElement>("[data-onboarding-back]");
    if (backButton) {
      backButton.addEventListener("click", () => {
        if (state.step === 1) {
          return;
        }
        state.step = Math.max(1, state.step - 1);
        renderStep();
      });
    }

    app.querySelectorAll<HTMLButtonElement>("[data-faction-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        if (logoGrid) {
          state.logoScrollTop = logoGrid.scrollTop;
        }
        const clubId = button.dataset.factionChoice || null;
        state.factionClubId = clubId;
        if (clubId) {
          state.factionLeague = findClubLeague(clubId) ?? null;
        }
        renderStep();
      });
    });

    const form = app.querySelector<HTMLFormElement>("[data-onboarding-form]");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        handleNicknameNext();
      });
    }

    const joinButton = app.querySelector<HTMLButtonElement>("[data-onboarding-join]");
    if (joinButton) {
      joinButton.addEventListener("click", () => {
        void submitOnboarding(state, user, stats);
      });
    }
  };

  renderStep();
}

function getOnboardingTitle(step: number): string {
  if (step === 1) {
    return "ЯКУ ФРАКЦІЮ ОБИРАЄШ?";
  }
  if (step === 2) {
    return "НАПИШИ СВІЙ НІКНЕЙМ";
  }
  return "БЕЗКОШТОВНА УЧАСТЬ";
}

async function submitOnboarding(
  state: {
    factionClubId: string | null;
    factionLeague: AllLeagueId | null;
    nickname: string;
  },
  user: TelegramWebAppUser | undefined,
  stats: UserStats
): Promise<void> {
  const status = app.querySelector<HTMLElement>("[data-onboarding-status]");
  const nickname = state.nickname.trim();
  if (nickname.length < 2) {
    if (status) {
      status.textContent = "Нікнейм має містити мінімум 2 символи.";
    }
    return;
  }

  if (!apiBase) {
    if (status) {
      status.textContent = "Не вдалося зберегти налаштування.";
    }
    return;
  }

  if (DEV_ONBOARDING) {
    currentNickname = nickname;
    currentAvatarChoice = getDefaultAvatarChoice(state);
    currentOnboarding = {
      faction_club_id: state.factionClubId,
      nickname,
      avatar_choice: currentAvatarChoice,
      completed: true
    };
    document.body.classList.remove("onboarding-active");
    renderUser(user, stats, isAdmin, currentDate, currentNickname, null);
    await loadMatches(currentDate);
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    if (!state.factionClubId) {
      if (status) {
        status.textContent = "Оберіть фракцію, щоб продовжити.";
      }
      return;
    }
    const avatarChoice = getDefaultAvatarChoice(state);
    const { response, data } = await postOnboarding(apiBase, {
      initData,
      faction_club_id: state.factionClubId,
      nickname,
      avatar_choice: avatarChoice,
    });
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти налаштування.";
      }
      return;
    }

    currentNickname = nickname;
    currentAvatarChoice = avatarChoice;
    currentUser = user;
    currentOnboarding = {
      faction_club_id: state.factionClubId,
      nickname,
      avatar_choice: avatarChoice,
      completed: true
    };
    renderUser(user, stats, isAdmin, currentDate, currentNickname, null);
    await loadMatches(currentDate);
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти налаштування.";
    }
  }
}

async function submitAvatarChoice(choice: string): Promise<void> {
  if (choice === currentAvatarChoice) {
    const picker = app.querySelector<HTMLElement>("[data-avatar-picker]");
    const toggle = app.querySelector<HTMLButtonElement>("[data-avatar-toggle]");
    if (picker && toggle) {
      picker.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    }
    return;
  }

  if (!apiBase) {
    return;
  }

  const status = app.querySelector<HTMLElement>("[data-avatar-status]");
  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const { response, data } = await postAvatarChoice(apiBase, {
      initData,
      avatar_choice: choice
    });
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти аватар.";
      }
      return;
    }

    currentAvatarChoice = choice;
    if (currentOnboarding) {
      currentOnboarding.avatar_choice = choice;
    }

    const avatarToggle = app.querySelector<HTMLButtonElement>("[data-avatar-toggle]");
    if (avatarToggle) {
      avatarToggle.innerHTML = renderAvatarContent(currentUser, currentAvatarChoice);
      avatarToggle.setAttribute("aria-expanded", "false");
    }

    app.querySelectorAll<HTMLButtonElement>("[data-avatar-choice]").forEach((button) => {
      const isSelected = button.dataset.avatarChoice === choice;
      button.classList.toggle("is-selected", isSelected);
    });

    const picker = app.querySelector<HTMLElement>("[data-avatar-picker]");
    if (picker) {
      picker.classList.remove("is-open");
    }

    leaderboardLoaded = false;

    if (status) {
      status.textContent = "Збережено ✅";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти аватар.";
    }
  }
}

function renderClubChoice(options: {
  id: string;
  name: string;
  logo: string;
  selected: boolean;
  dataAttr: string;
}): string {
  const safeName = escapeHtml(options.name);
  const safeLogo = escapeAttribute(options.logo);
  return `
    <button class="logo-choice ${options.selected ? "is-selected" : ""}" type="button" ${
      options.dataAttr
    }="${escapeAttribute(options.id)}">
      <img class="logo-img" src="${safeLogo}" alt="${safeName}" />
    </button>
  `;
}

function buildAvatarOptions(onboarding: OnboardingInfo | null): AvatarOption[] {
  if (!onboarding?.faction_club_id) {
    return [];
  }
  const league = findClubLeague(onboarding.faction_club_id);
  if (!league) {
    return [];
  }
  return [
    {
      choice: `${league}/${onboarding.faction_club_id}`,
      name: formatClubName(onboarding.faction_club_id),
      logo: getClubLogoPath(league, onboarding.faction_club_id)
    }
  ];
}

function getDefaultAvatarChoice(state: {
  factionClubId: string | null;
  factionLeague: AllLeagueId | null;
}): string | null {
  const clubId = state.factionClubId;
  if (!clubId) {
    return null;
  }
  const league = state.factionLeague ?? findClubLeague(clubId);
  if (!league) {
    return null;
  }
  return `${league}/${clubId}`;
}

function renderAvatarContent(
  user: TelegramWebAppUser | undefined,
  avatarChoice: string | null
): string {
  const logoPath = getAvatarLogoPath(avatarChoice);
  if (logoPath) {
    return `<img class="avatar avatar-logo" src="${escapeAttribute(logoPath)}" alt="Avatar logo" />`;
  }
  if (user?.photo_url) {
    return `<img class="avatar" src="${escapeAttribute(user.photo_url)}" alt="Avatar" />`;
  }
  return `<div class="avatar placeholder"></div>`;
}

const PREDICTION_GRID_MIN_CELLS = 20;

function renderPredictionGrid(profile: ProfileStatsPayload | null): string {
  const lastResults = profile?.prediction?.last_results ?? [];
  const cells: string[] = [];

  lastResults.forEach((entry) => {
    const state = getPredictionDotState(entry);
    cells.push(
      `<span class="prediction-dot ${state.className}" aria-label="${escapeAttribute(state.label)}">${state.icon}</span>`
    );
  });

  const fillerCount = Math.max(0, PREDICTION_GRID_MIN_CELLS - cells.length);
  for (let index = 0; index < fillerCount; index += 1) {
    const state = getPredictionDotState();
    cells.push(
      `<span class="prediction-dot ${state.className}" aria-label="${escapeAttribute(state.label)}">${state.icon}</span>`
    );
  }

  return `<div class="profile-prediction-grid">${cells.join("")}</div>`;
}

function renderFactionBadge(profile: ProfileStatsPayload | null, fallback: AvatarOption | null): string {
  const badge = resolveFactionBadge(profile, fallback);
  if (!badge) {
    return "";
  }
  return `
    <span class="profile-club-badge" aria-label="${escapeAttribute(badge.name)}" role="img">
      <img src="${escapeAttribute(badge.logo)}" alt="${escapeAttribute(badge.name)}" />
    </span>
  `;
}

function resolveFactionBadge(
  profile: ProfileStatsPayload | null,
  fallback: AvatarOption | null
): { name: string; logo: string } | null {
  const entry = selectBadgeFactionEntry(profile);
  if (entry) {
    const display = getFactionDisplay(entry);
    if (display.logo) {
      return display;
    }
  }
  if (fallback?.logo) {
    return { name: fallback.name, logo: fallback.logo };
  }
  return null;
}

function selectBadgeFactionEntry(profile: ProfileStatsPayload | null): FactionEntry | null {
  const factions = profile?.factions ?? [];
  if (!factions.length) {
    return null;
  }
  const primaryId = getPrimaryFactionId();
  if (primaryId) {
    const primary = factions.find((entry) => getFactionId(entry) === primaryId);
    if (primary) {
      return primary;
    }
  }
  return factions[0] ?? null;
}

function getPredictionDotState(entry?: { hit: boolean; points: number }) {
  if (!entry) {
    return {
      icon: "✓",
      className: "is-miss",
      label: "Прогноз не зроблено"
    };
  }
  if (entry.points === 5) {
    return {
      icon: "5",
      className: "is-perfect",
      label: "Вгаданий точний рахунок"
    };
  }
  if (entry.hit) {
    return {
      icon: "✓",
      className: "is-hit",
      label: "Вгаданий результат"
    };
  }
  return {
    icon: "✕",
    className: "is-miss",
    label: "Прогноз невдалий"
  };
}

function formatUkrainianPoints(value: number): string {
  const absValue = Math.abs(Math.trunc(value));
  const mod10 = absValue % 10;
  const mod100 = absValue % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return "БАЛІВ";
  }
  if (mod10 === 1) {
    return "БАЛ";
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return "БАЛИ";
  }
  return "БАЛІВ";
}

function normalizeFactionSlug(slug: string): string {
  return slug.replace(/_/g, "-");
}

function getFactionDisplay(entry: FactionEntry): { name: string; logo: string | null } {
  const normalized = normalizeFactionSlug(entry.value);
  const league = findClubLeague(normalized);
  return {
    name: formatClubName(normalized),
    logo: league ? getClubLogoPath(league, normalized) : null
  };
}

function getFactionId(entry: FactionEntry): string {
  return entry.value;
}

function getPrimaryFactionId(): string | null {
  try {
    return localStorage.getItem(PRIMARY_FACTION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setPrimaryFactionId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(PRIMARY_FACTION_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(PRIMARY_FACTION_STORAGE_KEY);
    }
  } catch {
    return;
  }
}

function getPrimaryFactionLogo(profile: ProfileStatsPayload | null): string | null {
  const primaryId = getPrimaryFactionId();
  if (!primaryId || !profile?.factions?.length) {
    return null;
  }
  const selected = profile.factions.find((entry) => getFactionId(entry) === primaryId);
  if (!selected) {
    return null;
  }
  return getFactionDisplay(selected).logo;
}

function getPrimaryFactionIdFromProfile(profile: ProfileStatsPayload | null): string | null {
  // Спочатку намагаємося отримати з localStorage (primary faction)
  const primaryId = getPrimaryFactionId();
  if (primaryId && profile?.factions?.length) {
    const selected = profile.factions.find((entry) => getFactionId(entry) === primaryId);
    if (selected) {
      return getFactionId(selected);
    }
  }
  // Якщо primary faction не знайдено, використовуємо першу фракцію з профілю
  if (profile?.factions?.length) {
    return getFactionId(profile.factions[0]);
  }
  // Якщо немає фракцій у профілі, використовуємо onboarding
  if (currentOnboarding?.faction_club_id) {
    return currentOnboarding.faction_club_id;
  }
  return null;
}

function updateLeaderboardPrimaryFaction(logo: string | null): void {
  if (!logo || !app) {
    return;
  }
  const row = app.querySelector<HTMLElement>(".leaderboard-row.is-self");
  if (!row) {
    return;
  }
  const identity = row.querySelector<HTMLElement>(".leaderboard-identity");
  if (!identity) {
    return;
  }
  const avatarMarkup = `<img class="table-avatar logo-avatar" src="${escapeAttribute(logo)}" alt="" />`;
  const existingAvatar = identity.querySelector<HTMLElement>(".table-avatar");
  if (existingAvatar) {
    existingAvatar.outerHTML = avatarMarkup;
    return;
  }
  identity.insertAdjacentHTML("afterbegin", avatarMarkup);
}

function renderFactionChatPreviewSection(entry: FactionEntry | null): string {
  const placeholderText = entry ? "Завантаження..." : "Фракцію ще не обрано.";
  const headerLabel = "Чат фракції";
  return `
    <section class="panel faction-chat-preview" data-faction-chat-panel>
      <a
        class="faction-chat-preview__header"
        data-faction-chat-link
        href="${GENERAL_FACTION_CHAT_URL}"
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled="true"
      >
        <span>${escapeHtml(headerLabel)}</span>
      </a>
      <div class="faction-chat-preview__messages" data-faction-chat-messages>
        <p class="muted small">${placeholderText}</p>
      </div>
    </section>
  `;
}

function renderFactionChatPreviewMessages(messages: FactionChatPreviewMessage[]): string {
  if (!messages.length) {
    return `<p class="muted small">Поки що повідомлень немає.</p>`;
  }
  return messages
    .slice(0, 1)
    .map((message, index) => renderFactionChatPreviewMessage(message, index))
    .join("");
}

function renderFactionChatPreviewMessage(message: FactionChatPreviewMessage, index: number): string {
  const lines = (message.text ?? "").trim().split(/\r?\n/);
  const safeText = lines.map((line) => escapeHtml(line)).join("<br />");
  const nickname = message.nickname?.trim();
  const author = message.author?.trim();
  const authorLabel = escapeHtml(nickname || author || "Анонім");
  return `
    <article class="faction-chat-preview-message" role="listitem" data-message-index="${index}">
      <div class="faction-chat-preview-message__author">${authorLabel}</div>
      <p>${safeText}</p>
    </article>
  `;
}

function setFactionChatPreviewLink(link: HTMLAnchorElement | null, url: string | null): void {
  if (!link) {
    return;
  }
  const target = url ?? GENERAL_FACTION_CHAT_URL;
  link.href = target;
  link.removeAttribute("aria-disabled");
  link.classList.remove("is-disabled");
}

async function loadFactionMembers(): Promise<void> {
  const container = app.querySelector<HTMLElement>("[data-faction-members]");
  if (!container || !apiBase) {
    return;
  }
  const entry = selectBadgeFactionEntry(currentProfileStats);
  if (!entry) {
    container.innerHTML = `<p class="muted small">Фракцію ще не обрано.</p>`;
    return;
  }
  const factionLogo = getFactionDisplay(entry).logo;
  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  const requestId = ++factionMembersRequestVersion;
  try {
    const { response, data } = await fetchFactionMembers(apiBase, initData, FACTION_MEMBERS_LIMIT);
    if (requestId !== factionMembersRequestVersion) {
      return;
    }
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted small">Не вдалося завантажити список учасників.</p>`;
      return;
    }
    const members = data.members ?? [];
    container.innerHTML = renderFactionMembersRows(
      members,
      currentUserId,
      factionLogo,
      entry.value,
      data.faction_rank ?? null
    );
  } catch {
    if (requestId !== factionMembersRequestVersion) {
      return;
    }
    container.innerHTML = `<p class="muted small">Помилка завантаження учасників.</p>`;
  }
}

async function loadFactionChatPreview(): Promise<void> {
  if (!app || !apiBase || !initData) {
    return;
  }
  const container = app.querySelector<HTMLElement>("[data-faction-chat-messages]");
  const link = app.querySelector<HTMLAnchorElement>("[data-faction-chat-link]");
  if (!container) {
    return;
  }
  const entry = selectBadgeFactionEntry(currentProfileStats);
  if (!entry) {
    container.innerHTML = `<p class="muted small">Фракцію ще не обрано.</p>`;
    setFactionChatPreviewLink(link, null);
    return;
  }

  const fallbackUrl = getFactionBranchChatUrl(entry);
  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  setFactionChatPreviewLink(link, fallbackUrl);

  const requestId = ++factionChatPreviewRequestVersion;
  try {
    const { response, data } = await fetchFactionChatPreview(apiBase, {
      initData,
      limit: FACTION_CHAT_PREVIEW_LIMIT
    });
    if (requestId !== factionChatPreviewRequestVersion) {
      return;
    }
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted small">Не вдалося завантажити чат.</p>`;
      return;
    }
    const messages = data.messages ?? [];
    container.innerHTML = renderFactionChatPreviewMessages(messages);
    setFactionChatPreviewLink(link, fallbackUrl);
  } catch {
    if (requestId !== factionChatPreviewRequestVersion) {
      return;
    }
    container.innerHTML = `<p class="muted small">Помилка завантаження чату.</p>`;
  }
}

function scrollProfilePredictionsToBottom(): void {
  const container = app.querySelector<HTMLElement>("[data-profile-predictions]");
  if (!container) {
    return;
  }
  window.requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderUser(
  user: TelegramWebAppUser | undefined,
  stats: UserStats,
  admin: boolean,
  date: string,
  nickname?: string | null,
  profile?: ProfileStatsPayload | null
): void {
  currentProfileStats = profile ?? null;
  const displayName = nickname?.trim() ? nickname.trim() : formatTelegramName(user);
  const safeName = escapeHtml(displayName);
  const logoOptions = buildAvatarOptions(currentOnboarding);
  const factionBadgeMarkup = renderFactionBadge(profile ?? null, logoOptions[0] ?? null);
  const predictionGridMarkup = renderPredictionGrid(profile ?? null);
  const nicknameMarkup = safeName
    ? `
      <div class="profile-nickname" data-profile-name>
        <span class="profile-nickname-chip">${safeName}</span>
      </div>
    `
    : "";
  const dateValue = date || getKyivDateString();
  const safeDateLabel = escapeHtml(formatKyivDateLabel(dateValue));
  const pointsLabel = formatUkrainianPoints(stats.points);
  const prediction = profile?.prediction;
  const totalPredictions = prediction?.total ?? 0;
  const hitsPredictions = prediction?.hits ?? 0;
  const accuracy = totalPredictions > 0 ? Math.round((hitsPredictions / totalPredictions) * 100) : 0;
  const primaryFactionEntry = selectBadgeFactionEntry(profile ?? null);
  const factionMembersMarkup = renderFactionMembersSection(primaryFactionEntry);
  const factionChatPreviewMarkup = renderFactionChatPreviewSection(primaryFactionEntry);
  const leagueOptions = MATCH_LEAGUES.map(
    (league) => `<option value="${league.id}">${escapeHtml(league.label)}</option>`
  ).join("");

  const adminPanel = admin
    ? `
      <section class="panel admin">
        <div class="section-header">
          <h2>Адмін</h2>
        </div>
        <div class="admin-actions">
          <button class="button secondary" type="button" data-admin-toggle-add>ДОДАТИ МАТЧ</button>
          <button class="button secondary" type="button" data-admin-toggle-odds>КОЕФІЦІЄНТИ</button>
          <button class="button secondary" type="button" data-admin-toggle-result>ВВЕСТИ РЕЗУЛЬТАТИ</button>
          <button class="button secondary" type="button" data-admin-toggle-users>КОРИСТУВАЧІ</button>
          <a class="button secondary" href="/messages">ЧАТ</a>
          <button class="button secondary" type="button" data-admin-toggle-logs>ЛОГИ БОТА</button>
          <button class="button secondary" type="button" data-admin-toggle-debug>DEBUG</button>
          <button class="button secondary" type="button" data-admin-announce>ПОВІДОМИТИ В БОТІ</button>
        </div>
        <p class="muted small" data-admin-announce-status></p>
        <div class="admin-pending" data-admin-pending>
          <div class="admin-pending-header">
            <p class="muted small">Матчі на підтвердження</p>
            <button class="button secondary small-button" type="button" data-admin-refresh-pending>Оновити список</button>
          </div>
          <div class="admin-pending-list" data-admin-pending-list></div>
          <p class="muted small" data-admin-pending-status></p>
        </div>
        <div class="admin-debug" data-admin-debug>
          <p class="muted small">Чернетка для тестів (не зберігається).</p>
          <textarea class="admin-debug-input" rows="4" placeholder="Тут можна занотувати тести або гіпотези."></textarea>
        </div>
        <form class="admin-form" data-admin-form>
          <label class="field">
            <span>Ліга</span>
            <select name="league_id" data-admin-league required>
              ${leagueOptions}
            </select>
          </label>
          <label class="field">
            <span>Команда 1</span>
            <select name="home_club_id" data-admin-home required></select>
          </label>
          <label class="field">
            <span>Команда 2</span>
            <select name="away_club_id" data-admin-away required></select>
          </label>
          <label class="field">
            <span>Початок (Київ)</span>
            <input type="datetime-local" name="kickoff_at" required />
          </label>
          <button class="button" type="submit">Створити</button>
          <p class="muted small" data-admin-status></p>
        </form>
        <form class="admin-form" data-admin-result-form>
          <label class="field">
            <span>Матч</span>
            <select name="match_id" data-admin-match></select>
          </label>
          <label class="field">
            <span>Avg rating</span>
            <div class="score-inputs">
              <input type="number" min="0" max="10" step="0.1" name="home_avg_rating" placeholder="7.0" required />
              <span>:</span>
              <input type="number" min="0" max="10" step="0.1" name="away_avg_rating" placeholder="7.0" required />
            </div>
          </label>
          <div class="score-inputs">
            <input type="number" min="0" name="home_score" placeholder="0" />
            <span>:</span>
            <input type="number" min="0" name="away_score" placeholder="0" />
          </div>
          <button class="button" type="submit">Зберегти результат</button>
          <p class="muted small" data-admin-result-status></p>
        </form>
        <form class="admin-form" data-admin-odds-form>
          <label class="field">
            <span>Матч</span>
            <select name="match_id" data-admin-odds-match></select>
          </label>
          <button class="button" type="submit">Підтягнути коефіцієнти</button>
          <p class="muted small" data-admin-odds-status></p>
        </form>
        <div class="admin-users" data-admin-users>
          <p class="muted small">Аналітика користувачів</p>
          <div data-admin-users-list></div>
          <p class="muted small" data-admin-users-status></p>
        </div>
        <div class="admin-logs-panel" data-admin-logs>
          <section class="admin-logs">
            <div class="admin-logs__header">
              <h2 class="admin-logs__title">Логи бота</h2>
              <button class="button secondary small" type="button" data-admin-logs-refresh>Оновити</button>
            </div>
            <div class="admin-logs__content" data-admin-logs-content></div>
            <p class="muted small" data-admin-logs-status></p>
          </section>
        </div>
      </section>
    `
    : "";
  const adminScreen = admin
    ? `
      <section class="screen" data-screen="admin">
        ${adminPanel}
      </section>
    `
    : "";
  const adminTabButton = admin
    ? `
        <button
          class="tabbar-button"
          type="button"
          data-tab="admin"
          role="tab"
          aria-selected="false"
          aria-label="Адмін"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"></path>
          </svg>
        </button>
      `
    : "";
  const adminLayoutScreen = `
      <section class="screen screen--admin-layout" data-screen="admin-layout">
        <div class="admin-layout">
          <div class="admin-layout__header">
            <div class="date-switcher" data-admin-layout-date>
              <button class="date-nav" type="button" data-admin-layout-date-prev aria-label="Попередній день">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6"></path>
                </svg>
              </button>
              <div class="date-pill" data-admin-layout-date-label>${safeDateLabel}</div>
              <button class="date-nav" type="button" data-admin-layout-date-next aria-label="Наступний день">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="admin-layout__info">
            <div class="admin-layout__info-card">
              <div class="admin-layout__info-title" data-admin-layout-tournament>—</div>
              <div class="admin-layout__info-subtitle" data-admin-layout-stage>—</div>
            </div>
            <div class="admin-layout__info-odds">
              <div class="admin-layout__info-odd" data-admin-layout-odd="home">—</div>
              <div class="admin-layout__info-odd" data-admin-layout-odd="draw">—</div>
              <div class="admin-layout__info-odd" data-admin-layout-odd="away">—</div>
            </div>
          </div>
          <div class="admin-layout__body">
            <div class="admin-layout__side admin-layout__side--left">
              <button class="admin-layout__nav" type="button" data-admin-layout-prev aria-label="Попередній матч">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6"></path>
                </svg>
              </button>
            </div>
            <div class="admin-layout__center admin-layout__center--left" data-admin-layout-home></div>
            <div class="admin-layout__center admin-layout__center--right" data-admin-layout-away></div>
            <div class="admin-layout__side admin-layout__side--right">
              <button class="admin-layout__nav" type="button" data-admin-layout-next aria-label="Наступний матч">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="admin-layout__vote">
            <div class="admin-layout__score-probability" data-admin-layout-probability>
              ймовірність рахунку 0:0 — 3%
            </div>
            <button class="prediction-submit admin-layout__vote-button" type="button" data-admin-layout-vote>
              Проголосувати
            </button>
          </div>
          <div class="admin-layout__faction-average match-faction-average" data-admin-layout-faction-average data-match-faction-average></div>
          <div class="admin-layout__footer">
            <div class="admin-layout__countdown" data-admin-layout-countdown>
              початок матчу через --:--:--
            </div>
            <span class="admin-layout__pagination" data-admin-layout-pagination></span>
          </div>
          <div class="admin-layout__no-voting" data-admin-layout-no-voting>
            ГОЛОСУВАННЯ ВІДСУТНЄ
          </div>
        </div>
      </section>
    `;
  const matchesScreen = `
        <section class="screen" data-screen="matches">
          <section class="panel matches">
            <div class="section-header">
              <div class="date-switcher" data-date-switcher>
                <button class="date-nav" type="button" data-date-prev aria-label="Попередній день">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6"></path>
                  </svg>
                </button>
                <div class="date-pill" data-date-label>${safeDateLabel}</div>
                <button class="date-nav" type="button" data-date-next aria-label="Наступний день">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 6l6 6-6 6"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div class="matches-list" data-matches></div>
          </section>
        </section>
      `;
  const adminLayoutTabButton = admin
    ? `
        <button
          class="tabbar-button"
          type="button"
          data-tab="admin-layout"
          role="tab"
          aria-selected="false"
          aria-label="Прогнози"
        >
          <span class="tabbar-icon tabbar-icon--matches" aria-hidden="true"></span>
        </button>
      `
    : "";
  const matchesTabButton = admin
    ? `
        <button
          class="tabbar-button"
          type="button"
          data-tab="admin-layout"
          role="tab"
          aria-selected="false"
          aria-label="Матчі"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 8h12v2H6z"></path>
            <path d="M6 12h12v2H6z"></path>
            <path d="M6 16h12v2H6z"></path>
          </svg>
        </button>
      `
    : `
        <button
          class="tabbar-button"
          type="button"
          data-tab="admin-layout"
          role="tab"
          aria-selected="false"
          aria-label="Матчі"
        >
          <span class="tabbar-icon tabbar-icon--matches" aria-hidden="true"></span>
        </button>
      `;
  const tabbarClass = admin ? "tabbar is-admin" : "tabbar";
  const messagesScreen = admin
    ? `
      <section class="screen screen--messages" data-screen="messages">
        <div class="admin-chat-page" data-admin-chat-page>
          <div class="admin-chat-page__header">
            <a class="button secondary small" href="/admin">Назад</a>
            <h2>Повідомлення</h2>
            <button class="button secondary small" type="button" data-admin-chat-refresh>Оновити</button>
          </div>
          <div class="admin-chat">
            <div class="admin-chat__threads">
              <div class="admin-chat__header">
                <h3 class="admin-chat__title">Чати</h3>
              </div>
              <div class="admin-chat__threads-list" data-admin-chat-threads></div>
              <p class="muted small" data-admin-chat-threads-status></p>
            </div>
            <div class="admin-chat__messages-panel">
              <div class="admin-chat__messages-header">
                <div class="admin-chat__selected" data-admin-chat-selected>Оберіть користувача</div>
                <button class="button secondary small" type="button" data-admin-chat-messages-refresh>Оновити</button>
              </div>
              <div class="admin-chat__messages-list" data-admin-chat-messages></div>
              <form class="admin-chat__form" data-admin-chat-form>
                <textarea rows="3" placeholder="Ваше повідомлення..." data-admin-chat-input></textarea>
                <button class="button" type="submit">НАДІСЛАТИ</button>
              </form>
              <p class="muted small" data-admin-chat-form-status></p>
            </div>
          </div>
        </div>
      </section>
    `
    : "";

  app.innerHTML = `
    <div class="app-shell">
      <main class="layout">
        <section class="screen screen--profile" data-screen="profile">
          <div class="profile-screen__layout">
            <div class="profile-screen__row profile-screen__row--results">
              <section class="panel profile center">
                ${nicknameMarkup}
                <div class="profile-predictions" data-profile-predictions>
                  ${predictionGridMarkup}
                </div>
                <div
                  class="card-progress"
                  style="--p:${accuracy}%;"
                  role="img"
                  aria-label="Точність прогнозів ${accuracy}%"
                >
                  <span class="card-progress__fill"></span>
                  <span class="card-progress__label">${accuracy}%</span>
                </div>
              </section>
            </div>

            <div class="profile-screen__row profile-screen__row--chat">
              ${factionMembersMarkup}
            </div>

            <div class="profile-screen__row profile-screen__row--animation">
              <div class="notice-ticker" aria-live="polite">
                <span class="notice-ticker-text" data-notice-text>
                  ${escapeHtml(formatNoticeRule(NOTICE_RULES[0] ?? ""))}
                </span>
              </div>
            </div>

            <div class="profile-screen__row profile-screen__row--chat-preview">
              ${factionChatPreviewMarkup}
            </div>
          </div>
        </section>

        ${adminLayoutScreen}
        ${messagesScreen}

        ${matchesScreen}

        <section class="screen" data-screen="leaderboard">
          <div class="leaderboard-shell">
            <img class="leaderboard-rada" src="/images/rada.png" alt="" />
            <section class="panel leaderboard center">
              <div class="leaderboard-list is-open" data-leaderboard-list></div>
            </section>
          </div>
        </section>
      </main>

      <nav class="${tabbarClass}" role="tablist" aria-label="Навігація">
        ${admin ? adminLayoutTabButton : matchesTabButton}
        <button
          class="tabbar-button"
          type="button"
          data-tab="leaderboard"
          role="tab"
          aria-selected="false"
          aria-label="Таблиця"
        >
          <span class="tabbar-icon tabbar-icon--leaderboard" aria-hidden="true"></span>
        </button>
        <button
          class="tabbar-button"
          type="button"
          data-tab="profile"
          role="tab"
          aria-selected="false"
          aria-label="Профіль"
        >
          <span class="tabbar-icon tabbar-icon--profile" aria-hidden="true"></span>
        </button>
      </nav>
    </div>
  `;

  void loadFactionMembers();
  void loadFactionChatPreview();

  const dateLabel = app.querySelector<HTMLElement>("[data-date-label]");
  const prevButton = app.querySelector<HTMLButtonElement>("[data-date-prev]");
  const nextButton = app.querySelector<HTMLButtonElement>("[data-date-next]");
  const adminLayoutDateLabel = app.querySelector<HTMLElement>("[data-admin-layout-date-label]");
  const adminLayoutPrevDate = app.querySelector<HTMLButtonElement>("[data-admin-layout-date-prev]");
  const adminLayoutNextDate = app.querySelector<HTMLButtonElement>("[data-admin-layout-date-next]");
  const adminLayoutPrevMatch = app.querySelector<HTMLButtonElement>("[data-admin-layout-prev]");
  const adminLayoutNextMatch = app.querySelector<HTMLButtonElement>("[data-admin-layout-next]");

  const setDate = (nextDate: string): void => {
    if (!nextDate) {
      return;
    }
    currentDate = nextDate;
    if (dateLabel) {
      dateLabel.textContent = formatKyivDateLabel(nextDate);
    }
    if (adminLayoutDateLabel) {
      adminLayoutDateLabel.textContent = formatKyivDateLabel(nextDate);
    }
    void loadMatches(nextDate);
  };

  if (prevButton) {
    prevButton.addEventListener("click", () => {
      setDate(addKyivDays(currentDate, -1));
    });
  }

  if (nextButton) {
    nextButton.addEventListener("click", () => {
      setDate(addKyivDays(currentDate, 1));
    });
  }

  if (adminLayoutPrevDate) {
    adminLayoutPrevDate.addEventListener("click", () => {
      setDate(addKyivDays(currentDate, -1));
    });
  }

  if (adminLayoutNextDate) {
    adminLayoutNextDate.addEventListener("click", () => {
      setDate(addKyivDays(currentDate, 1));
    });
  }

  if (adminLayoutPrevMatch) {
    adminLayoutPrevMatch.addEventListener("click", () => {
      shiftAdminLayoutMatch(-1);
    });
  }

  if (adminLayoutNextMatch) {
    adminLayoutNextMatch.addEventListener("click", () => {
      shiftAdminLayoutMatch(1);
    });
  }

  setupTabs();
  setupNoticeTicker();
  scrollProfilePredictionsToBottom();

  const avatarToggle = app.querySelector<HTMLButtonElement>("[data-avatar-toggle]");
  const avatarPicker = app.querySelector<HTMLElement>("[data-avatar-picker]");
  if (avatarToggle && avatarPicker) {
    avatarToggle.addEventListener("click", () => {
      const nextState = !avatarPicker.classList.contains("is-open");
      avatarPicker.classList.toggle("is-open", nextState);
      avatarToggle.setAttribute("aria-expanded", nextState ? "true" : "false");
    });
  }

  app.querySelectorAll<HTMLButtonElement>("[data-avatar-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.avatarChoice;
      if (!choice) {
        return;
      }
      void submitAvatarChoice(choice);
    });
  });

  if (admin) {
    const toggleAdd = app.querySelector<HTMLButtonElement>("[data-admin-toggle-add]");
    const toggleResult = app.querySelector<HTMLButtonElement>("[data-admin-toggle-result]");
    const toggleOdds = app.querySelector<HTMLButtonElement>("[data-admin-toggle-odds]");
    const toggleUsers = app.querySelector<HTMLButtonElement>("[data-admin-toggle-users]");
    const toggleLogs = app.querySelector<HTMLButtonElement>("[data-admin-toggle-logs]");
    const toggleDebug = app.querySelector<HTMLButtonElement>("[data-admin-toggle-debug]");
    const announceButton = app.querySelector<HTMLButtonElement>("[data-admin-announce]");
    const pendingList = app.querySelector<HTMLElement>("[data-admin-pending-list]");
    const pendingStatus = app.querySelector<HTMLElement>("[data-admin-pending-status]");
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    const resultForm = app.querySelector<HTMLFormElement>("[data-admin-result-form]");
    const oddsForm = app.querySelector<HTMLFormElement>("[data-admin-odds-form]");
    const debugPanel = app.querySelector<HTMLElement>("[data-admin-debug]");
    const usersPanel = app.querySelector<HTMLElement>("[data-admin-users]");
    const logsPanel = app.querySelector<HTMLElement>("[data-admin-logs]");
    const logsRefresh = app.querySelector<HTMLButtonElement>("[data-admin-logs-refresh]");
    const chatPage = app.querySelector<HTMLElement>("[data-admin-chat-page]");
    const chatThreadsList = app.querySelector<HTMLElement>("[data-admin-chat-threads]");
    const chatThreadsStatus = app.querySelector<HTMLElement>("[data-admin-chat-threads-status]");
    const chatRefreshButton = app.querySelector<HTMLButtonElement>("[data-admin-chat-refresh]");
    const chatMessagesList = app.querySelector<HTMLElement>("[data-admin-chat-messages]");
    const chatMessagesStatus = app.querySelector<HTMLElement>("[data-admin-chat-form-status]");
    const chatMessagesRefresh = app.querySelector<HTMLButtonElement>("[data-admin-chat-messages-refresh]");
    const chatSelectedLabel = app.querySelector<HTMLElement>("[data-admin-chat-selected]");
    const chatForm = app.querySelector<HTMLFormElement>("[data-admin-chat-form]");
    const chatInput = app.querySelector<HTMLTextAreaElement>("[data-admin-chat-input]");
    if (toggleAdd && form) {
      setupAdminMatchForm(form);
      toggleAdd.addEventListener("click", () => {
        setDefaultKickoffAt(form);
        form.classList.toggle("is-open");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitMatch(form);
      });
    }

    if (toggleResult && resultForm) {
      toggleResult.addEventListener("click", () => {
        resultForm.classList.toggle("is-open");
      });
      resultForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitResult(resultForm);
      });
    }

    if (toggleOdds && oddsForm) {
      toggleOdds.addEventListener("click", () => {
        oddsForm.classList.toggle("is-open");
      });
      oddsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitOddsRefresh(oddsForm);
      });
    }

    if (toggleUsers && usersPanel) {
      toggleUsers.addEventListener("click", () => {
        usersPanel.classList.toggle("is-open");
      });
    }

    if (toggleLogs && logsPanel) {
      toggleLogs.addEventListener("click", () => {
        const nextState = !logsPanel.classList.contains("is-open");
        logsPanel.classList.toggle("is-open", nextState);
        if (nextState && !botLogsLoaded) {
          void loadBotLogs();
        }
      });
    }

    if (logsRefresh) {
      logsRefresh.addEventListener("click", () => {
        void loadBotLogs(true);
      });
    }

    if (chatPage && !adminChatLoaded) {
      void (async () => {
        await loadAdminChatThreads(chatThreadsList, chatThreadsStatus, chatSelectedLabel, true);
        if (adminChatSelectedUserId && chatMessagesList) {
          await loadAdminChatMessages(chatMessagesList, chatMessagesStatus, adminChatSelectedUserId);
        }
      })();
    }

    if (chatRefreshButton) {
      chatRefreshButton.addEventListener("click", () => {
        void loadAdminChatThreads(chatThreadsList, chatThreadsStatus, chatSelectedLabel, true);
      });
    }

    if (chatMessagesRefresh) {
      chatMessagesRefresh.addEventListener("click", () => {
        if (adminChatSelectedUserId) {
          void loadAdminChatMessages(chatMessagesList, chatMessagesStatus, adminChatSelectedUserId);
        }
      });
    }

    if (chatThreadsList) {
      chatThreadsList.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-chat-thread]");
        if (!button) {
          return;
        }
        const userIdRaw = button.dataset.adminChatThread || "";
        const userId = Number.parseInt(userIdRaw, 10);
        if (!Number.isFinite(userId)) {
          return;
        }
        adminChatSelectedUserId = userId;
        if (chatSelectedLabel) {
          chatSelectedLabel.textContent = `Чат з id:${userId}`;
        }
        void loadAdminChatThreads(chatThreadsList, chatThreadsStatus, chatSelectedLabel, true);
        if (chatMessagesList) {
          void loadAdminChatMessages(chatMessagesList, chatMessagesStatus, userId);
        }
      });
    }

    if (chatForm && chatInput) {
      chatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!adminChatSelectedUserId) {
          if (chatMessagesStatus) {
            chatMessagesStatus.textContent = "Оберіть користувача зі списку.";
          }
          return;
        }
        const text = chatInput.value.trim();
        if (!text) {
          return;
        }
        void submitAdminChatMessage(chatForm, chatInput, chatMessagesStatus, adminChatSelectedUserId, chatMessagesList);
      });
    }

    if (toggleDebug && debugPanel) {
      toggleDebug.addEventListener("click", () => {
        debugPanel.classList.toggle("is-open");
      });
    }

    if (announceButton) {
      announceButton.addEventListener("click", () => {
        void publishMatchesAnnouncement();
      });
    }

    const refreshButton = app.querySelector<HTMLButtonElement>("[data-admin-refresh-pending]");
    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        void loadPendingMatches();
      });
    }

    if (pendingList) {
      pendingList.addEventListener("click", (event) => {
        const oddsButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-fetch-odds]");
        if (oddsButton) {
          const matchIdRaw = oddsButton.dataset.adminFetchOdds || "";
          const matchId = Number.parseInt(matchIdRaw, 10);
          if (!Number.isFinite(matchId)) {
            return;
          }
          const statusEl = pendingList.querySelector<HTMLElement>(
            `[data-admin-pending-status][data-match-id="${matchId}"]`
          );
          void refreshPendingMatchOdds(matchId, oddsButton, statusEl);
          return;
        }

        const confirmButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-confirm-match]");
        if (!confirmButton) {
          return;
        }
        const matchIdRaw = confirmButton.dataset.adminConfirmMatch || "";
        const matchId = Number.parseInt(matchIdRaw, 10);
        if (!Number.isFinite(matchId)) {
          return;
        }
        const statusEl = pendingList.querySelector<HTMLElement>(
          `[data-admin-pending-status][data-match-id="${matchId}"]`
        );
        void confirmPendingMatch(matchId, confirmButton, statusEl ?? pendingStatus);
      });
    }

  }

}

function normalizeLocalNickname(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 24) {
    return null;
  }
  return trimmed;
}

async function submitNickname(
  nickname: string,
  statusEl?: HTMLElement | null
): Promise<void> {
  if (!apiBase) {
    return;
  }

  if (statusEl) {
    statusEl.textContent = "Збереження...";
  }

  try {
    const { response, data } = await postNickname(apiBase, {
      initData,
      nickname
    });
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = "Не вдалося зберегти нікнейм.";
      }
      return;
    }

    currentNickname = nickname;
    if (currentOnboarding) {
      currentOnboarding.nickname = nickname;
    }

    const profileName = app.querySelector<HTMLElement>("[data-profile-name]");
    if (profileName) {
      profileName.textContent = nickname;
    }

    const nicknameInput = app.querySelector<HTMLInputElement>("[data-nickname-input]");
    if (nicknameInput) {
      nicknameInput.value = nickname;
    }

    app.querySelectorAll<HTMLElement>(".prediction-row.self .prediction-name").forEach((el) => {
      el.textContent = nickname;
    });

    const leaderboardName = app.querySelector<HTMLElement>(".leaderboard-row.is-self .leaderboard-name");
    if (leaderboardName) {
      leaderboardName.textContent = nickname;
    }
    leaderboardLoaded = false;

    if (statusEl) {
      statusEl.textContent = "Збережено ✅";
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося зберегти нікнейм.";
    }
  }
}

async function loadMatches(date: string): Promise<void> {
  if (!apiBase) {
    return;
  }

  const container = app.querySelector<HTMLElement>("[data-matches]");

  if (container) {
    container.innerHTML = `<p class="muted">Завантаження...</p>`;
  }

  try {
    const { response, data } = await fetchMatches(apiBase, initData, date);
    if (!response.ok || !data.ok) {
      if (container) {
        container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
      }
      return;
    }

    predictionsLoaded.clear();
    matchAveragesLoaded.clear();
    matchesById.clear();
    data.matches.forEach((match) => {
      matchesById.set(match.id, match);
    });
    const adminLayoutHome = app.querySelector("[data-admin-layout-home]");
    if (adminLayoutHome) {
      adminLayoutMatches = data.matches.slice();
      adminLayoutIndex = 0;
      updateAdminLayoutView();
    }
    if (container) {
      container.innerHTML = renderMatchesList(data.matches);
      centerMatchList(container);
    }
    bindMatchActions();
    setupMatchAnalitikaFilters();
    renderAdminMatchOptions(data.matches);
    prefetchMatchAverages(data.matches);
    startPredictionCountdowns();
  } catch {
    if (container) {
      container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
    }
  }
}

async function loadPendingMatches(): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }

  const list = app.querySelector<HTMLElement>("[data-admin-pending-list]");
  const status = app.querySelector<HTMLElement>("[data-admin-pending-status]");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (status) {
    status.textContent = "Завантаження...";
  }

  try {
    const { response, data } = await fetchPendingMatches(apiBase, initData);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося завантажити матчі.";
      }
      return;
    }

    data.matches.forEach((match) => {
    matchesById.set(match.id, match);
  });
  const orderedPending = data.matches.slice().sort((left, right) => right.id - left.id);
  list.innerHTML = renderPendingMatchesList(orderedPending);
  updateAdminLayoutView();
  bindMatchActions(list);
    setupMatchAnalitikaFilters(list);
    if (status) {
      status.textContent = "";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося завантажити матчі.";
    }
  }
}

function centerMatchList(container: HTMLElement): void {
  const firstItem = container.querySelector<HTMLElement>(".match-item");
  if (!firstItem) {
    container.scrollLeft = 0;
    return;
  }
  const containerWidth = container.clientWidth;
  if (containerWidth === 0) {
    return;
  }
  const containerRect = container.getBoundingClientRect();
  const itemRect = firstItem.getBoundingClientRect();
  const relativeLeft = itemRect.left - containerRect.left + container.scrollLeft;
  const itemWidth = itemRect.width;
  const targetScrollLeft = relativeLeft - (containerWidth - itemWidth) / 2;
  const maxScrollLeft = Math.max(0, container.scrollWidth - containerWidth);
  container.scrollLeft = Math.min(Math.max(targetScrollLeft, 0), maxScrollLeft);
}

async function loadAdminUserSessions(): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }

  const list = app.querySelector<HTMLElement>("[data-admin-users-list]");
  const status = app.querySelector<HTMLElement>("[data-admin-users-status]");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (status) {
    status.textContent = "Завантаження...";
  }

  try {
    const { response, data } = await fetchLeaderboard(apiBase, initData, 200);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося завантажити користувачів.";
      }
      return;
    }

    const users = data.users
      .slice()
      .sort((left, right) => {
        const leftStamp = left.last_seen_at ? Date.parse(left.last_seen_at) : 0;
        const rightStamp = right.last_seen_at ? Date.parse(right.last_seen_at) : 0;
        return rightStamp - leftStamp;
      });

    list.innerHTML = renderAdminUserSessions(users);
    if (status) {
      status.textContent = "";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося завантажити користувачів.";
    }
  }
}

function renderBotLogs(entries: BotLogEntry[]): void {
  const container = app.querySelector<HTMLElement>("[data-admin-logs-content]");
  if (!container) {
    return;
  }

  if (entries.length === 0) {
    container.innerHTML = "";
    return;
  }

  const ordered = entries.slice().sort((a, b) => a.id - b.id);
  container.innerHTML = ordered
    .map((entry) => {
      const time = entry.created_at ? formatKyivDateTime(entry.created_at) : "—";
      const meta = `id:${entry.id} user:${entry.user_id ?? "—"} chat:${entry.chat_id ?? "—"}`;
      const message = `${meta} ${entry.text ?? ""}`.trim();
      return `<div class="admin-log-entry admin-log-entry--log">
        <span class="admin-log-entry__time">[${escapeHtml(time)}]</span>
        <span>${escapeHtml(message)}</span>
      </div>`;
    })
    .join("");
  container.scrollTop = container.scrollHeight;
}

async function loadBotLogs(force = false): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }

  const status = app.querySelector<HTMLElement>("[data-admin-logs-status]");
  const token = getStoredAdminToken();
  if (!token) {
    if (status) {
      status.textContent = "Ви не авторизовані.";
    }
    return;
  }

  if (status) {
    status.textContent = "Завантаження...";
  }

  try {
    const params = force || lastBotLogId === 0 ? { limit: 100 } : { since: lastBotLogId, limit: 100 };
    const { response, data } = await fetchBotLogs(apiBase, token, params);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося завантажити логи.";
      }
      return;
    }

    const incoming = data.logs ?? [];
    if (force || lastBotLogId === 0) {
      botLogs.length = 0;
      botLogs.push(...incoming);
    } else {
      botLogs.push(...incoming);
    }

    for (const entry of incoming) {
      if (entry.id > lastBotLogId) {
        lastBotLogId = entry.id;
      }
    }

    if (botLogs.length > 300) {
      botLogs.splice(0, botLogs.length - 300);
    }

    botLogsLoaded = true;
    renderBotLogs(botLogs);

    if (status) {
      status.textContent = "";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося завантажити логи.";
    }
  }
}

function renderAdminChatThreadsUI(
  container: HTMLElement | null,
  statusEl: HTMLElement | null,
  selectedLabel: HTMLElement | null
): void {
  if (!container) {
    return;
  }
  container.innerHTML = renderAdminChatThreads(adminChatThreads, adminChatSelectedUserId);
  if (selectedLabel) {
    if (adminChatSelectedUserId) {
      selectedLabel.textContent = `Чат з id:${adminChatSelectedUserId}`;
    } else {
      selectedLabel.textContent = "Оберіть користувача";
    }
  }
  if (statusEl) {
    statusEl.textContent = adminChatThreads.length === 0 ? "Поки що немає чатів." : "";
  }
}

function renderAdminChatMessagesUI(container: HTMLElement | null, statusEl: HTMLElement | null): void {
  if (!container) {
    return;
  }
  container.innerHTML = renderAdminChatMessages(adminChatMessages);
  if (statusEl) {
    statusEl.textContent = "";
  }
  container.scrollTop = container.scrollHeight;
}

function parseNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAdminChatThread(raw: AdminChatThread): AdminChatThread | null {
  const chatId = parseNumericId(raw.chat_id);
  const userId = parseNumericId(raw.user_id) ?? chatId;
  if (userId === null) {
    return null;
  }
  return {
    ...raw,
    user_id: userId,
    chat_id: chatId ?? userId
  };
}

function normalizeAdminChatMessage(raw: AdminChatMessage): AdminChatMessage | null {
  const id = parseNumericId(raw.id);
  if (id === null) {
    return null;
  }
  return {
    ...raw,
    id,
    chat_id: parseNumericId(raw.chat_id),
    user_id: parseNumericId(raw.user_id),
    thread_id: parseNumericId(raw.thread_id),
    message_id: parseNumericId(raw.message_id)
  };
}

async function loadAdminChatThreads(
  container: HTMLElement | null,
  statusEl: HTMLElement | null,
  selectedLabel: HTMLElement | null,
  force = false
): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }
  const token = getStoredAdminToken();
  if (!token) {
    if (statusEl) {
      statusEl.textContent = "Ви не авторизовані.";
    }
    return;
  }
  if (statusEl) {
    statusEl.textContent = "Завантаження...";
  }
  try {
    const { response, data } = await fetchAdminChatThreads(apiBase, token, { limit: 60 });
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = "Не вдалося завантажити чати.";
      }
      return;
    }
    adminChatThreads = (data.threads ?? [])
      .map(normalizeAdminChatThread)
      .filter((thread): thread is AdminChatThread => Boolean(thread));
    adminChatLoaded = true;
    if (!adminChatSelectedUserId && adminChatThreads.length > 0 && force) {
      const firstUser = adminChatThreads[0]?.user_id ?? null;
      if (typeof firstUser === "number") {
        adminChatSelectedUserId = firstUser;
      }
    }
    renderAdminChatThreadsUI(container, statusEl, selectedLabel);
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося завантажити чати.";
    }
  }
}

async function loadAdminChatMessages(
  container: HTMLElement | null,
  statusEl: HTMLElement | null,
  userId: number
): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }
  const token = getStoredAdminToken();
  if (!token) {
    if (statusEl) {
      statusEl.textContent = "Ви не авторизовані.";
    }
    return;
  }
  if (statusEl) {
    statusEl.textContent = "Завантаження...";
  }
  try {
    const { response, data } = await fetchAdminChatMessages(apiBase, token, { userId, limit: 100 });
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = "Не вдалося завантажити повідомлення.";
      }
      return;
    }
    adminChatMessages = (data.messages ?? [])
      .map(normalizeAdminChatMessage)
      .filter((message): message is AdminChatMessage => Boolean(message));
    renderAdminChatMessagesUI(container, statusEl);
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося завантажити повідомлення.";
    }
  }
}

async function submitAdminChatMessage(
  form: HTMLFormElement,
  input: HTMLTextAreaElement,
  statusEl: HTMLElement | null,
  userId: number,
  messagesContainer: HTMLElement | null
): Promise<void> {
  if (!apiBase || !isAdmin) {
    return;
  }
  const token = getStoredAdminToken();
  if (!token) {
    if (statusEl) {
      statusEl.textContent = "Ви не авторизовані.";
    }
    return;
  }
  const text = input.value.trim();
  if (!text) {
    return;
  }
  if (statusEl) {
    statusEl.textContent = "Відправка...";
  }
  const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }
  try {
    const { response, data } = await sendAdminChatMessage(apiBase, token, { user_id: userId, text });
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = "Не вдалося надіслати повідомлення.";
      }
      return;
    }
    input.value = "";
    if (statusEl) {
      statusEl.textContent = "";
    }
    await loadAdminChatMessages(messagesContainer, statusEl, userId);
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося надіслати повідомлення.";
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

function setupMatchAnalitikaFilters(root: ParentNode = app): void {
  const panels = root.querySelectorAll<HTMLElement>("[data-match-analitika]");
  if (!panels.length) {
    return;
  }

  panels.forEach((panel) => {
    const buttons = panel.querySelectorAll<HTMLButtonElement>("[data-match-analitika-team]");
    if (!buttons.length) {
      return;
    }
    const defaultSlug =
      panel.dataset.defaultTeam || buttons[0]?.dataset.matchAnalitikaTeam || "";

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const teamSlug = button.dataset.matchAnalitikaTeam || "";
        if (!teamSlug || panel.dataset.activeTeam === teamSlug) {
          return;
        }
        setMatchAnalitikaActive(panel, teamSlug);
        void loadMatchAnalitika(panel, teamSlug);
      });
    });

    if (defaultSlug) {
      setMatchAnalitikaActive(panel, defaultSlug);
      void loadMatchAnalitika(panel, defaultSlug, { allowFallback: true });
    }
  });
}

function setMatchAnalitikaActive(panel: HTMLElement, teamSlug: string): void {
  panel.dataset.activeTeam = teamSlug;
  panel.querySelectorAll<HTMLButtonElement>("[data-match-analitika-team]").forEach((button) => {
    const isActive = button.dataset.matchAnalitikaTeam === teamSlug;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function getAlternateAnalitikaTeam(panel: HTMLElement, teamSlug: string): string | null {
  const buttons = panel.querySelectorAll<HTMLButtonElement>("[data-match-analitika-team]");
  for (const button of buttons) {
    const slug = button.dataset.matchAnalitikaTeam || "";
    if (slug && slug !== teamSlug) {
      return slug;
    }
  }
  return null;
}

async function loadMatchAnalitika(
  panel: HTMLElement,
  teamSlug: string,
  options: { allowFallback?: boolean } = {}
): Promise<void> {
  const container = panel.querySelector<HTMLElement>("[data-match-analitika-content]");
  if (!container) {
    return;
  }

  const resolvedSlug = TEAM_SLUG_ALIASES[teamSlug] ?? teamSlug;
  if (!ANALITIKA_TEAM_SLUGS.has(resolvedSlug)) {
    if (options.allowFallback) {
      const fallbackSlug = getAlternateAnalitikaTeam(panel, teamSlug);
      if (fallbackSlug) {
        panel.dataset.loading = "";
        setMatchAnalitikaActive(panel, fallbackSlug);
        await loadMatchAnalitika(panel, fallbackSlug);
        return;
      }
    }
    container.innerHTML = "";
    return;
  }

  if (panel.dataset.loading === teamSlug) {
    return;
  }
  panel.dataset.loading = teamSlug;
  container.innerHTML = "";

  const items = await fetchAnalitikaTeam(resolvedSlug);
  if (!items) {
    container.innerHTML = `<p class="muted">Не вдалося завантажити дані.</p>`;
    panel.dataset.loading = "";
    return;
  }

  if (!items.length) {
    if (options.allowFallback) {
      const fallbackSlug = getAlternateAnalitikaTeam(panel, teamSlug);
      if (fallbackSlug) {
        panel.dataset.loading = "";
        setMatchAnalitikaActive(panel, fallbackSlug);
        await loadMatchAnalitika(panel, fallbackSlug);
        return;
      }
    }
    container.innerHTML = "";
  } else {
    container.innerHTML = renderTeamMatchStatsList(items, teamSlug);
  }
  panel.dataset.loading = "";
}

async function fetchAnalitikaTeam(teamSlug: string): Promise<TeamMatchStat[] | null> {
  if (!apiBase) {
    return null;
  }
  const cached = analitikaTeamCache.get(teamSlug);
  if (cached) {
    return cached;
  }
  const inFlight = analitikaTeamInFlight.get(teamSlug);
  if (inFlight) {
    return inFlight;
  }
  const promise = (async () => {
    try {
      const { response, data } = await fetchAnalitikaTeamApi(apiBase, initData, teamSlug);
      if (!response.ok || !data.ok) {
        return null;
      }
      analitikaTeamCache.set(teamSlug, data.items);
      return data.items;
    } catch {
      return null;
    } finally {
      analitikaTeamInFlight.delete(teamSlug);
    }
  })();
  analitikaTeamInFlight.set(teamSlug, promise);
  return promise;
}

async function submitMatch(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const status = form.querySelector<HTMLElement>("[data-admin-status]");
  const leagueId = form.querySelector<HTMLSelectElement>("select[name=league_id]")?.value || "";
  const homeClubId =
    form.querySelector<HTMLSelectElement>("select[name=home_club_id]")?.value || "";
  const awayClubId =
    form.querySelector<HTMLSelectElement>("select[name=away_club_id]")?.value || "";
  const kickoffRaw = form.querySelector<HTMLInputElement>("input[name=kickoff_at]")?.value.trim() || "";
  const kickoff = toKyivISOString(kickoffRaw);

  if (!leagueId || !homeClubId || !awayClubId || !kickoff) {
    if (status) {
      status.textContent = "Заповніть всі поля.";
    }
    return;
  }

  if (homeClubId === awayClubId) {
    if (status) {
      status.textContent = "Оберіть різні команди.";
    }
    return;
  }

  const home = formatClubName(homeClubId);
  const away = formatClubName(awayClubId);
  const adminToken = getStoredAdminToken();

  if (status) {
    status.textContent = "Створення...";
  }

  try {
    const { response, data } = await postMatch(apiBase, {
      initData,
      home_team: home,
      away_team: away,
      league_id: leagueId,
      home_club_id: homeClubId,
      away_club_id: awayClubId,
      kickoff_at: kickoff,
    }, adminToken);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося створити матч.";
      }
      return;
    }

    form.reset();
    setDefaultKickoffAt(form);
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Матч додано. Очікує підтвердження ✅";
    }
    await loadPendingMatches();
  } catch {
    if (status) {
      status.textContent = "Не вдалося створити матч.";
    }
  }
}

async function confirmPendingMatch(
  matchId: number,
  button?: HTMLButtonElement | null,
  statusEl?: HTMLElement | null
): Promise<void> {
  if (!apiBase) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "ПІДТВЕРДЖУЮ...";
  }
  if (statusEl) {
    statusEl.textContent = "";
  }

  try {
    const adminToken = getStoredAdminToken();
    const { response, data } = await postConfirmMatch(apiBase, {
      initData,
      match_id: matchId
    }, adminToken);
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = getConfirmMatchError(data.ok ? undefined : data.error);
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = "Матч підтверджено ✅";
    }
    await loadPendingMatches();
    await loadMatches(currentDate || getKyivDateString());
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося підтвердити матч.";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "ПІДТВЕРДИТИ";
    }
  }
}

async function refreshPendingMatchOdds(
  matchId: number,
  button?: HTMLButtonElement | null,
  statusEl?: HTMLElement | null
): Promise<void> {
  if (!apiBase) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "ОНОВЛЕННЯ...";
  }
  if (statusEl) {
    statusEl.textContent = "Запит...";
  }

  try {
    const adminToken = getStoredAdminToken();
    const { response, data } = await postOddsRefresh(apiBase, {
      initData,
      match_id: matchId,
      debug: true
    }, adminToken);
    if (!response.ok || !data || !data.ok) {
      if (statusEl) {
        statusEl.textContent = formatOddsRefreshError(data);
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = "Коефіцієнти оновлено ✅";
    }
    await loadPendingMatches();
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося підтягнути коефіцієнти.";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "КОЕФІЦІЄНТИ";
    }
  }
}

async function submitResult(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const status = form.querySelector<HTMLElement>("[data-admin-result-status]");
  const matchIdRaw = form.querySelector<HTMLSelectElement>("select[name=match_id]")?.value || "";
  const matchId = parseScore(matchIdRaw);
  const homeScore = parseScore(form.querySelector<HTMLInputElement>("input[name=home_score]")?.value);
  const awayScore = parseScore(form.querySelector<HTMLInputElement>("input[name=away_score]")?.value);
  const homeRating = parseRating(form.querySelector<HTMLInputElement>("input[name=home_avg_rating]")?.value);
  const awayRating = parseRating(form.querySelector<HTMLInputElement>("input[name=away_avg_rating]")?.value);

  if (matchId === null || homeScore === null || awayScore === null || homeRating === null || awayRating === null) {
    if (status) {
      status.textContent = "Заповніть всі поля.";
    }
    return;
  }
  if (
    typeof window !== "undefined" &&
    !window.confirm(`Підтвердити рахунок ${homeScore}:${awayScore}?`)
  ) {
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const adminToken = getStoredAdminToken();
    const { response, data } = await postResult(apiBase, {
      initData,
      match_id: matchId,
      home_score: homeScore,
      away_score: awayScore,
      home_avg_rating: homeRating,
      away_avg_rating: awayRating
    }, adminToken);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти результат.";
      }
      return;
    }

    // Invalidate analitika cache so "last 5 matches" reflects the new result.
    analitikaTeamCache.clear();
    analitikaTeamInFlight.clear();

    form.reset();
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Результат збережено ✅ Запускаю розсилку…";
    }
    if (adminToken) {
      try {
        const notify = await postMatchResultNotify(apiBase, adminToken, { match_id: matchId });
        if (notify.response.ok && notify.data.ok) {
          if (status) {
            status.textContent = `Результат збережено ✅ Розсилка: ${notify.data.count ?? 0}`;
          }
        } else if (status) {
          status.textContent = "Результат збережено ✅ але розсилку не запущено.";
        }
      } catch {
        if (status) {
          status.textContent = "Результат збережено ✅ але розсилку не запущено.";
        }
      }
    } else if (status) {
      status.textContent = "Результат збережено ✅ (потрібен адмін‑токен для розсилки).";
    }
    await loadMatches(currentDate || getKyivDateString());
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти результат.";
    }
  }
}

async function submitOddsRefresh(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const matchSelect = form.querySelector<HTMLSelectElement>("[data-admin-odds-match]");
  const status = form.querySelector<HTMLElement>("[data-admin-odds-status]");
  const matchIdRaw = matchSelect?.value ?? "";
  const matchId = Number.parseInt(matchIdRaw, 10);
  if (!Number.isFinite(matchId)) {
    if (status) {
      status.textContent = "Оберіть матч.";
    }
    return;
  }

  if (status) {
    status.textContent = "Запит...";
  }

  try {
    const { response, data } = await postOddsRefresh(apiBase, {
      initData,
      match_id: matchId,
      debug: true
    });
    if (!response.ok || !data || !data.ok) {
      if (status) {
        status.textContent = formatOddsRefreshError(data);
      }
      return;
    }

    if (status) {
      status.textContent = "Запит надіслано ✅";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося підтягнути коефіцієнти.";
    }
  }
}

function resolveSeasonForDate(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function getDefaultSeason(): number {
  return resolveSeasonForDate(new Date());
}

async function submitClubSync(form: HTMLFormElement): Promise<void> {
  if (!apiBase || !initData) {
    return;
  }

  const status = form.querySelector<HTMLElement>("[data-admin-clubs-status]");
  if (status) {
    status.textContent = "Синхронізація...";
  }

  const leagueId = (form.querySelector<HTMLSelectElement>("[data-admin-clubs-league]")?.value ?? "").trim();
  const apiLeagueRaw = (form.querySelector<HTMLInputElement>('input[name="api_league_id"]')?.value ?? "").trim();
  const seasonRaw = (form.querySelector<HTMLInputElement>('input[name="season"]')?.value ?? "").trim();
  const apiLeagueId = apiLeagueRaw ? Number(apiLeagueRaw) : undefined;
  const season = seasonRaw ? Number(seasonRaw) : getDefaultSeason();

  try {
    const payload = {
      initData,
      league_id: leagueId || undefined,
      api_league_id: Number.isFinite(apiLeagueId) ? apiLeagueId : undefined,
      season: Number.isFinite(season) ? season : undefined
    };
    const { response, data } = await postClubSync(apiBase, payload);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = formatClubSyncError(data);
      }
      return;
    }

    if (status) {
      status.textContent = formatClubSyncSuccess(data);
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося синхронізувати клуби.";
    }
  }
}

function formatClubSyncSuccess(payload: Extract<ClubSyncResponse, { ok: true }>): string {
  const parts = [
    `Оновлено: ${payload.updated}`,
    `всього: ${payload.teams_total}`,
    payload.season ? `сезон: ${payload.season}` : null
  ].filter(Boolean);
  return `Синхронізація завершена ✅ (${parts.join(", ")})`;
}

function formatClubSyncError(payload: ClubSyncResponse | null): string {
  if (!payload) {
    return "Не вдалося синхронізувати клуби.";
  }
  if (!payload.ok) {
    const detail = payload.detail ? ` (${payload.detail})` : "";
    switch (payload.error) {
      case "bad_initData":
        return "Некоректні дані входу.";
      case "forbidden":
        return "Недостатньо прав.";
      case "missing_api_key":
        return "Не заданий API ключ.";
      case "missing_supabase":
        return "Не налаштовано Supabase.";
      case "missing_league_mapping":
        return `Немає мапи для ліги.${detail}`;
      case "bad_league":
        return "Некоректна ліга.";
      case "missing_timezone":
        return "Немає таймзони для сезону.";
      case "teams_empty":
        return "Список команд порожній.";
      case "api_error":
        if (payload.detail === "teams_status_200") {
          return "API-Football повернуло порожній список команд. Перевір сезон.";
        }
        return `Помилка API-Football.${detail}`;
      case "db_error":
        return `Помилка бази.${detail}`;
      default:
        return `Не вдалося синхронізувати клуби.${detail}`;
    }
  }
  return "Не вдалося синхронізувати клуби.";
}

function formatOddsRefreshError(payload: OddsRefreshResponse | null): string {
  if (!payload || payload.ok) {
    return "Не вдалося підтягнути коефіцієнти.";
  }
  const suffix = payload.detail ? ` (${payload.detail})` : "";
  const debugSuffix = formatOddsRefreshDebug(payload.debug);
  let message = "Не вдалося підтягнути коефіцієнти.";
  switch (payload.error) {
    case "missing_league_mapping":
      message = "Немає мапінгу ліги для API-Football.";
      break;
    case "missing_timezone":
      message = "Не заданий timezone для API-Football.";
      break;
    case "bad_kickoff_date":
      message = "Некоректна дата матчу.";
      break;
    case "team_not_found":
      message = "Команди не знайдені в API-Football.";
      break;
    case "fixture_not_found":
      message = "Матч не знайдено в API-Football.";
      break;
    case "api_error":
      message = "Помилка API-Football.";
      break;
    case "odds_empty":
      message = "Коефіцієнти ще недоступні.";
      break;
    case "db_error":
      message = "Помилка збереження в базі.";
      break;
    case "missing_api_key":
      message = "Не заданий API ключ.";
      break;
    case "match_not_found":
      message = "Матч не знайдено.";
      break;
    case "bad_match_id":
      message = "Некоректний матч.";
      break;
    case "bad_initData":
      message = "Некоректні дані входу.";
      break;
    case "forbidden":
      message = "Недостатньо прав.";
      break;
    case "missing_supabase":
      message = "Не налаштовано Supabase.";
      break;
    case "bad_json":
      message = "Некоректні дані запиту.";
      break;
    default:
      message = "Не вдалося підтягнути коефіцієнти.";
      break;
  }
  return `${message}${suffix}${debugSuffix}`;
}

function formatOddsRefreshDebug(debug?: OddsRefreshDebug): string {
  if (!debug) {
    return "";
  }
  const parts: string[] = [];
  const formatSearchDetails = (details?: OddsRefreshDebug["homeTeamSearchDetails"]): string => {
    if (!details?.length) {
      return "none";
    }
    return details
      .map((item) => {
        const candidates = item.candidates.length ? item.candidates.join(", ") : "none";
        return `${item.query}(${item.status}):${candidates}`;
      })
      .join(" | ");
  };
  if (debug.date) {
    parts.push(`date=${debug.date}`);
  }
  if (debug.season) {
    parts.push(`season=${debug.season}`);
  }
  if (debug.timezone) {
    parts.push(`tz=${debug.timezone}`);
  }
  if (debug.homeClubId || debug.awayClubId) {
    const homeClubId = debug.homeClubId ?? "none";
    const awayClubId = debug.awayClubId ?? "none";
    parts.push(`club_ids=${homeClubId}/${awayClubId}`);
  }
  if (debug.homeTeamNormalized || debug.awayTeamNormalized) {
    const homeNorm = debug.homeTeamNormalized ?? "none";
    const awayNorm = debug.awayTeamNormalized ?? "none";
    parts.push(`team_norm=${homeNorm}/${awayNorm}`);
  }
  if (debug.homeTeamKnownId !== undefined || debug.awayTeamKnownId !== undefined) {
    const homeKnown = debug.homeTeamKnownId ?? "none";
    const awayKnown = debug.awayTeamKnownId ?? "none";
    parts.push(`team_known_id=${homeKnown}/${awayKnown}`);
  }
  if (debug.homeTeamId !== undefined || debug.awayTeamId !== undefined) {
    const homeId = debug.homeTeamId ?? "null";
    const awayId = debug.awayTeamId ?? "null";
    parts.push(`team_ids=${homeId}/${awayId}`);
  }
  if (debug.homeTeamSource || debug.awayTeamSource) {
    const homeSource = debug.homeTeamSource ?? "none";
    const awaySource = debug.awayTeamSource ?? "none";
    parts.push(`team_src=${homeSource}/${awaySource}`);
  }
  if (debug.homeTeamQuery || debug.awayTeamQuery) {
    const homeQuery = debug.homeTeamQuery ?? "none";
    const awayQuery = debug.awayTeamQuery ?? "none";
    parts.push(`team_query=${homeQuery}/${awayQuery}`);
  }
  if (debug.homeTeamSearchStatus !== undefined || debug.awayTeamSearchStatus !== undefined) {
    const homeStatus = debug.homeTeamSearchStatus ?? "none";
    const awayStatus = debug.awayTeamSearchStatus ?? "none";
    parts.push(`team_search=${homeStatus}/${awayStatus}`);
  }
  if (debug.homeTeamSearchAttempts?.length || debug.awayTeamSearchAttempts?.length) {
    const homeAttempts = debug.homeTeamSearchAttempts?.join("->") ?? "none";
    const awayAttempts = debug.awayTeamSearchAttempts?.join("->") ?? "none";
    parts.push(`team_search_attempts=${homeAttempts}/${awayAttempts}`);
  }
  if (debug.homeTeamMatchedName || debug.awayTeamMatchedName) {
    const homeMatch = debug.homeTeamMatchedName ?? "none";
    const awayMatch = debug.awayTeamMatchedName ?? "none";
    parts.push(`team_match=${homeMatch}/${awayMatch}`);
  }
  if (debug.homeTeamMatchScore !== undefined || debug.awayTeamMatchScore !== undefined) {
    const homeScore = debug.homeTeamMatchScore ?? "none";
    const awayScore = debug.awayTeamMatchScore ?? "none";
    parts.push(`team_score=${homeScore}/${awayScore}`);
  }
  if (debug.homeTeamQueryAttempts?.length || debug.awayTeamQueryAttempts?.length) {
    const homeAttempts = debug.homeTeamQueryAttempts?.join("->") ?? "none";
    const awayAttempts = debug.awayTeamQueryAttempts?.join("->") ?? "none";
    parts.push(`team_query_attempts=${homeAttempts}/${awayAttempts}`);
  }
  if (debug.homeTeamCandidates?.length || debug.awayTeamCandidates?.length) {
    const formatCandidates = (items?: Array<{ name?: string }>) =>
      (items ?? [])
        .map((item) => item.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");
    const homeCandidates = formatCandidates(debug.homeTeamCandidates);
    const awayCandidates = formatCandidates(debug.awayTeamCandidates);
    const left = homeCandidates || "none";
    const right = awayCandidates || "none";
    parts.push(`team_candidates=${left}/${right}`);
  }
  if (debug.homeTeamSearchDetails?.length || debug.awayTeamSearchDetails?.length) {
    const homeDetail = formatSearchDetails(debug.homeTeamSearchDetails);
    const awayDetail = formatSearchDetails(debug.awayTeamSearchDetails);
    parts.push(`team_search_details=${homeDetail}/${awayDetail}`);
  }
  if (debug.headtoheadCount !== undefined) {
    parts.push(`h2h=${debug.headtoheadCount}`);
  }
  if (debug.headtoheadStatus) {
    parts.push(`h2h_status=${debug.headtoheadStatus}`);
  }
  if (debug.leagueFixturesCount !== undefined) {
    parts.push(`league_fixtures=${debug.leagueFixturesCount}`);
  }
  if (debug.leagueFixturesSource) {
    parts.push(`league_source=${debug.leagueFixturesSource}`);
  }
  if (debug.leagueDateStatus) {
    parts.push(`league_date_status=${debug.leagueDateStatus}`);
  }
  if (debug.leagueRangeStatus) {
    parts.push(`league_range_status=${debug.leagueRangeStatus}`);
  }
  if (debug.fallbackReason) {
    parts.push(`fallback=${debug.fallbackReason}`);
  }
  if (debug.headtoheadSample?.length) {
    const sample = debug.headtoheadSample
      .map((item) => [item.home, item.away].filter(Boolean).join(" - "))
      .filter(Boolean)
      .join(" | ");
    if (sample) {
      parts.push(`h2h_sample=${sample}`);
    }
  }
  if (debug.leagueFixturesSample?.length) {
    const teamSample = debug.leagueFixturesSample
      .map((item) => [item.home, item.away].filter(Boolean).join(" - "))
      .filter(Boolean)
      .join(" | ");
    if (teamSample) {
      parts.push(`league_sample=${teamSample}`);
    }
  }
  if (debug.teamFixturesCount !== undefined) {
    parts.push(`team_fixtures=${debug.teamFixturesCount}`);
  }
  if (debug.teamFixturesSource) {
    parts.push(`team_source=${debug.teamFixturesSource}`);
  }
  if (debug.teamFixturesStatus) {
    parts.push(`team_status=${debug.teamFixturesStatus}`);
  }
  if (debug.teamFixturesSample?.length) {
    const teamSample = debug.teamFixturesSample
      .map((item) => [item.home, item.away].filter(Boolean).join(" - "))
      .filter(Boolean)
      .join(" | ");
    if (teamSample) {
      parts.push(`team_sample=${teamSample}`);
    }
  }
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

async function publishMatchesAnnouncement(): Promise<void> {
  if (!apiBase) {
    return;
  }

  const status = app.querySelector<HTMLElement>("[data-admin-announce-status]");
  const button = app.querySelector<HTMLButtonElement>("[data-admin-announce]");

  if (status) {
    status.textContent = "Надсилаємо...";
  }
  if (button) {
    button.disabled = true;
  }

  try {
    const { response, data } = await postMatchesAnnouncement(apiBase, initData);
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося надіслати повідомлення.";
      }
      return;
    }

    if (status) {
      status.textContent = "Повідомлення надіслано ✅";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося надіслати повідомлення.";
    }
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function bindMatchActions(root: ParentNode = app): void {
  const forms = root.querySelectorAll<HTMLFormElement>("[data-prediction-form]");
  forms.forEach((form) => {
    if (form.dataset.bound === "true") {
      return;
    }
    form.dataset.bound = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitPrediction(form);
    });
    setupScoreControls(form);
  });

  const toggles = root.querySelectorAll<HTMLButtonElement>("[data-predictions-toggle]");
  toggles.forEach((toggle) => {
    if (toggle.dataset.bound === "true") {
      return;
    }
    toggle.dataset.bound = "true";
    toggle.addEventListener("click", () => {
      const matchIdRaw = toggle.dataset.matchId || "";
      const matchId = Number.parseInt(matchIdRaw, 10);
      if (!Number.isFinite(matchId)) {
        return;
      }
      const container = app.querySelector<HTMLElement>(
        `[data-predictions][data-match-id="${matchId}"]`
      );
      if (container) {
        void togglePredictions(matchId, container);
      }
    });
  });

  const autoContainers = root.querySelectorAll<HTMLElement>("[data-predictions][data-auto-open='true']");
  autoContainers.forEach((container) => {
    if (container.dataset.bound === "true") {
      return;
    }
    container.dataset.bound = "true";
    const matchIdRaw = container.dataset.matchId || "";
    const matchId = Number.parseInt(matchIdRaw, 10);
    if (!Number.isFinite(matchId)) {
      return;
    }
    void togglePredictions(matchId, container, { forceOpen: true });
  });
}

function setupNoticeTicker(): void {
  const textEl = app.querySelector<HTMLElement>("[data-notice-text]");
  if (!textEl || NOTICE_RULES.length === 0) {
    return;
  }

  noticeRuleIndex = 0;
  textEl.textContent = formatNoticeRule(NOTICE_RULES[noticeRuleIndex]);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  textEl.addEventListener("animationiteration", () => {
    noticeRuleIndex = (noticeRuleIndex + 1) % NOTICE_RULES.length;
    textEl.textContent = formatNoticeRule(NOTICE_RULES[noticeRuleIndex]);
  });
}

function formatNoticeRule(rule: string): string {
  return rule.toUpperCase();
}

function setupTabs(): void {
  const buttons = app.querySelectorAll<HTMLButtonElement>("[data-tab]");
  if (!buttons.length) {
    return;
  }

  const setActive = (tab: string): void => {
    app.querySelectorAll<HTMLElement>("[data-screen]").forEach((screen) => {
      screen.classList.toggle("is-active", screen.dataset.screen === tab);
    });
    buttons.forEach((button) => {
      const isActive = button.dataset.tab === tab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    document.body.classList.toggle("profile-tab-active", tab === "profile");
    document.body.classList.toggle("admin-layout-active", tab === "admin-layout");
    if (tab === "leaderboard") {
      void loadLeaderboard();
    }
    if (tab === "admin-layout") {
      if (adminLayoutMatches.length === 0 && currentDate) {
        void loadMatches(currentDate);
      } else if (adminLayoutMatches.length > 0) {
        updateAdminLayoutView();
      }
    }
  };

  if (window.location.pathname.startsWith("/messages")) {
    setActive("messages");
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) {
        return;
      }
      setActive(tab);
    });
  });

  const tabIds = Array.from(buttons)
    .map((button) => button.dataset.tab)
    .filter((tab): tab is string => Boolean(tab));
  const normalizedQueryTab = QUERY_TAB_PARAM?.trim().toLowerCase();
  const fallbackTab = tabIds.includes("leaderboard") ? "leaderboard" : tabIds.includes("admin-layout") ? "admin-layout" : tabIds[0] ?? "leaderboard";
  const initialTab =
    normalizedQueryTab && tabIds.includes(normalizedQueryTab) ? normalizedQueryTab : fallbackTab;
  setActive(initialTab);
}


function setupScoreControls(form: HTMLFormElement): void {
  const controls = form.querySelectorAll<HTMLElement>("[data-score-control]");
  controls.forEach((control) => {
    const input = control.querySelector<HTMLInputElement>("input[type=hidden]");
    const valueEl = control.querySelector<HTMLElement>("[data-score-value]");
    const inc = control.querySelector<HTMLButtonElement>("[data-score-inc]");
    const dec = control.querySelector<HTMLButtonElement>("[data-score-dec]");
    if (!input || !valueEl || !inc || !dec) {
      return;
    }

    const update = (nextValue: number) => {
      const safeValue = Math.max(0, Math.min(20, nextValue));
      input.value = String(safeValue);
      valueEl.textContent = String(safeValue);
      updateScoreOddsIndicator(form);
    };

    inc.addEventListener("click", () => {
      const current = parseScore(input.value) ?? 0;
      update(current + 1);
    });

    dec.addEventListener("click", () => {
      const current = parseScore(input.value) ?? 0;
      update(current - 1);
    });
  });

  updateScoreOddsIndicator(form);
}

function setupAdminMatchForm(form: HTMLFormElement): void {
  const leagueSelect = form.querySelector<HTMLSelectElement>("[data-admin-league]");
  const homeSelect = form.querySelector<HTMLSelectElement>("[data-admin-home]");
  const awaySelect = form.querySelector<HTMLSelectElement>("[data-admin-away]");
  if (!leagueSelect || !homeSelect || !awaySelect) {
    return;
  }

  const renderClubOptions = (leagueId: MatchLeagueId): string => {
    const clubs = ALL_CLUBS[leagueId] ?? [];
    const options = clubs
      .map((clubId) => `<option value="${clubId}">${escapeHtml(formatClubName(clubId))}</option>`)
      .join("");
    return `<option value="">Обери клуб</option>${options}`;
  };

  const setClubOptions = (leagueId: MatchLeagueId): void => {
    homeSelect.innerHTML = renderClubOptions(leagueId);
    awaySelect.innerHTML = renderClubOptions(leagueId);
  };

  const initialLeague = (leagueSelect.value as MatchLeagueId) || MATCH_LEAGUES[0]?.id;
  if (initialLeague) {
    leagueSelect.value = initialLeague;
    setClubOptions(initialLeague);
  }

  leagueSelect.addEventListener("change", () => {
    const leagueId = leagueSelect.value as MatchLeagueId;
    if (!leagueId) {
      return;
    }
    setClubOptions(leagueId);
  });

  setDefaultKickoffAt(form);
}

function setDefaultKickoffAt(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input[name="kickoff_at"]');
  if (!input) {
    return;
  }
  const date = getKyivDateString();
  input.value = `${date}T22:00`;
}

function renderAdminMatchOptions(matches: Match[]): void {
  const select = app.querySelector<HTMLSelectElement>("[data-admin-match]");
  const oddsSelect = app.querySelector<HTMLSelectElement>("[data-admin-odds-match]");
  if (!select) {
    return;
  }

  // Для введення результатів показуємо тільки матчі, які розпочалися або завершилися
  const resultMatches = matches.filter((match) => {
    const isStarted = match.status === "started";
    const isFinished = match.status === "finished";
    const kickoffMs = match.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
    const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && Date.now() >= kickoffMs;
    return isStarted || isFinished || hasKickoffPassed;
  });

  if (!resultMatches.length) {
    select.innerHTML = `<option value="">Немає матчів для введення результатів</option>`;
    select.disabled = true;
    if (oddsSelect) {
      oddsSelect.disabled = false;
      oddsSelect.innerHTML = matches
        .map((match) => {
          const { homeName, awayName } = getMatchTeamInfo(match);
          const title = `${homeName} — ${awayName}`;
          const kickoff = formatKyivDateTime(match.kickoff_at);
          return `<option value="${match.id}">${escapeHtml(title)} (${kickoff})</option>`;
        })
        .join("");
    }
    return;
  }

  select.disabled = false;
  select.innerHTML = resultMatches
    .map((match) => {
      const { homeName, awayName } = getMatchTeamInfo(match);
      const title = `${homeName} — ${awayName}`;
      const kickoff = formatKyivDateTime(match.kickoff_at);
      const hasResult = match.home_score !== null && match.away_score !== null;
      const resultLabel = hasResult ? ` [${match.home_score}:${match.away_score}]` : "";
      return `<option value="${match.id}">${escapeHtml(title)}${resultLabel} (${kickoff})</option>`;
    })
    .join("");
  if (oddsSelect) {
    oddsSelect.disabled = false;
    oddsSelect.innerHTML = matches
      .map((match) => {
        const { homeName, awayName } = getMatchTeamInfo(match);
        const title = `${homeName} — ${awayName}`;
        const kickoff = formatKyivDateTime(match.kickoff_at);
        return `<option value="${match.id}">${escapeHtml(title)} (${kickoff})</option>`;
      })
      .join("");
  }
}

async function submitPrediction(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const matchIdRaw = form.dataset.matchId || "";
  const matchId = Number.parseInt(matchIdRaw, 10);
  if (!Number.isFinite(matchId)) {
    return;
  }

  const homeInput = form.querySelector<HTMLInputElement>("input[name=home_pred]");
  const awayInput = form.querySelector<HTMLInputElement>("input[name=away_pred]");
  const status = form.querySelector<HTMLElement>("[data-prediction-status]");
  const isPreview = form.dataset.predictionPreview === "true";

  if (isPreview) {
    if (status) {
      status.textContent = "Перегляд в адмінці.";
    }
    return;
  }

  const home = parseScore(homeInput?.value);
  const away = parseScore(awayInput?.value);
  if (home === null || away === null) {
    if (status) {
      status.textContent = "Вкажіть рахунок.";
    }
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const { response, data } = await postPrediction(apiBase, {
      initData,
      match_id: matchId,
      home_pred: home,
      away_pred: away
    });
    if (!response.ok || !data.ok) {
      if (data.error === "already_predicted") {
        form.classList.add("is-hidden");
        const container = app.querySelector<HTMLElement>(
          `[data-predictions][data-match-id="${matchId}"]`
        );
        if (container) {
          await togglePredictions(matchId, container, { forceReload: true, forceOpen: true });
        }
      }
      if (status) {
        status.textContent = getPredictionError(data.error);
      }
      return;
    }

    if (status) {
      status.textContent = "Збережено ✅";
    }

    updateOddsHighlight(matchId, home, away);

    const container = app.querySelector<HTMLElement>(
      `[data-predictions][data-match-id="${matchId}"]`
    );
    form.classList.add("is-hidden");
    if (container) {
      await togglePredictions(matchId, container, { forceReload: true, forceOpen: true });
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти прогноз.";
    }
  }
}

async function togglePredictions(
  matchId: number,
  container: HTMLElement,
  options: { forceOpen?: boolean; forceReload?: boolean } = {}
): Promise<void> {
  const form = app.querySelector<HTMLFormElement>(`[data-prediction-form][data-match-id="${matchId}"]`);

  if (predictionsLoaded.has(matchId) && !options.forceReload) {
    if (options.forceOpen) {
      container.classList.add("is-open");
    } else {
      container.classList.toggle("is-open");
    }
    return;
  }

  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const { response, data } = await fetchPredictions(apiBase, initData, matchId);
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
      return;
    }

    updateMatchAverage(matchId, data.predictions);
    container.innerHTML = renderPredictionsPanel(matchId, data.predictions);
    const hasSelfPrediction = Boolean(
      currentUserId && data.predictions.some((item) => item.user_id === currentUserId)
    );
    const match = matchesById.get(matchId);
    const shouldShowFactionAverage = hasSelfPrediction || match?.status === "finished";
    updateMatchFactionAverage(matchId, data.predictions, shouldShowFactionAverage);
    if (form && hasSelfPrediction) {
      form.classList.add("is-hidden");
    }
    predictionsLoaded.add(matchId);
  } catch {
    container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
    const match = matchesById.get(matchId);
    if (match?.status === "finished") {
      showMatchFactionAverageStatus(matchId, "Не вдалося завантажити прогнози.");
    }
  }
}

function shouldPrefetchMatchAverage(match: Match): boolean {
  if (matchAveragesLoaded.has(match.id)) {
    return false;
  }
  if (match.status === "finished") {
    return true;
  }
  if (match.has_prediction) {
    return false;
  }
  if (match.status === "finished" || match.status === "started") {
    return true;
  }
  const closeAtMs = getMatchPredictionCloseAtMs(match);
  return closeAtMs !== null && Date.now() > closeAtMs;
}

async function prefetchMatchAverage(matchId: number): Promise<void> {
  if (!apiBase || matchAveragesLoaded.has(matchId)) {
    return;
  }
  matchAveragesLoaded.add(matchId);
  try {
    const { response, data } = await fetchPredictions(apiBase, initData, matchId);
    if (!response.ok || !data.ok) {
      matchAveragesLoaded.delete(matchId);
      const match = matchesById.get(matchId);
      if (match?.status === "finished") {
        showMatchFactionAverageStatus(matchId, "Не вдалося завантажити прогнози.");
      }
      return;
    }
    updateMatchAverage(matchId, data.predictions);
    const match = matchesById.get(matchId);
    const shouldShowFactionAverage = match?.status === "finished";
    updateMatchFactionAverage(matchId, data.predictions, shouldShowFactionAverage);
  } catch {
    matchAveragesLoaded.delete(matchId);
    const match = matchesById.get(matchId);
    if (match?.status === "finished") {
      showMatchFactionAverageStatus(matchId, "Не вдалося завантажити прогнози.");
    }
  }
}

function prefetchMatchAverages(matches: Match[]): void {
  matches.forEach((match) => {
    if (!shouldPrefetchMatchAverage(match)) {
      return;
    }
    void prefetchMatchAverage(match.id);
  });
}

function renderPredictionsPanel(matchId: number, predictions: PredictionView[]): string {
  if (!predictions.length) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }

  const self = currentUserId
    ? predictions.find((item) => item.user_id === currentUserId) || null
    : null;
  if (!self) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }
  updateOddsHighlight(matchId, self.home_pred, self.away_pred);
  const others = currentUserId
    ? predictions.filter((item) => item.user_id !== currentUserId)
    : predictions;

  const topPredictions = getTopPredictions(others, TOP_PREDICTIONS_LIMIT);
  const rows = renderPredictionRows(self, topPredictions);

  return `
    <div class="predictions-list">${rows}</div>
  `;
}

function updateAdminLayoutScoreValuesFromAverage(matchId: number): void {
  if (adminLayoutIsFinished || !adminLayoutHasPrediction || adminLayoutAverageMatchId !== matchId) {
    return;
  }
  const cached = adminLayoutAverageCache.get(matchId);
  if (!cached) {
    return;
  }
  const homeValue = cached.count ? formatAverageValue(cached.homeAvg) : "0";
  const awayValue = cached.count ? formatAverageValue(cached.awayAvg) : "0";
  const homeValueEl = app.querySelector<HTMLElement>(
    '.admin-layout__score-controls [data-team="home"] [data-score-value]'
  );
  const awayValueEl = app.querySelector<HTMLElement>(
    '.admin-layout__score-controls [data-team="away"] [data-score-value]'
  );
  if (homeValueEl) {
    homeValueEl.textContent = homeValue;
  }
  if (awayValueEl) {
    awayValueEl.textContent = awayValue;
  }
  updateAdminLayoutOddsHighlight(matchId);
}

function updateAdminLayoutScoreValuesFromResult(match: Match): void {
  if (match.status !== "finished") {
    return;
  }
  const homeScore = match.home_score;
  const awayScore = match.away_score;
  if (homeScore === null || awayScore === null) {
    return;
  }
  const homeValueEl = app.querySelector<HTMLElement>(
    '.admin-layout__score-controls [data-team="home"] [data-score-value]'
  );
  const awayValueEl = app.querySelector<HTMLElement>(
    '.admin-layout__score-controls [data-team="away"] [data-score-value]'
  );
  if (homeValueEl) {
    homeValueEl.textContent = String(homeScore);
  }
  if (awayValueEl) {
    awayValueEl.textContent = String(awayScore);
  }
  updateAdminLayoutOddsHighlight(match.id);
}

function updateAdminLayoutOddsHighlight(matchId: number): void {
  const odds = app.querySelectorAll<HTMLElement>(".admin-layout__info-odd");
  if (!odds.length) {
    return;
  }

  const match = matchesById.get(matchId) ?? adminLayoutMatches[adminLayoutIndex] ?? null;
  if (!match) {
    odds.forEach((el) => el.classList.remove("is-highlighted"));
    return;
  }

  let homeScore: number | null = null;
  let awayScore: number | null = null;

  if (match.status === "finished" && match.home_score !== null && match.away_score !== null) {
    homeScore = match.home_score;
    awayScore = match.away_score;
  } else if (adminLayoutHasPrediction) {
    const cached = adminLayoutAverageCache.get(matchId);
    if (!cached || cached.count === 0) {
      odds.forEach((el) => el.classList.remove("is-highlighted"));
      return;
    }
    homeScore = cached.homeAvg;
    awayScore = cached.awayAvg;
  } else {
    const homeInput = app.querySelector<HTMLInputElement>(
      '.admin-layout__score-controls [data-team="home"] input[type="hidden"]'
    );
    const awayInput = app.querySelector<HTMLInputElement>(
      '.admin-layout__score-controls [data-team="away"] input[type="hidden"]'
    );
    homeScore = parseScore(homeInput?.value);
    awayScore = parseScore(awayInput?.value);
  }

  if (homeScore === null || awayScore === null) {
    odds.forEach((el) => el.classList.remove("is-highlighted"));
    return;
  }

  const choice = homeScore === awayScore ? "draw" : homeScore > awayScore ? "home" : "away";
  odds.forEach((el) => {
    el.classList.toggle("is-highlighted", el.dataset.adminLayoutOdd === choice);
  });
}

function storeAdminLayoutAverage(matchId: number, predictions: PredictionView[]): void {
  const { homeAvg, awayAvg } = getAveragePrediction(predictions);
  const count = predictions.length;
  adminLayoutAverageCache.set(matchId, { homeAvg, awayAvg, count });
  adminLayoutPredictionsCache.set(matchId, predictions);

  if (adminLayoutAverageMatchId !== matchId) {
    return;
  }

  const homeAverageEl = app.querySelector<HTMLElement>('[data-admin-layout-average="home"]');
  const awayAverageEl = app.querySelector<HTMLElement>('[data-admin-layout-average="away"]');
  if (!homeAverageEl || !awayAverageEl) {
    return;
  }

  homeAverageEl.textContent = count ? formatAverageValue(homeAvg) : "0";
  awayAverageEl.textContent = count ? formatAverageValue(awayAvg) : "0";
  
  // Перевіряємо, чи потрібно оновити відображення рахунку
  const match = matchesById.get(matchId);
  const isFinished = match?.status === "finished";
  const isStarted = match?.status === "started";
  const kickoffMs = match?.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
  const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && Date.now() >= kickoffMs;
  const isClosed = isFinished || isStarted || hasKickoffPassed;
  
  if (adminLayoutHasPrediction) {
    // Якщо є прогноз - використовуємо стандартну логіку
    updateAdminLayoutScoreValuesFromAverage(matchId);
  } else if (!isFinished && isClosed && count > 0) {
    // Якщо немає прогнозу і матч розпочався - показуємо середній рахунок замість "0:0"
    const homeValueEl = app.querySelector<HTMLElement>(
      '.admin-layout__score-controls [data-team="home"] [data-score-value]'
    );
    const awayValueEl = app.querySelector<HTMLElement>(
      '.admin-layout__score-controls [data-team="away"] [data-score-value]'
    );
    if (homeValueEl) {
      homeValueEl.textContent = formatAverageValue(homeAvg);
    }
    if (awayValueEl) {
      awayValueEl.textContent = formatAverageValue(awayAvg);
    }
    // Приховуємо середній рахунок знизу
    const averageBadges = app.querySelectorAll<HTMLElement>(".admin-layout__average-score");
    averageBadges.forEach((badge) => {
      badge.classList.add("is-hidden");
    });
  } else if (isFinished) {
    // Для завершених матчів завжди залишаємо середній рахунок у бейджах
    const averageBadges = app.querySelectorAll<HTMLElement>(".admin-layout__average-score");
    averageBadges.forEach((badge) => {
      badge.classList.remove("is-hidden");
    });
  }

  const shouldShowFactionAverage = Boolean(
    match?.status === "finished" ||
      match?.status === "started" ||
      (match?.kickoff_at && Date.now() >= new Date(match.kickoff_at).getTime()) ||
      match?.has_prediction
  );
  updateMatchFactionAverage(matchId, predictions, shouldShowFactionAverage);
}

function updateAdminLayoutAverage(matchId: number): void {
  const homeAverageEl = app.querySelector<HTMLElement>('[data-admin-layout-average="home"]');
  const awayAverageEl = app.querySelector<HTMLElement>('[data-admin-layout-average="away"]');
  if (!homeAverageEl || !awayAverageEl) {
    return;
  }

  adminLayoutAverageMatchId = matchId;
  const cached = adminLayoutAverageCache.get(matchId);
  if (cached) {
    homeAverageEl.textContent = cached.count ? formatAverageValue(cached.homeAvg) : "0";
    awayAverageEl.textContent = cached.count ? formatAverageValue(cached.awayAvg) : "0";
    updateAdminLayoutScoreValuesFromAverage(matchId);
    const match = matchesById.get(matchId);
    const cachedPredictions = adminLayoutPredictionsCache.get(matchId) ?? [];
    const shouldShowFactionAverage = Boolean(
      match?.status === "finished" ||
        match?.status === "started" ||
        (match?.kickoff_at && Date.now() >= new Date(match.kickoff_at).getTime()) ||
        match?.has_prediction
    );
    if (cachedPredictions.length || shouldShowFactionAverage) {
      updateMatchFactionAverage(matchId, cachedPredictions, shouldShowFactionAverage);
    }
    return;
  }

  homeAverageEl.textContent = "0";
  awayAverageEl.textContent = "0";

  if (!apiBase) {
    return;
  }

  void (async () => {
    try {
      const { response, data } = await fetchPredictions(apiBase, initData, matchId);
      if (!response.ok || !data.ok) {
        return;
      }
      storeAdminLayoutAverage(matchId, data.predictions);
    } catch {
      return;
    }
  })();
}

function updateMatchAverage(matchId: number, predictions: PredictionView[]): void {
  storeAdminLayoutAverage(matchId, predictions);
  const averageEl = app.querySelector<HTMLElement>(
    `[data-match-average][data-match-id="${matchId}"]`
  );
  if (!averageEl) {
    return;
  }

  if (!predictions.length) {
    averageEl.classList.remove("is-visible");
    averageEl.innerHTML = "";
    return;
  }

  const { homeAvg, awayAvg } = getAveragePrediction(predictions);
  averageEl.classList.add("is-visible");
  const match = matchesById.get(matchId);
  const { homeName, awayName, homeLogo, awayLogo } = match
    ? getMatchTeamInfo(match)
    : { homeName: "", awayName: "", homeLogo: null, awayLogo: null };
  const homeLogoMarkup = renderTeamLogo(homeName, homeLogo);
  const awayLogoMarkup = renderTeamLogo(awayName, awayLogo);
  averageEl.innerHTML = `
    <span class="match-average-label">Середній прогноз</span>
    <div class="match-average-line">
      ${homeLogoMarkup}
      <span class="match-average-score">${formatAverageValue(homeAvg)} : ${formatAverageValue(awayAvg)}</span>
      ${awayLogoMarkup}
    </div>
  `;
}

function resetMatchFactionAverage(container: HTMLElement): void {
  container.classList.remove("is-visible");
  container.innerHTML = "";
}

function showMatchFactionAverageStatus(matchId: number, message: string): void {
  const containers = app.querySelectorAll<HTMLElement>(
    `[data-match-faction-average][data-match-id="${matchId}"]`
  );
  if (!containers.length) {
    return;
  }
  const markup = `
    <p class="muted small">${escapeHtml(message)}</p>
  `;
  containers.forEach((container) => {
    container.classList.add("is-visible");
    container.innerHTML = markup;
  });
}

function updateMatchFactionAverage(
  matchId: number,
  predictions: PredictionView[],
  shouldShow: boolean
): void {
  const containers = app.querySelectorAll<HTMLElement>(
    `[data-match-faction-average][data-match-id="${matchId}"]`
  );
  if (!containers.length) {
    return;
  }
  if (!shouldShow) {
    containers.forEach((container) => resetMatchFactionAverage(container));
    return;
  }
  const slot = app.querySelector<HTMLElement>(`[data-prediction-slot][data-match-id="${matchId}"]`);
  if (slot) {
    slot.classList.add("is-hidden");
  }

  if (!predictions.length) {
    const emptyMarkup = `
      <p class="muted small">Поки що немає прогнозів.</p>
    `;
    containers.forEach((container) => {
      container.classList.add("is-visible");
      container.innerHTML = emptyMarkup;
    });
    return;
  }

  const factions = new Map<string, PredictionView[]>();
  predictions.forEach((prediction) => {
    const factionId = prediction.user?.faction_club_id ?? null;
    const normalized = factionId ? normalizeFactionSlug(factionId) : "unknown-faction";
    if (!factions.has(normalized)) {
      factions.set(normalized, []);
    }
    factions.get(normalized)!.push(prediction);
  });

  if (factions.size === 0) {
    resetMatchFactionAverage(container);
    return;
  }

  const match = matchesById.get(matchId);
  const hasFinalScore =
    match?.status === "finished" &&
    typeof match.home_score === "number" &&
    typeof match.away_score === "number";
  const finalHome = match?.home_score ?? null;
  const finalAway = match?.away_score ?? null;
  const rows = Array.from(factions.entries())
    .map(([factionId, factionPredictions]) => {
      const { homeAvg, awayAvg } = getAveragePrediction(factionPredictions);
      const roundedHome = Math.round(homeAvg);
      const roundedAway = Math.round(awayAvg);
      return {
        factionId,
        count: factionPredictions.length,
        homeAvg,
        awayAvg,
        roundedHome,
        roundedAway
      };
    })
    .sort((a, b) => {
      if (!hasFinalScore || finalHome === null || finalAway === null) {
        return b.count - a.count;
      }
      const exactA = a.roundedHome === finalHome && a.roundedAway === finalAway;
      const exactB = b.roundedHome === finalHome && b.roundedAway === finalAway;
      const outcomeA = Math.sign(a.roundedHome - a.roundedAway);
      const outcomeB = Math.sign(b.roundedHome - b.roundedAway);
      const outcomeFinal = Math.sign(finalHome - finalAway);
      const resultA = outcomeA === outcomeFinal;
      const resultB = outcomeB === outcomeFinal;
      const groupA = exactA ? 0 : resultA ? 1 : 2;
      const groupB = exactB ? 0 : resultB ? 1 : 2;
      if (groupA !== groupB) {
        return groupA - groupB;
      }
      const diffA = Math.abs(a.roundedHome - finalHome) + Math.abs(a.roundedAway - finalAway);
      const diffB = Math.abs(b.roundedHome - finalHome) + Math.abs(b.roundedAway - finalAway);
      if (diffA !== diffB) {
        return diffA - diffB;
      }
      return b.count - a.count;
    })
    .map((entry) => {
      const isUnknown = entry.factionId === "unknown-faction";
      const logoMarkup = isUnknown
        ? `<div class="match-faction-logo match-faction-logo--fallback"></div>`
        : renderFactionLogo(entry.factionId);
      return `
        <div class="match-faction-card" role="listitem">
          <div class="match-faction-card__logo">
            ${logoMarkup}
          </div>
          <div class="match-faction-card__meta">
            <div class="match-faction-score" role="group" aria-label="Середній прогноз фракції">
              <span class="match-faction-score-value">${formatAverageValueInteger(entry.homeAvg)}</span>
              <span class="match-faction-score-sep">:</span>
              <span class="match-faction-score-value">${formatAverageValueInteger(entry.awayAvg)}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  const markup = `
    <div class="match-faction-carousel" role="list">
      ${rows}
    </div>
  `;
  containers.forEach((container) => {
    container.classList.add("is-visible");
    container.innerHTML = markup;
  });
}

function applyAdminLayoutPredictionState(matchId: number, hasPrediction: boolean): void {
  const voteButton = app.querySelector<HTMLElement>(".admin-layout__vote-button");
  const probability = app.querySelector<HTMLElement>("[data-admin-layout-probability]");
  const averageBadges = app.querySelectorAll<HTMLElement>(".admin-layout__average-score");
  const scoreButtons = app.querySelectorAll<HTMLButtonElement>(".admin-layout__score-controls .score-btn");
  const scoreControls = app.querySelectorAll<HTMLElement>(".admin-layout__score-controls .score-control");
  const match = matchesById.get(matchId);
  const isFinished = match?.status === "finished";
  const isStarted = match?.status === "started";
  const kickoffMs = match?.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
  const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && Date.now() >= kickoffMs;
  const isClosed = isFinished || isStarted || hasKickoffPassed;
  const shouldHideVote = hasPrediction || isClosed;
  const shouldLockScores = hasPrediction || isClosed;
  const shouldShowAverageInsteadOfZero = !hasPrediction && isClosed;

  if (voteButton) {
    voteButton.classList.toggle("is-faded", shouldHideVote);
    voteButton.toggleAttribute("disabled", shouldHideVote);
  }
  if (probability) {
    probability.classList.toggle("is-hidden", shouldHideVote);
  }
  
  // Якщо немає прогнозу і матч розпочався - показуємо середній рахунок замість "0:0"
  if (shouldShowAverageInsteadOfZero && !isFinished) {
    const cached = adminLayoutAverageCache.get(matchId);
    if (cached && cached.count > 0) {
      const homeValueEl = app.querySelector<HTMLElement>(
        '.admin-layout__score-controls [data-team="home"] [data-score-value]'
      );
      const awayValueEl = app.querySelector<HTMLElement>(
        '.admin-layout__score-controls [data-team="away"] [data-score-value]'
      );
      if (homeValueEl) {
        homeValueEl.textContent = formatAverageValue(cached.homeAvg);
      }
      if (awayValueEl) {
        awayValueEl.textContent = formatAverageValue(cached.awayAvg);
      }
      // Приховуємо середній рахунок знизу, якщо він показаний вище
      averageBadges.forEach((badge) => {
        badge.classList.add("is-hidden");
      });
    } else {
      // Якщо немає середнього рахунку, залишаємо "0:0" і показуємо середній рахунок знизу
      averageBadges.forEach((badge) => {
        badge.classList.remove("is-hidden");
      });
    }
  } else {
    // Якщо є прогноз або матч ще не розпочався - показуємо середній рахунок знизу як завжди
    averageBadges.forEach((badge) => {
      badge.classList.toggle("is-faded", hasPrediction && !adminLayoutIsFinished);
      badge.classList.remove("is-hidden");
    });
  }
  
  scoreButtons.forEach((button) => {
    button.classList.toggle("is-hidden", shouldLockScores);
    button.disabled = shouldLockScores;
  });
  scoreControls.forEach((control) => {
    control.classList.toggle("is-locked", shouldLockScores);
  });

  if (hasPrediction) {
    updateAdminLayoutScoreValuesFromAverage(matchId);
  }
}

function setupAdminLayoutVoteButton(matchId: number): void {
  const button = app.querySelector<HTMLButtonElement>("[data-admin-layout-vote]");
  if (!button) {
    return;
  }

  adminLayoutVoteMatchId = matchId;
  button.dataset.matchId = String(matchId);
  if (button.dataset.bound === "true") {
    return;
  }
  button.dataset.bound = "true";

  button.addEventListener("click", async () => {
    if (!apiBase || adminLayoutHasPrediction) {
      return;
    }
    const matchIdRaw = button.dataset.matchId || "";
    const resolvedMatchId = Number.parseInt(matchIdRaw, 10);
    if (!Number.isFinite(resolvedMatchId)) {
      return;
    }
    const match = matchesById.get(resolvedMatchId);
    if (match) {
      const isFinished = match.status === "finished";
      const isStarted = match.status === "started";
      const kickoffMs = match.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
      const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && Date.now() >= kickoffMs;
      if (isFinished || isStarted || hasKickoffPassed) {
        return;
      }
    }

    const homeControl = app.querySelector<HTMLElement>(
      '.admin-layout__score-controls [data-team="home"] input[type="hidden"]'
    );
    const awayControl = app.querySelector<HTMLElement>(
      '.admin-layout__score-controls [data-team="away"] input[type="hidden"]'
    );
    const home = parseScore((homeControl as HTMLInputElement | null)?.value);
    const away = parseScore((awayControl as HTMLInputElement | null)?.value);
    if (home === null || away === null) {
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`ВАШ ПРОГНОЗ — ${home}:${away}`)
    ) {
      return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Збереження...";

    try {
      const { response, data } = await postPrediction(apiBase, {
        initData,
        match_id: resolvedMatchId,
        home_pred: home,
        away_pred: away
      });
      if (!response.ok || !data.ok) {
        button.textContent = getPredictionError(data.error);
        button.disabled = false;
        return;
      }

      const match = matchesById.get(resolvedMatchId);
      if (match) {
        match.has_prediction = true;
      }
      adminLayoutHasPrediction = true;
      // Очищаємо кеш середнього рахунку, щоб отримати оновлені дані з новим голосом
      adminLayoutAverageCache.delete(resolvedMatchId);
      updateAdminLayoutAverage(resolvedMatchId);
      applyAdminLayoutPredictionState(resolvedMatchId, true);
      button.textContent = originalText ?? "Проголосувати";
    } catch {
      button.textContent = "Не вдалося зберегти прогноз.";
      button.disabled = false;
    } finally {
      if (!adminLayoutHasPrediction) {
        button.textContent = originalText;
      }
    }
  });
}

function renderPredictionRows(self: PredictionView | null, others: PredictionView[]): string {
  const rows: string[] = [];

  if (self) {
    const name = formatPredictionName(self.user);
    rows.push(`
      <div class="prediction-row self">
        <span class="prediction-name">${escapeHtml(name)}</span>
        <span class="prediction-score">${self.home_pred}:${self.away_pred}</span>
      </div>
    `);
  }

  if (others.length) {
    rows.push(
      others
        .map((item) => {
          const name = formatPredictionName(item.user);
          return `
            <div class="prediction-row">
              <span class="prediction-name">${escapeHtml(name)}</span>
              <span class="prediction-score">${item.home_pred}:${item.away_pred}</span>
            </div>
          `;
        })
        .join("")
    );
  }

  if (!rows.length) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }

  return rows.join("");
}

function getTopPredictions(predictions: PredictionView[], limit: number): PredictionView[] {
  return [...predictions]
    .sort((a, b) => {
      const pointsDiff = getUserPointsTotal(b.user) - getUserPointsTotal(a.user);
      if (pointsDiff !== 0) {
        return pointsDiff;
      }
      return a.user_id - b.user_id;
    })
    .slice(0, limit);
}

function getUserPointsTotal(user: PredictionUser | null): number {
  return typeof user?.points_total === "number" ? user.points_total : 0;
}

function updateAdminLayoutView(): void {
  const homeSlot = app.querySelector<HTMLElement>("[data-admin-layout-home]");
  const awaySlot = app.querySelector<HTMLElement>("[data-admin-layout-away]");
  const pagination = app.querySelector<HTMLElement>("[data-admin-layout-pagination]");
  const countdown = app.querySelector<HTMLElement>("[data-admin-layout-countdown]");
  const probability = app.querySelector<HTMLElement>("[data-admin-layout-probability]");
  const tournamentEl = app.querySelector<HTMLElement>("[data-admin-layout-tournament]");
  const stageEl = app.querySelector<HTMLElement>("[data-admin-layout-stage]");
  const oddHomeEl = app.querySelector<HTMLElement>("[data-admin-layout-odd='home']");
  const oddDrawEl = app.querySelector<HTMLElement>("[data-admin-layout-odd='draw']");
  const oddAwayEl = app.querySelector<HTMLElement>("[data-admin-layout-odd='away']");
  const oddsBlock = app.querySelector<HTMLElement>(".admin-layout__info-odds");
  const prevButton = app.querySelector<HTMLButtonElement>("[data-admin-layout-prev]");
  const nextButton = app.querySelector<HTMLButtonElement>("[data-admin-layout-next]");
  const noVotingEl = app.querySelector<HTMLElement>("[data-admin-layout-no-voting]");
  const adminLayout = app.querySelector<HTMLElement>(".admin-layout");
  const factionAverageEl = app.querySelector<HTMLElement>("[data-admin-layout-faction-average]");
  if (
    !homeSlot ||
    !awaySlot ||
    !pagination ||
    !countdown ||
    !probability ||
    !tournamentEl ||
    !stageEl ||
    !oddHomeEl ||
    !oddDrawEl ||
    !oddAwayEl ||
    !oddsBlock ||
    !prevButton ||
    !nextButton ||
    !noVotingEl ||
    !adminLayout ||
    !factionAverageEl
  ) {
    return;
  }

  const total = adminLayoutMatches.length;
  
  // Показуємо "ГОЛОСУВАННЯ ВІДСУТНЄ" тільки коли немає матчів взагалі
  adminLayout.classList.toggle("has-no-voting", total === 0);
  
  if (total === 0) {
    homeSlot.innerHTML = `<div class="admin-layout__logo-placeholder" aria-hidden="true"></div>`;
    awaySlot.innerHTML = `<div class="admin-layout__logo-placeholder" aria-hidden="true"></div>`;
    factionAverageEl.classList.remove("is-visible");
    factionAverageEl.innerHTML = "";
    pagination.innerHTML = "";
    countdown.textContent = "початок матчу через --:--:--";
    countdown.classList.remove("is-closed");
    probability.textContent = "";
    probability.classList.add("is-hidden");
    tournamentEl.textContent = "—";
    stageEl.textContent = "—";
    oddHomeEl.textContent = "—";
    oddDrawEl.textContent = "—";
    oddAwayEl.textContent = "—";
    oddsBlock.classList.add("is-empty");
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  const match = adminLayoutMatches[adminLayoutIndex] ?? adminLayoutMatches[0];
  adminLayoutHasPrediction = Boolean(match.has_prediction);
  adminLayoutIsFinished = match.status === "finished";
  factionAverageEl.dataset.matchId = String(match.id);
  factionAverageEl.classList.remove("is-visible");
  factionAverageEl.innerHTML = "";
  const { homeName, awayName, homeLogo, awayLogo, homeSlug, awaySlug } = getMatchTeamInfo(match);
  const tournamentName = match.tournament_name?.trim() ?? "";
  const tournamentStage = match.tournament_stage ? formatTournamentStageAdmin(match.tournament_stage) : "";
  const matchOdds = getMatchWinnerProbabilities(match, homeName, awayName);
  const renderScoreControls = (team: "home" | "away"): string => `
    <div class="score-controls admin-layout__score-controls">
      <div class="score-control" data-score-control data-team="${team}">
        <button class="score-btn" type="button" data-score-dec aria-label="minus">-</button>
        <div class="score-value score-center" data-score-value>0</div>
        <button class="score-btn" type="button" data-score-inc aria-label="plus">+</button>
        <input type="hidden" name="${team === "home" ? "home_pred" : "away_pred"}" value="0" />
      </div>
    </div>
    <div class="admin-layout__average-score" data-admin-layout-average="${team}">0</div>
  `;
  homeSlot.innerHTML = `
    <div class="admin-layout__logo-frame">
      ${renderTeamLogo(homeName, homeLogo)}
      ${renderScoreControls("home")}
    </div>
  `;
  awaySlot.innerHTML = `
    <div class="admin-layout__logo-frame">
      ${renderTeamLogo(awayName, awayLogo)}
      ${renderScoreControls("away")}
    </div>
  `;
  attachTeamGraphTrigger(homeSlot, homeSlug, homeName);
  attachTeamGraphTrigger(awaySlot, awaySlug, awayName);
  updateAdminLayoutAverage(match.id);
  applyAdminLayoutPredictionState(match.id, adminLayoutHasPrediction);
  updateAdminLayoutScoreValuesFromResult(match);
  updateAdminLayoutOddsHighlight(match.id);
  setupAdminLayoutVoteButton(match.id);
  setupAdminLayoutScoreControls(match.id);
  updateAdminLayoutCountdown();
  pagination.innerHTML = adminLayoutMatches
    .map((_, index) => {
      const isActive = index === adminLayoutIndex;
      return `<span class="admin-layout__dot${isActive ? " is-active" : ""}"></span>`;
    })
    .join("");
  tournamentEl.textContent = tournamentName || "—";
  stageEl.textContent = tournamentStage || "—";
  tournamentEl.classList.toggle("is-hidden", !tournamentName);
  stageEl.classList.toggle("is-hidden", !tournamentStage);
  oddHomeEl.textContent = matchOdds ? formatProbability(matchOdds.home) : "—";
  oddDrawEl.textContent = matchOdds ? formatProbability(matchOdds.draw) : "—";
  oddAwayEl.textContent = matchOdds ? formatProbability(matchOdds.away) : "—";
  oddsBlock.classList.toggle("is-empty", !matchOdds);
  prevButton.disabled = total < 2;
  nextButton.disabled = total < 2;
}

function setupAdminLayoutScoreControls(matchId: number): void {
  const controls = app.querySelectorAll<HTMLElement>(".admin-layout__score-controls [data-score-control]");
  if (!controls.length) {
    return;
  }

  const probability = app.querySelector<HTMLElement>("[data-admin-layout-probability]");
  if (!probability) {
    return;
  }

  const getScoreValue = (team: "home" | "away"): number | null => {
    const control = app.querySelector<HTMLElement>(`.admin-layout__score-controls [data-team="${team}"]`);
    if (!control) {
      return null;
    }
    const input = control.querySelector<HTMLInputElement>("input[type=hidden]");
    return parseScore(input?.value);
  };

  const updateProbability = (): void => {
    const match = matchesById.get(matchId);
    const homeScore = getScoreValue("home");
    const awayScore = getScoreValue("away");
    if (!match || homeScore === null || awayScore === null) {
      probability.textContent = "";
      probability.classList.add("is-empty");
      return;
    }

    probability.classList.remove("is-empty");
    if (!match.odds_json) {
      probability.textContent = `ймовірність рахунку ${homeScore}:${awayScore} — 3%`;
      probability.classList.add("is-empty");
      return;
    }
    const probabilityValue = extractCorrectScoreProbability(match.odds_json, homeScore, awayScore);
    if (probabilityValue === null) {
      probability.textContent = `ймовірність рахунку ${homeScore}:${awayScore} — 3%`;
      probability.classList.add("is-empty");
      return;
    }

    probability.textContent = `ймовірність рахунку ${homeScore}:${awayScore} — ${formatProbability(
      probabilityValue
    )}`;
  };

  controls.forEach((control) => {
    const input = control.querySelector<HTMLInputElement>("input[type=hidden]");
    const valueEl = control.querySelector<HTMLElement>("[data-score-value]");
    const inc = control.querySelector<HTMLButtonElement>("[data-score-inc]");
    const dec = control.querySelector<HTMLButtonElement>("[data-score-dec]");
    if (!input || !valueEl || !inc || !dec) {
      return;
    }

    const update = (nextValue: number) => {
      const safeValue = Math.max(0, Math.min(20, nextValue));
      input.value = String(safeValue);
      valueEl.textContent = String(safeValue);
      updateProbability();
      updateAdminLayoutOddsHighlight(matchId);
    };

    inc.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = parseScore(input.value) ?? 0;
      update(current + 1);
    });

    dec.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = parseScore(input.value) ?? 0;
      update(current - 1);
    });
  });

  updateProbability();
}

function attachTeamGraphTrigger(slot: HTMLElement, teamSlug: string | null, teamName: string): void {
  const frame = slot.querySelector<HTMLElement>(".admin-layout__logo-frame");
  if (!frame) {
    return;
  }
  frame.dataset.teamSlug = teamSlug ?? "";
  frame.dataset.teamName = teamName;
  
  // Обробник кліку тільки на логотипі команди
  const logo = frame.querySelector<HTMLElement>(".match-logo, .match-logo-fallback");
  if (logo) {
    logo.addEventListener("click", () => {
      void openTeamGraphPopup(teamSlug, teamName);
    });
  }
  
  // Зупиняємо спливання подій від контролерів рахунку
  const scoreControls = frame.querySelector<HTMLElement>(".admin-layout__score-controls");
  if (scoreControls) {
    scoreControls.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }
}

async function openTeamGraphPopup(teamSlug: string | null, teamName: string): Promise<void> {
  ensureTeamGraphPopup();
  if (!teamGraphPopup || !teamGraphBodyEl || !teamGraphTitleEl) {
    return;
  }
  const slug = teamSlug ?? normalizeTeamSlugValue(teamName) ?? teamName.toLowerCase();
  
  try {
    const stats = await loadTeamGraphStats(slug);
    // Перевіряємо, чи є хоча б 5 матчів перед відкриттям попапу
    if (!stats || stats.length < 5) {
      return;
    }
    
    teamGraphTitleEl.textContent = `ІСТОРІЯ ${teamName.toUpperCase()}`;
    teamGraphBodyEl.innerHTML = renderTeamMatchStatsList(stats, slug);
    teamGraphPopup.classList.remove("is-hidden");
    document.body.classList.add("admin-layout-popup-open");
    teamGraphPopup.focus();
  } catch {
    // У разі помилки не відкриваємо попап
    return;
  }
}

function closeTeamGraphPopup(): void {
  if (!teamGraphPopup) {
    return;
  }
  teamGraphPopup.classList.add("is-hidden");
  document.body.classList.remove("admin-layout-popup-open");
}

function ensureTeamGraphPopup(): void {
  if (teamGraphPopup) {
    return;
  }
  const popup = document.createElement("div");
  popup.className = "admin-layout__team-graph-popup is-hidden";
  popup.tabIndex = -1;
  popup.innerHTML = `
    <div class="admin-layout__team-graph-backdrop" data-team-graph-close></div>
    <div class="admin-layout__team-graph-panel" role="dialog" aria-modal="true">
      <div class="admin-layout__team-graph-header">
        <span data-team-graph-title></span>
        <button class="team-graph-close" type="button" data-team-graph-close aria-label="Закрити">×</button>
      </div>
      <div class="admin-layout__team-graph-body" data-team-graph-body></div>
    </div>
  `;
  document.body.appendChild(popup);
  teamGraphPopup = popup;
  teamGraphBodyEl = popup.querySelector<HTMLElement>("[data-team-graph-body]");
  teamGraphTitleEl = popup.querySelector<HTMLElement>("[data-team-graph-title]");
  popup.querySelectorAll<HTMLElement>("[data-team-graph-close]").forEach((el) => {
    el.addEventListener("click", closeTeamGraphPopup);
  });
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeTeamGraphPopup();
    }
  });
}

async function loadTeamGraphStats(teamSlug: string): Promise<TeamMatchStat[] | null> {
  if (import.meta.env.DEV && DEV_BYPASS) {
    return getDevTeamGraphStats(teamSlug);
  }
  if (!apiBase || !initData) {
    return null;
  }
  return fetchAnalitikaTeam(teamSlug);
}

function getDevTeamGraphStats(teamSlug: string): TeamMatchStat[] {
  const now = Date.now();
  return Array.from({ length: 5 }, (_, index) => {
    const daysAgo = index * 3;
    return {
      id: `${teamSlug}-${index}`,
      team_name: teamSlug,
      opponent_name: `Команда ${index + 1}`,
      match_date: new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
      is_home: index % 2 === 0,
      team_goals: Math.floor(Math.random() * 4),
      opponent_goals: Math.floor(Math.random() * 4),
      avg_rating: (6 + index * 0.3).toFixed(1)
    };
  });
}

function shiftAdminLayoutMatch(delta: number): void {
  if (adminLayoutMatches.length < 2) {
    return;
  }
  const total = adminLayoutMatches.length;
  adminLayoutIndex = (adminLayoutIndex + delta + total) % total;
  updateAdminLayoutView();
}

function getAveragePrediction(predictions: PredictionView[]): { homeAvg: number; awayAvg: number } {
  const total = predictions.reduce(
    (acc, item) => {
      acc.home += item.home_pred;
      acc.away += item.away_pred;
      return acc;
    },
    { home: 0, away: 0 }
  );

  const count = predictions.length || 1;
  return {
    homeAvg: total.home / count,
    awayAvg: total.away / count
  };
}

function renderFactionLogo(factionId: string): string {
  const league = findClubLeague(factionId);
  if (!league) {
    return `<div class="match-faction-logo match-faction-logo--fallback"></div>`;
  }
  const logo = getClubLogoPath(league, factionId);
  if (!logo) {
    return `<div class="match-faction-logo match-faction-logo--fallback"></div>`;
  }
  return `<img class="match-faction-logo" src="${escapeAttribute(logo)}" alt="${escapeAttribute(
    formatClubName(factionId)
  )}" />`;
}

function formatAverageValue(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

function formatAverageValueInteger(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

function getPredictionError(error: string | undefined): string {
  switch (error) {
    case "prediction_closed":
      return "Прийом прогнозів закрито.";
    case "match_finished":
      return "Матч завершено.";
    case "match_not_ready":
      return "Матч ще не підтверджено.";
    case "match_not_found":
      return "Матч не знайдено.";
    case "already_predicted":
      return "Ви вже зробили прогноз.";
    default:
      return "Не вдалося зберегти прогноз.";
  }
}

function getConfirmMatchError(error: string | undefined): string {
  switch (error) {
    case "match_not_pending":
      return "Матч вже підтверджено.";
    case "match_not_found":
      return "Матч не знайдено.";
    case "bad_match_id":
      return "Невірний матч.";
    case "forbidden":
      return "Недостатньо прав.";
    default:
      return "Не вдалося підтвердити матч.";
  }
}

function formatTournamentStageAdmin(stage: string): string {
  const trimmed = stage.trim();
  if (!trimmed) {
    return "";
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("quarter-final")) {
    return "ЧВЕРТЬФІНАЛ";
  }
  if (lower.includes("semi-final")) {
    return "ПІВФІНАЛ";
  }
  if (lower.includes("final")) {
    return "ФІНАЛ";
  }
  if (lower.includes("1/8")) {
    return "1/8 ФІНАЛУ";
  }
  if (lower.includes("1/4")) {
    return "1/4 ФІНАЛУ";
  }
  if (lower.includes("1/2")) {
    return "1/2 ФІНАЛУ";
  }
  const roundOfMatch = lower.match(/round\s+of\s+(\d+)/);
  if (roundOfMatch) {
    const roundNumber = Number.parseInt(roundOfMatch[1], 10);
    if (roundNumber === 16) {
      return "1/8 ФІНАЛУ";
    }
    if (roundNumber === 8) {
      return "1/4 ФІНАЛУ";
    }
    if (roundNumber === 4) {
      return "ПІВФІНАЛ";
    }
    if (roundNumber === 2) {
      return "ФІНАЛ";
    }
    if (roundNumber === 32) {
      return "1/16 ФІНАЛУ";
    }
  }
  const regularMatch = lower.match(/regular\s+season\s*-\s*(\d+)/);
  if (regularMatch) {
    return `${regularMatch[1]} РАУНД`;
  }
  return trimmed;
}

function updateScoreOddsIndicator(form: HTMLFormElement): void {
  const label = form.querySelector<HTMLElement>("[data-match-odds-score]");
  if (!label) {
    return;
  }

  const matchIdRaw = form.dataset.matchId || "";
  const matchId = Number.parseInt(matchIdRaw, 10);
  if (!Number.isFinite(matchId)) {
    label.textContent = "";
    label.classList.add("is-hidden");
    return;
  }

  const match = matchesById.get(matchId);
  if (!match || !match.odds_json) {
    label.textContent = "";
    label.classList.add("is-hidden");
    return;
  }

  const homeScore = parseScore(form.querySelector<HTMLInputElement>("input[name=home_pred]")?.value);
  const awayScore = parseScore(form.querySelector<HTMLInputElement>("input[name=away_pred]")?.value);
  if (homeScore === null || awayScore === null) {
    label.textContent = "";
    label.classList.add("is-hidden");
    return;
  }

  updateOddsHighlight(matchId, homeScore, awayScore);

  const probability = extractCorrectScoreProbability(match.odds_json, homeScore, awayScore);
  if (probability === null) {
    label.textContent = `ймовірність рахунку ${homeScore}:${awayScore} —`;
    label.classList.remove("is-hidden");
    return;
  }

  label.textContent = `ймовірність рахунку ${homeScore}:${awayScore} — ${formatProbability(probability)}`;
  label.classList.remove("is-hidden");
}

function updateOddsHighlight(matchId: number, homeScore: number, awayScore: number): void {
  const odds = app.querySelector<HTMLElement>(`[data-match-odds][data-match-id="${matchId}"]`);
  if (!odds) {
    return;
  }
  const choice = homeScore === awayScore ? "draw" : homeScore > awayScore ? "home" : "away";
  odds.querySelectorAll<HTMLElement>("[data-odds-choice]").forEach((el) => {
    el.classList.toggle("is-highlighted", el.dataset.oddsChoice === choice);
  });
}

function updateAdminLayoutCountdown(): void {
  const countdown = app.querySelector<HTMLElement>("[data-admin-layout-countdown]");
  if (!countdown) {
    return;
  }

  const match = adminLayoutMatches[adminLayoutIndex] ?? adminLayoutMatches[0];
  if (!match) {
    countdown.textContent = "початок матчу через --:--:--";
    countdown.classList.remove("is-closed");
    return;
  }

  const kickoffMs = new Date(match.kickoff_at).getTime();
  if (Number.isNaN(kickoffMs)) {
    countdown.textContent = "початок матчу через --:--:--";
    countdown.classList.remove("is-closed");
    return;
  }

  if (match.status === "finished") {
    countdown.textContent = "МАТЧ ЗАВЕРШЕНО";
    countdown.classList.add("is-closed");
    return;
  }

  const remaining = kickoffMs - Date.now();
  if (remaining <= 0) {
    countdown.textContent = "Матч розпочався.";
    countdown.classList.add("is-closed");
    return;
  }

  countdown.classList.remove("is-closed");
  countdown.textContent = `початок матчу через ${formatCountdown(remaining)}`;
}

function updatePredictionCountdowns(): void {
  const elements = app.querySelectorAll<HTMLElement>("[data-prediction-countdown]");
  const hasPredictionCountdowns = elements.length > 0;
  const hasAdminCountdown = Boolean(app.querySelector("[data-admin-layout-countdown]"));
  if (!hasPredictionCountdowns && !hasAdminCountdown) {
    return;
  }

  if (hasPredictionCountdowns) {
    const now = Date.now();
    elements.forEach((el) => {
      const matchId = Number.parseInt(el.dataset.matchId || "", 10);
      if (!Number.isFinite(matchId)) {
        el.textContent = "";
        return;
      }
      const match = matchesById.get(matchId);
      if (!match) {
        el.textContent = "";
        return;
      }

      const closeAtMs = getMatchPredictionCloseAtMs(match);
      if (closeAtMs === null) {
        el.textContent = "закриття прогнозу через --:--";
        return;
      }

      const remaining = closeAtMs - now;
      if (remaining <= 0) {
        el.textContent = "Прогнози закрито.";
        el.classList.add("is-closed");
        const form = app.querySelector<HTMLFormElement>(`[data-prediction-form][data-match-id="${matchId}"]`);
        if (form) {
          form.classList.add("is-closed");
          form.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
            button.disabled = true;
          });
          const status = form.querySelector<HTMLElement>("[data-prediction-status]");
          if (status) {
            status.textContent = "Прогнози закрито.";
          }
        }
        return;
      }

      el.classList.remove("is-closed");
      el.textContent = `закриття прогнозу через ${formatCountdown(remaining)}`;
    });
  }

  if (hasAdminCountdown) {
    updateAdminLayoutCountdown();
  }
}

function startPredictionCountdowns(): void {
  if (predictionCountdownId !== null) {
    window.clearInterval(predictionCountdownId);
    predictionCountdownId = null;
  }

  updatePredictionCountdowns();
  predictionCountdownId = window.setInterval(updatePredictionCountdowns, 1000);
}

function parseScore(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseRating(value?: string): number | null {
  if (!value) {
    return null;
  }
  const sanitized = value.replace(",", ".");
  const parsed = Number(sanitized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 10) {
    return null;
  }
  return parsed;
}

async function loadLeaderboard(): Promise<void> {
  if (!apiBase) {
    return;
  }

  const container = app.querySelector<HTMLElement>("[data-leaderboard-list]");
  if (!container) {
    return;
  }

  if (leaderboardLoaded) {
    container.classList.add("is-open");
    return;
  }

  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const { response, data } = await fetchLeaderboard(apiBase, initData);
    if (!response.ok || !data.ok) {
      renderUsersError(container);
      return;
    }

    container.innerHTML = renderLeaderboardList(data.users, {
      currentUserId,
      startingPoints: STARTING_POINTS,
      primaryFactionLogo: getPrimaryFactionLogo(currentProfileStats),
      primaryFactionId: getPrimaryFactionIdFromProfile(currentProfileStats)
    });
    updateFactionRankCache(data.users, STARTING_POINTS);
    leaderboardLoaded = true;
  } catch {
    renderUsersError(container);
  }
}
