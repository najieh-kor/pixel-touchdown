/* Pixel Touchdown: js/ui/screens/hub.js
 * Owner: WP5. Responsibility: franchise home (HQ): next game, record, news, events, Next button.
 * Also: Welcome card (first visit after New Game), Season Twist slot-machine reveal (Preseason 1),
 * Boss Goal card (Preseason 2), Training Camp card (Preseason 3), playoff/offseason phase cards.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function rec(L, tid) {
    try { const r = PT.League.Standings.get(L).find((x) => x.tid === tid); return r || { w: 0, l: 0, t: 0 }; }
    catch (e) { return { w: 0, l: 0, t: 0 }; }
  }
  function twistOf(L) {
    const T = PT.League.Twists;
    let tw = null;
    try { if (T && T.current) tw = T.current(L); } catch (e) { tw = null; }
    if (!tw) {
      const list = (PT.Data.Twists && PT.Data.Twists.list) || [];
      tw = list.find((x) => x.id === (L.twist && L.twist.id)) || { id: 'normal', name: 'Normal Season', desc: 'Nothing special this year.' };
    }
    return tw;
  }
  function weatherFor(L, g) {
    try { const c = PT.League.Games.config(L, g.gid); return c.weather; } catch (e) { return null; }
  }
  function userGameThisWeek(L) {
    const u = L.userTid;
    if (L.phase === 'REGULAR') return L.sched.find((g) => g.po === 0 && g.wk === L.week && (g.h === u || g.a === u)) || null;
    if (L.phase === 'PLAYOFFS') return L.sched.find((g) => g.po === L.po.rd && (g.h === u || g.a === u)) || null;
    return null;
  }
  function aliveInPlayoffs(L) {
    const u = L.userTid;
    if (!L.po || !L.po.seeds) return false;
    if (!L.po.seeds.some((s) => s.includes(u))) return false;
    return !L.sched.some((g) => g.po && g.st === 'F' && (g.h === u || g.a === u) && ((g.h === u) !== (g.hs > g.as)));
  }

  // ---------------- cards ----------------
  /** FEATURES: offer the Practice Field once, on the Welcome card of a new franchise (until practice is done) */
  function practiceOffer() {
    let p = {};
    try { p = PT.Save.prefs() || {}; } catch (e) { p = {}; }
    if (p.practiceDone) return '';
    return K().btn({ label: 'Go to Practice', action: 'practice', kind: 'sec', size: 'm', testid: 'btn-welcome-practice', cls: 'btn-wide welcome-practice' });
  }

  function welcomeCard(L, t) {
    const tw = twistOf(L);
    const goal = L.boss && L.boss.goal;
    return K().card(html`
      <div class="welcome">
        <div class="boss-face" aria-hidden="true">${K().sp('bear', 64)}</div>
        <div class="grow">
          <h2 class="big">Welcome, ${L.coach && L.coach.n ? L.coach.n : 'Coach'}</h2>
          <p class="small">Boss of the <b>${t.name}</b>: win games, keep fans happy.</p>
          <p class="small">${K().ic('dice')} <b>${tw.name}</b>${goal ? html` · Goal: <b>${goal.txt}</b>` : ''}</p>
        </div>
      </div>
      <div class="welcome-btns">
        ${K().btn({ label: 'Got It', action: 'welcome-ok', kind: 'go', size: 'l', testid: 'btn-welcome-ok', cls: 'btn-wide' })}
        ${practiceOffer()}
      </div>`, 'card-cream welcome-card hq-gate');
  }

  /**
   * ROUND6 C: no Preseason steps. The rollover (and a new franchise) sets L.newSeasonCard; HQ shows it once as a small
   * dismissible "New Season" card: the Twist, the Boss goal and the money/camp summary from the franchise side.
   */
  function seasonCardOn(L) { const c = L.newSeasonCard; return !!(c && !c.seen); }
  function newSeasonCard(L) {
    const c = L.newSeasonCard || {};
    const tw = (c.twist && typeof c.twist === 'object' && c.twist.name) ? c.twist : twistOf(L);
    const goal = (c.goal && (c.goal.txt || c.goal)) || (L.boss && L.boss.goal && L.boss.goal.txt) || '';
    const money = [];
    if (c.tv) money.push('TV money +' + D().money(c.tv));
    if (c.bills) money.push('Bills -' + D().money(c.bills));
    const camp = (c.camp || []).map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const lines = (c.lines || []).filter((x) => typeof x === 'string');
    return K().card(html`<h2 class="hq-gate-t">${K().ic('calendar')} Season ${c.s || L.season}</h2>
      <div class="ns-rows">
        <div class="ns-row"><span class="ns-ic">${K().ic('dice')}</span><span class="grow"><b>${tw.name}</b>${tw.desc ? html`<span class="small muted ns-x"> ${tw.desc}</span>` : ''}</span></div>
        ${goal ? html`<div class="ns-row"><span class="ns-ic">${K().ic('briefcase')}</span><span class="grow"><b>Boss goal:</b> ${goal}</span></div>` : ''}
        ${money.length ? html`<div class="ns-row"><span class="ns-ic">${K().ic('cash')}</span><span class="grow small">${money.join(' · ')}</span></div>` : ''}
        ${camp.length ? html`<div class="ns-row ns-x"><span class="ns-ic">${K().ic('dumbbell')}</span><span class="grow small">Camp: ${camp.map((p) => K().short(p)).join(', ')}</span></div>` : ''}
        ${lines.map((x) => html`<div class="ns-row ns-x"><span class="ns-ic">${K().ic('news')}</span><span class="grow small">${x}</span></div>`)}
      </div>
      ${K().btn({ label: 'Got It', action: 'season-ok', kind: 'go', size: 'm', testid: 'btn-season-ok', cls: 'btn-wide' })}`, 'card-cream ns-card hq-gate');
  }

  /** HQ overworld: the team banner + resource pills float over the voxel stadium diorama */
  function stage(L, t) {
    const r = rec(L, t.id);
    const ovr = K().teamOvr(t.id);
    const st = PT.UI.Flow.status();
    const space = (() => { try { return PT.League.Cap.space(L, t.id); } catch (e) { return 0; } })();
    const phaseLabel = st ? st.label : '';
    return html`<div class="hq-stage">
      <section class="hq-banner hub-team" style="${K().teamVars(t)}">
        ${K().badge(t, 'l')}
        <div class="grow">
          <div class="hq-name ellip">${t.name}</div>
          <div class="hq-meta"><span class="chip chip-ink">${L.season} · ${phaseLabel}</span><b class="hq-rec">${D().rec(r.w, r.l, r.t)}</b>${K().stars(ovr, { team: true, noNum: true })}</div>
        </div>
      </section>
      <div class="hq-res hub-stats">
        ${K().coins(t.fin.coins)}${K().cash(space)}${K().hype(t.fin.hype)}${K().boss(L.boss ? L.boss.conf : 50)}${K().spirit(t.spirit == null ? 50 : t.spirit)}
      </div>
    </div>`;
  }

  function gameCard(L, g, title) {
    const u = L.userTid;
    const home = g.h === u;
    const opp = L.teams[home ? g.a : g.h];
    const r = rec(L, opp.id);
    let rival = L.teams[u].rival === opp.id, hot = false;
    try {
      const H = PT.League.History;
      if (H && H.isRivalGame) rival = !!H.isRivalGame(L, g.h, g.a);
      const hr = H && H.hotRival ? H.hotRival(L) : null;
      hot = !!hr && hr.tid === opp.id;
    } catch (e) { /* keep fixed rival */ }
    const wx = g.st !== 'F' ? weatherFor(L, g) : null;
    const me = L.teams[u], r0 = rec(L, u);
    const sideOf = (tm, rr) => html`<div class="nx-side" style="${K().teamVars(tm)}">${K().badge(tm, 'l')}
      <span class="nx-line"><b class="nx-ab">${tm.abbr}</b> <span class="num nx-rec">${D().rec(rr.w, rr.l, rr.t)}</span></span>
      ${K().stars(K().teamOvr(tm.id), { team: true, noNum: true })}</div>`;
    if (g.st === 'F') {
      const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      const res = us > them ? 'W' : us < them ? 'L' : 'T';
      return K().card(html`${K().h2(title || 'Last game')}
        <div class="nx">
          ${sideOf(me, r0)}
          <div class="nx-vs"><span class="res-chip res-${res}">${res}</span><span class="score-big num ${res === 'W' ? 'good' : res === 'L' ? 'bad' : ''}">${us}–${them}</span></div>
          ${sideOf(opp, r)}
        </div>
        ${K().btn({ label: 'Box Score', icon: 'clipboard', action: 'box', data: { gid: g.gid }, kind: 'sec', size: 'l', testid: 'btn-hub-box', cls: 'btn-wide' })}`, 'hub-game nx-card');
    }
    const lbl = g.po ? PT.C.PLAYOFF_NAMES[g.po] : 'Week ' + g.wk;
    return K().card(html`${K().h2(lbl, rival ? K().chip(hot ? html`${K().ic('flame')} Hot Rival` : 'Rival', 'rival') : '')}
      <div class="nx">
        ${sideOf(me, r0)}
        <div class="nx-vs"><span class="vs">${home ? 'VS' : '@'}</span>${wx ? K().wx(wx.k, wx.mph) : ''}</div>
        ${sideOf(opp, r)}
      </div>
      ${K().btn({ label: 'Game Day', icon: 'football', action: 'pregame', data: { gid: g.gid }, kind: 'pri', size: 'l', testid: 'btn-hub-play', cls: 'btn-wide nx-go' })}`, 'hub-game nx-card');
  }

  function twistCard(L) {
    const tw = twistOf(L);
    const key = 'twist-' + L.season;
    const seen = D().memo[key];
    D().memo[key] = true;
    const list = ((PT.Data.Twists && PT.Data.Twists.list) || [tw]).map((x) => x.name);
    const reel = seen || D().reduced() ? [tw.name] : list.concat(list).concat([tw.name]);
    return K().card(html`${K().h2('Season Twist')}
      <div class="slot ${seen ? 'done' : 'spin'}" aria-live="polite">
        <div class="slot-win"><div class="slot-reel" style="--n:${reel.length - 1}">${reel.map((n) => html`<div class="slot-i">${n}</div>`)}</div></div>
      </div>
      <p class="center twist-desc">${tw.desc || ''}</p>`, 'hub-twist');
  }

  function bossCard(L) {
    const b = L.boss || { conf: 60, goal: null };
    return K().card(html`${K().h2('Boss Goal')}
      <div class="boss-row">
        <div class="boss-face big-face" aria-hidden="true">${K().bossFace(b.conf)}</div>
        <div class="grow">
          <p class="big">${b.goal ? b.goal.txt : 'The Boss is thinking…'}</p>
          <div class="row small"><span>Boss is <b>${K().bossWord(b.conf)}</b></span></div>
          ${K().meter(b.conf, 100, b.conf >= 50 ? 'm-gold' : 'm-red', 'Boss')}
        </div>
      </div>
      ${b.conf < 35 ? html`<p class="hot-seat">${K().ic('flame')} Hot Seat! Win games to keep your job.</p>` : ''}`, 'hub-boss');
  }

  function campCard(L, t) {
    const n = PT.League.Q.roster(L, t.id).filter((p) => !p.ir).length;
    const max = PT.C.ROSTER.MAX_SEASON;
    let done = t.campS === L.season;
    try { const P = PT.League.Progression; if (P && P.campInfo) done = !!P.campInfo(L).done; } catch (e) { /* keep */ }
    return K().card(html`${K().h2('Training Camp', done ? K().chip(html`${K().ic('check')} Done`, 'green') : '')}
      <p class="small">Roster: <b class="${n > max ? 'bad' : 'good'}">${n}/${max}</b> ${n > max ? html` · cut ${n - max} before Week 1` : ''}</p>
      <div class="btn-row">
        ${K().btn({ label: 'Camp', icon: 'dumbbell', action: 'go', data: { to: 'camp' }, kind: 'pri', size: 'm', testid: 'btn-hub-camp' })}
        ${K().btn({ label: 'Coaches', icon: 'cap', action: 'go', data: { to: 'shop' }, kind: 'sec', size: 'm' })}
      </div>`, 'hub-camp');
  }

  function phaseCard(L, t) {
    const g = userGameThisWeek(L);
    switch (L.phase) {
      case 'PRESEASON':
        if (L.sub === 0) return twistCard(L);
        if (L.sub === 1) return bossCard(L);
        return campCard(L, t);
      case 'REGULAR':
        if (!g) return K().card(html`${K().h2('Rest Week')}<div class="rest"><span class="rest-emo">${K().ic('zzz')}</span><p>Bye week. Hurt players heal.</p></div>`, 'hub-rest');
        return gameCard(L, g, 'This week');
      case 'PLAYOFFS':
        if (g) return gameCard(L, g, PT.C.PLAYOFF_NAMES[g.po]);
        return K().card(html`${K().h2(PT.C.PLAYOFF_NAMES[L.po.rd] || 'Playoffs')}
          <p>${aliveInPlayoffs(L) ? 'First-round bye.' : 'Your season is over.'}</p>
          ${K().btn({ label: 'Bracket', icon: 'bracket', action: 'go', data: { to: 'playoffs' }, kind: 'sec', testid: 'btn-hub-bracket' })}`, 'hub-po');
      default: {
        const to = UI.Flow.screenFor();
        const names = { awards: 'Awards Night', growth: 'Growth Day', goodbyes: 'Goodbyes', resign: 'Keep Players', draft: 'Draft Day', market: 'Market' };
        return K().card(html`${K().h2(names[to] || 'Offseason')}
          ${K().btn({ label: 'Open', icon: 'play', action: 'go', data: { to: to }, kind: 'pri', size: 'l', cls: 'btn-wide', testid: 'btn-hub-phase' })}`, 'hub-off');
      }
    }
  }

  function eventsBanner(L) {
    const n = (L.ev && L.ev.pending && L.ev.pending.length) || 0;
    if (!n) return '';
    return html`<button type="button" class="ev-banner" data-action="go" data-to="events" data-testid="btn-hub-events"><span class="ev-emo">${K().ic('megaphone')}</span><span class="grow"><b>Team News</b><span class="small"> ${n === 1 ? '1 decision waiting' : n + ' decisions waiting'}</span></span><span class="ev-arrow">${K().ic('play')}</span></button>`;
  }

  function swapsBanner(L) {
    if (L.phase !== 'REGULAR' || L.week !== 10) return '';
    return html`<button type="button" class="ev-banner swap-banner" data-action="go" data-to="swaps" data-testid="btn-hub-swaps"><span class="ev-emo">${K().ic('swap')}</span><span class="grow"><b>Swap Deadline</b><span class="small"> Swaps close after this week.</span></span><span class="ev-arrow">${K().ic('play')}</span></button>`;
  }

  function tiles(L, t) {
    const coinsUp = PT.C.FACILITIES.some((f) => t.fac[f] < 5 && PT.C.FACILITY_COST[f][t.fac[f]] <= t.fin.coins);
    const hurt = PT.League.Q.roster(L, t.id).some((p) => p.inj && !p.ir);
    const market = ['RESIGN', 'DRAFT', 'FREE_AGENCY'].includes(L.phase) || (L.scout && L.scout.pts > 0 && L.phase === 'REGULAR');
    const T = [
      { to: 'roster', icon: 'players', label: 'Players', c: 'red', dot: hurt },
      { to: 'depth', icon: 'clipboard', label: 'Lineup', c: 'green' },
      { to: 'market', icon: 'contract', label: 'Market', c: 'purple', dot: market },
      { to: 'schedule', icon: 'calendar', label: 'Calendar', c: 'sky' },
      { to: 'standings', icon: 'podium', label: 'Standings', c: 'blue' },
      { to: 'shop', icon: 'cart', label: 'Shop', c: 'gold', dot: coinsUp }
    ];
    return html`<div class="tiles">${T.map((x) => html`<button type="button" class="tile tile-${x.c}" data-action="go" data-to="${x.to}" data-testid="tile-${x.to}"><span class="tile-ic">${K().ic(x.icon)}</span><span class="tile-t">${x.label}</span>${x.dot ? D().raw('<span class="dot"></span>') : ''}</button>`)}</div>`;
  }

  function news(L) {
    const list = (PT.League.News && PT.League.News.list ? PT.League.News.list(L, 5) : (L.news || []).slice(0, 5)) || [];
    const ic = { game: 'football', inj: 'cross', sign: 'pencil', trade: 'swap', rec: 'chart', award: 'medal', event: 'megaphone' };
    return K().card(html`${K().h2('News', K().btn({ label: 'More', action: 'go', data: { to: 'news' }, kind: 'ghost', size: 's', testid: 'btn-hub-news' }))}
      ${K().pg('hq-news', list.map((n) => html`<div class="hq-news-i"><span class="news-ic">${K().ic(ic[n.k] || 'news')}</span><span>${n.txt}</span></div>`), { cls: 'news', empty: html`<p class="muted">Quiet week in the league.</p>` })}`, 'hub-news fill');
  }

  // ---------------- screen ----------------
  function mount(el, params) {
    if (PT.App.L && PT.App.L.tmp && PT.App.restore) PT.App.restore();      // left a Quick Game / Practice by a side door
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    if (L.fd && !L.fd.done) { UI.replace('fantasy'); return; }              // Fantasy Draft still running
    const t = L.teams[L.userTid];
    const showWelcome = D().memo.welcome === L.id || params.welcome;
    const simEnd = L.phase === 'REGULAR' ? K().btn({ label: 'Sim to End', icon: 'ff', action: 'sim-end', kind: 'ghost', size: 'l', testid: 'btn-sim-to-end', title: 'Sim the rest of the season', cls: 'btn-simend' }) : '';
    const gate = showWelcome ? welcomeCard(L, t) : seasonCardOn(L) ? newSeasonCard(L) : '';
    const ev = eventsBanner(L), sw = swapsBanner(L);
    // ROUND6 "0 scrolling": next game on the left, team banner + menu tiles (+ news on big screens) on the right
    const body = html`<div class="hq hqx ${gate ? 'has-gate' : ''} ${ev || sw ? 'has-alerts' : ''}">
      <div class="hqx-main hub-col-main">
        ${ev || sw ? html`<div class="hq-alerts">${ev}${sw}</div>` : ''}
        <div class="hub-phase">${phaseCard(L, t)}</div>
      </div>
      <div class="hqx-mid" aria-hidden="true"></div>
      <div class="hqx-side hq-col-side">${stage(L, t)}${gate}${tiles(L, t)}${news(L)}</div>
    </div>`;
    D().set(el, K().layout(body, html`${K().nextBtn()}${simEnd}`, 'fit nsa hub'));
  }

  function dismissSeason() {
    const L = PT.App.L;
    if (!L || !L.newSeasonCard) return;
    if (PT.League.dismissNewSeasonCard) PT.League.dismissNewSeasonCard(L);
    else { L.newSeasonCard.seen = true; if (PT.Events) PT.Events.emit('league:changed', { what: 'newSeasonCard' }); }
  }

  UI.screens.hub = {
    title: 'HQ',
    nav: 'hub',
    mount: mount,
    actions: {
      go: (el) => {
        const to = el.getAttribute('data-to');
        if (to === 'events' || to === 'camp' || to === 'news' || to === 'playoffs' || to === 'swaps') UI.go(to);
        else UI.reset(to);
      },
      pregame: (el) => UI.go('pregame', { gid: +el.getAttribute('data-gid') }),
      box: (el) => {
        const L = PT.App.L, b = PT.League.Q.box(L, +el.getAttribute('data-gid'));
        UI.Modal.open({ title: 'Box Score', body: K().boxScore(b), cls: 'm-wide', buttons: [{ label: 'Close', value: true, kind: 'go' }] });
      },
      'welcome-ok': () => { D().memo.welcome = null; dismissSeason(); UI.refresh(); },
      'season-ok': () => { dismissSeason(); UI.refresh(); },
      practice: () => { D().memo.welcome = null; UI.go('practice', { from: 'hub' }); },
      'sim-end': () => {
        UI.Modal.confirm('Sim the rest of the season?', { body: 'Your games get simmed too.', icon: 'ff' })
          .then((ok) => { if (ok) UI.Flow.simUntil('playoffs', 'Simming the season…'); });
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
