/* Pixel Touchdown: js/league/fantasy.js
 * Owner: WP1 (first written by FEATURES). Responsibility: PT.League.Fantasy: "Start fresh: everyone drafts!" — the
 * fantasy draft of the 8 Star players (client change after ROUND6 D).
 *
 * At a brand-new franchise (REGULAR week 1 with no game played; old saves: PRESEASON sub 0) every rostered player and
 * every free agent goes into one pool. All 32 teams snake-draft C.STAR_MAX (8) rounds; every pick becomes one of that
 * team's 8 Stars. The Star rule is enforced while drafting: no K, and when a team's remaining picks must cover a side
 * (≥ C.STAR_MIN_SIDE = 2 offense QB/RB/WR/TE/OL and 2 defense DL/LB/CB/S) only that side can be picked — the user
 * gets a short reason, the AI obeys it too. The user picks on the clock; "Auto Pick", "Sim to my pick" and
 * "Auto-draft rest" use the AI logic (best OVR that fits the rule).
 * After round 8 every roster is AUTO-FILLED with normal (non-Star) players from the pool to a legal 22-man roster
 * (position minimums first, then the 22-man template, value by fit), deals for free agents, pay scaled under the cap
 * (the League.create rule), Auto Lineup and a captain. Normal players change later through the Market / Swaps.
 *
 * State (persisted, compact): L.fd = { n:rounds, order:[32 tids, round 1], pool:[pid…], picks:[pid…] (overall order),
 *   done:false } → after the draft { done:true, mine:[pid…] (the user's 8 Stars) }.
 * Calendar.status shows only the {k:'FANTASY'} blocker while L.fd exists and is not done; Auto.resolve(FANTASY) = autoRest.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Fantasy = PT.ns('League.Fantasy');
  const LG = () => PT.League;
  const ok = (o) => Object.assign({ ok: true }, o || {});
  const fail = (err, msg) => ({ ok: false, err: err, msg: msg });
  const MIN = () => C.STAR_MIN_SIDE || 2;
  const side = (p) => LG().Roster.starSide(p);

  /** @param {League} L @returns {boolean} a fantasy draft is running */
  Fantasy.active = function (L) { return !!(L && L.fd && !L.fd.done); };

  /** @param {League} L @returns {boolean} the league can still start one (season start, nothing played) */
  Fantasy.canBegin = function (L) {
    if (!L || L.fd || L.sched.some((g) => g.st !== 'S')) return false;
    return (L.phase === C.PHASE.REGULAR && L.week === 1) || (L.phase === C.PHASE.PRESEASON && L.sub === 0);
  };

  /** rounds of the Star draft */
  Fantasy.ROUNDS = C.STAR_MAX || 8;

  /**
   * Empty every roster into the pool and set up the snake order.
   * @param {League} L @returns {Result} {pool, total}
   */
  Fantasy.begin = function (L) {
    if (!Fantasy.canBegin(L)) return fail('NOT_NOW', 'The Star Draft is for new franchises only.');
    const rng = LG().rng(L);
    const pool = [];
    L.teams.forEach((t) => {
      t.roster.forEach((pid) => {
        const p = LG().Q.player(L, pid);
        if (!p) return;
        p.tid = C.TID.FA; p.ir = false;
        pool.push(pid);
      });
      t.roster = [];
      C.SLOTS.forEach((s) => { t.dc[s] = []; });
      t.capt = null; t.stars = [];
    });
    LG().Q.freeAgents(L).forEach((p) => { if (pool.indexOf(p.id) < 0) pool.push(p.id); });
    const order = L.teams.map((t) => t.id);
    rng.shuffle(order);
    L.fd = { n: Fantasy.ROUNDS, order: order, pool: pool, picks: [], done: false };
    LG().emit('league:changed', { what: 'fantasy' });
    return ok({ pool: pool.length, total: Fantasy.total(L) });
  };

  /** @returns {number} picks in the whole Star draft */
  Fantasy.total = function (L) {
    const fd = L.fd;
    if (!fd || fd.done) return 0;
    return fd.n * fd.order.length;
  };

  /** @returns {number} team on the clock at overall pick index i (snake) */
  Fantasy.tidAt = function (L, i) {
    const o = L.fd.order, n = o.length, rd = Math.floor(i / n), k = i % n;
    return rd % 2 === 0 ? o[k] : o[n - 1 - k];
  };

  /** pids a team drafted so far */
  function teamPicks(L, tid) {
    const fd = L.fd, out = [];
    for (let i = 0; i < fd.picks.length; i++) if (Fantasy.tidAt(L, i) === tid) out.push(fd.picks[i]);
    return out;
  }

  /** Star-side state of a team: counts, picks left (incl. the current one), sides that must be picked now. */
  Fantasy.sideNeed = function (L, tid) {
    const mine = teamPicks(L, tid);
    const c = { off: 0, def: 0 };
    mine.forEach((pid) => { const p = LG().Q.player(L, pid); const sd = p && side(p); if (sd) c[sd]++; });
    const left = Math.max(0, L.fd.n - mine.length);
    const miss = { off: Math.max(0, MIN() - c.off), def: Math.max(0, MIN() - c.def) };
    const must = left > 0 && left <= miss.off + miss.def ? ['off', 'def'].filter((sd) => miss[sd] > 0) : null;
    return { off: c.off, def: c.def, left: left, need: MIN(), must: must };
  };

  /**
   * Can this team draft this player as a Star now? @returns {{ok:boolean, why?:string}}
   */
  Fantasy.allowed = function (L, tid, p) {
    if (!p) return { ok: false, why: 'Player not found.' };
    if (L.fd.pool.indexOf(p.id) < 0) return { ok: false, why: 'Already taken.' };
    const sd = side(p);
    if (!sd) return { ok: false, why: 'A Kicker cannot be a Star.' };
    const n = Fantasy.sideNeed(L, tid);
    if (n.must && n.must.indexOf(sd) < 0) {
      const w = n.must[0] === 'off' ? 'an offense' : 'a defense';
      return { ok: false, why: 'Pick ' + w + ' Star: you need ' + MIN() + '.' };
    }
    return { ok: true };
  };

  /**
   * Where the draft is. @param {League} L
   * @returns {{active, done, total, made, rounds, pick:{rd, pk, overall, tid}|null, userOnClock, userLeft,
   *   recent:{pk, tid, pid}[], need:{off, def, left, need, must:(string[]|null)}, why:(string|null), mine:number[]}}
   */
  Fantasy.status = function (L) {
    const fd = L && L.fd;
    const base = { rounds: Fantasy.ROUNDS, recent: [], need: {}, why: null };
    if (!fd) return Object.assign(base, { active: false, done: false, total: 0, made: 0, pick: null, userOnClock: false, userLeft: 0, mine: [] });
    if (fd.done) return Object.assign(base, { active: false, done: true, total: (fd.mine || []).length, made: (fd.mine || []).length, pick: null, userOnClock: false, userLeft: 0, mine: (fd.mine || []).slice() });
    const total = Fantasy.total(L), i = fd.picks.length, n = fd.order.length;
    const pick = i < total ? { rd: Math.floor(i / n) + 1, pk: (i % n) + 1, overall: i + 1, tid: Fantasy.tidAt(L, i) } : null;
    let userLeft = 0;
    for (let j = i; j < total; j++) if (Fantasy.tidAt(L, j) === L.userTid) userLeft++;
    const recent = [];
    for (let j = i - 1; j >= 0 && recent.length < 8; j--) recent.push({ pk: j + 1, tid: Fantasy.tidAt(L, j), pid: fd.picks[j] });
    const need = Fantasy.sideNeed(L, L.userTid);
    const why = need.must ? 'Pick ' + (need.must[0] === 'off' ? 'an offense' : 'a defense') + ' Star: you need ' + MIN() + '.' : null;
    return Object.assign(base, { active: true, done: false, total: total, made: i, pick: pick, userOnClock: !!pick && pick.tid === L.userTid,
      userLeft: userLeft, recent: recent, need: need, why: why, mine: teamPicks(L, L.userTid) });
  };

  /** @returns {Object} pos → {have, need, want} for a team's roster (need = NEED minimum, want = 22-man template) */
  Fantasy.needs = function (L, tid) {
    const pids = L.fd && !L.fd.done ? teamPicks(L, tid) : (L.teams[tid].roster || []);
    const c = countPos(L, pids);
    const out = {};
    C.POS.forEach((p) => { out[p] = { have: c[p], need: C.ROSTER.NEED[p] || 0, want: C.ROSTER.TEMPLATE[p] || 0 }; });
    return out;
  };
  function countPos(L, pids) {
    const c = {};
    C.POS.forEach((p) => { c[p] = 0; });
    pids.forEach((pid) => { const p = LG().Q.player(L, pid); if (p) c[p.pos]++; });
    return c;
  }

  /**
   * The pool for the Star draft, best OVR first. Each row says if the team on the clock may pick him now (ok / why)
   * and marks good Star candidates (top: OVR rank inside the picks still to come; never a K).
   * @param {League} L @param {{pos?:string, tid?:number}} [o] @returns {{p:Player, rank:number, ok:boolean, why:(string|null), top:boolean}[]}
   */
  Fantasy.board = function (L, o) {
    if (!Fantasy.active(L)) return [];
    o = o || {};
    const st = Fantasy.status(L);
    const tid = o.tid != null ? o.tid : st.pick ? st.pick.tid : L.userTid;
    const left = st.total - st.made;
    const list = L.fd.pool.map((pid) => LG().Q.player(L, pid)).filter(Boolean)
      .sort((a, b) => (b.ovr - a.ovr) || (a.age - b.age) || (a.id - b.id));
    let k = 0;
    const rows = list.map((p, i) => {
      const a = Fantasy.allowed(L, tid, p);
      const cand = !!side(p);
      if (cand) k++;
      return { p: p, rank: i + 1, ok: a.ok, why: a.ok ? null : a.why, top: cand && k <= left };
    });
    return o.pos ? rows.filter((x) => x.p.pos === o.pos) : rows;
  };

  /** AI Star pick: best OVR that fits the rule (a QB gets a small bump, older players a small cut). @returns {number|null} */
  /** starting spots per position in the lineup (QB 1, RB 1, WR 2, TE 1, OL 2, DL 2, LB 2, CB 2, S 1). HUNT6-flow #1 */
  Fantasy.starters = function (pos) {
    let n = 0;
    (C.OFF_SLOTS || []).concat(C.DEF_SLOTS || []).forEach((s) => { if (C.SLOT_POS[s] === pos) n++; });
    return n;
  };
  Fantasy.choose = function (L, tid) {
    const fd = L.fd;
    if (!Fantasy.active(L) || !fd.pool.length) return null;
    const rng = LG().rng(L);
    // HUNT6-flow #1: a Star beyond the position's starting spots sits on the bench → strongly prefer an open spot
    const have = {};
    teamPicks(L, tid).forEach((pid) => { const q = LG().Q.player(L, pid); if (q) have[q.pos] = (have[q.pos] || 0) + 1; });
    let best = null, bv = -1e9;
    for (const pid of fd.pool) {
      const p = LG().Q.player(L, pid);
      if (!p || !Fantasy.allowed(L, tid, p).ok) continue;
      let v = p.ovr + (p.pos === 'QB' ? 3 : 0) - (p.age >= 31 ? (p.age - 30) * 0.8 : 0) + rng.range(-1.5, 1.5);
      if ((have[p.pos] || 0) >= Fantasy.starters(p.pos)) v -= 40;
      if (v > bv) { bv = v; best = pid; }
    }
    return best;
  };

  function take(L, pid) {
    const fd = L.fd, i = fd.picks.length;
    const tid = Fantasy.tidAt(L, i);
    const k = fd.pool.indexOf(pid);
    if (k < 0) return null;
    fd.pool.splice(k, 1);
    fd.picks.push(pid);
    LG().emit('league:draftPick', { tid: tid, pid: pid, pk: i + 1, fantasy: true });
    if (fd.picks.length >= Fantasy.total(L)) finish(L);
    return tid;
  }

  /** The user's Star pick (must be on the clock and fit the rule). @returns {Result} */
  Fantasy.pick = function (L, pid) {
    const st = Fantasy.status(L);
    if (!st.active) return fail('NO_DRAFT', 'The draft is over.');
    if (!st.userOnClock) return fail('NOT_YOUR_PICK', 'It is not your pick yet.');
    const a = Fantasy.allowed(L, L.userTid, LG().Q.player(L, pid));
    if (!a.ok) return fail(a.why === 'Already taken.' ? 'TAKEN' : 'NOT_ALLOWED', a.why);
    take(L, pid);
    LG().emit('league:changed', { what: 'fantasy' });
    return ok({ pid: pid });
  };

  /** AI picks until the user is on the clock (or the end). @returns {{picks:number, userOnClock:boolean}} */
  Fantasy.simToUser = function (L) {
    let n = 0;
    while (Fantasy.active(L)) {
      const tid = Fantasy.tidAt(L, L.fd.picks.length);
      if (tid === L.userTid) break;
      take(L, Fantasy.choose(L, tid));
      n++;
    }
    LG().emit('league:changed', { what: 'fantasy' });
    return { picks: n, userOnClock: Fantasy.status(L).userOnClock };
  };

  /** Everyone (the user too) picks with the AI logic until the draft is done. @returns {{picks:number}} */
  Fantasy.autoRest = function (L) {
    let n = 0;
    while (Fantasy.active(L)) { take(L, Fantasy.choose(L, Fantasy.tidAt(L, L.fd.picks.length))); n++; }
    LG().emit('league:changed', { what: 'fantasy' });
    return { picks: n };
  };

  /** fill value of a normal player for a team (position needs first, then the 22-man template, value by fit) */
  function fillValue(p, cnt) {
    const pos = p.pos, need = C.ROSTER.NEED[pos] || 0, want = C.ROSTER.TEMPLATE[pos] || 0, have = cnt[pos];
    let v = p.ovr;
    if (p.age <= 25) v += 1; else if (p.age >= 31) v -= (p.age - 30) * 0.8;
    if (have < need) v += 40;                                  // minimums first
    else if (have < want) v += 10;
    else v -= 25 + 10 * (have - want);
    if (pos === 'K' && have >= 1) v -= 60;
    return v;
  }

  /** After the Star rounds: Stars + normal players → legal 22-man rosters under the cap, lineups, captains. */
  function finish(L) {
    const fd = L.fd;
    const rng = LG().rng(L);
    const PG = LG().PlayerGen;
    const cap = LG().Cap && LG().Cap.cap ? LG().Cap.cap(L) : C.CAP.BASE;
    const max = C.ROSTER.MAX_SEASON;
    const stars = {}, members = {};
    L.teams.forEach((t) => { stars[t.id] = []; members[t.id] = []; });
    fd.picks.forEach((pid, i) => { const tid = Fantasy.tidAt(L, i); stars[tid].push(pid); members[tid].push(pid); });
    // auto-fill: continue the snake with normal players until every team has 22 (minimums guaranteed)
    const n = fd.order.length;
    const pool = fd.pool.map((pid) => LG().Q.player(L, pid)).filter(Boolean);
    for (let rd = fd.n; rd < max; rd++) {
      for (let k = 0; k < n; k++) {
        const tid = rd % 2 === 0 ? fd.order[k] : fd.order[n - 1 - k];
        if (members[tid].length >= max || !pool.length) continue;
        const cnt = countPos(L, members[tid]);
        const left = max - members[tid].length;
        const unmet = C.POS.filter((pos) => cnt[pos] < (C.ROSTER.NEED[pos] || 0));
        const missing = unmet.reduce((s, pos) => s + (C.ROSTER.NEED[pos] - cnt[pos]), 0);
        const must = left <= missing ? unmet : null;
        let bi = -1, bv = -1e9;
        pool.forEach((p, i) => {
          if (must && must.indexOf(p.pos) < 0) return;
          const v = fillValue(p, cnt) + rng.range(-1, 1);
          if (v > bv) { bv = v; bi = i; }
        });
        if (bi < 0) bi = 0;
        members[tid].push(pool[bi].id);
        pool.splice(bi, 1);
      }
    }
    const mine = stars[L.userTid].slice();
    L.teams.forEach((t) => {
      t.roster = [];
      members[t.id].forEach((pid) => {
        const p = LG().Q.player(L, pid);
        if (!p) return;
        if (!p.con) {
          const yrs = rng.int(1, 3);
          const sal = Math.round(PG.fairPay(L, p, cap) / 100) * 100;
          p.con = { sal: Math.max(PG.minPay(cap), Math.min(sal, Math.round(cap * C.CAP.MAX_PCT))), exp: L.season + yrs - 1, sgn: L.season, rk: false, gtd: C.CAP.CUT_PCT };
        }
        const used = PG.usedNums(L, t.id);
        p.tid = t.id; p.ir = false;
        if (used[p.num] || !p.num) p.num = PG.pickNum(rng, p.pos, used);
        t.roster.push(pid);
      });
      t.stars = stars[t.id].slice();
    });
    pool.forEach((p) => { p.tid = C.TID.FA; p.con = null; p.ir = false; });
    L.teams.forEach((t) => {
      const ps = t.roster.map((pid) => LG().Q.player(L, pid)).filter(Boolean);
      const pay = ps.reduce((s, p) => s + p.con.sal, 0);
      if (pay > cap * 0.97) ps.forEach((p) => { p.con.sal = Math.max(PG.minPay(cap), Math.floor(p.con.sal * cap * 0.95 / pay / 100) * 100); });
      LG().Roster.autoDepth(L, t.id, { silent: true });
      LG().TeamGen.pickCaptain(L, t);
    });
    try { LG().TeamGen.setModes(L); } catch (e) { /* optional */ }
    L.fd = { done: true, mine: mine };
    if (L.phase === C.PHASE.REGULAR) {                          // new rosters → new Boss goal on the "New Season" card
      LG().Boss.setGoal(L);
      if (L.newSeasonCard) L.newSeasonCard.goal = L.boss.goal;
    }
    try { if (LG().Standings.snapPower) LG().Standings.snapPower(L); } catch (e) { /* optional */ }
    if (LG().News && LG().News.add) LG().News.add(L, 'sign', 'Star Draft done. Every team has 8 Stars.', L.userTid);
    LG().emit('league:fantasyDone', { mine: mine.length });
  }
})(globalThis.PT = globalThis.PT || {});
