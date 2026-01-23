const LOGIN_USERNAME = "artur2026";
const LOGIN_PASSWORD = "Qwe123Asd321";
const AUTH_KEY = "presentation.admin.auth";
const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? "";
const BUILD_TIME = import.meta.env.VITE_BUILD_TIME ?? "";

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const adminPanel = document.querySelector<HTMLElement>("[data-admin-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const buildBadge = document.querySelector<HTMLElement>("[data-admin-build]");

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  adminPanel?.classList.add("is-hidden");
}

function showAdmin(): void {
  loginPanel?.classList.add("is-hidden");
  adminPanel?.classList.remove("is-hidden");
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

if (buildBadge) {
  const baseLabel = BUILD_ID ? `build ${BUILD_ID}` : `build ${import.meta.env.MODE ?? "local"}`;
  const suffix = BUILD_TIME ? ` ${BUILD_TIME}` : "";
  buildBadge.textContent = `${baseLabel}${suffix}`;
}

const isLogged = sessionStorage.getItem(AUTH_KEY) === "1";
if (isLogged) {
  showAdmin();
} else {
  showLogin();
}
