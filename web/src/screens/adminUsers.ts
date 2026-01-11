import type { LeaderboardUser } from "../types";
import { formatKyivDateTime } from "../formatters/dates";
import { formatUserName } from "../formatters/names";
import { getAvatarLogoPath } from "../features/clubs";
import { escapeAttribute, escapeHtml } from "../utils/escape";

export function renderAdminUserSessions(users: LeaderboardUser[], startingPoints: number): string {
  if (!users.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  const rows = users
    .map((user) => {
      const name = formatUserName(user);
      const points = typeof user.points_total === "number" ? user.points_total : startingPoints;
      const lastSeen = user.updated_at ? formatKyivDateTime(user.updated_at) : "—";
      const avatarLogo = getAvatarLogoPath(user.avatar_choice);
      const avatar = avatarLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(avatarLogo)}" alt="" />`
        : user.photo_url
          ? `<img class="table-avatar" src="${escapeAttribute(user.photo_url)}" alt="" />`
          : `<div class="table-avatar placeholder"></div>`;
      return `
        <div class="admin-user-row">
          ${avatar}
          <div class="admin-user-info">
            <span class="admin-user-name">${escapeHtml(name)}</span>
            <span class="admin-user-session">${escapeHtml(lastSeen)}</span>
          </div>
          <span class="admin-user-points">${points}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="admin-users-list">${rows}</div>`;
}
