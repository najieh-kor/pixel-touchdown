/* Pixel Touchdown: js/league/ai-gm.js
 * Owner: WP2. Responsibility: PT.League.AIGM: AI roster mgmt (re-sign, draft board, FA bids, cuts) (design 17).
 * team.strat = 'contend' | 'balanced' (Middle) | 'rebuild'; team.fo = Front Office skill 1..5; team.rb = rebuild streak.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const AI = PT.ns('League.AIGM');
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;
  const Cap = () => PT.League.Cap;
  const Con = () => PT.League.Contracts;

  /** Positions favored by styles (design 6.2 / 7.5 "AI GM favors"). */
  AI.FAVORS = {
    off: { air: ['QB', 'WR'], ground: ['RB', 'OL', 'TE'], west: ['QB', 'TE', 'RB'], trick: ['QB', 'WR'], speed: ['RB', 'WR', 'CB'] },
    def: { wild: ['DL', 'LB'], wall: ['DL', 'OL', 'LB'], think: ['LB', 'S'], nofly: ['CB', 'S'] }
  };
  function favored(t, pos) {
    const o = AI.FAVORS.off[t.style.off] || [], d = AI.FAVORS.def[t.style.def] || [];
    return o.indexOf(pos) >= 0 || d.indexOf(pos) >= 0;
  }
  AI.favored = favored;

  function counts(L, tid, healthyOnly) {
    const c = {};
    for (const p of Q().roster(L, tid)) { if (p.ir || (healthyOnly && p.inj)) continue; c[p.pos] = (c[p.pos] || 0) + 1; }
    return c;
  }
  function maxRoster(L) { return Cap().offView(L) || L.phase === 'SEASON_END' ? C.ROSTER.MAX_OFF : C.ROSTER.MAX_SEASON; }
  function rng(L, tid, tag) { return PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.phase, L.week, L.sub, tid, tag)); }
  function value(L, p, tid) { return PT.League.Trade.playerValue(L, p.id, tid); }

  /** Team OVR rank 1..32 */
  function rank(L, tid) { return PT.League.Boss.rank(L, tid); }

  /**
   * Team mode (design 17.1), first match: Rebuild (rank ≥ 24, or ≤ 5 wins in each of the last 2 seasons, or avg starter
   * age ≥ 30.5 and rank ≥ 16) · Contender (rank ≤ 10, or made playoffs last season with avg starter age ≤ 30) · Middle.
   */
  AI.mode = function (L, tid) {
    const t = L.teams[tid];
    const rk = rank(L, tid);
    const st = [];
    for (const s of C.SLOTS) if (s !== 'KR' && t.dc[s] && t.dc[s][0] != null) { const p = Q().player(L, t.dc[s][0]); if (p) st.push(p.age); }
    const age = st.length ? st.reduce((a, b) => a + b, 0) / st.length : 27;
    const w0 = Con().lastWins(L, tid);
    const prevS = Con().lastSeason(L) - 1;
    const r1 = t.rec.find((r) => r.s === prevS);
    const w1 = r1 ? r1.w : 9;
    if (rk >= 24 || (w0 <= 5 && w1 <= 5) || (age >= 30.5 && rk >= 16)) return 'rebuild';
    if (rk <= 10 || (Con().madePlayoffs(L, tid) && age <= 30)) return 'contend';
    return 'balanced';
  };

  /** Set every AI team's mode (after the Bowl and at the trade deadline). Tracks rebuild streaks + AI coach changes. */
  AI.setModes = function (L, season) {
    for (const t of L.teams) {
      if (t.human) continue;
      const m = AI.mode(L, t.id);
      if (season) {
        t.rb = m === 'rebuild' ? (t.rb || 0) + 1 : 0;
        if (t.rb === 3) PT.League.News.add(L, 'event', PT.League.News.tpl('aiFire', { T: 'The ' + t.name }), t.id);
      }
      t.strat = m;
    }
  };

  // ---------------- lineup / roster fitting ----------------

  /** Cut one player: lowest value / pay at a position above the template, never below minimums, lower Cut Cost first. */
  function cutOne(L, tid, wantCap) {
    const pl = Q().roster(L, tid).filter((p) => !p.ir);
    const c = counts(L, tid, false);
    const tpl = C.ROSTER.TEMPLATE, need = C.ROSTER.NEED;
    const pool = pl.filter((p) => (c[p.pos] || 0) > need[p.pos]);
    if (!pool.length) return null;
    const above = pool.filter((p) => (c[p.pos] || 0) > tpl[p.pos]);
    const src = above.length && !wantCap ? above : pool;
    src.sort((a, b) => {
      const va = value(L, a, tid) / Math.max(a.con ? a.con.sal : 0, 500), vb = value(L, b, tid) / Math.max(b.con ? b.con.sal : 0, 500);
      if (wantCap) {
        const sa = a.con ? a.con.sal * (1 - C.CAP.CUT_PCT) : 0, sb = b.con ? b.con.sal * (1 - C.CAP.CUT_PCT) : 0;
        return (va - vb) || (sb - sa) || (a.id - b.id);
      }
      return (va - vb) || ((a.con ? a.con.sal : 0) - (b.con ? b.con.sal : 0)) || (a.id - b.id);
    });
    const victim = src[0];
    PT.League.Roster.release(L, victim.id);
    return victim.id;
  }

  /**
   * Make an AI roster legal: ≤ max (22 in season / 30 offseason), under the cap, position minimums, lineup, captain.
   * @returns {{cut:number[], signed:number[]}}
   */
  AI.fitRoster = function (L, tid, max) {
    const t = L.teams[tid];
    max = max || maxRoster(L);
    const cut = [], signed = [];
    let guard = 0;
    while (Q().roster(L, tid).filter((p) => !p.ir).length > max && guard++ < 20) {
      const id = cutOne(L, tid, false); if (id == null) break; cut.push(id);
    }
    guard = 0;
    while (Cap().space(L, tid) < 0 && guard++ < 10) {
      const id = cutOne(L, tid, true); if (id == null) break; cut.push(id);
    }
    // injured long-term players → Hurt List when a spot is needed
    for (const p of Q().roster(L, tid)) if (p.inj && p.inj.w >= C.ROSTER.IR_MIN_WEEKS && !p.ir) p.ir = true;
    const fill = AI.fillNeeds(L, tid, L.phase === 'REGULAR' || L.phase === 'PLAYOFFS');
    signed.push.apply(signed, fill);
    // QA1: fillNeeds stops when the team has no Team Cash for even a walk-on; the pre-game fix (Roster.ensurePlayable)
    // signs min-pay players anyway, so do it now and keep AI rosters legal between weeks too.
    const RS = PT.League.Roster;
    if (typeof RS.fixIt === 'function' && typeof RS.validate === 'function' && !RS.validate(L, tid, { max: max }).ok) {
      const fx = PT.League.Roster.fixIt(L, tid, { useFA: true, max: max });
      signed.push.apply(signed, fx.signed);
      cut.push.apply(cut, fx.cut);
    }
    PT.League.Roster.autoDepth(L, tid);
    if (t.capt == null || t.roster.indexOf(t.capt) < 0 || !PT.League.Spirit.isStarter(L, t.capt)) PT.League.Spirit.autoCaptain(L, tid);
    return { cut: cut, signed: signed };
  };

  /**
   * Sign Market players to reach healthy position minimums (in season) or the template (offseason), cheapest fit.
   * In season: best leftover at that position for min pay or his reduced Ask; cuts the lowest-value bench player if full.
   * @returns {number[]} signed pids
   */
  AI.fillNeeds = function (L, tid, inSeason) {
    const out = [];
    const target = inSeason ? C.ROSTER.NEED : C.ROSTER.TEMPLATE;
    for (let guard = 0; guard < 12; guard++) {
      const c = counts(L, tid, inSeason);
      // HUNT3-league #2: minimums always; template gaps only while the team is under a legal 22 (no Market overload)
      const act = Q().roster(L, tid).filter((p) => !p.ir).length;
      let pos = C.POS.find((x) => (c[x] || 0) < C.ROSTER.NEED[x]);
      if (!pos && act < C.ROSTER.MAX_SEASON) pos = C.POS.find((x) => (c[x] || 0) < target[x]);
      if (!pos) break;
      const fas = Q().freeAgents(L).filter((p) => p.pos === pos && !p.inj).sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id));
      let pick = null, sal = 0;
      for (const p of fas) {
        const ask = PT.League.FA.ask(L, p.id, tid).sal;
        const s = inSeason ? Math.max(Cap().minPay(L), Math.min(ask, Cap().round100(ask * 0.8))) : ask;
        if (Cap().space(L, tid) >= s) { pick = p; sal = s; break; }
      }
      if (!pick) {
        const r = PT.League.FA.walkOn(L, tid, pos);
        if (r.ok) { out.push(r.pid); continue; }
        if (Q().roster(L, tid).filter((p) => !p.ir).length >= maxRoster(L) && cutOne(L, tid, false) != null) continue;
        break;
      }
      if (Q().roster(L, tid).filter((p) => !p.ir).length >= maxRoster(L)) { if (cutOne(L, tid, false) == null) break; }
      PT.League.FA._sign(L, pick.id, tid, { sal: sal, yrs: inSeason ? 1 : Math.max(1, Con().yearsRange(pick)[0]), gift: 0 });
      out.push(pick.id);
    }
    return out;
  };

  // ---------------- weekly / preseason ----------------

  /**
   * After each regular week: AI teams fix injuries (Hurt List, sign replacements), lineup, captain. At the trade deadline
   * (after Week 10) modes are re-set. AI-to-AI swaps (weeks 3–10) and AI swap offers to the user (10%/week, P1).
   */
  AI.weekly = function (L) {
    if (!PT.League.History.once(L, 'ai')) return;
    for (const t of L.teams) {
      if (t.human) continue;
      const v = PT.League.Roster.validate(L, t.id);
      if (!v.ok) AI.fitRoster(L, t.id);          // valid rosters: WP1 runs Auto Lineup before every game
    }
    if (L.phase === 'REGULAR' && L.week === K().TR_DEADLINE_WEEK) AI.setModes(L, false);
    if (L.phase === 'REGULAR' && L.week >= 3 && L.week <= K().TR_DEADLINE_WEEK) {
      PT.League.Trade.aiToAi(L);
      PT.League.Trade.aiOffer(L);
    }
  };

  /**
   * Preseason (rollover): AI teams set coaches by mode, maybe switch style after 2 rebuild seasons, cut to 22 and under
   * the cap, fill minimums, Auto Lineup, captain.
   */
  AI.preseason = function (L) {
    const ss = PT.League.History.ss(L);
    if (ss.aiPre) return;
    ss.aiPre = 1;
    for (const t of L.teams) {
      if (t.human) continue;
      PT.League.Staff.aiSet(L, t.id);
      if ((t.rb || 0) >= 2 && rng(L, t.id, 'style').chance(0.3)) switchStyle(L, t);
      AI.fitRoster(L, t.id, C.ROSTER.MAX_SEASON);
    }
    PT.League.History.trimFA(L);
  };

  function switchStyle(L, t) {
    const avg = (posList) => {
      const vals = [];
      for (const s of C.SLOTS) if (s !== 'KR' && posList.indexOf(C.SLOT_POS[s]) >= 0 && t.dc[s] && t.dc[s][0] != null) {
        const p = Q().player(L, t.dc[s][0]); if (p) vals.push(p.ovr);
      }
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    const bestOff = Object.keys(AI.FAVORS.off).sort((a, b) => (avg(AI.FAVORS.off[b]) - avg(AI.FAVORS.off[a])) || (a < b ? -1 : 1))[0];
    const bestDef = Object.keys(AI.FAVORS.def).sort((a, b) => (avg(AI.FAVORS.def[b]) - avg(AI.FAVORS.def[a])) || (a < b ? -1 : 1))[0];
    t.style = { off: bestOff, def: bestDef };
  }

  // ---------------- Keep (re-sign) ----------------

  /**
   * AI Keep (design 17.5): keep if (OVR ≥ starter − 2, or age ≤ 25 with Growth ≥ B) and Ask fits projected cap room and
   * (age ≤ 30 or OVR ≥ 82). Rebuild teams don't keep age ≥ 29 unless OVR ≥ 85. Pays exactly the Ask; the player uses
   * the same acceptance rules. @returns {number[]} kept pids
   */
  AI.resign = function (L, tid) {
    const t = L.teams[tid];
    const kept = [];
    const exp = Con().expiring(L, tid).sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id));
    for (const p of exp) {
      const st = Con().starterOvr(L, tid, p.pos, p.id);
      const good = p.ovr >= st - 2 || (p.age <= 25 && ['A+', 'A', 'B'].indexOf(p.gl) >= 0);
      const ageOk = p.age <= 30 || p.ovr >= 82;
      const rebuildOk = t.strat !== 'rebuild' || p.age < 29 || p.ovr >= 85;
      if (!good || !ageOk || !rebuildOk) continue;
      const a = Con().ask(L, p.id, tid);
      if (a.verdict === 'wont' || p.mor < 15) continue;
      const room = Cap().space(L, tid) - Cap().cap(L) * K().FA_RESERVE;
      if (room < a.need) continue;
      p.con = { sal: a.need, exp: L.season + a.yrs, sgn: L.season, rk: false, gtd: C.CAP.CUT_PCT };
      PT.League.Spirit.addMood(L, p, 10, 'contract');
      kept.push(p.id);
    }
    return kept;
  };

  // ---------------- Draft (17.2) ----------------

  /**
   * Best rookie for a team: seenOVR × modeOVR + growthBonus × modeGrowth + need + style favor + rand(0,3).
   * Hard rules: no QB in round 1 unless their QB is ≥ 31 or < 72 OVR; no K before round 3 unless their K < 60.
   * @returns {number|null} pid
   */
  AI.chooseDraftPick = function (L, tid) {
    const t = L.teams[tid];
    const pros = Q().prospects(L);
    if (!pros.length) return null;
    const st = PT.League.Draft.status(L);
    const rd = st.pick ? st.pick.rd : 1;
    const mode = t.human ? 'balanced' : t.strat;
    const mO = mode === 'contend' ? 1.2 : mode === 'rebuild' ? 0.9 : 1.0;
    const mG = mode === 'rebuild' ? 1.5 : 1.0;
    const c = counts(L, tid, false);
    const qb = Q().player(L, t.dc.QB && t.dc.QB[0]);
    const k = Q().player(L, t.dc.K && t.dc.K[0]);
    const qbOk = !qb || qb.age >= 31 || qb.ovr < 72;
    const kOk = !k || k.ovr < 60;
    const r = rng(L, tid, 'draft');
    let best = null, bestS = -Infinity;
    for (const p of pros) {
      if (p.pos === 'QB' && rd === 1 && !qbOk) continue;
      if (p.pos === 'K' && rd < 3 && !kOk) continue;
      const seen = t.human ? { ovr: PT.League.Draft.view(L, p).grade - 2, gl: p.pr.sc >= 2 ? p.gl : 'B' } : PT.League.Draft.aiView(L, tid, p);
      let s = seen.ovr * mO + (PT.League.Draft.GBONUS[seen.gl] || 0) * mG;
      const so = Con().starterOvr(L, tid, p.pos);
      const have = c[p.pos] || 0, tpl = C.ROSTER.TEMPLATE[p.pos];
      if (so < 70) s += 6; else if (have < tpl) s += 3;
      if (have >= tpl + 1) s -= 8;
      if (favored(t, p.pos)) s += 3;
      s += r.range(0, 3);
      if (s > bestS || (s === bestS && p.id < best.id)) { bestS = s; best = p; }
    }
    if (!best) best = pros.slice().sort((a, b) => (a.pr.rank - b.pr.rank) || (a.id - b.id))[0];
    return best.id;
  };

  // ---------------- Market (17.3) ----------------

  /**
   * An AI team's offer for one Market player, or null. Needs: below template count, or starter < his OVR − 2 (an upgrade
   * only at/below the template count, or with a free bench cut at that position). Never past 22 incl. pending offers.
   * Offer if capRoom − reserve ≥ Ask × 0.9 with chance Contender 0.8 · Middle 0.5 · Rebuild 0.3 (Rebuild: age ≤ 27 only).
   * Pay = Ask × rand(0.9, 1.1) (Contender × 1.05), years inside his range.
   */
  AI.faBid = function (L, tid, pid, r) {
    const t = L.teams[tid];
    const p = Q().player(L, pid);
    if (!p || p.tid !== C.TID.FA || t.human) return null;
    r = r || rng(L, tid, 'bid' + pid);
    const c = counts(L, tid, false);
    // HUNT3-league #2: never bid past a legal 22-man roster (pending offers count), and only upgrade where there is room
    const active = Q().roster(L, tid).filter((x) => !x.ir).length;
    const open = ((L.fa && L.fa.offers) || []).filter((o) => o.tid === tid).length;
    if (active + open >= C.ROSTER.MAX_SEASON) return null;
    const have = c[p.pos] || 0, tpl = C.ROSTER.TEMPLATE[p.pos];
    const below = have < tpl;
    const upgrade = Con().starterOvr(L, tid, p.pos) < p.ovr - 2;
    if (!below && !upgrade) return null;
    if (!below && have > tpl) {
      const starts = {};
      Object.keys(t.dc || {}).forEach((s0) => { if (s0 !== 'KR' && t.dc[s0] && t.dc[s0][0] != null) starts[t.dc[s0][0]] = true; });
      const deadOf = (x) => { const cc = Cap().cutCost ? Cap().cutCost(L, x.id) : null; return cc == null ? 1 : typeof cc === 'number' ? cc : (cc.total || 0); };
      const freeCut = Q().roster(L, tid).some((x) => !x.ir && x.pos === p.pos && x.ovr < p.ovr && !starts[x.id] && deadOf(x) === 0);
      if (!freeCut) return null;
    }
    if (t.strat === 'rebuild' && p.age > 27) return null;
    const a = Con().ask(L, pid, tid);
    const room = Cap().space(L, tid) - Cap().cap(L) * K().FA_RESERVE;
    if (room < a.sal * 0.9) return null;
    if (Q().roster(L, tid).filter((x) => !x.ir).length >= C.ROSTER.MAX_OFF) return null;
    const pr = t.strat === 'contend' ? 0.8 : t.strat === 'rebuild' ? 0.3 : 0.5;
    if (!r.chance(pr)) return null;
    let sal = a.sal * r.range(0.9, 1.1) * (t.strat === 'contend' ? 1.05 : 1);
    sal = Math.max(Cap().minPay(L), Math.min(Cap().maxPay(L), Math.min(room, Cap().round100(sal))));
    sal = Cap().round100(sal);
    if (sal < Cap().minPay(L)) return null;
    return { pid: pid, tid: tid, sal: sal, yrs: r.int(a.lo, a.hi), gift: 0, day: L.sub };
  };

  /** One Market Day for an AI team: walk the pool by OVR, max 3 offers. */
  AI.marketDay = function (L, tid, day) {
    const r = rng(L, tid, 'market' + day);
    const fas = Q().freeAgents(L).sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id));
    let n = 0;
    for (const p of fas) {
      if (n >= K().FA_AI_MAX_OFFERS) break;
      if (L.fa.offers.some((o) => o.tid === tid && o.pid === p.id)) continue;
      const of = AI.faBid(L, tid, p.id, r);
      if (of) { L.fa.offers.push(of); n++; }
    }
    return n;
  };
})(globalThis.PT = globalThis.PT || {});
