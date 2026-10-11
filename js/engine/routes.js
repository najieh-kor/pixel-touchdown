/* Pixel Touchdown: js/engine/routes.js
 * Owner: WP3. Responsibility: route waypoint expansion, route following.
 * Design 6.5: straight lines point to point; turns sharper than 45° cost 0.15 − MOV×0.001 s (Route Artist ×0.5);
 * end codes CONT / SETTLE / BLOCK; waits; BLOCK(t)→ routes re-anchor at the player's spot when released.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const RT = PT.ns('Engine.Routes');
  RT.END = { NONE: 0, CONT: 1, SETTLE: 2, BLOCK: 3 };
  const MID = C.FIELD.MID_X;

  /**
   * Load offense-frame waypoints into e (field space). from = first index to run (alignment is index 0).
   * @param {Object} G @param {Object} e @param {number[][]} pts @param {number[]|null} waits @param {string} end
   */
  RT.load = function (G, e, pts, waits, end) {
    const F = PT.Engine.Formation;
    const n = Math.min(pts.length, 12);
    for (let i = 0; i < n; i++) {
      e.wpx[i] = F.fx(G, pts[i][0]);
      e.wpy[i] = F.fy(G, pts[i][1]);
      e.wpw[i] = waits && waits[i] ? waits[i] : 0;
    }
    // decision-time pass: a human QB's receivers break a touch earlier (the first stem is USER_STEM shorter and the rest
    // of the route moves up with it), so the first read is ready by ~1.2 s
    if (n >= 3 && e.tm === G.userIdx && G.poss === G.userIdx && G.human() && G.T.USER_STEM[G.diff] < 1) {
      const d1 = (pts[1][1] - pts[0][1]);
      if (d1 > 3) {
        const cut = d1 * (1 - G.T.USER_STEM[G.diff]) * G.dir;
        for (let i = 1; i < n; i++) e.wpy[i] -= cut;
      }
    }
    e.wpn = n; e.wpi = 1; e.wpWait = e.wpw[0];
    e.wpEnd = end === 'SETTLE' ? RT.END.SETTLE : end === 'BLOCK' ? RT.END.BLOCK : end === 'CONT' ? RT.END.CONT : RT.END.NONE;
    e.setOn = false; e.drT = 0; e.drOn = false; e.drRe = 0; e.drHold = 0;
    if (n >= 2) { const dx = e.wpx[1] - e.wpx[0], dy = e.wpy[1] - e.wpy[0], l = Math.hypot(dx, dy) || 1; e.hx = dx / l; e.hy = dy / l; }
    else { e.hx = 0; e.hy = G.dir; }
  };

  /**
   * Where will receiver e be in t seconds if he keeps running his route? (used for QB leads and openness)
   * Writes out.x/out.y.
   */
  RT.project = function (G, e, t, out) {
    const R = PT.Engine.Entity.R;
    if (e.role !== R.ROUTE || e.wpn === 0 || e.blkT > t) { out.x = e.x + e.vx * t; out.y = e.y + e.vy * t; return out; }
    if (e.drOn) {
      const dx = e.drX - e.x, dy = e.drY - e.y, d = Math.sqrt(dx * dx + dy * dy), m = Math.min(d, e.top * G.T.DRILL_SPD * t);
      out.x = d > 0.01 ? e.x + dx / d * m : e.x; out.y = d > 0.01 ? e.y + dy / d * m : e.y; return out;
    }
    let x = e.x, y = e.y;
    const waiting = e.wpWait > 0;
    let left = t - Math.max(0, e.blkT) - Math.max(0, e.wpWait);
    const sp = e.top * 0.95;
    // distance he can cover in `left` seconds, accelerating from his current speed (0 after a wait)
    const v0 = waiting ? 0 : Math.min(e.spd, sp);
    const tTop = Math.max(0, (sp - v0) / e.acc);
    const run = (tt) => (tt <= tTop ? v0 * tt + 0.5 * e.acc * tt * tt : v0 * tTop + 0.5 * e.acc * tTop * tTop + sp * (tt - tTop));
    let dist = left > 0 ? run(left) : 0;
    let i = e.wpi;
    while (dist > 0 && i < e.wpn) {
      const dx = e.wpx[i] - x, dy = e.wpy[i] - y, d = Math.sqrt(dx * dx + dy * dy);
      if (dist < d) { x += dx / d * dist; y += dy / d * dist; dist = 0; break; }
      x = e.wpx[i]; y = e.wpy[i]; dist -= d + (e.wpw[i] || 0) * sp; i++;
    }
    if (dist > 0 && e.wpEnd === RT.END.CONT) {
      let hx = e.hx, hy = e.hy;
      if (i >= 2 && i <= e.wpn) { const ax = e.wpx[i - 1] - e.wpx[i - 2], ay = e.wpy[i - 1] - e.wpy[i - 2], al = Math.hypot(ax, ay) || 1; hx = ax / al; hy = ay / al; }
      x += hx * dist; y += hy * dist;
      const lim = 24;
      if (x > MID + lim) x = MID + lim; else if (x < MID - lim) x = MID - lim;
    }
    out.x = x; out.y = y;
    return out;
  };

  /** Shift remaining waypoints so the route starts from the player's current spot (BLOCK(t)→ release). */
  RT.reanchor = function (e) {
    const dx = e.x - e.wpx[0], dy = e.y - e.wpy[0];
    for (let i = 0; i < e.wpn; i++) { e.wpx[i] += dx; e.wpy[i] += dy; }
    e.wpi = 1;
  };

  /** True while the QB still holds the ball behind the line (pass not thrown, no run). */
  function qbHolds(G) {
    const P = G.P, b = G.ball;
    return P.kind === 'scrim' && b.st === 'held' && P.qb >= 0 && b.car === P.qb && !P.thrown && !P.crossed && !P.run;
  }
  RT.qbHolds = qbHolds;

  const CAND = 10;
  /**
   * Scramble drill: every DRILL_RE s pick open grass around the receiver (away from the nearest defenders, spaced from
   * teammates, downfield of the LOS, inside the field), toward the QB's scramble side; under pressure break back
   * toward the ball. Staying put (a zone hole) is a candidate too.
   */
  function drill(G, e, dt) {
    const T = G.T, P = G.P, Ph = PT.Engine.Physics, dir = G.dir;
    e.drRe -= dt;
    if (e.drRe <= 0) {
      e.drRe = T.DRILL_RE;
      const qb = G.ents[P.qb >= 0 ? P.qb : G.poss * 7];
      const press = qbHolds(G) && (PT.Engine.Ball.pressure(G, qb, T.PRESS_R + 1) > 0 || P.t > T.DRILL_BACK_T);
      const qvx = qb.vx;
      const los = P.los0 != null ? P.los0 : G.los;
      let bx = e.x, by = e.y, bs = -1e9;
      const restless = e.drHold > T.DRILL_HOLD;                            // sat long enough: move to new grass
      for (let k = 0; k <= (restless ? CAND - 1 : CAND); k++) {
        let cx = e.x, cy = e.y;
        if (k < CAND) { const a = k / CAND * Math.PI * 2; cx += Math.cos(a) * T.DRILL_R; cy += Math.sin(a) * T.DRILL_R; }
        cx = Math.max(2, Math.min(C.FIELD.W - 2, cx));
        // stay 2+ yd downfield of the LOS, and inside the back of the end zone
        const minY = los + 2 * dir, backY = dir > 0 ? 117 : 3;
        if ((cy - minY) * dir < 0) cy = minY;
        if ((cy - backY) * dir > 0) cy = backY;
        let sc = 0, dmin = 12;
        const d0 = (1 - e.tm) * 7;
        for (let j = 0; j < 7; j++) {
          const o = G.ents[d0 + j];
          if (o.downT > 0) continue;
          const ox = o.x + o.vx * 0.4 - cx, oy = o.y + o.vy * 0.4 - cy, od = Math.sqrt(ox * ox + oy * oy);
          if (od < dmin) dmin = od;
        }
        sc += dmin;
        // spacing from the other receivers
        const o0 = e.tm * 7;
        for (let j = 0; j < 7; j++) {
          const m = G.ents[o0 + j];
          if (m === e || m.role !== e.role) continue;
          const mx = (m.drOn ? m.drX : m.x) - cx, my = (m.drOn ? m.drY : m.y) - cy, md = Math.sqrt(mx * mx + my * my);
          if (md < 6) sc -= (6 - md) * 0.6;
        }
        const qx = qb.x - cx, qy = qb.y - cy, qd = Math.sqrt(qx * qx + qy * qy);
        if (qd > 32) sc -= (qd - 32) * 0.3;                                  // stay in throwing range
        if (press) sc -= qd * T.DRILL_BACK_K;                                 // break back toward the ball
        sc += (cx - e.x) * qvx * 0.08;                                        // follow the QB's scramble direction
        if (k === CAND) sc += 0.6;                                            // a hole: sit in it (hysteresis)
        if (!restless && Math.abs(cx - e.drX) + Math.abs(cy - e.drY) < 1.5) sc += 0.8;
        if (restless && Math.abs(cx - e.x) + Math.abs(cy - e.y) < 2.5) sc -= 3;
        if (sc > bs) { bs = sc; bx = cx; by = cy; }
      }
      if (restless) e.drHold = 0;
      e.drX = bx; e.drY = by;
    }
    const dx = e.drX - e.x, dy = e.drY - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.6) { e.drHold += dt; Ph.steerDir(e, e.hx, e.hy, 1.2); return; }   // settled in the hole: shuffle, then move on
    e.hx = dx / d; e.hy = dy / d;
    Ph.steerDir(e, e.hx, e.hy, e.top * Math.min(T.DRILL_SPD, 0.35 + d * 0.15));
  }

  /**
   * Follow the route: sets desired velocity. Returns true while on the route, false once the end code takes over.
   * @returns {boolean}
   */
  RT.follow = function (G, e, dt) {
    const Ph = PT.Engine.Physics;
    if (e.wpWait > 0) { e.wpWait -= dt; Ph.stop(e); return true; }
    if (e.turnT > 0) e.turnT -= dt;
    const slow = e.turnT > 0 ? 0.45 : 1;
    if (e.wpi < e.wpn) {
      const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
      const dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.7) {
        if (e.wpw[e.wpi] > 0) e.wpWait = e.wpw[e.wpi];
        e.wpi++;
        if (e.wpi < e.wpn) {
          const nx = e.wpx[e.wpi] - tx, ny = e.wpy[e.wpi] - ty, nl = Math.hypot(nx, ny) || 1;
          const px = e.hx, py = e.hy;
          const cosA = (nx * px + ny * py) / nl;
          if (cosA < 0.7071) {
            let tt = 0.15 - e.r.mov * 0.001;
            if (e.info && e.info.t.route_artist) tt *= 0.5;
            e.turnT = Math.max(0.03, tt);
          }
          e.hx = nx / nl; e.hy = ny / nl;
        }
        return true;
      }
      e.hx = dx / d; e.hy = dy / d;
      Ph.steerDir(e, e.hx, e.hy, e.top * 0.97 * slow);
      return true;
    }
    // end code. Playtest: a receiver never stands still while the QB holds the ball. He keeps the stem for a moment
    // (CONT) or sits in the hole briefly (SETTLE), then runs the scramble drill (find open grass, come back to the QB).
    if (e.wpEnd === RT.END.CONT || e.wpEnd === RT.END.SETTLE) {
      const T = G.T;
      e.drT += dt;
      if (e.drOn || (qbHolds(G) && e.drT >= (e.wpEnd === RT.END.CONT ? T.DRILL_STEM : T.DRILL_SIT))) {
        if (!e.drOn) { e.drOn = true; e.drRe = 0; }
        drill(G, e, dt);
        return true;
      }
    }
    if (e.wpEnd === RT.END.CONT) {
      let hx = e.hx, hy = e.hy;
      const ox = (e.x - MID) * G.dir;
      if ((ox > 23.5 && hx * G.dir > 0) || (ox < -23.5 && hx * G.dir < 0)) { hx = 0; hy = G.dir; e.hx = 0; e.hy = G.dir; }
      // don't run out the back of the end zone
      const backY = G.dir > 0 ? 118 : 2;
      if ((e.y - backY) * G.dir > -1) { hy = 0; hx = e.x > MID ? -1 : 1; e.hx = hx * 0.2; }
      Ph.steerDir(e, hx, hy, e.top * slow);
      return true;
    }
    if (e.wpEnd === RT.END.SETTLE) {
      if (!e.setOn) {
        // drift up to 1.5 yd sideways toward the spot farthest from the nearest defender
        const n = PT.Engine.AI.nearestOpp(G, e, e.x, e.y);
        let sx = e.x;
        if (n >= 0) sx = e.x + (G.ents[n].x < e.x ? 1.5 : -1.5);
        e.setX = Math.max(1.5, Math.min(C.FIELD.W - 1.5, sx)); e.setY = e.y; e.setOn = true;
      }
      Ph.steerTo(e, e.setX, e.setY, 0.5);
      return true;
    }
    return false;
  };
})(globalThis.PT = globalThis.PT || {});
