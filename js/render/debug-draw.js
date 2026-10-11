/* Pixel Touchdown: js/render/debug-draw.js
 * Owner: WP4. Responsibility: hitboxes, routes, zones, LOS/first-down lines (debug only).
 *
 *   R.DebugDraw.create(ctx) → { set({hitboxes, routes, zones}), update(snap, alpha, g), dispose }
 * One LineSegments with a preallocated dynamic buffer, drawn on top (no depth test).
 * hitboxes: circle of PT.C.SIZES[sz].r + facing tick per entity · routes: snap.dbg.routes polylines ·
 * zones: snap.dbg.zones circles · targets: snap.dbg.targets crosses · always: thin LOS / first-down lines.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const D = R.DebugDraw = R.DebugDraw || {};
  const T = globalThis.THREE;
  const MIDX = 26.667;
  const MAXV = 8000;

  D.create = function (ctx) {
    const pos = new Float32Array(MAXV * 3), col = new Float32Array(MAXV * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('color', new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage));
    const mat = new T.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
    const lines = new T.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 20;
    lines.visible = false;
    ctx.scene.add(lines);
    const opt = { hitboxes: false, routes: false, zones: false };
    let n = 0;

    function seg(x0, y0, z0, x1, y1, z1, r, g, b) {
      if (n + 2 > MAXV) return;
      let o = n * 3;
      pos[o] = x0 - MIDX; pos[o + 1] = z0; pos[o + 2] = 60 - y0; col[o] = r; col[o + 1] = g; col[o + 2] = b;
      o += 3;
      pos[o] = x1 - MIDX; pos[o + 1] = z1; pos[o + 2] = 60 - y1; col[o] = r; col[o + 1] = g; col[o + 2] = b;
      n += 2;
    }
    function circle(x, y, rad, r, g, b) {
      const N = 20;
      for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
        seg(x + Math.cos(a0) * rad, y + Math.sin(a0) * rad, 0.1, x + Math.cos(a1) * rad, y + Math.sin(a1) * rad, 0.1, r, g, b);
      }
    }

    return {
      set(o) { Object.assign(opt, o || {}); lines.visible = !!(opt.hitboxes || opt.routes || opt.zones); },
      update(s, alpha) {
        if (!lines.visible) return;
        n = 0;
        seg(0, s.los, 0.12, 53.333, s.los, 0.12, 0.2, 0.6, 1);
        seg(0, s.fd, 0.12, 53.333, s.fd, 0.12, 1, 0.9, 0.2);
        if (opt.hitboxes) {
          for (let i = 0; i < s.ents.length; i++) {
            const e = s.ents[i];
            const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
            const r = (PT.C.SIZES[e.sz] || PT.C.SIZES.M).r;
            const c = e.tm ? [1, 0.4, 0.4] : [0.4, 0.8, 1];
            circle(x, y, r, c[0], c[1], c[2]);
            seg(x, y, 0.1, x - Math.sin(e.fa) * r * 1.8, y + Math.cos(e.fa) * r * 1.8, 0.1, 1, 1, 1);
          }
          const b = s.ball;
          if (b) seg(b.x, b.y, 0, b.x, b.y, (b.z || 0) + 0.3, 1, 0.5, 0);
        }
        const d = s.dbg;
        if (d) {
          if (opt.routes && d.routes) {
            for (let i = 0; i < d.routes.length; i++) {
              const r = Array.isArray(d.routes[i]) ? d.routes[i] : d.routes[i].pts;
              if (!r) continue;
              for (let k = 0; k + 3 < r.length; k += 2) seg(r[k], r[k + 1], 0.15, r[k + 2], r[k + 3], 0.15, 0.3, 1, 1);
            }
          }
          if (opt.zones && d.zones) for (let i = 0; i < d.zones.length; i++) { const z = d.zones[i]; circle(z.x, z.y, z.r, 1, 0.3, 1); }
          if (opt.zones && d.targets) {
            for (let i = 0; i < d.targets.length; i++) {
              const t = d.targets[i];
              const x = t.x != null ? t.x : t[0], y = t.y != null ? t.y : t[1];
              if (x == null) continue;
              seg(x - 0.6, y - 0.6, 0.15, x + 0.6, y + 0.6, 0.15, 1, 0.2, 0.2);
              seg(x - 0.6, y + 0.6, 0.15, x + 0.6, y - 0.6, 0.15, 1, 0.2, 0.2);
            }
          }
        }
        geo.setDrawRange(0, n);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      },
      dispose() { ctx.scene.remove(lines); geo.dispose(); mat.dispose(); }
    };
  };
})(globalThis.PT = globalThis.PT || {});
