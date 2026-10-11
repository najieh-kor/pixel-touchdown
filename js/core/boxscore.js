/* Pixel Touchdown: js/core/boxscore.js
 * Owner: WP0. Responsibility: PT.Box shared BoxScore builder used by engine AND statsim.
 */
(function (PT) {
  'use strict';

  const Box = PT.Box = PT.Box || {};

  function teamLine(tid) {
    return { tid: tid, fd: 0, ty: 0, py: 0, ry: 0, to: 0, top: 0, d3a: 0, d3c: 0, pen: 0, peny: 0 };
  }

  /** @returns {BoxScore} */
  Box.create = function (o) {
    return {
      gid: o.gid, s: o.s, wk: o.wk, po: o.po || 0, h: o.h, a: o.a,
      hs: 0, as: 0, ot: false, sim: !!o.sim,
      q: [[0, 0, 0, 0], [0, 0, 0, 0]],
      tm: [teamLine(o.h), teamLine(o.a)],
      pl: {},
      sc: [],
      inj: [],
      pog: null
    };
  };

  function side(box, tid) {
    if (tid === box.h) return 0;
    if (tid === box.a) return 1;
    throw new Error('[Box] team ' + tid + ' not in game ' + box.gid);
  }
  Box.side = side;

  function line(box, pid, tid) {
    let l = box.pl[pid];
    if (!l) l = box.pl[pid] = { t: tid };
    return l;
  }

  /** Add to a player stat. Long stats (rlg, rclg, fglg) keep the max. */
  Box.add = function (box, pid, tid, key, n) {
    if (n === undefined) n = 1;
    const l = line(box, pid, tid);
    if (PT.C.STAT_MAX[key]) { if (!(l[key] >= n)) l[key] = n; }
    else l[key] = (l[key] || 0) + n;
    if (!l.gp) l.gp = 1;
    return l;
  };

  Box.markPlayed = function (box, pid, tid, started) {
    const l = line(box, pid, tid);
    l.gp = 1;
    if (started) l.gs = 1;
    return l;
  };

  Box.team = function (box, tid, key, n) {
    const t = box.tm[side(box, tid)];
    t[key] = (t[key] || 0) + (n === undefined ? 1 : n);
  };

  /**
   * @param {number} q quarter 1..4, 5 = OT
   * @param {number} clk seconds left in quarter
   * @param {string} kind 'TD'|'FG'|'XP'|'2PT'|'SAF'
   */
  Box.score = function (box, tid, pts, q, clk, kind, txt) {
    const s = side(box, tid);
    const qi = Math.max(0, (q || 1) - 1);
    while (box.q[0].length <= qi) { box.q[0].push(0); box.q[1].push(0); }
    box.q[s][qi] += pts;
    if (qi >= 4) box.ot = true;
    if (s === 0) box.hs += pts; else box.as += pts;
    box.sc.push({ q: q, clk: Math.round(clk || 0), t: tid, k: kind, pts: pts, txt: txt || '' });
  };

  Box.injury = function (box, pid, sev) {
    if (!box.inj.some((i) => i.pid === pid)) box.inj.push({ pid: pid, sev: sev || 1 });
  };

  /** Player-of-the-game score for a stat line. */
  Box.pogScore = function (l) {
    return (l.py || 0) * 0.04 + (l.ptd || 0) * 4 - (l.pi || 0) * 3
      + (l.ry || 0) * 0.1 + (l.rtd || 0) * 6
      + (l.rcy || 0) * 0.1 + (l.rctd || 0) * 6
      + (l.tk || 0) * 1 + (l.dsk || 0) * 4 + (l.int || 0) * 5 + (l.ff || 0) * 3 + (l.fr || 0) * 2 + (l.dtd || 0) * 6
      + (l.fgm || 0) * 2.5 + (l.krtd || 0) * 6 + (l.kry || 0) * 0.03
      - (l.fl || 0) * 3;
  };

  /** Fill hs/as from quarters, pick pog, strip zero stats. */
  Box.finalize = function (box) {
    box.hs = box.q[0].reduce((a, b) => a + b, 0);
    box.as = box.q[1].reduce((a, b) => a + b, 0);
    box.ot = box.q[0].length > 4;
    const winTid = box.hs > box.as ? box.h : box.as > box.hs ? box.a : null;
    let best = null, bestV = -Infinity;
    for (const pid of Object.keys(box.pl)) {
      const l = box.pl[pid];
      for (const k of Object.keys(l)) if (k !== 't' && l[k] === 0) delete l[k];
      const v = Box.pogScore(l) + (l.t === winTid ? 5 : 0);
      if (v > bestV) { bestV = v; best = +pid; }
    }
    box.pog = best;
    return box;
  };

  /** Compact form: header + q + pog + top 3 lines per team. */
  Box.compact = function (box) {
    const out = {
      gid: box.gid, s: box.s, wk: box.wk, po: box.po, h: box.h, a: box.a,
      hs: box.hs, as: box.as, ot: box.ot, sim: box.sim, q: box.q, pog: box.pog, pl: {}, c: 1
    };
    [box.h, box.a].forEach((tid) => {
      const ids = Object.keys(box.pl).filter((pid) => box.pl[pid].t === tid);
      ids.sort((x, y) => Box.pogScore(box.pl[y]) - Box.pogScore(box.pl[x]));
      ids.slice(0, 3).forEach((pid) => { out.pl[pid] = box.pl[pid]; });
    });
    return out;
  };

  /** Sum a team's player lines for one key. */
  Box.teamSum = function (box, tid, key) {
    let s = 0;
    for (const pid of Object.keys(box.pl)) { const l = box.pl[pid]; if (l.t === tid && l[key]) s += l[key]; }
    return s;
  };
})(globalThis.PT = globalThis.PT || {});
