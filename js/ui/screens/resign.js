/* Pixel Touchdown: js/ui/screens/resign.js
 * Owner: WP5. Responsibility: expiring contracts negotiation ("Keep Players", design 10.5).
 * Also defines PT.UI.parts.offerSheet (Pay / Years / Welcome Gift sheet) reused by the Market screen.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const parts = UI.parts = UI.parts || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  /** ROUND6: each paged row sits in a .pg-cell so its pixel frame + drop shadow count toward the measured height */
  const cells = (rows) => rows.map((r) => html`<div class="pg-cell">${r}</div>`);
  const L = () => PT.App.L;
  function space(lg) { try { return PT.League.Cap.space(lg, lg.userTid); } catch (e) { return 0; } }
  function capMin() { return PT.C.CAP.MIN_SAL; }
  function capMax() { return PT.C.CAP.MAX_SAL; }

  // ---------------- shared offer sheet ----------------
  /**
   * offerSheet({ p, ask:{sal,yrs}, title, submit, gift:bool, coins, left:(sal)→$K, verdict:(sal,yrs,gift)→{face,word,cls} })
   * → Promise<{sal,yrs,gift}|null>. Submit button testid: btn-offer-submit.
   */
  parts.offerSheet = function (o) {
    const p = o.p;
    const ask = o.ask || { sal: capMin(), yrs: 2 };
    const st = { sal: Math.max(capMin(), Math.round(ask.sal / 100) * 100), yrs: Math.max(1, Math.min(5, ask.yrs || 2)), gift: 0 };
    const yrsRow = [1, 2, 3, 4, 5].map((y) => K().btn({ label: String(y), action: 'o-yrs', data: { y: y }, kind: 'sec', size: 's', testid: 'offer-yrs-' + y }));
    const giftRow = [0, 50, 100, 200].map((g) => K().btn({ label: g ? String(g) : 'None', icon: g ? D().raw('<i class="ic ic-coin"></i>') : '', action: 'o-gift', data: { g: g }, kind: 'sec', size: 's', testid: 'offer-gift-' + g, disabled: g > (o.coins || 0) }));
    const body = html`<div class="offer"><div class="offer-l">
      <div class="offer-who">${K().portrait(p, 64)}<div class="grow"><b class="ellip offer-n">${K().pname(p)}</b>
        <div class="row wrap small">${K().posChip(p.pos)} ${K().stars(p.ovr)} <span class="muted">Age ${p.age}</span></div>
        <div class="row wrap small">${K().want(p.want)} ${K().mood(p.mor, true)}</div></div></div>
      <div class="offer-ask">They ask <b class="num">${D().money(ask.sal)}</b> a year for <b>${D().plural(ask.yrs, 'year')}</b></div>
      <div class="field"><span class="field-l">Pay per year</span>
        <div class="offer-pay num" data-v="sal"></div>
        <div class="offer-steps">
          ${K().btn({ label: '−1M', action: 'o-pay', data: { d: -1000 }, kind: 'sec', size: 's', testid: 'offer-pay-m1' })}
          ${K().btn({ label: '−', action: 'o-pay', data: { d: -100 }, kind: 'sec', size: 's', testid: 'offer-pay-down', title: 'Less pay' })}
          ${K().btn({ label: '+', action: 'o-pay', data: { d: 100 }, kind: 'sec', size: 's', testid: 'offer-pay-up', title: 'More pay' })}
          ${K().btn({ label: '+1M', action: 'o-pay', data: { d: 1000 }, kind: 'sec', size: 's', testid: 'offer-pay-p1' })}
        </div>
        ${K().btn({ label: 'Match Ask', action: 'o-ask', kind: 'gold', size: 's', testid: 'offer-match', cls: 'btn-wide' })}
      </div></div><div class="offer-r">
      <div class="field"><span class="field-l">Years</span><div class="seg" data-seg="yrs">${yrsRow}</div></div>
      ${o.gift ? html`<div class="field"><span class="field-l">Welcome Gift <span class="muted small">(paid only if he signs)</span></span><div class="seg" data-seg="gift">${giftRow}</div></div>` : ''}
      <div class="offer-foot"><span class="small">Team Cash left: <b class="num" data-v="left"></b></span><span class="offer-face" data-v="face"></span></div>
    </div></div>`;
    function paint(card) {
      card.querySelector('[data-v="sal"]').textContent = D().money(st.sal);
      const left = o.left ? o.left(st.sal) : 0;
      const lv = card.querySelector('[data-v="left"]');
      lv.textContent = D().money(left);
      lv.className = 'num ' + (left >= 5000 ? 'good' : left >= 1000 ? 'warn' : 'bad');
      D().$$('[data-seg="yrs"] .btn', card).forEach((b) => b.classList.toggle('on', +b.getAttribute('data-y') === st.yrs));
      D().$$('[data-seg="gift"] .btn', card).forEach((b) => b.classList.toggle('on', +b.getAttribute('data-g') === st.gift));
      const v = o.verdict ? o.verdict(st.sal, st.yrs, st.gift) : null;
      const f = card.querySelector('[data-v="face"]');
      f.className = 'offer-face ' + (v ? v.cls : '');
      D().set(f, v ? html`${K().ic(v.face)} ${v.word}` : '');
      const sub = card.querySelector('[data-testid="btn-offer-submit"]');
      if (sub) sub.disabled = left < 0;
    }
    return UI.Modal.open({
      title: o.title || 'Make Offer', cls: 'm-offer', body: body,
      buttons: [{ label: o.submit || 'Send Offer', value: 'ok', kind: 'go', testid: 'btn-offer-submit' }, { label: 'Cancel', value: null, kind: 'cancel' }],
      mount: (card) => paint(card),
      actions: {
        'o-pay': (el, card) => { st.sal = Math.max(capMin(), Math.min(capMax(), st.sal + +el.getAttribute('data-d'))); paint(card); },
        'o-ask': (el, card) => { st.sal = Math.max(capMin(), ask.sal); st.yrs = Math.max(1, Math.min(5, ask.yrs || st.yrs)); paint(card); },
        'o-yrs': (el, card) => { st.yrs = +el.getAttribute('data-y'); paint(card); },
        'o-gift': (el, card) => { st.gift = +el.getAttribute('data-g'); paint(card); }
      },
      collect: (card, v) => (v === 'ok' ? { sal: st.sal, yrs: st.yrs, gift: st.gift } : null)
    });
  };

  // ---------------- Keep Players ----------------
  function memo(lg) {
    const m = D().memo.resign;
    if (m && m.s === lg.season && m.id === lg.id) return m;
    D().memo.resign = { s: lg.season, id: lg.id, seen: [], letgo: [], tried: {} };
    return D().memo.resign;
  }
  function askOf(lg, pid) {
    try { return PT.League.Contracts.ask(lg, pid); } catch (e) { return null; }
  }
  function winsOf(lg) {
    try { const r = PT.League.Standings.get(lg).find((x) => x.tid === lg.userTid); return r ? r.w : 8; } catch (e) { return 8; }
  }
  /** design 10.5 acceptance multiplier on Ask */
  function needMult(lg, p) {
    if (p.mor < 30) return 1.3;
    if (p.want === 'wins' && winsOf(lg) < 6) return 1.2;
    if (p.want === 'home') return 0.9;
    return 1.0;
  }
  function verdictOf(lg, p, a) {
    if (!a || a.willing === false) return { k: 'no', word: "Won't stay", chip: 'red', face: 'sad' };
    if (needMult(lg, p) > 1 || a.mood === 'upset') return { k: 'more', word: 'Wants more', chip: 'gold', face: 'meh' };
    return { k: 'yes', word: 'Will sign', chip: 'green', face: 'happy' };
  }
  function starterOvr(lg, pos) {
    const t = lg.teams[lg.userTid];
    const vals = PT.C.SLOTS.filter((s) => PT.C.SLOT_POS[s] === pos).map((s) => {
      const pid = (t.dc[s] || [])[0];
      const p = pid != null ? PT.League.Q.player(lg, pid) : null;
      return p ? p.ovr : 0;
    }).filter((v) => v > 0);
    return vals.length ? Math.min.apply(null, vals) : 0;
  }

  function lists(lg) {
    const m = memo(lg);
    let exp = [];
    try { exp = PT.League.Contracts.expiring(lg, lg.userTid) || []; } catch (e) { exp = []; }
    exp.forEach((p) => { if (!m.seen.includes(p.id)) m.seen.push(p.id); });
    const expIds = exp.map((p) => p.id);
    const kept = m.seen.filter((pid) => !expIds.includes(pid)).map((pid) => PT.League.Q.player(lg, pid))
      .filter((p) => p && p.tid === lg.userTid && p.con && p.con.exp > lg.season);
    const open = exp.filter((p) => !m.letgo.includes(p.id));
    const gone = exp.filter((p) => m.letgo.includes(p.id));
    return { open: open, kept: kept, gone: gone };
  }

  /** offers already made to this player this season (WP2 Contracts keeps them in L.ss.kept) */
  function triesOf(lg, pid) {
    try { const H = PT.League.History; const ss = H && H.ss ? H.ss(lg) : null; return (ss && ss.kept && ss.kept[pid]) || memo(lg).tried[pid] || 0; }
    catch (e) { return memo(lg).tried[pid] || 0; }
  }
  function row(lg, p) {
    const a = askOf(lg, p.id);
    const v = verdictOf(lg, p, a);
    const tries = triesOf(lg, p.id);
    const right = html`<span class="num"><b>${a ? D().money(a.sal) : '—'}</b></span><span class="muted small">${a ? D().plural(a.yrs, 'yr') : ''}</span>`;
    return html`<div class="rs-item">
      ${K().playerRow(p, { right: right, sub: html`${K().mood(p.mor)} ${K().chip(v.word, v.chip)}` })}
      <div class="rs-acts">
        ${tries >= 2 ? html`<span class="chip chip-red rs-no">${K().ic('star')} Said no</span>`
          : tries === 1 ? K().btn({ label: 'Ask Again', sub: 'Mood −5', icon: 'pray', action: 'keep', data: { pid: p.id }, kind: 'gold', size: 'm', testid: 'btn-resign-' + p.id, disabled: v.k === 'no' })
          : K().btn({ label: 'Keep', icon: 'pencil', action: 'keep', data: { pid: p.id }, kind: 'go', size: 'm', testid: 'btn-resign-' + p.id, disabled: v.k === 'no' })}
        ${K().btn({ label: 'Let Go', icon: 'hand', action: 'letgo', data: { pid: p.id }, kind: 'ghost', size: 'm', testid: 'btn-letgo-' + p.id })}
      </div>
    </div>`;
  }

  function mount(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const ls = lists(lg);
    const inPhase = lg.phase === 'RESIGN';
    // ROUND6 0-scroll: one paged list (deals ending, then Kept, then Leaving); the count sits in the title bar,
    // Team Cash + Auto Keep sit in the bottom bar next to NEXT.
    const note = !inPhase && ls.open.length ? html`<p class="small rs-note rs-note-b">These players are in the last year of their deals.</p>` : '';
    const items = ls.open.map((p) => row(lg, p))
      .concat(ls.kept.map((p) => html`<div class="rs-item rs-kept">${K().playerRow(p, { right: K().payYears(p), compact: true, sub: K().chip(html`${K().ic('party')} Kept`, 'green') })}</div>`))
      .concat(ls.gone.map((p) => html`<div class="rs-item rs-gone-i"><span class="ellip grow">${K().posChip(p.pos)} <b>${K().pname(p)}</b></span><span class="chip">${K().ic('hand')} Leaving</span>${K().btn({ label: 'Undo', action: 'undo', data: { pid: p.id }, kind: 'sec', size: 's', testid: 'btn-undo-' + p.id })}</div>`));
    const foot = html`<div class="rs-foot-s">${K().cash(space(lg))}</div>
      ${ls.open.length ? K().btn({ label: 'Auto Keep', icon: 'robot', action: 'auto', kind: 'gold', size: 'l', testid: 'btn-auto-keep', cls: 'rs-auto' }) : ''}${K().nextBtn()}`;
    D().set(el, K().layout(html`${note}${K().pg('resign', cells(items), { grid: true, cls: 'rs-pg', empty: K().empty('star', 'All set. Press Next for Draft Day.') })}`, foot, 'fit nsb resign'));
  }

  function keep(pid) {
    const lg = L();
    const p = PT.League.Q.player(lg, pid);
    const a = askOf(lg, pid);
    if (!p || !a) return;
    // QA1: in Keep Players the books already show next season, where his expiring Pay no longer counts
    // (Contracts.offer checks space ≥ new Pay). In season (extension) the new deal replaces his current Pay.
    const offView = PT.League.Cap && PT.League.Cap.offView ? PT.League.Cap.offView(lg) : lg.phase !== 'REGULAR' && lg.phase !== 'PRESEASON';
    const cur = p.con && !offView ? p.con.sal : 0;
    const t = lg.teams[lg.userTid];
    parts.offerSheet({
      p: p, ask: a, title: triesOf(lg, pid) === 1 ? 'Ask ' + p.fn + ' again? (last try, Mood −5)' : 'Keep ' + p.fn + '?', submit: 'Send Offer', coins: t.fin.coins,
      left: (sal) => space(lg) + cur - sal,          // his new Pay replaces the old one
      verdict: (sal) => {
        if (a.willing === false) return { face: 'sad', word: "Won't stay", cls: 'bad' };
        const need = a.sal * needMult(lg, p);
        return sal >= need ? { face: 'happy', word: 'Will sign', cls: 'good' } : sal >= need * 0.9 ? { face: 'meh', word: 'Maybe', cls: 'warn' } : { face: 'angry', word: 'Too low', cls: 'bad' };
      }
    }).then((o) => {
      if (!o) return;
      let r;
      try { r = PT.League.Contracts.offer(lg, pid, { sal: o.sal, yrs: o.yrs }); } catch (e) { r = { ok: false, msg: 'Something went wrong.' }; }
      const m = memo(lg); if (r && r.ok) m.tried[pid] = (m.tried[pid] || 0) + 1;     // a CAP refusal is not a try
      if (r && r.ok && r.accepted) {
        UI.Toast.show(p.fn + ' re-signed', 'good');
        if (PT.Events) PT.Events.emit('league:changed', { what: 'contract' });
      } else if (r && r.counter) {
        UI.Toast.show(p.fn + ' wants ' + D().money(r.counter.sal) + '. You can ask once more.', 'bad', 3000);
      } else UI.Toast.show((r && r.msg) || 'No deal.', 'bad');
      UI.refresh();
    });
  }

  function autoKeep() {
    const lg = L();
    const m = memo(lg);
    let exp = [];
    try { exp = PT.League.Contracts.expiring(lg, lg.userTid) || []; } catch (e) { exp = []; }
    exp = exp.filter((p) => !m.letgo.includes(p.id)).sort((a, b) => b.ovr - a.ovr);
    let n = 0;
    exp.forEach((p) => {
      const a = askOf(lg, p.id);
      if (!a || a.willing === false) return;
      if (p.ovr < starterOvr(lg, p.pos) - 3) return;
      const sal = Math.round(a.sal * Math.max(1, needMult(lg, p)) / 100) * 100;
      let can = true;
      const offView = PT.League.Cap.offView ? PT.League.Cap.offView(lg) : true;
      try { can = PT.League.Cap.canAfford(lg, lg.userTid, offView ? sal : Math.max(0, sal - (p.con ? p.con.sal : 0))); } catch (e) { can = true; }
      if (!can) return;
      try { const r = PT.League.Contracts.offer(lg, p.id, { sal: sal, yrs: a.yrs }); if (r && r.accepted) n++; } catch (e) { /* skip */ }
    });
    if (PT.Events) PT.Events.emit('league:changed', { what: 'contract' });
    UI.Toast.show(n ? 'Kept ' + D().plural(n, 'player') : 'No one to keep.', n ? 'good' : 'info');
    UI.refresh();
  }

  UI.screens.resign = {
    title: () => {
      const lg = L();
      let n = 0;
      try { const m = memo(lg); n = (PT.League.Contracts.expiring(lg, lg.userTid) || []).filter((p) => !m.letgo.includes(p.id)).length; } catch (e) { n = 0; }
      return 'Keep Players' + (n ? ' (' + n + ')' : '');
    },
    nav: 'market',
    mount: mount,
    actions: {
      keep: (el) => keep(+el.getAttribute('data-pid')),
      letgo: (el) => {
        const lg = L(), pid = +el.getAttribute('data-pid'), p = PT.League.Q.player(lg, pid);
        UI.Modal.confirm('Let ' + (p ? p.fn : 'him') + ' go?', { body: 'He goes to the Market.', icon: 'hand', yes: 'Let Go', no: 'Cancel' })
          .then((ok) => { if (ok) { memo(lg).letgo.push(pid); UI.refresh(); } });
      },
      undo: (el) => { const m = memo(L()); const pid = +el.getAttribute('data-pid'); m.letgo = m.letgo.filter((x) => x !== pid); UI.refresh(); },
      auto: () => autoKeep()
    }
  };
})(globalThis.PT = globalThis.PT || {});
