const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const ADMIN_TOKEN_KEY = "presentation.admin.token";
const PRESENTATION_VIEW_MODE_KEY = "presentation.viewMode";
const PRESENTATION_LAST5_TEAM_KEY = "presentation.last5Team";
const API_BASE =
  import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");

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
const syncLeagueSelect = document.querySelector<HTMLSelectElement>("[data-admin-sync-league]");

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
  const apiLeagueRaw = (syncForm?.querySelector<HTMLInputElement>('input[name="api_league_id"]')?.value ?? "").trim();
  const seasonRaw = (syncForm?.querySelector<HTMLInputElement>('input[name="season"]')?.value ?? "").trim();
  const apiLeagueId = apiLeagueRaw ? Number(apiLeagueRaw) : undefined;
  const season = seasonRaw ? Number(seasonRaw) : undefined;

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
    const data = (await response.json().catch(() => null)) as ClubSyncResponse | null;
    if (!response.ok || !data || !data.ok) {
      if (syncStatus) {
        syncStatus.textContent = formatSyncError(data);
      }
      return;
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

function formatSyncSuccess(payload: Extract<ClubSyncResponse, { ok: true }>): string {
  const parts = [
    `Оновлено: ${payload.updated}`,
    `всього: ${payload.teams_total}`,
    payload.season ? `сезон: ${payload.season}` : null
  ].filter(Boolean);
  return `Синхронізація завершена ✅ (${parts.join(", ")})`;
}

function formatSyncError(payload: ClubSyncResponse | null): string {
  if (!payload) {
    return "Не вдалося синхронізувати клуби.";
  }
  if (!payload.ok) {
    const detail = payload.detail ? ` (${payload.detail})` : "";
    switch (payload.error) {
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
        return `Помилка API-Football.${detail}`;
      case "db_error":
        return `Помилка бази.${detail}`;
      default:
        return `Не вдалося синхронізувати клуби.${detail}`;
    }
  }
  return "Не вдалося синхронізувати клуби.";
}

const authenticated = sessionStorage.getItem(AUTH_KEY) === "1";
if (authenticated) {
  showAdmin();
} else {
  showLogin();
}
