/* Pixel Touchdown: js/league/schedule.js
 * Owner: WP1. Responsibility: PT.League.Schedule: regular season generation (div/conf/inter rotation).
 * Design Appendix D (exact matchup rules) + 10.3: 18 weeks, 17 games per team, one Rest Week per team in weeks 6–13
 * (4 teams per bye week, no two from one division), week 18 = division games only, no division rematch in
 * consecutive weeks (soft). Deterministic: uses its own RNG stream hash(seed, season, 'sched').
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Schedule = PT.ns('League.Schedule');

  /** step-2 division pairs by y mod 3 */
  Schedule.CONF_PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  Schedule.MAX_TRIES = 200;

  /**
   * Division place 0..3 per team: last season's finish (team.rec entry with `pl`), else by tier (desc) then table order.
   * @returns {number[]} place by tid
   */
  Schedule.places = function (L) {
    const place = [];
    for (let c = 0; c < C.CONFS; c++) {
      for (let d = 0; d < C.DIVS_PER_CONF; d++) {
        const div = L.teams.filter((t) => t.conf === c && t.div === d);
        const last = (t) => t.rec.filter((r) => r.s === L.season - 1 && r.pl != null)[0];
        if (div.every((t) => last(t))) div.forEach((t) => { place[t.id] = last(t).pl; });
        else div.slice().sort((a, b) => (b.tier - a.tier) || (a.id - b.id)).forEach((t, i) => { place[t.id] = i; });
      }
    }
    return place;
  };

  /**
   * The 272 matchups for a season (Appendix D steps 1–5).
   * @returns {{h:number, a:number, k:string}[]} k: 'div'|'conf'|'inter'|'place'|'x17'
   */
  Schedule.matchups = function (L, yIn, placeIn) {
    const y = yIn == null ? Math.max(0, L.season - C.START_SEASON) : yIn;
    const place = placeIn || Schedule.places(L);
    const at = {};
    L.teams.forEach((t) => { at[t.conf + ':' + t.div + ':' + place[t.id]] = t.id; });
    const team = (c, d, p) => at[c + ':' + d + ':' + p];
    const members = (c, d) => [0, 1, 2, 3].map((p) => team(c, d, p));
    const out = [];
    const add = (h, a, k) => out.push({ h: h, a: a, k: k });
    // 1. division: home and away vs each rival
    for (let c = 0; c < C.CONFS; c++) for (let d = 0; d < 4; d++) {
      const m = members(c, d);
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { add(m[i], m[j], 'div'); add(m[j], m[i], 'div'); }
    }
    // 2. same-conference division (4)
    const pairs = Schedule.CONF_PAIRS[y % 3];
    for (let c = 0; c < C.CONFS; c++) pairs.forEach((pr) => {
      for (let pa = 0; pa < 4; pa++) for (let pb = 0; pb < 4; pb++) {
        const A = team(c, pr[0], pa), B = team(c, pr[1], pb);
        if ((pa + pb) % 2 === y % 2) add(A, B, 'conf'); else add(B, A, 'conf');
      }
    });
    // 3. other-conference division (4): Sunny d vs Frosty (d + y) mod 4
    for (let d = 0; d < 4; d++) {
      const fd = (d + y) % 4;
      for (let pa = 0; pa < 4; pa++) for (let pb = 0; pb < 4; pb++) {
        const A = team(0, d, pa), B = team(1, fd, pb);
        if ((pa + pb + y) % 2 === 0) add(A, B, 'inter'); else add(B, A, 'inter');
      }
    }
    // 4. same place, same conference (2) vs the two divisions that are not the step-2 partner
    for (let c = 0; c < C.CONFS; c++) {
      const A = pairs[0], B = pairs[1];
      for (let p = 0; p < 4; p++) {
        const a1 = team(c, A[0], p), a2 = team(c, A[1], p), b1 = team(c, B[0], p), b2 = team(c, B[1], p);
        const g = [[a1, b1], [b1, a2], [a2, b2], [b2, a1]];
        g.forEach((x) => (y % 2 === 0 ? add(x[0], x[1], 'place') : add(x[1], x[0], 'place')));
      }
    }
    // 5. 17th game: Sunny d place p vs Frosty (d + y + 2) mod 4 place p; Sunny hosts on even y
    for (let d = 0; d < 4; d++) for (let p = 0; p < 4; p++) {
      const A = team(0, d, p), B = team(1, (d + y + 2) % 4, p);
      if (y % 2 === 0) add(A, B, 'x17'); else add(B, A, 'x17');
    }
    return out;
  };

  /** 8 Rest Week groups of 4 (weeks 6..13), no two teams of one division in a group unless relaxed. */
  function byeGroups(L, rng, relax) {
    const n = C.BYE_WEEKS[1] - C.BYE_WEEKS[0] + 1;
    for (let attempt = 0; attempt < 100; attempt++) {
      const ids = rng.shuffle(L.teams.map((t) => t.id));
      const groups = [];
      for (let i = 0; i < n; i++) groups.push([]);
      let okAll = true;
      for (const tid of ids) {
        const t = L.teams[tid];
        const open = groups.filter((g) => g.length < 4 && (relax || !g.some((x) => L.teams[x].conf === t.conf && L.teams[x].div === t.div)));
        if (!open.length) { okAll = false; break; }
        open.sort((a, b) => a.length - b.length);
        const minLen = open[0].length;
        rng.pick(open.filter((g) => g.length === minLen)).push(tid);
      }
      if (okAll) return groups;
    }
    return null;
  }

  /**
   * One attempt at placing all games into 18 weeks. Returns weeks[w] = [gameIdx…] or null.
   */
  function attempt(L, games, rng, strict, relaxBye) {
    const W = C.REG_WEEKS;
    const N = L.teams.length;
    const groups = byeGroups(L, rng, relaxBye);
    if (!groups) return null;
    const byeWeek = new Array(N).fill(0);
    groups.forEach((g, i) => g.forEach((tid) => { byeWeek[tid] = C.BYE_WEEKS[0] + i; }));
    const weeks = [];
    for (let w = 0; w <= W; w++) weeks.push([]);
    const usedG = new Array(games.length).fill(false);
    const byTeam = [];
    for (let t = 0; t < N; t++) byTeam.push([]);
    games.forEach((g, i) => { byTeam[g.h].push(i); byTeam[g.a].push(i); });
    const pairKey = (g) => Math.min(g.h, g.a) * 64 + Math.max(g.h, g.a);
    const playedIn = {};   // pairKey → [weeks]

    const isDivRematch = (g, w) => {
      if (g.k !== 'div') return false;
      const ws = playedIn[pairKey(g)];
      return !!ws && ws.some((x) => Math.abs(x - w) === 1);
    };
    function place(gi, w) {
      usedG[gi] = true; weeks[w].push(gi);
      const k = pairKey(games[gi]);
      (playedIn[k] = playedIn[k] || []).push(w);
    }
    function unplace(gi, w) {
      usedG[gi] = false; weeks[w].pop();
      playedIn[pairKey(games[gi])].pop();
    }

    // week 18: division games only, one per team
    const W18 = W;
    for (let c = 0; c < C.CONFS; c++) for (let d = 0; d < 4; d++) {
      const m = L.teams.filter((t) => t.conf === c && t.div === d).map((t) => t.id).sort((a, b) => a - b);
      const pairings = [[[m[0], m[1]], [m[2], m[3]]], [[m[0], m[2]], [m[1], m[3]]], [[m[0], m[3]], [m[1], m[2]]]];
      rng.pick(pairings).forEach((pr) => {
        const cands = byTeam[pr[0]].filter((gi) => !usedG[gi] && games[gi].k === 'div' &&
          (games[gi].h === pr[1] || games[gi].a === pr[1]));
        place(rng.pick(cands), W18);
      });
    }

    // weeks 1..17: perfect matchings on teams not resting, depth-first across weeks (shared node budget).
    // Pruning: once two weeks remain, the leftover games form a 2-regular graph that must have only even cycles.
    const order = [];
    for (let w = 1; w < W; w++) order.push(w);
    const matched = new Array(N).fill(false);
    let budget = 5000;
    const evenLeftover = () => {
      const adj = [];
      for (let t = 0; t < N; t++) adj.push([]);
      games.forEach((g, gi) => { if (!usedG[gi]) { adj[g.h].push(gi); adj[g.a].push(gi); } });
      const seenG = new Array(games.length).fill(false), seenT = new Array(N).fill(false);
      for (let s0 = 0; s0 < N; s0++) {
        if (seenT[s0] || !adj[s0].length) continue;
        let len = 0, t = s0;
        while (!seenT[t]) {
          seenT[t] = true;
          const gi = adj[t].find((x) => !seenG[x]);
          if (gi == null) break;
          seenG[gi] = true; len++;
          t = games[gi].h === t ? games[gi].a : games[gi].h;
        }
        if (len % 2 === 1) return false;
      }
      return true;
    };
    const solveWeek = (wi) => {
      if (wi === order.length) return true;
      const w = order[wi];
      const avail = [];
      for (let t = 0; t < N; t++) { matched[t] = byeWeek[t] === w; if (!matched[t]) avail.push(t); }
      const solve = (left) => {
        if (left === 0) {
          if (wi === order.length - 3 && !evenLeftover()) return false;
          const saved = matched.slice();
          if (solveWeek(wi + 1)) return true;
          for (let t = 0; t < N; t++) matched[t] = saved[t];
          return false;
        }
        if (--budget <= 0) return false;
        let best = -1, bestC = null;
        for (const t of avail) {
          if (matched[t]) continue;
          const c = byTeam[t].filter((gi) => {
            if (usedG[gi]) return false;
            const o = games[gi].h === t ? games[gi].a : games[gi].h;
            return !matched[o] && !(strict && isDivRematch(games[gi], w));
          });
          if (!bestC || c.length < bestC.length) { best = t; bestC = c; if (!c.length) break; }
        }
        if (!bestC.length) return false;
        const seen = {};
        const cand = rng.shuffle(bestC.filter((gi) => {
          const o = games[gi].h === best ? games[gi].a : games[gi].h;
          if (seen[o]) return false;
          seen[o] = 1; return true;
        }));
        for (const gi of cand) {
          const o = games[gi].h === best ? games[gi].a : games[gi].h;
          matched[best] = matched[o] = true;
          place(gi, w);
          if (solve(left - 2)) return true;
          unplace(gi, w);
          matched[best] = matched[o] = false;
          if (budget <= 0) return false;
        }
        return false;
      };
      return solve(avail.length);
    };
    if (!solveWeek(0)) return null;
    return { weeks: weeks, byeWeek: byeWeek };
  }

  /**
   * Generate the regular season into L.sched (appends; Calendar clears it at rollover).
   * @returns {{rest:Object<number,number>, tries:number}} rest = tid → Rest Week
   */
  Schedule.generate = function (L) {
    const games = Schedule.matchups(L);
    const rng = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'sched'));
    let res = null, tries = 0;
    while (!res && tries < Schedule.MAX_TRIES * 2) {
      tries++;
      res = attempt(L, games, rng, tries <= Schedule.MAX_TRIES, tries > Schedule.MAX_TRIES);
    }
    if (!res) throw new Error('[Schedule] could not place games');
    const list = [];
    res.weeks.forEach((gis, w) => gis.forEach((gi) => list.push({ w: w, g: games[gi] })));
    list.sort((x, y) => (x.w - y.w) || (x.g.h - y.g.h));
    list.forEach((x) => {
      L.sched.push({ gid: L.nextGid++, wk: x.w, h: x.g.h, a: x.g.a, po: 0, st: 'S', hs: null, as: null, ot: false, sim: false });
    });
    const rest = {};
    res.byeWeek.forEach((w, tid) => { rest[tid] = w; });
    return { rest: rest, tries: tries };
  };

  /** Rest Week of a team this season (null if none found) */
  Schedule.restWeek = function (L, tid) {
    for (let w = C.BYE_WEEKS[0]; w <= C.BYE_WEEKS[1]; w++) {
      if (!L.sched.some((g) => g.po === 0 && g.wk === w && (g.h === tid || g.a === tid))) return w;
    }
    return null;
  };
})(globalThis.PT = globalThis.PT || {});
