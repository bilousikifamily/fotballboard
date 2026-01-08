import "./style.css";
import { ALL_CLUBS, EU_CLUBS, UA_CLUBS, type LeagueId, type MatchLeagueId } from "./data/clubs";

type AuthResponse =
  | {
      ok: true;
      user?: TelegramWebAppUser;
      admin?: boolean;
      points_total?: number;
      rank?: number | null;
      onboarding?: OnboardingInfo | null;
    }
  | { ok: false; error: string };

type LeaderboardResponse =
  | { ok: true; users: LeaderboardUser[] }
  | { ok: false; error: string };

type MatchesResponse =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

type PredictionResponse =
  | { ok: true; prediction: unknown }
  | { ok: false; error: string };

type PredictionsResponse =
  | { ok: true; predictions: PredictionView[] }
  | { ok: false; error: string };

type MatchWeatherResponse =
  | {
      ok: true;
      rain_probability: number | null;
      weather_condition?: string | null;
      weather_temp_c?: number | null;
      weather_timezone?: string | null;
    }
  | { ok: false; error: string };

type MatchWeatherDebugInfo = {
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

type MatchWeatherDebugResponse =
  | { ok: true; rain_probability: number | null; debug?: MatchWeatherDebugInfo }
  | { ok: false; error: string; debug?: MatchWeatherDebugInfo };

type CreateMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

type ResultResponse =
  | { ok: true }
  | { ok: false; error: string };

type AnnouncementResponse =
  | { ok: true }
  | { ok: false; error: string };

type OddsRefreshResponse =
  | { ok: true; debug?: OddsRefreshDebug }
  | { ok: false; error: string; detail?: string; debug?: OddsRefreshDebug };

type OddsRefreshDebug = {
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
  headtoheadSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueFixturesCount?: number;
  leagueFixturesSource?: "date" | "range" | "none" | "headtohead";
  leagueFixturesSample?: Array<{ id?: number; home?: string; away?: string; homeId?: number; awayId?: number }>;
  leagueDateStatus?: number;
  leagueRangeStatus?: number;
  fixtureId?: number | null;
  fallbackReason?: string;
};

type LeaderboardUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  points_total?: number | null;
  updated_at?: string | null;
};

type Match = {
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
  rain_probability?: number | null;
  weather_fetched_at?: string | null;
  weather_condition?: string | null;
  weather_temp_c?: number | null;
  weather_timezone?: string | null;
  odds_json?: unknown | null;
  odds_fetched_at?: string | null;
  has_prediction?: boolean;
};

type PredictionUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
  points_total?: number | null;
};

type PredictionView = {
  id: number;
  user_id: number;
  home_pred: number;
  away_pred: number;
  points: number;
  user: PredictionUser | null;
};

type UserStats = {
  rank: number | null;
  points: number;
};

type OnboardingInfo = {
  classico_choice?: string | null;
  ua_club_id?: string | null;
  eu_club_id?: string | null;
  nickname?: string | null;
  avatar_choice?: string | null;
  logo_order?: string[] | null;
  completed?: boolean;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

const INTRO_SEEN_KEY = "intro_seen";
const INTRO_TIMEOUT_MS = 900;
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
let currentLogoOrder: string[] | null = null;
let currentLogoOptions: AvatarOption[] = [];
let currentOnboarding: OnboardingInfo | null = null;
let noticeRuleIndex = 0;
const predictionsLoaded = new Set<number>();
const matchesById = new Map<number, Match>();
const matchWeatherCache = new Map<number, number | null>();
const matchWeatherConditionCache = new Map<number, string | null>();
const matchWeatherTempCache = new Map<number, number | null>();
const matchWeatherTimezoneCache = new Map<number, string | null>();
const WEATHER_CLIENT_CACHE_MIN = 60;
const TOP_PREDICTIONS_LIMIT = 4;
const LOGO_POSITIONS = ["center", "left", "right"] as const;
type LogoPosition = typeof LOGO_POSITIONS[number];
const LOGO_POSITION_LABELS: Record<LogoPosition, string> = {
  center: "1",
  left: "2",
  right: "3"
};

const EUROPEAN_LEAGUES: Array<{ id: LeagueId; label: string; flag: string }> = [
  { id: "english-premier-league", label: "АПЛ", flag: "🇬🇧" },
  { id: "la-liga", label: "Ла Ліга", flag: "🇪🇸" },
  { id: "serie-a", label: "Серія A", flag: "🇮🇹" },
  { id: "bundesliga", label: "Бундесліга", flag: "🇩🇪" },
  { id: "ligue-1", label: "Ліга 1", flag: "🇫🇷" }
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

function isAllLeagueId(value: MatchLeagueId): value is AllLeagueId {
  return (
    value === "ukrainian-premier-league" ||
    value === "english-premier-league" ||
    value === "la-liga" ||
    value === "serie-a" ||
    value === "bundesliga" ||
    value === "ligue-1"
  );
}

function resolveLogoLeagueId(leagueId: MatchLeagueId | null): AllLeagueId | null {
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

const NOTICE_RULES = [
  "Прогнози приймаються\nза 60 хв до старту матча",
  "Вгаданий результат +1 бал",
  "Вгаданий рахунок +5 балів",
  "Не вгаданий результат -1 бал"
];

const tg = window.Telegram?.WebApp;
if (tg?.ready) {
  tg.ready();
  if (tg.expand) {
    tg.expand();
  }
}

const initData = tg?.initData || "";
if (!initData) {
  renderMessage("Open in Telegram");
} else {
  void bootstrap(initData);
}

function mountIntro(): void {
  document.body.classList.add("intro-active");
  introOverlay = document.createElement("div");
  introOverlay.className = "intro-overlay";
  introOverlay.innerHTML = `
    <div class="intro-content">
      <video autoplay muted playsinline preload="auto" poster="/poster.jpg">
        <source src="/preloader.webm" type="video/webm" />
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

async function bootstrap(data: string): Promise<void> {
  renderLoading();

  apiBase = import.meta.env.VITE_API_BASE || "";

  try {
    const response = await fetch(`${apiBase}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: data })
    });

    const payload = (await response.json()) as AuthResponse;
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
    currentLogoOrder = onboarding.logo_order ?? null;

    if (!onboarding.completed) {
      renderOnboarding(payload.user, stats, onboarding);
      return;
    }

    renderUser(payload.user, stats, isAdmin, currentDate, currentNickname);
    await loadMatches(currentDate);
  } catch {
    renderMessage("Network error", "Check your connection and try again.");
  }
}

