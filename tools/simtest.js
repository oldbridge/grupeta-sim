// Headless check of the ride simulation.
//   node tools/simtest.js <routeId> <player> <seed> [runs]
// One run prints the event log; several runs print per-rider statistics (wins, homes, times).
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, JSON, Set, Map, Array, Object, String, Number, Infinity, URLSearchParams };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['config/players.js', 'data/routes.js', 'i18n/en.js', 'js/util.js', 'js/players.js', 'js/content.js', 'js/route.js', 'js/sim.js', 'js/social.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const G = ctx.G;
G.initPlayers();
const [rid = 'jaizkibel', pname = 'Xabi', seed = '1', runs = '1'] = process.argv.slice(2);
const route = G.routeById(rid);
const verbose = +runs === 1;
const agg = {};
for (let run = 0; run < +runs; run++) {
  G.seed(+seed + run);
  const riders = ctx.PLAYERS.map((p, i) => new G.Rider(p, i, { player: p.name === pname, formDelta: G.randi(-8, 8), bidons: 2, food: { bar: 2, banana: 1 } }));
  const sim = new G.Sim(route, riders, { weather: G.WEATHER[1] });
  const me = sim.player; me.pace = +(process.env.PACE || 1);
  let lastLog = 0;
  while (!sim.finished && sim.t < 8 * 3600) {
    if (sim.pending) {
      const p = sim.pending;
      if (p.type === 'bar') sim.leaveBar(15);
      else if (p.type === 'crash') sim.resolveCrash('wait');
      else if (p.type === 'coffeeAsk') sim.resolveCoffeeAsk(true);
      else if (p.type === 'playerUp') sim.resolvePlayerUp('go');
      else sim.pending = null;
    }
    if (!process.env.NOFOOD) {
      if (me.E < 55 && me.digest < 3) sim.eat(me, me.food.bar ? 'bar' : 'banana');
      if (me.H < 60) sim.drink(me);
    }
    sim.step(0.5);
    for (; lastLog < sim.feed.length; lastLog++) {
      const f = sim.feed[lastLog];
      if (verbose) console.log(G.fmtDur(f.t).padStart(8), (f.who ? f.who + ': ' : '') + f.text);
    }
  }
  sim.finishRest();
  const res = riders.slice().sort((a, b) => (a.status === 'home' ? 1e9 : a.finishT) - (b.status === 'home' ? 1e9 : b.finishT));
  res.forEach((r, i) => {
    const a = (agg[r.name] = agg[r.name] || { home: 0, t: 0, n: 0, falls: 0, E: 0, att: 0, win: 0, top3: 0 });
    if (r.status === 'home') a.home++; else { a.t += r.finishT; a.n++; }
    if (i === 0) a.win++;
    if (i < 3) a.top3++;
    a.falls += r.stats.falls; a.E += r.E; a.att += r.stats.attacks;
  });
  if (verbose) for (const r of res) console.log(r.name.padEnd(12), r.status.padEnd(9), G.fmtDur(r.finishT || r.homeT || 0), 'E', r.E.toFixed(0), 'avgP', (r.stats.work / Math.max(1, r.stats.moving)).toFixed(0), 'W/kg', (r.ftpW / r.mass).toFixed(2), 'falls', r.stats.falls, 'att', r.stats.attacks);
}
if (!verbose) for (const [n, a] of Object.entries(agg).sort((x, y) => y[1].win - x[1].win || y[1].top3 - x[1].top3)) console.log(n.padEnd(12), 'wins', String(a.win).padStart(2), 'top3', String(a.top3).padStart(2), 'home', a.home, 'avgT', G.fmtDur(a.t / Math.max(1, a.n)), 'falls', a.falls, 'endE', (a.E / +runs).toFixed(0), 'att', a.att);
console.log('route', route.name, route.km, 'km', route.gain, 'm');
