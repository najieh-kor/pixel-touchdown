/* Pixel Touchdown: js/league/standings.js
 * Owner: WP1. Responsibility: PT.League.Standings: records, tiebreakers, seeding, power ranking.
 * Design 10.3: win % (tie = half a win) → head-to-head win % → division win % (same division only) → conference win %
 * → point difference → points scored → coin flip (seeded). Multi-team ties restart the chain on each split subgroup.
 * Seeds: 4 division winners (1–4) + 3 wild cards (5–7) per conference. Clinch marks: z #1 seed, y division,
 * x playoff spot, e eliminated (simple max-wins math; exact at season end). Power rank: design 14.12.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Standings = PT.ns('League.Standings');

  const rec0 = () => ({ w: 0, l: 0, t: 0 });
  const pctOf = (r) => { const g = r.w + r.l + r.t; return g ? (r.w + 0.5 * r.t) / g : 0; };

  function key(L) {
    let n = 0, last = 0;
    for (const g of L.sched) if (g.po === 0 && g.st === 'F') { n++; if (g.gid > last) last = g.gid; }
    return L.season + ':' + n + ':' + last;
  }

  /** Raw tallies from final regular-season games. */
  function tally(L) {
    const rows = L.teams.map((t) => ({
      tid: t.id, w: 0, l: 0, t: 0, pct: 0, pf: 0, pa: 0, diff: 0, gp: 0,
      div: rec0(), conf: rec0(), home: rec0(), away: rec0(), strk: '', last6: 0, seed: null, clinch: null,
      divRank: 0, confRank: 0, _res: [], _vs: {}
    }));
    const games = L.sched.filter((g) => g.po === 0 && g.st === 'F').sort((a, b) => (a.wk - b.wk) || (a.gid - b.gid));
    for (const g of games) {
      const h = rows[g.h], a = rows[g.a];
      const th = L.teams[g.h], ta = L.teams[g.a];
      h.pf += g.hs; h.pa += g.as; a.pf += g.as; a.pa += g.hs;
      const r = g.hs > g.as ? ['w', 'l'] : g.hs < g.as ? ['l', 'w'] : ['t', 't'];
      h[r[0]]++; a[r[1]]++; h.home[r[0]]++; a.away[r[1]]++;
      h._res.push(r[0]); a._res.push(r[1]);
      if (th.conf === ta.conf) {
        h.conf[r[0]]++; a.conf[r[1]]++;
        if (th.div === ta.div) { h.div[r[0]]++; a.div[r[1]]++; }
      }
      (h._vs[g.a] = h._vs[g.a] || rec0())[r[0]]++;
      (a._vs[g.h] = a._vs[g.h] || rec0())[r[1]]++;
    }
    rows.forEach((x) => {
      x.gp = x.w + x.l + x.t;
      x.pct = pctOf(x);
      x.diff = x.pf - x.pa;
      const lastR = x._res[x._res.length - 1];
      let n = 0;
      for (let i = x._res.length - 1; i >= 0 && x._res[i] === lastR; i--) n++;
      x.strk = lastR ? lastR.toUpperCase() + n : '';
      const l6 = x._res.slice(-6);
      x.last6 = l6.length ? l6.reduce((s, v) => s + (v === 'w' ? 1 : v === 't' ? 0.5 : 0), 0) / l6.length : 0;
    });
    return rows;
  }

  /** Order a group of tids by the tiebreak chain. rows indexed by tid. */
  function order(L, rows, tids) {
    const sorted = tids.slice().sort((a, b) => rows[b].pct - rows[a].pct);
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && rows[sorted[j]].pct === rows[sorted[i]].pct) j++;
      const block = sorted.slice(i, j);
      Array.prototype.push.apply(out, block.length > 1 ? breakTie(L, rows, block) : block);
      i = j;
    }
    return out;
  }

  const STEPS = [
    // head-to-head win % among the tied teams (only if every team met at least one other tied team)
    function h2h(L, rows, block) {
      const vals = block.map((t) => {
        const r = rec0();
        block.forEach((o) => { if (o !== t && rows[t]._vs[o]) { const v = rows[t]._vs[o]; r.w += v.w; r.l += v.l; r.t += v.t; } });
        return r.w + r.l + r.t ? pctOf(r) : null;
      });
      return vals.some((v) => v === null) ? null : vals;
    },
    // division win % (same division only)
    function division(L, rows, block) {
      const t0 = L.teams[block[0]];
      if (!block.every((t) => L.teams[t].conf === t0.conf && L.teams[t].div === t0.div)) return null;
      return block.map((t) => pctOf(rows[t].div));
    },
    function conference(L, rows, block) { return block.map((t) => pctOf(rows[t].conf)); },
    function pointDiff(L, rows, block) { return block.map((t) => rows[t].diff); },
    function pointsFor(L, rows, block) { return block.map((t) => rows[t].pf); }
  ];
  Standings.STEP_NAMES = ['head-to-head', 'division', 'conference', 'point difference', 'points scored', 'coin flip'];

  function coin(L, tid) { return PT.RNG.hash(L.seed, L.season, 'coin', tid); }

  function breakTie(L, rows, block) {
    for (const step of STEPS) {
      const vals = step(L, rows, block);
      if (!vals) continue;
      const distinct = Array.from(new Set(vals)).sort((a, b) => b - a);
      if (distinct.length === 1) continue;
      const out = [];
      distinct.forEach((v) => {
        const sub = block.filter((t, i) => vals[i] === v);
        Array.prototype.push.apply(out, sub.length > 1 ? breakTie(L, rows, sub) : sub);
      });
      return out;
    }
    return block.slice().sort((a, b) => (coin(L, a) - coin(L, b)) || (a - b));
  }
  Standings.order = function (L, tids) { return order(L, compute(L), tids); };

  /**
   * Wild-card order (non-division-winners). A tie group keeps only the best-placed team of each division (its division
   * finish already settled that pair), the tie is broken among those, one team is taken, and the step repeats. Without
   * this a team could get the wild card over a division mate that finished above it in the division table.
   */
  function wildOrder(L, rows, tids) {
    const out = [];
    let left = tids.slice();
    const sameDiv = (a, b) => L.teams[a].conf === L.teams[b].conf && L.teams[a].div === L.teams[b].div;
    while (left.length) {
      let best = -1;
      left.forEach((t) => { if (rows[t].pct > best) best = rows[t].pct; });
      const tied = left.filter((t) => rows[t].pct === best);
      const cand = tied.filter((t) => !tied.some((o) => o !== t && sameDiv(o, t) && rows[o].divRank < rows[t].divRank));
      const first = cand.length > 1 ? breakTie(L, rows, cand)[0] : cand[0];
      out.push(first);
      left = left.filter((t) => t !== first);
    }
    return out;
  }

  function compute(L) {
    const k = key(L);
    if (L._std && L._std.k === k) return L._std.rows;
    const rows = tally(L);
    const allDone = L.sched.filter((g) => g.po === 0).length > 0 && L.sched.every((g) => g.po !== 0 || g.st === 'F');
    for (let c = 0; c < C.CONFS; c++) {
      const confT = L.teams.filter((t) => t.conf === c).map((t) => t.id);
      const winners = [];
      for (let d = 0; d < C.DIVS_PER_CONF; d++) {
        const div = order(L, rows, confT.filter((t) => L.teams[t].div === d));
        div.forEach((t, i) => { rows[t].divRank = i + 1; });
        winners.push(div[0]);
      }
      const w = order(L, rows, winners);
      const rest = wildOrder(L, rows, confT.filter((t) => winners.indexOf(t) < 0));
      const seeded = w.concat(rest);
      const anyPlayed = confT.some((t) => rows[t].gp > 0);
      seeded.forEach((t, i) => { rows[t].confRank = i + 1; rows[t].seed = anyPlayed && i < C.PLAYOFF_PER_CONF ? i + 1 : null; });
      // clinch marks
      const games = C.GAMES_PER_TEAM;
      const cur = (t) => rows[t].w + 0.5 * rows[t].t;
      const max = (t) => cur(t) + (games - rows[t].gp);
      confT.forEach((t) => {
        const r = rows[t];
        if (!r.gp) return;
        const others = confT.filter((o) => o !== t);
        const mates = others.filter((o) => L.teams[o].div === L.teams[t].div);
        if (allDone) {
          r.clinch = r.seed === 1 ? 'z' : r.seed && r.seed <= 4 ? 'y' : r.seed ? 'x' : 'e';
          return;
        }
        if (others.every((o) => max(o) < cur(t))) r.clinch = 'z';
        else if (mates.every((o) => max(o) < cur(t))) r.clinch = 'y';
        // ≤ 3 teams can finish at or above us → worst case 4th in the conference → a seed is guaranteed
        else if (others.filter((o) => max(o) >= cur(t)).length <= C.PLAYOFF_PER_CONF - 4) r.clinch = 'x';
        else if (others.filter((o) => cur(o) > max(t)).length >= C.PLAYOFF_PER_CONF &&
          mates.some((o) => cur(o) > max(t))) r.clinch = 'e';
      });
    }
    Object.defineProperty(L, '_std', { value: { k: k, rows: rows }, writable: true, configurable: true, enumerable: false });
    return rows;
  }

  function pub(r) {
    return { tid: r.tid, w: r.w, l: r.l, t: r.t, pct: Math.round(r.pct * 1000) / 1000, pf: r.pf, pa: r.pa, diff: r.diff, gp: r.gp,
      div: Object.assign({}, r.div), conf: Object.assign({}, r.conf), home: Object.assign({}, r.home), away: Object.assign({}, r.away),
      strk: r.strk, last6: r.last6, seed: r.seed, clinch: r.clinch, divRank: r.divRank, confRank: r.confRank };
  }

  /**
   * @returns {{tid,w,l,t,pct,pf,pa,diff,gp,div:{w,l,t},conf:{w,l,t},home,away,strk:'W3',last6,seed:(number|null),
   *   clinch:('x'|'y'|'z'|'e'|null),divRank,confRank}[]} index === tid
   */
  Standings.get = function (L) { return compute(L).map(pub); };

  /** One team's row */
  Standings.row = function (L, tid) { return pub(compute(L)[tid]); };

  /** Division table ordered by tiebreakers */
  Standings.division = function (L, conf, div) {
    const rows = compute(L);
    return L.teams.filter((t) => t.conf === conf && t.div === div).map((t) => rows[t.id])
      .sort((a, b) => a.divRank - b.divRank).map(pub);
  };

  /** Conference table: seeds 1–7 first, then the rest by tiebreakers */
  Standings.conference = function (L, conf) {
    const rows = compute(L);
    return L.teams.filter((t) => t.conf === conf).map((t) => rows[t.id]).sort((a, b) => a.confRank - b.confRank).map(pub);
  };

  /** @returns {number[][]} [[7 tids by seed], [7 tids by seed]] */
  Standings.seeds = function (L) {
    const rows = compute(L);
    const out = [];
    for (let c = 0; c < C.CONFS; c++) {
      out.push(L.teams.filter((t) => t.conf === c && rows[t.id].seed).map((t) => t.id).sort((a, b) => rows[a].seed - rows[b].seed));
    }
    return out;
  };

  /** Division finish 0..3 per tid (schedule input, Appendix D) */
  Standings.places = function (L) {
    const rows = compute(L);
    return L.teams.map((t) => rows[t.id].divRank - 1);
  };

  /**
   * Power Rankings (design 14.12): team OVR × 0.6 + last-6-games win% × 40.
   * @returns {{tid:number, score:number, rank:number, ovr:number}[]} best first
   */
  Standings.powerRank = function (L) {
    const rows = compute(L);
    return L.teams.map((t) => {
      const ovr = PT.League.Ratings.teamOvr(L, t.id).ovr;
      return { tid: t.id, ovr: ovr, score: Math.round((ovr * 0.6 + rows[t.id].last6 * 40) * 10) / 10 };
    }).sort((a, b) => (b.score - a.score) || (b.ovr - a.ovr) || (a.tid - b.tid)).map((x, i) => Object.assign(x, { rank: i + 1 }));
  };

  // ---------------- weekly Power Rankings (FEATURES: design P1) ----------------
  /** score weights: team OVR, record (pulled toward .500 early), point diff per game, recent form (last 4 games) */
  Standings.POWER_W = { ovr: 0.55, rec: 30, diff: 0.45, diffCap: 21, form: 10, formN: 4 };

  /**
   * Weekly Power Rankings: team OVR + record + point diff + recent form (regular season and playoff games of this season).
   * `prev`/`move` compare with last week's ranks stored in L.pr (see snapPower): when nothing was played since the latest
   * snapshot the baseline is the one before it, so the arrows always mean "since last week".
   * @param {League} L
   * @returns {{tid:number, rank:number, prev:number|null, move:number, score:number, ovr:number, w:number, l:number, t:number,
   *   diff:number, gp:number, form:string}[]} best first
   */
  Standings.power = function (L) {
    const W = Standings.POWER_W;
    const res = L.teams.map(() => []);
    const rec = L.teams.map(() => ({ w: 0, l: 0, t: 0, pf: 0, pa: 0 }));
    L.sched.filter((g) => g.st === 'F').sort((a, b) => (a.wk - b.wk) || (a.gid - b.gid)).forEach((g) => {
      const r = g.hs > g.as ? ['W', 'L'] : g.hs < g.as ? ['L', 'W'] : ['T', 'T'];
      res[g.h].push(r[0]); res[g.a].push(r[1]);
      [[g.h, g.hs, g.as, r[0]], [g.a, g.as, g.hs, r[1]]].forEach((x) => {
        const o = rec[x[0]];
        o.pf += x[1]; o.pa += x[2];
        if (x[3] === 'W') o.w++; else if (x[3] === 'L') o.l++; else o.t++;
      });
    });
    const val = (c) => (c === 'W' ? 1 : c === 'T' ? 0.5 : 0);
    const list = L.teams.map((t) => {
      const o = rec[t.id], gp = o.w + o.l + o.t;
      const ovr = PT.League.Ratings.teamOvr(L, t.id).ovr;
      const pct = (o.w + 0.5 * o.t + 1) / (gp + 2);
      const dpg = gp ? Math.max(-W.diffCap, Math.min(W.diffCap, (o.pf - o.pa) / gp)) : 0;
      const last = res[t.id].slice(-W.formN);
      const form = last.length ? last.reduce((s, c) => s + val(c), 0) / last.length : 0.5;
      const score = Math.round((ovr * W.ovr + pct * W.rec + dpg * W.diff + form * W.form) * 100) / 100;
      return { tid: t.id, ovr: ovr, w: o.w, l: o.l, t: o.t, gp: gp, diff: o.pf - o.pa, form: last.join(''), score: score };
    }).sort((a, b) => (b.score - a.score) || (b.ovr - a.ovr) || (a.tid - b.tid));
    list.forEach((x, i) => { x.rank = i + 1; });
    const pr = L.pr && L.pr.r && L.pr.r.length === L.teams.length ? L.pr : null;
    let base = pr ? pr.r : null;
    if (pr && pr.p && list.every((x) => pr.r[x.tid] === x.rank)) base = pr.p;      // nothing new since the snapshot
    list.forEach((x) => {
      x.prev = base ? base[x.tid] : null;
      x.move = x.prev ? x.prev - x.rank : 0;
    });
    return list;
  };

  /**
   * Store this week's ranks (end of each regular week / playoff round, and at the new-season rollover) and keep the
   * previous ones: L.pr = { s, wk, r:[rank by tid], p:[rank by tid]|null } (two 32-int arrays, ~200 bytes).
   * @param {League} L
   */
  Standings.snapPower = function (L) {
    const ranks = new Array(L.teams.length).fill(0);
    Standings.power(L).forEach((x) => { ranks[x.tid] = x.rank; });
    const old = L.pr && L.pr.r ? L.pr.r : null;
    L.pr = { s: L.season, wk: L.week, r: ranks, p: old };
    return L.pr;
  };
})(globalThis.PT = globalThis.PT || {});
