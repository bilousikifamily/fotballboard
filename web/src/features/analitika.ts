import { CLUB_REGISTRY, type AllLeagueId } from "../data/clubs";
import type { AnalitikaDebugInfo, AnalitikaItem, AnalitikaRefreshResponse, TeamMatchStat } from "../types";
import { formatKyivDateShort, formatKyivDateTime } from "../formatters/dates";
import { escapeAttribute, escapeHtml } from "../utils/escape";
import { formatClubName, getChampionsClubLogo, getClubLogoPath } from "./clubs";
import { normalizeTeamSlugValue } from "./teamSlugs";

export const ANALITIKA_TEAMS = [
  { slug: "arsenal", label: "Arsenal" },
  { slug: "aston-villa", label: "Aston Villa" },
  { slug: "nottingham-forest", label: "Nottingham Forest" },
  { slug: "barcelona", label: "Barcelona" },
  { slug: "chelsea", label: "Chelsea" },
  { slug: "fiorentina", label: "Fiorentina" },
  { slug: "inter", label: "Inter" },
  { slug: "leeds", label: "Leeds" },
  { slug: "liverpool", label: "Liverpool" },
  { slug: "manchester-city", label: "Manchester City" },
  { slug: "manchester-united", label: "Manchester United" },
  { slug: "milan", label: "Milan" },
  { slug: "napoli", label: "Napoli" },
  { slug: "newcastle", label: "Newcastle" },
  { slug: "real-madrid", label: "Real Madrid" }
];

export const ANALITIKA_TEAM_SLUGS = new Set(ANALITIKA_TEAMS.map((team) => team.slug));

const ANALITIKA_TYPE_LABELS: Record<string, string> = {
  team_stats: "Статистика команди (сезон)",
  standings: "Позиція в таблиці + форма",
  standings_home_away: "Домашні / виїзні показники",
  form_trends: "Тренди результатів",
  top_scorers: "Топ-бомбардири",
  top_assists: "Топ-асистенти",
  player_ratings: "Лідери за рейтингом",
  player_stats: "Статистика гравців",
  lineups: "Склади та формації",
  expected_lineups: "Очікувані склади",
  injuries: "Травми та доступність",
  head_to_head: "H2H протистояння",
  referee_cards: "Рефері та картки"
};

const ANALITIKA_TYPE_ORDER = Object.keys(ANALITIKA_TYPE_LABELS);

export function renderMatchAnalitika(matchId: number, homeName: string, awayName: string): string {
  const homeSlug = normalizeTeamSlugValue(homeName);
  const awaySlug = normalizeTeamSlugValue(awayName);
  const defaultSlug = resolveDefaultAnalitikaTeam(homeSlug, awaySlug);
  const buttons = [
    { slug: homeSlug, label: homeName },
    { slug: awaySlug, label: awayName }
  ]
    .map((team, index) => {
      const isActive = team.slug === defaultSlug || (!defaultSlug && index === 0);
      return `
        <button
          class="chip${isActive ? " is-active" : ""}"
          type="button"
          data-match-analitika-team="${escapeAttribute(team.slug)}"
          aria-pressed="${isActive ? "true" : "false"}"
        >
          ${escapeHtml(team.label)}
        </button>
      `;
    })
    .join("");

  return `
    <div class="match-analitika" data-match-analitika data-match-id="${matchId}" data-default-team="${escapeAttribute(
      defaultSlug
    )}">
      <p class="match-analitika-title">ОСТАННІ 5 МАТЧІВ</p>
      <div class="analitika-filter match-analitika-filter">
        ${buttons}
      </div>
      <div class="analitika-grid" data-match-analitika-content></div>
    </div>
  `;
}

export function resolveDefaultAnalitikaTeam(homeSlug: string, awaySlug: string): string {
  if (homeSlug === "chelsea" || awaySlug === "chelsea") {
    return "chelsea";
  }
  return homeSlug || awaySlug;
}


export function buildTeamMatchStatsStatus(items: TeamMatchStat[]): string {
  if (!items.length) {
    return "Немає даних.";
  }
  const latest = items[0];
  const latestDate = latest.match_date ? formatKyivDateTime(latest.match_date) : "—";
  return `Останній матч: ${latestDate} · Всього: ${items.length}`;
}

