/* Pixel Touchdown: js/league/staff.js
 * Owner: WP2. Responsibility: PT.League.Staff: coaches, hiring pool, effects (design 10.11).
 * P0: team.stf[role] = stars 1..5 (role: 'off' | 'def' | 'grw'). P1: named candidates { n, sp, st, q } with a small quirk.
 * Cost per season by stars: C.STAFF_COST. Off/Def coach: +0..+4 to all skills of that side in games (engine reads
 * GameTeam.coach). Growth coach: +0.5 × (stars − 1) progression for age ≤ 25.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Staff = PT.ns('League.Staff');

  /** Candidate quirks (P1): id → kid text. Effects applied by Economy/Progression/Injuries/Coach/Spirit. */
  Staff.QUIRKS = {
    none: 'No special trick.',
    hype: '+1 Hype per win',
    merch: '+10% merch money',
    heal: 'Hurt players heal a bit faster',
    mood: 'Players stay a bit happier',
    scout: '+1 scout point each season',
    xp: '+10% Coach XP'
  };
  const FIRST = ['Waddles', 'Hoots', 'Barkley', 'Snout', 'Quill', 'Biscuit', 'Pebble', 'Mochi', 'Truffle', 'Gizmo', 'Maple', 'Pudding'];
  const LAST = ['McHop', 'Puddlefoot', 'Thunderpaws', 'Featherstone', 'Whiskerton', 'Bouncewell', 'Crumbs', 'Waddle', 'Iceberg', 'Haystack'];

  /** @returns {number} stars 1..5 */
  Staff.stars = function (L, tid, role) {
    const v = L.teams[tid].stf[role];
    return typeof v === 'number' ? v : (v && v.st) || 1;
  };

  /** Set stars without charging (internal; keeps a named coach object if present). */
  Staff.put = function (L, tid, role, stars) {
    const t = L.teams[tid];
    stars = Math.max(1, Math.min(5, stars | 0));
    const v = t.stf[role];
    if (v && typeof v === 'object') v.st = stars; else t.stf[role] = stars;
  };

  /** Season cost of a star level. */
  Staff.cost = function (stars) { return C.STAFF_COST[stars] || 0; };

  /**
   * Coaches are hired for a season (ROUND6 C: no Preseason): any time in the offseason (Awards → Market) and in
   * Week 1 before your first game is final. Never mid-season, so stars can't be bought just for the playoffs.
   */
  function canHire(L) {
    if (['SEASON_END', 'RESIGN', 'DRAFT', 'FREE_AGENCY', 'PRESEASON'].indexOf(L.phase) >= 0) return true;
    if (L.phase !== 'REGULAR' || L.week > 1) return false;
    const u = L.userTid;
    return !L.sched.some((g) => g.po === 0 && g.st === 'F' && (g.h === u || g.a === u));
  }
  Staff.canHire = canHire;

  /**
   * P0: pick a star level for a slot; pays (or refunds) the difference in season cost. @returns {Result}
   */
  Staff.setStars = function (L, tid, role, stars) {
    if (C.STAFF.indexOf(role) < 0) return { ok: false, err: 'BAD_ROLE', msg: 'Pick a coach slot.' };
    if (tid === L.userTid && !canHire(L)) return { ok: false, err: 'NOT_NOW', msg: 'Hire coaches before Week 1.' };
    stars = Math.max(1, Math.min(5, stars | 0));
    const t = L.teams[tid], cur = Staff.stars(L, tid, role);
    const delta = Staff.cost(stars) - Staff.cost(cur);
    if (delta > t.fin.coins) return { ok: false, err: 'NO_COINS', msg: 'Not enough Coins.' };
    if (delta) PT.League.Economy.addCoins(L, tid, -delta, 'staff', false);
    Staff.put(L, tid, role, stars);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'staff' });
    return { ok: true, stars: stars, cost: delta };
  };

  /**
   * P1: 3 named candidates per slot (deterministic per season) with a star level and a small quirk.
   * @returns {{n:string, sp:string, st:number, q:string, txt:string, cost:number}[]}
   */
  Staff.candidates = function (L, role) {
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'staff', role));
    const qs = Object.keys(Staff.QUIRKS).filter((q) => q !== 'none');
    const stars = [r.int(1, 2), r.int(3, 4), r.int(4, 5)];
    return stars.map((st) => {
      const q = r.chance(0.6) ? r.pick(qs) : 'none';
      return { n: 'Coach ' + r.pick(FIRST) + ' ' + r.pick(LAST), sp: r.pick(C.SPECIES), st: st, q: q, txt: Staff.QUIRKS[q], cost: Staff.cost(st) };
    });
  };

  /** Hire candidate idx for a slot (pays the cost difference). @returns {Result} */
  Staff.hire = function (L, tid, role, idx) {
    const c = Staff.candidates(L, role)[idx];
    if (!c) return { ok: false, err: 'BAD_PICK', msg: 'Pick a coach.' };
    const res = Staff.setStars(L, tid, role, c.st);
    if (!res.ok) return res;
    L.teams[tid].stf[role] = { n: c.n, sp: c.sp, st: c.st, q: c.q };
    return { ok: true, coach: L.teams[tid].stf[role], cost: res.cost };
  };

  /** Let a coach go: the slot drops to a free 1-star coach (no refund). @returns {Result} */
  Staff.fire = function (L, tid, role) {
    if (C.STAFF.indexOf(role) < 0) return { ok: false, err: 'BAD_ROLE', msg: 'Pick a coach slot.' };
    L.teams[tid].stf[role] = 1;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'staff' });
    return { ok: true };
  };

  /** Game/progression effects of the coaches: off/def +0..4 skills, grw +0..2 progression (age ≤ 25). */
  Staff.effects = function (L, tid) {
    const s = (k) => Staff.stars(L, tid, k);
    return { off: s('off') - 1, def: s('def') - 1, grw: 0.5 * (s('grw') - 1) };
  };

  /** Active coach quirks for a team: { hype:true, merch:true, … } */
  Staff.quirks = function (L, tid) {
    const out = {};
    const t = L.teams[tid];
    if (!t || !t.stf) return out;
    for (const k of C.STAFF) { const v = t.stf[k]; if (v && typeof v === 'object' && v.q && v.q !== 'none') out[v.q] = true; }
    return out;
  };

  /** AI coach stars by team mode (design 17.5): Contender 3/3/2, Middle 2/2/2, Rebuild 2/2/4. Free (AI pays at Preseason bills). */
  Staff.aiSet = function (L, tid) {
    const m = L.teams[tid].strat;
    const s = m === 'contend' ? [3, 3, 2] : m === 'rebuild' ? [2, 2, 4] : [2, 2, 2];
    C.STAFF.forEach((k, i) => Staff.put(L, tid, k, s[i]));
  };
})(globalThis.PT = globalThis.PT || {});
