import { TEAM_SLUG_ALIASES } from "../../../shared/teamSlugAliases";

export function normalizeTeamSlugValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }
  return TEAM_SLUG_ALIASES[normalized] ?? normalized;
}
