import { requestJson } from "./client";

type SimpleResponse = { ok: boolean; error?: string };

export function postOnboarding(
  apiBase: string,
  payload: {
    initData: string;
    classico_choice: string | null;
    ua_club_id: string | null;
    eu_club_id: string | null;
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
