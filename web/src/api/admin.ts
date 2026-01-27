import type { AdminLoginResponse, BotLogsResponse } from "../types";
import { requestJson } from "./client";

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
