/* Pixel Touchdown: js/league/playoffs.js
 * Owner: WP1. Responsibility: PT.League.Playoffs: seeding, bracket, round advancement.
 * Design 10.2/10.3: 7 teams per conference, seed 1 bye. Wild Card 2v7, 3v6, 4v5 (higher seed hosts). Divisional:
 * 1 vs lowest remaining seed, other two play (reseeding). Conference title: the two winners. Pixel Bowl
 * (round 4, week 22) at the neutral Pixel Dome. Playoff games live in L.sched with po = round, wk = 18 + round.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Playoffs = PT.ns('League.Playoffs');

  const winner = (g) => (g.hs > g.as ? g.h : g.a);
  const loser = (g) => (g.hs > g.as ? g.a : g.h);
  Playoffs.winner = winner;
  Playoffs.loser = loser;

  /** {conf, seed} of a playoff team, else null */
  Playoffs.seedOf = function (L, tid) {
    for (let c = 0; c < L.po.seeds.length; c++) {
      const i = L.po.seeds[c].indexOf(tid);
      if (i >= 0) return { conf: c, seed: i + 1 };
    }
    return null;
  };

  function addGame(L, rd, h, a) {
    const g = { gid: L.nextGid++, wk: C.REG_WEEKS + rd, h: h, a: a, po: rd, st: 'S', hs: null, as: null, ot: false, sim: false };
    L.sched.push(g);
    return g;
  }
  const seedNo = (L, tid) => (Playoffs.seedOf(L, tid) || { seed: 99 }).seed;

  /** teams of a conference still alive entering round rd, ordered by seed */
  function alive(L, conf, rd) {
    const seeds = L.po.seeds[conf];
    if (rd === 1) return seeds.slice();
    const prev = L.sched.filter((g) => g.po === rd - 1 && L.teams[g.h].conf === conf && g.st === 'F');
    const win = prev.map(winner);
    if (rd === 2) win.push(seeds[0]);
    return seeds.filter((t) => win.indexOf(t) >= 0);
  }

  /** Create the games of round rd (1..4). */
  Playoffs.makeRound = function (L, rd) {
    if (L.sched.some((g) => g.po === rd)) return;
    if (rd <= 3) {
      for (let c = 0; c < C.CONFS; c++) {
        let t = alive(L, c, rd);
        if (rd === 1) t = t.slice(1);                       // seed 1 rests
        while (t.length >= 2) {
          const hi = t.shift(), lo = t.pop();                // best remaining vs worst remaining; higher seed hosts
          addGame(L, rd, hi, lo);
        }
      }
    } else {
      const champs = [0, 1].map((c) => winner(L.sched.find((g) => g.po === 3 && L.teams[g.h].conf === c)));
      addGame(L, 4, champs[0], champs[1]);                    // neutral site; nominal home = Sunny champion
    }
  };

  /** Enter the playoffs: seed from final standings and create the Wild Card round. */
  Playoffs.seed = function (L) {
    L.po = { seeds: PT.League.Standings.seeds(L), rd: 1, champ: null };
    Playoffs.makeRound(L, 1);
    return L.po;
  };

  /** true when every game of round rd is final */
  Playoffs.roundDone = function (L, rd) {
    const gs = L.sched.filter((g) => g.po === rd);
    return gs.length > 0 && gs.every((g) => g.st === 'F');
  };

  /** After a round is final: next round (rd+1) or the champion. @returns {{done:boolean, champ:(number|null)}} */
  Playoffs.advance = function (L) {
    const rd = L.po.rd;
    if (!Playoffs.roundDone(L, rd)) return { done: false, champ: null };
    if (rd >= C.PLAYOFF_ROUNDS) {
      L.po.champ = winner(L.sched.find((g) => g.po === C.PLAYOFF_ROUNDS));
      return { done: true, champ: L.po.champ };
    }
    L.po.rd = rd + 1;
    Playoffs.makeRound(L, rd + 1);
    return { done: false, champ: null };
  };

  /** is the team still alive (or the champion) */
  Playoffs.alive = function (L, tid) {
    if (!Playoffs.seedOf(L, tid)) return false;
    return !L.sched.some((g) => g.po > 0 && g.st === 'F' && loser(g) === tid);
  };

  /** Season result for team.rec.res: null (missed) | 'WC' | 'DIV' | 'CONF' | 'RU' | 'CHAMP' (round lost in) */
  Playoffs.result = function (L, tid) {
    if (!Playoffs.seedOf(L, tid)) return null;
    if (L.po.champ === tid) return 'CHAMP';
    const lost = L.sched.find((g) => g.po > 0 && g.st === 'F' && loser(g) === tid);
    if (!lost) return null;
    return ['', 'WC', 'DIV', 'CONF', 'RU'][lost.po];
  };

  /** @returns {{gid,h,a,hs,as,st,hSeed,aSeed,conf}[][]} one array per round (rounds not created yet are empty) */
  Playoffs.bracket = function (L) {
    const out = [];
    for (let rd = 1; rd <= C.PLAYOFF_ROUNDS; rd++) {
      out.push(L.sched.filter((g) => g.po === rd).sort((a, b) => (L.teams[a.h].conf - L.teams[b.h].conf) || (seedNo(L, a.h) - seedNo(L, b.h)))
        .map((g) => ({ gid: g.gid, h: g.h, a: g.a, hs: g.hs, as: g.as, st: g.st, hSeed: seedNo(L, g.h), aSeed: seedNo(L, g.a),
          conf: rd === C.PLAYOFF_ROUNDS ? -1 : L.teams[g.h].conf })));
    }
    return out;
  };
})(globalThis.PT = globalThis.PT || {});
