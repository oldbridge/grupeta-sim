#!/usr/bin/env python3
"""Sync the riders in config/players.js with inputs/player_stats.ods.

config/players.js is what the game reads (edit it directly to add / remove riders, change
colours, portraits, taglines...).  This tool is optional: it copies the stats from the
spreadsheet into it.

  python3 tools/import_players.py              update stats of riders in the sheet, add new ones
  python3 tools/import_players.py --prune      ...and remove riders that are no longer in the sheet
  python3 tools/import_players.py --check      only validate config/players.js

Colours, portraits, taglines and other extra fields of existing riders are kept.
Sheet columns (case-insensitive): Name, Endurance, Sprint, Fitness, Competitiveness,
Clumsiness, Weight, Gender (M/F).
"""
import colorsys, hashlib, json, os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, 'config', 'players.js')
SHEET = os.path.join(ROOT, 'inputs', 'player_stats.ods')
STATS = ['endurance', 'sprint', 'fitness', 'competitiveness', 'clumsiness']

HEADER = """// Riders of Igandeko Irteera — edit this file and reload the game.  No build needed.
//
// Add a rider: copy a block.  Remove a rider: delete the block.  Order = order on screen.
// Everything after "window.PLAYERS_CONFIG =" must stay valid JSON (double quotes, no
// trailing commas, no comments inside) so tools/import_players.py can update it.
//
// Per rider:
//   name                 unique; it is also the key for careers and relationships
//   endurance, sprint, fitness, competitiveness, clumsiness    0..100
//   weight               kg (heavy: more watts on the flat, slower uphill)
//   gender               "m" or "f" (texts and pixel art)
//   colors               optional: jersey, trim, bike, helmet, hair ("#rrggbb"); generated if missing
//   portrait             optional image path relative to index.html, e.g. "config/portraits/xabi.jpg"
//                        (png / jpg / webp / gif).  Empty: a pixel-art face in the rider's colours.
//   tagline              optional: {"en": "...", "eu": "..."}; generated from the stats if missing
//   favouriteStops       optional: stop ids the rider loves (e.g. "almandoz", "zizurkil", "bera")
//   badSleeper           optional 0..1: chance of sleeping badly and dropping out on Sunday morning
//
// Global:
//   portraitStyle        "pixel" (photos are pixelated to match the game) or "photo"
//   everybodyLikes       stop ids every rider is happy to ride to
"""


def read_config(path=CONFIG):
    s = open(path, encoding='utf-8').read()
    m = re.search(r'window\.PLAYERS_CONFIG\s*=\s*(\{.*\})\s*;?\s*$', s, re.S)
    if not m:
        sys.exit('config/players.js: could not find "window.PLAYERS_CONFIG = {...};"')
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError as e:
        sys.exit('config/players.js is not valid JSON after "=": %s' % e)


def write_config(cfg, path=CONFIG):
    lines = [HEADER, 'window.PLAYERS_CONFIG =\n{\n']
    top = {k: v for k, v in cfg.items() if k != 'players'}
    for k, v in top.items():
        lines.append('  %s: %s,\n' % (json.dumps(k), json.dumps(v, ensure_ascii=False)))
    lines.append('  "players": [\n')
    blocks = []
    for p in cfg['players']:
        parts = []
        for k, v in p.items():
            parts.append('      %s: %s' % (json.dumps(k), json.dumps(v, ensure_ascii=False)))
        blocks.append('    {\n' + ',\n'.join(parts) + '\n    }')
    lines.append(',\n'.join(blocks) + '\n  ]\n};\n')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(''.join(lines))


def colors_for(name):
    h = int(hashlib.md5(name.encode()).hexdigest(), 16)
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, 0.5, 0.65)
    hexc = lambda r, g, b: '#%02x%02x%02x' % (int(r * 255), int(g * 255), int(b * 255))
    return {'jersey': hexc(r, g, b), 'trim': '#ffffff', 'bike': '#2a2a2a', 'helmet': '#ffffff',
            'hair': ['#2b1b12', '#3b2a1e', '#5a3a1a', '#222222', '#777777'][h % 5]}


