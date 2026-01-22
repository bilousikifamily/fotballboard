export type LeagueId =
  | "english-premier-league"
  | "la-liga"
  | "serie-a"
  | "bundesliga"
  | "ligue-1";

export type AllLeagueId = LeagueId | "ukrainian-premier-league";
export type MatchLeagueId =
  | AllLeagueId
  | "uefa-champions-league"
  | "uefa-europa-league"
  | "uefa-europa-conference-league"
  | "fa-cup"
  | "copa-del-rey"
  | "coppa-italia"
  | "dfb-pokal"
  | "coupe-de-france";
export type LogoLeagueId =
  | AllLeagueId
  | "champions-league"
  | "europa-league"
  | "conference-league";

export const UA_CLUBS: string[] = [
  "dnipro",
  "dynamo-kyiv",
  "inhulets-petrove",
  "karpaty",
  "kolos-kovalivka",
  "kryvbas",
  "lnz-cherkasy",
  "obolon",
  "olexandriya",
  "polissya",
  "rukh-lviv",
  "shakhtar",
  "veres",
  "vorskla-poltava",
  "zorya-luhansk"
];

export const EU_CLUBS: Record<LeagueId, string[]> = {
  "english-premier-league": [
    "arsenal",
    "aston-villa",
    "bournemouth",
    "brentford",
    "brighton",
    "burnley",
    "charlton",
    "chelsea",
    "crystal-palace",
    "everton",
    "fulham",
    "ipswich",
    "leeds-united",
    "leicester",
    "liverpool",
    "manchester-city",
    "manchester-united",
    "newcastle",
    "nottingham-forest",
    "southampton",
    "sunderland",
    "tottenham",
    "west-ham",
    "wolves"
  ],
  "la-liga": [
    "alaves",
    "athletic-club",
    "atletico-madrid",
    "barcelona",
    "celta",
    "deportivo",
    "espanyol",
    "guadalajara",
    "getafe",
    "girona",
    "las-palmas",
    "leganes",
    "levante",
    "mallorca",
    "osasuna",
    "racing",
    "rayo-vallecano",
    "real-betis",
    "real-madrid",
    "real-sociedad",
    "sevilla",
    "talavera",
    "valencia",
    "valladolid",
    "villarreal",
    "albacete"
  ],
  "serie-a": [
    "atalanta",
    "bologna",
    "cagliari",
    "como-1907",
    "cremonese",
    "empoli",
    "fiorentina",
    "genoa",
    "inter",
    "juventus",
    "lazio",
    "lecce",
    "milan",
    "monza",
    "napoli",
    "parma",
    "roma",
    "sassuolo",
    "torino",
    "udinese",
    "venezia",
    "verona"
  ],
  "bundesliga": [
    "augsburg",
    "bayer-leverkusen",
    "bayern-munchen",
    "borussia-dortmund",
    "borussia-monchengladbach",
    "eintracht-frankfurt",
    "fc-heidenheim",
    "freiburg",
    "hoffenheim",
    "holstein-kiel",
    "mainz-05",
    "rb-leipzig",
    "st-pauli",
    "union-berlin",
    "vfb-stuttgart",
    "vfl-bochum",
    "werder-bremen",
    "wolfsburg"
  ],
  "ligue-1": [
    "angers",
    "as-monaco",
    "as-saint-etienne",
    "auxerre",
    "brest",
    "le-havre-ac",
    "lille",
    "lyon",
    "marseille",
    "montpellier",
    "nantes",
    "nice",
    "paris-saint-germain",
    "rc-lens",
    "rc-strasbourg-alsace",
    "rennes",
    "stade-de-reims",
    "toulouse"
  ]
};

const EU_ALL_CLUBS = Array.from(new Set(Object.values(EU_CLUBS).flat()));
const FA_CUP_CLUBS = Array.from(new Set([...EU_CLUBS["english-premier-league"], "barnsley", "portsmouth"]));
const CHAMPIONS_LEAGUE_CLUBS: string[] = [
  "arsenal",
  "bayern-munchen",
  "paris-saint-germain",
  "manchester-city",
  "atalanta",
  "inter",
  "real-madrid",
  "atletico-madrid",
  "liverpool",
  "borussia-dortmund",
  "tottenham",
  "newcastle",
  "chelsea",
  "sporting",
  "barcelona",
  "marseille",
  "juventus",
  "galatasaray",
  "as-monaco",
  "bayer-leverkusen",
  "psv",
  "karabakh",
  "napoli",
  "kopenhagen",
  "benfica",
  "pafos",
  "royal-union-saint-gilloise",
  "athletic-club",
  "olympiakos-pireus",
  "eintracht-frankfurt",
  "brugge",
  "bodo-glimt",
  "slavia-praga",
  "ajax",
  "villarreal",
  "kairat-almaty"
];
const EUROPA_LEAGUE_CLUBS: string[] = [
  "lyon",
  "midtjylland",
  "aston-villa",
  "real-betis",
  "freiburg",
  "ferencvaros",
  "braga",
  "porto",
  "vfb-stuttgart",
  "roma",
  "nottingham-forest",
  "fenerbahce",
  "bologna",
  "viktoria-plzen",
  "panathinaikos",
  "genk",
  "crvena-zvezda",
  "paok",
  "celta",
  "lille",
  "young-boys",
  "brann",
  "ludogorets",
  "celtic",
  "dinamo-zagreb",
  "basel",
  "steaua-b",
  "go-ahead-eagles",
  "sturm-graz",
  "feyenoord",
  "salzburg",
  "utrecht",
  "rangers",
  "malmo",
  "maccabi-tel-aviv",
  "nice"
];

export const ALL_CLUBS: Record<MatchLeagueId, string[]> = {
  "ukrainian-premier-league": UA_CLUBS,
  ...EU_CLUBS,
  "uefa-champions-league": CHAMPIONS_LEAGUE_CLUBS,
  "uefa-europa-league": EUROPA_LEAGUE_CLUBS,
  "uefa-europa-conference-league": EU_ALL_CLUBS,
  "fa-cup": FA_CUP_CLUBS,
  "copa-del-rey": EU_CLUBS["la-liga"],
  "coppa-italia": EU_CLUBS["serie-a"],
  "dfb-pokal": EU_CLUBS["bundesliga"],
  "coupe-de-france": EU_CLUBS["ligue-1"]
};

export type ClubRegistryEntry = {
  slug: string;
  leagueId: AllLeagueId;
  logoLeagueId: AllLeagueId;
};

export const CLUB_REGISTRY: Record<string, ClubRegistryEntry> = {};

function registerClub(slug: string, leagueId: AllLeagueId, logoLeagueId?: AllLeagueId): void {
  if (CLUB_REGISTRY[slug]) {
    return;
  }
  CLUB_REGISTRY[slug] = {
    slug,
    leagueId,
    logoLeagueId: logoLeagueId ?? leagueId
  };
}

const CLUB_REGISTRY_EXTRAS: Array<{ slug: string; leagueId: AllLeagueId }> = [
  { slug: "barnsley", leagueId: "english-premier-league" },
  { slug: "portsmouth", leagueId: "english-premier-league" },
  { slug: "exeter", leagueId: "english-premier-league" }
];

UA_CLUBS.forEach((slug) => registerClub(slug, "ukrainian-premier-league"));
(Object.entries(EU_CLUBS) as Array<[LeagueId, string[]]>).forEach(([leagueId, clubs]) => {
  clubs.forEach((slug) => registerClub(slug, leagueId));
});
CLUB_REGISTRY_EXTRAS.forEach((entry) => registerClub(entry.slug, entry.leagueId));
