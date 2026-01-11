import type { Env } from "../env";

export function fetchApiFootball(env: Env, path: string): Promise<Response> {
  const base = env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
  return fetch(`${base}${path}`, {
    headers: {
      "x-apisports-key": env.API_FOOTBALL_KEY ?? ""
    }
  });
}

export function getApiFootballBase(env: Env): string {
  return env.API_FOOTBALL_BASE ?? "https://v3.football.api-sports.io";
}

export function getApiFootballTimezone(env: Env): string | null {
  const value = env.API_FOOTBALL_TIMEZONE?.trim();
  if (!value || value.length > 64) {
    return null;
  }
  return value;
}

export function buildApiPath(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function logFixturesSearch(
  env: Env,
  payload: {
    source: string;
    path: string;
    params: Record<string, string | number | undefined>;
    fixturesCount: number;
    reason?: string;
  }
): void {
  const url = `${getApiFootballBase(env)}${payload.path}`;
  const params = Object.entries(payload.params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const reason = payload.reason ? ` reason=${payload.reason}` : "";
  console.info(
    `fixtures.search source=${payload.source} url=${url} ${params} result.fixtures=${payload.fixturesCount}${reason}`
  );
}

export function logFixturesFallback(reason: string, context: Record<string, string | number | undefined>): void {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`fixtures.fallback reason=${reason} ${details}`);
}
