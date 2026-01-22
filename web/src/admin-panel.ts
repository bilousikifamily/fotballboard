const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const ADMIN_TOKEN_KEY = "presentation.admin.token";
const PRESENTATION_VIEW_MODE_KEY = "presentation.viewMode";
const PRESENTATION_LAST5_TEAM_KEY = "presentation.last5Team";
const API_BASE =
  import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");
const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? "";
const BUILD_TIME = import.meta.env.VITE_BUILD_TIME ?? "";

type PresentationViewMode = 
  | "logos-only"
  | "stage"
  | "weather"
  | "probability"
  | "last5"
  | "average-score";

type ClubSyncResponse =
  | {
      ok: true;
      updated: number;
      teams_total: number;
      league_id?: string | null;
      api_league_id?: number | null;
      season?: number | null;
    }
  | { ok: false; error: string; detail?: string };

const CLUB_SYNC_LEAGUES: Array<{ id: string; label: string }> = [
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
const viewModeButtons = document.querySelectorAll<HTMLButtonElement>("[data-admin-view-mode]");
const syncForm = document.querySelector<HTMLFormElement>("[data-admin-sync-form]");
const syncStatus = document.querySelector<HTMLElement>("[data-admin-sync-status]");
const syncRawResponse = document.querySelector<HTMLElement>("[data-admin-sync-raw]");
const curlButton = document.querySelector<HTMLButtonElement>("[data-admin-curl-command]");
const curlHint = document.querySelector<HTMLElement>("[data-admin-curl-hint]");
const syncLeagueSelect = document.querySelector<HTMLSelectElement>("[data-admin-sync-league]");
const syncApiLeagueInput = syncForm?.querySelector<HTMLInputElement>('input[name="api_league_id"]') ?? null;
const syncSeasonInput = syncForm?.querySelector<HTMLInputElement>('input[name="season"]') ?? null;
const buildBadge = document.querySelector<HTMLElement>("[data-admin-build]");

function resolveSeasonForDate(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function getDefaultSeason(): number {
  return resolveSeasonForDate(new Date());
}

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  adminPanel?.classList.add("is-hidden");
}

function showAdmin(): void {
  loginPanel?.classList.add("is-hidden");
  adminPanel?.classList.remove("is-hidden");
}

function setPresentationViewMode(mode: PresentationViewMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PRESENTATION_VIEW_MODE_KEY, mode);
  // Trigger storage event for presentation screen
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: PRESENTATION_VIEW_MODE_KEY,
      newValue: mode
    })
  );
}

function toggleLast5Team(): void {
  if (typeof window === "undefined") {
    return;
  }
  const current = window.localStorage.getItem(PRESENTATION_LAST5_TEAM_KEY);
  const nextTeam = current === "away" ? "home" : "away";
  window.localStorage.setItem(PRESENTATION_LAST5_TEAM_KEY, nextTeam);
  // Trigger storage event for presentation screen
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: PRESENTATION_LAST5_TEAM_KEY,
      newValue: nextTeam
    })
  );
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
  } else if (loginError) {
    loginError.textContent = "Невірний логін або пароль.";
  }
}

function handleLogout(): void {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  showLogin();
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

logoutButton?.addEventListener("click", handleLogout);

// Setup view mode buttons
viewModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.adminViewMode;
    if (
      mode === "logos-only" ||
      mode === "stage" ||
      mode === "weather" ||
      mode === "probability" ||
      mode === "last5" ||
      mode === "average-score"
    ) {
      if (mode === "last5") {
        // Toggle team when clicking last5 button
        toggleLast5Team();
      }
      setPresentationViewMode(mode);
    }
  });
});

if (syncLeagueSelect) {
  syncLeagueSelect.innerHTML = CLUB_SYNC_LEAGUES.map(
    (league) => `<option value="${league.id}">${league.label}</option>`
  ).join("");
}

if (syncSeasonInput && !syncSeasonInput.value.trim()) {
  const defaultSeason = getDefaultSeason();
  syncSeasonInput.value = String(defaultSeason);
  syncSeasonInput.placeholder = String(defaultSeason);
}

if (buildBadge) {
  const baseLabel = BUILD_ID ? `build ${BUILD_ID}` : `build ${import.meta.env.MODE ?? "local"}`;
  const suffix = BUILD_TIME ? ` ${BUILD_TIME}` : "";
  buildBadge.textContent = `${baseLabel}${suffix}`;
}

if (syncForm) {
  syncForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitClubSync();
  });
}

