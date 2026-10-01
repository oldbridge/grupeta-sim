// Route helpers: elevation, gradient, map position and points of interest at a distance s (m).
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  class Route {
    constructor(data) {
      Object.assign(this, data);
      this.len = (this.e.length - 1) * this.step;
      this.ele = this.e.map((v) => v / 10);
      const n = this.ele.length, g = new Float32Array(n), k = 2;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - k), b = Math.min(n - 1, i + k);
        g[i] = b > a ? (this.ele[b] - this.ele[a]) / ((b - a) * this.step) : 0;
      }
      this.grad = g;
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (let i = 0; i < n; i++) {
        minx = Math.min(minx, this.x[i]); maxx = Math.max(maxx, this.x[i]);
        miny = Math.min(miny, this.y[i]); maxy = Math.max(maxy, this.y[i]);
      }
      this.bbox = { minx, maxx, miny, maxy };
      // difficulty used by riders to accept or refuse a proposal (~0.4 short .. ~2.5 epic)
      this.difficulty = this.km / 100 + this.gain / 1500 + (this.surface === 'cobbles' ? 0.3 : 0);
      this.bars.forEach((b, i) => { b.idx = i; });
    }
    get name() { return G.tOpt('routes.' + this.id + '.name') || this.id; }
    get blurb() { return G.tOpt('routes.' + this.id + '.blurb') || ''; }
    get areaName() { return G.areaName(this.area); }
    _idx(s) {
      const f = G.clamp(s, 0, this.len) / this.step;
      const i = Math.min(this.e.length - 2, Math.floor(f));
      return [i, f - i];
    }
    eleAt(s) { const [i, t] = this._idx(s); return this.ele[i] + (this.ele[i + 1] - this.ele[i]) * t; }
    gradeAt(s) { const [i, t] = this._idx(s); return this.grad[i] + (this.grad[i + 1] - this.grad[i]) * t; }
    posAt(s) {
      const [i, t] = this._idx(s);
      return { x: this.x[i] + (this.x[i + 1] - this.x[i]) * t, y: this.y[i] + (this.y[i + 1] - this.y[i]) * t };
    }
    sceneryAt(s) {
      if (this.surface === 'cobbles') return 'f';
      const i = G.clamp(Math.floor(s / 500), 0, this.scenery.length - 1);
      return this.scenery[i];
    }
    // next stop where the group can sit down (bar or feed station), skipping fountains
    nextBar(s) { return this.bars.find((b) => b.at > s + 30 && b.type !== 'fountain') || null; }
    nextStop(s) { return this.bars.find((b) => b.at > s + 30) || null; }
    nextClimb(s) { return this.climbs.find((c) => c.top > s) || null; }
    climbAt(s) { return this.climbs.find((c) => s >= c.start && s <= c.top) || null; }
    stars() { return G.clamp(Math.round(this.difficulty * 2.2), 1, 5); }
    stopName(b) { return G.stopName(b, this); }
  }
  G.Route = Route;

  G.areaName = (id) => G.tOpt('areas.' + id + '.name') || id;
  // place names from the data, translated when the language file has them (places.<name>)
  G.placeName = (p) => (p ? (G.tOpt('places.' + p) || p) : p);
  G.stopName = function (b, route) {
    if (b.brief) return G.placeName(b.place);
    if (b.final) return route && route.kind === 'home' ? G.t('stops.final_home') : G.t('stops.final_away', { area: route ? route.areaName : '' });
    if (b.place) return G.t('stops.' + b.type, { place: G.placeName(b.place) });
    return G.t('stops.' + b.type + '_km', { km: Math.round(b.at / 1000) });
  };
  G.stopIcon = (b) => (b.type === 'fountain' ? '🚰' : b.type === 'feed' ? '🍌' : '☕');
  G.climbName = function (c) {
    if (c.name) return G.placeName(c.name);
    if (c.near) return G.t('climb.near', { town: G.placeName(c.near) });
    return G.t('climb.km', { km: Math.round(c.top / 1000) });
  };
  let cache = null;
  G.routes = () => (cache = cache || (window.ROUTES || []).map((r) => new Route(r)));
  G.routeById = (id) => G.routes().find((r) => r.id === id);
  G.routesOfArea = (area) => G.routes().filter((r) => r.area === area);
  G.awayAreas = () => [...new Set(G.routes().filter((r) => r.kind === 'away').map((r) => r.area))];
  G.epicRoutes = () => G.routes().filter((r) => r.kind === 'epic');
})();
