export async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{
  response: Response;
  data: T;
}> {
  const response = await fetch(input, init);
  const data = (await response.json()) as T;
  return { response, data };
}

export function authHeaders(initData: string): HeadersInit {
  return {
    "X-Telegram-InitData": initData
  };
}

export function authJsonHeaders(initData: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Telegram-InitData": initData
  };
}
