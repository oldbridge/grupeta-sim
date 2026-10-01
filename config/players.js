// Riders of Igandeko Irteera — edit this file and reload the game.  No build needed.
//
// Add a rider: copy a block.  Remove a rider: delete the block.  Order = order on screen.
// Everything after "window.PLAYERS_CONFIG =" must stay valid JSON (double quotes, no
// trailing commas, no comments inside) so tools/import_players.py can update it.
//
// Per rider:
//   name                 unique; it is also the key for careers and relationships
//   endurance, sprint, fitness, competitiveness, clumsiness    0..100
//   weight               kg (heavy: more watts on the flat, slower uphill)
//   gender               "m" or "f" (texts and pixel art)
//   colors               optional: jersey, trim, bike, helmet, hair ("#rrggbb"); generated if missing
//   portrait             optional image path relative to index.html, e.g. "config/portraits/xabi.jpg"
//                        (png / jpg / webp / gif).  Empty: a pixel-art face in the rider's colours.
//   tagline              optional: {"en": "...", "eu": "..."}; generated from the stats if missing
//   favouriteStops       optional: stop ids the rider loves (e.g. "almandoz", "zizurkil", "bera")
//   badSleeper           optional 0..1: chance of sleeping badly and dropping out on Sunday morning
//
// Global:
//   portraitStyle        "pixel" (photos are pixelated to match the game) or "photo"
//   everybodyLikes       stop ids every rider is happy to ride to
window.PLAYERS_CONFIG =
{
  "portraitStyle": "pixel",
  "everybodyLikes": ["goizueta"],
  "players": [
    {
      "name": "Xabi",
      "endurance": 70,
      "sprint": 30,
      "fitness": 80,
      "competitiveness": 80,
      "clumsiness": 80,
      "weight": 80,
      "gender": "m",
      "colors": {"jersey": "#e8452c", "trim": "#ffffff", "bike": "#1d1d1d", "helmet": "#ffffff", "hair": "#3b2a1e"},
      "portrait": ""
    },
    {
      "name": "Unanue",
      "endurance": 80,
      "sprint": 70,
      "fitness": 90,
      "competitiveness": 65,
      "clumsiness": 20,
      "weight": 70,
      "gender": "m",
      "colors": {"jersey": "#2a6fdb", "trim": "#ffd23f", "bike": "#c0c0c0", "helmet": "#2a6fdb", "hair": "#222222"},
      "portrait": ""
    },
    {
      "name": "Denis",
      "endurance": 70,
      "sprint": 40,
      "fitness": 50,
      "competitiveness": 76,
      "clumsiness": 10,
      "weight": 70,
      "gender": "m",
      "colors": {"jersey": "#7b4bd1", "trim": "#ffffff", "bike": "#3a3a3a", "helmet": "#222222", "hair": "#5a3a1a"},
      "portrait": "",
      "tagline": {"en": "Never quite sure of a good night's sleep.", "eu": "Inoiz ez dago ziur ondo lo egin duen."},
      "badSleeper": 0.5
    },
    {
      "name": "Oiartzun",
      "endurance": 60,
      "sprint": 50,
      "fitness": 50,
      "competitiveness": 10,
      "clumsiness": 60,
      "weight": 75,
      "gender": "m",
      "colors": {"jersey": "#2e9e4f", "trim": "#ffffff", "bike": "#d23b3b", "helmet": "#ffffff", "hair": "#2b2b2b"},
      "portrait": ""
    },
    {
      "name": "Beloki",
      "endurance": 90,
      "sprint": 80,
      "fitness": 90,
      "competitiveness": 76,
      "clumsiness": 20,
      "weight": 75,
      "gender": "m",
      "colors": {"jersey": "#ffd23f", "trim": "#222222", "bike": "#222222", "helmet": "#ffd23f", "hair": "#6b4a2a"},
      "portrait": ""
    },
    {
      "name": "Urdin",
      "endurance": 70,
      "sprint": 97,
      "fitness": 60,
      "competitiveness": 95,
      "clumsiness": 40,
      "weight": 120,
      "gender": "m",
      "colors": {"jersey": "#1fb5c9", "trim": "#0b3d91", "bike": "#0b3d91", "helmet": "#ffffff", "hair": "#222222"},
      "portrait": ""
    },
    {
      "name": "Tibe",
      "endurance": 95,
      "sprint": 95,
      "fitness": 96,
      "competitiveness": 40,
      "clumsiness": 10,
      "weight": 56,
      "gender": "m",
      "colors": {"jersey": "#111111", "trim": "#e8452c", "bike": "#e8452c", "helmet": "#111111", "hair": "#4a3426"},
      "portrait": ""
    },
    {
      "name": "Txeste",
      "endurance": 70,
      "sprint": 80,
      "fitness": 80,
      "competitiveness": 65,
      "clumsiness": 70,
      "weight": 65,
      "gender": "m",
      "colors": {"jersey": "#f28c28", "trim": "#222222", "bike": "#2a6fdb", "helmet": "#ffffff", "hair": "#222222"},
      "portrait": ""
    },
    {
      "name": "Andueza",
      "endurance": 60,
      "sprint": 30,
      "fitness": 20,
      "competitiveness": 34,
      "clumsiness": 65,
      "weight": 55,
      "gender": "m",
      "colors": {"jersey": "#8b5a2b", "trim": "#f2d16b", "bike": "#2e9e4f", "helmet": "#f2d16b", "hair": "#777777"},
      "portrait": "",
      "tagline": {"en": "Lives for the coffee in Almandoz.", "eu": "Almandozko kafearengatik bizi da."},
      "favouriteStops": ["almandoz"]
    },
    {
      "name": "Eki Erro",
      "endurance": 50,
      "sprint": 80,
      "fitness": 56,
      "competitiveness": 67,
      "clumsiness": 54,
      "weight": 80,
      "gender": "m",
      "colors": {"jersey": "#ff6fae", "trim": "#222222", "bike": "#ffffff", "helmet": "#222222", "hair": "#3b2a1e"},
      "portrait": ""
    },
    {
      "name": "Peio",
      "endurance": 70,
      "sprint": 50,
      "fitness": 40,
      "competitiveness": 96,
      "clumsiness": 20,
      "weight": 96,
      "gender": "m",
      "colors": {"jersey": "#9bd13b", "trim": "#1d1d1d", "bike": "#7b4bd1", "helmet": "#9bd13b", "hair": "#222222"},
      "portrait": ""
    },
    {
      "name": "Ander Moron",
      "endurance": 80,
      "sprint": 70,
      "fitness": 78,
      "competitiveness": 72,
      "clumsiness": 25,
      "weight": 76,
      "gender": "m",
      "colors": {"jersey": "#c62828", "trim": "#2e9e4f", "bike": "#ffffff", "helmet": "#ffffff", "hair": "#5a3a1a"},
      "portrait": "",
      "tagline": {"en": "Hosts in Zizurkil, with Maider.", "eu": "Zizurkilen harrera egiten du, Maiderrekin."},
      "favouriteStops": ["zizurkil"]
    },
    {
      "name": "Aizpea",
      "endurance": 40,
      "sprint": 10,
      "fitness": 60,
      "competitiveness": 6,
      "clumsiness": 78,
      "weight": 61,
      "gender": "f",
      "colors": {"jersey": "#4dd0a8", "trim": "#ffffff", "bike": "#ff6fae", "helmet": "#4dd0a8", "hair": "#2b1b12"},
      "portrait": ""
    }
  ]
};