function renderLoading(): void {
  app.innerHTML = `
    <main class="card">
      <div class="spinner"></div>
      <p class="muted">Loading...</p>
    </main>
  `;
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
  const detectedEuLeague = onboarding.eu_club_id
    ? findEuropeanClubLeague(onboarding.eu_club_id)
    : null;
  const initialEuLeague = detectedEuLeague ?? ("english-premier-league" as LeagueId);
  const state = {
    step: 1,
    classicoChoice:
      onboarding.classico_choice === "real_madrid" || onboarding.classico_choice === "barcelona"
        ? onboarding.classico_choice
        : null,
    uaClubId: onboarding.ua_club_id ?? null,
    euClubId: onboarding.eu_club_id ?? null,
    euLeague: initialEuLeague,
    euClubLeague: detectedEuLeague,
    nickname: onboarding.nickname ?? ""
  };

  const renderStep = (statusMessage = ""): void => {
    const stepTitle = `Крок ${state.step} з 4`;
    const headerTitle = getOnboardingTitle(state.step);
    const header = `
      <div class="onboarding-header">
        <span class="onboarding-step">${stepTitle}</span>
        <h1>${escapeHtml(headerTitle)}</h1>
      </div>
    `;

    let body = "";
    if (state.step === 1) {
      body = `
        <div class="logo-grid">
          ${renderClubChoice({
            id: "real_madrid",
            name: "Реал Мадрид",
            logo: getClubLogoPath("la-liga", "real-madrid"),
            selected: state.classicoChoice === "real_madrid",
            dataAttr: "data-classico-choice"
          })}
          ${renderClubChoice({
            id: "barcelona",
            name: "Барселона",
            logo: getClubLogoPath("la-liga", "barcelona"),
            selected: state.classicoChoice === "barcelona",
            dataAttr: "data-classico-choice"
          })}
        </div>
        <button class="button secondary" type="button" data-classico-skip>Пропустити</button>
      `;
    } else if (state.step === 2) {
      body = `
        <div class="logo-grid">
          ${UA_CLUBS.map((clubId) =>
            renderClubChoice({
              id: clubId,
              name: formatClubName(clubId),
              logo: getClubLogoPath("ukrainian-premier-league", clubId),
              selected: state.uaClubId === clubId,
              dataAttr: "data-ua-choice"
            })
          ).join("")}
        </div>
        <button class="button secondary" type="button" data-ua-skip>Пропустити</button>
      `;
    } else if (state.step === 3) {
      const leagueTabs = EUROPEAN_LEAGUES.map((league) => {
        const isActive = league.id === state.euLeague;
        return `
          <button class="flag-button ${isActive ? "is-active" : ""}" type="button" data-eu-league="${
            league.id
          }">
            <span class="flag-icon">${league.flag}</span>
            <span>${escapeHtml(league.label)}</span>
          </button>
        `;
      }).join("");

      body = `
        <div class="league-tabs">${leagueTabs}</div>
        <div class="logo-grid">
          ${EU_CLUBS[state.euLeague].map((clubId) =>
            renderClubChoice({
              id: clubId,
              name: formatClubName(clubId),
              logo: getClubLogoPath(state.euLeague, clubId),
              selected: state.euClubId === clubId,
              dataAttr: "data-eu-choice"
            })
          ).join("")}
        </div>
        <button class="button secondary" type="button" data-eu-skip>Пропустити</button>
      `;
    } else {
      body = `
        <form class="onboarding-form" data-onboarding-form>
          <label class="field">
            <input type="text" name="nickname" maxlength="24" value="${escapeAttribute(
              state.nickname
            )}" required />
          </label>
          <button class="button" type="submit">Зберегти</button>
          <p class="muted small" data-onboarding-status>${escapeHtml(statusMessage)}</p>
        </form>
      `;
    }

    const actions = `
      <div class="onboarding-actions">
        <button class="button secondary" type="button" data-onboarding-back ${
          state.step === 1 ? "disabled" : ""
        }>Назад</button>
        ${
          state.step < 4
            ? `<button class="button" type="button" data-onboarding-next>Далі</button>`
            : ""
        }
      </div>
    `;

    app.innerHTML = `
      <main class="layout onboarding">
        <section class="panel onboarding-panel">
          ${header}
          ${body}
          ${actions}
        </section>
      </main>
    `;

    const nextButton = app.querySelector<HTMLButtonElement>("[data-onboarding-next]");
    if (nextButton) {
      nextButton.addEventListener("click", () => {
        state.step = Math.min(4, state.step + 1);
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

    app.querySelectorAll<HTMLButtonElement>("[data-classico-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.dataset.classicoChoice;
        if (choice === "real_madrid" || choice === "barcelona") {
          state.classicoChoice = choice;
        }
        renderStep();
      });
    });

    const classicoSkip = app.querySelector<HTMLButtonElement>("[data-classico-skip]");
    if (classicoSkip) {
      classicoSkip.addEventListener("click", () => {
        state.classicoChoice = null;
        renderStep();
      });
    }

    app.querySelectorAll<HTMLButtonElement>("[data-ua-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const clubId = button.dataset.uaChoice || null;
        state.uaClubId = clubId;
        renderStep();
      });
    });

    const uaSkip = app.querySelector<HTMLButtonElement>("[data-ua-skip]");
    if (uaSkip) {
      uaSkip.addEventListener("click", () => {
        state.uaClubId = null;
        renderStep();
      });
    }

    app.querySelectorAll<HTMLButtonElement>("[data-eu-league]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextLeague = button.dataset.euLeague as LeagueId | undefined;
        if (!nextLeague || nextLeague === state.euLeague) {
          return;
        }
        state.euLeague = nextLeague;
        state.euClubId = null;
        state.euClubLeague = null;
        renderStep();
      });
    });

    app.querySelectorAll<HTMLButtonElement>("[data-eu-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const clubId = button.dataset.euChoice || null;
        state.euClubId = clubId;
        state.euClubLeague = clubId ? state.euLeague : null;
        renderStep();
      });
    });

    const euSkip = app.querySelector<HTMLButtonElement>("[data-eu-skip]");
    if (euSkip) {
      euSkip.addEventListener("click", () => {
        state.euClubId = null;
        state.euClubLeague = null;
        renderStep();
      });
    }

    const form = app.querySelector<HTMLFormElement>("[data-onboarding-form]");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const nicknameInput = form.querySelector<HTMLInputElement>("input[name=nickname]");
        state.nickname = nicknameInput?.value ?? "";
        void submitOnboarding(state, user, stats);
      });
    }
  };

  renderStep();
}

function getOnboardingTitle(step: number): string {
  switch (step) {
    case 1:
      return "ХТО КРАЩЕ?";
    case 2:
      return "ОБЕРИ УКРАЇНСЬКИЙ КЛУБ";
    case 3:
      return "ОБЕРИ ЄВРОПЕЙСЬКИЙ КЛУБ";
    case 4:
      return "ВВЕДИ НІКНЕЙМ";
    default:
      return "ОБЕРИ ЄВРОПЕЙСЬКИЙ КЛУБ";
  }
}

