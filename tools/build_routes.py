#!/usr/bin/env python3
"""Build the game data from the Garmin exports and the player sheet.

  inputs/gpx/*.gpx          -> data/routes.js   (window.ROUTES, window.AREAS)

Riders are not built here: the game reads config/players.js directly
(tools/import_players.py copies the stats from inputs/player_stats.ods into it).

Three kinds of route:
  home  - rides that start and end in Irun (meeting at Darío de Regoyos)
  away  - loops somewhere else: somebody takes the car with the bikes
  epic  - big sportives (Paris-Roubaix Challenge, Tour of Flanders, ...)

Stopping places come from the GPX timestamps: every pause of 3+ minutes in every ride is
clustered; long pauses become bars, short ones fountains / regroup points, and on epic
routes they are feed stations.  The bars named in the brief are always included.

Route names and blurbs live in i18n/en.js (translatable); the build only keeps ids.

Run:  python3 tools/build_routes.py            (no third-party packages needed)
      python3 tools/build_routes.py --stops    (print the detected stopping places)
      python3 tools/build_routes.py --climbs   (print detected summits)
"""
import datetime, glob, json, math, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GPX = os.path.join(ROOT, 'inputs', 'gpx')
OUT = os.path.join(ROOT, 'data')

MEET = (43.3418, -1.7700)          # Darío de Regoyos (Irun)
IRUN = (43.3390, -1.7890)
STEP = 25.0                        # resampling step along the route (m)

# Bars from the brief (coordinates from the pause clusters or the village centre)
BRIEF_BARS = [
    ('bera', 'Bera', (43.2813, -1.6799)),
    ('hondarribia', 'Hondarribia (Ondare)', (43.3679, -1.7934)),
    ('urrugne', 'Urrugne (Plaza ostatua)', (43.3627, -1.6990)),
    ('lesaka', 'Lesaka', (43.2469, -1.7050)),
    ('zarautz', 'Zarautz (camping)', (43.2764, -2.1250)),
    ('goizueta', 'Goizueta (Josune)', (43.1708, -1.8651)),
    ('zizurkil', 'Zizurkil (Maider & Ander)', (43.1896, -2.0535)),
    ('almandoz', 'Almandoz (Andueza)', (43.0964, -1.5953)),
    ('aizarotz', 'Aizarotz', (43.0105, -1.7838)),
]

SUMMITS = [
    ('Jaizkibel', (43.3480, -1.8540)), ('Guadalupe', (43.3690, -1.8215)), ('Ibardin', (43.3030, -1.6840)),
    ('Aritxulegi', (43.2723, -1.7959)), ('Agiña', (43.2650, -1.7599)), ('Lizuniaga', (43.2608, -1.6192)),
    ('Artikutza', (43.2471, -1.8149)), ('Tourmalet', (42.9090, 0.1450)), ('Lagos de Covadonga', (43.2720, -4.9850)),
    ('Oude Kwaremont', (50.7860, 3.5240)), ('Paterberg', (50.7810, 3.5530)), ('Koppenberg', (50.8180, 3.5840)),
    ('Muur van Geraardsbergen', (50.7730, 3.8820)), ('Port de Larrau', (42.9742, -0.9936)),
    ('Moncayo', (41.7937, -1.8120)), ('Luz Ardiden', (42.8846, -0.0622)), ('Gavarnie', (42.7331, -0.0097)),
    ('Abodi', (42.9572, -1.1350)),
    ('Col d\'Ispéguy', (43.1550, -1.4130)), ('Belate', (43.0300, -1.6200)),
]

