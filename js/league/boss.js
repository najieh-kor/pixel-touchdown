/* Pixel Touchdown: js/league/boss.js
 * Owner: WP2. Responsibility: PT.League.Boss: the Boss (owner), Boss Goal, confidence, Hot Seat, firing, new job (design 10.9, R8).
 * L.boss = { goal:{k:'G1'..'G5', n:1..5, txt}, conf:0..100, fired?:true, offers?:[tid×3], retired?:true }.
 * Goal levels: G1 win 5+ · G2 win 8+ · G3 make playoffs · G4 win a playoff game · G5 reach the Bowl.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Boss = PT.ns('League.Boss');
  const FIRE_AT = [null, 20, 28, 30];      // Beginner never · Normal < 20 · Expert < 28 · Legend < 30 (ROUND6 B)

  function goalTxt(n) { const G = (PT.Data.Text && PT.Data.Text.goals) || []; return G[n] || ('Goal ' + n); }

  /** Team OVR rank 1..32 among all teams. */
  Boss.rank = function (L, tid) {
    const mine = PT.League.Q.teamOvr(L, tid).ovr;
    let r = 1;
    for (const t of L.teams) if (t.id !== tid && PT.League.Q.teamOvr(L, t.id).ovr > mine) r++;
    return r;
  };

  /**
   * New season (rollover, ROUND6 C): set the Boss Goal from the power rank (design 10.9). Year 1 (and a brand-new job) is
   * one level easier (min G1). Also snapshots every team's season-start OVR (Coach of the Year, Underdog, upsets).
   * Idempotent per season (pass force to recompute, e.g. after a new job). @returns {{k,n,txt}}
   */
  Boss.setGoal = function (L, force) {
    const ss = PT.League.History.ss(L);
    if (!force && L.boss.goal && L.boss.gs === L.season && ss.ovr) return L.boss.goal;
    ss.ovr = L.teams.map((t) => PT.League.Q.teamOvr(L, t.id).ovr);
    const rank = Boss.rank(L, L.userTid);
    let n = rank <= 3 ? 5 : rank <= 8 ? 4 : rank <= 16 ? 3 : rank <= 24 ? 2 : 1;
    if (L.season === C.START_SEASON || L.boss.nj) n--;
    delete L.boss.nj;
    n = Math.max(1, n);
    L.boss.goal = { k: 'G' + n, n: n, txt: goalTxt(n) };
    L.boss.gs = L.season;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'boss' });
    return L.boss.goal;
  };

  /** Boss face from confidence. */
  Boss.face = function (conf) {
    const T = (PT.Data.Text && PT.Data.Text.boss) || [[75, 'happy'], [50, 'okay'], [30, 'worried'], [0, 'angry']];
    for (const r of T) if (conf >= r[0]) return r[1];
    return 'angry';
  };

  /**
   * Change Boss confidence (clamped 0..100). Boss's Pet achievement at 100.
   * @returns {number} new confidence
   */
  Boss.change = function (L, n, why) {
    if (!n) return L.boss.conf;
    L.boss.conf = Math.max(0, Math.min(100, Math.round((L.boss.conf + n) * 10) / 10));
    if (L.boss.conf >= 100 && PT.League.Achievements) PT.League.Achievements.check(L, 'boss');
    return L.boss.conf;
  };

  /** Level reached this season: 5 Bowl · 4 playoff win · 3 playoffs · 2 won 8+ · 1 won 5+ · 0. */
  Boss.achieved = function (L) {
    const u = L.userTid;
    const row = PT.League.Standings.get(L).find((r) => r.tid === u) || { w: 0 };
    const po = L.sched.filter((g) => g.po > 0 && g.st === 'F' && (g.h === u || g.a === u));
    const poWin = po.some((g) => (g.h === u ? g.hs > g.as : g.as > g.hs));
    if (po.some((g) => g.po === C.PLAYOFF_ROUNDS)) return 5;
    if (poWin) return 4;
    if (po.length || (L.po && L.po.seeds && L.po.seeds.some((s) => s.indexOf(u) >= 0))) return 3;
    if (row.w >= 8) return 2;
    if (row.w >= 5) return 1;
    return 0;
  };

  /**
   * Current status for HQ: { conf, face, goal, hot, fired, level (reached so far), talk }.
   */
  Boss.status = function (L) {
    const conf = L.boss.conf, face = Boss.face(conf);
    const talk = ((PT.Data.Text && PT.Data.Text.bossTalk) || {})[face] || '';
    return { conf: conf, face: face, goal: L.boss.goal, hot: conf < 35, fired: !!L.boss.fired, level: Boss.achieved(L), talk: talk };
  };

  /** Per-game: win +1, loss −1, Bowl win +10 (Rivalry Season doubles rival games). */
  Boss.onGame = function (L, box) {
    const u = L.userTid;
    if (box.h !== u && box.a !== u) return 0;
    const us = box.h === u ? box.hs : box.as, them = box.h === u ? box.as : box.hs;
    let n = us > them ? 1 : us < them ? -1 : 0;
    if (box.po === C.PLAYOFF_ROUNDS && us > them) n += 10;
    const fx = PT.League.Twists.fx(L);
    if (fx.rivalMult && PT.League.History.isRivalGame(L, box.h, box.a)) n *= fx.rivalMult;
    Boss.change(L, n, 'game');
    return n;
  };

  /**
   * End-of-season evaluation (Awards Night): met +15 · beat by ≥ 1 level +25 · missed by one −10 · missed by 2+ −25.
   * Goal met also gives +100 Coach XP. Then the firing check (Rookie never; Pro < 20; Legend < 30).
   * Idempotent per season. @returns {{met:boolean, diff:number, change:number, fired:boolean}}
   */
  Boss.evaluate = function (L) {
    const ss = PT.League.History.ss(L);
    if (ss.bossEval) return ss.bossEval;
    const goal = L.boss.goal || { n: 1 };
    const got = Boss.achieved(L);
    const d = got - goal.n;
    const ch = d >= 1 ? 25 : d === 0 ? 15 : d === -1 ? -10 : -25;
    Boss.change(L, ch, 'season');
    if (d >= 0) PT.League.Coach.addXp(L, PT.League.Coach.XP.goal, 'goal');
    const lim = FIRE_AT[L.diff];
    const fired = lim != null && L.boss.conf < lim;
    if (fired) {
      L.boss.fired = true;
      L.boss.offers = Boss.jobOffers(L);
      PT.League.Coach.car(L).fired++;
    }
    ss.bossEval = { met: d >= 0, diff: d, change: ch, fired: fired, level: got, goal: goal.n };
    return ss.bossEval;
  };

  /** Job offers for the Fired screen (UI alias). @returns {number[]} */
  Boss.offers = function (L) { return L.boss.offers || (L.boss.fired ? (L.boss.offers = Boss.jobOffers(L)) : []); };

  /** 3 job offers from the 8 lowest-rank AI teams (deterministic). @returns {number[]} tids */
  Boss.jobOffers = function (L) {
    const ranked = L.teams.filter((t) => t.id !== L.userTid).map((t) => [t.id, PT.League.Q.teamOvr(L, t.id).ovr])
      .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0])).slice(0, 8).map((x) => x[0]);
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'jobs'));
    r.shuffle(ranked);
    return ranked.slice(0, 3).sort((a, b) => a - b);
  };

  /**
   * Take a new job after being fired: switches the human team; Coach Level, XP, achievements, legacy carry over.
   * Boss starts at 55. Fresh Start achievement. @returns {Result}
   */
  Boss.takeJob = function (L, tid) {
    if (!L.boss.fired) return { ok: false, err: 'NOT_FIRED', msg: 'You already have a job.' };
    if ((L.boss.offers || []).indexOf(tid) < 0) return { ok: false, err: 'NO_OFFER', msg: 'Pick one of the offers.' };
    const old = L.teams[L.userTid];
    old.human = false;
    if (old.strat == null) old.strat = 'balanced';
    L.userTid = tid;
    const t = L.teams[tid];
    t.human = true;
    L.boss = { goal: null, conf: 55, nj: 1 };
    // QA1: cards and next-game effects belong to the old team
    L.ev.pending = L.ev.pending.filter((e) => e.tid === tid);
    const ss = PT.League.History.ss(L);
    ss.nx = {};
    const car = PT.League.Coach.car(L);
    car.hired++;
    if (car.teams.indexOf(tid) < 0) car.teams.push(tid);
    PT.League.Roster.autoDepth(L, old.id);
    PT.League.News.add(L, 'event', PT.League.News.tpl('newJob', { T: 'The ' + t.name, P: L.coach.n }), tid);
    PT.League.Achievements.award(L, 'fresh_start');
    if (PT.Events) PT.Events.emit('league:changed', { what: 'job' });
    return { ok: true, tid: tid };
  };

  /** Retire instead (ends the save with a Legacy card; the slot stays viewable). @returns {{ok, legacy}} */
  Boss.retire = function (L) {
    L.boss.retired = true;
    return { ok: true, legacy: PT.League.Coach.legacy(L) };
  };
})(globalThis.PT = globalThis.PT || {});