async function submitOnboarding(
  state: {
    classicoChoice: "real_madrid" | "barcelona" | null;
    uaClubId: string | null;
    euClubId: string | null;
    euClubLeague: LeagueId | null;
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

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const avatarChoice = getDefaultAvatarChoice(state);
    const logoOrder = getDefaultLogoOrder({
      classico_choice: state.classicoChoice,
      ua_club_id: state.uaClubId,
      eu_club_id: state.euClubId,
      nickname,
      avatar_choice: avatarChoice,
      completed: true
    });
    const response = await fetch(`${apiBase}/api/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        classico_choice: state.classicoChoice,
        ua_club_id: state.uaClubId,
        eu_club_id: state.euClubId,
        nickname,
        avatar_choice: avatarChoice,
        logo_order: logoOrder
      })
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти налаштування.";
      }
      return;
    }

    currentNickname = nickname;
    currentAvatarChoice = avatarChoice;
    currentLogoOrder = logoOrder.length ? logoOrder : null;
    currentUser = user;
    currentOnboarding = {
      classico_choice: state.classicoChoice,
      ua_club_id: state.uaClubId,
      eu_club_id: state.euClubId,
      nickname,
      avatar_choice: avatarChoice,
      logo_order: currentLogoOrder,
      completed: true
    };
    renderUser(user, stats, isAdmin, currentDate, currentNickname);
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
    const response = await fetch(`${apiBase}/api/avatar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        avatar_choice: choice
      })
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
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

function getClubLogoPath(leagueId: string, clubId: string): string {
  return `/logos/football-logos/${leagueId}/${clubId}.png`;
}

type AvatarOption = {
  choice: string;
  name: string;
  logo: string;
};

function getClassicoLogoSlug(choice: "real_madrid" | "barcelona" | null): string | null {
  if (choice === "real_madrid") {
    return "real-madrid";
  }
  if (choice === "barcelona") {
    return "barcelona";
  }
  return null;
}

function getAvatarLogoPath(choice: string | null | undefined): string | null {
  if (!choice) {
    return null;
  }
  const match = /^([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(choice.trim());
  if (!match) {
    return null;
  }
  return getClubLogoPath(match[1], match[2]);
}

function findEuropeanClubLeague(clubId: string): LeagueId | null {
  const entries = Object.entries(EU_CLUBS) as Array<[LeagueId, string[]]>;
  for (const [leagueId, clubs] of entries) {
    if (clubs.includes(clubId)) {
      return leagueId;
    }
  }
  return null;
}

function findClubLeague(clubId: string): AllLeagueId | null {
  const entries = Object.entries(ALL_CLUBS) as Array<[AllLeagueId, string[]]>;
  for (const [leagueId, clubs] of entries) {
    if (clubs.includes(clubId)) {
      return leagueId;
    }
  }
  return null;
}

function getMatchTeamInfo(match: Match): {
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
} {
  const homeClubId = match.home_club_id ?? null;
  const awayClubId = match.away_club_id ?? null;
  const matchLeagueId = (match.league_id as MatchLeagueId | null) ?? null;
  const resolvedLeague =
    resolveLogoLeagueId(matchLeagueId) ||
    (homeClubId ? findClubLeague(homeClubId) : null) ||
    (awayClubId ? findClubLeague(awayClubId) : null);

  const homeName = homeClubId ? formatClubName(homeClubId) : match.home_team;
  const awayName = awayClubId ? formatClubName(awayClubId) : match.away_team;

  const homeLogo =
    homeClubId && resolvedLeague ? getClubLogoPath(resolvedLeague, homeClubId) : null;
  const awayLogo =
    awayClubId && resolvedLeague ? getClubLogoPath(resolvedLeague, awayClubId) : null;

  return { homeName, awayName, homeLogo, awayLogo };
}

function buildAvatarOptions(onboarding: OnboardingInfo | null): AvatarOption[] {
  if (!onboarding) {
    return [];
  }

  const options: AvatarOption[] = [];
  const seen = new Set<string>();
  const pushOption = (option: AvatarOption) => {
    if (seen.has(option.choice)) {
      return;
    }
    seen.add(option.choice);
    options.push(option);
  };
  const classicoSlug = getClassicoLogoSlug(
    onboarding.classico_choice === "real_madrid" || onboarding.classico_choice === "barcelona"
      ? onboarding.classico_choice
      : null
  );
  if (classicoSlug) {
    pushOption({
      choice: `la-liga/${classicoSlug}`,
      name: formatClubName(classicoSlug),
      logo: getClubLogoPath("la-liga", classicoSlug)
    });
  }

  if (onboarding.ua_club_id) {
    pushOption({
      choice: `ukrainian-premier-league/${onboarding.ua_club_id}`,
      name: formatClubName(onboarding.ua_club_id),
      logo: getClubLogoPath("ukrainian-premier-league", onboarding.ua_club_id)
    });
  }

  if (onboarding.eu_club_id) {
    const league = findEuropeanClubLeague(onboarding.eu_club_id);
    if (league) {
      pushOption({
        choice: `${league}/${onboarding.eu_club_id}`,
        name: formatClubName(onboarding.eu_club_id),
        logo: getClubLogoPath(league, onboarding.eu_club_id)
      });
    }
  }

  return options;
}

function getDefaultAvatarChoice(state: {
  classicoChoice: "real_madrid" | "barcelona" | null;
  uaClubId: string | null;
  euClubId: string | null;
  euClubLeague: LeagueId | null;
}): string | null {
  const classicoSlug = getClassicoLogoSlug(state.classicoChoice);
  if (classicoSlug) {
    return `la-liga/${classicoSlug}`;
  }
  if (state.uaClubId) {
    return `ukrainian-premier-league/${state.uaClubId}`;
  }
  if (state.euClubId && state.euClubLeague) {
    return `${state.euClubLeague}/${state.euClubId}`;
  }
  return null;
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

function formatClubName(slug: string): string {
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

function renderUser(
  user: TelegramWebAppUser | undefined,
  stats: UserStats,
  admin: boolean,
  date: string,
  nickname?: string | null
): void {
  const displayName = nickname?.trim() ? nickname.trim() : formatTelegramName(user);
  const safeName = escapeHtml(displayName);
  const logoOptions = buildAvatarOptions(currentOnboarding);
  currentLogoOptions = logoOptions;
  const resolvedLogoOrder = resolveLogoOrder(logoOptions, currentLogoOrder ?? currentOnboarding?.logo_order ?? null);
  currentLogoOrder = resolvedLogoOrder.length ? resolvedLogoOrder.map((option) => option.choice) : null;
  if (currentOnboarding) {
    currentOnboarding.logo_order = currentLogoOrder;
  }
  const logoStackMarkup = logoOptions.length
    ? renderLogoStack(resolvedLogoOrder)
    : renderAvatarContent(user, currentAvatarChoice);
  const logoOrderMenuMarkup =
    logoOptions.length > 1 ? renderLogoOrderMenu(resolvedLogoOrder, currentNickname ?? displayName) : "";
  const dateValue = date || getKyivDateString();
  const safeDateLabel = escapeHtml(formatKyivDateLabel(dateValue));
  const rankText = stats.rank ? `#${stats.rank}` : "—";
  const leagueOptions = MATCH_LEAGUES.map(
    (league) => `<option value="${league.id}">${escapeHtml(league.label)}</option>`
  ).join("");

  const adminSection = admin
    ? `
      <section class="panel admin">
        <div class="section-header">
          <h2>Адмін</h2>
        </div>
        <div class="admin-actions">
          <button class="button secondary" type="button" data-admin-toggle-add>Додати матч</button>
          <button class="button secondary" type="button" data-admin-toggle-result>Ввести результат</button>
          <button class="button secondary" type="button" data-admin-toggle-odds>Коефіцієнти</button>
          <button class="button secondary" type="button" data-admin-toggle-weather>Погода (debug)</button>
          <button class="button secondary" type="button" data-admin-announce>Повідомити в боті</button>
        </div>
        <p class="muted small" data-admin-announce-status></p>
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
        <form class="admin-form" data-admin-weather-form>
          <label class="field">
            <span>Матч</span>
            <select name="match_id" data-admin-weather-match></select>
          </label>
          <button class="button" type="submit">Погода (debug)</button>
          <p class="muted small" data-admin-weather-status></p>
        </form>
      </section>
    `
    : "";

  app.innerHTML = `
    <main class="layout">
      <section class="panel profile center">
        ${logoStackMarkup}
        ${safeName ? `<h1 data-profile-name>${safeName}</h1>` : ""}
        ${logoOrderMenuMarkup}
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Місце</span>
            <span class="stat-value">${rankText}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Бали</span>
            <span class="stat-value">${stats.points}</span>
          </div>
        </div>
      </section>

      <section class="panel matches">
        <div class="section-header">
          <div class="date-switcher" data-date-switcher>
            <button class="date-nav" type="button" data-date-prev aria-label="Попередній день">
              <span aria-hidden="true">‹</span>
            </button>
            <div class="date-pill" data-date-label>${safeDateLabel}</div>
            <button class="date-nav" type="button" data-date-next aria-label="Наступний день">
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div class="matches-list" data-matches></div>
      </section>

      <div class="notice-ticker" aria-live="polite">
        <span class="notice-ticker-text" data-notice-text>
          ${escapeHtml(formatNoticeRule(NOTICE_RULES[0] ?? ""))}
        </span>
      </div>

      <section class="panel leaderboard center">
        <button class="button" type="button" data-leaderboard>ТАБЛИЦЯ</button>
        <div class="leaderboard-list" data-leaderboard-list></div>
      </section>

      ${adminSection}
    </main>
  `;

  const leaderboardButton = app.querySelector<HTMLButtonElement>("[data-leaderboard]");
  if (leaderboardButton) {
    leaderboardButton.addEventListener("click", () => {
      void loadLeaderboard();
    });
  }

  const dateLabel = app.querySelector<HTMLElement>("[data-date-label]");
  const prevButton = app.querySelector<HTMLButtonElement>("[data-date-prev]");
  const nextButton = app.querySelector<HTMLButtonElement>("[data-date-next]");

  const setDate = (nextDate: string): void => {
    if (!nextDate) {
      return;
    }
    currentDate = nextDate;
    if (dateLabel) {
      dateLabel.textContent = formatKyivDateLabel(nextDate);
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

  setupNoticeTicker();
  setupLogoOrderControls();

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
    const toggleWeather = app.querySelector<HTMLButtonElement>("[data-admin-toggle-weather]");
    const announceButton = app.querySelector<HTMLButtonElement>("[data-admin-announce]");
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    const resultForm = app.querySelector<HTMLFormElement>("[data-admin-result-form]");
    const oddsForm = app.querySelector<HTMLFormElement>("[data-admin-odds-form]");
    const weatherForm = app.querySelector<HTMLFormElement>("[data-admin-weather-form]");

    if (toggleAdd && form) {
      setupAdminMatchForm(form);
      toggleAdd.addEventListener("click", () => {
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

    if (toggleWeather && weatherForm) {
      toggleWeather.addEventListener("click", () => {
        weatherForm.classList.toggle("is-open");
      });
    }

    if (weatherForm) {
      weatherForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitWeatherDebug(weatherForm);
      });
    }

    if (announceButton) {
      announceButton.addEventListener("click", () => {
        void publishMatchesAnnouncement();
      });
    }
  }
}

function setupLogoOrderControls(): void {
  const stack = app.querySelector<HTMLElement>("[data-logo-stack]");
  const menu = app.querySelector<HTMLElement>("[data-logo-order-menu]");
  if (!stack || !menu) {
    return;
  }

  let activeChoice: string | null = null;
  const status = menu.querySelector<HTMLElement>("[data-logo-order-status]");
  const nicknameStatus = menu.querySelector<HTMLElement>("[data-nickname-status]");
  const nicknameInput = menu.querySelector<HTMLInputElement>("[data-nickname-input]");
  const nicknameSave = menu.querySelector<HTMLButtonElement>("[data-nickname-save]");

  const updateMenuState = (choice: string): void => {
    const order = currentLogoOrder ?? [];
    const currentIndex = order.indexOf(choice);
    menu.querySelectorAll<HTMLButtonElement>("[data-logo-position]").forEach((button) => {
      const position = button.dataset.logoPosition as LogoPosition | undefined;
      if (!position) {
        return;
      }
      const index = LOGO_POSITIONS.indexOf(position);
      button.disabled = index >= order.length;
      button.classList.toggle("is-selected", index === currentIndex);
    });
  };

  const closeMenu = (): void => {
    menu.classList.remove("is-open");
    activeChoice = null;
  };

  const openMenu = (choice: string): void => {
    activeChoice = choice;
    if (status) {
      status.textContent = "";
    }
    if (nicknameStatus) {
      nicknameStatus.textContent = "";
    }
    updateMenuState(choice);
    menu.classList.add("is-open");
  };

  stack.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-logo-choice]");
    if (!target || !currentLogoOrder || currentLogoOrder.length < 2) {
      return;
    }
    const choice = target.dataset.logoChoice;
    if (!choice) {
      return;
    }
    openMenu(choice);
  });

  menu.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-logo-position]");
    if (!target || !activeChoice || !currentLogoOrder) {
      return;
    }
    const position = target.dataset.logoPosition as LogoPosition | undefined;
    if (!position) {
      return;
    }
    const nextOrder = reorderLogoOrder(currentLogoOrder, activeChoice, position);
    if (!nextOrder) {
      return;
    }
    currentLogoOrder = nextOrder;
    if (currentOnboarding) {
      currentOnboarding.logo_order = nextOrder;
    }
    updateLogoStack();
    closeMenu();
    void submitLogoOrder(nextOrder, status);
  });

  if (nicknameSave && nicknameInput) {
    const saveHandler = (): void => {
      const nextNickname = normalizeLocalNickname(nicknameInput.value);
      if (!nextNickname) {
        if (nicknameStatus) {
          nicknameStatus.textContent = "Нікнейм має містити від 2 до 24 символів.";
        }
        return;
      }
      if (nextNickname === currentNickname) {
        if (nicknameStatus) {
          nicknameStatus.textContent = "Нікнейм без змін.";
        }
        return;
      }
      if (nicknameStatus) {
        nicknameStatus.textContent = "";
      }
      void submitNickname(nextNickname, nicknameStatus);
    };

    nicknameSave.addEventListener("click", saveHandler);
    nicknameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveHandler();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("is-open")) {
      return;
    }
    const target = event.target as Node;
    if (menu.contains(target) || stack.contains(target)) {
      return;
    }
    closeMenu();
  });
}

