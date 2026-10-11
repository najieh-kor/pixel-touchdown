/* Pixel Touchdown: js/league/draft.js
 * Owner: WP2. Responsibility: PT.League.Draft: class generation, scouting fog, order, AI picks, user pick (design 10.6, 17.2, 17.6).
 * Class: 160 rookies per year, generated at Preseason (Twists.roll) or lazily; scouting runs Week 1 → Draft Day.
 * Prospect: tid −2, pr = { sch, rank, sc (scout level 0..2), o (fixed fog offset −6..6), nb (neighbor Growth letter) },
 * p.yr1 = first season they will play. L.draft = { s (= season they will play), order:[{rd,pk,tid,orig,pid}], cls:[pid], hot:[tid] };
 * L.sub = pick index while in DRAFT. Rookie Deals from Cap.rookieScale, signed at the pick (exp = season + yrs).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Draft = PT.ns('League.Draft');
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;
  const H = () => PT.League.History;

  const SHARES = [['QB', 8], ['RB', 9], ['WR', 15], ['TE', 7], ['OL', 13], ['DL', 13], ['LB', 11], ['CB', 13], ['S', 7], ['K', 4]];
  const GROWTH = [['A+', 5], ['A', 15], ['B', 35], ['C', 30], ['D', 15]];
  const GAP = { 'A+': [20, 28], A: [14, 19], B: [8, 13], C: [3, 7], D: [0, 2] };
  Draft.GBONUS = { 'A+': 8, A: 6, B: 3, C: 0, D: -3 };
  const LET = C.GROWTH_LETTERS;   // ['A+','A','B','C','D']

  function neighbor(r, gl) {
    const i = LET.indexOf(gl);
    if (i <= 0) return LET[1];
    if (i >= LET.length - 1) return LET[LET.length - 2];
    return r.chance(0.5) ? LET[i - 1] : LET[i + 1];
  }
  Draft.neighbor = neighbor;

  /** Shift main skills so the natural-position OVR hits target (local adapter around WP1 PlayerGen). */
  function fitOvr(p, target) {
    const ovr = () => (PT.League.Ratings && PT.League.Ratings.ovr ? PT.League.Ratings.ovr(p) : p.ovr);
    for (let pass = 0; pass < 3; pass++) {
      const d = target - ovr();
      if (!d) break;
      for (const k of Object.keys(C.OVR_W[p.pos])) p.r[k] = Math.max(C.SKILL_MIN, Math.min(C.SKILL_MAX, Math.round(p.r[k] + d)));
    }
    p.ovr = ovr();
  }
  Draft.fitOvr = fitOvr;

  function ensureFog(L, p) {
    if (!p.pr) p.pr = { sch: 'Acorn U', rank: 0, sc: 0 };
    if (p.pr.o == null) {
      const r = PT.RNG.create(PT.RNG.hash(L.seed, p.id, 'fog'));
      p.pr.o = r.int(-6, 6);
      p.pr.nb = neighbor(r, p.gl);
    }
    if (p.yr1 == null) p.yr1 = L.season + 1;
  }

  /** Scout Grade bonus for a shown Growth string ('?' → 2; 'B–A' → average). */
  function gbonus(gl) {
    if (!gl || gl === '?') return 2;
    const parts = gl.split('–');
    let s = 0;
    for (const x of parts) s += Draft.GBONUS[x] || 0;
    return s / parts.length;
  }

  /**
   * What the user sees of a prospect (design 10.6 fog). @returns {{ovr:[lo,hi], pot:[lo,hi], gl:string, spd:number,
   * tr:string[]|null, want:string|null, grade:number, sc:number}}
   */
  Draft.view = function (L, p) {
    ensureFog(L, p);
    const t = p.ovr, o = p.pr.o, sc = p.pr.sc || 0;
    const w = L.teams[L.userTid].fac.sct >= 5 ? 9 : 12;
    let lo, hi, gl;
    if (sc >= 2) { lo = hi = t; gl = p.gl; }
    else if (sc === 1) {
      const c = t + Math.round(o / 2); lo = c - 5; hi = c + 5;
      const pair = [p.gl, p.pr.nb].sort((a, b) => LET.indexOf(b) - LET.indexOf(a));
      gl = pair[0] === pair[1] ? pair[0] : pair.join('–');
    } else { lo = t + o - w; hi = t + o + w; gl = '?'; }
    lo = Math.max(1, lo); hi = Math.min(99, hi);
    const mid = (lo + hi) / 2;
    const gapR = gl === '?' ? [0, 28] : [GAP[gl.split('–')[0]][0], GAP[gl.split('–').slice(-1)[0]][1]].sort((a, b) => a - b);
    return { ovr: [lo, hi], pot: [Math.min(99, lo + gapR[0]), Math.min(99, hi + gapR[1])], gl: gl, spd: p.r.spd,
      tr: sc >= 2 ? p.tr.slice() : null, want: sc >= 2 ? p.want : null, grade: Math.round((mid + gbonus(gl)) * 10) / 10, sc: sc };
  };

  /** How an AI team sees a prospect (17.2): fixed personal OVR error N(0, 8 − 1.5×FO), true Growth w.p. 0.5 + 0.1×FO. */
  Draft.aiView = function (L, tid, p) {
    ensureFog(L, p);
    const fo = L.teams[tid].fo || 3;
    const r = PT.RNG.create(PT.RNG.hash(L.seed, tid, p.id, 'aiv'));
    const ovr = p.ovr + r.normal(0, Math.max(0.5, 8 - 1.5 * fo));
    const gl = r.chance(0.5 + 0.1 * fo) ? p.gl : neighbor(r, p.gl);
    return { ovr: ovr, gl: gl };
  };

  /** Make one rookie (not pushed). */
  function makeRookie(L, r, pos, ovr) {
    const age = pos === 'K' ? r.int(22, 24) : r.weighted([[21, 30], [22, 45], [23, 25]]);
    const p = PT.League.PlayerGen.create(L, { pos: pos, tid: C.TID.PROSPECT, age: age, ovr: ovr });
    p.tid = C.TID.PROSPECT; p.pos = pos; p.age = age; p.con = null; p.inj = null; p.ir = false;
    p.alt = p.alt || []; p.sg = p.sg || {};
    fitOvr(p, ovr);
    return p;
  }

  function setGrowth(r, p) {
    p.gl = r.weighted(GROWTH);
    const g = GAP[p.gl];
    p.pot = Math.min(99, p.ovr + r.int(g[0], g[1]));
  }

  /** Re-rank the class by consensus (fogged OVR + true Growth bonus). */
  function rerank(L) {
    const pros = Q().prospects(L);
    pros.forEach((p) => ensureFog(L, p));
    pros.sort((a, b) => ((b.ovr + b.pr.o + Draft.GBONUS[b.gl]) - (a.ovr + a.pr.o + Draft.GBONUS[a.gl])) || (a.id - b.id))
      .forEach((p, i) => { p.pr.rank = i + 1; });
  }

  /**
   * Make sure this season's class exists (160 rookies, design 10.6). Tops up a short class, applies Rookie Rush (+3) once.
   * @returns {number} class size
   */
  Draft.ensureClass = function (L, force) {
    if (!force && (L.phase === 'DRAFT' || L.phase === 'FREE_AGENCY')) return Q().prospects(L).length;
    const ss = H().ss(L);
    const have = Q().prospects(L);
    const need = K().DRAFT_CLASS - have.length;
    if (need > 0) {
      const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'class', have.length));
      const schools = (PT.Data.Text && PT.Data.Text.schools) || ['Acorn U'];
      const made = [];
      for (let i = 0; i < need; i++) {
        const pos = r.weighted(SHARES);
        const ovr = Math.max(K().DRAFT_MIN, Math.min(K().DRAFT_MAX, Math.round(r.normal(K().DRAFT_MEAN, K().DRAFT_SD))));
        const p = makeRookie(L, r, pos, ovr);
        p.pr = { sch: r.pick(schools), rank: 0, sc: 0, o: r.int(-6, 6), nb: 'B' };
        p.yr1 = L.season + 1;
        p.dr = null; p.st = {}; p.cs = []; p.aw = [];
        made.push(p);
      }
      made.slice().sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id)).slice(0, need >= K().DRAFT_CLASS ? K().DRAFT_TOP_N : Math.round(K().DRAFT_TOP_N * need / K().DRAFT_CLASS))
        .forEach((p) => fitOvr(p, Math.min(84, p.ovr + K().DRAFT_TOP_BONUS)));
      for (const p of made) { setGrowth(r, p); p.pr.nb = neighbor(r, p.gl); L.players.push(p); }
      if (PT.League.hydrate) PT.League.hydrate(L);
    }
    const bonus = PT.League.Twists.fx(L).draftOvr;
    if (bonus && !ss.rr) {
      ss.rr = 1;
      for (const p of Q().prospects(L)) { fitOvr(p, Math.min(99, p.ovr + bonus)); p.pot = Math.min(99, Math.max(p.pot, p.ovr) + bonus); }
    }
    rerank(L);
    return Q().prospects(L).length;
  };
  /** Hook at SEASON_END (arch): same as ensureClass. */
  Draft.generateClass = function (L) { return Draft.ensureClass(L); };

  // ---------------- order ----------------

  function coin(L, tid) { return PT.RNG.hash(L.seed, L.season, 'coin', tid); }

  /**
   * Draft order (design 10.6): non-playoff teams by worst record (worse point difference, coin flip), then playoff
   * teams by elimination round (earlier first, same tiebreaks), Bowl loser 31st, champion 32nd.
   * @returns {number[]} 32 original team ids
   */
  Draft.baseOrder = function (L) {
    const std = PT.League.Standings.get(L);
    const row = {};
    for (const r of std) row[r.tid] = r;
    const out = {};
    for (const g of L.sched) {
      if (!g.po || g.st !== 'F') continue;
      const loser = g.hs > g.as ? g.a : g.h;
      out[loser] = g.po;
      if (g.po === C.PLAYOFF_ROUNDS) out[g.hs > g.as ? g.h : g.a] = C.PLAYOFF_ROUNDS + 1;
    }
    const inPo = {};
    for (const s of (L.po && L.po.seeds) || []) for (const t of s) inPo[t] = 1;
    const cmp = (a, b) => (row[a].pct - row[b].pct) || ((row[a].pf - row[a].pa) - (row[b].pf - row[b].pa)) || (coin(L, a) - coin(L, b));
    const non = L.teams.map((t) => t.id).filter((t) => !inPo[t] && out[t] == null).sort(cmp);
    const po = L.teams.map((t) => t.id).filter((t) => inPo[t] || out[t] != null)
      .sort((a, b) => ((out[a] || 1) - (out[b] || 1)) || cmp(a, b));
    return non.concat(po);
  };

  /** Bottom-4 two seasons in a row → "Hot Draft" (17.6). */
  function hotTeams(L) {
    const std = PT.League.Standings.get(L).slice().sort((a, b) => (a.pct - b.pct) || ((a.pf - a.pa) - (b.pf - b.pa)) || (a.tid - b.tid));
    const now = std.slice(0, 4).map((r) => r.tid);
    const prev = L.hist.seasons.find((s) => s.s === L.season - 1);
    if (!prev || !prev.std) return [];
    const last = prev.std.slice().sort((a, b) => ((a[1] + 0.5 * a[3]) / Math.max(1, a[1] + a[2] + a[3]) - (b[1] + 0.5 * b[3]) / Math.max(1, b[1] + b[2] + b[3])) || ((a[4] - a[5]) - (b[4] - b[5])) || (a[0] - b[0]))
      .slice(0, 4).map((r) => r[0]);
    return now.filter((t) => last.indexOf(t) >= 0);
  }

  /** Enter DRAFT: class check, order (with traded picks), L.sub = 0. */
  Draft.begin = function (L) {
    Draft.ensureClass(L, true);
    const base = Draft.baseOrder(L);
    const s = L.season + 1;
    const order = [];
    for (let rd = 1; rd <= C.DRAFT_ROUNDS; rd++) {
      base.forEach((orig, i) => {
        const owner = L.teams.find((t) => t.picks.some((pk) => pk.s === s && pk.rd === rd && pk.orig === orig));
        order.push({ rd: rd, pk: (rd - 1) * C.NUM_TEAMS + i + 1, tid: owner ? owner.id : orig, orig: orig, pid: null });
      });
    }
    L.draft = { s: s, order: order, cls: Q().prospects(L).map((p) => p.id), hot: hotTeams(L) };
    L.sub = 0;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'draft' });
    return L.draft;
  };

  /** @returns {{pick:{rd,pk,tid,orig}|null, userOnClock, done, recent:{pk,tid,pid}[], next:number|null, left:number}} */
  Draft.status = function (L) {
    if (!L.draft || L.phase !== 'DRAFT') return { pick: null, userOnClock: false, done: true, recent: [], next: null, left: 0 };
    const o = L.draft.order[L.sub] || null;
    const recent = L.draft.order.filter((x) => x.pid != null).slice(-6).reverse().map((x) => ({ pk: x.pk, tid: x.tid, pid: x.pid }));
    const nxt = L.draft.order.find((x, i) => i >= L.sub && x.tid === L.userTid);
    return { pick: o ? { rd: o.rd, pk: o.pk, tid: o.tid, orig: o.orig } : null, userOnClock: !!o && o.tid === L.userTid, done: !o,
      recent: recent, next: nxt ? nxt.pk : null, left: L.draft.order.length - L.sub };
  };

  /** Positions where your starter is < 70 OVR (or missing): the "Need" chip. */
  Draft.needs = function (L, tid) {
    if (tid == null) tid = L.userTid;
    const out = {};
    // HUNT4-league #4: a position stops being a Need once this draft added someone there (rookies are not in the Lineup yet)
    const picked = {};
    if (L.draft && L.draft.order) L.draft.order.forEach((o) => {
      if (o.tid !== tid || o.pid == null) return;
      const p = Q().player(L, o.pid);
      if (p) picked[p.pos] = Math.max(picked[p.pos] || 0, p.ovr);
    });
    for (const pos of C.POS) {
      if (picked[pos] != null) continue;
      if (PT.League.Contracts.starterOvr(L, tid, pos) < 70) out[pos] = true;
    }
    return out;
  };

  /**
   * Draft Board: the class with fogged values, Scout Grade, rank, Need chip and top-6 flag.
   * opts: { pos?, sort?: 'grade'|'rank'|'spd'|'pos' } @returns {{p, shown, grade, rank, need, top}[]}
   */
  Draft.board = function (L, opts) {
    opts = opts || {};
    if (L.phase !== 'DRAFT' && L.phase !== 'FREE_AGENCY') Draft.ensureClass(L);
    const needs = Draft.needs(L, L.userTid);
    let rows = Q().prospects(L).filter((p) => !opts.pos || p.pos === opts.pos).map((p) => {
      const v = Draft.view(L, p);
      return { p: p, shown: v, grade: v.grade, rank: p.pr.rank, need: !!needs[p.pos], top: false };
    });
    const sort = opts.sort || 'grade';
    rows.sort((a, b) => sort === 'rank' ? a.rank - b.rank : sort === 'spd' ? b.shown.spd - a.shown.spd :
      sort === 'pos' ? (C.POS.indexOf(a.p.pos) - C.POS.indexOf(b.p.pos)) || (b.grade - a.grade) : (b.grade - a.grade) || (a.rank - b.rank));
    rows.slice().sort((a, b) => (b.grade - a.grade) || (a.rank - b.rank)).slice(0, 6).forEach((r) => { r.top = true; });
    return rows;
  };

  /** Spend a scouting point (level 0 → 1 → 2, 1 point each). Week 1 → Draft Day. @returns {Result} */
  Draft.scout = function (L, pid) {
    if (L.phase === 'PRESEASON' || L.phase === 'FREE_AGENCY') return { ok: false, err: 'NOT_NOW', msg: 'Scouting opens in Week 1.' };
    const p = Q().player(L, pid);
    if (!p || p.tid !== C.TID.PROSPECT) return { ok: false, err: 'NO_PROSPECT', msg: 'That rookie is not in the draft.' };
    ensureFog(L, p);
    if (p.pr.sc >= 2) return { ok: false, err: 'MAXED', msg: 'Already fully scouted.' };
    if (L.scout.pts < 1) return { ok: false, err: 'NO_POINTS', msg: 'No scout points left.' };
    L.scout.pts--;
    p.pr.sc++;
    L.scout.spent[pid] = p.pr.sc;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'scout' });
    return { ok: true, sc: p.pr.sc, left: L.scout.pts, shown: Draft.view(L, p) };
  };

  function doPick(L, pid) {
    const o = L.draft.order[L.sub];
    const p = Q().player(L, pid);
    if (!o) return { ok: false, err: 'DONE', msg: 'The draft is over.' };
    if (!p || p.tid !== C.TID.PROSPECT) return { ok: false, err: 'TAKEN', msg: 'That player is already taken.' };
    // Hot Draft (17.6): first pick of the team raises Growth one step
    if (L.draft.hot && L.draft.hot.indexOf(o.tid) >= 0 && !L.draft.order.some((x) => x.pid != null && x.tid === o.tid)) {
      const i = LET.indexOf(p.gl);
      if (i > 0) { p.gl = LET[i - 1]; const g = GAP[p.gl]; p.pot = Math.min(99, Math.max(p.pot, p.ovr + g[0])); }
    }
    const rs = PT.League.Cap.rookieScale(o.pk, L);
    p.dr = { s: L.draft.s, rd: o.rd, pk: o.pk, t: o.tid };
    p.yr1 = L.draft.s;
    p.mor = 70;
    // HUNT4 #4: rookie deals from round 3 on are not guaranteed until Week 1 (cutting them costs no dead money);
    // Calendar.startSeason restores the normal guarantee
    PT.League.Contracts.attach(L, pid, o.tid, { sal: rs.sal, exp: L.season + rs.yrs, sgn: L.season, rk: true, gtd: o.rd >= 3 ? 0 : C.CAP.CUT_PCT });
    o.pid = pid;
    L.sub++;
    if (o.pk === 1) {
      const N = PT.League.News;
      N.add(L, 'draft', N.tpl('firstPick', { T: L.teams[o.tid].name, P: N.pname(p) }), o.tid);
    }
    if (PT.Events) PT.Events.emit('league:draftPick', { pk: o.pk, tid: o.tid, pid: pid });
    finishIfDone(L);
    return { ok: true, pid: pid, pk: o.pk };
  }

  function finishIfDone(L) {
    if (!L.draft || L.sub < L.draft.order.length || L.draft.fin) return;
    L.draft.fin = 1;
    for (const p of Q().prospects(L)) { p.tid = C.TID.FA; delete p.pr; p.mor = 60; }
    for (const t of L.teams) t.picks = t.picks.filter((pk) => pk.s !== L.draft.s);
    L.scout.spent = {};
    if (PT.Events) PT.Events.emit('league:changed', { what: 'draft' });
  }

  /** User pick (must be on the clock). @returns {Result} */
  Draft.pick = function (L, pid) {
    const st = Draft.status(L);
    if (!st.userOnClock) return { ok: false, err: 'NOT_ON_CLOCK', msg: 'It is not your pick yet.' };
    return doPick(L, pid);
  };

  /** Auto Pick for the user (AI GM formula with your needs). @returns {Result} */
  Draft.autoPick = function (L) {
    const st = Draft.status(L);
    if (!st.userOnClock) return { ok: false, err: 'NOT_ON_CLOCK', msg: 'It is not your pick yet.' };
    return doPick(L, PT.League.AIGM.chooseDraftPick(L, L.userTid));
  };

  /** AI picks until the user is on the clock or the draft ends. @returns {{picks:{pk,tid,pid}[], userOnClock:boolean}} */
  Draft.simToUser = function (L) {
    const picks = [];
    let guard = 0;
    while (guard++ < 1000) {
      const st = Draft.status(L);
      if (st.done || st.userOnClock) break;
      const pid = PT.League.AIGM.chooseDraftPick(L, st.pick.tid);
      if (pid == null) break;
      const r = doPick(L, pid);
      if (!r.ok) break;
      picks.push({ pk: r.pk, tid: st.pick.tid, pid: pid });
    }
    finishIfDone(L);
    return { picks: picks, userOnClock: Draft.status(L).userOnClock };
  };

  /** Auto Draft: everyone picks (user picks use Auto Pick). @returns {{picks:{pk,tid,pid}[]}} */
  Draft.autoRest = function (L) {
    const picks = [];
    let guard = 0;
    while (guard++ < 1000) {
      const st = Draft.status(L);
      if (st.done) break;
      const pid = PT.League.AIGM.chooseDraftPick(L, st.pick.tid);
      if (pid == null) break;
      const r = doPick(L, pid);
      if (!r.ok) break;
      picks.push({ pk: r.pk, tid: st.pick.tid, pid: pid });
    }
    finishIfDone(L);
    return { picks: picks };
  };
})(globalThis.PT = globalThis.PT || {});
