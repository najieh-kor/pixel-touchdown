/* Pixel Touchdown: js/ui/screens/depth.js
 * Owner: WP5 (TEAM-UX redesign). Team › Lineup: who starts + who the Stars are. Screen word: "Lineup".
 * Layout: a control column (Offense · Defense · Kicks, the Stars box "Stars 6/8 · Off 4 · Def 2", Auto Lineup)
 * + a field with the starters as positioned slot tiles (formation). Each tile: spot, name, rating at that spot, and a
 * star toggle (Make / Remove Star right on the slot). Tap a tile → a side panel lists who can play there (best fit
 * first, "New spot" = out of position) plus the 2 backups. Stars box → the Stars panel (remove · Auto Stars · Make Star).
 * Phones: the panel slides over the half of the field away from the tile. Wide screens: the panel is always docked.
 * testids: tab-lineup-{off|def|kick|stars}, depth-slot-{slot}-{0|1|2}, depth-pick-{pid}, btn-depth-cancel,
 *   tile-star-{slot}, btn-auto-lineup, btn-stars-auto, stars-count, stars-count-{off|def}, star-chip-{pid},
 *   btn-unstar-{pid}, btn-add-star, star-pick-{pid}, btn-star-back, btn-captain-pick (strip).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  UI.parts = UI.parts || {};

  // side: 'off' | 'def' | 'kick'; panel: null | {mode:'slot', slot, i} | {mode:'stars'} | {mode:'starpick'}; dock: 'l' | 'r'
  const st = { side: 'off', panel: null, dock: 'r' };
  // formation on an 8-column grid: [slot, first column (tiles span 2), row (1 = line of scrimmage)] — max 4 tiles a row
  const FORM = {
    off: [['WR1', 1, 1], ['OL1', 3, 1], ['OL2', 5, 1], ['WR2', 7, 1], ['TE', 2, 2], ['QB', 4, 2], ['RB', 4, 3]],
    def: [['CB1', 1, 1], ['DL1', 3, 1], ['DL2', 5, 1], ['CB2', 7, 1], ['LB1', 2, 2], ['LB2', 6, 2], ['S', 4, 3]],
    kick: [['K', 2, 2], ['KR', 6, 2]]
  };
  const SIDES = [['off', 'Offense', 'football'], ['def', 'Defense', 'shield'], ['kick', 'Kicks', 'boot']];

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
  const label = (slot) => K().SLOT_LABEL[slot] || slot;
  /** HUNT #37: last name, or "J. Name" when a teammate shares the last name */
  function tileName(t, p) {
    const twin = PT.League.Q.roster(L(), t.id).some((x) => x.id !== p.id && x.ln === p.ln);
    return twin ? K().short(p) : p.ln;
  }
  const sideOf = (slot) => (FORM.def.some((x) => x[0] === slot) ? 'def' : FORM.kick.some((x) => x[0] === slot) ? 'kick' : 'off');

  // ---------------- Stars (ROUND6 A): up to 8 Star players, at least 2 per side ----------------
  const SMAX = () => PT.C.STAR_MAX || 8, SMIN = () => PT.C.STAR_MIN_SIDE || 2;
  const v2 = () => !!(PT.League.Roster && PT.League.Roster.toggleStar);
  function starCounts(t) {
    const c = { off: 0, def: 0, n: 0 };
    K().teamStars(t).forEach((pid) => { const p = P(pid); const sd = p ? K().starSide(p.pos) : ''; if (sd) { c[sd]++; c.n++; } });
    return c;
  }
  /** add / remove a Star (Roster.toggleStar; old saves: setStar) with the short block messages */
  function toggleStar(pid, adding) {
    const lg = L(), t = team(), R = PT.League.Roster, p = P(pid);
    if (!p) return false;
    if (adding && v2() && starCounts(t).n >= SMAX()) { UI.Toast.show(SMAX() + ' Stars max. Remove one first.', 'bad'); return false; }
    if (!adding && v2()) { const c = starCounts(t), sd = K().starSide(p.pos); if (c[sd] <= SMIN()) { UI.Toast.show('Need ' + SMIN() + ' ' + (sd === 'off' ? 'offense' : 'defense') + ' Stars.', 'bad'); return false; } }
    let r;
    if (v2()) r = R.toggleStar(lg, lg.userTid, pid);
    else if (adding && R.setStar) r = R.setStar(lg, lg.userTid, K().starSide(p.pos), pid);
    else r = { ok: false, msg: 'Need a ' + (K().starSide(p.pos) === 'off' ? 'offense' : 'defense') + ' Star.' };
    if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return false; }
    if (adding) { UI.Toast.show(K().short(p) + ' is a Star', 'good'); try { if (PT.Audio && PT.Audio.play) PT.Audio.play('ability'); } catch (e) { /* ignore */ } }
    else UI.Toast.show(K().short(p) + ' is not a Star', 'info');
    if (PT.Events) PT.Events.emit('league:changed', { what: 'star' });
    return true;
  }

  // ---------------- field ----------------
  function tile(t, slot, col, row, stars) {
    const p = P((t.dc[slot] || [])[0]);
    const sel = st.panel && st.panel.mode === 'slot' && st.panel.slot === slot;
    const place = 'grid-column:' + col + ' / span 2;grid-row:' + row;
    if (!p) {
      return html`<div class="ln-tile empty ${sel ? 'sel' : ''}" style="${place}">
        <button type="button" class="ln-tb" data-action="d-slot" data-slot="${slot}" data-i="0" data-testid="depth-slot-${slot}-0">
          <span class="ln-sl">${label(slot)}</span><span class="ln-nm">${K().ic('plus')} Pick</span></button></div>`;
    }
    const star = stars.indexOf(p.id) >= 0;
    const ns = newSpot(p, slot);
    const canStar = slot !== 'K' && p.pos !== 'K';
    return html`<div class="ln-tile ${sel ? 'sel' : ''} ${star ? 'is-star' : ''} ${p.inj ? 'hurt' : ''}" style="${place}">
      <button type="button" class="ln-tb" data-action="d-slot" data-slot="${slot}" data-i="0" data-testid="depth-slot-${slot}-0" title="${label(slot)}: ${K().pname(p)}">
        <span class="ln-sl">${label(slot)}</span>
        <span class="ln-main">${K().portrait(p, 32, t.col.pri)}<span class="ln-nm">${tileName(t, p)}</span></span>
        <span class="ln-rt">${K().stars(slotOvr(p, slot))}${ns ? html`<span class="ln-warn" title="New spot: plays out of position">${K().ic('warn')}</span>` : ''}${p.inj ? html`<span class="ln-hurt" title="${K().injuryText(p)}">${K().ic('cross')}</span>` : ''}</span>
      </button>
      ${canStar ? html`<button type="button" class="ln-star ${star ? 'on' : ''}" data-action="d-startog" data-pid="${p.id}" data-testid="tile-star-${slot}" title="${star ? 'Remove Star' : 'Make Star'}" aria-pressed="${star}">${K().ic(star ? 'star' : 'star-empty')}</button>` : ''}
    </div>`;
  }
  function field(t, v) {
    const stars = K().teamStars(t);
    const side = st.side;
    const err = v.ok ? null : (v.errors[0] ? v.errors[0].msg : 'Fix your Lineup.');
    return html`<div class="ln-field ln-${side}" role="group" aria-label="${SIDES.find((x) => x[0] === side)[1]} starters">
      <span class="ln-los" aria-hidden="true"></span>
      ${FORM[side].map((f) => tile(t, f[0], f[1], f[2], stars))}
      ${err ? html`<p class="ln-err" role="alert">${K().ic('warn')} ${err}</p>` : ''}
    </div>`;
  }
  function controls(t) {
    const c = starCounts(t), max = v2() ? SMAX() : 2;
    const low = (sd) => c[sd] < (v2() ? SMIN() : 1);
    const starsOn = st.panel && (st.panel.mode === 'stars' || st.panel.mode === 'starpick' || st.panel.mode === 'replace');
    return html`<div class="ln-ctl">
      <div class="ln-seg" role="tablist">${SIDES.map((x) => html`<button type="button" class="ln-segb ${st.side === x[0] ? 'on' : ''}" role="tab" aria-selected="${st.side === x[0]}" data-action="d-side" data-side="${x[0]}" data-testid="tab-lineup-${x[0]}">${K().ic(x[2])}<span>${x[1]}</span></button>`)}</div>
      <button type="button" class="ln-stars ${starsOn ? 'on' : ''}" data-action="d-starsbox" data-testid="tab-lineup-stars" title="Your Star players">
        <span class="ln-stars-t">${K().ic('star')}<b>Stars <span class="num" data-testid="stars-count">${c.n}/${max}</span></b></span>
        <span class="ln-stars-s"><span class="${low('off') ? 'bad' : ''}" data-testid="stars-count-off">Off <b class="num">${c.off}</b></span> · <span class="${low('def') ? 'bad' : ''}" data-testid="stars-count-def">Def <b class="num">${c.def}</b></span></span>
      </button>
      <span class="grow"></span>
      ${K().btn({ label: 'Auto Lineup', icon: 'wand', action: 'd-auto', kind: 'sec', size: 's', testid: 'btn-auto-lineup', cls: 'ln-auto' })}
    </div>`;
  }

  // ---------------- side panel ----------------
  function panelHead(title, sub, close) {
    return html`<div class="ln-ph"><span class="ln-pt"><b>${title}</b>${sub ? html`<span class="ln-ps">${sub}</span>` : ''}</span>
      ${close ? html`<button type="button" class="ln-x" data-action="${close.action}" data-testid="${close.testid}" title="${close.title}" aria-label="${close.title}">${K().ic(close.icon)}</button>` : ''}</div>`;
  }
  function pickRow(p, slot, t, o) {
    const where = startsAt(t, p.id);
    const ns = slot && newSpot(p, slot);
    const sub = o.sub || (where && where !== slot ? 'Starts: ' + label(where) : '');
    return html`<button type="button" class="ln-pr ${p.inj ? 'hurt' : ''}" data-action="${o.action}" data-pid="${p.id}" data-testid="${o.testid}">
      ${K().portrait(p, 28, t.col.pri)}
      <span class="ln-pr-m"><b class="ln-pr-n">${K().pname(p)}</b>${K().posChip(p.pos)}${K().stars(o.ovr != null ? o.ovr : p.ovr)}${o.extra || ''}${ns ? html`<span class="chip chip-gold tiny" title="Plays out of position">New spot</span>` : ''}${p.inj ? K().hurtShort(p) : ''}${sub ? html`<span class="ln-pr-w">${sub}</span>` : ''}</span>
    </button>`;
  }
  function slotPanel(t, pn) {
    const lg = L(), slot = pn.slot, i = pn.i || 0;
    const arr = t.dc[slot] || [];
    const nSubs = slot === 'KR' ? 0 : (PT.C.SUBS_PER_SLOT || 2);
    const spot = (k, txt) => {
      const b = P(arr[k]);
      return html`<button type="button" class="ln-bk ${i === k ? 'on' : ''}" data-action="d-slot" data-slot="${slot}" data-i="${k}" data-testid="${k ? 'depth-slot-' + slot + '-' + k : 'depth-spot-' + slot + '-0'}"><span class="ln-bkl">${txt}</span>${b ? html`<b>${tileName(t, b)}</b>` : html`<span class="muted">Empty</span>`}</button>`;
    };
    const spots = [spot(0, 'Starter')];
    for (let k = 1; k <= nSubs; k++) spots.push(spot(k, 'Backup ' + k));
    const cur = arr[i];
    // HUNT2 #3: players who fit the spot first (by rating there); everyone else only behind "Other positions…"
    const all = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir && p.id !== cur && (slot === 'K' ? true : p.pos !== 'K'))
      .map((p) => ({ p: p, o: slotOvr(p, slot), fit: !newSpot(p, slot) }))
      .sort((a, b) => (b.fit - a.fit) || (b.o - a.o));
    const fits = all.filter((x) => x.fit);
    const list = pn.all || !fits.length ? all : fits;
    const more = !pn.all && fits.length && fits.length < all.length
      ? html`<button type="button" class="ln-more" data-action="d-more" data-testid="depth-pick-more">${K().ic('players')} Other positions… <span class="muted">(${all.length - fits.length})</span></button>` : '';
    return html`${panelHead(label(slot), i ? 'Pick backup ' + i : 'Pick a starter', { action: 'd-close', testid: 'btn-depth-cancel', title: 'Close', icon: 'x' })}
      ${nSubs ? html`<div class="ln-bks">${spots}</div>` : ''}
      ${K().pg('lnpick', list.map((x) => pickRow(x.p, slot, t, { action: 'd-pick', testid: 'depth-pick-' + x.p.id, ovr: x.o })).concat(more ? [more] : []), { cls: 'ln-pg tx-side-pg' })}`;
  }
  function starsPanel(t) {
    const c = starCounts(t), max = v2() ? SMAX() : 2;
    const full = v2() && c.n >= max;   // HUNT #36: at 8/8 Make Star is a disabled grey button ("8/8 full")
    const list = K().teamStars(t).map(P).filter(Boolean)
      .sort((x, y) => (K().starSide(x.pos) === 'off' ? 0 : 1) - (K().starSide(y.pos) === 'off' ? 0 : 1) || y.ovr - x.ovr);
    const rows = list.map((p) => {
      const a = K().ABILITY[K().abilityKind(p.pos)];
      return html`<div class="ln-sc" data-testid="star-chip-${p.id}">
        ${K().portrait(p, 28, t.col.pri)}
        <span class="ln-pr-m"><b class="ln-pr-n">${K().pname(p)}</b>${K().posChip(p.pos)}${a ? html`<span class="ln-ab" title="${a.name}: ${a.txt}">${K().ic(a.icon)}${a.name}</span>` : ''}</span>
        <button type="button" class="ln-x ln-unstar" data-action="d-unstar" data-pid="${p.id}" data-testid="btn-unstar-${p.id}" title="Remove Star" aria-label="Remove Star">${K().ic('x')}</button>
      </div>`;
    });
    return html`${panelHead('Your Stars', '+5 key skills · Surge', { action: 'd-close', testid: 'btn-stars-close', title: 'Close', icon: 'x' })}
      ${K().pg('lnstars', rows, { cls: 'ln-pg tx-side-pg', empty: html`<p class="muted small">No Stars yet.</p>` })}
      <div class="ln-pfoot">${K().btn({ label: 'Auto Stars', icon: 'wand', action: 'd-autostar', kind: 'sec', size: 's', testid: 'btn-stars-auto', cls: 'ln-add' })}${full
        ? K().btn({ label: 'Make Star', sub: max + '/' + max + ' full', icon: 'plus', action: 'd-addstar', kind: 'sec', size: 's', testid: 'btn-add-star', cls: 'ln-add ln-full', disabled: true, title: 'Remove a Star first' })
        : K().btn({ label: 'Make Star', icon: 'plus', action: 'd-addstar', kind: 'gold', size: 's', testid: 'btn-add-star', cls: 'ln-add' })}</div>`;
  }
  function starPickPanel(t) {
    const lg = L(), mine = K().teamStars(t);
    const list = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir && p.pos !== 'K' && mine.indexOf(p.id) < 0)
      .map((p) => ({ p: p, slot: K().startSlot(t, p.id) }))
      .sort((x, y) => (!!y.slot - !!x.slot) || y.p.ovr - x.p.ovr);
    return html`${panelHead('Make Star', 'Starters first', { action: 'd-stars', testid: 'btn-star-back', title: 'Back to Stars', icon: 'back' })}
      ${K().pg('lnstarpick', list.map((x) => {
        const a = K().ABILITY[K().abilityKind(x.p.pos)];
        return pickRow(x.p, null, t, { action: 'd-starpick', testid: 'star-pick-' + x.p.id,
          extra: a ? html`<span class="ln-ab" title="${a.name}: ${a.txt}">${K().ic(a.icon)}${a.name}</span>` : '',
          sub: x.slot ? 'Starter: ' + label(x.slot) : 'Bench' });
      }), { cls: 'ln-pg tx-side-pg' })}`;
  }
  /** HUNT2 #2: 8/8 and a new Star tapped → pick the Star he replaces (rows that would break 2 per side are off) */
  function replacePanel(t, pn) {
    const np = P(pn.pid), nsd = np ? K().starSide(np.pos) : '';
    const c = starCounts(t);
    const rows = K().teamStars(t).map(P).filter(Boolean).map((p) => {
      const sd = K().starSide(p.pos);
      const ok = sd === nsd || c[sd] - 1 >= SMIN();
      const a = K().ABILITY[K().abilityKind(p.pos)];
      return html`<button type="button" class="ln-pr" data-action="d-replace" data-pid="${p.id}" data-testid="star-replace-${p.id}" ${ok ? '' : D().raw('disabled')}>
        ${K().portrait(p, 28, t.col.pri)}
        <span class="ln-pr-m"><b class="ln-pr-n">${K().pname(p)}</b>${K().posChip(p.pos)}${a ? html`<span class="ln-ab">${K().ic(a.icon)}${a.name}</span>` : ''}${ok ? '' : html`<span class="ln-pr-w">Need ${SMIN()} ${sd === 'off' ? 'offense' : 'defense'} Stars</span>`}</span></button>`;
    });
    return html`${panelHead('Replace which Star?', np ? 'New: ' + K().pname(np) : '', { action: 'd-close', testid: 'btn-replace-cancel', title: 'Cancel', icon: 'x' })}
      ${K().pg('lnrep', rows, { cls: 'ln-pg tx-side-pg' })}`;
  }
  function panel(t) {
    const pn = st.panel || { mode: 'stars' };
    const body = pn.mode === 'slot' ? slotPanel(t, pn) : pn.mode === 'starpick' ? starPickPanel(t) : pn.mode === 'replace' ? replacePanel(t, pn) : starsPanel(t);
    return html`<aside class="ln-panel ${st.panel ? 'open' : ''} ln-dock-${st.panel ? st.dock : 'r'} ln-p-${pn.mode}" aria-label="Lineup panel">${body}</aside>`;
  }

  UI.parts.lineup = function () {
    const lg = L(), t = team();
    let v = { ok: true, errors: [] };
    try { v = PT.League.Roster.validate(lg, t.id); } catch (e) { /* ignore */ }
    if (st.panel && st.panel.mode === 'slot' && sideOf(st.panel.slot) !== st.side) st.panel = null;
    return html`<div class="ln ${st.panel ? 'has-panel' : ''}">${controls(t)}<div class="ln-stage">${field(t, v)}</div>${panel(t)}</div>`;
  };

  // ---------------- moves ----------------
  function setDepth(slot, arr) {
    const r = PT.League.Roster.setDepth(L(), L().userTid, slot, arr.filter((x) => x != null));
    return r || { ok: true };
  }
  /** put pid at spot i of slot (0 = starter). A starter picked from another slot swaps with this one (Roster.setDepth). */
  function place(slot, i, pid) {
    const t = team(), p = P(pid);
    if (i === 0 && p.pos === 'K' && slot !== 'K') { UI.Toast.show(p.fn + ' only kicks.', 'bad'); return false; }
    const was = i === 0 ? startsAt(t, pid, slot) : null;
    const arr = (t.dc[slot] || []).slice();
    const old = arr.indexOf(pid);
    if (old >= 0) arr[old] = arr[i];
    while (arr.length < i) arr.push(null);
    arr[i] = pid;
    const r = setDepth(slot, arr.filter((x) => x != null));
    if (r.ok === false) { UI.Toast.show(r.msg, 'bad'); return false; }
    UI.Toast.show(was ? K().short(p) + ' moves from ' + label(was) : K().short(p) + (i ? ' is backup ' + i : ' starts at ' + label(slot)), 'good');
    return true;
  }

  const close = () => { st.panel = null; UI.refresh(); };
  UI.parts.lineupActions = {
    // HUNT2 #2: any open panel closes when the side changes (Kicks has no Stars)
    'd-side': (el) => { st.side = el.getAttribute('data-side'); st.panel = null; UI.refresh(); },
    'd-more': () => { if (st.panel && st.panel.mode === 'slot') { st.panel.all = true; UI.pgPage('lnpick', 0); UI.refresh(); } },
    'd-replace': (el) => {
      const pn = st.panel; if (!pn || pn.mode !== 'replace') return;
      const lg = L(), t = team(), out = +el.getAttribute('data-pid');
      const list = K().teamStars(t).filter((x) => x !== out).concat([pn.pid]);
      const r = PT.League.Roster.setStars(lg, lg.userTid, list);
      if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
      UI.Toast.show(K().short(P(pn.pid)) + ' is a Star · ' + K().short(P(out)) + ' is not', 'good');
      if (PT.Events) PT.Events.emit('league:changed', { what: 'star' });
      st.panel = null; UI.refresh();
    },
    'd-slot': (el) => {
      const slot = el.getAttribute('data-slot'), i = +el.getAttribute('data-i') || 0;
      const pn = st.panel;
      if (i === 0 && pn && pn.mode === 'slot' && pn.slot === slot && !pn.i) { close(); return; }
      const f = FORM[sideOf(slot)].find((x) => x[0] === slot);
      if (!pn || pn.mode !== 'slot' || pn.slot !== slot) st.dock = f && f[1] + 1 > 4 ? 'l' : 'r';   // panel docks on the far side of the tile
      st.panel = { mode: 'slot', slot: slot, i: i };
      UI.pgPage('lnpick', 0);
      UI.refresh();
    },
    'd-pick': (el) => {
      const pn = st.panel; if (!pn || pn.mode !== 'slot') return;
      if (place(pn.slot, pn.i || 0, +el.getAttribute('data-pid'))) st.panel = null;
      UI.refresh();
    },
    'd-close': close,
    'd-starsbox': () => { if (st.panel && st.panel.mode === 'stars') { close(); return; } st.panel = { mode: 'stars' }; st.dock = 'r'; UI.refresh(); },
    'd-stars': () => { st.panel = { mode: 'stars' }; st.dock = 'r'; UI.refresh(); },
    'd-addstar': () => {
      if (v2() && starCounts(team()).n >= SMAX()) { UI.Toast.show(SMAX() + ' Stars max. Remove one first.', 'bad'); return; }
      st.panel = { mode: 'starpick' }; st.dock = 'r'; UI.pgPage('lnstarpick', 0); UI.refresh();
    },
    'd-starpick': (el) => { if (toggleStar(+el.getAttribute('data-pid'), true)) st.panel = { mode: 'stars' }; UI.refresh(); },
    'd-unstar': (el) => { toggleStar(+el.getAttribute('data-pid'), false); UI.refresh(); },
    'd-startog': (el) => {
      const pid = +el.getAttribute('data-pid'), adding = K().teamStars(team()).indexOf(pid) < 0;
      // HUNT2 #2: at 8/8 the tile star asks which Star to replace (one tap more, no dead-end toast)
      if (adding && v2() && starCounts(team()).n >= SMAX()) { st.panel = { mode: 'replace', pid: pid }; st.dock = 'r'; UI.pgPage('lnrep', 0); UI.refresh(); return; }
      toggleStar(pid, adding);
      UI.refresh();
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
      st.panel = null;
      if (PT.Events) PT.Events.emit('league:changed', { what: 'depth' });
      UI.Toast.show('Best lineup set!', 'good');
      UI.refresh();
    },
    'tm-capt': () => UI.parts.pickCaptain()
  };

  UI.screens.depth = {
    title: () => team().name,
    nav: 'depth',
    mount: (el) => D().set(el, K().layout(UI.parts.lineup(), null, 'fit tx tx-ln')),
    unmount: () => { st.panel = null; },
    actions: UI.parts.lineupActions,
    keys: (ev) => { if (ev.key === 'Escape' && st.panel) { st.panel = null; UI.refresh(); return true; } return false; }
  };
})(globalThis.PT = globalThis.PT || {});
