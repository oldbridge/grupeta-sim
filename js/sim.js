// Ride simulation: physics, physiology, group dynamics and rider AI.
// DOM-free on purpose (tested headless with node, and a later port to the GBC should only need
// this file translated).  Units: metres, seconds, watts.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const t = (k, v) => G.t(k, v);

  const BIKE = 9, GRAV = 9.81, CRR = 0.005, RHO = 1.18, CDA = 0.36;
  const DRAFT = 0.64;         // aero share paid on a wheel
  const SLOT_GAP = 2.0;       // metres between pairs in a group

  G.PACES = [0.50, 0.64, 0.76, 0.88, 1.00].map((f, i) => ({ f, id: ['recovery', 'steady', 'tempo', 'hard', 'threshold'][i] }));
  G.paceName = (i) => t('pace.' + G.PACES[i].id);

  // ---------------------------------------------------------------- physics
  // r: rider (mass, cda); crr: rolling resistance of the surface
  function resist(v, grade, draft, r, crr) {
    const th = Math.atan(grade), M = r.mass + BIKE;
    return M * GRAV * ((crr || CRR) * Math.cos(th) + Math.sin(th)) * v + 0.5 * RHO * r.cda * draft * v * v * v;
  }
  function speedFor(P, grade, draft, r, crr) {
    let lo = 0, hi = 26;
    P = Math.max(0, P);
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (resist(mid, grade, draft, r, crr) > P) hi = mid; else lo = mid;
    }
    return lo;
  }
  G.physics = { resist, speedFor };
  const slotOffset = (k) => Math.floor(k / 2) * SLOT_GAP + (k % 2) * 0.6;
  G.slotOffset = slotOffset;

  // ---------------------------------------------------------------- rider
  class Rider {
    constructor(p, id, opt) {
      opt = opt || {};
      this.id = id;
      this.name = p.name;
      this.gender = p.gender || 'm';
      this.st = {
        endurance: p.endurance, sprint: p.sprint, fitness: p.fitness,
        competitiveness: p.competitiveness, clumsiness: p.clumsiness,
      };
      this.mass = p.weight || 70;
      this.cda = CDA * Math.pow(this.mass / 75, 0.66);
      this.isPlayer = !!opt.player;
      this.perks = new Set(opt.perks || []);
      this.look = G.lookOf(p.name, id);
      this.form = G.clamp(p.fitness + (opt.formDelta || 0), 5, 100);
      // threshold power: fitness sets W/kg for a 70 kg rider; heavier riders push more watts
      // but fewer watts per kilo (allometric exponent 0.6)
      this.ftpW = (1.5 + (this.form / 100) * 2.5) * 70 * Math.pow(this.mass / 70, 0.6);
      this.wcap = (100 + 2 * p.sprint) * this.mass * (this.perks.has('kick') ? 1.2 : 1);   // J
      this.wbal = this.wcap;
      this.E = 100; this.S = 100; this.H = 100; this.digest = 0;
      this.food = Object.assign({ bar: 1, banana: 1 }, opt.food || {});
      this.bidons = opt.bidons || 1;
      this.sips = this.bidons * 4;
      this.s = 0; this.P = 0; this.g = null;
      this.status = 'riding';                // riding | fallen | home | finished
      this.mode = 'normal';                  // normal | attack | break | chase | tempo
      this.modeT = 0;
      const c = p.competitiveness / 100;
      this.aggr = G.clamp(c * 0.6 + G.randf(-0.05, 0.12), 0, 1);
      this.relayWill = G.clamp(0.85 - c * 0.15 + G.randf(-0.1, 0.1), 0, 1);
      this.mood = 0.2;                       // towards the player, -1..1
      this.rival = false;
      this.paceBias = G.randf(-0.03, 0.03);
      this.annoy = 0;
      this.attackCd = G.randf(120, 400);
      this.shoutCd = 0;
      this.fallT = 0; this.injured = false;
      this.pace = 1; this.relay = true; this.leading = false;   // player controls
      this.finishT = null; this.homeT = null;
      this.stats = { work: 0, pull: 0, maxV: 0, falls: 0, attacks: 0, kom: [], moving: 0, eaten: 0, drunk: 0, groupT: 0, groupN: 0 };
      this.rel = [];                         // what the player did to / for this rider (keys)
      this.decideT = G.randf(0, 5);
      this.bonked = false;
    }
    get ftp() { return this.ftpW / this.mass; }
    // sustainable power right now: drops steeply as the endurance bar empties
    get cp() {
      let f = this.E >= 40 ? 1 : 0.4 + 0.6 * Math.pow(this.E / 40, 0.8);
      if (this.H < 30) f *= 0.8 + 0.2 * (this.H / 30);
      if (this.injured) f *= 0.85;
      return this.ftpW * f;
    }
    // most a rider can push to hold a wheel: above cp only while the sprint bar lasts,
    // and never when bonked (no glycogen, no anaerobic reserve)
    get maxFollow() { return this.wbal > 2 && !this.bonked ? this.cp * 1.6 : this.cp * 1.01; }
    get attackP() { return this.cp * (1.45 + (this.st.sprint / 100) * 0.85); }
    get active() { return this.status === 'riding' || this.status === 'fallen'; }
    toJSON() {
      const o = {};
      for (const k of Object.keys(this)) {
        if (k === 'g' || k === 'look' || k[0] === '_') continue;
        o[k] = k === 'perks' ? [...this.perks] : this[k];
      }
      return o;
    }
    static fromJSON(o) {
      const r = Object.create(Rider.prototype);
      Object.assign(r, o);
      r.perks = new Set(o.perks || []);
      r.look = G.lookOf(r.name, r.id);
      r.g = null;
      return r;
    }
  }
  G.Rider = Rider;

  // ---------------------------------------------------------------- simulation
  class Sim {
    constructor(route, riders, opt) {
      opt = opt || {};
      this.route = route;
      this.riders = riders;
      this.player = riders.find((r) => r.isPlayer);
      this.weather = opt.weather || G.WEATHER[1];
      this.startMin = opt.startMin || 8 * 60 + 30;
      this.t = 0;
      this.gid = 1;
      this.feed = [];
      this.pending = null;
      this.attackAlert = null;
      this.challenge = opt.challenge || null;   // {rider, climb, done, won}
      this.climbFirst = route.climbs.map(() => null);
      this.groups = [];
      this.barsDone = new Set();
      this.coffeeAskCd = 0;
      this.lastShout = -999;
      this.finished = false;
      this.sport = [];                          // sportiveness events {k, pts}
      for (const r of riders) r.mood0 = r.mood;
      const g = this._newGroup(riders.slice(), 0, 0);
      g.members.sort((a, b) => b.relayWill * b.ftp - a.relayWill * a.ftp);
      this._resetSlots(g);
    }
    get crr() { return this.route.surface === 'cobbles' ? 0.008 : CRR; }

    // ---- bookkeeping
    _newGroup(members, s, v) {
      const g = { id: this.gid++, members: [], s, v, pullT: G.randf(40, 90), wait: 0, waitFor: null, waitReason: '',
        stopBar: -1, barT: 0, fallen: false, lastS: s, noMergeT: 0, footDown: null };
      for (const m of members) this._join(g, m);
      this.groups.push(g);
      return g;
    }
    _join(g, r, front) {
      if (r.g && r.g !== g) this._leave(r);
      if (front) g.members.unshift(r); else g.members.push(r);
      r.g = g;
    }
    _leave(r) {
      const g = r.g;
      if (!g) return;
      g.members.splice(g.members.indexOf(r), 1);
      r.g = null;
      if (!g.members.length) this.groups.splice(this.groups.indexOf(g), 1);
    }
    _resetSlots(g) { g.members.forEach((m, k) => { m.s = g.s - slotOffset(k); }); }
    say(r, text, kind) { this.feed.push({ t: this.t, text, kind: kind || 'say', who: r ? r.name : null, rider: r }); }
    log(text, kind) { if (text) this.feed.push({ t: this.t, text, kind: kind || 'info' }); }
    clock() { return this.startMin + this.t / 60; }
    sortedGroups() { return this.groups.slice().sort((a, b) => b.s - a.s); }
    timeGap(sAhead, sBehind, v) { return (sAhead - sBehind) / Math.max(3, v || 0); }
    addSport(k, pts) { this.sport.push({ k, pts }); }
    relate(r, key, d) {
      if (!r || r.isPlayer) return;
      r.mood = G.clamp(r.mood + d, -1, 1);
      if (!r.rel.includes(key)) r.rel.push(key);
    }
    v(r) { return { n: r.name, g: r.gender }; }

    willing(m) {
      if (m.isPlayer) return m.relay || m.leading;
      return m.relayWill > 0.35 && m.E > 18 && m.mode === 'normal';
    }

    // ---- main step
    step(dt) {
      if (this.pending || this.finished) return;
      this.t += dt;
      if (this.attackAlert && this.t - this.attackAlert.t > 8) this.attackAlert = null;
      this.coffeeAskCd -= dt;

      for (const r of this.riders) {
        if (r.status === 'fallen') {
          r.fallT -= dt;
          if (r.fallT <= 0) this._getUp(r);
        }
        if (r.modeT > 0) {
          r.modeT -= dt;
          if (r.mode === 'attack' && (r.modeT <= 0 || r.wbal < r.wcap * 0.06)) {
            r.mode = r.isPlayer ? 'normal' : 'break';
            r.modeT = r.isPlayer ? 0 : G.randf(90, 360);
          } else if (r.modeT <= 0) { r.mode = 'normal'; }
        }
        if (r.mode !== 'normal' && r.bonked) { r.mode = 'normal'; r.modeT = 0; }
        if (r.status === 'riding' && !r.isPlayer) {
          r.decideT -= dt;
          if (r.decideT <= 0) { r.decideT += 5; this._decideAI(r); }
        }
        if (r.shoutCd > 0) r.shoutCd -= dt;
      }
      if (this.pending) return;

      const drops = [];
      for (const g of this.groups.slice()) this._groupStep(g, dt, drops);
      for (const [g, m, k] of drops) this._drop(g, m, k);
      this._merge();

      for (const r of this.riders) if (r.active) this._body(r, dt);
      const me = this.player;
      if (me.g && me.g.members.length > 1 && me.g.v > 1) { me.stats.groupT += dt; me.stats.groupN += me.g.members.length * dt; }
      this._crashes(dt);
      this._crossings();
      this._finishLine();
    }

    _finishLine() {
      for (const g of this.groups.slice()) {
        if (g.s < this.route.len) continue;
        // sprint for the line: sprinters with something left win the group finish
        const order = g.members.slice().sort((a, b) => this._sprintScore(b) - this._sprintScore(a));
        order.forEach((m, k) => {
          m.status = 'finished'; m.finishT = this.t + k * 0.4; m.s = this.route.len; m.P = 0;
          this._leave(m);
          if (m.isPlayer) {
            this.finished = true;
            if (k === 0 && order.length > 1) this.log(t('log.won_sprint'), 'good');
            this.log(t('log.back_home', { place: this.route.kind === 'home' ? 'Irun' : this.route.areaName }), 'good');
          }
        });
      }
    }
    _sprintScore(r) {
      const want = r.isPlayer ? (r.mode === 'attack' ? 1.3 : 0.9) : 0.6 + r.st.competitiveness / 250;
      return (r.st.sprint / 100 + 0.3) * (0.4 + r.S / 160) * want * (r.E > 15 ? 1 : 0.5) * G.randf(0.85, 1.15);
    }

    _groupStep(g, dt, drops) {
      const route = this.route;
      g.lastS = g.s;
      if (g.noMergeT > 0) g.noMergeT -= dt;
      if (g.fallen) { g.v = 0; for (const m of g.members) m.P = 0; return; }
      if (g.barT > 0) {
        g.v = 0;
        g.barT -= dt;
        for (const m of g.members) m.P = 0;
        if (g.barT <= 0) { g.barT = 0; g.stopBar = -1; if (g.members.includes(this.player)) this.log(t('log.back_on_bikes')); }
        return;
      }
      const grade = route.gradeAt(g.s);
      this._rotate(g, dt, grade);
      const lead = g.members[0];
      const Pl = this._leadPower(lead, g, grade);
      let vt = Math.min(speedFor(Pl, grade, 1, lead, this.crr), this._brakeCap(g));
      if (g.wait > 0) {
        vt = 0;
        g.wait -= dt;
        if (!g.footDown && (g.wait <= 0 || this._waitDone(g))) {
          g.wait = 0; g.waitFor = null;
          if (g.members.includes(this.player)) this.log(t('log.group_rides_on'));
        }
      }
      if (g.stopBar >= 0) {
        const bar = route.bars[g.stopBar];
        if (g.s >= bar.at - 0.5) { this._arriveBar(g, g.stopBar); return; }
        const toBar = bar.at - g.s;
        if (toBar < 60) vt = Math.min(vt, Math.max(1.5, toBar / 6));
      }
      const tau = vt > g.v ? 5 : 2.5;
      g.v += (vt - g.v) * Math.min(1, dt / tau);
      if (g.v < 0.05) g.v = 0;
      g.members.forEach((m, k) => {
        const draft = k === 0 ? 1 : m.perks.has('wheel') ? DRAFT * 0.9 : DRAFT;
        let P = g.v > 0.3 ? Math.max(0, resist(g.v, grade, draft, m, this.crr)) : 0;
        if (k === 0 && g.v < vt - 0.2) P = Math.max(P, Pl);
        if (m.perks.has('goat') && grade > 0.05) P /= 1.05;
        if (k > 0 && g.v > 1.5 && g.wait <= 0 && P > m.maxFollow) drops.push([g, m, k]);
        m.P = P;
        if (k === 0 && g.members.length > 1) m.stats.pull += dt;
      });
      g.s += g.v * dt;
      g.members.forEach((m, k) => {
        m.s = g.s - slotOffset(k);
        m.stats.maxV = Math.max(m.stats.maxV, g.v);
        if (g.v > 1) m.stats.moving += dt;
      });
    }

    _rotate(g, dt, grade) {
      if (g.members.length < 2) return;
      g.pullT -= dt;
      const lead = g.members[0];
      if (['attack', 'break', 'chase', 'tempo'].includes(lead.mode)) return;
      if (lead.isPlayer && lead.leading) {
        if (!lead.relay) return;
        if (g.pullT > 0) return;
      }
      if (g.pullT > 0 && this.willing(lead)) return;
      const rest = g.members.slice(1);
      let next = rest.find((m) => ['chase', 'tempo', 'attack'].includes(m.mode)) || rest.find((m) => this.willing(m));
      if (!next) {
        if (this.willing(lead)) { g.pullT = G.randf(40, 80); return; }
        const ai = rest.filter((m) => !m.isPlayer && m.E > 12 && m.mode === 'normal');
        if (!ai.length) { g.pullT = 30; return; }
        next = ai.reduce((a, b) => (a.st.competitiveness + a.form > b.st.competitiveness + b.form ? a : b));
        if (this.player.g === g && !this.player.relay) next.annoy += 0.15;
      }
      if (lead.isPlayer) lead.leading = false;
      g.members.splice(g.members.indexOf(next), 1);
      g.members.splice(g.members.indexOf(lead), 1);
      let pos = g.members.length;
      if (this.willing(lead)) while (pos > 0 && !this.willing(g.members[pos - 1])) pos--;
      g.members.splice(pos, 0, lead);
      g.members.unshift(next);
      g.pullT = grade > 0.04 ? G.randf(60, 140) : G.randf(40, 90);
    }

    _leadPower(r, g, grade) {
      if (r.mode === 'attack') return r.attackP;
      if (r.isPlayer) return Math.min(G.PACES[r.pace].f * r.ftpW, r.cp * (r.pace === 4 ? 1.0 : 0.99));
      if (r.mode === 'break' || r.mode === 'chase') return r.cp * 0.97;
      if (r.mode === 'tempo') return r.cp * 0.9;
      if (grade < -0.03) return r.ftpW * 0.2;
      const f = 0.58 + 0.22 * r.aggr + r.paceBias + (grade > 0.035 ? 0.1 : 0) - (r.E < 40 ? 0.1 : 0);
      let P = Math.min(f * r.ftpW, r.cp * 0.96);
      // friendly riders keep the group together: no faster than the weakest can follow on a wheel
      if (g.members.length > 1 && r.aggr < 0.5) {
        let vmin = Infinity;
        for (const m of g.members) {
          if (m === r) continue;
          vmin = Math.min(vmin, speedFor(m.cp * 0.86, grade, DRAFT, m, this.crr));
        }
        P = Math.min(P, Math.max(resist(vmin, grade, 1, r, this.crr), r.ftpW * 0.35));
      }
      return P;
    }

    _brakeCap(g) {
      let cap = 99;
      for (const m of g.members) {
        let c = 15 * (1 - m.st.clumsiness / 500) * (this.weather.id === 'drizzle' ? 0.86 : 1) * (m.bonked ? 0.8 : 1);
        if (m.perks.has('descender')) c *= 1.1;
        cap = Math.min(cap, c);
      }
      return cap;
    }

    _waitDone(g) {
      if (!g.waitFor) return false;
      return [...g.waitFor].every((r) => r.g === g || r.status === 'home' || r.status === 'finished');
    }

    _drop(g, m) {
      if (m.g !== g) return;
      this._leave(m);
      const tail = this.groups.includes(g) ? g.s - slotOffset(g.members.length - 1) : g.s;
      const ng = this._newGroup([m], tail - 2.5, g.v * 0.97);
      ng.noMergeT = 20;
      if (m.isPlayer) {
        m.leading = false;
        this.log(t(m.bonked ? 'log.you_dropped_bonk' : 'log.you_dropped'), 'bad');
      } else {
        this.log(t('log.dropped', this.v(m)), this.player.g === g ? 'warn' : 'info');
        if (m.aggr > 0.5 && m.wbal > m.wcap * 0.3 && !m.bonked) { m.mode = 'chase'; m.modeT = 60; }
      }
    }

    _merge() {
      // a moving group that reached a stopped one during this step (it may have jumped past
      // it at high speed) is put right behind it, so it joins the stop below
      const stoppedGs = this.groups.filter((g) => !g.fallen && g.v < 0.5 && (g.wait > 0 || g.barT > 0));
      for (const S of stoppedGs) {
        const tail = S.s - slotOffset(S.members.length - 1);
        for (const B of this.groups) {
          if (B === S || B.fallen || B.v < 0.5) continue;
          if (B.lastS <= tail && B.s > tail - 1.0) { B.s = tail - 0.8; B.v = Math.min(B.v, 2); this._resetSlots(B); }
        }
      }
      const gs = this.sortedGroups().filter((g) => !g.fallen);
      for (let i = 0; i < gs.length - 1; i++) {
        const A = gs[i], B = gs[i + 1];
        if (!this.groups.includes(A) || !this.groups.includes(B)) continue;
        const gap = A.s - slotOffset(A.members.length - 1) - B.s;
        if (gap > 1.2) continue;
        const stopped = A.barT > 0 || A.wait > 0;
        if (!stopped && (A.noMergeT > 0 || B.noMergeT > 0)) continue;
        const bl = B.members[0];
        const overtakes = B.v > A.v + 0.4 && !stopped &&
          (['attack', 'break', 'chase', 'tempo'].includes(bl.mode) || (bl.isPlayer && bl.leading));
        const ms = B.members.slice();
        for (const m of ms) this._leave(m);
        if (overtakes) {
          for (let k = ms.length - 1; k >= 0; k--) this._join(A, ms[k], true);
          A.s = Math.max(A.s, B.s);
          A.v = Math.max(A.v, B.v * 0.9);
          A.pullT = Math.max(A.pullT, 30);
        } else {
          for (const m of ms) this._join(A, m);
          if (A.barT > 0) this._barEffects(ms, this.route.bars[A.lastBar] || { type: 'bar' });
          if (A.footDown) this._footArrivals(A, ms);
        }
        if (B.stopBar >= 0 && A.stopBar < 0 && A.barT <= 0) A.stopBar = B.stopBar;
        if (ms.includes(this.player) && !overtakes) this.log(t('log.in_group', { n: A.members.length }), 'info');
        gs.splice(i + 1, 1);
        i--;
      }
    }

    // ---- physiology
    _body(r, dt) {
      const P = r.P;
      const IF = Math.max(0, P / r.ftpW);
      let rate = 0.028 * Math.pow(IF, 2.2) / (0.6 + r.st.endurance / 100) + 0.0012;
      if (r.perks.has('diesel')) rate *= 0.9;
      r.E -= rate * dt;
      const rel = Math.min(r.digest, 0.045 * dt);
      r.digest -= rel; r.E += rel;
      r.E = G.clamp(r.E, 0, 100);
      const cp = r.cp;
      if (P > cp) r.wbal -= (P - cp) * dt;
      else r.wbal += (cp - P) * dt * 0.45 * (r.bonked ? 0.3 : 1);
      r.wbal = G.clamp(r.wbal, 0, r.wcap);
      r.S = (r.wbal / r.wcap) * 100;
      r.H -= (0.0032 + 0.006 * IF * IF) * this.weather.heat * dt * (r.perks.has('camel') ? 0.75 : 1);
      r.H = G.clamp(r.H, 0, 100);
      r.stats.work += P * dt;
      if (r.E < 5 && !r.bonked) {
        r.bonked = true;
        if (r.isPlayer) this.log(t('log.you_bonk'), 'bad');
        else this.say(r, t('shout.bonk', this.v(r)), 'bad');
      }
      if (r.E > 18) r.bonked = false;
      if (r.isPlayer) {
        if (r.H < 25 && !r._thirstWarn) { r._thirstWarn = true; this.log(t('log.thirsty'), 'warn'); }
        if (r.H > 40) r._thirstWarn = false;
        if (r.E < 30 && !r._hungerWarn) { r._hungerWarn = true; this.log(t('log.hungry'), 'warn'); }
        if (r.E > 45) r._hungerWarn = false;
      }
    }

    // ---- food and drink
    eat(r, kind) {
      if (!r.food[kind]) return false;
      r.food[kind]--;
      r.digest += kind === 'bar' ? 22 : 14;
      r.stats.eaten++;
      if (r.isPlayer) this.log(t(kind === 'bar' ? 'log.eat_bar' : 'log.eat_banana'), 'good');
      return true;
    }
    drink(r) {
      if (r.sips <= 0) return false;
      r.sips--;
      r.H = Math.min(100, r.H + 12);
      r.stats.drunk++;
      if (r.isPlayer) this.log(t('log.drink', { n: r.sips }), 'good');
      return true;
    }

    // ---- crashes
    _crashes(dt) {
      for (const g of this.groups.slice()) {
        if (g.fallen || g.v < 2) continue;
        const grade = this.route.gradeAt(g.s);
        for (let k = 0; k < g.members.length; k++) {
          const r = g.members[k];
          const rate = 3.5e-6 * (0.25 + (r.st.clumsiness / 100) * 1.8) * (g.v > 11 ? 2.5 : 1) * (grade < -0.04 ? 1.6 : 1) *
            (r.E < 20 ? 1.6 : 1) * (r.bonked ? 1.5 : 1) * this.weather.crash * (r.perks.has('hands') ? 0.6 : 1) *
            (g.members.length > 4 ? 1.2 : 1) * (this.route.surface === 'cobbles' ? 1.5 : 1);
          if (G.rand() < rate * dt) {
            const victims = [r];
            const behind = g.members[k + 1];
            if (behind && G.chance(0.15 + behind.st.clumsiness / 400)) victims.push(behind);
            for (const v of victims) this._crash(v, g);
            return;
          }
        }
      }
    }
    _crash(r, g) {
      const k = g.members.indexOf(r);
      const s = g.s - slotOffset(Math.max(0, k));
      this._leave(r);
      const fg = this._newGroup([r], s, 0);
      fg.fallen = true;
      r.status = 'fallen';
      r.fallT = G.randf(45, 200);
      r.E = Math.max(0, r.E - G.randf(3, 10));
      r.stats.falls++;
      r.injured = G.chance(0.12);
      r.mode = 'normal'; r.leading = false;
      const others = this.groups.includes(g) ? g.members.filter((m) => !m.isPlayer) : [];
      const waitVotes = others.filter((m) => G.chance(0.3 + (1 - m.st.competitiveness / 100) * 0.5 + (r.isPlayer ? m.mood * 0.3 : 0.1)));
      const groupWaits = others.length > 0 && waitVotes.length * 2 >= others.length;
      if (r.isPlayer) {
        this.log(t('log.you_crashed'), 'bad');
        if (groupWaits) { g.wait = 420; g.waitFor = new Set([r]); g.waitReason = t('wait.for_you'); }
        this.pending = { type: 'playerCrash', group: this.groups.includes(g) ? g : null, waits: groupWaits, waiters: waitVotes };
        return;
      }
      this.log(t('log.crashed', this.v(r)), 'bad');
      if (this.player.g === g) {
        this.pending = { type: 'crash', rider: r, group: g, aiWait: groupWaits };
      } else if (groupWaits && this.groups.includes(g)) {
        g.wait = 420; g.waitFor = new Set([r]); g.waitReason = t('wait.for_rider', this.v(r));
      }
    }
    resolveCrash(choice) {
      const p = this.pending; this.pending = null;
      const me = this.player, g = p.group, r = p.rider;
      if (!this.groups.includes(g)) return;
      const groupWaits = p.aiWait || (choice === 'wait' && g.members.length <= 2);
      if (groupWaits) { g.wait = 420; g.waitFor = new Set([r]); g.waitReason = t('wait.for_rider', this.v(r)); }
      if (choice === 'wait') {
        this.relate(r, 'waited_crash', 0.3);
        for (const m of g.members) if (m !== me && m.st.competitiveness < 60) this.relate(m, 'good_mate', 0.03);
        this.addSport('waited_crash', 3);
        if (!groupWaits) {
          const k = g.members.indexOf(me);
          this._leave(me);
          const ng = this._newGroup([me], g.s - slotOffset(k), g.v);
          ng.wait = 420; ng.waitFor = new Set([r]); ng.waitReason = t('wait.for_rider', this.v(r));
          this.log(t('log.you_wait_alone', this.v(r)), 'warn');
        } else this.log(t('log.all_wait', this.v(r)), 'info');
      } else {
        this.relate(r, 'abandoned_crash', -0.3);
        this.addSport('abandoned_crash', -3);
        if (groupWaits) {
          const k = g.members.indexOf(me);
          this._leave(me);
          this._newGroup([me], g.s - slotOffset(k) + 1, g.v);
          this.log(t('log.others_wait_you_go', this.v(r)), 'warn');
        } else this.log(t('log.nobody_stops', this.v(r)), 'warn');
      }
    }
    resolvePlayerUp(choice) {
      this.pending = null;
      if (choice === 'home') this._goHome(this.player, t('log.you_head_home'));
    }
    _getUp(r) {
      r.status = 'riding';
      const g = r.g;
      if (g) g.fallen = false;
      const waiting = this.groups.find((x) => x.wait > 0 && x.waitFor && x.waitFor.has(r));
      if (r.isPlayer) {
        if (waiting) for (const m of waiting.members) this.relate(m, 'waited_for_me', 0);
        this.pending = { type: 'playerUp', injured: r.injured };
        return;
      }
      if (r.injured) { this.say(r, t('shout.crash_home', this.v(r)), 'bad'); this._goHome(r); return; }
      if (waiting) { this.say(r, t('shout.im_ok', this.v(r))); return; }
      const ahead = this.sortedGroups().find((x) => x.s > r.s && !x.fallen);
      const gap = ahead ? this.timeGap(ahead.s, r.s, ahead.v || 7) : 999;
      if (gap < 120 && r.E > 30) { r.mode = 'chase'; r.modeT = 120; this.say(r, t('shout.chasing', this.v(r))); return; }
      if (G.chance(0.55 - r.st.competitiveness / 250 + (r.E < 40 ? 0.25 : 0))) { this._goHome(r); return; }
      this.say(r, t('shout.finish_alone', this.v(r)));
    }
    _goHome(r, text) {
      this._leave(r);
      r.status = 'home'; r.homeT = this.t; r.P = 0;
      if (r.isPlayer) { this.finished = true; this.abandoned = true; this.log(text || t('log.you_head_home'), 'bad'); }
      else this.log(t('log.goes_home', this.v(r)), 'warn');
      for (const g of this.groups) if (g.waitFor && g.waitFor.has(r)) g.waitFor.delete(r);
    }
    playerAbandon() { this._goHome(this.player, t('log.you_short_way')); }

    // ---- climbs, fountains, feed stations, KOM, regrouping at the top
    _crossings() {
      const route = this.route;
      for (const g of this.groups) {
        if (g.fallen || g.s <= g.lastS) continue;
        route.climbs.forEach((c, i) => { if (g.lastS < c.top && g.s >= c.top) this._summit(g, c, i); });
        for (const b of route.bars) {
          if (b.type === 'fountain' && g.lastS < b.at && g.s >= b.at && g.barT <= 0 && g.wait <= 0 &&
            g.members.some((m) => m.H < 60 || m.sips < m.bidons * 2)) {
            g.barT = G.randf(90, 180);
            g.lastBar = b.idx;
            this._barEffects(g.members, b);
            if (g.members.includes(this.player)) this.log(t('log.fountain', { place: G.stopName(b, route) }), 'good');
          }
          if (b.type === 'feed' && g.stopBar < 0 && g.barT <= 0 && b.at > g.s && b.at - g.s < 1500 && !this.barsDone.has(b.idx) &&
            g.members.some((m) => m.E < 80 || m.H < 70)) {
            g.stopBar = b.idx;
            if (g.members.includes(this.player)) this.log(t('log.feed_ahead', { place: G.stopName(b, route) }), 'good');
          }
        }
      }
    }
    _summit(g, c, i) {
      const first = g.members[0];
      const name = G.climbName(c);
      if (!this.climbFirst[i]) {
        this.climbFirst[i] = first;
        first.stats.kom.push(name);
        this.log(first.isPlayer ? t('log.kom_you', { climb: name }) : t('log.kom', { ...this.v(first), climb: name }), first.isPlayer ? 'good' : 'info');
      }
      const ch = this.challenge;
      if (ch && ch.climb === i && !ch.done) {
        const me = this.player;
        const meHere = g.members.includes(me), himHere = g.members.includes(ch.rider);
        if (meHere || himHere) {
          const win = meHere && (!himHere || g.members.indexOf(me) < g.members.indexOf(ch.rider));
          ch.done = true; ch.won = win;
          if (win) { this.log(t('log.challenge_won', { ...this.v(ch.rider), climb: name }), 'good'); this.relate(ch.rider, 'lost_challenge', -0.05); }
          else this.say(ch.rider, t('shout.challenge_won', this.v(ch.rider)), 'bad');
        }
      }
      // Sunday etiquette: wait for those dropped on the climb
      const strag = this.riders.filter((r) => r.status === 'riding' && r.s < g.s - 20 && !g.members.includes(r) &&
        this.timeGap(g.s, r.s, r.g ? r.g.v : 5) < 360);
      if (!strag.length || g.wait > 0) return;
      const ai = g.members.filter((m) => !m.isPlayer);
      if (!ai.length) return;
      const avgAggr = ai.reduce((a, m) => a + m.aggr, 0) / ai.length;
      const playerBehind = strag.includes(this.player);
      const avgMood = ai.reduce((a, m) => a + m.mood, 0) / ai.length;
      const p = 1.05 - avgAggr * 1.3 + (playerBehind ? avgMood * 0.3 : 0);
      if (G.chance(p)) {
        const maxGap = Math.max(...strag.map((r) => this.timeGap(g.s, r.s, r.g ? r.g.v : 5)));
        g.wait = Math.min(420, maxGap + 45);
        g.waitFor = new Set(strag);
        g.waitReason = t('wait.regroup', { climb: name });
        if (g.members.includes(this.player)) this.log(t('log.group_waits_top', { climb: name }), 'info');
        else if (playerBehind) this.log(t('log.they_wait_for_you', { climb: name }), 'info');
      }
    }

    _arriveBar(g, idx) {
      const bar = this.route.bars[idx];
      g.s = bar.at; g.v = 0;
      g.lastBar = idx;
      this._resetSlots(g);
      this.barsDone.add(idx);
      this._barEffects(g.members, bar);
      if (g.members.includes(this.player)) {
        g.barT = 1;
        this.pending = { type: 'bar', bar, group: g };
      } else {
        g.barT = bar.type === 'feed' ? G.randf(180, 420) : G.randf(600, 1200);
        this.log(t('log.they_stop', { names: g.members.map((m) => m.name).join(', '), place: G.stopName(bar, this.route) }));
      }
    }
    _barEffects(ms, bar) {
      for (const m of ms) {
        if (bar.type === 'fountain') { m.H = Math.min(100, m.H + 25); m.sips = m.bidons * 4; continue; }
        const k = m.perks.has('coffee') ? 2 : 1;
        m.E = Math.min(100, m.E + (bar.type === 'feed' ? 14 : 20) * k);
        m.H = 100;
        m.sips = m.bidons * 4;
        m.wbal = m.wcap;
        if (bar.type === 'feed' && !m.isPlayer) m.food.bar = Math.max(m.food.bar, 1);
      }
    }
    leaveBar(minutes) {
      const p = this.pending; this.pending = null;
      if (p && p.group && this.groups.includes(p.group)) {
        p.group.barT = minutes * 60;
        p.group.stopBar = -1;
      }
    }
    askBar() {
      const me = this.player, g = me.g;
      const bar = this.route.nextBar(me.s);
      if (!bar) return { ok: false, text: t('ask.no_bar') };
      const idx = bar.idx, name = G.stopName(bar, this.route);
      const ai = g ? g.members.filter((m) => !m.isPlayer) : [];
      if (g && g.stopBar === idx) return { ok: true, text: t('ask.already', { place: name }) };
      if (!ai.length || bar.final || bar.type === 'feed') {
        if (g) g.stopBar = idx;
        return { ok: true, text: ai.length ? t('ask.final', { place: name }) : t('ask.alone', { place: name }) };
      }
      const prog = me.s / this.route.len;
      const talk = me.perks.has('talker') ? 0.15 : 0;
      const yes = ai.filter((m) => G.chance(0.3 + (100 - m.E) / 150 + (100 - m.H) / 200 + m.mood * 0.2 + (prog > 0.35 ? 0.15 : 0) - m.aggr * 0.2 + talk));
      if (yes.length * 2 >= ai.length) {
        g.stopBar = idx;
        return { ok: true, text: t('ask.agreed', { place: name, km: G.fmtKm(bar.at - me.s) }), yes };
      }
      return { ok: false, text: t('ask.refused', { yes: yes.length, n: ai.length }), yes };
    }
    resolveCoffeeAsk(yes) {
      const p = this.pending; this.pending = null;
      if (yes && this.groups.includes(p.group)) {
        p.group.stopBar = p.idx;
        this.relate(p.rider, 'coffee_yes', 0.05);
        this.log(t('log.coffee_agreed', { place: G.stopName(p.bar, this.route) }), 'good');
      } else { this.relate(p.rider, 'coffee_no', -0.1); this.say(p.rider, t('shout.coffee_refused', this.v(p.rider))); }
    }

    // ---- player actions
    setPace(d) {
      const me = this.player;
      me.pace = G.clamp(me.pace + d, 0, 4);
      const g = me.g;
      if (!g || g.fallen) return;
      if (g.footDown && d > 0) { this.footUp(); return; }
      const k = g.members.indexOf(me);
      if (d > 0 && k > 0 && g.wait <= 0 && g.barT <= 0) {
        const lead = g.members[0];
        const want = G.PACES[me.pace].f * me.ftpW;
        if (want > lead.P * 1.03) {
          g.members.splice(k, 1);
          g.members.unshift(me);
          me.leading = true;
          g.pullT = 90;
          this.log(t('log.you_push', { pace: G.paceName(me.pace) }), 'info');
        }
      }
    }
    toggleRelay() {
      const me = this.player;
      me.relay = !me.relay;
      if (!me.relay) me.leading = false;
      this.log(t(me.relay ? 'log.relay_on' : 'log.relay_off'), 'info');
      if (me.relay) for (const m of this.riders) m.annoy = Math.max(0, m.annoy - 0.2);
    }
    sitIn() {
      const me = this.player;
      me.leading = false;
      const g = me.g;
      if (g && g.members[0] === me && g.members.length > 1) g.pullT = 0;
      this.log(t('log.sit_in'), 'info');
    }
    letGo() {
      const me = this.player, g = me.g;
      if (!g || g.members.length < 2) return;
      const k = g.members.indexOf(me);
      this._leave(me);
      me.leading = false;
      const tail = this.groups.includes(g) ? g.s - slotOffset(g.members.length - 1) : g.s - slotOffset(k);
      this._newGroup([me], tail - 3, g.v * 0.9).noMergeT = 15;
      this.log(t('log.let_go'), 'info');
    }
    // leave a waiting group (at a summit, for a fallen rider...): they get angry and the
    // competitive ones may chase you
    goOn() {
      const me = this.player, g = me.g;
      if (!g || g.wait <= 0) return;
      if (g.footDown) { this.footUp(); return; }
      this._leave(me);
      this._newGroup([me], g.s + 2, 0).noMergeT = 10;
      this.addSport('left_waiting', -4);
      const ai = this.groups.includes(g) ? g.members.filter((m) => !m.isPlayer) : [];
      const chasers = [];
      for (const m of ai) {
        this.relate(m, 'left_waiting', -0.25);
        m.aggr = G.clamp(m.aggr + 0.15, 0, 1);
        const p = (m.st.competitiveness / 100) * 0.8 * (m.S / 100) * (m.E > 30 ? 1 : 0.2) + (m.rival ? 0.3 : 0);
        if (G.chance(p)) chasers.push(m);
      }
      if (chasers.length) {
        for (const m of chasers) { this._leave(m); m.mode = 'chase'; m.modeT = 300; m.rival = true; }
        this._newGroup(chasers, g.s, 0).noMergeT = 5;
        this.log(t('log.angry_chase', { names: chasers.map((m) => m.name).join(', ') }), 'warn');
        this.say(chasers[0], t('shout.angry', this.v(chasers[0])), 'bad');
      } else if (ai.length) {
        this.log(t('log.angry_stay'), 'warn');
      }
    }
    // what putting a foot down would mean right now (for the UI)
    footContext() {
      const me = this.player, g = me.g;
      if (!g || me.status !== 'riding') return null;
      if (g.footDown) return { down: true };
      const ref = g.s;
      const behind = this.riders.filter((r) => r.status === 'riding' && !g.members.includes(r) && r.s < ref && this.timeGap(ref, r.s, r.g ? r.g.v : 5) < 420);
      const ahead = this.groups.filter((x) => x !== g && !x.fallen && x.s > ref && this.timeGap(x.s, ref, x.v || 6) < 300);
      return { down: false, behind, ahead, inGroup: g.members.length > 1 };
    }
    // foot down: 'wait' (friendly), 'mock' (showing off from the front), 'guilt' (from behind)
    footDown(mode) {
      const me = this.player, g = me.g;
      if (!g) return;
      const ctx = this.footContext();
      let fg = g;
      if (g.members.length > 1) {
        const k = g.members.indexOf(me);
        const others = g.members.filter((m) => m !== me);
        const stay = others.filter((m) => G.chance(0.2 + (1 - m.aggr) * 0.4 + m.mood * 0.3));
        if (stay.length * 2 > others.length && mode !== 'mock') {
          this.log(t('log.foot_group_stops'), 'info');
        } else {
          this._leave(me);
          fg = this._newGroup([me], g.s - slotOffset(k), g.v * 0.5);
          this.log(t('log.foot_group_goes'), 'info');
        }
      }
      fg.wait = 1e9;
      fg.footDown = { mode, done: new Set() };
      me.leading = false;
      if (mode === 'wait') this.log(t('log.foot_wait', { n: ctx.behind.length }), 'info');
      if (mode === 'mock') this.log(t('log.foot_mock'), 'info');
      if (mode === 'guilt') {
        this.addSport('guilt', -2);
        let any = 0;
        for (const x of ctx.ahead) {
          const ai = x.members.filter((m) => !m.isPlayer);
          if (!ai.length) continue;
          const pm = ai.reduce((a, m) => a + 0.25 + m.mood * 0.5 + (1 - m.st.competitiveness / 100) * 0.35, 0) / ai.length;
          if (G.chance(pm)) {
            x.wait = 600; x.waitFor = new Set([me]); x.waitReason = t('wait.guilt');
            for (const m of ai) this.relate(m, 'guilt', -0.08);
            any += ai.length;
            this.say(ai[0], t('shout.guilt_ok', this.v(ai[0])), 'warn');
          } else for (const m of ai) this.relate(m, 'guilt_ignored', -0.02);
        }
        this.log(any ? t('log.guilt_works', { n: any }) : t('log.guilt_fails'), any ? 'warn' : 'bad');
      }
    }
    footUp() {
      const me = this.player, g = me.g;
      if (!g || !g.footDown) return;
      g.wait = 0; g.waitFor = null; g.footDown = null;
      this.log(t('log.foot_up'), 'info');
    }
    _footArrivals(A, ms) {
      const fd = A.footDown, me = this.player;
      if (!A.members.includes(me)) return;
      for (const m of ms) {
        if (m.isPlayer || fd.done.has(m.id)) continue;
        fd.done.add(m.id);
        if (fd.mode === 'mock') {
          this.addSport('mock', -1);
          if (m.st.competitiveness >= 55) {
            this.relate(m, 'mocked', -0.05);
            m.aggr = G.clamp(m.aggr + 0.2, 0, 1); m.rival = true;
            this.say(m, t('shout.mocked_hot', this.v(m)), 'warn');
          } else {
            this.relate(m, 'mocked', -0.15);
            this.say(m, t('shout.mocked_sad', this.v(m)), 'warn');
          }
        } else {
          this.addSport('waited', 2);
          this.relate(m, 'waited_for_them', 0.15);
          this.say(m, t('shout.thanks_wait', this.v(m)), 'good');
        }
      }
    }
    playerAttack() {
      const me = this.player;
      if (me.status !== 'riding' || me.wbal < me.wcap * 0.12 || me.bonked) {
        this.log(t(me.bonked ? 'log.no_attack_bonk' : 'log.no_attack'), 'warn');
        return false;
      }
      if (me.g && me.g.footDown) this.footUp();
      const alert = this.attackAlert;
      const responding = alert && alert.attacker !== me;
      this._attack(me, responding);
      if (responding) this.log(t('log.you_follow', this.v(alert.attacker)), 'good');
      else this.log(t('log.you_attack'), 'good');
      this.attackAlert = null;
      return true;
    }
    _attack(r, isResponse) {
      const g = r.g;
      if (!g) return;
      r.mode = 'attack';
      r.modeT = r.isPlayer ? 22 : G.randf(10, 25);
      r.stats.attacks++;
      r.attackCd = G.randf(240, 600);
      r.leading = false;
      if (g.wait > 0 || g.barT > 0) {
        if (r.isPlayer && g.wait > 0 && g.members.length > 1) this.goOn();
        return;
      }
      if (g.members.length === 1) return;
      const old = g.members.filter((m) => m !== r);
      this._leave(r);
      const ag = this._newGroup([r], g.s + 3, g.v + 1);
      ag.noMergeT = 6;
      if (isResponse) return;
      if (!r.isPlayer) this.log(t('log.attacks', this.v(r)), this.player.g === g ? 'warn' : 'info');
      if (this.player.g === g) this.attackAlert = { attacker: r, t: this.t };
      const resp = old.filter((m) => !m.isPlayer && m.mode === 'normal' && !m.bonked && G.chance(
        0.55 * (m.st.competitiveness / 100) * m.aggr * (m.S / 100) * (m.E > 30 ? 1 : 0.3) *
        (r.isPlayer && m.rival ? 1.8 : 1) * (this.challenge && this.challenge.rider === m && r.isPlayer ? 1.8 : 1)));
      for (const m of resp) {
        m.mode = 'attack'; m.modeT = G.randf(8, 15);
        this._leave(m);
        this._newGroup([m], g.s + 2, g.v + 0.5).noMergeT = 3;
        this.log(t('log.follows', this.v(m)), 'info');
      }
    }

    // ---- AI brain (every 5 s)
    _decideAI(r) {
      const g = r.g;
      if (!g || g.fallen) return;
      const route = this.route;
      r.attackCd -= 5;
      if (r.E < 60 && r.digest < 4) { if (!this.eat(r, 'bar')) this.eat(r, 'banana'); }
      if (r.H < 62) this.drink(r);
      if (g.barT > 0 || g.wait > 0) return;
      const grade = route.gradeAt(g.s);
      const me = this.player;
      const withPlayer = me.g === g;
      const k = g.members.indexOf(r);

      if (withPlayer && g.members.length >= 2 && !me.relay && !me.leading) {
        r.annoy += 0.004 * (0.5 + r.st.competitiveness / 100) * (g.members.length <= 4 ? 2 : 1);
        if (r.annoy > 0.35 && r.shoutCd <= 0 && this.t - this.lastShout > 150 && G.chance(0.15)) {
          this.say(r, t('shout.pull_please', { p: me.name, ...this.v(r) }), 'warn');
          r.shoutCd = 300; this.lastShout = this.t;
        }
        if (r.annoy > 0.6) { r.rival = r.rival || r.st.competitiveness > 60; r.relayWill = Math.max(0, r.relayWill - 0.01); }
      }
      if (withPlayer && g.members[0] === me && g.members.length > 1 && r.P > r.cp * 1.02 && r.shoutCd <= 0 && this.t - this.lastShout > 120 && G.chance(0.3)) {
        this.say(r, t('shout.ease_up', this.v(r)), 'warn');
        r.shoutCd = 300; this.lastShout = this.t;
        r.mood -= 0.03;
      }
      if (r.bonked || r.mode !== 'normal') return;

      const c = route.nextClimb(g.s);
      if (g.members.length >= 2 && r.attackCd <= 0 && r.S > 60 && r.E > 35 && g.stopBar < 0) {
        let terrain = grade > 0.045 ? 2.5 : grade > 0.02 ? 1.2 : 0.35;
        if (c && g.s > c.start && c.top - g.s < 1000) terrain *= 1.8;
        if (route.len - g.s < 2000) terrain *= 4;
        let p = 0.004 * Math.pow(r.aggr, 2.5) * terrain * (g.members.length >= 3 ? 1 : 0.5);
        if (withPlayer && r.rival) p *= 1.8;
        const ch = this.challenge;
        if (ch && !ch.done && ch.rider === r && withPlayer && c && route.climbs.indexOf(c) === ch.climb && g.s > c.start) p *= 6;
        if (G.chance(p)) { this._attack(r, false); return; }
      }

      // hunt: competitive riders don't let anybody ride away up the road
      if (r.st.competitiveness >= 50 && r.aggr > 0.35 && r.E > 40 && r.S > 30) {
        const ahead = this.sortedGroups().filter((x) => x.s > g.s && !x.fallen && x.barT <= 0 && x.wait <= 0).pop();
        const breakaway = ahead && ahead.members.length <= 2 && ahead.members.length < g.members.length;
        if (breakaway && this.timeGap(ahead.s, g.s, g.v || 6) < 150 && G.chance(0.1 + (ahead.members.includes(me) && r.rival ? 0.3 : 0))) {
          r.mode = 'chase'; r.modeT = 90;
          if (k > 0) { g.members.splice(k, 1); g.members.unshift(r); }
          return;
        }
      }
      // strong riders set their own tempo on climbs instead of crawling with the group
      if (grade > 0.04 && g.members.length > 1 && k > 0 && r.aggr > 0.3 && r.E > 45) {
        const mine = speedFor(r.cp * 0.9, grade, 1, r, this.crr);
        if (mine > g.v * 1.2 && G.chance(0.04 + r.aggr * 0.06)) {
          r.mode = 'tempo'; r.modeT = c ? Math.max(60, (c.top - g.s) / Math.max(2, mine)) : 120;
          g.members.splice(k, 1); g.members.unshift(r);
          return;
        }
      }
      if (g.members[0] === r && g.members.length > 1) {
        const ahead = this.sortedGroups().find((x) => x.s > g.s && !x.fallen && x.members.some((m) => m.mode === 'break' || m.mode === 'attack'));
        if (ahead && r.aggr > 0.42 && this.timeGap(ahead.s, g.s, g.v) < 90 && G.chance(0.3)) { r.mode = 'chase'; r.modeT = 90; }
      }

      const bar = route.nextBar(g.s);
      if (bar && g.stopBar < 0 && (r.E < 38 || r.H < 28) && bar.at - g.s < 25000 && r.shoutCd <= 0) {
        if (withPlayer) {
          if (this.coffeeAskCd <= 0 && !this.pending) {
            this.coffeeAskCd = 600;
            r.shoutCd = 300;
            this.pending = { type: 'coffeeAsk', rider: r, bar, idx: bar.idx, group: g, text: t('shout.coffee_ask', { ...this.v(r), place: G.stopName(bar, route) }) };
          }
        } else if (G.chance(0.6)) { g.stopBar = bar.idx; }
      }
      if (g.members.length === 1 && !withPlayer && r.E < 8 && G.chance(0.04)) {
        this.say(r, t('shout.home_alone', this.v(r)), 'warn');
        this._goHome(r);
      }
    }

    // ---- end of ride: relay share and wheel-sucking feed the relationship / sportiveness tally
    closeRelations() {
      const me = this.player;
      if (me.stats.groupT > 300) {
        const avgSize = me.stats.groupN / me.stats.groupT;
        const fair = me.stats.groupT / Math.max(2, avgSize);
        const pts = Math.round(G.clamp((me.stats.pull / fair - 0.5) * 8, -6, 6));
        if (pts) this.addSport(pts > 0 ? 'pulled' : 'wheelsucked', pts);
      }
      for (const r of this.riders) if (!r.isPlayer && r.annoy > 0.3) this.relate(r, 'wheelsucker', -Math.min(0.3, r.annoy * 0.3));
    }

    finishRest(maxT) {
      const end = this.t + (maxT || 4 * 3600);
      this.pending = null;
      this.finished = false;
      while (this.t < end && this.riders.some((r) => r.active)) {
        if (this.pending) {
          const p = this.pending;
          if (p.type === 'bar') this.leaveBar(15);
          else if (p.type === 'coffeeAsk') this.resolveCoffeeAsk(true);
          else this.pending = null;
        }
        this.step(1);
        this.finished = false;
      }
      for (const r of this.riders) {
        if (r.active) {
          r.finishT = this.t + (this.route.len - r.s) / 6.5;
          r.status = 'finished';
          r.estimated = true;
        }
      }
      this.finished = true;
    }

    // ---- save / load
    toJSON() {
      const ids = (arr) => arr.map((r) => r.id);
      return {
        routeId: this.route.id, weatherId: this.weather.id, startMin: this.startMin, t: this.t, gid: this.gid,
        coffeeAskCd: this.coffeeAskCd, lastShout: this.lastShout, finished: this.finished, abandoned: !!this.abandoned,
        sport: this.sport, barsDone: [...this.barsDone],
        climbFirst: this.climbFirst.map((r) => (r ? r.id : null)),
        challenge: this.challenge ? { rider: this.challenge.rider.id, climb: this.challenge.climb, done: !!this.challenge.done, won: !!this.challenge.won } : null,
        feed: this.feed.slice(-80).map((f) => ({ t: f.t, text: f.text, kind: f.kind, who: f.who })),
        riders: this.riders.map((r) => r.toJSON()),
        groups: this.groups.map((g) => Object.assign({}, g, {
          members: ids(g.members), waitFor: g.waitFor ? ids([...g.waitFor]) : null,
          footDown: g.footDown ? { mode: g.footDown.mode, done: [...g.footDown.done] } : null,
        })),
      };
    }
    static fromJSON(o) {
      const sim = Object.create(Sim.prototype);
      sim.route = G.routeById(o.routeId);
      sim.weather = G.WEATHER.find((w) => w.id === o.weatherId) || G.WEATHER[1];
      Object.assign(sim, { startMin: o.startMin, t: o.t, gid: o.gid, coffeeAskCd: o.coffeeAskCd, lastShout: o.lastShout,
        finished: o.finished, abandoned: o.abandoned, sport: o.sport || [], pending: null, attackAlert: null });
      sim.barsDone = new Set(o.barsDone || []);
      sim.riders = o.riders.map((x) => Rider.fromJSON(x));
      const byId = (id) => sim.riders.find((r) => r.id === id);
      sim.player = sim.riders.find((r) => r.isPlayer);
      sim.climbFirst = o.climbFirst.map((id) => (id == null ? null : byId(id)));
      sim.challenge = o.challenge ? Object.assign({}, o.challenge, { rider: byId(o.challenge.rider) }) : null;
      sim.feed = (o.feed || []).map((f) => Object.assign({}, f, { rider: f.who ? sim.riders.find((r) => r.name === f.who) : null }));
      sim.groups = o.groups.map((g) => {
        const ng = Object.assign({}, g, { members: g.members.map(byId), waitFor: g.waitFor ? new Set(g.waitFor.map(byId)) : null,
          footDown: g.footDown ? { mode: g.footDown.mode, done: new Set(g.footDown.done) } : null });
        for (const m of ng.members) m.g = ng;
        return ng;
      });
      return sim;
    }
  }
  G.Sim = Sim;
})();
