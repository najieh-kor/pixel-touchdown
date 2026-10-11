/* Pixel Touchdown: js/league/ratings.js
 * Owner: WP1. Responsibility: PT.League.Ratings: OVR formulas per position, team unit ratings.
 * Design 4.1 (derived values), 4.3 (OVR weights = PT.C.OVR_W), 4.4 (Stars), 4.5 (Growth letters), R5 (out of position −3),
 * Appendix C (team unit ratings).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Ratings = PT.ns('League.Ratings');

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** true if pos is a natural position of p (own pos or earned alt) */
  Ratings.isNatural = function (p, pos) {
    return pos === p.pos || (p.alt || []).indexOf(pos) >= 0;
  };

  /**
   * OVR at a position (design 4.3). Out of position: −3 to every skill (R5) until 4 starts there.
   * @param {Player|{r:Object,pos:string,alt?:string[]}} p @param {string} [pos] @returns {number} 1..99
   */
  Ratings.ovr = function (p, pos) {
    pos = pos || p.pos;
    const w = C.OVR_W[pos];
    if (!w) throw new Error('[Ratings] unknown position ' + pos);
    const pen = Ratings.isNatural(p, pos) ? 0 : C.OUT_OF_POS_PENALTY;
    let s = 0;
    for (const k in w) s += w[k] * (p.r[k] - pen);
    return clamp(Math.round(s), 1, 99);
  };

  /** Raw weighted sum from a skills object (no rounding, no penalty): used by StatSim with adjusted skills. */
  Ratings.ovrRaw = function (r, pos) {
    const w = C.OVR_W[pos];
    let s = 0;
    for (const k in w) s += w[k] * r[k];
    return s;
  };

  /** Main ("bold") skills per position (design 4.2) — Star players get +5 to these (ROUND6 A). */
  Ratings.MAIN = { QB: ['aim', 'arm', 'smt'], RB: ['spd', 'mov', 'pow'], WR: ['spd', 'hnd'], TE: ['hnd', 'pow', 'spd'],
    OL: ['pow', 'smt'], DL: ['pow', 'spd', 'tkl'], LB: ['tkl', 'spd'], CB: ['cov', 'spd'], S: ['cov', 'spd', 'tkl', 'smt'], K: ['kck'] };
  Ratings.STAR_BONUS = 5;

  /** Kick returner rating (KR slot has no position formula) */
  Ratings.krRating = function (p) { return clamp(Math.round(0.5 * p.r.spd + 0.35 * p.r.mov + 0.15 * p.r.hnd), 1, 99); };

  /** Slot OVR (lineup slot id from PT.C.SLOTS) */
  Ratings.slotOvr = function (p, slot) {
    if (slot === 'KR') return Ratings.krRating(p);
    return Ratings.ovr(p, C.SLOT_POS[slot]);
  };

  /** Recompute and cache p.ovr (natural position). @returns {number} */
  Ratings.recalc = function (p) { p.ovr = Ratings.ovr(p, p.pos); return p.ovr; };

  // ---- derived values (design 4.1) ----
  Ratings.block = (r) => 0.60 * r.pow + 0.25 * r.smt + 0.15 * r.mov;
  Ratings.rush = (r) => 0.50 * r.pow + 0.35 * r.spd + 0.15 * r.smt;
  Ratings.shed = (r) => 0.50 * r.pow + 0.30 * r.tkl + 0.20 * r.smt;
  Ratings.topSpeed = (r) => 5.0 + r.spd * 0.045;
  Ratings.accelTime = (r) => 0.65 - r.mov * 0.003;
  Ratings.reactTime = (r) => 0.40 - r.smt * 0.002;

  // ---- Stars (design 4.4) ----
  const STAR_CUTS = [[92, 5], [87, 4.5], [82, 4], [77, 3.5], [71, 3], [65, 2.5], [58, 2], [50, 1.5], [40, 1]];
  /** player OVR → 0.5..5 stars */
  Ratings.stars = function (ovr) {
    for (const c of STAR_CUTS) if (ovr >= c[0]) return c[1];
    return 0.5;
  };
  const TEAM_CUTS = [[80, 5], [77, 4.5], [74, 4], [72, 3.5], [70, 3], [68, 2.5], [66, 2], [64, 1.5]];
  /** team OVR → 1..5 stars */
  Ratings.teamStars = function (ovr) {
    for (const c of TEAM_CUTS) if (ovr >= c[0]) return c[1];
    return 1;
  };

  // ---- Growth letters (design 4.5) ----
  Ratings.GROWTH_GAP = { 'A+': [20, 28], A: [14, 19], B: [8, 13], C: [3, 7], D: [0, 2] };
  Ratings.GROWTH_SHARE = [['A+', 5], ['A', 15], ['B', 35], ['C', 30], ['D', 15]];
  /** ceiling − OVR → letter */
  Ratings.growthLetter = function (gap) {
    return gap >= 20 ? 'A+' : gap >= 14 ? 'A' : gap >= 8 ? 'B' : gap >= 3 ? 'C' : 'D';
  };

  // ---- team ratings ----
  function starter(L, t, slot) {
    const pid = t.dc && t.dc[slot] && t.dc[slot][0];
    return pid == null ? null : PT.League.Q.player(L, pid);
  }

  /**
   * Team OVR (design 4.4): QB ×3, every other field starter ×1, K ×0.5, divided by 16.5. Empty slot counts as 30.
   * @returns {{ovr:number, off:number, def:number, st:number, stars:number}}
   */
  Ratings.teamOvr = function (L, tid) {
    const t = L.teams[tid];
    const so = (slot) => { const p = starter(L, t, slot); return p ? Ratings.slotOvr(p, slot) : 30; };
    const off = C.OFF_SLOTS.map(so), def = C.DEF_SLOTS.map(so), k = so('K');
    let sum = 0;
    off.forEach((v, i) => { sum += v * (i === 0 ? 3 : 1); });
    def.forEach((v) => { sum += v; });
    sum += 0.5 * k;
    const ovr = Math.round(sum / 16.5);
    const offAvg = Math.round((off.reduce((a, b) => a + b, 0) + 2 * off[0]) / 9);
    const defAvg = Math.round(def.reduce((a, b) => a + b, 0) / 7);
    return { ovr: ovr, off: offAvg, def: defAvg, st: k, stars: Ratings.teamStars(ovr) };
  };

  /**
   * Unit ratings from slot OVRs (Appendix C), plus pass rush / pass block averages (design 4.1).
   * @param {Object<string,number>} so slot → slot OVR   @param {Object<string,Object>} [sr] slot → skills (for rush/block)
   */
  Ratings.unitsFrom = function (so, sr) {
    const avg = (a, b) => (so[a] + so[b]) / 2;
    const u = {
      pass: 0.45 * so.QB + 0.25 * avg('WR1', 'WR2') + 0.10 * so.TE + 0.20 * avg('OL1', 'OL2'),
      run: 0.40 * so.RB + 0.40 * avg('OL1', 'OL2') + 0.10 * so.TE + 0.10 * so.QB,
      passD: 0.30 * avg('CB1', 'CB2') + 0.20 * so.S + 0.20 * avg('LB1', 'LB2') + 0.30 * avg('DL1', 'DL2'),
      runD: 0.45 * avg('DL1', 'DL2') + 0.35 * avg('LB1', 'LB2') + 0.10 * so.S + 0.10 * avg('CB1', 'CB2'),
      kick: so.K
    };
    if (sr) {
      u.rush = (Ratings.rush(sr.DL1) + Ratings.rush(sr.DL2)) / 2;
      u.block = (Ratings.block(sr.OL1) + Ratings.block(sr.OL2)) / 2;
    }
    return u;
  };

  /** @returns {{pass, run, passD, runD, rush, block, kick}} for a league team's current starters */
  Ratings.unit = function (L, tid) {
    const t = L.teams[tid];
    const so = {}, sr = {};
    const blank = { spd: 40, pow: 40, mov: 40, hnd: 40, arm: 40, aim: 40, tkl: 40, cov: 40, smt: 40, kck: 40 };
    C.SLOTS.forEach((slot) => {
      if (slot === 'KR') return;
      const p = starter(L, t, slot);
      so[slot] = p ? Ratings.slotOvr(p, slot) : 30;
      sr[slot] = p ? p.r : blank;
    });
    const u = Ratings.unitsFrom(so, sr);
    for (const k in u) u[k] = Math.round(u[k] * 10) / 10;
    return u;
  };
})(globalThis.PT = globalThis.PT || {});
