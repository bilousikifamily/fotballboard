import type { FactionEntry, FactionMember, LeaderboardUser } from "../types";
import { formatUserName } from "../formatters/names";
import { formatClubName, getAvatarLogoPath } from "./clubs";
import { escapeAttribute, escapeHtml } from "../utils/escape";

const FACTION_PRIZE_MAP: Record<number, string> = {
  1: "/images/500.png",
  2: "/images/200.png",
  3: "/images/100.png",
  4: "/images/50.png",
  5: "/images/20.png"
};
const MAX_FACTION_CARDS = 6;
const MAX_TOP_FACTION_CARDS = 3;

const factionPrizeMap = new Map<string, string>();
const factionRankCache = new Map<string, number>();

function normalizeFactionId(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function getFactionRankPrize(rank?: number | null): string | null {
  if (rank === undefined || rank === null) {
    return null;
  }
  const normalizedRank = Math.floor(rank);
  if (normalizedRank < 1 || normalizedRank > 3) {
    return null;
  }
  return FACTION_PRIZE_MAP[normalizedRank] ?? null;
}

function getCachedFactionRank(factionId?: string | null): number | null {
  const normalized = normalizeFactionId(factionId);
  return normalized ? factionRankCache.get(normalized) ?? null : null;
}

export function getFactionPrizeSrc(factionId?: string | null): string | null {
  const normalized = normalizeFactionId(factionId);
  return normalized ? factionPrizeMap.get(normalized) ?? null : null;
}

export function renderUsersError(container: HTMLElement): void {
  container.innerHTML = `<p class="muted small">Не вдалося завантажити таблицю.</p>`;
}

function collapseLeaderboardByFaction(users: LeaderboardUser[]): LeaderboardUser[] {
  const seen = new Set<string>();
  const collapsed: LeaderboardUser[] = [];
  for (const user of users) {
    const normalized = normalizeFactionId(user.faction_club_id);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    collapsed.push(user);
  }
  return collapsed;
}

export function renderLeaderboardList(
  users: LeaderboardUser[],
  options: { currentUserId: number | null; startingPoints: number; primaryFactionLogo?: string | null; primaryFactionId?: string | null }
): string {
  factionPrizeMap.clear();
  const uniqueUsers = collapseLeaderboardByFaction(users);
  if (!uniqueUsers.length) {
    return `<p class="muted small">Поки що немає користувачів.</p>`;
  }

  // Знаходимо фракцію поточного користувача з даних таблиці
  const currentUserInList = uniqueUsers.find((user) => options.currentUserId === user.id);
  const currentUserFactionId = currentUserInList?.faction_club_id ?? options.primaryFactionId ?? null;

  let lastPoints: number | null = null;
  let currentRank = 0;
  const rows = uniqueUsers
    .map((user) => {
      const factionLabel =
        user.faction_club_id && user.faction_club_id.trim()
          ? formatClubName(user.faction_club_id)
          : formatUserName(user);
      const displayName = factionLabel || "Фракція не обрана";
      const points = typeof user.points_total === "number" ? user.points_total : options.startingPoints;
      if (lastPoints === null || points !== lastPoints) {
        currentRank += 1;
        lastPoints = points;
      }
      const isSelf = options.currentUserId === user.id;
      const isTop = currentRank <= 3;
      const normalizedUserFaction = normalizeFactionId(user.faction_club_id);
      const normalizedPrimaryFaction = normalizeFactionId(currentUserFactionId);
      const isSameFaction = normalizedUserFaction && normalizedPrimaryFaction && normalizedUserFaction === normalizedPrimaryFaction;
      const rowClasses = ["leaderboard-row"];
      if (isSelf) {
        rowClasses.push("is-self");
      }
      if (isTop) {
        rowClasses.push("is-top");
      }
      if (isSameFaction) {
        rowClasses.push("is-faction");
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
      const prizeSrc = currentRank <= 3 ? FACTION_PRIZE_MAP[currentRank] : null;
      const normalizedFaction = normalizeFactionId(user.faction_club_id);
      if (normalizedFaction && prizeSrc) {
        factionPrizeMap.set(normalizedFaction, prizeSrc);
      }
      const prizeIcon = prizeSrc
        ? `<img src="${escapeAttribute(prizeSrc)}" alt="" />`
        : "";
      return `
        <div class="${rowClasses.join(" ")}">
          <span class="leaderboard-rank">${currentRank}</span>
          <div class="leaderboard-identity">
            ${avatar}
            <span class="leaderboard-name">${escapeHtml(displayName)}</span>
          </div>
          <span class="leaderboard-points">${points}</span>
          <span class="leaderboard-prize ${prizeIcon ? "is-visible" : ""}">
            ${prizeIcon}
          </span>
        </div>
      `;
    })
    .join("");

  return `<div class="leaderboard-rows">${rows}</div>`;
}

function buildFactionRankCache(users: LeaderboardUser[], startingPoints: number): Map<string, number> {
  const cache = new Map<string, number>();
  const seen = new Set<string>();
  let lastPoints: number | null = null;
  let currentRank = 0;
  for (const user of users) {
    const normalized = normalizeFactionId(user.faction_club_id);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    const points = typeof user.points_total === "number" ? user.points_total : startingPoints;
    if (lastPoints === null || points !== lastPoints) {
      currentRank += 1;
      lastPoints = points;
    }
    seen.add(normalized);
    cache.set(normalized, currentRank);
  }
  return cache;
}

export function updateFactionRankCache(users: LeaderboardUser[], startingPoints: number): void {
  const latestRanks = buildFactionRankCache(users, startingPoints);
  factionRankCache.clear();
  latestRanks.forEach((rank, key) => {
    factionRankCache.set(key, rank);
  });
}

export function renderFactionMembersSection(entry: FactionEntry | null): string {
  const placeholderText = entry ? "Завантаження..." : "Фракцію ще не обрано.";
  return `
    <div class="faction-members-heading">
      <h2>ТОП 3 ДЕПУТАТІВ ФРАКЦІЇ</h2>
    </div>
    <section class="panel faction-members">
      <div class="faction-members-table" data-faction-members>
        <p class="muted small">${placeholderText}</p>
      </div>
    </section>
  `;
}

export function renderFactionMembersRows(
  members: FactionMember[],
  highlightId: number | null,
  factionLogo: string | null,
  factionId: string | null,
  factionRank: number | null
): string {
  if (!members.length) {
    return `<p class="muted small">У цій фракції ще немає голосів.</p>`;
  }
  const cachedRank = getCachedFactionRank(factionId);
  const globalPrizeSrc = getFactionRankPrize(cachedRank ?? factionRank);
  const topMembers = members.slice(0, Math.min(members.length, MAX_TOP_FACTION_CARDS));
  const displayMembers = [...topMembers];
  if (highlightId !== null) {
    const userIndex = members.findIndex((member) => member.id === highlightId);
    if (userIndex !== -1) {
      const userInTop = topMembers.some((member) => member.id === highlightId);
      if (!userInTop) {
        displayMembers.push(members[userIndex]);
      }
    }
  }
  const rows = displayMembers
    .slice(0, MAX_FACTION_CARDS)
    .map((member) => {
      const displayName = formatUserName(member) || "Гравець";
      const safeName = escapeHtml(displayName);
      const points = typeof member.points_total === "number" ? member.points_total : 0;
      const safePoints = escapeHtml(String(points));
      const isSelf = highlightId !== null && member.id === highlightId;
      const avatarLogo = getAvatarLogoPath(member.avatar_choice);
      const avatar = factionLogo
        ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(factionLogo)}" alt="" />`
        : avatarLogo
          ? `<img class="table-avatar logo-avatar" src="${escapeAttribute(avatarLogo)}" alt="" />`
          : member.photo_url
          ? `<img class="table-avatar" src="${escapeAttribute(member.photo_url)}" alt="" />`
          : `<div class="table-avatar placeholder"></div>`;
      const prizeIcon = globalPrizeSrc ? `<img src="${escapeAttribute(globalPrizeSrc)}" alt="" />` : "";
      return `
        <div class="leaderboard-row${isSelf ? " is-self" : ""}">
          <div class="leaderboard-rank" aria-hidden="true"></div>
          <div class="leaderboard-identity">
            ${avatar}
            <span class="leaderboard-name">${safeName}</span>
          </div>
          <div class="leaderboard-points">
            <span class="leaderboard-points-value">${safePoints}</span>
          </div>
          <span class="leaderboard-prize ${prizeIcon ? "is-visible" : ""}">
            ${prizeIcon}
          </span>
        </div>
      `;
    })
    .join("");
  return `<div class="leaderboard-rows">${rows}</div>`;
}
