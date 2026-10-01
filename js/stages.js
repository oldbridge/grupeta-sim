// Dialogue stages: title, 0 rider select, 1 WhatsApp call, 2 morning, 3 meeting point,
// 5 bar stop (called from the ride) and the results / progression screen.
// The Sunday is a small state machine (st.stage) so it can be saved and resumed.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const el = G.el, UI = G.UI, Social = G.Social, t = (k, v) => G.t(k, v);
  const Game = {};
  G.Game = Game;

  const STAT_ORDER = G.STAT_KEYS;
  const colorOf = (name) => G.lookOf(name).jersey;
  const face = (name, size) => UI.avatar(name, size || 20);
  const players = () => window.PLAYERS || [];
  const V = (name, extra) => Object.assign({ n: name, g: G.genderOf(name) }, extra || {});

  // ---------------------------------------------------------------- career (localStorage)
  Game.career = () => G.store.get('career', {});
  Game.careerOf = (name) => Object.assign({ xp: 0, perks: [], rides: 0, km: 0, fitBonus: 0, kom: 0, rel: {}, sport: 0 }, Game.career()[name] || {});
  Game.saveCareerOf = (name, rec) => {
    const c = Game.career(); c[name] = rec; G.store.set('career', c);
    if (G.Net && G.Net.me === name) G.Net.pushCareer(rec);
  };
  const playerStats = (p) => Object.assign({}, p, { fitness: Math.min(100, p.fitness + (Game.careerOf(p.name).fitBonus || 0)) });

  // ---------------------------------------------------------------- state (de)serialisation
  Game.serialize = function (st) {
    const o = Object.assign({}, st);
    o.perks = st.perks ? [...st.perks] : [];
    o.talked = st.talked ? [...st.talked] : [];
    o.route = st.route ? st.route.id : null;
    o.weather = st.weather.id;
    o.trip = st.trip ? Object.assign({}, st.trip, { route: st.trip.route ? st.trip.route.id : null }) : null;
    delete o.simSave;
    return JSON.parse(JSON.stringify(o));
  };
  Game.deserialize = function (o) {
    const st = Object.assign({}, o);
    st.perks = new Set(o.perks || []);
    st.talked = new Set(o.talked || []);
    st.route = o.route ? G.routeById(o.route) : null;
    st.weather = G.WEATHER.find((w) => w.id === o.weather) || G.WEATHER[1];
    if (o.trip) st.trip = Object.assign({}, o.trip, { route: o.trip.route ? G.routeById(o.trip.route) : null });
    return st;
  };
  Game.saveLabel = (st, sim) => {
    const who = st.playerName || '?';
    const where = sim ? `${sim.route.name} · km ${G.fmtKm(sim.player.s)}` : t('stage_name.' + st.stage);
    return `${who} · ${where}`;
  };
  // checkpoint at the start of every stage (resuming restarts that stage)
  Game.checkpoint = function (st) {
    Game.cp = { st: Game.serialize(st) };
    Game.cp.st.rng = G.rngState();
    G.Save.write('auto', G.Save.payload(Game.cp.st, null, Game.saveLabel(st)));
  };
  Game.autosaveRide = function (st, sim) {
    const s = Game.serialize(st);
    s.rng = G.rngState();
    G.Save.write('auto', G.Save.payload(s, sim.toJSON(), Game.saveLabel(st, sim)));
  };
  Game.applyPayload = function (p) {
    if (p.career) G.store.set('career', p.career);
    const st = Game.deserialize(p.st);
    if (p.st.rng) G.setRngState(p.st.rng);
    if (p.sim) st.simSave = p.sim;
    return st;
  };

  // save menu (dialogue stages save the stage checkpoint; the ride passes its live sim)
  Game.saveMenu = async function (st, sim) {
    const stJSON = sim ? Object.assign(Game.serialize(st), { rng: G.rngState() }) : Game.cp.st;
    const p = G.Save.payload(stJSON, sim ? sim.toJSON() : null, Game.saveLabel(st, sim));
    const items = G.Save.SLOTS.map((s) => ({ label: t('save.slot', { n: s }) + ' — ' + G.Save.describe(G.Save.read(s)), value: s }));
    items.push({ label: t('save.download'), value: 'file' }, { label: t('common.cancel'), value: null });
    const v = await UI.modal(t('save.title'), t('save.body'), items, { cancel: null, vertical: true });
    if (!v) return;
    if (v === 'file') { G.Save.download(p); UI.toast(t('save.downloaded')); return; }
    G.Save.write(v, p);
    UI.toast(t('save.saved', { n: v }));
  };
  Game.loadMenu = async function () {
    const auto = G.Save.read('auto');
    const items = [{ label: t('save.auto') + ' — ' + G.Save.describe(auto), value: 'auto', disabled: !auto }];
    for (const s of G.Save.SLOTS) { const p = G.Save.read(s); items.push({ label: t('save.slot', { n: s }) + ' — ' + G.Save.describe(p), value: s, disabled: !p }); }
    items.push({ label: t('save.from_file'), value: 'file' }, { label: t('common.cancel'), value: null });
    const v = await UI.modal(t('save.load_title'), t('save.load_body'), items, { cancel: null, vertical: true });
    if (!v) return null;
    if (v === 'file') {
      const p = await G.Save.pickFile();
      if (!p) UI.toast(t('save.bad_file'));
      return p;
    }
    return G.Save.read(v);
  };
  Game.headerButtons = function (st) {
    const b = el('button', { class: 'hbtn', title: t('save.title'), text: '💾 ' + t('save.button') });
    b.addEventListener('click', () => Game.saveMenu(st));
    return b;
  };

  // ---------------------------------------------------------------- top level
  Game.run = async function () {
    for (;;) {
      // online: every friend logs in with their own password and can only ride their rider
      if (G.Net.enabled && !G.Net.me) { await Game.login(); await G.Online.afterLogin(); }
      G.Online.where('menu');
      const action = await Game.title();
      if (action === 'help') { await Game.help(); continue; }
      if (action === 'lang') { await Game.language(); continue; }
      if (action === 'taberna') { await Game.taberna(); continue; }
      if (action === 'logout') { await G.Net.logout(); continue; }
      let st = null;
      if (action === 'new') { st = Game.newDay(); st.stage = 'select'; }
      if (action === 'continue') { const p = G.Save.read('auto'); if (p) st = Game.applyPayload(p); }
      if (action === 'load') { const p = await Game.loadMenu(); if (p) st = Game.applyPayload(p); }
      if (st && G.Net.me && st.playerName && st.playerName !== G.Net.me) {
        UI.toast(t('login.not_yours', { n: st.playerName }));
        st = null;
      }
      if (st) await Game.play(st);
    }
  };

  // the roster may have changed since a save was made: add riders that are new in
  // config/players.js and forget the ones that were removed
  Game.ensureRoster = function (st) {
    const names = new Set(players().map((p) => p.name));
    for (const p of players()) {
      if (!st.social[p.name]) {
        const c = p.competitiveness / 100;
        const rel = st.playerName ? (Game.careerOf(st.playerName).rel || {})[p.name] : undefined;
        st.social[p.name] = { aggr: G.clamp(c * 0.6 + 0.03, 0, 1), relayWill: G.clamp(0.85 - c * 0.15, 0, 1), mood: rel != null ? rel : 0.2, rival: false, challenge: false };
        st.form[p.name] = 0;
        if (st.rel0) st.rel0[p.name] = st.social[p.name].mood;
      }
    }
    const keep = (n) => names.has(n) || n === st.playerName;
    st.present = (st.present || []).filter(keep);
    if (st.riders) st.riders = st.riders.filter(keep);
    for (const n of Object.keys(st.chat || {})) if (!names.has(n)) delete st.chat[n];
  };

  Game.play = async function (st) {
    Game.ensureRoster(st);
    while (st.stage !== 'done') {
      if (st.stage !== 'ride' || !st.simSave) Game.checkpoint(st);
      G.Online.where(st.stage === 'ride' ? 'riding' : st.stage, st.stage === 'ride' && st.route ? st.route.name : '');
      switch (st.stage) {
        case 'select': st.stage = (await Game.selectRider(st)) ? 'whatsapp' : 'done'; break;
        case 'whatsapp': await Game.whatsapp(st); st.stage = 'morning'; break;
        case 'morning': st.stage = (await Game.morning(st)) ? 'meeting' : 'done'; break;
        case 'meeting': await Game.meeting(st); st.stage = 'ride'; break;
        case 'ride': {
          const res = await G.Ride.run(st);
          delete st.simSave;
          if (!res) { st.stage = 'done'; break; }   // quit to the menu (autosave kept)
          Game.computeResults(st, res.sim, res.barMinutes);
          st.stage = 'results';
          break;
        }
        case 'results': await Game.results(st); st.stage = 'done'; G.Save.remove('auto'); break;
        default: st.stage = 'done';
      }
    }
  };

  Game.newDay = function () {
    const seed = (Date.now() & 0x7fffffff) >>> 0;
    G.seed(seed);
    const wr = G.rand();
    const weather = wr < 0.3 ? G.WEATHER[0] : wr < 0.65 ? G.WEATHER[1] : wr < 0.85 ? G.WEATHER[2] : G.WEATHER[3];
    const st = { seed, weather, social: {}, form: {}, chat: {}, present: [], kit: { bidons: 1, bar: 1, banana: 1 }, route: null,
      talks: 0, talked: new Set(), challenge: null, trip: { kind: 'home', area: 'irun' }, sport: [], relKeys: {} };
    for (const p of players()) {
      const c = p.competitiveness / 100;
      st.form[p.name] = G.randi(-8, 8);
      st.social[p.name] = {
        aggr: G.clamp(c * 0.6 + G.randf(-0.05, 0.12), 0, 1),
        relayWill: G.clamp(0.85 - c * 0.15 + G.randf(-0.1, 0.1), 0, 1),
        mood: 0.2, rival: false, challenge: false,
      };
    }
    return st;
  };
  // relationships carried over from previous Sundays (set once the rider is chosen)
  function loadRelations(st) {
    const rel = Game.careerOf(st.playerName).rel || {};
    st.rel0 = {};
    for (const p of players()) {
      if (p.name === st.playerName) continue;
      const m = rel[p.name] != null ? rel[p.name] : 0.2;
      st.social[p.name].mood = m;
      st.rel0[p.name] = m;
    }
  }
  function addRel(st, name, key) {
    st.relKeys[name] = st.relKeys[name] || [];
    if (!st.relKeys[name].includes(key)) st.relKeys[name].push(key);
  }
  function moodIcon(m) { return m > 0.45 ? '😊' : m > 0.05 ? '🙂' : m > -0.3 ? '😐' : '😠'; }
  Game.moodIcon = moodIcon;

  // ---------------------------------------------------------------- title, help, language
  Game.title = async function () {
    const ui = UI.sceneScreen({ title: t('title.name'), sub: t('title.sub') });
    ui.root.classList.add('title-stage');
    const looks = players().slice(0, 7).map((p) => p.look);
    const stop = UI.animate((tm) => G.Art.sceneTitle(ui.canvas, tm, looks));
    ui.overlay.appendChild(el('div', { class: 'title-logo' }, [
      el('div', { class: 'logo-main', text: t('title.name') }),
      el('div', { class: 'logo-sub', text: t('title.tagline') }),
    ]));
    const routes = G.routes();
    await ui.dlg.say(null, t('title.intro', { routes: routes.length, home: routes.filter((r) => r.kind === 'home').length, riders: players().length }), { noWait: true });
    const auto = G.Save.read('auto');
    const v = await ui.dlg.choose([
      auto ? { label: t('title.continue'), value: 'continue', hint: auto.label } : null,
      { label: t('title.new'), value: 'new', hint: t('title.new_hint') },
      { label: t('title.load'), value: 'load', hint: t('title.load_hint') },
      { label: t('title.taberna'), value: 'taberna', hint: G.Net.me ? t('title.taberna_hint') : t('title.taberna_offline') },
      { label: t('title.language') + ' · ' + ((window.I18N_LANGS || {})[G.lang] || G.lang), value: 'lang' },
      { label: t('title.help'), value: 'help' },
      G.Net.me ? { label: t('title.logout', { n: G.Net.me }), value: 'logout' } : null,
    ].filter(Boolean));
    stop();
    return v;
  };

  Game.help = async function () {
    const ui = UI.sceneScreen({ tag: t('help.tag'), title: t('help.title') });
    const stop = UI.animate((tm) => G.Art.sceneTitle(ui.canvas, tm, players().slice(0, 1).map((p) => p.look)));
    for (const l of G.tList('help.pages')) await ui.dlg.say(t('help.tag'), l);
    stop();
  };

  Game.language = async function () {
    const langs = window.I18N_LANGS || { en: 'English' };
    const v = await UI.modal(t('title.language'), t('lang.body'), Object.keys(langs).map((k) => ({ label: langs[k], value: k })).concat([{ label: t('common.cancel'), value: null }]), { cancel: null, vertical: true });
    if (!v || v === G.lang) return;
    G.store.set('lang', v);
    location.reload();
    await new Promise(() => {});
  };

  // ---------------------------------------------------------------- stage 0: rider select
  Game.selectRider = function (st) {
    return new Promise((resolve) => {
      const list = players();
      let sel = Math.max(0, list.findIndex((p) => p.name === (G.Net.me || G.store.get('lastRider', ''))));
      const info = el('div', { class: 'stat-info' }, [
        el('h3', { text: t('select.stats_title') }),
        ...STAT_ORDER.map((k) => el('div', { class: 'stat-row' }, [el('b', { text: t('stats.' + k + '.name') }), el('span', { text: t('stats.' + k + '.info') })])),
        el('div', { class: 'stat-row' }, [el('b', { text: t('stats.weight.name') }), el('span', { text: t('stats.weight.info') })]),
      ]);
      const detail = el('div', { class: 'rider-detail' });
      const grid = el('div', { class: 'rider-grid' });
      const cards = list.map((p, i) => {
        const ps = playerStats(p), car = Game.careerOf(p.name);
        const lvl = Social.levelFor(car.xp);
        const card = el('div', { class: 'rider-card', tabindex: '0' }, [
          el('div', { class: 'rc-top' }, [face(p.name, 48), el('div', {}, [
            el('div', { class: 'rc-name', text: p.name }),
            el('div', { class: 'rc-tag', text: Game.tagline(p) }),
            el('div', { class: 'rc-kg', text: `${p.weight} kg` }),
            car.rides ? el('div', { class: 'rc-lvl', text: t('select.career', { lvl, rides: car.rides, km: Math.round(car.km) }) }) : null,
          ])]),
          el('div', { class: 'rc-stats' }, STAT_ORDER.map((k) => UI.bar(ps[k], 100, 'st-' + k, t('stats.' + k + '.short')))),
        ]);
        if (G.Net.me && p.name !== G.Net.me) card.classList.add('locked');
        card.addEventListener('click', () => { if (sel === i) confirm(); else { sel = i; paint(); } });
        grid.appendChild(card);
        return card;
      });
      const go = el('button', { class: 'btn primary big' });
      go.addEventListener('click', () => confirm());
      const back = el('button', { class: 'btn', text: t('common.back') });
      back.addEventListener('click', () => { UI.popKeys(keys); resolve(null); });
      const paint = () => {
        cards.forEach((c, i) => c.classList.toggle('sel', i === sel));
        const p = list[sel], car = Game.careerOf(p.name);
        const locked = G.Net.me && p.name !== G.Net.me;
        go.textContent = locked ? t('login.locked', { n: p.name }) : t('select.ride_as', { n: p.name });
        go.disabled = !!locked;
        detail.innerHTML = '';
        detail.append(...[
          el('div', { class: 'rd-head' }, [face(p.name, 96), el('div', {}, [el('div', { class: 'rd-name', text: p.name }), el('div', { class: 'small muted', text: `${p.weight} kg · ${p.gender === 'f' ? '♀' : '♂'}` })])]),
          el('div', { class: 'rd-tag', text: Game.tagline(p) }),
          car.perks.length ? el('div', { class: 'rd-perks', text: t('select.perks') + ' ' + car.perks.map((id) => t('perks.' + id + '.name')).join(', ') }) : null,
          car.fitBonus ? el('div', { class: 'small', text: t('select.training', { n: car.fitBonus }) }) : null,
          car.rides ? el('div', { class: 'small', text: t('select.sport_total', { n: car.sport || 0 }) }) : null,
        ].filter(Boolean));
        cards[sel].scrollIntoView({ block: 'nearest' });
      };
      const keys = (e) => {
        const cols = Math.max(1, Math.round(grid.clientWidth / (cards[0].clientWidth + 8))) || 4;
        if (e.key === 'ArrowRight') { sel = (sel + 1) % list.length; paint(); return true; }
        if (e.key === 'ArrowLeft') { sel = (sel - 1 + list.length) % list.length; paint(); return true; }
        if (e.key === 'ArrowDown') { sel = Math.min(list.length - 1, sel + cols); paint(); return true; }
        if (e.key === 'ArrowUp') { sel = Math.max(0, sel - cols); paint(); return true; }
        if (e.key === 'Enter') { confirm(); return true; }
        if (e.key === 'Escape') { UI.popKeys(keys); resolve(null); return true; }
        return false;
      };
      const confirm = () => {
        if (G.Net.me && list[sel].name !== G.Net.me) return;
        UI.popKeys(keys);
        const p = list[sel];
        st.playerName = p.name;
        st.player = playerStats(p);
        st.perks = new Set(Game.careerOf(p.name).perks);
        loadRelations(st);
        G.store.set('lastRider', p.name);
        resolve(p.name);
      };
      UI.pushKeys(keys);
      const warns = G.playerWarnings.length ? el('div', { class: 'cfg-warn' }, [el('b', { text: t('select.config_warnings') }), ...G.playerWarnings.map((w) => el('div', { text: '• ' + w }))]) : null;
      UI.show(el('div', { class: 'stage' }, [
        el('div', { class: 'stage-header' }, [el('span', { class: 'stage-tag', text: t('stage_tag.select') }), el('span', { class: 'stage-title', text: t('select.title') }), el('span', { class: 'stage-sub', text: t('select.keys') })]),
        warns,
        el('div', { class: 'select-layout' }, [grid, el('div', { class: 'select-side' }, [detail, el('div', { class: 'row' }, [back, go]), info])]),
      ].filter(Boolean)));
      paint();
    });
  };
  Game.tagline = function (p) {
    const special = G.playerTagline(p);
    if (special) return special;
    const s = p;
    let k = 'solid';
    if (s.fitness >= 90 && s.endurance >= 90 && s.competitiveness < 50) k = 'engine';
    else if (s.sprint >= 90 && s.competitiveness >= 90) k = 'sprinter';
    else if (s.competitiveness >= 90 && s.fitness < 50) k = 'allattack';
    else if (s.fitness >= 85) k = 'allrounder';
    else if (s.competitiveness <= 15) k = 'chatty';
    else if (s.endurance >= 75) k = 'diesel';
    else if (s.sprint >= 75) k = 'punchy';
    return t('taglines.generic.' + k, { g: p.gender });
  };

  // ---------------------------------------------------------------- stage 1: WhatsApp
  function tripDest(trip) {
    if (trip.kind === 'epic') return trip.route.name;
    if (trip.kind === 'away') return G.areaName(trip.area);
    return 'Irun';
  }
  Game.whatsapp = async function (st) {
    const me = st.playerName;
    const phone = new G.Phone({ title: t('wa.group'), sub: players().map((p) => p.name).join(', '), date: t('wa.saturday'), clock: '21:30' });
    const narr = el('div', { class: 'narr' });
    const roster = el('div', { class: 'roster' });
    UI.show(el('div', { class: 'stage' }, [
      el('div', { class: 'stage-header' }, [el('span', { class: 'stage-tag', text: t('stage_tag.whatsapp') }), el('span', { class: 'stage-title', text: t('wa.title') }), el('span', { class: 'stage-sub', text: t('wa.forecast', { icon: st.weather.icon, w: G.weatherName(st.weather), temp: st.weather.temp }) }), Game.headerButtons(st)]),
      el('div', { class: 'wa-layout' }, [el('div', { class: 'wa-left' }, [narr, roster]), phone.el]),
    ]));
    const setNarr = (txt) => { narr.textContent = txt; };
    const others = players().filter((p) => p.name !== me);
    const icons = { yes: '✅', maybe: '❔', silent: '💤', no: '❌', full: '🚗❌' };
    const paintRoster = () => {
      roster.innerHTML = '';
      roster.appendChild(el('h4', { text: t('wa.roster', { dest: tripDest(st.trip) }) }));
      for (const p of others) {
        const s = st.chat[p.name];
        roster.appendChild(el('div', { class: 'roster-row ' + (s || 'wait') }, [face(p.name), el('span', { text: p.name }), el('span', { class: 'r-icon', text: icons[s] || '…' })]));
      }
    };
    paintRoster();
    const chatty = G.shuffle(players().filter((p) => p.name !== me)).slice(0, 2).map((p) => p.name);
    if (chatty.length === 2) {
      phone.msg(chatty[0], t('wa.chatter1', V(chatty[0])), { color: colorOf(chatty[0]), time: '19:02', avatar: face(chatty[0], 26) });
      phone.msg(chatty[1], t('wa.chatter2', V(chatty[1])), { color: colorOf(chatty[1]), time: '19:05', avatar: face(chatty[1], 26) });
    }
    let minute = 30;
    const clock = () => G.fmtClock(21 * 60 + Math.min(59, minute));
    // sometimes somebody else proposes a trip first
    const offer = G.chance(0.4) ? Social.aiOffer(players(), me, st.weather) : null;
    if (offer) {
      await phone.typing(offer.by, 900);
      minute += 1;
      const txt = offer.kind === 'epic' ? t('wa.offer_epic', V(offer.by, { event: offer.route.name }))
        : t('wa.offer_away', V(offer.by, { area: G.areaName(offer.area), seats: offer.seats - 1 }));
      phone.msg(offer.by, txt, { color: colorOf(offer.by), time: clock(), avatar: face(offer.by, 26) });
    }
    setNarr(t('wa.narr_start', V(me)));
    const choice = await phone.replies([
      { label: t('wa.opt_home'), value: 'home' },
      { label: t('wa.opt_car'), value: 'away' },
      { label: t('wa.opt_epic'), value: 'epic' },
      offer ? { label: t('wa.opt_join', { n: offer.by, dest: offer.kind === 'epic' ? offer.route.name : G.areaName(offer.area) }), value: 'join' } : null,
    ].filter(Boolean), { prompt: t('wa.prompt_kind') });
    const times = [{ label: '08:00', value: 8 * 60 }, { label: '08:30', value: 8 * 60 + 30 }, { label: '09:00', value: 9 * 60 }, { label: '09:30', value: 9 * 60 + 30 }];
    let msg;
    if (choice === 'home') {
      st.trip = { kind: 'home', area: 'irun' };
      st.departure = await phone.replies(times, { prompt: t('wa.prompt_time') });
      msg = t('wa.call_home', { time: G.fmtClock(st.departure) });
    } else if (choice === 'away') {
      const area = await phone.replies(G.awayAreas().map((a) => ({ label: t('wa.area_opt', { area: G.areaName(a), min: G.AREAS_DRIVE(a), n: G.routesOfArea(a).length }), value: a })), { prompt: t('wa.prompt_area') });
      st.departure = await phone.replies(times.slice(0, 3).map((x) => ({ label: G.fmtClock(x.value - 30), value: x.value - 30 })), { prompt: t('wa.prompt_time') });
      st.trip = { kind: 'away', area, driver: me, seats: 4 };
      msg = t('wa.call_away', { area: G.areaName(area), time: G.fmtClock(st.departure), seats: 3 });
    } else if (choice === 'epic') {
      const id = await phone.replies(G.epicRoutes().map((r) => ({ label: `${r.name} · ${r.km} km · ${r.gain} m+`, value: r.id })), { prompt: t('wa.prompt_epic') });
      const route = G.routeById(id);
      st.trip = { kind: 'epic', area: route.area, route };
      st.departure = 7 * 60 + 30;
      msg = t('wa.call_epic', { event: route.name });
    } else {
      if (offer.kind === 'epic') st.trip = { kind: 'epic', area: offer.route.area, route: offer.route };
      else st.trip = { kind: 'away', area: offer.area, driver: offer.by, seats: offer.seats };
      st.departure = 7 * 60 + 30;
      st.chat[offer.by] = 'yes';
      msg = t('wa.join', { n: offer.by });
    }
    minute += 1;
    phone.msg(null, msg, { mine: true, time: clock() });
    paintRoster();
    setNarr(t('wa.narr_wait'));
    let seats = st.trip.kind === 'away' ? st.trip.seats : 99;
    let secondCar = false;
    const goingCount = () => 1 + others.filter((p) => st.chat[p.name] === 'yes').length;
    for (const p of G.shuffle(others)) {
      if (st.chat[p.name]) continue;
      if (G.chance(0.1)) { st.chat[p.name] = 'silent'; paintRoster(); continue; }
      minute += G.randi(0, 4);
      await phone.typing(p.name, G.randi(350, 900));
      const r = Social.chatReply(p, st.trip, st.departure, st.weather, st.social[p.name].mood, p.fitness + st.form[p.name]);
      if (r.kind === 'yes' && goingCount() >= seats) {
        if (!secondCar && G.chance(0.6)) {
          secondCar = true; seats += 4;
          st.chat[p.name] = 'yes';
          phone.msg(p.name, t('wa.second_car', V(p.name)), { color: colorOf(p.name), time: clock(), avatar: face(p.name, 26) });
        } else {
          st.chat[p.name] = 'full';
          phone.msg(p.name, r.text, { color: colorOf(p.name), time: clock(), avatar: face(p.name, 26) });
          const driverIsMe = st.trip.driver === me;
          phone.msg(driverIsMe ? null : st.trip.driver, t('wa.car_full', V(p.name)), { mine: driverIsMe, color: colorOf(st.trip.driver || me), time: clock() });
        }
      } else {
        st.chat[p.name] = r.kind;
        phone.msg(p.name, r.text, { color: colorOf(p.name), time: clock(), avatar: face(p.name, 26) });
      }
      paintRoster();
    }
    const doubtful = others.filter((p) => ['no', 'maybe', 'silent'].includes(st.chat[p.name]));
    setNarr(t('wa.narr_insist', { n: goingCount() - 1 }));
    if (doubtful.length && goingCount() < seats) {
      const v = await phone.replies(doubtful.slice(0, 8).map((p) => ({ label: t('wa.insist_opt', { n: p.name }), value: p.name })).concat([{ label: t('wa.good_night'), value: null }]), { prompt: t('wa.prompt_insist') });
      if (v) {
        const p = players().find((x) => x.name === v);
        phone.msg(null, t('wa.insist', V(v)), { mine: true, time: '21:58' });
        await phone.typing(v, 900);
        const r = Social.insist(p, st.perks, st.social[v].mood);
        if (r.ok) st.chat[v] = 'yes';
        phone.msg(v, r.text, { color: colorOf(v), time: '21:59', avatar: face(v, 26) });
        paintRoster();
      }
    }
    phone.msg(null, t('wa.night'), { mine: true, time: '22:02' });
    for (const p of others.filter((x) => st.chat[x.name] === 'yes').slice(0, 2)) { await phone.typing(p.name, 500); phone.msg(p.name, t('wa.night'), { color: colorOf(p.name), time: '22:03', avatar: face(p.name, 26) }); }
    const yes = others.filter((p) => st.chat[p.name] === 'yes').map((p) => p.name);
    setNarr(yes.length ? t('wa.narr_group', { names: yes.join(', '), dest: tripDest(st.trip) }) : t('wa.narr_nobody'));
    await phone.replies([{ label: t('wa.sleep'), value: 1 }], { prompt: '' });
  };

  // ---------------------------------------------------------------- stage 2: morning
  Game.morning = async function (st) {
    const me = st.playerName;
    const look = G.lookOf(me);
    const wake = st.departure - 60;
    const ui = UI.sceneScreen({ tag: t('stage_tag.morning'), title: t('morning.title'), sub: `${G.fmtClock(wake)} · ${st.weather.icon} ${G.weatherName(st.weather)}, ${st.weather.temp}°C`, side: true, extra: Game.headerButtons(st) });
    const kit = st.kit;
    kit.bidons = 1; kit.bar = 0; kit.banana = 0;
    const pockets = st.perks.has('pockets') ? 4 : 3;
    const draw = (lit) => G.Art.sceneKitchen(ui.canvas, { bidons: kit.bidons, bars: kit.bar, bananas: kit.banana, look, phoneLit: lit });
    draw(false);
    const side = ui.side;
    const paintSide = () => {
      side.innerHTML = '';
      side.append(el('h4', { text: t('morning.kit') }),
        el('div', { class: 'kit-row', text: t('morning.kit_bidons', { n: kit.bidons, sips: kit.bidons * 4 }) }),
        el('div', { class: 'kit-row', text: t('morning.kit_bars', { n: kit.bar }) }),
        el('div', { class: 'kit-row', text: t('morning.kit_bananas', { n: kit.banana }) }),
        el('div', { class: 'kit-row muted', text: t('morning.pockets', { n: kit.bar + kit.banana, max: pockets }) }),
        el('p', { class: 'small muted', text: t(st.weather.heat > 1.2 ? 'morning.hint_hot' : 'morning.hint') }));
    };
    paintSide();
    const meP = G.playerByName(me) || st.player;
    if (meP.badSleeper && G.chance(Math.min(1, meP.badSleeper + 0.1))) {
      await ui.dlg.say(null, t('morning.sleep_bad'));
      const v = await ui.dlg.choose([
        { label: t('morning.sleep_ride'), value: 'ride' },
        { label: t('morning.sleep_bed'), value: 'bed' },
      ], { prompt: t('morning.what_now') });
      if (v === 'bed') { await ui.dlg.say(null, t('morning.sleep_bed_end')); return false; }
      st.form[me] -= 12;
    }
    const intro = st.trip.kind === 'epic' ? t('morning.intro_epic', { time: G.fmtClock(wake), event: st.trip.route.name })
      : st.trip.kind === 'away' ? t('morning.intro_away', { time: G.fmtClock(wake), area: G.areaName(st.trip.area), driver: st.trip.driver === me ? t('morning.you_drive') : st.trip.driver })
        : t('morning.intro', { time: G.fmtClock(wake), w: G.weatherName(st.weather), temp: st.weather.temp });
    await ui.dlg.say(null, intro);
    kit.bidons = await ui.dlg.choose([
      { label: t('morning.one_bidon'), value: 1, hint: t('morning.one_bidon_hint') },
      { label: t('morning.two_bidons'), value: 2, hint: t(st.weather.heat > 1.2 ? 'morning.two_bidons_hot' : 'morning.two_bidons_hint') },
    ], { prompt: t('morning.water_q') });
    draw(false); paintSide();
    for (;;) {
      const used = kit.bar + kit.banana;
      const v = await ui.dlg.choose([
        { label: t('morning.add_bar'), value: 'bar', disabled: used >= pockets, hint: '+22' },
        { label: t('morning.add_banana'), value: 'banana', disabled: used >= pockets, hint: '+14' },
        { label: t('morning.empty'), value: 'clear', disabled: used === 0 },
        { label: t('common.done'), value: 'done' },
      ], { prompt: t('morning.food_q', { n: used, max: pockets }) });
      if (v === 'done') break;
      if (v === 'clear') { kit.bar = 0; kit.banana = 0; } else kit[v]++;
      draw(false); paintSide();
    }
    draw(true);
    await ui.dlg.say(null, t('morning.phone_buzz'));
    const phone = new G.Phone({ title: t('wa.group'), sub: t('wa.sunday_sub'), date: t('wa.sunday'), clock: G.fmtClock(wake + 10) });
    phone.el.classList.add('phone-small');
    side.innerHTML = '';
    side.appendChild(phone.el);
    const going = players().filter((p) => p.name !== me && (st.chat[p.name] === 'yes' || st.chat[p.name] === 'maybe'));
    let tmin = wake + 5, any = false;
    for (const p of G.shuffle(going)) {
      const s = st.chat[p.name];
      let key = null;
      if (p.badSleeper && s === 'yes' && G.chance(p.badSleeper)) { st.chat[p.name] = 'dropped'; st.badSleep = (st.badSleep || []).concat(p.name); key = 'wa.bad_sleep'; }
      else if (s === 'maybe') {
        if (G.chance(0.5)) { st.chat[p.name] = 'yes'; key = 'wa.maybe_yes'; } else { st.chat[p.name] = 'no'; key = 'wa.maybe_no'; }
      } else if (G.chance(0.05)) { st.chat[p.name] = 'dropped'; key = 'wa.morning_drop'; }
      else if (G.chance(0.35)) key = 'wa.morning_flavour';
      if (!key) continue;
      any = true;
      tmin += G.randi(1, 6);
      await phone.typing(p.name, 600);
      phone.msg(p.name, t(key, V(p.name)), { color: colorOf(p.name), time: G.fmtClock(tmin), avatar: face(p.name, 22) });
    }
    if (!any) phone.system(t('wa.no_new'));
    const dropped = players().filter((p) => st.chat[p.name] === 'dropped').map((p) => p.name);
    const sleepers = (st.badSleep || []).filter((n) => dropped.includes(n));
    if (sleepers.length) await ui.dlg.say(null, t('morning.sleep_dropped', { names: sleepers.join(', ') }));
    else if (dropped.length) await ui.dlg.say(null, t('morning.dropped', { names: dropped.join(', ') }));
    else await ui.dlg.say(null, t('morning.nobody_dropped'));
    const leave = st.trip.kind === 'epic' ? t('morning.leave_epic') : t('morning.leave', { time: G.fmtClock(st.departure) });
    await ui.dlg.choose([{ label: leave, value: 1 }], { prompt: t('morning.go') });
    return true;
  };

  // ---------------------------------------------------------------- stage 3: meeting point
  function routePreview(side, route) {
    side.innerHTML = '';
    const map = el('canvas', { class: 'mini-map', width: 220, height: 150 });
    const prof = el('canvas', { class: 'mini-prof', width: 440, height: 110 });
    const stars = route.stars();
    side.append(
      el('div', { class: 'rp-name', text: route.name }),
      el('div', { class: 'rp-meta', text: `${route.km} km · ${route.gain} m+ · ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}` + (route.surface === 'cobbles' ? ' · ' + t('route.cobbles') : '') }),
      el('div', { class: 'rp-blurb', text: route.blurb }),
      el('div', { class: 'rp-canvases' }, [map, prof]),
      el('div', { class: 'rp-list' }, [
        el('div', {}, [el('b', { text: t('route.stops') + ' ' }), route.bars.map((b) => `${G.stopIcon(b)} ${G.stopName(b, route)} (${G.fmtKm(b.at)})`).join(' · ')]),
        el('div', {}, [el('b', { text: t('route.climbs') + ' ' }), route.climbs.length ? route.climbs.map((c) => `${G.climbName(c)} ${c.cat === 'HC' ? 'HC' : t('route.cat', { c: c.cat })} (${G.fmtKm(c.top - c.start)} km ${c.grade}%)`).join(' · ') : t('route.none')]),
        el('div', { class: 'small muted', text: route.date === 'stitched' ? t('route.stitched') : t('route.ridden', { date: route.date }) }),
      ]),
    );
    G.Draw.map(map, route, { s: 0 });
    G.Draw.profile(prof, route, { s: 0 });
  }

  Game.meeting = async function (st) {
    const me = st.playerName;
    const trip = st.trip;
    const present = players().filter((p) => p.name !== me && (st.chat[p.name] === 'yes' || (st.chat[p.name] === 'silent' && trip.kind === 'home' && G.chance(0.35))));
    st.present = present.map((p) => p.name);
    const surprise = present.filter((p) => st.chat[p.name] === 'silent').map((p) => p.name);
    const placeTitle = trip.kind === 'home' ? t('meet.title_home') : trip.kind === 'away' ? t('meet.title_away', { area: G.areaName(trip.area) }) : trip.route.name;
    const ui = UI.sceneScreen({ tag: t('stage_tag.meeting'), title: placeTitle, sub: `${G.fmtClock(st.departure)} · ${st.weather.icon} ${st.weather.temp}°C`, side: true, extra: Game.headerButtons(st) });
    const scene = trip.kind === 'home' ? 'street' : trip.kind === 'away' ? 'carpark' : 'startline';
    const redraw = (kind) => G.Art.sceneStreet(ui.canvas, [G.lookOf(me)].concat(st.present.map((n) => G.lookOf(n))), kind || scene, [me].concat(st.present).map(G.genderOf));
    redraw(trip.kind === 'away' ? 'street' : scene);
    const sidePresent = () => {
      ui.side.innerHTML = '';
      ui.side.appendChild(el('h4', { text: t('meet.present', { n: st.present.length + 1 }) }));
      for (const n of [me].concat(st.present)) {
        const s = st.social[n];
        const tags = [];
        if (n !== me) {
          if (s.rival) tags.push(t('meet.tag_rival'));
          if (s.challenge) tags.push(t('meet.tag_challenge'));
          if (s.aggr < 0.25) tags.push(t('meet.tag_calm'));
          if (s.relayWill < 0.4) tags.push(t('meet.tag_nopull'));
          tags.push(moodIcon(s.mood));
        }
        ui.side.appendChild(el('div', { class: 'roster-row yes' }, [face(n, 24), el('span', { text: n + (n === me ? ' ' + t('common.you_paren') : '') }), el('span', { class: 'r-icon small', text: tags.join(' ') })]));
      }
      if (st.route) ui.side.appendChild(el('div', { class: 'agreed', text: t('meet.agreed_box', { route: st.route.name, km: st.route.km }) }));
    };
    sidePresent();
    if (!st.present.length) await ui.dlg.say(null, t(trip.kind === 'home' ? 'meet.nobody' : 'meet.nobody_away'));
    else {
      await ui.dlg.say(null, t('meet.arrive', { time: G.fmtClock(st.departure), names: st.present.join(', ') }));
      if (surprise.length) await ui.dlg.say(null, t('meet.surprise', { names: surprise.join(', ') }));
    }
    st.startMin = st.departure;
    if (trip.kind === 'away') {
      const min = G.AREAS_DRIVE(trip.area);
      await ui.dlg.say(null, t('meet.load_car', { driver: trip.driver === me ? t('meet.your_car') : t('meet.their_car', { n: trip.driver }) }));
      st.startMin = st.departure + min;
      redraw('carpark');
      ui.header.querySelector('.stage-sub').textContent = `${G.fmtClock(st.startMin)} · ${G.areaName(trip.area)}`;
      await ui.dlg.say(null, t('meet.arrived', { area: G.areaName(trip.area), min, time: G.fmtClock(st.startMin) }));
    }
    if (trip.kind === 'epic') {
      ui.overlay.appendChild(el('div', { class: 'bar-sign start-sign', text: t('meet.start_banner') }));
      st.route = trip.route;
      await ui.dlg.say(null, t('meet.epic_start', { event: trip.route.name, km: trip.route.km, gain: trip.route.gain }));
      sidePresent();
    }
    const routes = trip.kind === 'home' ? G.routes().filter((r) => r.kind === 'home') : G.routesOfArea(trip.area);
    let proposals = 0;
    for (;;) {
      const items = [
        trip.kind !== 'epic' ? { label: st.route ? t('meet.change_route', { route: st.route.name }) : t('meet.propose'), value: 'route', disabled: proposals >= 3 && !!st.route, hint: proposals >= 3 ? t('meet.enough') : '' } : null,
        { label: t('meet.talk'), value: 'talk', disabled: !st.present.length || st.talks >= 3, hint: t('meet.left', { n: 3 - st.talks }) },
        { label: t('meet.go'), value: 'go', disabled: !st.route },
      ].filter(Boolean);
      const v = await ui.dlg.choose(items, { prompt: st.route ? t('meet.ready', { route: st.route.name, km: st.route.km }) : t('meet.what') });
      if (v === 'go') break;
      if (v === 'talk') { await Game.talk(ui, st, st.present, null, sidePresent); continue; }
      const pick = await ui.dlg.choose(routes.map((r) => ({ label: r.name, value: r.id, hint: `${r.km} km · ${r.gain} m+ · ${'★'.repeat(r.stars())}` })).concat([{ label: t('common.back_arrow'), value: null }]),
        { cols: true, prompt: t('meet.which'), onFocus: (id) => { if (id) routePreview(ui.side, G.routeById(id)); }, cancel: null });
      if (!pick) { sidePresent(); continue; }
      const route = G.routeById(pick);
      proposals++;
      if (!st.present.length) { st.route = route; sidePresent(); continue; }
      await ui.dlg.say(me, t('meet.proposal', { route: route.name, km: route.km, gain: route.gain }), { color: colorOf(me) });
      const votes = [];
      for (const n of st.present) {
        const p = players().find((x) => x.name === n);
        const vt = Social.routeVote(p, p.fitness + st.form[n], route, st.weather, st.perks, st.social[n].mood);
        votes.push({ n, ...vt });
        await ui.dlg.say(n, (vt.accept ? '✅ ' : '❌ ') + vt.text, { color: colorOf(n) });
      }
      const yes = votes.filter((x) => x.accept).map((x) => x.n), no = votes.filter((x) => !x.accept).map((x) => x.n);
      const opts = [];
      opts.push(yes.length ? { label: t('meet.go_with', { n: yes.length, names: yes.join(', ') }), value: 'go' } : { label: t('meet.go_alone'), value: 'go' });
      let counter = null;
      if (no.length > yes.length && routes.length > 1) {
        let best = null, bestScore = -1;
        for (const r of routes) {
          if (r === route) continue;
          let sc = 0;
          for (const n of st.present) {
            const p = players().find((x) => x.name === n);
            sc += G.sigmoid((Social.capacity(p, p.fitness + st.form[n]) - r.difficulty) * 3.2 + 0.6);
          }
          sc += r.km / 400;
          if (sc > bestScore) { bestScore = sc; best = r; }
        }
        counter = best;
        const who = G.pick(no);
        await ui.dlg.say(who, t('meet.counter', V(who, { route: best.name, km: best.km })), { color: colorOf(who) });
        opts.push({ label: t('meet.accept_counter', { route: best.name, km: best.km }), value: 'counter' });
      }
      opts.push({ label: proposals < 3 ? t('meet.again') : t('meet.again_last'), value: 'again', disabled: proposals >= 3 });
      const d = await ui.dlg.choose(opts, { prompt: t('meet.tally', { yes: yes.length, no: no.length }) });
      if (d === 'again') { sidePresent(); continue; }
      if (d === 'counter') {
        st.route = counter;
        await ui.dlg.say(null, t('meet.counter_ok', { route: counter.name }));
      } else {
        st.route = route;
        if (no.length && yes.length) await ui.dlg.say(null, t(trip.kind === 'home' ? 'meet.leave_home' : 'meet.leave_away', { names: no.join(', ') }));
        st.present = yes;
        for (const n of no) { st.social[n].mood -= 0.1; addRel(st, n, 'left_out'); }
      }
      redraw(trip.kind === 'away' ? 'carpark' : scene); sidePresent();
    }
    st.riders = st.present.slice();
  };

  // taunt / praise / calm, shared by stage 3 and the bar (stage 5)
  Game.talk = async function (ui, st, names, sim, after) {
    const me = st.playerName;
    const who = await ui.dlg.choose(names.map((n) => ({ label: n, value: n, disabled: st.talked.has(n), hint: st.talked.has(n) ? t('talk.already') : '' })).concat([{ label: t('common.back_arrow'), value: null }]), { prompt: t('talk.whom'), cancel: null });
    if (!who) return;
    const route = st.route || (sim && sim.route);
    const s0 = sim ? sim.player.s : 0;
    const nextClimb = route ? route.climbs.find((c) => c.start > s0 + 200) : null;
    const climb = nextClimb ? G.climbName(nextClimb) : null;
    const kinds = ['provoke', 'challenge', 'praise', 'calm'];
    const kind = await ui.dlg.choose(kinds.map((k) => ({ label: t('taunt.' + k + '.label'), value: k, hint: t('taunt.' + k + '.line', V(who, { climb: climb || '—' })), disabled: k === 'challenge' && (!nextClimb || !!st.challenge) })).concat([{ label: t('common.back_arrow'), value: null }]), { prompt: t('talk.what', V(who)), cancel: null });
    if (!kind) return;
    await ui.dlg.say(me, t('taunt.' + kind + '.line', V(who, { climb: climb || '' })), { color: colorOf(me) });
    const p = players().find((x) => x.name === who);
    const state = sim ? sim.riders.find((r) => r.name === who) : st.social[who];
    const res = Social.taunt(p, state, kind, climb, st.perks);
    if (state.challenge && kind === 'challenge' && nextClimb) {
      const ci = route.climbs.indexOf(nextClimb);
      st.challenge = { name: who, climb: ci };
      if (sim) sim.challenge = { rider: state, climb: ci };
    }
    if (res.sport) { if (sim) sim.addSport('taunt_' + kind, res.sport); else st.sport.push({ k: 'taunt_' + kind, pts: res.sport }); }
    if (res.rel) { if (sim) { if (!state.rel.includes(res.rel)) state.rel.push(res.rel); } else addRel(st, who, res.rel); }
    await ui.dlg.say(who, res.text, { color: colorOf(who) });
    if (res.effect) await ui.dlg.say(null, '→ ' + res.effect);
    st.talks++;
    st.talked.add(who);
    if (after) after();
  };

  // ---------------------------------------------------------------- stage 5: bar / feed station
  Game.bar = async function (st, sim, bar, group) {
    const me = sim.player;
    const here = group.members;
    const feed = bar.type === 'feed';
    const name = G.stopName(bar, sim.route);
    const ui = UI.sceneScreen({ tag: t('stage_tag.bar'), title: (feed ? '🍌 ' : '☕ ') + name, sub: t('bar.sub', { time: G.fmtClock(sim.clock()), km: G.fmtKm(bar.at), total: sim.route.km }), side: true });
    G.Art.sceneBar(ui.canvas, here.map((r) => r.look), name, sim.weather, feed, here.map((r) => r.gender));
    ui.overlay.appendChild(el('div', { class: 'bar-sign', text: (feed ? t('bar.feed_sign') : (bar.brief ? G.placeName(bar.place).split(' (')[0] : G.placeName(bar.place) || t('bar.bar_sign'))).toUpperCase() }));
    const paint = () => {
      ui.side.innerHTML = '';
      ui.side.appendChild(el('h4', { text: t('bar.how') }));
      const tbl = el('div', { class: 'cmp' });
      tbl.appendChild(el('div', { class: 'cmp-row head' }, ['', t('bar.col_end'), t('bar.col_spr'), t('bar.col_h2o'), t('bar.col_form')].map((x) => el('span', { text: x }))));
      for (const r of here) {
        tbl.appendChild(el('div', { class: 'cmp-row' + (r.isPlayer ? ' me' : '') }, [
          el('span', { class: 'cmp-name' }, [face(r.name), r.name + (r.isPlayer ? '' : ' ' + moodIcon(r.mood))]),
          UI.bar(r.E, 100, 'end'), UI.bar(r.S, 100, 'spr'), UI.bar(r.H, 100, 'h2o'),
          el('span', { class: 'cmp-form', text: String(Math.round(r.form)) }),
        ]));
      }
      ui.side.appendChild(tbl);
      const away = sim.riders.filter((r) => !here.includes(r));
      if (away.length) ui.side.appendChild(el('div', { class: 'small muted', text: t('bar.elsewhere') + ' ' + away.map((r) => `${r.name} (${t('bar.where_' + (r.status === 'home' ? 'home' : r.status === 'finished' ? 'finished' : r.s > me.s ? 'ahead' : 'behind'))})`).join(', ') }));
      ui.side.appendChild(el('div', { class: 'small', text: t('bar.pockets', { bar: me.food.bar, banana: me.food.banana }) }));
    };
    paint();
    await ui.dlg.say(null, t(feed ? 'bar.intro_feed' : 'bar.intro'));
    for (const r of G.shuffle(here.filter((x) => !x.isPlayer)).slice(0, 3)) await ui.dlg.say(r.name, Social.feeling(r), { color: r.look.jersey });
    const pockets = me.perks.has('pockets') ? 4 : 3;
    let more = false;
    for (;;) {
      const used = me.food.bar + me.food.banana;
      const v = await ui.dlg.choose([
        { label: t('bar.talk'), value: 'talk', disabled: here.length < 2 || st.talks >= 5 },
        feed ? { label: t('bar.grab'), value: 'grab', disabled: used >= pockets, hint: t('bar.pockets_hint', { n: used, max: pockets }) }
          : { label: t('bar.buy'), value: 'buy', disabled: used >= pockets, hint: t('bar.pockets_hint', { n: used, max: pockets }) },
        feed ? null : { label: t('bar.more'), value: 'more', disabled: more },
        { label: t('bar.save'), value: 'save' },
        { label: t('bar.go'), value: 'go' },
      ].filter(Boolean), { prompt: t(feed ? 'bar.prompt_feed' : 'bar.prompt') });
      if (v === 'go') break;
      if (v === 'save') { await Game.saveMenu(st, sim); continue; }
      if (v === 'talk') { await Game.talk(ui, st, here.filter((r) => !r.isPlayer).map((r) => r.name), sim, paint); continue; }
      if (v === 'buy') { me.food.bar++; await ui.dlg.say(null, t('bar.bought')); paint(); continue; }
      if (v === 'grab') {
        while (me.food.bar + me.food.banana < pockets) { if (me.food.bar <= me.food.banana) me.food.bar++; else me.food.banana++; }
        await ui.dlg.say(null, t('bar.grabbed')); paint(); continue;
      }
      if (v === 'more') { more = true; for (const r of here) r.E = Math.min(100, r.E + 5); await ui.dlg.say(null, t('bar.more_done')); paint(); }
    }
    st.talked = new Set();
    return feed ? 5 : more ? 25 : 15;
  };

  // ---------------------------------------------------------------- results + progression
  Game.computeResults = function (st, sim, barMinutes) {
    sim.closeRelations();
    const me = sim.player, route = sim.route;
    const order = sim.riders.slice().sort((a, b) => {
      const ka = a.status === 'home' ? 1e9 + (a.homeT || 0) : a.finishT, kb = b.status === 'home' ? 1e9 + (b.homeT || 0) : b.finishT;
      return ka - kb;
    });
    const dist = me.status === 'home' ? me.s : route.len;
    const moving = me.stats.moving || 1;
    const kj = me.stats.work / 1000;
    const drive = st.trip && st.trip.kind === 'away' ? G.AREAS_DRIVE(st.trip.area) : 0;
    const homeClock = sim.startMin + ((me.finishT || me.homeT || sim.t) / 60) + (barMinutes || 0) + 10 + drive;
    const sportEv = (st.sport || []).concat(sim.sport);
    const sportSum = {};
    for (const e of sportEv) sportSum[e.k] = (sportSum[e.k] || 0) + e.pts;
    const sport = Object.values(sportSum).reduce((a, b) => a + b, 0);
    const rel = [];
    for (const p of players()) {
      if (p.name === me.name) continue;
      const r = sim.riders.find((x) => x.name === p.name);
      const before = st.rel0 && st.rel0[p.name] != null ? st.rel0[p.name] : 0.2;
      let after = r ? r.mood : st.social[p.name].mood;
      const keys = (st.relKeys[p.name] || []).concat(r ? r.rel : []);
      if (r && r.status === 'finished') { after += 0.03; if (!keys.includes('rode_together')) keys.push('rode_together'); }
      rel.push({ n: p.name, before, after: G.clamp(after, -1, 1), keys, rode: !!r });
    }
    const xp = [];
    xp.push(['distance', Math.round(dist / 1000)]);
    xp.push(['climbing', Math.round((route.gain * dist) / route.len / 20)]);
    if (me.stats.kom.length) xp.push(['kom', 15 * me.stats.kom.length, me.stats.kom.join(', ')]);
    if (sim.challenge && sim.challenge.done && sim.challenge.won) xp.push(['challenge', 25]);
    const first = order[0];
    if (me.status === 'finished' && first && first.finishT != null && me.finishT - first.finishT < 20) xp.push(['front', 10]);
    if (me.stats.attacks) xp.push(['attacks', 5 * Math.min(3, me.stats.attacks)]);
    if (sport > 0) xp.push(['sport', sport]);
    if (route.kind === 'epic' && me.status === 'finished') xp.push(['epic', 40]);
    let total = xp.reduce((a, x) => a + x[1], 0);
    if (me.status === 'home') { total = Math.round(total / 2); xp.push(['dnf', 0]); }
    const keep = /[⚡⛰💥☕🏆🚰🍌😡😠🦶🏠]/u;
    const log = sim.feed.filter((f) => f.kind !== 'info' || keep.test(f.text)).slice(-70)
      .map((f) => ({ c: G.fmtClock(sim.startMin + f.t / 60), x: (f.who ? f.who + ': ' : '') + f.text, k: f.kind }));
    st.result = {
      log,
      routeId: route.id, abandoned: me.status === 'home', time: me.finishT, dist, moving, kj, homeClock,
      maxV: me.stats.maxV, pull: me.stats.pull, attacks: me.stats.attacks, falls: me.stats.falls, kom: me.stats.kom.slice(),
      challenge: sim.challenge && sim.challenge.done ? { name: sim.challenge.rider.name, won: sim.challenge.won } : null,
      order: order.map((r) => ({ n: r.name, isPlayer: r.isPlayer, status: r.status, finishT: r.finishT, est: !!r.estimated,
        moving: r.stats.moving, kom: r.stats.kom.length, falls: r.stats.falls, pull: r.stats.pull })),
      xp, total, sport, sportSum, rel, applied: false,
    };
  };

  Game.results = async function (st) {
    const R = st.result, route = G.routeById(R.routeId), me = st.playerName;
    const car = Game.careerOf(me);
    if (!R.applied) {
      R.lvl0 = Social.levelFor(car.xp);
      car.xp += R.total; car.rides++; car.km += R.dist / 1000; car.kom += R.kom.length;
      car.sport = (car.sport || 0) + R.sport;
      if (R.kj > 1200 && car.fitBonus < 10) { car.fitBonus++; R.trained = true; }
      car.rel = car.rel || {};
      for (const x of R.rel) car.rel[x.n] = Math.round(x.after * 100) / 100;
      R.applied = true;
      Game.saveCareerOf(me, car);
      G.Online.recordRide(st);
      Game.checkpoint(st);   // resumable without applying twice
    }
    const lvl1 = Social.levelFor(car.xp);
    const tbl = el('div', { class: 'res-table' }, [el('div', { class: 'res-row head' }, ['#', t('res.rider'), t('res.time'), t('res.avg'), t('res.kom'), t('res.falls'), t('res.pulls')].map((h) => el('span', { text: h })))]);
    R.order.forEach((r, i) => {
      const tm = r.status === 'home' ? t('res.home') : G.fmtDur(r.finishT) + (r.est ? ' ~' : '');
      const spd = r.status === 'home' ? '' : ((route.len / Math.max(1, r.moving || r.finishT)) * 3.6).toFixed(1);
      tbl.appendChild(el('div', { class: 'res-row' + (r.isPlayer ? ' me' : '') }, [
        el('span', { text: r.status === 'home' ? '–' : String(i + 1) }),
        el('span', { class: 'cmp-name' }, [face(r.n), r.n]),
        el('span', { text: tm }), el('span', { text: spd }), el('span', { text: r.kom ? '⛰️' + r.kom : '' }),
        el('span', { text: r.falls ? '💥' + r.falls : '' }), el('span', { text: G.fmtDur(r.pull) }),
      ]));
    });
    const lunch = t(R.homeClock < 14 * 60 ? 'res.lunch_ok' : 'res.lunch_late', { time: G.fmtClock(R.homeClock) });
    const summary = el('div', { class: 'res-summary' }, [
      el('div', { class: 'big-num', text: R.abandoned ? t('res.dnf') : G.fmtDur(R.time) }),
      el('div', { text: t('res.line1', { km: G.fmtKm(R.dist), avg: ((R.dist / R.moving) * 3.6).toFixed(1), max: (R.maxV * 3.6).toFixed(0) }) }),
      el('div', { text: t('res.line2', { w: Math.round((R.kj * 1000) / R.moving), kj: Math.round(R.kj), kcal: Math.round(R.kj * 1.05) }) }),
      el('div', { text: t('res.line3', { pull: G.fmtDur(R.pull), attacks: R.attacks, falls: R.falls }) }),
      el('div', { text: lunch }),
      R.challenge ? el('div', { text: t(R.challenge.won ? 'res.challenge_won' : 'res.challenge_lost', V(R.challenge.name)) }) : null,
    ].filter(Boolean));
    const sportBox = el('div', { class: 'xp-box' }, [
      el('h4', { text: t('res.sport_title') }),
      el('div', { class: 'sport-score ' + (R.sport > 0 ? 'good' : R.sport < 0 ? 'bad' : '') }, [el('b', { text: (R.sport > 0 ? '+' : '') + R.sport }), ' · ' + Social.sportLabel(R.sport)]),
      ...Object.entries(R.sportSum).map(([k, v]) => el('div', { class: 'xp-row' }, [el('span', { text: t('sport.ev.' + k) }), el('span', { text: (v > 0 ? '+' : '') + v })])),
      el('div', { class: 'small muted', text: t('res.sport_career', { n: car.sport || 0 }) }),
    ]);
    const relBox = el('div', { class: 'xp-box' }, [el('h4', { text: t('res.rel_title') })]);
    for (const x of R.rel.slice().sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))) {
      const d = Math.round((x.after - x.before) * 100);
      if (!x.rode && !d) continue;
      relBox.appendChild(el('div', { class: 'rel-row' }, [
        el('span', { class: 'cmp-name' }, [face(x.n), x.n]),
        el('span', { text: moodIcon(x.before) + ' → ' + moodIcon(x.after) }),
        el('span', { class: d > 0 ? 'good' : d < 0 ? 'bad' : 'muted', text: (d > 0 ? '+' : '') + d }),
        el('span', { class: 'small muted rel-why', text: x.keys.map((k) => t('rel.' + k)).join(', ') }),
      ]));
    }
    const xpBox = el('div', { class: 'xp-box' }, [
      el('h4', { text: t('res.xp', { n: R.total }) }),
      ...R.xp.map(([k, v, extra]) => el('div', { class: 'xp-row' }, [el('span', { text: t('xp.' + k) + (extra ? ` (${extra})` : '') }), el('span', { text: v ? '+' + v : '' })])),
      el('div', { class: 'xp-level', text: t('res.level', { n: lvl1 }) + (lvl1 > (R.lvl0 || lvl1) ? '  ' + t('res.levelup') : '') }),
      UI.bar(car.xp - Social.xpFor(lvl1), Social.xpFor(lvl1 + 1) - Social.xpFor(lvl1), 'xp', 'XP'),
      R.trained ? el('div', { class: 'small good', text: t('res.trained') }) : null,
    ].filter(Boolean));
    const perkBox = el('div', { class: 'perk-box' });
    const btns = el('div', { class: 'row' });
    UI.show(el('div', { class: 'stage' }, [
      el('div', { class: 'stage-header' }, [el('span', { class: 'stage-tag', text: t('stage_tag.results') }), el('span', { class: 'stage-title', text: R.abandoned ? t('res.title_dnf') : t('res.title_' + route.kind, { route: route.name }) }), el('span', { class: 'stage-sub', text: `${route.km} km · ${route.gain} m+` })]),
      el('div', { class: 'res-layout' }, [el('div', {}, [summary, tbl, relBox]), el('div', {}, [xpBox, sportBox, perkBox, btns])]),
    ]));
    while (car.perks.length < lvl1 - 1) {
      const avail = G.shuffle(G.PERK_IDS.filter((p) => !car.perks.includes(p))).slice(0, 3);
      if (!avail.length) break;
      const chosen = await new Promise((resolve) => {
        perkBox.innerHTML = '';
        perkBox.appendChild(el('h4', { text: t('res.choose_perk') }));
        avail.forEach((p, i) => {
          const b = el('button', { class: 'perk' }, [el('span', { class: 'kbd', text: String(i + 1) }), el('b', { text: ' ' + t('perks.' + p + '.name') }), el('div', { class: 'small', text: t('perks.' + p + '.desc') })]);
          b.addEventListener('click', () => { UI.popKeys(keys); resolve(p); });
          perkBox.appendChild(b);
        });
        const keys = (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= avail.length) { UI.popKeys(keys); resolve(avail[n - 1]); return true; } return false; };
        UI.pushKeys(keys);
      });
      car.perks.push(chosen);
      Game.saveCareerOf(me, car);
      perkBox.innerHTML = '';
      perkBox.appendChild(el('div', { class: 'good', text: t('res.new_perk', { perk: t('perks.' + chosen + '.name') }) }));
    }
    await new Promise((resolve) => {
      const b = el('button', { class: 'btn primary big', text: t('res.next') });
      b.addEventListener('click', () => { UI.popKeys(keys); resolve(); });
      btns.appendChild(b);
      const keys = (e) => { if (e.key === 'Enter') { UI.popKeys(keys); resolve(); return true; } return false; };
      UI.pushKeys(keys);
    });
  };
})();
