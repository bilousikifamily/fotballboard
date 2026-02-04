import type { AdminLoginResponse, BotLogsResponse, ChannelWebappResponse, PredictionAccuracyResponse } from "../types";
import { authJsonHeaders, requestJson } from "./client";

export function postAdminLogin(
  apiBase: string,
  payload: { username: string; password: string }
): Promise<{ response: Response; data: AdminLoginResponse }> {
  return requestJson<AdminLoginResponse>(`${apiBase}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function fetchBotLogs(
  apiBase: string,
  token: string,
  params: { since?: number; limit?: number } = {}
): Promise<{ response: Response; data: BotLogsResponse }> {
  const url = new URL(`${apiBase}/api/admin/bot-logs`);
  if (typeof params.since === "number") {
    url.searchParams.set("since", String(params.since));
  }
  if (typeof params.limit === "number") {
    url.searchParams.set("limit", String(params.limit));
  }
  return requestJson<BotLogsResponse>(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
}

export function postChannelWebapp(
  apiBase: string,
  payload: { caption?: string },
  adminSessionToken?: string
): Promise<{ response: Response; data: ChannelWebappResponse }> {
  return requestJson<ChannelWebappResponse>(`${apiBase}/api/admin/channel-webapp`, {
    method: "POST",
    headers: authJsonHeaders(undefined, adminSessionToken),
    body: JSON.stringify(payload)
  });
}

export function fetchPredictionAccuracy(
  apiBase: string,
  token: string,
  params: { limit?: number; month?: string } = {}
): Promise<{ response: Response; data: PredictionAccuracyResponse }> {
  const url = new URL(`${apiBase}/api/admin/prediction-accuracy`);
  if (typeof params.limit === "number") {
    url.searchParams.set("limit", String(params.limit));
  }
  if (typeof params.month === "string" && params.month.trim()) {
    url.searchParams.set("month", params.month.trim());
  }
  return requestJson<PredictionAccuracyResponse>(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
}
