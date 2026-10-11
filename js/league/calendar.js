/* Pixel Touchdown: js/league/calendar.js
 * Owner: WP1. Responsibility: PT.League.Calendar: season state machine, advance(), blockers.
 *
 * Phases / sub-steps (RECONCILE R6, design 10.2, 18.4) — one advance() = one "Next" press:
 *   (ROUND6 C: no Preseason steps) new franchise / rollover → REGULAR week 1 with an automatic season start:
 *     Twists.roll, Economy.season (rollover / create), Boss.setGoal, Training Camp auto-pick, AI preseason, roster prep,
 *     then L.newSeasonCard = { s, twist, goal } for the UI (League.dismissNewSeasonCard). Old saves in PRESEASON start
 *     the season on the next advance.
 *   REGULAR weeks 1..18 (17 games + 1 Rest Week) → PLAYOFFS (week 19..22, sub = round)
 *   SEASON_END "Season Recap" (Awards + Growth Day + Goodbyes run together on entering; the UI shows tabs) →
 *   RESIGN "Keep Players" (skipped with a news line when the user has no expiring deals) → DRAFT (sims to the user's
 *   picks; done → Market) → FREE_AGENCY "Market": Next sims every day left at once (one day at a time while the
 *   user waits on offers; Calendar.finishMarket forces all) → rollover → REGULAR week 1. ≤ 5 Next presses Bowl → Week 1.
 *   (L.sub = Market day index 0..2 while in FREE_AGENCY.)
 * WP2 hooks are called by their documented names at these moments (see Calendar.HOOKS). WP2 implements them;
 * tests use dev/stubs/franchise.stub.js.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Calendar = PT.ns('League.Calendar');
  const LG = () => PT.League;

  /** Every WP2 hook this file calls, in order, per moment (also listed in docs/handoff/WP1.md). */
  Calendar.HOOKS = {
    afterRegularWeek: ['Injuries.weekly(L)', 'Progression.weekly(L)', 'Economy.weekly(L)', 'AIGM.weekly(L)', 'WeeklyEvents.generate(L)'],
    afterPlayoffRound: ['Injuries.weekly(L)', 'Economy.weekly(L)', 'WeeklyEvents.generate(L)'],
    enterSeasonEnd: ['Awards.compute(L) → summary', 'History.archiveSeason(L, summary)', 'Draft.generateClass(L)'],
    enterSeasonRecap: ['(after enterSeasonEnd) Progression.offseason(L)', 'Progression.retire(L)', 'WeeklyEvents.generate(L)'],
    enterResign: ['Contracts.beginResign(L)'],
    enterDraft: ['Contracts.expireUnsigned(L)', 'Draft.begin(L)', 'Draft.simToUser(L)'],
    resignSkip: ['Contracts.expiring(L, userTid) (status + skip check)', 'News.add(L, "sign", …)'],
    draftAdvance: ['Draft.status(L)', 'Draft.simToUser(L)'],
    enterFreeAgency: ['FA.begin(L)'],
    marketDay: ['FA.day(L) (× every day left unless the user waits on offers)'],
    rollover: ['Contracts.rollover(L)', 'Twists.roll(L)', 'Economy.season(L)', 'History.compact(L)', 'AIGM.preseason(L)',
      'Boss.setGoal(L)', 'Progression.campInfo(L)', 'Progression.camp(L, userTid, [{pid}])'],
    seasonStart: ['Boss.setGoal(L)', 'Progression.campInfo(L)', 'Progression.camp(L, userTid, [{pid}])'],
    gamesRecord: ['Injuries.fromBox(L, box)', 'Awards.checkGameRecords(L, box)', 'News.add(L, k, txt, tid)'],
    status: ['Draft.status(L)', 'Cap.space(L, tid)']
  };


  /** the user's game in the current calendar step (regular week or playoff round), or null */
  Calendar.userGame = function (L) {
    const u = L.userTid;
    if (L.phase === C.PHASE.REGULAR) return L.sched.find((g) => g.po === 0 && g.wk === L.week && (g.h === u || g.a === u)) || null;
    if (L.phase === C.PHASE.PLAYOFFS) return L.sched.find((g) => g.po === L.po.rd && (g.h === u || g.a === u)) || null;
    return null;
  };

  function roundName(rd) { return C.PLAYOFF_NAMES[rd] || 'Playoffs'; }

  /**
   * What the Next button does now.
   * @returns {{phase:string, week:number, sub:number, season:number, label:string, nextLabel:string,
   *   blockers:Object[], canAdvance:boolean, info:Object}}
   *   blockers: {k:'FIRED'} | {k:'FANTASY'} | {k:'EVENT', iid} | {k:'ROSTER', errors} | {k:'CAP', over} | {k:'USER_GAME', gid} | {k:'DRAFT_PICK'}
   *   FIRED (QA1): the Boss fired you; nothing advances until Boss.takeJob (or the save is retired). Auto never resolves it.
   */
  Calendar.status = function (L) {
    const blockers = [];
    const info = {};
    let label = '', nextLabel = 'Next';
    if (L.boss && L.boss.fired) blockers.push({ k: 'FIRED' });
    if (L.fd && !L.fd.done) blockers.push({ k: 'FANTASY' });          // "Start fresh: everyone drafts!" (League.Fantasy)
    (L.ev && L.ev.pending || []).forEach((e) => blockers.push({ k: 'EVENT', iid: e.iid }));
    const rosterCheck = (max) => {
      const v = LG().Roster.validate(L, L.userTid, max ? { max: max } : null);
      if (!v.ok) blockers.push({ k: 'ROSTER', errors: v.errors });
      return v;
    };
    switch (L.phase) {
      case C.PHASE.PRESEASON:                                          // only old saves (ROUND6 C)
        label = 'New Season';
        nextLabel = 'Start Season';
        break;
      case C.PHASE.REGULAR: {
        label = 'Week ' + L.week;
        const g = Calendar.userGame(L);
        if (!g) { nextLabel = 'Rest Week'; info.rest = true; }
        else {
          const opp = L.teams[g.h === L.userTid ? g.a : g.h];
          info.gid = g.gid; info.opp = opp.id; info.home = g.h === L.userTid;
          if (g.st !== 'F') {
            nextLabel = 'Play Week ' + L.week + (g.h === L.userTid ? ' vs ' : ' @ ') + opp.name;
            rosterCheck();
            const space = LG().Cap.space(L, L.userTid);
            if (space < 0) blockers.push({ k: 'CAP', over: -space });
            blockers.push({ k: 'USER_GAME', gid: g.gid });
          } else nextLabel = L.week >= C.REG_WEEKS ? 'Next: Playoffs' : 'Next Week';
        }
        break;
      }
      case C.PHASE.PLAYOFFS: {
        label = roundName(L.po.rd);
        const g = Calendar.userGame(L);
        const seed = LG().Playoffs.seedOf(L, L.userTid);
        if (g) {
          const opp = L.teams[g.h === L.userTid ? g.a : g.h];
          info.gid = g.gid; info.opp = opp.id; info.home = g.h === L.userTid;
          if (g.st !== 'F') {
            nextLabel = L.po.rd === C.PLAYOFF_ROUNDS ? 'Play the Pixel Bowl' : 'Play ' + roundName(L.po.rd);
            rosterCheck();
            blockers.push({ k: 'USER_GAME', gid: g.gid });
          } else nextLabel = L.po.rd >= C.PLAYOFF_ROUNDS ? 'Season Recap' : 'Next Round';
        } else if (seed && L.po.rd === 1 && seed.seed === 1) { nextLabel = 'Rest Week'; info.rest = true; }
        else nextLabel = L.po.rd >= C.PLAYOFF_ROUNDS ? 'Watch the Bowl' : 'See Playoffs';
        if (L.po.rd >= C.PLAYOFF_ROUNDS && LG().Playoffs.roundDone(L, L.po.rd)) nextLabel = 'Season Recap';
        break;
      }
      case C.PHASE.SEASON_END:                                         // one step: awards + growth + goodbyes (UI tabs)
        label = 'Season Recap';
        nextLabel = userExpiring(L) ? 'Keep Players' : 'Draft Day';
        break;
      case C.PHASE.RESIGN:
        label = 'Keep Players';
        nextLabel = 'Draft Day';
        break;
      case C.PHASE.DRAFT: {
        label = 'Draft Day';
        const ds = LG().Draft.status(L);
        info.draft = ds;
        if (ds.done) nextLabel = 'Market';
        else if (ds.userOnClock) { nextLabel = 'Your Pick'; blockers.push({ k: 'DRAFT_PICK' }); }
        else {
          const userLeft = L.draft && L.draft.order ? L.draft.order.some((o) => o.pid == null && o.tid === L.userTid) : false;
          nextLabel = userLeft ? 'Sim to My Pick' : 'Finish Draft';
        }
        break;
      }
      case C.PHASE.FREE_AGENCY: {
        // Next finishes the whole Market (all days) unless the user is waiting on offers → one Market Day at a time
        label = 'Market';
        const pend = userPendingOffers(L);
        info.pending = pend;
        info.day = L.sub + 1;
        nextLabel = pend && L.sub + 1 < C.FA_DAYS ? 'Next Market Day' : 'Start Season';
        break;
      }
      default:
        label = L.phase;
    }
    // while a Fantasy Draft runs, rosters are empty: only the draft itself blocks (no roster / cap / game blockers)
    if (blockers.some((b) => b.k === 'FANTASY')) {
      for (let i = blockers.length - 1; i >= 0; i--) if (['ROSTER', 'CAP', 'USER_GAME'].indexOf(blockers[i].k) >= 0) blockers.splice(i, 1);
    }
    const ros = blockers.find((b) => b.k === 'ROSTER');
    if (blockers.length && blockers[0].k === 'FIRED') nextLabel = 'Big News';
    else if (blockers.length && blockers[0].k === 'FANTASY') nextLabel = 'Fantasy Draft';
    else if (ros) nextLabel = ros.errors[0].msg;
    else if (blockers.some((b) => b.k === 'CAP')) nextLabel = 'Over the Team Cash Limit';
    return { phase: L.phase, week: L.week, sub: L.sub, season: L.season, label: label, nextLabel: nextLabel,
      blockers: blockers, canAdvance: blockers.length === 0, info: info };
  };

  const BLOCK_MSG = { EVENT: 'Pick an answer for the team news first.', USER_GAME: 'Play or sim your game first.',
    DRAFT_PICK: 'You are on the clock.', FANTASY: 'Finish the Fantasy Draft first.', FIRED: 'The Boss wants to talk. Take a new job first.', CAP: 'You are over the Team Cash limit.' };

  function compactOld(L) {
    const u = L.userTid;
    for (const gid of Object.keys(L.box)) {
      const b = L.box[gid];
      if (!b.c && b.wk < L.week && b.h !== u && b.a !== u) L.box[gid] = PT.Box.compact(b);
    }
  }

  function simStep(L, pred) {
    const simmed = [];
    L.sched.filter((g) => g.st !== 'F' && pred(g)).sort((a, b) => a.gid - b.gid).forEach((g) => {
      LG().Games.simGame(L, g.gid);
      simmed.push(g.gid);
    });
    return simmed;
  }

  /** AI teams get legal before Week 1: cut to 22, fill minimums, fit the cap, Auto Lineup, captain. */
  function prepSeason(L) {
    const R = LG().Roster;
    L.teams.forEach((t) => {
      if (t.human) {
        if (L.settings.autoLineup) R.autoDepth(L, t.id, { silent: true });
        else { R.repairDepth(L, t.id); R.autoDepth(L, t.id, { onlyEmpty: true, silent: true }); }
        return;
      }
      R.cutToMax(L, t.id, C.ROSTER.MAX_SEASON);
      if (!R.validate(L, t.id, { max: C.ROSTER.MAX_SEASON }).ok) R.fixIt(L, t.id, { useFA: true, max: C.ROSTER.MAX_SEASON });
      if (LG().Cap.space(L, t.id) < 0) R.fixCap(L, t.id);
      R.autoDepth(L, t.id, { silent: true });
      if (t.capt == null || t.roster.indexOf(t.capt) < 0) LG().TeamGen.pickCaptain(L, t);
    });
  }

  /** Weekly Power Rankings snapshot (Standings.snapPower → L.pr). Never blocks the calendar. */
  function snapPower(L) {
    try { if (LG().Standings.snapPower) LG().Standings.snapPower(L); }
    catch (e) { if (PT.Log) PT.Log.warn('calendar', 'power rankings snapshot failed', e && e.message); }
  }

  /** does the user have contracts ending now (Keep Players step)? */
  function userExpiring(L) {
    const Ct = LG().Contracts;
    return !!(Ct && typeof Ct.expiring === 'function' && Ct.expiring(L, L.userTid).length);
  }
  /** user offers still waiting for an answer on the Market */
  function userPendingOffers(L) {
    if (!L.fa || !L.fa.offers) return 0;
    return L.fa.offers.filter((of) => {
      const p = of.tid === L.userTid ? LG().Q.player(L, of.pid) : null;
      return p && p.tid === C.TID.FA;
    }).length;
  }

  /** Enter DRAFT (hooks Contracts.expireUnsigned, Draft.begin) and sim to the user's first pick. */
  function enterDraft(L) {
    const H = LG();
    H.Contracts.expireUnsigned(L);
    L.phase = C.PHASE.DRAFT; L.sub = 0;
    H.Draft.begin(L);
    if (!H.Draft.status(L).done) H.Draft.simToUser(L);
  }

  /** Market days left → FA.day each, then rollover (REGULAR week 1). */
  function finishMarketDays(L) {
    while (L.phase === C.PHASE.FREE_AGENCY) {
      LG().FA.day(L);
      L.sub++;
      if (L.sub >= C.FA_DAYS) rollover(L);
    }
  }

  /** Training Camp auto-pick (ROUND6 C): the user's Focus players = highest growth potential (ceiling − OVR). */
  function autoCamp(L) {
    const P = LG().Progression;
    if (!P || typeof P.camp !== 'function' || P.camp.__stub) return;
    const info = typeof P.campInfo === 'function' ? P.campInfo(L) : { n: L.diff === 0 ? 4 : 3, done: false };
    if (info.done) return;
    const pl = LG().Q.roster(L, L.userTid).filter((p) => p.pos !== 'K' && !p.ir)
      .sort((a, b) => ((b.pot - b.ovr) - (a.pot - a.ovr)) || (a.age - b.age) || (a.id - b.id)).slice(0, info.n || 3);
    P.camp(L, L.userTid, pl.map((p) => ({ pid: p.id })));
  }

  /**
   * Automatic season start (ROUND6 C), entered in phase PRESEASON: Boss goal, Training Camp, roster prep → REGULAR
   * week 1 and the "New Season" card. (Twists.roll / Economy.season run at rollover and League.create just before.)
   * @param {{keepGoal?:boolean}} [o] keepGoal: an old save that already has this season's goal
   */
  function startSeason(L, o) {
    const H = LG();
    if (!(o && o.keepGoal && L.boss && L.boss.goal)) H.Boss.setGoal(L);
    autoCamp(L);
    prepSeason(L);
    L.phase = C.PHASE.REGULAR; L.week = 1; L.sub = 0;
    L.teams.forEach((t) => { if (t.human) H.Roster.updateStars(L, t.id); else H.Roster.autoStars(L, t.id); });
    L.newSeasonCard = { s: L.season, twist: L.twist ? L.twist.id : 'normal', goal: L.boss ? L.boss.goal : null };
  }
  Calendar.startSeason = startSeason;

  /** End of season → REGULAR week 1 of the next season (ROUND6 C). */
  function rollover(L) {
    const S = LG().Standings;
    const rows = S.get(L), places = S.places(L);
    L.teams.forEach((t) => {
      const r = rows[t.id];
      const ex = t.rec.find((x) => x.s === L.season);
      if (ex) ex.pl = places[t.id];
      else t.rec.push({ s: L.season, w: r.w, l: r.l, t: r.t, res: LG().Playoffs.result(L, t.id), pl: places[t.id] });
    });
    L.players.forEach((p) => {
      // t = the team he played for this season (p.st.t from Games.record), not where he is after the Market
      if (p.st && Object.keys(p.st).length) { p.cs.push(Object.assign({ s: L.season, t: p.tid }, p.st)); p.st = {}; }
    });
    L.season++;
    L.phase = C.PHASE.PRESEASON; L.week = 0; L.sub = 0;
    L.sched = []; L.box = {}; L.po = { seeds: [[], []], rd: 0, champ: null }; L.draft = null; L.fa = null;
    LG().Contracts.rollover(L);
    LG().Twists.roll(L);
    LG().Economy.season(L);
    LG().History.compact(L);
    LG().hydrate(L);
    // draft picks: drop used seasons, keep two future seasons for every original team
    L.teams.forEach((t) => { t.picks = t.picks.filter((pk) => pk.s > L.season); });
    for (let s = L.season + 1; s <= L.season + 2; s++) {
      L.teams.forEach((orig) => {
        for (let rd = 1; rd <= C.DRAFT_ROUNDS; rd++) {
          const held = L.teams.some((t) => t.picks.some((pk) => pk.s === s && pk.rd === rd && pk.orig === orig.id));
          if (!held) orig.picks.push({ s: s, rd: rd, orig: orig.id });
        }
      });
    }
    L.scout = { pts: LG().scoutPoints(L), spent: {} };
    LG().Schedule.generate(L);
    LG().AIGM.preseason(L);
    L.teams.forEach((t) => {
      if (t.human) return;
      LG().Roster.autoDepth(L, t.id, { silent: true });
      if (t.capt == null || t.roster.indexOf(t.capt) < 0) LG().TeamGen.pickCaptain(L, t);
    });
    startSeason(L);
    snapPower(L);
  }
  Calendar._rollover = rollover;

  /**
   * "Finish the Market": sim every Market Day left (FA.day × N) and start the season (rollover → REGULAR week 1).
   * Same blockers as advance. @returns {AdvanceResult}
   */
  Calendar.finishMarket = function (L) {
    if (L.phase !== C.PHASE.FREE_AGENCY) return { ok: false, err: 'NOT_MARKET', msg: 'The Market is not open.' };
    return Calendar.advance(L, { finishMarket: true });
  };

  /**
   * One "Next" press. Refuses while blockers exist.
   * @returns {{ok:boolean, from:Object, to:Object, simmed:number[], phaseChanged:boolean, news:Object[], err?, msg?, blockers?}}
   */
  Calendar.advance = function (L, opts) {
    opts = opts || {};
    const st = Calendar.status(L);
    const from = { phase: L.phase, week: L.week, sub: L.sub, season: L.season };
    if (!st.canAdvance) {
      const b = st.blockers[0];
      return { ok: false, err: 'BLOCKED', msg: b.k === 'ROSTER' ? b.errors[0].msg : BLOCK_MSG[b.k] || 'Not yet.', blockers: st.blockers,
        from: from, to: from, simmed: [], phaseChanged: false, news: [] };
    }
    const oldNews = new Set(L.news);
    let simmed = [];
    const H = LG();
    switch (L.phase) {
      case C.PHASE.PRESEASON:                                          // old saves: start the season now
        startSeason(L, { keepGoal: true });
        break;
      case C.PHASE.REGULAR:
        simmed = simStep(L, (g) => g.po === 0 && g.wk === L.week);
        compactOld(L);
        H.Injuries.weekly(L);
        H.Progression.weekly(L);
        H.Economy.weekly(L);
        H.AIGM.weekly(L);
        H.WeeklyEvents.generate(L);
        snapPower(L);
        if (L.week >= C.REG_WEEKS) {
          L.phase = C.PHASE.PLAYOFFS;
          H.Playoffs.seed(L);
          L.week = C.REG_WEEKS + 1; L.sub = 1;
          L.po.seeds.forEach((s) => s.forEach((tid) => { if (tid === L.userTid) H.News.add(L, 'game', 'The ' + L.teams[tid].name + ' clinch a playoff spot', tid); }));
        } else L.week++;
        break;
      case C.PHASE.PLAYOFFS: {
        simmed = simStep(L, (g) => g.po === L.po.rd);
        compactOld(L);
        H.Injuries.weekly(L);
        H.Economy.weekly(L);
        H.WeeklyEvents.generate(L);
        snapPower(L);
        const r = H.Playoffs.advance(L);
        if (r.done) {
          L.phase = C.PHASE.SEASON_END; L.sub = 0;
          L.newSeasonCard = null;                                      // the season-start card belongs to the season that just ended
          H.News.add(L, 'award', 'The ' + L.teams[r.champ].name + ' win the Pixel Bowl!', r.champ);
          const summary = H.Awards.compute(L);
          H.History.archiveSeason(L, summary);
          H.Draft.generateClass(L);
          // Season Recap = Awards Night + Growth Day + Goodbyes in one step (same hook order as before)
          H.Progression.offseason(L);
          H.Progression.retire(L);
          H.WeeklyEvents.generate(L);
        } else { L.week++; L.sub = L.po.rd; }
        break;
      }
      case C.PHASE.SEASON_END:
        // old saves stopped mid-way through the former 3 sub-steps: run the hooks they still miss
        if (L.sub === 1) { H.Progression.retire(L); H.WeeklyEvents.generate(L); }
        L.phase = C.PHASE.RESIGN; L.sub = 0;
        H.Contracts.beginResign(L);
        if (!userExpiring(L)) {                                         // nobody to keep → straight to Draft Day
          H.News.add(L, 'sign', 'No contracts ending this year. On to Draft Day!', L.userTid);
          enterDraft(L);
        }
        break;
      case C.PHASE.RESIGN:
        enterDraft(L);
        break;
      case C.PHASE.DRAFT:
        if (!H.Draft.status(L).done) H.Draft.simToUser(L);
        if (H.Draft.status(L).done) { L.phase = C.PHASE.FREE_AGENCY; L.sub = 0; H.FA.begin(L); }
        break;
      case C.PHASE.FREE_AGENCY:
        if (!opts.finishMarket && userPendingOffers(L) && L.sub + 1 < C.FA_DAYS) {           // the user waits on offers: one Market Day
          H.FA.day(L);
          L.sub++;
        } else finishMarketDays(L);                                     // otherwise the whole Market at once
        break;
      default:
        throw new Error('[Calendar] unknown phase ' + L.phase);
    }
    // Stars (ROUND6 A): keep every team's Stars valid (players gone / out long-term are replaced by the auto pick)
    L.teams.forEach((t) => H.Roster.updateStars(L, t.id));
    const to = { phase: L.phase, week: L.week, sub: L.sub, season: L.season };
    const res = { ok: true, from: from, to: to, simmed: simmed, phaseChanged: from.phase !== to.phase,
      news: L.news.filter((n) => !oldNews.has(n)) };
    if (res.phaseChanged) H.emit('league:phase', { from: from.phase, to: to.phase });
    H.emit('league:advanced', res);
    H.emit('league:changed', { what: 'advance' });
    return res;
  };
})(globalThis.PT = globalThis.PT || {});
