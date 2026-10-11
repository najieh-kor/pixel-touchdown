/* Pixel Touchdown: js/render/animate.js
 * Owner: WP4. Responsibility: anim state → part rotations (run/throw/catch/tackle/celebrate…).
 *
 *   R.Animate.state()                         → per-entity render state (phase, timers), keep one per ent.id
 *   R.Animate.pose(P, ent, st, info, dt)      → fills pose P (R.Voxel.newPose) for ent.an / ent.at / ent.spd
 *     info = { h: model height (voxels), dance: 'hop'|'flap'|'spin'|'wag'|'flip'|'stomp', sz: 'S'|'M'|'L' }
 *
 * Crossy Road feel: the run cycle is a series of springy hops (two bounces per stride, squash on contact,
 * stretch at the top), the head bobs a beat behind the body, tails wag with the stride.
 * Sign conventions (see voxel.js): positive rx = limbs swing forward / body leans forward.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const A = R.Animate = R.Animate || {};
  const PI = Math.PI, TAU = Math.PI * 2;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs, min = Math.min, max = Math.max;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function outBack(t) { t = clamp(t, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

  /** per-entity animation state */
  A.state = function () {
    return { an: '', t: 0, phase: Math.random() * TAU, idle: Math.random() * 10, land: 0, lastZ: 0, seed: Math.random(), spinBase: 0 };
  };

  /**
   * @param {Object} P   pose (reset by caller or here)
   * @param {Object} e   snapshot entity (or a fake one: {an, at, spd, z, ball})
   * @param {Object} st  A.state()
   * @param {Object} info { h, dance, sz }
   * @param {number} dt  real seconds (already scaled by game time scale if wanted)
   */
  A.pose = function (P, e, st, info, dt) {
    R.Voxel.resetPose(P);
    const an = e.an || 'idle';
    if (an !== st.an) { st.an = an; st.t = 0; }
    st.t += dt;
    const t = e.at != null && e.at >= 0 ? e.at : st.t;
    const h = info.h || 16;
    P.cy = h * 0.42;
    st.idle += dt;

    // landing squash (Crossy hop)
    const z = e.z || 0;
    if (st.lastZ > 0.25 && z <= 0.02) st.land = 0.16;
    st.lastZ = z;
    if (st.land > 0) st.land = max(0, st.land - dt);

    switch (an) {
      case 'run': case 'sprint': case 'carry': case 'rush':
        run(P, e, st, dt, an); break;
      case 'stance': stance(P, e, st); break;
      case 'block': block(P, e, st, t); break;
      case 'throw': throwAnim(P, e, st, t); break;
      case 'catch': catchAnim(P, e, st, t); break;
      case 'tackle': tackle(P, e, st, t, h); break;
      case 'tackled': tackled(P, e, st, t, h); break;
      case 'down': down(P, st, h); break;
      case 'dive': dive(P, e, st, t, h); break;
      case 'juke': juke(P, e, st, t, dt); break;
      case 'spin': spin(P, e, st, t, dt); break;
      case 'celebrate': celebrate(P, e, st, t, info.dance || 'hop'); break;
      case 'sad': sad(P, st, t); break;
      case 'kick': kick(P, e, st, t); break;
      default: idle(P, st);
    }
    if (st.land > 0) {
      const k = st.land / 0.16;
      P.sy *= 1 - 0.14 * k; P.sx *= 1 + 0.08 * k; P.sz *= 1 + 0.08 * k;
    }
    // airborne (jump catch / dive / hop): lift is applied by the renderer from e.z; stretch a little
    if (z > 0.3 && an !== 'dive' && an !== 'tackle') { P.sy *= 1.06; P.sx *= 0.97; P.sz *= 0.97; }
    if (e.ball && an !== 'throw' && an !== 'celebrate' && an !== 'tackled' && an !== 'down' && an !== 'dive') carryArm(P);
  };

  function carryArm(P) {
    // tuck the ball: right arm bent forward and in
    P.arx = 0.95; P.arz = -0.35; P.ary = 0.25;
  }

  function idle(P, st) {
    const t = st.idle;
    P.by = sin(t * 2.2) * 0.12;
    P.hrx = sin(t * 2.2 - 0.6) * 0.04;
    P.alz = 0.08 + sin(t * 2.2) * 0.03; P.arz = -P.alz;
    P.try_ = sin(t * 3) * 0.25;
    // occasional happy Crossy hop
    const c = (t + st.seed * 7) % 4.2;
    if (c < 0.42) {
      const k = c / 0.42;
      P.y = sin(k * PI) * 1.6;
      P.sy = 1 + sin(k * PI) * 0.08 - (k < 0.12 || k > 0.88 ? 0.1 : 0);
      P.alz = 0.5 * sin(k * PI); P.arz = -P.alz;
    }
  }

  function stance(P, e, st) {
    const t = st.idle;
    P.y = -0.5; P.sy = 0.95;
    P.brx = 0.42; P.hrx = -0.32;
    P.llz = 0.12; P.lrz = -0.12; P.llx = -0.15; P.lrx = 0.2;
    P.alx = 0.7; P.arx = 0.7; P.alz = 0.12; P.arz = -0.12;
    P.by = sin(t * 3 + st.seed * 5) * 0.08;
    P.try_ = sin(t * 4) * 0.2;
  }

  function run(P, e, st, dt, an) {
    const spd = e.spd != null ? e.spd : 5;
    const sprint = an === 'sprint' || spd > 7.5;
    const freq = clamp(1.3 + spd * 0.2, 1.4, 3.4);                     // strides per second
    st.phase += dt * freq * TAU;
    const ph = st.phase;
    const s = sin(ph), c2 = cos(ph * 2);
    const amp = clamp(0.35 + spd * 0.07, 0.4, sprint ? 1.05 : 0.85);
    // two springy hops per stride
    const hop = abs(s);
    P.y = hop * (sprint ? 1.3 : 0.95) * clamp(spd / 4, 0.3, 1.2);
    P.sy = 1 + (hop - 0.5) * 0.09;
    P.sx = P.sz = 1 - (hop - 0.5) * 0.045;
    P.llx = s * amp; P.lrx = -s * amp;
    P.alx = -s * amp * 0.9; P.arx = s * amp * 0.9;
    P.alz = 0.12; P.arz = -0.12;
    const lean = clamp(0.06 + spd * 0.025, 0.06, sprint ? 0.32 : 0.24);
    P.brx = lean; P.bry = s * 0.12;
    P.hrx = -lean * 0.7 + c2 * 0.05;                                    // head lags the bounce
    P.hrz = s * 0.04;
    P.try_ = s * 0.55; P.trx = -0.1;
    if (an === 'rush') { P.alx = 1.2 + s * 0.2; P.arx = 1.2 - s * 0.2; P.brx += 0.12; }
  }

  function block(P, e, st, t) {
    const j = sin(t * 9 + st.seed * 3);
    P.y = -0.4 + abs(j) * 0.2;
    P.brx = 0.38; P.hrx = -0.3;
    P.alx = 1.45 + j * 0.12; P.arx = 1.45 - j * 0.12;
    P.alz = -0.12; P.arz = 0.12;
    P.llz = 0.16; P.lrz = -0.16; P.llx = j * 0.25; P.lrx = -j * 0.25;
  }

  function throwAnim(P, e, st, t) {
    // 0..0.25 wind-up, 0.25..0.45 release, then follow-through
    if (t < 0.25) {
      const k = ease(t / 0.25);
      P.arx = -0.4 - 2.2 * k; P.arz = -0.3 * k;
      P.bry = -0.45 * k; P.brx = -0.06 * k;
      P.alx = 0.7 * k; P.alz = 0.2;
      P.lrx = -0.25 * k; P.llx = 0.25 * k;
      P.hry = 0.3 * k;
    } else {
      const k = outBack(clamp((t - 0.25) / 0.18, 0, 1));
      P.arx = -2.6 + 3.9 * k; P.arz = -0.3 + 0.2 * k;
      P.bry = -0.45 + 0.75 * k; P.brx = 0.25 * k;
      P.alx = 0.7 - 0.9 * k; P.alz = 0.2;
      P.lrx = -0.25 + 0.6 * k; P.llx = 0.25 - 0.5 * k;
      P.hry = 0.3 - 0.4 * k;
      P.y = sin(clamp((t - 0.25) / 0.3, 0, 1) * PI) * 0.6;
    }
  }

  function catchAnim(P, e, st, t) {
    const k = ease(t / 0.15);
    P.alx = P.arx = 2.75 * k; P.alz = 0.25 * k; P.arz = -0.25 * k;
    P.hrx = -0.35 * k; P.brx = -0.08 * k;
    P.llx = -0.2 * k; P.lrx = 0.3 * k;
    P.sy = 1 + 0.06 * k;
  }

  function tackle(P, e, st, t, h) {
    const k = ease(t / 0.22);
    P.rx = 1.1 * k;
    P.y = (sin(min(1, t / 0.35) * PI) * 1.2) - k * (h * 0.42 - 4) * sin(1.1 * k) * 0.6;
    P.alx = P.arx = 2.3 * k; P.alz = 0.4 * k; P.arz = -0.4 * k;
    P.llx = -0.5 * k; P.lrx = -0.3 * k;
    P.hrx = -0.6 * k;
  }

  function tackled(P, e, st, t, h) {
    const k = ease(t / 0.35);
    const th = 1.45 * k;
    P.rx = -th;                                                           // knocked onto the back
    P.y = -(h * 0.42 - 3.4) * sin(th) + sin(min(1, t / 0.3) * PI) * 0.9;
    P.alx = 1.8 * k + sin(t * 18) * 0.25 * (1 - k); P.arx = 2.2 * k - sin(t * 18) * 0.25 * (1 - k);
    P.alz = 0.7 * k; P.arz = -0.7 * k;
    P.llx = 0.9 * k; P.lrx = 0.5 * k;
    P.hrx = 0.4 * k;
    if (t < 0.12) { P.sx = 1.12; P.sy = 0.86; P.sz = 1.12; }
  }

  function down(P, st, h) {
    const t = st.idle;
    P.rx = -1.45;
    P.y = -(h * 0.42 - 3.4) * sin(1.45);
    P.alx = 1.6 + sin(t * 2) * 0.1; P.arx = 2.0; P.alz = 0.7; P.arz = -0.7;
    P.llx = 0.8; P.lrx = 0.45 + sin(t * 1.5) * 0.1;
    P.hrx = 0.35;
    P.by = sin(t * 2.4) * 0.15;
  }

  function dive(P, e, st, t, h) {
    const k = ease(t / 0.2);
    const th = 1.35 * k;
    P.rx = th;
    P.y = -(h * 0.42 - 3.6) * sin(th) * (e.z > 0.2 ? 0.2 : 1);
    P.alx = P.arx = 2.9 * k; P.alz = 0.12; P.arz = -0.12;
    P.llx = -0.45 * k; P.lrx = -0.3 * k;
    P.hrx = -0.9 * k;
    P.sz = 1 + 0.1 * k; P.sy = 1 - 0.05 * k;
  }

  function juke(P, e, st, t, dt) {
    const side = st.seed > 0.5 ? 1 : -1;
    const k = sin(min(1, t / 0.32) * PI);
    run(P, e, st, dt, 'run');
    P.rz = 0.42 * k * side;
    P.brz = 0.3 * k * side;
    P.alz = 0.9 * k; P.arz = -0.9 * k;
    P.hrz = -0.2 * k * side;
    P.sy *= 1 - 0.08 * k;
  }

  function spin(P, e, st, t, dt) {
    run(P, e, st, dt, 'run');
    const k = clamp(t / 0.45, 0, 1);
    P.ry = ease(k) * TAU;
    P.alz = 1.1 * sin(k * PI); P.arz = -P.alz;
    P.y += sin(k * PI) * 0.8;
  }

  function kick(P, e, st, t) {
    const k = clamp(t / 0.32, 0, 1);
    const sw = k < 0.45 ? -0.9 * ease(k / 0.45) : -0.9 + 2.6 * outBack((k - 0.45) / 0.55);
    P.lrx = sw; P.llx = -0.15;
    P.brx = -0.1 - 0.1 * (sw > 0 ? sw / 1.7 : 0);
    P.alz = 0.9; P.arz = -0.9; P.alx = -0.3; P.arx = 0.4;
    P.y = k > 0.5 ? sin((k - 0.5) * 2 * PI) * 0.8 : 0;
    P.hrx = 0.2;
  }

  function sad(P, st, t) {
    const s = st.idle;
    P.brx = 0.25; P.hrx = 0.55; P.hry = sin(s * 0.9) * 0.18;
    P.alz = 0.02; P.arz = -0.02; P.alx = 0.1; P.arx = 0.1;
    P.y = -0.3; P.sy = 0.96;
    P.trx = 0.5; P.try_ = 0;
    P.by = sin(s * 1.3) * 0.1;
    void t;
  }

  function celebrate(P, e, st, t, style) {
    const c = t % 1.2, k = c / 1.2;
    switch (style) {
      case 'flap': {
        const f = sin(c * 22);
        P.alz = 1.2 + f * 0.9; P.arz = -P.alz;
        P.y = abs(sin(c * PI * 2.5)) * 2.2;
        P.hrx = -0.3; P.try_ = f * 0.4;
        break;
      }
      case 'spin': {
        P.ry = ease(k) * TAU;
        P.alx = P.arx = 2.9; P.alz = 0.3; P.arz = -0.3;
        P.y = sin(k * PI) * 2.6;
        P.hrx = -0.2;
        break;
      }
      case 'wag': {
        const w = sin(c * 16);
        P.try_ = w * 0.9; P.trx = -0.4;
        P.bry = w * 0.25; P.brz = w * 0.12;
        P.alx = 2.6 + sin(c * 8) * 0.4; P.arx = 2.6 - sin(c * 8) * 0.4;
        P.y = abs(sin(c * 8)) * 1.2; P.hrz = w * 0.15;
        break;
      }
      case 'flip': {
        const j = k < 0.75 ? k / 0.75 : 1;
        P.y = sin(j * PI) * 6;
        P.rx = -ease(j) * TAU;
        P.alx = P.arx = 2.8 * sin(j * PI); P.alz = 0.4; P.arz = -0.4;
        P.llx = -0.6 * sin(j * PI); P.lrx = -0.6 * sin(j * PI);
        break;
      }
      case 'stomp': {
        const s = sin(c * 10);
        P.llx = max(0, s) * 1.0; P.lrx = max(0, -s) * 1.0;
        P.llz = 0.25; P.lrz = -0.25;
        P.y = abs(s) * 1.2;
        P.sy = 1 - (1 - abs(s)) * 0.08; P.sx = P.sz = 1 + (1 - abs(s)) * 0.05;
        P.alx = 1.4; P.arx = 1.4; P.alz = 1.2; P.arz = -1.2;            // flex
        P.brz = s * 0.12; P.hrx = -0.25;
        break;
      }
      default: { // hop
        const j = (c % 0.4) / 0.4;
        P.y = sin(j * PI) * 3.4;
        P.sy = j < 0.12 || j > 0.9 ? 0.86 : 1.08; P.sx = P.sz = j < 0.12 || j > 0.9 ? 1.08 : 0.96;
        P.alx = P.arx = 2.8; P.alz = 0.5; P.arz = -0.5;
        P.llx = -0.3 * sin(j * PI); P.lrx = -0.3 * sin(j * PI);
        P.hrx = -0.3; P.try_ = sin(c * 20) * 0.5;
      }
    }
  }
})(globalThis.PT = globalThis.PT || {});