function updateLogoStack(): void {
  const stack = app.querySelector<HTMLElement>("[data-logo-stack]");
  if (!stack || !currentLogoOrder || currentLogoOptions.length === 0) {
    return;
  }
  const resolvedOrder = resolveLogoOrder(currentLogoOptions, currentLogoOrder);
  stack.innerHTML = renderLogoStackContent(resolvedOrder);
}

function reorderLogoOrder(order: string[], choice: string, position: LogoPosition): string[] | null {
  const targetIndex = LOGO_POSITIONS.indexOf(position);
  const currentIndex = order.indexOf(choice);
  if (targetIndex === -1 || currentIndex === -1 || targetIndex >= order.length) {
    return null;
  }
  if (targetIndex === currentIndex) {
    return order;
  }
  const nextOrder = [...order];
  const swapped = nextOrder[targetIndex];
  nextOrder[targetIndex] = choice;
  nextOrder[currentIndex] = swapped;
  return nextOrder;
}

function renderLogoStack(logoOrder: AvatarOption[]): string {
  return `
    <div class="logo-stack" data-logo-stack>
      ${renderLogoStackContent(logoOrder)}
    </div>
  `;
}

function renderLogoStackContent(logoOrder: AvatarOption[]): string {
  const center = logoOrder[0] ?? null;
  const left = logoOrder[1] ?? null;
  const right = logoOrder[2] ?? null;
  return [
    renderLogoSlot(left, "left"),
    renderLogoSlot(center, "center"),
    renderLogoSlot(right, "right")
  ].join("");
}

function renderLogoSlot(option: AvatarOption | null, position: LogoPosition): string {
  if (!option) {
    return `<div class="logo-slot ${position} is-empty" aria-hidden="true"></div>`;
  }
  const safeLogo = escapeAttribute(option.logo);
  const safeName = escapeAttribute(option.name);
  return `
    <button class="logo-slot ${position}" type="button" data-logo-choice="${escapeAttribute(
      option.choice
    )}" aria-label="${safeName}">
      <img src="${safeLogo}" alt="${safeName}" />
    </button>
  `;
}