TOWNS = [
    ('Irun', (43.3390, -1.7890)), ('Hondarribia', (43.3660, -1.7930)), ('Hendaye', (43.3590, -1.7740)),
    ('Behobia', (43.3410, -1.7600)), ('Biriatou', (43.3330, -1.7410)), ('Urrugne', (43.3627, -1.6990)),
    ('Ascain', (43.3452, -1.6209)), ('Sare', (43.3120, -1.5800)), ('Saint-Jean-de-Luz', (43.3880, -1.6620)),
    ('Bera', (43.2813, -1.6830)), ('Lesaka', (43.2469, -1.7050)), ('Etxalar', (43.2350, -1.6380)),
    ('Igantzi', (43.2280, -1.6990)), ('Doneztebe', (43.1309, -1.6708)), ('Oronoz', (43.1400, -1.6050)),
    ('Almandoz', (43.0964, -1.5953)), ('Oiartzun', (43.3000, -1.8600)), ('Errenteria', (43.3110, -1.9000)),
    ('Lezo', (43.3200, -1.8980)), ('Pasaia', (43.3240, -1.9200)), ('Hernani', (43.2660, -1.9760)),
    ('Usurbil', (43.2720, -2.0490)), ('Orio', (43.2790, -2.1250)), ('Zarautz', (43.2840, -2.1700)),
    ('Aia', (43.2370, -2.1490)), ('Zizurkil', (43.1960, -2.0730)), ('Andoain', (43.2180, -2.0200)),
    ('Goizueta', (43.1708, -1.8651)), ('Arano', (43.2000, -1.9000)), ('Leitza', (43.0790, -1.9150)),
    ('Aizarotz', (43.0105, -1.7838)), ('Ituren', (43.1290, -1.7330)), ('Elgorriaga', (43.1380, -1.6880)),
    ('Sunbilla', (43.1680, -1.6720)), ('Endarlatsa', (43.2830, -1.7290)), ('Lekunberri', (43.0040, -1.8900)),
    ('Lekeitio', (43.3630, -2.5050)), ('Ea', (43.3810, -2.5850)), ('Ispaster', (43.3560, -2.5450)),
    ('Markina', (43.2680, -2.4970)), ('Gernika', (43.3170, -2.6780)), ('Bermeo', (43.4200, -2.7220)),
    ('Mundaka', (43.4070, -2.6980)), ('Meñaka', (43.3620, -2.8080)), ('Mungia', (43.3550, -2.8460)),
    ('Bakio', (43.4280, -2.8100)), ('Gorliz', (43.4150, -2.9400)), ('Sopelana', (43.3810, -2.9940)),
    ('Beasain', (43.0480, -2.1950)), ('Ordizia', (43.0540, -2.1770)), ('Lazkao', (43.0330, -2.1880)),
    ('Ataun', (43.0070, -2.1760)), ('Zegama', (42.9750, -2.2900)), ('Segura', (43.0090, -2.2560)),
    ('Tolosa', (43.1350, -2.0770)), ('Azpeitia', (43.1820, -2.2660)), ('Zumarraga', (43.0890, -2.3170)),
    ('Itxassou', (43.3330, -1.4050)), ('Espelette', (43.3400, -1.4470)), ('Cambo', (43.3580, -1.4010)),
    ('Bidarray', (43.2680, -1.3480)), ('Ainhoa', (43.3070, -1.4990)), ('Saint-Pée', (43.3550, -1.5530)),
    ('Saint-Jean-Pied-de-Port', (43.1630, -1.2370)), ('Baigorri', (43.1760, -1.3440)), ('Ossès', (43.2400, -1.2800)),
    ('Larrau', (43.0100, -0.9600)), ('Arnéguy', (43.1100, -1.2800)), ('Luzaide', (43.0900, -1.3000)),
    ('Orreaga', (43.0090, -1.3200)), ('Aurizberri', (42.9900, -1.3360)), ('Aldudes', (43.0960, -1.4270)),
    ('Ochagavía', (42.9060, -1.0880)), ('Isaba', (42.8600, -0.9200)), ('Ezcároz', (42.8800, -1.0900)),
    ('Orbaizeta', (43.0000, -1.2200)), ('Campezo', (42.6750, -2.3690)), ('Maeztu', (42.7370, -2.4480)),
    ('Tudela', (42.0610, -1.6050)), ('Arguedas', (42.1800, -1.6000)), ('Bardenas Reales', (42.1700, -1.4800)),
    ('Luz-Saint-Sauveur', (42.8730, -0.0040)), ('Barèges', (42.8970, 0.0600)), ('Gavarnie', (42.7300, -0.0100)),
    ('Contis', (44.0900, -1.3200)), ('Lit-et-Mixe', (44.0300, -1.2500)), ('Mimizan', (44.2000, -1.2300)),
    ('Meruelo', (43.4600, -3.5700)), ('Isla', (43.4900, -3.5500)), ('Noja', (43.4900, -3.5200)),
    ('Solares', (43.3900, -3.7300)), ('Liérganes', (43.3400, -3.7400)), ('Laredo', (43.4100, -3.4200)),
    ('Ramales', (43.2600, -3.4700)), ('Cangas de Onís', (43.3510, -5.1290)), ('Covadonga', (43.3090, -5.0550)),
    ('Arriondas', (43.3900, -5.1900)), ('Ribadesella', (43.4600, -5.0600)), ('Benia', (43.3300, -4.9800)),
    ('Roubaix', (50.6900, 3.1800)), ('Arenberg', (50.4000, 3.4100)), ('Mons-en-Pévèle', (50.4800, 3.1000)),
    ('Carrefour de l\'Arbre', (50.5900, 3.2600)), ('Cysoing', (50.5700, 3.2100)), ('Templeuve', (50.5300, 3.1800)),
    ('Orchies', (50.4700, 3.2400)), ('Wallers', (50.3700, 3.3900)), ('Seclin', (50.5500, 3.0300)),
    ('Oudenaarde', (50.8450, 3.6050)), ('Kluisbergen', (50.7700, 3.5100)), ('Ronse', (50.7460, 3.6000)),
    ('Geraardsbergen', (50.7730, 3.8820)), ('Zottegem', (50.8700, 3.8100)), ('Brakel', (50.8000, 3.7600)),
    ('Berastegi', (43.1200, -1.9800)), ('Areso', (43.0800, -1.9500)), ('Betelu', (43.0250, -1.9800)),
    ('Lizartza', (43.1000, -2.0300)),
]
COAST = [(43.3740, -1.7930), (43.3720, -1.7700), (43.3600, -1.8300), (43.3560, -1.8600), (43.3420, -1.8900),
         (43.3300, -1.9300), (43.3210, -1.9600), (43.3000, -2.0300), (43.2900, -2.1000), (43.2860, -2.1300),
         (43.2870, -2.1700), (43.2950, -2.2000), (43.3900, -1.6700), (43.3950, -1.6900), (43.3800, -1.7300),
         (43.3650, -2.5000), (43.3800, -2.5800), (43.4200, -2.7200), (43.4300, -2.8100), (43.4150, -2.9400),
         (43.4900, -3.5400), (43.4600, -5.0600), (44.0900, -1.3300)]

