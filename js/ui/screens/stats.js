/* Pixel Touchdown: js/ui/screens/stats.js
 * Owner: WP5. Responsibility: league leaders, team stats.
 * Screens: 'stats' (Leaders, params {tab:'leaders'|'team'|'news'}), 'news' (full feed), 'teams' (all 32 teams).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const CATS = [
    { k: 'py', label: 'Pass Yards', icon: 'football' }, { k: 'ptd', label: 'Pass TDs', icon: 'target' },
    { k: 'ry', label: 'Run Yards', icon: 'boot' }, { k: 'rcy', label: 'Catch Yards', icon: 'glove' },
    { k: 'rc', label: 'Catches', icon: 'hand' }, { k: 'tk', label: 'Tackles', icon: 'bolt' },
    { k: 'dsk', label: 'Sacks', icon: 'wind' }, { k: 'int', label: 'Picks', icon: 'plane' },
    { k: 'fgm', label: 'Field Goals', icon: 'target' }
  ];
  const NEWS_IC = { game: 'football', inj: 'cross', sign: 'pencil', trade: 'swap', rec: 'chart', award: 'medal', event: 'megaphone' };

  function leaders(L, k, n) {
    try { return PT.League.Q.leaders(L, k, n); } catch (e) { return []; }
  }
  function leaderCard(L, c, u) {
    // HUNT #9: 3 leaders per card on short screens (5 on tall ones), never clipped rows
    const n = (globalThis.innerHeight || 800) < 600 ? 3 : 5;
    const list = leaders(L, c.k, n);
    const rows = list.map((x, i) => {
      const p = PT.League.Q.player(L, x.pid);
      if (!p) return '';
      const t = p.tid >= 0 ? L.teams[p.tid] : null;
      return html`<button type="button" class="ldr-row ${t && t.id === u ? 'me' : ''} ${i === 0 ? 'first' : ''}" data-action="player" data-pid="${p.id}" data-testid="leader-${c.k}-${p.id}">
        <span class="ldr-rank num">${i + 1}</span>${K().portrait(p, 32, t ? t.col.pri : undefined)}
        <span class="grow ldr-n"><b class="ldr-nm">${K().short(p)}</b><span class="small muted ellip">${p.pos} · ${t ? t.abbr : 'Free'}</span></span>
        <b class="ldr-v num">${D().int(x.v)}</b></button>`;
    });
    return K().card(html`${K().h2(c.label, null, c.icon)}${list.length ? html`<div class="ldr-list">${rows}</div>` : html`<p class="muted small">No stats yet.</p>`}`, 'ldr-card');
  }

  // ROUND6: div rows in a paged 2-3 column grid (no table scroll); the header repeats over each column
  function teamTab(L, u) {
    let std = [];
    try { std = PT.League.Standings.get(L); } catch (e) { std = []; }
    const list = std.map((r) => { const gp = r.w + r.l + r.t; return Object.assign({ gp: gp, ppg: gp ? r.pf / gp : 0, apg: gp ? r.pa / gp : 0 }, r); })
      .sort((a, b) => (b.ppg - a.ppg) || (a.tid - b.tid));
    const head = html`<div class="ts-h"><span>Team</span><span class="n" title="Points per game">Pts/G</span><span class="n ts-x">Scored</span><span class="n ts-x">Allowed</span><span class="n">+/-</span></div>`;
    const rows = list.map((r, i) => html`<button type="button" class="ts-r ${r.tid === u ? 'me' : ''}" data-action="team-view" data-tid="${r.tid}" data-testid="ts-row-${r.tid}">
      <span class="tcell"><span class="ts-rk num">${i + 1}</span>${K().badge(L.teams[r.tid], 's')}<span class="ellip">${L.teams[r.tid].name}</span></span>
      <b class="n num">${r.ppg.toFixed(1)}</b><span class="n num ts-x">${r.pf}</span><span class="n num ts-x">${r.pa}</span><span class="n num ${r.pf - r.pa > 0 ? 'good' : r.pf - r.pa < 0 ? 'bad' : ''}">${D().signed(r.pf - r.pa)}</span></button>`);
    return html`<div class="ts-heads">${head}${head}${head}</div>${K().pg('ts', rows, { grid: true, cls: 'ts-pg' })}`;
  }

  /** ROUND6: the newest items as one flat paged list (week tag on each row) */
  const NEWS_MAX = 40;
  function newsFeed(L, top) {
    const all = (L.news || []).slice(0, NEWS_MAX);
    if (!all.length) return K().card(K().empty('news', 'No news yet.'));
    const wkName = (wk) => (wk > PT.C.REG_WEEKS ? PT.C.PLAYOFF_NAMES[wk - PT.C.REG_WEEKS] || 'Playoffs' : wk ? 'Wk ' + wk : 'Preseason');
    const rows = all.map((n) => html`<div class="nw-row ${n.tid === L.userTid ? 'me' : ''}"><span class="news-ic">${K().ic(NEWS_IC[n.k] || 'news')}</span>
      <span class="nw-t">${n.txt}</span><span class="nw-wk small">${wkName(n.wk)}</span>${n.tid != null && L.teams[n.tid] ? K().badge(L.teams[n.tid], 's') : ''}</div>`);
    return K().pg('news', rows, { grid: true, cls: 'nw-pg' });
  }

  // HUNT #32: News is its own League sub-tab, so the inner tabs are just Players / Teams
  const TABS = [
    { id: 'leaders', label: 'Players', testid: 'tab-stats-leaders' },
    { id: 'team', label: 'Teams', testid: 'tab-stats-team' }
  ];

  function mount(el, params) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const u = L.userTid;
    if (params.tab === 'news') { UI.replace('news'); return; }
    const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'leaders';
    let content;
    if (tab === 'team') content = teamTab(L, u);
    else {
      // HUNT #49: before week 1 one empty state instead of 9 empty cards
      const any = CATS.some((c) => leaders(L, c.k, 1).length);
      content = any ? K().pg('ldr', CATS.map((c) => leaderCard(L, c, u)), { grid: true, cls: 'ldr-pg' }) : K().card(K().empty('chart', 'Leaders show up after week 1.'), 'fill');
    }
    D().set(el, K().layout(html`${K().tabs(TABS, tab, 'tab')}${content}`, null, 'fit stats stats-' + tab));
  }

  UI.screens.stats = {
    title: 'Leaders',
    nav: 'stats',
    mount: mount,
    actions: { tab: (el, ev, params) => { params.tab = el.getAttribute('data-id'); UI.refresh(); } }
  };

  UI.screens.news = {
    title: 'News',
    nav: 'stats',
    mount: (el) => {
      const L = PT.App.L;
      if (!L) { UI.replace('title'); return; }
      D().set(el, K().layout(newsFeed(L, false), null, 'fit news-scr'));
    }
  };

  UI.screens.teams = {
    title: 'Teams',
    nav: 'standings',
    mount: (el) => {
      const L = PT.App.L;
      if (!L) { UI.replace('title'); return; }
      // ROUND6: one compact card per division, paged (was the scrolling 8-card grid)
      let std = [];
      try { std = PT.League.Standings.get(L); } catch (e) { std = []; }
      const DIVS = (PT.Data.Teams && PT.Data.Teams.DIVS) || [];
      const cards = [];
      for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) {
        const ts = L.teams.filter((t) => t.conf === c && t.div === d);
        cards.push(K().card(html`${K().h2((DIVS[c] && DIVS[c][d]) || 'Division ' + (d + 1), null, c ? 'snow' : 'sun')}
          <div class="tm2-list">${ts.map((t) => { const r = std.find((x) => x.tid === t.id) || { w: 0, l: 0, t: 0 }; return html`<button type="button" class="tm2-row ${t.id === L.userTid ? 'me' : ''}" data-action="team-view" data-tid="${t.id}" data-testid="team-tile-${t.id}">${K().badge(t, 's')}<b class="grow ellip">${t.name}</b>${K().stars(K().teamOvr(t.id), { team: true })}<span class="num tm2-rec">${D().rec(r.w, r.l, r.t)}</span></button>`; })}</div>`, 'tm2-card'));
      }
      D().set(el, K().layout(K().pg('teams', cards, { grid: true, cls: 'tm2-pg' }), null, 'fit teams-scr'));
    }
  };
})(globalThis.PT = globalThis.PT || {});
