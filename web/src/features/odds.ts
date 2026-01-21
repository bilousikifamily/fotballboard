import type { Match } from "../types";

export function renderMatchOdds(match: Match, homeName: string, awayName: string): string {
  const probabilities = getMatchWinnerProbabilities(match, homeName, awayName);
  if (!probabilities) {
    return "";
  }
  const hasCompetition = Boolean(match.tournament_name || match.tournament_stage);
  const competitionClass = hasCompetition ? " has-competition" : "";
  return `
    <div class="match-odds-values${competitionClass}" data-match-odds data-match-id="${match.id}">
      <span class="match-odds-value" data-odds-choice="home">
        <span class="match-odds-key">1</span>
        <span class="match-odds-num">${formatProbability(probabilities.home)}</span>
      </span>
      <span class="match-odds-value" data-odds-choice="draw">
        <span class="match-odds-key">X</span>
        <span class="match-odds-num">${formatProbability(probabilities.draw)}</span>
      </span>
      <span class="match-odds-value" data-odds-choice="away">
        <span class="match-odds-key">2</span>
        <span class="match-odds-num">${formatProbability(probabilities.away)}</span>
      </span>
    </div>
  `;
}

export function getMatchWinnerProbabilities(
  match: Match,
  homeName: string,
  awayName: string
): { home: number; draw: number; away: number } | null {
  return extractOddsProbabilities(match.odds_json, homeName, awayName);
}

function extractOddsProbabilities(
  oddsJson: unknown,
  homeName: string,
  awayName: string
): { home: number; draw: number; away: number } | null {
  if (!Array.isArray(oddsJson) || !oddsJson.length) {
    return null;
  }
  const homeNormalized = normalizeOddsLabel(homeName);
  const awayNormalized = normalizeOddsLabel(awayName);

  for (const entry of oddsJson) {
    const bookmakers = (entry as { bookmakers?: unknown }).bookmakers;
    if (!Array.isArray(bookmakers)) {
      continue;
    }
    for (const bookmaker of bookmakers) {
      const bets = (bookmaker as { bets?: unknown }).bets;
      if (!Array.isArray(bets) || !bets.length) {
        continue;
      }
      const preferred = bets.filter((bet) => isMatchWinnerBet(bet as { id?: number; name?: string }));
      const candidates = preferred.length ? preferred : bets;
      for (const bet of candidates) {
        const values = (bet as { values?: unknown }).values;
        if (!Array.isArray(values)) {
          continue;
        }
        const odds = resolveThreeWayOdds(values, homeNormalized, awayNormalized);
        if (odds) {
          const probabilities = toProbability(odds.home, odds.draw, odds.away);
          if (probabilities) {
            return probabilities;
          }
        }
      }
    }
  }

  return null;
}

export function extractCorrectScoreProbability(
  oddsJson: unknown,
  homeScore: number,
  awayScore: number
): number | null {
  const odd = extractCorrectScoreOdd(oddsJson, homeScore, awayScore);
  if (!odd) {
    return null;
  }
  return (1 / odd) * 100;
}

function extractCorrectScoreOdd(oddsJson: unknown, homeScore: number, awayScore: number): number | null {
  if (!Array.isArray(oddsJson) || !oddsJson.length) {
    return null;
  }

  for (const entry of oddsJson) {
    const bookmakers = (entry as { bookmakers?: unknown }).bookmakers;
    if (!Array.isArray(bookmakers)) {
      continue;
    }
    for (const bookmaker of bookmakers) {
      const bets = (bookmaker as { bets?: unknown }).bets;
      if (!Array.isArray(bets) || !bets.length) {
        continue;
      }
      for (const bet of bets) {
        if (!isCorrectScoreBet(bet as { id?: number; name?: string })) {
          continue;
        }
        const values = (bet as { values?: unknown }).values;
        if (!Array.isArray(values)) {
          continue;
        }
        for (const value of values) {
          const labelRaw = typeof value.value === "string" ? value.value.trim() : "";
          if (!labelRaw) {
            continue;
          }
          const score = parseScoreLabel(labelRaw);
          if (!score) {
            continue;
          }
          if (score.home === homeScore && score.away === awayScore) {
            const oddValue = parseOddNumber(value.odd);
            if (oddValue) {
              return oddValue;
            }
          }
        }
      }
    }
  }

  return null;
}

function isCorrectScoreBet(bet: { id?: number; name?: string }): boolean {
  const name = bet.name?.toLowerCase() ?? "";
  return name.includes("correct score") || name.includes("exact score");
}

function parseScoreLabel(value: string): { home: number; away: number } | null {
  const match = /(\d+)\s*[:\-]\s*(\d+)/.exec(value);
  if (!match) {
    return null;
  }
  const home = Number.parseInt(match[1], 10);
  const away = Number.parseInt(match[2], 10);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    return null;
  }
  return { home, away };
}

function resolveThreeWayOdds(
  values: Array<{ value?: string; odd?: string | number }>,
  homeNormalized: string,
  awayNormalized: string
): { home: number; draw: number; away: number } | null {
  let home: number | null = null;
  let draw: number | null = null;
  let away: number | null = null;

  for (const entry of values) {
    const labelRaw = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!labelRaw) {
      continue;
    }
    const labelLower = labelRaw.toLowerCase();
    const labelNormalized = normalizeOddsLabel(labelRaw);
    const oddValue = parseOddNumber(entry.odd);
    if (!oddValue) {
      continue;
    }

    if (labelLower === "home" || labelLower === "1") {
      home = oddValue;
      continue;
    }
    if (labelLower === "draw" || labelLower === "x") {
      draw = oddValue;
      continue;
    }
    if (labelLower === "away" || labelLower === "2") {
      away = oddValue;
      continue;
    }

    if (labelNormalized && isOddsLabelMatch(labelNormalized, homeNormalized)) {
      home = oddValue;
      continue;
    }
    if (labelNormalized && isOddsLabelMatch(labelNormalized, awayNormalized)) {
      away = oddValue;
      continue;
    }
  }

  if (!home || !draw || !away) {
    return null;
  }

  return { home, draw, away };
}

function isOddsLabelMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  return left === right || left.includes(right) || right.includes(left);
}

function isMatchWinnerBet(bet: { id?: number; name?: string }): boolean {
  if (bet.id === 1) {
    return true;
  }
  const name = bet.name?.toLowerCase() ?? "";
  return name.includes("match winner") || name.includes("match result") || name.includes("fulltime result");
}

function normalizeOddsLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function parseOddNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toProbability(homeOdd: number, drawOdd: number, awayOdd: number): { home: number; draw: number; away: number } | null {
  const homeInv = 1 / homeOdd;
  const drawInv = 1 / drawOdd;
  const awayInv = 1 / awayOdd;
  const total = homeInv + drawInv + awayInv;
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return {
    home: (homeInv / total) * 100,
    draw: (drawInv / total) * 100,
    away: (awayInv / total) * 100
  };
}

export function formatProbability(value: number): string {
  return `${Math.round(value)}%`;
}
