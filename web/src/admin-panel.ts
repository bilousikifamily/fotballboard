import { ALL_CLUBS } from "./data/clubs";
import { formatClubName } from "./features/clubs";
import type { LeaderboardUser, Match } from "./types";
import {
  fetchMatches,
  fetchPendingMatches,
  postFactionPredictionsStats,
  postMatch,
  postMatchesAnnouncement,
  postOddsRefresh,
  postResult,
  postConfirmMatch
} from "./api/matches";
import { fetchLeaderboard } from "./api/leaderboard";
import { renderAdminUserSessions } from "./screens/adminUsers";
import { renderPendingMatchesList } from "./screens/matches";
import { formatKyivDateTime, getKyivDateString } from "./formatters/dates";
import { toKyivISOString } from "./utils/time";

const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const ADMIN_TOKEN_KEY = "presentation.admin.token";
const API_BASE = import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");
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
const actionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-admin-action]"));
const panelContents = Array.from(document.querySelectorAll<HTMLElement>("[data-admin-panel-content]"));
const addForm = document.querySelector<HTMLFormElement>("[data-admin-add-form]");
const resultForm = document.querySelector<HTMLFormElement>("[data-admin-result-form]");
const announceButton = document.querySelector<HTMLButtonElement>("[data-admin-announce]");
const predictionsStatsButton = document.querySelector<HTMLButtonElement>("[data-admin-predictions-stats]");
const addStatus = document.querySelector<HTMLElement>("[data-admin-add-status]");
const resultStatus = document.querySelector<HTMLElement>("[data-admin-result-status]");
const announceStatus = document.querySelector<HTMLElement>("[data-admin-announce-status]");
const predictionsStatsStatus = document.querySelector<HTMLElement>("[data-admin-predictions-stats-status]");
const pendingList = document.querySelector<HTMLElement>("[data-admin-pending-list]");
const pendingStatus = document.querySelector<HTMLElement>("[data-admin-pending-status]");
const usersList = document.querySelector<HTMLElement>("[data-admin-users-list]");
const usersStatus = document.querySelector<HTMLElement>("[data-admin-users-status]");
const leagueSelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-league]') ?? null;
const homeSelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-home]') ?? null;
const awaySelect = addForm?.querySelector<HTMLSelectElement>('[data-admin-away]') ?? null;
const resultMatchSelect = resultForm?.querySelector<HTMLSelectElement>('[data-admin-result-match]') ?? null;
const logsContent = document.querySelector<HTMLElement>("[data-admin-logs-content]");
const logsClearButton = document.querySelector<HTMLButtonElement>("[data-admin-logs-clear]");

const state = {
  matches: [] as Match[],
  pending: [] as Match[],
  leaderboard: [] as LeaderboardUser[],
  leaderboardLoaded: false
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

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  adminPanel?.classList.add("is-hidden");
}

function showAdmin(): void {
  loginPanel?.classList.add("is-hidden");
  adminPanel?.classList.remove("is-hidden");
  updateActivePanel("add-match");
}

