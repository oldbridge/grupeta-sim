// Online layer (Firebase Authentication + Realtime Database), used when config/online.js exists.
// Every rider has an account <key>@<emailDomain>; the database rules (database.rules.json) let a
// rider write only their own nodes.  Data:
//   profiles/<key>   public card: level, rides, km, sportiveness, last ride...
//   careers/<key>    career JSON string (levels, perks, relationships) - follows you across devices
//   saves/<key>      latest autosave (JSON string) - continue on another device
//   rides/<key>/<id> ride registry (summary fields + JSON detail)
//   presence/<key>   online flag, where in the game, last seen, last tavern visit
//   chat/<id>        tavern chat (text, brags)
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  let cfg = null;
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const Net = { enabled: false, me: null, ready: false };
  Net.setup = () => { cfg = window.ONLINE_CONFIG || null; Net.enabled = !!(cfg && cfg.firebase && cfg.firebase.apiKey); return Net.enabled; };
  G.Net = Net;
  let db = null, auth = null, TS = null;

  Net.key = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const email = (name) => Net.key(name) + '@' + ((cfg && cfg.emailDomain) || 'grupeta.invalid');

  const load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('cannot load ' + src));
    document.head.appendChild(s);
  });

  // load the SDK, restore a previous session (resolves with the rider name or null)
  Net.init = async function () {
    if (!Net.enabled) return null;
    for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-database-compat.js']) await load(SDK + f);
    const app = window.firebase.initializeApp(cfg.firebase);
    auth = app.auth(); db = app.database();
    TS = window.firebase.database.ServerValue.TIMESTAMP;
    Net.ready = true;
    const user = await new Promise((resolve) => { const off = auth.onAuthStateChanged((u) => { off(); resolve(u); }); });
    if (user) await signedIn(user);
    return Net.me;
  };

  function nameFromUser(user) {
    const key = (user.email || '').split('@')[0];
    const p = (window.PLAYERS || []).find((x) => Net.key(x.name) === key);
    return p ? p.name : null;
  }
  async function signedIn(user) {
    Net.me = nameFromUser(user);
    if (!Net.me) { await auth.signOut(); return; }
    startPresence();
  }

  Net.login = async function (name, password) {
    const cred = await auth.signInWithEmailAndPassword(email(name), password);
    await signedIn(cred.user);
    return Net.me;
  };
  Net.logout = async function () {
    if (presRef) await presRef.update({ online: false, last: TS });
    if (connRef) connRef.off();
    Net.me = null;
    await auth.signOut();
  };

  // ---- presence
  let presRef = null, connRef = null, where = { where: 'menu', detail: '' };
  function startPresence() {
    presRef = db.ref('presence/' + Net.key(Net.me));
    connRef = db.ref('.info/connected');
    connRef.on('value', (snap) => {
      if (!snap.val()) return;
      presRef.onDisconnect().update({ online: false, last: TS }).then(() => presRef.update(Object.assign({ online: true, last: TS, name: Net.me }, where)));
    });
  }
  Net.setWhere = function (w, detail) {
    where = { where: w, detail: detail || '' };
    if (presRef) presRef.update(Object.assign({ online: true, last: TS }, where)).catch(() => {});
  };
  Net.markTaberna = () => presRef && presRef.update({ taberna: TS }).catch(() => {});

  // ---- career, profile, saves
  const mine = (node) => db.ref(node + '/' + Net.key(Net.me));
  Net.getCareerOf = async (name) => { const v = (await db.ref('careers/' + Net.key(name)).once('value')).val(); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  Net.getCareer = async () => { const v = (await mine('careers').once('value')).val(); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
  Net.pushCareer = (car) => Net.me && mine('careers').set(JSON.stringify(car)).catch((e) => console.warn('net', e));
  Net.pushProfile = (prof) => Net.me && mine('profiles').update(Object.assign({ name: Net.me, updated: TS }, prof)).catch((e) => console.warn('net', e));
  let saveTimer = null, pendingSave = null;
  Net.pushSave = function (payload) {
    if (!Net.me) return;
    pendingSave = payload;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      mine('saves').set(JSON.stringify(pendingSave)).catch((e) => console.warn('net', e));
    }, 4000);
  };
  Net.clearSave = () => Net.me && mine('saves').remove().catch(() => {});
  Net.getSave = async () => { const v = (await mine('saves').once('value')).val(); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };

  // ---- rides
  Net.addRide = async function (rec) {
    const ref = mine('rides').push();
    await ref.set(Object.assign({}, rec, { ts: TS, detail: JSON.stringify(rec.detail || {}) }));
    return ref.key;
  };
  Net.getRides = async function (name, limit) {
    const snap = await db.ref('rides/' + Net.key(name)).orderByChild('ts').limitToLast(limit || 30).once('value');
    const out = [];
    snap.forEach((c) => { const v = c.val(); v.id = c.key; out.push(v); });
    return out.reverse();
  };
  Net.getRide = async function (name, id) {
    const v = (await db.ref('rides/' + Net.key(name) + '/' + id).once('value')).val();
    if (!v) return null;
    v.id = id;
    try { v.detail = JSON.parse(v.detail); } catch (e) { v.detail = {}; }
    return v;
  };

  // ---- live data for the tavern
  const watch = (path, cb, q) => {
    const ref = q ? q(db.ref(path)) : db.ref(path);
    const h = ref.on('value', (s) => cb(s.val() || {}));
    return () => ref.off('value', h);
  };
  Net.watchProfiles = (cb) => watch('profiles', cb);
  Net.watchPresence = (cb) => watch('presence', cb);
  Net.watchChat = function (cb, limit) {
    const ref = db.ref('chat').orderByChild('ts').limitToLast(limit || 80);
    const h = ref.on('value', (s) => { const out = []; s.forEach((c) => { const v = c.val(); v.id = c.key; out.push(v); }); cb(out); });
    return () => ref.off('value', h);
  };
  Net.sendChat = (text, extra) => db.ref('chat').push(Object.assign({ k: Net.key(Net.me), n: Net.me, text: String(text).slice(0, 600), ts: TS }, extra || {}));
})();