export function renderTeamMatchStatsList(items: TeamMatchStat[], teamSlug: string): string {
  const teamLabel = resolveTeamLabel(teamSlug);
  if (!items.length) {
    return `<p class="muted">Немає даних для ${escapeHtml(teamLabel)}.</p>`;
  }
  const orderedItems = items.slice().reverse();
  const ratingValues = orderedItems
    .map((item) => parseTeamMatchRating(item.avg_rating))
    .filter((value): value is number => value !== null);
  const minRating = ratingValues.length ? Math.min(...ratingValues) : 6.0;
  const maxRating = ratingValues.length ? Math.max(...ratingValues) : 7.5;
  const hasSpan = maxRating > minRating;
  const ratingSpan = hasSpan ? maxRating - minRating : 1;
  const pointsCount = orderedItems.length;
  const edgePad = pointsCount > 1 ? 8 : 0;
  const xSpan = 100 - edgePad * 2;
  const points = orderedItems.map((item, index) => {
    const ratingValue = parseTeamMatchRating(item.avg_rating);
    const clamped = ratingValue === null ? null : Math.min(maxRating, Math.max(minRating, ratingValue));
    const y = clamped === null ? 100 : hasSpan ? ((maxRating - clamped) / ratingSpan) * 100 : 50;
    const x = pointsCount > 1 ? edgePad + (index / (pointsCount - 1)) * xSpan : 50;
    const opponent = item.opponent_name || "—";
    const opponentLogo = resolveClubLogoByName(opponent);
    const scoreLabel = formatTeamMatchScoreLabel(item);
    const dateLabel = item.match_date ? formatKyivDateShort(item.match_date) : "";
    const homeAway = getHomeAwayLabel(item) ?? "";
    const outcomeClass = getTeamMatchOutcomeClass(item);
    return {
      x,
      y,
      opponent,
      opponentLogo,
      scoreLabel,
      dateLabel,
      homeAway,
      outcomeClass,
      ratingValue
    };
  });
  const polyline = points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const gridLines = points
    .map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === points.length - 1;
      const dateMeta = `
        <span class="analitika-line-date">
          ${point.dateLabel ? `<span>${escapeHtml(point.dateLabel)}</span>` : ""}
          ${point.homeAway ? `<span class="analitika-line-homeaway">${escapeHtml(point.homeAway)}</span>` : ""}
        </span>
      `;
      return `
        <span class="analitika-line-gridline" style="--x:${point.x}%" data-is-first="${isFirst}" data-is-last="${isLast}">
          ${point.dateLabel || point.homeAway ? dateMeta : ""}
        </span>
      `;
    })
    .join("");
  const pointMarkup = points
    .map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === points.length - 1;
      const isTopThird = point.y < 33;
      const isBottomThird = point.y > 67;
      const badgePosition = isTopThird ? "below" : isBottomThird ? "above" : "below";
      const badgeSide = isFirst ? "right" : isLast ? "left" : "center";
      
      const ariaLabel = [
        point.dateLabel,
        point.homeAway.toLowerCase(),
        `vs ${point.opponent}`,
        point.scoreLabel,
        point.ratingValue !== null ? `рейтинг ${point.ratingValue.toFixed(1)}` : ""
      ].filter(Boolean).join(", ");
      
      const score = `<span class="analitika-line-score ${escapeAttribute(point.outcomeClass)}" data-badge-position="${escapeAttribute(badgePosition)}" data-badge-side="${escapeAttribute(badgeSide)}">${escapeHtml(
        point.scoreLabel
      )}</span>`;
      return `
        <div 
          class="analitika-line-point" 
          style="--x:${point.x}%; --y:${point.y}%;"
          data-is-first="${isFirst}"
          data-is-last="${isLast}"
          aria-label="${escapeAttribute(ariaLabel)}"
        >
          <div class="analitika-line-logo">
            ${renderTeamLogo(point.opponent, point.opponentLogo)}
          </div>
          ${score}
        </div>
      `;
    })
    .join("");
  const midRating = (maxRating + minRating) / 2;
  const axisLabels = [maxRating, midRating, minRating]
    .map((value) => `<span>${value.toFixed(1)}</span>`)
    .join("");

  return `
    <section class="analitika-card is-graph" aria-label="${escapeAttribute(`${teamLabel} — останні матчі`)}">
      <div class="analitika-card-body">
        <div class="analitika-line">
          <div class="analitika-line-axis">
            ${axisLabels}
          </div>
          <div class="analitika-line-canvas">
            <div class="analitika-line-plot">
              <div class="analitika-line-grid">${gridLines}</div>
              <svg class="analitika-line-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline points="${polyline}"></polyline>
              </svg>
              ${pointMarkup}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

export function resolveTeamLabel(teamSlug: string): string {
  return ANALITIKA_TEAMS.find((team) => team.slug === teamSlug)?.label ?? teamSlug;
}

function renderTeamLogo(name: string, logo: string | null): string {
  const alt = escapeAttribute(name);
  return logo
    ? `<img class="match-logo" src="${escapeAttribute(logo)}" alt="${alt}" />`
    : `<div class="match-logo match-logo-fallback" role="img" aria-label="${alt}"></div>`;
}

const CLUB_NAME_ALIASES: Record<string, string> = {
  "athletic": "athletic-club",
  "athletic bilbao": "athletic-club",
  "barnsley fc": "barnsley",
  "newcastle united": "newcastle",
  "ipswich town": "ipswich",
  "leeds": "leeds-united",
  "alaves": "alaves",
  "deportivo alaves": "alaves",
  "atletico": "atletico-madrid",
  "atletico madrid": "atletico-madrid",
  "atletico de madrid": "atletico-madrid",
  "betis": "real-betis",
  "real betis": "real-betis",
  "wolverhampton wanderers": "wolves",
  "west ham united": "west-ham",
  "tottenham hotspur": "tottenham",
  "man city": "manchester-city",
  "man utd": "manchester-united",
  "exeter city": "exeter",
  "brighton and hove albion": "brighton",
  "nottingham forest": "nottingham-forest",
  "portsmouth": "portsmouth",
  "pafos": "pafos",
  "benfica": "benfica",
  "slavia praga": "slavia-praga"
};

type ClubLogoEntry = { slug: string; logoLeagueId: AllLeagueId };

let clubNameLookup: Map<string, ClubLogoEntry> | null = null;

export function resolveClubLogoByName(name: string): string | null {
  const normalized = normalizeClubName(name);
  if (!normalized) {
    return null;
  }
  const aliasSlug = CLUB_NAME_ALIASES[normalized];
  const candidateSlug = aliasSlug ?? normalized.replace(/\s+/g, "-");
  const championsLogo = getChampionsClubLogo(candidateSlug);
  if (championsLogo) {
    return championsLogo;
  }
  if (aliasSlug) {
    const entry = CLUB_REGISTRY[aliasSlug];
    return entry ? getClubLogoPath(entry.logoLeagueId, aliasSlug) : null;
  }
  const lookup = getClubNameLookup();
  const entry = lookup.get(normalized);
  return entry ? getClubLogoPath(entry.logoLeagueId, entry.slug) : null;
}

function getClubNameLookup(): Map<string, ClubLogoEntry> {
  if (clubNameLookup) {
    return clubNameLookup;
  }
  const map = new Map<string, ClubLogoEntry>();
  const leaguePriority: AllLeagueId[] = [
    "english-premier-league",
    "la-liga",
    "serie-a",
    "bundesliga",
    "ligue-1",
    "ukrainian-premier-league"
  ];
  leaguePriority.forEach((leagueId) => {
    Object.values(CLUB_REGISTRY).forEach((entry) => {
      if (entry.leagueId !== leagueId) {
        return;
      }
      const normalized = normalizeClubName(formatClubName(entry.slug));
      if (!normalized || map.has(normalized)) {
        return;
      }
      map.set(normalized, { slug: entry.slug, logoLeagueId: entry.logoLeagueId });
    });
  });
  Object.values(CLUB_REGISTRY).forEach((entry) => {
    const normalized = normalizeClubName(formatClubName(entry.slug));
    if (!normalized || map.has(normalized)) {
      return;
    }
    map.set(normalized, { slug: entry.slug, logoLeagueId: entry.logoLeagueId });
  });
  clubNameLookup = map;
  return map;
}

function normalizeClubName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getHomeAwayLabel(item: TeamMatchStat): string | null {
  if (item.is_home === true) {
    return "ВДОМА";
  }
  if (item.is_home === false) {
    return "ВИЇЗД";
  }
  return null;
}

function parseTeamMatchNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTeamMatchRating(value: number | string | null | undefined): number | null {
  const numeric = parseTeamMatchNumber(value);
  if (numeric === null) {
    return null;
  }
  const clamped = Math.max(0, Math.min(10, numeric));
  return Math.round(clamped * 10) / 10;
}

function formatTeamMatchScoreLabel(item: TeamMatchStat): string {
  const teamGoals = parseTeamMatchNumber(item.team_goals);
  const opponentGoals = parseTeamMatchNumber(item.opponent_goals);
  if (teamGoals === null || opponentGoals === null) {
    return "—";
  }
  if (item.is_home === false) {
    return `${opponentGoals}:${teamGoals}`;
  }
  return `${teamGoals}:${opponentGoals}`;
}

function getTeamMatchOutcomeClass(item: TeamMatchStat): string {
  const teamGoals = parseTeamMatchNumber(item.team_goals);
  const opponentGoals = parseTeamMatchNumber(item.opponent_goals);
  if (teamGoals === null || opponentGoals === null) {
    return "is-missing";
  }
  if (teamGoals > opponentGoals) {
    return "is-win";
  }
  if (teamGoals < opponentGoals) {
    return "is-loss";
  }
  return "is-draw";
}

export function buildAnalitikaStatus(items: AnalitikaItem[]): string {
  const latest = getLatestAnalitikaItem(items);
  if (!latest) {
    return "";
  }
  const updated = formatAnalitikaDate(latest.fetched_at);
  const expires = latest.expires_at ? formatAnalitikaDate(latest.expires_at) : "";
  if (expires) {
    return `Оновлено: ${updated} · TTL до ${expires}`;
  }
  return `Оновлено: ${updated}`;
}

export function renderAnalitikaList(items: AnalitikaItem[]): string {
  const grouped = new Map<string, AnalitikaItem[]>();
  items.forEach((item) => {
    const group = grouped.get(item.data_type) ?? [];
    group.push(item);
    grouped.set(item.data_type, group);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => {
      const indexA = ANALITIKA_TYPE_ORDER.indexOf(a[0]);
      const indexB = ANALITIKA_TYPE_ORDER.indexOf(b[0]);
      const safeA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA;
      const safeB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB;
      return safeA - safeB;
    })
    .map(([dataType, group]) => renderAnalitikaSection(dataType, group))
    .join("");
}

export function renderAnalitikaSection(dataType: string, items: AnalitikaItem[]): string {
  const title = ANALITIKA_TYPE_LABELS[dataType] ?? dataType;
  const body = renderAnalitikaBody(dataType, items);

  return `
    <section class="analitika-card" data-analitika-type="${escapeAttribute(dataType)}">
      <div class="analitika-card-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="analitika-card-body">
        ${body}
      </div>
    </section>
  `;
}

function renderAnalitikaBody(dataType: string, items: AnalitikaItem[]): string {
  if (!items.length) {
    return renderAnalitikaEmpty();
  }

  const payload = items[0]?.payload;

  switch (dataType) {
    case "team_stats":
      return renderAnalitikaKeyValueTable(payload, [
        { key: "gf", label: "Голи забито" },
        { key: "ga", label: "Голи пропущено" },
        { key: "xg", label: "xG" },
        { key: "ppda", label: "PPDA" },
        { key: "shots", label: "Удари за матч" },
        { key: "shots_on_target", label: "Удари в площину" },
        { key: "possession", label: "Володіння (%)" },
        { key: "clean_sheets", label: "Сухі матчі" }
      ]);
    case "standings":
      return renderAnalitikaKeyValueTable(payload, [
        { key: "rank", label: "Позиція" },
        { key: "points", label: "Очки" },
        { key: "played", label: "Матчі" },
        { key: "wins", label: "Перемоги" },
        { key: "draws", label: "Нічиї" },
        { key: "losses", label: "Поразки" },
        { key: "gf", label: "Забито" },
        { key: "ga", label: "Пропущено" },
        { key: "gd", label: "Різниця" },
        { key: "form", label: "Форма" }
      ]);
    case "standings_home_away":
      return renderAnalitikaHomeAway(payload);
    case "form_trends":
      return renderAnalitikaKeyValueTable(payload, [
        { key: "streak_type", label: "Тип серії" },
        { key: "streak_len", label: "Довжина серії" },
        { key: "form", label: "Форма" },
        { key: "last_results", label: "Останні результати" }
      ]);
    case "top_scorers":
      return renderAnalitikaRankingTable(payload, "Голи", "goals");
    case "top_assists":
      return renderAnalitikaRankingTable(payload, "Асисти", "assists");
    case "player_ratings":
      return renderAnalitikaRankingTable(payload, "Рейтинг", "rating");
    case "player_stats":
      return renderAnalitikaPlayerStats(payload);
    case "lineups":
      return renderAnalitikaLineups(payload);
    case "expected_lineups":
      return renderAnalitikaLineups(payload);
    case "injuries":
      return renderAnalitikaInjuries(payload);
    case "head_to_head":
      return renderAnalitikaHeadToHead(payload);
    case "referee_cards":
      return renderAnalitikaReferees(payload);
    default:
      return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
}

function renderAnalitikaKeyValueTable(
  payload: unknown,
  fields: Array<{ key: string; label: string }>
): string {
  const record = toRecord(payload);
  if (!record) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = fields
    .map((field) => ({
      label: field.label,
      value: record[field.key]
    }))
    .filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
  if (!rows.length) {
    return renderAnalitikaEmpty();
  }
  return renderAnalitikaTable(
    ["Показник", "Значення"],
    rows.map((row) => [row.label, row.value])
  );
}

function renderAnalitikaHomeAway(payload: unknown): string {
  const record = toRecord(payload);
  if (!record) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const home = toRecord(record.home);
  const away = toRecord(record.away);
  if (!home && !away) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }

  const fields = [
    { key: "played", label: "Матчі" },
    { key: "wins", label: "Перемоги" },
    { key: "draws", label: "Нічиї" },
    { key: "losses", label: "Поразки" },
    { key: "gf", label: "Забито" },
    { key: "ga", label: "Пропущено" },
    { key: "points", label: "Очки" },
    { key: "form", label: "Форма" }
  ];
  const rows = fields.map((field) => [
    field.label,
    home?.[field.key] ?? null,
    away?.[field.key] ?? null
  ]);

  return renderAnalitikaTable(["Показник", "Домашні", "Виїзні"], rows);
}

function renderAnalitikaRankingTable(payload: unknown, valueLabel: string, valueKey: string): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = entries.map((entry) => [
    getEntryName(entry, "player"),
    getEntryName(entry, "team"),
    getEntryStat(entry, valueKey)
  ]);
  return renderAnalitikaTable(["Гравець", "Команда", valueLabel], rows);
}

function renderAnalitikaPlayerStats(payload: unknown): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = entries.map((entry) => [
    getEntryName(entry, "player"),
    getEntryName(entry, "team"),
    getEntryStat(entry, "goals"),
    getEntryStat(entry, "assists"),
    getEntryStat(entry, "rating"),
    getEntryStat(entry, "minutes")
  ]);
  return renderAnalitikaTable(["Гравець", "Команда", "Голи", "Асисти", "Рейтинг", "Хвилини"], rows);
}

function renderAnalitikaLineups(payload: unknown): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = entries.map((entry) => [
    getEntryLabel(entry, "fixture"),
    getEntryLabel(entry, "formation"),
    normalizeNameList(entry.start_xi ?? entry.starting ?? entry.startXI),
    normalizeNameList(entry.subs ?? entry.substitutes ?? entry.bench)
  ]);
  return renderAnalitikaTable(["Матч", "Схема", "Старт", "Запас"], rows);
}

function renderAnalitikaInjuries(payload: unknown): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = entries.map((entry) => [
    getEntryName(entry, "player"),
    getEntryLabel(entry, "status"),
    getEntryLabel(entry, "reason"),
    getEntryLabel(entry, "since"),
    getEntryLabel(entry, "until")
  ]);
  return renderAnalitikaTable(["Гравець", "Статус", "Причина", "З", "По"], rows);
}

function renderAnalitikaHeadToHead(payload: unknown): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
  }
  const rows = entries.map((entry) => [
    getEntryLabel(entry, "date"),
    getEntryLabel(entry, "home"),
    getEntryLabel(entry, "away"),
    getEntryLabel(entry, "score"),
    getEntryLabel(entry, "league")
  ]);
  return renderAnalitikaTable(["Дата", "Господарі", "Гості", "Рахунок", "Ліга"], rows);
}

function renderAnalitikaReferees(payload: unknown): string {
  const entries = toEntryList(payload);
  if (!entries.length) {
    const record = toRecord(payload);
    if (!record) {
      return renderAnalitikaCustomTable(payload) ?? renderAnalitikaEmpty();
    }
    const rows = [
      ["Рефері", record.referee ?? record.name],
      ["Матчів", record.matches],
      ["Жовті / матч", record.yellow_avg],
      ["Червоні / матч", record.red_avg]
    ];
    return renderAnalitikaTable(["Показник", "Значення"], rows);
  }
  const rows = entries.map((entry) => [
    getEntryName(entry, "referee"),
    getEntryStat(entry, "matches"),
    getEntryStat(entry, "yellow_avg"),
    getEntryStat(entry, "red_avg")
  ]);
  return renderAnalitikaTable(["Рефері", "Матчі", "Жовті/матч", "Червоні/матч"], rows);
}

function renderAnalitikaCustomTable(payload: unknown): string | null {
  const record = toRecord(payload);
  if (!record) {
    return null;
  }
  const columns = Array.isArray(record.columns) ? record.columns.map((item) => String(item)) : null;
  const rows = Array.isArray(record.rows) ? record.rows : null;
  if (!columns || !rows) {
    return null;
  }
  const normalizedRows = rows.map((row) => (Array.isArray(row) ? row : [row]));
  return renderAnalitikaTable(columns, normalizedRows);
}

export function renderAnalitikaTable(headers: string[], rows: Array<Array<unknown>>): string {
  if (!rows.length) {
    return renderAnalitikaEmpty();
  }
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const value = formatAnalitikaCell(cell);
          const safe = escapeHtml(value).replace(/\n/g, "<br />");
          return `<td>${safe}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="analitika-table-wrap">
      <table class="analitika-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderAnalitikaEmpty(): string {
  return `<p class="muted small">Немає даних.</p>`;
}

function formatAnalitikaDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatAnalitikaCell(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatAnalitikaCell(entry)).join("\n");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  return String(value);
}

export function renderAnalitikaDebugInfo(debug: AnalitikaDebugInfo | null, warnings: string[]): string {
  if (!debug) {
    return `<p class="muted small">Немає діагностичних даних.</p>`;
  }

  const teamRows = (debug.teams ?? []).map((team) => [
    team.slug,
    team.team_id ?? "—"
  ]);
  const countRows = [
    ["standings", debug.counts?.standings ?? "—"],
    ["top_scorers", debug.counts?.top_scorers ?? "—"],
    ["top_assists", debug.counts?.top_assists ?? "—"],
    ["head_to_head", debug.counts?.head_to_head ?? "—"]
  ];
  const teamCounts = debug.counts?.team_stats ?? {};
  Object.entries(teamCounts).forEach(([slug, count]) => {
    countRows.push([`team_stats:${slug}`, count]);
  });
  const standingsSample = (debug.samples?.standings_teams ?? [])
    .map((entry) => `${entry.id ?? "—"} ${entry.name}`.trim())
    .filter(Boolean)
    .join(", ");
  const statusRows = [
    ["standings", debug.statuses?.standings ?? "—"],
    ["top_scorers", debug.statuses?.top_scorers ?? "—"],
    ["top_assists", debug.statuses?.top_assists ?? "—"],
    ["head_to_head", debug.statuses?.head_to_head ?? "—"]
  ];
  const teamStats = debug.statuses?.team_stats ?? {};
  Object.entries(teamStats).forEach(([slug, status]) => {
    statusRows.push([`team_stats:${slug}`, status]);
  });

  const warningsMarkup = warnings.length
    ? `<p class="muted small">Попередження: ${escapeHtml(warnings.join(", "))}</p>`
    : "";

  return `
    <div class="analitika-debug-grid">
      <div>
        <div class="analitika-debug-title">Конфіг</div>
        ${renderAnalitikaTable(
          ["Поле", "Значення"],
          [
            ["league", debug.league_slug ?? "—"],
            ["api_league_id", debug.api_league_id ?? "—"],
            ["season", debug.season ?? "—"],
            ["timezone", debug.timezone ?? "—"]
          ]
        )}
      </div>
      <div>
        <div class="analitika-debug-title">Команди (ID)</div>
        ${renderAnalitikaTable(["slug", "team_id"], teamRows)}
      </div>
      <div>
        <div class="analitika-debug-title">Кількість даних</div>
        ${renderAnalitikaTable(["endpoint", "count"], countRows)}
        ${standingsSample ? `<p class="muted small">standings sample: ${escapeHtml(standingsSample)}</p>` : ""}
      </div>
      <div>
        <div class="analitika-debug-title">Статуси API</div>
        ${renderAnalitikaTable(["endpoint", "status"], statusRows)}
      </div>
    </div>
    ${warningsMarkup}
  `;
}

