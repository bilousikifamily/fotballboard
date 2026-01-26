import type {
  AnnouncementResponse,
  ClubSyncResponse,
  ConfirmMatchResponse,
  CreateMatchResponse,
  FactionPredictionsStatsResponse,
  MatchesResponse,
  OddsRefreshResponse,
  ManualOddsResponse,
  PendingMatchesResponse,
  ResultResponse
} from "../types";
import { authHeaders, authJsonHeaders, requestJson } from "./client";

export function fetchMatches(
  apiBase: string,
  initData: string,
  date: string,
  adminSessionToken?: string
): Promise<{ response: Response; data: MatchesResponse }> {
  const url = date 
    ? `${apiBase}/api/matches?date=${encodeURIComponent(date)}`
    : `${apiBase}/api/matches`;
  return requestJson<MatchesResponse>(url, {
    headers: authHeaders(initData, adminSessionToken)
  });
}

export function fetchPendingMatches(
  apiBase: string,
  initData: string,
  adminSessionToken?: string
): Promise<{ response: Response; data: PendingMatchesResponse }> {
  return requestJson<PendingMatchesResponse>(`${apiBase}/api/matches/pending`, {
    headers: authHeaders(initData, adminSessionToken)
  });
}

export function postMatch(
  apiBase: string,
  payload: {
    initData: string;
    home_team: string;
    away_team: string;
    league_id: string;
    home_club_id: string;
    away_club_id: string;
    kickoff_at: string;
  },
  adminSessionToken?: string
): Promise<{ response: Response; data: CreateMatchResponse }> {
  return requestJson<CreateMatchResponse>(`${apiBase}/api/matches`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
}

export function postConfirmMatch(
  apiBase: string,
  payload: { initData: string; match_id: number },
  adminSessionToken?: string
): Promise<{ response: Response; data: ConfirmMatchResponse }> {
  return requestJson<ConfirmMatchResponse>(`${apiBase}/api/matches/confirm`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
}

export function postResult(
  apiBase: string,
  payload: {
    initData: string;
    match_id: number;
    home_score: number;
    away_score: number;
    home_avg_rating: number;
    away_avg_rating: number;
  },
  adminSessionToken?: string
): Promise<{ response: Response; data: ResultResponse }> {
  return requestJson<ResultResponse>(`${apiBase}/api/matches/result`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
}

export function postManualOdds(
  apiBase: string,
  payload: { initData: string; match_id: number; home_odd: number; draw_odd: number; away_odd: number },
  adminSessionToken?: string
): Promise<{ response: Response; data: ManualOddsResponse }> {
  return requestJson<ManualOddsResponse>(`${apiBase}/api/matches/odds/manual`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
}

export async function postOddsRefresh(
  apiBase: string,
  payload: { initData: string; match_id: number; debug?: boolean },
  adminSessionToken?: string
): Promise<{ response: Response; data: OddsRefreshResponse | null }> {
  const response = await fetch(`${apiBase}/api/matches/odds`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => null)) as OddsRefreshResponse | null;
  return { response, data };
}

export function postMatchesAnnouncement(
  apiBase: string,
  initData: string,
  adminSessionToken?: string
): Promise<{ response: Response; data: AnnouncementResponse }> {
  return requestJson<AnnouncementResponse>(`${apiBase}/api/matches/announcement`, {
    method: "POST",
    headers: authJsonHeaders(initData, adminSessionToken),
    body: JSON.stringify({ initData })
  });
}

export function postFactionPredictionsStats(
  apiBase: string,
  initData: string,
  adminSessionToken?: string
): Promise<{ response: Response; data: FactionPredictionsStatsResponse }> {
  return requestJson<FactionPredictionsStatsResponse>(`${apiBase}/api/faction-predictions-stats`, {
    method: "POST",
    headers: authJsonHeaders(initData, adminSessionToken),
    body: JSON.stringify({ initData })
  });
}

export function postClubSync(
  apiBase: string,
  payload: { initData: string; league_id?: string; api_league_id?: number; season?: number },
  adminSessionToken?: string
): Promise<{ response: Response; data: ClubSyncResponse }> {
  return requestJson<ClubSyncResponse>(`${apiBase}/api/clubs/sync`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminSessionToken),
    body: JSON.stringify(payload)
  });
}