# area -> start altitude (m, the barometric data drifts), drive from Irun (min), surface, event
AREAS = {
    'irun':      dict(alt=12,  drive=0),
    'lekeitio':  dict(alt=5,   drive=75),
    'menaka':    dict(alt=120, drive=80),
    'goierri':   dict(alt=160, drive=50),
    'itxassou':  dict(alt=50,  drive=40),
    'garazi':    dict(alt=160, drive=60),
    'campezo':   dict(alt=550, drive=100),
    'bardenas':  dict(alt=265, drive=120),
    'irati':     dict(alt=765, drive=110),
    'tourmalet': dict(alt=710, drive=150),
    'landes':    dict(alt=10,  drive=95),
    'cantabria': dict(alt=30,  drive=140),
    # sportives: you travel the day before, the drive is not part of the Sunday
    'roubaix':     dict(alt=30,  drive=0, surface='cobbles', event=True),
    'flanders':    dict(alt=15,  drive=0, surface='cobbles', event=True),
    'covadonga':   dict(alt=70,  drive=0, event=True),
    'irati_x':     dict(alt=765, drive=0, event=True),
    'baigorri':    dict(alt=160, drive=0, event=True),
    'leitza':      dict(alt=480, drive=0, event=True),
    'cantabria_x': dict(alt=30,  drive=0, event=True),
}

