/* Pixel Touchdown: js/league/roster.js
 * Owner: WP1. Responsibility: PT.League.Roster: depth chart, auto-depth, validate, raw sign/release moves.
 * Design 2.2 (roster sizes, minimums, Hurt List, walk-ons, "Fix it for me"), 2.3 (slot lineup, Auto Lineup order,
 * 2 subs, out of position −3, new natural position after 4 starts), 10.4 (Cut Cost), 13.5 (Captain), 17.4/17.5 (cut logic).
 * Result = { ok:true, … } | { ok:false, err:'CODE', msg:'Simple words.' }
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Roster = PT.ns('League.Roster');
  const Q = () => PT.League.Q;
  const R = () => PT.League.Ratings;

  const ok = (o) => Object.assign({ ok: true }, o || {});
  const fail = (err, msg) => ({ ok: false, err: err, msg: msg });
  const emit = (n, p) => PT.League.emit(n, p);
  const OFFSEASON = { SEASON_END: 1, RESIGN: 1, DRAFT: 1, FREE_AGENCY: 1 };

  /** Auto Lineup slot order (design 2.3: QB, K, OL, DL, WR, CB, RB, TE, LB, S; then KR) */
  Roster.AUTO_ORDER = ['QB', 'K', 'OL1', 'OL2', 'DL1', 'DL2', 'WR1', 'WR2', 'CB1', 'CB2', 'RB', 'TE', 'LB1', 'LB2', 'S'];
  Roster.FIELD_SLOTS = Roster.AUTO_ORDER.filter((s) => s !== 'K');

  /** Max roster size now (design 2.2): 22 from Week 1 to the Bowl, 30 in the offseason. Hurt List does not count. */
  Roster.limit = function (L) {
    return L.phase === C.PHASE.REGULAR || L.phase === C.PHASE.PLAYOFFS ? C.ROSTER.MAX_SEASON : C.ROSTER.MAX_OFF;
  };
  /** Season whose Team Cash a move affects now: next season after the Bowl. */
  Roster.capSeason = function (L) { return OFFSEASON[L.phase] ? L.season + 1 : L.season; };

  function team(L, tid) {
    const t = L.teams[tid];
    if (!t) throw new Error('[Roster] bad team ' + tid);
    return t;
  }
  const healthy = (p) => Q().isHealthy(p);
  const natural = (p, pos) => R().isNatural(p, pos);

  /** slot where pid starts (index 0), excluding KR; null if none */
  Roster.startsAt = function (t, pid) {
    for (const s of C.SLOTS) if (s !== 'KR' && t.dc[s] && t.dc[s][0] === pid) return s;
    return null;
  };

  // ---------------- Auto Lineup ----------------
  /**
   * Max-value assignment of slots (rows) to players (cols) via the Hungarian algorithm.
   * val(p, slot) → number, or null when not allowed. @returns {Object<string,Player>} slot → player
   */
  function assign(slots, players, val) {
    const n = Math.max(slots.length, players.length);
    if (!n || !players.length) return {};
    const BIG = 1e7;
    let maxV = 0;
    const cost = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        let v = null;
        if (i < slots.length && j < players.length) v = val(players[j], slots[i]);
        else v = 0;                                   // dummy row/col
        row.push(v);
        if (v != null && v > maxV) maxV = v;
      }
      cost.push(row);
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = cost[i][j];
      const dummy = i >= slots.length || j >= players.length;
      cost[i][j] = v == null ? BIG : dummy ? maxV + 1 : maxV + 1 - v;   // real pairs always beat leaving a slot empty
    }
    // e-maxx Hungarian (1-indexed potentials)
    const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), pp = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      pp[0] = i;
      let j0 = 0;
      const minv = new Array(n + 1).fill(Infinity), usedC = new Array(n + 1).fill(false);
      do {
        usedC[j0] = true;
        const i0 = pp[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) {
          if (usedC[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (usedC[j]) { u[pp[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (pp[j0] !== 0);
      do { const j1 = way[j0]; pp[j0] = pp[j1]; j0 = j1; } while (j0);
    }
    const out = {};
    for (let j = 1; j <= n; j++) {
      const i = pp[j] - 1, c = j - 1;
      if (i < slots.length && c < players.length && cost[i][c] < BIG) out[slots[i]] = players[c];
    }
    return out;
  }
  Roster._assign = assign;

  /**
   * Auto Lineup (design 2.3): every slot gets a healthy starter (a player starts in one slot only), chosen as the best
   * overall lineup by slot OVR (ties → natural position, younger); subs = next two best by slot OVR (bench first).
   * K players only start/sub at K. KR = best returner (any non-QB, non-K).
   * @param {{onlyEmpty?:boolean, silent?:boolean}} [o] onlyEmpty: keep slots that already have a healthy starter
   * @returns {Result} {ok, dc}
   */
  Roster.autoDepth = function (L, tid, o) {
    o = o || {};
    const t = team(L, tid);
    const pl = Q().roster(L, tid).filter(healthy);
    const used = {};
    const keep = {};
    if (o.onlyEmpty) {
      C.SLOTS.forEach((s) => {
        const st = (t.dc[s] || [])[0];
        const p = st != null && t.roster.indexOf(st) >= 0 ? Q().player(L, st) : null;
        if (p && healthy(p) && (s === 'KR' || !used[st])) { keep[s] = true; if (s !== 'KR') used[st] = true; }
      });
    }
    // slot OVR depends only on the slot's position: precompute once per (position, player)
    const byPos = {};
    const so = (p, slot) => {
      const pos = C.SLOT_POS[slot] || 'KR';
      let m = byPos[pos];
      if (!m) {
        m = byPos[pos] = {};
        for (const x of pl) m[x.id] = pos === 'KR' ? R().krRating(x) : R().ovr(x, pos);
      }
      const v = m[p.id];
      return v != null ? v : R().slotOvr(p, slot);
    };
    const order = (slot) => (a, b) => (so(b, slot) - so(a, slot)) || (a.age - b.age) || (a.id - b.id);
    const dc = {};
    // pass 1: starters. Optimal assignment (maximise Σ team-OVR weight × slot OVR; QB ×3, K ×0.5; natural position and
    // younger break ties). The design's greedy order (QB, K, OL, DL, WR, CB, RB, TE, LB, S) is the tie-break order.
    const open = Roster.AUTO_ORDER.filter((slot) => !keep[slot]);
    const free = pl.filter((p) => !used[p.id]);
    const W = { QB: 3, K: 0.5 };
    const val = (p, slot) => {
      if (slot !== 'K' && p.pos === 'K') return null;
      return (W[slot] || 1) * so(p, slot) + (natural(p, C.SLOT_POS[slot]) ? 1.5 : 0) - p.age * 0.001 - Roster.AUTO_ORDER.indexOf(slot) * 0.0001;
    };
    const pick = assign(open, free, val);
    Roster.AUTO_ORDER.forEach((slot) => {
      if (keep[slot]) { dc[slot] = [t.dc[slot][0]]; return; }
      dc[slot] = [];
      const p = pick[slot];
      if (p) { dc[slot].push(p.id); used[p.id] = true; }
    });
    // pass 2: subs (bench first, then other starters; K players only for K)
    Roster.AUTO_ORDER.forEach((slot) => {
      const st = dc[slot][0];
      if (st == null) return;                         // no starter left: index 0 must stay a starter, so keep it empty
      if (keep[slot]) {
        (t.dc[slot] || []).slice(1).forEach((pid) => {
          const p = Q().player(L, pid);
          if (p && pid !== st && t.roster.indexOf(pid) >= 0 && healthy(p) && dc[slot].length < 1 + C.SUBS_PER_SLOT) dc[slot].push(pid);
        });
      }
      const pool = pl.filter((p) => p.id !== st && dc[slot].indexOf(p.id) < 0 && (slot === 'K' || p.pos !== 'K'));
      const bench = pool.filter((p) => !used[p.id]).sort(order(slot));
      const others = pool.filter((p) => used[p.id]).sort(order(slot));
      const subs = bench.concat(others);
      while (dc[slot].length < 1 + C.SUBS_PER_SLOT && subs.length) dc[slot].push(subs.shift().id);
    });
    // KR
    if (keep.KR) dc.KR = [t.dc.KR[0]];
    else {
      const kr = pl.filter((p) => p.pos !== 'K' && p.pos !== 'QB')
        .sort((a, b) => (R().krRating(b) - R().krRating(a)) || ((used[a.id] ? 1 : 0) - (used[b.id] ? 1 : 0)) || (a.id - b.id))[0];
      dc.KR = kr ? [kr.id] : [];
    }
    const out = {};
    C.SLOTS.forEach((s) => { out[s] = dc[s] || []; });
    t.dc = out;
    if (!o.silent) emit('league:changed', { what: 'depth' });
    return ok({ dc: out });
  };

  /** Drop ids not on the roster / on the Hurt List and remove double starts. Keeps the user's order. */
  Roster.repairDepth = function (L, tid) {
    const t = team(L, tid);
    const starting = {};
    C.SLOTS.forEach((s) => {
      let list = (t.dc[s] || []).filter((pid, i, a) => {
        if (a.indexOf(pid) !== i || t.roster.indexOf(pid) < 0) return false;
        const p = Q().player(L, pid);
        return !!p && !p.ir;
      });
      if (s !== 'KR') {
        while (list.length && starting[list[0]]) list = list.slice(1);
        if (list.length) starting[list[0]] = s;
      }
      t.dc[s] = list.slice(0, s === 'KR' ? 1 : 1 + C.SUBS_PER_SLOT);
    });
    return t.dc;
  };

  /**
   * Set one slot's list [starter, sub1, sub2] (KR: [pid]). If the new starter already starts another slot,
   * the two slots swap starters. K players may not start or sub outside the K slot (design 2.3).
   * @returns {Result}
   */
  Roster.setDepth = function (L, tid, slot, pids) {
    const t = team(L, tid);
    if (C.SLOTS.indexOf(slot) < 0) return fail('BAD_SLOT', 'That spot does not exist.');
    if (!Array.isArray(pids)) return fail('BAD_LIST', 'Pick some players.');
    const max = slot === 'KR' ? 1 : 1 + C.SUBS_PER_SLOT;
    if (pids.length > max) return fail('TOO_MANY', 'Only ' + max + ' players fit here.');
    if (new Set(pids).size !== pids.length) return fail('DUPLICATE', 'A player is listed twice.');
    for (const pid of pids) {
      if (t.roster.indexOf(pid) < 0) return fail('NOT_ON_TEAM', 'That player is not on your team.');
      const p = Q().player(L, pid);
      if (p.ir) return fail('HURT_LIST', p.fn + ' is on the Hurt List.');
      if (slot !== 'K' && p.pos === 'K') return fail('KICKER_ONLY', 'A Kicker can only kick.');
    }
    const old = (t.dc[slot] || [])[0];
    const nu = pids[0];
    if (slot !== 'KR' && nu != null && nu !== old) {
      const other = Roster.startsAt(t, nu);
      if (other) {
        const rest = t.dc[other].slice(1).filter((x) => x !== old);
        if (old != null) {
          const op = Q().player(L, old);
          if (other !== 'K' && op.pos === 'K') return fail('KICKER_ONLY', 'A Kicker can only kick.');
          t.dc[other] = [old].concat(rest).slice(0, 1 + C.SUBS_PER_SLOT);
        } else t.dc[other] = rest;
      }
    }
    t.dc[slot] = pids.slice();
    emit('league:changed', { what: 'depth' });
    return ok({ dc: t.dc });
  };

  /** Swap two entries of a slot list (e.g. starter <-> 1st sub). @returns {Result} */
  Roster.swapDepth = function (L, tid, slot, i, j) {
    const t = team(L, tid);
    const arr = (t.dc[slot] || []).slice();
    if (i === j || i < 0 || j < 0 || i >= arr.length || j >= arr.length) return fail('BAD_SLOT', 'Pick two players to swap.');
    const x = arr[i]; arr[i] = arr[j]; arr[j] = x;
    return Roster.setDepth(L, tid, slot, arr);
  };

  /** Put pid at index idx of a slot (tap-to-assign). @returns {Result} */
  Roster.assign = function (L, tid, slot, idx, pid) {
    const t = team(L, tid);
    const arr = (t.dc[slot] || []).filter((x) => x !== pid);
    arr.splice(Math.min(idx, arr.length), 0, pid);
    return Roster.setDepth(L, tid, slot, arr.slice(0, slot === 'KR' ? 1 : 1 + C.SUBS_PER_SLOT));
  };

  /** Captain (design 13.5). Delegates to WP2 Spirit.setCaptain when present; fallback: in season Spirit −5 and old
   *  Captain Mood −8 when changed; new Captain Mood +8. */
  Roster.setCaptain = function (L, tid, pid) {
    const Sp = PT.League.Spirit;
    if (Sp && typeof Sp.setCaptain === 'function' && !Sp.setCaptain.__stub && pid != null) return Sp.setCaptain(L, tid, pid);  // WP2 owns Mood/Spirit
    const t = team(L, tid);
    if (pid != null && t.roster.indexOf(pid) < 0) return fail('NOT_ON_TEAM', 'That player is not on your team.');
    if (t.capt === pid) return ok();
    const inSeason = L.phase === C.PHASE.REGULAR || L.phase === C.PHASE.PLAYOFFS;
    const old = t.capt != null ? Q().player(L, t.capt) : null;
    if (old && inSeason) { old.mor = Math.max(0, old.mor - 8); t.spirit = Math.max(0, t.spirit - 5); }
    t.capt = pid;
    if (pid != null) { const p = Q().player(L, pid); p.mor = Math.min(100, p.mor + 8); }
    emit('league:changed', { what: 'captain' });
    return ok();
  };

  /**
   * Team style (design 6.2 / 7.5): side 'off' (PT.C.OFF_STYLES key) or 'def' (PT.C.DEF_STYLES key).
   * The user may change it only in the setup window (League.canChangeSetup). @returns {Result}
   */
  Roster.setStyle = function (L, tid, side, id) {
    const t = team(L, tid);
    const table = side === 'off' ? C.OFF_STYLES : side === 'def' ? C.DEF_STYLES : null;
    if (!table) return fail('BAD_SIDE', 'Pick offense or defense.');
    if (!table[id]) return fail('BAD_STYLE', 'That style does not exist.');
    if (t.human && !PT.League.canChangeSetup(L)) return fail('NOT_NOW', 'Change your style before Week 1 kicks off or after the season.');
    t.style[side] = id;
    emit('league:changed', { what: 'style' });
    return ok();
  };

  // ---------------- Star Players v2 (docs/ROUND6.md A) ----------------
  // team.stars = [pid…] up to C.STAR_MAX (8): ≥ C.STAR_MIN_SIDE (2) offense (QB/RB/WR/TE/OL) and ≥ 2 defense (DL/LB/CB/S).
  // K never. Teams keep their Stars while they stay on the roster and are not out long-term (Hurt List or ≥ 4 weeks);
  // gaps are refilled by the auto pick so the team always has 8 when the roster allows. AI teams re-pick each new season.
  const STAR_OFF = { QB: 1, RB: 1, WR: 1, TE: 1, OL: 1 }, STAR_DEF = { DL: 1, LB: 1, CB: 1, S: 1 };
  Roster.starSide = (p) => (STAR_OFF[p.pos] ? 'off' : STAR_DEF[p.pos] ? 'def' : null);
  const STAR_MAX = () => C.STAR_MAX || 8, STAR_MIN = () => C.STAR_MIN_SIDE || 2;
  /** style-aware bonus for the auto pick (run teams star OL+RB, air teams QB+WR, coverage teams the secondary…) */
  const STAR_STYLE = {
    off: { ground: { OL: 6, RB: 6, TE: 2 }, air: { QB: 6, WR: 6 }, west: { QB: 4, TE: 4, RB: 3 }, trick: { QB: 5, WR: 4 }, speed: { RB: 5, WR: 5 } },
    def: { nofly: { CB: 6, S: 6 }, wall: { DL: 6, LB: 5 }, wild: { DL: 6, LB: 4 }, think: { S: 5, LB: 5 } }
  };

  /** can be a Star at all now: on the roster, not a K, not out long-term */
  function starEligible(L, t, p) {
    return !!p && p.tid === t.id && t.roster.indexOf(p.id) >= 0 && !!Roster.starSide(p) && !p.ir &&
      !(p.inj && p.inj.w >= C.ROSTER.IR_MIN_WEEKS && !p.ph);
  }
  function starList(t) { return Array.isArray(t.stars) ? t.stars : []; }
  function starCounts(L, pids) {
    const c = { off: 0, def: 0 };
    pids.forEach((pid) => { const p = Q().player(L, pid); const sd = p && Roster.starSide(p); if (sd) c[sd]++; });
    return c;
  }

  /**
   * Auto pick (ROUND6 A): best 8 by value (OVR + starter bonus + team-style bonus), ≥ 2 per side, no K.
   * @param {number[]} [keep] pids to keep first (the user's valid picks) @returns {number[]}
   */
  Roster.pickStars = function (L, tid, keep) {
    const t = team(L, tid);
    const starting = {};
    C.SLOTS.forEach((s) => { if (s !== 'KR' && t.dc[s] && t.dc[s][0] != null) starting[t.dc[s][0]] = true; });
    const cands = Q().roster(L, tid).filter((p) => starEligible(L, t, p));
    const score = (p) => {
      const sd = Roster.starSide(p);
      const st = STAR_STYLE[sd][sd === 'off' ? t.style.off : t.style.def] || {};
      return p.ovr + (starting[p.id] ? 6 : 0) + (st[p.pos] || 0) - p.id * 1e-6;
    };
    const sc = {};
    cands.forEach((p) => { sc[p.id] = score(p); });
    cands.sort((a, b) => sc[b.id] - sc[a.id]);
    const out = (keep || []).filter((pid) => cands.some((p) => p.id === pid)).slice(0, STAR_MAX());
    const add = (p) => { if (out.length < STAR_MAX() && out.indexOf(p.id) < 0) out.push(p.id); };
    ['off', 'def'].forEach((sd) => {
      let have = starCounts(L, out)[sd];
      for (const p of cands) {
        if (have >= STAR_MIN()) break;
        if (Roster.starSide(p) !== sd || out.indexOf(p.id) >= 0) continue;
        if (out.length >= STAR_MAX()) {
          // make room: drop the weakest Star of a side that has more than the minimum
          const c = starCounts(L, out);
          const other = sd === 'off' ? 'def' : 'off';
          if (c[other] <= STAR_MIN()) break;
          const drop = out.filter((pid) => Roster.starSide(Q().player(L, pid)) === other)
            .sort((x, y) => (sc[x] - sc[y]))[0];
          out.splice(out.indexOf(drop), 1);
        }
        out.push(p.id); have++;
      }
    });
    cands.forEach(add);
    return out;
  };

  /** Auto-pick the team's Stars (Lineup "Auto" button; AI teams every step). @returns {Result} {stars} */
  Roster.autoStars = function (L, tid) {
    const t = team(L, tid);
    t.stars = Roster.pickStars(L, tid);
    emit('league:changed', { what: 'stars' });
    return ok({ stars: t.stars.slice() });
  };

  /** Check a Star list against the rules. @returns {Result} */
  Roster.checkStars = function (L, tid, pids) {
    const t = team(L, tid);
    if (!Array.isArray(pids)) return fail('BAD_LIST', 'Pick some players.');
    if (new Set(pids).size !== pids.length) return fail('DUPLICATE', 'A player is listed twice.');
    if (pids.length > STAR_MAX()) return fail('TOO_MANY', STAR_MAX() + ' Stars max. Remove one first.');
    for (const pid of pids) {
      const p = Q().player(L, pid);
      if (!p || t.roster.indexOf(pid) < 0) return fail('NOT_ON_TEAM', 'That player is not on your team.');
      if (p.pos === 'K') return fail('KICKER', 'A Kicker cannot be a Star.');
    }
    const elig = Q().roster(L, tid).filter((p) => starEligible(L, t, p));
    const c = starCounts(L, pids);
    for (const sd of ['off', 'def']) {
      const can = Math.min(STAR_MIN(), elig.filter((p) => Roster.starSide(p) === sd).length);
      if (c[sd] < can) return fail('NEED_' + sd.toUpperCase(), 'Need ' + STAR_MIN() + ' ' + (sd === 'off' ? 'offense' : 'defense') + ' Stars.');
    }
    return ok();
  };

  /** Set the whole Star list (≤ 8, ≥ 2 per side, no K). @returns {Result} */
  Roster.setStars = function (L, tid, pids) {
    const r = Roster.checkStars(L, tid, pids);
    if (!r.ok) return r;
    team(L, tid).stars = pids.slice();
    emit('league:changed', { what: 'stars' });
    return ok({ stars: pids.slice() });
  };

  /** "Make Star" / "Remove Star". @returns {Result} {on, stars} */
  Roster.toggleStar = function (L, tid, pid) {
    const t = team(L, tid);
    const cur = starList(t).slice();
    const i = cur.indexOf(pid);
    if (i >= 0) cur.splice(i, 1); else cur.push(pid);
    const r = Roster.setStars(L, tid, cur);
    return r.ok ? ok({ on: i < 0, stars: cur }) : r;
  };

  /** true if pid is one of the team's Stars */
  Roster.isStar = function (L, tid, pid) { return starList(team(L, tid)).indexOf(pid) >= 0; };

  /** Star counts {off, def, n, max}. */
  Roster.starInfo = function (L, tid) {
    const s = starList(team(L, tid));
    const c = starCounts(L, s);
    return { off: c.off, def: c.def, n: s.length, max: STAR_MAX(), min: STAR_MIN() };
  };

  /**
   * Keep Stars valid (ROUND6 A): keep the current Stars (user picks, fantasy-draft picks; migrates the old {off, def}
   * shape), drop players gone or out long-term, refill with the auto pick. AI teams get a fresh auto pick at each new
   * season start (Calendar.startSeason). @returns {number[]}
   */
  Roster.updateStars = function (L, tid) {
    const t = team(L, tid);
    let keep = [];
    if (Array.isArray(t.stars)) keep = t.stars;
    else if (t.stars && typeof t.stars === 'object') keep = [t.stars.off, t.stars.def].filter((x) => x != null);
    t.stars = Roster.pickStars(L, tid, keep);
    return t.stars;
  };

  /** Legacy single-Star call (STAR_ABILITIES v1): makes pid a Star. @returns {Result} */
  Roster.setStar = function (L, tid, side, pid) {
    if (pid == null) return Roster.autoStars(L, tid);
    return Roster.isStar(L, tid, pid) ? ok() : Roster.toggleStar(L, tid, pid);
  };

  // ---------------- moves ----------------
  /**
   * Cut Cost (design 10.4): 50% × pay per year left (years left include the current cap season), spread evenly.
   * @returns {{years:number, perYear:number, total:number, entries:{s:number,amt:number}[]}}
   */
  Roster.cutCost = function (L, pid) {
    const p = Q().player(L, pid);
    if (!p || !p.con) return { years: 0, perYear: 0, total: 0, entries: [] };
    const s0 = Roster.capSeason(L);
    const years = Math.max(0, p.con.exp - s0 + 1);
    const perYear = Math.round(p.con.sal * (p.con.gtd == null ? C.CAP.CUT_PCT : p.con.gtd));
    const entries = [];
    for (let i = 0; i < years; i++) entries.push({ s: s0 + i, amt: perYear });
    return { years: years, perYear: perYear, total: perYear * years, entries: entries };
  };

  function detach(L, t, pid) {
    const pp = Q().player(L, pid);
    if (pp && pp.ph) delete pp.ph;
    if (pp && pp.inj && pp.inj.ph) delete pp.inj.ph;   // QA1: Play Hurt is a per-team choice
    t.roster = t.roster.filter((x) => x !== pid);
    C.SLOTS.forEach((s) => { if (t.dc[s]) t.dc[s] = t.dc[s].filter((x) => x !== pid); });
    if (Array.isArray(t.stars)) t.stars = t.stars.filter((x) => x !== pid);
    else if (t.stars) t.stars = [t.stars.off, t.stars.def].filter((x) => x != null && x !== pid);
    if (t.capt === pid) {
      t.capt = null;
      if (!t.human) PT.League.TeamGen.pickCaptain(L, t);
    }
  }
  function afterChange(L, t) {
    if (!t.human || L.settings.autoLineup) Roster.autoDepth(L, t.id, { silent: true });
    else { Roster.repairDepth(L, t.id); Roster.autoDepth(L, t.id, { onlyEmpty: true, silent: true }); }
    Roster.updateStars(L, t.id);
  }

  /** Cut a player: Cut Cost goes to team.dead, player → free agent. @returns {Result} {cost} */
  Roster.release = function (L, pid) {
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return fail('NOT_ON_TEAM', 'That player is not on a team.');
    const t = L.teams[p.tid];
    const cc = Roster.cutCost(L, pid);
    cc.entries.forEach((e) => { if (e.amt > 0) t.dead.push({ s: e.s, amt: e.amt }); });
    detach(L, t, pid);
    p.tid = C.TID.FA; p.con = null; p.ir = false;
    afterChange(L, t);
    emit('league:changed', { what: 'roster' });
    return ok({ cost: cc.total, perYear: cc.perYear, years: cc.years });
  };

  /**
   * Raw signing (used by Draft, FA, walk-ons): free agent / prospect → team with a contract. No cap or size checks.
   * New signings start at Mood 70 (design 13.1). Jersey number re-picked on a clash.
   * @param {Contract} con @returns {Result}
   */
  Roster.sign = function (L, pid, tid, con) {
    const p = Q().player(L, pid);
    const t = team(L, tid);
    if (!p) return fail('NO_PLAYER', 'Player not found.');
    if (p.tid >= 0) return fail('ON_TEAM', p.fn + ' is already on a team.');
    if (!con) return fail('NO_CONTRACT', 'A contract is needed.');
    p.tid = tid; p.con = con; p.ir = false;
    delete p.pr;
    p.mor = Math.max(p.mor, 70);
    const used = PT.League.PlayerGen.usedNums(L, tid);
    if (used[p.num] || !p.num) p.num = PT.League.PlayerGen.pickNum(PT.League.rng(L), p.pos, used);
    t.roster.push(pid);
    afterChange(L, t);
    emit('league:signed', { pid: pid, tid: tid });
    emit('league:changed', { what: 'roster' });
    return ok({ pid: pid });
  };

  /** Move a player with his contract to another team (Swaps). No checks. @returns {Result} */
  Roster.transfer = function (L, pid, toTid) {
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return fail('NOT_ON_TEAM', 'That player is not on a team.');
    if (p.tid === toTid) return ok();
    const from = L.teams[p.tid], to = team(L, toTid);
    detach(L, from, pid);
    p.tid = toTid; p.ir = false;
    const used = PT.League.PlayerGen.usedNums(L, toTid);
    if (used[p.num]) p.num = PT.League.PlayerGen.pickNum(PT.League.rng(L), p.pos, used);
    to.roster.push(pid);
    afterChange(L, from); afterChange(L, to);
    emit('league:changed', { what: 'roster' });
    return ok();
  };

  /**
   * Hurt List (design 2.2): only players with ≥ 4 weeks out. Off the list needs an open roster spot.
   * Delegates to WP2 Injuries.setIR when present (same rules).
   * @param {boolean} on @returns {Result}
   */
  Roster.setIR = function (L, pid, on) {
    const I = PT.League.Injuries;
    if (I && typeof I.setIR === 'function' && !I.setIR.__stub) return I.setIR(L, pid, on);              // WP2 owns the Hurt List rules
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return fail('NOT_ON_TEAM', 'That player is not on a team.');
    const t = L.teams[p.tid];
    if (on) {
      if (p.ir) return ok();
      if (!p.inj || p.inj.w < C.ROSTER.IR_MIN_WEEKS) return fail('NOT_HURT_ENOUGH', 'Only players out ' + C.ROSTER.IR_MIN_WEEKS + '+ weeks can go on the Hurt List.');
      p.ir = true;
    } else {
      if (!p.ir) return ok();
      if (Q().active(L, t.id).length >= Roster.limit(L)) return fail('ROSTER_FULL', 'No open roster spot.');
      p.ir = false;
    }
    afterChange(L, t);
    emit('league:changed', { what: 'roster' });
    return ok();
  };

  // ---------------- validation ----------------
  /** 'LB (Chaser)' / 'LBs (Chasers)': the position code everyone else uses, with the kid word (HUNT-league #4) */
  const AN = { RB: 1, OL: 1, LB: 1, S: 1 };                   // "an R-B", "an O-L", "an L-B", "an S"
  function posLabel(pos, many) {
    if (pos === 'QB') return many ? 'QBs' : 'QB';
    const w = POS_WORD[pos];
    return pos + (many ? 's' : '') + ' (' + (many ? (w === 'Safety' ? 'Safeties' : w + 's') : w) + ')';
  }
  const POS_WORD = { QB: 'QB', RB: 'Runner', WR: 'Catcher', TE: 'Big Catcher', OL: 'Blocker', DL: 'Smasher', LB: 'Chaser',
    CB: 'Cover', S: 'Safety', K: 'Kicker' };

  /** healthy players able to fill a position minimum (natural position incl. earned alt positions) */
  Roster.countHealthy = function (L, tid, pos) {
    return Q().roster(L, tid).filter((p) => healthy(p) && natural(p, pos)).length;
  };

  /**
   * Roster legality (design 2.2): position minimums (healthy), 16 healthy players, size limit (Hurt List excluded).
   * @param {{max?:number}} [o] override the size limit (Calendar uses 22 at "Start Season!")
   * @returns {{ok:boolean, errors:{code:string, msg:string, pos?:string, n?:number}[]}}
   */
  Roster.validate = function (L, tid, o) {
    o = o || {};
    const pl = Q().roster(L, tid);
    const errors = [];
    const used = {};
    // a player counts toward one position minimum (natural pos first, then earned alt)
    const have = {};
    Object.keys(C.ROSTER.NEED).forEach((pos) => { have[pos] = 0; });
    const hp = pl.filter(healthy);
    hp.forEach((p) => { if (have[p.pos] != null) { have[p.pos]++; used[p.id] = true; } });
    Object.keys(C.ROSTER.NEED).forEach((pos) => {
      const need = C.ROSTER.NEED[pos];
      hp.forEach((p) => {
        if (have[pos] >= need || !p.alt || p.alt.indexOf(pos) < 0) return;
        if (have[p.pos] > C.ROSTER.NEED[p.pos]) { have[p.pos]--; have[pos]++; }
      });
      if (have[pos] < need) {
        const n = need - have[pos];
        errors.push({ code: 'TOO_FEW_' + pos, pos: pos, n: n,
          msg: n === 1 ? 'Need ' + (AN[pos] ? 'an ' : 'a ') + posLabel(pos, false) + '.' : 'Need ' + n + ' more ' + posLabel(pos, true) + '.' });
      }
    });
    if (!errors.length && hp.length < C.ROSTER.MIN_PLAY) {
      errors.push({ code: 'TOO_FEW_PLAYERS', n: C.ROSTER.MIN_PLAY - hp.length, msg: 'Need ' + C.ROSTER.MIN_PLAY + ' healthy players.' });
    }
    const max = o.max || Roster.limit(L);
    const active = pl.filter((p) => !p.ir).length;
    if (active > max) errors.push({ code: 'TOO_MANY', n: active - max, msg: 'Too many players. Cut ' + (active - max) + '.' });
    return { ok: errors.length === 0, errors: errors };
  };

  // ---------------- value / cuts ----------------
  /** design 17.4 player value (no contract penalty) */
  Roster.value = function (L, p) {
    const a = p.age;
    const ageF = a <= 24 ? 1.25 : a <= 27 ? 1.10 : a <= 29 ? 1.0 : a <= 31 ? 0.70 : 0.40;
    const posF = p.pos === 'QB' ? 1.5 : p.pos === 'K' ? 0.4 : 1.0;
    const gF = a <= 25 ? ({ 'A+': 1.3, A: 1.2, B: 1.0, C: 0.9, D: 0.8 }[p.gl] || 1) : 1;
    return Math.pow(Math.max(0, p.ovr - 50), 1.8) * ageF * posF * gF;
  };

  function posCounts(L, tid) {
    const cnt = {};
    C.POS.forEach((pos) => { cnt[pos] = 0; });
    Q().roster(L, tid).forEach((p) => { if (!p.ir) cnt[p.pos]++; });
    return cnt;
  }
  function isStarter(t, pid) { return !!Roster.startsAt(t, pid); }

  /**
   * Pick the next cut (design 17.5): lowest value / max(pay, $0.5M) at a position above the template count
   * (else above the minimum), never below minimums; starters last; ties → lower Cut Cost.
   */
  Roster.nextCut = function (L, tid, exclude) {
    const t = L.teams[tid];
    const cnt = posCounts(L, tid);
    const act = Q().active(L, tid).filter((p) => !(exclude && exclude[p.id]));
    // INT: never cut a healthy player at a position that is at its healthy minimum (injured players count in cnt,
    // so "Fix it for me" used to cut the walk-on it had just signed and loop on "Need a Blocker!")
    const hcnt = {};
    C.POS.forEach((pos) => { hcnt[pos] = 0; });
    act.forEach((p) => { if (healthy(p)) hcnt[p.pos]++; });
    const safe = (p) => !healthy(p) || hcnt[p.pos] > C.ROSTER.NEED[p.pos];
    let cands = act.filter((p) => cnt[p.pos] > C.ROSTER.TEMPLATE[p.pos] && safe(p));
    if (!cands.length) cands = act.filter((p) => cnt[p.pos] > C.ROSTER.NEED[p.pos] && safe(p));
    if (!cands.length) return null;
    const score = (p) => Roster.value(L, p) / Math.max((p.con ? p.con.sal : 0) / 1000, 0.5) + (isStarter(t, p.id) ? 1e6 : 0);
    cands.sort((a, b) => (score(a) - score(b)) || (Roster.cutCost(L, a.id).total - Roster.cutCost(L, b.id).total) || (a.id - b.id));
    return cands[0];
  }

  /** Cut players until the active roster fits max (default limit). @returns {number[]} cut pids */
  Roster.cutToMax = function (L, tid, max) {
    max = max || Roster.limit(L);
    const cut = [];
    let guard = 40;
    while (Q().active(L, tid).length > max && guard-- > 0) {
      const p = Roster.nextCut(L, tid);
      if (!p) break;
      Roster.release(L, p.id);
      cut.push(p.id);
    }
    return cut;
  };

  /**
   * Plan for "Fix it for me" (design 2.2) without changing anything:
   * walk-ons for every missing position minimum, then cuts if the roster would go over the limit.
   * @returns {{sign:string[], cut:{pid:number, cost:number}[]}}
   */
  Roster.fixPlan = function (L, tid, o) {
    o = o || {};
    const v = Roster.validate(L, tid, o);
    const sign = [];
    v.errors.forEach((e) => {
      if (e.pos) for (let i = 0; i < e.n; i++) sign.push(e.pos);
      else if (e.code === 'TOO_FEW_PLAYERS') for (let i = 0; i < e.n; i++) sign.push(lowestDepthPos(L, tid));
    });
    const max = o.max || Roster.limit(L);
    let over = Q().active(L, tid).length + sign.length - max;
    const cut = [];
    const ex = {};
    while (over > 0) {
      const p = Roster.nextCut(L, tid, ex);
      if (!p) break;
      ex[p.id] = true;
      cut.push({ pid: p.id, cost: Roster.cutCost(L, p.id).total });
      over--;
    }
    return { sign: sign, cut: cut };
  };
  function lowestDepthPos(L, tid) {
    const cnt = posCounts(L, tid);
    return Object.keys(C.ROSTER.TEMPLATE).sort((a, b) => (cnt[a] - C.ROSTER.TEMPLATE[a]) - (cnt[b] - C.ROSTER.TEMPLATE[b]))[0];
  }

  /**
   * Sign a walk-on (design 2.2): generated FA at pos, OVR 45–55, minimum pay, 1 year. @returns {Result} {pid}
   */
  Roster.walkOn = function (L, tid, pos) {
    if (!C.OVR_W[pos]) return fail('BAD_POS', 'Pick a position.');
    const p = PT.League.PlayerGen.walkOn(L, pos);
    PT.League.addPlayer(L, p);
    const s = Roster.capSeason(L);
    const con = { sal: PT.League.PlayerGen.minPay(PT.League.Cap.cap(L)), exp: s, sgn: L.season, rk: false, gtd: C.CAP.CUT_PCT };
    return Roster.sign(L, p.id, tid, con);
  };

  /**
   * "Fix it for me": apply fixPlan (cuts first, then walk-ons). AI option useFA: sign the best leftover free agent at
   * the position for minimum pay instead of a walk-on when one exists (design 17.3 in-season rule).
   * @returns {{ok:boolean, signed:number[], cut:number[]}}
   */
  Roster.fixIt = function (L, tid, o) {
    o = o || {};
    const plan = Roster.fixPlan(L, tid, o);
    const cut = [], signed = [];
    plan.cut.forEach((c) => { if (Roster.release(L, c.pid).ok) cut.push(c.pid); });
    plan.sign.forEach((pos) => {
      let r = null;
      if (o.useFA) {
        const fa = Q().freeAgents(L).filter((p) => p.pos === pos && healthy(p)).sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id))[0];
        if (fa) {
          const con = { sal: PT.League.PlayerGen.minPay(PT.League.Cap.cap(L)), exp: Roster.capSeason(L), sgn: L.season, rk: false, gtd: C.CAP.CUT_PCT };
          r = Roster.sign(L, fa.id, tid, con);
        }
      }
      if (!r || !r.ok) r = Roster.walkOn(L, tid, pos);
      if (r.ok) signed.push(r.pid);
    });
    return { ok: Roster.validate(L, tid, o).ok, signed: signed, cut: cut };
  };

  /** Cut lowest value-per-pay players until under the Team Cash limit. @returns {number[]} cut pids */
  Roster.fixCap = function (L, tid) {
    const cut = [];
    let guard = 30;
    while (PT.League.Cap.space(L, tid) < 0 && guard-- > 0) {
      const cnt = posCounts(L, tid);
      const t = L.teams[tid];
      const saves = (p) => p.con.sal - Roster.cutCost(L, p.id).perYear;
      let cands = Q().active(L, tid).filter((p) => p.con && cnt[p.pos] > C.ROSTER.NEED[p.pos] && saves(p) > 0);
      // QA1: every position at its minimum (e.g. over only because of Cut Costs): swap a pricey player for a min-pay
      // walk-on at his position when that still saves Team Cash, instead of giving up with the CAP blocker stuck.
      const minPay = PT.League.PlayerGen.minPay(PT.League.Cap.cap(L));
      const swap = !cands.length;
      if (swap) cands = Q().active(L, tid).filter((p) => p.con && saves(p) > minPay);
      if (!cands.length) break;
      const score = (p) => Roster.value(L, p) / Math.max(p.con.sal / 1000, 0.5) + (isStarter(t, p.id) ? 1e6 : 0);
      cands.sort((a, b) => (score(a) - score(b)) || (b.con.sal - a.con.sal) || (a.id - b.id));
      const pos = cands[0].pos;
      Roster.release(L, cands[0].id);
      cut.push(cands[0].id);
      if (swap) Roster.walkOn(L, tid, pos);
    }
    return cut;
  };

  /** AI before a game week: fill minimums from free agents, fit the limit, Auto Lineup. */
  Roster.ensurePlayable = function (L, tid) {
    const v = Roster.validate(L, tid);
    if (!v.ok) Roster.fixIt(L, tid, { useFA: true });
    Roster.autoDepth(L, tid, { silent: true });
  };

  /**
   * After a game: count starts in non-natural slots (R5). 4 starts at a position make it an extra natural position.
   * @param {Object<string,number[]>} dc the lineup used (slot → [starter,…]) @returns {string[]} 'pid:POS' newly earned
   */
  Roster.recordStarts = function (L, dc) {
    const earned = [];
    C.SLOTS.forEach((slot) => {
      if (slot === 'KR' || !dc[slot] || dc[slot][0] == null) return;
      const p = Q().player(L, dc[slot][0]);
      const pos = C.SLOT_POS[slot];
      if (!p || natural(p, pos)) return;
      p.sg[pos] = (p.sg[pos] || 0) + 1;
      if (p.sg[pos] >= C.NEW_POS_STARTS) { p.alt.push(pos); delete p.sg[pos]; earned.push(p.id + ':' + pos); }
    });
    return earned;
  };
})(globalThis.PT = globalThis.PT || {});
