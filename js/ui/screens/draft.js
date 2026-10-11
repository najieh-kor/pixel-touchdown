/* Pixel Touchdown: js/ui/screens/draft.js
 * Owner: WP5. Responsibility: draft board, on-the-clock, pick, sim to my pick (Draft Day + Draft Board, design 10.6).
 * Fog: shown OVR range from Draft.board().shown, Growth "?" (scout 0) / two letters (1) / exact (2), Speed always exact.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;
  const Dr = () => PT.League.Draft;

  let filter = '';

  function status(lg) {
    try { return lg.draft && Dr() && Dr().status ? Dr().status(lg) : null; } catch (e) { return null; }
  }
  function board(lg) {
    try { return Dr().board(lg, { pos: filter || undefined }) || []; } catch (e) { return []; }
  }
  function scoutPts(lg) { return (lg.scout && lg.scout.pts) || 0; }
  function scLevel(p) { return (p.pr && p.pr.sc) || 0; }
  function needs(lg) {
    const t = lg.teams[lg.userTid];
    const out = {};
    PT.C.POS.forEach((pos) => {
      const slots = PT.C.SLOTS.filter((s) => PT.C.SLOT_POS[s] === pos);
      const vals = slots.map((s) => { const pid = (t.dc[s] || [])[0]; const p = pid != null ? PT.League.Q.player(lg, pid) : null; return p ? p.ovr : 0; });
      out[pos] = !vals.length || Math.min.apply(null, vals) < 70;
    });
    return out;
  }
  /** Growth as the fog allows: '?' · 'B–A' · 'A' */
  function growthShown(p) {
    const sc = scLevel(p);
    if (sc >= 2) return p.gl;
    if (sc === 1) {
      const G = PT.C.GROWTH_LETTERS, i = G.indexOf(p.gl);
      const j = i <= 0 ? 1 : i >= G.length - 1 ? i - 1 : (p.id % 2 ? i - 1 : i + 1);
      const a = G[Math.max(i, j)], b = G[Math.min(i, j)];
      return a + '–' + b;
    }
    return '?';
  }
  function growthChip(p) {
    const g = growthShown(p);
    if (g.indexOf('–') > 0) return html`<span class="growth g-b dr-g2" title="Growth">${g}</span>`;
    return K().growth(g);
  }
  function teamOnClock(lg, st) { return st && st.pick ? lg.teams[st.pick.tid] : null; }

  // ROUND6 "0 scrolling": side panel (clock / buttons) + position chips + one paged board (pager.js)
  const BOARD_CAP = 64;
  function side(lg, st) {
    const u = lg.userTid;
    if (!lg.draft) {
      return html`<aside class="card card-cream nc-side-card"><div class="nc-head"><span class="nc-emo" aria-hidden="true">${K().ic('scope')}</span>
        <div class="nc-head-t"><b class="nc-t">Draft Board</b><span class="small">Scout rookies now. Draft Day comes after Keep Players.</span></div></div>
        <div class="nc-stats">${scoutChip(lg)}</div></aside>`;
    }
    const on = teamOnClock(lg, st);
    const mine = st && st.userOnClock;
    const left = lg.draft.order.filter((o, i) => i >= lg.sub && o.tid === u).length;
    return html`<aside class="card nc-side-card dr-clock ${mine ? 'up' : ''}" style="${on ? K().teamVars(on) : ''}">
      <div class="nc-head">${on ? K().badge(on, 'm') : ''}<div class="nc-head-t">
        <b class="dr-pick num">Rd ${st.pick.rd} <span class="dr-pk">#${st.pick.pk}</span></b>
        <span class="dr-who">${mine ? "You're on the clock" : html`${on ? on.name : ''} picking`}</span></div></div>
      <div class="nc-stats"><span class="small">Your picks: <b class="num">${left}</b></span>${scoutChip(lg)}</div>
      ${recent(lg, st)}
    </aside>`;
  }
  function scoutChip(lg) {
    return html`<span class="chip chip-gold dr-scout" title="Scout points">${K().ic('scope')} <b class="num">${scoutPts(lg)}</b></span>`;
  }

  /** last picks (tall screens only: hidden on phones by CSS) */
  function recent(lg, st) {
    if (!st || !st.recent || !st.recent.length) return '';
    return html`<div class="dr-recent nc-recent" aria-label="Recent picks">${st.recent.slice(-3).reverse().map((r) => {
      const p = PT.League.Q.player(lg, r.pid), t = lg.teams[r.tid];
      return html`<div class="dr-rp ${r.tid === lg.userTid ? 'me' : ''}">${K().badge(t, 's')}<span class="dr-rp-t ellip"><b class="num">#${r.pk}</b> ${p ? K().short(p) : ''}</span>${p ? K().posChip(p.pos) : ''}</div>`;
    })}</div>`;
  }

  function filters(nd) {
    const all = [''].concat(PT.C.POS);
    return html`<div class="fchips nc-chips" role="toolbar" aria-label="Position">${all.map((pos) => html`<button type="button" class="fchip ${filter === pos ? 'on' : ''}" data-action="filter" data-pos="${pos}" data-testid="draft-filter-${pos || 'all'}">${pos || 'All'}${pos && nd[pos] ? D().raw('<span class="dr-need" title="Need">!</span>') : ''}</button>`)}</div>`;
  }

  function row(lg, x, nd) {
    // custom row: K.playerRow would show the true Stars (fog!)
    const p = x.p;
    const sc = scLevel(p);
    return html`<button type="button" class="prow dr-row nc-prow sc-${sc}" data-action="row" data-pid="${p.id}" data-testid="draft-row-${p.id}">
      ${K().portrait(p, 40, 0x8a8fb3)}
      <span class="prow-main">
        <span class="prow-name ellip">${K().pname(p)}</span>
        <span class="prow-sub">${K().posChip(p.pos)} ${sc >= 2 ? K().stars(p.ovr) : K().starsRange(x.shown.ovr[0], x.shown.ovr[1])} ${growthChip(p)}${nd[p.pos] ? html` <span class="chip chip-red nc-need">Need</span>` : ''}</span>
      </span>
      <span class="prow-right"><span class="dr-rank num">#${x.rank}</span><span class="chip chip-blue nc-spd" title="Speed">${K().ic('bolt')}${p.r.spd}</span>${sc ? html`<span class="chip chip-gold nc-sc" title="Scouted">${K().ic('scope')}${sc}</span>` : ''}</span>
    </button>`;
  }

  function mount(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const st = status(lg);
    const nd = needs(lg);
    let main;
    if (st && st.done) {
      const mine = lg.draft.order.filter((o) => o.tid === lg.userTid && o.pid != null).map((o) => ({ o: o, p: PT.League.Q.player(lg, o.pid) })).filter((x) => x.p);
      main = html`<div class="nc-main"><h2 class="sec-title on-grass nc-st">${K().ic('party')} Draft Complete: your rookies</h2>
        <div class="fill">${K().pg('drmine', mine.map((x) => K().playerRow(x.p, { compact: true, cls: 'nc-prow', right: html`<span class="chip chip-ink">Rd ${x.o.rd} · #${x.o.pk}</span>` })), { grid: true, cls: 'nc-side nc-plist', empty: html`<p class="muted nc-empty">No picks this year.</p>` })}</div></div>`;
    } else {
      const b = board(lg);
      const list = b.slice(0, BOARD_CAP);
      const count = b.length > BOARD_CAP ? BOARD_CAP + ' of ' + b.length : String(b.length);
      main = html`<div class="nc-main"><div class="nc-tools">${filters(nd)}<span class="nc-count small" title="Rookies">${count}</span></div>
        <div class="fill">${K().pg('board', list.map((x) => row(lg, x, nd)), { grid: true, cls: 'nc-side nc-plist', empty: K().empty('grad', 'No rookies here.') })}</div></div>`;
    }
    const body = html`${K().tip('draft', 'grad', 'Scout rookies to narrow their Stars range.')}<div class="nc-split ${st && st.done ? 'nc-done' : ''}">${st && st.done ? '' : side(lg, st)}${main}</div>`;
    // draft buttons live in the bottom bar (next to NEXT) so the side panel stays short on phones
    const live = lg.draft && st && !st.done;
    const btns = live ? html`${K().btn({ label: 'Auto Draft', icon: 'robot', action: 'auto', kind: 'sec', size: 'l', testid: 'btn-draft-auto', cls: 'nc-fb' })}${st.userOnClock ? K().btn({ label: 'Auto Pick', icon: 'target', action: 'autopick', kind: 'gold', size: 'l', testid: 'btn-draft-autopick', cls: 'nc-fb' })
      : K().btn({ label: 'Sim to Me', icon: 'ff', action: 'simme', kind: 'pri', size: 'l', testid: 'btn-draft-sim-to-me', title: 'Sim to My Pick', cls: 'nc-fb' })}` : '';
    const foot = html`${btns}${lg.phase === 'DRAFT' ? K().nextBtn() : K().btn({ label: 'Back to HQ', icon: 'home', action: 'hq', kind: 'sec', size: 'l', testid: 'btn-draft-hq' })}`;
    D().set(el, K().layout(body, foot, 'fit draft nc'));
  }

  function changed(what) { if (PT.Events) PT.Events.emit('league:changed', { what: what || 'draft' }); UI.refresh(); }

  function detail(pid) {
    const lg = L();
    const x = (Dr().board(lg, {}) || []).find((y) => y.p.id === pid);
    if (!x) return;
    const p = x.p, st = status(lg), sc = scLevel(p);
    const onClock = !!(st && st.userOnClock);
    const nd = needs(lg);
    const body = html`<div class="dr-detail">
      <div class="offer-who">${K().portrait(p, 72)}<div class="grow"><b class="offer-n">${K().pname(p)}</b>
        <div class="row wrap small">${K().posChip(p.pos)} <span>${K().posLabel(p.pos)}</span> <span class="muted">${K().spName(p.sp)} · Age ${p.age}</span></div>
        <div class="small muted">${p.pr ? p.pr.sch : ''} · Rank #${x.rank}</div></div></div>
      <div class="dr-facts">
        <div><span class="field-l">Stars</span>${sc >= 2 ? K().stars(p.ovr) : K().starsRange(x.shown.ovr[0], x.shown.ovr[1])}</div>
        <div><span class="field-l">Growth</span>${growthChip(p)}</div>
        <div><span class="field-l">Speed</span><b class="num">${K().ic('bolt')} ${p.r.spd}</b></div>
      </div>
      ${sc >= 2 ? html`<div class="row wrap">${K().want(p.want)} ${K().traits(p)}</div>` : html`<p class="small muted">${sc ? 'Scout again for the full report.' : 'Scout him to learn more.'}</p>`}
      ${nd[p.pos] ? html`<p class="small"><span class="chip chip-red">Need</span> Your ${K().posLabel(p.pos)} spot is weak.</p>` : ''}
    </div>`;
    const btns = [];
    if (onClock) btns.push({ label: 'Draft Him', value: 'pick', kind: 'go', testid: 'btn-draft-pick', icon: 'grad' });
    btns.push({ label: sc >= 2 ? 'Fully Scouted' : 'Scout (1 pt)', value: 'scout', kind: 'gold', testid: 'btn-scout', icon: 'scope', disabled: sc >= 2 || scoutPts(lg) <= 0 });
    if (!onClock && lg.phase === 'DRAFT' && st && !st.done) btns.push({ label: 'Not Your Pick', value: null, kind: 'sec', testid: 'btn-draft-pick', disabled: true });
    btns.push({ label: 'Close', value: null, kind: 'cancel' });
    UI.Modal.open({ title: onClock ? 'On the Clock' : 'Rookie', body: body, buttons: btns, cls: 'm-draft' }).then((v) => {
      if (v === 'pick') doPick(pid);
      else if (v === 'scout') { doScout(pid); detail(pid); }
    });
  }

  function doScout(pid) {
    const lg = L();
    if (scoutPts(lg) <= 0) { UI.Toast.show('No scout points left.', 'bad'); return; }
    const before = scoutPts(lg);
    let r;
    try { r = Dr().scout(lg, pid); } catch (e) { r = { ok: false, msg: 'Scout is busy.' }; }
    if (!r || !r.ok) { UI.Toast.show((r && r.msg) || 'Could not scout.', 'bad'); return; }
    // adapter: the stub Draft.scout does not spend points (WP2 real one should)
    if (lg.scout && lg.scout.pts === before) {
      lg.scout.pts = Math.max(0, before - 1);
      lg.scout.spent = lg.scout.spent || {};
      lg.scout.spent[pid] = (lg.scout.spent[pid] || 0) + 1;
    }
    UI.Toast.show('Scouted', 'good');
    changed('scout');
  }

  function doPick(pid) {
    const lg = L();
    const p = PT.League.Q.player(lg, pid);
    let r;
    try { r = Dr().pick(lg, pid); } catch (e) { r = { ok: false, msg: 'Pick failed.' }; }
    if (r && r.ok) {
      UI.Toast.show((p ? K().pname(p) : 'Rookie') + ' drafted', 'good');
      const v = UI.current() && D().$('#screen .lay');
      if (v) K().confetti(v, 50);
    } else UI.Toast.show((r && r.msg) || 'Pick failed.', 'bad');
    changed('draft');
  }

  UI.screens.draft = {
    title: () => (PT.App.L && PT.App.L.phase === 'DRAFT' ? 'Draft Day' : 'Draft Board'),
    nav: 'market',
    mount: (el) => mount(el),
    actions: {
      row: (el) => detail(+el.getAttribute('data-pid')),
      filter: (el) => { filter = el.getAttribute('data-pos') || ''; if (UI.pgPage) UI.pgPage('board', 0); UI.refresh(); },
      hq: () => UI.reset(),
      simme: () => {
        const lg = L();
        let r = null;
        try { r = Dr().simToUser(lg); } catch (e) { r = null; }
        const st = status(lg);
        UI.Toast.show(st && st.done ? 'Draft complete' : st && st.userOnClock ? "You're on the clock" : 'Picks made.', 'good');
        changed('draft');
        return r;
      },
      auto: () => {
        UI.Modal.confirm('Auto Draft the rest?', { body: 'Your scouts make the remaining picks.', icon: 'robot' }).then((ok) => {
          if (!ok) return;
          try { Dr().autoRest(L()); } catch (e) { UI.Toast.show('Auto Draft failed.', 'bad'); }
          UI.Toast.show('Draft complete', 'good');
          changed('draft');
        });
      },
      autopick: () => {
        const lg = L();
        let pid = null;
        try { pid = PT.League.AIGM.chooseDraftPick(lg, lg.userTid); } catch (e) { pid = null; }
        if (pid == null) { const b = Dr().board(lg, {}); pid = b.length ? b[0].p.id : null; }
        if (pid != null) doPick(pid);
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
