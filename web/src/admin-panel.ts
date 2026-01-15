import { ALL_CLUBS, type MatchLeagueId } from "./data/clubs";
import { formatClubName } from "./features/clubs";
import { formatKyivDateTime } from "./formatters/dates";
import {
  createDefaultMatches,
  generateMatchId,
  loadPresentationMatches,
  mergePresentationMatches,
  PresentationMatch,
  savePresentationMatches,
  STORAGE_KEY
} from "./presentation/storage";
import { fetchPresentationMatches } from "./presentation/remote";
import { escapeHtml } from "./utils/escape";

const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";

const MATCH_LEAGUES = Object.keys(ALL_CLUBS) as MatchLeagueId[];

const LEAGUE_LABELS: Record<MatchLeagueId, string> = {
  "ukrainian-premier-league": "УПЛ",
  "english-premier-league": "АПЛ",
  "la-liga": "Ла Ліга",
  "serie-a": "Серія А",
  "bundesliga": "Бундесліга",
  "ligue-1": "Ліга 1",
  "uefa-champions-league": "Ліга чемпіонів",
  "uefa-europa-league": "Ліга Європи",
  "uefa-europa-conference-league": "Ліга конференцій",
  "fa-cup": "Кубок Англії",
  "copa-del-rey": "Кубок Іспанії",
  "coppa-italia": "Кубок Італії",
  "dfb-pokal": "Кубок Німеччини",
  "coupe-de-france": "Кубок Франції"
};

const API_BASE =
  import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const adminPanel = document.querySelector<HTMLElement>("[data-admin-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const syncButton = document.querySelector<HTMLButtonElement>("[data-admin-sync]");
const syncStatus = document.querySelector<HTMLElement>("[data-admin-sync-status]");

const matchForm = document.querySelector<HTMLFormElement>("[data-match-form]");
const homeLeagueSelect = matchForm?.querySelector<HTMLSelectElement>("[name='homeLeague']");
const awayLeagueSelect = matchForm?.querySelector<HTMLSelectElement>("[name='awayLeague']");
const homeClubSelect = matchForm?.querySelector<HTMLSelectElement>("[name='homeClub']");
const awayClubSelect = matchForm?.querySelector<HTMLSelectElement>("[name='awayClub']");
const kickoffInput = matchForm?.querySelector<HTMLInputElement>("[name='kickoff']");
const homeProbInput = matchForm?.querySelector<HTMLInputElement>("[name='homeProbability']");
const drawProbInput = matchForm?.querySelector<HTMLInputElement>("[name='drawProbability']");
const awayProbInput = matchForm?.querySelector<HTMLInputElement>("[name='awayProbability']");
const noteInput = matchForm?.querySelector<HTMLInputElement>("[name='note']");
const cancelEditButton = matchForm?.querySelector<HTMLButtonElement>("[data-form-cancel]");
const matchList = document.querySelector<HTMLElement>("[data-admin-match-list]");

let matches: PresentationMatch[] = loadPresentationMatches();
let editingId: string | null = null;

function populateLeagueSelect(select: HTMLSelectElement | null): void {
  if (!select) {
    return;
  }
  select.innerHTML = MATCH_LEAGUES.map(
    (leagueId) => `<option value="${leagueId}">${LEAGUE_LABELS[leagueId] ?? leagueId}</option>`
  ).join("");
}

function updateClubOptions(select: HTMLSelectElement | null, leagueId: MatchLeagueId, selected?: string): void {
  if (!select) {
    return;
  }
  const clubs = ALL_CLUBS[leagueId] ?? [];
  select.innerHTML = clubs
    .map(
      (club) =>
        `<option value="${club}" ${selected && selected === club ? "selected" : ""}>${escapeHtml(
          formatClubName(club)
        )}</option>`
    )
    .join("");
}

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  adminPanel?.classList.add("is-hidden");
}

function showAdmin(): void {
  loginPanel?.classList.add("is-hidden");
  adminPanel?.classList.remove("is-hidden");
  populateLeagueSelect(homeLeagueSelect);
  populateLeagueSelect(awayLeagueSelect);
  resetForm();
  renderMatchList();
  void syncRemoteMatches();
}

