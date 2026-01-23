export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{
  response: Response;
  data: T;
}> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T;
  return { response, data };
}

export function authHeaders(initData?: string, adminToken?: string): HeadersInit {
  const headers: HeadersInit = {};
  if (initData) {
    headers["X-Telegram-InitData"] = initData;
  }
  if (adminToken) {
    headers["X-Presentation-Admin-Token"] = adminToken;
  }
  return headers;
}

export function authJsonHeaders(initData?: string, adminToken?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...authHeaders(initData, adminToken)
  };
}
