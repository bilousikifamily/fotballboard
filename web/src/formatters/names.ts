import type { LeaderboardUser, PredictionUser } from "../types";

export function formatTelegramName(user?: TelegramWebAppUser): string {
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

export function formatUserName(user: LeaderboardUser): string {
  if (user.nickname) {
    return user.nickname;
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

export function formatPredictionName(user: PredictionUser | null): string {
  if (!user) {
    return "Гравець";
  }
  if (user.nickname) {
    return user.nickname;
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
