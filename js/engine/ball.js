/* Pixel Touchdown: js/engine/ball.js
 * Owner: WP3. Responsibility: ball states, pass flight (x,y + z arc), catch resolution, fumbles.
 * Design 8.9 (passing σ model, wind drift, batted balls, intended receiver), 8.10 (catch resolution, jump ball),
 * 8.12 (fumbles, recovery). Ball states: 'spot' | 'held' | 'air' | 'loose' | 'dead'; kind: 'pass'|'pitch'|'ko'|'punt'|'fg'|'onside'|''.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const BL = PT.ns('Engine.Ball');
  const MID = C.FIELD.MID_X;
  const cand = { n: 0, idx: new Int32Array(14) };
  BL._pr = { x: 0, y: 0 };
  const ST = () => PT.Engine.Stars;

  BL.create = function () {
    return { x: MID, y: 60, z: 0, px: MID, py: 60, pz: 0, vx: 0, vy: 0, vz: 0, st: 'spot', car: -1, sp: 0, kind: '',
      sx: 0, sy: 0, sz: 0, lx: 0, ly: 0, lz: 1.2, T: 1, t: 0, H: 0, team: 0, to: -1, looseT: 0, bounce: 0, tp: false };
  };

  BL.spot = function (G, x, y) {
    const b = G.ball;
    b.x = x; b.y = y; b.z = 0.15; b.st = 'spot'; b.car = -1; b.kind = ''; b.vx = b.vy = b.vz = 0;
    b.px = x; b.py = y; b.pz = 0.15; b.tp = true;                   // teleport frame (snapshot ball.tp = 1)
    for (let i = 0; i < 14; i++) G.ents[i].ball = false;
  };

  /** Give the ball to ent i. */
  BL.give = function (G, i) {
    const b = G.ball;
    for (let k = 0; k < 14; k++) G.ents[k].ball = false;
    b.st = 'held'; b.car = i; b.kind = ''; b.team = G.ents[i].tm;
    G.ents[i].ball = true;
    G.ents[i].carT = 0;
  };

  /** Effective arm: ball speed (yd/s) and max distance (design 8.9). */
  BL.ballSpeed = function (G, qb) {
    const T = G.T;
    let s = T.BALL_SPD_BASE + qb.r.arm * T.BALL_SPD_K;
    if (qb.info.t.rocket_arm) s *= T.ROCKET_SPD;
    if (G.twist.airshow) s *= T.AIR_SHOW_SPD;
    const lz = ST().active(G, qb, 'laser');
    if (lz) s *= 1 + T.AB_LASER_SPD * lz;
    return s;
  };
  BL.maxThrow = function (G, qb) {
    return G.T.MAX_THROW_BASE + qb.r.arm * G.T.MAX_THROW_K + (qb.info.t.rocket_arm ? G.T.ROCKET_DIST : 0);
  };

  /** Rushers within r yd of the QB. */
  BL.pressure = function (G, qb, r) {
    const d = 1 - qb.tm;
    let n = 0;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k];
      if (e.downT > 0) continue;
      const dx = e.x - qb.x, dy = e.y - qb.y;
      if (dx * dx + dy * dy <= r * r) n++;
    }
    return n;
  };

  /** Throw error σ (design 8.9). */
  BL.sigma = function (G, qb, d, easy, tx) {
    const T = G.T, w = G.cfg.weather || {};
    let s = (100 - qb.r.aim) / 25 * Math.pow(Math.max(d, 5) / 20, 0.7);
    if (d > T.LONG_SIG_D) s *= 1 + (d - T.LONG_SIG_D) / T.LONG_SIG_K;      // tuned: bombs are harder to place
    // playtest: only a QB who is actually being hit gets the full pressure penalty; a rusher close by costs a little
    if (BL.pressure(G, qb, T.SIG_HIT_R) > 0) s *= T.SIG_PRESSURE;
    else if (BL.pressure(G, qb, 2) > 0) s *= T.SIG_PRESS_NEAR;
    // throw on the run (client pass 4): ×(1 + SIG_RUN) at full speed, ×1 standing; rolling toward the throw side or a
    // Scrambler halves it
    const mv = Math.min(1, qb.spd / Math.max(1, qb.top));
    if (mv > 0.1) {
      let pen = T.SIG_RUN * mv;
      if (tx != null && Math.abs(qb.vx) > 1 && (tx - qb.x) * qb.vx > 0) pen *= T.SIG_ROLL;
      if (qb.info.t.scrambler) pen *= 0.5;
      s *= 1 + pen;
    }
    if (qb.info.t.dime_dropper && d >= 20) s *= T.SIG_DIME;
    if (w.k === 'rain') s *= T.SIG_RAIN;
    if (w.k === 'snow') s *= T.SIG_SNOW;
    if (w.k === 'wind' && d >= 20) s *= 1 + (w.mph || 0) / 100;
    if (qb.tm === G.userIdx && !G.idle) {
      s *= T.USER_SIG[G.diff];
      // short / medium throws are easier to place (full help to 15 yd, fading out by 28 yd)
      const sm = T.USER_SIG_SM[G.diff];
      s *= d <= 15 ? sm : d >= 28 ? 1 : sm + (1 - sm) * (d - 15) / 13;
    }
    else s *= T.AI_QB_SIG * (G.userIdx >= 0 ? T.EASY_AIQB_SIG[G.diff] : 1);     // Rookie: the AI QB is less accurate
    if (easy) s *= T.EASY_SIG;
    const lz = ST().active(G, qb, 'laser');
    if (lz) s *= Math.max(0.15, 1 - (1 - T.AB_LASER_SIG) * lz);
    return s;
  };

  /** Flight info for a throw from (x0,y0) to (x1,y1): fills out {t, apex}. */
  BL.flight = function (G, qb, x1, y1, lob, out) {
    const T = G.T;
    const d = Math.hypot(x1 - qb.x, y1 - qb.y);
    let sp = BL.ballSpeed(G, qb);
    if (lob) sp *= T.LOB_SPD;
    out.t = Math.max(T.MIN_FLIGHT, d / sp);
    out.apex = lob ? T.LOB_A + T.LOB_B * d : T.APEX_A + T.APEX_B * d;
    out.d = d;
    return out;
  };

  /** Commit a throw (wind-up starts; ball leaves after WINDUP). */
  BL.startThrow = function (G, qbIdx, tx, ty, lob, easy) {
    const P = G.P, qb = G.ents[qbIdx], T = G.T;
    if (P.thrown || P.windT > 0 || G.ball.car !== qbIdx) return false;
    const maxT = BL.maxThrow(G, qb);
    let dx = tx - qb.x, dy = ty - qb.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) return false;
    if (d > maxT) { tx = qb.x + dx / d * maxT; ty = qb.y + dy / d * maxT; }
    P.windT = qb.info.t.quick_release ? T.WINDUP_QR : T.WINDUP;
    P.thTx = tx; P.thTy = ty; P.thLob = !!lob; P.thEasy = !!easy;
    // a throw started with a rusher already on top of the QB is not "committed" (he can still be sacked in the wind-up)
    // playtest: a human who has released the drag expects the ball to come out (design 8.9: committed throws can't be
    // sacked). Only a rusher already in tackle reach (≤ WIND_SAFE_USER yd) can still get him; the AI keeps 2.6 yd.
    const safeR = qb.tm === G.userIdx && G.human() ? T.WIND_SAFE_USER : 2.6;
    P.windSafe = PT.Engine.AI.nearestOppDist(G, qb.tm, qb.x, qb.y, 0) > safeR;
    qb.an = 'throw'; qb.at = 0;
    return true;
  };

  BL._mg = { x: 0, y: 0, f: 1 };
  /**
   * Aim magnet (user throws): the receiver the drag points at (smallest angle off the aim line within ASSIST_ANG°,
   * drag length in range) or whose projected catch spot is within ASSIST yd of the aim point.
   * Writes his projected spot into out and returns his ent index (or −1). Also used for the aim preview (snap.aim.tgt).
   */
  BL.magnet = function (G, qb, tx, ty, lob, out) {
    const T = G.T, ar = T.ASSIST[G.diff], ang = T.ASSIST_ANG[G.diff];
    if (!(ar > 0)) return -1;
    const tmp = G.tmpFl;
    BL.flight(G, qb, tx, ty, lob, tmp);
    const ax = tx - qb.x, ay = ty - qb.y, al = Math.hypot(ax, ay) || 1;
    let best = -1, bs = 1e9;
    const o = qb.tm * 7, pr = BL._pr;
    for (let k = 1; k <= 4; k++) {
      const r = G.ents[o + k];
      if (!BL.eligible(G, r)) continue;
      PT.Engine.Routes.project(G, r, tmp.t + 0.05, pr);
      const dd = Math.hypot(pr.x - tx, pr.y - ty);
      const rx = pr.x - qb.x, ry = pr.y - qb.y, rl = Math.hypot(rx, ry) || 1;
      const da = Math.acos(Math.max(-1, Math.min(1, (ax * rx + ay * ry) / (al * rl)))) * 57.2958;
      // the cone only counts when the drag length is in range (no magnet to a 40-yd bomb from a 5-yd flick)
      const lenOk = al >= rl * 0.55 && al <= rl * 1.6 + 4;
      let sc = 1e9;
      if (dd < ar * T.ASSIST_SOFT) sc = dd / ar;
      if (lenOk && da < ang * T.ASSIST_SOFT) sc = Math.min(sc, da / ang + 0.15);
      if (sc < bs) { bs = sc; best = o + k; out.x = pr.x; out.y = pr.y; }
    }
    // full lock inside the radius / cone; a partial lead toward his catch spot just outside it (drag close to his path)
    out.f = bs <= 1 ? 1 : Math.max(0, (T.ASSIST_SOFT - bs) / (T.ASSIST_SOFT - 1)) * T.ASSIST_SOFT_F;
    if (out.f <= 0) return -1;
    return best;
  };

  /** Ball leaves the hand: σ, landing point, intended receiver, batted balls. */
  BL.release = function (G) {
    const P = G.P, T = G.T, b = G.ball, qb = G.ents[P.qb], rng = G.rng, w = G.cfg.weather || {};
    let tx = P.thTx, ty = P.thTy;
    const d0 = Math.hypot(tx - qb.x, ty - qb.y);
    const sig = BL.sigma(G, qb, d0, P.thEasy, tx);
    // aim assist (user, non-easy): magnet to the receiver the drag points at
    if (qb.tm === G.userIdx && !P.thEasy && !G.idle) {
      const m = BL.magnet(G, qb, tx, ty, P.thLob, BL._mg);
      if (m >= 0) { const f = BL._mg.f; tx += (BL._mg.x - tx) * f; ty += (BL._mg.y - ty) * f; }
    }
    P.thTx = tx; P.thTy = ty;
    let lx = tx + rng.normal(0, sig), ly = ty + rng.normal(0, sig);
    const fl = BL.flight(G, qb, lx, ly, P.thLob, G.tmpFl);
    if (w.mph && (w.wx || w.wy)) {
      const wl = Math.hypot(w.wx, w.wy) || 1;
      const drift = w.mph * T.WIND_DRIFT * fl.t;
      lx += w.wx / wl * drift; ly += w.wy / wl * drift;
    }
    b.st = 'air'; b.kind = 'pass'; b.car = -1; b.team = qb.tm;
    b.sx = qb.x; b.sy = qb.y; b.sz = T.RELEASE_Z; b.lx = lx; b.ly = ly; b.lz = T.ARRIVE_Z;
    b.T = BL.flight(G, qb, lx, ly, P.thLob, G.tmpFl).t; b.t = 0;
    b.H = G.tmpFl.apex - (b.sz + b.lz) / 2;
    qb.ball = false;
    P.thrown = true; P.relT = P.t; P.lob = P.thLob; P.undercut = 0; P.sig = sig;
    P.passDist = Math.hypot(lx - qb.x, ly - qb.y);
    // intended receiver: who reaches the landing point soonest
    let best = -1, bt = 1e9;
    const o = qb.tm * 7;
    for (let k = 1; k <= 4; k++) {
      const r = G.ents[o + k];
      if (!BL.eligible(G, r)) continue;
      const dd = Math.max(0, Math.hypot(r.x - lx, r.y - ly) - r.reach);
      const tt = dd / r.top;
      if (tt < bt) { bt = tt; best = o + k; }
    }
    P.tgt = best;
    if (best >= 0) { const r = G.ents[best]; r.goBallT = P.t + r.react * 0.5 * (G.spiritFast[r.tm] ? 0.8 : 1); }
    P.breakT = P.t;     // defenders compute their own delay
    G.em.emit('throw', { from: qb.pid, to: best >= 0 ? G.ents[best].pid : null, x: lx, y: ly, power: P.passDist / BL.maxThrow(G, qb), lob: P.lob });
    // batted ball
    const d = 1 - qb.tm;
    const hx = (lx - qb.x) / (P.passDist || 1), hy = (ly - qb.y) / (P.passDist || 1);
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k];
      if (e.downT > 0) continue;
      const ex = e.x - qb.x, ey = e.y - qb.y;
      if (ex * ex + ey * ey > T.BAT_RANGE * T.BAT_RANGE || ex * hx + ey * hy <= 0) continue;
      if (rng.chance(T.BAT[e.sz] || 0.03)) {
        P.batted = true;
        b.lx = qb.x + hx * 2 + rng.range(-1.5, 1.5); b.ly = qb.y + hy * 2; b.T = 0.5; b.H = 1.5;
        if (rng.chance(T.BAT_PICK)) P.batPick = d * 7 + k;
        G.em.emit('batted', { pid: e.pid, x: e.x, y: e.y });
        PT.Engine.Snapshot.fx(G, 'text', e.x, e.y, 2.5, 1, G.tids[e.tm], 'BATTED!');
        break;
      }
    }
    // roughing window
    P.roughT = P.t + 0.3;
  };

  BL.eligible = function (G, r) {
    const R = PT.Engine.Entity.R;
    if (r.downT > 0) return false;
    if (r.role === R.PBLK || r.role === R.BLOCK || r.role === R.RBLK || r.role === R.FAKE) return false;
    return r.pos === 'RB' || r.pos === 'WR1' || r.pos === 'WR2' || r.pos === 'TE';
  };

  /** Handoff (instant) from ent a to ent b. */
  BL.handoff = function (G, a, b) {
    BL.give(G, b);
    const P = G.P;
    P.rusher = b; P.run = true; P.runT = P.t;
    G.em.emit('handoff', { from: G.ents[a].pid, to: G.ents[b].pid, x: G.ents[b].x, y: G.ents[b].y, power: 0 });
    PT.Engine.AI.onBallChange(G);
  };

  /** Pitch / toss: short flight to a receiver who catches automatically. */
  BL.pitch = function (G, a, bIdx, dur) {
    const b = G.ball, from = G.ents[a], to = G.ents[bIdx];
    from.ball = false;
    b.st = 'air'; b.kind = 'pitch'; b.car = -1; b.to = bIdx; b.team = from.tm;
    b.sx = from.x; b.sy = from.y; b.sz = 1.2;
    b.lx = to.x + to.vx * dur; b.ly = to.y + to.vy * dur; b.lz = 1.1; b.T = dur; b.t = 0; b.H = 0.4;
    G.em.emit('handoff', { from: from.pid, to: to.pid, x: from.x, y: from.y, power: 0.3, pitch: true });
  };

  /** Fumble: ball pops loose from the carrier. */
  BL.fumble = function (G, ci, byIdx) {
    const b = G.ball, c = G.ents[ci], rng = G.rng, P = G.P;
    c.ball = false;
    b.st = 'loose'; b.kind = ''; b.car = -1; b.team = c.tm; b.looseT = 0;
    const ang = rng.range(0, Math.PI * 2), dist = rng.range(1, 4);
    b.sx = c.x; b.sy = c.y; b.lx = c.x + Math.cos(ang) * dist; b.ly = c.y + Math.sin(ang) * dist; b.T = G.T.LOOSE_T; b.t = 0; b.H = 0.6;
    b.sz = 0.8; b.lz = 0.1;
    P.fumBy = ci; P.ffBy = byIdx;
    if (P.offEndY == null && c.tm === P.off) P.offEndY = c.y;
    G.em.emit('fumble', { pid: c.pid, by: byIdx >= 0 ? G.ents[byIdx].pid : -1, x: c.x, y: c.y });
    PT.Engine.Snapshot.fx(G, 'fumble', c.x, c.y, 1, 1, G.tids[c.tm], 'FUMBLE!');
    G.snap.cam.shake = Math.max(G.snap.cam.shake, 0.2);
    G.ctl = -1;
    PT.Engine.AI.onBallChange(G);
  };

  /** Per-tick ball update (before physics). */
  BL.update = function (G, dt) {
    const b = G.ball, P = G.P;
    b.px = b.x; b.py = b.y; b.pz = b.z;
    if (P && P.windT > 0) {
      P.windT -= dt;
      if (P.windT <= 0) { P.windT = 0; BL.release(G); }
    }
    if (b.st === 'held') {
      const c = G.ents[b.car];
      if (!c.ball) { for (let k = 0; k < 14; k++) G.ents[k].ball = false; c.ball = true; }   // keep one carrier, the right one
      b.x = c.x - Math.sin(c.fa) * 0.25; b.y = c.y + Math.cos(c.fa) * 0.25; b.z = c.z + (c.an === 'throw' ? 1.6 : 0.9);
      b.sp += dt * 2;
    } else if (b.st === 'air' || b.st === 'loose') {
      b.t += dt;
      const s = Math.min(1, b.t / b.T);
      b.x = b.sx + (b.lx - b.sx) * s; b.y = b.sy + (b.ly - b.sy) * s;
      b.z = b.sz + (b.lz - b.sz) * s + 4 * b.H * s * (1 - s);
      b.sp += dt * 12;
      if (b.st === 'air' && b.kind === 'pass') {
        if (s >= 0.75) BL.undercutScan(G);
        if (s >= 1) BL.arrive(G);
      } else if (b.st === 'air' && b.kind === 'pitch') {
        if (s >= 1) BL.pitchArrive(G);
      } else if (b.st === 'loose') {
        if (b.t >= b.T) BL.recover(G);
      }
    }
  };

  /** Defenders near the ball path in the last 25% of the flight become candidates (undercut). */
  BL.undercutScan = function (G) {
    const b = G.ball, P = G.P, d = 1 - b.team;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k];
      if (e.downT > 0) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      if (dx * dx + dy * dy <= e.reach * e.reach && b.z <= e.jumpH) P.undercut |= (1 << k);
    }
  };

  BL.pitchArrive = function (G) {
    const b = G.ball, to = G.ents[b.to], P = G.P;
    if (P.tossBack && G.rng.chance(0.02)) { b.x = to.x; b.y = to.y; BL.fumble(G, b.to, -1); return; }
    BL.give(G, b.to);
    if (!P.tossBack) { P.rusher = b.to; P.run = true; P.runT = P.t; PT.Engine.AI.onBallChange(G); }
    else { G.P.qbBack = true; P.run = false; P.runT = 1e9; PT.Engine.AI.recoverCoverage(G); }
  };

  function inBounds(x, y) { return Math.abs(x - MID) <= 26.65 && y >= 0 && y <= 120; }

  /** Pass arrives: resolve catch / drop / pick / incomplete (design 8.10). */
  BL.arrive = function (G) {
    const b = G.ball, P = G.P, T = G.T, rng = G.rng;
    const o = b.team, d = 1 - o, lx = b.x, ly = b.y;
    const edge = P.edge || 0;
    const wx = (G.cfg.weather || {}).k;
    if (!inBounds(lx, ly)) return BL.incomplete(G, 'out', -1);
    if (P.batted) {
      if (P.batPick >= 0 && G.ents[P.batPick].downT <= 0) return BL.caught(G, P.batPick, true, true);
      return BL.incomplete(G, 'defended', -1);
    }
    // candidates
    let offN = 0, defN = 0;
    cand.n = 0;
    const star = G.star;
    const hail = P.play && P.play.hail;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      if (e.downT > 0 && e.diveT <= 0) continue;
      const dx = e.x - lx, dy = e.y - ly, dd = Math.sqrt(dx * dx + dy * dy);
      let reach = e.reach;
      if (hail) reach = Math.max(reach, T.HAIL_R);
      const mg = ST().active(G, e, 'magnet');
      if (mg) reach += T.AB_MAGNET_REACH * mg;
      if (e.diveT > 0) reach += 0.6;
      const isOff = e.tm === o;
      if (isOff) { if (!BL.eligible(G, e) && !(e.role === PT.Engine.Entity.R.CARRIER)) continue; }
      let ok = dd <= reach;
      if (!isOff && !ok && (P.undercut & (1 << (i - d * 7)))) ok = true;
      if (!isOff && star.idx === i && star.superJump && dd <= reach + 1.5) ok = true;
      if (!ok) continue;
      cand.idx[cand.n++] = i;
      if (isOff) offN++; else defN++;
    }
    if (cand.n === 0) return BL.incomplete(G, 'overthrown', -1);
    const dist = (i) => Math.hypot(G.ents[i].x - lx, G.ents[i].y - ly);
    if (hail && offN + defN > 1) {
      let best = -1, bs = -1e9;
      for (let c = 0; c < cand.n; c++) {
        const e = G.ents[cand.idx[c]];
        const s = (e.tm === o ? BL.rScore(G, e, null) : BL.dScore(G, e, edge, 0)) + rng.range(0, 20);
        if (s > bs) { bs = s; best = cand.idx[c]; }
      }
      if (G.ents[best].tm === o) return BL.caught(G, best, true, false);
      if (rng.chance(0.5)) return BL.caught(G, best, true, true);
      P.pdBy = best;
      return BL.incomplete(G, 'defended', best);
    }
    if (defN === 0) {
      // uncontested: closest offensive candidate
      let r = -1, rd = 1e9;
      for (let c = 0; c < cand.n; c++) { const dd = dist(cand.idx[c]); if (dd < rd) { rd = dd; r = cand.idx[c]; } }
      const e = G.ents[r];
      const air = P.passDist || 0;
      let p = PT.Util.clamp(T.UNCON_BASE + (e.r.hnd - 70) * T.UNCON_HND - T.UNCON_OFF * rd - Math.max(0, air - T.DEEP_CATCH_D) * T.DEEP_CATCH_K, T.UNCON_MIN, T.UNCON_MAX);
      if (G.twist.airshow) p = Math.min(0.99, p + 0.03);
      let drop = 1 - p;
      if (e.info.t.stone_hands) drop *= 1.6;
      if (e.info.t.glue_paws) drop *= 0.5;
      if (e.info.q.drop) drop *= e.info.q.drop;
      if (ST().active(G, e, 'magnet')) drop = 0;                   // Magnet Hands: can't drop
      if (wx === 'rain') drop *= 1.3;
      if (rng.chance(drop)) return BL.incomplete(G, 'drop', -1, r);
      return BL.caught(G, r, false, false);
    }
    if (offN === 0) {
      // only defenders
      let dfi = -1, dd0 = 1e9;
      for (let c = 0; c < cand.n; c++) { const dd = dist(cand.idx[c]); if (dd < dd0) { dd0 = dd; dfi = cand.idx[c]; } }
      const e = G.ents[dfi];
      let p = PT.Util.clamp(T.DPICK_BASE + (e.r.hnd - 50) * T.DPICK_K, T.DPICK_MIN, T.DPICK_MAX);
      if (o === G.userIdx) p *= T.EASY_PICK[G.diff];
      if (star.idx === dfi && star.superJump) p = Math.min(0.95, p + T.STAR_JUMP_PICK);
      const ldD = ST().active(G, e, 'lockdown');
      if (ldD) p = Math.min(0.95, p * (1 + (T.AB_LOCK_INT - 1) * ldD));
      if (rng.chance(p)) return BL.caught(G, dfi, false, true);
      P.pdBy = dfi;
      return BL.incomplete(G, 'defended', dfi);
    }
    // contested: best receiver vs best defender
    let r = -1, rd = 1e9, dfi = -1, dfd = 1e9;
    for (let c = 0; c < cand.n; c++) {
      const i = cand.idx[c], dd = dist(i);
      if (G.ents[i].tm === o) { if (dd < rd) { rd = dd; r = i; } } else if (dd < dfd) { dfd = dd; dfi = i; }
    }
    const re = G.ents[r], de = G.ents[dfi];
    let R = BL.rScore(G, re, de);
    let D = BL.dScore(G, de, edge, defN - 1);
    if (rd + 0.5 < dfd) R += 10; else if (dfd + 0.5 < rd) D += 10;
    if (star.idx === dfi) { if (star.superJump) D += T.STAR_JUMP_D; else if (star.whiffD) D -= T.STAR_WHIFF_D; }
    const diff = R - D;
    let pc = PT.Util.clamp(T.CON_BASE + T.CON_K * diff - Math.max(0, (P.passDist || 0) - T.DEEP_CATCH_D) * T.DEEP_CON_K, T.CON_MIN, T.CON_MAX);
    if (o === G.userIdx && G.human()) pc += T.EASY_CON[G.diff];
    if ((ly - PT.Engine.Rules.goalY(G, o)) * PT.Engine.Rules.dirOf(G, o) >= 0) pc += T.RZ_CON;   // end-zone fades / jump balls             // playtest: the user's receivers win more 50/50 balls
    const mgC = ST().active(G, re, 'magnet');
    if (mgC) pc = Math.min(0.97, pc * (1 + (T.AB_MAGNET_WIN - 1) * mgC));
    let pp = PT.Util.clamp(T.PICK_BASE - T.PICK_K * diff, T.PICK_MIN, T.PICK_MAX) * (de.r.hnd / 70);
    if (o === G.userIdx) pp *= T.EASY_PICK[G.diff];
    if (de.info.t.ball_hawk) pp *= 1.5;
    if (de.info.q.int) pp *= de.info.q.int;
    const ldC = ST().active(G, de, 'lockdown');
    if (ldC) { pp *= 1 + (T.AB_LOCK_INT - 1) * ldC; if (mgC) pp *= 0.5; }
    if (star.idx === dfi && star.superJump) pp += T.STAR_JUMP_PICK;
    const roll = rng.next();
    if (roll < pc) return BL.caught(G, r, true, false);
    if (roll < pc + pp) return BL.caught(G, dfi, true, true);
    P.pdBy = dfi;
    // pass interference (design 8.15)
    if (D - R > 15 && rng.chance(T.PEN_PI * PT.Engine.Rules.penMul(G, de))) {
      P.pen = { kind: 'pi', team: d, yds: 0, txt: 'Pass interference! First down', spot: ly, fd: true };
    }
    return BL.incomplete(G, 'defended', dfi);
  };

  BL.rScore = function (G, e, de) {
    let R = e.r.hnd * 0.7 + e.r.smt * 0.3 + (de ? 4 * (e.mass - de.mass) : 0);
    if (e.info.t.glue_paws) R += 12;
    if (e.info.t.stone_hands) R -= 8;
    if ((G.cfg.weather || {}).k === 'rain') R -= 6;
    return R;
  };
  BL.dScore = function (G, e, edge, extra) {
    return e.r.cov * 0.7 + e.r.smt * 0.3 + 4 * edge + 5 * extra;
  };

  /** Completed pass or interception. */
  BL.caught = function (G, i, contested, pick) {
    const P = G.P, e = G.ents[i], b = G.ball;
    BL.give(G, i);
    e.an = 'catch'; e.at = 0; e.carT = 0;
    if (pick) {
      P.picked = true; P.pickBy = i; P.turnY = e.y;
      if (e.tm === G.userIdx) G.ustats.ints++;
      const RU = PT.Engine.Rules;
      P.tbOk = (e.y - RU.ownGoalY(G, e.tm)) * RU.dirOf(G, e.tm) <= 0;
      PT.Engine.Snapshot.fx(G, 'pick', e.x, e.y, 2, 1, G.tids[e.tm], 'PICK!');
      G.snap.cam.shake = Math.max(G.snap.cam.shake, 0.15);
    } else {
      P.compl = true; P.catcher = i;
      PT.Engine.Snapshot.fx(G, 'catch', e.x, e.y, 1.5, 1, G.tids[e.tm], '');
    }
    G.em.emit('catch', { pid: e.pid, x: e.x, y: e.y, contested: !!contested, yac: 0, int: !!pick });
    PT.Engine.AI.onBallChange(G);
    b.x = e.x; b.y = e.y;
    // TD on the catch?
    PT.Engine.Contact.checkScore(G);
    if (G.phase !== 'LIVE') return;
    // immediate tackle if a defender is right there
    const d = 1 - e.tm;
    for (let k = 0; k < 7; k++) {
      const df = G.ents[d * 7 + k];
      if (df.downT > 0 || df.eng >= 0) continue;
      if (Math.hypot(df.x - e.x, df.y - e.y) <= G.T.CATCH_TACKLE_R + df.rad) { PT.Engine.Contact.attempt(G, d * 7 + k, i, 0); if (G.phase !== 'LIVE') return; break; }
    }
  };

  BL.incomplete = function (G, reason, by, target) {
    const P = G.P;
    const tgt = target != null ? target : P.tgt;
    P.incDesc = reason === 'drop' ? 'Dropped!' : reason === 'defended' ? 'Broken up!' : reason === 'out' ? 'Out of bounds' : 'Incomplete';
    G.em.emit('incomplete', { target: tgt >= 0 ? G.ents[tgt].pid : null, reason: reason });
    PT.Engine.Snapshot.fx(G, 'text', G.ball.x, G.ball.y, 2, 1, -1, reason === 'drop' ? 'DROP!' : 'INCOMPLETE');
    G.ball.st = 'dead';
    G.whistle('inc', P.off, P.los0, false);
  };

  /** Loose ball: nearest player recovers (design 8.12, P0: dead at recovery). */
  BL.recover = function (G) {
    const b = G.ball, P = G.P, rng = G.rng;
    let best = -1, bd = 1e9, second = -1, sd = 1e9;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      if (e.downT > 0.3) continue;
      const dd = Math.hypot(e.x - b.x, e.y - b.y);
      if (dd < bd) { second = best; sd = bd; best = i; bd = dd; } else if (dd < sd) { second = i; sd = dd; }
    }
    if (best < 0) best = 0;
    if (second >= 0 && sd - bd < 0.5 && rng.chance(0.5)) best = second;
    const e = G.ents[best];
    let team = e.tm, y = b.y;
    if (Math.abs(b.x - MID) > 26.65) { team = b.team; }      // out of bounds: last team in possession keeps it
    P.frBy = best;
    P.carrierEnd = best;
    G.em.emit('recover', { pid: e.pid, tid: G.tids[team], x: b.x, y: b.y });
    // fumble return (design P1): the other team scoops it on the run and the play goes on
    const RU0 = PT.Engine.Rules;
    if (team !== b.team && team === e.tm && G.phase === 'LIVE' && e.downT <= 0 && bd < 1.5 && !P.fumRet && rng.chance(G.T.FUM_RET) &&
        (P.kind === 'scrim' || P.kind === 'kickoff' || P.kind === 'punt')) {
      P.fumRet = true; P.turnY = b.y;
      P.tbOk = (b.y - RU0.ownGoalY(G, team)) * RU0.dirOf(G, team) <= 0;
      BL.give(G, best);
      e.an = 'catch'; e.at = 0;
      PT.Engine.Snapshot.fx(G, 'text', e.x, e.y, 2.2, 1, G.tids[team], 'SCOOP!');
      PT.Engine.AI.onBallChange(G);
      return;
    }
    b.st = 'dead';
    // scoring at recovery
    const RU = PT.Engine.Rules;
    if (P.kind === 'scrim' || P.kind === 'two' || P.kind === 'kickoff' || P.kind === 'punt') {
      const gy = RU.goalY(G, team), og = RU.ownGoalY(G, team), dir = RU.dirOf(G, team);
      if ((y - gy) * dir >= 0 && y >= 0 && y <= 120) return G.whistle('td', team, gy, false);
      if ((y - og) * dir <= 0) {
        const off = P.off;
        if (team === off && P.kind !== 'kickoff' && P.kind !== 'punt') return G.whistle('safety', team, og, false);
        return G.whistle(P.kind === 'kickoff' || P.kind === 'punt' ? 'touchback' : 'down', team, RU.ownYard(G, team, 20), false);
      }
    }
    G.whistle('down', team, PT.Util.clamp(y, 10.5, 109.5), false);
  };
})(globalThis.PT = globalThis.PT || {});
