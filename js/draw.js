// Course panels: track map, elevation profile (full and zoomed) and the race-situation strip.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const D = {};

  // Pro Cycling Manager style gradient colours
  D.gradeColor = function (g) {
    if (g < -0.02) return '#6f8fb0';
    if (g < 0.03) return '#5cb85c';
    if (g < 0.06) return '#f0c419';
    if (g < 0.09) return '#f08a24';
    if (g < 0.12) return '#e0362c';
    return '#7a1414';
  };
  const css = (name, def) => {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || def; } catch (e) { return def; }
  };

  D.map = function (cv, route, opt) {
    opt = opt || {};
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, pad = 10;
    const b = route.bbox;
    const sc = Math.min((w - 2 * pad) / Math.max(1, b.maxx - b.minx), (h - 2 * pad) / Math.max(1, b.maxy - b.miny));
    const ox = (w - (b.maxx - b.minx) * sc) / 2, oy = (h - (b.maxy - b.miny) * sc) / 2;
    const X = (x) => ox + (x - b.minx) * sc, Y = (y) => h - (oy + (y - b.miny) * sc);
    c.clearRect(0, 0, w, h);
    c.fillStyle = css('--panel2', '#1d2230'); c.fillRect(0, 0, w, h);
    const n = route.x.length, si = Math.floor((opt.s || 0) / route.step);
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = css('--muted', '#8a93a6'); c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < n; i += 2) { const px = X(route.x[i]), py = Y(route.y[i]); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
    c.stroke();
    if (si > 0) {
      c.strokeStyle = css('--accent', '#ff7a45'); c.lineWidth = 2.5;
      c.beginPath();
      for (let i = 0; i <= Math.min(si, n - 1); i += 2) { const px = X(route.x[i]), py = Y(route.y[i]); if (i) c.lineTo(px, py); else c.moveTo(px, py); }
      c.stroke();
    }
    // start / bars
    c.font = '11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#fff'; c.fillText('🏁', X(route.x[0]), Y(route.y[0]));
    for (const bar of route.bars) {
      const i = Math.min(n - 1, Math.round(bar.at / route.step));
      if (bar.final) continue;
      c.fillText(G.stopIcon(bar), X(route.x[i]), Y(route.y[i]));
    }
    for (const cl of route.climbs) {
      const i = Math.min(n - 1, Math.round(cl.top / route.step));
      c.fillStyle = '#e0362c';
      c.beginPath(); c.moveTo(X(route.x[i]), Y(route.y[i]) - 6); c.lineTo(X(route.x[i]) - 4, Y(route.y[i]) + 1); c.lineTo(X(route.x[i]) + 4, Y(route.y[i]) + 1); c.fill();
    }
    for (const g of opt.groups || []) {
      const p = route.posAt(g.s);
      c.fillStyle = g.color || '#fff';
      c.strokeStyle = '#000'; c.lineWidth = 1;
      c.beginPath(); c.arc(X(p.x), Y(p.y), g.isPlayer ? 5 : 3.5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  };

  // full profile when from/to omitted; opt.groups: [{s, color, isPlayer}]
  D.profile = function (cv, route, opt) {
    opt = opt || {};
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    const from = opt.from != null ? Math.max(0, opt.from) : 0;
    const to = opt.to != null ? Math.min(route.len, opt.to) : route.len;
    const top = 14, bottom = h - 14;
    let lo = Infinity, hi = -Infinity;
    for (let s = from; s <= to; s += route.step) { const e = route.eleAt(s); lo = Math.min(lo, e); hi = Math.max(hi, e); }
    if (opt.zoom) { const mid = (lo + hi) / 2, span = Math.max(hi - lo, 60); lo = mid - span / 2; hi = mid + span / 2; }
    else { lo = Math.min(lo, 0); hi = Math.max(hi, lo + 100); }
    const X = (s) => ((s - from) / Math.max(1, to - from)) * w;
    const Y = (e) => bottom - ((e - lo) / Math.max(1, hi - lo)) * (bottom - top);
    c.clearRect(0, 0, w, h);
    c.fillStyle = css('--panel2', '#1d2230'); c.fillRect(0, 0, w, h);
    const step = Math.max(route.step, (to - from) / w);
    for (let s = from; s < to; s += step) {
      const x0 = X(s), x1 = X(Math.min(to, s + step)) + 0.6;
      const e = route.eleAt(s);
      c.fillStyle = D.gradeColor(route.gradeAt(s));
      c.fillRect(x0, Y(e), x1 - x0, bottom - Y(e));
    }
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1;
    c.beginPath();
    for (let s = from; s <= to; s += step) { const x = X(s), y = Y(route.eleAt(s)); if (s === from) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
    // km ticks
    c.fillStyle = css('--muted', '#8a93a6'); c.font = '10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
    const tick = opt.zoom ? 1000 : (to - from) > 80000 ? 20000 : 10000;
    for (let s = Math.ceil(from / tick) * tick; s <= to; s += tick) { c.fillRect(X(s), bottom, 1, 3); c.fillText(String(Math.round(s / 1000)), X(s), bottom + 3); }
    // climbs and bars
    c.textBaseline = 'bottom';
    for (const cl of route.climbs) {
      if (cl.top < from || cl.top > to) continue;
      const x = X(cl.top), y = Y(route.eleAt(cl.top));
      c.fillStyle = '#fff'; c.font = 'bold 10px sans-serif';
      c.fillText(cl.cat === 'HC' ? 'HC' : cl.cat, x, y - 2);
      if (opt.zoom || opt.labels) { c.font = '10px sans-serif'; c.fillText(G.climbName(cl), x, Math.max(11, y - 12)); }
    }
    c.font = '12px sans-serif';
    for (const bar of route.bars) {
      if (bar.at < from || bar.at > to) continue;
      c.fillText(G.stopIcon(bar), X(bar.at), top + 2);
    }
    if (opt.zoom) {   // gradient per 500 m
      c.font = 'bold 10px sans-serif'; c.textBaseline = 'top';
      for (let s = Math.ceil(from / 500) * 500; s < to; s += 500) {
        const g = (route.eleAt(Math.min(route.len, s + 500)) - route.eleAt(s)) / 5;
        if (Math.abs(g) < 2) continue;
        c.fillStyle = g > 0 ? '#fff' : '#bcd';
        c.fillText((g > 0 ? '+' : '') + g.toFixed(0) + '%', X(s + 250), Y(route.eleAt(s + 250)) + 3);
      }
    }
    for (const g of opt.groups || []) {
      if (g.s < from || g.s > to) continue;
      const x = X(g.s), y = Y(route.eleAt(g.s));
      c.fillStyle = g.color || '#fff'; c.strokeStyle = '#000';
      c.beginPath(); c.arc(x, y, g.isPlayer ? 4.5 : 3, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    if (opt.s != null && opt.s >= from && opt.s <= to) {
      c.fillStyle = 'rgba(255,255,255,0.9)';
      c.fillRect(X(opt.s), top - 4, 1, bottom - top + 4);
    }
  };

  // PCM style race situation: groups on a time axis (leader on the right)
  D.situation = function (cv, items) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    c.clearRect(0, 0, w, h);
    c.fillStyle = css('--panel2', '#1d2230'); c.fillRect(0, 0, w, h);
    if (!items.length) return;
    const maxGap = Math.max(60, ...items.map((i) => i.gap));
    const X = (gap) => w - 24 - (gap / maxGap) * (w - 48);
    const y = h / 2 + 4;
    c.strokeStyle = css('--muted', '#8a93a6'); c.lineWidth = 2;
    c.beginPath(); c.moveTo(16, y); c.lineTo(w - 12, y); c.stroke();
    c.font = '10px sans-serif'; c.textAlign = 'center';
    for (const it of items) {
      const x = X(it.gap), r = 5 + Math.min(8, it.n * 1.2);
      c.fillStyle = it.color; c.strokeStyle = it.isPlayer ? '#fff' : '#000'; c.lineWidth = it.isPlayer ? 2.5 : 1;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.font = 'bold 10px sans-serif';
      c.fillText(String(it.n), x, y + 0.5);
      c.textBaseline = 'bottom'; c.font = '10px sans-serif';
      c.fillStyle = css('--text', '#e8ecf3');
      c.fillText(it.gap < 1 ? G.t('race.lead') : G.fmtGap(-it.gap), x, y - r - 3);
    }
  };

  G.Draw = D;
})();