function renderLogoOrderMenu(logoOrder: AvatarOption[], nickname: string): string {
  if (logoOrder.length < 2) {
    return "";
  }
  const safeNickname = escapeAttribute(nickname);
  const options = LOGO_POSITIONS.map(
    (position) => `
      <button class="logo-order-option" type="button" data-logo-position="${position}">
        ${LOGO_POSITION_LABELS[position]}
      </button>
    `
  ).join("");
  return `
    <div class="logo-order-menu" data-logo-order-menu>
      <p class="logo-order-title">ОБЕРИ ПОЗИЦІЮ ЛОГОТИПІВ</p>
      <div class="logo-order-options">
        ${options}
      </div>
      <div class="logo-nickname-field">
        <label class="logo-nickname-label" for="nickname-input">Нікнейм</label>
        <input id="nickname-input" type="text" maxlength="24" value="${safeNickname}" data-nickname-input />
        <button class="button secondary small-button logo-nickname-save" type="button" data-nickname-save>
          Зберегти
        </button>
      </div>
      <p class="muted small" data-logo-order-status></p>
      <p class="muted small" data-nickname-status></p>
    </div>
  `;
}

function resolveLogoOrder(options: AvatarOption[], logoOrder: string[] | null): AvatarOption[] {
  if (!options.length) {
    return [];
  }

  const byChoice = new Map(options.map((option) => [option.choice, option]));
  const ordered: AvatarOption[] = [];
  const seen = new Set<string>();

  if (Array.isArray(logoOrder)) {
    for (const choice of logoOrder) {
      const option = byChoice.get(choice);
      if (option && !seen.has(choice)) {
        ordered.push(option);
        seen.add(choice);
      }
    }
  }

  for (const option of options) {
    if (!seen.has(option.choice)) {
      ordered.push(option);
      seen.add(option.choice);
    }
  }

  return ordered;
}

function getDefaultLogoOrder(onboarding: OnboardingInfo | null): string[] {
  return buildAvatarOptions(onboarding).map((option) => option.choice);
}

async function submitLogoOrder(
  logoOrder: string[],
  statusEl?: HTMLElement | null
): Promise<void> {
  if (!apiBase) {
    return;
  }

  if (statusEl) {
    statusEl.textContent = "Збереження...";
  }

  try {
    const response = await fetch(`${apiBase}/api/logo-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        logo_order: logoOrder
      })
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
    if (!response.ok || !data.ok) {
      if (statusEl) {
        statusEl.textContent = "Не вдалося зберегти порядок.";
      }
      return;
    }

    if (statusEl) {
      statusEl.textContent = "Збережено ✅";
    }
  } catch {
    if (statusEl) {
      statusEl.textContent = "Не вдалося зберегти порядок.";
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
    const response = await fetch(`${apiBase}/api/nickname`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        nickname
      })
    });
    const data = (await response.json()) as { ok: boolean; error?: string };
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
  if (!container) {
    return;
  }

  container.innerHTML = `<p class="muted">Завантаження...</p>`;

  try {
    const response = await fetch(`${apiBase}/api/matches?date=${encodeURIComponent(date)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as MatchesResponse;
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
      return;
    }

    predictionsLoaded.clear();
    matchesById.clear();
    data.matches.forEach((match) => {
      matchesById.set(match.id, match);
    });
    container.innerHTML = renderMatchesList(data.matches);
    bindMatchActions();
    renderAdminMatchOptions(data.matches);
    void loadMatchWeather(data.matches);
  } catch {
    container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
  }
}

async function loadMatchWeather(matches: Match[]): Promise<void> {
  if (!apiBase) {
    return;
  }
  const tasks = matches.map(async (match) => {
    if (isWeatherFresh(match)) {
      const cachedValue = match.rain_probability ?? null;
      const cachedCondition = match.weather_condition ?? null;
      const cachedTemp = match.weather_temp_c ?? null;
      const cachedTimezone = match.weather_timezone ?? null;
      matchWeatherCache.set(match.id, cachedValue);
      matchWeatherConditionCache.set(match.id, cachedCondition);
      matchWeatherTempCache.set(match.id, cachedTemp);
      matchWeatherTimezoneCache.set(match.id, cachedTimezone);
      updateMatchWeather(match.id, cachedValue, cachedCondition, cachedTemp, cachedTimezone);
      return;
    }
    if (matchWeatherCache.has(match.id)) {
      updateMatchWeather(
        match.id,
        matchWeatherCache.get(match.id) ?? null,
        matchWeatherConditionCache.get(match.id) ?? null,
        matchWeatherTempCache.get(match.id) ?? null,
        matchWeatherTimezoneCache.get(match.id) ?? null
      );
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/matches/weather?match_id=${match.id}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-InitData": initData
        }
      });
      const data = (await response.json()) as MatchWeatherResponse;
      if (!response.ok || !data.ok) {
        updateMatchWeather(match.id, null, null, null, null);
        return;
      }
      matchWeatherCache.set(match.id, data.rain_probability ?? null);
      matchWeatherConditionCache.set(match.id, data.weather_condition ?? null);
      matchWeatherTempCache.set(match.id, data.weather_temp_c ?? null);
      matchWeatherTimezoneCache.set(match.id, data.weather_timezone ?? null);
      const stored = matchesById.get(match.id);
      if (stored) {
        stored.rain_probability = data.rain_probability ?? null;
        stored.weather_condition = data.weather_condition ?? null;
        stored.weather_temp_c = data.weather_temp_c ?? null;
        stored.weather_timezone = data.weather_timezone ?? null;
      }
      updateMatchWeather(
        match.id,
        data.rain_probability ?? null,
        data.weather_condition ?? null,
        data.weather_temp_c ?? null,
        data.weather_timezone ?? null
      );
    } catch {
      updateMatchWeather(match.id, null, null, null, null);
    }
  });
  await Promise.all(tasks);
}

function isWeatherFresh(match: Match): boolean {
  if (!match.weather_fetched_at) {
    return false;
  }
  if (match.weather_temp_c === null || match.weather_temp_c === undefined) {
    return false;
  }
  if (!match.weather_timezone) {
    return false;
  }
  const fetchedAt = new Date(match.weather_fetched_at);
  if (Number.isNaN(fetchedAt.getTime())) {
    return false;
  }
  const ageMinutes = (Date.now() - fetchedAt.getTime()) / (60 * 1000);
  return ageMinutes < WEATHER_CLIENT_CACHE_MIN;
}

function updateMatchWeather(
  matchId: number,
  rainProbability: number | null,
  condition: string | null,
  tempC: number | null,
  timezone: string | null
): void {
  const el = app.querySelector<HTMLElement>(`[data-match-rain][data-match-id="${matchId}"]`);
  if (!el) {
    return;
  }
  const percent = normalizeRainProbability(rainProbability);
  const value = formatRainProbability(percent);
  const icon = getWeatherIcon(condition);
  const valueEl = el.querySelector<HTMLElement>("[data-match-rain-value]");
  const iconEl = el.querySelector<HTMLElement>("[data-match-rain-icon]");
  const fillEl = el.querySelector<HTMLElement>("[data-match-rain-fill]");
  if (valueEl) {
    valueEl.textContent = value;
  }
  if (iconEl) {
    iconEl.textContent = icon;
  }
  if (fillEl) {
    fillEl.style.width = `${percent ?? 0}%`;
  }
  el.setAttribute("aria-label", `Дощ: ${value}`);

  const match = matchesById.get(matchId);
  if (!match) {
    return;
  }
  const tempEl = app.querySelector<HTMLElement>(`[data-match-temp][data-match-id="${matchId}"]`);
  if (tempEl) {
    tempEl.textContent = formatTemperature(tempC);
  }
  const tz = timezone ?? "Europe/Kyiv";
  const localTimeEl = app.querySelector<HTMLElement>(`[data-match-local-time][data-match-id="${matchId}"]`);
  if (localTimeEl) {
    localTimeEl.textContent = `(${formatTimeInZone(match.kickoff_at, tz)})`;
  }
}

