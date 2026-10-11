/* Pixel Touchdown: js/engine/ai-qb.js
 * Owner: WP3. Responsibility: AI QB reads (openness, progression, scramble, sack avoidance).
 * Also the QB "script" every QB follows after the snap (auto-drop, handoff/pitch timing, play-action fake, option mesh,
 * flea-flicker) — the user's QB runs the same script until the user moves him (design 6.4, 6.6, 8.14).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const Q = PT.ns('Engine.AIQB');
  const MID = C.FIELD.MID_X;

  /** Called at the snap: set up the QB script for the play. */
  Q.setup = function (G, qb) {
    const P = G.P, play = P.play, F = PT.Engine.Formation, PB = PT.Data.Playbook;
    const q = play.qb || {};
    const big = !!PB.UNDER[play.form];   // under center
    qb.qbX0 = qb.x; qb.qbY0 = qb.y; qb.qbRead = 0; qb.qbNext = 0; qb.rs = 0; qb.thinkT = 0;
    qb.readMul = G.rng.range(1 - G.T.JIT_READ, 1 + G.T.JIT_READ);              // HUNT5 #11: read tempo varies per snap
    P.qbMode = 'drop'; P.readStart = 0.4;
    if (q.drop) {
      const dr = PB.DROPS[q.drop];
      qb.qbDropX = F.fx(G, 0); qb.qbDropY = F.fy(G, big ? dr.big : dr.gun); qb.qbDropT = dr.t; P.readStart = dr.t;
    } else if (q.hand) {
      P.qbMode = 'hand';
      const at = q.hand.drop || q.hand.at;
      qb.qbDropX = F.fx(G, at[0]); qb.qbDropY = F.fy(G, at[1]); qb.qbDropT = q.hand.t;
    } else if (q.pitch) {
      P.qbMode = 'pitch'; qb.qbDropX = qb.x; qb.qbDropY = qb.y - 1 * G.dir; qb.qbDropT = q.pitch.t;
    } else if (q.fake) {
      P.qbMode = 'fake'; qb.qbDropX = F.fx(G, q.fake.at[0]); qb.qbDropY = F.fy(G, q.fake.at[1]); qb.qbDropT = q.fake.t;
      P.readStart = q.fake.t + (q.fake.rollT || q.fake.dropT || 0.5) * 0.7;
    } else if (q.mesh) {
      P.qbMode = 'mesh'; qb.qbDropX = F.fx(G, q.mesh.at[0]); qb.qbDropY = F.fy(G, q.mesh.at[1]); qb.qbDropT = q.mesh.t0;
    } else if (q.sneak) { P.qbMode = 'sneak'; }
    else if (q.kneel) { P.qbMode = 'kneel'; } else if (q.spike) { P.qbMode = 'spike'; }
    if (play.readAt) P.readStart = play.readAt;
  };

  /**
   * QB script movement + automatic exchanges. userMoved = the user has taken over movement (drop cancelled).
   * Returns true when the script set the QB's desired velocity this tick.
   */
  Q.script = function (G, qb, dt, userMoved) {
    const P = G.P, Ph = PT.Engine.Physics, play = P.play, q = play.qb || {}, F = PT.Engine.Formation, BL = PT.Engine.Ball;
    const t = P.t;
    switch (P.qbMode) {
      case 'drop': {
        if (userMoved || t > qb.qbDropT + 0.05) { P.qbMode = 'pass'; return false; }
        const d = Math.hypot(qb.qbDropX - qb.x, qb.qbDropY - qb.y), left = Math.max(0.05, qb.qbDropT - t);
        Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, Math.min(1, d / left / qb.top + 0.15));
        return true;
      }
      case 'hand': {
        const h = q.hand;
        const tgt = G.ents[P.off * 7 + C.OFF_SLOTS.indexOf(h.to)];
        if (!P.handDone) {
          const d = Math.hypot(qb.qbDropX - qb.x, qb.qbDropY - qb.y), left = Math.max(0.05, h.t - t);
          Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, Math.min(1, d / left / qb.top + 0.1));
          const md = Math.hypot(tgt.x - qb.x, tgt.y - qb.y);
          if (t >= h.t && (md < 2.2 || t > h.t + 0.6)) {
            P.handDone = true; P.handT = t;
            if (h.back) { P.qbMode = 'toss'; qb.qbDropX = F.fx(G, h.back[0]); qb.qbDropY = F.fy(G, h.back[1]); }
            BL.handoff(G, qb.id, tgt.id);
          }
          return true;
        }
        return false;
      }
      case 'pitch': {
        if (!P.handDone && t >= q.pitch.t) {
          P.handDone = true; P.handT = t;
          const tgt = G.ents[P.off * 7 + C.OFF_SLOTS.indexOf(q.pitch.to)];
          BL.pitch(G, qb.id, tgt.id, 0.3);
          qb.role = PT.Engine.Entity.R.IDLE;
        }
        Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, 0.4);
        return true;
      }
      case 'fake': {
        const fk = q.fake;
        if (t < fk.t) {
          const d = Math.hypot(qb.qbDropX - qb.x, qb.qbDropY - qb.y), left = Math.max(0.05, fk.t - t);
          Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, Math.min(1, d / left / qb.top + 0.1));
          return true;
        }
        if (!P.faked) { P.faked = true; P.fakeT = t; Q.paBite(G, play.flea ? 0.15 : 0); }
        if (userMoved) { P.qbMode = 'pass'; return false; }
        const dest = fk.roll || fk.drop, dur = fk.rollT || fk.dropT || 0.5;
        const tx = F.fx(G, dest[0]), ty = F.fy(G, dest[1]);
        if (t > fk.t + dur + 0.1) { P.qbMode = 'pass'; return false; }
        const d = Math.hypot(tx - qb.x, ty - qb.y), left = Math.max(0.05, fk.t + dur - t);
        Ph.steerTo(qb, tx, ty, Math.min(1, d / left / qb.top + 0.1));
        return true;
      }
      case 'mesh': {
        const m = q.mesh;
        if (!P.meshDone) {
          Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, 0.7);
          const rb = G.ents[P.off * 7 + 1];
          if (t >= m.t1 || P.giveNow) {
            P.meshDone = true;
            let give = P.giveNow && !m.always;                         // m.always: QB draw (always a keep)
            if (!P.giveNow && !m.always && !(qb.tm === G.userIdx && !G.idle)) give = Q.optionRead(G, qb);
            if (give) { P.handDone = true; P.handT = t; BL.handoff(G, qb.id, rb.id); }
            else {
              // keep: the QB runs the keep lane
              P.rusher = qb.id; P.run = true; P.runT = t; P.handDone = true; P.handT = t; P.crossed = true;
              PT.Engine.Routes.load(G, qb, m.keep, null, 'CONT');
              PT.Engine.AI.onBallChange(G);
              qb.carT = 0;
            }
            if (play.fake) P.faked = true;
          }
          return true;
        }
        return false;
      }
      case 'toss': {
        // flea flicker: QB drifts back, RB tosses it back at toss.t
        Ph.steerTo(qb, qb.qbDropX, qb.qbDropY, 0.5);
        if (!P.faked && t >= (q.hand.t + 0.1)) { P.faked = true; P.fakeT = t; Q.paBite(G, 0.15); }
        if (!P.tossBack && t >= q.toss.t && G.ball.st === 'held') {
          const rb = G.ball.car;
          P.tossBack = true;
          BL.pitch(G, rb, qb.id, 0.35);
          G.ents[rb].role = PT.Engine.Entity.R.BLOCK;
          P.rusher = -1; P.run = false;
          // defenders who already read run stay committed
        }
        if (P.tossBack && G.ball.st === 'held' && G.ball.car === qb.id) {
          P.qbMode = 'pass'; P.readStart = t + 0.15; qb.role = PT.Engine.Entity.R.QB;
          if (qb.tm === G.userIdx) G.setCtl(qb.id);
          return false;
        }
        return true;
      }
      default: return false;
    }
  };

  /** Play-action bite rolls for LB and S (design 6.6 PA effect). */
  Q.paBite = function (G, extra) {
    const T = G.T, P = G.P, d = 1 - P.off;
    const edge = P.edge || 0;
    const runCall = P.call && P.call.tags && P.call.tags.indexOf('heavy') >= 0;   // heavy run fronts bite harder
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k];
      if (!(e.pos === 'LB1' || e.pos === 'LB2' || e.pos === 'S')) continue;
      let p = T.PA_BITE - (e.r.smt - 50) * T.PA_BITE_SMT - T.PA_BITE_EDGE * edge + (runCall ? T.PA_BITE_RUNCALL : 0) + (extra || 0);
      p = PT.Util.clamp(p, 0.10, 0.80);
      if (G.rng.chance(p)) e.bite = 1;
    }
  };

  /** Option read (design P23): keep if DL1 crashes on the RB's lane, else give; Smarts mistake chance. */
  Q.optionRead = function (G, qb) {
    const P = G.P, d = 1 - P.off;
    const rd = G.ents[d * 7 + 0];
    const rb = G.ents[P.off * 7 + 1];
    // keep if the end crashes on the RB, give if he plays the QB
    const crashRB = P.readCommit === 'rb' || ((rb.x - rd.x) * rd.vx + (rb.y - rd.y) * rd.vy) > ((qb.x - rd.x) * rd.vx + (qb.y - rd.y) * rd.vy) + 3;
    let give = !crashRB;
    if (G.rng.chance(Math.max(0.03, 0.35 - qb.r.smt * 0.003))) give = !give;
    return give;
  };

  /** AI QB tick: script, then reads. */
  Q.update = function (G, qb, dt) {
    const P = G.P;
    if (!qb.ball) {
      if (P.qbMode === 'toss' || P.qbMode === 'hand' || P.qbMode === 'pitch' || P.qbMode === 'mesh') { Q.script(G, qb, dt, false); return; }
      PT.Engine.Physics.stop(qb); return;
    }
    if (Q.script(G, qb, dt, false)) return;
    if (P.qbMode !== 'pass' || P.thrown || P.windT > 0) { if (P.windT > 0) PT.Engine.Physics.stop(qb); return; }
    const dec = G.dec;
    Q.think(G, qb, dt, dec);
    Q.apply(G, qb, dec, dt);
  };

  /** Execute a decision for an AI QB. */
  Q.apply = function (G, qb, dec, dt) {
    const Ph = PT.Engine.Physics, BL = PT.Engine.Ball;
    if (dec.act === 'throw' || dec.act === 'away') { BL.startThrow(G, qb.id, dec.tx, dec.ty, dec.lob, false); Ph.stop(qb); return; }
    if (dec.act === 'scramble') { PT.Engine.AI.runCarrier(G, qb, dec.mx, dec.my, 1, false, dt); return; }
    Ph.steerDir(qb, dec.mx, dec.my, qb.top * 0.35);
  };

  Q._pr = { x: 0, y: 0 };
  Q._pr2 = { x: 0, y: 0 };
  /** openness of receiver r (design 8.14): distance to the nearest defender, both projected 0.6 s ahead */
  Q.openness = function (G, r) {
    const T = G.T, pr = PT.Engine.Routes.project(G, r, T.OPEN_PROJ, Q._pr);
    return PT.Engine.AI.nearestOppDist(G, r.tm, pr.x, pr.y, T.OPEN_PROJ);
  };

  /** Lead point for a throw to r: projected position at arrival. */
  Q.leadPoint = function (G, qb, r, lob, out) {
    const BL = PT.Engine.Ball, fl = G.tmpFl;
    let tx = r.x, ty = r.y;
    const wind = qb.info.t.quick_release ? G.T.WINDUP_QR : G.T.WINDUP;
    const pr = Q._pr;
    for (let i = 0; i < 3; i++) {
      BL.flight(G, qb, tx, ty, lob, fl);
      const tt = fl.t + wind;
      PT.Engine.Routes.project(G, r, tt, pr);
      tx = pr.x; ty = pr.y;
    }
    // keep it in bounds
    tx = PT.Util.clamp(tx, 1.2, C.FIELD.W - 1.2);
    ty = PT.Util.clamp(ty, 1, 119);
    out.tx = tx; out.ty = ty;
    return out;
  };

  /**
   * Decide what the QB should do now. Fills out {act:'none'|'throw'|'away'|'scramble', tx, ty, lob, mx, my, tgt}.
   * Used by the AI QB and by Autopilot for the user's QB.
   */
  Q.think = function (G, qb, dt, out) {
    const T = G.T, P = G.P, play = P.play, rng = G.rng, AI = PT.Engine.AI, BL = PT.Engine.Ball;
    out.act = 'none'; out.lob = false; out.mx = 0; out.my = 0; out.tgt = -1;
    const t = P.t, o = qb.tm * 7, dir = G.dir;
    if (t < P.readStart + (play.readAt ? 0 : T.QB_SET)) return out;
    const fog = (G.cfg.weather || {}).k === 'fog' && !qb.info.q.fogImm;
    const smt = qb.r.smt;
    const readEvery = Math.max(0.2, T.QB_READ_BASE - smt * T.QB_READ_K - (qb.info.q.owl ? T.QB_OWL : 0)) * (qb.readMul || 1);
    // pressure is only "felt" after a reaction delay (longer from the blind side) — that is where sacks come from
    let pressure = false;
    const pn = PT.Engine.AI.nearestOpp(G, qb, qb.x, qb.y);
    if (pn >= 0) {
      const r = G.ents[pn], dx = r.x - qb.x, dy = r.y - qb.y, dd = Math.sqrt(dx * dx + dy * dy);
      if (dd <= T.PRESS_R) {
        if (qb.pressT < 0) qb.pressT = t;
        const front = (dx * -Math.sin(qb.fa) + dy * Math.cos(qb.fa)) > -0.3;
        const delay = (0.7 - smt * 0.002) * (front ? 1 : 2.5);
        pressure = t - qb.pressT >= delay;
      } else qb.pressT = -1;
    }
    const maxT = BL.maxThrow(G, qb);
    const reads = play.read && play.read.length ? play.read : ['WR1', 'WR2', 'TE', 'RB'];
    if (qb.qbNext === 0) qb.qbNext = t + readEvery;
    if (t >= qb.qbNext) { qb.qbRead = (qb.qbRead + 1) % reads.length; qb.qbNext = t + readEvery; }
    // scan: deep shot first, then the current read
    let bestOpen = -1, bestIdx = -1;
    const thr = play.screen || play.type === 'SCREEN' ? 1.2 : pressure ? T.OPEN_PRESS : T.OPEN_MIN;
    let pick = -1;
    for (let i = 0; i < reads.length; i++) {
      const k = C.OFF_SLOTS.indexOf(reads[i]);
      if (k < 0) continue;
      const r = G.ents[o + k];
      if (!BL.eligible(G, r) || r.ball) continue;
      const dist = Math.hypot(r.x - qb.x, r.y - qb.y);
      if (dist > maxT - 2) continue;
      if (fog && dist > 25) continue;
      const op = Q.openness(G, r);
      const depth = (r.y - P.los0) * dir;
      if (op > bestOpen) { bestOpen = op; bestIdx = o + k; }
      const deepNeed = T.OPEN_DEEP - (qb.info.q.eagle ? 0.4 : 0);
      if (depth >= Math.max(G.togo, 8) && op >= deepNeed && dist > 12) { pick = o + k; break; }
      // 3rd/4th down: a catch short of the sticks needs to be wide open (he can still run after the catch)
      let need = thr;
      if (G.down >= 3 && !G.tryTwo) {
        const pr = PT.Engine.Routes.project(G, r, 1.0, Q._pr2);
        if ((pr.y - G.fdY) * dir < -1) need += 2.0;
        else need -= 0.8;                       // beyond the sticks: he will fit it into a tighter window
      }
      if (i === qb.qbRead && op >= need && (depth > -2 || op > 4)) pick = o + k;
    }
    const tooLong = t - P.readStart >= T.QB_MAX_T - 0.4 || t >= T.QB_MAX_T + 0.6;
    if (pick < 0 && tooLong) {
      if (bestOpen >= 1.2 && bestIdx >= 0) pick = bestIdx;
      else { Q.throwAway(G, qb, out); return out; }
    }
    if (pick >= 0) {
      const r = G.ents[pick];
      const near = AI.nearestOpp(G, r, r.x, r.y);
      let lob = false;
      const dist = Math.hypot(r.x - qb.x, r.y - qb.y);
      if (near >= 0 && dist >= 20) {
        const d = G.ents[near];
        if (Math.hypot(d.x - qb.x, d.y - qb.y) < dist) lob = true;
      }
      Q.leadPoint(G, qb, r, lob, out);
      out.act = 'throw'; out.lob = lob; out.tgt = pick;
      return out;
    }
    // pressure with nobody open (design 8.14)
    if (pressure) {
      if (qb.rs === 0) {
        if (smt >= 60 && rng.chance(0.5)) qb.rs = 1;
        else if (qb.r.spd >= 70 || qb.info.t.scrambler) qb.rs = 2;
        else qb.rs = smt >= 50 && rng.chance(0.35) ? 1 : 3;
      }
      if (qb.rs === 1) { Q.throwAway(G, qb, out); return out; }
    }
    if (qb.rs === 2 || (pressure && qb.rs !== 3 && t - P.readStart > 1.2)) {
      // scramble: upfield if there is room, else roll away from the pressure
      const ahead = AI.nearestOppDist(G, qb.tm, qb.x, qb.y + dir * 4, 0.3);
      if (ahead > 3.5) { out.mx = 0; out.my = dir; }
      else {
        const n = AI.nearestOpp(G, qb, qb.x, qb.y);
        const side = n >= 0 && G.ents[n].x > qb.x ? -1 : 1;
        out.mx = side * 0.9; out.my = dir * 0.3;
        if (Math.abs(qb.x + side * 3 - MID) > 24) { out.mx = 0; out.my = dir; }
      }
      out.act = 'scramble';
      return out;
    }
    // hold in the pocket, slide away from the nearest rusher
    const n = AI.nearestOpp(G, qb, qb.x, qb.y);
    if (n >= 0) {
      const d = G.ents[n], dx = qb.x - d.x, dy = qb.y - d.y, dl = Math.hypot(dx, dy) || 1;
      if (dl < 4) { out.mx = dx / dl; out.my = dy / dl * 0.3; }
    }
    return out;
  };

  Q.throwAway = function (G, qb, out) {
    const side = qb.x > MID ? 1 : -1;
    out.act = 'away'; out.tx = MID + side * 29; out.ty = qb.y + G.dir * 8; out.lob = false; out.tgt = -1;
    return out;
  };
})(globalThis.PT = globalThis.PT || {});
