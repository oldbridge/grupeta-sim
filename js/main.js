// Entry point.  Loads the chosen language file (i18n/<code>.js), then starts the game.
// URL options: ?lang=xx  ?fast=1 (instant text, for testing)  ?seed=N (fixed randomness)
(function () {
  'use strict';
  const G = window.G;
  const q = new URLSearchParams(location.search);
  G.fastText = q.has('fast');
  if (!window.ROUTES) {
    document.getElementById('screen').textContent = 'Missing data/routes.js — run: python3 tools/build_routes.py';
    return;
  }

  if (q.has('seed')) {
    const s = +q.get('seed'), orig = G.Game.newDay;
    G.Game.newDay = function () { const st = orig(); G.seed(s); return st; };
  }
  const start = () => {
    document.documentElement.lang = G.lang;
    G.Game.run().catch((e) => {
      console.error(e);
      document.getElementById('screen').innerHTML = '<pre class="crash"></pre>';
      document.querySelector('.crash').textContent = 'Something broke:\n' + ((e && e.stack) || e);
    });
  };
  // optional scripts: dynamic <script> works from file:// too (fetch would not)
  const load = (src) => new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => { s.remove(); resolve(false); };
    document.head.appendChild(s);
  });
  const lang = q.get('lang') || G.store.get('lang', 'en');
  const langs = window.I18N_LANGS || { en: 'English' };
  (async () => {
    // config/players.local.js: private, git-ignored rider overrides (e.g. portrait photos)
    if (!q.has('nolocal')) await load('config/players.local.js');
    G.initPlayers();
    if (!window.PLAYERS || !window.PLAYERS.length) {
      document.getElementById('screen').textContent = 'No riders: check config/players.js (python3 tools/import_players.py --check). ' + (G.playerWarnings || []).join(' · ');
      return;
    }
    if (lang !== 'en' && langs[lang] && (await load('i18n/' + lang + '.js')) && window.I18N && window.I18N[lang]) G.lang = lang;
    start();
  })();
})();
