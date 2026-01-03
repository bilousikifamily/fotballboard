import "./style.css";

type AuthResponse =
  | { ok: true; user?: TelegramWebAppUser; admin?: boolean }
  | { ok: false; error: string };

type LeaderboardResponse =
  | { ok: true; users: LeaderboardUser[] }
  | { ok: false; error: string };

type MatchesResponse =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string };

type PredictionResponse =
  | { ok: true; prediction: unknown }
  | { ok: false; error: string };

type CreateMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

type LeaderboardUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  points_total?: number | null;
  updated_at?: string | null;
};

type Match = {
  id: number;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  status: string;
  home_score?: number | null;
  away_score?: number | null;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let apiBase = "";
let usersLoaded = false;
let currentDate = "";
let isAdmin = false;

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

async function bootstrap(data: string): Promise<void> {
  renderLoading();

  apiBase = import.meta.env.VITE_API_BASE || "";

  try {
    const response = await fetch(`${apiBase}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: data })
    });

    const payload = (await response.json()) as AuthResponse;
    if (!response.ok || !payload.ok) {
      renderMessage("Auth failed", "Please reopen the WebApp.");
      return;
    }

    isAdmin = Boolean(payload.admin);
    currentDate = getKyivDateString();
    renderUser(payload.user, isAdmin, currentDate);
    await loadMatches(currentDate);
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

function renderUser(user?: TelegramWebAppUser, admin = false, date = ""): void {
  const displayName = formatTelegramName(user);
  const safeName = escapeHtml(displayName);
  const avatar = user?.photo_url
    ? `<img class="avatar" src="${escapeAttribute(user.photo_url)}" alt="Avatar" />`
    : `<div class="avatar placeholder"></div>`;
  const safeDate = escapeAttribute(date || getKyivDateString());

  const adminSection = admin
    ? `
      <section class="admin">
        <div class="section-header">
          <h2>Адмін</h2>
          <button class="button secondary" type="button" data-admin-toggle>Додати матч</button>
        </div>
        <form class="admin-form" data-admin-form>
          <label class="field">
            <span>Команда 1</span>
            <input type="text" name="home_team" required />
          </label>
          <label class="field">
            <span>Команда 2</span>
            <input type="text" name="away_team" required />
          </label>
          <label class="field">
            <span>Початок (Київ)</span>
            <input type="datetime-local" name="kickoff_at" required />
          </label>
          <button class="button" type="submit">Створити</button>
          <p class="muted small" data-admin-status></p>
        </form>
      </section>
    `
    : "";

  app.innerHTML = `
    <main class="card">
      ${avatar}
      ${safeName ? `<h1>${safeName}</h1>` : ""}
      <section class="matches">
        <div class="section-header">
          <h2>Матчі</h2>
          <input class="date-input" type="date" value="${safeDate}" data-date />
        </div>
        <p class="muted small">Прогнози приймаються за 60 хв до старту.</p>
        <div class="matches-list" data-matches></div>
      </section>
      ${adminSection}
      <div class="actions">
        <button class="button" type="button" data-leaderboard>ТАБЛИЦЯ</button>
      </div>
      <section class="users" data-users></section>
    </main>
  `;

  const button = app.querySelector<HTMLButtonElement>("[data-leaderboard]");
  if (button) {
    button.addEventListener("click", () => {
      void loadLeaderboard();
    });
  }

  const dateInput = app.querySelector<HTMLInputElement>("[data-date]");
  if (dateInput) {
    dateInput.addEventListener("change", () => {
      const nextDate = dateInput.value;
      if (!nextDate) {
        return;
      }
      currentDate = nextDate;
      void loadMatches(nextDate);
    });
  }

  if (admin) {
    const toggle = app.querySelector<HTMLButtonElement>("[data-admin-toggle]");
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    if (toggle && form) {
      toggle.addEventListener("click", () => {
        form.classList.toggle("is-open");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitMatch(form);
      });
    }
  }
}

async function loadMatches(date: string): Promise<void> {
  if (!apiBase) {
    return;
  }

  const container = app.querySelector<HTMLElement>("[data-matches]");
  if (!container) {
    return;
  }

  container.innerHTML = `<p class="muted">Завантаження...</p>`;

  try {
    const response = await fetch(`${apiBase}/api/matches?date=${encodeURIComponent(date)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as MatchesResponse;
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
      return;
    }

    container.innerHTML = renderMatchesList(data.matches);
    bindPredictionForms();
  } catch {
    container.innerHTML = `<p class="muted">Не вдалося завантажити матчі.</p>`;
  }
}

async function submitMatch(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const status = form.querySelector<HTMLElement>("[data-admin-status]");
  const home = form.querySelector<HTMLInputElement>("input[name=home_team]")?.value.trim() || "";
  const away = form.querySelector<HTMLInputElement>("input[name=away_team]")?.value.trim() || "";
  const kickoffRaw = form.querySelector<HTMLInputElement>("input[name=kickoff_at]")?.value.trim() || "";
  const kickoff = toKyivISOString(kickoffRaw);

  if (!home || !away || !kickoff) {
    if (status) {
      status.textContent = "Заповніть всі поля.";
    }
    return;
  }

  if (status) {
    status.textContent = "Створення...";
  }

  try {
    const response = await fetch(`${apiBase}/api/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        home_team: home,
        away_team: away,
        kickoff_at: kickoff
      })
    });
    const data = (await response.json()) as CreateMatchResponse;
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося створити матч.";
      }
      return;
    }

    form.reset();
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Матч додано ✅";
    }
    await loadMatches(currentDate || getKyivDateString());
  } catch {
    if (status) {
      status.textContent = "Не вдалося створити матч.";
    }
  }
}

function bindPredictionForms(): void {
  const forms = app.querySelectorAll<HTMLFormElement>("[data-prediction-form]");
  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitPrediction(form);
    });
  });
}

async function submitPrediction(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const matchIdRaw = form.dataset.matchId || "";
  const matchId = Number.parseInt(matchIdRaw, 10);
  if (!Number.isFinite(matchId)) {
    return;
  }

  const homeInput = form.querySelector<HTMLInputElement>("input[name=home_pred]");
  const awayInput = form.querySelector<HTMLInputElement>("input[name=away_pred]");
  const status = form.querySelector<HTMLElement>("[data-prediction-status]");

  const home = parseScore(homeInput?.value);
  const away = parseScore(awayInput?.value);
  if (home === null || away === null) {
    if (status) {
      status.textContent = "Вкажіть рахунок.";
    }
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const response = await fetch(`${apiBase}/api/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        match_id: matchId,
        home_pred: home,
        away_pred: away
      })
    });
    const data = (await response.json()) as PredictionResponse;
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = getPredictionError(data.error);
      }
      return;
    }

    if (status) {
      status.textContent = "Збережено ✅";
    }
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти прогноз.";
    }
  }
}