function resetForm(): void {
  if (!matchForm) {
    return;
  }
  editingId = null;
  matchForm.reset();
  if (homeLeagueSelect) {
    homeLeagueSelect.value = MATCH_LEAGUES[0];
  }
  if (awayLeagueSelect) {
    awayLeagueSelect.value = MATCH_LEAGUES[0];
  }
  const homeLeagueValue = (homeLeagueSelect?.value as MatchLeagueId) ?? MATCH_LEAGUES[0];
  const awayLeagueValue = (awayLeagueSelect?.value as MatchLeagueId) ?? MATCH_LEAGUES[0];
  updateClubOptions(homeClubSelect, homeLeagueValue);
  updateClubOptions(awayClubSelect, awayLeagueValue);
  if (kickoffInput) {
    kickoffInput.value = formatInputDateTime(new Date(Date.now() + 60 * 60 * 1000));
  }
  if (homeProbInput) {
    homeProbInput.value = "60";
  }
  if (drawProbInput) {
    drawProbInput.value = "25";
  }
  if (awayProbInput) {
    awayProbInput.value = "15";
  }
  if (cancelEditButton) {
    cancelEditButton.classList.add("is-hidden");
  }
}

function formatInputDateTime(date: Date): string {
  const iso = date.toISOString();
  return iso.substring(0, 16);
}

function renderMatchList(): void {
  if (!matchList) {
    return;
  }
  if (!matches.length) {
    matchList.innerHTML = `<p class="muted small">Немає збережених матчів.</p>`;
    return;
  }
  matchList.innerHTML = matches
    .map(
      (match) => `
        <div class="admin-match-card" data-admin-match-id="${match.id}">
          <div class="admin-match-card__head">
            <strong>${escapeHtml(formatClubName(match.homeClub))} vs ${escapeHtml(
        formatClubName(match.awayClub)
      )}</strong>
            <span class="admin-meta">${formatKyivDateTime(match.kickoff)}</span>
          </div>
          <div class="admin-match-card__body">
            <div class="admin-prob-row">
              <span>Господарі</span><span>${match.homeProbability}%</span>
            </div>
            <div class="admin-prob-row">
              <span>Нічия</span><span>${match.drawProbability}%</span>
            </div>
            <div class="admin-prob-row">
              <span>Гості</span><span>${match.awayProbability}%</span>
            </div>
            <p class="admin-note">${escapeHtml(match.note ?? "Прогноз трансляції")}</p>
          </div>
          <div class="admin-match-card__actions">
            <button class="button secondary" type="button" data-admin-edit>Редагувати</button>
            <button class="button secondary" type="button" data-admin-delete>Видалити</button>
            <button class="button secondary" type="button" data-admin-move-up>Вгору</button>
            <button class="button secondary" type="button" data-admin-move-down>Вниз</button>
          </div>
        </div>
      `
    )
    .join("");
}

function persistMatches(updated: PresentationMatch[]): void {
  matches = updated;
  savePresentationMatches(updated);
  renderMatchList();
}

function setSyncStatus(message: string): void {
  if (syncStatus) {
    syncStatus.textContent = message;
  }
}

async function syncRemoteMatches(): Promise<void> {
  if (!API_BASE) {
    setSyncStatus("API не налаштовано");
    return;
  }
  setSyncStatus("Завантажуємо...");
  const remoteMatches = await fetchPresentationMatches(API_BASE);
  if (!remoteMatches.length) {
    setSyncStatus("Матчів не знайдено");
    return;
  }
  const merged = mergePresentationMatches(matches, remoteMatches);
  persistMatches(merged);
  setSyncStatus("Синхронізовано");
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
    loginError && (loginError.textContent = "");
    showAdmin();
  } else if (loginError) {
    loginError.textContent = "Невірний логін або пароль.";
  }
}

function handleLogout(): void {
  sessionStorage.removeItem(AUTH_KEY);
  showLogin();
}

