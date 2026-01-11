import type { TeamMatchStatsResponse } from "../types";
import { authHeaders, requestJson } from "./client";

export function fetchAnalitikaTeam(
  apiBase: string,
  initData: string,
  teamSlug: string
): Promise<{ response: Response; data: TeamMatchStatsResponse }> {
  const params = new URLSearchParams({ team: teamSlug, limit: "5" });
  return requestJson<TeamMatchStatsResponse>(`${apiBase}/api/analitika?${params.toString()}`, {
    headers: authHeaders(initData)
  });
}