def read_ods(path):
    with zipfile.ZipFile(path) as z:
        xml = z.read('content.xml').decode('utf-8')
    table = re.search(r'<table:table .*?</table:table>', xml, re.S).group(0)
    rows = []
    for row in re.findall(r'<table:table-row[^>]*>(.*?)</table:table-row>', table, re.S):
        cells = []
        for m in re.finditer(r'<table:table-cell([^>]*?)(/>|>(.*?)</table:table-cell>)', row, re.S):
            attrs, body = m.group(1), m.group(3) or ''
            rep = re.search(r'number-columns-repeated="(\d+)"', attrs)
            cells += [re.sub(r'<[^>]+>', '', body).strip()] * (min(int(rep.group(1)), 30) if rep else 1)
        while cells and not cells[-1]:
            cells.pop()
        if cells:
            rows.append(cells)
    return rows


def sheet_players():
    rows = read_ods(SHEET)
    head = [h.strip().lower() for h in rows[0]]
    out = []
    for r in rows[1:]:
        rec = dict(zip(head, r + [''] * (len(head) - len(r))))
        if not rec.get('name'):
            continue
        p = {'name': rec['name'].strip()}
        for k in STATS + ['weight']:
            if rec.get(k):
                p[k] = int(float(rec[k]))
        if rec.get('gender'):
            p['gender'] = 'f' if rec['gender'].strip().upper().startswith('F') else 'm'
        out.append(p)
    return out


def check(cfg):
    problems, names = [], set()
    for i, p in enumerate(cfg.get('players', [])):
        n = p.get('name')
        if not n:
            problems.append('rider #%d has no name' % (i + 1)); continue
        if n in names:
            problems.append('duplicate name: %s' % n)
        names.add(n)
        for k in STATS:
            v = p.get(k)
            if not isinstance(v, (int, float)) or not 0 <= v <= 100:
                problems.append('%s: %s should be a number 0..100 (is %r)' % (n, k, v))
        if not isinstance(p.get('weight'), (int, float)) or not 35 <= p['weight'] <= 160:
            problems.append('%s: weight should be kg between 35 and 160' % n)
        if str(p.get('gender', '')).strip().lower()[:1] not in ('m', 'f'):
            problems.append('%s: gender should be "m" or "f"' % n)
        por = p.get('portrait')
        if por and not os.path.exists(os.path.join(ROOT, por)):
            problems.append('%s: portrait file not found: %s' % (n, por))
    return problems


def main():
    if '--check' in sys.argv:
        cfg = read_config()
        probs = check(cfg)
        print('\n'.join(probs) if probs else 'config/players.js OK: %d riders' % len(cfg['players']))
        sys.exit(1 if probs else 0)
    cfg = read_config() if os.path.exists(CONFIG) else {'portraitStyle': 'pixel', 'everybodyLikes': [], 'players': []}
    have = {p['name']: p for p in cfg['players']}
    sheet = sheet_players()
    added, updated = [], []
    for sp in sheet:
        if sp['name'] in have:
            have[sp['name']].update(sp)
            updated.append(sp['name'])
        else:
            np = {'name': sp['name'], 'endurance': 50, 'sprint': 50, 'fitness': 50, 'competitiveness': 50,
                  'clumsiness': 40, 'weight': 70, 'gender': 'm'}
            np.update(sp)
            np['colors'] = colors_for(sp['name'])
            np['portrait'] = ''
            cfg['players'].append(np)
            added.append(sp['name'])
    removed = []
    if '--prune' in sys.argv:
        keep = {sp['name'] for sp in sheet}
        removed = [p['name'] for p in cfg['players'] if p['name'] not in keep]
        cfg['players'] = [p for p in cfg['players'] if p['name'] in keep]
    write_config(cfg)
    print('updated %d, added %s, removed %s' % (len(updated), added or 'none', removed or 'none'))
    for pr in check(cfg):
        print('warning:', pr)


if __name__ == '__main__':
    main()
