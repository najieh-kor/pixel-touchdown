/* Pixel Touchdown: js/ui/screens/schedule.js
 * Owner: WP5. Responsibility: team schedule, results, box score open.
 * Screens: 'schedule' (Calendar: your 18 weeks + playoff games) and 'results' (Week Results, params {wk}).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function stdRow(L, tid) {
    try { return PT.League.Standings.get(L).find((r) => r.tid === tid) || { w: 0, l: 0, t: 0 }; }
    catch (e) { return { w: 0, l: 0, t: 0 }; }
  }
  function resultOf(g, tid) {
    if (g.st !== 'F') return null;
    const us = g.h === tid ? g.hs : g.as, them = g.h === tid ? g.as : g.hs;
    return { us: us, them: them, r: us > them ? 'W' : us < them ? 'L' : 'T' };
  }
  function openBox(gid) {
    const L = PT.App.L;
    const b = PT.League.Q.box(L, gid);
    const g = L.sched.find((x) => x.gid === gid);
    if (!b && !g) return;
    // HUNT #10: one tabbed box-score overlay everywhere (Summary / Team Stats / Scoring)
    if (b && UI.postgameOverlay) { UI.postgameOverlay('box', b); return; }
    UI.Modal.open({
      title: 'Box Score', cls: 'm-wide',
      body: b ? K().boxScore(b) : html`<p class="center">${L.teams[g.a].name} ${g.as} – ${g.hs} ${L.teams[g.h].name}</p><p class="muted center small">Box score not available.</p>`,
      buttons: [{ label: 'Close', value: true, kind: 'go' }]
    });
  }
  UI.openBoxScore = UI.openBoxScore || openBox;

  // ---------------- Calendar ----------------
  function gameRow(L, g, u, thisWeek) {
    const home = g.h === u;
    const opp = L.teams[home ? g.a : g.h];
    const rival = L.teams[u].rival === opp.id;
    const res = resultOf(g, u);
    const wk = g.po ? PT.C.PLAYOFF_NAMES[g.po] : 'Week ' + g.wk;
    const right = res
      ? html`<span class="res-chip res-${res.r}">${res.r}</span><b class="num sch-score">${res.us}–${res.them}</b>`
      : thisWeek ? html`<span class="chip chip-go">Up Next</span>` : html`<span class="muted small">${home ? 'Home' : 'Away'}</span>`;
    return html`<button type="button" class="sch-row ${thisWeek ? 'now' : ''} ${g.po ? 'po' : ''}" data-action="game" data-gid="${g.gid}" data-testid="game-row-${g.gid}">
      <span class="sch-wk">${wk}</span>
      ${K().badge(opp, 's')}
      <span class="sch-opp grow"><span class="ellip"><span class="muted">${home ? 'vs' : '@'}</span> <b>${opp.name}</b></span>${rival ? K().chip('Rival', 'rival') : ''}</span>
      <span class="sch-res">${right}</span>
    </button>`;
  }

  let schedSeen = '';                       // ROUND6: jump to the page with this week's game once per week
  function mountSchedule(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const u = L.userTid;
    const games = PT.League.Q.schedule(L, u);
    const rows = [];
    let nowId = '';
    for (let wk = 1; wk <= PT.C.REG_WEEKS; wk++) {
      const g = games.find((x) => x.po === 0 && x.wk === wk);
      const now = L.phase === 'REGULAR' && L.week === wk;
      if (g) { rows.push(gameRow(L, g, u, now && g.st !== 'F')); if (now) nowId = 'game-row-' + g.gid; }
      else {
        rows.push(html`<div class="sch-row rest ${now ? 'now' : ''}" data-testid="sch-rest-${wk}"><span class="sch-wk">Week ${wk}</span><span class="sch-rest-emo">${K().ic('zzz')}</span><span class="grow"><b>Rest Week</b></span></div>`);
        if (now) nowId = 'sch-rest-' + wk;
      }
    }
    // ROUND6: playoff games join the same paged list (their week label names the round)
    games.filter((x) => x.po > 0).sort((a, b) => a.po - b.po).forEach((g) => {
      const now = L.phase === 'PLAYOFFS' && g.po === L.po.rd && g.st !== 'F';
      rows.push(gameRow(L, g, u, now));
      if (now) nowId = 'game-row-' + g.gid;
    });
    const r = stdRow(L, u);
    const lastWk = L.phase === 'REGULAR' ? Math.max(1, L.week - 1) : PT.C.REG_WEEKS;
    const body = html`
      <div class="sch-head">
        ${K().badge(L.teams[u], 's')}<div class="sch-tn"><b>${L.teams[u].name}</b><span class="muted small sch-season">Season ${L.season}</span></div>
        <div class="sch-rec num">${D().rec(r.w, r.l, r.t)}</div>
        <div class="sch-btns">${K().btn({ label: 'Week Results', icon: 'news', action: 'results', data: { wk: lastWk }, kind: 'sec', size: 's', testid: 'btn-week-results' })}</div>
      </div>
      ${K().pg('sch', rows, { grid: true, cls: 'sch-pg' })}`;
    D().set(el, K().layout(body, null, 'fit sched'));
    const seen = L.season + ':' + L.phase + ':' + L.week + ':' + nowId;
    if (nowId && seen !== schedSeen && UI.fit && UI.pgReveal) {
      schedSeen = seen;
      try { UI.fit(el); UI.pgReveal(nowId); } catch (e) { /* first page */ }
    }
  }

  UI.screens.schedule = {
    title: 'Calendar',
    nav: 'schedule',
    mount: mountSchedule,
    actions: {
      game: (el) => {
        const L = PT.App.L, gid = +el.getAttribute('data-gid');
        const g = L.sched.find((x) => x.gid === gid);
        if (!g) return;
        if (g.st === 'F') { openBox(gid); return; }
        let st = null;
        try { st = PT.League.Calendar.status(L); } catch (e) { st = null; }
        const b = st && st.blockers.find((x) => x.k === 'USER_GAME');
        if (b && b.gid === gid) { UI.go('pregame', { gid: gid }); return; }
        UI.go('roster', { tid: g.h === L.userTid ? g.a : g.h });
      },
      results: (el) => UI.go('results', { wk: +el.getAttribute('data-wk') }),
      bracket: () => UI.go('playoffs')
    }
  };

  // ---------------- Week Results ----------------
  // ROUND6: one-line score chips (away score – score home), paged; my game + division on the left
  function scoreCard(L, g, u) {
    const done = g.st === 'F';
    const side = (tid, sc, win, right) => (right
      ? html`<span class="sc-side r ${win ? 'win' : ''} ${tid === u ? 'me' : ''}"><b class="num">${done ? sc : ''}</b><span class="sc-ab">${L.teams[tid].abbr}</span>${K().badge(L.teams[tid], 's')}</span>`
      : html`<span class="sc-side ${win ? 'win' : ''} ${tid === u ? 'me' : ''}">${K().badge(L.teams[tid], 's')}<span class="sc-ab">${L.teams[tid].abbr}</span><b class="num">${done ? sc : ''}</b></span>`);
    return html`<button type="button" class="sc-card" data-action="box" data-gid="${g.gid}" data-testid="score-${g.gid}" title="${L.teams[g.a].name} at ${L.teams[g.h].name}" ${done ? '' : D().raw('disabled')}>
      ${side(g.a, g.as, done && g.as > g.hs, false)}<span class="sc-at muted">${done ? '–' : '@'}</span>${side(g.h, g.hs, done && g.hs > g.as, true)}
    </button>`;
  }

  function mountResults(el, params) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const u = L.userTid, t = L.teams[u];
    const maxWk = Math.max(1, L.sched.reduce((m, g) => (g.st === 'F' && g.po === 0 ? Math.max(m, g.wk) : m), 1));
    const wk = Math.max(1, Math.min(PT.C.REG_WEEKS, params.wk || maxWk));
    const games = L.sched.filter((g) => g.po === 0 && g.wk === wk);
    const mine = games.find((g) => g.h === u || g.a === u);
    const others = games.filter((g) => g !== mine);
    let myCard;
    if (!mine) myCard = K().card(html`<div class="res-line">${K().badge(t, 'm')}<span class="rest-emo">${K().ic('zzz')}</span><p class="grow"><b>Rest Week</b> for the ${t.name}.</p></div>`, 'res-mine');
    else {
      const res = resultOf(mine, u);
      const opp = L.teams[mine.h === u ? mine.a : mine.h];
      myCard = K().card(html`<div class="res-line">${K().badge(t, 'm')}
        ${res ? html`<div class="score-big num"><span class="res-chip res-${res.r}">${res.r}</span>${res.us}–${res.them}</div>` : html`<div class="vs">${mine.h === u ? 'VS' : '@'}</div>`}
        ${K().badge(opp, 'm')}</div>
        <div class="res-line res-say" hidden><p class="grow small">${res ? (res.r === 'W' ? 'Beat the ' : res.r === 'L' ? 'Lost to the ' : 'Tied the ') : 'Next: the '}<b>${opp.name}</b></p>
        ${res ? K().btn({ label: 'Box', icon: 'clipboard', title: 'Box Score', action: 'box', data: { gid: mine.gid }, kind: 'sec', size: 's', testid: 'btn-res-box' }) : ''}</div>`, 'res-mine');
    }
    let div = [];
    try { div = PT.League.Standings.division(L, t.conf, t.div); } catch (e) { div = []; }
    const divNames = (PT.Data.Teams && PT.Data.Teams.DIVS) || [];
    const divName = (divNames[t.conf] && divNames[t.conf][t.div]) || 'Division';
    const nav = html`<div class="wk-nav">
        ${K().btn({ label: '', icon: 'back', title: 'Week before', action: 'wk', data: { wk: wk - 1 }, kind: 'sec', size: 's', testid: 'btn-wk-prev', disabled: wk <= 1 })}
        <h2 class="wk-t outline-text">Week ${wk}</h2>
        ${K().btn({ label: '', icon: 'play', title: 'Next week', action: 'wk', data: { wk: wk + 1 }, kind: 'sec', size: 's', testid: 'btn-wk-next', disabled: wk >= PT.C.REG_WEEKS })}
      </div>`;
    const body = html`
      <div class="cols2 res-cols">
        <div>
          ${nav}
          ${myCard}
          ${K().card(html`<div class="res-dn small">${divName} Division</div><div class="res-div">
            ${div.map((r) => html`<button type="button" class="res-dt ${r.tid === u ? 'me' : ''}" data-action="team-view" data-tid="${r.tid}" data-testid="res-team-${r.tid}" title="${L.teams[r.tid].name}">${K().badge(L.teams[r.tid], 's')}<span class="sc-ab">${L.teams[r.tid].abbr}</span><b class="num">${D().rec(r.w, r.l, r.t)}</b></button>`)}
            </div>`, 'res-divc')}
        </div>
        ${K().card(html`${K().h2('Around the League')}${K().pg('res', others.map((g) => scoreCard(L, g, u)), { grid: true, cls: 'res-pg', empty: html`<p class="muted">No other games.</p>` })}`, 'fill res-lg')}
      </div>`;
    D().set(el, K().layout(body, null, 'fit results'));
  }

  UI.screens.results = {
    title: (p) => 'Week ' + (p && p.wk ? p.wk : '') + ' Results',
    nav: 'schedule',
    mount: mountResults,
    actions: {
      wk: (el) => UI.replace('results', { wk: +el.getAttribute('data-wk') }),
      box: (el) => openBox(+el.getAttribute('data-gid'))
    }
  };
})(globalThis.PT = globalThis.PT || {});
