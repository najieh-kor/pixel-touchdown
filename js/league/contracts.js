/* Pixel Touchdown: js/league/contracts.js
 * Owner: WP2. Responsibility: PT.League.Contracts: asks, re-sign, extensions, expiry, morale effect (design 10.4, 10.5).
 * Contract { sal $K, exp last season covered, sgn, rk, gtd }. Offseason signings (Keep/Draft/Market) start next season:
 * exp = season + yrs. In-season signings: exp = season + yrs − 1.
 * Also exports the shared roster helpers Contracts.attach / Contracts.detach (no Cut Cost) used by WP2 modules.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Con = PT.ns('League.Contracts');
  const Q = () => PT.League.Q;
  const Cap = () => PT.League.Cap;
  const H = () => PT.League.History;

  const PERS = { money: 1.20, fame: 1.05, wins: 1.00, home: 0.85, chill: 0.95 };
  const NUMS = { QB: [[1, 19]], K: [[1, 19]], WR: [[10, 19], [80, 89]], TE: [[80, 89]], RB: [[20, 49]], CB: [[20, 49]],
    S: [[20, 49]], LB: [[40, 59], [90, 99]], OL: [[50, 79]], DL: [[50, 79], [90, 99]] };

  // ---------------- shared roster helpers ----------------

  /** Make sure no pid starts in two field slots after a removal (subs move up). */
  function repairDepth(t) {
    const started = {};
    for (const s of C.SLOTS) {
      if (s === 'KR' || !t.dc[s]) continue;
      const list = t.dc[s];
      const i = list.findIndex((pid) => !started[pid]);
      if (i < 0) { t.dc[s] = []; continue; }
      if (i > 0) { const pid = list[i]; list.splice(i, 1); list.unshift(pid); }
      started[list[0]] = 1;
    }
  }
  Con.repairDepth = repairDepth;

  /**
   * Remove a player from his team WITHOUT Cut Cost (expiry, retirement, swap). Clears lineup spots and captaincy.
   * The player keeps p.con (caller decides). @returns {number} old tid
   */
  Con.detach = function (L, pid) {
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return -1;
    const t = L.teams[p.tid];
    t.roster = t.roster.filter((x) => x !== pid);
    for (const s of Object.keys(t.dc)) t.dc[s] = t.dc[s].filter((x) => x !== pid);
    if (t.capt === pid) t.capt = null;
    repairDepth(t);
    p.ir = false;
    if (p.ph) delete p.ph;
    if (p.inj && p.inj.ph) delete p.inj.ph;      // QA1: Play Hurt is a per-team choice
    const old = p.tid;
    p.tid = C.TID.FA;
    return old;
  };

  /** Pick a free jersey number for pos on team tid (never a retired number, design 4.6 / 14.10). */
  Con.freeNum = function (L, tid, pos, prefer) {
    const used = {};
    for (const pid of L.teams[tid].roster) { const q = Q().player(L, pid); if (q) used[q.num] = 1; }
    for (const n of (L.retNums[tid] || [])) used[n] = 1;
    if (prefer != null && !used[prefer] && prefer >= 0 && prefer <= 99) return prefer;
    for (const r of NUMS[pos] || [[1, 99]]) for (let n = r[0]; n <= r[1]; n++) if (!used[n]) return n;
    for (let n = 1; n <= 99; n++) if (!used[n]) return n;
    return 0;
  };

  /**
   * Put a player on a team with a contract (no Cut Cost, never a retired number). Lineups: in season AI teams (and the
   * user with Auto Lineup) re-run Auto Lineup, otherwise only empty slots are filled; in the offseason lineups are left
   * alone (AIGM.preseason / WP1 rebuild them before Week 1). @returns {Result}
   */
  Con.attach = function (L, pid, tid, con) {
    const p = Q().player(L, pid);
    if (!p) return { ok: false, err: 'NO_PLAYER', msg: 'Player not found.' };
    if (p.tid >= 0) Con.detach(L, pid);
    const want = p.num;
    if (p.pr) delete p.pr;
    p.tid = tid; p.con = con; p.ir = false;
    const t = L.teams[tid];
    if (t.roster.indexOf(pid) < 0) t.roster.push(pid);
    p.num = Con.freeNum(L, tid, p.pos, want);
    const inSeason = L.phase === 'REGULAR' || L.phase === 'PLAYOFFS' || L.phase === 'PRESEASON';
    if (inSeason) {
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, tid);
      else PT.League.Roster.autoDepth(L, tid, { onlyEmpty: true, silent: true });
    }
    return { ok: true };
  };

  /** Build a contract for the current phase (offseason deals start next season). */
  Con.make = function (L, sal, yrs, rk) {
    yrs = Math.max(1, Math.min(C.CAP.MAX_YRS, yrs | 0));
    const start = Cap().offView(L) || L.phase === 'SEASON_END' ? L.season + 1 : L.season;
    return { sal: Math.max(Cap().minPay(L), Math.round(sal / 100) * 100), exp: start + yrs - 1, sgn: L.season, rk: !!rk, gtd: C.CAP.CUT_PCT };
  };

  // ---------------- asks ----------------

  /** Years asked by age (design 10.4): ≤ 26 → 3–5 · 27–30 → 2–4 · 31+ → 1–2. */
  Con.yearsRange = function (p) { return p.age <= 26 ? [3, 5] : p.age <= 30 ? [2, 4] : [1, 2]; };

  /** The season whose results count as "last season" right now. */
  function lastSeason(L) { return Cap().offView(L) || L.phase === 'SEASON_END' ? L.season : L.season - 1; }
  Con.lastSeason = lastSeason;

  /** Wins of a team in "last season". */
  Con.lastWins = function (L, tid) {
    const s = lastSeason(L);
    if (s === L.season) { const r = PT.League.Standings.get(L).find((x) => x.tid === tid); return r ? r.w : 8.5; }
    const rec = L.teams[tid].rec.find((r) => r.s === s);
    if (rec) return rec.w;
    const hs = L.hist.seasons.find((x) => x.s === s);
    const row = hs && hs.std ? hs.std.find((r) => r[0] === tid) : null;
    return row ? row[1] : 8.5;
  };
  /** Did a team make the playoffs "last season"? */
  Con.madePlayoffs = function (L, tid) {
    const s = lastSeason(L);
    if (s === L.season) return !!(L.po && L.po.seeds && L.po.seeds.some((x) => x.indexOf(tid) >= 0));
    const rec = L.teams[tid].rec.find((r) => r.s === s);
    return !!(rec && rec.res);
  };

  /**
   * What a player wants (design 10.4/10.5). tid = asking team (default: his team, else yours).
   * @returns {{sal, yrs, lo, hi, need, req, mood:'happy'|'neutral'|'upset', verdict:'will'|'more'|'wont', willing}}
   */
  Con.ask = function (L, pid, tid) {
    const p = Q().player(L, pid);
    if (!p) throw new Error('[Contracts] no player ' + pid);
    if (tid == null) tid = p.tid >= 0 ? p.tid : L.userTid;
    const own = p.tid === tid;
    let m = PERS[p.want] || 1;
    if (p.want === 'home' && !own) m = 1.0;
    if (p.want === 'wins' && tid >= 0 && Con.madePlayoffs(L, tid)) m = 0.85;
    if (own && p.mor < 40) m *= 1.15;
    if (p.aw.some((a) => a.a === 'PRO' && a.s === lastSeason(L))) m *= 1.10;
    if (own && p.tr.indexOf('hometown_hero') >= 0) m *= 0.8;
    if (p.ak) m *= 1 + p.ak;
    const fair = Cap().fairPay(L, p);
    const sal = Math.max(Cap().minPay(L), Math.min(Cap().maxPay(L), Cap().round100(fair * m)));
    const rg = Con.yearsRange(p);
    const pr = PT.RNG.create(PT.RNG.hash(L.seed, p.id, L.season, 'yrs'));
    const yrs = pr.int(rg[0], rg[1]);
    let req = 1;
    if (own && p.mor < 30) req = 1.3;
    if (p.want === 'wins' && tid >= 0 && Con.lastWins(L, tid) < 6) req = Math.max(req, 1.2);
    if (p.want === 'home' && own) req *= 0.9;
    const need = Cap().round100(sal * req);
    const tries = (H().ss(L).kept[pid] || 0);
    const verdict = tries >= 2 || (own && p.mor < 15) ? 'wont' : req > 1.0001 ? 'more' : 'will';
    return { sal: sal, yrs: yrs, lo: rg[0], hi: rg[1], need: need, req: Math.round(req * 100) / 100,
      mood: p.mor >= 70 ? 'happy' : p.mor >= 40 ? 'neutral' : 'upset', verdict: verdict, willing: verdict !== 'wont' };
  };

  /** Expiring contracts (exp ≤ season) on a team. */
  Con.expiring = function (L, tid) {
    return Q().roster(L, tid).filter((p) => p.con && p.con.exp <= L.season);
  };

  /**
   * Offer a Keep (RESIGN phase) or an in-season extension (player in his final year). One offer per player;
   * "Ask again" (a 2nd offer) costs Mood −5. Accepts if pay ≥ need (×1.05 if years are outside his range).
   * @returns {{ok, accepted, counter?:{sal,yrs}, msg, tries}}
   */
  Con.offer = function (L, pid, o) {
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return { ok: false, err: 'NOT_ON_TEAM', msg: 'That player is not on a team.' };
    const tid = p.tid;
    const inSeason = L.phase === 'REGULAR' || L.phase === 'PRESEASON';
    if (!p.con || (inSeason ? p.con.exp !== L.season : p.con.exp > L.season)) return { ok: false, err: 'NOT_EXPIRING', msg: 'His deal is not ending yet.' };
    if (!inSeason && L.phase !== 'RESIGN') return { ok: false, err: 'NOT_NOW', msg: 'Keep players during Keep Players.' };
    const sal = Math.round((o && o.sal) || 0), yrs = Math.max(1, Math.min(C.CAP.MAX_YRS, ((o && o.yrs) || 1) | 0));
    const ss = H().ss(L);
    const tries = ss.kept[pid] || 0;
    if (tries >= 2) return { ok: true, accepted: false, msg: p.fn + ' is done talking.', tries: tries };
    if (!inSeason && Cap().space(L, tid) < sal) return { ok: false, err: 'CAP', msg: 'Not enough Team Cash.' };
    // QA1: an in-season extension replaces this season's pay right away, so the raise must fit too
    if (inSeason && sal > p.con.sal && Cap().space(L, tid) < sal - p.con.sal) return { ok: false, err: 'CAP', msg: 'Not enough Team Cash.' };
    if (tries === 1) PT.League.Spirit.addMood(L, p, -5, 'contract');
    const a = Con.ask(L, pid, tid);
    ss.kept[pid] = tries + 1;
    if (a.verdict === 'wont' && tries + 1 > 1) return { ok: true, accepted: false, msg: p.fn + ' wants a new team.', tries: tries + 1 };
    let need = a.need;
    if (yrs < a.lo || yrs > a.hi) need = Cap().round100(need * 1.05);
    if (p.mor < 15) need = Infinity;
    if (sal >= need) {
      const con = { sal: sal, exp: (inSeason ? L.season : L.season) + yrs, sgn: L.season, rk: false, gtd: C.CAP.CUT_PCT };
      const raise = sal > p.con.sal;
      p.con = con;
      if (p.ak) delete p.ak;
      PT.League.Spirit.addMood(L, p, 10, 'contract');
      if (raise && p.want === 'money') PT.League.Spirit.addMood(L, p, 5, 'contract');
      const N = PT.League.News;
      if (tid === L.userTid || p.ovr >= 80) N.add(L, 'sign', N.tpl('keep', { T: L.teams[tid].name, P: N.pname(p), N: Math.round(sal / 100) / 10 }), tid);
      if (PT.Events) { PT.Events.emit('league:signed', { pid: pid, tid: tid }); PT.Events.emit('league:changed', { what: 'contract' }); }
      return { ok: true, accepted: true, msg: p.fn + ' says yes. Deal done.', tries: tries + 1 };
    }
    const counter = isFinite(need) ? { sal: need, yrs: a.yrs } : undefined;
    return { ok: true, accepted: false, counter: counter, tries: tries + 1,
      msg: tries + 1 >= 2 ? p.fn + ' said no.' : p.fn + ' wants ' + PT.Util.fmtMoney(need) + ' a year.' };
  };

  /** In-season extension (P1): same rules, final-year players only. */
  Con.extend = function (L, pid, o) { return Con.offer(L, pid, o); };

  /**
   * Auto Keep (design 10.5): keep every player whose OVR ≥ his position's starter OVR on your roster − 3 if the Ask fits,
   * highest OVR first. @returns {{kept:number[], skipped:number[]}}
   */
  Con.autoKeep = function (L, tid) {
    if (tid == null) tid = L.userTid;
    const kept = [], skipped = [];
    const list = Con.expiring(L, tid).sort((a, b) => b.ovr - a.ovr);
    for (const p of list) {
      const st = starterOvr(L, tid, p.pos, p.id);
      const a = Con.ask(L, p.id, tid);
      if (p.ovr >= st - 3 && a.verdict !== 'wont' && Cap().space(L, tid) >= a.need) {
        const r = Con.offer(L, p.id, { sal: a.need, yrs: Math.max(a.lo, Math.min(a.hi, a.yrs)) });
        if (r.accepted) { kept.push(p.id); continue; }
      }
      skipped.push(p.id);
    }
    return { kept: kept, skipped: skipped };
  };

  /**
   * The bar to clear at pos: the WEAKEST current starter there (HUNT5 #1: comparing to the best one let CB2/QB starters
   * walk). If `exclude` is himself a starter he always clears it (returns 0). Used by Auto Keep, AI keeps, draft needs,
   * Market "would start" and AI bids. 0 when nobody starts there (then the best player at pos, as a fallback).
   */
  function starterOvr(L, tid, pos, exclude) {
    const t = L.teams[tid];
    if (exclude != null) for (const s of C.SLOTS) if (s !== 'KR' && t.dc[s] && t.dc[s][0] === exclude) return 0;
    let low = Infinity;
    for (const s of C.SLOTS) {
      if (C.SLOT_POS[s] !== pos || !t.dc[s]) continue;
      const pid = t.dc[s][0];
      if (pid == null || pid === exclude) continue;
      const p = Q().player(L, pid);
      if (p) low = Math.min(low, p.ovr);
    }
    if (low !== Infinity) return low;
    let best = 0;
    for (const p of Q().roster(L, tid)) if (p.pos === pos && p.id !== exclude) best = Math.max(best, p.ovr);
    return best;
  }
  Con.starterOvr = starterOvr;

  /**
   * Raise a current contract by pct (event "Pay Me More"). Needs Team Cash room. @returns {Result}
   */
  Con.raise = function (L, pid, pct) {
    const p = Q().player(L, pid);
    if (!p || !p.con || p.tid < 0) return { ok: false, err: 'NO_CONTRACT', msg: 'No contract.' };
    const add = Cap().round100(p.con.sal * pct / 100);
    if (Cap().space(L, p.tid) < add) return { ok: false, err: 'CAP', msg: 'Not enough Team Cash.' };
    p.con.sal += add;
    if (p.want === 'money') PT.League.Spirit.addMood(L, p, 5, 'contract');
    return { ok: true, add: add };
  };

  // ---------------- phase hooks ----------------

  /** Enter RESIGN: AI teams decide now (design 17.5); the human team gets asks on demand. */
  Con.beginResign = function (L) {
    H().ss(L);
    for (const t of L.teams) if (!t.human) PT.League.AIGM.resign(L, t.id);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'resign' });
  };

  /**
   * Enter DRAFT: every unkept expiring player goes to the Market (no Cut Cost). Former team remembered in p.ft.
   * @returns {number[]} pids
   */
  Con.expireUnsigned = function (L) {
    const out = [];
    for (const t of L.teams) {
      for (const p of Con.expiring(L, t.id)) {
        Con.detach(L, p.id);
        p.con = null; p.ft = t.id;
        out.push(p.id);
      }
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
    }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'expire' });
    return out;
  };

  /** Rollover (season already +1): drop old Cut Costs, release any stale deal (safety). */
  Con.rollover = function (L) {
    for (const t of L.teams) {
      t.dead = t.dead.filter((d) => d.s >= L.season);
      for (const p of Q().roster(L, t.id)) {
        if (p.con && p.con.exp < L.season) { Con.detach(L, p.id); p.con = null; p.ft = t.id; }
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
