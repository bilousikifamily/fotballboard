import type { LeaderboardResponse } from "../types";
import { authHeaders, requestJson } from "./client";

export function fetchLeaderboard(
  apiBase: string,
  initData: string,
  limit?: number,
  adminToken?: string
): Promise<{ response: Response; data: LeaderboardResponse }> {
  const params = typeof limit === "number" ? `?limit=${encodeURIComponent(limit)}` : "";
  return requestJson<LeaderboardResponse>(`${apiBase}/api/leaderboard${params}`, {
    headers: authHeaders(initData, adminToken)
  });
}
