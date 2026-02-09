import { ALL_CLUBS } from "./data/clubs";
import { formatClubName } from "./features/clubs";
import type { LeaderboardUser, Match, OddsRefreshDebug, PredictionAccuracyMatch, PredictionAccuracyUser } from "./types";
import {
  fetchMatches,
  fetchPendingMatches,
  postFactionPredictionsStats,
  postMatch,
  postMatchesAnnouncement,
  postManualOdds,
  postOddsRefresh,
  postResult,
  postConfirmMatch
} from "./api/matches";
import { fetchBotLogs, fetchPredictionAccuracy, postAdminLogin, postChannelWebapp } from "./api/admin";
import { fetchLeaderboard } from "./api/leaderboard";
import { renderAdminMatchAccuracy, renderAdminPlayerAccuracy, renderAdminUserSessions } from "./screens/adminUsers";
import { renderPendingMatchesList } from "./screens/matches";
import { formatKyivDateLabel, formatKyivDateTime, formatKyivMonthLabel, getKyivDateString } from "./formatters/dates";
import { toKyivISOString } from "./utils/time";

const API_BASE = import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");
let adminSessionToken: string | null = null;
const ADMIN_TOKEN_KEY = "admin_token";
const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? "";
const BUILD_TIME = import.meta.env.VITE_BUILD_TIME ?? "";

const MATCH_LEAGUES: Array<{ id: string; label: string }> = [
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

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const adminPanel = document.querySelector<HTMLElement>("[data-admin-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const buildBadge = document.querySelector<HTMLElement>("[data-admin-build]");
const filterButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-admin-filter]"));
const actionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-admin-action]"));
const actionGroups = Array.from(document.querySelectorAll<HTMLElement>("[data-admin-actions-group]"));
const panelContents = Array.from(document.querySelectorAll<HTMLElement>("[data-admin-panel-content]"));
const addForm = document.querySelector<HTMLFormElement>("[data-admin-add-form]");
const resultForm = document.querySelector<HTMLFormElement>("[data-admin-result-form]");
const announceButton = document.querySelector<HTMLButtonElement>("[data-admin-announce]");
const predictionsStatsButton = document.querySelector<HTMLButtonElement>("[data-admin-predictions-stats]");
const channelWebappButton = document.querySelector<HTMLButtonElement>("[data-admin-channel-webapp]");
const addStatus = document.querySelector<HTMLElement>("[data-admin-add-status]");
const resultStatus = document.querySelector<HTMLElement>("[data-admin-result-status]");
const announceStatus = document.querySelector<HTMLElement>("[data-admin-announce-status]");
const predictionsStatsStatus = document.querySelector<HTMLElement>("[data-admin-predictions-stats-status]");
const channelWebappStatus = document.querySelector<HTMLElement>("[data-admin-channel-webapp-status]");
const pendingList = document.querySelector<HTMLElement>("[data-admin-pending-list]");
const pendingStatus = document.querySelector<HTMLElement>("[data-admin-pending-status]");
const usersList = document.querySelector<HTMLElement>("[data-admin-users-list]");
const usersStatus = document.querySelector<HTMLElement>("[data-admin-users-status]");
const usersMatchStatsList = document.querySelector<HTMLElement>("[data-admin-users-match-stats-list]");
const usersMatchStatsStatus = document.querySelector<HTMLElement>("[data-admin-users-match-stats-status]");
const usersPlayerStatsList = document.querySelector<HTMLElement>("[data-admin-users-player-stats-list]");
const usersPlayerStatsStatus = document.querySelector<HTMLElement>("[data-admin-users-player-stats-status]");
const usersMatchStatsDateLabel = document.querySelector<HTMLElement>("[data-admin-match-stats-date-label]");
const usersMatchStatsDatePrev = document.querySelector<HTMLButtonElement>("[data-admin-match-stats-date-prev]");
const usersMatchStatsDateNext = document.querySelector<HTMLButtonElement>("[data-admin-match-stats-date-next]");
const usersPlayerStatsMonthLabel = document.querySelector<HTMLElement>("[data-admin-player-stats-month-label]");
const usersPlayerStatsMonthPrev = document.querySelector<HTMLButtonElement>("[data-admin-player-stats-month-prev]");
const usersPlayerStatsMonthNext = document.querySelector<HTMLButtonElement>("[data-admin-player-stats-month-next]");
const leagueSelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-league]') ?? null;
const homeSelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-home]') ?? null;
const awaySelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-away]') ?? null;
const resultMatchSelect = resultForm?.querySelector<HTMLSelectElement>('[data-admin-result-match]') ?? null;
const logsContent = document.querySelector<HTMLElement>("[data-admin-logs-content]");
const logsClearButton = document.querySelector<HTMLButtonElement>("[data-admin-logs-clear]");
const logsRefreshButton = document.querySelector<HTMLButtonElement>("[data-admin-logs-refresh]");
const channelWebappCaption = document.querySelector<HTMLTextAreaElement>("[data-admin-channel-caption]");

const state = {
  matches: [] as Match[],
  pending: [] as Match[],
  leaderboard: [] as LeaderboardUser[],
  leaderboardLoaded: false,
  accuracyMatches: [] as PredictionAccuracyMatch[],
  accuracyUsers: [] as PredictionAccuracyUser[],
  accuracyLoaded: false,
  accuracyDates: [] as string[],
  selectedAccuracyDate: null as string | null,
  accuracyMonths: [] as string[],
  selectedAccuracyMonth: null as string | null,
  accuracyUsersByMonth: {} as Record<string, PredictionAccuracyUser[]>
};

