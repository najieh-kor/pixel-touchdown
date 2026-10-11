/* Pixel Touchdown: js/ui/screens/roster.js
 * Owner: WP5. Responsibility: roster list, filters, release, player card open.
 * params.tid → any team (read-only for AI teams). Exposes PT.UI.parts.rosterList(state, tid) for the Team screen.
 * testids: player-row-{pid}, roster-filter-{id}, roster-sort-{id}.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  UI.parts = UI.parts || {};
  /** ROUND6: each paged row sits in a .pg-cell so its pixel frame + drop shadow count toward the measured height */
  const cells = (rows) => rows.map((r) => html`<div class="pg-cell">${r}</div>`);

  const st = { filter: 'all', sort: 'stars' };
  const FILTERS = [['all', 'All'], ['off', 'Off', 'Offense'], ['def', 'Def', 'Defense'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['OL', 'OL'],
    ['DL', 'DL'], ['LB', 'LB'], ['CB', 'CB'], ['S', 'S'], ['K', 'K'], ['hurt', 'Hurt']];
  const SORTS = [['stars', 'Stars'], ['pos', 'Spot'], ['age', 'Age'], ['pay', 'Pay'], ['yrs', 'Years'], ['mood', 'Mood']];

  function yearsLeft(L, p) { return K().yrsLeft(p, L); }
  function sorted(L, list) {
    const posI = (p) => PT.C.POS.indexOf(p.pos);
    const by = {
      stars: (a, b) => b.ovr - a.ovr,
      pos: (a, b) => posI(a) - posI(b) || b.ovr - a.ovr,
      age: (a, b) => a.age - b.age || b.ovr - a.ovr,
      pay: (a, b) => ((b.con && b.con.sal) || 0) - ((a.con && a.con.sal) || 0),
      yrs: (a, b) => yearsLeft(L, a) - yearsLeft(L, b),
      mood: (a, b) => a.mor - b.mor
    }[st.sort];
    return list.slice().sort(by);
  }
  function keep(p) {
    const f = st.filter;
    if (f === 'all') return true;
    if (f === 'off') return PT.C.OFF_POS.includes(p.pos);
    if (f === 'def') return PT.C.DEF_POS.includes(p.pos);
    if (f === 'hurt') return !!p.inj || p.ir;
    return p.pos === f;
  }
  function starterSlot(t, pid) {
    for (const s of PT.C.SLOTS) { if (s !== 'KR' && t.dc[s] && t.dc[s][0] === pid) return s; }
    return null;
  }

  /** list block (filters + sorted player rows), shared with Team › Players */
  UI.parts.rosterList = function (tid, head) {
    const L = PT.App.L;
    const t = L.teams[tid];
    const mine = tid === L.userTid;
    const all = PT.League.Q.roster(L, tid);
    const active = all.filter((p) => !p.ir), ir = all.filter((p) => p.ir);
    const rows = sorted(L, active.filter(keep));
    const right = (p) => {
      const sl = starterSlot(t, p.id);
      return html`<span class="ros-r1">${sl ? html`<span class="chip chip-go tiny">Starter</span>` : html`<span class="chip tiny">Bench</span>`}${mine ? K().mood(p.mor) : ''}</span>
        ${mine ? html`<span class="small">${K().payYears(p)}</span>` : html`<span class="small muted">Age ${p.age}</span>`}`;
    };
    // ROUND6 0-scroll: filter + sort chips in a side grid, then a paged grid (Hurt List players at the end).
    // The roster count sits in the title bar (rosterCount); Team Cash lives on the Pay tab.
    const list = rows.map((p) => K().playerRow(p, { team: t, right: right(p), compact: true }))
      .concat(ir.filter(keep).map((p) => K().playerRow(p, { team: t, cls: 'is-ir', compact: true, right: html`<span class="chip chip-hurt tiny">Hurt List</span><span class="small">${K().injuryText(p)}</span>` })));
    const nHurt = all.filter((p) => p.inj || p.ir).length;
    const chip = (f, action, on, extra) => html`<button type="button" class="fchip ${on ? 'on' : ''}" data-action="${action}" data-id="${f[0]}" data-testid="${action === 'r-sort' ? 'roster-sort-' : 'roster-filter-'}${f[0]}" title="${f[2] || f[1]}">${f[1]}${extra || ''}</button>`;
    return html`<div class="ros-cols">
      <div class="ros-side">
        <div class="ros-lab tiny">Show</div>
        <div class="ros-grid">${FILTERS.map((f) => chip(f, 'r-filter', st.filter === f[0], f[0] === 'hurt' && nHurt ? html` <b class="ros-n num">${nHurt}</b>` : ''))}</div>
        <div class="ros-lab tiny">Sort</div>
        <div class="ros-grid ros-sort">${SORTS.map((f) => chip(f, 'r-sort', st.sort === f[0]))}</div>
      </div>
      <div class="ros-main">${head || ''}${K().pg('roster', cells(list), { grid: true, cls: 'ros-pg', empty: K().empty('scope', 'No players.') })}</div>
    </div>`;
  };
  /** "22/22" for the title bar (the roster count moved out of the page) */
  UI.parts.rosterCount = function (tid) {
    const L = PT.App.L;
    const n = PT.League.Q.roster(L, tid).filter((p) => !p.ir).length;
    const max = ['REGULAR', 'PLAYOFFS'].includes(L.phase) || (L.phase === 'PRESEASON' && L.sub >= 2) ? PT.C.ROSTER.MAX_SEASON : PT.C.ROSTER.MAX_OFF;
    return n + '/' + max;
  };
  UI.parts.rosterActions = {
    'r-filter': (el) => { st.filter = el.getAttribute('data-id'); UI.refresh(); },
    'r-sort': (el) => { st.sort = el.getAttribute('data-id'); UI.refresh(); }
  };

  function mount(el, params) {
    const L = PT.App.L;
    const tid = params.tid == null ? L.userTid : params.tid;
    const t = L.teams[tid];
    const mine = tid === L.userTid;
    let head = '';
    if (!mine) {
      let r = { w: 0, l: 0, t: 0 };
      try { r = PT.League.Standings.get(L).find((x) => x.tid === tid) || r; } catch (e) { /* ignore */ }
      head = html`<section class="card team-head ros-head" style="${K().teamVars(t)}">${K().badge(t, 'm')}<div class="grow ros-head-t"><b class="big ellip">${t.city} ${t.name}</b><span class="ros-head-s">${K().stars(K().teamOvr(tid), { team: true })} <b class="num">${D().rec(r.w, r.l, r.t)}</b>
        <span class="small">${(PT.C.OFF_STYLES[t.style && t.style.off] || '')} · ${(PT.C.DEF_STYLES[t.style && t.style.def] || '')}</span></span></div>
        ${K().btn({ label: 'Swap', icon: 'swap', action: 'swap', kind: 'sec', size: 's', testid: 'btn-team-swap' })}</section>`;
    }
    D().set(el, K().layout(UI.parts.rosterList(tid, head), null, 'fit nsb roster'));
  }

  UI.screens.roster = {
    title: (p) => {
      const L = PT.App.L, tid = p.tid == null ? L.userTid : p.tid;
      let n = '';
      try { n = ' ' + UI.parts.rosterCount(tid); } catch (e) { n = ''; }
      return (tid === L.userTid ? 'Players' : L.teams[tid].name) + n;
    },
    nav: 'roster',
    mount: mount,
    actions: Object.assign({
      swap: (el, ev, params) => UI.go('swaps', { tid: params.tid })
    }, UI.parts.rosterActions)
  };
})(globalThis.PT = globalThis.PT || {});