export function renderAnalitikaDebugError(response: AnalitikaRefreshResponse): string {
  if (!response || response.ok) {
    return `<p class="muted small">Немає даних про помилку.</p>`;
  }
  const detail = response.detail ? ` (${escapeHtml(response.detail)})` : "";
  const error = escapeHtml(response.error ?? "unknown");
  const debug = response.debug ? renderAnalitikaDebugInfo(response.debug, []) : "";
  return `
    <div class="analitika-debug-error">
      <p class="muted small">Помилка: ${error}${detail}</p>
      ${debug}
    </div>
  `;
}

function getLatestAnalitikaItem(items: AnalitikaItem[]): AnalitikaItem | null {
  if (!items.length) {
    return null;
  }
  return items.reduce((latest, item) => {
    const latestTime = new Date(latest.fetched_at).getTime();
    const itemTime = new Date(item.fetched_at).getTime();
    return itemTime > latestTime ? item : latest;
  }, items[0]);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toEntryList(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((entry) => typeof entry === "object" && entry !== null) as Array<Record<string, unknown>>;
  }
  const record = toRecord(payload);
  if (!record) {
    return [];
  }
  const entries = record.entries;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter((entry) => typeof entry === "object" && entry !== null) as Array<Record<string, unknown>>;
}

function getEntryName(entry: Record<string, unknown>, key: string): string {
  const candidate = entry[key];
  if (typeof candidate === "string") {
    return candidate;
  }
  const altKey = `${key}_name`;
  const altValue = entry[altKey];
  if (typeof altValue === "string") {
    return altValue;
  }
  const camelKey = `${key}Name`;
  const camelValue = entry[camelKey];
  if (typeof camelValue === "string") {
    return camelValue;
  }
  const record = toRecord(candidate);
  const name = record?.name;
  return typeof name === "string" ? name : "";
}

function getEntryLabel(entry: Record<string, unknown>, key: string): string {
  const value = entry[key];
  return formatAnalitikaCell(value);
}

function getEntryStat(entry: Record<string, unknown>, key: string): unknown {
  if (key in entry) {
    return extractStatValue(entry[key]);
  }
  const altKey = `${key}_total`;
  if (altKey in entry) {
    return extractStatValue(entry[altKey]);
  }
  return null;
}

function extractStatValue(value: unknown): unknown {
  const record = toRecord(value);
  if (record) {
    if ("total" in record) {
      return record.total;
    }
    if ("value" in record) {
      return record.value;
    }
    if ("avg" in record) {
      return record.avg;
    }
    if ("average" in record) {
      return record.average;
    }
  }
  return value;
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      const record = toRecord(entry);
      if (!record) {
        return "";
      }
      const name = record.name;
      if (typeof name === "string") {
        return name;
      }
      const player = toRecord(record.player);
      if (player && typeof player.name === "string") {
        return player.name;
      }
      return "";
    })
    .filter(Boolean);
}
