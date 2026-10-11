/* Pixel Touchdown: js/engine/snapshot.js
 * Owner: WP3. Responsibility: preallocated render snapshot writer, fx ring buffer.
 * The Snapshot (js/core/schema.js typedef + extensions listed in docs/handoff/WP3.md) is allocated ONCE per game and
 * mutated in place every tick. No allocations in write().
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const S = PT.ns('Engine.Snapshot');
  const FX_N = 32;

  /** @returns {Snapshot} */
  S.create = function (G) {
    const snap = {
      tick: 0, phase: 'CALL', ents: [],
      ball: { x: C.FIELD.MID_X, y: 60, z: 0, px: C.FIELD.MID_X, py: 60, pz: 0, st: 'spot', car: -1, sp: 0, tx: 0, ty: 0, kind: '', tp: 0 },
      los: 35, fd: 45, dir: 1, udir: 1, poss: 0,
      aim: { on: false, x: 0, y: 0, ok: true, apex: 3, t: 0.9, sig: 0, arc: 1, lob: false, max: 50, tgt: -1 },
      kick: { on: false, x: 0, y: 0, pct: 0, ang: 0, pow: 0, minPow: 0, dist: 0, kx: 0, ky: 0 },
      star: { idx: -1, ring: 'none', t: 0, win: 0.4 },
      cam: { mode: 'presnap', fx: C.FIELD.MID_X, fy: 60, lead: 6, zoom: 1, shake: 0 },
      routes: [], routeA: null,
      meters: { u: { off: 0, def: 0 }, ai: { off: 0, def: 0 } }, ability: null,
      fx: [], fxSeq: 0,
      hud: { q: 1, half: 1, clk: 0, pc: 0, down: 1, togo: 10, ballOn: 'OWN 25', hs: 0, as: 0, poss: 0, tos: [3, 3], wx: 'sunny', mph: 0,
        hurry: false, flip: false, ot: false, goal: false, two: false, onside: false, edge: 0, fgPct: 0, retHint: '' },
      dbg: G.debug ? { routes: [], zones: [], targets: [] } : null
    };
    for (let i = 0; i < 14; i++) {
      snap.ents.push({ id: i, pid: 0, tm: i < 7 ? 0 : 1, pos: '', x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, fa: 0, an: 'idle', at: 0,
        spd: 0, ball: false, ctl: false, hi: 0, sz: 'M', en: -1, num: 0, badge: 0, star: 0 });
    }
    for (let i = 0; i < 7; i++) {
      snap.routes.push({ on: false, ent: -1, n: 0, pts: [], hot: false, end: '', k: '' });
    }
    for (let i = 0; i < FX_N; i++) snap.fx.push({ seq: 0, k: 'dust', x: 0, y: 0, z: 0, n: 0, tid: 0, txt: '', name: '' });
    snap._ab = { k: '', side: 'off', idx: -1, t: 0, perfect: false, name: '', names: [], count: 0, tid: -1 };
    if (snap.dbg) {
      for (let i = 0; i < 14; i++) snap.dbg.routes.push([]);
      for (let i = 0; i < 7; i++) snap.dbg.zones.push({ on: false, x: 0, y: 0, r: 0 });
    }
    return snap;
  };

  /**
   * Push an fx entry into the ring.
   * @param {Object} G @param {string} k 'dust'|'hit'|'catch'|'td'|'confetti'|'fumble'|'text'|'star'|'juke'|'spin'|'dive'|'flag'|'kick'|'whiff'|'pick'|'firstDown'
   */
  S.fx = function (G, k, x, y, z, n, tid, txt, name) {
    const snap = G.snap;
    const f = snap.fx[snap.fxSeq % FX_N];
    snap.fxSeq++;
    f.seq = snap.fxSeq; f.k = k; f.x = x; f.y = y; f.z = z || 0; f.n = n || 1; f.tid = tid == null ? -1 : tid; f.txt = txt || ''; f.name = name || '';
  };

  /** Write route art (offense frame from the play data) for the user's offense presnap. */
  S.setRoutes = function (G, on) {
    const snap = G.snap;
    for (let k = 0; k < 7; k++) { const r = snap.routes[k]; r.on = false; r.n = 0; r.pts.length = 0; r.hot = false; }
    if (!on || !G.P || !G.P.play) return;
    const play = G.P.play, F = PT.Engine.Formation, o = G.poss;
    for (let k = 0; k < 7; k++) {
      const slot = C.OFF_SLOTS[k], a = play.as[slot], r = snap.routes[k];
      if ((!a || typeof a !== 'object') && !(G.P.hotStar && G.P.starEnt && G.P.starEnt[o] === o * 7 + k)) continue;
      const isHot = G.P.hotStar && G.P.starEnt && G.P.starEnt[o] === o * 7 + k;
      const pts = isHot ? G.hotPts(G.ents[o * 7 + k]) : (a.rt || a.lane || a.fake || a.pull);
      if (!pts) continue;
      r.on = true; r.ent = o * 7 + k; r.n = Math.min(12, pts.length);
      r.k = isHot || (a && a.rt) ? 'route' : a.lane ? 'lane' : 'block';
      r.end = isHot ? 'HOT' : a.end || (a.fake ? 'BLOCK' : '');
      r.hot = isHot || !!(play.read && play.read[0] === slot) || (play.k === 'run' && !!(a && a.lane) && slot === (play.qb && play.qb.hand ? play.qb.hand.to : 'RB'));
      for (let i = 0; i < r.n; i++) r.pts.push(F.fx(G, pts[i][0]), F.fy(G, pts[i][1]));
    }
  };

  /** Copy engine state into the snapshot (once per tick). */
  S.write = function (G) {
    const snap = G.snap, ents = G.ents;
    snap.tick = G.tick; snap.phase = G.phase;
    for (let i = 0; i < 14; i++) {
      const e = ents[i], s = snap.ents[i];
      s.pid = e.pid; s.pos = e.pos; s.x = e.x; s.y = e.y; s.z = e.z; s.px = e.px; s.py = e.py; s.pz = e.pz;
      // ball flag from the ball itself (never two carriers, never a stale carrier after a re-spot)
      s.fa = e.fa; s.an = e.an; s.at = e.at; s.spd = e.spd; s.ball = (G.ball.st === 'held' || G.ball.st === 'dead') && G.ball.car === i && e.ball; s.ctl = e.ctl; s.hi = e.hi; s.sz = e.sz;
      s.num = e.info ? e.info.num : 0;
      s.en = (e.ctl && e.ball && G.phase === 'LIVE') ? e.energy / e.enMax : -1;
      s.badge = 0; s.star = 0;
    }
    // Star players v2 (ROUND6 A): 1 = my Star, 2 = enemy Star whose side is about to Surge (red glow), 3 = Surge active/armed
    const P0 = G.P, ST = PT.Engine.Stars;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      if (!e.info || !e.info.star) continue;
      let v = 0;
      if (P0 && P0.ab && P0.ab[e.tm] && ST.surging(G, e)) v = 3;
      else if (e.tm === G.userIdx) v = 1;
      else if (P0 && P0.aiPlan && P0.aiPlan[e.tm] && P0.stars && P0.stars[e.tm].indexOf(i) >= 0) v = 2;
      snap.ents[i].star = v;
    }
    // Easy Throw badges (1 WR1, 2 WR2, 3 TE, 4 RB) while the user's QB has the ball
    if (G.ctl >= 0 && G.P && G.P.qb === G.ctl && !G.P.thrown && G.ents[G.ctl].ball) {
      const o = G.poss * 7;
      snap.ents[o + 2].badge = 1; snap.ents[o + 3].badge = 2; snap.ents[o + 4].badge = 3; snap.ents[o + 1].badge = 4;
    }
    // Star meters + the active ability (user's first)
    const ui = G.userIdx >= 0 ? G.userIdx : 0, mu = snap.meters.u, ma = snap.meters.ai;
    mu.off = Math.round(G.meter[ui].off); mu.def = Math.round(G.meter[ui].def);
    ma.off = Math.round(G.meter[1 - ui].off); ma.def = Math.round(G.meter[1 - ui].def);
    snap.ability = null;
    if (P0 && P0.ab) {
      const ab = (P0.ab[ui] && P0.ab[ui].on) ? P0.ab[ui] : (P0.ab[1 - ui] && P0.ab[1 - ui].on) ? P0.ab[1 - ui] : null;
      if (ab) {
        const o = snap._ab; o.k = ab.k; o.side = ab.side; o.idx = ab.idx; o.t = ab.t; o.perfect = ab.perfect; o.tid = G.tids[ab.tm];
        o.name = (ab.names || []).join(' + ') || ST.NAME[ab.k]; o.names = ab.names || []; o.count = ab.mem ? ab.mem.length : 1;
        snap.ability = o;
      }
    }
    const st = G.star, ss = snap.star;
    ss.idx = st.idx; ss.ring = st.ring; ss.t = st.t; ss.win = st.win;
    const b = G.ball, sb = snap.ball;
    sb.x = b.x; sb.y = b.y; sb.z = b.z; sb.px = b.px; sb.py = b.py; sb.pz = b.pz; sb.st = b.st; sb.car = b.car; sb.sp = b.sp;
    // ROUND6 E: teleport frames (re-spot, snap to a shotgun QB, kickoff tee, PAT, turnover spot) — prev = current and tp = 1
    // so the renderer neither interpolates a streak across the field nor flashes; a real ball never moves 3 yd in a tick
    const jump = Math.abs(b.x - b.px) + Math.abs(b.y - b.py) + Math.abs(b.z - b.pz);
    if (b.tp || jump > 3) { sb.tp = 1; sb.px = b.x; sb.py = b.y; sb.pz = b.z; } else sb.tp = 0;
    sb.tx = b.lx; sb.ty = b.ly; sb.kind = b.kind;
    snap.los = G.los; snap.fd = G.fdY; snap.dir = G.dir; snap.poss = G.poss;
    snap.udir = G.userIdx >= 0 ? G.dirOf(G.userIdx) : G.dirOf(0);
    // route-line alpha by difficulty (design 9.3 / 16): Rookie & Pro settle at 30%, Legend fades out
    // play art fades on Legend (to 0) and Expert (to 0.25); aim arc 1 / 0.6 / 0.15 / 0 (Beginner → Legend)
    const fadeTo = G.diff >= 3 ? 0 : G.diff === 2 ? 0.25 : -1;
    snap.routeA = (G.phase === 'PRESNAP' && fadeTo >= 0 && G.pt > 1.5) ? Math.max(fadeTo, 1 - (G.pt - 1.5) * 2) : null;
    snap.aim.arc = G.diff === 0 ? 1 : G.diff === 1 ? 0.6 : G.diff === 2 ? 0.15 : 0;
    // camera hints
    const cam = snap.cam;
    if (cam.shake > 0) cam.shake = Math.max(0, cam.shake - 0.016 * 4);
    const ph = G.phase;
    if (ph === 'CALL' || ph === 'PRESNAP' || ph === 'PAT' || ph === 'BREAK') {
      cam.mode = 'presnap'; cam.fx = C.FIELD.MID_X; cam.fy = G.los + 5 * G.dir; cam.lead = 6; cam.zoom = 1.15;
      if (G.kickWait) { cam.mode = 'kick'; cam.fy = G.los + 8 * G.dir; }
    } else if (ph === 'KICK' || (b.st === 'air' && (b.kind === 'ko' || b.kind === 'punt' || b.kind === 'fg'))) {
      cam.mode = 'kick'; cam.fx = b.x; cam.fy = b.y; cam.zoom = 1.3; cam.lead = 0;
    } else if (ph === 'DEAD' && G.P && G.P.td) {
      cam.mode = 'celebrate';
    } else {
      cam.mode = 'follow';
      cam.fx = b.x; cam.fy = b.y; cam.lead = 6; cam.zoom = 1;
      // playtest: while the QB holds the ball behind the line on a pass play, pull out so the receivers (±20 yd wide,
      // 8–20 yd deep) stay on screen — at zoom 1 both WRs were off-screen in portrait and deep routes in landscape,
      // so a human could not see who was open. Ball carriers get a little extra room to see pursuit.
      const P = G.P;
      if (P && (P.kind === 'scrim' || P.kind === 'two') && b.st === 'held' && b.car === P.qb && !P.thrown && !P.crossed &&
        P.play && P.play.k !== 'run') cam.zoom = 1.6;
      else if (b.st === 'held') cam.zoom = 1.12;
      if (snap.aim.on) {
        const ddx = snap.aim.x - b.x, ddy = snap.aim.y - b.y, dd = Math.sqrt(ddx * ddx + ddy * ddy);
        cam.fx = b.x + ddx * 0.4; cam.fy = b.y + ddy * 0.4; cam.zoom = Math.min(1.6, Math.max(1, dd / 24));
      } else if (b.st === 'air') {
        cam.fx = (b.x + b.lx) * 0.5; cam.fy = (b.y + b.ly) * 0.5; cam.zoom = 1.15;
      }
    }
    // hud
    const h = snap.hud, sit = G.sitCache;
    // the yard-line string / FG % only change with the spot: recompute on change (no per-tick string allocation)
    const key = G.los * 8 + G.dir * 2 + G.poss + (G.tryTwo ? 4 : 0) + G.q * 1e4;
    if (sit._key !== key) { PT.Engine.Rules.situation(G, sit); sit._key = key; }
    h.q = G.q; h.half = G.q <= 2 ? 1 : G.q <= 4 ? 2 : 3; h.clk = Math.max(0, Math.ceil(G.clk - G.pend)); h.down = G.down; h.togo = G.togo; h.ballOn = sit.ballOn;
    h.hs = G.score[0]; h.as = G.score[1]; h.poss = G.poss; h.tos[0] = G.tos[0]; h.tos[1] = G.tos[1];
    h.pc = 0;   // no play clock: the user always snaps (client pass 5)
    h.hurry = G.userIdx >= 0 ? G.hurry[G.userIdx] : false; h.flip = G.flipNext; h.ot = G.q > 4;
    h.goal = sit.goal; h.two = G.tryTwo; h.onside = G.canOnside; h.fgPct = sit.fgPct;
    // returner hint for the UI: 'fc' = tap for a fair catch, 'tb' = tap to take a knee (touchback), '' = none
    const P = G.P;
    h.retHint = '';
    if (P && (P.kind === 'kickoff' || P.kind === 'punt') && G.ball.st === 'air' && G.userRet(1 - P.off) && !P.retCall) {
      if (P.kind === 'punt') h.retHint = 'fc';
      else { const RU = PT.Engine.Rules, rt = 1 - P.off; if ((G.ball.ly - RU.ownGoalY(G, rt)) * RU.dirOf(G, rt) <= 0) h.retHint = 'tb'; }
    }
    if (G.debug) S.writeDebug(G);
  };

  S.writeDebug = function (G) {
    const dbg = G.snap.dbg;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i], arr = dbg.routes[i];
      arr.length = 0;
      if (e.wpn > 0 && (e.role === PT.Engine.Entity.R.ROUTE || e.role === PT.Engine.Entity.R.LANE)) {
        for (let k = Math.max(0, e.wpi - 1); k < e.wpn; k++) { arr.push(e.wpx[k], e.wpy[k]); }
      }
    }
    const d = 1 - G.poss;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k], z = dbg.zones[k];
      z.on = e.ar > 0 && G.phase === 'LIVE'; z.x = e.ax; z.y = e.ay; z.r = e.ar;
    }
    dbg.targets.length = 0;
    if (G.ball.st === 'air') dbg.targets.push(G.ball.lx, G.ball.ly);
  };
})(globalThis.PT = globalThis.PT || {});
