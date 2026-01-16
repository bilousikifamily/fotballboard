import { authHeaders, requestJson } from "./client";
import type { FactionMembersResponse } from "../types";

type SimpleResponse = { ok: boolean; error?: string };

export function postOnboarding(
  apiBase: string,
  payload: {
    initData: string;
    faction_club_id: string | null;
    nickname: string;
    avatar_choice: string | null;
    logo_order: string[];
  }
): Promise<{ response: Response; data: SimpleResponse }> {
  return requestJson<SimpleResponse>(`${apiBase}/api/onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function postAvatarChoice(
  apiBase: string,
  payload: { initData: string; avatar_choice: string }
): Promise<{ response: Response; data: SimpleResponse }> {
  return requestJson<SimpleResponse>(`${apiBase}/api/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function postLogoOrder(
  apiBase: string,
  payload: { initData: string; logo_order: string[] }
): Promise<{ response: Response; data: SimpleResponse }> {
  return requestJson<SimpleResponse>(`${apiBase}/api/logo-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function postNickname(
  apiBase: string,
  payload: { initData: string; nickname: string }
): Promise<{ response: Response; data: SimpleResponse }> {
  return requestJson<SimpleResponse>(`${apiBase}/api/nickname`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function fetchFactionMembers(
  apiBase: string,
  initData: string,
  limit?: number
): Promise<{ response: Response; data: FactionMembersResponse }> {
  const params = typeof limit === "number" ? `?limit=${encodeURIComponent(limit)}` : "";
  return requestJson<FactionMembersResponse>(`${apiBase}/api/faction-members${params}`, {
    headers: authHeaders(initData)
  });
}

export function fetchFactionMessages(
  apiBase: string,
  payload: { initData: string; faction?: string; limit?: number }
): Promise<{ response: Response; data: FactionMessagesResponse }> {
  return requestJson<FactionMessagesResponse>(`${apiBase}/api/faction-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
