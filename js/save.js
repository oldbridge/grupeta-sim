// Saving: three manual slots + an autosave in localStorage, and save files you can download
// and load back (the safest way to keep a career across browsers).  A save holds the career
// (levels, perks, relationships), the current Sunday and, mid-ride, the whole simulation.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const Save = {};
  Save.SLOTS = ['1', '2', '3'];
  Save.VERSION = 2;

  Save.payload = function (stJSON, simJSON, label) {
    return {
      game: 'igandeko-irteera', v: Save.VERSION, savedAt: new Date().toISOString(), label: label || '',
      career: G.store.get('career', {}), st: stJSON, sim: simJSON || null,
    };
  };
  Save.write = (slot, p) => { G.store.set('save.' + slot, p); if (slot === 'auto' && G.Net && G.Net.me) G.Net.pushSave(p); };
  Save.read = (slot) => {
    const p = G.store.get('save.' + slot, null);
    return p && p.game === 'igandeko-irteera' ? p : null;
  };
  Save.remove = (slot) => {
    try { localStorage.removeItem('irunride.save.' + slot); } catch (e) { /* ignore */ }
    if (slot === 'auto' && G.Net && G.Net.me) G.Net.clearSave();
  };
  Save.describe = function (p) {
    if (!p) return G.t('save.empty');
    const d = new Date(p.savedAt);
    const when = isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    return `${p.label || '—'} · ${when}`;
  };
  Save.download = function (p) {
    try {
      const blob = new Blob([JSON.stringify(p)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'igandeko-irteera-' + p.savedAt.slice(0, 16).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return true;
    } catch (e) { return false; }
  };
  Save.pickFile = function () {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) { resolve(null); return; }
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const p = JSON.parse(rd.result);
            resolve(p && p.game === 'igandeko-irteera' ? p : null);
          } catch (e) { resolve(null); }
        };
        rd.onerror = () => resolve(null);
        rd.readAsText(f);
      };
      inp.click();
    });
  };
  G.Save = Save;
})();