function buildMatchFromForm(): PresentationMatch | null {
  if (
    !homeLeagueSelect ||
    !awayLeagueSelect ||
    !homeClubSelect ||
    !awayClubSelect ||
    !kickoffInput ||
    !homeProbInput ||
    !drawProbInput ||
    !awayProbInput
  ) {
    return null;
  }

  const kickoffValue = kickoffInput.value || new Date().toISOString();
  const kickoffIso = new Date(kickoffValue);
  if (Number.isNaN(kickoffIso.getTime())) {
    return null;
  }

  const existing = editingId ? matches.find((entry) => entry.id === editingId) : null;
  const match: PresentationMatch = {
    id: editingId ?? generateMatchId(),
    homeLeague: homeLeagueSelect.value as MatchLeagueId,
    awayLeague: awayLeagueSelect.value as MatchLeagueId,
    homeClub: homeClubSelect.value,
    awayClub: awayClubSelect.value,
    kickoff: kickoffIso.toISOString(),
    homeProbability: clampProbability(Number(homeProbInput.value)),
    drawProbability: clampProbability(Number(drawProbInput.value)),
    awayProbability: clampProbability(Number(awayProbInput.value)),
    note: noteInput?.value?.trim() || undefined,
    createdAt: existing?.createdAt ?? Date.now()
  };

  return match;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function handleFormSubmit(event: Event): void {
  event.preventDefault();
  const match = buildMatchFromForm();
  if (!match) {
    return;
  }
  const updated = editingId
    ? matches.map((entry) => (entry.id === match.id ? match : entry))
    : [match, ...matches];
  persistMatches(updated);
  resetForm();
}

function startEditing(matchId: string): void {
  const match = matches.find((entry) => entry.id === matchId);
  if (!match || !matchForm) {
    return;
  }
  editingId = matchId;
  if (homeLeagueSelect) {
    homeLeagueSelect.value = match.homeLeague;
  }
  if (awayLeagueSelect) {
    awayLeagueSelect.value = match.awayLeague;
  }
  updateClubOptions(homeClubSelect, match.homeLeague, match.homeClub);
  updateClubOptions(awayClubSelect, match.awayLeague, match.awayClub);
  if (kickoffInput) {
    kickoffInput.value = formatInputDateTime(new Date(match.kickoff));
  }
  if (homeProbInput) {
    homeProbInput.value = String(match.homeProbability);
  }
  if (drawProbInput) {
    drawProbInput.value = String(match.drawProbability);
  }
  if (awayProbInput) {
    awayProbInput.value = String(match.awayProbability);
  }
  if (noteInput) {
    noteInput.value = match.note ?? "";
  }
  if (cancelEditButton) {
    cancelEditButton.classList.remove("is-hidden");
  }
}

function deleteMatch(matchId: string): void {
  const updated = matches.filter((entry) => entry.id !== matchId);
  persistMatches(updated);
}

function moveMatch(matchId: string, direction: -1 | 1): void {
  const index = matches.findIndex((entry) => entry.id === matchId);
  if (index === -1) {
    return;
  }
  const swapIndex = index + direction;
  if (swapIndex < 0 || swapIndex >= matches.length) {
    return;
  }
  const next = [...matches];
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  persistMatches(next);
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

logoutButton?.addEventListener("click", handleLogout);
syncButton?.addEventListener("click", () => {
  void syncRemoteMatches();
});

homeLeagueSelect?.addEventListener("change", () => {
  if (!homeLeagueSelect) {
    return;
  }
  updateClubOptions(homeClubSelect, homeLeagueSelect.value as MatchLeagueId);
});

awayLeagueSelect?.addEventListener("change", () => {
  if (!awayLeagueSelect) {
    return;
  }
  updateClubOptions(awayClubSelect, awayLeagueSelect.value as MatchLeagueId);
});

matchForm?.addEventListener("submit", handleFormSubmit);

cancelEditButton?.addEventListener("click", resetForm);

matchList?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>("[data-admin-match-id]");
  if (!card) {
    return;
  }
  const matchId = card.dataset.adminMatchId;
  if (!matchId) {
    return;
  }

  if (target.matches("[data-admin-edit]")) {
    startEditing(matchId);
    return;
  }
  if (target.matches("[data-admin-delete]")) {
    deleteMatch(matchId);
    return;
  }
  if (target.matches("[data-admin-move-up]")) {
    moveMatch(matchId, -1);
    return;
  }
  if (target.matches("[data-admin-move-down]")) {
    moveMatch(matchId, 1);
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    matches = loadPresentationMatches();
    renderMatchList();
  }
});

const authenticated = sessionStorage.getItem(AUTH_KEY) === "1";
if (authenticated) {
  showAdmin();
} else {
  showLogin();
}

const CURRENT_MATCH_INDEX_KEY = "presentation.currentMatchIndex";

function getCurrentMatchIndex(matchesLength: number): number {
  if (typeof window === "undefined" || matchesLength === 0) {
    return 0;
  }
  const stored = window.localStorage.getItem(CURRENT_MATCH_INDEX_KEY);
  const parsed = stored ? Number(stored) : 0;
  const index = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  return Math.min(index, Math.max(0, matchesLength - 1));
}

const resetButton = document.querySelector<HTMLButtonElement>("[data-admin-reset]");
resetButton?.addEventListener("click", () => {
  const defaults = createDefaultMatches();
  persistMatches(defaults);
  resetForm();
});

const nextMatchButton = document.querySelector<HTMLButtonElement>("[data-admin-next-match]");
nextMatchButton?.addEventListener("click", () => {
  const matches = loadPresentationMatches();
  if (matches.length === 0) {
    return;
  }
  const currentIndex = getCurrentMatchIndex(matches.length);
  const nextIndex = (currentIndex + 1) % matches.length;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CURRENT_MATCH_INDEX_KEY, String(nextIndex));
    // Trigger storage event for presentation screen
    window.dispatchEvent(new StorageEvent("storage", {
      key: CURRENT_MATCH_INDEX_KEY,
      newValue: String(nextIndex)
    }));
  }
});
