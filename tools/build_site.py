#!/usr/bin/env python3
"""Build a password-protected single page of the game for GitHub Pages.

The whole game (HTML, CSS, JS, routes, all languages and, optionally, the private
portraits from config/players.local.js) is inlined into one HTML document, gzipped and
encrypted with AES-256-GCM.  The key comes from the password with PBKDF2-SHA256
(600 000 iterations, random salt).  The published build/site/index.html contains only the
encrypted blob and a small unlock form; the browser decrypts it with WebCrypto.

  python3 tools/build_site.py                     asks for the password, writes build/site/
  python3 tools/build_site.py --with-portraits    also packs config/players.local.js + photos
  python3 tools/build_site.py --deploy            ...and force-pushes it to the gh-pages branch
  GRUPETA_PASSWORD=... python3 tools/build_site.py --deploy      (non-interactive)

This is client-side protection: anyone with the password can open the game, and the
strength depends on the password.  It is not server-side access control.
"""
import base64, getpass, gzip, json, mimetypes, os, re, secrets, shutil, subprocess, sys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'site')
ITER = 600_000
REMOTE = 'git@github.com:oldbridge/grupeta-sim.git'


def read(rel):
    return open(os.path.join(ROOT, rel), encoding='utf-8').read()


def data_uri(rel):
    path = os.path.join(ROOT, rel)
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())


def bundle(with_portraits):
    html = read('index.html')
    safe = lambda js: js.replace('</script', '<\\/script')
    # stylesheet
    html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>\n%s\n</style>' % read('css/style.css'))
    # every <script src> inlined, plus all language files and (optionally) the local riders
    extra = []
    for f in sorted(os.listdir(os.path.join(ROOT, 'i18n'))):
        if f.endswith('.js') and f not in ('en.js', 'languages.js'):
            extra.append('i18n/' + f)
    local = ''
    if with_portraits and os.path.exists(os.path.join(ROOT, 'config/players.local.js')):
        local = read('config/players.local.js')
        for rel in set(re.findall(r'"(config/portraits/[^"]+)"', local)):
            if os.path.exists(os.path.join(ROOT, rel)):
                local = local.replace('"%s"' % rel, '"%s"' % data_uri(rel))
            else:
                print('warning: portrait not found, skipped:', rel)

    def inline(m):
        src = m.group(1)
        out = '<script>\n%s\n</script>' % safe(read(src))
        if src == 'i18n/en.js':
            out += ''.join('\n<script>\n%s\n</script>' % safe(read(x)) for x in extra)
        if src == 'config/players.js' and local:
            out += '\n<script>\n%s\n</script>' % safe(local)
        return out

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    left = re.findall(r'src="(?!data:)([^"]+\.js)"', html)
    if left:
        sys.exit('not inlined: %s' % left)
    return html


def encrypt(plain, password):
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode('utf-8'))
    ct = AESGCM(key).encrypt(iv, gzip.compress(plain.encode('utf-8'), 9), None)
    b64 = lambda b: base64.b64encode(b).decode()
    return {'salt': b64(salt), 'iv': b64(iv), 'iter': ITER, 'data': b64(ct)}


GATE = r"""<!doctype html>
<html lang="eu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Igandeko Irteera</title>
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; min-height: 100vh; background: #12141b; color: #e8ecf3; font-family: system-ui, sans-serif; }
  body { display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
  form { width: 100%; max-width: 380px; background: #0b0d14; border: 3px solid #e8ecf3; border-radius: 10px; padding: 22px; box-shadow: 0 10px 40px #000; }
  h1 { font-family: 'Press Start 2P', monospace; font-size: 15px; color: #ffd23f; margin: 0 0 6px; line-height: 1.5; }
  p { font-family: 'VT323', monospace; font-size: 21px; margin: 0 0 14px; color: #c9d0dc; }
  input[type=password] { width: 100%; box-sizing: border-box; font-size: 17px; padding: 10px 12px; border-radius: 6px; border: 1px solid #2c3346; background: #1d2230; color: #fff; }
  label { display: flex; gap: 8px; align-items: center; font-size: 13px; color: #8a93a6; margin: 10px 0 14px; }
  button { width: 100%; padding: 11px; font-size: 16px; font-weight: 700; border: 0; border-radius: 8px; background: #ff7a45; color: #1a0e08; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  .err { color: #ff5f56; min-height: 20px; font-size: 14px; margin-top: 10px; }
</style>
</head>
<body>
<form id="f" autocomplete="on">
  <h1>🚴 IGANDEKO IRTEERA</h1>
  <p>Pasahitza / Password</p>
  <input type="password" id="pw" autocomplete="current-password" autofocus required>
  <label><input type="checkbox" id="keep" checked> Gogoratu gailu honetan / Remember on this device</label>
  <button id="go">Sartu / Enter ▶</button>
  <div class="err" id="err"></div>
</form>
<script>
const BOX = __BOX__;
const KEY = 'grupeta.sitekey';
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function open(rawKey) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(BOX.iv) }, key, b64(BOX.data));
  const html = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  document.open(); document.write(html); document.close();
}
async function derive(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(BOX.salt), iterations: BOX.iter }, base, 256));
}
(async () => {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved) { try { await open(b64(saved)); return; } catch (e) { try { localStorage.removeItem(KEY); } catch (_) {} } }
})();
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const go = document.getElementById('go'), err = document.getElementById('err');
  go.disabled = true; err.textContent = '…';
  try {
    const raw = await derive(document.getElementById('pw').value);
    if (document.getElementById('keep').checked) {
      try { localStorage.setItem(KEY, btoa(String.fromCharCode(...raw))); } catch (_) {}
    }
    await open(raw);
  } catch (e2) {
    err.textContent = 'Pasahitz okerra / Wrong password';
    go.disabled = false;
  }
});
</script>
</body>
</html>
"""


def deploy():
    run = lambda *a: subprocess.run(a, cwd=OUT, check=True, stdout=subprocess.DEVNULL)
    shutil.rmtree(os.path.join(OUT, '.git'), ignore_errors=True)
    run('git', 'init', '-q', '-b', 'gh-pages')
    run('git', 'add', '-A')
    run('git', 'commit', '-q', '-m', 'Encrypted build of the game for GitHub Pages')
    subprocess.run(['git', 'push', '-f', REMOTE, 'gh-pages'], cwd=OUT, check=True)


def main():
    pw = os.environ.get('GRUPETA_PASSWORD')
    if not pw:
        pw = getpass.getpass('Site password: ')
        if pw != getpass.getpass('Repeat: '):
            sys.exit('passwords differ')
    if len(pw) < 8:
        sys.exit('use at least 8 characters')
    html = bundle('--with-portraits' in sys.argv)
    box = encrypt(html, pw)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(GATE.replace('__BOX__', json.dumps(box)))
    open(os.path.join(OUT, '.nojekyll'), 'w').close()
    print('build/site/index.html: %d KB game -> %d KB encrypted page' % (len(html) // 1024, os.path.getsize(os.path.join(OUT, 'index.html')) // 1024))
    if '--deploy' in sys.argv:
        deploy()
        print('pushed to gh-pages: https://oldbridge.github.io/grupeta-sim/')


if __name__ == '__main__':
    main()
