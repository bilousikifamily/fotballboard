import "./style.css";
import { ALL_CLUBS, EU_CLUBS, UA_CLUBS, type AllLeagueId, type LeagueId } from "./data/clubs";

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

type CreateMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

type ResultResponse =
  | { ok: true }
  | { ok: false; error: string };

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
  has_prediction?: boolean;
};

type PredictionUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  nickname?: string | null;
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
  completed?: boolean;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let apiBase = "";
let leaderboardLoaded = false;
let currentDate = "";
let isAdmin = false;
let currentUserId: number | null = null;
let currentUser: TelegramWebAppUser | undefined;
let currentNickname: string | null = null;
let currentAvatarChoice: string | null = null;
let currentOnboarding: OnboardingInfo | null = null;
const predictionsLoaded = new Set<number>();
const matchesById = new Map<number, Match>();

const EUROPEAN_LEAGUES: Array<{ id: LeagueId; label: string; flag: string }> = [
  { id: "english-premier-league", label: "АПЛ", flag: "🇬🇧" },
  { id: "la-liga", label: "Ла Ліга", flag: "🇪🇸" },
  { id: "serie-a", label: "Серія A", flag: "🇮🇹" },
  { id: "bundesliga", label: "Бундесліга", flag: "🇩🇪" },
  { id: "ligue-1", label: "Ліга 1", flag: "🇫🇷" }
];

