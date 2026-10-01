// Procedural pixel art.  Everything is drawn into small low-resolution canvases (320 x 160 by
// default) that CSS scales up with image-rendering: pixelated.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const A = {};
  A.W = 320; A.H = 160;

  const SKIN = '#f1c27d', SKIN_D = '#c8955a', SHORTS = '#1a1a1a', TIRE = '#202020', SHOE = '#f4f4f4';

  // deterministic hash -> [0,1)
  A.hash = function (n) {
    n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  };

  A.px = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  A.line = function (c, x0, y0, x1, y1, col, th) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    c.fillStyle = col;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    th = th || 1;
    for (;;) {
      c.fillRect(x0, y0, th, th);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  A.ring = function (c, cx, cy, r, col) {
    c.fillStyle = col;
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      c.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1);
    }
  };
  A.disc = function (c, cx, cy, r, col) {
    c.fillStyle = col;
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.6));
      c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  };
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(G.clamp(r * k, 0, 255)); g = Math.round(G.clamp(g * k, 0, 255)); b = Math.round(G.clamp(b * k, 0, 255));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  A.shade = shade;

  // ---------------------------------------------------------------- riders
  // Side view, facing right.  (x, y) = ground point between the wheels.  phase = crank angle.
  A.rider = function (c, x, y, look, phase, opt) {
    opt = opt || {};
    x = Math.round(x); y = Math.round(y);
    const rh = [x - 6, y - 4], fh = [x + 6, y - 4], bb = [x - 1, y - 4];
    const seat = [x - 3, y - 10], head = [x + 4, y - 10];
    const hip = [x - 3, y - 12];
    const lean = opt.climb ? 1 : 0;
    const sh = [x + 2 - lean, y - 17 - lean];
    const legs = (ang, dark) => {
      const p = [bb[0] + Math.cos(ang) * 2.6, bb[1] + Math.sin(ang) * 2.6];
      const dx = p[0] - hip[0], dy = p[1] - hip[1];
      const d = Math.min(9.6, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx), k = Math.acos(G.clamp(d / 10, -1, 1));
      const knee = [hip[0] + Math.cos(a - k) * 5, hip[1] + Math.sin(a - k) * 5];
      A.line(c, hip[0], hip[1], knee[0], knee[1], dark ? '#000' : SHORTS, 2);
      A.line(c, knee[0], knee[1], p[0], p[1], dark ? SKIN_D : SKIN, 1);
      A.px(c, p[0], p[1], 2, 1, dark ? '#bbb' : SHOE);
    };
    // wheels
    for (const h of [rh, fh]) { A.ring(c, h[0], h[1], 4, TIRE); A.ring(c, h[0], h[1], 3, '#555'); A.px(c, h[0], h[1], 1, 1, '#999'); }
    legs(phase + Math.PI, true);
    // frame
    const fc = look.bike;
    A.line(c, rh[0], rh[1], bb[0], bb[1], fc); A.line(c, bb[0], bb[1], seat[0], seat[1], fc);
    A.line(c, seat[0], seat[1], rh[0], rh[1], fc); A.line(c, bb[0], bb[1], head[0], head[1], fc);
    A.line(c, head[0], head[1], fh[0], fh[1], fc); A.line(c, seat[0], seat[1], head[0], head[1], fc);
    A.px(c, seat[0] - 2, seat[1] - 1, 4, 1, '#111');
    A.px(c, head[0], head[1] - 1, 3, 1, '#333'); A.px(c, head[0] + 2, head[1], 1, 2, '#333');
    // torso, arm, head
    A.line(c, hip[0], hip[1], sh[0], sh[1], look.jersey, 3);
    A.line(c, hip[0] + 1, hip[1] - 1, sh[0] + 1, sh[1], look.trim, 1);
    A.line(c, sh[0] + 1, sh[1] + 1, head[0] + 2, head[1] - 1, look.jersey, 1);
    A.px(c, head[0] + 2, head[1] - 1, 1, 1, SKIN);
    A.disc(c, sh[0] + 3, sh[1] - 2, 2, SKIN);
    A.px(c, sh[0] + 1, sh[1] - 5, 5, 2, look.helmet);
    A.px(c, sh[0] + 2, sh[1] - 6, 3, 1, look.helmet);
    A.px(c, sh[0] + 4, sh[1] - 2, 2, 1, '#111');   // sunglasses
    if (opt.ponytail) { A.px(c, sh[0], sh[1] - 3, 2, 2, look.hair || '#2b1b12'); A.px(c, sh[0] - 1, sh[1] - 2, 1, 2, look.hair || '#2b1b12'); }
    legs(phase, false);
    if (opt.marker) {   // little arrow over the player
      A.px(c, sh[0] + 1, sh[1] - 12, 5, 1, opt.marker);
      A.px(c, sh[0] + 2, sh[1] - 11, 3, 1, opt.marker);
      A.px(c, sh[0] + 3, sh[1] - 10, 1, 1, opt.marker);
    }
  };

  A.fallenRider = function (c, x, y, look) {
    x = Math.round(x); y = Math.round(y);
    // bike on its side
    A.line(c, x - 9, y - 1, x + 3, y - 2, TIRE, 2);
    A.line(c, x - 6, y - 2, x + 1, y - 4, look.bike, 1);
    // rider sitting, holding knee
    A.px(c, x + 5, y - 3, 6, 2, SHORTS);
    A.line(c, x + 5, y - 4, x + 6, y - 10, look.jersey, 3);
    A.disc(c, x + 7, y - 12, 2, SKIN);
    A.px(c, x + 5, y - 15, 5, 2, look.helmet);
    A.px(c, x + 11, y - 2, 2, 2, SKIN);
  };

  A.standing = function (c, x, y, look, opt) {
    opt = opt || {};
    x = Math.round(x); y = Math.round(y);
    if (opt.bike !== false) {   // bike leaning beside
      const bx = x + 9;
      A.ring(c, bx - 6, y - 4, 4, TIRE); A.ring(c, bx + 6, y - 4, 4, TIRE);
      A.line(c, bx - 6, y - 4, bx, y - 4, look.bike); A.line(c, bx, y - 4, bx - 2, y - 10, look.bike);
      A.line(c, bx - 2, y - 10, bx + 4, y - 10, look.bike); A.line(c, bx + 4, y - 10, bx + 6, y - 4, look.bike);
      A.line(c, bx, y - 4, bx + 4, y - 10, look.bike); A.line(c, bx - 2, y - 10, bx - 6, y - 4, look.bike);
    }
    A.px(c, x - 2, y - 2, 2, 2, '#222'); A.px(c, x + 1, y - 2, 2, 2, '#222');
    A.px(c, x - 2, y - 7, 2, 5, SKIN); A.px(c, x + 1, y - 7, 2, 5, SKIN);
    A.px(c, x - 2, y - 10, 5, 3, SHORTS);
    A.px(c, x - 3, y - 17, 7, 7, look.jersey);
    A.px(c, x - 3, y - 15, 7, 1, look.trim);
    A.px(c, x - 4, y - 16, 1, 5, SKIN); A.px(c, x + 4, y - 16, 1, 5, SKIN);
    if (opt.cup) { A.px(c, x + 4, y - 12, 2, 2, '#fff'); A.px(c, x + 4, y - 12, 2, 1, '#6b3b1b'); }
    A.disc(c, x, y - 20, 2, SKIN);
    A.px(c, x - 2, y - 24, 5, 2, look.helmet);
    A.px(c, x - 1, y - 21, 3, 1, '#111');
    if (opt.ponytail) A.px(c, x - 3, y - 22, 1, 4, look.hair || '#2b1b12');
  };

  // Bust portrait for the selection cards (drawn at 32 x 32)
  A.portrait = function (c, look, seedN, gender) {
    const h = A.hash(seedN * 7 + 3);
    c.fillStyle = shade(look.jersey, 0.35); c.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 8; i++) A.px(c, (A.hash(seedN * 31 + i) * 32) | 0, (A.hash(seedN * 17 + i) * 14) | 0, 1, 1, shade(look.jersey, 0.55));
    // shoulders
    A.px(c, 5, 25, 22, 7, look.jersey); A.px(c, 7, 23, 18, 2, look.jersey);
    A.px(c, 13, 23, 6, 3, look.trim); A.px(c, 5, 28, 22, 1, look.trim);
    // neck & face
    A.px(c, 14, 20, 4, 4, SKIN_D);
    A.px(c, 10, 9, 12, 13, SKIN); A.px(c, 9, 12, 1, 5, SKIN); A.px(c, 22, 12, 1, 5, SKIN);
    void h;
    if (gender === 'f') {   // long hair falling from under the helmet
      const hc = look.hair || '#2b1b12';
      A.px(c, 7, 9, 3, 14, hc); A.px(c, 22, 9, 3, 14, hc); A.px(c, 6, 20, 2, 5, hc); A.px(c, 24, 20, 2, 5, hc);
    }
    // mouth
    A.px(c, 14, 19, 4, 1, '#7a3b2e');
    // sunglasses
    A.px(c, 10, 13, 12, 3, '#111'); A.px(c, 11, 13, 4, 1, '#4cc3ff'); A.px(c, 17, 13, 4, 1, '#4cc3ff');
    // helmet
    A.px(c, 9, 5, 14, 5, look.helmet); A.px(c, 11, 3, 10, 2, look.helmet); A.px(c, 8, 8, 16, 2, look.helmet);
    A.px(c, 12, 4, 2, 4, shade(look.helmet, 0.7)); A.px(c, 18, 4, 2, 4, shade(look.helmet, 0.7));
    A.px(c, 10, 9, 1, 8, '#333'); A.px(c, 21, 9, 1, 8, '#333');
  };

  // ---------------------------------------------------------------- scenery pieces
  A.caserio = function (c, x, y, s, h) {   // Basque farmhouse
    s = s || 1;
    const w = Math.round(30 * s), hh = Math.round(16 * s);
    A.px(c, x, y - hh, w, hh, '#efe9dc');
    // roof
    for (let i = 0; i < Math.round(8 * s); i++) A.px(c, x - 2 + i * 2, y - hh - 1 - i, w + 4 - i * 4, 1, i % 2 ? '#a8432c' : '#b84b31');
    // timber
    A.px(c, x, y - hh, 1, hh, '#6b3b1b'); A.px(c, x + w - 1, y - hh, 1, hh, '#6b3b1b');
    A.px(c, x + w / 2, y - hh, 1, hh, '#6b3b1b'); A.px(c, x, y - Math.round(hh / 2), w, 1, '#6b3b1b');
    // door and windows
    A.px(c, x + w / 2 - 3, y - 7 * s, 6 * s, 7 * s, '#5a2e14');
    A.px(c, x + 4 * s, y - 13 * s, 3 * s, 3 * s, (h || 0) > 0.5 ? '#2a6f3a' : '#a8432c');
    A.px(c, x + w - 7 * s, y - 13 * s, 3 * s, 3 * s, (h || 0) > 0.5 ? '#2a6f3a' : '#a8432c');
  };
  A.townHouse = function (c, x, y, h) {
    const hh = 22 + Math.floor(h * 14), w = 18 + Math.floor(A.hash(h * 1e6) * 8);
    const wall = ['#efe9dc', '#e6d3b3', '#f2f2f2', '#dfe8ef'][Math.floor(h * 4)];
    A.px(c, x, y - hh, w, hh, wall);
    A.px(c, x - 1, y - hh - 2, w + 2, 2, '#9a3a26');
    const shutter = h > 0.5 ? '#2a6f3a' : '#2a5fa8';
    for (let fy = y - hh + 4; fy < y - 8; fy += 8) {
      for (let fx = x + 3; fx < x + w - 4; fx += 7) {
        A.px(c, fx, fy, 3, 4, '#3a4a5a'); A.px(c, fx - 1, fy, 1, 4, shutter); A.px(c, fx + 3, fy, 1, 4, shutter);
        A.px(c, fx - 1, fy + 4, 5, 1, '#444');
      }
    }
    A.px(c, x + 3, y - 7, 5, 7, '#5a2e14');
  };
  A.tree = function (c, x, y, kind, h) {
    if (kind === 'pine') {
      A.px(c, x - 1, y - 4, 2, 4, '#5a3a1a');
      for (let i = 0; i < 4; i++) A.px(c, x - 5 + i, y - 6 - i * 3, 10 - i * 2, 3, i % 2 ? '#1f5a35' : '#226b3c');
    } else {
      A.px(c, x - 1, y - 6, 2, 6, '#5a3a1a');
      A.disc(c, x, y - 10, 5 + Math.floor((h || 0) * 2), (h || 0) > 0.5 ? '#3f8f3a' : '#4a9b3f');
      A.px(c, x - 2, y - 13, 2, 2, '#62b851');
    }
  };
  A.sheep = function (c, x, y) {
    A.px(c, x, y - 4, 6, 3, '#f4f4ee'); A.px(c, x + 5, y - 4, 2, 2, '#222');
    A.px(c, x + 1, y - 1, 1, 1, '#222'); A.px(c, x + 4, y - 1, 1, 1, '#222');
  };
  A.barBuilding = function (c, x, y, name) {
    A.px(c, x, y - 30, 46, 30, '#f1e6d0');
    A.px(c, x - 2, y - 32, 50, 2, '#8a2f1f');
    // awning
    for (let i = 0; i < 46; i += 4) A.px(c, x + i, y - 18, 4, 4, (i / 4) % 2 ? '#e8452c' : '#ffffff');
    A.px(c, x + 6, y - 28, 34, 7, '#2a2a2a');
    A.px(c, x + 8, y - 26, 30, 3, '#ffd23f');
    A.px(c, x + 8, y - 14, 10, 14, '#5a2e14');
    A.px(c, x + 24, y - 13, 16, 8, '#9cd3f0');
    // terrace table
    A.px(c, x + 48, y - 6, 8, 1, '#ddd'); A.px(c, x + 51, y - 5, 2, 5, '#999');
    void name;
  };
  A.fountain = function (c, x, y) {
    A.px(c, x - 1, y - 12, 3, 12, '#8a8f99'); A.px(c, x - 3, y - 13, 7, 2, '#8a8f99');
    A.px(c, x + 2, y - 10, 3, 1, '#8a8f99'); A.px(c, x + 4, y - 9, 1, 3, '#4aa8ff');
    A.px(c, x - 4, y - 2, 9, 2, '#6a6f78');
  };
  A.feedTent = function (c, x, y) {
    A.px(c, x, y - 16, 40, 3, '#2a6fdb'); A.px(c, x, y - 13, 40, 2, '#ffffff');
    A.px(c, x + 1, y - 13, 1, 13, '#ccc'); A.px(c, x + 38, y - 13, 1, 13, '#ccc');
    A.px(c, x + 4, y - 6, 32, 2, '#ddd');
    for (let i = 0; i < 5; i++) A.px(c, x + 6 + i * 6, y - 8, 3, 2, i % 2 ? '#f2d03b' : '#e8452c');
  };
  A.kmPost = function (c, x, y) { A.px(c, x, y - 7, 3, 7, '#f4f4f4'); A.px(c, x, y - 7, 3, 2, '#e8452c'); };
  A.komBanner = function (c, x, y) {
    A.px(c, x - 14, y - 26, 2, 26, '#ddd'); A.px(c, x + 14, y - 26, 2, 26, '#ddd');
    A.px(c, x - 14, y - 28, 30, 6, '#ffffff');
    for (let i = 0; i < 30; i += 3) A.px(c, x - 14 + i, y - 27 + (i % 2), 2, 2, '#d0021b');
  };
  A.finishBanner = function (c, x, y) {
    A.px(c, x - 16, y - 30, 2, 30, '#ccc'); A.px(c, x + 16, y - 30, 2, 30, '#ccc');
    for (let i = 0; i < 34; i += 2) for (let j = 0; j < 6; j += 2) A.px(c, x - 16 + i, y - 32 + j, 2, 2, ((i + j) / 2) % 2 ? '#111' : '#fff');
  };
  A.climbStart = function (c, x, y) { A.px(c, x, y - 10, 1, 10, '#999'); A.px(c, x + 1, y - 10, 6, 4, '#e8452c'); };

  // sky with weather and time of day
  A.sky = function (c, w, h, weather, hour) {
    const id = weather ? weather.id : 'mild';
    let top = '#5aa7e6', bot = '#cfe8f7';
    if (id === 'cool') { top = '#8a9aa8'; bot = '#d4dadf'; }
    if (id === 'drizzle') { top = '#6d7b86'; bot = '#b9c2c9'; }
    if (id === 'sunny') { top = '#3d97e8'; bot = '#d9f0ff'; }
    if (hour !== undefined && hour < 8) { top = '#f0a35e'; bot = '#ffe0b0'; }
    const gr = c.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, top); gr.addColorStop(1, bot);
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
  };
  A.rain = function (c, w, h, t) {
    c.fillStyle = 'rgba(220,230,255,0.55)';
    for (let i = 0; i < 70; i++) {
      const x = (A.hash(i * 13) * w + t * 40) % w, y = (A.hash(i * 7 + 1) * h + t * 160) % h;
      c.fillRect(Math.round(x), Math.round(y), 1, 3);
    }
  };
  A.clouds = function (c, w, off, weather) {
    const n = weather && (weather.id === 'cool' || weather.id === 'drizzle') ? 9 : 4;
    for (let i = 0; i < n; i++) {
      const x = ((A.hash(i * 91) * (w + 80) - off * (0.05 + A.hash(i) * 0.05)) % (w + 80) + w + 80) % (w + 80) - 40;
      const y = 8 + A.hash(i * 33) * 30;
      const col = weather && weather.id === 'drizzle' ? '#9aa4ab' : '#ffffff';
      A.disc(c, x, y, 5, col); A.disc(c, x + 7, y - 2, 6, col); A.disc(c, x + 14, y, 5, col); A.px(c, x - 4, y + 2, 24, 4, col);
    }
  };
  // mountain silhouette band; `kind` 'aia' draws the three peaks of Aiako Harria
  A.ridge = function (c, w, baseY, off, amp, col, seedN, kind) {
    c.fillStyle = col;
    for (let x = 0; x < w; x++) {
      const X = x + off;
      let y = Math.sin(X * 0.013 + seedN) * 0.5 + Math.sin(X * 0.031 + seedN * 2) * 0.3 + Math.sin(X * 0.071 + seedN * 3) * 0.2;
      if (kind === 'aia') {
        const p = (X % 900) - 450;
        y += 1.6 * (Math.exp(-((p - 40) ** 2) / 300) + 0.85 * Math.exp(-((p + 10) ** 2) / 250) + 0.9 * Math.exp(-((p - 85) ** 2) / 260));
      }
      const top = Math.round(baseY - amp * (0.6 + y * 0.5));
      c.fillRect(x, top, 1, c.canvas.height - top);
    }
  };
  A.sea = function (c, w, y, h, t) {
    A.px(c, 0, y, w, h, '#2f7fc1');
    c.fillStyle = '#7fc1ee';
    for (let i = 0; i < 40; i++) {
      const x = (A.hash(i * 5) * w + t * 3 * (i % 3)) % w;
      c.fillRect(Math.round(x), Math.round(y + 1 + A.hash(i * 9) * (h - 2)), 3, 1);
    }
  };

  // ---------------------------------------------------------------- whole scenes
  A.newCanvas = function (w, h) {
    const cv = document.createElement('canvas');
    cv.width = w || A.W; cv.height = h || A.H;
    cv.className = 'pix';
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    return cv;
  };

  A.sceneTitle = function (cv, t, riders) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    A.sky(c, w, h, G.WEATHER[0], 7);
    A.disc(c, 250, 52, 14, '#ffd27a'); A.disc(c, 250, 52, 11, '#ffe9b0');
    A.clouds(c, w, t * 6, G.WEATHER[1]);
    A.ridge(c, w, 92, 300, 46, '#7d6f8f', 1.3, 'aia');
    A.ridge(c, w, 110, t * 2, 26, '#4f7a55', 4.1);
    A.ridge(c, w, 124, t * 6, 16, '#3b6b3f', 7.7);
    A.px(c, 0, 130, w, 30, '#3f7d3a');
    A.px(c, 0, 134, w, 8, '#4a4a4f'); A.px(c, 0, 134, w, 1, '#6a6a70');
    for (let x = (-(t * 40) % 16 + 16) % 16 - 16; x < w; x += 16) A.px(c, x, 138, 8, 1, '#e8e8e8');
    (riders || []).forEach((lk, i) => A.rider(c, 40 + i * 24 + Math.sin(t * 1.3 + i) * 3, 141, lk, t * 9 + i, {}));
  };

  A.sceneKitchen = function (cv, items) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    A.px(c, 0, 0, w, h, '#e9dcc0');
    for (let y = 0; y < 100; y += 10) A.px(c, 0, y, w, 1, '#e0d0b0');
    // window with morning light
    A.px(c, 200, 16, 90, 60, '#6b4a2a'); A.px(c, 204, 20, 82, 52, '#ffd9a0');
    const wc = c; void wc;
    A.px(c, 204, 52, 82, 20, '#c0a070'); A.px(c, 244, 20, 2, 52, '#6b4a2a'); A.px(c, 204, 45, 82, 2, '#6b4a2a');
    A.disc(c, 230, 34, 6, '#ffeec0');
    // floor
    A.px(c, 0, 118, w, 42, '#b07d4f');
    for (let x = 0; x < w; x += 24) A.px(c, x, 118, 1, 42, '#9a6a40');
    // table
    A.px(c, 20, 96, 170, 6, '#7a4f2a'); A.px(c, 26, 102, 6, 30, '#6a4222'); A.px(c, 178, 102, 6, 30, '#6a4222');
    // bike leaning on the wall
    const lk = items.look || G.lookOf(((window.PLAYERS || [])[0] || {}).name);
    A.ring(c, 225, 128, 9, TIRE); A.ring(c, 260, 128, 9, TIRE);
    A.line(c, 225, 128, 240, 128, lk.bike, 2); A.line(c, 240, 128, 236, 112, lk.bike, 2);
    A.line(c, 236, 112, 254, 112, lk.bike, 2); A.line(c, 254, 112, 260, 128, lk.bike, 2);
    A.line(c, 240, 128, 254, 112, lk.bike, 2); A.line(c, 236, 112, 225, 128, lk.bike, 2);
    A.px(c, 232, 110, 7, 2, '#111'); A.px(c, 253, 108, 5, 2, '#333');
    // coffee cup
    A.px(c, 160, 88, 8, 8, '#fff'); A.px(c, 168, 90, 2, 4, '#fff'); A.px(c, 161, 88, 6, 2, '#6b3b1b');
    // items on the table
    let x = 30;
    for (let i = 0; i < items.bidons; i++) { A.px(c, x, 76, 9, 20, lk.jersey); A.px(c, x + 2, 72, 5, 4, '#222'); A.px(c, x + 1, 84, 7, 3, '#fff'); x += 14; }
    for (let i = 0; i < items.bars; i++) { A.px(c, x, 90, 16, 6, '#3a3a8a'); A.px(c, x + 3, 91, 10, 4, '#ffd23f'); x += 20; }
    for (let i = 0; i < items.bananas; i++) {
      A.line(c, x, 88, x + 4, 94, '#f2d03b', 3); A.line(c, x + 4, 94, x + 14, 93, '#f2d03b', 3); A.px(c, x - 1, 87, 2, 2, '#5a3a1a'); x += 20;
    }
    // phone
    A.px(c, 140, 90, 10, 6, '#222'); A.px(c, 141, 91, 8, 4, items.phoneLit ? '#25d366' : '#445');
  };

  // kind: 'street' (Darío de Regoyos, Irun), 'carpark' (car trip: bikes on the roof), 'startline' (sportive)
  A.sceneStreet = function (cv, looks, kind, genders) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    genders = genders || [];
    A.sky(c, w, h, G.WEATHER[1], 8);
    if (kind === 'carpark') {
      A.ridge(c, w, 80, 400, 40, '#7d8fa0', 3.1);
      A.ridge(c, w, 112, 900, 22, '#4f7a55', 6.2);
      A.px(c, 0, 112, w, 48, '#6a6a70');
      for (let x = 10; x < w; x += 40) A.px(c, x, 140, 20, 1, '#ddd');
      // the car with bikes on the roof
      const cx = 210, cy = 128;
      A.px(c, cx, cy - 16, 76, 14, '#c62828'); A.px(c, cx + 12, cy - 26, 48, 10, '#c62828');
      A.px(c, cx + 16, cy - 24, 18, 7, '#9cd3f0'); A.px(c, cx + 38, cy - 24, 18, 7, '#9cd3f0');
      A.disc(c, cx + 16, cy - 2, 6, '#222'); A.disc(c, cx + 60, cy - 2, 6, '#222');
      A.px(c, cx + 8, cy - 29, 60, 2, '#333');
      for (let i = 0; i < 3; i++) {
        const bx = cx + 18 + i * 18, by = cy - 30;
        A.ring(c, bx - 6, by - 4, 4, '#222'); A.ring(c, bx + 6, by - 4, 4, '#222');
        A.line(c, bx - 6, by - 4, bx, by - 4, ['#e8452c', '#2a6fdb', '#ffd23f'][i]); A.line(c, bx, by - 4, bx + 4, by - 10, ['#e8452c', '#2a6fdb', '#ffd23f'][i]);
      }
      looks.forEach((lk, i) => A.standing(c, 14 + (i % 6) * 30, 150 + (i >= 6 ? 8 : 0), lk, { ponytail: genders[i] === 'f' }));
      return;
    }
    if (kind === 'startline') {
      A.ridge(c, w, 76, 200, 26, '#7d8fa0', 1.7);
      for (let i = 0; i < 9; i++) A.townHouse(c, i * 36 - 6, 116, A.hash(i * 17 + 3));
      A.px(c, 0, 116, w, 44, '#55555c');
      // crowd and start arch
      for (let x = 0; x < w; x += 4) A.px(c, x, 112 + (x % 8 ? 0 : -2), 3, 4, ['#e8452c', '#2a6fdb', '#ffd23f', '#2e9e4f'][(x / 4) % 4]);
      A.px(c, 40, 50, 4, 70, '#ddd'); A.px(c, 276, 50, 4, 70, '#ddd');
      A.px(c, 40, 46, 240, 14, '#e8452c'); A.px(c, 44, 50, 232, 6, '#ffffff');
      looks.forEach((lk, i) => A.standing(c, 30 + (i % 8) * 34, 150 + (i >= 8 ? 8 : 0), lk, { ponytail: genders[i] === 'f' }));
      return;
    }
    A.ridge(c, w, 70, 120, 30, '#7d8fa0', 2.2, 'aia');
    for (let i = 0; i < 9; i++) A.townHouse(c, i * 36 - 6, 118, A.hash(i * 11 + 5));
    A.px(c, 0, 118, w, 6, '#bdb7ad'); A.px(c, 0, 124, w, 36, '#55555c');
    for (let x = 0; x < w; x += 20) A.px(c, x, 140, 10, 1, '#ddd');
    A.px(c, 268, 80, 2, 38, '#555'); A.px(c, 248, 72, 44, 10, '#2a5fa8');
    A.px(c, 251, 75, 38, 1, '#fff'); A.px(c, 251, 78, 30, 1, '#fff');
    looks.forEach((lk, i) => {
      const x = 18 + (i % 7) * 34 + (i >= 7 ? 16 : 0), y = 146 + (i >= 7 ? 10 : 0);
      A.standing(c, x, Math.min(158, y), lk, { ponytail: genders[i] === 'f' });
    });
  };

  A.sceneBar = function (cv, looks, barName, weather, feed, genders) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height;
    genders = genders || [];
    A.sky(c, w, h, weather || G.WEATHER[1]);
    A.ridge(c, w, 70, A.hash(barName.length) * 900, 26, '#6f8f73', 3.3);
    if (feed) {
      A.px(c, 0, 100, w, 60, '#6a9a4a');
      A.px(c, 0, 118, w, 10, '#55555c');
      // feed station tent with tables
      A.px(c, 60, 52, 200, 6, '#2a6fdb'); A.px(c, 60, 58, 200, 4, '#ffffff');
      for (let i = 0; i < 200; i += 10) A.px(c, 60 + i, 62, 5, 3, '#2a6fdb');
      A.px(c, 62, 58, 3, 62, '#ccc'); A.px(c, 255, 58, 3, 62, '#ccc');
      A.px(c, 80, 96, 160, 4, '#ddd'); A.px(c, 84, 100, 3, 18, '#999'); A.px(c, 232, 100, 3, 18, '#999');
      for (let i = 0; i < 12; i++) A.line(c, 88 + i * 12, 94, 94 + i * 12, 92, '#f2d03b', 2);
      for (let i = 0; i < 6; i++) A.px(c, 160 + i * 12, 86, 6, 8, i % 2 ? '#e8452c' : '#4aa8ff');
    } else {
      A.px(c, 0, 30, w, 96, '#f1e6d0');
      A.px(c, 0, 26, w, 4, '#8a2f1f');
      A.px(c, 20, 36, 280, 16, '#2a2a2a'); A.px(c, 22, 38, 276, 12, '#3a3a3a');
      for (let i = 0; i < w; i += 8) A.px(c, i, 56, 8, 8, (i / 8) % 2 ? '#e8452c' : '#ffffff');
      A.px(c, 30, 70, 30, 56, '#5a2e14'); A.px(c, 80, 72, 80, 34, '#9cd3f0'); A.px(c, 190, 72, 80, 34, '#9cd3f0');
      A.px(c, 80, 88, 80, 1, '#5a2e14'); A.px(c, 190, 88, 80, 1, '#5a2e14');
      A.px(c, 0, 126, w, 34, '#a89f92');
      for (let x = 0; x < w; x += 16) A.px(c, x, 126, 1, 34, '#968d80');
      for (const tx of [70, 170, 260]) {
        A.px(c, tx - 12, 132, 26, 2, '#ddd'); A.px(c, tx, 134, 2, 14, '#888');
        A.px(c, tx - 8, 129, 4, 3, '#fff'); A.px(c, tx + 4, 129, 4, 3, '#fff');
      }
    }
    const n = looks.length;
    looks.forEach((lk, i) => {
      const x = n === 1 ? 160 : 30 + (i * 260) / (n - 1);
      A.standing(c, Math.min(300, x), 158, lk, { bike: false, cup: !feed && i % 2 === 0, ponytail: genders[i] === 'f' });
    });
  };

  G.Art = A;
})();
