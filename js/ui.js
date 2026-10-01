// Screen framework: RPG dialogue box, choices, modals, toasts and a keyboard stack.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const UI = {};
  const el = G.el;

  // ---- keyboard: the top handler gets the keys
  const keyStack = [];
  UI.pushKeys = (fn) => { keyStack.push(fn); return () => UI.popKeys(fn); };
  UI.popKeys = (fn) => { const i = keyStack.lastIndexOf(fn); if (i >= 0) keyStack.splice(i, 1); };
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const h = keyStack[keyStack.length - 1];
    if (h && h(e) !== false) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(e.key)) e.preventDefault();
    }
  });

  UI.root = () => G.$('#screen');
  UI.show = function (node) {
    const root = UI.root();
    root.innerHTML = '';
    root.appendChild(node);
    window.scrollTo(0, 0);
    return node;
  };

  // ---- a scene (pixel canvas + overlay for crisp labels) above a dialogue box
  UI.sceneScreen = function (opt) {
    opt = opt || {};
    const cv = G.Art.newCanvas(opt.w, opt.h);
    const overlay = el('div', { class: 'scene-overlay' });
    const side = opt.side ? el('div', { class: 'scene-side' }) : null;
    const scene = el('div', { class: 'scene' }, [cv, overlay]);
    const top = el('div', { class: 'scene-row' + (side ? ' with-side' : '') }, [scene, side]);
    const dlg = new UI.Dialog();
    const header = el('div', { class: 'stage-header' }, [
      el('span', { class: 'stage-tag', text: opt.tag || '' }),
      el('span', { class: 'stage-title', text: opt.title || '' }),
      el('span', { class: 'stage-sub', text: opt.sub || '' }),
      opt.extra || null,
    ]);
    const root = el('div', { class: 'stage' }, [header, top, dlg.el]);
    UI.show(root);
    return { root, canvas: cv, overlay, dlg, side, header };
  };

  // ---- RPG dialogue box
  class Dialog {
    constructor() {
      this.name = el('div', { class: 'dlg-name' });
      this.text = el('div', { class: 'dlg-text' });
      this.choices = el('div', { class: 'dlg-choices' });
      this.hint = el('div', { class: 'dlg-hint' });
      this.el = el('div', { class: 'dlg' }, [this.name, this.text, this.choices, this.hint]);
    }
    clear() { this.name.textContent = ''; this.text.textContent = ''; this.choices.innerHTML = ''; this.hint.textContent = ''; this.name.style.display = 'none'; }
    // typewriter text; resolves when the player clicks / presses a key
    say(who, text, opt) {
      opt = opt || {};
      this.choices.innerHTML = '';
      this.name.style.display = who ? '' : 'none';
      this.name.textContent = who || '';
      this.name.style.background = opt.color || '';
      this.text.textContent = '';
      this.hint.textContent = '';
      return new Promise((resolve) => {
        let i = 0, done = false, timer = null;
        const full = () => { done = true; clearInterval(timer); this.text.textContent = text; this.hint.textContent = opt.noWait ? '' : G.t('ui.continue_hint'); };
        const finish = () => { UI.popKeys(keys); this.el.removeEventListener('click', click); resolve(); };
        const keys = (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z') { if (!done) full(); else finish(); return true; }
          return false;
        };
        const click = () => { if (!done) full(); else finish(); };
        if (G.fastText) { full(); if (opt.noWait) { resolve(); return; } }
        else {
          timer = setInterval(() => {
            i += 2;
            this.text.textContent = text.slice(0, i);
            if (i >= text.length) { full(); if (opt.noWait) resolve(); }
          }, 16);
        }
        if (opt.noWait) return;
        UI.pushKeys(keys);
        this.el.addEventListener('click', click);
      });
    }
    // list of choices: [{label, value, hint, disabled}] -> Promise(value)
    choose(items, opt) {
      opt = opt || {};
      if (opt.prompt !== undefined) { this.name.style.display = opt.who ? '' : 'none'; this.name.textContent = opt.who || ''; this.text.textContent = opt.prompt; }
      this.choices.innerHTML = '';
      this.choices.className = 'dlg-choices' + (opt.cols ? ' cols' : '');
      this.hint.textContent = G.t('ui.choose_hint');
      return new Promise((resolve) => {
        let sel = items.findIndex((it) => !it.disabled);
        const btns = items.map((it, i) => {
          const b = el('button', { class: 'choice' + (it.disabled ? ' disabled' : ''), disabled: it.disabled ? 'disabled' : null }, [
            el('span', { class: 'choice-key', text: i < 9 ? String(i + 1) : '' }),
            el('span', { class: 'choice-label', text: it.label }),
            it.hint ? el('span', { class: 'choice-hint', text: it.hint }) : null,
          ]);
          b.addEventListener('click', () => { if (!it.disabled) pick(i); });
          b.addEventListener('mouseenter', () => { if (!it.disabled) { sel = i; paint(); if (opt.onFocus) opt.onFocus(it.value); } });
          this.choices.appendChild(b);
          return b;
        });
        const paint = () => btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
        const move = (d) => {
          for (let k = 0; k < items.length; k++) {
            sel = (sel + d + items.length) % items.length;
            if (!items[sel].disabled) break;
          }
          paint();
          if (opt.onFocus) opt.onFocus(items[sel].value);
        };
        const pick = (i) => { UI.popKeys(keys); this.choices.innerHTML = ''; this.hint.textContent = ''; resolve(items[i].value); };
        const keys = (e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight' && opt.cols) { move(1); return true; }
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' && opt.cols) { move(-1); return true; }
          if (e.key === 'Enter' || e.key === ' ') { if (sel >= 0) pick(sel); return true; }
          if (e.key === 'Escape' && opt.cancel !== undefined) { UI.popKeys(keys); this.choices.innerHTML = ''; resolve(opt.cancel); return true; }
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= items.length && !items[n - 1].disabled) { pick(n - 1); return true; }
          return false;
        };
        UI.pushKeys(keys);
        paint();
        if (opt.onFocus && sel >= 0) opt.onFocus(items[sel].value);
      });
    }
  }
  UI.Dialog = Dialog;

  // ---- modal popup (used during the ride)
  UI.modal = function (title, body, buttons, opt) {
    opt = opt || {};
    return new Promise((resolve) => {
      const box = el('div', { class: 'modal ' + (opt.kind || '') + (opt.vertical ? ' vertical' : '') }, [
        el('div', { class: 'modal-title', text: title }),
        typeof body === 'string' ? el('div', { class: 'modal-body', text: body }) : el('div', { class: 'modal-body' }, body),
      ]);
      const row = el('div', { class: 'modal-buttons' });
      let sel = buttons.findIndex((b) => !b.disabled);
      const bs = buttons.map((b, i) => {
        const x = el('button', { class: 'btn' + (i === 0 && !opt.vertical ? ' primary' : '') + (b.disabled ? ' disabled' : ''), disabled: b.disabled ? 'disabled' : null }, [el('span', { class: 'kbd', text: String(i + 1) }), ' ' + b.label]);
        x.addEventListener('click', () => { if (!b.disabled) done(b.value); });
        row.appendChild(x);
        return x;
      });
      box.appendChild(row);
      const back = el('div', { class: 'modal-back' }, [box]);
      document.body.appendChild(back);
      const paint = () => bs.forEach((b, i) => b.classList.toggle('sel', i === sel));
      paint();
      const move = (d) => { for (let k = 0; k < bs.length; k++) { sel = (sel + d + bs.length) % bs.length; if (!buttons[sel].disabled) break; } paint(); };
      const keys = (e) => {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= buttons.length && !buttons[n - 1].disabled) { done(buttons[n - 1].value); return true; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { move(1); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { move(-1); return true; }
        if (e.key === 'Enter') { if (sel >= 0) done(buttons[sel].value); return true; }
        if (e.key === 'Escape' && opt.cancel !== undefined) { done(opt.cancel); return true; }
        return true;   // swallow everything else while the modal is open
      };
      UI.pushKeys(keys);
      function done(v) { UI.popKeys(keys); back.remove(); resolve(v); }
    });
  };

  UI.toast = function (text, kind) {
    let box = G.$('#toasts');
    if (!box) { box = el('div', { id: 'toasts' }); document.body.appendChild(box); }
    const t = el('div', { class: 'toast ' + (kind || ''), text });
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  };

  // horizontal stat bar
  UI.bar = function (value, max, cls, label) {
    const pct = G.clamp((value / (max || 100)) * 100, 0, 100);
    return el('div', { class: 'bar ' + (cls || '') }, [
      label ? el('span', { class: 'bar-label', text: label }) : null,
      el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill', style: { width: pct + '%' } })]),
      el('span', { class: 'bar-val', text: String(Math.round(value)) }),
    ]);
  };

  // animate a canvas scene with a draw(t) function until stop() is called
  UI.animate = function (draw) {
    let run = true;
    const t0 = performance.now();
    const loop = (now) => { if (!run) return; draw((now - t0) / 1000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return () => { run = false; };
  };

  // rider avatar: the portrait image from config/players.js (pixelated or as a photo), or a
  // procedural pixel face in the rider's colours
  UI.avatar = function (name, size) {
    const p = G.playerByName(name);
    const look = G.lookOf(name), gender = p ? p.gender : 'm';
    const seedN = [...String(name)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const cv = G.Art.newCanvas(32, 32);
    cv.className = 'pix portrait';
    cv.title = name;
    if (size) cv.style.width = cv.style.height = size + 'px';
    const c = cv.getContext('2d');
    G.Art.portrait(c, look, seedN, gender);
    const src = p && p.portrait;
    if (!src) return cv;
    if (G.portraitStyle === 'photo') {
      const img = el('img', { class: 'portrait photo', alt: name, title: name, src });
      if (size) img.style.width = img.style.height = size + 'px';
      img.addEventListener('error', () => img.replaceWith(cv));
      return img;
    }
    const draw = () => {
      // photos get a bit more resolution than the 32x32 faces so friends stay recognisable
      cv.width = cv.height = 40;
      const c = cv.getContext('2d');
      const im = rec.img, s = Math.min(im.naturalWidth, im.naturalHeight);
      // square crop, biased to the top of the picture where faces usually are
      const sx = (im.naturalWidth - s) / 2, sy = Math.max(0, (im.naturalHeight - s) * 0.25);
      c.imageSmoothingEnabled = true;
      c.drawImage(im, sx, sy, s, s, 0, 0, 40, 40);
    };
    const rec = G.portraitImage(src, draw);
    if (rec && rec.ok) draw();
    return cv;
  };
  UI.portrait = (look, i, size, gender, name) => UI.avatar(name, size);

  G.UI = UI;
})();
