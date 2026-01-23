export function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Telegram-InitData, X-Presentation-Admin-Token"
  };
}

export function corsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers
  };
  return new Response(JSON.stringify(data), { status, headers: baseHeaders });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
