import {
  loadPresentationMatches,
  STORAGE_KEY
} from "./presentation/storage";

const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const PRESENTATION_VIEW_MODE_KEY = "presentation.viewMode";

type PresentationViewMode = "normal" | "average" | "chart";

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const adminPanel = document.querySelector<HTMLElement>("[data-admin-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const nextMatchButton = document.querySelector<HTMLButtonElement>("[data-admin-next-match]");
const showAverageButton = document.querySelector<HTMLButtonElement>("[data-admin-show-average]");
const showChartButton = document.querySelector<HTMLButtonElement>("[data-admin-show-chart]");

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

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}

logoutButton?.addEventListener("click", handleLogout);

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
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: CURRENT_MATCH_INDEX_KEY,
        newValue: String(nextIndex)
      })
    );
    // Reset view mode to normal when changing match
    setPresentationViewMode("normal");
  }
});

showAverageButton?.addEventListener("click", () => {
  setPresentationViewMode("average");
});

showChartButton?.addEventListener("click", () => {
  setPresentationViewMode("chart");
});

const authenticated = sessionStorage.getItem(AUTH_KEY) === "1";
if (authenticated) {
  showAdmin();
} else {
  showLogin();
}
