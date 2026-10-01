// Stage 4: the live ride.  Side-scrolling pixel view on the real elevation profile, HUD,
// course panels (profile, zoom, map), race situation and controls.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const el = G.el, UI = G.UI, A = G.Art, t = (k, v) => G.t(k, v);

  const W = 384, H = 150;          // low-res main view
  const PXM = 1.5, VEX = 3;        // pixels per metre, vertical exaggeration
  const PX0 = 140, ROADY = 104;    // player screen x, road height for the camera point
  const SPEEDS = [1, 3, 6, 12, 30, 60];
  const VIS_SPREAD = 5;            // riders in a group are drawn further apart than real wheel gaps

  const Ride = {};
  G.Ride = Ride;

  Ride.makeRiders = function (st) {
    const names = [st.playerName].concat((st.riders || []).filter((n) => G.playerByName(n)));
    const route = st.route;
    return names.map((n, i) => {
      const isMe = n === st.playerName;
      const p = isMe ? st.player : G.playerByName(n);
      const long = route.km > 70;
      const r = new G.Rider(p, i, {
        player: isMe,
        formDelta: st.form[n] || 0,
        perks: isMe ? [...st.perks] : [],
        bidons: isMe ? st.kit.bidons : (long || st.weather.heat > 1.2 ? 2 : 1),
        food: isMe ? { bar: st.kit.bar, banana: st.kit.banana } : { bar: long ? 2 : G.randi(0, 1), banana: G.randi(0, 1) },
      });
      const so = st.social[n];
      if (so && !isMe) { r.aggr = so.aggr; r.relayWill = so.relayWill; r.mood = so.mood; r.rival = so.rival; }
      return r;
    });
  };

  // resolves {sim, barMinutes} at the end, or null when the player quits to the menu
  Ride.run = function (st) {
    let sim;
    if (st.simSave) {
      sim = G.Sim.fromJSON(st.simSave);
    } else {
      const riders = Ride.makeRiders(st);
      sim = new G.Sim(st.route, riders, { weather: st.weather, startMin: st.startMin || st.departure });
      if (st.challenge) {
        const r = riders.find((x) => x.name === st.challenge.name);
        if (r) sim.challenge = { rider: r, climb: st.challenge.climb };
      }
    }
    const route = sim.route;
    const me = sim.player;
    G.currentSim = sim;   // for the console and the automated play-tests
    return new Promise((resolve) => {
      const view = buildDom(sim);
      UI.show(view.root);
      let speedIdx = 3, busy = false, last = performance.now(), panelT = 0, ended = false, barMinutes = st.barMinutes || 0;
      let saveT = 20;
      const bubbles = [];
      let feedSeen = 0;
      for (const f of sim.feed) addLog(view, f, sim);
      feedSeen = sim.feed.length;
      const sizeMain = () => {
        const maxH = Math.max(220, window.innerHeight * 0.46);
        const wpx = Math.min(view.mainBox.parentElement.clientWidth, (maxH * W) / H);
        view.mainBox.style.width = wpx + 'px';
        const dpr = window.devicePixelRatio || 1;
        view.labels.width = Math.round(wpx * dpr);
        view.labels.height = Math.round(((wpx * H) / W) * dpr);
      };
      sizeMain();
      window.addEventListener('resize', sizeMain);
      const autosave = () => {
        st.barMinutes = barMinutes;
        G.Game.autosaveRide(st, sim);
        if (G.Online) G.Online.where('riding', `${route.name} · km ${G.fmtKm(me.s)}`);
      };

      const act = {
        paceUp: () => sim.setPace(1), paceDown: () => sim.setPace(-1),
        attack: () => sim.playerAttack(),
        relay: () => sim.toggleRelay(),
        sitin: () => sim.sitIn(),
        letgo: () => { if (me.g && me.g.wait > 0) sim.goOn(); else sim.letGo(); },
        foot: () => footMenu(),
        bar: () => { if (!sim.eat(me, 'bar')) sim.log(t('log.no_bars'), 'warn'); },
        banana: () => { if (!sim.eat(me, 'banana')) sim.log(t('log.no_bananas'), 'warn'); },
        drink: () => { if (!sim.drink(me)) sim.log(t('log.no_water'), 'warn'); },
        askBar: () => { const r = sim.askBar(); sim.log(r.text, r.ok ? 'good' : 'warn'); },
        slower: () => { speedIdx = Math.max(0, speedIdx - 1); },
        faster: () => { speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); },
        pause: () => pauseMenu(),
      };
      const keyMap = {
        ArrowUp: 'paceUp', ArrowDown: 'paceDown', a: 'attack', A: 'attack', r: 'relay', R: 'relay', s: 'sitin', S: 'sitin',
        g: 'letgo', G: 'letgo', f: 'foot', F: 'foot', e: 'bar', E: 'bar', n: 'banana', N: 'banana', d: 'drink', D: 'drink', b: 'askBar', B: 'askBar',
        ArrowLeft: 'slower', ArrowRight: 'faster', ' ': 'pause', Escape: 'pause', p: 'pause', P: 'pause',
      };
      const free = ['pause', 'slower', 'faster'];
      const keys = (e) => {
        if (busy) return false;
        const a = keyMap[e.key];
        if (!a) return false;
        if (me.status !== 'riding' && !free.includes(a)) return true;
        act[a]();
        flash(a);
        panelT = 0;
        return true;
      };
      UI.pushKeys(keys);
      view.actions.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
        if (busy) return;
        const a = b.dataset.act;
        if (me.status !== 'riding' && !free.includes(a)) return;
        act[a](); panelT = 0;
      }));
      function flash(a) {
        const b = view.actions.querySelector(`[data-act="${a}"]`);
        if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 150); }
      }

      async function footMenu() {
        const ctx = sim.footContext();
        if (!ctx) return;
        if (ctx.down) { sim.footUp(); return; }
        busy = true;
        const opts = [];
        if (ctx.behind.length) {
          opts.push({ label: t('foot.wait', { n: ctx.behind.length }), value: 'wait' });
          opts.push({ label: t('foot.mock'), value: 'mock' });
        }
        if (ctx.ahead.length) opts.push({ label: t('foot.guilt'), value: 'guilt' });
        if (!opts.length) opts.push({ label: t('foot.rest'), value: 'wait' });
        opts.push({ label: t('common.cancel'), value: null });
        const body = [ctx.behind.length ? t('foot.body_behind', { names: ctx.behind.map((r) => r.name).join(', ') }) : '',
          ctx.ahead.length ? t('foot.body_ahead', { n: ctx.ahead.reduce((a, g) => a + g.members.length, 0) }) : ''].filter(Boolean).join(' ') || t('foot.body_alone');
        const v = await UI.modal(t('foot.title'), body, opts, { cancel: null, vertical: true });
        if (v) sim.footDown(v);
        busy = false;
        last = performance.now();
      }

      async function pauseMenu() {
        busy = true;
        const v = await UI.modal(t('pause.title'), t('pause.body'), [
          { label: t('pause.resume'), value: 'go' }, { label: t('pause.save'), value: 'save' }, { label: t('pause.controls'), value: 'help' },
          { label: t('pause.quit'), value: 'quit' }, { label: t('pause.home'), value: 'home' },
        ], { cancel: 'go', vertical: true });
        if (v === 'save') await G.Game.saveMenu(Object.assign(st, { barMinutes }), sim);
        if (v === 'help') await UI.modal(t('pause.controls'), helpBody(), [{ label: t('common.ok'), value: 1 }], { cancel: 1 });
        if (v === 'home') sim.playerAbandon();
        if (v === 'quit') {
          autosave();
          ended = true;
          UI.popKeys(keys);
          window.removeEventListener('resize', sizeMain);
          resolve(null);
          return;
        }
        busy = false;
        last = performance.now();
      }

      async function handlePending(p) {
        busy = true;
        if (p.type === 'crash') {
          const V = { n: p.rider.name, g: p.rider.gender };
          const v = await UI.modal(t('modal.crash_title', V), t(p.aiWait ? 'modal.crash_body_wait' : 'modal.crash_body_go', V),
            [{ label: t('modal.crash_wait', V), value: 'wait' }, { label: t('modal.crash_go'), value: 'go' }], { kind: 'bad' });
          sim.resolveCrash(v);
        } else if (p.type === 'playerCrash') {
          const who = p.waits ? t('modal.you_crash_wait', { names: p.waiters.map((r) => r.name).join(', ') }) : t('modal.you_crash_nowait');
          await UI.modal(t('modal.you_crash_title'), t('modal.you_crash_body') + ' ' + who, [{ label: t('modal.ouch'), value: 1 }], { kind: 'bad' });
          sim.pending = null;
        } else if (p.type === 'playerUp') {
          const v = await UI.modal(t('modal.up_title'), t(p.injured ? 'modal.up_injured' : 'modal.up_ok'),
            [{ label: t('modal.up_go'), value: 'go' }, { label: t('modal.up_home'), value: 'home' }]);
          sim.resolvePlayerUp(v);
        } else if (p.type === 'coffeeAsk') {
          const v = await UI.modal(`☕ ${p.rider.name}`, t('modal.coffee_body', { text: p.text, place: G.stopName(p.bar, route), km: G.fmtKm(p.bar.at - me.s) }),
            [{ label: t('modal.coffee_yes'), value: true }, { label: t('modal.coffee_no'), value: false }]);
          sim.resolveCoffeeAsk(v);
        } else if (p.type === 'bar') {
          window.removeEventListener('resize', sizeMain);
          UI.popKeys(keys);
          autosave();
          const minutes = await G.Game.bar(st, sim, p.bar, p.group);
          barMinutes += minutes;
          sim.leaveBar(minutes);
          UI.show(view.root);
          UI.pushKeys(keys);
          window.addEventListener('resize', sizeMain);
          sizeMain();
          const end = sim.t + minutes * 60;
          while (sim.t < end - 0.5 && !sim.finished) {
            if (sim.pending) autoResolve(sim);
            sim.step(1);
          }
          sim.log(t('log.bar_done', { min: minutes, place: G.stopName(p.bar, route) }), 'good');
          autosave();
        } else sim.pending = null;
        busy = false;
        last = performance.now();
      }

      async function finish() {
        ended = true;
        busy = true;
        await UI.modal(sim.abandoned ? t('modal.home_title') : t('modal.finish_title', { place: route.kind === 'home' ? 'Irun' : route.areaName }),
          sim.abandoned ? t('modal.home_body') : t('modal.finish_body', { route: route.name }), [{ label: t('modal.results'), value: 1 }]);
        sim.finishRest();
        UI.popKeys(keys);
        window.removeEventListener('resize', sizeMain);
        resolve({ sim, barMinutes });
      }

      function frame(now) {
        if (ended) return;
        const dtReal = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!busy) {
          if (sim.pending) handlePending(sim.pending);
          else if (sim.finished) finish();
          else {
            let speed = SPEEDS[speedIdx];
            if (sim.attackAlert) speed = Math.min(speed, 3);
            const adv = dtReal * speed;
            const n = Math.max(1, Math.ceil(adv / 0.5));
            for (let i = 0; i < n && !sim.pending && !sim.finished; i++) sim.step(adv / n);
            saveT -= dtReal;
            if (saveT <= 0) { saveT = 20; autosave(); }
          }
        }
        for (; feedSeen < sim.feed.length; feedSeen++) {
          const f = sim.feed[feedSeen];
          if (f.rider && f.kind !== 'info') bubbles.push({ r: f.rider, text: f.text, until: now + 4500 });
          addLog(view, f, sim);
        }
        while (bubbles.length && bubbles[0].until < now) bubbles.shift();
        if (ended) return;
        renderMain(view, sim, dtReal, now / 1000, bubbles);
        panelT -= dtReal;
        if (panelT <= 0) { panelT = 0.2; renderPanels(view, sim, SPEEDS[speedIdx]); }
        requestAnimationFrame(frame);
      }
      if (!st.simSave) sim.log(t('log.start', { time: G.fmtClock(sim.startMin), route: route.name, km: route.km, n: sim.riders.length }), 'good');
      else sim.log(t('log.resumed'), 'good');
      requestAnimationFrame(frame);
    });
  };

  function autoResolve(sim) {
    const p = sim.pending;
    if (p.type === 'crash') sim.resolveCrash('wait');
    else if (p.type === 'coffeeAsk') sim.resolveCoffeeAsk(false);
    else if (p.type === 'bar') sim.leaveBar(15);
    else if (p.type === 'playerUp') sim.resolvePlayerUp('go');
    else sim.pending = null;
  }

  function helpBody() {
    return G.tList('controls').map(([k, txt]) => el('div', { class: 'help-row' }, [el('span', { class: 'kbd', text: k }), el('span', { text: txt })]));
  }

  // ---------------------------------------------------------------- DOM
  function buildDom(sim) {
    const hud = {};
    const hudItem = (k) => { hud[k] = el('b', { text: '–' }); return el('div', { class: 'hud-item' }, [el('span', { text: t('hud.' + k) }), hud[k]]); };
    const top = el('div', { class: 'ride-top' }, ['clock', 'dist', 'speed', 'grade', 'alt', 'power', 'gameSpeed'].map(hudItem));
    const main = A.newCanvas(W, H);
    main.classList.add('main-view');
    const labels = el('canvas', { class: 'labels' });
    const banner = el('div', { class: 'banner' });
    const mainBox = el('div', { class: 'main-box' }, [main, labels, banner]);
    const you = el('div', { class: 'panel p-you' });
    const profFull = el('canvas', { width: 560, height: 96 });
    const profZoom = el('canvas', { width: 560, height: 96 });
    const map = el('canvas', { width: 260, height: 196 });
    const next = el('div', { class: 'next-info' });
    const course = el('div', { class: 'panel p-course' }, [
      el('div', { class: 'p-title', text: t('panel.course') }),
      el('div', { class: 'course-grid' }, [el('div', { class: 'profiles' }, [profFull, profZoom, next]), map]),
    ]);
    const sit = el('canvas', { width: 380, height: 64 });
    const groups = el('div', { class: 'group-list' });
    const race = el('div', { class: 'panel p-race' }, [el('div', { class: 'p-title', text: t('panel.race') }), sit, groups]);
    const btn = (act, key) => el('button', { class: 'act', 'data-act': act }, [el('span', { class: 'kbd', text: key }), el('span', { text: t('act.' + act) })]);
    const actions = el('div', { class: 'ride-actions' }, [
      btn('paceUp', '↑'), btn('paceDown', '↓'), btn('attack', 'A'), btn('relay', 'R'), btn('sitin', 'S'), btn('letgo', 'G'),
      btn('foot', 'F'), btn('bar', 'E'), btn('banana', 'N'), btn('drink', 'D'), btn('askBar', 'B'),
      btn('slower', '←'), btn('faster', '→'), btn('pause', '␣'),
    ]);
    const log = el('div', { class: 'log' });
    const root = el('div', { class: 'ride' }, [
      top,
      el('div', { class: 'main-wrap' }, [mainBox]),
      el('div', { class: 'ride-panels' }, [you, course, race]),
      el('div', { class: 'ride-bottom' }, [actions, log]),
    ]);
    return { root, hud, main, labels, banner, mainBox, you, profFull, profZoom, map, next, sit, groups, actions, log, cam: null };
  }

  function addLog(view, f, sim) {
    const line = el('div', { class: 'log-line ' + (f.kind || '') }, [
      el('span', { class: 'log-t', text: G.fmtClock(sim.startMin + f.t / 60) }),
      el('span', { text: (f.who ? f.who + ': ' : '') + f.text }),
    ]);
    view.log.prepend(line);
    while (view.log.children.length > 40) view.log.lastChild.remove();
  }

  // ---------------------------------------------------------------- main view
  function visualS(r) {
    const g = r.g;
    if (!g) return r.s;
    if (r._vo === undefined) r._vo = g.s - r.s;
    return g.s - r._vo * VIS_SPREAD;
  }

  function renderMain(view, sim, dt, time, bubbles) {
    const c = view.main.getContext('2d');
    const route = sim.route, me = sim.player;
    for (const r of sim.riders) {
      if (r.g) {
        const off = r.g.s - r.s;
        if (r._vo === undefined) r._vo = off;
        r._vo += (off - r._vo) * Math.min(1, dt * 3);
      } else r._vo = 0;
      const vs = visualS(r);
      if (r._ls === undefined) r._ls = vs;
      if (r.P > 15) r._ph = (r._ph || 0) + (vs - r._ls) * 0.9;
      r._ls = vs;
    }
    const target = visualS(me);
    if (!view.cam) view.cam = { s: target, e: route.eleAt(target) };
    const cam = view.cam;
    cam.s += (target - cam.s) * Math.min(1, dt * 8);
    if (Math.abs(target - cam.s) > 200) cam.s = target;
    cam.e += (route.eleAt(cam.s) - cam.e) * Math.min(1, dt * 6);
    const sAt = (x) => cam.s + (x - PX0) / PXM;
    const yOf = (s) => ROADY - (route.eleAt(s) - cam.e) * PXM * VEX;
    const xOf = (s) => PX0 + (s - cam.s) * PXM;
    const sc = route.sceneryAt(cam.s);
    const hour = sim.clock() / 60;

    A.sky(c, W, H, sim.weather, hour);
    A.clouds(c, W, cam.s * PXM * 0.6, sim.weather);
    if (sc === 'c') {
      A.ridge(c, W, 70, cam.s * PXM * 0.03, 16, '#8a9bb0', 1.1);
      A.sea(c, W, 72, 18, time);
    } else {
      A.ridge(c, W, 74, cam.s * PXM * 0.04, sc === 'm' ? 40 : route.surface === 'cobbles' ? 8 : 30, '#8796a8', 1.1, route.kind === 'home' ? 'aia' : null);
    }
    A.ridge(c, W, 96, cam.s * PXM * 0.15, sc === 'm' ? 30 : route.surface === 'cobbles' ? 6 : 20, sc === 'm' ? '#3f6e48' : '#5b8c4f', 2.7);
    A.ridge(c, W, 108, cam.s * PXM * 0.35, route.surface === 'cobbles' ? 4 : 14, sc === 'm' ? '#355f3c' : '#4c7d43', 5.3);

    const sL = sAt(-40), sR = sAt(W + 40);
    const CELL = 14;
    for (let cell = Math.floor(sL / CELL); cell <= Math.floor(sR / CELL); cell++) {
      const s = cell * CELL;
      if (s < 0 || s > route.len) continue;
      const h = A.hash(cell * 2654435761 + route.km * 1000);
      const x = xOf(s), y = yOf(s) - 3;
      const tag = route.sceneryAt(s);
      if (tag === 't') { if (cell % 2 === 0 && h < 0.8) A.townHouse(c, x, y, A.hash(cell + 7)); }
      else if (tag === 'm') { if (h < 0.3) A.tree(c, x, y, 'pine'); else if (h < 0.36) A.sheep(c, x, y); }
      else if (tag === 'c') { if (h < 0.08) A.tree(c, x, y, 'round', h); }
      else { if (h < 0.16) A.tree(c, x, y, 'round', h * 5); else if (h < 0.2 && cell % 3 === 0) A.caserio(c, x - 10, y, 0.8, h * 3); else if (h < 0.25) A.sheep(c, x, y); }
    }
    for (const bar of route.bars) {
      if (bar.at < sL - 60 || bar.at > sR) continue;
      if (bar.type === 'fountain') A.fountain(c, xOf(bar.at), yOf(bar.at) - 2);
      else if (bar.type === 'feed') A.feedTent(c, xOf(bar.at) - 20, yOf(bar.at) - 2);
      else A.barBuilding(c, xOf(bar.at) - 26, yOf(bar.at) - 2);
    }
    for (const cl of route.climbs) {
      if (cl.top > sL && cl.top < sR + 30) A.komBanner(c, xOf(cl.top), yOf(cl.top) + 2);
      if (cl.start > sL && cl.start < sR) A.climbStart(c, xOf(cl.start), yOf(cl.start) - 1);
    }
    for (let k = Math.ceil(sL / 1000) * 1000; k < sR; k += 1000) if (k > 0) A.kmPost(c, xOf(k), yOf(k) - 2);
    if (route.len > sL && route.len < sR + 40) A.finishBanner(c, xOf(route.len), yOf(route.len) + 2);
    if (sL < 0 && sR > 0) A.finishBanner(c, xOf(0), yOf(0) + 2);

    const ground = sc === 'm' ? '#4a7a3f' : sc === 'c' ? '#6a9a4a' : '#5a8f45';
    const cob = route.surface === 'cobbles';
    for (let x = 0; x < W; x++) {
      const y = Math.round(yOf(sAt(x)));
      c.fillStyle = cob ? '#6d6458' : '#58585e'; c.fillRect(x, y - 1, 1, 5);
      c.fillStyle = cob ? ((x + Math.floor(cam.s * PXM)) % 3 ? '#8a7f70' : '#4d463d') : '#7a7a82'; c.fillRect(x, y - 1, 1, 1);
      c.fillStyle = ground; c.fillRect(x, y + 4, 1, H - y);
      c.fillStyle = '#3d6b33'; if ((x + Math.floor(cam.s * PXM)) % 7 === 0) c.fillRect(x, y + 6, 1, 1);
      if (!cob && ((x + Math.floor(cam.s * PXM)) >> 3) % 2 === 0) { c.fillStyle = '#e6e6e6'; c.fillRect(x, y + 2, 1, 1); }
    }
    const vis = [];
    for (const r of sim.riders) {
      if (!(r.status === 'riding' || r.status === 'fallen')) continue;
      const s = visualS(r), x = xOf(s);
      if (x < -30 || x > W + 30) continue;
      const k = r.g ? r.g.members.indexOf(r) : 0;
      vis.push({ r, s, x, lane: k % 2 });
    }
    vis.sort((a, b) => b.lane - a.lane || a.s - b.s);
    for (const v of vis) {
      const y = yOf(v.s) + (v.lane ? -2 : 1);
      const pony = v.r.gender === 'f';
      if (v.r.status === 'fallen') A.fallenRider(c, v.x, y + 1, v.r.look);
      else if (v.r.g && (v.r.g.barT > 0 || (v.r.g.v < 0.3 && v.r.g.wait > 0))) A.standing(c, v.x, y + 1, v.r.look, { cup: v.r.g.barT > 0, ponytail: pony });
      else A.rider(c, v.x, y, v.r.look, v.r._ph || 0, { climb: route.gradeAt(v.s) > 0.05, marker: v.r.isPlayer ? '#ffef5a' : null, ponytail: pony });
      v.y = y;
    }
    if (sim.weather.id === 'drizzle') A.rain(c, W, H, time);

    // ---- crisp labels on top
    const L = view.labels, lc = L.getContext('2d');
    const k = L.width / W;
    lc.clearRect(0, 0, L.width, L.height);
    const fs = Math.max(10, Math.round(k * 3.6));
    lc.font = `600 ${fs}px system-ui, sans-serif`;
    lc.textAlign = 'center'; lc.textBaseline = 'bottom';
    const placed = [];
    const byX = vis.slice().sort((a, b) => (b.r.isPlayer ? 1 : 0) - (a.r.isPlayer ? 1 : 0) || b.x - a.x);
    for (const v of byX) {
      const text = v.r.isPlayer ? t('ride.you') : v.r.name;
      const tw = lc.measureText(text).width + 8;
      const x = v.x * k;
      let y = (v.y - 24) * k;
      for (let tries = 0; tries < 4 && placed.some((p) => Math.abs(p.x - x) < (p.w + tw) / 2 && Math.abs(p.y - y) < fs + 2); tries++) y -= fs + 3;
      if (placed.some((p) => Math.abs(p.x - x) < (p.w + tw) / 2 && Math.abs(p.y - y) < fs + 2)) continue;
      placed.push({ x, y, w: tw });
      lc.fillStyle = v.r.isPlayer ? 'rgba(255,239,90,0.95)' : 'rgba(10,12,18,0.72)';
      roundRect(lc, x - tw / 2, y - fs - 2, tw, fs + 4, 4); lc.fill();
      lc.fillStyle = v.r.isPlayer ? '#111' : v.r.look.jersey === '#111111' ? '#fff' : v.r.look.jersey;
      lc.fillText(text, x, y + 1);
    }
    lc.font = `${Math.max(10, Math.round(k * 3.4))}px system-ui, sans-serif`;
    for (const b of bubbles) {
      const v = vis.find((x) => x.r === b.r);
      if (!v) continue;
      const text = b.text.length > 46 ? b.text.slice(0, 44) + '…' : b.text;
      const tw = lc.measureText(text).width + 12;
      const x = G.clamp(v.x * k, tw / 2 + 4, L.width - tw / 2 - 4);
      const y = Math.max(fs + 8, (v.y - 34) * k - fs);
      lc.fillStyle = 'rgba(255,255,255,0.95)';
      roundRect(lc, x - tw / 2, y - fs - 4, tw, fs + 8, 6); lc.fill();
      lc.fillStyle = '#111'; lc.fillText(text, x, y + 2);
    }
    lc.font = `600 ${Math.max(10, Math.round(k * 3.2))}px system-ui, sans-serif`;
    const gs = sim.sortedGroups();
    const myG = me.g;
    const ref = myG ? myG.s : me.s;
    let ra = 0, la = 0;
    for (const g of gs) {
      const x = xOf(g.s - G.slotOffset(g.members.length - 1) / 2);
      const vref = Math.max(4, (myG && myG.v) || g.v || 6);
      const gap = (g.s - ref) / vref;
      const names = g.members.map((m) => (m.isPlayer ? t('ride.you_lower') : m.name)).slice(0, 3).join(', ') + (g.members.length > 3 ? ` +${g.members.length - 3}` : '');
      if (xOf(g.s) > W + 10) {
        const tx = `${names}  ${G.fmtGap(gap)} ▶`;
        lc.textAlign = 'right'; lc.fillStyle = 'rgba(10,12,18,0.7)';
        const tw = lc.measureText(tx).width + 10;
        roundRect(lc, L.width - tw - 6, 8 + ra * (fs + 8), tw, fs + 6, 4); lc.fill();
        lc.fillStyle = '#fff'; lc.fillText(tx, L.width - 11, 8 + ra * (fs + 8) + fs + 3);
        ra++;
      } else if (x < -20) {
        const tx = `◀ ${names}  ${G.fmtGap(gap)}`;
        lc.textAlign = 'left'; lc.fillStyle = 'rgba(10,12,18,0.7)';
        const tw = lc.measureText(tx).width + 10;
        roundRect(lc, 6, 8 + la * (fs + 8), tw, fs + 6, 4); lc.fill();
        lc.fillStyle = '#fff'; lc.fillText(tx, 11, 8 + la * (fs + 8) + fs + 3);
        la++;
      }
    }
    lc.textAlign = 'center';
    lc.font = `700 ${Math.max(10, Math.round(k * 3.2))}px system-ui, sans-serif`;
    for (const bar of route.bars) {
      const x = xOf(bar.at);
      if (x > -40 && x < W + 40) { lc.fillStyle = bar.type === 'fountain' ? '#9cd3f0' : '#ffd23f'; lc.fillText(G.stopIcon(bar) + ' ' + G.stopName(bar, route).toUpperCase(), x * k, (yOf(bar.at) - 36) * k); }
    }
    for (const cl of route.climbs) {
      const x = xOf(cl.top);
      if (x > -40 && x < W + 40) { lc.fillStyle = '#fff'; lc.fillText(`⛰ ${G.climbName(cl)} (${cl.cat === 'HC' ? 'HC' : t('route.cat', { c: cl.cat })})`, x * k, (yOf(cl.top) - 32) * k); }
    }
    if (xOf(route.len) < W + 40 && xOf(route.len) > -40) { lc.fillStyle = '#fff'; lc.fillText((route.kind === 'home' ? 'IRUN' : route.areaName.toUpperCase()) + ' 🏁', xOf(route.len) * k, (yOf(route.len) - 36) * k); }

    // banner
    let ban = '', cls = '';
    if (me.status === 'fallen') { ban = t('banner.fallen', { s: Math.ceil(me.fallT) }); cls = 'bad'; }
    else if (sim.attackAlert && sim.attackAlert.attacker !== me) { ban = t('banner.attack', { n: sim.attackAlert.attacker.name }); cls = 'warn'; }
    else if (myG && myG.footDown) { ban = t('banner.foot'); cls = 'info'; }
    else if (myG && myG.wait > 0) { ban = t('banner.wait', { why: myG.waitReason, s: Math.ceil(myG.wait) }); cls = 'info'; }
    else if (myG && myG.stopBar >= 0 && route.bars[myG.stopBar].at - me.s < 8000) { const b = route.bars[myG.stopBar]; ban = t('banner.stop', { place: G.stopName(b, route), km: G.fmtKm(b.at - me.s) }); cls = 'good'; }
    else if (me.bonked) { ban = t('banner.bonk'); cls = 'bad'; }
    else if (me.mode === 'attack') { ban = t('banner.attacking'); cls = 'warn'; }
    else if (myG && myG.members.length === 1 && me.status === 'riding') {
      const ahead = gs.filter((x) => x.s > myG.s && !x.fallen).pop();
      const gap = ahead ? (ahead.s - myG.s) / Math.max(4, myG.v || 6) : 999;
      if (gap < 90) { ban = t('banner.chasing', { who: ahead.members.length > 1 ? t('banner.the_group') : ahead.members[0].name, gap: G.fmtGap(gap) }); cls = 'info'; }
    }
    view.banner.textContent = ban;
    view.banner.className = 'banner ' + cls + (ban ? ' on' : '');
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }

  // ---------------------------------------------------------------- panels (5 Hz)
  function groupIcon(g) {
    if (g.fallen) return '💥';
    if (g.barT > 0) return '☕';
    if (g.footDown) return '🦶';
    if (g.wait > 0) return '⏸';
    if (g.members.some((m) => m.mode === 'attack')) return '⚡';
    if (g.members.some((m) => m.mode === 'chase')) return '🏃';
    return '';
  }

  function renderPanels(view, sim, gameSpeed) {
    const me = sim.player, route = sim.route, g = me.g;
    const h = view.hud;
    const v = g ? g.v : 0;
    const grade = route.gradeAt(me.s);
    h.clock.textContent = G.fmtClock(sim.clock());
    h.dist.textContent = `${G.fmtKm(me.s)} / ${route.km}`;
    h.speed.textContent = (v * 3.6).toFixed(1);
    h.grade.textContent = (grade * 100 >= 0 ? '+' : '') + (grade * 100).toFixed(1) + '%';
    h.grade.style.color = G.Draw.gradeColor(grade);
    h.alt.textContent = Math.round(route.eleAt(me.s)) + ' m';
    h.power.textContent = `${Math.round(me.P)} W · ${(me.P / me.mass).toFixed(1)}`;
    h.gameSpeed.textContent = '×' + gameSpeed;

    const k = g ? g.members.indexOf(me) : -1;
    let pos = t('you.alone');
    if (me.status === 'fallen') pos = t('you.ground');
    else if (g && g.barT > 0) pos = t('you.bar');
    else if (g && g.footDown) pos = t('you.foot');
    else if (g && g.members.length > 1) pos = k === 0 ? t('you.front', { n: g.members.length }) : t('you.wheel', { n: g.members.length, k: k + 1 });
    const you = view.you;
    you.innerHTML = '';
    you.append(...[
      el('div', { class: 'p-title' }, [el('span', { class: 'dot', style: { background: me.look.jersey } }), ` ${me.name.toUpperCase()}`]),
      UI.bar(me.E, 100, 'end' + (me.E < 15 ? ' low' : ''), t('you.endurance')),
      UI.bar(me.S, 100, 'spr', t('you.sprint')),
      UI.bar(me.H, 100, 'h2o', t('you.water')),
      me.digest > 0.5 ? el('div', { class: 'small good', text: t('you.digesting', { n: Math.round(me.digest) }) }) : null,
      el('div', { class: 'pace' }, [el('span', { class: 'pace-l', text: t('you.pace') }), ...G.PACES.map((p, i) => el('span', { class: 'pace-box' + (i <= me.pace ? ' on' : '') + (i === me.pace ? ' cur' : ''), title: G.paceName(i) })), el('span', { class: 'pace-name', text: G.paceName(me.pace) })]),
      el('div', { class: 'chips' }, [
        el('span', { class: 'chip ' + (me.relay ? 'on' : 'off'), text: t(me.relay ? 'you.relay_on' : 'you.relay_off') }),
        me.leading ? el('span', { class: 'chip on', text: t('you.pushing') }) : null,
        me.mode === 'attack' ? el('span', { class: 'chip warn', text: t('you.attack') }) : null,
        me.bonked ? el('span', { class: 'chip bad', text: t('you.bonk') }) : null,
      ].filter(Boolean)),
      el('div', { class: 'small', text: pos }),
      el('div', { class: 'items' }, [el('span', { text: `🍫×${me.food.bar}` }), el('span', { text: `🍌×${me.food.banana}` }), el('span', { text: t('you.sips', { n: me.sips }) })]),
    ].filter(Boolean));

    const gl = sim.groups.map((x) => ({ s: x.s, color: x.members.includes(me) ? '#ffef5a' : x.members[0].look.jersey, isPlayer: x.members.includes(me) }));
    G.Draw.profile(view.profFull, route, { s: me.s, groups: gl });
    G.Draw.profile(view.profZoom, route, { s: me.s, from: me.s - 500, to: me.s + 5500, zoom: true, groups: gl });
    G.Draw.map(view.map, route, { s: me.s, groups: gl });
    const nc = route.nextClimb(me.s), nb = route.nextStop(me.s);
    view.next.innerHTML = '';
    if (nc) {
      const inside = me.s >= nc.start;
      view.next.appendChild(el('div', {}, [el('b', { text: '⛰ ' + G.climbName(nc) }), ' ' + t(inside ? 'next.climb_in' : 'next.climb_to', {
        cat: nc.cat === 'HC' ? 'HC' : t('route.cat', { c: nc.cat }), top: G.fmtKm(nc.top - me.s), dist: G.fmtKm(nc.start - me.s), len: G.fmtKm(nc.top - nc.start), grade: nc.grade, max: nc.maxGrade,
      })]));
    }
    if (nb) view.next.appendChild(el('div', {}, [el('b', { text: G.stopIcon(nb) + ' ' + G.stopName(nb, route) }), ' ' + t('next.stop', { km: G.fmtKm(nb.at - me.s) }) + (g && g.stopBar === nb.idx ? ' · ' + t('next.agreed') : '')]));
    view.next.appendChild(el('div', { class: 'muted', text: t('next.finish', { place: route.kind === 'home' ? 'Irun' : route.areaName, km: G.fmtKm(route.len - me.s) }) }));

    const gs = sim.sortedGroups().filter((x) => x.members.length);
    const lead = gs[0];
    const items = gs.map((x) => ({
      gap: lead ? (lead.s - x.s) / Math.max(4, x.v || lead.v || 6) : 0,
      n: x.members.length, color: x.members.includes(me) ? '#ffef5a' : x.members[0].look.jersey, isPlayer: x.members.includes(me),
    }));
    G.Draw.situation(view.sit, items);
    view.groups.innerHTML = '';
    gs.forEach((x, i) => {
      const gap = items[i].gap;
      const head = i === 0 ? t('race.head') : x.members.length === 1 ? t('race.rider') : t('race.group');
      view.groups.appendChild(el('div', { class: 'grp' + (x.members.includes(me) ? ' mine' : '') }, [
        el('div', { class: 'grp-h' }, [el('b', { text: head }), ` ${x.members.length > 1 ? '(' + x.members.length + ')' : ''} ${i === 0 ? '' : G.fmtGap(-gap)} ${groupIcon(x)}`]),
        el('div', { class: 'grp-m' }, x.members.map((m, j) => el('span', { class: 'rchip' + (m.isPlayer ? ' me' : '') + (j === 0 && x.members.length > 1 ? ' lead' : ''), title: m.name }, [
          el('span', { class: 'dot', style: { background: m.look.jersey } }), (m.isPlayer ? t('ride.you_cap') : m.name) + (m.mode === 'attack' ? '⚡' : m.mode === 'chase' ? '🏃' : '') + (m.status === 'fallen' ? '💥' : '') + (m.bonked ? '😵' : ''),
        ]))),
      ]));
    });
    const home = sim.riders.filter((r) => r.status === 'home'), fin = sim.riders.filter((r) => r.status === 'finished');
    if (fin.length) view.groups.appendChild(el('div', { class: 'grp small' }, [t('race.finished') + ' ' + fin.map((r) => r.name).join(', ')]));
    if (home.length) view.groups.appendChild(el('div', { class: 'grp small muted' }, [t('race.home') + ' ' + home.map((r) => r.name).join(', ')]));

    const acts = view.actions;
    const set = (a, on) => { const b = acts.querySelector(`[data-act="${a}"]`); if (b) b.classList.toggle('dis', !on); };
    const riding = me.status === 'riding';
    set('attack', riding && me.S > 12 && !me.bonked);
    set('bar', riding && me.food.bar > 0); set('banana', riding && me.food.banana > 0); set('drink', riding && me.sips > 0);
    set('sitin', riding && g && g.members[0] === me && g.members.length > 1);
    set('letgo', riding && g && (g.members.length > 1 || g.wait > 0));
    set('askBar', riding && !!route.nextBar(me.s));
    set('foot', riding);
    const lbl = (a, txt) => { const b = acts.querySelector(`[data-act="${a}"] span:last-child`); if (b) b.textContent = txt; };
    lbl('relay', t(me.relay ? 'act.relay_on' : 'act.relay_off'));
    lbl('letgo', t(g && g.wait > 0 ? 'act.rideon' : 'act.letgo'));
    lbl('foot', t(g && g.footDown ? 'act.footup' : 'act.foot'));
  }
})();
