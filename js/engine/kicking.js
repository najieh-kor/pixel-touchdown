/* Pixel Touchdown: js/engine/kicking.js
 * Owner: WP3. Responsibility: kickoff/punt/FG/PAT flight + kick-meter state machine.
 * Design 8.4 (kickoffs, onside), 8.5 (punts), 8.6 (FG/XP: max range, auto-kick %, manual drag-aim with σ + wind).
 * Kickoffs and punts are automatic; returns are played live (AI or the user's returner).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const K = PT.ns('Engine.Kicking');
  const MID = C.FIELD.MID_X;
  const DEG = Math.PI / 180;

  /** Effective KCK for a kicker info (team bonus applies, clamp 1..99). */
  K.kck = function (G, ki) {
    let v = ki.r.kck + G.tb[ki.tm];
    if (G.close) { if (ki.t.ice_cold) v += 5; if (ki.t.shaky_paws) v -= 5; }
    if (G.cfg.po > 0 && ki.t.big_game) v += 4;
    return v < 1 ? 1 : v > 99 ? 99 : v;
  };
  K.maxRange = function (G, ki) { return G.T.FG_RANGE + K.kck(G, ki) * G.T.FG_RANGE_K + (ki.t.boomer ? G.T.FG_BOOM : 0); };
  K.windMph = function (G) { const w = G.cfg.weather || {}; return w.k === 'clear' ? 0 : (w.mph || 0); };

  /** Auto-kick success chance 0..1 (design 8.6). */
  K.autoPct = function (G, ki, dist) {
    const T = G.T, kck = K.kck(G, ki), w = (G.cfg.weather || {}).k;
    let p = T.FG_P0 - Math.max(0, dist - 25) * (T.FG_PD + (90 - kck) * T.FG_PK) - K.windMph(G) * T.FG_WIND;
    if (ki.t.wild_leg) p -= T.FG_WILD;
    if (w === 'rain' || w === 'snow') p *= T.FG_WET;
    return PT.Util.clamp(p, 0.05, 0.99);
  };

  /** Lateral wind drift (yd) at the posts for a kick of dist yards. */
  K.windDrift = function (G, ki, dist) {
    const w = G.cfg.weather || {}, mph = K.windMph(G);
    if (!mph) return 0;
    const wl = Math.hypot(w.wx || 0, w.wy || 0) || 1;
    return mph * (dist / 10) * G.T.KICK_WIND * ((w.wx || 0) / wl) * (ki.t.ice_toes ? 0.5 : 1);
  };

  /** FG/XP aim preview for Action.kickAim (field-space direction + power). Fills G.snap.kick. */
  K.preview = function (G, ka) {
    const s = G.snap.kick, ki = G.kicker(G.poss), RU = PT.Engine.Rules;
    const dist = G.kickWait === 'xp' ? K.xpDist(G) : RU.fgDist(G);
    const maxR = K.maxRange(G, ki);
    s.on = true; s.dist = dist; s.pct = Math.round(K.autoPct(G, ki, dist) * 100); s.minPow = Math.min(1, dist / maxR);
    // a manual kick needs pow ≥ minPow and over-kicks above 0.97: past that the green zone is empty (HUNT2 #3)
    s.outRange = s.minPow > G.T.KICK_POW_MAX;
    if (s.outRange) s.pct = 0;
    let ang = 0;
    if (ka && ka.on && (ka.dx || ka.dy)) ang = Math.atan2(ka.dx, ka.dy * G.dir) / DEG;
    ang = PT.Util.clamp(ang, -G.T.KICK_AIM_MAX, G.T.KICK_AIM_MAX);
    s.ang = ang; s.pow = ka && ka.on ? PT.Util.clamp(ka.pow, 0, 1) : 0;
    s.x = MID + dist * Math.tan(ang * DEG) + K.windDrift(G, ki, dist);
    s.y = RU.dirOf(G, G.poss) > 0 ? 120 : 0;
    const kick = G.ents[G.poss * 7];
    s.kx = kick.x; s.ky = kick.y;
  };
  K.xpDist = function (G) { return Math.round(Math.abs(PT.Engine.Rules.goalY(G, G.poss) - G.los) + G.T.FG_ADD); };

  /** Manual kick result (design 8.6). @returns {{good:boolean, lat:number, short:boolean}} */
  K.manual = function (G, ki, dist, angDeg, pow) {
    const T = G.T, rng = G.rng, kck = K.kck(G, ki), w = (G.cfg.weather || {}).k;
    const maxR = K.maxRange(G, ki);
    let sig = T.KICK_SIG0 + (100 - kck) * T.KICK_SIGK;
    if (ki.t.ice_toes) sig *= 0.8;
    if (ki.t.wild_leg) sig *= 1.3;
    if (pow > 0.97) sig *= 2;          // over-kick (decision-time pass: band 0.95 → 0.97)
    if (ki.tm === G.userIdx && G.sk.kickguru) sig *= G.sk.kickguru >= 2 ? 0.8 : 0.9;
    if (w === 'rain' || w === 'snow') sig += 0.5;
    const err = rng.normal(0, sig);
    const lat = dist * Math.tan((angDeg + err) * DEG) + K.windDrift(G, ki, dist);
    if (pow < dist / maxR) return { good: false, lat: lat, short: true };
    let good = Math.abs(lat) <= T.GOAL_HALF_W;
    if (Math.abs(Math.abs(lat) - T.GOAL_HALF_W) <= T.DOINK) { good = rng.chance(0.5); G.em.emit('doink', {}); }
    return { good: good, lat: lat, short: false };
  };

  // ------------------------------------------------------------------ flights
  function launch(G, kind, x0, y0, x1, y1, z1, T, apex) {
    const b = G.ball;
    for (let i = 0; i < 14; i++) G.ents[i].ball = false;
    b.st = 'air'; b.kind = kind; b.car = -1; b.sx = x0; b.sy = y0; b.sz = 0.3; b.lx = x1; b.ly = y1; b.lz = z1;
    b.T = T; b.t = 0; b.H = apex - (b.sz + z1) / 2;
  }

  /** Begin a kickoff by team kt (phase KICK). */
  K.startKickoff = function (G, kt) {
    const F = PT.Engine.Formation, P = G.P;
    F.kickoff(G, kt);
    PT.Engine.Ball.spot(G, MID, G.ballSpotY);
    G.ball.z = 0.3;
    P.stage = 'setup'; P.st = 0;
    const R = PT.Engine.Entity.R;
    for (let k = 0; k < 7; k++) {
      const a = G.ents[kt * 7 + k], b = G.ents[(1 - kt) * 7 + k];
      a.role = k === 0 ? R.KICKER : R.KCOVER; a.side = 'K';
      b.role = k === 0 ? R.KRET : R.KBLOCK; b.side = 'K';
    }
    P.ret = (1 - kt) * 7; P.kickerEnt = kt * 7;
    G.canOnside = G.userIdx === kt && G.q >= 4 && G.score[kt] < G.score[1 - kt];
    if (G.userIdx !== kt && kt !== -1) {
      const diff = G.score[kt] - G.score[1 - kt];
      if (G.q >= 4 && PT.Engine.Rules.clockLeft(G) < PT.Engine.Rules.warnT(G) * 1.5 && diff < 0 && diff >= -16) P.onside = true;
    }
  };

  /** Begin a punt (phase KICK). */
  K.startPunt = function (G) {
    const F = PT.Engine.Formation, P = G.P, R = PT.Engine.Entity.R, o = G.poss;
    F.punt(G);
    P.stage = 'set'; P.st = 0;
    for (let k = 0; k < 7; k++) {
      const a = G.ents[o * 7 + k], b = G.ents[(1 - o) * 7 + k];
      a.role = k === 0 ? R.KICKER : R.KCOVER;
      b.role = k === 0 ? R.KRET : R.KBLOCK;
    }
    P.ret = (1 - o) * 7; P.kickerEnt = o * 7;
    PT.Engine.Ball.spot(G, MID, G.los);
  };

  /** Begin a field goal or extra point; manual = {ang, pow} or null for auto. */
  K.startFG = function (G, kind, manual) {
    const F = PT.Engine.Formation, P = G.P, R = PT.Engine.Entity.R, o = G.poss;
    if (!P.fgLined) F.fieldGoal(G);
    P.stage = 'set'; P.st = 0; P.manual = manual;
    for (let k = 0; k < 7; k++) {
      const a = G.ents[o * 7 + k], b = G.ents[(1 - o) * 7 + k];
      a.role = k === 0 ? R.KICKER : k === 1 ? R.HOLDER : R.PBLK;
      b.role = k < 4 ? R.RUSH : R.IDLE;
    }
    P.kickerEnt = o * 7;
    P.fgDist = kind === 'xp' ? K.xpDist(G) : PT.Engine.Rules.fgDist(G);
    PT.Engine.Ball.spot(G, MID, G.los);
  };

  /** Kick phase tick (setup → kick → flight → catch/land/result). */
  K.update = function (G, dt) {
    const P = G.P, T = G.T, rng = G.rng, F = PT.Engine.Formation, Ph = PT.Engine.Physics, b = G.ball, RU = PT.Engine.Rules;
    P.st += dt;
    const fast = (G.fast || G.idle);
    if (P.kind === 'kickoff') {
      const kt = P.off, dirK = RU.dirOf(G, kt), kick = G.ents[kt * 7];
      if (P.stage === 'setup') {
        const setT = fast ? T.FAST.KICKOFF_SETUP_T : T.KICKOFF_SETUP_T;
        F.jogStep(G, Math.min(1, P.st / (setT * 0.7)));
        if (G.onsideReq) { P.onside = true; G.onsideReq = false; }
        if (P.st >= setT) { P.stage = 'approach'; P.st = 0; G.canOnside = false; }
        return;
      }
      if (P.stage === 'approach') {
        Ph.steerTo(kick, MID, G.ballSpotY - 0.6 * dirK, 0.8);
        for (let i = 0; i < 14; i++) if (i !== kick.id) Ph.stop(G.ents[i]);
        if (Math.hypot(kick.x - MID, kick.y - G.ballSpotY) < 1.0 || P.st > 1.2) {
          kick.an = 'kick'; kick.at = 0;
          const ki = kick.info;
          const kck = K.kck(G, ki);
          if (P.onside) {
            let p = T.ONSIDE_BASE + (kck - 70) * T.ONSIDE_K + (kt === G.userIdx && G.diff === 0 ? T.ONSIDE_ROOKIE : 0);
            P.onsideOk = rng.chance(PT.Util.clamp(p, 0.02, 0.6));
            P.kind = 'onside';
            launch(G, 'onside', MID, G.ballSpotY, MID + rng.range(-6, 6), G.ballSpotY + 11 * dirK, 0.1, 1.0, 1.5);
            G.em.emit('kickoff', { tid: G.tids[kt], onside: true });
          } else {
            const w = G.cfg.weather || {}, wl = Math.hypot(w.wx || 0, w.wy || 0) || 1;
            let dist = T.KO_DIST + kck * T.KO_KCK + rng.normal(0, T.KO_SD) + K.windMph(G) * ((w.wy || 0) / wl) * dirK * 0.15;
            const landY = G.ballSpotY + dist * dirK;
            const landYard = T.KO_LINE + dist;
            P.koTB = landYard >= 110 || (landYard >= 100 && rng.chance(T.KO_TB));
            const lx = PT.Util.clamp(MID + rng.normal(0, 7), 6, C.FIELD.W - 6);
            const ly = PT.Util.clamp(landY, 1, 119);
            launch(G, 'ko', MID, G.ballSpotY, lx, ly, 1.3, T.KO_HANG * Math.sqrt(Math.max(30, dist) / 65), 20);
            G.em.emit('kickoff', { tid: G.tids[kt], onside: false, x: lx, y: ly });
          }
          PT.Engine.Snapshot.fx(G, 'kick', MID, G.ballSpotY, 0.3, 1, G.tids[kt], '');
          P.stage = 'flight'; P.st = 0; P.kicked = true;
          kick.role = PT.Engine.Entity.R.KCOVER;
        }
        return;
      }
      if (P.stage === 'flight') {
        if (b.t >= b.T) K.land(G);
      }
      return;
    }
    if (P.kind === 'onside') {
      if (P.stage === 'flight' && b.t >= b.T) {
        const kt = P.off, rt = 1 - kt;
        P.stage = 'done';
        const team = P.onsideOk ? kt : rt;
        const y = P.onsideOk ? RU.ownYard(G, kt, 46) : RU.ownYard(G, kt, 45);
        b.st = 'dead';
        G.whistle('onside', team, y, false);
      }
      return;
    }
    if (P.kind === 'punt') {
      const o = P.off, kick = G.ents[o * 7];
      if (P.stage === 'set') {
        const lt = fast ? T.FAST.LINEUP_T : T.LINEUP_T;
        F.jogStep(G, Math.min(1, P.st / lt));
        if (P.st >= lt + (fast ? 0.05 : 0.4)) {
          P.stage = 'snap'; P.st = 0;
          launch(G, 'snap', MID, G.los, kick.x, kick.y, 1.0, 0.45, 1.0);
          b.to = kick.id;
          G.em.emit('snap', { play: 'punt', side: 'O', userSide: G.userSide() });
        }
        return;
      }
      if (P.stage === 'snap') {
        if (b.t >= b.T) { PT.Engine.Ball.give(G, kick.id); P.stage = 'hold'; P.st = 0; }
        return;
      }
      if (P.stage === 'hold') {
        Ph.stop(kick);
        if (P.st >= 0.45) {
          if (rng.chance(T.PUNT_BLOCK)) {
            P.blocked = true; b.st = 'dead';
            return G.whistle('down', 1 - o, G.los, false);
          }
          kick.an = 'kick'; kick.at = 0;
          const ki = kick.info, kck = K.kck(G, ki);
          let gross = T.PUNT_NET + kck * T.PUNT_KCK + rng.normal(0, T.PUNT_SD) + (ki.t.boomer ? T.PUNT_BOOM : 0) + T.PUNT_RET_ADD;
          gross = Math.max(18, gross);
          const goal = RU.goalY(G, o);
          let ly = G.los + gross * G.dir;
          P.puntTB = (ly - goal) * G.dir >= 0;
          if (P.puntTB) ly = goal + G.dir * rng.range(2, 8);
          P.kickDist = Math.abs(ly - G.los);
          const lx = PT.Util.clamp(MID + rng.normal(0, 5), 8, C.FIELD.W - 8);
          launch(G, 'punt', kick.x, kick.y, lx, PT.Util.clamp(ly, 1, 119), 1.4, T.PUNT_HANG * Math.sqrt(Math.max(25, gross) / 45), 18);
          P.kicked = true; P.stage = 'flight'; P.st = 0;
          kick.role = PT.Engine.Entity.R.KCOVER;
          PT.Engine.Snapshot.fx(G, 'kick', kick.x, kick.y, 0.5, 1, G.tids[o], '');
        }
        return;
      }
      if (P.stage === 'flight' && b.t >= b.T) K.land(G);
      return;
    }
    if (P.kind === 'fg' || P.kind === 'xp') {
      const o = P.off, kick = G.ents[o * 7], holder = G.ents[o * 7 + 1];
      if (P.stage === 'set') {
        const lt = fast ? 0.05 : 0.35;
        if (!P.fgLined) F.jogStep(G, Math.min(1, P.st / lt));
        if (P.st >= lt) {
          P.stage = 'snap'; P.st = 0;
          launch(G, 'snap', MID, G.los, holder.x, holder.y, 0.4, 0.35, 0.8);
          G.em.emit('snap', { play: P.kind, side: 'O', userSide: G.userSide() });
        }
        return;
      }
      if (P.stage === 'snap') {
        holder.an = 'stance';
        if (b.t >= b.T) { b.st = 'spot'; b.x = holder.x; b.y = holder.y; b.z = 0.3; P.stage = 'approach'; P.st = 0; }
        return;
      }
      if (P.stage === 'approach') {
        Ph.steerTo(kick, holder.x - 0.5, holder.y - 0.6 * G.dir, 0.6);
        if (P.st >= (fast ? 0.05 : 0.45)) {
          kick.an = 'kick'; kick.at = 0;
          const ki = kick.info, dist = P.fgDist;
          let res;
          if (P.manual) res = K.manual(G, ki, dist, P.manual.ang, P.manual.pow);
          else {
            const good = rng.chance(K.autoPct(G, ki, dist));
            const side = rng.chance(0.5) ? 1 : -1;
            const shortMiss = !good && dist > K.maxRange(G, ki) - 6 && rng.chance(0.5);
            res = { good: good, lat: good ? rng.range(-2.2, 2.2) : side * rng.range(3.4, 6.5), short: shortMiss };
          }
          P.fgGood = res.good;
          const endY = RU.dirOf(G, o) > 0 ? 120 : 0;
          const run = Math.abs(endY - holder.y);
          const lx = MID + res.lat * (run + 4) / Math.max(1, run), ly = endY + RU.dirOf(G, o) * 4;
          const tt = Math.max(0.9, run / 24);
          launch(G, 'fg', holder.x, holder.y, res.short ? MID + res.lat * 0.8 : lx, res.short ? endY - RU.dirOf(G, o) * 3 : ly, res.short ? 0.2 : 4, tt,
            res.short ? 3 : Math.max(6, run * 0.28));
          P.stage = 'flight'; P.st = 0; P.kicked = true;
          PT.Engine.Snapshot.fx(G, 'kick', holder.x, holder.y, 0.3, 1, G.tids[o], '');
          G.em.emit('kick', { tid: G.tids[o], kind: P.kind, dist: dist });
        }
        return;
      }
      if (P.stage === 'flight' && b.t >= b.T) {
        P.stage = 'done'; b.st = 'dead';
        PT.Engine.Snapshot.fx(G, 'text', b.x, b.y, 3, 1, G.tids[o], P.fgGood ? 'IT\'S GOOD!' : 'NO GOOD!');
        G.whistle(P.kind, o, G.los, false, P.fgGood);
      }
    }
  };

  /** Kickoff/punt ball arrives: catch, touchback, fair catch, muff, or live return. */
  K.land = function (G) {
    const P = G.P, T = G.T, b = G.ball, rng = G.rng, RU = PT.Engine.Rules;
    const kt = P.off, rt = 1 - kt, ret = G.ents[P.ret];
    const isPunt = P.kind === 'punt';
    P.stage = 'landed';
    const og = RU.ownGoalY(G, rt), dirR = RU.dirOf(G, rt);
    const inEZ = (b.y - og) * dirR <= 0;
    // a user returner decides: tap during the flight = touchback (kickoff in the end zone) / fair catch (punt);
    // steering during the flight = "I'm bringing it out"; no input = the usual auto choice
    const userRet = G.userRet(rt);
    let koTB = P.koTB;
    if (userRet && !isPunt && inEZ) koTB = P.retCall === 'tb' ? true : P.retMoved ? false : P.koTB;
    // touchbacks: kickoff past the end line or chosen, punt into the end zone
    if ((isPunt && P.puntTB) || (!isPunt && koTB && inEZ) || b.y <= 0.5 || b.y >= 119.5) {
      b.st = 'dead';
      P.retY0 = null; P.ret = -1;
      PT.Engine.Snapshot.fx(G, 'text', b.x, b.y, 2, 1, G.tids[rt], 'TOUCHBACK');
      return G.whistle('touchback', rt, b.y, false);
    }
    if (isPunt && rng.chance(T.PUNT_MUFF)) {
      b.st = 'dead';
      PT.Engine.Snapshot.fx(G, 'fumble', b.x, b.y, 0.5, 1, G.tids[rt], 'MUFFED!');
      P.fumBy = P.ret; P.frBy = kt * 7 + 2;
      G.em.emit('fumble', { pid: ret.pid, by: -1, x: b.x, y: b.y, muff: true });
      return G.whistle('down', kt, b.y, false);
    }
    // the returner catches it where it comes down (he has been running there)
    ret.x = ret.x + (b.x - ret.x) * 0.85; ret.y = ret.y + (b.y - ret.y) * 0.85;
    PT.Engine.Ball.give(G, ret.id);
    P.retY0 = ret.y; P.tbOk = inEZ;
    ret.an = 'catch'; ret.at = 0;
    G.em.emit('catch', { pid: ret.pid, x: ret.x, y: ret.y, contested: false, yac: 0, ret: true });
    if (isPunt) {
      let near = 99;
      for (let k = 0; k < 7; k++) { const c = G.ents[kt * 7 + k]; near = Math.min(near, Math.hypot(c.x - ret.x, c.y - ret.y)); }
      const fc = userRet ? P.retCall === 'fc' : (near < 5.5 || (ret.y - og) * dirR < 8);
      if (fc) {
        P.fairCatch = true; b.st = 'dead';
        PT.Engine.Snapshot.fx(G, 'text', ret.x, ret.y, 2, 1, G.tids[rt], 'FAIR CATCH');
        P.retEndY = ret.y;
        return G.whistle('down', rt, PT.Util.clamp(ret.y, 10.5, 109.5), false);
      }
    }
    G.phase = 'LIVE';
    PT.Engine.AI.onBallChange(G);
  };
})(globalThis.PT = globalThis.PT || {});
