/* Pixel Touchdown: js/ui/screens/resign.js
 * Owner: FLOW-UX (was WP5). "Keep Players" (expiring deals, design 10.5) as a flow screen (docs/handoff/FLOW-UX.md):
 * header "Deals ending · Kept · Leaving", a paged table (name, pos, Stars, age, ask, mood, status), a detail card with an
 * inline offer (Pay stepper, Years, verdict, Cash left, Send offer = btn-offer-submit) and "Let go", ONE primary "Done"
 * (flow NEXT → Draft Day), secondary "Auto keep" (btn-auto-keep).
 * Rows: btn-resign-{pid} (open deals; tap = select), rs-kept-{pid}, rs-gone-{pid}; btn-letgo-{pid}, btn-undo-{pid}.
 * Also keeps PT.UI.parts.offerSheet (the old modal) for any other caller.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const parts = UI.parts = UI.parts || {};
  const D = () => UI.dom, K = () => UI.comp, FK = () => UI.FlowKit;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;
  function space(lg) { try { return PT.League.Cap.space(lg, lg.userTid); } catch (e) { return 0; } }

  // ---------------- legacy modal offer sheet (kept for other callers) ----------------
  /**
   * offerSheet({ p, ask:{sal,yrs}, title, submit, left:(sal)→$K, verdict:(sal,yrs)→{face,word,cls} })
   * → Promise<{sal,yrs,gift}|null>. Same inline control as the flow screens, in a modal.
   */
  parts.offerSheet = function (o) {
    const key = 'sheet:' + o.p.id + ':' + Math.random();
    const body = html`<div class="fl-sheet-offer">${FK().offer({ key: key, ask: o.ask, submit: o.submit || 'Send Offer', left: o.left, verdict: o.verdict, testid: 'btn-offer-submit' })}</div>`;
    return UI.Modal.open({ title: o.title || 'Make Offer', cls: 'm-offer m-floffer', body: body, buttons: [{ label: 'Cancel', value: null, kind: 'cancel' }],
      mount: (card) => FK().paintOffer(card),
      actions: {
        'fl-pay': (el, card) => { FK().actions()['fl-pay'](el); FK().paintOffer(card); },
        'fl-yrs': (el, card) => { FK().actions()['fl-yrs'](el); FK().paintOffer(card); },
        'fl-send': (el, card, entry) => entry.close('ok')
      },
      collect: (card, v) => (v === 'ok' ? FK().offerValue() : null) });
  };

  // ---------------- Keep Players ----------------
  const ui = { sel: null };
  function memo(lg) {
    const m = D().memo.resign;
    if (m && m.s === lg.season && m.id === lg.id) return m;
    D().memo.resign = { s: lg.season, id: lg.id, seen: [], letgo: [], tried: {} };
    return D().memo.resign;
  }
  function askOf(lg, pid) {
    try { return PT.League.Contracts.ask(lg, pid); } catch (e) { return null; }
  }
  /** offers already made to this player this season (WP2 Contracts keeps them in L.ss.kept) */
  function triesOf(lg, pid) {
    try { const H = PT.League.History; const ss = H && H.ss ? H.ss(lg) : null; return (ss && ss.kept && ss.kept[pid]) || memo(lg).tried[pid] || 0; }
    catch (e) { return memo(lg).tried[pid] || 0; }
  }
  function statusOf(lg, p, a) {
    if (triesOf(lg, p.id) >= 2 || !a || a.willing === false) return { k: 'no', word: triesOf(lg, p.id) >= 2 ? 'Said no' : "Won't stay", cls: 'red' };
    if (a.verdict === 'more') return { k: 'more', word: 'Wants more', cls: 'gold' };
    return { k: 'yes', word: 'Will sign', cls: 'green' };
  }

  function lists(lg) {
    const m = memo(lg);
    let exp = [];
    try { exp = PT.League.Contracts.expiring(lg, lg.userTid) || []; } catch (e) { exp = []; }
    exp = exp.slice().sort((a, b) => b.ovr - a.ovr);
    exp.forEach((p) => { if (!m.seen.includes(p.id)) m.seen.push(p.id); });
    const expIds = exp.map((p) => p.id);
    const kept = m.seen.filter((pid) => !expIds.includes(pid)).map((pid) => PT.League.Q.player(lg, pid))
      .filter((p) => p && p.tid === lg.userTid && p.con && p.con.exp > lg.season);
    return { open: exp.filter((p) => !m.letgo.includes(p.id)), kept: kept, gone: exp.filter((p) => m.letgo.includes(p.id)) };
  }

  const COLS = [{ k: 'name', label: 'Name', cls: 'c-name' }, { k: 'pos', label: 'Pos', cls: 'c-pos' }, { k: 'stars', label: 'Stars', cls: 'c-stars' },
    { k: 'age', label: 'Age', cls: 'c-age c-c c-hn' }, { k: 'ask', label: 'Asks', cls: 'c-ask' }, { k: 'mood', label: K().ic('ok'), cls: 'c-c c-hs' }, { k: 'st', label: 'Status', cls: 'c-st' }];

  function cells(lg, p, a, tag) {
    return { name: FK().name(p), pos: K().posChip(p.pos), stars: FK().stars(p.ovr), age: html`<span class="num">${p.age}</span>`,
      ask: a ? html`<span class="fl-ask"><b class="num">${D().money(a.sal)}</b><span class="dim">${a.yrs}y</span></span>` : html`<span class="fl-ask">${K().payYears(p)}</span>`,
      mood: K().mood(p.mor), st: tag };
  }

  function detail(lg, p, kind, inPhase) {
    if (!p) return html`<aside class="fl-card fl-side fl-side-empty"><p class="fl-empty">${K().ic('check')} Nobody left to keep.</p></aside>`;
    const who = html`<div class="fl-who">${K().portrait(p, 56)}<div class="fl-who-t"><b class="fl-pn">${p.fn} ${p.ln}</b>
      <span class="fl-pm">${K().posChip(p.pos)}<span class="dim">Age ${p.age}</span>${K().mood(p.mor, true)}</span></div></div>`;
    if (kind === 'kept') return html`<aside class="fl-card fl-side">${who}<p class="fl-note good">${K().ic('party')} Kept: ${K().payYears(p)}</p></aside>`;
    if (kind === 'gone') return html`<aside class="fl-card fl-side">${who}<p class="fl-note dim">${K().ic('hand')} Leaving for the Market.</p>
      ${K().btn({ label: 'Undo', icon: 'uturn', action: 'undo', data: { pid: p.id }, kind: 'sec', size: 'm', testid: 'btn-undo-' + p.id, cls: 'fl-sbtn' })}</aside>`;
    const a = askOf(lg, p.id);
    const s = statusOf(lg, p, a);
    const tries = triesOf(lg, p.id);
    // QA1: in Keep Players the books already show next season (his old Pay no longer counts); in season the new deal replaces it
    const offView = PT.League.Cap && PT.League.Cap.offView ? PT.League.Cap.offView(lg) : !inPhase;
    const cur = p.con && !offView ? p.con.sal : 0;
    const letgo = K().btn({ label: 'Let go', action: 'letgo', data: { pid: p.id }, kind: 'ghost', size: 's', testid: 'btn-letgo-' + p.id, cls: 'fl-letgo' });
    const offer = FK().offer({ key: 'rs:' + p.id + ':' + tries, ask: a, disabled: s.k === 'no', why: s.word, extra: letgo,
      submit: s.k === 'no' ? s.word : tries === 1 ? 'Ask again' : 'Send offer', submitHtml: s.k === 'no' || tries === 1 ? '' : html`Send<span class="fl-nf"> offer</span>`,
      left: (sal) => space(lg) + cur - sal,
      verdict: (sal, yrs) => {
        if (s.k === 'no') return { face: 'sad', word: s.word, cls: 'bad' };
        let need = (a && a.need) || (a && a.sal) || sal;
        if (a && (yrs < a.lo || yrs > a.hi)) need *= 1.05;
        return sal >= need ? { face: 'happy', word: 'Will sign', cls: 'good' } : sal >= need * 0.9 ? { face: 'meh', word: 'Maybe', cls: 'warn' } : { face: 'angry', word: 'Too low', cls: 'bad' };
      } });
    return html`<aside class="fl-card fl-side has-offer" data-testid="resign-detail">${who}
      <p class="fl-note fl-asks">${a ? html`<span>Asks <b class="num">${D().money(a.sal)}</b> × ${D().plural(a.yrs, 'yr')}</span>` : ''}${tries === 1 ? html`<span class="bad">Last try: Mood −5</span>` : ''}</p>
      ${offer}
    </aside>`;
  }

  function mount(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const inPhase = lg.phase === 'RESIGN';
    if (inPhase) FK().noSub(el);
    const ls = lists(lg);
    const all = ls.open.concat(ls.kept, ls.gone);
    if (ui.sel == null || !all.some((p) => p.id === ui.sel)) ui.sel = all.length ? all[0].id : null;
    const rows = ls.open.map((p) => { const a = askOf(lg, p.id), s = statusOf(lg, p, a);
      return { id: p.id, testid: 'btn-resign-' + p.id, sel: ui.sel === p.id, cells: cells(lg, p, a, FK().tag(s.word, s.cls)) }; })
      .concat(ls.kept.map((p) => ({ id: p.id, testid: 'rs-kept-' + p.id, sel: ui.sel === p.id, cls: 'kept', cells: cells(lg, p, null, FK().tag(html`${K().ic('check')}Kept`, 'green')) })))
      .concat(ls.gone.map((p) => ({ id: p.id, testid: 'rs-gone-' + p.id, sel: ui.sel === p.id, cls: 'dim', cells: cells(lg, p, askOf(lg, p.id), FK().tag('Leaving', '')) })));
    const selP = ui.sel != null ? PT.League.Q.player(lg, ui.sel) : null;
    const kind = selP ? (ls.kept.some((p) => p.id === selP.id) ? 'kept' : ls.gone.some((p) => p.id === selP.id) ? 'gone' : 'open') : null;
    const F = FK();
    const head = F.head(html`${F.seg('Deals ending', String(ls.open.length), { icon: 'contract', cls: 'fl-seg-t', testid: 'rs-open' })}${F.seg('Kept', String(ls.kept.length), { icon: 'check' })}${F.seg('Leaving', String(ls.gone.length), { cls: ls.gone.length ? '' : 'fl-seg-dim' })}${F.gap()}`);
    const table = F.table({ key: 'resign', cols: COLS, rows: rows, cls: 'fl-t-keep',
      tools: html`<span class="fl-bar-t">${inPhase ? 'Last year of deal' : 'Deals ending this season'}</span>`,
      empty: html`<p class="fl-empty">All set. Nobody's deal is ending.</p>` });
    const body = html`${head}${F.tip('fl-keep', 'Tap a player. Green face = he signs.')}<div class="fl-main">${table}${detail(lg, selP, kind, inPhase)}</div>`;
    const foot = inPhase ? F.foot('', ls.open.length ? F.sec({ label: 'Auto keep', icon: 'robot', action: 'auto', testid: 'btn-auto-keep' }) : '', F.next({ label: 'Done' })) : null;
    D().set(el, K().layout(body, foot, 'fit flow fl-keep'));
    F.paintOffer(el);
  }

  function send() {
    const lg = L();
    const pid = ui.sel, p = PT.League.Q.player(lg, pid);
    if (!p) return;
    const o = FK().offerValue();
    let r;
    try { r = PT.League.Contracts.offer(lg, pid, { sal: o.sal, yrs: o.yrs }); } catch (e) { r = { ok: false, msg: 'Something went wrong.' }; }
    const m = memo(lg); if (r && r.ok) m.tried[pid] = (m.tried[pid] || 0) + 1;     // a CAP refusal is not a try
    if (r && r.ok && r.accepted) {
      UI.Toast.show(p.fn + ' re-signed', 'good');
      if (PT.Events) PT.Events.emit('league:changed', { what: 'contract' });
    } else if (r && r.counter) {
      UI.Toast.show(p.fn + ' wants ' + D().money(r.counter.sal) + '. One more try.', 'bad', 3000);
    } else UI.Toast.show((r && r.msg) || 'No deal.', 'bad');
    UI.refresh();
  }

  /** Auto keep (design 10.5, same rule as Contracts.autoKeep): starters-level players whose Ask fits, best first.
   * Players you chose to let go stay out. */
  function autoKeep() {
    const lg = L(), m = memo(lg), C = PT.League.Contracts;
    let n = 0;
    lists(lg).open.forEach((p) => {
      try {
        const a = C.ask(lg, p.id, lg.userTid);
        const st = C.starterOvr ? C.starterOvr(lg, lg.userTid, p.pos, p.id) : 0;
        if (p.ovr < st - 3 || a.verdict === 'wont' || space(lg) < a.need) return;
        const r = C.offer(lg, p.id, { sal: a.need, yrs: Math.max(a.lo, Math.min(a.hi, a.yrs)) });
        if (r && r.ok) m.tried[p.id] = (m.tried[p.id] || 0) + 1;
        if (r && r.accepted) n++;
      } catch (e) { /* skip him */ }
    });
    if (PT.Events) PT.Events.emit('league:changed', { what: 'contract' });
    UI.Toast.show(n ? 'Kept ' + D().plural(n, 'player') : 'No one to keep.', n ? 'good' : 'info');
    UI.refresh();
  }

  UI.screens.resign = {
    title: 'Keep Players',
    nav: 'market',
    mount: mount,
    actions: FK().withActions({
      row: (el) => { ui.sel = +el.getAttribute('data-pid'); UI.refresh(); },
      'fl-send': () => send(),
      letgo: (el) => {
        const lg = L(), pid = +el.getAttribute('data-pid'), p = PT.League.Q.player(lg, pid);
        UI.Modal.confirm('Let ' + (p ? p.fn : 'him') + ' go?', { body: 'He goes to the Market.', icon: 'hand', yes: 'Let Go', no: 'Cancel' })
          .then((ok) => { if (ok) { memo(lg).letgo.push(pid); UI.refresh(); } });
      },
      undo: (el) => { const m = memo(L()); const pid = +el.getAttribute('data-pid'); m.letgo = m.letgo.filter((x) => x !== pid); UI.refresh(); },
      auto: () => autoKeep()
    })
  };
})(globalThis.PT = globalThis.PT || {});
