import {
  loadPresentationMatches,
  STORAGE_KEY
} from "./presentation/storage";

const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const PRESENTATION_VIEW_MODE_KEY = "presentation.viewMode";
const PRESENTATION_LAST5_TEAM_KEY = "presentation.last5Team";

type PresentationViewMode = 
  | "logos-only"
  | "stage"
  | "weather"
  | "probability"
  | "last5"
  | "average-score";

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const adminPanel = document.querySelector<HTMLElement>("[data-admin-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const viewModeButtons = document.querySelectorAll<HTMLButtonElement>("[data-admin-view-mode]");

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

const authenticated = sessionStorage.getItem(AUTH_KEY) === "1";
if (authenticated) {
  showAdmin();
} else {
  showLogin();
}
