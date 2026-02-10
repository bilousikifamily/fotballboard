import type {
  AdminChatMessage,
  AdminChatThread,
  LeaderboardUser,
  Match,
  PredictionAccuracyMatch,
  PredictionAccuracyUser
} from "../types";
import { formatKyivDateShort, formatKyivTime } from "../formatters/dates";
import { formatUserName } from "../formatters/names";
import { getAvatarLogoPath, getMatchTeamInfo } from "../features/clubs";
import { escapeAttribute, escapeHtml } from "../utils/escape";
import { renderTeamLogo } from "./matches";

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

  const formatAverage = (value: number): string => {
    return value.toFixed(1);
  };

  const rows = matches
    .slice()
    .sort((a, b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at))
    .map((match) => {
      const matchForLogos: Match = {
        id: match.match_id,
        home_team: match.home_team,
        away_team: match.away_team,
        league_id: match.league_id ?? null,
        home_club_id: match.home_club_id ?? null,
        away_club_id: match.away_club_id ?? null,
        kickoff_at: match.kickoff_at,
        status: "finished",
        home_score: match.home_score ?? null,
        away_score: match.away_score ?? null
      };
      const { homeName, awayName, homeLogo, awayLogo, homeLogoFallback, awayLogoFallback } = getMatchTeamInfo(matchForLogos);
      const homeLogoMarkup = renderTeamLogo(homeName, homeLogo, homeLogoFallback);
      const awayLogoMarkup = renderTeamLogo(awayName, awayLogo, awayLogoFallback);
      const homeAvgLabel = formatAverage(match.avg_home_pred);
      const awayAvgLabel = formatAverage(match.avg_away_pred);
      const resultLabel =
        typeof match.home_score === "number" && typeof match.away_score === "number"
          ? `${match.home_score}:${match.away_score}`
          : "—:—";
      const scoreLabel = `${match.hits}/${match.total_predictions}`;
      const accuracyPercent = Number.isFinite(match.accuracy_pct) ? Math.max(0, Math.min(100, match.accuracy_pct)) : 0;
      return `
        <div class="admin-match-accuracy-card">
          <div class="admin-match-accuracy-card__logos" aria-label="${escapeHtml(homeName)} vs ${escapeHtml(awayName)}">
            <div class="admin-match-accuracy-card__logo-item admin-match-accuracy-card__logo-item--home">
              <span class="admin-match-accuracy-card__average-side admin-match-accuracy-card__average-side--home">${escapeHtml(homeAvgLabel)}</span>
              ${homeLogoMarkup}
            </div>
            <div class="admin-match-accuracy-card__center">
              <div class="admin-match-accuracy-card__score">${escapeHtml(resultLabel)}</div>
            </div>
            <div class="admin-match-accuracy-card__logo-item admin-match-accuracy-card__logo-item--away">
              ${awayLogoMarkup}
              <span class="admin-match-accuracy-card__average-side admin-match-accuracy-card__average-side--away">${escapeHtml(awayAvgLabel)}</span>
            </div>
          </div>
          <div class="admin-match-accuracy-card__progress" role="img" aria-label="Влучність ${accuracyPercent}% (${escapeHtml(scoreLabel)})">
            <div class="admin-match-accuracy-card__progress-fill" style="width:${accuracyPercent}%"></div>
            <span class="admin-match-accuracy-card__progress-label">${accuracyPercent}% (${escapeHtml(scoreLabel)})</span>
          </div>
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

function formatChatThreadName(thread: AdminChatThread): string {
  const nickname = thread.nickname?.trim();
  if (nickname) {
    return nickname;
  }
  const username = thread.username?.trim();
  if (username) {
    return username;
  }
  const fullName = `${thread.first_name ?? ""} ${thread.last_name ?? ""}`.trim();
  if (fullName) {
    return fullName;
  }
  return thread.user_id ? `id:${thread.user_id}` : "Невідомий";
}

export function renderAdminChatThreads(threads: AdminChatThread[], selectedUserId: number | null): string {
  if (!threads.length) {
    return `<p class="muted small">Поки що немає чатів.</p>`;
  }

  const rows = threads
    .map((thread) => {
      const name = formatChatThreadName(thread);
      const timeLabel = thread.last_message_at
        ? `${formatKyivDateShort(thread.last_message_at)} · ${formatKyivTime(thread.last_message_at)}`
        : "—";
      const lastText = thread.last_text?.trim() || "—";
      const avatar = thread.photo_url
        ? `<img class="table-avatar" src="${escapeAttribute(thread.photo_url)}" alt="" />`
        : `<div class="table-avatar placeholder"></div>`;
      const isActive = typeof thread.user_id === "number" && thread.user_id === selectedUserId;
      const buttonLabel = thread.user_id ? String(thread.user_id) : "";
      return `
        <button class="admin-chat-thread${isActive ? " is-active" : ""}" type="button" data-admin-chat-thread="${escapeAttribute(buttonLabel)}">
          ${avatar}
          <div class="admin-chat-thread__body">
            <div class="admin-chat-thread__top">
              <span class="admin-chat-thread__name">${escapeHtml(name)}</span>
              <span class="admin-chat-thread__time">${escapeHtml(timeLabel)}</span>
            </div>
            <div class="admin-chat-thread__preview">${escapeHtml(lastText)}</div>
          </div>
        </button>
      `;
    })
    .join("");

  return `<div class="admin-chat-threads">${rows}</div>`;
}

export function renderAdminChatMessages(messages: AdminChatMessage[]): string {
  if (!messages.length) {
    return `<p class="muted small">Оберіть користувача зі списку.</p>`;
  }

  const rows = messages
    .slice()
    .reverse()
    .map((message) => {
      const timeLabel = message.created_at
        ? `${formatKyivDateShort(message.created_at)} · ${formatKyivTime(message.created_at)}`
        : "—";
      const text = message.text?.trim() || message.message_type;
      const isOutgoing = message.direction === "out";
      const roleLabel = message.sender === "admin" ? "адмін" : message.sender === "bot" ? "бот" : "гравець";
      return `
        <div class="admin-chat-message${isOutgoing ? " is-outgoing" : " is-incoming"}">
          <div class="admin-chat-message__meta">${escapeHtml(roleLabel)} · ${escapeHtml(timeLabel)}</div>
          <div class="admin-chat-message__bubble">${escapeHtml(text)}</div>
        </div>
      `;
    })
    .join("");

  return `<div class="admin-chat-messages">${rows}</div>`;
}