type LogLevel = "error" | "warn" | "info" | "log";

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  args?: unknown[];
}

const logs: LogEntry[] = [];
const MAX_LOGS = 200;
let botLogsPoller: number | null = null;
let lastBotLogId = 0;
let currentAdminFilter: "matches" | "users" = "matches";
let currentActivePanel = "add-match";

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("uk-UA", { hour12: false });
}

function addLog(level: LogLevel, message: string, ...args: unknown[]): void {
  logs.push({
    timestamp: Date.now(),
    level,
    message,
    args: args.length > 0 ? args : undefined
  });

  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  renderLogs();
}

function formatLogArg(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

function renderLogs(): void {
  if (!logsContent) {
    return;
  }

  if (logs.length === 0) {
    logsContent.innerHTML = "";
    return;
  }

  logsContent.innerHTML = logs
    .map((log) => {
      const time = formatLogTime(log.timestamp);
      let message = log.message;
      if (log.args && log.args.length > 0) {
        const formattedArgs = log.args.map(formatLogArg).join("\n");
        message = `${message}\n${formattedArgs}`;
      }
      return `<div class="admin-log-entry admin-log-entry--${log.level}">
        <span class="admin-log-entry__time">[${time}]</span>
        <span>${escapeHtml(message)}</span>
      </div>`;
    })
    .join("");
  
  logsContent.scrollTop = logsContent.scrollHeight;
}

function clearLogs(): void {
  logs.length = 0;
  renderLogs();
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function describeOddsDebug(debug?: OddsRefreshDebug | null): string {
  if (!debug) {
    return "";
  }
  const parts: string[] = [];
  const pushIf = (label: string, value: unknown) => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === "string" && value.trim() === "") {
      return;
    }
    parts.push(`${label}: ${value}`);
  };
  pushIf("league", debug.leagueId ?? debug.apiLeagueId);
  pushIf("kickoff", debug.kickoffAt);
  pushIf("fallback", debug.fallbackReason);
  pushIf("fixture", debug.fixtureId);
  pushIf("home status", debug.homeTeamSearchStatus);
  pushIf("away status", debug.awayTeamSearchStatus);
  pushIf("home match score", debug.homeTeamMatchScore);
  pushIf("away match score", debug.awayTeamMatchScore);
  pushIf("home match", debug.homeTeamMatchedName);
  pushIf("away match", debug.awayTeamMatchedName);
  if (Array.isArray(debug.homeTeamSearchDetails) && debug.homeTeamSearchDetails.length) {
    const summary = debug.homeTeamSearchDetails
      .map((detail) => `${detail.query}(${detail.status})`)
      .join(", ");
    pushIf("home searches", summary);
  }
  if (Array.isArray(debug.awayTeamSearchDetails) && debug.awayTeamSearchDetails.length) {
    const summary = debug.awayTeamSearchDetails
      .map((detail) => `${detail.query}(${detail.status})`)
      .join(", ");
    pushIf("away searches", summary);
  }
  return parts.join(" | ");
}