function normalizeRainProbability(value: number | null): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

function formatRainProbability(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value}%`;
}

function formatTemperature(value: number | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—°C";
  }
  return `${Math.round(value)}°C`;
}

function formatTimeInZone(value: string, timeZone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getWeatherIcon(condition: string | null): string {
  if (condition === "thunderstorm") {
    return "⛈️";
  }
  if (condition === "snow") {
    return "🌨️";
  }
  return "🌧️";
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

  if (status) {
    status.textContent = "Створення...";
  }

  try {
    const response = await fetch(`${apiBase}/api/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        home_team: home,
        away_team: away,
        league_id: leagueId,
        home_club_id: homeClubId,
        away_club_id: awayClubId,
        kickoff_at: kickoff
      })
    });
    const data = (await response.json()) as CreateMatchResponse;
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося створити матч.";
      }
      return;
    }

    form.reset();
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Матч додано ✅";
    }
    await loadMatches(currentDate || getKyivDateString());
  } catch {
    if (status) {
      status.textContent = "Не вдалося створити матч.";
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

  if (matchId === null || homeScore === null || awayScore === null) {
    if (status) {
      status.textContent = "Заповніть всі поля.";
    }
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const response = await fetch(`${apiBase}/api/matches/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        match_id: matchId,
        home_score: homeScore,
        away_score: awayScore
      })
    });
    const data = (await response.json()) as ResultResponse;
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти результат.";
      }
      return;
    }

    form.reset();
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Результат збережено ✅";
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
    const response = await fetch(`${apiBase}/api/matches/odds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        match_id: matchId,
        debug: true
      })
    });
    const data = (await response.json().catch(() => null)) as OddsRefreshResponse | null;
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

