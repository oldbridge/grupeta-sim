"""Save / load round trip in a real browser:
   play to the ride, save in slot 2, quit to the menu, Continue (autosave), check the
   ride resumes at the same km; then reload the page and load slot 2.
   python3 tools/savetest.py"""
import os, re, time, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'shots'); os.makedirs(OUT, exist_ok=True)
errors = []

def run():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1280, 'height': 900})
        pg = ctx.new_page()
        pg.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        url = f'file://{ROOT}/index.html?fast=1&seed=3'
        pg.goto(url); time.sleep(1)
        def labels(sel): return pg.eval_on_selector_all(sel, 'els => els.map(e => [e.innerText, e.disabled || e.classList.contains("disabled")])')
        def click(sel, rx):
            for i, (t, d) in enumerate(labels(sel)):
                if not d and re.search(rx, t, re.I):
                    pg.query_selector_all(sel)[i].click(); time.sleep(0.25); return True
            return False
        # quick path to the ride
        t0 = time.time()
        while not pg.query_selector('.ride') and time.time() - t0 < 120:
            if pg.query_selector('.rider-grid'):
                pg.keyboard.press('Enter'); time.sleep(0.4); continue
            if pg.query_selector('.wa-reply'):
                click('.wa-reply', 'Ride from Irun') or click('.wa-reply', '08:30') or click('.wa-reply', 'Good night') or click('.wa-reply', '.'); time.sleep(0.4); continue
            if labels('.choice'):
                txt = ' '.join(t for t, _ in labels('.choice'))
                if 'Hondarribia coffee' in txt: click('.choice', 'Jaizkibel'); continue
                (click('.choice', 'New Sunday') or click('.choice', r"Let.s ride") or click('.choice', 'Propose a route') or click('.choice', 'Go with') or click('.choice', r'\bDone') or click('.choice', '.'))
                continue
            pg.keyboard.press('Enter'); time.sleep(0.15)
        time.sleep(1)
        for _ in range(3): pg.keyboard.press('ArrowRight'); time.sleep(0.1)
        time.sleep(6)
        km_before = pg.evaluate('() => G.currentSim.player.s')
        pg.keyboard.press(' '); time.sleep(0.4)          # pause
        click('.modal .btn', 'Save game'); time.sleep(0.4)
        pg.screenshot(path=os.path.join(OUT, 'save_menu.png'))
        click('.modal .btn', 'Slot 2'); time.sleep(0.4)
        km_saved = pg.evaluate('() => G.currentSim.player.s')
        pg.keyboard.press(' '); time.sleep(0.4)
        click('.modal .btn', 'quit'); time.sleep(1)
        pg.screenshot(path=os.path.join(OUT, 'title_continue.png'))
        assert click('.choice', 'Continue'), 'no Continue on the title'
        time.sleep(1.5)
        km_cont = pg.evaluate('() => G.currentSim.player.s')
        print(f'km before save {km_before/1000:.2f}, saved {km_saved/1000:.2f}, after Continue {km_cont/1000:.2f}')
        pg.screenshot(path=os.path.join(OUT, 'resumed.png'))
        # reload and load slot 2
        pg.goto(url); time.sleep(1)
        click('.choice', 'Load game'); time.sleep(0.4)
        pg.screenshot(path=os.path.join(OUT, 'load_menu.png'))
        click('.modal .btn', 'Slot 2'); time.sleep(1.5)
        km_slot = pg.evaluate('() => G.currentSim && G.currentSim.player.s')
        print(f'after reload + load slot 2: {km_slot/1000:.2f} km (saved {km_saved/1000:.2f})')
        ok = abs(km_slot - km_saved) < 600 and abs(km_cont - km_saved) < 1500
        print('ROUND TRIP', 'OK' if ok else 'MISMATCH')
        b.close()
run()
print('\n'.join(errors) or 'no console errors')
