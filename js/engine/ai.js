/* Pixel Touchdown: js/engine/ai.js
 * Owner: WP3. Responsibility: role behaviors: block, rush, cover (man/zone), pursue, carry, return.
 * Design 6.5 (routes/escort), 7.1–7.4 (assignments, Edge), 8.13 (line play, coverage, pursuit), 8.14 (AI carriers),
 * 8.4/8.5 (kick coverage/returns). Sets desired velocities only; physics integrates.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const AI = PT.ns('Engine.AI');
  const MID = C.FIELD.MID_X;
  let R = null, Ph = null, RT = null;
  const tmp = { x: 0, y: 0 };

  function init() { R = PT.Engine.Entity.R; Ph = PT.Engine.Physics; RT = PT.Engine.Routes; }

  AI.dirC = function (G, e) { return PT.Engine.Rules.dirOf(G, e.tm); };

  /** Nearest standing opponent of e to point (x,y). @returns {number} ent index or -1 */
  AI.nearestOpp = function (G, e, x, y) {
    const o = (1 - e.tm) * 7;
    let best = -1, bd = 1e9;
    for (let k = 0; k < 7; k++) {
      const d = G.ents[o + k];
      if (d.downT > 0) continue;
      const dx = d.x - x, dy = d.y - y, dd = dx * dx + dy * dy;
      if (dd < bd) { bd = dd; best = o + k; }
    }
    return best;
  };
  AI.nearestOppDist = function (G, tm, x, y, lookT) {
    const o = (1 - tm) * 7;
    let bd = 1e9;
    for (let k = 0; k < 7; k++) {
      const d = G.ents[o + k];
      if (d.downT > 0) continue;
      const dx = d.x + d.vx * lookT - x, dy = d.y + d.vy * lookT - y, dd = dx * dx + dy * dy;
      if (dd < bd) bd = dd;
    }
    return Math.sqrt(bd);
  };

  /** Defender reaction time for this play (design 4.1 + Edge 7.4). */
  AI.react = function (G, e) {
    const T = G.T, edge = G.P.kind === 'scrim' ? G.P.edge || 0 : 0;
    let rt = (e.react - 0.05 * edge) * (e.tm !== G.P.off ? (e.reactMul || 1) : 1);
    if (e.tm !== G.userIdx && G.userIdx >= 0) rt += T.EASY_REACT[G.diff];    // Rookie: AI defenders read a beat late
    if (e.tm !== G.P.off) {
      rt += T.AB_LASER_REACT * PT.Engine.Stars.offLaser(G);                  // Laser: the throw beats their eyes
      if (PT.Engine.Stars.active(G, e, 'lockdown')) rt *= 0.5;               // Lockdown: breaks on the ball twice as fast
      // misdirection: trick plays (options, reverses, end-arounds, statue) freeze defenders a beat (style balance)
      const pl = G.P.play;
      if (pl && pl.type === 'TRICK') rt += T.TRICK_REACT;
    }
    return rt < T.REACT_MIN ? T.REACT_MIN : rt > T.REACT_MAX ? T.REACT_MAX : rt;
  };

  /** The ball changed hands: reassign roles. */
  AI.onBallChange = function (G) {
    if (!R) init();
    const b = G.ball, P = G.P;
    if (b.st === 'held') {
      const c = G.ents[b.car];
      const ct = c.tm;
      c.role = R.CARRIER; c.thinkT = 0; c.tgt = -1;
      if (c.eng >= 0) PT.Engine.Contact.release(G, c, false);
      const handoff = P.run && !P.thrown && !P.picked && ct === P.off;
      for (let k = 0; k < 7; k++) {
        const e = G.ents[ct * 7 + k];
        if (e === c) continue;
        if (handoff && (e.role === R.RBLK || e.role === R.PSET || e.role === R.SELL || e.role === R.PBLK)) {
          if (e.role === R.PBLK || e.role === R.PSET) { e.role = R.RBLK; if (e.pushX === 0 && e.pushY === 0) e.tsel = 'near'; }
          continue;
        }
        if (e.pos === 'QB' && handoff) { e.role = P.qbMode === 'toss' ? R.QB : R.IDLE; continue; }
        if (handoff && P.qbMode === 'toss' && (e.role === R.ROUTE || e.role === R.PBLK)) continue;   // flea flicker: keep selling the pass
        if (handoff && P.play && P.play.reverse && !P.exch && e.pos === 'WR1') continue;            // reverse: WR1 keeps coming for the exchange
        e.role = R.ESCORT; e.thinkT = 0; e.tgt = -1;
      }
      const dt = 1 - ct;
      if (handoff) {
        // pass sets turn into run blocks (draws): blockers now drive their man away from the lane
        for (let k = 0; k < 7; k++) {
          const e = G.ents[dt * 7 + k];
          if (e.dside && e.eng >= 0 && !e.engRun) { const bl = G.ents[e.eng]; e.engRun = true; e.engWin = e.shed > bl.block * 1.1; }
        }
      }
      for (let k = 0; k < 7; k++) {
        const e = G.ents[dt * 7 + k];
        if (handoff && !e.readDone) continue;     // defenders read the run after their reaction time
        e.role = R.PURSUE; e.thinkT = 0; e.readDone = true;
        if (e.eng >= 0 && !handoff && (P.picked || ct !== P.off)) PT.Engine.Contact.release(G, e, false);
      }
      // user control follows the ball on the user's team
      if (ct === G.userIdx && !(P.kind === 'scrim' && G.ball.car === P.qb && !P.run && !P.crossed && P.qbBack)) {
        // offense / returns: the user takes the carrier; turnovers (pick, fumble return) too unless Auto Return is on
        if ((P.kind !== 'scrim' && P.kind !== 'two') ? G.userRet(ct) : (ct === P.off || G.userRet(ct))) G.setCtl(b.car);
      } else if (G.ctl >= 0 && G.ents[G.ctl].tm !== ct) G.setCtl(-1);
    } else if (b.st === 'loose') {
      for (let i = 0; i < 14; i++) { const e = G.ents[i]; if (e.eng >= 0) PT.Engine.Contact.release(G, e, false); e.role = R.PURSUE; e.tgt = -1; }
      G.setCtl(-1);
    }
  };

  // ------------------------------------------------------------------ main update
  AI.update = function (G, dt) {
    if (!R) init();
    const P = G.P;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      if (e.diving && e.diveT <= 0) { e.diving = false; G.tk.diveMiss++; e.downT = G.T.DIVE_MISS_DOWN; e.an = 'down'; e.at = 0; }
      if (e.ctl || e.downT > 0 || e.diveT > 0) continue;
      if (e.eng >= 0) continue;        // duel controls engaged bodies (blocker side too)
      if (e.thinkT > 0) e.thinkT -= dt;
      switch (e.role) {
        case R.QB: PT.Engine.AIQB.update(G, e, dt); break;
        case R.ROUTE: route(G, e, dt); break;
        case R.LANE: lane(G, e, dt); break;
        case R.PBLK: case R.PSET: passBlock(G, e, dt); break;
        case R.BLOCK: backBlock(G, e, dt); break;
        case R.RBLK: case R.SELL: runBlock(G, e, dt); break;
        case R.ESCORT: escort(G, e, dt); break;
        case R.FAKE: fakeRun(G, e, dt); break;
        case R.CARRIER: AI.carrier(G, e, dt, null); break;
        case R.RUSH: rush(G, e, dt); break;
        case R.MAN: man(G, e, dt); break;
        case R.ZONE: zone(G, e, dt); break;
        case R.FILL: case R.FILLRUSH: fill(G, e, dt); break;
        case R.SPY: spy(G, e, dt); break;
        case R.FREE: free(G, e, dt); break;
        case R.PURSUE: pursue(G, e, dt); break;
        case R.BREAK: breakBall(G, e, dt); break;
        case R.KCOVER: kcover(G, e, dt); break;
        case R.KRET: kret(G, e, dt); break;
        case R.KBLOCK: kblock(G, e, dt); break;
        case R.KICKER: case R.HOLDER: case R.IDLE: idle(G, e, dt); break;
        default: Ph.stop(e);
      }
      if (e.an !== 'block' && e.an !== 'catch' && e.an !== 'throw' && e.an !== 'tackle' && e.an !== 'juke' && e.an !== 'celebrate' && e.an !== 'kick') {
        const want = e.ball ? 'carry' : (e.role === R.RUSH ? 'rush' : (e.spd > 0.6 ? (e.sprint ? 'sprint' : 'run') : 'idle'));
        if (e.an !== want && !(e.an === 'tackled' || e.an === 'down' || e.an === 'dive' || e.an === 'spin')) { e.an = want; e.at = 0; }
      } else if (e.at > 0.45 && e.an !== 'block' && e.an !== 'celebrate') { e.an = e.ball ? 'carry' : 'run'; e.at = 0; }
    }
    void P;
  };

  // ------------------------------------------------------------------ offense
  function passInAir(G) { return G.ball.st === 'air' && G.ball.kind === 'pass'; }

  function goForBall(G, e) {
    const b = G.ball, P = G.P;
    // track the ball: head for where the QB aimed, read the real landing spot as the flight goes on
    const s = b.T > 0 ? b.t / b.T : 1;
    const k = b.T < 0.7 ? 1 : s < 0.3 ? 0 : s > 0.8 ? 1 : (s - 0.3) / 0.5;    // short throws are read right away
    const ax = P.thTx + (b.lx - P.thTx) * k, ay = P.thTy + (b.ly - P.thTy) * k;
    const dx = ax - e.x, dy = ay - e.y, d = Math.sqrt(dx * dx + dy * dy);
    const tl = Math.max(0.05, b.T - b.t);
    // run to arrive with the ball (no faster than top speed), then wait
    const need = d / tl;
    const sp = Math.min(e.top, Math.max(need * 1.05, d > 0.3 ? 2 : 0));
    if (d < 0.15) { Ph.stop(e); return; }
    Ph.steerDir(e, dx / d, dy / d, sp);
  }

  function route(G, e, dt) {
    const P = G.P;
    if (passInAir(G) && P.tgt === e.id && (P.t >= e.goBallT || G.ball.T < 0.7)) { goForBall(G, e); return; }
    if (e.blkT > 0) {
      e.blkT -= dt;
      backBlock(G, e, dt);
      if (e.blkT <= 0) { RT.reanchor(e); e.tgt = -1; }
      return;
    }
    if (!RT.follow(G, e, dt)) { e.role = R.BLOCK; }
  }

  function lane(G, e, dt) {
    const P = G.P;
    // RB waiting for the handoff (or decoy lane)
    if (e.wpWait > 0) { e.wpWait -= dt; Ph.stop(e); return; }
    if (P.waitHandEnt === e.id && !P.handDone) {
      const tx = e.wpx[1], ty = e.wpy[1];
      Ph.steerTo(e, tx, ty, 0.6);
      return;
    }
    if (e.wpi < e.wpn) {
      const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
      const d = Math.hypot(tx - e.x, ty - e.y);
      if (d < 0.6) { e.wpi++; return; }
      Ph.steerTo(e, tx, ty, P.handDone ? 1 : 0.62);
    } else {
      // lane ran out before getting the ball: decoy → block
      if (!e.ball) { e.role = P.run ? R.ESCORT : R.BLOCK; }
    }
  }

  /** pocket spot for a pass blocker */
  function pocket(G, e, out) {
    const P = G.P, qb = G.ents[P.qb >= 0 ? P.qb : G.poss * 7], F = PT.Engine.Formation;
    const side = F.ox(G, e.lx1) < 0 ? -1 : 1;
    out.x = qb.x + side * 1.9 * G.dir;      // offense-frame side → field x
    out.y = Math.max(Math.min(qb.y + 2.4 * G.dir, Math.max(P.los0, P.los0 - 1.4 * G.dir)), Math.min(P.los0, P.los0 - 1.4 * G.dir));
    out.y = P.los0 - 1.6 * G.dir;
    if ((qb.y - P.los0) * G.dir > -2.5) out.y = qb.y + 0.8 * G.dir;
    return out;
  }

  /** pick the rusher this pass blocker should take */
  function pickRusher(G, e, sideOnly) {
    const P = G.P, d = 1 - e.tm, F = PT.Engine.Formation;
    const qb = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
    const side = F.ox(G, e.lx1) < 0 ? -1 : 1;
    let best = -1, bs = 1e9;
    for (let k = 0; k < 7; k++) {
      const r = G.ents[d * 7 + k];
      if (r.downT > 0) continue;
      const isRusher = r.role === R.RUSH || r.role === R.FILLRUSH && r.readDone;
      if (!isRusher) continue;
      if (r.eng >= 0 && r.eng !== e.id && r.eng2 >= 0) continue;
      const dq = Math.hypot(r.x - qb.x, r.y - qb.y);
      if (dq > 14) continue;
      let s = Math.hypot(r.x - e.x, r.y - e.y);
      const rside = F.ox(G, r.x) < F.ox(G, qb.x) ? -1 : 1;
      if (sideOnly && rside !== side) s += 6;
      if (r.eng >= 0 && r.eng !== e.id) s += 8;     // already blocked: only help (double team) if nothing else
      if (s < bs) { bs = s; best = d * 7 + k; }
    }
    return best;
  }

  function interceptPoint(G, e, r, prot, out) {
    // stand on the line from the rusher to the protected spot, one body length in front of the rusher
    const dx = prot.x - r.x, dy = prot.y - r.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const k = Math.min(d * 0.5, e.rad + r.rad + 0.4);
    out.x = r.x + dx / d * k + r.vx * 0.15; out.y = r.y + dy / d * k + r.vy * 0.15;
    return out;
  }

  function passBlock(G, e, dt) {
    const P = G.P;
    if (e.role === R.PBLK && e.asg && e.asg.pb && P.t >= e.asg.pb) {
      // screen release: go to the release spot then block the nearest defender
      e.role = R.RBLK; e.tsel = 'near'; e.pre = true;
      const F = PT.Engine.Formation; e.preX = F.fx(G, e.asg.rel[0]); e.preY = F.fy(G, e.asg.rel[1]);
      return;
    }
    if (e.thinkT <= 0) { e.tgt = pickRusher(G, e, true); e.thinkT = 0.1; }
    const qb = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
    if (e.tgt >= 0) {
      const r = G.ents[e.tgt];
      interceptPoint(G, e, r, qb, tmp);
      Ph.steerTo(e, tmp.x, tmp.y, 0.9);
    } else {
      pocket(G, e, tmp);
      Ph.steerTo(e, tmp.x, tmp.y, 0.6);
    }
  }

  function backBlock(G, e, dt) {
    const P = G.P;
    const qb = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
    if (e.thinkT <= 0) {
      e.thinkT = 0.1;
      // nearest unblocked rusher entering 4 yd around the QB
      const d = 1 - e.tm;
      let best = -1, bd = 4.5;
      for (let k = 0; k < 7; k++) {
        const r = G.ents[d * 7 + k];
        if (r.downT > 0 || r.eng >= 0) continue;
        if (!(r.role === R.RUSH || r.role === R.FILLRUSH || r.role === R.PURSUE || r.role === R.SPY)) continue;
        const dq = Math.hypot(r.x - qb.x, r.y - qb.y);
        if (dq < bd) { bd = dq; best = d * 7 + k; }
      }
      e.tgt = best;
    }
    if (e.tgt >= 0) {
      interceptPoint(G, e, G.ents[e.tgt], qb, tmp);
      Ph.steerTo(e, tmp.x, tmp.y, 1);
    } else {
      const F = PT.Engine.Formation;
      const side = F.ox(G, e.lx1) < 0 ? -1 : 1;
      Ph.steerTo(e, qb.x + side * 1.6 * G.dir, qb.y + 0.6 * G.dir, 0.5);
    }
  }

  /** select a run-block target by assignment code */
  function takenBy(G, e, ti) {
    for (let k = 0; k < 7; k++) { const o = G.ents[e.tm * 7 + k]; if (o !== e && o.tgt === ti && isBlk(o.role)) return true; }
    return false;
  }
  function isBlk(r) { return r === R.RBLK || r === R.ESCORT || r === R.SELL; }

  function selectTarget(G, e) {
    const d = 1 - e.tm, sel = e.tsel, F = PT.Engine.Formation;
    if (sel === 'LB1' || sel === 'LB2' || sel === 'S') {
      // second level: take the unblocked defender nearest the running lane (assignments by slot go stale vs zones)
      const P = G.P, b = G.ball;
      let lx = e.x, ly = e.y;
      if (b.st === 'held' && G.ents[b.car].tm === e.tm) { const c = G.ents[b.car]; lx = c.x + c.vx * 0.6; ly = c.y + c.vy * 0.6 + 3 * G.dir; }
      else { const rb = G.ents[P.off * 7 + 1]; const n = rb.wpn; if (n > 1) { lx = rb.wpx[n - 1]; ly = rb.wpy[n - 1] + 2 * G.dir; } }
      let best = -1, bs = 1e9;
      for (let k = 2; k < 7; k++) {
        const t = G.ents[d * 7 + k];
        if (t.downT > 0 || (t.eng >= 0 && t.eng !== e.id) || takenBy(G, e, d * 7 + k)) continue;
        if (C.DEF_SLOTS[k] === 'CB1' || C.DEF_SLOTS[k] === 'CB2') continue;
        const sc = Math.hypot(t.x - lx, t.y - ly) + 0.4 * Math.hypot(t.x - e.x, t.y - e.y);
        if (sc < bs) { bs = sc; best = d * 7 + k; }
      }
      if (best >= 0) return best;
    }
    if (sel && sel.length <= 3 && sel !== 'any') {
      const k = C.DEF_SLOTS.indexOf(sel);
      if (k >= 0) {
        const t = G.ents[d * 7 + k];
        if (t.downT <= 0 && !(t.eng >= 0 && t.eng !== e.id)) return d * 7 + k;
      }
    }
    // nearest suitable defender (prefer ones between me and the ball/lane, not already blocked)
    const b = G.ball;
    const fx = b.st === 'held' ? G.ents[b.car].x : e.x, fy = b.st === 'held' ? G.ents[b.car].y : e.y;
    let best = -1, bs = 1e9;
    for (let k = 0; k < 7; k++) {
      const t = G.ents[d * 7 + k];
      if (t.downT > 0 || (t.eng >= 0 && t.eng !== e.id) || t.ball) continue;
      if (takenBy(G, e, d * 7 + k) && sel !== 'any') continue;
      const slot = C.DEF_SLOTS[k];
      if (sel === 'nearLB' && slot !== 'LB1' && slot !== 'LB2') continue;
      if (sel === 'nearCB' && slot !== 'CB1' && slot !== 'CB2') continue;
      if (e.asg && e.asg.side && F.ox(G, t.x) * e.asg.side < -2) continue;
      let s = Math.hypot(t.x - e.x, t.y - e.y) + 0.5 * Math.hypot(t.x - fx, t.y - fy);
      if (s < bs) { bs = s; best = d * 7 + k; }
    }
    return best;
  }

  function runBlock(G, e, dt) {
    const P = G.P;
    if (e.role === R.SELL && P.t < (e.asg && e.asg.sell || 1)) {
      // push the "wrong way" to sell the reverse
      Ph.steerDir(e, -G.dir * G.P.flip * 0.7, 0.3 * G.dir, e.top * 0.4);
      return;
    }
    if (e.pre) {
      const d = Ph.steerTo(e, e.preX, e.preY, 1);
      if (d < 0.8) e.pre = false;
      return;
    }
    if (e.wpn > 0 && e.wpi < e.wpn) {      // pulling guard path
      const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
      if (Math.hypot(tx - e.x, ty - e.y) < 0.8) e.wpi++;
      else { Ph.steerTo(e, tx, ty, 1); return; }
    }
    if (e.thinkT <= 0 || e.tgt < 0 || G.ents[e.tgt].downT > 0) { e.tgt = selectTarget(G, e); e.thinkT = 0.15; }
    if (e.tgt < 0) { escort(G, e, dt); return; }
    const t = G.ents[e.tgt];
    Ph.steerTo(e, t.x + t.vx * 0.2, t.y + t.vy * 0.2, 1);
  }

  function escort(G, e, dt) {
    const b = G.ball;
    if (b.st !== 'held') { Ph.steerTo(e, b.x, b.y, 0.8); return; }
    const c = G.ents[b.car];
    if (c.tm !== e.tm) { pursue(G, e, dt); return; }
    if (e.thinkT <= 0) {
      e.thinkT = 0.15;
      const d = 1 - e.tm, myD = Math.hypot(e.x - c.x, e.y - c.y);
      let best = -1, bs = 1e9;
      for (let k = 0; k < 7; k++) {
        const t = G.ents[d * 7 + k];
        if (t.downT > 0 || (t.eng >= 0 && t.eng2 >= 0) || (t.eng >= 0 && t.eng !== e.id)) continue;
        const td = Math.hypot(t.x - c.x, t.y - c.y);
        if (td >= myD + 1.0 || td > 7) continue;
        const s = Math.hypot(t.x - e.x, t.y - e.y) + td * 0.6;
        if (s < bs) { bs = s; best = d * 7 + k; }
      }
      e.tgt = best;
    }
    if (e.tgt >= 0) {
      const t = G.ents[e.tgt];
      interceptPoint(G, e, t, c, tmp);
      Ph.steerTo(e, tmp.x, tmp.y, 1);
    } else {
      const dirC = AI.dirC(G, c);
      Ph.steerTo(e, c.x + (e.x > c.x ? 2.5 : -2.5), c.y + 4 * dirC, 0.9);
    }
  }

  function fakeRun(G, e, dt) {
    if (e.wpi < e.wpn) {
      const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
      if (Math.hypot(tx - e.x, ty - e.y) < 0.6) e.wpi++;
      else Ph.steerTo(e, tx, ty, 0.85);
    } else { e.role = R.BLOCK; e.thinkT = 0; }
  }

  function idle(G, e, dt) {
    const P = G.P;
    if (e.role === R.IDLE && P.kind === 'scrim' && e.pos === 'QB') {
      // carry out the fake a few steps, then watch
      if (P.t - (P.handT || 0) < 0.8) { Ph.steerDir(e, -G.dir * 0.3, -G.dir, e.top * 0.4); return; }
    }
    Ph.stop(e);
  }

  // ------------------------------------------------------------------ AI ball carrier (design 8.14)
  /**
   * AI carrier logic. If out is given (autopilot), writes a move intent into out {mx,my,sprint,juke,spin,dive} instead of
   * acting directly.
   */
  AI.carrier = function (G, e, dt, out) {
    const T = G.T, P = G.P, rng = G.rng;
    const dirC = AI.dirC(G, e);
    e.carT += dt;
    if (e.an === 'catch' && e.at < T.CATCH_ANIM) { if (!out) Ph.steerDir(e, e.vx * 0.3, e.vy * 0.3, 1); return; }
    // follow the designed lane right after a handoff until a defender closes in
    const RU = PT.Engine.Rules;
    if (e.role === R.CARRIER && e.wpn > 0 && e.wpi < e.wpn && e.carT < 1.2 && (P.rusher === e.id)) {
      const dn = AI.nearestOppDist(G, e.tm, e.x, e.y, 0.2);
      if (dn > 3.5) {
        const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
        if (Math.hypot(tx - e.x, ty - e.y) < 0.8) e.wpi++;
        else if (out) { const dx = tx - e.x, dy = ty - e.y, dl = Math.hypot(dx, dy) || 1; out.mx = dx / dl; out.my = dy / dl; out.sprint = false; out.juke = out.spin = out.dive = false; return; }
        else { Ph.steerTo(e, tx, ty, 1); return; }
      }
    }
    if (e.thinkT <= 0 || out) {
      if (!out) e.thinkT = T.CAR_THINK;
      const gy = RU.goalY(G, e.tm);
      const diff = G.score[e.tm] - G.score[1 - e.tm];
      const urgent = RU.halfEndQ(G) && RU.clockLeft(G) < RU.warnT(G) * 1.5 && diff <= 0 && e.tm === P.off;
      let bestA = 0, bestS = -1e9, bestFree = 0;
      const n = T.CAR_HEADINGS, spread = T.CAR_SPREAD;
      for (let h = 0; h < n; h++) {
        const a = -spread + (2 * spread) * h / (n - 1);
        const hx = Math.sin(a) * dirC, hy = Math.cos(a) * dirC;   // rotate "upfield" (0, dirC)
        let mn = 1e9;
        for (let s = 1; s <= 5; s += 2) {
          const px = e.x + hx * s, py = e.y + hy * s;
          const dd = AI.nearestOppDist(G, e.tm, px, py, 0.25) - s * 0.15;
          if (dd < mn) mn = dd;
        }
        let score = Math.min(mn, 9) + Math.cos(a) * T.CAR_FWD;
        const ex = e.x + hx * 5;
        if (Math.abs(ex - MID) > 25.2) score -= 6 + (Math.abs(ex - MID) - 25.2) * 2;
        if (urgent) score += Math.abs(ex - MID) / 26 * 1.5;
        if ((gy - e.y) * dirC < 6) score += Math.cos(a) * 3;
        if (score > bestS) { bestS = score; bestA = a; bestFree = mn; }
      }
      e.hx = Math.sin(bestA) * dirC; e.hy = Math.cos(bestA) * dirC;
      // moves
      const near = AI.nearestOpp(G, e, e.x, e.y);
      let ahead = false, nd = 99;
      if (near >= 0) {
        const o = G.ents[near];
        nd = Math.hypot(o.x - e.x, o.y - e.y);
        ahead = ((o.y - e.y) * dirC) > -0.3;
      }
      const wantJuke = ahead && nd < 1.6 + e.rad && rng.chance(T.CAR_JUKE * e.r.mov / 70);   // (the spin move was removed — client)
      const lineDist = Math.min(Math.abs(G.fdY - e.y), Math.abs(gy - e.y));
      const wantDive = e.tm === P.off && P.kind === 'scrim' && lineDist < 2 && (G.fdY - e.y) * dirC > 0 && nd < 1.5 + e.rad;
      const sprint = bestFree >= T.CAR_SPRINT_FREE || (gy - e.y) * dirC < 12;
      if (out) {
        out.mx = e.hx; out.my = e.hy; out.sprint = sprint; out.juke = wantJuke; out.spin = false; out.dive = wantDive;
        return;
      }
      e.sprint = sprint && e.energy > T.SPRINT_MIN;
      if (wantDive) { PT.Engine.Contact.dive(G, e); return; }
      if (wantJuke) PT.Engine.Contact.juke(G, e);
    }
    AI.runCarrier(G, e, e.hx, e.hy, 1, e.sprint, dt);
  };

  /** Apply carrier locomotion incl. sprint/energy (shared by AI and user). */
  AI.runCarrier = function (G, e, ux, uy, mag, sprint, dt) {
    const T = G.T;
    let sp = e.top * mag;
    if (sprint && e.energy > (e.sprint ? 0 : T.SPRINT_MIN) && mag > 0.5) {
      let mul = e.info.t.speed_demon ? T.SPRINT_MUL_DEMON : T.SPRINT_MUL;
      if (e.info.q.burst) mul += T.BURST_ADD;
      sp *= mul;
      let drain = T.ENERGY_DRAIN * (e.info.q.burst ? 1.2 : 1);
      if (G.hot) drain *= 1.25;
      e.energy = Math.max(0, e.energy - drain * dt);
      e.sprint = e.energy > 0;
    } else {
      e.sprint = false;
      e.energy = Math.min(e.enMax, e.energy + T.ENERGY_REGEN * dt);
    }
    Ph.steerDir(e, ux, uy, sp);
  };

  // ------------------------------------------------------------------ defense
  function readRun(G, e) {
    const P = G.P;
    if (e.readDone) return true;
    let rt = AI.react(G, e);
    if (P.play && P.play.draw && e.role === R.RUSH) rt += G.T.DRAW_FOOL;       // pass rushers bite on the draw
    if ((P.run || P.crossed) && P.t - (P.runT || 0) >= rt) {
      // pass defenders on the edges / deep keep their pass responsibility until the ball crosses the line
      if ((e.pos === 'CB1' || e.pos === 'CB2' || e.deep || e.role === R.FREE) && G.ball.st === 'held') {
        const c = G.ents[G.ball.car];
        if ((c.y - P.los0) * G.dir < 0.5 && P.t - (P.runT || 0) < rt + G.T.DEEP_RUN_READ) return false;
      }
      e.readDone = true; return true;
    }
    return false;
  }
  function toPursue(e) { e.role = R.PURSUE; e.thinkT = 0; e.readDone = true; }

  function breakDelay(G, e) {
    return G.P.relT + AI.react(G, e) + (e.bite > 0 ? 0.4 : 0);
  }
  /** Should this defender break on the thrown ball now? */
  function shouldBreak(G, e, buddy) {
    const P = G.P, b = G.ball;
    if (!passInAir(G) || P.t < breakDelay(G, e)) return false;
    if (buddy >= 0 && P.tgt === buddy) return true;
    const dx = b.lx - e.x, dy = b.ly - e.y, br = G.T.BREAK_R * (PT.Engine.Stars.active(G, e, 'lockdown') ? 2 : 1);
    return dx * dx + dy * dy <= br * br;
  }

  function biteStep(G, e) {
    // PA bite: run 1.5 yd toward the LOS before reacting
    const P = G.P;
    if (e.bite === 1) {
      const ty = P.los0 + 0.5 * G.dir;
      if ((e.y - ty) * G.dir <= 0.3 || P.t - P.fakeT > 0.6) { e.bite = 2; return false; }
      Ph.steerTo(e, e.x, e.y - G.dir * 1.5, 1);
      return true;
    }
    return false;
  }

  function rush(G, e, dt) {
    const P = G.P, b = G.ball;
    if (readRun(G, e) && (b.car !== P.qb || P.crossed)) { toPursue(e); return; }
    if (passInAir(G)) {
      if (shouldBreak(G, e, -1)) { e.role = R.BREAK; return; }
      Ph.steerTo(e, b.lx, b.ly, 0.5); return;
    }
    if (b.st !== 'held') { pursue(G, e, dt); return; }
    const tgt = G.ents[b.car];
    if (tgt.tm === e.tm) { toPursue(e); return; }
    // read option: the unblocked end has to play both the QB and the RB during the mesh (squeeze, don't fly in)
    if (P.play && P.play.option && e.id === P.readEnt && P.t < 1.4) {
      // the read end commits: crash on the RB (inside) or play the QB (outside contain)
      const F = PT.Engine.Formation, m = P.play.qb.mesh;
      if (P.readCommit === 'rb') { const rb = G.ents[P.off * 7 + 1]; Ph.steerTo(e, rb.x + rb.vx * 0.4, rb.y + rb.vy * 0.4, 0.85); }
      else Ph.steerTo(e, F.fx(G, m.keep[1][0]), F.fy(G, m.keep[1][1]) + 1.5 * G.dir, 0.85);
      return;
    }
    // draw: rushers are selling out for the QB — until they read it they keep chasing the QB, not the RB
    let ch = tgt;
    if (P.play && P.play.draw && !e.readDone && P.qb >= 0) ch = G.ents[P.qb];
    let tx = ch.x + ch.vx * 0.25, ty = ch.y + ch.vy * 0.25;
    const a = e.asg;
    if (a && a.aimX && P.t < 0.8) tx += a.aimX * G.dir;
    if (a && a.contain) {
      const F = PT.Engine.Formation;
      const side = F.ox(G, e.lx1) < 0 ? -1 : 1;
      const dq = Math.hypot(tgt.x - e.x, tgt.y - e.y);
      if (dq > 3) tx = tgt.x + side * 2.5 * G.dir;
    }
    // playtest: vs a human QB, blitzers from the second level (LB/CB/S) need a beat to read before they fly in
    let pace = 1;
    if (G.poss === G.userIdx && G.human() && P.kind === 'scrim' && e.id % 7 >= 2) {
      const gd = G.T.USER_BLITZ_GO[G.diff] || 0;
      if (P.t < gd) pace = 0.45; else pace = G.T.USER_BLITZ_PACE;      // decision-time pass: a beat to read, then not quite full speed
    }
    // loop around a blocker that is directly in the way
    Ph.steerTo(e, tx, ty, pace);
  }

  function man(G, e, dt) {
    const P = G.P, T = G.T;
    const bud = e.tgt >= 0 ? G.ents[e.tgt] : null;
    if (!bud) { e.role = R.ZONE; return; }
    if (bud.ball && G.ball.st === 'held' && bud.tm !== e.tm) { if (P.t - (P.runT || 0) >= AI.react(G, e) || !P.run) { toPursue(e); return; } }
    if (readRun(G, e) && !bud.ball) { toPursue(e); return; }
    if (shouldBreak(G, e, e.tgt)) { e.role = R.BREAK; return; }
    if (biteStep(G, e)) return;
    // green dog: buddy stays in to block
    if (bud.role === R.PBLK || bud.role === R.BLOCK || bud.role === R.FAKE || (bud.role === R.ROUTE && bud.blkT > 0)) {
      e.rt0 += dt;
      if (e.rt0 >= T.GREEN_DOG_T && !passInAir(G)) { e.role = R.RUSH; return; }
    } else e.rt0 = 0;
    // lagged velocity of the buddy (reaction to cuts)
    const k = PT.Engine.Stars.active(G, e, 'lockdown') ? 1 : Math.min(1, dt / Math.max(0.05, AI.react(G, e)));
    e.ptx += (bud.vx - e.ptx) * k; e.pty += (bud.vy - e.pty) * k;
    let trail = e.trail;
    if (e.asg && e.asg.press && P.t < T.PRESS_T) trail = Math.min(trail, T.TRAIL_PRESS);
    const dirO = G.dir;
    // underneath early in the route, then even + inside once he is past ~8 yd (no free release over the top)
    const depth = (bud.y - P.los0) * dirO;
    const under = depth < 4 ? 1 : depth > 10 ? 0.15 : 1 - (depth - 4) / 6 * 0.85;
    const inside = bud.x > MID ? -1 : 1;
    const tx = bud.x + e.ptx * 0.35 + inside * trail * (1 - under) * 0.8, ty = bud.y + e.pty * 0.35 - dirO * trail * under;
    const dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
    let sp = e.top;
    if (d < 1.2) sp = Math.max(Math.hypot(e.ptx, e.pty), e.top * d / 1.2);
    if (d > 0.01) Ph.steerDir(e, dx / d, dy / d, sp); else Ph.stop(e);
    e.an = 'run';
  }

  function zone(G, e, dt) {
    const P = G.P, T = G.T, o = G.poss;
    if (readRun(G, e)) { toPursue(e); return; }
    if (shouldBreak(G, e, -1)) { e.role = R.BREAK; return; }
    if (biteStep(G, e)) return;
    if (e.ar2 > 0 && P.t >= 1.0) { e.ax = e.ax2; e.ay = e.ay2; e.ar = e.ar2; e.ar2 = 0; }
    const dirO = G.dir;
    // underneath zones react to quick routes sooner than deep zones finish their drop
    if (P.t < (e.deep ? T.ZONE_DROP_T : T.ZONE_DROP_UNDER)) { Ph.steerTo(e, e.ax, e.ay, T.BACKPEDAL); return; }
    if (e.thinkT <= 0) {
      e.thinkT = 0.12;
      // threats in (or near) my area. Coverage fix (playtest "receivers run open"): areas are small, so a route just
      // outside an area belonged to nobody. Now each zone defender reaches ZONE_REACH yd past his area, prefers
      // receivers nobody else is on (no man defender, no closer zone defender), and keeps his man while he stays near.
      let best = -1, bs = -1e9;
      const d0 = (1 - o) * 7;
      for (let k = 1; k <= 4; k++) {
        const r = G.ents[o * 7 + k];
        if (r.downT > 0 || !(r.role === R.ROUTE || r.role === R.CARRIER || (r.role === R.LANE && !P.run))) continue;
        const dx = r.x - e.ax, dy = r.y - e.ay;
        const rr = e.ar + (e.deep ? 1.5 : T.ZONE_REACH);
        const depth = (r.y - P.los0) * dirO;
        // a vertical route running through/past a deep zone, or a deeper route (curl, dig) in my lane under me
        const pastDeep = e.deep && Math.abs(dx) < e.ar + 2 && (dy * dirO > 0 || depth >= T.ZONE_SQUEEZE_D);
        if (!pastDeep && dx * dx + dy * dy > rr * rr) continue;
        const me = Math.hypot(r.x - e.x, r.y - e.y);
        // underneath: the closest threat, but a route downfield matters more than a checkdown behind the line
        // (anchored to my area: the receiver nearest my landmark is mine, not the one nearest me after I drifted)
        const da = Math.sqrt(dx * dx + dy * dy);
        let s = e.deep ? depth : -(0.6 * da + 0.4 * me) + T.ZONE_DEPTH_W * Math.max(-3, Math.min(12, depth)) - (depth < 0 ? T.ZONE_CHECKDOWN : 0);
        let cov = false;
        for (let j = 0; j < 7 && !cov; j++) {
          const m = G.ents[d0 + j];
          if (m === e || m.downT > 0 || m.tgt !== r.id) continue;
          const md = Math.hypot(r.x - m.x, r.y - m.y);
          if (m.role === R.MAN || (m.role === R.ZONE && (md < me || md < 3))) cov = true;
        }
        if (cov) s -= T.ZONE_COVERED;
        if (r.id === e.tgt) s += 1.5;                                     // stay with my man (no flip-flopping)
        if (s > bs) { bs = s; best = o * 7 + k; }
      }
      e.tgt = best;
    }
    let tx = e.ax, ty = e.ay;
    if (e.tgt >= 0) {
      const r = G.ents[e.tgt];
      if (e.deep) { tx = r.x + r.vx * 0.3; ty = r.y + r.vy * 0.3 + dirO * ((r.y - e.ay) * dirO < 0 ? T.ZONE_CUSHION : 2.0); }
      else {
        const qb = G.ents[P.qb >= 0 ? P.qb : o * 7];
        const dx = qb.x - r.x, dy = qb.y - r.y, dl = Math.hypot(dx, dy) || 1;
        tx = r.x + r.vx * 0.3 + dx / dl * 1.4; ty = r.y + r.vy * 0.3 + dy / dl * 1.4;
      }
      // don't chase far outside the area (deep zones may always sink with the deepest threat)
      const ox = tx - e.ax, oy = e.deep && (ty - e.ay) * dirO > 0 ? 0 : ty - e.ay, ol = Math.hypot(ox, oy), lim = e.ar + (e.deep ? 3 : T.ZONE_REACH + 1);
      if (ol > lim) { tx = e.ax + ox / ol * lim; if (!(e.deep && (ty - e.ay) * dirO > 0)) ty = e.ay + oy / ol * lim; }
    } else {
      // drift toward where the QB is looking
      const qb = G.ents[P.qb >= 0 ? P.qb : o * 7];
      const fx = qb.x - Math.sin(qb.fa) * 15, fy = qb.y + Math.cos(qb.fa) * 15;
      tx = e.ax + (fx - e.ax) * 0.15; ty = e.ay;
    }
    Ph.steerTo(e, tx, ty, 1);
  }

  function fill(G, e, dt) {
    const P = G.P;
    if (readRun(G, e)) { toPursue(e); return; }
    if (biteStep(G, e)) return;
    const waitT = Math.max(AI.react(G, e), 0.85);
    if (P.t < waitT && !passInAir(G)) {
      if (e.asg && e.asg.edge) {
        const F = PT.Engine.Formation;
        Ph.steerTo(e, F.dx(G, e.asg.edge[0]), F.fy(G, e.asg.edge[1]), 0.8);
      } else Ph.steerTo(e, e.x, e.y - G.dir * 0.4, 0.3);
      return;
    }
    if (P.thrown || !P.run) {
      if (e.role === R.FILLRUSH) { e.role = R.RUSH; e.readDone = false; return; }
      e.role = R.ZONE; e.thinkT = 0; e.rs = 1;
      return;
    }
  }

  function spy(G, e, dt) {
    const P = G.P;
    if (readRun(G, e)) { toPursue(e); return; }
    if (shouldBreak(G, e, -1)) { e.role = R.BREAK; return; }
    const b = G.ball;
    const q = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
    if (b.st === 'held' && b.car === P.qb && P.crossed) { toPursue(e); return; }
    Ph.steerTo(e, q.x, P.los0 + 5 * G.dir, 0.9);
  }

  function free(G, e, dt) {
    const P = G.P;
    if (readRun(G, e)) { toPursue(e); return; }
    if (passInAir(G) && P.t >= breakDelay(G, e) && Math.hypot(G.ball.lx - e.x, G.ball.ly - e.y) < 20) { e.role = R.BREAK; return; }
    if (biteStep(G, e)) return;
    const q = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
    const fx = q.x - Math.sin(q.fa) * 20;
    Ph.steerTo(e, e.ax + (fx - e.ax) * 0.3, e.ay, 0.9);
  }

  function breakBall(G, e, dt) {
    const b = G.ball, P = G.P;
    if (!passInAir(G)) { toPursue(e); pursue(G, e, dt); return; }
    const edge = P.edge || 0;
    const mul = e.deep || e.ar > 0 ? 1 + 0.04 * edge : 1;
    const s = b.T > 0 ? b.t / b.T : 1;
    const k = s < 0.3 ? 0 : s > 0.8 ? 1 : (s - 0.3) / 0.5;
    const ax = P.thTx + (b.lx - P.thTx) * k, ay = P.thTy + (b.ly - P.thTy) * k;
    const dx = ax - e.x, dy = ay - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.2) { Ph.stop(e); return; }
    Ph.steerDir(e, dx / d, dy / d, Math.min(e.top * mul, Math.max(1.5, d * 3)));
  }

  function pursue(G, e, dt) {
    if (e.jkT > 0) { e.jkT -= dt; return; }          // fooled by a juke: keeps his old line for a beat
    const T = G.T, b = G.ball;
    if (b.st === 'loose' || b.st === 'spot') { Ph.steerTo(e, b.x, b.y, 1); return; }
    if (passInAir(G)) { if (e.tm !== b.team) { e.role = R.BREAK; breakBall(G, e, dt); } else Ph.steerTo(e, b.lx, b.ly, 0.8); return; }
    if (b.st !== 'held') { Ph.stop(e); return; }
    const c = G.ents[b.car];
    if (c.tm === e.tm) { e.role = R.ESCORT; return; }
    if (e.thinkT <= 0) {
      e.thinkT = T.PURSUIT_DT;
      const dist = Math.hypot(c.x - e.x, c.y - e.y);
      // intercept time: |c + v·t − e| = top·t
      const rx = c.x - e.x, ry = c.y - e.y, vx = c.vx, vy = c.vy, sp = e.top * (e.info.q.charge ? 1.05 : 1);
      const qa = vx * vx + vy * vy - sp * sp, qb = 2 * (rx * vx + ry * vy), qc = rx * rx + ry * ry;
      let ti = dist / sp;
      if (Math.abs(qa) > 1e-6) {
        const disc = qb * qb - 4 * qa * qc;
        if (disc >= 0) { const sq = Math.sqrt(disc), t1 = (-qb - sq) / (2 * qa), t2 = (-qb + sq) / (2 * qa); ti = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2); if (ti < 0) ti = dist / sp; }
      }
      // a carrier running laterally (sweeps, stretches) is led fully — no "take the angle late" (HUNT5 #3)
      const lateral = Math.abs(c.vx) > Math.abs(c.vy);
      let tl = ti * (dist < 8 || lateral ? 1 : 0.55 + e.r.smt * 0.0045);
      if (tl > 2.5) tl = 2.5;
      let tx = c.x + c.vx * tl, ty = c.y + c.vy * tl;
      // the last line (deepest defender, still goal-side) keeps leverage: meet him near his own depth, don't over-run
      const dirC = AI.dirC(G, c), ahead = (e.y - c.y) * dirC;
      if (ahead > 6 && AI.isDeepest(G, e, dirC)) {
        const vy = Math.max(3, c.vy * dirC), tr = Math.min(2.0, ahead / vy);
        tx = c.x + c.vx * tr; ty = e.y - dirC * Math.min(ahead * 0.5, 4);
        if (tx < 1) tx = 1; else if (tx > C.FIELD.W - 1) tx = C.FIELD.W - 1;
      }
      // contain: outermost defender on each side stays outside the carrier until close
      if (dist > T.CONTAIN_R && AI.outerRank(G, e, c) < T.CONTAIN_N) {   // the 2 outermost on each side keep contain
        const side = e.x > c.x ? 1 : -1;
        if ((tx - c.x) * side < T.CONTAIN_GAP) tx = c.x + side * T.CONTAIN_GAP;
      }
      e.ptx = tx; e.pty = ty;
    }
    let sp = 1;
    if (e.info.q.charge) sp = 1.05;
    // hustle: a defender chasing from behind gets a small burst (lets pursuit run down equal-speed carriers)
    const bx = e.x - c.x, by = e.y - c.y, bd = Math.sqrt(bx * bx + by * by);
    const P = G.P;
    const open = AI.openField(G, c);
    if (open && bd < T.HUSTLE_R && bx * c.vx + by * c.vy < 0) sp *= T.HUSTLE;
    Ph.steerTo(e, e.ptx, e.pty, sp);
    if (Math.hypot(e.ptx - e.x, e.pty - e.y) < 1.2) Ph.steerTo(e, c.x, c.y, sp);
  }

  /** Flea flicker: the ball went back to the QB — defenders who read run recover to their coverage (late). */
  AI.recoverCoverage = function (G) {
    const P = G.P, d = 1 - P.off;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k], a = e.asg;
      if (!a || e.eng >= 0) continue;
      if (a.k === 'man' && e.role === R.PURSUE) { e.role = R.MAN; e.readDone = false; e.bite = 2; e.rt0 = 0; }
      else if ((a.k === 'zone' || a.k === 'fill') && e.role === R.PURSUE && e.ar > 0) { e.role = R.ZONE; e.readDone = false; e.bite = 2; }
      else if (a.k === 'free' && e.role === R.PURSUE) { e.role = R.FREE; e.readDone = false; }
    }
  };

  /** Is the carrier "in the open field" (past the LOS on scrimmage plays, well into a return)? Hustle/dive tackles only then. */
  AI.openField = function (G, c) {
    const P = G.P, T = G.T, dir = AI.dirC(G, c);
    if (P.kind === 'scrim' || P.kind === 'two') return (c.y - P.los0) * dir >= T.HUSTLE_PAST;
    return P.retY0 != null && (c.y - P.retY0) * dir >= T.HUSTLE_RET;
  };

  AI.isDeepest = function (G, e, dirC) {
    const o = e.tm * 7;
    for (let k = 0; k < 7; k++) { const d = G.ents[o + k]; if (d !== e && d.downT <= 0 && (d.y - e.y) * dirC > 0) return false; }
    return true;
  };

  /** How many teammates are further outside than e on his side of the carrier (0 = outermost). */
  AI.outerRank = function (G, e, c) {
    const o = e.tm * 7, side = e.x > c.x ? 1 : -1;
    let n = 0;
    for (let k = 0; k < 7; k++) {
      const d = G.ents[o + k];
      if (d === e || d.downT > 0) continue;
      if ((d.x - c.x) * side > (e.x - c.x) * side) n++;
    }
    return n;
  };

  AI.isOutermost = function (G, e, c) {
    const o = e.tm * 7, side = e.x > c.x ? 1 : -1;
    for (let k = 0; k < 7; k++) {
      const d = G.ents[o + k];
      if (d === e || d.downT > 0) continue;
      if ((d.x - e.x) * side > 0) return false;
    }
    return true;
  };

  // ------------------------------------------------------------------ kicks
  function kcover(G, e, dt) {
    const b = G.ball;
    if (b.st === 'held' && G.ents[b.car].tm !== e.tm) { toPursue(e); pursue(G, e, dt); return; }
    if (b.st === 'loose') { Ph.steerTo(e, b.x, b.y, 1); return; }
    const dir = AI.dirC(G, e);
    // run down the lane, converging toward the landing spot
    const P = G.P;
    if (P.kind === 'punt' && !P.kicked && !(e.pos === 'WR1' || e.pos === 'WR2')) { backBlock(G, e, dt); return; }
    if (e.pos === 'K' && b.st === 'air') {
      // the kicker / punter stays back as the last line of defense
      Ph.steerTo(e, MID + (b.lx - MID) * 0.5, b.ly - dir * 28, 0.75);
      return;
    }
    const tx = e.lx1 + (b.lx - e.lx1) * 0.55;
    const ty = b.st === 'air' ? b.ly - dir * 6 : e.y + dir * 10;
    Ph.steerTo(e, tx, ty, G.T.KCOVER_PACE);
  }

  function kret(G, e, dt) {
    const b = G.ball;
    if (b.st === 'air') {
      Ph.steerTo(e, b.lx, b.ly, 1);
      if (Math.hypot(b.lx - e.x, b.ly - e.y) < 0.6) e.fa = Math.atan2(-(b.x - e.x), b.y - e.y);
    } else Ph.stop(e);
  }

  function kblock(G, e, dt) {
    const b = G.ball, P = G.P;
    if (b.st === 'held') { e.role = R.ESCORT; escort(G, e, dt); return; }
    if (P.kind === 'punt' && !P.kicked) {
      // rush the punter (DL) or hold up gunners (CB)
      const kt = 1 - e.tm;
      if (e.pos === 'DL1' || e.pos === 'DL2') { const k = G.ents[kt * 7]; Ph.steerTo(e, k.x, k.y, 0.8); return; }
      if (e.pos === 'CB1' || e.pos === 'CB2') { const g = G.ents[kt * 7 + (e.pos === 'CB1' ? 2 : 3)]; Ph.steerTo(e, g.x, g.y + AI.dirC(G, g) * 1.5, 1); return; }
    }
    if (b.st !== 'air') { Ph.stop(e); return; }
    const dir = AI.dirC(G, e);
    const wallY = b.ly + dir * (e.pos === 'OL1' || e.pos === 'OL2' || e.pos === 'LB1' || e.pos === 'LB2' ? 16 : 11);
    const tx = b.lx + (e.lx1 - MID) * 0.45;
    Ph.steerTo(e, tx, wallY, 0.9);
  }
})(globalThis.PT = globalThis.PT || {});
