import "./style.css";

type AuthResponse =
  | { ok: true; user?: TelegramWebAppUser }
  | { ok: false; error: string };

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

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

async function bootstrap(initData: string): Promise<void> {
  renderLoading();

  const apiBase = import.meta.env.VITE_API_BASE || "";

  try {
    const response = await fetch(`${apiBase}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData })
    });

    const data = (await response.json()) as AuthResponse;
    if (!response.ok || !data.ok) {
      renderMessage("Auth failed", "Please reopen the WebApp.");
      return;
    }

    renderUser(data.user);
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

function renderUser(user?: TelegramWebAppUser): void {
  const displayName = user?.first_name?.trim() || (user?.username ? `@${user.username}` : "");
  const safeName = escapeHtml(displayName);

  app.innerHTML = `
    <main class="card">
      ${safeName ? `<h1>${safeName}</h1>` : ""}
    </main>
  `;
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
