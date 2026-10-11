/* Pixel Touchdown: js/render/weather.js
 * Owner: WP4. Responsibility: rain/snow instanced particles, fog, tint.
 *
 *   R.Weather.create(ctx) → { update(dt, target, cam), dispose }
 * rain: slanted streaks (+ the field is painted wet in field.js) · snow: drifting cubes (+ snowy field paint)
 * wind: fast streak lines and tumbling leaves along the wind vector · fog: scene fog (stadium.js) + low mist
 * cubes · cloudy / sunny / clear (dome): nothing extra. Particle counts by quality tier (ARCHITECTURE 6).
 * The particle volume follows the camera target so it is always on screen.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const W = R.Weather = R.Weather || {};
  const T = globalThis.THREE;

  W.create = function (ctx) {
    const scene = ctx.scene;
    const wx = ctx.wx || { k: 'sunny' };
    const k = wx.k;
    // wind vector in world space (field (x, y) → world (x, −z)); speed from mph
    const mph = wx.mph != null ? wx.mph : (k === 'wind' ? 18 : 3);
    let dx = wx.wx != null ? wx.wx : 1, dy = wx.wy != null ? wx.wy : 0;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const windX = dx * mph * 0.45, windZ = -dy * mph * 0.45;

    let n = 0, kindMode = '';
    if (k === 'rain') { n = ctx.q.weather; kindMode = 'rain'; }
    else if (k === 'snow') { n = ctx.q.weather; kindMode = 'snow'; }
    else if (k === 'wind') { n = Math.max(30, ctx.q.weather / 4 | 0); kindMode = 'wind'; }
    if (!n) return { update() {}, dispose() {} };

    const mat = kindMode === 'snow'
      ? new T.MeshLambertMaterial({ color: 0xffffff })
      : new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: kindMode === 'rain' ? 0.55 : kindMode === 'fog' ? 0.18 : 0.42, depthWrite: false });
    const batch = R.Voxel.batch(n + (kindMode === 'wind' ? 40 : 0), mat);
    batch.mesh.renderOrder = 6;
    scene.add(batch.mesh);
    const SX = 40, SZ = 44, SY = 26;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n), ph = new Float32Array(n), sp = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = (Math.random() - 0.5) * SX * 2; py[i] = Math.random() * SY; pz[i] = (Math.random() - 0.5) * SZ * 2;
      ph[i] = Math.random() * 6.28; sp[i] = 0.7 + Math.random() * 0.6;
    }
    const nLeaves = kindMode === 'wind' ? 40 : 0;
    const lx = new Float32Array(nLeaves), ly = new Float32Array(nLeaves), lz = new Float32Array(nLeaves), lc = [];
    for (let i = 0; i < nLeaves; i++) {
      lx[i] = (Math.random() - 0.5) * SX * 2; ly[i] = Math.random() * 6; lz[i] = (Math.random() - 0.5) * SZ * 2;
      lc.push([[0.45, 0.75, 0.3], [0.95, 0.6, 0.2], [0.85, 0.35, 0.2]][i % 3]);
    }
    const m = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
    // rain streak orientation (along the fall velocity)
    const fallY = -26;
    const rv = new T.Vector3(windX * 0.6, fallY, windZ * 0.6).normalize();
    const rainQ = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), rv);
    const windYaw = Math.atan2(windX, windZ);
    let time = 0;

    function wrap(i, cx, cz) {
      if (px[i] - cx > SX) px[i] -= SX * 2; else if (px[i] - cx < -SX) px[i] += SX * 2;
      if (pz[i] - cz > SZ) pz[i] -= SZ * 2; else if (pz[i] - cz < -SZ) pz[i] += SZ * 2;
    }

    return {
      update(dt, target) {
        time += dt;
        const cx = target ? target.x : 0, cz = target ? target.z : 0;
        batch.begin();
        if (kindMode === 'rain') {
          for (let i = 0; i < n; i++) {
            py[i] += fallY * sp[i] * dt; px[i] += windX * 0.6 * dt; pz[i] += windZ * 0.6 * dt;
            if (py[i] < 0) { py[i] += SY; px[i] = cx + (Math.random() - 0.5) * SX * 2; pz[i] = cz + (Math.random() - 0.5) * SZ * 2; }
            wrap(i, cx, cz);
            m.compose(v.set(px[i], py[i], pz[i]), rainQ, s.set(0.05, 1.1, 0.05));
            batch.add(m, 0.78, 0.86, 1);
          }
        } else if (kindMode === 'snow') {
          for (let i = 0; i < n; i++) {
            py[i] -= 2.6 * sp[i] * dt;
            px[i] += (windX * 0.35 + Math.sin(time * 1.3 + ph[i]) * 0.8) * dt;
            pz[i] += (windZ * 0.35 + Math.cos(time * 1.1 + ph[i]) * 0.6) * dt;
            if (py[i] < 0) { py[i] += SY; px[i] = cx + (Math.random() - 0.5) * SX * 2; pz[i] = cz + (Math.random() - 0.5) * SZ * 2; }
            wrap(i, cx, cz);
            const z = 0.13 + sp[i] * 0.05;
            e.set(ph[i] + time, ph[i] * 2, 0); q.setFromEuler(e);
            m.compose(v.set(px[i], py[i], pz[i]), q, s.set(z, z, z));
            batch.add(m, 1, 1, 1);
          }
        } else if (kindMode === 'wind') {
          for (let i = 0; i < n; i++) {
            px[i] += windX * 3 * sp[i] * dt; pz[i] += windZ * 3 * sp[i] * dt;
            wrap(i, cx, cz);
            const life = (Math.sin(time * 1.7 + ph[i]) + 1) / 2;
            q.setFromAxisAngle(s.set(0, 1, 0), windYaw);
            m.compose(v.set(px[i], 1 + (py[i] % 8), pz[i]), q, s.set(0.06, 0.06, 1.2 + 2.4 * life));
            batch.add(m, 1, 1, 1);
          }
          for (let i = 0; i < nLeaves; i++) {
            lx[i] += windX * 1.6 * dt; lz[i] += windZ * 1.6 * dt;
            ly[i] = 0.4 + Math.abs(Math.sin(time * 2 + i)) * 2.4;
            if (lx[i] - cx > SX) lx[i] -= SX * 2; else if (lx[i] - cx < -SX) lx[i] += SX * 2;
            if (lz[i] - cz > SZ) lz[i] -= SZ * 2; else if (lz[i] - cz < -SZ) lz[i] += SZ * 2;
            e.set(time * 4 + i, time * 3, time * 5 + i); q.setFromEuler(e);
            m.compose(v.set(lx[i], ly[i], lz[i]), q, s.set(0.28, 0.06, 0.2));
            batch.add(m, lc[i][0], lc[i][1], lc[i][2]);
          }
        } else if (kindMode === 'fog') {
          for (let i = 0; i < n; i++) {
            px[i] += (0.6 + windX * 0.2) * dt;
            wrap(i, cx, cz);
            const z = 3 + sp[i] * 3;
            m.compose(v.set(px[i], 0.6 + (py[i] % 3), pz[i]), q.identity(), s.set(z * 2, z * 0.4, z * 1.4));
            batch.add(m, 1, 1, 1);
          }
        }
        batch.end();
      },
      dispose() { scene.remove(batch.mesh); batch.dispose(); mat.dispose(); }
    };
  };
})(globalThis.PT = globalThis.PT || {});
