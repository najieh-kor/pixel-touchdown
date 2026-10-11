/* Pixel Touchdown: js/engine/physics.js
 * Owner: WP3. Responsibility: steering/integration, circle collisions, bounds.
 * Every body steers by a desired velocity (dvx, dvy). Acceleration from design 4.1 (accelTime from MOV), braking/turning
 * stronger (BRAKE_MUL). Allocation-free.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const Ph = PT.ns('Engine.Physics');
  const GRAV = 10.7;   // yd/s²

  /** Desired velocity toward a point at frac × top speed (eases in the last yard). */
  Ph.steerTo = function (e, tx, ty, frac) {
    const dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.05) { e.dvx = 0; e.dvy = 0; return d; }
    let sp = e.top * (frac == null ? 1 : frac);
    if (d < 1.2) sp *= d / 1.2;
    e.dvx = dx / d * sp; e.dvy = dy / d * sp;
    return d;
  };
  /** Desired velocity along a unit dir at speed. */
  Ph.steerDir = function (e, ux, uy, speed) { e.dvx = ux * speed; e.dvy = uy * speed; };
  Ph.stop = function (e) { e.dvx = 0; e.dvy = 0; };

  /** Integrate all bodies one tick. */
  Ph.integrate = function (G, dt) {
    const T = G.T, ents = G.ents;
    for (let i = 0; i < 14; i++) {
      const e = ents[i];
      if (e.tkCd > 0) e.tkCd -= dt;
      if (e.noEngT > 0) { e.noEngT -= dt; if (e.noEngT <= 0) e.noEng = -1; }
      if (e.slowT > 0) e.slowT -= dt;
      if (e.jukeCd > 0) e.jukeCd -= dt;
      if (e.spinCd > 0) e.spinCd -= dt;
      if (e.jukeWin > 0) e.jukeWin -= dt;
      if (e.superT > 0) e.superT -= dt;
      e.at += dt;
      if (e.downT > 0) {
        e.downT -= dt;
        e.vx *= 0.85; e.vy *= 0.85;
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (e.downT <= 0 && e.an === 'down') { e.an = 'run'; e.at = 0; }
        continue;
      }
      if (e.diveT > 0) {
        e.diveT -= dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.z = Math.max(0, e.z + e.vz * dt); e.vz -= GRAV * dt;
        e.spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (e.diveT <= 0) { e.z = 0; e.vz = 0; }
        continue;
      }
      // accelerate toward desired velocity
      let dvx = e.dvx, dvy = e.dvy;
      if (e.slowT > 0) { dvx *= T.BRK_SLOW; dvy *= T.BRK_SLOW; }
      const ax = dvx - e.vx, ay = dvy - e.vy;
      const al = Math.sqrt(ax * ax + ay * ay);
      if (al > 1e-6) {
        const braking = (dvx * e.vx + dvy * e.vy) < (e.vx * e.vx + e.vy * e.vy) * 0.98;
        const maxD = e.acc * dt * (braking ? T.BRAKE_MUL : 1);
        if (al <= maxD) { e.vx = dvx; e.vy = dvy; }
        else { e.vx += ax / al * maxD; e.vy += ay / al * maxD; }
      }
      let mx = e.vx, my = e.vy;
      if (e.jukeT > 0) { e.jukeT -= dt; mx += e.jvx; my += e.jvy; }
      e.x += mx * dt; e.y += my * dt;
      if (e.z > 0 || e.vz !== 0) {
        e.z += e.vz * dt; e.vz -= GRAV * dt;
        if (e.z <= 0) { e.z = 0; e.vz = 0; }
      }
      const sp = Math.sqrt(mx * mx + my * my);
      e.spd = sp;
      if (sp > 0.35 && e.spinT <= 0) e.fa = Math.atan2(-mx, my);
      if (e.spinT > 0) { e.spinT -= dt; e.fa += 14 * dt; }
    }
  };

  /** Circle separation between bodies (skips engaged pairs and bodies on the ground). */
  Ph.collide = function (G) {
    const ents = G.ents;
    for (let i = 0; i < 13; i++) {
      const a = ents[i];
      if (a.downT > 0 || a.z > 1.0) continue;
      for (let j = i + 1; j < 14; j++) {
        const b = ents[j];
        if (b.downT > 0 || b.z > 1.0) continue;
        const dx = b.x - a.x;
        if (dx > 1.4 || dx < -1.4) continue;
        const dy = b.y - a.y;
        if (dy > 1.4 || dy < -1.4) continue;
        const rr = a.rad + b.rad;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        if (a.eng === j || b.eng === i || a.eng2 === j || b.eng2 === i) continue;
        const d = Math.sqrt(d2) || 0.001;
        const ov = (rr - d) * (a.tm === b.tm ? 0.4 : 1);   // teammates can squeeze past each other
        const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        const nx = d2 > 1e-8 ? dx / d : 1, ny = d2 > 1e-8 ? dy / d : 0;
        a.x -= nx * ov * wa; a.y -= ny * ov * wa;
        b.x += nx * ov * wb; b.y += ny * ov * wb;
      }
    }
  };

  /** Hard clamp every body inside the playable box (ARCHITECTURE 8.3 acceptance bounds). */
  Ph.bounds = function (G) {
    const T = G.T;
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      if (e.x < T.BOUND_X0) { e.x = T.BOUND_X0; if (e.vx < 0) e.vx = 0; }
      else if (e.x > T.BOUND_X1) { e.x = T.BOUND_X1; if (e.vx > 0) e.vx = 0; }
      if (e.y < T.BOUND_Y0) { e.y = T.BOUND_Y0; if (e.vy < 0) e.vy = 0; }
      else if (e.y > T.BOUND_Y1) { e.y = T.BOUND_Y1; if (e.vy > 0) e.vy = 0; }
    }
  };
})(globalThis.PT = globalThis.PT || {});