function getAdminToken(): string {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
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
  panelContents.forEach((panel) => {
    const target = panel.dataset.adminPanelContent ?? "";
    panel.classList.toggle("is-hidden", target !== action);
  });
  actionButtons.forEach((button) => {
    const target = button.dataset.adminAction ?? "";
    button.classList.toggle("is-active", target === action);
  });
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
  
  // Логуємо всі матчі для діагностики
  state.matches.forEach((match) => {
    const kickoffMs = match.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
    const now = Date.now();
    const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && now >= kickoffMs;
    addLog("log", `Матч ${match.id}: status=${match.status}, kickoff=${match.kickoff_at}, passed=${hasKickoffPassed}, now=${new Date(now).toISOString()}`);
  });
  
  // Фільтруємо матчі: показуємо тільки ті, які розпочалися або завершилися
  const resultMatches = state.matches.filter((match) => {
    const isStarted = match.status === "started";
    const isFinished = match.status === "finished";
    const kickoffMs = match.kickoff_at ? new Date(match.kickoff_at).getTime() : null;
    const hasKickoffPassed = kickoffMs !== null && !Number.isNaN(kickoffMs) && Date.now() >= kickoffMs;
    const shouldInclude = isStarted || isFinished || hasKickoffPassed;
    
    if (!shouldInclude) {
      addLog("log", `Матч ${match.id} пропущено: status=${match.status}, kickoff=${match.kickoff_at}`);
    }
    
    return shouldInclude;
  });
  
  addLog("info", `Відфільтровано матчів для результатів: ${resultMatches.length}`);
  
  if (!resultMatches.length) {
    resultMatchSelect.innerHTML = `<option value="">Немає матчів для введення результатів</option>`;
    addLog("warn", "Немає матчів для введення результатів після фільтрації. Перевірте логи вище.");
    return;
  }
  
  const options = resultMatches
    .map((match) => {
      const hasResult = match.home_score !== null && match.away_score !== null;
      const resultLabel = hasResult ? ` [${match.home_score}:${match.away_score}]` : "";
      return `<option value="${match.id}">${formatMatchOption(match)}${resultLabel}</option>`;
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
    // Завантажуємо матчі з кількох дат: вчора, сьогодні, завтра
    const today = getKyivDateString();
    const todayDate = new Date(today + "T00:00:00");
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const tomorrowDate = new Date(todayDate);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    
    const formatDateForApi = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    
    const dates = [
      formatDateForApi(yesterdayDate),
      today,
      formatDateForApi(tomorrowDate)
    ];
    
    const allMatches: Match[] = [];
    for (const date of dates) {
      try {
        const { response, data } = await fetchMatches(API_BASE, "", date, getAdminToken());
        if (response.ok && data.ok && data.matches) {
          allMatches.push(...data.matches);
        }
      } catch (error) {
        addLog("warn", `Не вдалося завантажити матчі на ${date}`, error);
      }
    }
    
    // Видаляємо дублікати за ID
    const uniqueMatches = new Map<number, Match>();
    for (const match of allMatches) {
      if (!uniqueMatches.has(match.id)) {
        uniqueMatches.set(match.id, match);
      }
    }
    
    state.matches = Array.from(uniqueMatches.values());
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
    const { response, data } = await fetchPendingMatches(API_BASE, "", getAdminToken());
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
      const { response, data } = await postOddsRefresh(
        API_BASE,
        { initData: "", match_id: matchId, debug: true, admin_token: getAdminToken() },
        getAdminToken()
      );
      if (!response.ok || !data?.ok) {
        setStatus(pendingStatus, "Не вдалося підтягнути коефіцієнти.");
        return;
      }
      setStatus(pendingStatus, "Коефіцієнти оновлено ✅");
      await loadPendingMatches();
    } catch {
      setStatus(pendingStatus, "Не вдалося підтягнути коефіцієнти.");
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
      const { response, data } = await postConfirmMatch(
        API_BASE,
        { initData: "", match_id: matchId, admin_token: getAdminToken() },
        getAdminToken()
      );
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
    const { response, data } = await fetchLeaderboard(API_BASE, "", 200, getAdminToken());
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
  const payload = {
    initData: "",
    admin_token: getAdminToken(),
    league_id: leagueId,
    home_club_id: homeClubId,
    away_club_id: awayClubId,
    home_team: formatClubName(homeClubId),
    away_team: formatClubName(awayClubId),
    kickoff_at: kickoffAt
  };
  setStatus(addStatus, "Створення матчу…");
  try {
    const { response, data } = await postMatch(API_BASE, payload, getAdminToken());
    if (!response.ok || !data.ok || !data.match) {
      setStatus(addStatus, "Не вдалося додати матч.");
      return;
    }
    await postOddsRefresh(API_BASE, { initData: "", match_id: data.match.id, admin_token: getAdminToken() }, getAdminToken());
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
        away_avg_rating: awayRating,
        admin_token: getAdminToken()
      },
      getAdminToken()
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
  setStatus(announceStatus, "Надсилання повідомлення…");
  try {
    const { response, data } = await postMatchesAnnouncement(API_BASE, "", getAdminToken());
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
  setStatus(predictionsStatsStatus, "Розрахунок та надсилання статистики…");
  addLog("info", "Початок розрахунку статистики прогнозів");
  try {
    const { response, data } = await postFactionPredictionsStats(API_BASE, "", getAdminToken());
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

function attachListeners(): void {
  actionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.adminAction ?? "";
      if (action === "users" && !state.leaderboardLoaded) {
        void loadLeaderboard();
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
  predictionsStatsButton?.addEventListener("click", () => {
    void handlePredictionsStats();
  });
  pendingList?.addEventListener("click", (event) => {
    void handlePendingAction(event);
  });
  logsClearButton?.addEventListener("click", () => {
    clearLogs();
  });
}

async function initializeAdminView(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  await Promise.all([loadMatches(), loadPendingMatches()]);
}

function handleLogin(event: Event): void {
  event.preventDefault();
  if (!loginForm) {
    return;
  }
  const formData = new FormData(loginForm);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (username === LOGIN_USERNAME && password === LOGIN_PASSWORD) {
    sessionStorage.setItem(AUTH_KEY, "1");
    sessionStorage.setItem(ADMIN_TOKEN_KEY, password);
    loginError && (loginError.textContent = "");
    showAdmin();
    populateLeagueOptions();
    populateClubOptions(leagueSelect?.value ?? MATCH_LEAGUES[0].id);
    void initializeAdminView();
    return;
  }
  if (loginError) {
    loginError.textContent = "Невірний логін або пароль.";
  }
}

function handleLogout(): void {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  state.leaderboardLoaded = false;
  state.leaderboard = [];
  showLogin();
}

setupLogging();

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}
logoutButton?.addEventListener("click", handleLogout);
attachListeners();
updateBuildBadge();
const isLogged = sessionStorage.getItem(AUTH_KEY) === "1";
if (isLogged) {
  showAdmin();
  populateLeagueOptions();
  populateClubOptions(leagueSelect?.value ?? MATCH_LEAGUES[0].id);
  void initializeAdminView();
} else {
  showLogin();
}
