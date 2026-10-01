// Social AI for the dialogue stages: who answers the WhatsApp call, who comes on a car trip
// or an epic, who accepts a route, how riders react to taunts.  DOM-free like sim.js.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const t = (k, v) => G.t(k, v);
  const Social = {};
  const vars = (p, extra) => Object.assign({ n: p.name, g: p.gender }, extra || {});

  // Rider capacity (0.4 weak .. 2.2 strong) for a given daily form.
  Social.capacity = (p, form) => ((form * 0.6 + p.endurance * 0.4) / 100) * 2.2;
  Social.areaDifficulty = (area) => {
    const rs = G.routesOfArea(area);
    return rs.reduce((a, r) => a + r.difficulty, 0) / Math.max(1, rs.length);
  };

  // Saturday evening: reply to a call.  trip = {kind: 'home'|'away'|'epic', area, route}
  Social.chatReply = function (p, trip, time, weather, mood, form) {
    let prob, pool = '';
    const C = Social.capacity(p, form != null ? form : p.fitness);
    if (trip.kind === 'epic') {
      const D = trip.route.difficulty;
      prob = G.sigmoid((C - D) * 3 + (p.competitiveness / 100 - 0.4) * 2 + mood * 0.5);
      pool = 'epic_';
    } else if (trip.kind === 'away') {
      const D = Social.areaDifficulty(trip.area);
      prob = G.sigmoid((C - D) * 2.5 + 0.5 - G.AREAS_DRIVE(trip.area) / 120 + mood * 0.5 + weather.accept);
      pool = 'away_';
    } else {
      prob = 0.5 + p.fitness / 400 + weather.accept + mood * 0.2;
    }
    if (p.badSleeper) prob += 0.2;              // bad sleepers always say yes the night before
    let extra = null;
    if (trip.kind === 'home' && time <= 8 * 60 && G.chance(0.4)) { prob -= 0.25; extra = 'early'; }
    if (trip.kind === 'home' && time >= 9 * 60 + 30 && weather.id === 'sunny' && G.chance(0.4)) { prob -= 0.1; extra = 'late'; }
    if (weather.id === 'drizzle' && G.chance(0.4)) extra = 'rainy';
    const r = G.rand();
    const kind = r < prob ? 'yes' : r < prob + 0.12 ? 'maybe' : 'no';
    let text = G.tOpt('chat.' + pool + kind, vars(p, { time: G.fmtClock(time) })) || t('chat.' + kind, vars(p));
    if (extra && kind !== 'yes') text = t('chat.' + extra, vars(p, { time: G.fmtClock(time) })) + ' ' + t(kind === 'no' ? 'chat.pass' : 'chat.maybe_short');
    return { kind, text };
  };
  Social.insist = function (p, perks, mood) {
    const ok = G.chance(0.3 + (perks.has('talker') ? 0.2 : 0) + p.competitiveness / 500 + (mood || 0) * 0.2);
    return { ok, text: t(ok ? 'chat.insist_yes' : 'chat.insist_no', vars(p)) };
  };
  // an AI organiser proposes a car trip or an epic before the player writes
  Social.aiOffer = function (players, exclude, weather) {
    const cands = players.filter((p) => p.name !== exclude && p.fitness >= 45);
    if (!cands.length || weather.id === 'drizzle') return null;
    const p = G.pick(cands);
    if (p.fitness >= 70 && G.chance(0.25)) {
      const epics = G.epicRoutes();
      return { kind: 'epic', by: p.name, route: G.pick(epics) };
    }
    const areas = G.awayAreas().filter((a) => Social.areaDifficulty(a) < Social.capacity(p, p.fitness) + 0.3);
    if (!areas.length) return null;
    return { kind: 'away', by: p.name, area: G.pick(areas), seats: G.pick([3, 4, 4, 6]) };
  };

  Social.routeVote = function (p, form, route, weather, perks, mood) {
    const D = route.difficulty, C = Social.capacity(p, form);
    let x = (C - D) * 3.2 + 0.6;
    const favStop = route.bars.find((b) => (p.favouriteStops || []).includes(b.id));
    const love = !!favStop;
    if (love) x += 2.5;
    const liked = route.bars.find((b) => G.everybodyLikes.includes(b.id));
    if (liked) x += 0.4;
    x += (p.competitiveness / 100 - 0.5) * (D - 0.9) * 1.6;
    if (weather.id === 'drizzle') x -= 0.4 * D;
    if (weather.id === 'sunny' && D > 1.6) x -= 0.3;
    if (perks && perks.has('talker')) x += 0.5;
    x += (mood || 0) * 0.6;
    const prob = G.sigmoid(x);
    const accept = G.rand() < prob;
    let text;
    if (accept) {
      const loveLine = (b) => G.tOpt('route_vote.love_' + b.id, vars(p)) || t('route_vote.love_generic', vars(p, { place: G.stopName(b, route) }));
      if (love) text = loveLine(favStop);
      else if (liked && G.chance(0.5)) text = loveLine(liked);
      else text = t(D > 1.4 && p.competitiveness > 60 && G.chance(0.6) ? 'route_vote.accept_hard' : 'route_vote.accept', vars(p));
    } else {
      text = t(D < 0.6 && C > 1.4 ? 'route_vote.refuse_easy' : 'route_vote.refuse', vars(p));
    }
    return { accept, text, prob };
  };

  // Taunts.  `st` holds the rider's mutable social state {aggr, relayWill, mood, rival}.
  // Returns {text, effect, sport, rel}
  Social.taunt = function (p, st, kind, climbName, perks) {
    const c = p.competitiveness;
    const bonus = perks && perks.has('talker') ? 1.25 : 1;
    const V = vars(p, { climb: climbName });
    switch (kind) {
      case 'provoke':
        if (c >= 60) {
          st.aggr = G.clamp(st.aggr + 0.25 * bonus, 0, 1); st.rival = true; st.mood -= 0.05;
          return { text: t('reply.provoke_hot', V), effect: t('effect.provoke_hot', V), sport: -2, rel: 'provoked' };
        }
        st.mood -= 0.3; st.relayWill = G.clamp(st.relayWill - 0.35, 0, 1);
        return { text: t('reply.provoke_sulk', V), effect: t('effect.provoke_sulk', V), sport: -2, rel: 'provoked' };
      case 'challenge':
        if (!climbName) return { text: t('reply.no_climb', V), effect: '', sport: 0 };
        if (c >= 50 || G.chance(c / 100)) {
          st.aggr = G.clamp(st.aggr + 0.15 * bonus, 0, 1); st.challenge = true;
          return { text: t('reply.challenge_yes', V), effect: t('effect.challenge_yes', V), sport: 0, rel: 'challenged' };
        }
        return { text: t('reply.challenge_no', V), effect: t('effect.challenge_no', V), sport: 0 };
      case 'praise':
        st.mood = Math.min(1, st.mood + 0.3 * bonus); st.relayWill = G.clamp(st.relayWill + 0.2, 0, 1);
        if (c > 70) st.aggr = G.clamp(st.aggr + 0.05, 0, 1);
        return { text: t('reply.praise', V), effect: t('effect.praise', V), sport: 1, rel: 'praised' };
      case 'calm':
        if (c < 75 || G.chance(0.25 * bonus)) {
          st.aggr = G.clamp(st.aggr - 0.25 * bonus, 0, 1); st.rival = false;
          return { text: t('reply.calm_yes', V), effect: t('effect.calm_yes', V), sport: 1, rel: 'calmed' };
        }
        st.aggr = G.clamp(st.aggr + 0.05, 0, 1);
        return { text: t('reply.calm_no', V), effect: t('effect.calm_no', V), sport: 0 };
    }
    return { text: '…', effect: '', sport: 0 };
  };

  Social.feeling = function (r) {
    const V = { n: r.name, g: r.gender };
    if (r.E > 75) return t('feeling.great', V);
    if (r.E > 50) return t('feeling.ok', V);
    if (r.E > 25) return t('feeling.tired', V);
    return t('feeling.cooked', V);
  };

  Social.sportLabel = (score) => t('sport.label.' + (score >= 10 ? 'gentleman' : score >= 4 ? 'mate' : score > -4 ? 'normal' : score > -10 ? 'sucker' : 'ruthless'));
  Social.levelFor = (xp) => Math.floor(Math.sqrt(xp / 60)) + 1;
  Social.xpFor = (lvl) => (lvl - 1) * (lvl - 1) * 60;

  G.AREAS_DRIVE = (area) => ((window.AREAS || {})[area] || {}).drive || 0;
  G.Social = Social;
})();