async function submitWeatherDebug(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const matchSelect = form.querySelector<HTMLSelectElement>("[data-admin-weather-match]");
  const status = form.querySelector<HTMLElement>("[data-admin-weather-status]");
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
    const response = await fetch(`${apiBase}/api/matches/weather?match_id=${matchId}&debug=1`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json().catch(() => null)) as MatchWeatherDebugResponse | null;
    if (!response.ok || !data) {
      if (status) {
        status.textContent = "Не вдалося отримати погоду.";
      }
      return;
    }

    if (data.ok) {
      const rain = formatRainProbability(data.rain_probability ?? null);
      const debug = formatWeatherDebug(data.debug);
      if (status) {
        status.textContent = `Дощ: ${rain}${debug}`;
      }
      return;
    }

    if (status) {
      status.textContent = formatWeatherError(data);
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося отримати погоду.";
    }
  }
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
  if (debug.date) {
    parts.push(`date=${debug.date}`);
  }
  if (debug.season) {
    parts.push(`season=${debug.season}`);
  }
  if (debug.timezone) {
    parts.push(`tz=${debug.timezone}`);
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
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

function formatWeatherError(payload: MatchWeatherDebugResponse): string {
  let message = "Не вдалося отримати погоду.";
  switch (payload.error) {
    case "missing_location":
      message = "Немає локації для матчу.";
      break;
    case "bad_kickoff":
      message = "Некоректна дата матчу.";
      break;
    case "api_error":
      message = "Помилка погодного API.";
      break;
    case "rate_limited":
      message = "Ліміт запитів до погоди.";
      break;
    case "bad_match_id":
      message = "Некоректний матч.";
      break;
    case "match_not_found":
      message = "Матч не знайдено.";
      break;
    case "bad_initData":
      message = "Некоректні дані входу.";
      break;
    case "missing_supabase":
      message = "Не налаштовано Supabase.";
      break;
    default:
      break;
  }
  const debug = formatWeatherDebug(payload.debug);
  return `${message}${debug}`;
}

function formatWeatherDebug(debug?: MatchWeatherDebugInfo): string {
  if (!debug) {
    return "";
  }
  const parts: string[] = [];
  if (debug.venue_city || debug.venue_name) {
    parts.push(`city=${debug.venue_city ?? debug.venue_name}`);
  }
  if (debug.venue_lat !== undefined || debug.venue_lon !== undefined) {
    const lat = debug.venue_lat ?? "null";
    const lon = debug.venue_lon ?? "null";
    parts.push(`latlon=${lat}/${lon}`);
  }
  if (debug.kickoff_at) {
    parts.push(`kickoff=${debug.kickoff_at}`);
  }
  if (debug.weather_fetched_at) {
    parts.push(`fetched=${debug.weather_fetched_at}`);
  }
  if (debug.cache_used !== undefined) {
    parts.push(`cache=${debug.cache_used ? "yes" : "no"}`);
  }
  if (debug.cache_state) {
    parts.push(`cache_state=${debug.cache_state}`);
  }
  if (debug.is_stale !== undefined) {
    parts.push(`is_stale=${debug.is_stale ? "yes" : "no"}`);
  }
  if (debug.rate_limited_locally !== undefined) {
    parts.push(`rl_local=${debug.rate_limited_locally ? "yes" : "no"}`);
  }
  if (debug.status_code !== undefined && debug.status_code !== null) {
    parts.push(`status=${debug.status_code}`);
  }
  if (debug.attempts !== undefined && debug.attempts !== null) {
    parts.push(`attempts=${debug.attempts}`);
  }
  if (debug.retry_after_sec !== undefined && debug.retry_after_sec !== null) {
    parts.push(`retry_after=${debug.retry_after_sec}`);
  }
  if (debug.cooldown_until) {
    parts.push(`cooldown=${debug.cooldown_until}`);
  }
  if (debug.cache_age_min !== undefined && debug.cache_age_min !== null) {
    parts.push(`cache_age_min=${debug.cache_age_min}`);
  }
  if (debug.target_time) {
    parts.push(`target=${debug.target_time}`);
  }
  if (debug.weather_key) {
    parts.push(`key=${debug.weather_key}`);
  }
  if (debug.date_string) {
    parts.push(`date=${debug.date_string}`);
  }
  if (debug.geocode_city) {
    parts.push(`geo_city=${debug.geocode_city}`);
  }
  if (debug.geocode_ok !== undefined) {
    parts.push(`geo_ok=${debug.geocode_ok ? "yes" : "no"}`);
  }
  if (debug.geocode_status !== undefined && debug.geocode_status !== null) {
    parts.push(`geo_status=${debug.geocode_status}`);
  }
  if (debug.forecast_status !== undefined && debug.forecast_status !== null) {
    parts.push(`forecast_status=${debug.forecast_status}`);
  }
  if (debug.time_index !== undefined && debug.time_index !== null) {
    parts.push(`time_idx=${debug.time_index}`);
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
    const response = await fetch(`${apiBase}/api/matches/announcement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData })
    });
    const data = (await response.json()) as AnnouncementResponse;
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

function bindMatchActions(): void {
  const forms = app.querySelectorAll<HTMLFormElement>("[data-prediction-form]");
  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitPrediction(form);
    });
    setupScoreControls(form);
  });

  const toggles = app.querySelectorAll<HTMLButtonElement>("[data-predictions-toggle]");
  toggles.forEach((toggle) => {
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

  const autoContainers = app.querySelectorAll<HTMLElement>("[data-predictions][data-auto-open='true']");
  autoContainers.forEach((container) => {
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
}

function renderAdminMatchOptions(matches: Match[]): void {
  const select = app.querySelector<HTMLSelectElement>("[data-admin-match]");
  const oddsSelect = app.querySelector<HTMLSelectElement>("[data-admin-odds-match]");
  const weatherSelect = app.querySelector<HTMLSelectElement>("[data-admin-weather-match]");
  if (!select) {
    return;
  }

  if (!matches.length) {
    select.innerHTML = `<option value="">Немає матчів</option>`;
    select.disabled = true;
    if (oddsSelect) {
      oddsSelect.innerHTML = `<option value="">Немає матчів</option>`;
      oddsSelect.disabled = true;
    }
    if (weatherSelect) {
      weatherSelect.innerHTML = `<option value="">Немає матчів</option>`;
      weatherSelect.disabled = true;
    }
    return;
  }

  select.disabled = false;
  select.innerHTML = matches
    .map((match) => {
      const { homeName, awayName } = getMatchTeamInfo(match);
      const title = `${homeName} — ${awayName}`;
      const kickoff = formatKyivDateTime(match.kickoff_at);
      return `<option value="${match.id}">${escapeHtml(title)} (${kickoff})</option>`;
    })
    .join("");
  if (oddsSelect) {
    oddsSelect.disabled = false;
    oddsSelect.innerHTML = select.innerHTML;
  }
  if (weatherSelect) {
    weatherSelect.disabled = false;
    weatherSelect.innerHTML = select.innerHTML;
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
    const response = await fetch(`${apiBase}/api/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        match_id: matchId,
        home_pred: home,
        away_pred: away
      })
    });
    const data = (await response.json()) as PredictionResponse;
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
    const response = await fetch(`${apiBase}/api/predictions?match_id=${matchId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as PredictionsResponse;
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
      return;
    }

    updateMatchAverage(matchId, data.predictions);
    container.innerHTML = renderPredictionsPanel(data.predictions);
    if (form && data.predictions.some((item) => item.user_id === currentUserId)) {
      form.classList.add("is-hidden");
    }
    predictionsLoaded.add(matchId);
  } catch {
    container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
  }
}

function renderPredictionsPanel(predictions: PredictionView[]): string {
  if (!predictions.length) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }

  const self = currentUserId
    ? predictions.find((item) => item.user_id === currentUserId) || null
    : null;
  if (!self) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }
  const others = currentUserId
    ? predictions.filter((item) => item.user_id !== currentUserId)
    : predictions;

  const topPredictions = getTopPredictions(others, TOP_PREDICTIONS_LIMIT);
  const rows = renderPredictionRows(self, topPredictions);

  return `
    <div class="predictions-list">${rows}</div>
  `;
}

function updateMatchAverage(matchId: number, predictions: PredictionView[]): void {
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

function formatAverageValue(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value);
}

function getPredictionError(error: string | undefined): string {
  switch (error) {
    case "prediction_closed":
      return "Прийом прогнозів закрито.";
    case "match_finished":
      return "Матч завершено.";
    case "match_not_found":
      return "Матч не знайдено.";
    case "already_predicted":
      return "Ви вже зробили прогноз.";
    default:
      return "Не вдалося зберегти прогноз.";
  }
}

function renderTeamLogo(name: string, logo: string | null): string {
  const alt = escapeAttribute(name);
  return logo
    ? `<img class="match-logo" src="${escapeAttribute(logo)}" alt="${alt}" />`
    : `<div class="match-logo match-logo-fallback" role="img" aria-label="${alt}"></div>`;
}

function renderMatchOdds(match: Match, homeName: string, awayName: string): string {
  const probabilities = extractOddsProbabilities(match.odds_json, homeName, awayName);
  if (!probabilities) {
    return "";
  }
  return `
    <div class="match-odds-values">
      <span class="match-odds-value">
        <span class="match-odds-key">1</span>
        <span class="match-odds-num">${formatProbability(probabilities.home)}</span>
      </span>
      <span class="match-odds-value">
        <span class="match-odds-key">X</span>
        <span class="match-odds-num">${formatProbability(probabilities.draw)}</span>
      </span>
      <span class="match-odds-value">
        <span class="match-odds-key">2</span>
        <span class="match-odds-num">${formatProbability(probabilities.away)}</span>
      </span>
    </div>
  `;
}

function extractOddsProbabilities(
  oddsJson: unknown,
  homeName: string,
  awayName: string
): { home: number; draw: number; away: number } | null {
  if (!Array.isArray(oddsJson) || !oddsJson.length) {
    return null;
  }
  const homeNormalized = normalizeOddsLabel(homeName);
  const awayNormalized = normalizeOddsLabel(awayName);

  for (const entry of oddsJson) {
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

  return null;
}

function extractCorrectScoreProbability(
  oddsJson: unknown,
  homeScore: number,
  awayScore: number
): number | null {
  const odd = extractCorrectScoreOdd(oddsJson, homeScore, awayScore);
  if (!odd) {
    return null;
  }
  return (1 / odd) * 100;
}

function extractCorrectScoreOdd(oddsJson: unknown, homeScore: number, awayScore: number): number | null {
  if (!Array.isArray(oddsJson) || !oddsJson.length) {
    return null;
  }

  for (const entry of oddsJson) {
    const bookmakers = (entry as { bookmakers?: unknown }).bookmakers;
    if (!Array.isArray(bookmakers)) {
      continue;
    }
    for (const bookmaker of bookmakers) {
      const bets = (bookmaker as { bets?: unknown }).bets;
      if (!Array.isArray(bets) || !bets.length) {
        continue;
      }
      for (const bet of bets) {
        if (!isCorrectScoreBet(bet as { id?: number; name?: string })) {
          continue;
        }
        const values = (bet as { values?: unknown }).values;
        if (!Array.isArray(values)) {
          continue;
        }
        for (const value of values) {
          const labelRaw = typeof value.value === "string" ? value.value.trim() : "";
          if (!labelRaw) {
            continue;
          }
          const score = parseScoreLabel(labelRaw);
          if (!score) {
            continue;
          }
          if (score.home === homeScore && score.away === awayScore) {
            const oddValue = parseOddNumber(value.odd);
            if (oddValue) {
              return oddValue;
            }
          }
        }
      }
    }
  }

  return null;
}

function isCorrectScoreBet(bet: { id?: number; name?: string }): boolean {
  const name = bet.name?.toLowerCase() ?? "";
  return name.includes("correct score") || name.includes("exact score");
}

function parseScoreLabel(value: string): { home: number; away: number } | null {
  const match = /(\d+)\s*[:\-]\s*(\d+)/.exec(value);
  if (!match) {
    return null;
  }
  const home = Number.parseInt(match[1], 10);
  const away = Number.parseInt(match[2], 10);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null;
  }
  return { home, away };
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
    const labelNormalized = normalizeOddsLabel(labelRaw);
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

function isOddsLabelMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function isMatchWinnerBet(bet: { id?: number; name?: string }): boolean {
  if (bet.id === 1) {
    return true;
  }
  const name = bet.name?.toLowerCase() ?? "";
  return name.includes("match winner") || name.includes("match result") || name.includes("fulltime result");
}

function normalizeOddsLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseOddNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    home: (homeInv / total) * 100,
    draw: (drawInv / total) * 100,
    away: (awayInv / total) * 100
  };
}

function formatProbability(value: number): string {
  return `${Math.round(value)}%`;
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

  const probability = extractCorrectScoreProbability(match.odds_json, homeScore, awayScore);
  if (probability === null) {
    label.textContent = `Ймовірність рахунку ${homeScore}:${awayScore} —`;
    label.classList.remove("is-hidden");
    return;
  }

  label.textContent = `Ймовірність рахунку ${homeScore}:${awayScore} — ${formatProbability(probability)}`;
  label.classList.remove("is-hidden");
}

function renderMatchesList(matches: Match[]): string {
  if (!matches.length) {
    return `
      <article class="match match-empty">
        <p class="muted">Немає матчів на цю дату.</p>
      </article>
    `;
  }

  return matches
    .map((match) => {
      const { homeName, awayName, homeLogo, awayLogo } = getMatchTeamInfo(match);
      const homeLogoMarkup = renderTeamLogo(homeName, homeLogo);
      const awayLogoMarkup = renderTeamLogo(awayName, awayLogo);
      const city = match.venue_city ?? match.venue_name ?? "";
      const cityLabel = city ? city.toUpperCase() : "";
      const kyivTime = formatTimeInZone(match.kickoff_at, "Europe/Kyiv");
      const localTime = formatTimeInZone(match.kickoff_at, match.weather_timezone ?? "Europe/Kyiv");
      const tempValue = formatTemperature(match.weather_temp_c ?? null);
      const cityMarkup = city
        ? `<span class="match-meta-sep">·</span><span class="match-city">${escapeHtml(cityLabel)}</span>`
        : "";
      const rainPercent = normalizeRainProbability(match.rain_probability ?? null);
      const rainValue = formatRainProbability(rainPercent);
      const rainIcon = getWeatherIcon(match.weather_condition ?? null);
      const rainBarWidth = rainPercent ?? 0;
      const rainMarkup = `
        <div class="match-weather-row" data-match-rain data-match-id="${match.id}" aria-label="Дощ: ${rainValue}">
          <span class="match-weather-icon" data-match-rain-icon aria-hidden="true">${rainIcon}</span>
          <span class="match-weather-bar" aria-hidden="true">
            <span class="match-weather-bar-fill" data-match-rain-fill style="width: ${rainBarWidth}%"></span>
          </span>
          <span class="match-weather-value" data-match-rain-value>${rainValue}</span>
        </div>
      `;
      const oddsMarkup = renderMatchOdds(match, homeName, awayName);
      const finished = match.status === "finished";
      const closed = finished || isPredictionClosed(match.kickoff_at);
      const predicted = Boolean(match.has_prediction);
      const result =
        finished && match.home_score !== null && match.away_score !== null
          ? `
            <div class="match-scoreline">
              ${homeLogoMarkup}
              <div class="match-result">${match.home_score}:${match.away_score}</div>
              ${awayLogoMarkup}
            </div>
          `
          : "";
      const statusLine = finished
        ? `<p class="muted small">Матч завершено.</p>`
        : closed
          ? `<p class="muted small status-closed">Прогнози закрито.</p>`
          : "";
      const form = closed || predicted
        ? ""
        : `
          <form class="prediction-form" data-prediction-form data-match-id="${match.id}">
            <div class="score-row">
              ${homeLogoMarkup}
              <div class="score-controls">
                <div class="score-control" data-score-control>
                  <button class="score-btn" type="button" data-score-inc>+</button>
                  <div class="score-value" data-score-value>0</div>
                  <button class="score-btn" type="button" data-score-dec>-</button>
                  <input type="hidden" name="home_pred" value="0" />
                </div>
                <span class="score-separator">:</span>
                <div class="score-control" data-score-control>
                  <button class="score-btn" type="button" data-score-inc>+</button>
                  <div class="score-value" data-score-value>0</div>
                  <button class="score-btn" type="button" data-score-dec>-</button>
                  <input type="hidden" name="away_pred" value="0" />
                </div>
              </div>
              ${awayLogoMarkup}
            </div>
            <p class="match-odds-score muted small is-hidden" data-match-odds-score></p>
            <button class="button small-button prediction-submit" type="submit">ПРОГНОЗ</button>
            <p class="muted small" data-prediction-status></p>
          </form>
        `;

      return `
        <div class="match-item ${predicted ? "has-prediction" : ""}">
          <div class="match-time">
            <div class="match-time-row">
              <span class="match-time-value" data-match-kyiv-time data-match-id="${match.id}">${escapeHtml(
                kyivTime
              )}</span>
              ${cityMarkup}
              <span class="match-time-alt" data-match-local-time data-match-id="${match.id}">(${escapeHtml(
                localTime
              )})</span>
              <span class="match-meta-sep">·</span>
              <span class="match-temp" data-match-temp data-match-id="${match.id}">${escapeHtml(tempValue)}</span>
            </div>
            ${rainMarkup}
          </div>
          <article class="match">
            ${oddsMarkup}
            <div class="match-header">
              ${result}
            </div>
            <div class="match-average" data-match-average data-match-id="${match.id}"></div>
            ${closed ? "" : statusLine}
            ${form}
            <div class="predictions" data-predictions data-match-id="${match.id}" ${
              predicted ? "data-auto-open='true'" : ""
            }></div>
            ${closed ? statusLine : ""}
          </article>
        </div>
      `;
    })
    .join("");
}

function isPredictionClosed(kickoffAt: string): boolean {
  const kickoff = new Date(kickoffAt);
  if (Number.isNaN(kickoff.getTime())) {
    return false;
  }
  const cutoff = kickoff.getTime() - 60 * 60 * 1000;
  return Date.now() > cutoff;
}

function parseScore(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
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
    container.classList.toggle("is-open");
    return;
  }

  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const response = await fetch(`${apiBase}/api/leaderboard?limit=10`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as LeaderboardResponse;
    if (!response.ok || !data.ok) {
      renderUsersError(container);
      return;
    }

    container.innerHTML = renderLeaderboardList(data.users);
    leaderboardLoaded = true;
  } catch {
    renderUsersError(container);
  }
}

function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted small">Не вдалося завантажити таблицю.</p>`;
}

