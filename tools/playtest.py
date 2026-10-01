"""Headless play-through with Playwright.  An autopilot answers every dialogue with sensible
choices, rides the route at high game speed and saves screenshots to build/shots/.

    python3 tools/playtest.py [route name substring] [seed] [rider]
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'shots')
os.makedirs(OUT, exist_ok=True)
ROUTE = sys.argv[1] if len(sys.argv) > 1 else 'Jaizkibel'
SEED = sys.argv[2] if len(sys.argv) > 2 else '7'
RIDER = sys.argv[3] if len(sys.argv) > 3 else 'Xabi'
W, H = int(os.environ.get('W', 1280)), int(os.environ.get('H', 900))

errors, shots = [], set()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': W, 'height': H})
        pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        lang = os.environ.get('GAMELANG', 'en')
        pg.goto(f'file://{ROOT}/index.html?fast=1&seed={SEED}&lang={lang}' + ('&nolocal=1' if os.environ.get('NOLOCAL') else ''))
        time.sleep(1)

        def L(key, rx):
            if lang == 'en':
                return rx
            txt = pg.evaluate('(k) => { const v = G.tr(k); return typeof v === "string" ? v : null }', key)
            return re.escape(txt.split('{')[0].strip()) if txt else rx

        def shot(name):
            pg.screenshot(path=os.path.join(OUT, name + '.png'))
            shots.add(name)

        def labels(sel):
            return pg.eval_on_selector_all(sel, 'els => els.map(e => [e.innerText, e.disabled || e.classList.contains("disabled")])')

        def click_label(sel, rx):
            for i, (t, dis) in enumerate(labels(sel)):
                if not dis and re.search(rx, t, re.I):
                    pg.query_selector_all(sel)[i].click()
                    time.sleep(0.25)
                    return t
            return None

        talked = 0
        started = time.time()
        ride_t0 = None
        last_header = ''
        n = 0
        while time.time() - started < float(os.environ.get('TMAX', 240)):
            n += 1
            header = pg.eval_on_selector('.stage-title', 'e => e.innerText') if pg.query_selector('.stage-title') else ''
            if pg.query_selector('.ride'):
                header = 'RIDE'
            if os.environ.get('DEBUG'): print('top', n, header, bool(pg.query_selector('.ride')), bool(pg.query_selector('.wa-reply')), len(labels('.choice')))
            if header != last_header:
                last_header = header
                time.sleep(0.4)
                shot(f'{n:03d}_' + re.sub(r'\W+', '_', header)[:30])
            if pg.query_selector('.modal'):
                title = pg.eval_on_selector('.modal-title', 'e => e.innerText')
                if os.environ.get('SAVETEST') and 'Paused' in title and not getattr(main, 'saved', False):
                    main.saved = True
                    pg.keyboard.press('2'); time.sleep(0.4); shot(f'{n:03d}_save_menu'); pg.keyboard.press('1'); time.sleep(0.4)
                    continue
                shot(f'{n:03d}_modal_' + re.sub(r'\W+', '_', title)[:20])
                if 'Paused' in title:
                    pg.keyboard.press('1')
                else:
                    pg.keyboard.press('1')
                time.sleep(0.3)
                continue
            if pg.query_selector('.ride'):
                if ride_t0 is None:
                    ride_t0 = time.time()
                    time.sleep(1.5)
                    shot('ride_start')
                    for _ in range(2):
                        pg.keyboard.press('ArrowRight'); time.sleep(0.1)   # x60
                    pg.keyboard.press('ArrowRight')
                el = time.time() - ride_t0
                if 6 < el < 7: shot('ride_6s')
                if 20 < el < 21: shot('ride_20s')
                if os.environ.get('CRASHTEST') and 8 < el < 9.1:
                    pg.evaluate("() => { const s = G.currentSim, g = s.player.g, r = g && g.members.find(m => !m.isPlayer); if (r) s._crash(r, g); }")
                if os.environ.get('CRASHTEST') and 18 < el < 19.1:
                    pg.evaluate("() => { const s = G.currentSim; if (s.player.g && !s.pending) s._crash(s.player, s.player.g); }")
                if os.environ.get('SAVETEST') and 12 < el < 13.1 and not getattr(main, 'paused', False):
                    main.paused = True; pg.keyboard.press(' '); time.sleep(0.4); continue
                if os.environ.get('FOOT') and 10 < el < 11.1:
                    pg.keyboard.press('f'); time.sleep(0.4); shot(f'{n:03d}_foot_menu'); pg.keyboard.press('1'); time.sleep(0.3)
                if os.environ.get('ASKBAR') and int(el) % 8 == 0: pg.keyboard.press('b'); time.sleep(0.2)
                # play a bit: eat and drink when low
                st = pg.evaluate('''() => { const t = document.querySelectorAll('.p-you .bar-val'); return [...t].map(x => +x.innerText) }''')
                if st and len(st) >= 3:
                    if st[0] < 55: pg.keyboard.press('e')
                    if st[2] < 55: pg.keyboard.press('d')
                time.sleep(1.0)
                continue
            if pg.query_selector('.rider-grid'):
                cards = labels('.rider-card')
                for i, (t, _) in enumerate(cards):
                    if t.split('\n')[0].strip() == RIDER:
                        pg.query_selector_all('.rider-card')[i].click(); time.sleep(0.2)
                        cs = pg.query_selector_all('.rider-card')
                        if cs: cs[i].click()
                        break
                time.sleep(0.5)
                continue
            if pg.query_selector('.wa-reply'):
                trip = os.environ.get('TRIP', 'home')
                first = {'home': L('wa.opt_home', r'Ride from Irun'), 'away': L('wa.opt_car', r'Car trip'), 'epic': L('wa.opt_epic', r'Epic sportive'), 'join': L('wa.opt_join', r'Join')}[trip]
                (click_label('.wa-reply', first) or click_label('.wa-reply', ROUTE) or click_label('.wa-reply', r'08:30')
                 or click_label('.wa-reply', L('wa.good_night', r'Good night')) or click_label('.wa-reply', L('wa.sleep', r'sleep')) or click_label('.wa-reply', r'.'))
                time.sleep(0.6)
                continue
            if pg.query_selector('.perk'):
                pg.query_selector('.perk').click(); time.sleep(0.3); continue
            if pg.query_selector('.res-table'):
                shot('results')
                break
            chs = labels('.choice')
            if chs:
                txt = ' | '.join(t for t, _ in chs)
                pick = None
                prefs = [L('title.new', r'New Sunday'), L('morning.two_bidons', r'Two bidons'), L('morning.sleep_ride', r'Ride anyway')]
                if re.search(L('morning.add_bar', r'Add an energy bar'), txt):
                    used = pg.eval_on_selector('.dlg-text', 'e => e.innerText')
                    m = re.search(r'\((\d)/(\d)\)', used)
                    if m and int(m.group(1)) < 2: prefs = [L('morning.add_bar', r'Add an energy bar')]
                    elif m and int(m.group(1)) < int(m.group(2)): prefs = [L('morning.add_banana', r'Add a banana')]
                    else: prefs = [L('common.done', r'\bDone')]
                if re.search(L('meet.talk', r'Talk to someone'), txt):
                    ride_ok = any(re.search(L('meet.go', r"Let.s ride"), t) and not d for t, d in chs)
                    prefs = ([L('meet.talk', r'Talk to someone')] if talked < 1 and ride_ok else []) + [L('meet.go', r'Let.s ride'), L('meet.propose', r'Propose a route'), L('bar.go', r'Let.s go')]
                if re.search(L('bar.go', r'Let.s go'), txt) and not re.search(L('meet.talk', r'Talk to someone'), txt): prefs = [L('bar.go', r'Let.s go')]
                if re.search(L('taunt.provoke.label', r'Provoke'), txt): prefs = [L('taunt.challenge.label', r'Challenge'), L('taunt.provoke.label', r'Provoke')]; talked += 1
                if re.search(L('meet.go_with', r'Go with those') + '|' + L('meet.accept_counter', r'Accept their idea'), txt): prefs = [L('meet.go_with', r'Go with those'), L('meet.accept_counter', r'Accept their idea'), L('meet.go_alone', r'Do it alone')]
                if re.search(L('morning.leave', r'Leave home'), txt): prefs = [L('morning.leave', r'Leave home')]
                if ROUTE and re.search(L('common.back_arrow', r'back'), txt) and re.search(r'km', txt) and re.search(ROUTE, txt, re.I):
                    prefs = [ROUTE]
                    shot(f'{n:03d}_route_list')
                for rx in prefs:
                    pick = click_label('.choice', rx)
                    if pick: break
                if not pick:
                    pick = click_label('.choice', r'.')
                if os.environ.get('DEBUG'): print('   prefs', prefs, 'pick', repr(pick), 'txt', txt[:120].replace(chr(10), '/'))
                time.sleep(0.3)
                continue
            if os.environ.get('DEBUG'): print('loop', n, header, 'hint=', pg.eval_on_selector('.dlg-hint', 'e => e.innerText') if pg.query_selector('.dlg-hint') else None)
            if pg.query_selector('.dlg-hint') and '▼' in (pg.eval_on_selector('.dlg-hint', 'e => e.innerText') or ''):
                pg.keyboard.press('Enter'); time.sleep(0.15)
                continue
            time.sleep(0.3)
        b.close()
    print('\n'.join(errors) or 'no console errors')
    print('shots:', len(shots))


main()
