import "./style.css";

type AuthResponse =
  | { ok: true; user?: TelegramWebAppUser }
  | { ok: false; error: string };

type UsersResponse =
  | { ok: true; users: StoredUser[] }
  | { ok: false; error: string };

type StoredUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  updated_at?: string | null;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let apiBase = "";
let usersLoaded = false;

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

  apiBase = import.meta.env.VITE_API_BASE || "";

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
  const displayName = formatTelegramName(user);
  const safeName = escapeHtml(displayName);
  const avatar = user?.photo_url
    ? `<img class="avatar" src="${escapeAttribute(user.photo_url)}" alt="Avatar" />`
    : `<div class="avatar placeholder"></div>`;

  app.innerHTML = `
    <main class="card">
      ${avatar}
      ${safeName ? `<h1>${safeName}</h1>` : ""}
      <div class="actions">
        <button class="button" type="button">ТАБЛИЦЯ</button>
      </div>
      <section class="users" data-users></section>
    </main>
  `;

  const button = app.querySelector<HTMLButtonElement>(".button");
  if (button) {
    button.addEventListener("click", () => {
      void loadUsers();
    });
  }
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

async function loadUsers(): Promise<void> {
  if (!apiBase) {
    return;
  }

  const container = app.querySelector<HTMLElement>("[data-users]");
  if (!container) {
    return;
  }

  if (usersLoaded) {
    container.classList.toggle("is-open");
    return;
  }

  container.innerHTML = `<p class="muted">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const response = await fetch(`${apiBase}/api/users`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });
    const data = (await response.json()) as UsersResponse;
    if (!response.ok || !data.ok) {
      renderUsersError(container);
      return;
    }

    container.innerHTML = renderUsersTable(data.users);
    container.classList.add("is-open");
    usersLoaded = true;
  } catch {
    renderUsersError(container);
  }
}

function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted">Не вдалося завантажити користувачів.</p>`;
}

function renderUsersTable(users: StoredUser[]): string {
  if (!users.length) {
    return `<p class="muted">Поки що немає користувачів.</p>`;
  }

  const rows = users
    .map((user) => {
      const name = formatUserName(user);
      const avatar = user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      const updatedAt = user.updated_at ? escapeHtml(new Date(user.updated_at).toLocaleString()) : "";
      return `
        <tr>
          <td>${avatar}</td>
          <td>${escapeHtml(name)}</td>
          <td class="muted">${updatedAt}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Користувач</th>
            <th>Оновлено</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
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

function formatUserName(user: StoredUser): string {
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