function renderLeaderboardList(users: LeaderboardUser[]): string {
  if (!users.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  let lastPoints: number | null = null;
  let currentRank = 0;
  const rows = users
    .map((user, index) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : STARTING_POINTS;
      if (lastPoints === null || points !== lastPoints) {
        currentRank += 1;
        lastPoints = points;
      }
      const avatarLogo = getAvatarLogoPath(user.avatar_choice);
      const avatar = avatarLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(avatarLogo)}" alt="" />`
        : user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      const isSelf = currentUserId === user.id;
      return `
        <div class="leaderboard-row ${isSelf ? "is-self" : ""}">
          <span class="leaderboard-rank">${currentRank}</span>
          <div class="leaderboard-identity">
            ${avatar}
            <span class="leaderboard-name">${escapeHtml(name)}</span>
          </div>
          <span class="leaderboard-points">${points}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="leaderboard-rows">${rows}</div>`;
}

function formatTelegramName(user?: TelegramWebAppUser): string {
  if (!user) {
    return "";
  }

  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return "";
}

function formatUserName(user: LeaderboardUser): string {
  if (user.nickname) {
    return user.nickname;
  }
  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return "";
}

function formatPredictionName(user: PredictionUser | null): string {
  if (!user) {
    return "Гравець";
  }
  if (user.nickname) {
    return user.nickname;
  }
  const first = user.first_name?.trim() ?? "";
  const last = user.last_name?.trim() ?? "";
  const full = [first, last].filter(Boolean).join(" ").trim();
  if (full) {
    return full;
  }
  if (user.username) {
    return `@${user.username}`;
  }
  return "Гравець";
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

function formatKyivDateLabel(dateString: string): string {
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) {
    return dateString;
  }
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long"
  }).format(date);
}

function addKyivDays(dateString: string, delta: number): string {
  const [yearRaw, monthRaw, dayRaw] = dateString.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) {
    return getKyivDateString();
  }
  const baseUtc = Date.UTC(year, month - 1, day, 12);
  const nextDate = new Date(baseUtc + delta * 24 * 60 * 60 * 1000);
  return getKyivDateString(nextDate);
}

function formatKyivDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatKyivTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toKyivISOString(dateTimeLocal: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeLocal)) {
    return null;
  }
  const base = new Date(`${dateTimeLocal}:00Z`);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  const offset = getTimeZoneOffset(base, "Europe/Kyiv");
  return new Date(base.getTime() - offset).toISOString();
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
