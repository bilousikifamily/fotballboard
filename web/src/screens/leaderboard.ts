import type { LeaderboardUser } from "../types";
import { formatUserName } from "../formatters/names";
import { getAvatarLogoPath } from "../features/clubs";
import { escapeAttribute, escapeHtml } from "../utils/escape";

export function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted small">Не вдалося завантажити таблицю.</p>`;
}

export function renderLeaderboardList(
  users: LeaderboardUser[],
  options: { currentUserId: number | null; startingPoints: number; primaryFactionLogo?: string | null }
): string {
  if (!users.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  let lastPoints: number | null = null;
  let currentRank = 0;
  const rows = users
    .map((user, index) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : options.startingPoints;
      if (lastPoints === null || points !== lastPoints) {
        currentRank += 1;
        lastPoints = points;
      }
      const isSelf = options.currentUserId === user.id;
      const isTop = index < 5;
      const rowClasses = ["leaderboard-row"];
      if (isSelf) {
        rowClasses.push("is-self");
      }
      if (isTop) {
        rowClasses.push("is-top");
      }
      const primaryLogo = isSelf ? options.primaryFactionLogo : null;
      const avatarLogo = getAvatarLogoPath(user.avatar_choice);
      const avatar = primaryLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(primaryLogo)}" alt="" />`
        : avatarLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(avatarLogo)}" alt="" />`
        : user.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      return `
        <div class="${rowClasses.join(" ")}">
          <span class="leaderboard-rank">${currentRank}</span>
          <div class="leaderboard-identity">
            ${avatar}
            <span class="leaderboard-name">${escapeHtml(name)}</span>
          </div>
          <span class="leaderboard-points">${points}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="leaderboard-rows">${rows}</div>`;
}
