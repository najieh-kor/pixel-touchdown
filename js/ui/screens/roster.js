/* Pixel Touchdown: js/ui/screens/roster.js
 * Owner: WP5 (TEAM-UX redesign). Team › Roster: who is on the team. One paged table that fills the height:
 * portrait · full name · pos · rating (stars + small number) · age · tags (STAR, hurt, mood). One filter row on top.
 * Sort = tap a column head. Tap a row → player card. params.tid → any team (read-only for AI teams; strip has Swap).
 * testids: player-row-{pid}, roster-filter-{id}, roster-sort-{stars|pos|age}, btn-captain-pick (strip), btn-team-swap.
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

  function row(L, t, p, mine) {
    const star = K().isStar(L, p);
    const capt = t.capt === p.id;
    return html`<button type="button" class="tx-row tx-rrow ${p.inj || p.ir ? 'is-hurt' : ''} ${p.ir ? 'is-ir' : ''}" data-action="player" data-pid="${p.id}" data-testid="player-row-${p.id}" title="${K().pname(p)}">
      <span class="tx-c-por">${K().portrait(p, 28, t.col.pri)}</span>
      <span class="tx-nm"><b>${K().pname(p)}</b>${capt ? D().raw('<span class="capt" title="Captain">C</span>') : ''}</span>
      <span class="tx-c-pos">${K().posChip(p.pos)}</span>
      <span class="tx-c-rate">${K().stars(p.ovr)}</span>
      <span class="tx-c-age"><span class="num">${p.age}</span><span class="tx-u">yrs</span></span>
      <span class="tx-c-tags">${star ? K().starTag() : ''}${p.ir ? html`<span class="chip chip-hurt tiny" title="Hurt List">IR</span>` : p.inj ? K().hurtShort(p) : ''}${mine ? K().mood(p.mor) : ''}</span>
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
    const chip = (f) => html`<button type="button" class="tx-f ${st.filter === f[0] ? 'on' : ''}" data-action="r-filter" data-id="${f[0]}" data-testid="roster-filter-${f[0]}" aria-pressed="${st.filter === f[0]}">${f[1]}${f[0] === 'hurt' && nHurt ? html`<b class="tx-fn num">${nHurt}</b>` : ''}</button>`;
    const head = (id, label, cls) => html`<button type="button" class="tx-sort ${cls} ${st.sort === id ? 'on' : ''}" data-action="r-sort" data-id="${id}" data-testid="roster-sort-${id}" title="Sort by ${label}">${label}${st.sort === id ? K().ic('down') : ''}</button>`;
    const SORTS = [['stars', 'Rating'], ['pos', 'Pos'], ['age', 'Age']];
    const sNow = SORTS.find((x) => x[0] === st.sort) || SORTS[0], sNext = SORTS[(SORTS.indexOf(sNow) + 1) % SORTS.length];
    const cycle = html`<button type="button" class="tx-f tx-cyc" data-action="r-sort" data-id="${sNext[0]}" data-testid="roster-sort" title="Sort by ${sNext[1]}">${K().ic('down')}${sNow[1]}</button>`;
    return html`<div class="tx-filters" role="toolbar" aria-label="Show">${FILTERS.map(chip)}${cycle}</div>
      ${K().card(html`<div class="tx-thead tx-rrow"><span class="tx-c-por"></span><span class="tx-nm">Player <span class="muted num">${UI.parts.rosterCount(tid)}</span></span>
        ${head('pos', 'Pos', 'tx-c-pos')}${head('stars', 'Rating', 'tx-c-rate')}${head('age', 'Age', 'tx-c-age')}<span class="tx-c-tags"></span></div>
        ${K().pg('roster', rows, { cls: 'tx-pg tx-side-pg', empty: html`<p class="muted tx-empty">No players here.</p>` })}`, 'fill tx-list tx-roster')}`;
  };
  /** "22/22" (active players / limit) */
  UI.parts.rosterCount = function (tid) {
    const L = PT.App.L;
    const n = PT.League.Q.roster(L, tid).filter((p) => !p.ir).length;
    const max = ['REGULAR', 'PLAYOFFS'].includes(L.phase) || (L.phase === 'PRESEASON' && L.sub >= 2) ? PT.C.ROSTER.MAX_SEASON : PT.C.ROSTER.MAX_OFF;
    return n + '/' + max;
  };
  UI.parts.rosterActions = {
    'r-filter': (el) => { st.filter = el.getAttribute('data-id'); UI.pgPage('roster', 0); UI.refresh(); },
    'r-sort': (el) => { st.sort = el.getAttribute('data-id'); UI.pgPage('roster', 0); UI.refresh(); }
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