# Route catalogue: (id, kind, area, gpx activity id or None for stitched)
ROUTES = [
    ('hondarribia', 'home', 'irun', '5022098791'),
    ('jaizkibel', 'home', 'irun', '5884372205'),
    ('bera', 'home', 'irun', '11022990415'),
    ('ibardin', 'home', 'irun', '8282687736'),
    ('lesaka', 'home', 'irun', '6796586040'),
    ('ascain', 'home', 'irun', '20699078668'),
    ('aritxulegi', 'home', 'irun', '22609252498'),
    ('lizuniaga', 'home', 'irun', '9757485196'),
    ('zarautz', 'home', 'irun', '7199763970'),
    ('frenchcoast', 'home', 'irun', '5254179193'),
    ('sare', 'home', 'irun', '6944907956'),
    ('cincovillas', 'home', 'irun', '15570185517'),
    ('zizurkil', 'home', 'irun', '21374344221'),
    ('bigjaizkibel', 'home', 'irun', '15454814618'),
    ('goizueta', 'home', 'irun', '13687565977'),
    ('aizarotz', 'home', 'irun', '22667769662'),
    ('almandoz', 'home', 'irun', None),
    # car trips
    ('lekeitio', 'away', 'lekeitio', '11266337035'),
    ('menaka_short', 'away', 'menaka', '6465732591'),
    ('menaka_mid', 'away', 'menaka', '21439805088'),
    ('menaka_long', 'away', 'menaka', '16662853376'),
    ('ordizia', 'away', 'goierri', '11654680417'),
    ('beasain', 'away', 'goierri', '11603945240'),
    ('itxassou', 'away', 'itxassou', '13261128946'),
    ('garazi', 'away', 'garazi', '11523314240'),
    ('campezo', 'away', 'campezo', '6536052044'),
    ('bardenas_short', 'away', 'bardenas', '15645520993'),
    ('bardenas_long', 'away', 'bardenas', '15611453638'),
    ('irati_short', 'away', 'irati', '20513002122'),
    ('irati_mid', 'away', 'irati', '20498714774'),
    ('tourmalet', 'away', 'tourmalet', '11876925253'),
    ('landes', 'away', 'landes', '19843973869'),
    ('cantabria', 'away', 'cantabria', '7373241756'),
    # epic sportives
    ('roubaix', 'epic', 'roubaix', '22487685712'),
    ('flanders', 'epic', 'flanders', '14652433523'),
    ('covadonga', 'epic', 'covadonga', '19359449163'),
    ('irati_epic', 'epic', 'irati_x', '23236517610'),
    ('baigorri', 'epic', 'baigorri', '23153478579'),
    ('leitza', 'epic', 'leitza', '23477931513'),
    ('cantabria_epic', 'epic', 'cantabria_x', '7358114148'),
]

# Almandoz: no Irun loop reaches it.  Out-and-back stitched from three real rides.
STITCHED = {'almandoz': [('22404425723', 0, 1755), ('21201446693', 2311, 2178), ('5364771049', 0, 218)]}


def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    return 6371000 * math.hypot((lo2 - lo1) * math.cos((la1 + la2) / 2), la2 - la1)


