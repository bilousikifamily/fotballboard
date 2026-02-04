import type { LeaderboardUser, PredictionAccuracyMatch, PredictionAccuracyUser } from "../types";
import { formatKyivDateShort, formatKyivTime } from "../formatters/dates";
import { formatUserName } from "../formatters/names";
import { getAvatarLogoPath } from "../features/clubs";
import { escapeAttribute, escapeHtml } from "../utils/escape";

function parseUserTimestamp(user: LeaderboardUser): number {
  if (!user.last_seen_at) {
    return 0;
  }
  const parsed = Date.parse(user.last_seen_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function renderAdminUserSessions(users: LeaderboardUser[]): string {
  if (!users.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  const rows = users
    .slice()
    .sort((a, b) => parseUserTimestamp(b) - parseUserTimestamp(a))
    .map((user) => {
      const name = formatUserName(user);
      const lastSeen = user.last_seen_at
        ? `${formatKyivDateShort(user.last_seen_at)} · ${formatKyivTime(user.last_seen_at)}`
        : "—";
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
          </div>
          <span class="admin-user-session">${escapeHtml(lastSeen)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="admin-users-list">${rows}</div>`;
}

function formatAccuracyUserName(user: PredictionAccuracyUser): string {
  const nickname = user.nickname?.trim();
  if (nickname) {
    return nickname;
  }
  const username = user.username?.trim();
  if (username) {
    return username;
  }
  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  if (fullName) {
    return fullName;
  }
  return `id:${user.user_id}`;
}

export function renderAdminMatchAccuracy(matches: PredictionAccuracyMatch[]): string {
  if (!matches.length) {
    return `<p class="muted small">Немає даних по матчах.</p>`;
  }

  const rows = matches
    .slice()
    .sort((a, b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at))
    .map((match) => {
      const kickoffLabel = `${formatKyivDateShort(match.kickoff_at)} · ${formatKyivTime(match.kickoff_at)}`;
      const scoreLabel = `${match.hits}/${match.total_predictions}`;
      return `
        <div class="admin-user-row">
          <div class="table-avatar placeholder"></div>
          <div class="admin-user-info">
            <span class="admin-user-name">${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)}</span>
            <span class="admin-user-session">${escapeHtml(kickoffLabel)} · ${match.accuracy_pct}%</span>
          </div>
          <span class="admin-user-session">${escapeHtml(scoreLabel)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="admin-users-list">${rows}</div>`;
}

export function renderAdminPlayerAccuracy(users: PredictionAccuracyUser[]): string {
  if (!users.length) {
    return `<p class="muted small">Немає даних по гравцях.</p>`;
  }

  const rows = users
    .slice()
    .sort((a, b) => b.accuracy_pct - a.accuracy_pct || b.total_predictions - a.total_predictions)
    .map((user) => {
      const name = formatAccuracyUserName(user);
      const scoreLabel = `${user.hits}/${user.total_predictions}`;
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
            <span class="admin-user-session">${user.accuracy_pct}%</span>
          </div>
          <span class="admin-user-session">${escapeHtml(scoreLabel)}</span>
        </div>
      `;
    })
    .join("");

  return `<div class="admin-users-list">${rows}</div>`;
}
