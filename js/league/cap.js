/* Pixel Touchdown: js/league/cap.js
 * Owner: WP2. Responsibility: PT.League.Cap: payroll, cap space, dead money, rookie scale.
 * Also: PT.League.K WP2 tuning keys (prefixed FA_/PROG_/ECO_/INJ_/EV_/DRAFT_/AI_/TR_), fair pay (design 10.4).
 * Team Cash = salary cap in $K. "Offseason view" (RESIGN/DRAFT/FREE_AGENCY): payroll counts next season's books
 * (contracts with exp > season, dead money for season + 1), so expiring deals stop counting once Keep Players starts.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Cap = PT.ns('League.Cap');
  const K = PT.ns('League.K');

  // ---------------- WP2 tuning (design values; one place to tweak) ----------------
  Object.assign(K, {
    ECO_TV: 400, ECO_WIN_BONUS: 20, ECO_PO_WIN_BONUS: 50, ECO_PO_CHECK: 100, ECO_BOWL_BONUS: 300,
    ECO_UPKEEP: 50, ECO_FAC_MULT: 1.6,         // pacing: design 40 / ×1.0 maxed every facility in ~6 seasons
    ECO_PARTY_COST: 100, ECO_PARTY_HYPE: 5, ECO_PARTY_MAX: 3,
    PROG_ROLL_SD: 1.5, PROG_RETIRE_MAX_AGE: 39, PROG_TOP_FROM: 80, PROG_TOP_SPAN: 35, DRAFT_POT_PULL: 0.5, DRAFT_POT_MEAN: 72,
    INJ_BASE: 0.005, INJ_SIM_LAMBDA: 0.35,
    EV_CHANCE: 0.55, EV_SECOND: 0.15, EV_PO_CHANCE: 0.30, EV_GAP_WEEKS: 8, EV_MAX_PER_SEASON: 2, EV_GUARANTEE_AFTER: 2, EV_OFF_COUNT: 2,
    FA_SIGN_SCORE: 95, FA_SIGN_SCORE_LAST: 85, FA_MAX_USER_OFFERS: 5, FA_AI_MAX_OFFERS: 3, FA_LEFTOVER_MULT: 0.8, FA_RESERVE: 0.02,
    DRAFT_CLASS: 160, DRAFT_MEAN: 58,   // design N(60,7); −2 keeps league OVR stable (selection effects)
    DRAFT_SD: 7, DRAFT_MIN: 42, DRAFT_MAX: 80, DRAFT_TOP_N: 16, DRAFT_TOP_BONUS: 2,
    // pacing (franchise tuning pass; see docs/handoff/WP2.md "Pacing")
    ECO_HYPE_WIN: 3, ECO_HYPE_HOME_WIN: 4, ECO_HYPE_LOSS: -3, ECO_HYPE_RIVAL_WIN: 5, ECO_HYPE_RIVAL_LOSS: -4,
    ECO_HYPE_DRIFT: 0.35, ECO_SCORER_MAX: 2, ECO_HYPE_CALM: 10,
    COACH_XP_A: 250, COACH_XP_P: 1.6, COACH_XP_LATE: 1000,
    AI_SWAP_CHANCE: 0.10, TR_DEADLINE_WEEK: 10, TR_MAX_PER_TEAM: 2,
    HOF_POINTS: 25, HOF_FIRST: 35, LEGENDS_MAX: 300
  });

  const OFFSEASON = { SEASON_END: 1, RESIGN: 1, DRAFT: 1, FREE_AGENCY: 1 };   // same as WP1 Roster.capSeason

  /** true while the books show next season (Keep Players → Market). @param {League} L */
  Cap.offView = function (L) { return !!OFFSEASON[L.phase]; };
  /** the season whose books count right now */
  Cap.bookSeason = function (L) { return L.season + (Cap.offView(L) ? 1 : 0); };

  /** roundTo $0.5M (500 $K) */
  function round500(v) { return Math.round(v / 500) * 500; }
  /** round to $0.1M */
  Cap.round100 = function (v) { return Math.round(v / 100) * 100; };

  /** Base cap before twists ($K). Persisted in L.capB (grows yearly, design 10.4). */
  Cap.base = function (L) {
    if (typeof L.capB === 'number' && L.capB > 0) return L.capB;
    return round500(C.CAP.BASE * Math.pow(1 + C.CAP.GROWTH, Math.max(0, L.season - C.START_SEASON)));
  };

  /** @param {League} L @returns {number} Team Cash limit in $K (Cap Boom twist +10% this season) */
  Cap.cap = function (L) {
    let v = Cap.base(L);
    // QA1: in the offseason view the books are next season's, which a Cap Boom (this season only) does not cover
    const tw = L.twist && L.twist.s === L.season && !Cap.offView(L) && PT.Data.Twists && PT.Data.Twists.byId ? PT.Data.Twists.byId(L.twist.id) : null;
    if (tw && tw.fx && tw.fx.capBoom) v = round500(v * tw.fx.capBoom);
    return v;
  };

  /**
   * Yearly growth: cap = roundTo0.5(cap × (1.03 + rand(0, 0.02))). Cap Crunch twist: no growth. Called once per season
   * (from Twists.roll after the twist is known). Idempotent per season via L.capS.
   */
  Cap.grow = function (L) {
    if (L.capS === L.season) return Cap.base(L);
    const base = Cap.base(L);
    const crunch = L.twist && L.twist.s === L.season && L.twist.id === 'cap_crunch';
    if (L.capS == null && L.season === C.START_SEASON) L.capB = C.CAP.BASE;
    else if (L.capS == null) L.capB = base;
    else if (!crunch) L.capB = round500(base * (1 + C.CAP.GROWTH + PT.League.rng(L).range(0, C.CAP.GROWTH_RAND)));
    L.capS = L.season;
    return L.capB;
  };

  Cap.minPay = function (L) { return Math.max(100, Cap.round100(Cap.cap(L) * C.CAP.MIN_PCT)); };
  Cap.maxPay = function (L) { return Cap.round100(Cap.cap(L) * C.CAP.MAX_PCT); };

  /**
   * Market value (design 10.4). basePay = 0.5 + 18 × ((max(OVR,50) − 50)/49)^2.2 ($M at cap 100) × posMult × ageMult.
   * @param {League} L @param {Player} p @param {string} [pos] @returns {number} $K, rounded to $0.1M
   */
  Cap.fairPay = function (L, p, pos) {
    pos = pos || p.pos;
    const base = 0.5 + 18 * Math.pow((Math.max(p.ovr, 50) - 50) / 49, 2.2);
    const age = p.age <= 30 ? 1 : p.age <= 32 ? 0.85 : 0.7;
    const capM = (L ? Cap.cap(L) : C.CAP.BASE) / 1000;
    const k = Cap.round100(base * (C.POS_PAY_MULT[pos] || 1) * age * capM / 100 * 1000);
    const lo = L ? Cap.minPay(L) : C.CAP.MIN_SAL, hi = L ? Cap.maxPay(L) : C.CAP.MAX_SAL;
    return Math.max(lo, Math.min(hi, k));
  };

  function roster(L, tid) {
    const t = L.teams[tid];
    const out = [];
    for (const pid of t.roster) { const p = PT.League.Q.player(L, pid); if (p) out.push(p); }
    return out;
  }

  /** Cut Costs counting in the book season. @returns {number} $K */
  Cap.dead = function (L, tid, season) {
    const s = season == null ? Cap.bookSeason(L) : season;
    let n = 0;
    for (const d of L.teams[tid].dead) if (d.s === s) n += d.amt;
    return n;
  };

  /** Sum of Pay (roster incl. Hurt List) + Cut Costs for the book season. @returns {number} $K */
  Cap.payroll = function (L, tid) {
    const s = Cap.bookSeason(L);
    let n = 0;
    for (const p of roster(L, tid)) if (p.con && p.con.exp >= s) n += p.con.sal;
    return n + Cap.dead(L, tid, s);
  };

  /** @returns {number} Team Cash left in $K (negative = over) */
  Cap.space = function (L, tid) { return Cap.cap(L) - Cap.payroll(L, tid); };

  /** @returns {boolean} */
  Cap.canAfford = function (L, tid, sal) { return Cap.space(L, tid) >= sal; };

  /** UI color for Team Cash left (design 1.3): green ≥ $5M, yellow $1–5M, red < $1M */
  Cap.color = function (L, tid) {
    const s = Cap.space(L, tid);
    return s >= 5000 ? 'green' : s >= 1000 ? 'yellow' : 'red';
  };

  /**
   * Rookie Deals (design 10.4), n = overall pick 1..128, scaled by cap/100M, rounded to $0.1M.
   * @param {number} n @param {League} [L] @returns {{sal:number, yrs:number}}
   */
  Cap.rookieScale = function (n, L) {
    const m = n <= 32 ? 5.0 - (n - 1) * 3.0 / 31 : n <= 64 ? 1.5 - (n - 33) * 0.5 / 31 : n <= 96 ? 0.9 - (n - 65) * 0.2 / 31 : 0.6 - (n - 97) * 0.1 / 31;
    const capM = (L ? Cap.cap(L) : C.CAP.BASE) / 1000;
    const sal = Math.max(L ? Cap.minPay(L) : C.CAP.MIN_SAL, Cap.round100(Math.max(0.5, m) * capM / 100 * 1000));
    return { sal: sal, yrs: n <= 32 ? 4 : 3 };
  };

  /** Seasons left on a deal, counting the book season. */
  Cap.yearsLeft = function (L, p) { return p.con ? Math.max(0, p.con.exp - Cap.bookSeason(L) + 1) : 0; };

  /**
   * Cut Cost preview (design 10.4): 50% × pay per year left, spread over those years.
   * @returns {{total:number, years:{s:number, amt:number}[], msg:string}}
   */
  Cap.cutCost = function (L, pid) {
    const p = PT.League.Q.player(L, pid);
    if (!p || !p.con) return { total: 0, years: [], msg: 'No Cut Cost.' };
    // QA1: same rule as Roster.release books (a deal that ends before the book season has no Cut Cost; gtd share)
    const n = Cap.yearsLeft(L, p), per = Math.round(p.con.sal * (p.con.gtd == null ? C.CAP.CUT_PCT : p.con.gtd));
    if (n <= 0) return { total: 0, years: [], msg: 'No Cut Cost.' };
    const s0 = Cap.bookSeason(L);
    const years = [];
    for (let i = 0; i < n; i++) years.push({ s: s0 + i, amt: per });
    const fm = PT.Util.fmtMoney;
    const msg = 'Cut Cost: ' + years.map((y, i) => fm(y.amt) + (i === 0 ? ' this year' : i === 1 ? ' next year' : ' in ' + y.s)).join(' and ') + '.';
    return { total: per * n, years: years, msg: msg };
  };

  /**
   * Book the Cut Cost of releasing pid into team.dead (for WP1 Roster.release: call BEFORE clearing p.con).
   * @returns {number} total $K
   */
  Cap.addDead = function (L, pid) {
    const p = PT.League.Q.player(L, pid);
    if (!p || !p.con || p.tid < 0) return 0;
    const cc = Cap.cutCost(L, pid);
    const t = L.teams[p.tid];
    for (const y of cc.years) if (y.amt > 0) t.dead.push({ s: y.s, amt: y.amt });
    return cc.total;
  };

  /** Payroll rank 1 (highest) .. 32 (lowest). */
  Cap.rank = function (L, tid) {
    const mine = Cap.payroll(L, tid);
    let r = 1;
    for (const t of L.teams) if (t.id !== tid && Cap.payroll(L, t.id) > mine) r++;
    return r;
  };

  /**
   * "Fix it" helper (design 10.4): suggested cuts (lowest value per pay, never below position minimums) to get
   * under the Team Cash limit and to the roster max. Does not mutate.
   * @returns {{cuts:number[], over:number, tooMany:number}}
   */
  Cap.fixPlan = function (L, tid, max) {
    const pl = roster(L, tid).filter((p) => !p.ir);
    max = max || (Cap.offView(L) ? C.ROSTER.MAX_OFF : C.ROSTER.MAX_SEASON);
    const cnt = {};
    for (const p of pl) cnt[p.pos] = (cnt[p.pos] || 0) + 1;
    let over = -Cap.space(L, tid), extra = pl.length - max;
    const val = (p) => (PT.League.Trade && PT.League.Trade.playerValue ? PT.League.Trade.playerValue(L, p.id, tid) : p.ovr) /
      Math.max(p.con ? p.con.sal : 0, 500);
    const sorted = pl.slice().sort((a, b) => (val(a) - val(b)) || ((a.con ? a.con.sal : 0) - (b.con ? b.con.sal : 0)) || (a.id - b.id));
    const cuts = [];
    for (const p of sorted) {
      if (over <= 0 && extra <= 0) break;
      if ((cnt[p.pos] || 0) <= (C.ROSTER.NEED[p.pos] || 0)) continue;
      const saves = p.con ? p.con.sal - Math.round(p.con.sal * C.CAP.CUT_PCT) : 0;
      if (extra <= 0 && saves <= 0) continue;
      cuts.push(p.id); cnt[p.pos]--; extra--; over -= saves;
    }
    return { cuts: cuts, over: Math.max(0, -Cap.space(L, tid)), tooMany: Math.max(0, pl.length - max) };
  };
})(globalThis.PT = globalThis.PT || {});
