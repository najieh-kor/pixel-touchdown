/* Pixel Touchdown: js/render/camera.js
 * Owner: WP4. Responsibility: camera director (follow, kick, celebrate), portrait/landscape framing.
 *
 * RECONCILE R4: the USER team's attack direction (snap.udir) is always UP the screen, in portrait and
 * landscape; yaw depends only on udir (0 when udir = +1, π when −1). On defense the AI offense comes down.
 * Framing (landscape only, readability first): follow ≈ 34 yd wide at the target; presnap fits the formation into
 * the HUD-free band; QB dropbacks fit every receiver; aiming / passes in the air pull back to keep the target
 * on screen. The target sits below the screen center (pitch offset) so we see downfield.
 * Modes (snap.cam.mode): presnap (wider, LOS + 5 toward the offense), follow (ball + lead), kick (high,
 * pulled back), celebrate (zoom + slow 20° orbit), replay (= follow). Aiming eases out so the target stays
 * on screen. Shake decays over 0.25 s. Smoothing: exponential spring k = 6 (snap() cuts instantly).
 *
 *   R.Camera.create(ctx) → { cam, target, yaw, resize(w,h), update(snap, alpha, dt, g), snap(), cue(kind,dur),
 *                            shake(amt), save(), restore(st), view }
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const Cm = R.Camera = R.Camera || {};
  const T = globalThis.THREE;
  const MIDX = 26.667;
  const D2R = Math.PI / 180;

  /** framing preset (landscape only; tunable): follow width 34 yd at the target, presnap = formation fit */
  Cm.P = { fov: 32, pitch: 50, width: 35, pre: 54, f: 0.40, lead: 6, latFollow: 0.7, orbit: 14 };
  /** Reduce Motion (Settings): no shake, no slow-mo zoom */
  Cm.reduceMotion = false;

  /**
   * Screen band (CSS px from the top) that is not covered by the HUD: below the scoreboard, above the
   * open play-call tray / the big HIKE-GO button. Read from the DOM a few times per second (render only reads).
   */
  const band = { top: 0, bottom: 0, t: -1, w: 0, h: 0 };
  function readBand(time, w, h) {
    if (time - band.t < 0.2 && band.w === w && band.h === h) return band;
    band.t = time; band.w = w; band.h = h;
    let top = Math.min(110, Math.max(40, h * 0.11)), bottom = h * 0.97;
    const doc = globalThis.document;
    if (doc && doc.querySelector) {
      const tb = doc.querySelector('.hud-top');
      if (tb && tb.offsetParent !== null) { const r = tb.getBoundingClientRect(); if (r.height > 0 && r.bottom < h * 0.4) top = r.bottom + 4; }
      const els = doc.querySelectorAll('.hud-tray-open .pc-tray, .hud-ctl-big, .hud-hint');
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.height > 0 && r.width > 0 && r.top > h * 0.3) bottom = Math.min(bottom, r.top - 6);
      }
    }
    band.top = top; band.bottom = Math.max(top + h * 0.2, bottom);
    return band;
  }
  Cm._band = band;

  Cm.create = function (ctx) {
    void ctx;
    const cam = new T.PerspectiveCamera(35, 1, 1, 600);
    cam.rotation.order = 'YXZ';
    const target = new T.Vector3(0, 0, 0);
    const want = new T.Vector3(0, 0, 0);
    const pos = new T.Vector3();
    let w = 1, h = 1;
    let dist = 60, wantDist = 60, yaw = 0, wantYaw = 0, orbit = 0;
    let shakeA = 0, shakeT = 0, slowT = 0, celebT = 0, aimK = 0, first = true;
    let lastMode = '', fitDist = 0, timeNow = 0, curPitch = null;
    const qbBand = { top: 0, bottom: 0 };

    function preset() { return Cm.P; }

    // ---- fit a set of ground points into the free screen band (presnap) ----
    const sc = new T.PerspectiveCamera(35, 1, 1, 600);
    sc.rotation.order = 'YXZ';
    const st = new T.Vector3(), sp = new T.Vector3(), pv = new T.Vector3();
    const pts = new Float32Array(8 * 3);
    let nPts = 0;
    function placeCam(c, tgt, d, ya, pr, p) {
      c.fov = p.fov; c.aspect = w / h; c.updateProjectionMatrix();
      c.position.set(Math.sin(ya) * Math.cos(pr) * d, Math.sin(pr) * d, Math.cos(ya) * Math.cos(pr) * d).add(tgt);
      const off = Math.atan((0.5 - p.f) * 2 * Math.tan(p.fov * D2R / 2));
      c.rotation.set(-(pr - off), ya, 0, 'YXZ');
      c.updateMatrixWorld();
    }
    function put(x, y, z) { pts[nPts * 3] = x; pts[nPts * 3 + 1] = z; pts[nPts * 3 + 2] = 60 - y; nPts++; }
    /** → sets fitOut {tz, dist}; points in world space; tx fixed */
    const fitOut = { tz: 0, dist: 60 };
    function fit(tx, tz0, ya, p, b, depthSpan, udir, pitchDeg, anchorBottom) {
      const pr = pitchDeg * D2R;
      const nTop = 1 - 2 * b.top / h, nBot = 1 - 2 * b.bottom / h;
      const allowH = nTop - nBot, allowW = 1.94;
      let cyWant = (nTop + nBot) / 2;
      let tz = tz0, d = fitOut.dist > 5 ? fitOut.dist : 60;
      for (let it = 0; it < 24; it++) {
        st.set(tx, 0, tz);
        placeCam(sc, st, d, ya, pr, p);
        let mnX = 9, mxX = -9, mnY = 9, mxY = -9;
        for (let i = 0; i < nPts; i++) {
          pv.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).project(sc);
          if (pv.x < mnX) mnX = pv.x; if (pv.x > mxX) mxX = pv.x; if (pv.y < mnY) mnY = pv.y; if (pv.y > mxY) mxY = pv.y;
        }
        const sH = (mxY - mnY) / allowH, sW = (mxX - mnX) / allowW;
        const sc2 = Math.max(sH, sW);
        d = Math.max(8, Math.min(260, d * (1 + (sc2 - 1) * 0.85)));
        const cy = (mxY + mnY) / 2;
        if (anchorBottom && sW > sH) cyWant = nBot + (mxY - mnY) / 2;      // width-bound: keep the lowest point on the band bottom
        tz -= udir * (cy - cyWant) / Math.max(0.05, mxY - mnY) * depthSpan * 0.7;
        tz = Math.max(-70, Math.min(70, tz));
      }
      fitOut.tz = tz; fitOut.dist = d;
      return fitOut;
    }

    /** distance so that `width` yards span the screen at the target */
    function distFor(width) {
      const p = preset();
      const tv = Math.tan(p.fov * D2R / 2);
      return (width / 2) / (Math.max(0.2, w / h) * tv);
    }

    const api = {
      cam: cam, target: target, yaw: 0, view: { land: true }, width: 40,
      resize(W, H) {
        w = W; h = H;
        api.view.land = true;
        const p = preset();
        cam.fov = p.fov;
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        first = true;
      },
      snap() { first = true; },
      shake(a) { if (!Cm.reduceMotion) { shakeA = Math.max(shakeA, a); shakeT = 0.25; } },
      cue(kind, dur) {
        if (kind === 'slowmo' && !Cm.reduceMotion) slowT = dur || 1.2;
        if (kind === 'celebrate') celebT = 2.2;
      },
      save() { return { x: target.x, z: target.z, dist: dist, yaw: yaw }; },
      restore(st) { if (!st) return; target.x = st.x; target.z = st.z; dist = st.dist; yaw = st.yaw; },
      update(s, alpha, dt, g) {
        const p = preset();
        const udir = s ? (s.udir || 1) : 1;
        wantYaw = udir > 0 ? 0 : Math.PI;
        // extra-wide phones (≈ 2.2:1) see less depth per yard of width: widen a touch
        let tx = 0, ty = 60, width = p.width * Math.max(1, Math.sqrt((w / h) / 1.78));
        let k = 6, qbFit = false;
        let wantPitch = p.pitch;
        // near the end zone behind the camera, look down steeper so the camera never backs over the end stands
        if (s && s.ball) {
          const backY = (s.udir || 1) > 0 ? 0 : 120;
          const gap = Math.abs(((s.ball.y != null ? s.ball.y : 60)) - backY);
          if (gap < 30) wantPitch = Math.min(78, wantPitch + (1 - gap / 30) * 16);
        }
        curPitch = first || curPitch == null ? wantPitch : curPitch + (wantPitch - curPitch) * (1 - Math.exp(-4 * dt));
        const pitch = curPitch;
        let mode = s && s.cam ? s.cam.mode : 'presnap';
        timeNow += dt;
        if (celebT > 0) { celebT -= dt; if (mode !== 'presnap') mode = 'celebrate'; }
        // ground depth seen per yard of width at the target (depth/width ratio of the view)
        const ratio = 1 / (Math.max(0.2, w / h) * Math.sin(pitch * D2R));
        if (s) {
          const b = s.ball;
          const bx = b ? b.px + (b.x - b.px) * alpha : MIDX, by = b ? b.py + (b.y - b.py) * alpha : 60;
          const bz = b ? (b.pz || 0) + ((b.z || 0) - (b.pz || 0)) * alpha : 0;
          const dir = s.dir || udir;
          const pre = mode === 'presnap' || s.phase === 'PRESNAP' || s.phase === 'CALL';
          if (pre && !(s.kick && s.kick.on)) {
            // frame the formation: ~3 yd behind the deepest player .. ~12–19 yd past the LOS, full width,
            // inside the screen band the HUD leaves free (scoreboard / tray / HIKE button)
            const ents = s.ents;
            let mnx = 99, mxx = -99, back = 4, front = 10;
            const lined = s.phase === 'PRESNAP';
            for (let i = 0; lined && i < ents.length; i++) {
              const e = ents[i];
              if (e.x < mnx) mnx = e.x; if (e.x > mxx) mxx = e.x;
              const dd = (e.y - s.los) * dir;
              if (-dd > back) back = -dd; if (dd > front) front = dd;
            }
            let rEnd = 0;
            if (s.routes && s.routes.length) {
              for (let i = 0; i < s.routes.length; i++) {
                const r = s.routes[i];
                if (!r || r.on === false || !r.pts) continue;
                const n = r.n ? r.n * 2 : r.pts.length;
                for (let k = 1; k < n; k += 2) { const dd = (r.pts[k] - s.los) * dir; if (dd > rEnd) rEnd = dd; }
              }
            }
            if (!lined) { mnx = MIDX - 20; mxx = MIDX + 20; back = 8; front = 12; }
            const yB = s.los - (Math.min(back, 12) + 3) * dir;
            const fr = Math.min(19, Math.max(12, front + 3, rEnd > 0 ? Math.min(rEnd + 2, 19) : 0));
            const yF = s.los + fr * dir;
            const xm = s.dir !== udir ? 2.6 : 2.0;   // user on defense: outside defenders + Star ring fully tappable
            const xl = Math.max(-1, mnx - xm) - MIDX, xr = Math.min(54.3, mxx + xm) - MIDX;
            nPts = 0;
            put(xl, yB, 0); put(xr, yB, 0); put(xl, yF, 0); put(xr, yF, 0);
            put(xl, s.los, 2.6); put(xr, s.los, 2.6);
            tx = MIDX + (xl + xr) / 2;
            const bd = readBand(timeNow, w, h);
            const ya = wantYaw;
            const f0 = fit(tx - MIDX, 60 - (yB + yF) / 2, ya, p, bd, Math.abs(yF - yB), udir, wantPitch);
            ty = 60 - f0.tz;
            fitDist = f0.dist;
          } else if (pre) {
            tx = MIDX; width = p.pre;
            {
              const span = Math.abs(s.kick.y - by);
              ty = by + (s.kick.y - by) * 0.45; width = Math.max(p.pre, (span + 14) / ratio);
            }
          } else if (mode === 'kick') {
            // kickoffs / punts / FGs: follow the ball, pulled back, aim at the landing spot when known
            const lx = b && b.tx != null ? b.tx : bx, ly = b && b.ty != null ? b.ty : by;
            const air = b && (b.st === 'air' || b.st === 'kick');
            tx = MIDX + (bx - MIDX) * 0.6;
            ty = air ? by + (ly - by) * 0.35 : by + 4 * dir;
            width = p.width * 1.45 + bz * 0.6; k = 4;
            void lx;
          } else if (mode === 'celebrate') {
            tx = bx; ty = by + 2 * udir; width = p.width * 1.1; k = 3;
          } else if (s.cam && s.cam.zoom > 1.4 && b && b.st === 'held' && s.ents) {
            // QB dropback (engine hint): every receiver on screen at decision time, QB ~25% up from the bottom
            const o = (s.poss || 0) * 7, ents = s.ents;
            let half = 12, front = 8;
            for (let i = o; i < o + 7 && i < ents.length; i++) {
              const e = ents[i];
              const hx = Math.abs(e.x - MIDX) + 3; if (hx > half) half = hx;
              const dd = (e.y - by) * dir; if (dd + 5 > front) front = dd + 5;
            }
            if (s.aim && s.aim.on) {
              const hx = Math.abs(s.aim.x - MIDX) + 3; if (hx > half) half = hx;
              const dd = (s.aim.y - by) * dir; if (dd + 4 > front) front = dd + 4;
            }
            half = Math.min(half, 30);
            const yF = by + Math.min(front, 45) * dir, yB = by - 2 * dir;
            nPts = 0;
            put(-half, yB, 0); put(half, yB, 0); put(-half, yF, 0); put(half, yF, 0);
            const bd = readBand(timeNow, w, h);
            qbBand.top = bd.top; qbBand.bottom = h * 0.75;
            const f0 = fit(0, 60 - (yB + yF) / 2, wantYaw, p, qbBand, Math.abs(yF - yB), udir, pitch, true);
            tx = MIDX; ty = 60 - f0.tz; fitDist = f0.dist; qbFit = true;
          } else {
            // lead toward the attack, scaled to the visible depth so the carrier stays ~28% up from the bottom
            const lead = Math.max(2.5, Math.min(p.lead, width * ratio * 0.13));
            tx = MIDX + (bx - MIDX) * p.latFollow; ty = by + lead * dir;
            // pass in the air: keep the ball and its landing spot on screen
            if (b && b.st === 'air' && b.tx != null && (b.kind == null || b.kind === 'pass')) {
              const dy = Math.abs(b.ty - by), dx = Math.abs(b.tx - bx);
              ty = by + (b.ty - by) * 0.45; tx = MIDX + ((bx + b.tx) / 2 - MIDX) * p.latFollow;
              width = Math.max(width, dx + 8, (dy * 0.45 + 7) / (p.f * ratio));
            }
          }
          // aim ease-out (~0.3 s): QB and the aim target both on screen
          const aiming = s.aim && s.aim.on;
          aimK += ((aiming ? 1 : 0) - aimK) * Math.min(1, dt * 7);
          if (aimK > 0.01 && s.aim && !pre && !qbFit) {
            const ay = s.aim.y, ax = s.aim.x;
            // the QB sits below the target: the lower f of the view must hold ~45% of the span + margin
            const need = Math.max(Math.abs(ax - bx) + 10, (Math.abs(ay - by) * 0.45 + 8) / (p.f * ratio));
            ty += (by + (ay - by) * 0.45 - ty) * aimK;
            tx += (MIDX + ((bx + ax) / 2 - MIDX) * p.latFollow - tx) * aimK;
            if (need > width) width += (need - width) * aimK;
          }
          // engine hint: zoom > 1 = pull out (floor only; framing above already covers aim / air)
          if (!pre && mode === 'follow' && s.cam && s.cam.zoom > 1) width = Math.max(width, p.width * Math.min(1.6, s.cam.zoom));
          if (s.cam && s.cam.shake > shakeA) api.shake(s.cam.shake);
          if (mode !== lastMode && mode === 'presnap') k = 4;
          lastMode = mode;
        }
        if (slowT > 0) { slowT -= dt; width *= 0.85; k = Math.max(k, 5); }
        // keep the view inside the field laterally (sidelines at most ~3 yd off-screen)
        if (!(fitDist > 0)) {
          const maxOff = Math.max(0, (53.333 + 6) / 2 - width / 2);
          tx = Math.max(MIDX - maxOff, Math.min(MIDX + maxOff, tx));
        }
        ty = Math.max(-2, Math.min(122, ty));
        // a big jump of the framing target (turnover, kickoff, new drive) cuts instead of a long pan
        if (!first && Math.abs((60 - ty) - target.z) > 45) first = true;
        want.set(tx - MIDX, 0, 60 - ty);
        wantDist = fitDist > 0 ? fitDist : distFor(width);
        fitDist = 0;
        orbit = mode === 'celebrate' ? Math.min((p.orbit || 14) * D2R, orbit + dt * 8 * D2R) : orbit * Math.max(0, 1 - dt * 3);
        if (first) {
          target.copy(want); dist = wantDist; yaw = wantYaw; first = false;
        } else {
          const e = 1 - Math.exp(-k * dt);
          target.x += (want.x - target.x) * e;
          target.z += (want.z - target.z) * e;
          dist += (wantDist - dist) * (1 - Math.exp(-4 * dt));
          if (Math.abs(wantYaw - yaw) > 0.01) yaw = wantYaw;           // yaw changes only at a dead-ball wipe
        }
        const ya = yaw + orbit * (udir > 0 ? 1 : -1);
        const pr = pitch * D2R;
        pos.set(Math.sin(ya) * Math.cos(pr) * dist, Math.sin(pr) * dist, Math.cos(ya) * Math.cos(pr) * dist).add(target);
        if (shakeT > 0) {
          shakeT -= dt;
          const a = shakeA * 4 * Math.max(0, shakeT / 0.25);
          pos.x += (Math.random() - 0.5) * a; pos.y += (Math.random() - 0.5) * a * 0.5; pos.z += (Math.random() - 0.5) * a;
          if (shakeT <= 0) shakeA = 0;
        }
        api.width = width;
        cam.position.copy(pos);
        // look a little above the target so it sits at fraction f from the bottom of the screen
        const alphaOff = Math.atan((0.5 - p.f) * 2 * Math.tan(p.fov * D2R / 2));
        cam.rotation.set(-(pr - alphaOff), ya, 0, 'YXZ');
        cam.near = Math.max(1, dist * 0.2);
        cam.far = dist * 3.2 + 120;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        api.yaw = ya;
        api.dist = dist;
        void g;
      }
    };
    return api;
  };
})(globalThis.PT = globalThis.PT || {});
