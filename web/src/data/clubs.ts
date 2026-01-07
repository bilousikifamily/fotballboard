export type LeagueId =
  | "english-premier-league"
  | "la-liga"
  | "serie-a"
  | "bundesliga"
  | "ligue-1";

export type AllLeagueId = LeagueId | "ukrainian-premier-league";

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
    "athletic-club",
    "atletico-madrid",
    "barcelona",
    "celta",
    "deportivo",
    "espanyol",
    "getafe",
    "girona",
    "las-palmas",
    "leganes",
    "mallorca",
    "osasuna",
    "rayo-vallecano",
    "real-betis",
    "real-madrid",
    "real-sociedad",
    "sevilla",
    "valencia",
    "valladolid",
    "villarreal"
  ],
  "serie-a": [
    "atalanta",
    "bologna",
    "cagliari",
    "como-1907",
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

export const ALL_CLUBS: Record<AllLeagueId, string[]> = {
  "ukrainian-premier-league": UA_CLUBS,
  ...EU_CLUBS
};
