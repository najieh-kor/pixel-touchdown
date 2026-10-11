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
    return K().btn({ label: 'Practice', icon: 'football', action: 'practice', kind: 'sec', size: 'l', testid: 'btn-welcome-practice', cls: 'welcome-practice' });
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
          ${L.newSeasonCard && L.newSeasonCard.tv ? html`<p class="small ns-x">${K().icon('coin')} ${K().numify('TV money +' + D().int(L.newSeasonCard.tv) + ' Coins')}</p>` : ''}
        </div>
      </div>
      <div class="welcome-btns">
        ${practiceOffer()}
        ${K().btn({ label: 'Got It', icon: 'check', action: 'welcome-ok', kind: 'go', size: 'l', testid: 'btn-welcome-ok' })}
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
    // HUNT3 #2: tv / bills are Coin changes (not Team Cash)
    if (c.tv) money.push('TV money +' + D().int(c.tv) + ' Coins');
    if (c.bills) money.push('Bills −' + D().int(c.bills) + ' Coins');
    const camp = (c.camp || []).map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const lines = (c.lines || []).filter((x) => typeof x === 'string');
    return K().card(html`<h2 class="hq-gate-t">${K().ic('calendar')} Season ${c.s || L.season}</h2>
      <div class="ns-rows">
        <div class="ns-row"><span class="ns-ic">${K().ic('dice')}</span><span class="grow ns-tw"><b>${tw.name}</b>${tw.desc ? html`<span class="small ns-fx">${K().numify(tw.desc)}</span>` : ''}</span></div>
        ${goal ? html`<div class="ns-row"><span class="ns-ic">${K().ic('briefcase')}</span><span class="grow"><b>Boss goal:</b> ${K().numify(goal)}</span></div>` : ''}
        ${money.length ? html`<div class="ns-row"><span class="ns-ic">${K().icon('coin')}</span><span class="grow small">${K().numify(money.join(' · '))}</span></div>` : ''}
        ${camp.length ? html`<div class="ns-row ns-x"><span class="ns-ic">${K().ic('dumbbell')}</span><span class="grow small">Camp: ${camp.map((p) => K().short(p)).join(', ')}</span></div>` : ''}
        ${lines.map((x) => html`<div class="ns-row ns-x"><span class="ns-ic">${K().ic('news')}</span><span class="grow small">${K().numify(x)}</span></div>`)}
      </div>
      ${K().btn({ label: 'Got It', icon: 'check', action: 'season-ok', kind: 'sec', size: 'm', testid: 'btn-season-ok', cls: 'btn-wide' })}`, 'card-cream ns-card hq-gate');
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
      <span class="nx-meta"><span class="nx-line"><b class="nx-ab">${tm.abbr}</b> <span class="num nx-rec">${D().rec(rr.w, rr.l, rr.t)}</span></span>
      ${K().stars(K().teamOvr(tm.id), { team: true, noNum: true })}</span></div>`;
    if (g.st === 'F') {
      const us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      const res = us > them ? 'W' : us < them ? 'L' : 'T';
      return K().card(html`${K().h2(title || 'Last game')}
        <div class="nx">
          ${sideOf(me, r0)}
          <div class="nx-vs"><span class="res-chip res-${res}">${res}</span><span class="score-big num ${res === 'W' ? 'good' : res === 'L' ? 'bad' : ''}">${us}–${them}</span>
            ${K().btn({ label: 'Box', icon: 'clipboard', title: 'Box Score', action: 'box', data: { gid: g.gid }, kind: 'sec', size: 's', testid: 'btn-hub-box', cls: 'nx-box' })}</div>
          ${sideOf(opp, r)}
        </div>`, 'hub-game nx-card');
    }
    const lbl = g.po ? PT.C.PLAYOFF_NAMES[g.po] : 'Week ' + g.wk;
    return K().card(html`${K().h2(lbl, rival ? K().chip(hot ? html`${K().ic('flame')} Hot Rival` : 'Rival', 'rival') : '')}
      <div class="nx">
        ${sideOf(me, r0)}
        <div class="nx-vs"><span class="vs">${home ? 'VS' : '@'}</span>${wx ? K().wx(wx.k, wx.mph) : ''}</div>
        ${sideOf(opp, r)}
      </div>
      ${scoutRow(L, g)}`, 'hub-game nx-card');
  }

  /** HUNT2 #7: the Pregame scouting (style tags + 2 lines) now sits on the HQ game card */
  function scoutRow(L, g) {
    if (!UI.Game || !UI.Game.scout) return '';
    const sc = UI.Game.scout(L, g);
    // HUNT4 #8: the opponent's Star split (so you can set your Stars for the matchup)
    const opp = L.teams[g.h === L.userTid ? g.a : g.h];
    const ps = K().teamStars(opp).map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const off = ps.filter((p) => K().starSide(p.pos) === 'off'), def = ps.filter((p) => K().starSide(p.pos) === 'def');
    const heavy = off.length >= def.length ? off : def;
    const cnt = {}; heavy.forEach((p) => { cnt[p.pos] = (cnt[p.pos] || 0) + 1; });
    const posTxt = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 3).map((k) => (cnt[k] > 1 ? cnt[k] + ' ' : '') + k).join(', ');
    const starTxt = ps.length ? 'Their Stars: ' + off.length + ' O · ' + def.length + ' D' + (posTxt ? ' (' + posTxt + ')' : '') : '';
    const skew = ps.length && Math.abs(off.length - def.length) >= 4;
    return html`<div class="nx-scout" data-testid="hub-scout"><span class="nx-tags">${sc.tags}${starTxt && !skew ? html`<span class="chip chip-gold">${K().ic('star')} ${off.length} O · ${def.length} D</span>` : ''}</span><p>${sc.them}</p>${skew
      ? html`<p class="nx-stars" data-testid="hub-opp-stars">${K().ic('star')} ${starTxt}</p>` : html`<p class="${sc.usCls}">${K().ic('shield')} ${sc.us}</p>`}</div>`;
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
        return gameCard(L, g, g.st === 'F' ? 'Last game' : 'This week');
      case 'PLAYOFFS':
        if (g) return gameCard(L, g, PT.C.PLAYOFF_NAMES[g.po]);
        return K().card(html`${K().h2(PT.C.PLAYOFF_NAMES[L.po.rd] || 'Playoffs')}
          <p>${aliveInPlayoffs(L) ? 'First-round bye.' : 'Your season is over.'}</p>
          ${K().btn({ label: 'Bracket', icon: 'bracket', action: 'go', data: { to: 'playoffs' }, kind: 'sec', testid: 'btn-hub-bracket' })}`, 'hub-po');
      default: {
        const to = UI.Flow.screenFor();
        // HUNT2 #15: the card names the screen NEXT opens (same words as the bar), with one line on what happens there
        const names = { awards: 'Season Recap', growth: 'Season Recap', goodbyes: 'Season Recap', resign: 'Keep Players', draft: 'Draft Day', market: 'Market' };
        const what = { awards: 'Awards, player growth and goodbyes.', growth: 'Awards, player growth and goodbyes.', goodbyes: 'Awards, player growth and goodbyes.',
          resign: 'Offer new deals before they end.', draft: 'Pick new rookies.', market: 'Sign free agents.' };
        return K().card(html`${K().h2(names[to] || 'Offseason')}
          <div class="rest"><span class="rest-emo">${K().ic('calendar')}</span><p>${what[to] || 'Tap Next to go on.'}</p></div>`, 'hub-off');
      }
    }
  }

  /**
   * UI_RULES 4: ONE "To do" panel, at most 3 short items that need the user, each a button to the right screen.
   * Hidden when empty.
   */
  function todoItems(L, t) {
    const out = [];
    const nEv = (L.ev && L.ev.pending && L.ev.pending.length) || 0;
    if (nEv) out.push({ to: 'events', icon: 'megaphone', txt: nEv === 1 ? 'Team News: 1 decision' : 'Team News: ' + nEv + ' decisions', id: 'events' });
    let lineupErr = null;
    try { const v = PT.League.Roster.validate(L, t.id); if (v && !v.ok && v.errors && v.errors[0]) lineupErr = v.errors[0].msg; } catch (e) { lineupErr = null; }
    const hurtStarters = PT.League.Q.roster(L, t.id).filter((p) => p.inj && !p.ir && K().startSlot(t, p.id)).length;
    if (lineupErr) out.push({ to: 'depth', icon: 'warn', txt: 'Lineup: fix needed', id: 'lineup' });
    else if (hurtStarters) out.push({ to: 'depth', icon: 'cross', txt: 'Lineup: ' + hurtStarters + ' hurt starter' + (hurtStarters > 1 ? 's' : ''), id: 'lineup' });
    else if (!(L.settings && L.settings.autoLineup)) {
      const b = benchGain(L, t);
      if (b) out.push({ to: 'depth', icon: 'clipboard', txt: 'Lineup: ' + b + ' better player' + (b > 1 ? 's' : '') + ' on the bench', id: 'lineup' });
    }
    if (L.phase === 'REGULAR' && L.week === 10) out.push({ to: 'swaps', icon: 'swap', txt: 'Swap deadline this week', id: 'swaps' });
    // HUNT2 #5: Keep Players / Draft Day are the NEXT bar's job; the Market item only while the Market is open
    if (L.phase === 'FREE_AGENCY') out.push({ to: 'market', icon: 'contract', txt: 'Market is open', id: 'market' });
    const pts = L.coach && typeof L.coach === 'object' ? (L.coach.pts || L.coach.sp || 0) : 0;
    if (pts > 0) out.push({ to: 'coach', icon: 'cap', txt: 'New coach skill', id: 'coach' });
    const sig = shopSig(t);
    const seen = shopSeen().split(',');
    if (sig && sig.split(',').some((x) => seen.indexOf(x) < 0)) out.push({ to: 'shop', icon: 'cart', txt: 'Upgrade ready in the Shop', id: 'shop' });
    // never repeat what the NEXT bar already does
    let nextK = '';
    try { const st = PT.League.Calendar.status(L); nextK = st && st.blockers && st.blockers[0] ? st.blockers[0].k : ''; } catch (e) { nextK = ''; }
    const dup = { EVENT: 'events', ROSTER: 'lineup' }[nextK];
    return out.filter((x) => x.id !== dup && x.to !== UI.Flow.screenFor()).slice(0, 3);
  }
  /**
   * HUNT4-league #1: how many bench players Auto Lineup would start, when that raises team OVR by 1+ (0 otherwise).
   * Runs Auto Lineup on the real team and puts the old lineup back (nothing is saved or emitted).
   */
  function benchGain(L, t) {
    const R = PT.League.Roster, Q = PT.League.Q;
    if (!R || !R.autoDepth || !Q.teamOvr) return 0;
    const before = JSON.stringify(t.dc);
    let gain = 0, n = 0;
    try {
      const o0 = Q.teamOvr(L, t.id).ovr;
      const slots = PT.C.OFF_SLOTS.concat(PT.C.DEF_SLOTS, ['K']);
      const st0 = slots.map((sl) => (t.dc[sl] || [])[0]);
      R.autoDepth(L, t.id, { silent: true });
      gain = Q.teamOvr(L, t.id).ovr - o0;
      n = slots.map((sl) => (t.dc[sl] || [])[0]).filter((pid) => pid != null && st0.indexOf(pid) < 0).length;
    } catch (e) { gain = 0; }
    t.dc = JSON.parse(before);
    return gain >= 1 ? Math.max(1, n) : 0;
  }
  /** HUNT2 #5: the Shop item shows once per newly affordable upgrade set (seen when you open the Shop) */
  function shopSig(t) {
    return PT.C.FACILITIES.filter((f) => t.fac[f] < 5 && PT.C.FACILITY_COST[f][t.fac[f]] <= t.fin.coins).map((f) => f + t.fac[f]).join(',');
  }
  function shopSeen() { try { return (PT.Save.prefs() || {}).shopSeen || ''; } catch (e) { return ''; } }
  if (PT.Events && PT.Events.on) PT.Events.on('ui:navigate', (e) => {
    if (!e || e.name !== 'shop' || !PT.App.L) return;
    try {
      const all = shopSeen().split(',').concat(shopSig(PT.App.L.teams[PT.App.L.userTid]).split(',')).filter(Boolean);
      PT.Save.setPrefs({ shopSeen: all.filter((x, i) => all.indexOf(x) === i).slice(-40).join(',') });
    } catch (err) { /* prefs off */ }
  });
  function todoPanel(L, t) {
    const items = todoItems(L, t);
    if (!items.length) return '';
    return K().card(html`${K().h2('To do', null, 'check')}
      <div class="todo">${items.map((x) => html`<button type="button" class="todo-i" data-action="go" data-to="${x.to}" data-testid="todo-${x.id}"><span class="todo-ic">${K().ic(x.icon)}</span><span class="grow">${x.txt}</span><span class="todo-go">${K().ic('play')}</span></button>`)}</div>`, 'hub-todo');
  }
  /** one-line latest news */
  function ticker(L) {
    const list = (PT.League.News && PT.League.News.list ? PT.League.News.list(L, 1) : (L.news || []).slice(0, 1)) || [];
    if (!list.length) return '';
    return html`<button type="button" class="hq-ticker" data-action="go" data-to="news" data-testid="btn-hub-news">${K().ic('news')}<span class="grow">${K().numify(list[0].txt)}</span></button>`;
  }

  // ---------------- screen ----------------
  function mount(el, params) {
    if (PT.App.L && PT.App.L.tmp && PT.App.restore) PT.App.restore();      // left a Quick Game / Practice by a side door
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    if (L.fd && !L.fd.done) { UI.replace('fantasy'); return; }              // Fantasy Draft still running
    const t = L.teams[L.userTid];
    const showWelcome = D().memo.welcome === L.id || params.welcome;
    // HUNT2 #7: game week = [Sim] + [Play Week N] right here (no Pregame stop); Sim Season lives on the Calendar
    const gw = userGameThisWeek(L);
    let first = null;
    try { const st = PT.League.Calendar.status(L); first = st && st.blockers && st.blockers[0]; } catch (e) { first = null; }
    const simEnd = gw && gw.po === 0 && gw.st !== 'F' && first && first.k === 'USER_GAME' && first.gid === gw.gid
      ? K().btn({ label: 'Sim', icon: 'bolt', action: 'sim-game', data: { gid: gw.gid }, kind: 'sec', size: 'l', testid: 'btn-hub-sim', title: 'Sim this game', cls: 'btn-simend' }) : '';
    const gate = showWelcome ? welcomeCard(L, t) : seasonCardOn(L) ? newSeasonCard(L) : '';
    // UI_RULES 4: HQ = what's next only: the next game (display only), ONE To do panel, a news line, the bottom bar
    const body = html`<div class="hq hqz ${gate ? 'has-gate' : ''}">
      <div class="hqz-main hub-col-main"><div class="hub-phase">${phaseCard(L, t)}</div></div>
      <div class="hqz-side">${gate || todoPanel(L, t)}${gate ? '' : ticker(L)}</div>
    </div>`;
    D().set(el, K().layout(body, html`${simEnd}${K().nextBtn()}`, 'fit hub'));
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
        const L = PT.App.L, gid = +el.getAttribute('data-gid'), b = PT.League.Q.box(L, gid);
        if (UI.openBoxScore) { UI.openBoxScore(gid); return; }
        if (b && UI.postgameOverlay) { UI.postgameOverlay('box', b); return; }
        UI.Modal.open({ title: 'Box Score', body: K().boxScore(b), cls: 'm-wide', buttons: [{ label: 'Close', value: true, kind: 'go' }] });
      },
      'welcome-ok': () => { D().memo.welcome = null; dismissSeason(); UI.refresh(); },
      'season-ok': () => { dismissSeason(); UI.refresh(); },
      practice: () => { D().memo.welcome = null; dismissSeason(); UI.go('practice', { from: 'hub' }); },   // HUNT4 #11
      'sim-game': (el) => { if (UI.Game) UI.Game.sim(+el.getAttribute('data-gid')); }
    }
  };
})(globalThis.PT = globalThis.PT || {});
