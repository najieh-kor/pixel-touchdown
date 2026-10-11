/* Pixel Touchdown: js/ui/screens/flow-kit.js
 * Owner: FLOW-UX (docs/handoff/FLOW-UX.md). Shared pieces for the offseason "flow" screens (Draft Day, Star Draft,
 * Market, Keep Players, Swaps, Awards / Growth Day / Goodbyes, Team News). Styles: css/flow.css (.lay.flow, .fl-*).
 *
 * Layout of every flow screen (no scrolling, nothing clipped):
 *   [header strip: where you are, one line]  [optional one-line coach tip, first visit only]
 *   [main: a dense paged table card (toolbar: filter + pager) | a detail card for the selected row]
 *   [bottom bar: info / ticker … secondary … PRIMARY (bottom-right)]
 *
 *   FK.noSub(el)                       flow screens hide the section sub-tabs (the left rail stays)
 *   FK.name(p)                         player name that never truncates: full name, "J. Smith" on narrow layouts
 *   FK.head(parts, cls) / FK.seg(label, value, o)   header strip + its segments
 *   FK.tip(id, text)                   one small dismissible line (data-action fl-tip), shown once
 *   FK.table(o)                        table card: o = { key, cols:[{k,label,cls}], rows:[{id,testid,cells,cls,sel,attrs,static,action}], noHead, grid (rows flow in columns),
 *                                        tools:Raw, cls, empty:Raw, action:'row' }  (paged with K.pg → pager.js)
 *   FK.filter(o)                       one-row position filter (chips; a "Pos" button + sheet on narrow layouts)
 *   FK.foot(info, sec, pri)            bottom bar (secondary left of primary)
 *   FK.offer(o) / FK.offerAct          inline offer control (Pay stepper, Years, verdict, Send) used by Market + Keep
 *   FK.actions                         actions every flow screen merges in (fl-tip, fl-pos, offer steppers)
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const FK = UI.FlowKit = UI.FlowKit || {};

  /** Flow screens are full-screen steps: drop the Team sub-tab strip (the left rail stays). */
  FK.noSub = function (el) {
    const fr = el && el.closest ? el.closest('.frame') : null;
    if (!fr) return;
    fr.classList.remove('has-sub');
    const s = fr.querySelector(':scope > .subnav');
    if (s) s.remove();
  };

  /** name that is never cut: the full name; on narrow layouts the CSS shows "J. Lastname" instead */
  FK.name = function (p) {
    if (!p) return '';
    return html`<span class="fl-nm"><span class="fl-nf">${p.fn} ${p.ln}</span><span class="fl-ns">${p.fn.charAt(0)}. ${p.ln}</span></span>`;
  };
  /** team name: full on wide layouts, abbr on narrow */
  FK.team = function (t) {
    if (!t) return '';
    return html`<span class="fl-tn"><span class="fl-nf">${t.name}</span><span class="fl-ns">${t.abbr}</span></span>`;
  };

  // ---------------- header strip ----------------
  FK.head = (parts, cls) => html`<div class="fl-head ${cls || ''}">${parts}</div>`;
  /** one header segment: icon + small label + big value. o = { icon, cls, testid, title } */
  FK.seg = function (label, value, o) {
    o = o || {};
    const tid = o.testid ? D().raw(' data-testid="' + D().esc(o.testid) + '"') : '';
    const hasL = label !== '' && label != null, hasV = value !== '' && value != null;
    return html`<span class="fl-seg ${o.cls || ''}"${tid}>${o.icon ? K().ic(o.icon) : ''}${hasL ? html`<span class="fl-sl">${label}</span>` : ''}${hasL && hasV ? ' ' : ''}${hasV ? html`<b class="fl-sv">${value}</b>` : ''}${o.extra ? html` <span class="fl-sx">${o.extra}</span>` : ''}</span>`;
  };
  FK.gap = () => html`<span class="fl-sp" aria-hidden="true"></span>`;

  /** one small dismissible coach line (first visit only) */
  FK.tip = function (id, text) {
    if (K().tipSeen && K().tipSeen(id)) return '';
    return html`<div class="fl-tip" role="note">${K().ic('cap')}<span class="fl-tip-t">${text}</span><button type="button" class="fl-tip-x" data-action="fl-tip" data-id="${id}" data-testid="tip-ok-${id}" aria-label="Got it">${K().ic('x')}</button></div>`;
  };

  // ---------------- table card ----------------
  FK.table = function (o) {
    const head = html`<div class="fl-tr fl-th" aria-hidden="true">${o.cols.map((c) => html`<span class="fl-c ${c.cls || ''}">${c.label}</span>`)}</div>`;
    const rows = o.rows.map((r) => {
      const at = r.attrs ? D().raw(' ' + r.attrs) : '';
      const inner = o.cols.map((c) => html`<span class="fl-c ${c.cls || ''}">${r.cells[c.k] == null ? '' : r.cells[c.k]}</span>`);
      // rows that hold their own buttons (or nothing to open) are plain blocks: no button inside a button
      if (r.static || o.static) return html`<div class="fl-tr fl-row fl-static ${r.cls || ''}" data-pid="${r.id}" data-testid="${r.testid}"${at}>${inner}</div>`;
      return html`<button type="button" class="fl-tr fl-row ${r.sel ? 'sel' : ''} ${r.cls || ''}" data-action="${r.action || o.action || 'row'}" data-pid="${r.id}" data-testid="${r.testid}" aria-pressed="${r.sel ? 'true' : 'false'}"${at}>${inner}</button>`;
    });
    return html`<section class="fl-card fl-tcard ${o.cls || ''}">
      <div class="fl-bar">${o.tools || ''}</div>
      ${o.rows.length && !o.noHead ? head : ''}
      ${K().pg(o.key, rows, { cls: 'fl-pg', grid: !!o.grid, empty: o.empty || html`<p class="fl-empty">Nobody here.</p>` })}
    </section>`;
  };

  // ---------------- position filter: one row, never wraps ----------------
  /**
   * o = { value, list:[{id, label, dot}], testid(id) → string, title, pick(id) (sheet choice) }
   * Chips on wide layouts; on narrow ones a single "Pos: X" button opens a sheet with the same chips.
   */
  FK.filter = function (o) {
    const cur = o.list.find((x) => x.id === o.value) || o.list[0];
    const chip = (x, inSheet) => html`<button type="button" class="fl-chip ${x.id === o.value ? 'on' : ''}" data-action="${inSheet ? 'fl-pos-pick' : 'filter'}" data-pos="${x.id}" ${inSheet ? '' : D().raw('data-testid="' + D().esc(o.testid(x.id)) + '"')} title="${x.title || x.label}">${x.label}${x.dot ? D().raw('<i class="fl-dot" title="Need"></i>') : ''}</button>`;
    FK._sheet = { list: o.list, value: o.value, chip: chip, pick: o.pick };
    return html`<div class="fl-filter" role="toolbar" aria-label="${o.title || 'Position'}">
      <div class="fl-chips">${o.list.map((x) => chip(x, false))}</div>
      <button type="button" class="fl-chip fl-posbtn ${o.value ? 'on' : ''}" data-action="fl-pos" data-testid="${o.testid('menu')}">${o.short || 'Pos'}<b>${cur.label}</b><i class="fl-caret" aria-hidden="true"></i></button>
    </div>`;
  };
  function posSheet() {
    const s = FK._sheet;
    if (!s) return;
    UI.Modal.open({ title: 'Show', cls: 'm-flpos', body: html`<div class="fl-sheet">${s.list.map((x) => s.chip(x, true))}</div>`,
      buttons: [{ label: 'Close', value: null, kind: 'cancel' }],
      actions: { 'fl-pos-pick': (t, card, entry) => entry.close(t.getAttribute('data-pos')) } })
      .then((v) => { if (v != null && s.pick) s.pick(v); });
  }

  // ---------------- bottom bar ----------------
  FK.foot = (info, sec, pri) => html`<div class="fl-foot"><div class="fl-info">${info || ''}</div>${sec || ''}${pri || ''}</div>`;
  /** the primary button (bottom-right) */
  FK.pri = (o) => K().btn(Object.assign({ kind: 'go', size: 'l', icon: 'play' }, o, { cls: 'fl-pri ' + (o.cls || '') }));
  FK.sec = (o) => K().btn(Object.assign({ kind: 'sec', size: 'l' }, o, { cls: 'fl-sec ' + (o.cls || '') }));
  /** flow NEXT as the primary: label from Calendar (Flow.label) unless a custom one is given (blockers win) */
  FK.next = function (o) {
    o = o || {};
    const F = UI.Flow;
    const lab = F ? F.label() : { text: 'Next', sub: '', icon: 'play' };
    const st = F && F.status ? F.status() : null;
    const blocked = !!(st && st.blockers && st.blockers.length);
    return FK.pri({ label: !blocked && o.label ? o.label : lab.text, sub: !blocked && o.label ? (o.sub != null ? o.sub : lab.text) : (o.sub != null ? o.sub : ''),
      icon: lab.icon || 'play', action: 'flow-next', testid: o.testid || 'btn-next', disabled: F && F.busy, cls: 'btn-next-f' + (F && F.busy ? ' busy' : '') });
  };

  /** two-line cell: line 1 = full name (+ something on the right), line 2 = details. Names wrap, never cut. */
  FK.two = (name, sub, right) => html`<span class="fl-l2"><span class="fl-l2a"><b>${name}</b>${right ? html`<span class="fl-l2r">${right}</span>` : ''}</span><span class="fl-l2b">${sub}</span></span>`;

  // ---------------- small pieces ----------------
  /** 5-block interest / fairness meter. v 0..100 */
  FK.meter = function (v, cls, title) {
    const n = Math.max(0, Math.min(5, Math.round((v || 0) / 20)));
    let s = '';
    for (let i = 0; i < 5; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return html`<span class="fl-meter ${cls || ''}" title="${title || ''}" role="meter" aria-valuenow="${Math.round(v || 0)}" aria-valuemax="100">${D().raw(s)}</span>`;
  };
  /** small tag (never wraps, never cut: short words only) */
  FK.tag = (text, cls) => html`<span class="fl-tag ${cls || ''}">${text}</span>`;
  /** stars + small grey number (UI_RULES 8) */
  FK.stars = (ovr) => html`<span class="fl-st">${K().stars(ovr, { noNum: true })}<span class="fl-sn num">${ovr}</span></span>`;
  FK.range = (lo, hi) => (lo === hi ? FK.stars(lo) : html`<span class="fl-st">${K().stars(Math.round((lo + hi) / 2), { noNum: true })}<span class="fl-sn num">${lo}–${hi}</span></span>`);
  FK.money = (k) => html`<b class="num">${D().money(k)}</b>`;

  // ---------------- inline offer control (Market + Keep Players) ----------------
  const MIN = () => PT.C.CAP.MIN_SAL, MAX = () => PT.C.CAP.MAX_SAL;
  const offerSt = { key: null, sal: 0, yrs: 2 };
  /** state for the player in the panel (reset when another player is picked) */
  FK.offerState = function (key, ask) {
    if (offerSt.key !== key) {
      offerSt.key = key;
      offerSt.sal = Math.max(MIN(), Math.round(((ask && ask.sal) || MIN()) / 100) * 100);
      offerSt.yrs = Math.max(1, Math.min(5, (ask && ask.yrs) || 2));
    }
    return offerSt;
  };
  /**
   * o = { key, ask:{sal,yrs}, left(sal) → $K, verdict(sal, yrs) → {face, word, cls}, submit, disabled, why, testid, extra (Raw left of Send), submitHtml (Raw label) }
   * Paints values into [data-v] slots so the steppers update without a re-mount.
   */
  FK.offer = function (o) {
    const st = FK.offerState(o.key, o.ask);
    FK._offer = o;
    const yrs = [1, 2, 3, 4, 5].map((y) => html`<button type="button" class="fl-yr ${y === st.yrs ? 'on' : ''}" data-action="fl-yrs" data-y="${y}" data-testid="offer-yrs-${y}" aria-pressed="${y === st.yrs ? 'true' : 'false'}">${y}</button>`);
    const step = (label, d, tid, cls) => html`<button type="button" class="fl-step ${cls || ''}" data-action="fl-pay" data-d="${d}" data-testid="${tid}" aria-label="${d > 0 ? 'More pay' : 'Less pay'}">${label}</button>`;
    return html`<div class="fl-offer" data-offer>
      <div class="fl-of-row"><span class="fl-ol">Pay / yr</span>
        <div class="fl-pay">${step('−1M', -1000, 'offer-pay-m1', 'big')}${step('−', -100, 'offer-pay-down')}<b class="fl-pv num" data-v="sal">${D().money(st.sal)}</b>${step('+', 100, 'offer-pay-up')}${step('+1M', 1000, 'offer-pay-p1', 'big')}</div></div>
      <div class="fl-of-row"><span class="fl-ol">Years</span><div class="fl-yrs" role="group" aria-label="Years">${yrs}</div></div>
      <div class="fl-of-v"><span class="fl-face" data-v="face"></span><span class="fl-left"><span class="fl-nf">Cash left</span><span class="fl-ns">Left</span> <b class="num" data-v="left"></b></span></div>
      <div class="fl-of-act">${o.extra || ''}${K().btn({ label: o.submitHtml || o.submit || 'Send Offer', icon: 'contract', action: 'fl-send', kind: 'go', size: 'm', testid: o.testid || 'btn-offer-submit', disabled: !!o.disabled, cls: 'fl-send', title: o.why || '' })}</div>
    </div>`;
  };
  /** repaint the offer control (after a stepper tap, and once after mount) */
  FK.paintOffer = function (root) {
    const o = FK._offer;
    const box = root && root.querySelector ? root.querySelector('[data-offer]') : null;
    if (!o || !box) return;
    const st = offerSt;
    box.querySelector('[data-v="sal"]').textContent = D().money(st.sal);
    const left = o.left ? o.left(st.sal) : 0;
    const lv = box.querySelector('[data-v="left"]');
    lv.textContent = D().money(left);
    lv.className = 'num ' + (left >= 5000 ? 'good' : left >= 1000 ? 'warn' : 'bad');
    D().$$('.fl-yr', box).forEach((b) => { const on = +b.getAttribute('data-y') === st.yrs; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const v = o.verdict ? o.verdict(st.sal, st.yrs) : null;
    const f = box.querySelector('[data-v="face"]');
    f.className = 'fl-face ' + (v ? v.cls : '');
    D().set(f, v ? html`${K().ic(v.face)}<span>${v.word}</span>` : '');
    const sub = box.querySelector('.fl-send');
    if (sub && !o.disabled) sub.disabled = left < 0;
  };
  /** current offer values */
  FK.offerValue = () => ({ sal: offerSt.sal, yrs: offerSt.yrs, gift: 0 });

  // ---------------- actions every flow screen merges in ----------------
  FK.actions = function () {
    return {
      'fl-tip': (t) => { if (K().tipDone) K().tipDone(t.getAttribute('data-id')); UI.refresh(); },
      'fl-pos': () => posSheet(),
      'fl-pay': (t) => { offerSt.sal = Math.max(MIN(), Math.min(MAX(), offerSt.sal + +t.getAttribute('data-d'))); FK.paintOffer(t.closest('#screen') || globalThis.document); },
      'fl-yrs': (t) => { offerSt.yrs = +t.getAttribute('data-y'); FK.paintOffer(t.closest('#screen') || globalThis.document); }
    };
  };
  /** merge FK.actions into a screen's action map (screen actions win) */
  FK.withActions = function (acts) { return Object.assign(FK.actions(), acts); };

  /** select the row on the current page after a filter/page change keeps the panel in sync (helper) */
  FK.firstVisible = function (root, prefix) {
    const r = root && root.querySelector('.fl-pg .pg-list > .fl-row:not([hidden])');
    return r ? +r.getAttribute('data-pid') : null;
  };
})(globalThis.PT = globalThis.PT || {});
