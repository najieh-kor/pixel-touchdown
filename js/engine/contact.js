/* Pixel Touchdown: js/engine/contact.js
 * Owner: WP3. Responsibility: block engagement, tackle attempts, broken tackles, jukes/dives, injuries.
 * Design 8.11 (moves), 8.12 (tackles, fumbles), 8.13 (pass pro / run block duels), 12.1–12.4 (injuries), 7.4 (Edge).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const CT = PT.ns('Engine.Contact');
  const MID = C.FIELD.MID_X;

  // ---------------------------------------------------------------- blocks
  function protectPoint(G, out) {
    const b = G.ball;
    if (b.st === 'held') { const c = G.ents[b.car]; out.x = c.x; out.y = c.y; }
    else if (G.P && G.P.qb >= 0) { const q = G.ents[G.P.qb]; out.x = q.x; out.y = q.y; }
    else { out.x = b.x; out.y = b.y; }
    return out;
  }
  const pp = { x: 0, y: 0 };

  function isBlockerRole(r) {
    const R = PT.Engine.Entity.R;
    return r === R.PBLK || r === R.BLOCK || r === R.RBLK || r === R.ESCORT || r === R.KBLOCK || r === R.PSET || r === R.SELL;
  }
  CT.isBlockerRole = isBlockerRole;

  /** Start a duel between blocker b and defender d. */
  function engage(G, b, d) {
    const T = G.T, P = G.P, rng = G.rng, R = PT.Engine.Entity.R;
    const run = !(b.role === R.PBLK || b.role === R.BLOCK || b.role === R.PSET) || !!P.run || P.thrown || G.ball.st !== 'held' || G.ball.car !== P.qb;
    const edge = P.kind === 'scrim' ? (P.edge || 0) : 0;
    if (b.dside) return;
    b.eng = d.id; b.dside = false; d.dside = true;
    const first = d.eng < 0;
    if (first) { d.eng = b.id; d.engT = 0; } else if (d.eng2 < 0 && d.eng !== b.id) d.eng2 = b.id; else return;
    let t;
    if (!run) {
      t = T.TWIN * Math.pow(Math.max(1, b.block) / Math.max(1, d.rush), 1.2) * Math.max(0.5, rng.normal(1, T.TWIN_SD)) * (1 - 0.07 * edge);
      if (b.info.t.brick_wall) t += T.BRICK_WALL_T;
      if (b.info.q.builder) t += T.BUILDER_T;
      if (d.info.t.sack_master) t *= T.SACK_MASTER_W;
      if (d.info.q.horn) t -= T.HORN_T;
      if (P.play && P.play.screen && P.t < 1.4) t *= T.SCREEN_HOLD;
      // playtest: a human QB needs time to read + drag + wind up (~1.8–2.4 s); the AI QB throws faster
      if (b.tm === G.userIdx && G.human()) t = Math.max(T.USER_POCKET_MIN[G.diff], t * (T.USER_POCKET[G.diff] || 1) + (T.USER_POCKET_ADD[G.diff] || 0));   // + more decision time
      d.engWin = d.rush > b.block;
    } else {
      t = T.TSHED * Math.pow(Math.max(1, b.block) / Math.max(1, d.shed), 1.2) * Math.max(0.4, rng.normal(1, T.TSHED_SD)) * (1 - 0.10 * edge);
      if (b.info.t.road_grader) t += T.ROAD_GRADER_T;
      if (b.info.q.bigEars) t += T.BIG_EARS_T;
      if (G.twist.groundwar) t += 0.3;
      if (b.role === R.ESCORT || b.role === R.KBLOCK) t *= T.ESCORT_SHED;
      // perimeter stalk blocks (WR/TE on a CB/S) don't hold as long (HUNT5 #3: outside runs were too easy)
      if ((b.pos === 'WR1' || b.pos === 'WR2' || b.pos === 'TE') && (d.pos === 'CB1' || d.pos === 'CB2' || d.pos === 'S')) t *= T.STALK_SHED;
      d.engWin = d.shed > b.block;
    }
    t = Math.max(0.15, t);
    if (first) d.engMax = t; else d.engMax = Math.max(d.engMax, d.engT + (d.engMax - d.engT) * T.DOUBLE);
    d.engRun = run; b.engRun = run; d.pushed = 0;
    b.an = 'block'; b.at = 0;
  }

  function release(G, d, beaten) {
    const P = G.P;
    if (d.eng < 0) return;
    if (!d.dside) { const o = G.ents[d.eng]; if (o.dside && (o.eng === d.id || o.eng2 === d.id)) d = o; else { d.eng = -1; return; } }
    const b1 = d.eng >= 0 ? G.ents[d.eng] : null, b2 = d.eng2 >= 0 ? G.ents[d.eng2] : null;
    if (b1) { b1.eng = -1; if (beaten) { b1.beatT = P.t; b1.slowT = 0.3; } d.noEng = b1.id; }
    if (b2) { b2.eng = -1; if (beaten) b2.beatT = P.t; }
    d.eng = -1; d.eng2 = -1; d.dside = false; d.noEngT = G.T.REENGAGE_CD;
    if (beaten) { d.an = 'run'; d.at = 0; }
  }
  CT.release = release;

  /** Engagement acquisition + duel updates (after integration, before collisions). */
  CT.blocks = function (G, dt) {
    const T = G.T, ents = G.ents;
    // acquire
    for (let i = 0; i < 14; i++) {
      const b = ents[i];
      if (b.eng >= 0 || b.dside || b.downT > 0 || b.tgt < 0 || b.ball || !isBlockerRole(b.role)) continue;
      const d = ents[b.tgt];
      if (d.tm === b.tm || d.downT > 0 || d.ball || d.noEng === b.id || d.diveT > 0) continue;
      if (d.eng >= 0 && d.eng2 >= 0) continue;
      const rr = b.rad + d.rad + T.ENGAGE_PAD;
      const dx = d.x - b.x, dy = d.y - b.y;
      if (dx * dx + dy * dy <= rr * rr) engage(G, b, d);
    }
    // duels
    protectPoint(G, pp);
    for (let i = 0; i < 14; i++) {
      const d = ents[i];
      if (d.eng < 0 || !d.dside) continue;
      const b = ents[d.eng];
      if (b.eng !== d.id || b.downT > 0 || d.downT > 0) { release(G, d, false); continue; }
      // Pancake (Star Surge, OL): the block is won at once and held; the defender is driven back
      const pan = PT.Engine.Stars.active(G, b, 'pancake') || (d.eng2 >= 0 && PT.Engine.Stars.active(G, ents[d.eng2], 'pancake'));
      if (pan) { d.engT = 0; d.engWin = false; } else d.engT += dt;
      const ddx = d.x - b.x, ddy = d.y - b.y, dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d.engT >= d.engMax || dist > b.rad + d.rad + 1.2) { release(G, d, d.engT >= d.engMax); continue; }
      let ux = pp.x - d.x, uy = pp.y - d.y;
      const ul = Math.sqrt(ux * ux + uy * uy) || 1; ux /= ul; uy /= ul;
      let vx = 0, vy = 0;
      if (pan) {
        let px = b.pushX, py = b.pushY;
        if (px === 0 && py === 0) { px = -ux; py = -uy; }
        const pw = T.RUN_PUSH * T.AB_PANCAKE_PUSH * pan;
        vx = px * pw; vy = py * pw;
      } else if (!d.engRun) {
        // the blocker gives a little ground to set the pocket, more if the rusher is winning
        const give = (ul > 3.0 ? 1.6 : 0) + (d.engWin ? T.POCKET_PUSH : 0);
        vx = ux * give; vy = uy * give;
      } else if (!d.engWin) {
        let px = b.pushX, py = b.pushY;
        if (px === 0 && py === 0) { px = -ux; py = -uy; }
        const lim = d.info.q.heavy ? 1.0 : 99;
        const pw = T.RUN_PUSH * (b.asg && b.asg.push === 'out' ? 1.8 : 1);
        if (d.pushed < lim) { vx = px * pw; vy = py * pw; d.pushed += pw * dt; }
      } else { vx = ux * 0.5; vy = uy * 0.5; }
      d.dvx = vx; d.dvy = vy; d.vx = vx; d.vy = vy;
      // blocker sits in front of the defender (between him and the ball)
      const cd = b.rad + d.rad;
      b.x = d.x + ux * cd; b.y = d.y + uy * cd;
      b.vx = vx; b.vy = vy; b.dvx = vx; b.dvy = vy;
      b.fa = Math.atan2(ux, -uy); d.fa = Math.atan2(-ux, uy);
      b.an = 'block'; d.an = d.engRun ? 'block' : 'rush';
      if (d.eng2 >= 0) {
        const b2 = ents[d.eng2];
        if (b2.eng !== d.id) d.eng2 = -1;
        else { b2.x = d.x + (ux * 0.7 - uy * 0.7) * cd; b2.y = d.y + (uy * 0.7 + ux * 0.7) * cd; b2.vx = vx; b2.vy = vy; b2.an = 'block'; }
      }
    }
  };

  // ---------------------------------------------------------------- moves
  CT.juke = function (G, e) {
    const T = G.T;
    if (e.jukeCd > 0 || e.energy < T.JUKE.en || e.diveT > 0) return false;
    const AI = PT.Engine.AI;
    const n = AI.nearestOpp(G, e, e.x + e.vx * 0.3, e.y + e.vy * 0.3);
    let hx = e.vx, hy = e.vy;
    const hl = Math.hypot(hx, hy);
    if (hl < 0.5) { hx = 0; hy = AI.dirC(G, e); } else { hx /= hl; hy /= hl; }
    let sx = -hy, sy = hx;      // left of heading
    if (n >= 0) { const o = G.ents[n]; if ((o.x - e.x) * sx + (o.y - e.y) * sy > 0) { sx = -sx; sy = -sy; } }
    const v = T.JUKE.dist / T.JUKE.t;
    const cd = e.info.t.spin_doctor ? T.JUKE.cdShifty : T.JUKE.cd;            // 'Shifty' (id spin_doctor): 1.0 s cooldown
    e.jvx = sx * v; e.jvy = sy * v; e.jukeT = T.JUKE.t; e.jukeWin = T.JUKE.win; e.jukeCd = cd; e.jukeCdMax = cd; e.jukeSoft = T.JUKE.soft; e.energy -= T.JUKE.en;
    e.an = 'juke'; e.at = 0;
    // decision-time pass: defenders near a human's juke take a beat to react (they keep their old line)
    if (e.tm === G.userIdx && G.human()) {
      const d0 = (1 - e.tm) * 7;
      for (let k = 0; k < 7; k++) { const d = G.ents[d0 + k]; if (Math.hypot(d.x - e.x, d.y - e.y) < T.JUKE_REACT_R) d.jkT = T.JUKE_REACT[G.diff]; }
    }
    G.em.emit('juke', { pid: e.pid, x: e.x, y: e.y });
    PT.Engine.Snapshot.fx(G, 'juke', e.x, e.y, 0, 1, G.tids[e.tm], '');
    return true;
  };
  /** Dive (or QB slide past the LOS). The play ends at the landing spot. */
  CT.dive = function (G, e) {
    const T = G.T, P = G.P;
    if (e.diveT > 0 || !e.ball) return false;
    const dirC = PT.Engine.AI.dirC(G, e);
    const isQBslide = P.kind === 'scrim' && G.ball.car === P.qb && P.crossed;
    if (isQBslide) {
      e.an = 'dive'; e.at = 0;
      G.em.emit('dive', { pid: e.pid, x: e.x, y: e.y, slide: true });
      P.slide = true;
      CT.downAt(G, e.id, e.y, false, true);
      return true;
    }
    let hx = e.vx, hy = e.vy;
    const hl = Math.hypot(hx, hy);
    if (hl < 1) { hx = 0; hy = dirC; } else { hx /= hl; hy /= hl; }
    const v = e.diveL / T.DIVE_T;
    e.vx = hx * v; e.vy = hy * v; e.vz = 2.2; e.diveT = T.DIVE_T; e.z = 0.05;
    e.an = 'dive'; e.at = 0;
    P.dived = e.id;
    G.em.emit('dive', { pid: e.pid, x: e.x, y: e.y, slide: false });
    PT.Engine.Snapshot.fx(G, 'dive', e.x, e.y, 0, 1, G.tids[e.tm], '');
    return true;
  };

  // ---------------------------------------------------------------- end of carry
  /**
   * Carrier ci is down at field y (handles safety / touchback / regular spot). nofum: dive/slide/oob.
   */
  CT.downAt = function (G, ci, y, oob, nofum) {
    const P = G.P, RU = PT.Engine.Rules, c = G.ents[ci];
    const team = c.tm, og = RU.ownGoalY(G, team), dir = RU.dirOf(G, team);
    P.carrierEnd = ci;
    if (P.ret === ci) P.retEndY = y;
    if (team === P.off && P.offEndY == null) P.offEndY = y;
    if ((y - og) * dir <= 0) {
      if (P.tbOk) {
        if (P.kind === 'kickoff' || P.kind === 'punt') { P.retEndY = y; return G.whistle('touchback', team, y, oob); }
        return G.whistle('down', team, RU.ownYard(G, team, 20), oob);
      }
      return G.whistle('safety', team, og, oob);
    }
    G.whistle('down', team, PT.Util.clamp(y, 10.2, 109.8), oob);
  };

  /** TD / out-of-bounds check for the ball carrier. */
  CT.checkScore = function (G) {
    const b = G.ball, P = G.P, RU = PT.Engine.Rules, T = G.T;
    if (b.st !== 'held' || G.phase !== 'LIVE') return;
    const c = G.ents[b.car];
    const dir = RU.dirOf(G, c.tm), gy = RU.goalY(G, c.tm), og = RU.ownGoalY(G, c.tm);
    if (P.tbOk && (c.y - og) * dir > 0.6) P.tbOk = false;
    const oob = Math.abs(c.x - MID) > T.SIDELINE || c.y < 0 || c.y > 120;
    if (!oob && (c.y + (c.rad + 0.3) * dir - gy) * dir >= 0) {
      P.carrierEnd = b.car;
      if (P.ret === b.car) P.retEndY = gy;
      if (c.tm === P.off) P.offEndY = gy;
      c.an = 'celebrate'; c.at = 0;
      PT.Engine.Snapshot.fx(G, 'td', c.x, c.y, 0, 1, G.tids[c.tm], 'TOUCHDOWN!');
      PT.Engine.Snapshot.fx(G, 'confetti', c.x, gy, 0, 200, G.tids[c.tm], '');
      if (!G.fast) G.em.emit('bigPlay', { slowmo: 0.4, dur: 0.3, kind: 'td', user: c.tm === G.userIdx });
      return G.whistle('td', c.tm, gy, false);
    }
    if (oob) {
      const y = PT.Util.clamp(c.y, 0, 120);
      return CT.downAt(G, b.car, y, true, true);
    }
  };

  // ---------------------------------------------------------------- tackles
  CT.tackles = function (G, dt) {
    const T = G.T, b = G.ball, P = G.P, rng = G.rng;
    if (b.st !== 'held' || G.phase !== 'LIVE') return;
    const ci = b.car, c = G.ents[ci];
    if (c.diveT > 0) return;
    const d0 = (1 - c.tm) * 7;
    for (let k = 0; k < 7; k++) {
      const di = d0 + k, d = G.ents[di];
      if (d.downT > 0 || d.eng >= 0 || d.tkCd > 0) continue;
      const dx = c.x - d.x, dy = c.y - d.y, dist = Math.sqrt(dx * dx + dy * dy);
      let reach = d.rad + c.rad + T.TKL_PAD;
      if (d.diveT > 0 && d.diving) reach += T.DIVE_TKL_REACH * 0.5;
      if (G.star.idx === di && d.superT > 0) reach += T.STAR_SUPER_REACH;
      if (dist <= reach) {
        CT.attempt(G, di, ci, 0);
        if (G.phase !== 'LIVE' || G.ball.st !== 'held') return;
        continue;
      }
      // AI diving tackle (design 8.12)
      const gap = dist - d.rad - c.rad;
      if (d.diveT <= 0 && !d.ctl && gap >= T.DIVE_TKL_MIN && gap <= T.DIVE_TKL_MAX && c.spd > 5 && P.t > 0.6) {
        const ux = dx / dist, uy = dy / dist;
        const closing = (d.vx - c.vx) * ux + (d.vy - c.vy) * uy;
        const behind = (d.x - c.x) * c.vx + (d.y - c.y) * c.vy < 0 &&   // chasing from behind, not gaining, in the open field
          PT.Engine.AI.openField(G, c);
        if (behind && closing <= 1.0 && rng.chance(T.DIVE_TKL_P)) {
          // dive at where he will be (lead), limited by the dive length
          const lx = c.x + c.vx * T.DIVE_T - d.x, ly = c.y + c.vy * T.DIVE_T - d.y, ll = Math.sqrt(lx * lx + ly * ly) || 1;
          const v = Math.min(ll + 0.3, d.diveL + 1.0) / T.DIVE_T;
          d.vx = lx / ll * v; d.vy = ly / ll * v; d.vz = 2; d.z = 0.05; d.diveT = T.DIVE_T; d.diving = true;
          d.an = 'dive'; d.at = 0; G.tk.dive++;
        }
      }
    }
  };

  function anotherNear(G, c, except, r) {
    const d0 = (1 - c.tm) * 7;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d0 + k];
      if (e.id === except || e.downT > 0) continue;
      const dx = e.x - c.x, dy = e.y - c.y;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /**
   * Tackle attempt by defender di on carrier ci. Returns true if the carrier went down (or fumbled).
   */
  CT.attempt = function (G, di, ci, mode) {
    const T = G.T, P = G.P, rng = G.rng, d = G.ents[di], c = G.ents[ci], RU = PT.Engine.Rules;
    d.tkCd = T.TKL_CD;
    const edge = P.kind === 'scrim' ? (P.edge || 0) : 0;
    const star = G.star, isStar = star.idx === di;
    const dirC = RU.dirOf(G, c.tm);
    // QB committed to the throw: can't be sacked (late hit → roughing chance)
    if (P.kind === 'scrim' && ci === P.qb && P.windT > 0 && P.windSafe) return false;
    const isSack = P.kind === 'scrim' && ci === P.qb && !P.thrown && G.ball.car === ci && !P.crossed && !P.run && (c.y - P.los0) * dirC < 0.5 && !(P.play && (P.play.sneak || P.play.option || P.play.k === 'run'));   // a run stuffed before the handoff is not a sack (HUNT5 #10)
    if (isSack) {
      let pe = T.SACK_ESC_BASE + (c.r.pow - d.r.tkl) * 0.005 + (c.r.mov - 50) * 0.003 + (c.info.t.scrambler ? 0.10 : 0);
      pe = PT.Util.clamp(pe, T.SACK_ESC_MIN, T.SACK_ESC_MAX);
      if (c.tm === G.userIdx && G.human()) pe += T.USER_SACK_ESC[G.diff] || 0;     // playtest: human QBs get a "break free" chance
      if (isStar && d.superT > 0) pe *= 0.3;
      const dz = PT.Engine.Stars.active(G, d, 'bulldozer');
      if (dz) pe /= 1 + (T.AB_DOZER_TKL - 1) * dz;
      if (rng.chance(pe)) {
        G.tk.esc++;
        d.downT = T.SACK_FALL; d.an = 'down'; d.at = 0;
        G.em.emit('brokenTackle', { pid: c.pid, x: c.x, y: c.y, by: d.pid, escape: true });
        return false;
      }
      G.tk.sack++;
      P.sack = true; P.sackBy = di; P.tkBy = di;
      if (d.tm === G.userIdx) G.ustats.sacks++;
      const behind = ((d.x - c.x) * Math.sin(-c.fa) + (d.y - c.y) * Math.cos(c.fa)) < 0;
      CT.injuryCheck(G, c, T.INJ_SACK);
      c.an = 'tackled'; c.at = 0; d.an = 'tackle'; d.at = 0;
      G.snap.cam.shake = Math.max(G.snap.cam.shake, 0.3);
      PT.Engine.Snapshot.fx(G, 'hit', c.x, c.y, 1, 2, G.tids[d.tm], 'SACK!');
      G.em.emit('sack', { pid: c.pid, by: d.pid, x: c.x, y: c.y });
      const sackBig = Math.hypot(c.vx - d.vx, c.vy - d.vy) >= T.BIG_SACK_V && d.eng < 0 && behind;   // blindside / unblocked only (HUNT3 #6)
      G.em.emit('tackle', { carrier: c.pid, by: [d.pid], x: c.x, y: c.y, big: sackBig, sack: true });
      if (!G.fast) G.em.emit('bigPlay', { slowmo: 0.5, dur: 0.06, kind: 'hitstop', big: sackBig, user: c.tm === G.userIdx || d.tm === G.userIdx });
      if (CT.fumbleRoll(G, c, d, behind ? T.FUM_SACK_BEHIND : T.FUM_SACK_FRONT, true)) return true;
      CT.downAt(G, ci, c.y, false, false);
      return true;
    }
    G.tk.att++;
    // juke window (the spin move was removed — client: a juke now also softens the hit, less than a spin did)
    let jukeFail = false;
    const perkJ = (c.info.t.ankle_breaker ? 0.20 : 0) + (c.info.t.spin_doctor ? T.SHIFTY_DODGE : 0) + (c.info.q.juke || 0);
    if (c.jukeWin > 0) {
      const pm = PT.Util.clamp(0.45 + (c.r.mov - d.r.tkl) * 0.01 + perkJ, 0.15, 0.85);
      if (rng.chance(pm)) { whiffed(G, d, c); return false; }
      jukeFail = true;
    }
    let tkl = d.r.tkl;
    if (d.info.q.pack && anotherNear(G, c, di, 3)) tkl += 3;
    // playtest: tackles are reliable when the tackler is square and close; breaks come from real mismatches
    // (Power vs Tackle, a bigger body, an arm tackle from behind, Turbo/Bulldozer, a well-timed juke).
    const massD = c.mass - d.mass;                                          // S 1, M 2, L 3
    let pb = T.BRK_BASE + (c.r.pow - tkl) * T.BRK_POW + T.BRK_MASS * massD - T.BRK_EDGE * edge;
    if (c.info.t.truck_stick) pb += T.BRK_TRUCK;
    if (d.info.t.sure_tackler) pb -= T.BRK_SURE;
    const cvl = Math.hypot(c.vx, c.vy);
    if (cvl > 1) {
      const ux = (c.x - d.x), uy = (c.y - d.y), ul = Math.hypot(ux, uy) || 1;
      const cosA = (ux * c.vx + uy * c.vy) / (ul * cvl);                  // > 0: the tackler is behind the carrier
      if (cosA > 0.5) pb += T.BRK_BEHIND;                                  // arm tackle from behind
      else if (cosA < -0.3) pb -= T.BRK_SQUARE;                            // square, in front of him
      // a carrier at full speed through a side-on angle is harder to wrap up
      else if (cvl > c.top * 0.8) pb += T.BRK_SIDE;
    } else pb -= T.BRK_SQUARE;                                             // a stopped carrier is easy to wrap up
    if (d.ctl && d.tm === G.userIdx && G.human()) pb -= T.USER_TKL[G.diff] || 0;   // the user's own tackler is reliable
    if (d.diving) pb += T.DIVE_TKL_BRK;
    // a pass rusher fooled by the draw is out of position: only an arm tackle
    if (P.play && P.play.draw && !d.readDone && d.role === PT.Engine.Entity.R.RUSH) pb += T.DRAW_ARM;
    if (jukeFail) pb += T.JUKE_BRK;                                   // the dodge missed but he's moving: a slightly better chance to break
    if (isStar && d.superT > 0) pb -= T.STAR_SUPER_BRK;
    if (isStar && d.whiff) { pb += T.STAR_WHIFF_BRK; d.whiff = false; }
    if (P.kind === 'kickoff' || P.kind === 'punt') pb -= T.RET_TKL_BONUS;
    if (c.tm === G.userIdx) pb += T.EASY_BRK[G.diff];                       // Rookie: the user's carrier breaks a few more
    if (anotherNear(G, c, di, T.GANG_R)) pb *= T.BRK_GANG;
    const dz2 = PT.Engine.Stars.active(G, d, 'bulldozer');
    if (dz2) pb /= 1 + (T.AB_DOZER_TKL - 1) * dz2;                        // Bulldozer: tackle chance ×1.5
    if (c.turboBrk) { c.turboBrk = false; pb = 1; }                         // Turbo: the first tackle attempt is auto-broken
    if (!Number.isFinite(pb)) pb = T.BRK_BASE;                              // HUNT5 #2 guard: a bad tuning key can't silently zero breaks
    pb = PT.Util.clamp(pb, T.BRK_MIN, T.BRK_MAX);
    const closing = Math.hypot(c.vx - d.vx, c.vy - d.vy);
    // L tacklers hit harder (big hit sooner); only a clean, unblocked hit on a carrier who isn't spinning (HUNT3 #6)
    let big = closing >= T.BIG_HIT_V - T.BIG_HIT_MASS * (d.mass - 2) && d.eng < 0;
    if (big && c.jukeSoft > 0 && rng.chance(T.JUKE_SOFT)) big = false;     // a juke (up to JUKE.soft s after the press) halves big hits
    if (rng.chance(pb)) {
      G.tk.brk++;
      c.slowT = T.BRK_SLOW_T;
      d.downT = d.diving ? T.DIVE_MISS_DOWN : T.STUMBLE_T; d.an = 'down'; d.at = 0;
      if (c.tm === G.userIdx && c.ctl) G.ustats.brokenTackles++;
      G.em.emit('brokenTackle', { pid: c.pid, x: c.x, y: c.y, by: d.pid });
      PT.Engine.Snapshot.fx(G, 'text', c.x, c.y, 2, 1, G.tids[c.tm], 'BROKEN TACKLE!');
      CT.injuryCheck(G, c, T.INJ_BROKEN);
      CT.injuryCheck(G, d, T.INJ_BROKEN);
      return false;
    }
    // tackled
    P.tkBy = di;
    c.an = 'tackled'; c.at = 0; d.an = 'tackle'; d.at = 0;
    G.snap.cam.shake = Math.max(G.snap.cam.shake, big ? 0.2 : 0.08);
    PT.Engine.Snapshot.fx(G, 'hit', c.x, c.y, 0.8, big ? 2 : 1, G.tids[d.tm], '');
    G.em.emit('tackle', { carrier: c.pid, by: [d.pid], x: c.x, y: c.y, big: big });
    if (big && !G.fast) G.em.emit('bigPlay', { slowmo: 0.5, dur: 0.06, kind: 'hitstop', big: true, user: c.tm === G.userIdx || d.tm === G.userIdx });
    CT.injuryCheck(G, c, big ? T.INJ_BIG : 1);
    CT.injuryCheck(G, d, big ? T.INJ_BIG : 1);
    // facemask (design 8.15)
    if (P.kind === 'scrim' && rng.chance(T.PEN_FACE * RU.penMul(G, d)) && !P.pen) {
      P.pen = { kind: 'face', team: d.tm, yds: 15, txt: 'Facemask! +15 yards', fd: true, after: true };
    }
    if (CT.fumbleRoll(G, c, d, big ? T.FUM_BIG : 1, false)) return true;
    // fall forward
    const fwd = c.vy * dirC > 0.5;
    // a bigger carrier drags a smaller tackler forward; a heavy tackler stops him cold
    let fall = fwd ? T.FALL_FWD[c.sz] + T.DRAG_YD * Math.max(0, massD) - T.STONE_YD * Math.max(0, -massD) : 0;
    if (big && fall > 0) fall *= 0.5;
    if (fwd && massD >= 1 && !big) { G.em.emit('drag', { pid: c.pid, by: d.pid, yds: Math.round(fall) }); PT.Engine.Snapshot.fx(G, 'text', c.x, c.y, 2, 1, G.tids[c.tm], 'DRAGGED!'); }
    if (fwd && P.kind === 'scrim' && c.tm === P.off && RU.toGoal(G) <= 10 && (RU.goalY(G, c.tm) - c.y) * dirC <= 10) fall += T.RZ_PUSH;   // red zone: push the pile
    const y = c.y + Math.max(0, fall) * dirC;
    c.y = y;
    CT.downAt(G, ci, y, false, false);
    return true;
  };

  function whiffed(G, d, c) {
    G.tk.whf++;
    if (c.tm === G.userIdx && c.ctl) G.ustats.jukes++;
    d.downT = G.T.STUMBLE_T * 0.7; d.an = 'down'; d.at = 0;
    G.em.emit('brokenTackle', { pid: c.pid, x: c.x, y: c.y, by: d.pid, move: true });
    PT.Engine.Snapshot.fx(G, 'text', c.x, c.y, 2, 1, G.tids[c.tm], 'WHIFF!');
  }

  /** Fumble roll on a completed tackle (design 8.12). Returns true if the ball came loose. */
  CT.fumbleRoll = function (G, c, d, hit, sack) {
    const T = G.T, w = (G.cfg.weather || {}).k;
    let p = T.FUM_BASE * (1 - (c.r.hnd - 50) / 150) * hit;
    if (c.info.t.fumbley) p *= 2;
    if (c.info.q.fum) p *= c.info.q.fum;
    if (d.info.q.chomp) p *= 1.25;
    if (sack && d.info.t.sack_master) p += 0.10;
    if (w === 'rain') p *= 1.4; else if (w === 'snow') p *= 1.2;
    if (G.twist.butterfinger) p *= 1.3;
    if (c.tm === G.userIdx) p *= T.USER_FUM[G.diff];
    if (G.rng.chance(p)) { PT.Engine.Ball.fumble(G, c.id, d.id); return true; }
    return false;
  };

  /** Injury check (design 12.1). mult = hit multiplier. */
  CT.injuryCheck = function (G, e, mult) {
    const T = G.T, info = e.info;
    if (!info || info.out || G.drill) return;     // practice drills: nobody gets hurt
    let p = T.INJ_BASE * mult * (1 + Math.max(0, info.age - 29) * T.INJ_AGE);
    if (info.t.glass_bones) p *= 1.75;
    if (info.t.iron_hide) p *= 0.5;
    if (info.q.inj) p *= info.q.inj;
    const gt = G.teams[e.tm];
    if (gt.med) p *= 1 - 0.05 * (gt.med - 1);
    if ((G.cfg.weather || {}).k === 'snow') p *= 1.1;
    if (G.twist.injurybug) p *= 1.25;
    if (G.twist.ironyear) p *= 0.75;
    if (e.tm === G.userIdx) p *= T.USER_INJ[G.diff];
    if (!G.rng.chance(p)) return;
    let r = G.rng.next(), sev = 1;
    for (let i = 0; i < T.INJ_SEV.length; i++) { r -= T.INJ_SEV[i]; if (r < 0) { sev = i + 1; break; } }
    if (info.t.iron_hide && sev > 1) sev--;
    info.out = true; info.injured = true;
    if (sev === 1) info.backAt = G.teamPlays[e.tm] + G.rng.int(3, 8);
    PT.Box.injury(G.box, info.pid, sev);
    G.em.emit('injury', { pid: info.pid, tid: G.tids[e.tm], sev: sev, name: info.n });
    PT.Engine.Snapshot.fx(G, 'text', e.x, e.y, 2.2, 1, G.tids[e.tm], 'OUCH!');
  };
})(globalThis.PT = globalThis.PT || {});