function getPredictionError(error: string | undefined): string {
  switch (error) {
    case "prediction_closed":
      return "Прийом прогнозів закрито.";
    case "match_finished":
      return "Матч завершено.";
    case "match_not_found":
      return "Матч не знайдено.";
    default:
      return "Не вдалося зберегти прогноз.";
  }
}

function renderMatchesList(matches: Match[]): string {
  if (!matches.length) {
    return `<p class="muted">Немає матчів на цю дату.</p>`;
  }

  return matches
    .map((match) => {
      const title = `${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}`;
      const kickoff = formatKyivDateTime(match.kickoff_at);
      const finished = match.status === "finished";
      const closed = finished || isPredictionClosed(match.kickoff_at);
      const result =
        finished && match.home_score !== null && match.away_score !== null
          ? `<div class="match-result">${match.home_score}:${match.away_score}</div>`
          : "";
      const statusLine = finished
        ? `<p class="muted small">Матч завершено.</p>`
        : closed
          ? `<p class="muted small">Прогнози закрито.</p>`
          : "";

      const form = closed
        ? ""
        : `
          <form class="prediction-form" data-prediction-form data-match-id="${match.id}">
            <div class="score-inputs">
              <input type="number" min="0" name="home_pred" placeholder="0" />
              <span>:</span>
              <input type="number" min="0" name="away_pred" placeholder="0" />
            </div>
            <button class="button small-button" type="submit">Прогноз</button>
            <p class="muted small" data-prediction-status></p>
          </form>
        `;

      return `
        <article class="match">
          <div class="match-header">
            <div>
              <div class="match-title">${title}</div>
              <div class="match-time">${kickoff}</div>
            </div>
            ${result}
          </div>
          ${statusLine}
          ${form}
        </article>
      `;
    })
    .join("");
}

function isPredictionClosed(kickoffAt: string): boolean {
  const kickoff = new Date(kickoffAt);
  if (Number.isNaN(kickoff.getTime())) {
    return false;
  }
  const cutoff = kickoff.getTime() - 60 * 60 * 1000;
  return Date.now() > cutoff;
}

function parseScore(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function loadLeaderboard(): Promise<void> {
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
    const response = await fetch(`${apiBase}/api/leaderboard`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as LeaderboardResponse;
    if (!response.ok || !data.ok) {
      renderUsersError(container);
      return;
    }

    container.innerHTML = renderLeaderboardTable(data.users);
    container.classList.add("is-open");
    usersLoaded = true;
  } catch {
    renderUsersError(container);
  }
}

function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted">Не вдалося завантажити користувачів.</p>`;
}

function renderLeaderboardTable(users: LeaderboardUser[]): string {
  if (!users.length) {
    return `<p class="muted">Поки що немає користувачів.</p>`;
  }

  const rows = users
    .map((user, index) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : 0;
      const avatar = user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      return `
        <tr>
          <td class="muted">${index + 1}</td>
          <td>${avatar}</td>
          <td>${escapeHtml(name)}</td>
          <td class="points">${points}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th></th>
            <th>Користувач</th>
            <th>Бали</th>
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

function formatUserName(user: LeaderboardUser): string {
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

function getKyivDateString(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function formatKyivDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function toKyivISOString(dateTimeLocal: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTimeLocal)) {
    return null;
  }
  const base = new Date(`${dateTimeLocal}:00Z`);
  if (Number.isNaN(base.getTime())) {
    return null;
  }
  const offset = getTimeZoneOffset(base, "Europe/Kyiv");
  return new Date(base.getTime() - offset).toISOString();
}

function getTimeZoneOffset(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUTC - date.getTime();
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
