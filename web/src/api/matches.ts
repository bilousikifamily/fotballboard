import type {
  AnnouncementResponse,
  ClubSyncResponse,
  ConfirmMatchResponse,
  CreateMatchResponse,
  MatchWeatherResponse,
  MatchesResponse,
  OddsRefreshResponse,
  PendingMatchesResponse,
  ResultResponse
} from "../types";
import { authHeaders, authJsonHeaders, requestJson } from "./client";

export function fetchMatches(
  apiBase: string,
  initData: string,
  date: string,
  adminToken?: string
): Promise<{ response: Response; data: MatchesResponse }> {
  return requestJson<MatchesResponse>(`${apiBase}/api/matches?date=${encodeURIComponent(date)}`, {
    headers: authHeaders(initData, adminToken)
  });
}

export function fetchPendingMatches(
  apiBase: string,
  initData: string,
  adminToken?: string
): Promise<{ response: Response; data: PendingMatchesResponse }> {
  return requestJson<PendingMatchesResponse>(`${apiBase}/api/matches/pending`, {
    headers: authHeaders(initData, adminToken)
  });
}

export function fetchMatchWeather(
  apiBase: string,
  initData: string,
  matchId: number,
  adminToken?: string
): Promise<{ response: Response; data: MatchWeatherResponse }> {
  return requestJson<MatchWeatherResponse>(`${apiBase}/api/matches/weather?match_id=${matchId}`, {
    headers: authHeaders(initData, adminToken)
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
    admin_token?: string;
  },
  adminToken?: string
): Promise<{ response: Response; data: CreateMatchResponse }> {
  return requestJson<CreateMatchResponse>(`${apiBase}/api/matches`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminToken),
    body: JSON.stringify(payload)
  });
}

export function postConfirmMatch(
  apiBase: string,
  payload: { initData: string; match_id: number; admin_token?: string },
  adminToken?: string
): Promise<{ response: Response; data: ConfirmMatchResponse }> {
  return requestJson<ConfirmMatchResponse>(`${apiBase}/api/matches/confirm`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminToken),
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
    admin_token?: string;
  },
  adminToken?: string
): Promise<{ response: Response; data: ResultResponse }> {
  return requestJson<ResultResponse>(`${apiBase}/api/matches/result`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminToken),
    body: JSON.stringify(payload)
  });
}

export async function postOddsRefresh(
  apiBase: string,
  payload: { initData: string; match_id: number; debug?: boolean; admin_token?: string },
  adminToken?: string
): Promise<{ response: Response; data: OddsRefreshResponse | null }> {
  const response = await fetch(`${apiBase}/api/matches/odds`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminToken),
    body: JSON.stringify(payload)
  });
  const data = (await response.json().catch(() => null)) as OddsRefreshResponse | null;
  return { response, data };
}

export function postMatchesAnnouncement(
  apiBase: string,
  initData: string,
  adminToken?: string
): Promise<{ response: Response; data: AnnouncementResponse }> {
  return requestJson<AnnouncementResponse>(`${apiBase}/api/matches/announcement`, {
    method: "POST",
    headers: authJsonHeaders(initData, adminToken),
    body: JSON.stringify({ initData })
  });
}

export function postClubSync(
  apiBase: string,
  payload: { initData: string; league_id?: string; api_league_id?: number; season?: number },
  adminToken?: string
): Promise<{ response: Response; data: ClubSyncResponse }> {
  return requestJson<ClubSyncResponse>(`${apiBase}/api/clubs/sync`, {
    method: "POST",
    headers: authJsonHeaders(payload.initData, adminToken),
    body: JSON.stringify(payload)
  });
}
