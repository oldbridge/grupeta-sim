// WhatsApp-style group chat panel.
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  const el = G.el;

  class Phone {
    constructor(opt) {
      opt = opt || {};
      this.sub = el('div', { class: 'wa-sub', text: opt.sub || '' });
      this.baseSub = opt.sub || '';
      this.body = el('div', { class: 'wa-body' });
      this.foot = el('div', { class: 'wa-foot' }, [el('div', { class: 'wa-input', text: G.t('wa.message') }), el('div', { class: 'wa-mic', text: '🎤' })]);
      this.clock = el('span', { class: 'wa-clock', text: opt.clock || '21:30' });
      this.el = el('div', { class: 'phone' }, [
        el('div', { class: 'wa-status' }, [this.clock, el('span', { text: '▂▄▆ 📶 🔋' })]),
        el('div', { class: 'wa-head' }, [
          el('span', { class: 'wa-back', text: '←' }),
          el('div', { class: 'wa-avatar', text: '🚴' }),
          el('div', { class: 'wa-titles' }, [el('div', { class: 'wa-title', text: opt.title || '' }), this.sub]),
          el('span', { class: 'wa-icons', text: '📹 📞 ⋮' }),
        ]),
        this.body,
        this.foot,
      ]);
      if (opt.date) this.day(opt.date);
    }
    setClock(t) { this.clock.textContent = t; }
    day(text) { this.body.appendChild(el('div', { class: 'wa-day', text })); }
    system(text) { this.body.appendChild(el('div', { class: 'wa-system', text })); this._scroll(); }
    msg(from, text, opt) {
      opt = opt || {};
      const mine = !!opt.mine;
      const b = el('div', { class: 'wa-msg ' + (mine ? 'mine' : 'theirs') }, [
        !mine && from ? el('div', { class: 'wa-from', text: from, style: { color: opt.color || '#1f7a8c' } }) : null,
        el('div', { class: 'wa-text', text }),
        el('div', { class: 'wa-meta', text: (opt.time || '') + (mine ? ' ✓✓' : '') }),
      ]);
      if (!mine && opt.avatar) {
        this.body.appendChild(el('div', { class: 'wa-row' }, [opt.avatar, b]));
      } else this.body.appendChild(b);
      this._scroll();
      return b;
    }
    async typing(name, ms) {
      this.sub.textContent = G.t('wa.typing', { n: name });
      this.sub.classList.add('typing');
      await G.wait(ms || 700);
      this.sub.textContent = this.baseSub;
      this.sub.classList.remove('typing');
    }
    // quick replies in place of the keyboard; returns the chosen value
    replies(items, opt) {
      opt = opt || {};
      return new Promise((resolve) => {
        this.foot.innerHTML = '';
        this.foot.classList.add('choices');
        if (opt.prompt) this.foot.appendChild(el('div', { class: 'wa-prompt', text: opt.prompt }));
        let sel = 0;
        const bs = items.map((it, i) => {
          const b = el('button', { class: 'wa-reply' + (it.disabled ? ' disabled' : ''), disabled: it.disabled ? 'disabled' : null }, [
            el('span', { class: 'kbd', text: String(i + 1) }), ' ' + it.label]);
          b.addEventListener('click', () => !it.disabled && pick(i));
          this.foot.appendChild(b);
          return b;
        });
        const paint = () => bs.forEach((b, i) => b.classList.toggle('sel', i === sel));
        paint();
        const keys = (e) => {
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= items.length && !items[n - 1].disabled) { pick(n - 1); return true; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { sel = (sel + 1) % items.length; paint(); return true; }
          if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { sel = (sel - 1 + items.length) % items.length; paint(); return true; }
          if (e.key === 'Enter') { if (!items[sel].disabled) pick(sel); return true; }
          return false;
        };
        G.UI.pushKeys(keys);
        const pick = (i) => {
          G.UI.popKeys(keys);
          this.foot.classList.remove('choices');
          this.foot.innerHTML = '';
          this.foot.append(el('div', { class: 'wa-input', text: G.t('wa.message') }), el('div', { class: 'wa-mic', text: '🎤' }));
          resolve(items[i].value);
        };
      });
    }
    _scroll() { this.body.scrollTop = this.body.scrollHeight; }
  }
  G.Phone = Phone;
})();
