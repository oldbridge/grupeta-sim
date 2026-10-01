// Rider roster: reads config/players.js (window.PLAYERS_CONFIG), validates it and exposes
// window.PLAYERS (normalised) plus helpers for colours, taglines, traits and portraits.
// Adding or removing riders only needs an edit of the config file and a page reload.
// An optional, git-ignored config/players.local.js (window.PLAYERS_LOCAL) is merged on top:
// per-rider overrides (e.g. private portrait photos) and extra riders.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const STATS = ['endurance', 'sprint', 'fitness', 'competitiveness', 'clumsiness'];
  G.playerWarnings = [];
  const list = [];
  const warn = (m) => { G.playerWarnings.push(m); if (typeof console !== 'undefined') console.warn('players: ' + m); };

  function hashOf(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hsl(h, s, l) {
    const f = (n) => {
      const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  function colorsFor(name, given) {
    const h = hashOf(name);
    const gen = {
      jersey: hsl(h % 360, 0.65, 0.5), trim: '#ffffff', bike: '#2a2a2a', helmet: '#ffffff',
      hair: ['#2b1b12', '#3b2a1e', '#5a3a1a', '#222222', '#777777'][h % 5],
    };
    const out = {};
    for (const k of Object.keys(gen)) {
      const v = given && given[k];
      if (v !== undefined && !isColor(v)) warn(`${name}: colors.${k} "${v}" is not a #rrggbb colour`);
      out[k] = isColor(v) ? v : gen[k];
    }
    return out;
  }
  const num = (v, def, lo, hi, what) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) { if (v !== undefined) warn(what + ' is not a number'); return def; }
    if (n < lo || n > hi) warn(`${what} = ${n} is outside ${lo}..${hi}`);
    return Math.max(lo, Math.min(hi, n));
  };

  // merge config/players.js with the optional local overrides, by rider name
  function merged() {
    const base = window.PLAYERS_CONFIG || (window.PLAYERS ? { players: window.PLAYERS } : { players: [] });
    const local = window.PLAYERS_LOCAL || {};
    const cfg = Object.assign({}, base, local.portraitStyle ? { portraitStyle: local.portraitStyle } : {});
    const over = local.players || {};
    const players = (base.players || []).map((p) => (p && over[p.name] ? Object.assign({}, p, over[p.name]) : p));
    for (const name of Object.keys(over)) {
      if (!players.some((p) => p && p.name === name)) players.push(Object.assign({ name }, over[name]));
    }
    cfg.players = players;
    return cfg;
  }

  // called once at startup (js/main.js) after the optional local file had a chance to load
  G.initPlayers = function () {
    const cfg = merged();
    G.playerWarnings.length = 0;
    list.length = 0;
    const seen = new Set();
    (cfg.players || []).forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') { warn(`entry #${i + 1} is not an object`); return; }
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) { warn(`rider #${i + 1} has no name (skipped)`); return; }
      if (seen.has(name)) { warn(`duplicate rider "${name}" (second one skipped)`); return; }
      seen.add(name);
      const p = { name };
      for (const k of STATS) p[k] = num(raw[k], 50, 0, 100, `${name}: ${k}`);
      p.weight = num(raw.weight, 70, 35, 160, `${name}: weight`);
      const g = String(raw.gender || 'm').trim().toLowerCase();
      p.gender = g.startsWith('f') ? 'f' : 'm';
      p.look = colorsFor(name, raw.colors);
      p.portrait = typeof raw.portrait === 'string' ? raw.portrait.trim() : '';
      p.tagline = raw.tagline && typeof raw.tagline === 'object' ? raw.tagline : typeof raw.tagline === 'string' ? { en: raw.tagline } : null;
      p.favouriteStops = Array.isArray(raw.favouriteStops) ? raw.favouriteStops.map(String) : [];
      p.badSleeper = num(raw.badSleeper, 0, 0, 1, `${name}: badSleeper`);
      list.push(p);
    });
    window.PLAYERS = list;
    G.portraitStyle = cfg.portraitStyle === 'photo' ? 'photo' : 'pixel';
    G.everybodyLikes = Array.isArray(cfg.everybodyLikes) ? cfg.everybodyLikes.map(String) : [];
  };

  G.playerByName = (n) => list.find((p) => p.name === n);
  G.genderOf = (n) => { const p = G.playerByName(n); return (p && p.gender) || 'm'; };
  // colours of a rider (riders removed from the config keep a generated look in old saves)
  G.lookOf = (n) => { const p = G.playerByName(n); return p ? p.look : colorsFor(String(n || '?')); };
  G.playerTagline = function (p) {
    const t = p && p.tagline;
    if (!t) return null;
    return t[G.lang] || t.en || Object.values(t)[0] || null;
  };

  // ---- portraits: images are loaded once; with the "pixel" style they are drawn into the
  // same 32x32 canvas as the procedural faces so they match the pixel art
  const images = {};
  G.portraitImage = function (src, onload) {
    if (!src || typeof Image === 'undefined') return null;
    let rec = images[src];
    if (!rec) {
      rec = images[src] = { img: new Image(), ok: false, failed: false, waiting: [] };
      rec.img.onload = () => { rec.ok = true; rec.waiting.forEach((f) => f()); rec.waiting = []; };
      rec.img.onerror = () => { rec.failed = true; warn(`portrait not found: ${src}`); rec.waiting = []; };
      rec.img.src = src;
    }
    if (!rec.ok && !rec.failed && onload) rec.waiting.push(onload);
    return rec;
  };
})();
