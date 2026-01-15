import { escapeAttribute, escapeHtml } from "./utils/escape";
import { formatKyivDateTime } from "./formatters/dates";
import { formatClubName, getClubLogoPath } from "./features/clubs";
import {
  getPresentationUpdatedAt,
  loadPresentationMatches,
  mergePresentationMatches,
  PresentationMatch,
  savePresentationMatches,
  STORAGE_KEY
} from "./presentation/storage";
import { fetchPresentationMatches } from "./presentation/remote";

const root = document.querySelector<HTMLElement>("#presentation");
if (!root) {
  throw new Error("Presentation root element is missing");
}

const matchList = root.querySelector<HTMLElement>("[data-match-list]");
const emptyState = root.querySelector<HTMLElement>("[data-empty-state]");
const updatedLabel = root.querySelector<HTMLElement>("[data-last-updated]");
const formatter = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit" });
const API_BASE =
  import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");

function render(): void {
  const matches = loadPresentationMatches();
  if (!matchList || !updatedLabel || !emptyState) {
    return;
  }

  if (!matches.length) {
    matchList.innerHTML = "";
    emptyState.classList.remove("is-hidden");
  } else {
    emptyState.classList.add("is-hidden");
    matchList.innerHTML = matches.map(renderMatchCard).join("");
  }

  updatedLabel.textContent = `Оновлено ${formatter.format(getPresentationUpdatedAt())}`;
}

function renderMatchCard(match: PresentationMatch): string {
  const homeName = formatClubName(match.homeClub);
  const awayName = formatClubName(match.awayClub);
const homeLogo = getClubLogoPath(match.homeLeague, match.homeClub);
const awayLogo = getClubLogoPath(match.awayLeague, match.awayClub);
  const noteMarkup = match.note ? `<span class="pill">${escapeHtml(match.note)}</span>` : `<span class="pill">Прогноз</span>`;

  return `
    <article class="presentation-card">
      <header class="presentation-card__header">
        <span>${escapeHtml(formatKyivDateTime(match.kickoff))}</span>
        ${noteMarkup}
      </header>
      <div class="presentation-card__teams">
        ${renderTeam("home", homeName, homeLogo)}
        <div class="presentation-card__vs">vs</div>
        ${renderTeam("away", awayName, awayLogo)}
      </div>
      <div class="presentation-probabilities">
        ${renderProbability("Господарі", match.homeProbability, "home")}
        ${renderProbability("Нічия", match.drawProbability, "draw")}
        ${renderProbability("Гості", match.awayProbability, "away")}
      </div>
    </article>
  `;
}

function renderTeam(role: "home" | "away", name: string, logo: string | null): string {
  const safeName = escapeHtml(name);
  const logoMarkup = logo
    ? `<img src="${escapeAttribute(logo)}" alt="${safeName} логотип" />`
    : `<div class="presentation-team-logo-fallback" aria-hidden="true"></div>`;

  return `
    <div class="presentation-team presentation-team-${role}">
      ${logoMarkup}
      <strong>${safeName}</strong>
    </div>
  `;
}

function renderProbability(label: string, value: number, type: "home" | "draw" | "away"): string {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return `
    <div class="presentation-probability" data-type="${type}">
      <div class="presentation-probability__label">
        <span>${escapeHtml(label)}</span>
        <strong>${safeValue}%</strong>
      </div>
      <div class="presentation-probability__bar">
        <span style="width: ${safeValue}%"></span>
      </div>
    </div>
  `;
}

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    render();
  }
});

window.addEventListener("focus", () => {
  void ensureRemoteMatches();
});

render();
void ensureRemoteMatches();

async function ensureRemoteMatches(): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const remoteMatches = await fetchPresentationMatches(API_BASE);
  if (!remoteMatches.length) {
    return;
  }
  const existing = loadPresentationMatches();
  const merged = mergePresentationMatches(existing, remoteMatches);
  savePresentationMatches(merged);
  render();
}
