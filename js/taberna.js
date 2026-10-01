// Personal login (online mode) and the "Altzola taberna": who is online and where, who came by
// last, every rider's profile and ride registry, brags and a real-time chat.
// Without config/online.js the tavern shows what this browser knows (local careers and rides).
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const el = G.el, UI = G.UI, t = (k, v) => G.t(k, v);
  const Game = G.Game, Net = G.Net;
  const players = () => window.PLAYERS || [];
  const face = (n, s) => UI.avatar(n, s || 28);

  function ago(ts) {
    if (!ts) return t('tab.never');
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return t('tab.ago_now');
    if (s < 3600) return t('tab.ago_min', { n: Math.round(s / 60) });
    if (s < 86400 * 2) return t('tab.ago_h', { n: Math.round(s / 3600) });
    return t('tab.ago_d', { n: Math.round(s / 86400) });
  }
  const dateStr = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  // ---------------------------------------------------------------- local ride history
  G.LocalRides = {
    all: () => G.store.get('rides', []),
    add(rec) { const a = G.LocalRides.all(); a.unshift(Object.assign({ id: 'L' + Date.now(), ts: Date.now() }, rec)); G.store.set('rides', a.slice(0, 60)); },
  };

  // ---------------------------------------------------------------- hooks used by the game
  const Online = {};
  G.Online = Online;
  // after a successful login: cloud career / save vs this browser, keep the most advanced
  Online.afterLogin = async function () {
    const me = Net.me;
    const local = Game.career()[me];
    const cloud = await Net.getCareer();
    const best = !cloud ? local : !local ? cloud : (cloud.xp || 0) >= (local.xp || 0) ? cloud : local;
    if (best) { const c = Game.career(); c[me] = best; G.store.set('career', c); Net.pushCareer(best); }
    Online.pushProfile();
    const cs = await Net.getSave();
    const ls = G.Save.read('auto');
    if (cs && cs.st && cs.st.playerName === me && (!ls || ls.savedAt < cs.savedAt)) G.store.set('save.auto', cs);
  };
  Online.pushProfile = function (lastRide) {
    if (!Net.me) return;
    const car = Game.careerOf(Net.me);
    const prof = { level: G.Social.levelFor(car.xp), xp: car.xp, rides: car.rides, km: Math.round(car.km), kom: car.kom || 0,
      sport: car.sport || 0, perks: car.perks, fitBonus: car.fitBonus || 0 };
    if (lastRide) prof.lastRide = lastRide;
    Net.pushProfile(prof);
  };
  Online.where = (w, detail) => { if (Net.me) Net.setWhere(w, detail); };
  // ride registry entry, stored locally and (online) in the cloud
  Online.recordRide = function (st) {
    const R = st.result, route = G.routeById(R.routeId);
    const me = R.order.findIndex((x) => x.isPlayer);
    const rec = {
      rider: st.playerName, routeId: route.id, routeName: route.name, kind: route.kind, km: Math.round(R.dist / 100) / 10,
      gain: route.gain, time: R.abandoned ? null : Math.round(R.time), pos: R.abandoned ? null : me + 1, n: R.order.length,
      dnf: R.abandoned, avg: Math.round((R.dist / R.moving) * 36) / 10, xp: R.total, sport: R.sport, kom: R.kom.length,
      falls: R.falls, attacks: R.attacks, date: Date.now(),
      detail: {
        weather: st.weather.id, start: st.startMin || st.departure, trip: st.trip ? st.trip.kind : 'home',
        order: R.order.map((x) => ({ n: x.n, st: x.status, t: x.finishT, kom: x.kom, f: x.falls, p: Math.round(x.pull) })),
        kj: Math.round(R.kj), maxV: Math.round(R.maxV * 36) / 10, pull: Math.round(R.pull), kom: R.kom,
        challenge: R.challenge, sportSum: R.sportSum, rel: R.rel.filter((x) => x.rode || x.after !== x.before).map((x) => ({ n: x.n, d: Math.round((x.after - x.before) * 100), k: x.keys })),
        log: R.log || [],
      },
    };
    G.LocalRides.add(rec);
    const summary = { routeName: rec.routeName, km: rec.km, time: rec.time, pos: rec.pos, n: rec.n, dnf: rec.dnf, date: rec.date };
    if (Net.me) Net.addRide(rec).then((id) => { summary.id = id; Online.pushProfile(summary); }).catch((e) => console.warn('net', e));
  };

  // ---------------------------------------------------------------- login screen
  Game.login = function () {
    return new Promise((resolve) => {
      let sel = Math.max(0, players().findIndex((p) => p.name === G.store.get('lastRider', '')));
      const grid = el('div', { class: 'login-grid' });
      const pw = el('input', { type: 'password', class: 'login-pw', autocomplete: 'current-password', placeholder: t('login.password') });
      const who = el('div', { class: 'login-who' });
      const err = el('div', { class: 'login-err' });
      const go = el('button', { class: 'btn primary big', text: t('login.enter') });
      const cards = players().map((p, i) => {
        const c = el('button', { class: 'login-card' }, [face(p.name, 56), el('span', { text: p.name })]);
        c.addEventListener('click', () => { sel = i; paint(); pw.focus(); });
        grid.appendChild(c);
        return c;
      });
      const paint = () => {
        cards.forEach((c, i) => c.classList.toggle('sel', i === sel));
        who.innerHTML = '';
        who.append(face(players()[sel].name, 72), el('div', {}, [el('div', { class: 'rd-name', text: players()[sel].name }), el('div', { class: 'small muted', text: t('login.hint') })]));
      };
      const submit = async () => {
        go.disabled = true; err.textContent = '…';
        try {
          await Net.login(players()[sel].name, pw.value.trim().toLowerCase());
          G.store.set('lastRider', Net.me);
          err.textContent = '';
          resolve(Net.me);
        } catch (e) {
          err.textContent = /too-many/.test(e.code || '') ? t('login.too_many') : t('login.wrong');
          go.disabled = false;
          pw.select();
        }
      };
      go.addEventListener('click', submit);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      UI.show(el('div', { class: 'stage' }, [
        el('div', { class: 'stage-header' }, [el('span', { class: 'stage-tag', text: '🔑' }), el('span', { class: 'stage-title', text: t('login.title') }), el('span', { class: 'stage-sub', text: t('login.sub') })]),
        el('div', { class: 'login-layout' }, [grid, el('div', { class: 'login-side' }, [who, pw, go, err])]),
      ]));
      paint();
      pw.focus();
    });
  };

  // ---------------------------------------------------------------- the tavern
  Game.taberna = function () {
    return new Promise((resolve) => {
      const online = !!Net.me;
      const unsub = [];
      let presence = {}, profiles = {}, chat = [];
      const ui = UI.sceneScreen({ tag: '🍺', title: t('tab.title'), sub: online ? '' : t('tab.offline'), side: true });
      ui.root.classList.add('taberna-stage');
      const list = el('div', { class: 'tab-riders' });
      const pane = el('div', { class: 'tab-pane' });
      ui.side.replaceWith(el('div', { class: 'tab-right' }, [pane]));
      ui.dlg.el.replaceWith(el('div', { class: 'tab-bottom' }, [list]));
      ui.overlay.appendChild(el('div', { class: 'bar-sign taberna-sign', text: 'ALTZOLA' }));
      const back = el('button', { class: 'hbtn', text: t('tab.leave') });
      back.addEventListener('click', () => leave());
      ui.header.appendChild(back);
      const keys = (e) => { if (e.key === 'Escape') { leave(); return true; } return false; };
      UI.pushKeys(keys);
      function leave() { unsub.forEach((f) => f()); clearInterval(tick); UI.popKeys(keys); Online.where('menu'); resolve(); }

      const isOn = (n) => { const p = presence[Net.key(n)]; return !!(p && p.online && Date.now() - (p.last || 0) < 6 * 3600e3); };
      const drawScene = () => {
        const here = players().filter((p) => isOn(p.name) && presence[Net.key(p.name)].where === 'taberna');
        G.Art.sceneTaberna(ui.canvas, here.map((p) => p.look), here.map((p) => p.gender));
        ui.header.querySelector('.stage-sub').textContent = online ? t('tab.sub', { on: players().filter((p) => isOn(p.name)).length, here: here.length }) : t('tab.offline');
      };
      const whereText = (p) => {
        const pr = presence[Net.key(p.name)];
        if (!pr) return t('tab.never_seen');
        if (isOn(p.name)) {
          const d = pr.detail ? ` · ${pr.detail}` : '';
          return '🟢 ' + t('tab.where.' + (pr.where || 'menu')) + d;
        }
        return '⚪ ' + t('tab.last_seen', { ago: ago(pr.last) });
      };
      const paintList = () => {
        list.innerHTML = '';
        const sorted = players().slice().sort((a, b) => (isOn(b.name) - isOn(a.name)) || ((presence[Net.key(b.name)] || {}).last || 0) - ((presence[Net.key(a.name)] || {}).last || 0));
        for (const p of sorted) {
          const k = Net.key(p.name), pr = presence[k] || {}, prof = profiles[k] || {};
          const lr = prof.lastRide;
          const row = el('button', { class: 'tab-rider' + (isOn(p.name) ? ' on' : '') + (p.name === Net.me ? ' me' : '') }, [
            face(p.name, 36),
            el('div', { class: 'tr-main' }, [
              el('div', { class: 'tr-name' }, [p.name, prof.level ? el('span', { class: 'tr-lvl', text: t('tab.lv', { n: prof.level }) }) : null].filter(Boolean)),
              el('div', { class: 'tr-line', text: online ? whereText(p) : '' }),
              el('div', { class: 'tr-line muted', text: (pr.taberna ? '🍺 ' + ago(pr.taberna) + '  ' : '') + (lr ? `🚴 ${lr.routeName} · ${dateStr(lr.date)}` : '') }),
            ]),
          ]);
          row.addEventListener('click', () => showProfile(p.name));
          list.appendChild(row);
        }
      };

      // ---- chat
      const msgs = el('div', { class: 'tab-msgs' });
      const input = el('input', { type: 'text', class: 'tab-input', maxlength: '500', placeholder: t('tab.say') });
      const send = el('button', { class: 'btn primary', text: t('tab.send') });
      const bragBtn = el('button', { class: 'btn', text: t('tab.brag_last') });
      const statsBtn = el('button', { class: 'btn', text: t('tab.show_stats') });
      const chatBox = el('div', { class: 'tab-chat' }, [
        el('div', { class: 'p-title', text: t('tab.chat') }), msgs,
        online ? el('div', { class: 'tab-say' }, [input, send]) : el('div', { class: 'small muted', text: t('tab.chat_offline') }),
        online ? el('div', { class: 'row' }, [bragBtn, statsBtn]) : null,
      ].filter(Boolean));
      const doSend = () => { const v = input.value.trim(); if (!v) return; Net.sendChat(v).catch(() => UI.toast(t('tab.send_fail'))); input.value = ''; };
      send.addEventListener('click', doSend);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); e.stopPropagation(); });
      bragBtn.addEventListener('click', async () => {
        const rides = await Net.getRides(Net.me, 1);
        if (!rides.length) { UI.toast(t('tab.no_rides')); return; }
        brag(rides[0]);
      });
      statsBtn.addEventListener('click', () => {
        const car = Game.careerOf(Net.me);
        Net.sendChat(t('tab.stats_line', { lvl: G.Social.levelFor(car.xp), rides: car.rides, km: Math.round(car.km), kom: car.kom || 0, sport: car.sport || 0 }), { kind: 'stats' });
      });
      function brag(r) {
        const line = r.dnf ? t('tab.brag_dnf', { route: r.routeName }) : r.pos === 1 ? t('tab.brag_win', { route: r.routeName, time: G.fmtDur(r.time), avg: r.avg })
          : t('tab.brag', { route: r.routeName, pos: r.pos, n: r.n, time: G.fmtDur(r.time), avg: r.avg, km: r.km });
        Net.sendChat(line, { kind: 'brag', ride: r.id, rk: Net.key(Net.me) }).then(() => showChat()).catch(() => UI.toast(t('tab.send_fail')));
      }
      const paintChat = () => {
        const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
        msgs.innerHTML = '';
        for (const m of chat) {
          const p = players().find((x) => Net.key(x.name) === m.k);
          const name = p ? p.name : m.n;
          const body = [el('div', { class: 'tm-head' }, [el('b', { text: name, style: { color: G.lookOf(name).jersey } }), el('span', { class: 'muted', text: ' · ' + ago(m.ts) })]), el('div', { class: 'tm-text', text: m.text })];
          if (m.kind === 'brag' && m.ride) {
            const b = el('button', { class: 'btn small', text: t('tab.see_ride') });
            b.addEventListener('click', () => openRide(name, m.ride));
            body.push(b);
          }
          msgs.appendChild(el('div', { class: 'tab-msg' + (m.kind ? ' ' + m.kind : '') + (name === Net.me ? ' mine' : '') }, [face(name, 30), el('div', {}, body)]));
        }
        if (atBottom || !msgs.dataset.init) { msgs.scrollTop = msgs.scrollHeight; msgs.dataset.init = 1; }
      };
      const showChat = () => { pane.innerHTML = ''; pane.appendChild(chatBox); msgs.scrollTop = msgs.scrollHeight; };

      // ---- profile + registry
      async function showProfile(name) {
        const p = G.playerByName(name);
        const k = Net.key(name);
        const prof = profiles[k] || {};
        let car = null;
        if (online) { try { car = await Net.getCareerOf(name); } catch (e) { car = null; } }
        if (!car) car = Game.career()[name] || null;
        car = Object.assign({ xp: 0, perks: [], rides: 0, km: 0, kom: 0, sport: 0, rel: {}, fitBonus: 0 }, car || prof);
        const lvl = G.Social.levelFor(car.xp || 0);
        const box = el('div', { class: 'tab-profile' });
        const closeB = el('button', { class: 'hbtn', text: t('tab.back_chat') });
        closeB.addEventListener('click', showChat);
        const stats = G.STAT_KEYS.map((s) => UI.bar(s === 'fitness' ? Math.min(100, p.fitness + (car.fitBonus || 0)) : p[s], 100, 'st-' + s, t('stats.' + s + '.short')));
        const rel = Object.entries(car.rel || {}).filter(([n]) => G.playerByName(n)).sort((a, b) => b[1] - a[1]);
        const relLine = (arr) => arr.map(([n, v]) => `${n} ${Game.moodIcon(v)}`).join(', ');
        box.append(...[
          el('div', { class: 'row' }, [closeB]),
          el('div', { class: 'rd-head' }, [face(name, 96), el('div', {}, [
            el('div', { class: 'rd-name', text: name }), el('div', { class: 'rd-tag', text: Game.tagline(p) }),
            el('div', { class: 'xp-level', text: t('res.level', { n: lvl }) + ' · ' + G.Social.sportLabel(car.sport || 0) }),
          ])]),
          el('div', { class: 'tab-facts' }, [
            el('span', { text: t('tab.f_rides', { n: car.rides || 0 }) }), el('span', { text: t('tab.f_km', { n: Math.round(car.km || 0) }) }),
            el('span', { text: t('tab.f_kom', { n: car.kom || 0 }) }), el('span', { text: t('tab.f_sport', { n: car.sport || 0 }) }), el('span', { text: `${p.weight} kg` }),
          ]),
          el('div', { class: 'rc-stats' }, stats),
          (car.perks || []).length ? el('div', { class: 'rd-perks', text: t('select.perks') + ' ' + car.perks.map((id) => t('perks.' + id + '.name')).join(', ') }) : null,
          rel.length ? el('div', { class: 'small', text: t('tab.friends') + ' ' + relLine(rel.slice(0, 3)) }) : null,
          rel.length > 3 ? el('div', { class: 'small', text: t('tab.enemies') + ' ' + relLine(rel.slice(-2).reverse()) }) : null,
          el('h4', { text: t('tab.history') }),
        ].filter(Boolean));
        const hist = el('div', { class: 'tab-hist', text: '…' });
        box.appendChild(hist);
        pane.innerHTML = ''; pane.appendChild(box);
        let rides = [];
        try { rides = online ? await Net.getRides(name, 40) : G.LocalRides.all().filter((r) => r.rider === name); } catch (e) { rides = []; }
        hist.innerHTML = '';
        if (!rides.length) hist.textContent = t('tab.no_rides_yet');
        for (const r of rides) {
          const b = el('button', { class: 'tab-ride' }, [
            el('span', { class: 'muted', text: dateStr(r.ts || r.date) }), el('b', { text: r.routeName }),
            el('span', { text: `${r.km} km` }), el('span', { text: r.dnf ? 'DNF' : `${G.fmtDur(r.time)} · ${r.pos}/${r.n}` }),
            el('span', { text: (r.kom ? '⛰️' + r.kom + ' ' : '') + (r.falls ? '💥' + r.falls : '') }),
          ]);
          b.addEventListener('click', () => (online ? openRide(name, r.id) : registry(name, r)));
          hist.appendChild(b);
        }
      }
      async function openRide(name, id) {
        const r = await Net.getRide(name, id);
        if (!r) { UI.toast(t('tab.ride_gone')); return; }
        registry(name, r);
      }
      async function registry(name, r) {
        const d = r.detail || {};
        const rows = (d.order || []).map((o, i) => el('div', { class: 'res-row' + (o.n === name ? ' me' : '') }, [
          el('span', { text: o.st === 'home' ? '–' : String(i + 1) }), el('span', { class: 'cmp-name' }, [face(o.n, 18), o.n]),
          el('span', { text: o.st === 'home' ? t('res.home') : G.fmtDur(o.t) }), el('span', { text: o.kom ? '⛰️' + o.kom : '' }),
          el('span', { text: o.f ? '💥' + o.f : '' }), el('span', { text: G.fmtDur(o.p || 0) }),
        ]));
        const body = [
          el('div', { class: 'reg-sum' }, [
            el('div', { text: `${dateStr(r.ts || r.date)} · ${t('weather.' + (d.weather || 'mild'))} · ${G.fmtClock(d.start || 510)}` }),
            el('div', { text: r.dnf ? t('res.title_dnf') : t('tab.reg_line', { time: G.fmtDur(r.time), pos: r.pos, n: r.n, km: r.km, avg: r.avg }) }),
            el('div', { text: t('tab.reg_line2', { kj: d.kj || 0, max: d.maxV || 0, pull: G.fmtDur(d.pull || 0), xp: r.xp, sport: r.sport }) }),
            d.challenge ? el('div', { text: t(d.challenge.won ? 'res.challenge_won' : 'res.challenge_lost', { n: d.challenge.name }) }) : null,
          ].filter(Boolean)),
          el('div', { class: 'res-table' }, [el('div', { class: 'res-row head' }, ['#', t('res.rider'), t('res.time'), t('res.kom'), t('res.falls'), t('res.pulls')].map((h) => el('span', { text: h })))].concat(rows)),
          (d.rel || []).length ? el('div', { class: 'small' }, [el('b', { text: t('res.rel_title') + ': ' }), d.rel.map((x) => `${x.n} ${x.d > 0 ? '+' : ''}${x.d}`).join(' · ')]) : null,
          (d.log || []).length ? el('div', { class: 'reg-log' }, d.log.map((l) => el('div', { class: 'log-line ' + (l.k || '') }, [el('span', { class: 'log-t', text: l.c }), el('span', { text: l.x })]))) : null,
        ].filter(Boolean);
        const buttons = [{ label: t('common.ok'), value: 'ok' }];
        if (online && name === Net.me && r.id) buttons.unshift({ label: t('tab.brag_this'), value: 'brag' });
        const v = await UI.modal(`📜 ${r.routeName} — ${name}`, body, buttons, { cancel: 'ok', kind: 'registry' });
        if (v === 'brag') brag(r);
      }

      // ---- live data
      const tick = setInterval(() => { paintList(); if (chat.length) paintChat(); }, 30000);
      if (online) {
        Online.where('taberna');
        Net.markTaberna();
        unsub.push(Net.watchPresence((v) => { presence = v; paintList(); drawScene(); }));
        unsub.push(Net.watchProfiles((v) => { profiles = v; paintList(); }));
        unsub.push(Net.watchChat((v) => { chat = v; paintChat(); }));
      } else {
        const car = Game.career();
        for (const p of players()) if (car[p.name]) profiles[Net.key(p.name)] = car[p.name];
      }
      drawScene(); paintList(); showChat();
    });
  };
})();
