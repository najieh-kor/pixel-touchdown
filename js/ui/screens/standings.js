/* Pixel Touchdown: js/ui/screens/standings.js
 * Owner: WP5. Responsibility: division/conference standings, playoff picture.
 * Screen 'standings' params {tab:'div'|'picture'|'power'|'teams'}. Rows open that team (global action team-view).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const CONF_EMO = ['sun', 'snow'];
  function confName(c) { const n = (PT.Data.Teams && PT.Data.Teams.CONFS) || ['Sunny Conference', 'Frosty Conference']; return n[c] || 'Conference ' + (c + 1); }
  function divName(c, d) { const n = (PT.Data.Teams && PT.Data.Teams.DIVS) || []; return (n[c] && n[c][d]) || 'Division ' + (d + 1); }
  function rows(L) { try { return PT.League.Standings.get(L); } catch (e) { return L.teams.map((t) => ({ tid: t.id, w: 0, l: 0, t: 0, pct: 0, pf: 0, pa: 0, strk: '', seed: null, clinch: null })); } }
  function division(L, c, d) {
    try { return PT.League.Standings.division(L, c, d); }
    catch (e) { return rows(L).filter((r) => L.teams[r.tid].conf === c && L.teams[r.tid].div === d); }
  }
  function conference(L, c) {
    try { return PT.League.Standings.conference(L, c); }
    catch (e) { return rows(L).filter((r) => L.teams[r.tid].conf === c); }
  }
  const CLINCH = { z: 'Top seed', y: 'Clinched division', x: 'Clinched playoffs', e: 'Eliminated' };

  function teamCell(L, tid, extra) {
    const t = L.teams[tid];
    return html`<span class="tcell">${K().badge(t, 's')}<span class="ellip">${t.name}</span>${extra || ''}</span>`;
  }
  function tr(L, r, u, cells, tid) {
    return html`<tr class="${r.tid === u ? 'me' : ''}" data-action="team-view" data-tid="${r.tid}" data-testid="${tid || 'team-row-'}${r.tid}">${cells}</tr>`;
  }

  // ---------------- tabs ----------------
  // ROUND6 "0 scrolling": every tab is one paged list (pager.js) in a fit layout; the pager sits at the right.
  function divCard(L, u, c, d) {
    return html`<section class="card nc-div"><table class="tbl lh-tbl std-tbl nc-tbl"><thead><tr><th class="nc-th" title="${confName(c)}">${K().ic(CONF_EMO[c])}${divName(c, d)}</th><th class="n">W</th><th class="n">L</th><th class="n">T</th><th class="n col-pf">PF</th><th class="n col-pa">PA</th><th class="n col-strk">Strk</th></tr></thead><tbody>
        ${division(L, c, d).map((r) => tr(L, r, u, html`<td>${teamCell(L, r.tid, html`${r.seed ? html`<span class="seed seed-m" title="Playoff seed ${r.seed}">#${r.seed}</span>` : ''}${r.clinch ? html`<span class="clinch" title="${CLINCH[r.clinch] || ''}">${r.clinch}</span>` : ''}`)}</td>
          <td class="n num"><b>${r.w}</b></td><td class="n num">${r.l}</td><td class="n num">${r.t}</td><td class="n num col-pf">${r.pf}</td><td class="n num col-pa">${r.pa}</td><td class="n num col-strk">${r.strk || '–'}</td>`))}
        </tbody></table></section>`;
  }
  function divTab(L, u) {
    const cards = [];
    for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) cards.push(divCard(L, u, c, d));
    return html`<div class="fill">${K().pg('std', cards, { grid: true, cls: 'nc-side nc-cards nc-divs' })}</div>`;
  }

  function pictureTab(L, u) {
    const confs = [0, 1].map((c) => {
      const list = conference(L, c).slice().sort((a, b) => ((a.seed || 99) - (b.seed || 99)) || (b.pct - a.pct));
      const ins = list.slice(0, PT.C.PLAYOFF_PER_CONF), hunt = list.slice(PT.C.PLAYOFF_PER_CONF, PT.C.PLAYOFF_PER_CONF + 4);
      const tile = (r, i, inside) => {
        const t = L.teams[r.tid];
        return html`<button type="button" class="nc-tile ${r.tid === u ? 'me' : ''} ${inside ? '' : 'out'}" data-action="team-view" data-tid="${r.tid}" data-testid="pic-row-${r.tid}" title="${K().teamFull(t)}">
          <span class="seed-big ${inside ? '' : 'out'}">${inside ? i + 1 : '–'}</span>${K().badge(t, 's')}<span class="nc-tile-m"><b class="nc-n"><span class="nc-full">${t.name}</span><span class="nc-ab">${t.abbr}</span></b><span class="num nc-tile-r">${D().rec(r.w, r.l, r.t)}${i === 0 && inside ? html` <span class="chip chip-gold nc-bye">Bye</span>` : ''}</span></span></button>`;
      };
      return html`<section class="card nc-pic"><div class="nc-pic-h">${K().ic(CONF_EMO[c])}<b>${confName(c)}</b></div>
        <div class="nc-tiles">${ins.map((r, i) => tile(r, i, true))}</div>
        <div class="nc-line"><span>${K().ic('scissors')} Playoff line</span></div>
        <div class="nc-tiles">${hunt.map((r) => tile(r, 0, false))}</div></section>`;
    });
    return html`<p class="std-key nc-key small">Seeds 1–4 win a division · 5–7 wild cards · seed 1 gets a bye</p>
      <div class="fill">${K().pg('pic', confs, { grid: true, cls: 'nc-side nc-cards nc-pics' })}</div>`;
  }

  /** design 14.12: team OVR × 0.6 + last-6-games win% × 40 */
  function powerList(L) {
    const fin = L.sched.filter((g) => g.st === 'F').sort((a, b) => (b.po - a.po) || (b.wk - a.wk));
    return L.teams.map((t) => {
      const last = fin.filter((g) => g.h === t.id || g.a === t.id).slice(0, 6);
      const w = last.reduce((s, g) => { const us = g.h === t.id ? g.hs : g.as, th = g.h === t.id ? g.as : g.hs; return s + (us > th ? 1 : us === th ? 0.5 : 0); }, 0);
      const pct = last.length ? w / last.length : 0.5;
      const ovr = K().teamOvr(t.id);
      return { tid: t.id, ovr: ovr, pct: pct, n: last.length, score: ovr * 0.6 + pct * 40 };
    }).sort((a, b) => (b.score - a.score) || (a.tid - b.tid));
  }
  /** FEATURES: weekly Power Rankings (League.Standings.power: record, point diff, team OVR, recent form; arrows vs last week) */
  function powerTab(L, u) {
    let list;
    try { list = PT.League.Standings.power(L); } catch (e) { list = powerList(L).map((x, i) => ({ tid: x.tid, rank: i + 1, ovr: x.ovr, w: 0, l: 0, t: 0, diff: 0, form: '', move: 0, prev: null })); }
    const mv = (x) => (x.prev == null ? html`<span class="pw-mv">–</span>`
      : x.move > 0 ? html`<span class="pw-mv up" title="Up ${x.move} from #${x.prev}">▲${x.move}</span>`
        : x.move < 0 ? html`<span class="pw-mv down" title="Down ${-x.move} from #${x.prev}">▼${-x.move}</span>` : html`<span class="pw-mv same" title="Same as last week">=</span>`);
    const form = (f) => (f ? html`<span class="pw-form">${f.split('').map((c) => html`<i class="pw-f pw-${c.toLowerCase()}" title="${c === 'W' ? 'Win' : c === 'L' ? 'Loss' : 'Tie'}">${c}</i>`)}</span>` : html`<span class="muted">–</span>`);
    const wk = L.pr && L.pr.s === L.season && L.pr.wk ? 'after week ' + Math.min(L.pr.wk, PT.C.REG_WEEKS) : 'before the season';
    const rows = list.map((x) => html`<button type="button" class="nc-pw ${x.tid === u ? 'me' : ''}" data-action="team-view" data-tid="${x.tid}" data-testid="pw-row-${x.tid}">
      <span class="rank ${x.rank <= 3 ? 'top' : ''}">${x.rank}</span>${mv(x)}${teamCell(L, x.tid)}<span class="num nc-pw-rec">${D().rec(x.w, x.l, x.t)}</span>
      <span class="num nc-pw-d ${x.diff > 0 ? 'pw-pos' : x.diff < 0 ? 'pw-neg' : ''}" title="Point difference">${x.diff > 0 ? '+' : ''}${x.diff}</span><span class="nc-pw-f">${form(x.form)}</span><span class="nc-pw-s">${K().stars(x.ovr, { team: true })}</span></button>`);
    void wk;
    const headRow = html`<div class="nc-pw nc-pw-h" aria-hidden="true"><span class="rank">#</span><span class="pw-mv">Move</span><span class="tcell">Team</span><span class="num nc-pw-rec">W-L</span><span class="num nc-pw-d">+/-</span><span class="nc-pw-f">Form</span><span class="nc-pw-s">Stars</span></div>`;
    return html`${headRow}
      <div class="fill">${K().pg('pw', rows, { grid: true, cls: 'nc-side nc-pws' })}</div>`;
  }

  /** 32 teams, one division per row (shared with the 'teams' screen in stats.js) */
  function teamsGrid(L, u) {
    const std = rows(L);
    const strips = [];
    for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) {
      const ts = L.teams.filter((t) => t.conf === c && t.div === d);
      strips.push(html`<div class="nc-tmrow"><span class="nc-tm-div" title="${confName(c)}">${K().ic(CONF_EMO[c])}<b>${divName(c, d)}</b></span>
        <div class="nc-tm4">${ts.map((t) => { const r = std.find((s) => s.tid === t.id) || { w: 0, l: 0, t: 0 }; return html`<button type="button" class="tm-row nc-tm ${t.id === u ? 'me' : ''}" data-action="team-view" data-tid="${t.id}" data-testid="team-tile-${t.id}" title="${K().teamFull(t)}">${K().badge(t, 'm')}<span class="grow tm-main"><b class="ellip">${t.name}</b><span class="small muted ellip nc-tm-city">${t.city}</span><span class="nc-tm-st">${K().stars(K().teamOvr(t.id), { team: true })}</span></span><span class="num tm-rec">${D().rec(r.w, r.l, r.t)}</span></button>`; })}</div></div>`);
    }
    return html`<div class="fill">${K().pg('teams', strips, { cls: 'nc-side nc-tms' })}</div>`;
  }
  UI.leagueParts = UI.leagueParts || {};
  UI.leagueParts.teamsGrid = teamsGrid;
  UI.leagueParts.powerList = powerList;

  const TABS = [
    { id: 'div', label: 'Divisions', testid: 'tab-std-div' },
    { id: 'picture', label: 'Playoff Picture', testid: 'tab-std-picture' },
    { id: 'power', label: 'Power Rank', testid: 'tab-std-power' },
    { id: 'teams', label: 'Teams', testid: 'tab-std-teams' }
  ];

  function mount(el, params) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const u = L.userTid;
    const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'div';
    const content = tab === 'picture' ? pictureTab(L, u) : tab === 'power' ? powerTab(L, u) : tab === 'teams' ? teamsGrid(L, u) : divTab(L, u);
    const head = html`<div class="row between wrap std-top">${K().tabs(TABS, tab, 'tab')}</div>`;   // HUNT #32: no Bracket button (Playoffs sub-tab)
    D().set(el, K().layout(html`${head}${content}`, null, 'fit standings nc'));
  }

  UI.screens.standings = {
    title: 'League',
    nav: 'standings',
    mount: mount,
    actions: {
      tab: (el, ev, params) => { params.tab = el.getAttribute('data-id'); UI.refresh(); },
      bracket: () => UI.go('playoffs')
    }
  };
})(globalThis.PT = globalThis.PT || {});
