// Non-text game content: perks, weather numbers.  Riders (stats, colours, portraits) come
// from config/players.js via js/players.js; all words live in i18n/<lang>.js.
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  G.STAT_KEYS = ['endurance', 'sprint', 'fitness', 'competitiveness', 'clumsiness'];

  G.PERK_IDS = ['diesel', 'goat', 'wheel', 'coffee', 'hands', 'kick', 'camel', 'pockets', 'talker', 'descender'];

  // numbers only; names come from i18n weather.<id>
  G.WEATHER = [
    { id: 'sunny', temp: 27, icon: '☀️', heat: 1.5, crash: 1.0, accept: 0.1 },
    { id: 'mild', temp: 19, icon: '⛅', heat: 1.0, crash: 1.0, accept: 0.15 },
    { id: 'cool', temp: 12, icon: '☁️', heat: 0.7, crash: 1.0, accept: 0 },
    { id: 'drizzle', temp: 14, icon: '🌧️', heat: 0.7, crash: 2.0, accept: -0.35 },
  ];
  G.weatherName = (w) => G.t('weather.' + w.id);
})();
