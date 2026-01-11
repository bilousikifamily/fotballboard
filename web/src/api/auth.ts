import type { AuthResponse } from "../types";
import { requestJson } from "./client";

export function fetchAuth(apiBase: string, initData: string): Promise<{
  response: Response;
  data: AuthResponse;
}> {
  return requestJson<AuthResponse>(`${apiBase}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData })
  });
}
