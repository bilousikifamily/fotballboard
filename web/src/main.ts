import "./style.css";
import { ALL_CLUBS, EU_CLUBS, UA_CLUBS, type LeagueId, type MatchLeagueId } from "./data/clubs";
import type {
  AvatarOption,
  FactionEntry,
  LogoPosition,
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
import { fetchAuth } from "./api/auth";
import { fetchAnalitikaTeam as fetchAnalitikaTeamApi } from "./api/analitika";
import { fetchLeaderboard } from "./api/leaderboard";
import {
  fetchMatchWeather,
  fetchMatches,
  postMatch,
  postMatchesAnnouncement,
  postOddsRefresh,
  postResult
} from "./api/matches";
import { postPrediction, fetchPredictions } from "./api/predictions";
import { postAvatarChoice, postLogoOrder, postNickname, postOnboarding } from "./api/profile";
import { ANALITIKA_TEAM_SLUGS, renderTeamMatchStatsList } from "./features/analitika";
import {
  findEuropeanClubLeague,
  formatClubName,
  getAvatarLogoPath,
  getClassicoLogoSlug,
  getClubLogoPath,
  getMatchTeamInfo
} from "./features/clubs";
import { extractCorrectScoreProbability, formatProbability } from "./features/odds";
import { formatCountdown, getMatchPredictionCloseAtMs } from "./features/predictionTime";
import { addKyivDays, formatKyivDateLabel, formatKyivDateTime, getKyivDateString } from "./formatters/dates";
import { formatPredictionName, formatTelegramName } from "./formatters/names";
import {
  formatRainProbability,
  formatTemperature,
  formatTimeInZone,
  getWeatherIcon,
  normalizeRainProbability,
  renderMatchesList,
  renderTeamLogo
} from "./screens/matches";
import { renderLeaderboardList, renderUsersError } from "./screens/leaderboard";
import { escapeAttribute, escapeHtml } from "./utils/escape";
import { toKyivISOString } from "./utils/time";

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
let predictionCountdownId: number | null = null;
const analitikaTeamCache = new Map<string, TeamMatchStat[]>();
const analitikaTeamInFlight = new Map<string, Promise<TeamMatchStat[] | null>>();
const predictionsLoaded = new Set<number>();
const matchesById = new Map<number, Match>();
const matchWeatherCache = new Map<number, number | null>();
const matchWeatherConditionCache = new Map<number, string | null>();
const matchWeatherTempCache = new Map<number, number | null>();
const matchWeatherTimezoneCache = new Map<number, string | null>();
const WEATHER_CLIENT_CACHE_MIN = 60;
const TOP_PREDICTIONS_LIMIT = 4;
const LOGO_POSITIONS = ["center", "left", "right"] as const;
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

const NOTICE_RULES = [
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
    currentLogoOrder = onboarding.logo_order ?? null;

    if (!onboarding.completed) {
      renderOnboarding(payload.user, stats, onboarding);
      return;
    }

    renderUser(payload.user, stats, isAdmin, currentDate, currentNickname, payload.profile ?? null);
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
    const { response, data } = await postOnboarding(apiBase, {
      initData,
      classico_choice: state.classicoChoice,
      ua_club_id: state.uaClubId,
      eu_club_id: state.euClubId,
      nickname,
      avatar_choice: avatarChoice,
      logo_order: logoOrder
    });
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

function renderPredictionQuality(profile: ProfileStatsPayload | null): string {
  const stats = profile?.prediction;
  const total = stats?.total ?? 0;
  const hits = stats?.hits ?? 0;
  const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
  const lastResults = stats?.last_results ?? [];
  const icons = lastResults.map((entry) => {
    if (entry.points === 5) {
      return `<span class="result-icon is-perfect" aria-hidden="true">5</span>`;
    }
    if (entry.points > 0) {
      return `<span class="result-icon is-hit" aria-hidden="true">✓</span>`;
    }
    return `<span class="result-icon is-miss" aria-hidden="true">✕</span>`;
  }).join("");
  return `
    <section class="panel profile-metrics">
      <div class="section-header">
        <h2>ЗРОБЛЕНО ${total} ПРОГНОЗІВ</h2>
      </div>
      <div class="accuracy-bar" role="img" aria-label="Точність прогнозів ${accuracy}%">
        <span class="accuracy-bar-fill" style="width: ${accuracy}%;"></span>
        <span class="accuracy-bar-text">${accuracy}%</span>
      </div>
      <div class="recent-results">
        <div class="result-icons">${icons}</div>
      </div>
    </section>
  `;
}

function getFactionDisplay(entry: FactionEntry): { name: string; logo: string | null } {
  if (entry.key === "classico_choice") {
    const classico =
      entry.value === "real_madrid" || entry.value === "barcelona" ? entry.value : null;
    const slug = getClassicoLogoSlug(classico);
    return {
      name: slug ? formatClubName(slug) : formatClubName(entry.value),
      logo: slug ? getClubLogoPath("la-liga", slug) : null
    };
  }
  if (entry.key === "eu_club_id") {
    const league = findEuropeanClubLeague(entry.value);
    return {
      name: formatClubName(entry.value),
      logo: league ? getClubLogoPath(league, entry.value) : null
    };
  }
  return {
    name: formatClubName(entry.value),
    logo: getClubLogoPath("ukrainian-premier-league", entry.value)
  };
}

function renderFactions(profile: ProfileStatsPayload | null): string {
  const factions = profile?.factions ?? [];
  const cards = factions
    .map((entry) => {
      const display = getFactionDisplay(entry);
      const name = escapeHtml(display.name);
      const logo = display.logo
        ? `<img class="faction-logo" src="${escapeAttribute(display.logo)}" alt="" />`
        : `<div class="faction-logo placeholder" aria-hidden="true"></div>`;
      const rank = entry.rank ? `№${entry.rank} У СПИСКУ` : "№— У СПИСКУ";
      return `
        <div class="faction-card">
          <div class="faction-logo-wrap">${logo}</div>
          <div class="faction-info">
            <div class="faction-name">${name}</div>
            <div class="faction-meta">${rank}</div>
          </div>
        </div>
      `;
    })
    .join("");
  const content = cards || `<p class="muted small">Фракції ще не обрані.</p>`;
  return `
    <section class="panel profile-factions">
      <div class="section-header">
        <h2>ФРАКЦІЇ</h2>
      </div>
      <div class="faction-list">
        ${content}
      </div>
    </section>
  `;
}

function renderUser(
  user: TelegramWebAppUser | undefined,
  stats: UserStats,
  admin: boolean,
  date: string,
  nickname?: string | null,
  profile?: ProfileStatsPayload | null
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
  const predictionQualityMarkup = renderPredictionQuality(profile ?? null);
  const factionsMarkup = renderFactions(profile ?? null);
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
          <button class="button secondary" type="button" data-admin-toggle-debug>DEBUG</button>
          <button class="button secondary" type="button" data-admin-announce>ПОВІДОМИТИ В БОТІ</button>
        </div>
        <p class="muted small" data-admin-announce-status></p>
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
  const tabbarClass = admin ? "tabbar is-admin" : "tabbar";

  app.innerHTML = `
    <div class="app-shell">
      <main class="layout">
        <section class="screen" data-screen="profile">
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

          ${predictionQualityMarkup}
          ${factionsMarkup}

          <div class="notice-ticker" aria-live="polite">
            <span class="notice-ticker-text" data-notice-text>
              ${escapeHtml(formatNoticeRule(NOTICE_RULES[0] ?? ""))}
            </span>
          </div>
        </section>

        <section class="screen is-active" data-screen="matches">
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
        </section>

        ${adminScreen}

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
        <button
          class="tabbar-button is-active"
          type="button"
          data-tab="matches"
          role="tab"
          aria-selected="true"
          aria-label="Прогнози"
        >
          <span class="tabbar-icon tabbar-icon--matches" aria-hidden="true"></span>
        </button>
        <button
          class="tabbar-button"
          type="button"
          data-tab="leaderboard"
          role="tab"
          aria-selected="false"
          aria-label="Таблиця"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 18V9"></path>
            <path d="M12 18V6"></path>
            <path d="M19 18v-4"></path>
          </svg>
        </button>
        ${adminTabButton}
      </nav>
    </div>
  `;

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

  setupTabs();
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
    const toggleDebug = app.querySelector<HTMLButtonElement>("[data-admin-toggle-debug]");
    const announceButton = app.querySelector<HTMLButtonElement>("[data-admin-announce]");
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    const resultForm = app.querySelector<HTMLFormElement>("[data-admin-result-form]");
    const oddsForm = app.querySelector<HTMLFormElement>("[data-admin-odds-form]");
    const debugPanel = app.querySelector<HTMLElement>("[data-admin-debug]");

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
    const { response, data } = await postLogoOrder(apiBase, {
      initData,
      logo_order: logoOrder
    });
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
  if (!container) {
    return;
  }

  container.innerHTML = `<p class="muted">Завантаження...</p>`;

  try {
    const { response, data } = await fetchMatches(apiBase, initData, date);
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
    setupMatchAnalitikaFilters();
    renderAdminMatchOptions(data.matches);
    void loadMatchWeather(data.matches);
    startPredictionCountdowns();
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
      const { response, data } = await fetchMatchWeather(apiBase, initData, match.id);
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

function setupMatchAnalitikaFilters(): void {
  const panels = app.querySelectorAll<HTMLElement>("[data-match-analitika]");
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

    const setActive = (teamSlug: string): void => {
      panel.dataset.activeTeam = teamSlug;
      buttons.forEach((button) => {
        const isActive = button.dataset.matchAnalitikaTeam === teamSlug;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const teamSlug = button.dataset.matchAnalitikaTeam || "";
        if (!teamSlug || panel.dataset.activeTeam === teamSlug) {
          return;
        }
        setActive(teamSlug);
        void loadMatchAnalitika(panel, teamSlug);
      });
    });

    if (defaultSlug) {
      setActive(defaultSlug);
      void loadMatchAnalitika(panel, defaultSlug);
    }
  });
}

async function loadMatchAnalitika(panel: HTMLElement, teamSlug: string): Promise<void> {
  const container = panel.querySelector<HTMLElement>("[data-match-analitika-content]");
  if (!container) {
    return;
  }

  if (!ANALITIKA_TEAM_SLUGS.has(teamSlug)) {
    container.innerHTML = "";
    return;
  }

  if (panel.dataset.loading === teamSlug) {
    return;
  }
  panel.dataset.loading = teamSlug;
  container.innerHTML = "";

  const items = await fetchAnalitikaTeam(teamSlug);
  if (!items) {
    container.innerHTML = `<p class="muted">Не вдалося завантажити дані.</p>`;
    panel.dataset.loading = "";
    return;
  }

  if (!items.length) {
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
    const { response, data } = await postMatch(apiBase, {
      initData,
      home_team: home,
      away_team: away,
      league_id: leagueId,
      home_club_id: homeClubId,
      away_club_id: awayClubId,
      kickoff_at: kickoff
    });
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
    const { response, data } = await postResult(apiBase, {
      initData,
      match_id: matchId,
      home_score: homeScore,
      away_score: awayScore
    });
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
    if (tab === "leaderboard") {
      void loadLeaderboard();
    }
  };

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      if (!tab) {
        return;
      }
      setActive(tab);
    });
  });
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
    if (form && data.predictions.some((item) => item.user_id === currentUserId)) {
      form.classList.add("is-hidden");
    }
    predictionsLoaded.add(matchId);
  } catch {
    container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
  }
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

function updatePredictionCountdowns(): void {
  const elements = app.querySelectorAll<HTMLElement>("[data-prediction-countdown]");
  if (!elements.length) {
    return;
  }

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
      startingPoints: STARTING_POINTS
    });
    leaderboardLoaded = true;
  } catch {
    renderUsersError(container);
  }
}
