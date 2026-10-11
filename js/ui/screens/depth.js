/* Pixel Touchdown: js/ui/screens/depth.js
 * Owner: WP5. Responsibility: depth chart editor (tap-to-swap, no drag needed). Screen word: "Lineup".
 * 15 starter slots + KR, each with a starter and 2 bench spots (R5). Tap a spot → it lights up; tap another spot to
 * swap them, or "Pick player" to choose from a list sorted by Stars at that spot ("New spot" = −3 until 4 starts).
 * Exposes PT.UI.parts.lineup() + PT.UI.parts.lineupActions for Team › Lineup.
 * testids: depth-slot-{slot}-{i}, btn-auto-lineup, btn-depth-pick, btn-depth-cancel, btn-captain-pick, depth-pick-{pid}.
 * Stars (ROUND6 A): "Stars n/8" card: btn-add-star → star-pick-{pid}, btn-unstar-{pid}, btn-stars-auto, star-chip-{pid}, stars-count.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  UI.parts = UI.parts || {};

  const st = { sel: null, tab: 'off' };
  const GROUPS = [
    ['Offense', 'football', ['QB', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2']],
    ['Defense', 'shield', ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S']],
    ['Kicks', 'boot', ['K', 'KR']]
  ];

  const L = () => PT.App.L;
  const team = () => L().teams[L().userTid];
  const P = (pid) => (pid == null ? null : PT.League.Q.player(L(), pid));
  function slotOvr(p, slot) {
    const pos = PT.C.SLOT_POS[slot];
    if (!pos) return p.ovr;
    try { return PT.League.Ratings.ovr(p, pos); } catch (e) { return p.ovr; }
  }
  function newSpot(p, slot) {
    const pos = PT.C.SLOT_POS[slot];
    return !!pos && p.pos !== pos && !(p.alt || []).includes(pos);
  }
  function startsAt(t, pid, except) {
    for (const s of PT.C.SLOTS) { if (s !== 'KR' && s !== except && t.dc[s] && t.dc[s][0] === pid) return s; }
    return null;
  }

  function chip(t, slot, i) {
    const arr = t.dc[slot] || [];
    const p = P(arr[i]);
    const sel = st.sel && st.sel.slot === slot && st.sel.i === i;
    const tid = 'depth-slot-' + slot + '-' + i;
    if (!p) return html`<button type="button" class="dchip empty ${i === 0 ? 'starter' : 'sub'} ${sel ? 'sel' : ''}" data-action="d-chip" data-slot="${slot}" data-i="${i}" data-testid="${tid}"><span class="dchip-add">＋</span><span class="small">${i === 0 ? 'Pick starter' : 'Bench'}</span></button>`;
    const ns = newSpot(p, slot);
    return html`<button type="button" class="dchip ${i === 0 ? 'starter' : 'sub'} ${sel ? 'sel' : ''} ${p.inj ? 'hurt' : ''}" data-action="d-chip" data-slot="${slot}" data-i="${i}" data-testid="${tid}" title="${K().pname(p)}">
      ${i === 0 ? K().portrait(p, 40, t.col.pri) : ''}
      <span class="dchip-m">
        <span class="dchip-n ellip"><span class="num jersey">#${p.num}</span>${K().short(p)}${t.capt === p.id ? D().raw(' <span class="capt">C</span>') : ''}${K().teamStars(t).indexOf(p.id) >= 0 ? K().starTag() : ''}</span>
        <span class="dchip-s">${K().stars(slotOvr(p, slot))}${ns ? D().raw(' <span class="chip chip-gold tiny">New spot</span>') : ''}${p.inj ? html` <span class="chip chip-hurt tiny">${K().ic('cross')}</span>` : ''}</span>
      </span>
    </button>`;
  }

  // ---------------- Stars (ROUND6 A): up to 8 Star players, at least 2 per side ----------------
  const SMAX = () => PT.C.STAR_MAX || 8, SMIN = () => PT.C.STAR_MIN_SIDE || 2;
  const v2 = () => !!(PT.League.Roster && PT.League.Roster.toggleStar);   // league side of ROUND6 landed?
  function starCounts(t) {
    const c = { off: 0, def: 0, n: 0 };
    K().teamStars(t).forEach((pid) => { const p = P(pid); const sd = p ? K().starSide(p.pos) : ''; if (sd) { c[sd]++; c.n++; } });
    return c;
  }
  function starChip(t, p) {
    const k = K().abilityKind(p.pos), a = K().ABILITY[k];
    return html`<div class="star-chip" data-testid="star-chip-${p.id}">
      ${K().portrait(p, 40, t.col.pri)}
      <span class="star-chip-m"><b class="star-chip-n">${K().short(p)}</b><span class="tiny">${K().posChip(p.pos)} ${a ? html`<span class="star-ab" title="${a.name}: ${a.txt}">${K().ic(a.icon)}<span class="star-ab-n">${a.name}</span></span>` : ''}</span></span>
      ${K().btn({ icon: 'x', action: 'd-unstar', kind: 'ghost', size: 's', title: 'Remove Star', data: { pid: p.id }, testid: 'btn-unstar-' + p.id })}
    </div>`;
  }
  function starPanel(t) {
    const c = starCounts(t), max = v2() ? SMAX() : 2;
    const list = K().teamStars(t).map(P).filter(Boolean).sort((x, y) => (K().starSide(x.pos) === 'off' ? 0 : 1) - (K().starSide(y.pos) === 'off' ? 0 : 1) || y.ovr - x.ovr);
    const side = (sd, label) => html`<span class="chip ${c[sd] < (v2() ? SMIN() : 1) ? 'chip-hurt' : 'chip-gold'}" data-testid="stars-count-${sd}">${label} ${c[sd]}</span>`;
    return html`<div class="star-head"><b class="star-n">Stars <span class="num" data-testid="stars-count">${c.n}/${max}</span></b>${side('off', 'Offense')}${side('def', 'Defense')}
        <span class="grow tiny muted star-hint">+5 key skills. Full meter = Surge.</span>
        ${K().btn({ label: 'Make Star', icon: 'plus', action: 'd-star', kind: 'go', size: 's', testid: 'btn-add-star' })}
        ${K().btn({ label: 'Auto-pick', icon: 'wand', action: 'd-autostar', kind: 'sec', size: 's', testid: 'btn-stars-auto' })}</div>
      ${K().pg('stars', list.map((p) => starChip(t, p)), { grid: true, cls: 'star-pg' })}`;
  }
  /** list of players who can become Stars (not Stars yet, not K), starters first */
  function pickStar() {
    const lg = L(), t = team(), mine = K().teamStars(t);
    const list = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir && p.pos !== 'K' && mine.indexOf(p.id) < 0)
      .map((p) => ({ p: p, slot: K().startSlot(t, p.id) }))
      .sort((x, y) => (!!y.slot - !!x.slot) || y.p.ovr - x.p.ovr);
    return UI.Modal.open({ title: 'Make Star', icon: 'star', cls: 'm-list',
      body: K().pg('starpick', list.map((x) => {
        const a = K().ABILITY[K().abilityKind(x.p.pos)];
        return K().playerRow(x.p, { action: 'pick', testid: 'star-pick-' + x.p.id, compact: true,
          sub: html`<span class="tiny muted">${x.slot ? 'Starter' : 'Bench'}</span>`,
          right: a ? html`<span class="star-ab small">${K().ic(a.icon)}<b>${a.name}</b></span>` : '' });
      }), { grid: true }),
      actions: { pick: (b, card, entry) => entry.close(+b.getAttribute('data-pid')) },
      buttons: [{ label: 'Cancel', value: null, kind: 'cancel' }] });
  }
  /** add / remove a Star. Uses Roster.toggleStar (ROUND6) when present, else the old one-per-side setStar. */
  function toggleStar(pid, adding) {
    const lg = L(), t = team(), R = PT.League.Roster, p = P(pid);
    if (!p) return;
    let r;
    if (v2()) r = R.toggleStar(lg, lg.userTid, pid);
    else if (adding && R.setStar) r = R.setStar(lg, lg.userTid, K().starSide(p.pos), pid);
    else r = { ok: false, msg: 'Need a ' + (K().starSide(p.pos) === 'off' ? 'offense' : 'defense') + ' Star.' };
    if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
    if (adding) { UI.Toast.show(K().short(p) + ' is a Star', 'good'); try { if (PT.Audio && PT.Audio.play) PT.Audio.play('ability'); } catch (e) { /* ignore */ } }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'star' });
    UI.refresh();
    void t;
  }

  // ROUND6 "0 scrolling": Lineup is one fixed panel — a tab row (Stars / Offense / Defense / Kicks) and a paged body
  const TABS = [['stars', 'Stars', 'star'], ['off', 'Offense', 'football'], ['def', 'Defense', 'shield'], ['kick', 'Kicks', 'boot']];
  function slotRow(t, slot) {
    const pos = PT.C.SLOT_POS[slot];
    return html`<div class="drow">
      <div class="drow-l"><b>${K().SLOT_LABEL[slot] || slot}</b>${slot === 'KR' ? html`<span class="tiny muted">Any</span>` : pos && K().posLabel(pos) !== K().SLOT_LABEL[slot] && !(K().SLOT_LABEL[slot] || '').startsWith(K().posLabel(pos)) ? html`<span class="tiny muted">${pos}</span>` : ''}</div>
      <div class="drow-c">${chip(t, slot, 0)}${slot === 'KR' ? '' : html`${chip(t, slot, 1)}${chip(t, slot, 2)}`}</div>
    </div>`;
  }
  UI.parts.lineup = function () {
    const lg = L(), t = team();
    let v = { ok: true, errors: [] };
    try { v = PT.League.Roster.validate(lg, t.id); } catch (e) { /* ignore */ }
    const capt = P(t.capt);
    const tab = st.tab || 'off';
    const c = starCounts(t), max = v2() ? SMAX() : 2;
    const tabs = html`<div class="seg dtabs" role="tablist">${TABS.map((x) => html`<button type="button" class="btn btn-sec btn-s ${tab === x[0] ? 'on' : ''}" role="tab" aria-selected="${tab === x[0]}" data-action="d-tab" data-tab="${x[0]}" data-testid="tab-lineup-${x[0]}">${K().ic(x[2])}<span>${x[1]}${x[0] === 'stars' ? ' ' + c.n + '/' + max : ''}</span></button>`)}</div>`;
    const tools = st.sel
      ? html`<span class="dsel"><b>${K().SLOT_LABEL[st.sel.slot] || st.sel.slot}${st.sel.i ? ' · Bench ' + st.sel.i : ''}</b> <span class="tiny">tap a spot to swap</span></span>
        ${K().btn({ label: 'Pick', icon: 'players', action: 'd-pick', kind: 'go', size: 's', testid: 'btn-depth-pick' })}
        ${K().btn({ label: 'Cancel', action: 'd-cancel', kind: 'ghost', size: 's', testid: 'btn-depth-cancel' })}`
      : html`${K().btn({ label: 'Auto Lineup', icon: 'wand', action: 'd-auto', kind: 'pri', size: 's', testid: 'btn-auto-lineup' })}
        <span class="capt-box"><span class="capt">C</span><b>${capt ? K().short(capt) : 'None'}</b></span>
        ${K().btn({ icon: 'crown', action: 'd-capt', kind: 'sec', size: 's', title: 'Change Captain', testid: 'btn-captain-pick' })}`;
    let bodyHtml;
    if (tab === 'stars') bodyHtml = starPanel(t);
    else {
      const g = GROUPS[tab === 'off' ? 0 : tab === 'def' ? 1 : 2];
      bodyHtml = K().pg('lineup-' + tab, g[2].map((slot) => slotRow(t, slot)), { grid: true, cls: 'dgrid-pg' });
    }
    return html`<div class="dtop">${tabs}<span class="dtools">${tools}</span></div>
      ${v.ok ? '' : html`<p class="dwarn" role="alert">${K().ic('warn')} ${v.errors[0] ? v.errors[0].msg : 'Fix your Lineup.'}${v.errors.length > 1 ? ' (+' + (v.errors.length - 1) + ')' : ''}</p>`}
      <section class="card fill dbody">${bodyHtml}</section>`;
  };

  // ---------------- moves ----------------
  function setDepth(slot, arr) {
    const r = PT.League.Roster.setDepth(L(), L().userTid, slot, arr.filter((x) => x != null));
    return r || { ok: true };
  }
  /** why pid cannot start at slot (or null). vacating = the slot he leaves as starter in this same move */
  function starterErr(t, slot, pid, vacating) {
    if (pid == null || slot === 'KR') return null;
    const p = P(pid);
    if (p.pos === 'K' && slot !== 'K') return p.fn + ' only kicks.';
    const other = startsAt(t, pid, slot);
    if (other && other !== vacating) return p.fn + ' already starts at ' + (K().SLOT_LABEL[other] || other) + '.';
    return null;
  }
  function swap(a, b) {
    const t = team();
    if (a.slot === b.slot) {
      const A = (t.dc[a.slot] || []).slice();
      const pa = A[a.i], pb = A[b.i];
      if (pa == null && pb == null) return;
      A[a.i] = pb; A[b.i] = pa;
      const r = setDepth(a.slot, A.filter((x) => x != null));
      if (r.ok === false) UI.Toast.show(r.msg, 'bad');
      return;
    }
    const A = (t.dc[a.slot] || []).slice(), B = (t.dc[b.slot] || []).slice();
    const pa = A[a.i], pb = B[b.i];
    if (pa == null && pb == null) return;
    const e = (a.i === 0 && starterErr(t, a.slot, pb, b.i === 0 ? b.slot : null)) || (b.i === 0 && starterErr(t, b.slot, pa, a.i === 0 ? a.slot : null));
    if (e) { UI.Toast.show(e, 'bad'); return; }
    A[a.i] = pb; B[b.i] = pa;
    const dedupe = (arr, keepIdx) => arr.filter((x, i) => x != null && (arr.indexOf(x) === i || i === keepIdx));
    const bad = [setDepth(a.slot, dedupe(A, a.i)), setDepth(b.slot, dedupe(B, b.i))].find((r) => r && r.ok === false);
    if (bad) UI.Toast.show(bad.msg, 'bad');
  }
  function place(sel, pid) {
    const t = team();
    if (sel.i === 0) { const e = starterErr(t, sel.slot, pid, null); if (e) { UI.Toast.show(e, 'bad'); return false; } }
    const arr = (t.dc[sel.slot] || []).slice();
    const old = arr.indexOf(pid);
    if (old >= 0) { arr[old] = arr[sel.i]; }
    arr[sel.i] = pid;
    const r = setDepth(sel.slot, arr.filter((x) => x != null));
    if (r.ok === false) { UI.Toast.show(r.msg, 'bad'); return false; }
    return true;
  }

  function pickList(sel) {
    const lg = L(), t = team();
    const pos = PT.C.SLOT_POS[sel.slot];
    const list = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir).map((p) => ({ p: p, o: slotOvr(p, sel.slot) }))
      .sort((a, b) => (b.p.pos === pos) - (a.p.pos === pos) || b.o - a.o);
    return UI.Modal.open({ title: 'Who plays ' + (K().SLOT_LABEL[sel.slot] || sel.slot) + '?', cls: 'm-list',
      body: K().pg('pick', list.map((x) => {
        const where = startsAt(t, x.p.id);
        return K().playerRow(x.p, { action: 'pick', testid: 'depth-pick-' + x.p.id, ovr: x.o, compact: true,
          sub: html`${newSpot(x.p, sel.slot) ? html`<span class="chip chip-gold tiny">New spot</span>` : ''}`,
          right: where ? html`<span class="tiny muted">Starts: ${K().SLOT_LABEL[where] || where}</span>` : html`<span class="tiny muted">Bench</span>` });
      }), { grid: true }),
      actions: { pick: (b, card, entry) => entry.close(+b.getAttribute('data-pid')) },
      buttons: [{ label: 'Cancel', value: null, kind: 'cancel' }] });
  }

  UI.parts.lineupActions = {
    'd-chip': (el) => {
      const s = { slot: el.getAttribute('data-slot'), i: +el.getAttribute('data-i') };
      const t = team();
      if (!st.sel) {
        if ((t.dc[s.slot] || [])[s.i] == null) { pickList(s).then((pid) => { if (pid != null && place(s, pid)) UI.Toast.show('Lineup updated', 'good'); }); return; }
        st.sel = s; UI.refresh(); return;
      }
      if (st.sel.slot === s.slot && st.sel.i === s.i) { st.sel = null; UI.refresh(); return; }
      const a = st.sel; st.sel = null;
      swap(a, s);
      UI.refresh();
    },
    'd-pick': () => {
      const s = st.sel; if (!s) return;
      pickList(s).then((pid) => { st.sel = null; if (pid != null) place(s, pid); UI.refresh(); });
    },
    'd-cancel': () => { st.sel = null; UI.refresh(); },
    'd-tab': (el) => { st.tab = el.getAttribute('data-tab'); st.sel = null; UI.refresh(); },
    'd-star': () => {
      if (v2() && starCounts(team()).n >= SMAX()) { UI.Toast.show(SMAX() + ' Stars max. Remove one first.', 'bad'); return; }
      pickStar().then((pid) => { if (pid != null) toggleStar(pid, true); });
    },
    'd-unstar': (el) => {
      const pid = +el.getAttribute('data-pid'), p = P(pid), t = team();
      // short block message before asking the league (ROUND6: "Need 2 defense Stars.")
      if (p && v2()) { const c = starCounts(t), sd = K().starSide(p.pos); if (c[sd] <= SMIN()) { UI.Toast.show('Need ' + SMIN() + ' ' + (sd === 'off' ? 'offense' : 'defense') + ' Stars.', 'bad'); return; } }
      toggleStar(pid, false);
    },
    'd-autostar': () => {
      const lg = L(), R = PT.League.Roster;
      let r = null;
      if (R && R.autoStars) r = R.autoStars(lg, lg.userTid);
      else if (R && R.setStar) { R.setStar(lg, lg.userTid, 'off', null); r = R.setStar(lg, lg.userTid, 'def', null); }
      if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
      if (PT.Events) PT.Events.emit('league:changed', { what: 'star' });
      UI.Toast.show('Stars picked', 'good');
      UI.refresh();
    },
    'd-auto': () => {
      const lg = L();
      PT.League.Roster.autoDepth(lg, lg.userTid);
      st.sel = null;
      if (PT.Events) PT.Events.emit('league:changed', { what: 'depth' });
      UI.Toast.show('Best lineup set!', 'good');
      UI.refresh();
    },
    'd-capt': () => {
      const lg = L(), t = team();
      const list = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir).sort((a, b) => (b.r.smt - a.r.smt));
      UI.Modal.open({ title: 'Pick a Captain', icon: 'crown', cls: 'm-list',
        body: K().pg('capt', list.map((p) => K().playerRow(p, { action: 'pick', testid: 'capt-pick-' + p.id, compact: true,
          right: html`<span class="small">Smarts <b class="num">${p.r.smt}</b></span>${K().mood(p.mor)}` })), { grid: true }),
        actions: { pick: (b, card, entry) => entry.close(+b.getAttribute('data-pid')) },
        buttons: [{ label: 'Cancel', value: null, kind: 'cancel' }] })
        .then((pid) => {
          if (pid == null || pid === t.capt) return;
          const r = UI.adapt && UI.adapt.setCaptain ? UI.adapt.setCaptain(lg, t.id, pid) : null;
          if (!r) { t.capt = pid; if (PT.Events) PT.Events.emit('league:changed', { what: 'captain' }); }
          if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
          UI.Toast.show('New Captain!', 'good');
          UI.refresh();
        });
    }
  };

  UI.screens.depth = {
    title: 'Lineup',
    nav: 'depth',
    mount: (el) => D().set(el, K().layout(UI.parts.lineup(), null, 'fit lineup')),
    unmount: () => { st.sel = null; },
    actions: UI.parts.lineupActions,
    keys: (ev) => { if (ev.key === 'Escape' && st.sel) { st.sel = null; UI.refresh(); return true; } return false; }
  };
})(globalThis.PT = globalThis.PT || {});
