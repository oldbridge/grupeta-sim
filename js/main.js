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
    if (!q.has('nolocal') && !window.PLAYERS_LOCAL) await load('config/players.local.js');
    G.initPlayers();
    // config/online.js: Firebase project (git-ignored; bundled into the protected site)
    if (!q.has('offline') && !window.ONLINE_CONFIG) await load('config/online.js');
    if (G.Net.setup()) {
      try { await G.Net.init(); } catch (e) { console.warn('online mode unavailable', e); G.Net.enabled = false; }
    }
    if (!window.PLAYERS || !window.PLAYERS.length) {
      document.getElementById('screen').textContent = 'No riders: check config/players.js (python3 tools/import_players.py --check). ' + (G.playerWarnings || []).join(' · ');
      return;
    }
    // (in the bundled site all languages are already inlined)
    if (lang !== 'en' && langs[lang] && ((window.I18N && window.I18N[lang]) || (await load('i18n/' + lang + '.js'))) && window.I18N && window.I18N[lang]) G.lang = lang;
    start();
  })();
})();
