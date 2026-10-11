/* Pixel Touchdown: js/league/player-gen.js
 * Owner: WP1. Responsibility: PT.League.PlayerGen: create player (pos, age, tier) → Player.
 * Design 3.4 (species pick weights), 4.5 (ages, Growth), 4.6 (skill templates, steps, jersey numbers), 5.1 (traits),
 * 13.2 (Wants shares), 10.4 (fair pay), Appendix A (names, schools).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const PlayerGen = PT.ns('League.PlayerGen');

  /** Position skill templates (design 4.6), in PT.C.RATINGS order: spd pow mov hnd arm aim tkl cov smt kck */
  PlayerGen.TEMPLATE = {
    QB: [55, 45, 50, 45, 70, 70, 20, 20, 70, 25], RB: [72, 62, 70, 58, 30, 25, 30, 25, 55, 20],
    WR: [75, 45, 66, 70, 30, 25, 25, 35, 58, 20], TE: [60, 68, 52, 64, 25, 20, 40, 30, 58, 20],
    OL: [45, 75, 45, 35, 20, 15, 45, 15, 62, 15], DL: [58, 74, 50, 35, 20, 15, 70, 25, 55, 15],
    LB: [63, 64, 52, 48, 20, 15, 70, 55, 62, 15], CB: [76, 45, 66, 55, 20, 15, 52, 72, 58, 15],
    S: [70, 55, 58, 55, 20, 15, 64, 66, 64, 15], K: [45, 40, 40, 35, 40, 30, 20, 15, 60, 72]
  };
  /** Jersey number ranges (design 4.6) */
  PlayerGen.NUMS = { QB: [[1, 19]], K: [[1, 19]], WR: [[10, 19], [80, 89]], TE: [[80, 89]], RB: [[20, 49]], CB: [[20, 49]],
    S: [[20, 49]], LB: [[40, 59], [90, 99]], OL: [[50, 79]], DL: [[50, 79], [90, 99]] };
  PlayerGen.WANT_SHARE = [['money', 25], ['wins', 25], ['home', 20], ['fame', 15], ['chill', 15]];
  PlayerGen.ROOKIE_AGE = [[21, 30], [22, 45], [23, 25]];
  PlayerGen.ACCESSORIES = ['band', 'shades', 'bow', 'cap'];

  const clampS = (v) => Math.max(C.SKILL_MIN, Math.min(C.SKILL_MAX, Math.round(v)));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** design 3.4: 65% fitting species (Best spots), 35% any of the 35 */
  PlayerGen.pickSpecies = function (rng, pos) {
    const S = PT.Data.Species;
    if (rng.chance(S.PICK_FIT)) {
      const fit = S.fitting(pos);
      if (fit.length) return rng.pick(fit).id;
    }
    return rng.pick(S.list).id;
  };

  /** Team cash limit for pay math: Cap.cap(L) when the league is running, base cap otherwise. */
  function capOf(L, cap) {
    if (cap) return cap;
    return L && L.teams && L.teams.length ? PT.League.Cap.cap(L) : C.CAP.BASE;
  }

  /**
   * Market value per design 10.4, in $K, rounded to $0.1M and clamped to min/max pay (0.5% / 25% of cap).
   * @param {League|null} L @param {Player} p @param {number} [cap] $K (defaults to Cap.cap(L))
   */
  PlayerGen.fairPay = function (L, p, cap) {
    cap = capOf(L, cap);
    const base = 0.5 + 18 * Math.pow((Math.max(p.ovr, 50) - 50) / 49, 2.2);
    const age = p.age <= 30 ? 1 : p.age <= 32 ? 0.85 : 0.7;
    const m = base * C.POS_PAY_MULT[p.pos] * age * cap / 100000;
    const k = Math.round(m * 10) * 100;
    return clamp(k, PlayerGen.minPay(cap), Math.round(cap * C.CAP.MAX_PCT / 100) * 100);
  };
  /** minimum pay (0.5% of cap), $K rounded to $0.1M */
  PlayerGen.minPay = function (cap) { return Math.max(100, Math.round((cap || C.CAP.BASE) * C.CAP.MIN_PCT / 100) * 100); };

  /** runtime full-name set for re-rolls (Appendix A: re-roll if the full name already exists) */
  function nameSet(L) {
    if (!L._names || L._namesN !== L.players.length) {
      const s = new Set();
      for (const p of L.players) s.add(p.fn + ' ' + p.ln);
      Object.defineProperty(L, '_names', { value: s, writable: true, configurable: true, enumerable: false });
      Object.defineProperty(L, '_namesN', { value: L.players.length, writable: true, configurable: true, enumerable: false });
    }
    return L._names;
  }

  /** numbers in use on a team (+ retired numbers) */
  PlayerGen.usedNums = function (L, tid, exceptPid) {
    const used = {};
    if (tid >= 0) {
      for (const pid of L.teams[tid].roster) {
        if (pid === exceptPid) continue;
        const p = PT.League.Q.player(L, pid);
        if (p) used[p.num] = 1;
      }
      (L.retNums[tid] || []).forEach((n) => { used[n] = 1; });
    }
    return used;
  };

  /** random free number from the position ranges, else any free 1..99 */
  PlayerGen.pickNum = function (rng, pos, used) {
    const pool = [];
    (PlayerGen.NUMS[pos] || [[1, 99]]).forEach((r) => { for (let n = r[0]; n <= r[1]; n++) if (!used[n]) pool.push(n); });
    if (!pool.length) for (let n = 1; n <= 99; n++) if (!used[n]) pool.push(n);
    if (!pool.length) return 0;
    return rng.pick(pool);
  };

  /** design 5.1: 0 (50%) / 1 (40%) / 2 (10%); 25% Quirk per slot; allowed by natural position */
  PlayerGen.rollTraits = function (rng, pos, age, extraPerk) {
    const T = PT.Data.Traits;
    let n = rng.weighted(T.GEN.COUNT);
    const tr = [];
    const ok = (id) => tr.indexOf(id) < 0 && !(T.byId(id).maxAgeCreate != null && age > T.byId(id).maxAgeCreate);
    const add = (type) => {
      let pool = T.forPos(pos, type).filter(ok);
      if (!pool.length) pool = T.forPos(pos).filter(ok);
      if (pool.length) tr.push(rng.pick(pool));
    };
    for (let i = 0; i < n; i++) add(rng.chance(T.GEN.QUIRK_CHANCE) ? 'quirk' : 'perk');
    if (extraPerk && tr.length < T.GEN.MAX_GEN) add('perk');
    return tr;
  };

  /**
   * Create a player (design 4.6). Assigns id from L.nextPid. Does NOT push into L.players / rosters.
   * @param {League} L
   * @param {{pos:string, tid?:number, age?:number, ovr?:number, letter?:string, sp?:string, num?:number,
   *          initial?:boolean, mor?:number, rng?:Object}} o   ovr = target OVR at the natural position
   * @returns {Player}
   */
  PlayerGen.create = function (L, o) {
    o = o || {};
    const rng = o.rng || PT.League.rng(L);
    const pos = o.pos || 'WR';
    if (!C.OVR_W[pos]) throw new Error('[PlayerGen] bad position ' + pos);
    const tid = o.tid == null ? C.TID.FA : o.tid;
    const prospect = tid === C.TID.PROSPECT;
    const target = o.ovr == null ? rng.int(55, 75) : Math.round(o.ovr);
    const sp = o.sp || PlayerGen.pickSpecies(rng, pos);
    const bias = PT.Data.Species.byId(sp).bias;
    let age = o.age;
    if (age == null) age = prospect ? (pos === 'K' ? rng.int(22, 24) : rng.weighted(PlayerGen.ROOKIE_AGE)) : rng.int(22, 32);

    const tpl = PlayerGen.TEMPLATE[pos];
    const r = {};
    C.RATINGS.forEach((k, i) => { r[k] = clampS(tpl[i] + (bias[k] || 0) + clamp(rng.normal(0, 6), -18, 18)); });
    const p = {
      id: L.nextPid++, fn: '', ln: '', sp: sp, pos: pos, alt: [], sg: {}, age: age, tid: tid, num: 0,
      r: r, ovr: 1, pot: 1, gl: 'B', tr: [], mor: o.mor == null ? 60 : o.mor, want: rng.weighted(PlayerGen.WANT_SHARE), ir: false,
      look: { v: rng.int(0, 1), acc: rng.chance(0.2) ? rng.pick(PlayerGen.ACCESSORIES) : null },
      con: null, inj: null, st: {}, cs: [], aw: [], dr: null
    };
    // step 4: shift main-position skills toward the target OVR, twice
    const R = PT.League.Ratings;
    for (let pass = 0; pass < 2; pass++) {
      const d = target - R.ovr(p, pos);
      if (!d) break;
      for (const k in C.OVR_W[pos]) r[k] = clampS(r[k] + d);
    }
    p.ovr = R.ovr(p, pos);

    // Growth letter + ceiling (design 4.5)
    const letter = o.letter || rng.weighted(R.GROWTH_SHARE);
    const gr = R.GROWTH_GAP[letter];
    let gap = rng.int(gr[0], gr[1]);
    if (age >= 28) gap = Math.min(gap, rng.int(0, 1));
    else if (age >= 26) gap = Math.round(gap * 0.35);
    p.pot = Math.min(99, p.ovr + gap);
    p.gl = age <= 25 ? R.growthLetter(p.pot - p.ovr) : letter;

    p.tr = PlayerGen.rollTraits(rng, pos, age, !!o.initial && p.ovr >= PT.Data.Traits.GEN.STAR_OVR);

    // unique name (re-roll up to 20 times)
    const names = nameSet(L);
    let fn, ln, tries = 0;
    do { fn = PT.Data.Names.first(rng, sp); ln = PT.Data.Names.last(rng, sp); } while (names.has(fn + ' ' + ln) && ++tries < 20);
    p.fn = fn; p.ln = ln;
    names.add(fn + ' ' + ln);
    L._namesN = L.players.length + 1;     // the caller pushes this player next

    p.num = o.num != null ? o.num : PlayerGen.pickNum(rng, pos, PlayerGen.usedNums(L, tid));
    if (prospect) p.pr = { sch: PT.Data.Names.school(rng), rank: 0, sc: 0 };
    return p;
  };

  /**
   * Walk-on (design 2.2): generated free agent at a position, OVR 45–55. Not pushed, no contract.
   * @returns {Player}
   */
  PlayerGen.walkOn = function (L, pos, o) {
    const rng = (o && o.rng) || PT.League.rng(L);
    return PlayerGen.create(L, { pos: pos, tid: C.TID.FA, ovr: rng.int(45, 55), age: rng.int(22, 29), rng: rng });
  };
})(globalThis.PT = globalThis.PT || {});
