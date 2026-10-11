/* Pixel Touchdown: js/ui/screens/roster.js
 * Owner: WP5 (TEAM-UX redesign). Team › Roster: who is on the team. One paged table that fills the height:
 * portrait · full name · pos · rating (stars + small number) · age (hurt: weeks out, red) · tags (STAR, mood only when low).
 * Sort = tap a column head. Tap a row → player card. params.tid → any team (read-only for AI teams; strip has Swap).
 * testids: player-row-{pid}, roster-filter-menu (Pos dropdown) → sheet roster-filter-{id}, roster-sort (phones) / roster-sort-{stars|pos|age}, btn-captain-pick (strip), btn-team-swap.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  UI.parts = UI.parts || {};

  const st = { filter: 'all', sort: 'stars' };
  const FILTERS = [['all', 'All'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['OL', 'OL'],
    ['DL', 'DL'], ['LB', 'LB'], ['CB', 'CB'], ['S', 'S'], ['K', 'K'], ['hurt', 'Hurt']];

  function sorted(list) {
    const posI = (p) => PT.C.POS.indexOf(p.pos);
    const by = {
      stars: (a, b) => b.ovr - a.ovr,
      pos: (a, b) => posI(a) - posI(b) || b.ovr - a.ovr,
      age: (a, b) => a.age - b.age || b.ovr - a.ovr
    }[st.sort] || ((a, b) => b.ovr - a.ovr);
    return list.slice().sort(by);
  }
  function keep(p) {
    const f = st.filter;
    if (f === 'all') return true;
    if (f === 'hurt') return !!p.inj || p.ir;
    return p.pos === f;
  }

  /** HUNT2 #1: a hurt player shows his weeks out (red) where the age goes; the full text is the tooltip */
  function hurtCell(p) {
    if (p.ir || p.inj) {
      const w = p.inj ? (p.inj.w >= 90 || p.inj.sev >= 4 ? 'Out' : p.inj.w > 0 ? p.inj.w + 'w' : 'Ouch') : 'IR';
      return html`<span class="tx-c-age tx-hurt" title="${p.ir ? 'Hurt List · ' : ''}${K().injuryText(p) || 'Hurt'}">${K().ic('cross')}<b class="num">${p.ir && !p.inj ? 'IR' : w}</b></span>`;
    }
    return html`<span class="tx-c-age"><span class="num">${p.age}</span><span class="tx-u">yrs</span></span>`;
  }
  function row(L, t, p, mine) {
    const star = K().isStar(L, p);
    const capt = t.capt === p.id;
    return html`<button type="button" class="tx-row tx-rrow ${p.inj || p.ir ? 'is-hurt' : ''} ${p.ir ? 'is-ir' : ''}" data-action="player" data-pid="${p.id}" data-testid="player-row-${p.id}" title="${K().pname(p)}">
      <span class="tx-c-por">${K().portrait(p, 28, t.col.pri)}</span>
      <span class="tx-nm"><b>${K().pname(p)}</b>${capt ? D().raw('<span class="capt" title="Captain">C</span>') : ''}</span>
      <span class="tx-c-pos">${K().posChip(p.pos)}</span>
      <span class="tx-c-rate">${K().stars(p.ovr)}</span>
      ${hurtCell(p)}
      <span class="tx-c-tags">${star ? html`<span class="tx-star" title="Star player">${K().ic('star')}<b>STAR</b></span>` : ''}${mine && p.mor < 50 ? K().mood(p.mor) : ''}</span>
    </button>`;
  }

  /** roster table (filter row + sortable head + paged rows). Hurt List players come last. */
  UI.parts.rosterList = function (tid) {
    const L = PT.App.L;
    const t = L.teams[tid];
    const mine = tid === L.userTid;
    const all = PT.League.Q.roster(L, tid);
    const active = sorted(all.filter((p) => !p.ir && keep(p))), ir = sorted(all.filter((p) => p.ir && keep(p)));
    const rows = active.concat(ir).map((p) => row(L, t, p, mine));
    const nHurt = all.filter((p) => p.inj || p.ir).length;
    // HUNT5-ui-core #13: one "Pos" dropdown at every width (the sheet lists All · QB … K · Hurt)
    const curF = FILTERS.find((f) => f[0] === st.filter) || FILTERS[0];
    const menu = html`<button type="button" class="tx-f tx-posbtn ${st.filter !== 'all' ? 'on' : ''}" data-action="r-menu" data-testid="roster-filter-menu" aria-haspopup="dialog">Pos<b>${curF[1]}</b><i class="tx-caret" aria-hidden="true"></i></button>`;
    const head = (id, label, cls) => html`<button type="button" class="tx-sort ${cls} ${st.sort === id ? 'on' : ''}" data-action="r-sort" data-id="${id}" data-testid="roster-sort-${id}" title="Sort by ${label}">${label}${st.sort === id ? K().ic('down') : ''}</button>`;
    const SORTS = [['stars', 'Rating'], ['pos', 'Pos'], ['age', 'Age']];
    const sNow = SORTS.find((x) => x[0] === st.sort) || SORTS[0], sNext = SORTS[(SORTS.indexOf(sNow) + 1) % SORTS.length];
    const cycle = html`<button type="button" class="tx-f tx-cyc" data-action="r-sort" data-id="${sNext[0]}" data-testid="roster-sort" title="Sort by ${sNext[1]}">${K().ic('down')}${sNow[1]}</button>`;
    UI.parts._rosterSheet = { nHurt: nHurt };
    return html`<div class="tx-filters" role="toolbar" aria-label="Show">${menu}${cycle}<span class="grow"></span>${nHurt ? html`<span class="tx-hurtn">${K().ic('cross')}<b class="num">${nHurt}</b> hurt</span>` : ''}${cutChip(tid)}<span class="tx-count ${weekOneOver(tid) > 0 ? 'bad' : ''}"><b class="num">${UI.parts.rosterCount(tid)}</b> players</span></div>
      ${K().card(html`<div class="tx-thead tx-rrow"><span class="tx-c-por"></span><span class="tx-nm">Player</span>
        ${head('pos', 'Pos', 'tx-c-pos')}${head('stars', 'Rating', 'tx-c-rate')}${head('age', 'Age', 'tx-c-age')}<span class="tx-c-tags"></span></div>
        ${K().pg('roster', rows, { cls: 'tx-pg tx-side-pg', empty: html`<p class="muted tx-empty">No players here.</p>` })}`, 'fill tx-list tx-roster')}`;
  };
  /** HUNT6-team #1: in Draft / Market the limit that matters is Week 1's (22, everyone counts: FK.rosterCount) */
  function weekOne(tid) {
    const L = PT.App.L, FK = UI.FlowKit;
    return tid === L.userTid && FK && FK.rosterCount && (L.phase === 'DRAFT' || L.phase === 'FREE_AGENCY') ? FK.rosterCount(L) : null;
  }
  function weekOneOver(tid) { const rc = weekOne(tid); return rc ? rc.act - rc.max : 0; }
  function cutChip(tid) {
    const n = weekOneOver(tid);
    if (n <= 0) return '';
    // the chip IS the way back to the Market (FREE_AGENCY): one control, never cut
    return PT.App.L.phase === 'FREE_AGENCY'
      ? html`<button type="button" class="tx-cut tx-cut-btn" data-action="r-market" data-testid="roster-cut-n" title="Back to the Market">${K().ic('warn')}Cut ${n} for Week 1</button>`
      : html`<span class="tx-cut" data-testid="roster-cut-n">${K().ic('warn')}Cut ${n} for Week 1</span>`;
  }
  /** "22/22" (active players / limit) */
  UI.parts.rosterCount = function (tid) {
    const L = PT.App.L;
    const rc = weekOne(tid);
    if (rc) return rc.act + '/' + rc.max;
    const n = PT.League.Q.roster(L, tid).filter((p) => !p.ir).length;
    const max = ['REGULAR', 'PLAYOFFS'].includes(L.phase) || (L.phase === 'PRESEASON' && L.sub >= 2) ? PT.C.ROSTER.MAX_SEASON : PT.C.ROSTER.MAX_OFF;
    return n + '/' + max;
  };
  UI.parts.rosterActions = {
    'r-filter': (el) => { st.filter = el.getAttribute('data-id'); UI.pgPage('roster', 0); UI.refresh(); },
    'r-menu': () => {
      const n = (UI.parts._rosterSheet || {}).nHurt || 0;
      const chip = (f) => html`<button type="button" class="tx-f ${st.filter === f[0] ? 'on' : ''}" data-action="r-pick" data-id="${f[0]}" data-testid="roster-filter-${f[0]}" aria-pressed="${st.filter === f[0]}">${f[1]}${f[0] === 'hurt' && n ? html`<b class="tx-fn num">${n}</b>` : ''}</button>`;
      UI.Modal.open({ title: 'Show', cls: 'm-txpos', body: html`<div class="tx-sheet">${FILTERS.map(chip)}</div>`,
        actions: { 'r-pick': (b, card, entry) => entry.close(b.getAttribute('data-id')) },
        buttons: [{ label: 'Close', value: null, kind: 'cancel' }] })
        .then((v) => { if (v == null) return; st.filter = v; UI.pgPage('roster', 0); UI.refresh(); });
    },
    'r-sort': (el) => { st.sort = el.getAttribute('data-id'); UI.pgPage('roster', 0); UI.refresh(); },
    'r-market': () => { const c = UI.current(); if (UI.depth() > 1 && c && c.name === 'roster') UI.back(); if (!UI.current() || UI.current().name !== 'market') UI.reset('market'); }
  };

  function mount(el, params) {
    const L = PT.App.L;
    const tid = params.tid == null ? L.userTid : params.tid;
    D().set(el, K().layout(html`${UI.parts.teamStrip(tid)}${UI.parts.rosterList(tid)}`, null, 'fit tx tx-ros'));
  }

  UI.screens.roster = {
    title: (p) => {
      const L = PT.App.L, tid = p.tid == null ? L.userTid : p.tid;
      return tid === L.userTid ? L.teams[tid].name : L.teams[tid].city + ' ' + L.teams[tid].name;
    },
    nav: 'roster',
    mount: mount,
    actions: Object.assign({
      swap: (el, ev, params) => UI.go('swaps', { tid: params.tid }),
      'tm-capt': () => UI.parts.pickCaptain()
    }, UI.parts.rosterActions)
  };
})(globalThis.PT = globalThis.PT || {});
