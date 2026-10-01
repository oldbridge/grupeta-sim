// Small shared helpers. Everything hangs off the global G namespace so the game runs
// from file:// without a bundler or ES modules.
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  // ---- seeded random (mulberry32) so a Sunday can be replayed while debugging
  let seed = (Date.now() ^ 0x5eed) >>> 0;
  G.seed = function (s) { seed = s >>> 0; };
  G.rngState = () => seed;
  G.setRngState = (s) => { seed = s >>> 0; };
  G.rand = function () {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  G.randf = (a, b) => a + (b - a) * G.rand();
  G.randi = (a, b) => Math.floor(a + (b - a + 1) * G.rand());
  G.chance = (p) => G.rand() < p;
  G.pick = (arr) => arr[Math.floor(G.rand() * arr.length)];
  G.shuffle = function (arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(G.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // ---- formatting
  const pad = (n) => String(n).padStart(2, '0');
  G.fmtDur = function (sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };
  G.fmtClock = function (minOfDay) {
    const m = Math.floor(minOfDay) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  G.fmtGap = function (sec) {
    const s = Math.round(Math.abs(sec));
    return (sec < 0 ? '-' : '+') + `${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  G.fmtKm = (m) => (m / 1000).toFixed(1);
  G.fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));

  // ---- translations: every text lives in i18n/<lang>.js (window.I18N[lang]); English is the
  // fallback.  Values can be strings, arrays (one is picked at random) or {m, f} gendered
  // variants chosen with vars.g.  {name} placeholders are filled from vars.
  const missing = new Set();
  G.lang = 'en';
  function lookup(table, key) {
    let o = table;
    for (const part of key.split('.')) {
      if (o == null || typeof o !== 'object') return undefined;
      o = o[part];
    }
    return o;
  }
  G.tr = function (key) {
    const I = window.I18N || {};
    let v = I[G.lang] ? lookup(I[G.lang], key) : undefined;
    if (v === undefined && I.en) v = lookup(I.en, key);
    if (v === undefined && !missing.has(key)) { missing.add(key); console.warn('i18n: missing key ' + key); }
    return v;
  };
  function resolve(v, vars) {
    if (Array.isArray(v)) v = v[Math.floor(G.rand() * v.length)];
    if (v && typeof v === 'object' && !Array.isArray(v)) v = v[(vars && vars.g) || 'm'] || v.m || v.f;
    return v;
  }
  // translate: t('ride.dropped', {n: 'Peio', g: 'm'})
  G.t = function (key, vars) {
    let v = resolve(G.tr(key), vars);
    if (v == null) return key;
    return typeof v === 'string' ? G.fill(v, vars || {}) : v;
  };
  // like t but returns undefined instead of the key when missing (for optional overrides)
  G.tOpt = function (key, vars) {
    const I = window.I18N || {};
    let v = I[G.lang] ? lookup(I[G.lang], key) : undefined;
    if (v === undefined && I.en) v = lookup(I.en, key);
    v = resolve(v, vars);
    return typeof v === 'string' ? G.fill(v, vars || {}) : v;
  };
  G.tList = (key) => { const v = G.tr(key); return Array.isArray(v) ? v : v == null ? [] : [v]; };

  // ---- storage that never throws (private windows, blocked storage, file://)
  G.store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('irunride.' + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('irunride.' + key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    },
  };

  // ---- DOM
  G.$ = (sel, root) => (root || document).querySelector(sel);
  G.el = function (tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    if (children != null) {
      for (const c of [].concat(children)) {
        if (c == null || c === false) continue;
        e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return e;
  };
  G.wait = (ms) => new Promise((r) => setTimeout(r, ms * (G.fastText ? 0.05 : 1)));
})();