async function submitClubSync(): Promise<void> {
  if (!API_BASE) {
    if (syncStatus) {
      syncStatus.textContent = "API недоступне.";
    }
    return;
  }

  const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
  if (!adminToken) {
    if (syncStatus) {
      syncStatus.textContent = "Немає токена доступу.";
    }
    return;
  }

  if (syncStatus) {
    syncStatus.textContent = "Синхронізація...";
  }

  const leagueId = (syncLeagueSelect?.value ?? "").trim();
  const apiLeagueRaw = (syncApiLeagueInput?.value ?? "").trim();
  const seasonRaw = (syncSeasonInput?.value ?? "").trim();
  const apiLeagueId = apiLeagueRaw ? Number(apiLeagueRaw) : undefined;
  const season = seasonRaw ? Number(seasonRaw) : getDefaultSeason();

  const payload = {
    admin_token: adminToken,
    league_id: leagueId || undefined,
    api_league_id: Number.isFinite(apiLeagueId) ? apiLeagueId : undefined,
    season: Number.isFinite(season) ? season : undefined
  };

  try {
    const response = await fetch(`${API_BASE}/api/clubs/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const rawText = await response.text();
    let data: ClubSyncResponse | null = null;
    try {
      data = JSON.parse(rawText) as ClubSyncResponse;
    } catch {
      data = null;
    }
    if (!response.ok || !data || !data.ok) {
      if (syncStatus) {
        syncStatus.textContent = formatSyncError(data, response.status, rawText);
      }
      if (syncRawResponse) {
        syncRawResponse.textContent = rawText;
      }
      return;
    }
    if (syncRawResponse) {
      syncRawResponse.textContent = rawText;
    }
    if (syncStatus) {
      syncStatus.textContent = formatSyncSuccess(data);
    }
  } catch {
    if (syncStatus) {
      syncStatus.textContent = "Не вдалося синхронізувати клуби.";
    }
  }
}

const buildCurlCommand = (apiLeagueId: number | undefined, leagueParam: string, seasonParam: string): string => {
  const leagueValue = Number.isFinite(apiLeagueId) ? apiLeagueId : leagueParam;
  return `curl -X GET "https://v3.football.api-sports.io/teams?league=${leagueValue}&season=${seasonParam}" \\\n-H "x-apisports-key: <API_FOOTBALL_KEY>"`;
};

if (curlButton) {
  curlButton.addEventListener("click", () => {
    const leagueId = (syncLeagueSelect?.value ?? "").trim() || "uefa-champions-league";
    const seasonValue = (syncSeasonInput?.value ?? "").trim() || String(getDefaultSeason());
    const apiLeagueRaw = (syncApiLeagueInput?.value ?? "").trim();
    const apiLeagueId = apiLeagueRaw ? Number(apiLeagueRaw) : undefined;
    const command = buildCurlCommand(apiLeagueId, leagueId, seasonValue);
    if (curlHint) {
      curlHint.textContent = `Виконуй у терміналі (Mac/Linux або WSL):${"\n"}${command}`;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(command);
    }
  });
}

function formatSyncSuccess(payload: Extract<ClubSyncResponse, { ok: true }>): string {
  const parts = [
    `Оновлено: ${payload.updated}`,
    `всього: ${payload.teams_total}`,
    payload.season ? `сезон: ${payload.season}` : null
  ].filter(Boolean);
  return `Синхронізація завершена ✅ (${parts.join(", ")})`;
}

function formatSyncError(payload: ClubSyncResponse | null, status?: number, rawText?: string): string {
  const statusLabel = typeof status === "number" ? `HTTP ${status}` : null;
  const trimmed = rawText?.trim();
  const snippet = trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 160) : "";
  const detailSuffix = statusLabel ? ` (${statusLabel})` : "";
  if (!payload) {
    return `Не вдалося синхронізувати клуби.${detailSuffix}${snippet ? ` ${snippet}` : ""}`;
  }
  if (!payload.ok) {
    const detail = payload.detail ? ` (${payload.detail})` : "";
    switch (payload.error) {
      case "forbidden":
        return `Недостатньо прав.${detailSuffix}`;
      case "missing_api_key":
        return `Не заданий API ключ.${detailSuffix}`;
      case "missing_supabase":
        return `Не налаштовано Supabase.${detailSuffix}`;
      case "missing_league_mapping":
        return `Немає мапи для ліги.${detail}${detailSuffix}`;
      case "bad_league":
        return `Некоректна ліга.${detailSuffix}`;
      case "missing_timezone":
        return `Немає таймзони для сезону.${detailSuffix}`;
      case "teams_empty":
        return `Список команд порожній.${detailSuffix}`;
      case "api_error":
        if (payload.detail === "teams_status_200") {
          return `API-Football повернуло порожній список команд. Перевір сезон.${detailSuffix}`;
        }
        return `Помилка API-Football.${detail}${detailSuffix}`;
      case "db_error":
        return `Помилка бази.${detail}${detailSuffix}`;
      default:
        return `Не вдалося синхронізувати клуби.${detail}${detailSuffix}`;
    }
  }
  return `Не вдалося синхронізувати клуби.${detailSuffix}`;
}

const authenticated = sessionStorage.getItem(AUTH_KEY) === "1";
if (authenticated) {
  showAdmin();
} else {
  showLogin();
}
