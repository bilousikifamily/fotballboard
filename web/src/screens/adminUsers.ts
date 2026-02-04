import type { LeaderboardUser, Match, PredictionAccuracyMatch, PredictionAccuracyUser } from "../types";
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
      const avgScoreLabel = `${formatAverage(match.avg_home_pred)} : ${formatAverage(match.avg_away_pred)}`;
      const resultLabel =
        typeof match.home_score === "number" && typeof match.away_score === "number"
          ? `${match.home_score}:${match.away_score}`
          : "—:—";
      const scoreLabel = `${match.hits}/${match.total_predictions}`;
      const accuracyPercent = Number.isFinite(match.accuracy_pct) ? Math.max(0, Math.min(100, match.accuracy_pct)) : 0;
      return `
        <div class="admin-match-accuracy-card">
          <div class="admin-match-accuracy-card__logos" aria-label="${escapeHtml(homeName)} vs ${escapeHtml(awayName)}">
            <div class="admin-match-accuracy-card__logo-item">
              ${homeLogoMarkup}
            </div>
            <div class="admin-match-accuracy-card__center">
              <div class="admin-match-accuracy-card__score">${escapeHtml(resultLabel)}</div>
              <div class="admin-match-accuracy-card__average">${escapeHtml(avgScoreLabel)}</div>
            </div>
            <div class="admin-match-accuracy-card__logo-item">
              ${awayLogoMarkup}
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