function setupLogging(): void {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalLog = console.log;

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    addLog("error", args.map((arg) => String(arg)).join(" "), ...args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    addLog("warn", args.map((arg) => String(arg)).join(" "), ...args);
  };

  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args);
    addLog("info", args.map((arg) => String(arg)).join(" "), ...args);
  };

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    addLog("log", args.map((arg) => String(arg)).join(" "), ...args);
  };

  window.addEventListener("error", (event) => {
    addLog("error", `Uncaught Error: ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    addLog("error", `Unhandled Promise Rejection: ${event.reason}`, event.reason);
  });
}

function setDefaultKickoffAt(): void {
  if (!addForm) {
    return;
  }
  const input = addForm.querySelector<HTMLInputElement>('input[name="kickoff_at"]');
  if (!input) {
    return;
  }
  const date = getKyivDateString();
  input.value = `${date}T22:00`;
}

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  adminPanel?.classList.add("is-hidden");
}

function showAdmin(): void {
  loginPanel?.classList.add("is-hidden");
  adminPanel?.classList.remove("is-hidden");
  setAdminFilter("matches");
  updateActivePanel("add-match");
}

function getAdminToken(): string {
  return adminSessionToken ?? "";
}

function updateBuildBadge(): void {
  if (!buildBadge) {
    return;
  }
  const baseLabel = BUILD_ID ? `build ${BUILD_ID}` : `build ${import.meta.env.MODE ?? "local"}`;
  const suffix = BUILD_TIME ? ` ${BUILD_TIME}` : "";
  buildBadge.textContent = `${baseLabel}${suffix}`;
}

function updateActivePanel(action: string): void {
  currentActivePanel = action;
  panelContents.forEach((panel) => {
    const target = panel.dataset.adminPanelContent ?? "";
    panel.classList.toggle("is-hidden", target !== action);
  });
  actionButtons.forEach((button) => {
    const target = button.dataset.adminAction ?? "";
    button.classList.toggle("is-active", target === action);
  });
}

function setAdminFilter(filter: "matches" | "users"): void {
  currentAdminFilter = filter;
  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.adminFilter === filter);
  });
  actionGroups.forEach((group) => {
    group.classList.toggle("is-visible", group.dataset.adminActionsGroup === filter);
  });

  if (filter === "users") {
    updateActivePanel("users");
    if (!state.leaderboardLoaded) {
      void loadLeaderboard();
    }
    return;
  }
  if (currentActivePanel === "users") {
    updateActivePanel("add-match");
  }
}

function isActionAvailableForCurrentFilter(action: string): boolean {
  if (currentAdminFilter === "users") {
    return action === "users" || action === "users-match-stats" || action === "users-player-stats";
  }
  return action !== "users" && action !== "users-match-stats" && action !== "users-player-stats";
}

function setStatus(element: HTMLElement | null, message: string): void {
  if (!element) {
    return;
  }
  element.textContent = message;
}

function populateLeagueOptions(): void {
  if (!leagueSelect) {
    return;
  }
  leagueSelect.innerHTML = MATCH_LEAGUES.map((league) => `<option value="${league.id}">${league.label}</option>`).join("");
}

function populateClubOptions(leagueId: string): void {
  const clubs = ALL_CLUBS[leagueId as keyof typeof ALL_CLUBS] ?? [];
  const markup = clubs.map((clubId) => `<option value="${clubId}">${formatClubName(clubId)}</option>`).join("");
  if (homeSelect) {
    homeSelect.innerHTML = `<option value="">Оберіть команду</option>${markup}`;
  }
  if (awaySelect) {
    awaySelect.innerHTML = `<option value="">Оберіть команду</option>${markup}`;
  }
}

function formatMatchOption(match: Match): string {
  const display = formatKyivDateTime(match.kickoff_at);
  return `${display} · ${match.home_team} — ${match.away_team}`;
}

function updateMatchSelects(): void {
  if (!resultMatchSelect) {
    return;
  }
  
  addLog("info", `Завантажено матчів: ${state.matches.length}`);
  
  if (state.matches.length === 0) {
    resultMatchSelect.innerHTML = `<option value="">Немає матчів для введення результатів</option>`;
    addLog("warn", "Немає матчів взагалі");
    return;
  }
  
  // Показуємо тільки матчі без введеного результату
  const resultMatches = state.matches.filter((match) => {
    return match.home_score === null || match.away_score === null;
  });
  
  addLog("info", `Матчів без результату: ${resultMatches.length} з ${state.matches.length}`);
  
  if (!resultMatches.length) {
    resultMatchSelect.innerHTML = `<option value="">Всі матчі вже мають введені результати</option>`;
    addLog("info", "Всі матчі вже мають введені результати");
    return;
  }
  
  // Сортуємо матчі: спочатку ті, що розпочалися/завершилися, потім заплановані
  resultMatches.sort((a, b) => {
    const aStarted = a.status === "started" || a.status === "finished";
    const bStarted = b.status === "started" || b.status === "finished";
    if (aStarted !== bStarted) {
      return aStarted ? -1 : 1;
    }
    const aKickoff = a.kickoff_at ? new Date(a.kickoff_at).getTime() : 0;
    const bKickoff = b.kickoff_at ? new Date(b.kickoff_at).getTime() : 0;
    return bKickoff - aKickoff; // Новіші спочатку
  });
  
  const options = resultMatches
    .map((match) => {
      const hasResult = match.home_score !== null && match.away_score !== null;
      const resultLabel = hasResult ? ` [${match.home_score}:${match.away_score}]` : "";
      const statusLabel = match.status === "started" ? " (розпочався)" : match.status === "finished" ? " (завершено)" : "";
      return `<option value="${match.id}">${formatMatchOption(match)}${statusLabel}${resultLabel}</option>`;
    })
    .join("");
  resultMatchSelect.innerHTML = `<option value="">Оберіть матч</option>${options}`;
}

async function loadMatches(): Promise<void> {
  if (!API_BASE) {
    return;
  }

  setStatus(pendingStatus, "Завантаження матчів…");
  try {
    const token = getAdminToken();
    if (!token) {
      setStatus(pendingStatus, "Ви не авторизовані.");
      return;
    }
    // Для адміна завантажуємо всі матчі без фільтрації по даті
    // Робимо запит без параметра date, щоб отримати всі матчі
    const { response, data } = await fetchMatches(API_BASE, "", "", token);
    if (!response.ok || !data.ok || !data.matches) {
      setStatus(pendingStatus, "Не вдалося завантажити матчі.");
      addLog("error", "Помилка при завантаженні матчів", { response, data });
      return;
    }
    
    state.matches = data.matches;
    setStatus(pendingStatus, "");
    updateMatchSelects();
  } catch (error) {
    setStatus(pendingStatus, "Не вдалося завантажити матчі.");
    addLog("error", "Помилка при завантаженні матчів", error);
  }
}

async function loadPendingMatches(): Promise<void> {
  if (!API_BASE) {
    return;
  }

  setStatus(pendingStatus, "Завантаження списку…");
  try {
    const token = getAdminToken();
    if (!token) {
      setStatus(pendingStatus, "Ви не авторизовані.");
      return;
    }
    const { response, data } = await fetchPendingMatches(API_BASE, "", token);
    if (!response.ok || !data.ok) {
      const errorMsg = `Не вдалося завантажити очікування. Status: ${response.status}, Error: ${data.error ?? "unknown"}`;
      setStatus(pendingStatus, "Не вдалося завантажити очікування.");
      addLog("error", errorMsg, { response, data });
      return;
    }
    state.pending = data.matches;
    setStatus(pendingStatus, state.pending.length ? "" : "Немає матчів на підтвердження.");
    if (pendingList) {
      pendingList.innerHTML = renderPendingMatchesList(state.pending);
    }
  } catch (error) {
    setStatus(pendingStatus, "Не вдалося завантажити очікування.");
    addLog("error", "Помилка при завантаженні очікування", error);
  }
}

async function handlePendingAction(event: Event): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-fetch-odds]");
  if (target) {
    const matchId = Number.parseInt(target.dataset.adminFetchOdds ?? "", 10);
    if (!Number.isFinite(matchId)) {
      return;
    }
    setStatus(pendingStatus, "Оновлення коефіцієнтів…");
    try {
      const token = getAdminToken();
      if (!token) {
        setStatus(pendingStatus, "Ви не авторизовані.");
        return;
      }
      const { response, data } = await postOddsRefresh(API_BASE, { initData: "", match_id: matchId, debug: true }, token);
      if (!response.ok || !data?.ok) {
        const reasonSummary = describeOddsDebug(data?.debug);
        const detail = data?.detail ? `, Detail: ${data.detail}` : "";
        const reasonSuffix = reasonSummary ? ` (${reasonSummary})` : "";
        const errorMsg = `Не вдалося підтягнути коефіцієнти для матчу ${matchId}. Status: ${response.status}${detail}, Error: ${data?.error ?? "unknown"}${reasonSuffix}`;
        setStatus(pendingStatus, "Не вдалося підтягнути коефіцієнти.");
        addLog("error", errorMsg, { response, data });
        return;
      }
      setStatus(pendingStatus, "Коефіцієнти оновлено ✅");
      await loadPendingMatches();
    } catch (error) {
      setStatus(pendingStatus, "Не вдалося підтягнути коефіцієнти.");
      addLog("error", `Помилка при оновленні коефіцієнтів для матчу ${matchId}`, error);
    }
    return;
  }

  const manualOddsButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-save-odds]");
  if (manualOddsButton) {
    const matchId = Number.parseInt(manualOddsButton.dataset.adminSaveOdds ?? "", 10);
    if (!Number.isFinite(matchId)) {
      return;
    }
    const card = manualOddsButton.closest<HTMLElement>("[data-admin-pending-card]");
    const homeInput = card?.querySelector<HTMLInputElement>("[data-admin-odds-home]");
    const drawInput = card?.querySelector<HTMLInputElement>("[data-admin-odds-draw]");
    const awayInput = card?.querySelector<HTMLInputElement>("[data-admin-odds-away]");
    const homeOdd = Number.parseFloat(homeInput?.value ?? "");
    const drawOdd = Number.parseFloat(drawInput?.value ?? "");
    const awayOdd = Number.parseFloat(awayInput?.value ?? "");
    if (!Number.isFinite(homeOdd) || !Number.isFinite(drawOdd) || !Number.isFinite(awayOdd)) {
      setStatus(pendingStatus, "Вкажіть усі коефіцієнти.");
      return;
    }
    setStatus(pendingStatus, "Збереження коефіцієнтів…");
    try {
      const token = getAdminToken();
      if (!token) {
        setStatus(pendingStatus, "Ви не авторизовані.");
        return;
      }
      const { response, data } = await postManualOdds(
        API_BASE,
        { initData: "", match_id: matchId, home_odd: homeOdd, draw_odd: drawOdd, away_odd: awayOdd },
        token
      );
      if (!response.ok || !data.ok) {
        setStatus(pendingStatus, "Не вдалося зберегти коефіцієнти.");
        addLog("error", `Не вдалося зберегти коефіцієнти для матчу ${matchId}. Status: ${response.status}, Error: ${data.error}`);
        return;
      }
      setStatus(pendingStatus, "Коефіцієнти збережено ✅");
      await loadPendingMatches();
    } catch (error) {
      setStatus(pendingStatus, "Не вдалося зберегти коефіцієнти.");
      addLog("error", `Помилка при збереженні коефіцієнтів для матчу ${matchId}`, error);
    }
    return;
  }

  const confirmButton = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-confirm-match]");
  if (confirmButton) {
    const matchId = Number.parseInt(confirmButton.dataset.adminConfirmMatch ?? "", 10);
    if (!Number.isFinite(matchId)) {
      return;
    }
    setStatus(pendingStatus, "Підтвердження матчу…");
    try {
      const token = getAdminToken();
      if (!token) {
        setStatus(pendingStatus, "Ви не авторизовані.");
        return;
      }
      const { response, data } = await postConfirmMatch(API_BASE, { initData: "", match_id: matchId }, token);
      if (!response.ok || !data.ok) {
        setStatus(pendingStatus, "Не вдалося підтвердити матч.");
        return;
      }
      setStatus(pendingStatus, "Матч підтверджено ✅");
      await Promise.all([loadMatches(), loadPendingMatches()]);
    } catch {
      setStatus(pendingStatus, "Не вдалося підтвердити матч.");
    }
  }
}

async function loadLeaderboard(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  setStatus(usersStatus, "Завантаження користувачів…");
  try {
    const token = getAdminToken();
    if (!token) {
      setStatus(usersStatus, "Ви не авторизовані.");
      return;
    }
    const { response, data } = await fetchLeaderboard(API_BASE, "", 200, token);
    if (!response.ok || !data.ok) {
      setStatus(usersStatus, "Не вдалося завантажити користувачів.");
      return;
    }
    state.leaderboard = data.users;
    state.leaderboardLoaded = true;
    if (usersList) {
      usersList.innerHTML = renderAdminUserSessions(state.leaderboard);
    }
    setStatus(usersStatus, "");
  } catch {
    setStatus(usersStatus, "Не вдалося завантажити користувачів.");
  }
}

function getMatchKyivDate(match: PredictionAccuracyMatch): string {
  return getKyivDateString(new Date(match.kickoff_at));
}

function getMatchKyivMonth(match: PredictionAccuracyMatch): string {
  return getMatchKyivDate(match).slice(0, 7);
}

function updateAccuracyDateNavigationState(): void {
  const dates = state.accuracyDates;
  const selected = state.selectedAccuracyDate;
  if (!usersMatchStatsDateLabel) {
    return;
  }
  if (!dates.length || !selected) {
    usersMatchStatsDateLabel.textContent = "Немає матчів";
    if (usersMatchStatsDatePrev) usersMatchStatsDatePrev.disabled = true;
    if (usersMatchStatsDateNext) usersMatchStatsDateNext.disabled = true;
    return;
  }
  const index = dates.indexOf(selected);
  const safeIndex = index >= 0 ? index : 0;
  usersMatchStatsDateLabel.textContent = formatKyivDateLabel(dates[safeIndex]);
  if (usersMatchStatsDatePrev) {
    usersMatchStatsDatePrev.disabled = safeIndex >= dates.length - 1;
  }
  if (usersMatchStatsDateNext) {
    usersMatchStatsDateNext.disabled = safeIndex <= 0;
  }
}

function moveAccuracyDate(delta: number): void {
  if (!state.accuracyDates.length || !state.selectedAccuracyDate) {
    return;
  }
  const currentIndex = state.accuracyDates.indexOf(state.selectedAccuracyDate);
  const nextIndex = Math.max(0, Math.min(state.accuracyDates.length - 1, currentIndex + delta));
  if (nextIndex === currentIndex) {
    return;
  }
  state.selectedAccuracyDate = state.accuracyDates[nextIndex];
  renderPredictionAccuracyPanels();
}

function updatePlayerMonthNavigationState(): void {
  const months = state.accuracyMonths;
  const selected = state.selectedAccuracyMonth;
  if (!usersPlayerStatsMonthLabel) {
    return;
  }
  if (!months.length || !selected) {
    usersPlayerStatsMonthLabel.textContent = "Немає місяців";
    if (usersPlayerStatsMonthPrev) usersPlayerStatsMonthPrev.disabled = true;
    if (usersPlayerStatsMonthNext) usersPlayerStatsMonthNext.disabled = true;
    return;
  }
  const index = months.indexOf(selected);
  const safeIndex = index >= 0 ? index : 0;
  usersPlayerStatsMonthLabel.textContent = formatKyivMonthLabel(months[safeIndex]);
  if (usersPlayerStatsMonthPrev) {
    usersPlayerStatsMonthPrev.disabled = safeIndex >= months.length - 1;
  }
  if (usersPlayerStatsMonthNext) {
    usersPlayerStatsMonthNext.disabled = safeIndex <= 0;
  }
}

async function loadPredictionAccuracyUsersForMonth(month: string, force = false): Promise<void> {
  if (!API_BASE) {
    return;
  }
  if (state.accuracyUsersByMonth[month] && !force) {
    return;
  }
  setStatus(usersPlayerStatsStatus, "Завантаження статистики по гравцях…");
  try {
    const token = getAdminToken();
    if (!token) {
      setStatus(usersPlayerStatsStatus, "Ви не авторизовані.");
      return;
    }
    const { response, data } = await fetchPredictionAccuracy(API_BASE, token, { limit: 300, month });
    if (!response.ok || !data.ok) {
      setStatus(usersPlayerStatsStatus, "Не вдалося завантажити статистику.");
      return;
    }
    state.accuracyUsersByMonth[month] = data.users;
    if (state.selectedAccuracyMonth === month && usersPlayerStatsList) {
      usersPlayerStatsList.innerHTML = renderAdminPlayerAccuracy(data.users);
    }
    setStatus(usersPlayerStatsStatus, "");
  } catch {
    setStatus(usersPlayerStatsStatus, "Не вдалося завантажити статистику.");
  }
}

function moveAccuracyMonth(delta: number): void {
  if (!state.accuracyMonths.length || !state.selectedAccuracyMonth) {
    return;
  }
  const currentIndex = state.accuracyMonths.indexOf(state.selectedAccuracyMonth);
  const nextIndex = Math.max(0, Math.min(state.accuracyMonths.length - 1, currentIndex + delta));
  if (nextIndex === currentIndex) {
    return;
  }
  state.selectedAccuracyMonth = state.accuracyMonths[nextIndex];
  renderPredictionAccuracyPanels();
  if (state.selectedAccuracyMonth) {
    void loadPredictionAccuracyUsersForMonth(state.selectedAccuracyMonth);
  }
}

function renderPredictionAccuracyPanels(): void {
  const selectedDate = state.selectedAccuracyDate;
  const filteredMatches = selectedDate
    ? state.accuracyMatches.filter((match) => getMatchKyivDate(match) === selectedDate)
    : state.accuracyMatches;
  if (usersMatchStatsList) {
    usersMatchStatsList.innerHTML = renderAdminMatchAccuracy(filteredMatches);
  }
  if (usersPlayerStatsList) {
    const selectedMonth = state.selectedAccuracyMonth;
    const monthUsers = selectedMonth ? state.accuracyUsersByMonth[selectedMonth] : null;
    if (selectedMonth && !monthUsers) {
      usersPlayerStatsList.innerHTML = `<p class="muted small">Завантаження статистики по гравцях…</p>`;
    } else {
      usersPlayerStatsList.innerHTML = renderAdminPlayerAccuracy(monthUsers ?? []);
    }
  }
  updateAccuracyDateNavigationState();
  updatePlayerMonthNavigationState();
}

async function loadPredictionAccuracy(force = false): Promise<void> {
  if (!API_BASE) {
    return;
  }
  if (state.accuracyLoaded && !force) {
    renderPredictionAccuracyPanels();
    return;
  }
  setStatus(usersMatchStatsStatus, "Завантаження статистики по матчах…");
  setStatus(usersPlayerStatsStatus, "Завантаження статистики по гравцях…");
  try {
    const token = getAdminToken();
    if (!token) {
      setStatus(usersMatchStatsStatus, "Ви не авторизовані.");
      setStatus(usersPlayerStatsStatus, "Ви не авторизовані.");
      return;
    }
    const { response, data } = await fetchPredictionAccuracy(API_BASE, token, { limit: 300 });
    if (!response.ok || !data.ok) {
      setStatus(usersMatchStatsStatus, "Не вдалося завантажити статистику.");
      setStatus(usersPlayerStatsStatus, "Не вдалося завантажити статистику.");
      return;
    }
    state.accuracyMatches = data.matches;
    state.accuracyUsers = data.users;
    state.accuracyDates = Array.from(new Set(data.matches.map((match) => getMatchKyivDate(match)))).sort((a, b) =>
      b.localeCompare(a)
    );
    state.accuracyMonths = Array.from(new Set(data.matches.map((match) => getMatchKyivMonth(match)))).sort((a, b) =>
      b.localeCompare(a)
    );
    state.selectedAccuracyDate = state.accuracyDates[0] ?? null;
    state.selectedAccuracyMonth = state.accuracyMonths[0] ?? null;
    state.accuracyUsersByMonth = {};
    state.accuracyLoaded = true;
    renderPredictionAccuracyPanels();
    if (state.selectedAccuracyMonth) {
      void loadPredictionAccuracyUsersForMonth(state.selectedAccuracyMonth);
    }
    setStatus(usersMatchStatsStatus, "");
    setStatus(usersPlayerStatsStatus, "");
  } catch {
    setStatus(usersMatchStatsStatus, "Не вдалося завантажити статистику.");
    setStatus(usersPlayerStatsStatus, "Не вдалося завантажити статистику.");
  }
}

function parseScore(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.max(0, Math.floor(parsed));
}

function parseRating(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
    return null;
  }
  return parsed;
}

async function handleAddMatch(event: Event): Promise<void> {
  event.preventDefault();
  if (!addForm || !API_BASE) {
    return;
  }
  const leagueId = leagueSelect?.value.trim() ?? "";
  const homeClubId = homeSelect?.value ?? "";
  const awayClubId = awaySelect?.value ?? "";
  const kickoffRaw = addForm.querySelector<HTMLInputElement>("input[name=kickoff_at]")?.value ?? "";
  const kickoffAt = toKyivISOString(kickoffRaw);
  if (!leagueId || !homeClubId || !awayClubId || !kickoffAt) {
    setStatus(addStatus, "Заповніть усі поля.");
    return;
  }
  if (homeClubId === awayClubId) {
    setStatus(addStatus, "Обидві команди не можуть бути однаковими.");
    return;
  }
  const token = getAdminToken();
  if (!token) {
    setStatus(addStatus, "Ви не авторизовані.");
    return;
  }
  const payload = {
    initData: "",
    league_id: leagueId,
    home_club_id: homeClubId,
    away_club_id: awayClubId,
    home_team: formatClubName(homeClubId),
    away_team: formatClubName(awayClubId),
    kickoff_at: kickoffAt
  };
  setStatus(addStatus, "Створення матчу…");
  try {
    const { response, data } = await postMatch(API_BASE, payload, token);
    if (!response.ok || !data.ok || !data.match) {
      setStatus(addStatus, "Не вдалося додати матч.");
      return;
    }
    await postOddsRefresh(API_BASE, { initData: "", match_id: data.match.id }, token);
    setStatus(addStatus, "Матч додано. Коефіцієнти оновлені.");
    addForm.reset();
    await Promise.all([loadMatches(), loadPendingMatches()]);
  } catch {
    setStatus(addStatus, "Не вдалося створити матч.");
  }
}

async function handleResult(event: Event): Promise<void> {
  event.preventDefault();
  if (!resultForm || !API_BASE) {
    return;
  }
  const matchRaw = resultMatchSelect?.value ?? "";
  const matchId = Number.parseInt(matchRaw, 10);
  const homeScore = parseScore(resultForm.querySelector<HTMLInputElement>("input[name=home_score]")?.value);
  const awayScore = parseScore(resultForm.querySelector<HTMLInputElement>("input[name=away_score]")?.value);
  const homeRating = parseRating(resultForm.querySelector<HTMLInputElement>("input[name=home_avg_rating]")?.value);
  const awayRating = parseRating(resultForm.querySelector<HTMLInputElement>("input[name=away_avg_rating]")?.value);
  if (!Number.isFinite(matchId) || homeScore === null || awayScore === null || homeRating === null || awayRating === null) {
    setStatus(resultStatus, "Заповніть усі поля коректно.");
    return;
  }
  if (
    typeof window !== "undefined" &&
    !window.confirm(`Підтвердити рахунок ${homeScore}:${awayScore}?`)
  ) {
    return;
  }
  const token = getAdminToken();
  if (!token) {
    setStatus(resultStatus, "Ви не авторизовані.");
    return;
  }
  setStatus(resultStatus, "Збереження результату…");
  try {
    const { response, data } = await postResult(
      API_BASE,
      {
        initData: "",
        match_id: matchId,
        home_score: homeScore,
        away_score: awayScore,
        home_avg_rating: homeRating,
        away_avg_rating: awayRating
      },
      token
    );
    if (!response.ok || !data.ok) {
      setStatus(resultStatus, "Не вдалося зберегти результат.");
      return;
    }
    setStatus(resultStatus, "Результат збережено ✅");
    resultForm.reset();
    await Promise.all([loadMatches(), loadPendingMatches()]);
  } catch {
    setStatus(resultStatus, "Не вдалося зберегти результат.");
  }
}

async function handleAnnouncement(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const token = getAdminToken();
  if (!token) {
    setStatus(announceStatus, "Ви не авторизовані.");
    return;
  }
  setStatus(announceStatus, "Надсилання повідомлення…");
  try {
    const { response, data } = await postMatchesAnnouncement(API_BASE, "", token);
    if (!response.ok || !data.ok) {
      const errorMsg = `Не вдалося надіслати повідомлення. Status: ${response.status}, Error: ${data.error ?? "unknown"}`;
      setStatus(announceStatus, "Не вдалося надіслати повідомлення.");
      addLog("error", errorMsg, { response, data });
      return;
    }
    setStatus(announceStatus, "Повідомлення надіслано ✅");
    addLog("info", "Повідомлення успішно надіслано");
  } catch (error) {
    setStatus(announceStatus, "Не вдалося надіслати повідомлення.");
    addLog("error", "Помилка при надсиланні повідомлення", error);
  }
}

async function handlePredictionsStats(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const token = getAdminToken();
  if (!token) {
    setStatus(predictionsStatsStatus, "Ви не авторизовані.");
    return;
  }
  setStatus(predictionsStatsStatus, "Розрахунок та надсилання статистики…");
  addLog("info", "Початок розрахунку статистики прогнозів");
  try {
    const { response, data } = await postFactionPredictionsStats(API_BASE, "", token);
    if (!response.ok || !data.ok) {
      const errorMsg = `Не вдалося надіслати статистику. Status: ${response.status}, Error: ${data.error ?? "unknown"}`;
      setStatus(predictionsStatsStatus, "Не вдалося надіслати статистику.");
      addLog("error", errorMsg, { response, data });
      return;
    }
    setStatus(predictionsStatsStatus, "Статистику надіслано ✅");
    addLog("info", "Статистику успішно надіслано");
  } catch (error) {
    setStatus(predictionsStatsStatus, "Не вдалося надіслати статистику.");
    addLog("error", "Помилка при надсиланні статистики", error);
  }
}

async function handleChannelWebapp(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const token = getAdminToken();
  if (!token) {
    setStatus(channelWebappStatus, "Потрібен адмін-доступ.");
    return;
  }
  const caption = channelWebappCaption?.value.trim() ?? "";
  setStatus(channelWebappStatus, "Публікація в канал…");
  addLog("info", "Публікація WebApp у канал");
  try {
    const { response, data } = await postChannelWebapp(API_BASE, { caption: caption || undefined }, token);
    if (!response.ok || !data.ok) {
      const errorDetails = data && "status" in data ? ` tg:${data.status ?? "?"}` : "";
      const errorBody = data && "body" in data && data.body ? ` ${data.body}` : "";
      const errorMsg = `Не вдалося опублікувати в канал. Status: ${response.status}, Error: ${data.error ?? "unknown"}${errorDetails}${errorBody}`;
      setStatus(channelWebappStatus, "Не вдалося опублікувати в канал.");
      addLog("error", errorMsg, { response, data });
      return;
    }
    setStatus(channelWebappStatus, "Опубліковано ✅");
    addLog("info", "Повідомлення опубліковано в каналі");
  } catch (error) {
    setStatus(channelWebappStatus, "Не вдалося опублікувати в канал.");
    addLog("error", "Помилка при публікації в канал", error);
  }
}

function attachListeners(): void {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.adminFilter;
      if (filter === "matches" || filter === "users") {
        setAdminFilter(filter);
      }
    });
  });

  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.adminAction ?? "";
      if (!isActionAvailableForCurrentFilter(action)) {
        return;
      }
      if (action === "users" && !state.leaderboardLoaded) {
        void loadLeaderboard();
      }
      if ((action === "users-match-stats" || action === "users-player-stats") && !state.accuracyLoaded) {
        void loadPredictionAccuracy();
      }
      if (action === "result") {
        // Оновлюємо матчі при відкритті панелі результатів
        void loadMatches();
      }
      updateActivePanel(action);
    });
  });
  leagueSelect?.addEventListener("change", () => {
    populateClubOptions(leagueSelect.value);
  });
  addForm?.addEventListener("submit", handleAddMatch);
  resultForm?.addEventListener("submit", handleResult);
  announceButton?.addEventListener("click", () => {
    void handleAnnouncement();
  });
  channelWebappButton?.addEventListener("click", () => {
    void handleChannelWebapp();
  });
  predictionsStatsButton?.addEventListener("click", () => {
    void handlePredictionsStats();
  });
  pendingList?.addEventListener("click", (event) => {
    void handlePendingAction(event);
  });
  logsClearButton?.addEventListener("click", () => {
    clearLogs();
  });
  logsRefreshButton?.addEventListener("click", () => {
    addLog("info", "Запит bot-логів вручну…");
    void loadBotLogs(true, true);
  });
  usersMatchStatsDatePrev?.addEventListener("click", () => {
    moveAccuracyDate(1);
  });
  usersMatchStatsDateNext?.addEventListener("click", () => {
    moveAccuracyDate(-1);
  });
  usersPlayerStatsMonthPrev?.addEventListener("click", () => {
    moveAccuracyMonth(1);
  });
  usersPlayerStatsMonthNext?.addEventListener("click", () => {
    moveAccuracyMonth(-1);
  });
}

async function loadBotLogs(initial = false, verbose = false): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const token = getAdminToken();
  if (!token) {
    if (verbose) {
      addLog("warn", "Bot-логи: немає admin token.");
    }
    return;
  }
  try {
    const { response, data } = await fetchBotLogs(API_BASE, token, {
      since: lastBotLogId || undefined,
      limit: initial ? 50 : 100
    });
    if (!response.ok || !data.ok) {
      addLog("warn", "Не вдалося отримати bot-логи.", { response, data });
      return;
    }
    const logsToAdd = (data.logs ?? []).slice();
    if (!logsToAdd.length) {
      if (verbose) {
        addLog("info", "Bot-логи: нових записів немає.");
      }
      return;
    }
    logsToAdd.forEach((entry) => {
      if (entry.id > lastBotLogId) {
        lastBotLogId = entry.id;
      }
      const createdAt = entry.created_at ? ` (${entry.created_at})` : "";
      const userLabel = entry.user_id ? `user:${entry.user_id}` : "user:unknown";
      const text = entry.text ?? "bot_log";
      addLog("error", `[bot] ${userLabel}${createdAt} ${text}`);
    });
    if (verbose) {
      addLog("info", `Bot-логи: завантажено ${logsToAdd.length} запис(ів).`);
    }
  } catch (error) {
    addLog("error", "Помилка при завантаженні bot-логів", error);
  }
}

function startBotLogPolling(): void {
  if (botLogsPoller !== null) {
    window.clearInterval(botLogsPoller);
  }
  void loadBotLogs(true);
  botLogsPoller = window.setInterval(() => {
    void loadBotLogs(false);
  }, 10_000);
}

function stopBotLogPolling(): void {
  if (botLogsPoller !== null) {
    window.clearInterval(botLogsPoller);
    botLogsPoller = null;
  }
  lastBotLogId = 0;
}

async function initializeAdminView(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  await Promise.all([loadMatches(), loadPendingMatches()]);
}

async function handleLogin(event: Event): Promise<void> {
  event.preventDefault();
  if (!loginForm || !API_BASE) {
    return;
  }
  const formData = new FormData(loginForm);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    loginError && (loginError.textContent = "Введіть логін і пароль.");
    return;
  }
  const submitButton = loginForm.querySelector<HTMLButtonElement>("button[type=submit]");
  submitButton?.setAttribute("disabled", "true");
  try {
    const { response, data } = await postAdminLogin(API_BASE, { username, password });
    if (!response.ok || !data.ok || !data.token) {
      loginError && (loginError.textContent = "Невірний логін або пароль.");
      return;
    }
    adminSessionToken = data.token;
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    }
    loginError && (loginError.textContent = "");
    showAdmin();
    startBotLogPolling();
    populateLeagueOptions();
    populateClubOptions(leagueSelect?.value ?? MATCH_LEAGUES[0].id);
    setDefaultKickoffAt();
    void initializeAdminView();
  } catch (error) {
    loginError && (loginError.textContent = "Не вдалося виконати вхід.");
    addLog("error", "Помилка при авторизації", error);
  } finally {
    submitButton?.removeAttribute("disabled");
  }
}

function handleLogout(): void {
  adminSessionToken = null;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }
  stopBotLogPolling();
  state.leaderboardLoaded = false;
  state.leaderboard = [];
  state.accuracyLoaded = false;
  state.accuracyMatches = [];
  state.accuracyUsers = [];
  state.accuracyDates = [];
  state.selectedAccuracyDate = null;
  state.accuracyMonths = [];
  state.selectedAccuracyMonth = null;
  state.accuracyUsersByMonth = {};
  state.matches = [];
  state.pending = [];
  setStatus(pendingStatus, "");
  setStatus(usersStatus, "");
  setStatus(usersMatchStatsStatus, "");
  setStatus(usersPlayerStatsStatus, "");
  setStatus(addStatus, "");
  setStatus(resultStatus, "");
  setStatus(announceStatus, "");
  setStatus(predictionsStatsStatus, "");
  if (usersMatchStatsList) {
    usersMatchStatsList.innerHTML = "";
  }
  if (usersPlayerStatsList) {
    usersPlayerStatsList.innerHTML = "";
  }
  showLogin();
}

setupLogging();

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    void handleLogin(event);
  });
}
logoutButton?.addEventListener("click", handleLogout);
attachListeners();
updateBuildBadge();
if (typeof sessionStorage !== "undefined") {
  const storedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (storedToken) {
    adminSessionToken = storedToken;
    showAdmin();
    startBotLogPolling();
    populateLeagueOptions();
    populateClubOptions(leagueSelect?.value ?? MATCH_LEAGUES[0].id);
    setDefaultKickoffAt();
    void initializeAdminView();
  } else {
    showLogin();
  }
} else {
  showLogin();
}
