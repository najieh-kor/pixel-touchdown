/* Pixel Touchdown: js/render/stadium.js
 * Owner: WP4. Responsibility: stands, instanced crowd, sky color, lights.
 *
 *   R.Stadium.build(ctx) → { sky, fog, setLight(), cheer(power), update(dt, time, cam), dispose }
 *     toy voxel stands sized by stadium.lvl (1..5: bleachers → bowl + upper deck, video board, light towers),
 *     padded wall + banners in home colors, instanced crowd of little voxel fans (bounces on big plays),
 *     outside world themed by climate (warm / mild / cold / rainy / dome), sky + light per weather.
 *   R.Stadium.menu(opts) → menu backdrop: floating Crossy-Road island diorama with the mascot and two players
 *     playing catch; { scene, cam, setTeam(backdrop), update(dt, time, aspect), dispose }.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const St = R.Stadium = R.Stadium || {};
  const T = globalThis.THREE;
  const HW = 26.667;

  /** sky + light presets by weather / dome (warm/cold tint the sky a little) */
  const SKY = {
    sunny: { bg: 0x8fd6ff, hemi: 0.56, sun: 0.52, ground: 0x8f9c84, fogNear: 60, fogFar: 260 },
    cloudy: { bg: 0xb4c6d4, hemi: 0.68, sun: 0.24, ground: 0x8a968a, fogNear: 50, fogFar: 220 },
    rain: { bg: 0x8a9db0, hemi: 0.62, sun: 0.16, ground: 0x76857e, fogNear: 30, fogFar: 170 },
    wind: { bg: 0x9fd2f0, hemi: 0.58, sun: 0.48, ground: 0x8f9c84, fogNear: 60, fogFar: 260 },
    fog: { bg: 0xc9d1d8, hemi: 0.7, sun: 0.18, ground: 0xa0a8a4, fogNear: 0, fogFar: 45 },
    snow: { bg: 0xcfdcea, hemi: 0.68, sun: 0.28, ground: 0xb8c4cc, fogNear: 40, fogFar: 200 },
    clear: { bg: 0x1f2547, hemi: 0.66, sun: 0.36, ground: 0x7e7a98, fogNear: 90, fogFar: 300 }
  };
  St.SKY = SKY;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  function climateOf(ctx) {
    const s = ctx.stad || {};
    if (s.clim) return s.clim;
    const k = ctx.wx.k;
    if (k === 'clear') return 'dome';
    if (k === 'snow') return 'cold';
    if (k === 'rain') return 'rainy';
    return 'mild';
  }

  // ---------------------------------------------------------------------------------------------
  // Stadium
  // ---------------------------------------------------------------------------------------------
  St.build = function (ctx) {
    const scene = ctx.scene, q = ctx.q;
    const lvl = Math.max(1, Math.min(5, (ctx.stad && ctx.stad.lvl) || 2));
    const clim = climateOf(ctx);
    const dome = clim === 'dome' || ctx.wx.k === 'clear';
    const wk = dome ? 'clear' : (SKY[ctx.wx.k] ? ctx.wx.k : 'sunny');
    const sky = SKY[wk];
    const homeCol = (ctx.stad && ctx.stad.homeCol != null) ? ctx.stad.homeCol : ctx.cols[0].pri;
    const homeSec = ctx.cols[0].sec, awayCol = ctx.cols[1].pri;
    const V = R.Voxel;
    const objs = [];
    const add = (o) => { scene.add(o); objs.push(o); return o; };

    // lights / sky
    let bg = sky.bg;
    if (!dome && wk === 'sunny' && clim === 'warm') bg = 0x7fd0ff;
    if (!dome && wk === 'sunny' && clim === 'cold') bg = 0xa9dcf5;
    const skyCol = new T.Color(bg);
    const fog = new T.Fog(bg, sky.fogNear + 40, sky.fogFar + 40);
    if (ctx.hemi) { ctx.hemi.intensity = sky.hemi; ctx.hemi.groundColor.setHex(sky.ground); }
    if (ctx.sun) ctx.sun.intensity = sky.sun;

    // ground apron (outside the painted field)
    const groundCol = clim === 'cold' && wk === 'snow' ? 0xeef4fa : clim === 'warm' ? 0x7cc04a : clim === 'rainy' ? 0x5f9e45 : 0x6db447;
    const apronCol = clim === 'cold' && wk === 'snow' ? 0xe6eef5 : 0x6fbe48;
    const gb = V.builder();
    gb.quad(0, -0.03, 0, 600, 600, dome ? 0x3a3f5c : groundCol);
    gb.quad(0, -0.02, 0, (HW + 7) * 2, 134, apronCol);
    // sideline bench zones + white boundary (toy curb)
    [-1, 1].forEach((s) => {
      gb.quad(s * (HW + 3.6), -0.015, 0, 3.4, 52, V.shade(apronCol, 0.9));
      gb.box(s * (HW + 0.55), 0.06, 0, 0.5, 0.12, 120.6, 0xffffff);
    });
    gb.box(0, 0.06, 60.3, HW * 2 + 1.6, 0.12, 0.5, 0xffffff);
    gb.box(0, 0.06, -60.3, HW * 2 + 1.6, 0.12, 0.5, 0xffffff);
    const groundMat = new T.MeshLambertMaterial({ vertexColors: true });
    const ground = add(new T.Mesh(gb.geometry(), groundMat));
    ground.renderOrder = -1;

    // ----- stands (merged) -----
    const sb = V.builder();
    // end-zone structures live in their own meshes so they can fade when the camera sits behind that end
    // eb[0] = the y = 0 end (world +z), eb[1] = the y = 120 end (world −z)
    const eb = [V.builder(), V.builder()];
    const steps = [0, 4, 6, 8, 10, 12][lvl];
    const endSteps = [0, 0, 3, 6, 8, 10][lvl];
    const SD = 1.5, SH = 1.05;                  // step depth / rise
    const sideX = HW + 7.2, endZ = 60 + 5.5;
    const sideLen = lvl >= 3 ? 128 : 100;
    const conc = [0xEDE8DF, 0xDCD5C9];
    const seatA = homeCol, seatB = V.shade(homeCol, 0.82);
    const seats = [];                            // fan slots {x,y,z,ry} (side stands)
    const endSeats = [[], []];                   // fan slots in the end stands
    function standSide(s) {
      // padded wall
      sb.box(s * (sideX - 0.4), 0.75, 0, 0.7, 1.5, sideLen, homeCol);
      sb.box(s * (sideX - 0.4), 1.58, 0, 0.8, 0.18, sideLen, homeSec);
      for (let i = 0; i < steps; i++) {
        const x = s * (sideX + i * SD + SD / 2), top = (i + 1) * SH + 0.6;
        sb.box(x, top / 2, 0, SD, top, sideLen, conc[i % 2], 0, true);
        // seat strip in team colors (visible where there are no fans)
        sb.box(x + s * 0.25, top + 0.12, 0, 0.7, 0.24, sideLen, i % 2 ? seatA : seatB);
        for (let z = -sideLen / 2 + 0.8; z < sideLen / 2 - 0.5; z += 1.15) seats.push(x + s * 0.2, top + 0.24, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
      // back wall + roof lip
      const bx = s * (sideX + steps * SD + 0.4), bh = steps * SH + 2.6;
      sb.box(bx, bh / 2, 0, 0.8, bh, sideLen, V.shade(conc[1], 0.9));
      if (lvl >= 4) sb.box(s * (sideX + steps * SD - 1.6), bh + 0.4, 0, 5, 0.6, sideLen + 2, 0xffffff);
      // upper deck
      if (lvl >= 5) {
        const ux = sideX + steps * SD + 2, base = steps * SH + 4;
        sb.box(s * (ux + 3), base - 1.2, 0, 6, 1.2, sideLen - 10, homeCol);       // suites band
        for (let k = 0; k < 9; k++) sb.box(s * (ux - 0.05), base - 1.2, -sideLen / 2 + 8 + k * (sideLen - 16) / 8, 0.1, 0.7, 4, 0x9fd8ff);
        for (let i = 0; i < 6; i++) {
          const x = s * (ux + i * SD + SD / 2), top = base + (i + 1) * SH;
          sb.box(x, top - (top - base + 1) / 2, 0, SD, top - base + 1, sideLen - 10, conc[i % 2], 0, true);
          sb.box(x + s * 0.25, top + 0.12, 0, 0.7, 0.24, sideLen - 10, i % 2 ? seatA : seatB);
          for (let z = -sideLen / 2 + 6; z < sideLen / 2 - 6; z += 1.3) seats.push(x + s * 0.2, top + 0.24, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
      }
    }
    function standEnd(s) {
      if (!endSteps) return;
      const b = eb[s > 0 ? 0 : 1], es = endSeats[s > 0 ? 0 : 1];
      const w = (sideX) * 2 - 2;
      b.box(0, 0.75, s * (endZ - 0.4), w, 1.5, 0.7, homeCol);
      b.box(0, 1.58, s * (endZ - 0.4), w, 0.18, 0.8, homeSec);
      for (let i = 0; i < endSteps; i++) {
        const z = s * (endZ + i * SD + SD / 2), top = (i + 1) * SH + 0.6;
        b.box(0, top / 2, z, w, top, SD, conc[i % 2], 0, true);
        b.box(0, top + 0.12, z + s * 0.25, w, 0.24, 0.7, i % 2 ? seatA : seatB);
        for (let x = -w / 2 + 0.8; x < w / 2 - 0.5; x += 1.15) es.push(x, top + 0.24, z + s * 0.2, s > 0 ? Math.PI : 0);
      }
      const bz = s * (endZ + endSteps * SD + 0.4), bh = endSteps * SH + 2.6;
      b.box(0, bh / 2, bz, w, bh, 0.8, V.shade(conc[1], 0.9));
    }
    standSide(-1); standSide(1);
    standEnd(-1); standEnd(1);
    if (lvl <= 1) {
      // little bleacher ends: hay bales / picnic look
      [-1, 1].forEach((s) => { for (let k = -3; k <= 3; k++) eb[s > 0 ? 0 : 1].box(k * 4, 0.6, s * (endZ + 2), 3, 1.2, 1.6, 0xE9C46A); });
    }
    // video board (lvl ≥ 4) behind the far (+y, world −z) end
    if (lvl >= 4) {
      const z = -(endZ + endSteps * SD + 3), vb = eb[1];
      vb.box(0, 13, z, 22, 9, 1.2, 0x2b2d42);
      vb.box(0, 13, z + 0.65, 20, 7.4, 0.1, 0x1b3a5c);
      vb.box(0, 13.4, z + 0.75, 8, 2.2, 0.1, homeCol);
      vb.box(-6, 4, z, 1, 8, 1, 0x8a8f99); vb.box(6, 4, z, 1, 8, 1, 0x8a8f99);
    }
    // light towers (lvl ≥ 3) at the four corners
    if (lvl >= 3 && !dome) {
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((c) => {
        const x = c[0] * (sideX + steps * SD + 2), z = c[1] * (endZ + Math.max(endSteps, 3) * SD + 2), hgt = 18 + lvl * 2;
        const tb = eb[c[1] > 0 ? 0 : 1];
        tb.box(x, hgt / 2, z, 0.9, hgt, 0.9, 0xb7bcc6);
        tb.box(x, hgt + 1.4, z, 6, 3, 0.8, 0x6a707c, c[0] * c[1] * 0.7);
        for (let i = -1; i <= 1; i++) for (let j = 0; j < 2; j++) tb.box(x + i * 1.7, hgt + 0.7 + j * 1.4, z - c[1] * 0.45, 1.3, 1.0, 0.2, 0xfff6c8, c[0] * c[1] * 0.7);
      });
    }
    // ----- sideline (both team areas between the 20s): long two-row benches on a riser, ad boards, carts, nets,
    // camera rails, equipment cases, weather props. All merged into the stands mesh (no extra draw calls).
    const benchTop0 = 0.42, benchTop1 = 0.78;
    St.BENCH = { top0: benchTop0, top1: benchTop1, dx0: 4.3, dx1: 5.4, z0: -26, z1: 26 };
    [[-1, ctx.cols[0], ctx.kits ? ctx.kits[0] : ctx.cols[0]], [1, ctx.cols[1], ctx.kits ? ctx.kits[1] : ctx.cols[1]]].forEach((b) => {
      const s = b[0], c = b[1];
      const x0 = s * (HW + 4.3), x1 = s * (HW + 5.4), L = 52;
      sb.box(s * (HW + 5.4), 0.18, 0, 1.3, 0.36, L + 1, V.shade(c.pri, 0.55));            // riser
      for (let z = -24; z <= 24; z += 6) { sb.box(x0, 0.15, z, 0.12, 0.3, 0.12, 0x8a8f99); }   // bench legs
      sb.box(x0, benchTop0 - 0.06, 0, 0.7, 0.12, L, c.pri);                                // front bench
      sb.box(x1, benchTop1 - 0.06, 0, 0.7, 0.12, L, c.pri);                                // back bench
      sb.box(s * (HW + 5.95), benchTop1 + 0.35, 0, 0.12, 0.6, L, V.shade(c.pri, 0.8));      // backrest
      sb.box(s * (HW + 5.95), benchTop1 + 0.66, 0, 0.16, 0.08, L + 0.1, c.sec);
      // ad boards along the wall in team colours
      for (let z = -54; z <= 54; z += 6) {
        if (Math.abs(z) < 3) continue;
        const pc = (Math.round(z / 6) & 1) ? c.pri : c.sec;
        sb.box(s * (HW + 6.55), 0.45, z, 0.18, 0.9, 5.6, pc);
        sb.box(s * (HW + 6.45), 0.45, z, 0.04, 0.22, 4.8, pc === c.sec ? c.pri : 0xffffff);
      }
      // medical cart (white, red cross) near the 20
      const mz = -29;
      sb.box(s * (HW + 3.6), 0.55, mz, 1.3, 0.7, 2.0, 0xffffff);
      sb.box(s * (HW + 3.6), 0.92, mz, 0.24, 0.05, 0.9, 0xE63B2E); sb.box(s * (HW + 3.6), 0.92, mz, 0.9, 0.05, 0.24, 0xE63B2E);
      [[-0.55, -0.8], [0.55, -0.8], [-0.55, 0.8], [0.55, 0.8]].forEach((w) => sb.box(s * (HW + 3.6) + w[0], 0.18, mz + w[1], 0.15, 0.36, 0.36, 0x222222));
      sb.box(s * (HW + 3.6), 1.05, mz + 0.6, 0.5, 0.3, 0.5, 0x2D9CDB);                     // ice bag box
      // kicking net (frame + white net panel) near the other 20 — the team's kicker warms up into it
      const nz = 24;
      sb.box(s * (HW + 2.6), 1.1, nz, 0.1, 2.2, 0.1, 0x9aa0a8); sb.box(s * (HW + 4.6), 1.1, nz, 0.1, 2.2, 0.1, 0x9aa0a8);
      sb.box(s * (HW + 3.6), 2.2, nz, 2.1, 0.1, 0.1, 0x9aa0a8);
      sb.box(s * (HW + 3.6), 1.1, nz - 0.05, 1.9, 2.1, 0.05, 0xEFEFEA);
      for (let k = 0; k < 4; k++) sb.box(s * (HW + 3.6), 0.3 + k * 0.5, nz - 0.08, 1.9, 0.04, 0.02, 0xBFC3C8);
      // equipment cases (black/silver) and a helmet rack
      [[-17, 0x2b2b30], [-15.8, 0x9aa0a8], [15.5, 0x2b2b30]].forEach((e) => sb.box(s * (HW + 6.1), 0.3, e[0], 0.7, 0.6, 1.0, e[1]));
      sb.box(s * (HW + 6.1), 0.62, -17, 0.72, 0.06, 1.02, 0xFFC933);
      // weather: heaters on cold / snowy days, misting fans when it is hot
      if (clim === 'cold' || wk === 'snow') {
        [-12, 0, 12].forEach((z) => { sb.box(s * (HW + 6.2), 0.6, z, 0.6, 1.2, 0.6, 0x3a3a40); sb.box(s * (HW + 5.95), 0.8, z, 0.08, 0.6, 0.45, 0xFF7B1C); sb.box(s * (HW + 6.2), 1.25, z, 0.7, 0.1, 0.7, 0x55555c); });
      } else if (clim === 'warm' && wk === 'sunny') {
        [-12, 0, 12].forEach((z) => { sb.box(s * (HW + 6.2), 0.7, z, 0.12, 1.4, 0.12, 0x9aa0a8); sb.box(s * (HW + 6.0), 1.5, z, 0.25, 0.9, 0.9, 0xEFEFEA); sb.box(s * (HW + 5.85), 1.5, z, 0.05, 0.7, 0.7, 0x9fd8ff); });
      }
    });
    // TV camera rails on the home side (the cart + cameraman ride them in the renderer)
    sb.box(-(HW + 1.05), 0.04, 0, 0.08, 0.08, 96, 0x8a8f99); sb.box(-(HW + 1.65), 0.04, 0, 0.08, 0.08, 96, 0x8a8f99);
    for (let z = -46; z <= 46; z += 4) sb.box(-(HW + 1.35), 0.02, z, 0.8, 0.04, 0.12, 0x6b4a3a);
    // sideline props: drinks table with cups + Gatorade-style bucket per bench, an equipment cart (away side)
    [[-1, ctx.cols[0]], [1, ctx.cols[1]]].forEach((b) => {
      const s = b[0], c = b[1], x = s * (HW + 3.0);
      for (let k = -1; k <= 1; k += 2) {
        const z = k * 8.2;
        sb.box(x, 0.85, z, 1.0, 0.12, 2.4, 0xB07A45);                                   // table top
        sb.box(x - 0.35, 0.4, z - 1.0, 0.1, 0.8, 0.1, 0x8a8f99); sb.box(x + 0.35, 0.4, z + 1.0, 0.1, 0.8, 0.1, 0x8a8f99);
        sb.box(x + 0.35, 0.4, z - 1.0, 0.1, 0.8, 0.1, 0x8a8f99); sb.box(x - 0.35, 0.4, z + 1.0, 0.1, 0.8, 0.1, 0x8a8f99);
        for (let i = 0; i < 6; i++) sb.box(x - 0.25 + (i % 2) * 0.5, 1.03, z - 0.9 + (i >> 1) * 0.55, 0.22, 0.24, 0.22, i % 3 ? 0xffffff : c.pri);   // cups
        sb.box(x, 1.25, z + 0.95, 0.5, 0.55, 0.5, 0x2D9CDB);                              // water jug
      }
      for (let k = -1; k <= 1; k += 2) {                                                  // coolers
        sb.box(s * (HW + 3.0), 0.5, k * 11.6, 0.9, 1.0, 0.9, 0xFF8C1A);
        sb.box(s * (HW + 3.0), 1.06, k * 11.6, 0.94, 0.12, 0.94, 0xffffff);
      }
      sb.box(s * (HW + 2.4), 0.35, 4.5, 0.75, 0.7, 0.75, 0xFF8C1A);                       // Gatorade bucket
      sb.box(s * (HW + 2.4), 0.73, 4.5, 0.8, 0.08, 0.8, 0xffffff);
    });
    {
      const x = HW + 4.2, z = -37;                                                        // equipment cart
      sb.box(x, 0.75, z, 1.6, 0.7, 2.8, 0xffffff);
      sb.box(x, 1.55, z + 0.5, 1.5, 0.9, 1.2, ctx.cols[0].pri);
      sb.box(x, 2.3, z + 0.3, 1.7, 0.12, 2.0, ctx.cols[0].sec);
      [[-0.75, -0.9], [0.75, -0.9], [-0.75, 0.9], [0.75, 0.9]].forEach((w) => sb.box(x + w[0], 0.3, z + w[1], 0.2, 0.6, 0.6, 0x222222));
      sb.box(x, 1.0, z - 1.0, 1.4, 0.6, 0.8, 0xFF8C1A);                                   // ball bin
    }
    // dome walls + roof ring
    if (dome) {
      const r = sideX + steps * SD + 3;
      for (let a = 0; a < 24; a++) {
        const an = a / 24 * Math.PI * 2, x = Math.cos(an) * r * 1.05, z = Math.sin(an) * (endZ + endSteps * SD + 6) * 1.05;
        sb.box(x, 14, z, 9, 28, 2, 0x353b60, -an + Math.PI / 2);
        sb.box(x * 0.92, 27, z * 0.92, 10, 1.2, 3, 0xd8dcf0, -an + Math.PI / 2);
        sb.box(x * 0.9, 25.8, z * 0.9, 1.2, 0.6, 1.2, 0xfff3b0, -an + Math.PI / 2);
      }
    }
    // outside world: trees / cacti / pines around the stadium
    if (!dome) {
      const outX = sideX + (lvl >= 5 ? steps * SD + 12 : steps * SD) + 6, outZ = endZ + Math.max(endSteps, 2) * SD + 8;
      for (let i = 0; i < 70; i++) {
        let x = rnd(-110, 110), z = rnd(-150, 150);
        if (Math.abs(x) < outX && Math.abs(z) < outZ) { if (Math.random() < 0.5) x = Math.sign(x || 1) * rnd(outX, outX + 40); else z = Math.sign(z || 1) * rnd(outZ, outZ + 40); }
        tree(sb, x, z, clim, wk);
      }
    }
    const standMat = new T.MeshLambertMaterial({ vertexColors: true });
    const stands = add(new T.Mesh(sb.geometry(), standMat));
    stands.renderOrder = 1;
    // end groups (fade): {mats[], meshes[], a}
    const ends = [0, 1].map((k) => {
      const grp = { mats: [], meshes: [], a: 1 };
      if (eb[k].count() > 0) {
        const m = new T.MeshLambertMaterial({ vertexColors: true });
        const mesh = add(new T.Mesh(eb[k].geometry(), m));
        mesh.renderOrder = 1;
        grp.mats.push(m); grp.meshes.push(mesh);
      }
      return grp;
    });

    // clouds (outdoor)
    let clouds = null;
    if (false) {   // clouds: off in the game (a high portrait camera would see them below it); the menu has its own
      const cb = V.builder();
      const cc = wk === 'rain' || wk === 'cloudy' ? 0xdde3ea : 0xffffff;
      for (let i = 0; i < 9; i++) {
        const x = rnd(-120, 120), z = rnd(-180, -60) * (Math.random() < 0.3 ? -1 : 1), y = rnd(34, 50);
        const n = 3 + (Math.random() * 3 | 0);
        for (let k = 0; k < n; k++) cb.box(x + k * 4 - n * 2, y + (k % 2) * 1.5, z + rnd(-2, 2), rnd(5, 8), rnd(3, 5), rnd(4, 7), cc);
      }
      clouds = add(new T.Mesh(cb.geometry(), new T.MeshBasicMaterial({ vertexColors: true, fog: false })));
    }

    // ----- crowd: FULL stands. 3D voxel fans in the front side rows (med/high), a dense 2D billboard crowd
    // (instanced camera-facing pixel-art quads, GPU bob / cheer) on every other seat, every tier -----
    const fanPal = { home: homeCol, sec: homeSec, away: awayCol };
    const fanGroups = [], boards = [];
    const n3d = Math.min(q.crowd >= 1500 ? 900 : q.crowd >= 600 ? 300 : 0, seats.length / 4 | 0);
    // side seats sorted front (low) → back
    const order = [];
    for (let i = 0; i < seats.length / 4; i++) order.push(i);
    order.sort((a, b) => seats[a * 4 + 1] - seats[b * 4 + 1]);
    const front = [], rest = [];
    order.forEach((i, k) => { const dst = k < n3d ? front : rest; dst.push(seats[i * 4], seats[i * 4 + 1], seats[i * 4 + 2], seats[i * 4 + 3]); });
    let fans = null;
    if (n3d > 0) {
      fans = St.fans(front, n3d, fanPal, 1, null);
      add(fans.batch.mesh); fans.batch.mesh.renderOrder = 2; fanGroups.push(fans);
    }
    const atlas = St.crowdAtlas(fanPal);
    if (rest.length) { const bb = St.billboards(rest, atlas, null); add(bb.mesh); boards.push(bb); }
    [0, 1].forEach((k) => {
      if (endSeats[k].length < 16) return;
      const bb = St.billboards(endSeats[k], atlas, null);
      add(bb.mesh); boards.push(bb);
      ends[k].mats.push(bb.mat); ends[k].meshes.push(bb.mesh);
    });

    // ----- banners (flutter in wind) -----
    const nb = q.banners * (lvl >= 3 ? 1 : 0.5) | 0;
    const banMat = new T.MeshLambertMaterial({ color: 0xffffff });
    const banners = V.batch(nb * 3 + 4, banMat);
    add(banners.mesh);
    const banPos = [];
    for (let i = 0; i < nb; i++) {
      const s = i % 2 ? 1 : -1;
      const z = -sideLen / 2 + 6 + (i >> 1) * (sideLen - 12) / Math.max(1, (nb >> 1) - 1);
      banPos.push(s * (sideX + steps * SD + 0.4), steps * SH + 2.6, z, i % 4 < 2 ? 0 : 1);
    }
    const priRGB = V.rgb(homeCol), secRGB = V.rgb(homeSec);
    const wind = ctx.wx;
    const windMag = Math.min(1.5, ((wind && wind.mph) || 4) / 12);

    // cheer state
    let cheerAmp = 0, cheerT = 0;
    const mtx = new T.Matrix4();

    return {
      sky: skyCol, fog: fog, lvl: lvl, clim: clim, dome: dome,
      setLight() {},
      /** 0..1 bounce the crowd */
      cheer(p) { cheerAmp = Math.max(cheerAmp, p); cheerT = 0; },
      update(dt, time, cam, dist, mood) {
        // fog distances follow the camera distance
        if (dist) {
          if (wk === 'fog') { fog.near = dist - 12; fog.far = dist + 32; }
          else { fog.near = dist + sky.fogNear; fog.far = dist + sky.fogFar; }
        }
        // crowd: bounce + arms up on big plays, quieter when the home team is behind (mood −1..1)
        if (fans || boards.length) {
          cheerT += dt;
          const amp = cheerAmp * Math.max(0, 1 - cheerT / 2.5);
          if (amp < 0.01) cheerAmp = 0;
          if (amp > 0 || q.crowdAnim) for (let i = 0; i < fanGroups.length; i++) fanGroups[i].update(time, amp, q.crowdAnim, mood || 0);
          for (let i = 0; i < boards.length; i++) boards[i].update(time, amp, mood || 0);
        }
        // occlusion fade: the end structures behind the camera turn see-through (camera z > 60 = behind y = 0)
        if (cam) {
          const cz = cam.position.z;
          for (let k = 0; k < 2; k++) {
            const behind = k === 0 ? (cz - 48) / 14 : (-cz - 48) / 14;
            const want = behind > 0 ? Math.max(0.1, 1 - Math.min(1, behind) * 0.9) : 1;
            const g = ends[k];
            g.a += (want - g.a) * Math.min(1, dt * 6);
            const fade = g.a < 0.98;
            for (let i = 0; i < g.mats.length; i++) {
              const m = g.mats[i];
              if (m.transparent !== fade) { m.transparent = fade; m.depthWrite = !fade; m.needsUpdate = true; }
              m.opacity = fade ? g.a : 1;
              g.meshes[i].visible = g.a > 0.12;
            }
          }
        }
        // banners
        banners.begin();
        for (let i = 0; i < banPos.length; i += 4) {
          const x = banPos[i], y = banPos[i + 1], z = banPos[i + 2];
          banners.addBox(x, y + 2, z, 0.18, 4, 0.18, 0.85, 0.86, 0.9);
          const fl = Math.sin(time * (4 + windMag * 5) + z * 0.3) * (0.15 + windMag * 0.35);
          const c = banPos[i + 3] ? secRGB : priRGB;
          const ang = fl + (x > 0 ? Math.PI : 0);
          _tmpV.set(0, 0, 0.95).applyAxisAngle(_up, ang);
          mtx.makeRotationY(ang); _tmpM.makeScale(0.12, 1.3, 1.8); mtx.multiply(_tmpM);
          mtx.setPosition(x + _tmpV.x, y + 3.2, z + _tmpV.z);
          banners.add(mtx, c[0], c[1], c[2]);
        }
        banners.end();
        if (clouds) clouds.position.x = ((time * 0.6) % 80) - 40;
      },
      dispose() {
        objs.forEach((o) => { scene.remove(o); if (o.geometry && o.geometry !== R.Voxel.unitBox()) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        groundMat.dispose(); standMat.dispose(); banMat.dispose();
        for (let i = 0; i < fanGroups.length; i++) fanGroups[i].dispose();
        for (let i = 0; i < boards.length; i++) boards[i].dispose();
        atlas.dispose();
        ends.forEach((g) => g.mats.forEach((m) => m.dispose()));
      }
    };
  };
  const _tmpM = T ? new T.Matrix4() : null, _tmpV = T ? new T.Vector3() : null, _up = T ? new T.Vector3(0, 1, 0) : null;

  // ---------------------------------------------------------------------------------------------
  // Fans: little voxel animal (and a few person) fans for stands, HQ and the draft audience
  // ---------------------------------------------------------------------------------------------
  // ---------------------------------------------------------------------------------------------
  // 2D billboard crowd: 16 pixel-art animal fans (8 looks × arms down / arms up) in the team colors
  // ---------------------------------------------------------------------------------------------
  St.crowdAtlas = function (pal) {
    const C = 32, cols = 8;
    const cv = document.createElement('canvas'); cv.width = C * cols; cv.height = C * 2;
    const g = cv.getContext('2d');
    const hex = R.Voxel.hexStr;
    const furs = [0xC88A4A, 0xF4F4F4, 0x7D8590, 0xE07A2F, 0x6CC24A, 0xF4A9B8, 0x7A4E2D, 0xFFD84D];
    const shirts = [pal.home, pal.home, pal.sec, pal.home, 0xffffff, pal.away, pal.home, pal.sec];
    const ears = ['round', 'pointy', 'long', 'none', 'round', 'pointy', 'round', 'tuft'];
    for (let row = 0; row < 2; row++) for (let c = 0; c < cols; c++) {
      const ox = c * C, oy = row * C, up = row === 1;
      const fur = furs[c], shirt = shirts[c];
      const R2 = (x, y, w, h, col) => { g.fillStyle = hex(col); g.fillRect(ox + x, oy + y, w, h); };
      // body (shirt) + stripe
      R2(8, 18, 16, 14, shirt); R2(8, 22, 16, 2, shirt === pal.home ? pal.sec : pal.home);
      // arms
      if (up) { R2(4, 6, 4, 14, shirt); R2(24, 6, 4, 14, shirt); R2(4, 3, 4, 3, fur); R2(24, 3, 4, 3, fur); }
      else { R2(4, 19, 4, 10, shirt); R2(24, 19, 4, 10, shirt); R2(4, 28, 4, 3, fur); R2(24, 28, 4, 3, fur); }
      // head
      R2(9, 6, 14, 13, fur);
      if (ears[c] === 'round') { R2(8, 3, 4, 4, fur); R2(20, 3, 4, 4, fur); }
      else if (ears[c] === 'pointy') { R2(9, 2, 3, 5, fur); R2(20, 2, 3, 5, fur); }
      else if (ears[c] === 'long') { R2(11, 0, 3, 7, fur); R2(18, 0, 3, 7, fur); }
      else if (ears[c] === 'tuft') R2(14, 3, 4, 3, fur);
      R2(12, 11, 2, 3, 0x1b1b20); R2(18, 11, 2, 3, 0x1b1b20);          // eyes
      R2(14, 15, 4, 2, R.Voxel.shade(fur, 0.7));                         // snout
      // a sign held up on two looks (arms-up row)
      if (up && (c === 2 || c === 6)) { R2(2, 0, 28, 7, 0xffffff); R2(4, 2, 24, 3, c === 2 ? pal.home : pal.sec); }
    }
    const tex = new T.CanvasTexture(cv);
    tex.magFilter = T.NearestFilter;
    tex.minFilter = T.LinearMipmapLinearFilter;
    return tex;
  };

  /**
   * Billboard crowd over seat slots [x, y, z, ry, …]: one InstancedMesh of quads, camera-facing in the vertex
   * shader; per-instance look (atlas column), bob phase/speed and size. update(time, cheer 0..1, mood −1..1).
   */
  St.billboards = function (seats, atlas, matIn) {
    const n = seats.length / 4 | 0;
    const geo = new T.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    const look = new Float32Array(n), ph = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { look[i] = (Math.random() * 8) | 0; ph[i * 3] = Math.random() * 6.28; ph[i * 3 + 1] = 0.8 + Math.random() * 0.5; ph[i * 3 + 2] = 0.95 + Math.random() * 0.25; }
    geo.setAttribute('aLook', new T.InstancedBufferAttribute(look, 1));
    geo.setAttribute('aPh', new T.InstancedBufferAttribute(ph, 3));
    const uni = { uTime: { value: 0 }, uCheer: { value: 0 }, uIdle: { value: 0.06 } };
    const mat = matIn || new T.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, transparent: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = 'attribute float aLook;\nattribute vec3 aPh;\nuniform float uTime;\nuniform float uCheer;\nuniform float uIdle;\n' + sh.vertexShader
        .replace('#include <uv_vertex>', [
          '#include <uv_vertex>',
          'float wave = sin(uTime * 7.0 * aPh.y + aPh.x);',
          'float armsUp = step(0.55, uCheer * (0.6 + 0.4 * sin(aPh.x * 3.0)) + max(0.0, wave) * uCheer * 0.5);',
          'vUv = uv * vec2(0.125, 0.5) + vec2(aLook * 0.125, armsUp > 0.5 ? 0.0 : 0.5);'
        ].join('\n'))
        .replace('#include <project_vertex>', [
          'vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
          'float bob = max(0.0, sin(uTime * 7.0 * aPh.y + aPh.x)) * (uIdle + uCheer * 0.45);',
          'mvPosition.xy += vec2(position.x, position.y + bob) * aPh.z;',
          'gl_Position = projectionMatrix * mvPosition;'
        ].join('\n'));
    };
    mat.customProgramCacheKey = () => 'pt-crowd-bb';
    const mesh = new T.InstancedMesh(geo, mat, n);
    const m = new T.Matrix4();
    for (let i = 0; i < n; i++) { m.makeTranslation(seats[i * 4], seats[i * 4 + 1] - 0.05, seats[i * 4 + 2]); mesh.setMatrixAt(i, m); }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return {
      mesh: mesh, mat: mat, n: n,
      update(time, cheer, mood) { uni.uTime.value = time; uni.uCheer.value = cheer; uni.uIdle.value = Math.max(0.0, 0.06 + mood * 0.04); },
      dispose() { geo.dispose(); if (!matIn) mat.dispose(); }
    };
  };

  const SKIN = [0xF2C9A0, 0xE0B080, 0xC68B59, 0x8D5524];
  const BRIGHT = [0xFF5A5F, 0x3A86FF, 0xFFBE0B, 0x8AC926, 0xFF8FAB, 0x9B5DE5, 0x00BBF9];
  /**
   * @param {number[]} seats flat [x, yTop, z, ry, …] (ry turns the fan's +z front toward the field)
   * @param {number} count
   * @param {{home:number, sec:number, away:number}} pal
   * @param {number} sc  size scale (1 = game stands)
   * @param {THREE.Material|null} mat
   * @returns {{batch, n, update(time, amp, idleOn, mood), dispose()}}
   */
  St.fans = function (seats, count, pal, sc, mat) {
    const V = R.Voxel;
    const nSeats = seats.length / 4 | 0;
    count = Math.min(count, nSeats);
    const material = mat || new T.MeshLambertMaterial({ color: 0xffffff });
    const batch = V.batch(Math.max(1, count * 8), material);
    const base = new Float32Array(count * 8);               // per-instance base y
    const start = new Uint16Array(count), num = new Uint8Array(count);
    const armL = new Int32Array(count), armR = new Int32Array(count);
    const armM = new Float32Array(count * 64);               // [L down, R down, L up, R up] × 16
    const ph = new Float32Array(count), sp = new Float32Array(count), rnd01 = new Float32Array(count), hold = new Uint8Array(count);
    const furs = [];
    Object.keys(R.Models.SPECIES).forEach((k) => { furs.push(R.Models.SPECIES[k].A[0], R.Models.SPECIES[k].B[0]); });
    const shirtOf = () => {
      const r = Math.random();
      return r < 0.45 ? pal.home : r < 0.65 ? pal.sec : r < 0.77 ? pal.away : r < 0.85 ? 0xffffff : pick(BRIGHT);
    };
    const W = new T.Matrix4(), L = new T.Matrix4(), Mt = new T.Matrix4(), Rz = new T.Matrix4(), S = new T.Matrix4();
    let idx = 0;
    // seat choice: pack ~80% of the fans densely into the lowest rows (what the camera sees), scatter the rest
    const order = [];
    for (let i = 0; i < nSeats; i++) order.push(i);
    order.sort((a, b) => seats[a * 4 + 1] - seats[b * 4 + 1] || a - b);
    const chosen = [];
    const dense = Math.floor(count * 0.8);
    for (let i = 0; i < nSeats && chosen.length < dense; i++) if (Math.random() < 0.88) chosen.push(order[i]);
    const rest = order.slice(Math.min(nSeats, Math.ceil(dense / 0.88) + 1));
    while (chosen.length < count && rest.length) chosen.push(rest.splice((Math.random() * rest.length) | 0, 1)[0]);
    while (chosen.length < count) chosen.push(order[(Math.random() * nSeats) | 0]);
    function part(lx, ly, lz, w, h, d, col, rz) {
      L.makeTranslation(lx * sc, ly * sc, lz * sc);
      if (rz) { Rz.makeRotationZ(rz); L.multiply(Rz); }
      S.makeScale(w * sc, h * sc, d * sc); L.multiply(S);
      Mt.multiplyMatrices(W, L);
      return Mt;
    }
    for (let i = 0; i < count; i++) {
      const si = chosen[i] * 4;
      const x = seats[si], y = seats[si + 1], z = seats[si + 2], ry = seats[si + 3];
      const fs = 0.88 + Math.random() * 0.22;
      W.makeRotationY(ry); S.makeScale(fs, fs, fs); W.multiply(S); W.setPosition(x, y, z);
      start[i] = idx;
      const shirt = V.rgb(shirtOf(), 0.92 + Math.random() * 0.12);
      const animal = Math.random() < 0.72;
      const head = animal ? pick(furs) : pick(SKIN);
      const hc = V.rgb(head);
      const add = (m, c, by) => { batch.add(m, c[0], c[1], c[2]); base[idx] = m.elements[13]; idx++; void by; };
      add(part(0, 0.38, 0, 0.78, 0.76, 0.55), shirt);                         // body (shirt)
      add(part(0, 1.07, 0.02, 0.62, 0.6, 0.6), hc);                           // head
      if (animal && Math.random() < 0.85) {
        const longE = Math.random() < 0.18;
        const ew = longE ? 0.13 : 0.17, eh = longE ? 0.42 : 0.2, ey = longE ? 1.55 : 1.44;
        add(part(0.2, ey, 0, ew, eh, 0.12), hc);
        add(part(-0.2, ey, 0, ew, eh, 0.12), hc);
      }
      // arms: precompute down / up matrices (copied at runtime, never composed per frame)
      const skin = animal ? hc : V.rgb(head);
      const armC = Math.random() < 0.5 ? shirt : skin;
      const o = i * 64;
      armM.set(part(0.48, 0.42, 0.02, 0.17, 0.5, 0.2, null, 0.08).elements, o);
      armM.set(part(-0.48, 0.42, 0.02, 0.17, 0.5, 0.2, null, -0.08).elements, o + 16);
      armM.set(part(0.42, 1.12, 0.04, 0.17, 0.55, 0.2, null, -0.22).elements, o + 32);
      armM.set(part(-0.42, 1.12, 0.04, 0.17, 0.55, 0.2, null, 0.22).elements, o + 48);
      Mt.fromArray(armM, o); armL[i] = idx; add(Mt, armC);
      Mt.fromArray(armM, o + 16); armR[i] = idx; add(Mt, armC);
      // props: ~8% signs (board on a stick), ~5% foam fingers
      const pr = Math.random();
      if (pr < 0.08) {
        hold[i] = 2;
        const board = V.rgb(pick([pal.home, pal.sec, 0xffffff]));
        const ink = V.rgb(board[0] + board[1] + board[2] > 2.4 ? pal.home : 0xffffff);
        add(part(0, 1.62, 0.12, 0.07, 0.62, 0.07), [0.55, 0.38, 0.22]);
        add(part(0, 2.08, 0.14, 1.05, 0.58, 0.07), board);
        add(part(0, 2.1, 0.19, 0.72, 0.13, 0.03), ink);
      } else if (pr < 0.13) {
        hold[i] = 1;
        const fc = V.rgb(pal.home);
        add(part(-0.48, 1.52, 0.06, 0.34, 0.34, 0.22), fc);
        add(part(-0.42, 1.86, 0.06, 0.12, 0.42, 0.12), fc);
      }
      num[i] = idx - start[i];
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.8 + Math.random() * 0.5;
      rnd01[i] = Math.random();
      // props are held up: copy the "up" arm matrices now
      if (hold[i]) {
        const arr = batch.mesh.instanceMatrix.array;
        if (hold[i] === 2) for (let k = 0; k < 16; k++) arr[armL[i] * 16 + k] = armM[o + 32 + k];
        for (let k = 0; k < 16; k++) arr[armR[i] * 16 + k] = armM[o + 48 + k];
        base[armL[i]] = arr[armL[i] * 16 + 13]; base[armR[i]] = arr[armR[i] * 16 + 13];
      }
    }
    batch.end();
    const arr = batch.mesh.instanceMatrix.array;
    return {
      batch: batch, n: count,
      /** amp 0..1 cheer, idleOn: gentle idle bob, mood −1..1 (behind..ahead) */
      update(time, amp, idleOn, mood) {
        const idle = idleOn ? (mood < 0 ? 0.025 + 0.025 * (1 + mood) : 0.05 + 0.04 * mood) : 0;
        const upFrac = mood < 0 ? 0.02 * (1 + mood) : 0.03 + 0.08 * mood;
        for (let i = 0; i < count; i++) {
          const p = ph[i] + time * 7 * sp[i];
          const j = (Math.max(0, Math.sin(p)) * amp * 0.85 + Math.max(0, Math.sin(p * 0.33)) * idle) * sc;
          const s0 = start[i], n = num[i];
          for (let k = s0; k < s0 + n; k++) arr[k * 16 + 13] = base[k] + j;
          if (hold[i] === 2) continue;
          // arms up: cheering wave (phase-shifted) or a few happy idle fans
          const wave = amp > 0.08 && Math.sin(p * 0.5 + rnd01[i] * 3) > 0.35 - amp;
          const idleUp = rnd01[i] < upFrac && Math.sin(time * 0.6 + rnd01[i] * 40) > 0.2;
          const up = wave || idleUp;
          const o = i * 64;
          const li = armL[i] * 16, ri = armR[i] * 16;
          if (hold[i] !== 1) { for (let k = 0; k < 16; k++) arr[li + k] = armM[o + (up ? 32 : 0) + k]; arr[li + 13] += j; }
          for (let k = 0; k < 16; k++) arr[ri + k] = armM[o + (up || hold[i] === 1 ? 48 : 16) + k];
          arr[ri + 13] += j;
        }
        batch.mesh.instanceMatrix.needsUpdate = true;
      },
      dispose() { batch.dispose(); if (!mat) material.dispose(); }
    };
  };

  /** voxel tree / cactus / pine by climate */
  function tree(b, x, z, clim, wk) {
    const s = 0.9 + Math.random() * 0.8;
    if (clim === 'warm' && Math.random() < 0.5) {
      // cactus
      const g = 0x3fae5a;
      b.box(x, 2.2 * s, z, 1.4 * s, 4.4 * s, 1.4 * s, g);
      b.box(x + 1.3 * s, 2.6 * s, z, 1.2 * s, 0.9 * s, 0.9 * s, g);
      b.box(x + 1.75 * s, 3.4 * s, z, 0.9 * s, 1.8 * s, 0.9 * s, g);
      b.box(x - 1.2 * s, 2.0 * s, z, 1.0 * s, 0.8 * s, 0.9 * s, g);
      b.box(x - 1.55 * s, 2.7 * s, z, 0.8 * s, 1.4 * s, 0.8 * s, g);
      b.box(x, 4.5 * s, z, 0.6, 0.4, 0.6, 0xff6fae);
      return;
    }
    if (clim === 'cold') {
      // pine (snow caps when snowing)
      const g = 0x2f7d4a, snow = wk === 'snow';
      b.box(x, 0.8 * s, z, 0.8 * s, 1.6 * s, 0.8 * s, 0x7a4e2d);
      b.box(x, 2.4 * s, z, 4 * s, 1.6 * s, 4 * s, g);
      b.box(x, 3.9 * s, z, 3 * s, 1.5 * s, 3 * s, g);
      b.box(x, 5.2 * s, z, 1.8 * s, 1.3 * s, 1.8 * s, g);
      if (snow) { b.box(x, 3.25 * s, z, 3.2 * s, 0.2, 3.2 * s, 0xffffff); b.box(x, 5.9 * s, z, 1.6 * s, 0.25, 1.6 * s, 0xffffff); }
      return;
    }
    // round-ish leafy tree (Crossy Road)
    const leaf = clim === 'rainy' ? pick([0x3f9a45, 0x4caf50]) : pick([0x5cbf4a, 0x4caf50, 0x7ccf4a]);
    b.box(x, 1.0 * s, z, 0.9 * s, 2.0 * s, 0.9 * s, 0x8a5a2b);
    b.box(x, 2.8 * s, z, 3.2 * s, 2.2 * s, 3.2 * s, leaf);
    b.box(x, 4.1 * s, z, 2.2 * s, 1.0 * s, 2.2 * s, R.Voxel.shade(leaf, 1.1));
  }
  St._tree = tree;

  // ---------------------------------------------------------------------------------------------
  // Menu / HQ backdrop: floating Crossy-Road island dioramas in the user team's colors
  //   modes: 'title' (field + catch), 'hq' (mini stadium + town), 'draft' (stage + podiums + spotlights),
  //          'market' (stall tents + crates). Climate theming: warm / mild / cold / rainy / dome.
  //   St.menu(opts) → { scene, cam, setTeam(bd), setMode(mode), update(dt, time, aspect), dispose }
  //   bd = { teamCol, sec, sp, stad, clim, lvl, mode }
  // ---------------------------------------------------------------------------------------------
  const MENU_SKY = { warm: 0x8fd8ff, mild: 0x86d3f5, cold: 0xbfe2f2, rainy: 0x9db2c4, dome: 0x252b55 };
  const MENU_ISL = { title: [22, 30], hq: [34, 30], draft: [28, 24], market: [30, 24] };

  St.menu = function (opts) {
    const V = R.Voxel;
    const scene = new T.Scene();
    scene.background = new T.Color(0x86d3f5);
    scene.fog = new T.Fog(0x86d3f5, 80, 190);
    const hemi = new T.HemisphereLight(0xffffff, 0x8f9c84, 0.56);
    const sun = new T.DirectionalLight(0xffffff, 0.52);
    sun.position.set(-20, 40, 15);
    scene.add(hemi, sun);
    const cam = new T.PerspectiveCamera(32, 1, 1, 500);
    const objs = [];
    const add = (o) => { scene.add(o); objs.push(o); return o; };
    const LX = 0.55, LY = -1, LZ = -0.42;
    const matV = new T.MeshLambertMaterial({ vertexColors: true });
    const shadowMat = opts.shadowMaterial();
    const fanMat = new T.MeshLambertMaterial({ color: 0xffffff });
    let island = null, islandShadow = null, fans = null;
    let cur = Object.assign({ mode: 'title', clim: 'mild', lvl: 2 }, opts.backdrop || {});

    // spotlight cones (draft), one instanced draw call
    const coneGeo = new T.CylinderGeometry(0.5, 2.6, 13, 18, 1, true);
    coneGeo.translate(0, -6.5, 0);
    const coneMat = new T.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const cones = new T.InstancedMesh(coneGeo, coneMat, 3);
    cones.visible = false; cones.renderOrder = 5;
    add(cones);

    // ---- static diorama (merged): P() = prop that casts a baked shadow, G() = ground-level piece ----
    // remove a rebuilt mesh from the scene AND from objs (otherwise its CPU geometry arrays leak per rebuild)
    const drop = (o) => {
      if (!o) return;
      scene.remove(o);
      const i = objs.indexOf(o);
      if (i >= 0) objs.splice(i, 1);
      if (o.geometry && o.geometry !== V.unitBox()) o.geometry.dispose();
    };
    function buildIsland(bd) {
      drop(island); island = null;
      drop(islandShadow); islandShadow = null;
      if (fans) { drop(fans.batch.mesh); fans.dispose(); fans = null; }
      const pri = bd.teamCol != null ? bd.teamCol : 0x3BB273;
      const sec = bd.sec != null ? bd.sec : (V.lum(pri) > 160 ? 0x1b1f3a : 0xffffff);
      const clim = bd.clim || 'mild', mode = MENU_ISL[bd.mode] ? bd.mode : 'title';
      const snow = clim === 'cold', warm = clim === 'warm', rainy = clim === 'rainy', dome = clim === 'dome';
      const b = V.builder(), sh = V.builder();
      const G = (x, y, z, w, h, d, c, ry) => b.box(x, y, z, w, h, d, c, ry);
      const P = (x, y, z, w, h, d, c, ry) => { b.box(x, y, z, w, h, d, c, ry); sh.box(x, y, z, w, h, d, 0, ry); };
      const PM = (m, c) => { b.boxM(m, c); sh.boxM(m, 0); };
      const dims = MENU_ISL[mode], IW = dims[0], IL = dims[1];
      const grassA = rainy ? 0x6fb24a : warm ? 0xa5d36a : 0x93d65c, grassB = rainy ? 0x62a641 : warm ? 0x98c85e : 0x84ca4f;
      const rim = snow ? 0xf2f7fb : warm ? 0xe8cf8a : rainy ? 0x5c9a3f : 0x7cc04a;
      // island block: dirt layers, rim, grass top
      G(0, -2.2, 0, IW, 4, IL, 0x9c6b3e);
      G(0, -4.6, 0, IW - 3, 1.2, IL - 3, 0x80542f);
      G(0, -5.6, 0, IW - 7, 1.0, IL - 7, 0x6b4426);
      G(0, -0.3, 0, IW, 0.6, IL, rim);
      for (let i = 0; i < 18; i++) G(-IW / 2 + 0.8 + i * (IW - 1.6) / 17, -0.9, IL / 2 + 0.05, 1.1, rnd(0.5, 1.4), 0.2, snow ? 0xf2f7fb : warm ? 0xd9bd73 : 0x7cc04a);
      const inner = (w, l, cz) => { for (let i = 0; i < Math.round(l / 2.5); i++) G(0, -0.24, cz - l / 2 + 1.25 + i * 2.5, w, 0.5, 2.5, i % 2 ? grassB : grassA); };
      if (rainy) for (let i = 0; i < 6; i++) G(rnd(-IW / 2 + 2, IW / 2 - 2), 0.03, rnd(-IL / 2 + 2, IL / 2 - 2), rnd(1.5, 3), 0.04, rnd(1, 2), 0x8fb4cf);
      // climate trees around the edge
      const tk = snow ? 'cold' : warm ? 'warm' : rainy ? 'rainy' : 'mild', tw = snow ? 'snow' : 'sunny';
      const treeAt = (x, z) => { tree(b, x, z, tk, tw); tree(sh, x, z, tk, tw); };
      // dome: arch + roof light ring behind the island
      if (dome) {
        for (let k = 0; k <= 16; k++) {
          const an = k / 16 * Math.PI, r = IW * 0.62;
          P(Math.cos(an) * r, Math.sin(an) * r * 0.75 + 0.5, -IL / 2 - 1.5, 1.6, 1.6, 1.2, k % 2 ? 0xdfe3f2 : 0xc6cbe0);
          if (k % 2 === 0) G(Math.cos(an) * (r - 1.1), Math.sin(an) * r * 0.75 + 0.2, -IL / 2 - 1.1, 0.6, 0.6, 0.4, 0xfff3b0);
        }
      }
      const fanSeats = [];
      if (mode === 'title') {
        inner(IW - 1.2, IL - 1.2, 0);
        G(0, -0.2, -IL / 2 + 2.5 - 0.01, IW - 1.2, 0.62, 5.02, pri);
        G(0, 0.12, -IL / 2 + 2.5, 10, 0.06, 1.0, sec);
        for (let i = 1; i < 6; i++) G(0, 0.08, -IL / 2 + i * 5, IW - 1.6, 0.04, 0.22, 0xffffff);
        G(-IW / 2 + 0.9, 0.08, 0, 0.3, 0.04, IL - 1.6, 0xffffff); G(IW / 2 - 0.9, 0.08, 0, 0.3, 0.04, IL - 1.6, 0xffffff);
        goalpost(P, 0, -IL / 2 + 0.9, pri, 1);
        [[-IW / 2 + 1, -IL / 2 + 5], [IW / 2 - 1, -IL / 2 + 5]].forEach((q) => P(q[0], 0.4, q[1], 0.3, 0.8, 0.3, 0xFF7B1C));
        treeAt(-IW / 2 + 1.8, IL / 2 - 2.5); treeAt(IW / 2 - 1.8, -IL / 2 + 8); treeAt(IW / 2 - 1.6, IL / 2 - 4);
        P(-IW / 2 + 1.6, 0.4, -2, 0.9, 0.8, 7, pri); P(-IW / 2 + 1.15, 1.0, -2, 0.25, 1.2, 7, V.shade(pri, 0.8));
        P(-IW / 2 + 1.7, 0.45, 3.2, 0.9, 0.9, 0.9, 0xFF8C1A); P(-IW / 2 + 1.7, 0.98, 3.2, 0.95, 0.15, 0.95, 0xffffff);
      } else if (mode === 'hq') {
        // mini stadium (back half): field, two little stands with fans, scoreboard, flag
        const fz = -4, FW = 13, FL = 17;
        for (let i = 0; i < 7; i++) G(0, -0.22, fz - FL / 2 + 1.2 + i * 2.43, FW, 0.5, 2.43, i % 2 ? 0x84ca4f : 0x93d65c);
        G(0, -0.2, fz - FL / 2 + 1.2, FW, 0.56, 2.4, pri); G(0, -0.2, fz + FL / 2 - 1.2, FW, 0.56, 2.4, pri);
        for (let i = 1; i < 6; i++) G(0, 0.06, fz - FL / 2 + 2.4 + i * 2.43, FW - 0.6, 0.04, 0.16, 0xffffff);
        goalpost(P, 0, fz - FL / 2 + 0.3, pri, 0.7);
        const lvl = Math.max(1, Math.min(5, bd.lvl || 2)), stp = 2 + Math.min(3, lvl >> 1);
        [-1, 1].forEach((sd) => {
          P(sd * (FW / 2 + 0.45), 0.5, fz, 0.5, 1.0, FL, pri);
          P(sd * (FW / 2 + 0.45), 1.05, fz, 0.55, 0.12, FL, sec);
          for (let i = 0; i < stp; i++) {
            const x = sd * (FW / 2 + 1.2 + i * 1.2), top = 0.9 + i * 0.75;
            P(x, top / 2, fz, 1.2, top, FL, i % 2 ? 0xdcd5c9 : 0xede8df);
            G(x + sd * 0.2, top + 0.06, fz, 0.5, 0.12, FL, i % 2 ? pri : V.shade(pri, 0.8));
            for (let z = fz - FL / 2 + 1; z < fz + FL / 2 - 0.8; z += 1.15) fanSeats.push(x + sd * 0.15, top + 0.12, z, sd > 0 ? -Math.PI / 2 : Math.PI / 2);
          }
        });
        // scoreboard behind the far end
        const sbz = fz - FL / 2 - 1.8;
        P(-3, 2.2, sbz, 0.4, 4.4, 0.4, 0x8a8f99); P(3, 2.2, sbz, 0.4, 4.4, 0.4, 0x8a8f99);
        P(0, 5.4, sbz, 8.4, 3.4, 0.8, 0x2b2d42); G(0, 5.4, sbz + 0.42, 7.6, 2.6, 0.1, 0x1b3a5c);
        G(0, 6.15, sbz + 0.48, 7.6, 0.5, 0.1, pri); G(-2, 5.0, sbz + 0.48, 1.4, 1.2, 0.1, 0xffd23f); G(2, 5.0, sbz + 0.48, 1.4, 1.2, 0.1, 0xffd23f);
        // flag pole with the team flag
        const flx = -IW / 2 + 2.4, flz = IL / 2 - 4;
        P(flx, 3.5, flz, 0.25, 7, 0.25, 0xd8dce6); P(flx + 1.4, 6.3, flz, 2.6, 1.6, 0.12, pri); G(flx + 1.4, 6.3, flz + 0.08, 2.6, 0.4, 0.04, sec);
        // town: a house and a shop in front, by climate
        const wall = warm ? 0xf2d5a0 : snow ? 0xe8e2d6 : rainy ? 0xd9d6cc : 0xf4ebdc;
        const roof = warm ? 0xd9a066 : snow ? 0xffffff : rainy ? 0x5b6e82 : 0xd9534f;
        house(P, G, IW / 2 - 4.5, IL / 2 - 4.5, 4.4, 3, 3.6, wall, roof, warm, snow);
        house(P, G, -IW / 2 + 5.5, IL / 2 - 4.2, 3.6, 2.6, 3.2, V.shade(wall, 0.95), roof, warm, snow);
        // shop awning in team colors on the house front
        for (let k = 0; k < 6; k++) P(IW / 2 - 4.5 - 1.85 + k * 0.74, 2.2, IL / 2 - 4.5 + 2.2, 0.74, 0.2, 1.1, k % 2 ? 0xffffff : pri);
        G(IW / 2 - 4.5, 3.1, IL / 2 - 4.5 + 1.82, 2.6, 0.7, 0.12, sec);
        treeAt(-IW / 2 + 1.6, -IL / 2 + 2); treeAt(IW / 2 - 1.6, -IL / 2 + 2.5); treeAt(IW / 2 - 1.6, 4);
      } else if (mode === 'draft') {
        inner(IW - 1.2, IL - 1.2, 0);
        // stage + backdrop board + podiums
        const sz = -5;
        P(0, 0.55, sz, 20, 1.1, 8, 0x6b4426); G(0, 1.12, sz, 20.1, 0.08, 8.1, 0x80542f);
        G(0, 0.55, sz + 4.02, 20, 0.5, 0.06, pri);
        P(0, 5.6, sz - 4.2, 20, 9, 0.6, pri); G(0, 9.4, sz - 3.88, 20, 0.8, 0.05, sec); G(0, 1.9, sz - 3.88, 20, 0.6, 0.05, sec);
        // big pixel star on the board
        const ST = ['00100', '11111', '01110', '01010', '10001'];
        for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (ST[r][c] === '1') G(-2 + c, 7.6 - r, sz - 3.86, 1, 1, 0.08, 0xffd23f);
        [[-4.8, 1.1, 0xc0c6d0], [0, 1.7, 0xffd23f], [4.8, 0.8, 0xcd7f32]].forEach((q) => { P(q[0], 1.1 + q[1] / 2, sz + 0.5, 2.6, q[1], 2.6, q[2]); G(q[0], 1.1 + q[1] + 0.02, sz + 0.5, 2.7, 0.06, 2.7, 0xffffff); });
        P(-9, 2.6, sz - 2.5, 1.4, 3, 1.4, 0x2b2b30); P(9, 2.6, sz - 2.5, 1.4, 3, 1.4, 0x2b2b30);   // speakers
        // audience rows (fans) facing the stage
        for (let r = 0; r < 2; r++) {
          const top = 0.3 + r * 0.6;
          P(0, top / 2, 4 + r * 1.6, 20, top, 1.3, r ? 0xdcd5c9 : 0xede8df);
          for (let x = -9; x <= 9; x += 1.2) fanSeats.push(x, top, 4 + r * 1.6, Math.PI);
        }
        treeAt(-IW / 2 + 1.8, -IL / 2 + 2); treeAt(IW / 2 - 1.8, -IL / 2 + 2.4); treeAt(IW / 2 - 1.6, IL / 2 - 2.2);
      } else if (mode === 'market') {
        inner(IW - 1.2, IL - 1.2, 0);
        // path
        for (let i = 0; i < 9; i++) G(-IW / 2 + 3 + i * 3, 0.05, 2.5 + (i % 2) * 0.3, 2.4, 0.08, 2.2, warm ? 0xe6cf98 : 0xcfc6b5);
        const tents = [[-9, -5], [0, -6.5], [9, -5]];
        tents.forEach((t, ti) => {
          const tx = t[0], tz = t[1];
          [[-2.2, -1.2], [2.2, -1.2], [-2.2, 1.2], [2.2, 1.2]].forEach((q) => P(tx + q[0], 1.6, tz + q[1], 0.25, 3.2, 0.25, 0xd8c3a0));
          P(tx, 0.55, tz + 1.0, 4.6, 1.1, 1.4, 0x9c6b3e); G(tx, 1.12, tz + 1.0, 4.7, 0.08, 1.5, 0xb5835a);
          const aw = ti === 1 ? sec : pri;
          for (let k = 0; k < 7; k++) {
            const m = new T.Matrix4().makeRotationX(0.32);
            m.premultiply(new T.Matrix4().makeTranslation(tx - 2.6 + k * 0.74 + 0.37, 3.45, tz + 0.1));
            m.multiply(new T.Matrix4().makeScale(0.74, 0.22, 3.4));
            PM(m, k % 2 ? 0xffffff : aw);
          }
          G(tx, 4.1, tz - 1.2, 3.2, 0.7, 0.12, ti === 1 ? pri : sec);
          // goods on the counter: balls, helmets, jerseys
          for (let k = 0; k < 4; k++) {
            const gx = tx - 1.6 + k * 1.05;
            if (ti === 0) P(gx, 1.38, tz + 1.0, 0.5, 0.36, 0.36, 0x8c4a28);
            else if (ti === 1) { P(gx, 1.45, tz + 1.0, 0.7, 0.55, 0.65, k % 2 ? pri : sec); G(gx, 1.5, tz + 1.34, 0.5, 0.15, 0.02, 0x2b2b30); }
            else P(gx, 1.3, tz + 1.0, 0.8, 0.3, 0.6, k % 2 ? pri : 0xffffff);
          }
        });
        // crates + bunting
        [[-13, 0.5], [-12.6, 3.5], [13, 1], [12.4, 4]].forEach((c, i) => { P(c[0], 0.6, c[1], 1.2, 1.2, 1.2, 0xa8763f); G(c[0], 0.6, c[1] + 0.61, 1.0, 0.12, 0.02, 0x7a522b); if (i % 2) P(c[0], 1.55, c[1], 0.9, 0.7, 0.9, 0xa8763f); });
        for (let k = 0; k < 24; k++) { const x = -12 + k; G(x, 4.6 - Math.sin((k % 12) / 12 * Math.PI) * 0.6 + (k >= 12 ? 0 : 0), -1.5, 0.45, 0.45, 0.06, k % 3 === 0 ? pri : k % 3 === 1 ? sec : 0xffd23f); }
        treeAt(-IW / 2 + 1.6, IL / 2 - 2); treeAt(IW / 2 - 1.6, IL / 2 - 2.5); treeAt(-IW / 2 + 1.8, -IL / 2 + 2);
      }
      // little flowers on the front lip
      for (let i = 0; i < 10; i++) G(rnd(-IW / 2 + 1, IW / 2 - 1), 0.12, IL / 2 - rnd(0.5, 1.2), 0.3, 0.3, 0.3, snow ? pick([0xffffff, 0x9fd8ff]) : pick([0xff6fae, 0xffffff, 0xffd23f]));
      island = add(new T.Mesh(b.geometry(), matV));
      islandShadow = add(new T.Mesh(sh.flatten(LX, LY, LZ, 0.06).geometry(), shadowMat));
      islandShadow.renderOrder = 1;
      if (fanSeats.length) {
        fans = St.fans(fanSeats, mode === 'draft' ? 26 : 70, { home: pri, sec: sec, away: 0xffffff }, mode === 'draft' ? 1.25 : 1.05, fanMat);
        scene.add(fans.batch.mesh);
        fans.batch.mesh.renderOrder = 2;
      }
      // sky by climate
      const skyC = MENU_SKY[clim] || MENU_SKY.mild;
      scene.background.setHex(skyC); scene.fog.color.setHex(skyC);
      hemi.intensity = dome ? 0.62 : rainy ? 0.6 : 0.56; sun.intensity = dome ? 0.42 : rainy ? 0.3 : 0.52;
      deco.visible = !dome;
      cones.visible = mode === 'draft';
      return mode;
    }

    // floating little clouds & distant islands (static, built once)
    const cb = V.builder();
    for (let i = 0; i < 12; i++) {
      const x = rnd(-80, 80), z = rnd(-100, -36), y = rnd(-6, 18);
      const n = 2 + (Math.random() * 3 | 0);
      for (let k = 0; k < n; k++) cb.box(x + k * 3, y + (k % 2), z, rnd(3, 6), rnd(2, 3), rnd(3, 5), 0xffffff);
    }
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 ? 1 : -1) * rnd(30, 48), z = rnd(-64, -26), y = rnd(-14, -4), s2 = rnd(4, 7);
      cb.box(x, y, z, s2 * 2, 1, s2 * 2, 0x84ca4f);
      cb.box(x, y - 1.6, z, s2 * 2, 2.2, s2 * 2, 0x9c6b3e);
      tree(cb, x, z, 'mild', 'sunny');
    }
    const deco = add(new T.Mesh(cb.geometry(), new T.MeshLambertMaterial({ vertexColors: true })));

    // players: one instanced batch + planar shadows
    const pmat = new T.MeshLambertMaterial({ color: 0xffffff });
    const batch = V.batch(800, pmat);
    add(batch.mesh);
    batch.mesh.renderOrder = 2;
    const shadows = V.batch(800, shadowMat);
    shadows.proj = V.shadowMatrix(new T.Matrix4(), LX, LY, LZ, 0.06);
    shadows.mesh.renderOrder = 1;
    add(shadows.mesh);
    let cast = [], mode = 'title';
    const squad = ['chicken', 'elephant', 'frog', 'penguin', 'fox', 'turtle', 'rabbit', 'giraffe', 'pig', 'owl', 'cat', 'bear'];

    function setTeam(bd) {
      cur = Object.assign({}, cur, bd || {});
      mode = buildIsland(cur);
      const team = { pri: cur.teamCol, sec: cur.sec != null ? cur.sec : (V.lum(cur.teamCol) > 160 ? 0x1b1f3a : 0xffffff) };
      const others = squad.filter((s2) => s2 !== cur.sp);
      const mk = (sp, num, cs, acc) => opts.makeRig({ sp: sp, num: num, cs: cs, look: { acc: acc } }, team, opts.q);
      const M = (rig, o) => Object.assign({ rig: rig, x: 0, z: 0, y: 0, fa: Math.PI, role: 'idle' }, o);
      if (mode === 'title') {
        cast = [
          M(mk(cur.sp || 'frog', 1, 0, null), { x: 1.5, z: 8.5, fa: Math.PI - 0.35, role: 'mascot', big: 2.3 }),
          M(mk(others[0], 12, 0, null), { x: -5.5, z: -6, role: 'passA' }),
          M(mk(others[1], 88, 1, 'band'), { x: 5.5, z: -2, role: 'passB' }),
          M(mk(others[2], 23, 0, 'shades'), { role: 'jog', cx: 0, cz: 1, rx: 8, rz: 11, spd: 0.45 })
        ];
      } else if (mode === 'hq') {
        cast = [
          M(mk(cur.sp || 'frog', 1, 0, null), { x: 0, z: 9.5, fa: Math.PI - 0.2, role: 'wave', big: 2.4 }),
          M(mk(others[3], 7, 0, null), { role: 'jog', cx: 0, cz: -4, rx: 4.2, rz: 6.5, spd: 0.55 }),
          M(mk(others[4], 34, 1, 'cap'), { x: 10.5, z: 9.5, fa: Math.PI + 0.5, role: 'idle' })
        ];
      } else if (mode === 'draft') {
        cast = [
          M(mk(others[5], 0, 0, null), { x: -4.8, z: -4.5, y: 2.2, role: 'prospect', ph: 0 }),
          M(mk(others[6], 0, 1, null), { x: 0, z: -4.5, y: 2.8, role: 'prospect', ph: 1.3 }),
          M(mk(others[7], 0, 0, 'shades'), { x: 4.8, z: -4.5, y: 1.9, role: 'prospect', ph: 2.6 }),
          M(mk(cur.sp || 'frog', 1, 0, null), { x: -6.5, z: 8.8, fa: Math.PI + 0.3, role: 'wave', big: 2.2 })
        ];
      } else {
        cast = [
          M(mk(cur.sp || 'frog', 1, 0, null), { x: 2, z: 8.5, fa: Math.PI - 0.25, role: 'wave', big: 2.3 }),
          M(mk(others[8], 21, 0, null), { x: -9, z: -1.6, fa: 0, role: 'idle' }),
          M(mk(others[9], 55, 1, 'band'), { x: 0.6, z: -3.1, fa: 0.2, role: 'idle' }),
          M(mk(others[10], 9, 0, 'bow'), { role: 'walk', x0: -12, x1: 12, z: 2.6, spd: 2.2 })
        ];
      }
      cast.forEach((c) => { c.st = R.Animate.state(); c.P = V.newPose(); c.e = { an: 'idle', at: -1, spd: 0, z: 0, ball: false }; });
      // spotlight cones over the podiums
      if (mode === 'draft') for (let i = 0; i < 3; i++) { m.makeTranslation(-4.8 + i * 4.8, 15, -4.5); cones.setMatrixAt(i, m); }
      cones.instanceMatrix.needsUpdate = true;
    }

    const m = new T.Matrix4(), m2 = new T.Matrix4(), qq = new T.Quaternion(), v = new T.Vector3(), sv = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const ballQ = new T.Quaternion(), hv = new T.Vector3(), eul = new T.Euler();
    let tossT = 0;
    setTeam(opts.backdrop);

    // camera presets per mode (landscape only): [base angle, drift, distance, height factor, look y, look z]
    const CAMS = { title: [0.3, 0.42, 60, 0.6, -1, 0], hq: [0.55, 0.25, 70, 0.62, 0, -1], draft: [0.05, 0.14, 56, 0.42, 3, -3], market: [-0.45, 0.2, 58, 0.55, 1, -2] };

    return {
      scene: scene, cam: cam,
      setTeam: setTeam,
      setMode(md) { if (md && md !== mode) setTeam({ mode: md }); },
      mode() { return mode; },
      update(dt, time, aspect) {
        const cp = CAMS[mode] || CAMS.title;
        const ang = cp[0] + Math.sin(time * 0.12) * cp[1];
        const dist = cp[2];
        cam.fov = 30;
        void aspect;
        cam.position.set(Math.sin(ang) * dist * 0.78, dist * cp[3], Math.cos(ang) * dist * 0.78);
        cam.lookAt(0, cp[4], cp[5]);
        scene.fog.near = dist * 1.15; scene.fog.far = dist * 2.8;
        cam.updateProjectionMatrix();
        tossT += dt;
        const period = 1.6, ph = (tossT % (period * 2)) / period;
        const k = ph % 1;
        let A = null, B = null;
        batch.begin(); shadows.begin();
        for (let i = 0; i < cast.length; i++) {
          const c = cast[i];
          let an = 'idle', at = -1, x = c.x, z = c.z, fa = c.fa, spd = 0;
          if (c.role === 'passA' || c.role === 'passB') {
            const thrower = (ph < 1) === (c.role === 'passA');
            const o = cast[c.role === 'passA' ? 2 : 1];
            fa = Math.atan2(-(o.x - c.x), -(o.z - c.z));
            if (thrower) { an = k < 0.35 ? 'throw' : 'idle'; at = k * period; A = c; } else { an = k > 0.7 ? 'catch' : 'stance'; at = (k - 0.7) * period; B = c; }
          } else if (c.role === 'mascot') {
            const cyc = time % 7; an = cyc > 5.3 ? 'celebrate' : 'idle'; at = cyc - 5.3;
          } else if (c.role === 'jog') {
            const a = time * c.spd;
            x = c.cx + Math.cos(a) * c.rx; z = c.cz + Math.sin(a) * c.rz;
            fa = Math.atan2(Math.sin(a) * c.rx, -Math.cos(a) * c.rz);
            an = 'run'; spd = 4.5;
          } else if (c.role === 'walk') {
            const span = c.x1 - c.x0, t2 = (time * c.spd) % (span * 2);
            const fwd = t2 < span;
            x = fwd ? c.x0 + t2 : c.x1 - (t2 - span);
            fa = fwd ? -Math.PI / 2 : Math.PI / 2;
            an = 'run'; spd = 2.2;
          } else if (c.role === 'prospect') {
            const cyc = (time + c.ph * 2) % 6; an = cyc > 4.8 ? 'celebrate' : 'idle'; at = cyc - 4.8;
          }
          c.e.an = an; c.e.at = at >= 0 ? at : -1; c.e.spd = spd; c.e.ball = false;
          R.Animate.pose(c.P, c.e, c.st, c.rig.info, dt);
          if (c.role === 'wave') { c.P.arz = -2.55 + Math.sin(time * 9) * 0.35; c.P.arx = 0.15; c.P.hrz = Math.sin(time * 2) * 0.08; }
          const s3 = c.rig.scale * (c.big || 1.25);
          qq.setFromAxisAngle(up, fa);
          m.compose(v.set(x, c.y || 0, z), qq, sv.set(s3, s3, s3));
          V.poseRig(c.rig, c.P, m, batch, shadows);
          c.wx = x; c.wz = z;
        }
        if (A && B) {
          const hA = V.handPos(A.rig, hv);
          const bx = A.wx + (B.wx - A.wx) * k, bz = A.wz + (B.wz - A.wz) * k, by = 2.2 + Math.sin(k * Math.PI) * 4.5;
          const yaw = Math.atan2(-(B.wx - A.wx), -(B.wz - A.wz));
          qq.setFromEuler(eul.set(Math.cos(k * Math.PI) * 0.6, yaw, 0, 'YXZ'));
          ballQ.setFromAxisAngle(sv.set(0, 0, 1), time * 14); qq.multiply(ballQ);
          const bpos = k < 0.06 ? hA : v.set(bx, by, bz);
          m.compose(bpos, qq, sv.set(0.3, 0.3, 0.52));
          batch.add(m, 0.55, 0.29, 0.16);
          m2.multiplyMatrices(shadows.proj, m);
          shadows.add(m2, 1, 1, 1);
        }
        batch.end(); shadows.end();
        if (fans) {
          const cyc = time % 6;
          fans.update(time, cyc < 1.6 ? 0.8 * (1 - cyc / 1.6) : 0, true, 0.6);
        }
        if (mode === 'draft') {
          for (let i = 0; i < 3; i++) {
            m.makeRotationZ(Math.sin(time * 0.7 + i * 2) * 0.12);
            m.setPosition(-4.8 + i * 4.8, 15, -4.5);
            cones.setMatrixAt(i, m);
          }
          cones.instanceMatrix.needsUpdate = true;
        }
        const bob = Math.sin(time * 0.8) * 0.4;
        island.position.y = islandShadow.position.y = batch.mesh.position.y = shadows.mesh.position.y = cones.position.y = bob;
        if (fans) fans.batch.mesh.position.y = bob;
        deco.position.x = Math.sin(time * 0.05) * 4;
      },
      dispose() {
        if (fans) { scene.remove(fans.batch.mesh); fans.dispose(); }
        objs.forEach((o) => { scene.remove(o); if (o.geometry && o.geometry !== V.unitBox()) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        shadowMat.dispose(); fanMat.dispose(); matV.dispose();
      }
    };
  };

  /** small voxel goalpost (P = prop adder) */
  function goalpost(P, x, z, pri, s) {
    const Y = 0xFFD23F;
    P(x, 0.8 * s, z, 0.6 * s, 1.6 * s, 0.6 * s, pri);
    P(x, 2.1 * s, z, 0.3 * s, 1.2 * s, 0.3 * s, Y);
    P(x, 2.75 * s, z - 0.6 * s, 0.3 * s, 0.3 * s, 1.5 * s, Y);
    P(x, 2.9 * s, z - 1.3 * s, 5.2 * s, 0.3 * s, 0.3 * s, Y);
    P(x - 2.5 * s, 4.6 * s, z - 1.3 * s, 0.3 * s, 3.6 * s, 0.3 * s, Y);
    P(x + 2.5 * s, 4.6 * s, z - 1.3 * s, 0.3 * s, 3.6 * s, 0.3 * s, Y);
  }
  /** voxel house / shop by climate */
  function house(P, G, x, z, w, h, d, wall, roof, warm, snow) {
    P(x, h / 2, z, w, h, d, wall);
    if (warm) { P(x, h + 0.2, z, w + 0.3, 0.4, d + 0.3, roof); P(x - w / 4, h + 0.7, z, 1, 0.6, 1, 0xf2d5a0); }
    else {
      P(x, h + 0.35, z, w + 0.5, 0.7, d + 0.5, roof);
      P(x, h + 0.95, z, w - 0.6, 0.6, d - 0.6, roof);
      P(x, h + 1.45, z, w - 1.8, 0.45, d - 1.6, roof);
      if (!snow) P(x + w / 4, h + 1.4, z - d / 4, 0.5, 1.2, 0.5, 0x9a5a3a);
    }
    G(x, 0.75, z + d / 2 + 0.03, 0.8, 1.5, 0.08, 0x7a4e2d);
    G(x - w / 2 + 0.8, h * 0.6, z + d / 2 + 0.03, 0.7, 0.7, 0.06, 0x9fd8ff);
    G(x + w / 2 - 0.8, h * 0.6, z + d / 2 + 0.03, 0.7, 0.7, 0.06, 0x9fd8ff);
  }
})(globalThis.PT = globalThis.PT || {});
