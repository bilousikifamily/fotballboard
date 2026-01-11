import type { Match } from "../types";

export function getPredictionCloseAtMs(kickoffAt: string): number | null {
  const kickoff = new Date(kickoffAt);
  if (Number.isNaN(kickoff.getTime())) {
    return null;
  }
  return kickoff.getTime();
}

export function getMatchPredictionCloseAtMs(match: Match): number | null {
  if (match.prediction_closes_at) {
    const parsed = new Date(match.prediction_closes_at).getTime();
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return getPredictionCloseAtMs(match.kickoff_at);
}

export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
