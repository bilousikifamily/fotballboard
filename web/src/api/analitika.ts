import type { TeamMatchStatsResponse } from "../types";
import { authHeaders, requestJson } from "./client";

export function fetchAnalitikaTeam(
  apiBase: string,
  initData: string,
  teamSlug: string
): Promise<{ response: Response; data: TeamMatchStatsResponse }> {
  return requestJson<TeamMatchStatsResponse>(`${apiBase}/api/analitika?team=${encodeURIComponent(teamSlug)}`, {
    headers: authHeaders(initData)
  });
}
