import "./style.css";

type AuthResponse =
  | { ok: true; user?: TelegramWebAppUser; admin?: boolean; points_total?: number; rank?: number | null }
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

type PredictionsResponse =
  | { ok: true; predictions: PredictionView[] }
  | { ok: false; error: string };

type CreateMatchResponse =
  | { ok: true; match: Match }
  | { ok: false; error: string };

type ResultResponse =
  | { ok: true }
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

type PredictionUser = {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
};

type PredictionView = {
  id: number;
  home_pred: number;
  away_pred: number;
  points: number;
  user: PredictionUser | null;
};

type UserStats = {
  rank: number | null;
  points: number;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

let apiBase = "";
let leaderboardLoaded = false;
let currentDate = "";
let isAdmin = false;
let currentUserId: number | null = null;
const predictionsLoaded = new Set<number>();

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
    currentUserId = payload.user?.id ?? null;
    currentDate = getKyivDateString();

    const stats: UserStats = {
      rank: payload.rank ?? null,
      points: typeof payload.points_total === "number" ? payload.points_total : 0
    };

    renderUser(payload.user, stats, isAdmin, currentDate);
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

function renderUser(user: TelegramWebAppUser | undefined, stats: UserStats, admin: boolean, date: string): void {
  const displayName = formatTelegramName(user);
  const safeName = escapeHtml(displayName);
  const avatar = user?.photo_url
    ? `<img class="avatar" src="${escapeAttribute(user.photo_url)}" alt="Avatar" />`
    : `<div class="avatar placeholder"></div>`;
  const safeDate = escapeAttribute(date || getKyivDateString());
  const rankText = stats.rank ? `#${stats.rank}` : "—";

  const adminSection = admin
    ? `
      <section class="panel admin">
        <div class="section-header">
          <h2>Адмін</h2>
        </div>
        <div class="admin-actions">
          <button class="button secondary" type="button" data-admin-toggle-add>Додати матч</button>
          <button class="button secondary" type="button" data-admin-toggle-result>Ввести результат</button>
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
        <form class="admin-form" data-admin-result-form>
          <label class="field">
            <span>Матч</span>
            <select name="match_id" data-admin-match></select>
          </label>
          <div class="score-inputs">
            <input type="number" min="0" name="home_score" placeholder="0" />
            <span>:</span>
            <input type="number" min="0" name="away_score" placeholder="0" />
          </div>
          <button class="button" type="submit">Зберегти результат</button>
          <p class="muted small" data-admin-result-status></p>
        </form>
      </section>
    `
    : "";

  app.innerHTML = `
    <main class="layout">
      <section class="panel profile center">
        ${avatar}
        ${safeName ? `<h1>${safeName}</h1>` : ""}
        <div class="stats">
          <div class="stat">
            <span class="stat-label">Місце</span>
            <span class="stat-value">${rankText}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Бали</span>
            <span class="stat-value">${stats.points}</span>
          </div>
        </div>
      </section>

      <section class="panel matches">
        <div class="section-header">
          <h2>Матчі</h2>
          <input class="date-input" type="date" value="${safeDate}" data-date />
        </div>
        <p class="muted small">Прогнози приймаються за 60 хв до старту.</p>
        <div class="matches-list" data-matches></div>
      </section>

      <section class="panel leaderboard center">
        <button class="button" type="button" data-leaderboard>ТАБЛИЦЯ</button>
        <div class="leaderboard-list" data-leaderboard-list></div>
      </section>

      ${adminSection}
    </main>
  `;

  const leaderboardButton = app.querySelector<HTMLButtonElement>("[data-leaderboard]");
  if (leaderboardButton) {
    leaderboardButton.addEventListener("click", () => {
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
    const toggleAdd = app.querySelector<HTMLButtonElement>("[data-admin-toggle-add]");
    const toggleResult = app.querySelector<HTMLButtonElement>("[data-admin-toggle-result]");
    const form = app.querySelector<HTMLFormElement>("[data-admin-form]");
    const resultForm = app.querySelector<HTMLFormElement>("[data-admin-result-form]");

    if (toggleAdd && form) {
      toggleAdd.addEventListener("click", () => {
        form.classList.toggle("is-open");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitMatch(form);
      });
    }

    if (toggleResult && resultForm) {
      toggleResult.addEventListener("click", () => {
        resultForm.classList.toggle("is-open");
      });
      resultForm.addEventListener("submit", (event) => {
        event.preventDefault();
        void submitResult(resultForm);
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

    predictionsLoaded.clear();
    container.innerHTML = renderMatchesList(data.matches);
    bindMatchActions();
    renderAdminMatchOptions(data.matches);
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

async function submitResult(form: HTMLFormElement): Promise<void> {
  if (!apiBase) {
    return;
  }

  const status = form.querySelector<HTMLElement>("[data-admin-result-status]");
  const matchIdRaw = form.querySelector<HTMLSelectElement>("select[name=match_id]")?.value || "";
  const matchId = parseScore(matchIdRaw);
  const homeScore = parseScore(form.querySelector<HTMLInputElement>("input[name=home_score]")?.value);
  const awayScore = parseScore(form.querySelector<HTMLInputElement>("input[name=away_score]")?.value);

  if (matchId === null || homeScore === null || awayScore === null) {
    if (status) {
      status.textContent = "Заповніть всі поля.";
    }
    return;
  }

  if (status) {
    status.textContent = "Збереження...";
  }

  try {
    const response = await fetch(`${apiBase}/api/matches/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData,
        match_id: matchId,
        home_score: homeScore,
        away_score: awayScore
      })
    });
    const data = (await response.json()) as ResultResponse;
    if (!response.ok || !data.ok) {
      if (status) {
        status.textContent = "Не вдалося зберегти результат.";
      }
      return;
    }

    form.reset();
    form.classList.remove("is-open");
    if (status) {
      status.textContent = "Результат збережено ✅";
    }
    await loadMatches(currentDate || getKyivDateString());
  } catch {
    if (status) {
      status.textContent = "Не вдалося зберегти результат.";
    }
  }
}

function bindMatchActions(): void {
  const forms = app.querySelectorAll<HTMLFormElement>("[data-prediction-form]");
  forms.forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitPrediction(form);
    });
  });

  const toggles = app.querySelectorAll<HTMLButtonElement>("[data-predictions-toggle]");
  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const matchIdRaw = toggle.dataset.matchId || "";
      const matchId = Number.parseInt(matchIdRaw, 10);
      if (!Number.isFinite(matchId)) {
        return;
      }
      const container = app.querySelector<HTMLElement>(
        `[data-predictions][data-match-id="${matchId}"]`
      );
      if (container) {
        void togglePredictions(matchId, container);
      }
    });
  });
}

function renderAdminMatchOptions(matches: Match[]): void {
  const select = app.querySelector<HTMLSelectElement>("[data-admin-match]");
  if (!select) {
    return;
  }

  if (!matches.length) {
    select.innerHTML = `<option value="">Немає матчів</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = matches
    .map((match) => {
      const title = `${match.home_team} — ${match.away_team}`;
      const kickoff = formatKyivDateTime(match.kickoff_at);
      return `<option value="${match.id}">${escapeHtml(title)} (${kickoff})</option>`;
    })
    .join("");
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

async function togglePredictions(matchId: number, container: HTMLElement): Promise<void> {
  if (predictionsLoaded.has(matchId)) {
    container.classList.toggle("is-open");
    return;
  }

  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const response = await fetch(`${apiBase}/api/predictions?match_id=${matchId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData
      }
    });
    const data = (await response.json()) as PredictionsResponse;
    if (!response.ok || !data.ok) {
      container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
      return;
    }

    container.innerHTML = renderPredictionsList(data.predictions);
    predictionsLoaded.add(matchId);
  } catch {
    container.innerHTML = `<p class="muted small">Не вдалося завантажити прогнози.</p>`;
  }
}

function renderPredictionsList(predictions: PredictionView[]): string {
  const filtered = predictions.filter((item) => !currentUserId || item.user?.id !== currentUserId);
  if (!filtered.length) {
    return `<p class="muted small">Поки що немає прогнозів.</p>`;
  }

  const rows = filtered
    .map((item) => {
      const name = formatPredictionName(item.user);
      return `
        <div class="prediction-row">
          <span class="prediction-name">${escapeHtml(name)}</span>
          <span class="prediction-score">${item.home_pred}:${item.away_pred}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="predictions-list">${rows}</div>`;
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
            <div class="match-title">${title}</div>
            <div class="match-time">${kickoff}</div>
            ${result}
          </div>
          <button class="link-button" type="button" data-predictions-toggle data-match-id="${match.id}">
            Прогнози
          </button>
          ${statusLine}
          ${form}
          <div class="predictions" data-predictions data-match-id="${match.id}"></div>
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

  const container = app.querySelector<HTMLElement>("[data-leaderboard-list]");
  if (!container) {
    return;
  }

  if (leaderboardLoaded) {
    container.classList.toggle("is-open");
    return;
  }

  container.innerHTML = `<p class="muted small">Завантаження...</p>`;
  container.classList.add("is-open");

  try {
    const response = await fetch(`${apiBase}/api/leaderboard?limit=10`, {
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

    container.innerHTML = renderLeaderboardList(data.users);
    leaderboardLoaded = true;
  } catch {
    renderUsersError(container);
  }
}

function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted small">Не вдалося завантажити таблицю.</p>`;
}

function renderLeaderboardList(users: LeaderboardUser[]): string {
  if (!users.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  const rows = users
    .map((user, index) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : 0;
      const avatar = user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      return `
        <div class="leaderboard-row">
          <span class="leaderboard-rank">${index + 1}</span>
          ${avatar}
          <span class="leaderboard-name">${escapeHtml(name)}</span>
          <span class="leaderboard-points">${points}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="leaderboard-rows">${rows}</div>`;
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

function formatPredictionName(user: PredictionUser | null): string {
  if (!user) {
    return "Гравець";
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
  return "Гравець";
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