def ts(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def load_gpx(path, with_time=False):
    s = open(path, encoding='utf-8').read()
    pts = re.findall(r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)">\s*(?:<ele>([-\d.]+)</ele>)?\s*(?:<time>([^<]+)</time>)?', s)
    name = re.search(r'<name>(.*?)</name>', s)
    out = []
    last = next((float(p[2]) for p in pts if p[2]), 0.0)
    for la, lo, el, tm in pts:
        e = float(el) if el else last
        last = e
        if with_time:
            out.append((float(la), float(lo), e, ts(tm) if tm else None))
        else:
            out.append((float(la), float(lo), e))
    return out, (name.group(1) if name else '')


def gpx_by_id(aid):
    f = glob.glob(os.path.join(GPX, '*_%s.gpx' % aid))
    if not f:
        sys.exit('missing gpx for activity %s' % aid)
    return f[0]


def stitched(spec):
    out, n_first = [], 0
    for aid, a, b in spec:
        pts, _ = load_gpx(gpx_by_id(aid))
        seg = pts[a:b + 1] if a <= b else pts[b:a + 1][::-1]
        out += seg
        n_first = n_first or len(out)
    back = out[n_first:][::-1]          # retrace everything after the first track's stretch
    first, _ = load_gpx(gpx_by_id(spec[0][0]))
    j = spec[0][2]
    far = max(range(len(first)), key=lambda i: dist(first[i], first[0]))
    k = min(range(far, len(first)), key=lambda i: dist(first[i], first[j]))
    return out + back + first[k:]


def resample(pts):
    clean = [pts[0]]
    for p in pts[1:]:
        if dist(p, clean[-1]) >= 3:
            clean.append(p)
    cum = [0.0]
    for i in range(1, len(clean)):
        cum.append(cum[-1] + dist(clean[i - 1], clean[i]))
    total = cum[-1]
    n = int(total // STEP) + 1
    res, j = [], 0
    for k in range(n):
        s = k * STEP
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = 0 if seg <= 0 else (s - cum[j]) / seg
        a, b = clean[j], clean[j + 1]
        res.append(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))
    return res, total


def smooth(vals, half):
    pre = [0.0]
    for v in vals:
        pre.append(pre[-1] + v)
    n = len(vals)
    return [(pre[min(n, i + half + 1)] - pre[max(0, i - half)]) / (min(n, i + half + 1) - max(0, i - half)) for i in range(n)]


def gain(ele, hyst=4.0):
    g, ref = 0.0, ele[0]
    for e in ele[1:]:
        if e > ref + hyst:
            g += e - ref
            ref = e
        elif e < ref:
            ref = e
    return g


def nearest(lst, p):
    best = min(lst, key=lambda t: dist(t[1], p))
    return best[0], dist(best[1], p)


def max_grade(ele, a, b):
    w, best = 8, 0.0
    for i in range(a, max(a + 1, b - w)):
        j = min(b, i + w)
        best = max(best, (ele[j] - ele[i]) / ((j - i) * STEP) * 100)
    return best


def find_climbs(ele, pts):
    """Climbs: rises of >= 60 m whose average from start to top is >= 3.5 %."""
    n, H = len(ele), 20
    turns, lo, hi, trend, ext = [], 0, 0, 0, 0
    for i in range(n):
        if trend == 0:
            if ele[i] > ele[hi]:
                hi = i
            if ele[i] < ele[lo]:
                lo = i
            if ele[hi] - ele[lo] > H:
                turns.append(min(lo, hi))
                trend, ext = (1, hi) if hi > lo else (-1, lo)
        elif trend == 1:
            if ele[i] > ele[ext]:
                ext = i
            elif ele[ext] - ele[i] > H:
                turns.append(ext)
                trend, ext = -1, i
        else:
            if ele[i] < ele[ext]:
                ext = i
            elif ele[i] - ele[ext] > H:
                turns.append(ext)
                trend, ext = 1, i
    turns.append(ext)
    climbs = []
    for a, b in zip(turns, turns[1:]):
        if ele[b] <= ele[a]:
            continue
        a = next((i for i in range(a, b) if (ele[b] - ele[i]) / ((b - i) * STEP) >= 0.035), b)
        if ele[b] - ele[a] < 60:
            continue
        length = (b - a) * STEP
        rise = ele[b] - ele[a]
        grade = rise / length * 100
        score = rise * grade
        cat = 'HC' if score >= 5000 else '1' if score >= 3000 else '2' if score >= 1600 else '3' if score >= 800 else '4'
        sname, sd = nearest(SUMMITS, pts[b])
        town, td = nearest(TOWNS, pts[b])
        c = dict(start=round(a * STEP), top=round(b * STEP), rise=round(rise), grade=round(grade, 1), cat=cat,
                 maxGrade=round(max_grade(ele, a, b), 1))
        if sd < 1500:
            c['name'] = sname
        else:
            c['near'] = town if td < 8000 else None
        if '--climbs' in sys.argv:
            print('   top', c.get('name') or c.get('near'), round(pts[b][0], 4), round(pts[b][1], 4), round(ele[b]))
        climbs.append(c)
    return climbs


# ---------------------------------------------------------------- stopping places
def detect_stops():
    """Cluster every pause (>= 3 min, < 4 h, moved < 300 m) in every ride."""
    events = []
    for f in sorted(glob.glob(os.path.join(GPX, '*.gpx'))):
        pts, _ = load_gpx(f, with_time=True)
        pts = [p for p in pts if p[3] is not None]
        if len(pts) < 50:
            continue
        for i in range(len(pts) - 1):
            dt = pts[i + 1][3] - pts[i][3]
            if 180 <= dt <= 4 * 3600 and dist(pts[i], pts[i + 1]) < 300:
                if dist(pts[i], pts[0]) < 1500 or dist(pts[i], pts[-1]) < 1500:
                    continue    # car park / home
                events.append((pts[i][0], pts[i][1], dt / 60.0))
    clusters = []
    for e in events:
        for c in clusters:
            if dist(c['c'], e) < 250:
                c['m'].append(e)
                n = len(c['m'])
                c['c'] = (sum(m[0] for m in c['m']) / n, sum(m[1] for m in c['m']) / n)
                break
        else:
            clusters.append({'c': (e[0], e[1]), 'm': [e]})
    stops = []
    for c in clusters:
        mins = sorted(m[2] for m in c['m'])
        med = mins[len(mins) // 2]
        if len(mins) < 2 and med < 15:
            continue
        stops.append(dict(c=c['c'], n=len(mins), med=med, type='bar' if med >= 12 else 'fountain'))
    if '--stops' in sys.argv:
        for s in sorted(stops, key=lambda s: -s['n']):
            print('stop %-8s n=%-2d %3d min  %-22s %s' % (s['type'], s['n'], round(s['med']), nearest(TOWNS, s['c']), s['c']))
    return stops


def route_stops(pts, total, kind, all_stops):
    out, taken = [], []
    for bid, bname, loc in BRIEF_BARS:
        i = min(range(len(pts)), key=lambda k: dist(pts[k], loc))
        if dist(pts[i], loc) < 300:
            out.append(dict(id=bid, type='bar', place=bname, at=round(i * STEP), brief=True))
            taken.append(i * STEP)
    cands = []
    for s in all_stops:
        if kind == 'home' and dist(s['c'], IRUN) < 3000:
            continue        # pauses at home, not a stop of the ride
        i = min(range(0, len(pts), 2), key=lambda k: dist(pts[k], s['c']))
        if dist(pts[i], s['c']) > 150:
            continue
        cands.append((s['n'] + (2 if s['med'] >= 20 else 0), i * STEP, s))
    cands.sort(key=lambda c: -c[0])
    limit = max(1, int(total / 15000))
    for score, at, s in cands:
        if len(out) >= limit + len([b for b in out if b.get('brief')]):
            break
        if at < 2000 or at > total - 2500 or any(abs(at - t) < 5000 for t in taken):
            continue
        town, td = nearest(TOWNS, s['c'])
        out.append(dict(id='s%d' % round(at), type='feed' if kind == 'epic' else s['type'],
                        place=town if td < 4000 else None, at=round(at), seen=s['n']))
        taken.append(at)
    if kind == 'away' and total > 40000 and not any(0.25 * total < t < 0.8 * total for t in taken):
        # no recorded stop: coffee in the town nearest to the middle of the loop
        best = min(range(int(0.35 * total / STEP), int(0.65 * total / STEP)), key=lambda k: nearest(TOWNS, pts[k])[1])
        town, td = nearest(TOWNS, pts[best])
        out.append(dict(id='mid', type='bar', place=town if td < 4000 else None, at=round(best * STEP)))
    if kind == 'home':
        out.append(dict(id='irun', type='bar', place='Irun', at=round(max(0, total - 900)), final=True))
    elif kind == 'away':
        out.append(dict(id='final', type='bar', place=None, at=round(max(0, total - 700)), final=True))
    if kind == 'epic':   # official feed stations roughly every 40 km
        feeds = [b['at'] for b in out]
        k = 40000
        while k < total - 15000:
            if not any(abs(f - k) < 15000 for f in feeds):
                town, td = nearest(TOWNS, pts[int(k / STEP)])
                out.append(dict(id='f%d' % k, type='feed', place=town if td < 4000 else None, at=k))
            k += 40000
    out.sort(key=lambda b: b['at'])
    return out


def build_route(rid, kind, area, aid, all_stops):
    if aid is None:
        raw, date = stitched(STITCHED[rid]), 'stitched'
    else:
        f = gpx_by_id(aid)
        raw, _ = load_gpx(f)
        date = os.path.basename(f)[:10]
    pts, total = resample(raw)
    ele = smooth([p[2] for p in pts], 6)
    # barometric altitude drifts by up to hundreds of metres: pin start (and finish on loops)
    # to the known altitude of the start
    alt, n = AREAS[area]['alt'], len(ele)
    e0, e1 = sum(ele[:8]) / 8, sum(ele[-8:]) / 8
    if dist(pts[0], pts[-1]) < 3000:
        ele = [v - (e0 + (e1 - e0) * i / (n - 1)) + alt for i, v in enumerate(ele)]
    else:
        ele = [v - e0 + alt for v in ele]
    ele = [max(0.0, v) for v in ele]
    o = MEET if kind == 'home' else pts[0]
    cosl = math.cos(math.radians(o[0]))
    xs = [round((p[1] - o[1]) * math.radians(1) * 6371000 * cosl) for p in pts]
    ys = [round((p[0] - o[0]) * math.radians(1) * 6371000) for p in pts]
    scen = []
    for i in range(0, len(pts), 20):
        p = pts[i]
        if min(dist(p, c) for c in COAST) < 1600 and ele[i] < 200:
            scen.append('c')
        elif nearest(TOWNS, p)[1] < 700:
            scen.append('t')
        elif ele[i] > 350:
            scen.append('m')
        else:
            scen.append('f')
    a = AREAS[area]
    return dict(id=rid, kind=kind, area=area, drive=a['drive'], surface=a.get('surface'), date=date,
                km=round(total / 1000, 1), gain=round(gain(ele)), maxEle=round(max(ele)),
                step=STEP, x=xs, y=ys, e=[round(v * 10) for v in ele],
                bars=route_stops(pts, total, kind, all_stops), climbs=find_climbs(ele, pts), scenery=''.join(scen))


def main():
    os.makedirs(OUT, exist_ok=True)
    all_stops = detect_stops()
    routes = []
    for rid, kind, area, aid in ROUTES:
        r = build_route(rid, kind, area, aid, all_stops)
        routes.append(r)
        print('%-15s %-5s %-10s %6.1f km %5d m+  stops: %s' % (
            rid, kind, area, r['km'], r['gain'],
            ', '.join('%s:%s@%.0f' % (b['type'][0], b['place'] or '?', b['at'] / 1000) for b in r['bars'])))
    routes.sort(key=lambda r: (['home', 'away', 'epic'].index(r['kind']), r['km']))
    areas = {k: dict(drive=v['drive'], event=bool(v.get('event'))) for k, v in AREAS.items()}
    with open(os.path.join(OUT, 'routes.js'), 'w') as f:
        f.write('// Generated by tools/build_routes.py from inputs/gpx. Do not edit.\n')
        f.write('window.AREAS = ' + json.dumps(areas, separators=(',', ':')) + ';\n')
        f.write('window.ROUTES = ' + json.dumps(routes, separators=(',', ':'), ensure_ascii=False) + ';\n')
    print('wrote data/routes.js (%d routes)' % len(routes))


if __name__ == '__main__':
    main()
