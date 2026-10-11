/* Pixel Touchdown: js/ui/modal.js
 * Owner: WP5. Responsibility: PT.UI.Modal (open/confirm/choose → Promise), PT.UI.Toast, busy overlay.
 *   Modal.open({ title, body, buttons:[{label, value, kind, testid, icon, disabled}], icon, cls, art,
 *                mount(cardEl), collect(cardEl, value) → resolved value, actions:{name(el, cardEl)}, dismiss=true,
 *                closeX (corner X button, testid modal-x) })
 *   First 'go'/'pri' (or first) button gets data-testid="modal-ok", a value===false/null or kind 'cancel' gets
 *   "modal-cancel", unless a testid is given. Esc / tapping the backdrop resolves the cancel value.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom;
  const stack = [];
  let root = null, toastRoot = null;

  function host() {
    if (!root) root = (UI._roots && UI._roots.modal) || globalThis.document.getElementById('modal');
    return root;
  }
  function tHost() {
    if (!toastRoot) toastRoot = (UI._roots && UI._roots.toast) || globalThis.document.getElementById('toast');
    return toastRoot;
  }

  function cancelValue(o) {
    const b = (o.buttons || []).find((x) => x.kind === 'cancel' || x.value === false || x.value === null);
    return b ? b.value : null;
  }

  const Modal = UI.Modal = UI.Modal || {};
  const isCancel = (b) => (b.kind === 'cancel' || b.value === false || b.value === null ? 1 : 0);

  Modal.open = function (o) {
    o = o || {};
    return new Promise((resolve) => {
      const h = host();
      if (!h) { resolve((o.buttons && o.buttons[0] && o.buttons[0].value) || null); return; }
      const btns = o.buttons || [{ label: 'OK', value: true, kind: 'go' }];
      let okGiven = false;
      const okIdx = Math.max(0, btns.findIndex((b) => b.kind === 'go' || b.kind === 'pri'));
      // UI_RULES 9: secondary/cancel on the left, primary on the right (render order only; data-i keeps the index)
      const order = btns.map((b, i) => i);
      if (btns.length === 2) order.sort((a, b) => (isCancel(btns[b]) - isCancel(btns[a])));
      const bHtml = order.map((i) => {
        const b = btns[i];
        let tid = b.testid;
        if (!tid && i === okIdx && !okGiven) { tid = 'modal-ok'; okGiven = true; }
        else if (!tid && (b.kind === 'cancel' || b.value === false || b.value === null)) tid = 'modal-cancel';
        else if (!tid) tid = 'modal-btn-' + i;
        return UI.comp.btn({ label: b.label, icon: b.icon, sub: b.sub, kind: b.kind === 'cancel' ? 'ghost' : (b.kind || (i === okIdx ? 'go' : 'sec')),
          size: b.size || 'l', testid: tid, disabled: b.disabled, action: 'm-btn', data: { i: i } });
      });
      const wrap = globalThis.document.createElement('div');
      wrap.className = 'mwrap' + (o.cls ? ' ' + o.cls : '');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML = String(D().html`<div class="mback" data-action="m-back"></div>
        <div class="mcard" tabindex="-1">
          ${o.closeX ? UI.comp.btn({ icon: 'x', action: 'm-back', kind: 'ghost', size: 's', title: 'Close', testid: 'modal-x', cls: 'mx' }) : ''}
          ${o.art ? D().html`<div class="mart">${o.art}</div>` : ''}
          ${o.icon ? D().html`<div class="micon">${UI.comp.ic(o.icon)}</div>` : ''}
          ${o.title ? D().html`<h2 class="mtitle">${o.title}</h2>` : ''}
          ${o.body != null && o.body !== '' ? D().html`<div class="mbody">${D().isRaw(o.body) ? o.body : D().html`<p>${o.body}</p>`}</div>` : ''}
          <div class="mbtns ${btns.length > 2 ? 'stack' : ''}">${bHtml}</div>
        </div>`);
      h.appendChild(wrap);
      h.classList.add('on');
      const card = wrap.querySelector('.mcard');
      const prevFocus = globalThis.document.activeElement;
      const entry = {
        wrap: wrap, o: o,
        close: function (v) {
          const i = stack.indexOf(entry);
          if (i < 0) return;
          stack.splice(i, 1);
          wrap.classList.add('out');
          wrap.remove();
          if (!stack.length) h.classList.remove('on');
          if (prevFocus && prevFocus.focus && globalThis.document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
          if (PT.Events) PT.Events.emit('ui:modal', { open: stack.length > 0 });
          let val = v;
          if (o.collect) { try { val = o.collect(card, v); } catch (e) { PT.Log && PT.Log.error && PT.Log.error('ui', 'modal collect', e); } }
          resolve(val);
        },
        cancel: function () { if (o.dismiss === false) return; entry.close(cancelValue(o)); }
      };
      stack.push(entry);
      wrap.addEventListener('click', (ev) => {
        const t = ev.target.closest('[data-action]');
        if (!t || !wrap.contains(t)) return;
        const a = t.getAttribute('data-action');
        if (a === 'pg' && UI.pgClick && UI.pgClick(t)) { ev.stopPropagation(); return; }
        if (a === 'm-back') { entry.cancel(); return; }
        if (a === 'm-btn') {
          const b = btns[+t.getAttribute('data-i')];
          if (b && !b.disabled) { UI.click && UI.click(b.kind === 'cancel' ? 'back' : 'tap'); entry.close(b.value); }
          return;
        }
        if (o.actions && o.actions[a]) { ev.stopPropagation(); o.actions[a](t, card, entry); }
      });
      if (o.change) wrap.addEventListener('input', (ev) => o.change(ev.target, card, entry));
      if (o.mount) { try { o.mount(card, entry); } catch (e) { PT.Log && PT.Log.error && PT.Log.error('ui', 'modal mount', e); } }
      if (UI.fit) { try { UI.fit(wrap); } catch (e) { /* ignore */ } }
      const first = card.querySelector('[data-testid="modal-ok"]') || card.querySelector('button:not([disabled])');
      try { (o.focus === false ? card : first || card).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      if (PT.Events) PT.Events.emit('ui:modal', { open: true });
    });
  };

  Modal.confirm = function (text, opts) {
    opts = opts || {};
    return Modal.open({ title: opts.title || text, body: opts.title ? text : opts.body, icon: opts.icon || 'question',
      buttons: [{ label: opts.yes || 'Yes', value: true, kind: opts.danger ? 'bad' : 'go' }, { label: opts.no || 'Cancel', value: false, kind: 'cancel' }] });
  };
  /** choose(title, [{label, value, icon, sub}], opts) → Promise<value|null> */
  Modal.choose = function (title, options, opts) {
    opts = opts || {};
    return Modal.open({ title: title, body: opts.body, icon: opts.icon, cls: 'm-choose',
      buttons: options.map((x, i) => ({ label: x.label, value: x.value, icon: x.icon, sub: x.sub, kind: x.kind || (i === 0 ? 'go' : 'sec'), testid: x.testid, disabled: x.disabled }))
        .concat(opts.noCancel ? [] : [{ label: 'Cancel', value: null, kind: 'cancel' }]) });
  };
  Modal.alert = (title, body, icon) => Modal.open({ title: title, body: body, icon: icon, buttons: [{ label: 'OK', value: true, kind: 'go' }] });
  Modal.isOpen = () => stack.length > 0;
  Modal.top = () => stack[stack.length - 1] || null;
  /** close the top modal with its cancel value (Esc) */
  Modal.cancelTop = function () { const t = Modal.top(); if (t) { t.cancel(); return true; } return false; };
  Modal.closeAll = function () { while (stack.length) stack[stack.length - 1].close(cancelValue(stack[stack.length - 1].o)); };

  /** Busy overlay (simming). Returns { set(text), close() }. */
  Modal.busy = function (text) {
    const h = host();
    const el = globalThis.document.createElement('div');
    el.className = 'mwrap busy';
    el.setAttribute('data-testid', 'busy');
    el.innerHTML = String(D().html`<div class="mback"></div><div class="mcard busy-card"><div class="hopper" aria-hidden="true">${UI.comp.ic('football')}</div><p class="busy-t">${text || 'Working…'}</p></div>`);
    if (h) { h.appendChild(el); h.classList.add('on'); }
    return {
      set: (t) => { const p = el.querySelector('.busy-t'); if (p) p.textContent = t; },
      close: () => { el.remove(); if (h && !stack.length && !h.querySelector('.mwrap')) h.classList.remove('on'); }
    };
  };

  // ---------------- Toast ----------------
  // At most 2 visible; the rest wait in a short queue. A toast with the same text as a visible/queued one is merged
  // ("×3" badge, timer restarted). Big sims that fire many toasts collapse into a few.
  const Toast = UI.Toast = UI.Toast || {};
  const ICON = { good: 'check', bad: 'warn', info: 'chat', coin: 'coin', xp: 'star', ach: 'trophy', hurt: 'cross' };
  const MAX_VIS = 1, MAX_Q = 3;
  const vis = [], queue = [], held = [];
  // HUNT #53: no toasts over the Fired ("Big News") screen; they wait and show after you leave it
  const HOLD_ON = { fired: 1 };
  function holding() {
    let cur = null;
    try { cur = UI.current && UI.current(); } catch (e) { cur = null; }
    if (cur && HOLD_ON[cur.name]) return true;
    const s = globalThis.document && globalThis.document.getElementById('screen');
    return !!(s && HOLD_ON[s.getAttribute('data-screen')]);
  }
  function hideT(item) {
    if (!item || item.out) return;                   // HUNT #3: a second hide used to pull an extra item off the queue
    item.out = true;
    clearTimeout(item.timer);
    item.el.classList.add('out');
    setTimeout(() => { item.el.remove(); }, 260);
    const i = vis.indexOf(item);
    if (i >= 0) vis.splice(i, 1);
    if (queue.length) setTimeout(() => { if (vis.length >= MAX_VIS) return; const n = queue.shift(); if (n) showNow(n); }, 120);
  }
  function arm(item) { clearTimeout(item.timer); item.timer = setTimeout(() => hideT(item), item.ms); }
  function paint(item) {
    item.el.innerHTML = String(D().html`<span class="toast-ic">${UI.comp.ic(ICON[item.kind] || ICON.info)}</span><span class="toast-t">${UI.comp.txt(item.text)}</span>${item.n > 1 && item.kind !== 'ach' ? D().html`<span class="toast-n">×${item.n}</span>` : ''}`);
  }
  function showNow(item) {
    if (!item) return;
    const h = tHost();
    if (!h) return;
    // HUNT3 #7: no crossfade overlap — a toast that is fading out goes away now
    Array.prototype.forEach.call(h.querySelectorAll('.toast.out'), (n) => n.remove());
    const d = globalThis.document.createElement('div');
    d.className = 'toast toast-' + item.kind;
    d.setAttribute('data-testid', 'toast');
    d.setAttribute('role', 'status');
    item.el = d;
    paint(item);
    h.appendChild(d);
    vis.push(item);
    arm(item);
  }
  Toast.show = function (text, kind, ms) {
    if (!text || !tHost()) return;
    kind = kind || 'info';
    text = String(text);
    // HUNT3-audio #4: let the audio side react (error sound on 'bad'); fired for every request, merged or not
    try { if (PT.Events && PT.Events.emit) PT.Events.emit('ui:toast', { kind: kind, text: text }); } catch (e) { /* ignore */ }
    const key = kind + '|' + text;                   // HUNT #16: exact text (no '×3' for levels 2, 3, 4)
    // HUNT #15: badge toasts collapse into one ("3 new badges")
    if (kind === 'ach') {
      const a = vis.find((x) => x.kind === 'ach' && !x.out) || queue.find((x) => x.kind === 'ach');
      if (a) { a.n++; a.text = a.n + ' new badges'; a.key = 'ach|*'; if (a.el) { paint(a); arm(a); } return; }
    }
    const same = vis.find((x) => x.key === key) || queue.find((x) => x.key === key);
    if (same) {
      same.n++; same.text = text;
      if (same.el) { paint(same); arm(same); }
      return;
    }
    const item = { key: key, text: text, kind: kind, ms: ms || 2200, n: 1, el: null, timer: 0 };
    if (holding()) {
      const h = held.find((x) => x.key === key);
      if (h) h.n++; else held.push(item);
      while (held.length > MAX_Q) held.shift();
      return;
    }
    if (vis.length < MAX_VIS) { showNow(item); return; }
    queue.push(item);
    while (queue.length > MAX_Q) queue.shift();       // drop the oldest waiting ones
    // speed up the oldest visible toast so the queue drains
    const old = vis[0];
    if (old) { clearTimeout(old.timer); old.timer = setTimeout(() => hideT(old), 900); }
  };
  Toast.clear = function () { queue.length = 0; held.length = 0; vis.slice().forEach(hideT); };
  Toast.held = () => held.length;
  /** clear on every screen change so old toasts never sit over the new screen's tabs (HUNT #15) */
  if (PT.Events && PT.Events.on) PT.Events.on('ui:navigate', (e) => {
    queue.length = 0;
    const name = e && e.name;
    if (HOLD_ON[name]) { vis.slice().forEach(hideT); return; }      // entering Fired: clear what is showing
    // HUNT2 #13: a new screen starts clean (badge toasts may stay; they are about you, not the old screen)
    vis.filter((x) => x.kind !== 'ach').forEach(hideT);
    const host = tHost();
    if (host) {
      const sc = globalThis.document.getElementById('screen');
      host.classList.toggle('t-flow', !!(sc && sc.querySelector('.lay.flow')));
      host.classList.toggle('t-rail', !!(sc && sc.querySelector('.frame.has-nav')));
      // HUNT3 #7: flow toasts fit the empty left part of the foot bar (left of its first button)
      const fb = sc && sc.querySelector('.lay.flow .foot .btn');
      const nav = sc && sc.querySelector('.navbar');
      if (fb) {
        const left = nav ? nav.getBoundingClientRect().right : 0;
        host.style.setProperty('--tflow-w', Math.max(160, Math.round(fb.getBoundingClientRect().left - left - 24)) + 'px');
      }
    }
    if (!held.length) return;
    // left the Fired screen: release what waited (after the new screen has painted)
    const out = held.splice(0, held.length);
    setTimeout(() => out.forEach((x) => { if (holding()) { held.push(x); return; } if (vis.length < MAX_VIS) showNow(x); else { queue.push(x); while (queue.length > MAX_Q) queue.shift(); } }), 300);
  });
})(globalThis.PT = globalThis.PT || {});
