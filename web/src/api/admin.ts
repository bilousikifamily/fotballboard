import type { AdminLoginResponse } from "../types";
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
