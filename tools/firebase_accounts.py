#!/usr/bin/env python3
"""Create one Firebase login per rider in config/players.js (online mode).

Each rider gets <key>@<emailDomain> with a simple Basque cycling word as password.  The list is
printed and written to build/accounts.txt (git-ignored) so you can hand the passwords out.

  python3 tools/firebase_accounts.py            create missing accounts
  python3 tools/firebase_accounts.py --check    only try to sign in with build/accounts.txt

Existing accounts are left alone (their password can't be read back); delete a user in the
Firebase console (Authentication > Users) and run this again to give it a new password.
"""
import json, os, random, re, sys, unicodedata, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# password words: one per line in config/password_words.txt (git-ignored, so not published)
WORDS_FILE = os.path.join(ROOT, 'config', 'password_words.txt')


def online_cfg():
    s = open(os.path.join(ROOT, 'config', 'online.js'), encoding='utf-8').read()
    get = lambda k: re.search(k + r"\s*:\s*'([^']+)'", s).group(1)
    return get('apiKey'), get('emailDomain')


def riders():
    s = open(os.path.join(ROOT, 'config', 'players.js'), encoding='utf-8').read()
    cfg = json.loads(re.search(r'window\.PLAYERS_CONFIG\s*=\s*(\{.*\})\s*;?\s*$', s, re.S).group(1))
    names = [p['name'] for p in cfg['players']]
    local = os.path.join(ROOT, 'config', 'players.local.js')
    if os.path.exists(local):
        ls = open(local, encoding='utf-8').read()
        extra = json.loads(re.search(r'window\.PLAYERS_LOCAL\s*=\s*(\{.*\})\s*;?\s*$', ls, re.S).group(1)).get('players', {})
        names += [n for n in extra if n not in names]
    return names


def key(name):   # same as Net.key in js/net.js
    s = unicodedata.normalize('NFD', name)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', '_', s).strip('_')


def call(api_key, op, body):
    req = urllib.request.Request('https://identitytoolkit.googleapis.com/v1/accounts:%s?key=%s' % (op, api_key),
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        return json.load(e)


def main():
    api_key, domain = online_cfg()
    out = os.path.join(ROOT, 'build', 'accounts.txt')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if '--check' in sys.argv:
        for line in open(out, encoding='utf-8'):
            m = re.match(r'(.+?)\s{2,}(\S+)\s*$', line.rstrip())
            if not m or m.group(1) == 'Rider':
                continue
            r = call(api_key, 'signInWithPassword', {'email': key(m.group(1)) + '@' + domain, 'password': m.group(2), 'returnSecureToken': True})
            print('%-14s %s' % (m.group(1), 'OK' if 'idToken' in r else r.get('error', {}).get('message')))
        return
    if not os.path.exists(WORDS_FILE):
        sys.exit('put one password word per line in config/password_words.txt')
    words = [w.strip() for w in open(WORDS_FILE, encoding='utf-8') if w.strip() and len(w.strip()) >= 6]
    random.shuffle(words)
    rows = []
    for name in riders():
        pw = words.pop()
        r = call(api_key, 'signUp', {'email': key(name) + '@' + domain, 'password': pw, 'returnSecureToken': True})
        if 'idToken' in r:
            rows.append((name, pw))
        else:
            msg = r.get('error', {}).get('message', '?')
            rows.append((name, '(exists)' if msg == 'EMAIL_EXISTS' else '(error: %s)' % msg))
            words.append(pw)
    text = 'Rider           Password\n' + ''.join('%-14s  %s\n' % r for r in rows)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)
    print(text + '\nwritten to build/accounts.txt')


if __name__ == '__main__':
    main()
