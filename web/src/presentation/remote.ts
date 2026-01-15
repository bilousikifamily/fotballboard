import type { PresentationRemoteMatch } from "./presentation/storage";
import { getKyivDateString } from "../formatters/dates";

export async function fetchPresentationMatches(apiBase: string): Promise<PresentationRemoteMatch[]> {
  if (!apiBase) {
    return [];
  }

  try {
    const dateParam = getKyivDateString();
    const response = await fetch(
      `${apiBase}/api/presentation/matches?date=${encodeURIComponent(dateParam)}`
    );
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json().catch(() => null)) as
      | { ok: true; matches: PresentationRemoteMatch[] }
      | { ok: false }
      | null;
    if (!payload?.ok || !Array.isArray(payload.matches)) {
      return [];
    }
    return payload.matches;
  } catch (error) {
    console.warn("Failed to fetch presentation matches", error);
    return [];
  }
}
