import type { LeaderboardResponse } from "../types";
import { authHeaders, requestJson } from "./client";

export function fetchLeaderboard(
  apiBase: string,
  initData: string
): Promise<{ response: Response; data: LeaderboardResponse }> {
  return requestJson<LeaderboardResponse>(`${apiBase}/api/leaderboard`, {
    headers: authHeaders(initData)
  });
}
