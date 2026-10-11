/* Pixel Touchdown: js/league/team-gen.js
 * Owner: WP1. Responsibility: PT.League.TeamGen: build initial 32 rosters, staff, facilities, finances.
 * Design 15.3 (initial league generation), 2.2 (22-man template), 6.2/7.5 (AI GM favored positions), 10.10 (Hype by tier),
 * 10.11/16 (starting Coins), 13.3 (Spirit 50), 13.5 (Captain), 17.1 (team mode), 17.5 (AI coach stars).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const TeamGen = PT.ns('League.TeamGen');

  TeamGen.BASE_BY_TIER = { 1: 64, 2: 68, 3: 72, 4: 76, 5: 80 };
  TeamGen.HYPE_BY_TIER = { 1: 30, 2: 40, 3: 50, 4: 60, 5: 70 };
  /** AI GM favored positions (design 6.2 / 7.5) */
  TeamGen.FAV_OFF = { air: ['QB', 'WR'], ground: ['RB', 'OL', 'TE'], west: ['QB', 'TE', 'RB'], trick: ['QB', 'WR'], speed: ['RB', 'WR', 'CB'] };
  TeamGen.FAV_DEF = { wall: ['DL', 'LB'], nofly: ['CB', 'S'], wild: ['DL', 'LB'], think: ['S', 'LB'] };
  /** starters per position in the 22-man template (14 field slots + K) */
  TeamGen.STARTERS = { QB: 1, RB: 1, WR: 2, TE: 1, OL: 2, DL: 2, LB: 2, CB: 2, S: 1, K: 1 };
  /**
   * Team "windows" (HUNT5-league #2): varied core ages so strong teams don't all age out together. Same OVR targets as
   * design 15.3 (season-1 strength by tier is unchanged); only ages, Growth and pay differ.
   * age = [mean, sd, min, max] for starters (s) and bench (b); growth = young upside letters; pay = fairPay × range.
   */
  TeamGen.WINDOWS = {
    young: { s: [24.5, 1.5, 21, 28], b: [23, 2, 21, 27], growth: true, pay: [0.85, 1.05] },     // rising contender
    prime: { s: [27, 2.5, 22, 32], b: [25, 3, 21, 33], growth: false, pay: [0.85, 1.15] },
    vet: { s: [30, 1.5, 27, 34], b: [27, 3, 22, 33], growth: false, pay: [1.0, 1.2] },          // win-now, little cap room
    rebuild: { s: [24, 2, 21, 29], b: [22.5, 1.5, 21, 26], growth: true, pay: [0.85, 1.1] },     // young upside
    stuck: { s: [29.5, 2, 26, 34], b: [27, 3, 22, 33], growth: false, pay: [0.95, 1.15] }       // old and capped: slow to climb
  };
  /** window odds by tier */
  TeamGen.WINDOW_ODDS = {
    5: [['young', 40], ['vet', 40], ['prime', 20]], 4: [['young', 40], ['vet', 40], ['prime', 20]],
    3: [['young', 30], ['prime', 40], ['vet', 30]], 2: [['rebuild', 50], ['stuck', 35], ['prime', 15]],
    1: [['rebuild', 50], ['stuck', 35], ['prime', 15]]
  };
  TeamGen.UPSIDE_LETTERS = [['A+', 6], ['A', 24], ['B', 42], ['C', 22], ['D', 6]];

  /** design 17.5 coach stars by AI mode {off, def, grw} */
  TeamGen.AI_STAFF = { contend: { off: 3, def: 3, grw: 2 }, balanced: { off: 2, def: 2, grw: 2 }, rebuild: { off: 2, def: 2, grw: 4 } };
  TeamGen.AI_COINS = 600;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** @returns {Team} empty team shell from a PT.Data.Teams def */
  TeamGen.shell = function (L, d) {
    const human = d.id === L.userTid;
    const fl = human ? 1 : d.tier >= 4 ? 3 : 2;
    const t = {
      id: d.id, city: d.city, name: d.name, abbr: d.abbr, sp: d.sp, logo: d.logo,
      col: { pri: d.col.pri, sec: d.col.sec, acc: d.col.acc }, conf: d.conf, div: d.div, human: human,
      roster: [], dc: {}, stf: { off: 1, def: 1, grw: 1 },
      fac: { trn: fl, med: fl, sct: fl, std: fl, shop: fl },
      fin: { coins: human ? C.START_COINS[L.diff] : TeamGen.AI_COINS, hype: TeamGen.HYPE_BY_TIER[d.tier], revS: 0, expS: 0, last: 0 },
      spirit: 50, capt: null, stars: [], style: { off: d.style.off, def: d.style.def }, rival: d.rival, clim: d.clim, stad: d.stad,
      dead: [], picks: [], strat: 'balanced', tier: d.tier, rec: []
    };
    C.SLOTS.forEach((s) => { t.dc[s] = []; });
    for (let s = L.season + 1; s <= L.season + 2; s++) for (let rd = 1; rd <= C.DRAFT_ROUNDS; rd++) t.picks.push({ s: s, rd: rd, orig: t.id });
    return t;
  };

  /** Fill a team's 22-man roster per design 15.3. Players are pushed into L.players. */
  TeamGen.fillRoster = function (L, t, rng, cap) {
    const PG = PT.League.PlayerGen;
    const B = TeamGen.BASE_BY_TIER[t.tier];
    const fav = TeamGen.FAV_OFF[t.style.off].concat(TeamGen.FAV_DEF[t.style.def]);
    // one random non-QB, non-K starter is a "star" on tier ≥ 3
    const starSlots = [];
    Object.keys(TeamGen.STARTERS).forEach((pos) => {
      if (pos === 'QB' || pos === 'K') return;
      for (let i = 0; i < TeamGen.STARTERS[pos]; i++) starSlots.push(pos + i);
    });
    const star = t.tier >= 3 ? rng.pick(starSlots) : null;
    const win = TeamGen.WINDOWS[t.win] ? t.win : (t.win = rng.weighted(TeamGen.WINDOW_ODDS[t.tier] || TeamGen.WINDOW_ODDS[3]));
    const W = TeamGen.WINDOWS[win];
    const made = [];
    Object.keys(C.ROSTER.TEMPLATE).forEach((pos) => {
      for (let i = 0; i < C.ROSTER.TEMPLATE[pos]; i++) {
        const starter = i < TeamGen.STARTERS[pos];
        let target;
        if (starter) {
          const sd = pos === 'QB' ? 3 : pos === 'K' ? 5 : 4;
          target = B + rng.normal(0, sd) + (fav.indexOf(pos) >= 0 ? 2 : 0);
          if (star === pos + i) target = B + 8 + (fav.indexOf(pos) >= 0 ? 2 : 0);
        } else target = B - 10 + rng.normal(0, 4);
        target = clamp(Math.round(target), 40, 95);
        const A = starter ? W.s : W.b;
        const age = Math.round(clamp(rng.normal(A[0], A[1]), A[2], A[3]));
        const letter = W.growth && age <= 25 && target < 78 ? rng.weighted(TeamGen.UPSIDE_LETTERS) : undefined;   // stars keep normal Growth
        const p = PG.create(L, { pos: pos, tid: t.id, ovr: target, age: age, letter: letter, initial: true, rng: rng });
        const yrs = rng.int(1, 4);
        const sal = Math.round(PG.fairPay(L, p, cap) * rng.range(W.pay[0], W.pay[1]) / 100) * 100;
        p.con = { sal: clamp(sal, PG.minPay(cap), Math.round(cap * C.CAP.MAX_PCT)), exp: L.season + yrs - 1,
          sgn: L.season - rng.int(0, Math.max(0, 4 - yrs)), rk: age <= 23 && yrs >= 2, gtd: C.CAP.CUT_PCT };
        PT.League.addPlayer(L, p);
        t.roster.push(p.id);
        made.push(p);
      }
    });
    // payroll > 97% of cap → scale all pays down to 95%
    const pay = made.reduce((s, p) => s + p.con.sal, 0);
    if (pay > cap * 0.97) {
      made.forEach((p) => { p.con.sal = Math.max(PG.minPay(cap), Math.floor(p.con.sal * cap * 0.95 / pay / 100) * 100); });
    }
    return made;
  };

  /** Captain default (design 13.5): highest-Smarts starter with Mood ≥ 50. */
  TeamGen.pickCaptain = function (L, t) {
    let best = null;
    C.SLOTS.forEach((s) => {
      if (s === 'KR') return;
      const p = t.dc[s][0] != null ? PT.League.Q.player(L, t.dc[s][0]) : null;
      if (!p || p.mor < 50) return;
      if (!best || p.r.smt > best.r.smt || (p.r.smt === best.r.smt && p.id < best.id)) best = p;
    });
    t.capt = best ? best.id : (t.dc.QB[0] != null ? t.dc.QB[0] : null);
    return t.capt;
  };

  /** AI team mode (design 17.1) from team OVR rank at creation: ≥ 24 rebuild, ≤ 10 contend. */
  TeamGen.setModes = function (L) {
    const ranked = L.teams.map((t) => ({ tid: t.id, ovr: PT.League.Ratings.teamOvr(L, t.id).ovr }))
      .sort((a, b) => (b.ovr - a.ovr) || (a.tid - b.tid));
    ranked.forEach((x, i) => {
      const t = L.teams[x.tid];
      t.strat = i + 1 >= 24 ? 'rebuild' : i + 1 <= 10 ? 'contend' : 'balanced';
      if (!t.human) t.stf = Object.assign({}, TeamGen.AI_STAFF[t.strat]);
    });
  };

  /** Build all 32 teams with rosters, lineups, captains, modes. */
  TeamGen.build = function (L) {
    const rng = PT.League.rng(L);
    const cap = C.CAP.BASE;
    PT.Data.Teams.list.forEach((d) => {
      const t = TeamGen.shell(L, d);
      L.teams.push(t);
      TeamGen.fillRoster(L, t, rng, cap);
    });
    L.teams.forEach((t) => {
      PT.League.Roster.autoDepth(L, t.id, { silent: true });
      TeamGen.pickCaptain(L, t);
    });
    TeamGen.setModes(L);
    return L.teams;
  };

  /** Initial free-agent pool (mixed species, OVR 45–62, positions by the 22-man template). */
  TeamGen.freeAgents = function (L, n) {
    const rng = PT.League.rng(L);
    const PG = PT.League.PlayerGen;
    const posW = Object.keys(C.ROSTER.TEMPLATE).map((p) => [p, C.ROSTER.TEMPLATE[p]]);
    const out = [];
    for (let i = 0; i < n; i++) {
      const pos = i < C.POS.length * 2 ? C.POS[i % C.POS.length] : rng.weighted(posW);   // at least 2 per position
      const p = PG.create(L, { pos: pos, tid: C.TID.FA, ovr: rng.int(45, 62), age: rng.int(23, 33), rng: rng });
      PT.League.addPlayer(L, p);
      out.push(p);
    }
    return out;
  };
})(globalThis.PT = globalThis.PT || {});
