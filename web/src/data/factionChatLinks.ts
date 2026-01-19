import type { FactionBranchSlug, FactionEntry } from "../types";

const FACTION_BRANCH_CHAT_URLS: Record<FactionBranchSlug, string> = {
  real_madrid: "https://t.me/football_rada/3",
  barcelona: "https://t.me/football_rada/4",
  liverpool: "https://t.me/football_rada/185",
  arsenal: "https://t.me/football_rada/184",
  chelsea: "https://t.me/football_rada/183",
  milan: "https://t.me/football_rada/186",
  "manchester-united": "https://t.me/c/3415133128/244"
};

const FACTION_BRANCH_ALIAS: Record<string, FactionBranchSlug> = {
  barcelona: "barcelona",
  barca: "barcelona",
  real_madrid: "real_madrid",
  "real-madrid": "real_madrid",
  realmadrid: "real_madrid",
  liverpool: "liverpool",
  arsenal: "arsenal",
  chelsea: "chelsea",
  milan: "milan",
  "manchester-united": "manchester-united",
  "manchester_united": "manchester-united",
  "manchester united": "manchester-united",
  "man-united": "manchester-united",
  manutd: "manchester-united",
  "man utd": "manchester-united"
};

export function resolveFactionBranchSlug(value: string | null | undefined): FactionBranchSlug | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1] ?? normalized;
  if (FACTION_BRANCH_ALIAS[candidate]) {
    return FACTION_BRANCH_ALIAS[candidate];
  }
  const underscored = candidate.replace(/[\s-]+/g, "_");
  return FACTION_BRANCH_ALIAS[underscored] ?? null;
}

export function getFactionBranchChatUrl(entry: FactionEntry | null): string | null {
  const slug = resolveFactionBranchSlug(entry?.value ?? null);
  if (!slug) {
    return null;
  }
  return FACTION_BRANCH_CHAT_URLS[slug] ?? null;
}