const MATCH_LEAGUES: Array<{ id: AllLeagueId; label: string }> = [
  { id: "ukrainian-premier-league", label: "УПЛ" },
  { id: "english-premier-league", label: "АПЛ" },
  { id: "la-liga", label: "Ла Ліга" },
  { id: "serie-a", label: "Серія A" },
  { id: "bundesliga", label: "Бундесліга" },
  { id: "ligue-1", label: "Ліга 1" }
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
      points: typeof payload.points_total === "number" ? payload.points_total : 0
    };

    const onboarding = payload.onboarding ?? { completed: false };
    currentOnboarding = onboarding;
    currentNickname = onboarding.nickname ?? null;
    currentAvatarChoice = onboarding.avatar_choice ?? null;

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
    const header = `
      <div class="onboarding-header">
        <span class="onboarding-step">${stepTitle}</span>
        <h1>Налаштуй профіль</h1>
      </div>
    `;

    let body = "";
    if (state.step === 1) {
      body = `
        <p class="muted onboarding-question">Хто краще Реал чи Барселона?</p>
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
        <p class="muted">Обери український клуб або пропусти.</p>
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
        <p class="muted">Обери європейський клуб або пропусти.</p>
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
            <span>Нікнейм</span>
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
    const response = await fetch(`${apiBase}/api/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        classico_choice: state.classicoChoice,
        ua_club_id: state.uaClubId,
        eu_club_id: state.euClubId,
        nickname,
        avatar_choice: avatarChoice
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
    currentUser = user;
    currentOnboarding = {
      classico_choice: state.classicoChoice,
      ua_club_id: state.uaClubId,
      eu_club_id: state.euClubId,
      nickname,
      avatar_choice: avatarChoice,
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
  const resolvedLeague =
    (match.league_id as AllLeagueId | null) ||
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
  const avatarOptions = buildAvatarOptions(currentOnboarding);
  const avatarContent = renderAvatarContent(user, currentAvatarChoice);
  const hasAvatarOptions = avatarOptions.length > 0;
  const avatar = hasAvatarOptions
    ? `
      <button class="avatar-button" type="button" data-avatar-toggle aria-expanded="false">
        ${avatarContent}
      </button>
    `
    : avatarContent;
  const avatarPickerMarkup = hasAvatarOptions
    ? `
      <div class="avatar-picker" data-avatar-picker>
        <p class="muted small">Обери логотип для аватарки.</p>
        <div class="logo-grid avatar-grid">
          ${avatarOptions
            .map((option) =>
              renderClubChoice({
                id: option.choice,
                name: option.name,
                logo: option.logo,
                selected: option.choice === currentAvatarChoice,
                dataAttr: "data-avatar-choice"
              })
            )
            .join("")}
        </div>
        <p class="muted small" data-avatar-status></p>
      </div>
    `
    : "";
  const safeDate = escapeAttribute(date || getKyivDateString());
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
      </section>
    `
    : "";

  app.innerHTML = `
    <main class="layout">
      <section class="panel profile center">
        ${avatar}
        ${safeName ? `<h1>${safeName}</h1>` : ""}
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
        ${avatarPickerMarkup}
      </section>

      <p class="muted small notice">Прогнози приймаються за 60 хв до старту.</p>

      <section class="panel matches">
        <div class="section-header">
          <h2>Матчі</h2>
          <input class="date-input" type="date" value="${safeDate}" data-date />
        </div>
        <div class="matches-list" data-matches></div>
      </section>

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

  const dateInput = app.querySelector<HTMLInputElement>("[data-date]");
  if (dateInput) {
    dateInput.addEventListener("change", () => {
      const nextDate = dateInput.value;
      if (!nextDate) {
        return;
      }
      currentDate = nextDate;
      void loadMatches(nextDate);
    });
  }

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
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    const resultForm = app.querySelector<HTMLFormElement>("[data-admin-result-form]");

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
  } catch {
    container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
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
}

function setupAdminMatchForm(form: HTMLFormElement): void {
  const leagueSelect = form.querySelector<HTMLSelectElement>("[data-admin-league]");
  const homeSelect = form.querySelector<HTMLSelectElement>("[data-admin-home]");
  const awaySelect = form.querySelector<HTMLSelectElement>("[data-admin-away]");
  if (!leagueSelect || !homeSelect || !awaySelect) {
    return;
  }

  const renderClubOptions = (leagueId: AllLeagueId): string => {
    const clubs = ALL_CLUBS[leagueId] ?? [];
    const options = clubs
      .map((clubId) => `<option value="${clubId}">${escapeHtml(formatClubName(clubId))}</option>`)
      .join("");
    return `<option value="">Обери клуб</option>${options}`;
  };

  const setClubOptions = (leagueId: AllLeagueId): void => {
    homeSelect.innerHTML = renderClubOptions(leagueId);
    awaySelect.innerHTML = renderClubOptions(leagueId);
  };

  const initialLeague = (leagueSelect.value as AllLeagueId) || MATCH_LEAGUES[0]?.id;
  if (initialLeague) {
    leagueSelect.value = initialLeague;
    setClubOptions(initialLeague);
  }

  leagueSelect.addEventListener("change", () => {
    const leagueId = leagueSelect.value as AllLeagueId;
    if (!leagueId) {
      return;
    }
    setClubOptions(leagueId);
  });
}

function renderAdminMatchOptions(matches: Match[]): void {
  const select = app.querySelector<HTMLSelectElement>("[data-admin-match]");
  if (!select) {
    return;
  }

  if (!matches.length) {
    select.innerHTML = `<option value="">Немає матчів</option>`;
    select.disabled = true;
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
  const others = currentUserId
    ? predictions.filter((item) => item.user_id !== currentUserId)
    : predictions;

  const rows = renderPredictionRows(self, others);

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

function renderMatchesList(matches: Match[]): string {
  if (!matches.length) {
    return `<p class="muted">Немає матчів на цю дату.</p>`;
  }

  return matches
    .map((match) => {
      const { homeName, awayName, homeLogo, awayLogo } = getMatchTeamInfo(match);
      const homeLogoMarkup = renderTeamLogo(homeName, homeLogo);
      const awayLogoMarkup = renderTeamLogo(awayName, awayLogo);
      const kickoff = formatKyivDateTime(match.kickoff_at);
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
            <button class="button small-button" type="submit">Прогноз</button>
            <p class="muted small" data-prediction-status></p>
          </form>
        `;

      return `
        <article class="match ${predicted ? "has-prediction" : ""}">
          <div class="match-header">
            <div class="match-time">${kickoff}</div>
            ${result}
          </div>
          <div class="match-average" data-match-average data-match-id="${match.id}"></div>
          ${predicted ? "" : `
            <button class="link-button" type="button" data-predictions-toggle data-match-id="${match.id}">
              Прогнози
            </button>
          `}
          ${closed ? "" : statusLine}
          ${form}
          <div class="predictions" data-predictions data-match-id="${match.id}" ${
            predicted ? "data-auto-open='true'" : ""
          }></div>
          ${closed ? statusLine : ""}
        </article>
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

  const rows = users
    .map((user, index) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : 0;
      const avatarLogo = getAvatarLogoPath(user.avatar_choice);
      const avatar = avatarLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(avatarLogo)}" alt="" />`
        : user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      return `
        <div class="leaderboard-row">
          <span class="leaderboard-rank">${index + 1}</span>
          ${avatar}
          <span class="leaderboard-name">${escapeHtml(name)}</span>
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
