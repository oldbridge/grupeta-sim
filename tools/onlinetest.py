"""Two friends online at the same time (needs config/online.js and build/accounts.txt).
   python3 tools/onlinetest.py"""
import os, re, time, threading, functools, http.server
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'shots'); os.makedirs(OUT, exist_ok=True)
PW = dict(re.findall(r'^(\S.*?)\s{2,}(\S+)$', open(os.path.join(ROOT, 'build', 'accounts.txt')).read(), re.M))
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8777), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []

def login(b, name):
    ctx = b.new_context(viewport={'width': 1280, 'height': 860})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'{name}: {e}'))
    pg.on('console', lambda m: errors.append(f'{name}: {m.text}') if m.type == 'error' else None)
    pg.goto('http://localhost:8777/index.html?fast=1'); pg.wait_for_selector('.login-pw', timeout=20000)
    for c in pg.query_selector_all('.login-card'):
        if c.inner_text().strip() == name: c.click()
    pg.fill('.login-pw', 'wrong'); pg.keyboard.press('Enter'); time.sleep(2)
    wrong = pg.inner_text('.login-err')
    pg.fill('.login-pw', PW[name]); pg.keyboard.press('Enter')
    pg.wait_for_selector('.choice', timeout=20000); time.sleep(0.5)
    return pg, wrong

def choose(pg, rx):
    for c in pg.query_selector_all('.choice'):
        if re.search(rx, c.inner_text()): c.click(); time.sleep(0.6); return True
    return False

with sync_playwright() as p:
    b = p.chromium.launch()
    a, wrong = login(b, 'Xabi')
    print('wrong password ->', wrong)
    print('Xabi title menu:', [c.inner_text().split('\n')[1] for c in a.query_selector_all('.choice')])
    bb, _ = login(b, 'Peio')
    choose(a, 'Altzola'); choose(bb, 'Altzola'); time.sleep(3)
    print('Xabi sees:', a.inner_text('.stage-sub'))
    bb.fill('.tab-input', 'Aupa Xabi! Gaur Jaizkibel? 💪'); bb.keyboard.press('Enter'); time.sleep(2.5)
    print('Xabi chat:', [m.inner_text().replace('\n', ' | ') for m in a.query_selector_all('.tab-msg')][-2:])
    a.screenshot(path=os.path.join(OUT, 'taberna_xabi.png'))
    rows = a.query_selector_all('.tab-rider')
    print('rider rows:', len(rows), '|', rows[0].inner_text().replace('\n', ' | '))
    for r in rows:
        if r.inner_text().startswith('Peio'): r.click(); break
    time.sleep(2); a.screenshot(path=os.path.join(OUT, 'taberna_profile.png'))
    # Peio leaves the game: Xabi must see him go offline
    bb.close(); time.sleep(5)
    print('after Peio closes:', a.inner_text('.stage-sub'))
    # lock: Xabi can only ride as Xabi
    a.keyboard.press('Escape'); time.sleep(1); choose(a, 'New Sunday'); time.sleep(1)
    for c in a.query_selector_all('.rider-card'):
        if c.inner_text().startswith('Peio'): c.click(); break
    time.sleep(0.4)
    print('ride button on Peio:', a.inner_text('.btn.primary.big'), '| disabled =', a.eval_on_selector('.btn.primary.big', 'b => b.disabled'))
    b.close()
srv.shutdown()
print('\n'.join(errors) or 'no console errors')
