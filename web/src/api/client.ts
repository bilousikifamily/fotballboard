export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{
  response: Response;
  data: T;
}> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T;
  return { response, data };
}

export function authHeaders(initData?: string, adminSessionToken?: string): HeadersInit {
  const headers: HeadersInit = {};
  if (initData) {
    headers["X-Telegram-InitData"] = initData;
  }
  if (adminSessionToken) {
    headers["Authorization"] = `Bearer ${adminSessionToken}`;
  }
  return headers;
}

export function authJsonHeaders(initData?: string, adminSessionToken?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...authHeaders(initData, adminSessionToken)
  };
}
