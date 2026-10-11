/* Pixel Touchdown: js/render/field.js
 * Owner: WP4. Responsibility: field CanvasTexture (stripes, numbers, hashes), endzones, goalposts.
 *
 *   R.Field.build(ctx)   → { mesh, setLight(lx,ly,lz,udir), dispose }   field plane + goalposts + pylons (+ baked shadows)
 *   R.Field.overlay(ctx) → { update(snap, alpha, dt, time, g), dispose }  dynamic field paint:
 *       LOS (blue) / line to gain (yellow) voxel strips, presnap route lines, aim arc + landing circle (σ),
 *       FG kick preview, Star defender gold ring + timing ring states, controlled-player marker, open-receiver rings.
 * Field space → world: wx = x − 26.667, wz = 60 − y.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const F = R.Field = R.Field || {};
  const T = globalThis.THREE;
  const W = 53.333, L = 120, MIDX = 26.667;

  F.GRASS = ['#93d65c', '#84ca4f'];

  function hex(c) { return R.Voxel.hexStr(c); }

  // ---------------------------------------------------------------------------------------------
  // Field texture
  // ---------------------------------------------------------------------------------------------
  function paint(cv, ctx, udir) {
    const g = cv.getContext('2d');
    const pw = cv.width, ph = cv.height;
    const sx = pw / W, sy = ph / L;
    const X = (x) => x * sx, Y = (y) => (L - y) * sy;
    const wx = ctx.wx.k;
    const home = ctx.home || {}, away = ctx.away || {};
    // grass stripes (5 yd) + subtle 1-yd tile checker (toy tiles)
    for (let y = 0; y < L; y += 5) {
      const i = Math.floor(y / 5);
      g.fillStyle = F.GRASS[i % 2];
      g.fillRect(0, Y(y + 5), pw, 5 * sy + 1);
    }
    g.globalAlpha = 0.045;
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < 54; x++) {
        const n = ((x * 73856093) ^ (y * 19349663)) & 7;
        if (n < 3) { g.fillStyle = n === 0 ? '#ffffff' : '#1e4d10'; g.fillRect(X(x), Y(y + 1), sx + 0.5, sy + 0.5); }
      }
    }
    g.globalAlpha = 1;
    // end zones
    const ez = (y0, team, flip) => {
      const pri = team.col ? team.col.pri : 0x3a6fd8, sec = team.col ? team.col.sec : 0xffffff;
      g.fillStyle = hex(pri);
      g.fillRect(0, Y(y0 + 10), pw, 10 * sy + 1);
      // diagonal toy stripes
      g.save();
      g.beginPath(); g.rect(0, Y(y0 + 10), pw, 10 * sy); g.clip();
      g.fillStyle = hex(R.Voxel.shade(pri, 0.9));
      for (let k = -12; k < 70; k += 3) {
        g.beginPath();
        g.moveTo(X(k), Y(y0)); g.lineTo(X(k + 1.5), Y(y0)); g.lineTo(X(k + 11.5), Y(y0 + 10)); g.lineTo(X(k + 10), Y(y0 + 10));
        g.fill();
      }
      g.restore();
      // team name in secondary
      const name = String(team.name || team.abbr || 'HOME').toUpperCase();
      g.save();
      g.translate(X(MIDX), Y(y0 + 5));
      if (flip) g.rotate(Math.PI);
      let fs = 6.2 * sy;
      g.font = '900 ' + fs + 'px "Arial Black", "Arial Rounded MT Bold", Impact, sans-serif';
      const tw = g.measureText(name).width;
      const maxW = 44 * sx;
      if (tw > maxW) { fs *= maxW / tw; g.font = '900 ' + fs + 'px "Arial Black", "Arial Rounded MT Bold", Impact, sans-serif'; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = fs * 0.22;
      g.strokeStyle = hex(R.Voxel.shade(pri, 0.62));
      g.strokeText(name, 0, fs * 0.06);
      g.fillStyle = hex(sec);
      g.fillText(name, 0, 0);
      g.restore();
    };
    // the end zone each team ATTACKS shows the opponent's name: home attacks +y in Q1 → away paints 110..120
    ez(0, home, udir < 0);
    ez(110, away, udir < 0);
    // lines
    g.fillStyle = '#ffffff';
    const line = (y, w) => g.fillRect(0, Y(y) - w * sy / 2, pw, w * sy);
    for (let y = 15; y <= 105; y += 5) line(y, 0.16);
    line(10, 0.32); line(110, 0.32);
    // sidelines / end lines
    g.fillRect(0, 0, 0.45 * sx, ph); g.fillRect(pw - 0.45 * sx, 0, 0.45 * sx, ph);
    g.fillRect(0, 0, pw, 0.45 * sy); g.fillRect(0, ph - 0.45 * sy, pw, 0.45 * sy);
    // yard ticks: along the sidelines and the two hash columns
    for (let y = 11; y < 110; y++) {
      if (y % 5 === 0) continue;
      g.fillRect(X(0.6), Y(y) - 0.06 * sy, 0.7 * sx, 0.12 * sy);
      g.fillRect(X(W - 1.3), Y(y) - 0.06 * sy, 0.7 * sx, 0.12 * sy);
      g.fillRect(X(23.58) - 0.35 * sx, Y(y) - 0.06 * sy, 0.7 * sx, 0.12 * sy);
      g.fillRect(X(29.75) - 0.35 * sx, Y(y) - 0.06 * sy, 0.7 * sx, 0.12 * sy);
    }
    // blocky voxel yard numbers (3×5 pixel font), upright for the camera (repainted when udir flips)
    const FONT = R.Models.FONT;
    const pix = 0.5;
    const digit = (d, cx, cy) => {
      // cx, cy = field coords of the glyph center; glyph is upright when viewed with udir
      const gl = FONT[d];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (gl[r][c] !== '1') continue;
        const lx = (c - 1) * pix * udir, ly = (2 - r) * pix * udir;
        const x = cx + lx, y = cy + ly;
        g.fillRect(X(x - pix / 2) - 0.5, Y(y + pix / 2) - 0.5, pix * sx + 1, pix * sy + 1);
      }
    };
    for (let yl = 20; yl <= 100; yl += 10) {
      const n = yl <= 60 ? yl - 10 : 110 - yl;
      const s = String(n);
      const ny = yl - 2.2 * udir;                     // just "below" the line from the camera
      [7, W - 7].forEach((cx) => {
        for (let k = 0; k < s.length; k++) digit(s[k], cx + (k - (s.length - 1) / 2) * 4 * pix * udir, ny);
        if (n !== 50) {
          const dirY = yl < 60 ? -1 : 1;
          const ax = cx - (s.length * 2 + 1.2) * pix * udir * (yl < 60 ? 1 : 1) * 0 + (cx < MIDX ? -1 : 1) * (s.length * 2 * pix + 0.9) * 1;
          g.beginPath();
          g.moveTo(X(ax), Y(ny + dirY * 0.7)); g.lineTo(X(ax - 0.5), Y(ny - dirY * 0.2)); g.lineTo(X(ax + 0.5), Y(ny - dirY * 0.2)); g.closePath(); g.fill();
        }
      });
    }
    // midfield badge: home colors + short name
    const hc = home.col || { pri: 0x3a6fd8, sec: 0xffffff };
    g.save();
    g.translate(X(MIDX), Y(60));
    if (udir < 0) g.rotate(Math.PI);
    const rr = 3.6 * sx;
    g.fillStyle = hex(hc.pri);
    g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.fill();
    g.lineWidth = 0.45 * sx; g.strokeStyle = hex(hc.sec);
    g.beginPath(); g.arc(0, 0, rr - 0.6 * sx, 0, Math.PI * 2); g.stroke();
    g.fillStyle = hex(hc.sec);
    g.font = '900 ' + (2.3 * sy) + 'px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(home.abbr || 'PT').toUpperCase().slice(0, 3), 0, 0.1 * sy);
    g.restore();
    // weather paint
    if (wx === 'snow') {
      g.globalAlpha = 0.5;
      for (let i = 0; i < 1400; i++) {
        const x = Math.random() * W, y = Math.random() * L, r = 0.3 + Math.random() * 0.9;
        g.fillStyle = Math.random() < 0.7 ? '#ffffff' : '#e9f3ff';
        g.fillRect(X(x), Y(y), r * sx, r * sy * 0.8);
      }
      g.globalAlpha = 0.3; g.fillStyle = '#ffffff'; g.fillRect(0, 0, pw, ph);
      g.globalAlpha = 0.85; for (let i = 0; i < 26; i++) { g.fillRect(0, Y(i * 4.6 + Math.random() * 3), (0.6 + Math.random() * 1.6) * sx, (1 + Math.random() * 3) * sy); g.fillRect(pw - (0.6 + Math.random() * 1.6) * sx, Y(i * 4.6 + Math.random() * 3), 3 * sx, (1 + Math.random() * 3) * sy); }
      g.globalAlpha = 1;
    } else if (wx === 'rain') {
      g.globalAlpha = 0.12; g.fillStyle = '#1d3b5a'; g.fillRect(0, 0, pw, ph);
      g.globalAlpha = 0.3; g.fillStyle = '#7fa8c8';
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * W, y = 8 + Math.random() * (L - 16);
        g.beginPath(); g.ellipse(X(x), Y(y), (1 + Math.random() * 2.2) * sx, (0.6 + Math.random()) * sy, 0, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  /** @param {Object} ctx render context from renderer.loadGame */
  F.build = function (ctx) {
    const q = ctx.q;
    const cv = document.createElement('canvas');
    // field texture: 2048 × 4096 on med/high (≈38 px/yd across, 34 px/yd along), mipmapped + max anisotropy
    const maxTex = ctx.gl.capabilities.maxTextureSize || 4096;
    cv.width = Math.min(q.tex, maxTex); cv.height = Math.min(maxTex, q.tex * 2);
    let udir = 1;
    paint(cv, ctx, udir);
    const tex = new T.CanvasTexture(cv);
    tex.anisotropy = Math.min(q.aniso || 1, ctx.gl.capabilities.getMaxAnisotropy());
    tex.generateMipmaps = true;
    tex.minFilter = T.LinearMipmapLinearFilter;
    const mat = new T.MeshLambertMaterial({ map: tex });
    const geo = new T.PlaneGeometry(W, L);
    geo.rotateX(-Math.PI / 2);
    const mesh = new T.Mesh(geo, mat);
    mesh.position.set(0, 0, 0);
    mesh.renderOrder = 0;
    ctx.scene.add(mesh);

    // goalposts + pylons (merged) and their baked planar shadows
    // goalposts + pylons: one mesh per end (each fades when the camera sits behind that end), baked shadows
    const postMats = [new T.MeshLambertMaterial({ vertexColors: true }), new T.MeshLambertMaterial({ vertexColors: true })];
    const posts = [null, null], postA = [1, 1];
    let shadow = null;
    const shadowMat = R._shadowMaterial();
    function mkEnd(b, k) {
      const y = k === 0 ? 0 : 120;
      const s = y === 0 ? 1 : -1;
      const z = 60 - y - s * 0.4;           // just past the end line
      const Y = 0xFFD23F, Yd = 0xF2B705;
      b.box(0, 0.9, z, 0.9, 1.8, 0.9, ctx.cols[y === 0 ? 0 : 1].pri);   // padded base
      b.box(0, 2.4, z, 0.4, 1.4, 0.4, Y);
      b.box(0, 3.1, z + s * 0.9, 0.4, 0.4, 2.2, Y);                       // gooseneck
      b.box(0, 3.33, z + s * 1.9, 6.2, 0.36, 0.36, Y);                     // crossbar
      b.box(-3.08, 5.6, z + s * 1.9, 0.36, 4.6, 0.36, Y);
      b.box(3.08, 5.6, z + s * 1.9, 0.36, 4.6, 0.36, Y);
      b.box(-3.08, 8.0, z + s * 1.9, 0.5, 0.3, 0.5, Yd);
      b.box(3.08, 8.0, z + s * 1.9, 0.5, 0.3, 0.5, Yd);
      b.box(-3.08, 7.6, z + s * 1.9, 0.12, 0.6, 0.12, 0xE63B2E);          // wind ribbons
      b.box(3.08, 7.6, z + s * 1.9, 0.12, 0.6, 0.12, 0xE63B2E);
      // pylons at this end's 4 corners
      (k === 0 ? [10, 0] : [110, 120]).forEach((yy) => [0.25, W - 0.25].forEach((x) => b.box(x - MIDX, 0.5, 60 - yy, 0.36, 1.0, 0.36, 0xFF7B1C)));
      return b;
    }
    function buildProps(lx, ly, lz) {
      for (let k = 0; k < 2; k++) {
        if (posts[k]) { ctx.scene.remove(posts[k]); posts[k].geometry.dispose(); }
        posts[k] = new T.Mesh(mkEnd(R.Voxel.builder(), k).geometry(), postMats[k]);
        posts[k].renderOrder = 2;
        ctx.scene.add(posts[k]);
      }
      if (shadow) { ctx.scene.remove(shadow); shadow.geometry.dispose(); }
      const sb = R.Voxel.builder(); mkEnd(sb, 0); mkEnd(sb, 1);
      shadow = new T.Mesh(sb.flatten(lx, ly, lz, 0.05).geometry(), shadowMat);
      shadow.renderOrder = 1;
      ctx.scene.add(shadow);
    }
    buildProps(0.55, -1, -0.42);

    return {
      mesh: mesh,
      setLight(lx, ly, lz, ud) {
        buildProps(lx, ly, lz);
        if (ud && ud !== udir) { udir = ud; paint(cv, ctx, udir); tex.needsUpdate = true; }
      },
      /** occlusion fade: the goalpost at the end the camera sits behind turns see-through */
      fade(cam, dt) {
        const cz = cam.position.z;
        for (let k = 0; k < 2; k++) {
          const behind = k === 0 ? (cz - 50) / 12 : (-cz - 50) / 12;
          const want = behind > 0 ? Math.max(0.15, 1 - Math.min(1, behind) * 0.85) : 1;
          postA[k] += (want - postA[k]) * Math.min(1, dt * 6);
          const m = postMats[k], f = postA[k] < 0.98;
          if (m.transparent !== f) { m.transparent = f; m.depthWrite = !f; m.needsUpdate = true; }
          m.opacity = f ? postA[k] : 1;
        }
      },
      dispose() {
        ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); tex.dispose();
        for (let k = 0; k < 2; k++) if (posts[k]) { ctx.scene.remove(posts[k]); posts[k].geometry.dispose(); }
        if (shadow) { ctx.scene.remove(shadow); shadow.geometry.dispose(); }
        postMats[0].dispose(); postMats[1].dispose(); shadowMat.dispose();
      }
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Dynamic overlays
  // ---------------------------------------------------------------------------------------------
  const STAR = ['00100', '11111', '01110', '01010', '10001'];
  const ARROW = ['11111', '01110', '00100'];

  /** true when the engine sends ents[i].star (STAR_ABILITIES) */
  function ents0Star(s) { return !!(s.ents && s.ents[0] && s.ents[0].star !== undefined); }

  F.overlay = function (ctx) {
    const scene = ctx.scene;
    // opaque unlit boxes: strips, arcs, markers
    const boxMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const ob = R.Voxel.batch(900, boxMat);
    ob.mesh.renderOrder = 3;
    scene.add(ob.mesh);
    // translucent route dashes (opacity = route alpha)
    const rMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
    const rb = R.Voxel.batch(600, rMat);
    rb.mesh.renderOrder = 3;
    scene.add(rb.mesh);
    // rings (flat)
    const ringGeo = new T.RingGeometry(0.78, 1, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false, side: T.DoubleSide });
    const rings = R.Voxel.batch(48, ringMat, ringGeo);
    rings.mesh.renderOrder = 4;
    scene.add(rings.mesh);
    // additive glow (Star markers)
    const glowMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending });
    const gb = R.Voxel.batch(300, glowMat);
    gb.mesh.renderOrder = 6;
    scene.add(gb.mesh);
    // "mine" base discs under the user team's players
    const baseGeo = new T.CircleGeometry(1, 28);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    const bases = R.Voxel.batch(16, baseMat, baseGeo);
    bases.mesh.renderOrder = 3;
    scene.add(bases.mesh);
    // landing disc
    const discGeo = new T.CircleGeometry(1, 32);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    const disc = new T.Mesh(discGeo, discMat);
    disc.renderOrder = 3;
    disc.visible = false;
    scene.add(disc);

    const m = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    let routeT = 0, routeKey = null, lastPhase = '';
    const ctlT = new Float32Array(16), ctlPrev = new Uint8Array(16);
    // team badge color = kit jersey (or helmet when the jersey is white)
    const badge = (kit, col) => { const k = kit || col; const c = R.Voxel.lum(k.pri) > 225 && k.helm != null ? k.helm : k.pri; return R.Voxel.rgb(c); };
    const teamRGB = [badge(ctx.kits && ctx.kits[0], ctx.cols[0]), badge(ctx.kits && ctx.kits[1], ctx.cols[1])];
    // base disc fill = jersey color (lightened when very dark) + outline in the helmet color
    const discFill = (kit, col) => { const k = kit || col; let c = k.pri; if (R.Voxel.lum(c) < 80) c = R.Voxel.mix(c, 0xffffff, 0.4); return R.Voxel.rgb(c); };
    const discLine = (kit, col) => { const k = kit || col; return R.Voxel.rgb(k.helm != null ? k.helm : k.pri); };
    const fillRGB = [discFill(ctx.kits && ctx.kits[0], ctx.cols[0]), discFill(ctx.kits && ctx.kits[1], ctx.cols[1])];
    const lineRGB = [discLine(ctx.kits && ctx.kits[0], ctx.cols[0]), discLine(ctx.kits && ctx.kits[1], ctx.cols[1])];

    const C = {
      los: [0.24, 0.65, 1], fd: [1, 0.88, 0.3], white: [1, 1, 1], gold: [1, 0.8, 0.15], green: [0.3, 1, 0.42],
      red: [1, 0.36, 0.3], redStar: [1, 0.16, 0.12], redGlow: [0.8, 0.08, 0.04], goldGlow: [0.7, 0.5, 0.08], dark: [0.12, 0.13, 0.18], ctl: [1, 1, 1], open: [0.35, 1, 0.5], route: [1, 1, 1], yel: [1, 0.86, 0.2], block: [0.72, 0.84, 1]
    };

    function strip(y, col, h) {
      const wz = 60 - y;
      for (let x = 0; x < 53; x += 1) ob.addBox(x + 0.5 - MIDX + 0.17, h, wz, 0.92, 0.06, 0.34, col[0], col[1], col[2]);
    }
    function ring(x, y, r, col, h) {
      m.compose(v.set(x - MIDX, h || 0.07, 60 - y), q.identity(), sc.set(r, 1, r));
      rings.add(m, col[0], col[1], col[2]);
    }
    function sprite(pat, wx, wy, wz, px, col, yaw, batch) {
      // a flat pixel pattern standing up, facing the camera yaw
      const bt = batch || ob;
      const rows = pat.length, cols = pat[0].length;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        if (pat[r][k] !== '1') continue;
        const lx = (k - (cols - 1) / 2) * px, ly = ((rows - 1) / 2 - r) * px;
        bt.addBox(wx + lx * c, wy + ly, wz - lx * s, px, px, px * 0.6, col[0], col[1], col[2], yaw);
      }
    }
    /** Star markers (STAR_ABILITIES 4–6): 1 my Star (gold, glows when the meter is full), 2 enemy Star about to act
     *  (red, pulsing glow + red ring), 3 ability active (bright pulse) */
    function starMarker(s, e, hp, x, y, r, time, yaw) {
      const k = e.star;
      const bob = 0.12 * Math.sin(time * 3 + e.id);
      if (k === 1) {
        const side = e.tm === s.poss ? 'off' : 'def';
        const mt = s.meters ? (s.meters.u ? s.meters.u[side] : s.meters[side]) || 0 : 0;
        const full = mt >= 100;
        const px = full ? 0.17 : 0.13;
        sprite(STAR, hp.x, hp.y + 1.5 + bob, hp.z, px, C.gold, yaw);
        if (full) sprite(STAR, hp.x, hp.y + 1.5 + bob, hp.z - 0.05, px * (1.7 + 0.25 * Math.sin(time * 6)), C.goldGlow, yaw, gb);
      } else if (k === 2) {
        const pu = 1 + 0.25 * Math.sin(time * 9);
        sprite(STAR, hp.x, hp.y + 1.2 + bob, hp.z, 0.2 * pu, C.redStar, yaw);
        sprite(STAR, hp.x, hp.y + 1.2 + bob, hp.z - 0.05, 0.2 * pu * 1.9, C.redGlow, yaw, gb);
        ring(x, y, r + 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(time * 9)), C.redStar, 0.076);
      } else if (k === 3) {
        if (String(e.pos || '').indexOf('OL') === 0) {
          // Pancake: impact rings pulsing out from the block
          for (let j = 0; j < 2; j++) { const kk = ((time * 1.8) + j * 0.5) % 1; ring(x, y, r + 0.3 + 2.4 * kk, j ? C.white : C.gold, 0.079 + j * 0.001); }
        }
        const pu = 1 + 0.3 * Math.abs(Math.sin(time * 14));
        sprite(STAR, hp.x, hp.y + 1.3 + bob, hp.z, 0.22 * pu, C.white, yaw);
        sprite(STAR, hp.x, hp.y + 1.3 + bob, hp.z - 0.05, 0.22 * pu * 2.1, C.goldGlow, yaw, gb);
        const kk = (time * 2.2) % 1;
        ring(x, y, r + 0.2 + 1.6 * kk, C.gold, 0.078);
      }
    }
    function dashLine(b, x0, y0, x1, y1, col, dash, gap, w) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len < 0.05) return;
      const ux = dx / len, uy = dy / len;
      const yaw = Math.atan2(-ux, uy);           // box depth axis along the segment (world −z = +y)
      for (let d = 0; d < len; d += dash + gap) {
        const l = Math.min(dash, len - d);
        const cx = x0 + ux * (d + l / 2), cy = y0 + uy * (d + l / 2);
        b.addBox(cx - MIDX, 0.06, 60 - cy, w, 0.05, l, col[0], col[1], col[2], yaw);
      }
    }
    function arrowHead(b, x, y, ux, uy, col) {
      for (let k = -1; k <= 1; k += 2) {
        const an = k * 0.6, ca = Math.cos(an), sa = Math.sin(an);
        const dx = ux * ca - uy * sa, dy = ux * sa + uy * ca;
        const cx = x - dx * 0.42, cy = y - dy * 0.42;
        b.addBox(cx - MIDX, 0.065, 60 - cy, 0.26, 0.05, 0.95, col[0], col[1], col[2], Math.atan2(dx, -dy));
      }
    }

    function routes(s, dt) {
      const list = s.routes || (s.dbg && s.dbg.routes);
      rb.begin();
      if (!list || !list.length || (s.phase !== 'PRESNAP' && s.phase !== 'CALL' && !s.routesLive)) {
        if (s.phase === 'LIVE') routeKey = null;
        rb.end(); return;
      }
      if (list !== routeKey || (lastPhase !== 'PRESNAP' && s.phase === 'PRESNAP')) { routeKey = list; routeT = 0; }
      routeT += dt;
      // 1.5 s full, then 30% (engine may override with s.routeA)
      const a = s.routeA != null ? s.routeA : (routeT < 1.5 ? 1 : Math.max(0.3, 1 - (routeT - 1.5) * 2));
      rMat.opacity = a * Math.min(1, routeT * 4);
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r && r.on === false) continue;
        const pts = Array.isArray(r) ? r : (r && r.pts) || null;
        const n = Array.isArray(r) ? pts && pts.length : (r && r.n ? r.n * 2 : pts && pts.length);
        if (!pts || n < 4) continue;
        const col = (r && r.hot) ? C.yel : (r && r.k === 'block') ? C.block : C.route;
        const w = (r && r.hot) ? 0.3 : 0.24;
        for (let k = 0; k + 3 < n; k += 2) dashLine(rb, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], col, r && r.k === 'block' ? 0.4 : 0.7, 0.45, w);
        const ux = pts[n - 2] - pts[n - 4], uy = pts[n - 1] - pts[n - 3], ul = Math.hypot(ux, uy) || 1;
        if (r && r.k === 'block') rb.addBox(pts[n - 2] - MIDX, 0.065, 60 - pts[n - 1], 0.9, 0.05, 0.26, col[0], col[1], col[2], Math.atan2(ux / ul, -uy / ul));
        else arrowHead(rb, pts[n - 2], pts[n - 1], ux / ul, uy / ul, col);
      }
      rb.end();
    }

    function aim(s, g, time) {
      const a = s.aim;
      disc.visible = false;
      if (!a || !a.on) return;
      // from the QB's hand (ball) to the target
      let x0 = s.ball.x, y0 = s.ball.y, z0 = 1.6;
      if (s.ball.car >= 0 && g.hand[s.ball.car]) { const h = g.hand[s.ball.car]; x0 = h.x + MIDX; y0 = 60 - h.z; z0 = h.y; }
      const x1 = a.x, y1 = a.y, apex = a.apex || 3;
      const col = a.ok === false ? C.red : C.white;
      const frac = a.arc != null ? a.arc : 1;
      const N = 26;
      const off = (time * 1.6) % 1;
      for (let i = 0; i < N * frac; i++) {
        const t = (i + off) / N;
        if (t > frac) break;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const z = z0 + (1.2 - z0) * t + 4 * (apex - Math.max(z0, 1.2) * 0.5) * t * (1 - t);
        const sz = 0.2 + 0.08 * Math.sin(t * Math.PI);
        ob.addBox(x - MIDX, z, 60 - y, sz, sz, sz, col[0], col[1], col[2]);
      }
      const sig = Math.max(0.5, a.sig != null ? a.sig : 1.2);
      ring(x1, y1, sig, col, 0.08);
      ring(x1, y1, 0.25, col, 0.08);
      disc.visible = true;
      disc.position.set(x1 - MIDX, 0.065, 60 - y1);
      disc.scale.set(sig, 1, sig);
      discMat.color.setRGB(col[0], col[1], col[2]);
    }

    function kick(s, time) {
      const k = s.kick;
      if (!k || !k.on) return;
      const x0 = s.ball.x, y0 = s.ball.y;
      // colour by the PREDICTED result of the current aim: k.x already includes wind drift (engine K.preview);
      // lateral miss ≤ 2.0 yd green, ≤ 3.08 yd (goal half-width) yellow, else red; too short / out of range → red
      let col;
      if (k.outRange || (k.pow > 0 && k.minPow != null && k.pow < k.minPow)) col = C.red;
      else if (k.x != null) {
        const miss = Math.abs(k.x - MIDX);
        col = miss <= 2.0 ? C.green : miss <= 3.08 ? C.yel : C.red;
      } else {
        const pct = k.pct != null ? k.pct : 50;
        col = pct >= 70 ? C.green : pct >= 40 ? C.yel : C.red;
      }
      const N = 30, off = (time * 1.2) % 1;
      const dist = Math.hypot(k.x - x0, k.y - y0);
      const apex = 3 + dist * 0.12;
      for (let i = 0; i < N; i++) {
        const t = (i + off) / N;
        const x = x0 + (k.x - x0) * t, y = y0 + (k.y - y0) * t;
        const z = 0.3 + 4 * apex * t * (1 - t) + t * 3.3;
        ob.addBox(x - MIDX, z, 60 - y, 0.24, 0.24, 0.24, col[0], col[1], col[2]);
      }
      // target marker at crossbar height
      const tz = 60 - k.y;
      ob.addBox(k.x - MIDX, 3.9, tz, 0.5, 0.5, 0.2, col[0], col[1], col[2]);
      ob.addBox(k.x - MIDX - 0.5, 3.9, tz, 0.3, 0.12, 0.12, 1, 1, 1);
      ob.addBox(k.x - MIDX + 0.5, 3.9, tz, 0.3, 0.12, 0.12, 1, 1, 1);
    }

function starMark(s, e, hp, star, alpha, time, yaw, pulse, noSprite) {
      const ka = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 3 ? 1 : alpha;
          const x = e.px + (e.x - e.px) * ka, y = e.py + (e.y - e.py) * ka;
      const r = (PT.C.SIZES[e.sz] || PT.C.SIZES.M).r * 2.2;
      const ringState = star ? star.ring : 'wait';
      const spin = time * 2.5;
      if (!noSprite) sprite(STAR, hp.x, hp.y + 1.1 + 0.15 * Math.sin(time * 3), hp.z, 0.2, C.gold, yaw + Math.sin(spin) * 0.5);
      if (ringState === 'green') {
        ring(x, y, r + 0.1, C.green, 0.075);
        const k = ((star.t || time) * 2.5) % 1;
        ring(x, y, r + 2.4 * (1 - k), C.green, 0.08);
        ring(x, y, r + 0.45, C.white, 0.075);
      } else if (ringState === 'used') {
        ring(x, y, r, C.white, 0.075);
      } else {
        ring(x, y, r + 0.12 * pulse, C.gold, 0.075);
        if (ringState === 'wait' && s.phase === 'LIVE') {
          const k = (time * 1.3) % 1;
          ring(x, y, r + 1.6 * (1 - k), C.gold, 0.08);
        }
      }
    }

    return {
      update(s, alpha, dt, time, g) {
        ob.begin(); rings.begin(); gb.begin(); bases.begin();
        const userTm = (s.udir || 1) === s.dir ? (s.poss || 0) : 1 - (s.poss || 0);
        const newStars = ents0Star(s);
        // kick context (kickoff incl. onside, punt, FG/XP, 2-pt try and their returns): hide the line to gain (and the
        // LOS while a kick is in the air / returned). Latched until the next scrimmage down is called (CALL/PRESNAP
        // without kick context) so the old marker never flashes between plays.
        const ph = s.phase, bk = s.ball ? s.ball.kind : '';
        const kickPlay = ph === 'KICK' || bk === 'ko' || bk === 'onside' || bk === 'punt';
        const kickCtx = kickPlay || ph === 'HOLD' || ph === 'PAT' || (s.cam && s.cam.mode === 'celebrate') || (s.kick && s.kick.on) || (s.hud && s.hud.two) || bk === 'fg';
        if (kickCtx) g.markHide = true;
        else if (g.markHide && (ph === 'CALL' || ph === 'PRESNAP')) g.markHide = false;
        g.losHide = kickPlay || (s.cam && s.cam.mode === 'celebrate') || (g.markHide && !(ph === 'PAT' || ph === 'HOLD' || (s.kick && s.kick.on) || (s.hud && s.hud.two)));
        if (!g.losHide && s.los != null && s.los > 0) strip(s.los, C.los, 0.03);
        if (!g.markHide && s.fd != null && s.fd > 0 && s.fd < 120 && Math.abs(s.fd - s.los) > 0.01) strip(s.fd, C.fd, 0.03);
        routes(s, dt);
        lastPhase = s.phase;
        const yaw = g.camera ? g.camera.yaw : 0;
        const ents = s.ents;
        const pulse = 0.5 + 0.5 * Math.sin(time * 6);
        for (let i = 0; i < ents.length && i < 16; i++) {
          const e = ents[i];
          // visual position (incl. render-only celebration offsets) from the renderer
          const x = g.vx ? g.vx[i] : e.x, y = g.vy ? g.vy[i] : e.y;
          const r = (PT.C.SIZES[e.sz] || PT.C.SIZES.M).r * 2.1;
          const hp = g.head[i];
          // mine vs theirs: team-colored base disc + outline under my players, thin dark ring under theirs
          if (e.tm === userTm) {
            const fc = fillRGB[e.tm ? 1 : 0], lc = lineRGB[e.tm ? 1 : 0];
            m.compose(v.set(x - MIDX, 0.062, 60 - y), q.identity(), sc.set(r * 0.92, 1, r * 0.92));
            bases.add(m, fc[0], fc[1], fc[2]);
            ring(x, y, r * 0.98, lc, 0.066);
          }
          if (newStars && e.star > 0) starMarker(s, e, hp, x, y, r, time, yaw);
          // control change (handoff, catch, exchange): big bouncing chevron for 0.6 s
          if (e.ctl && !ctlPrev[i]) ctlT[i] = 0.6;
          ctlPrev[i] = e.ctl ? 1 : 0;
          if (ctlT[i] > 0) ctlT[i] = Math.max(0, ctlT[i] - dt);
          if (e.ctl) {
            // thick ring in the team color with a thin white outline (reads on any grass / any species size)
            const tc = teamRGB[e.tm ? 1 : 0];
            ring(x, y, r + 0.2, C.white, 0.07);
            ring(x, y, r, tc, 0.072);
            ring(x, y, r * 0.8, tc, 0.073);
            if (ctlT[i] > 0) {
              const k = 1 - ctlT[i] / 0.6;
              const bounce = Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 1.6;
              sprite(ARROW, hp.x, hp.y + 1.3 + bounce, hp.z, 0.36, C.yel, yaw);
            } else {
              sprite(ARROW, hp.x, hp.y + 1.0 + 0.25 * Math.abs(Math.sin(time * 5)), hp.z, 0.2, C.yel, yaw);
            }
          }
          if (e.hi === 1) {
            ring(x, y, r + 0.3 * pulse, C.open, 0.07);
          }
        }
        // Star defender
        const st = s.star;
        const si = st && st.idx >= 0 ? st.idx : -1;
        for (let i = 0; i < ents.length && i < 16; i++) if (ents[i].hi === 2 && si < 0) starMark(s, ents[i], g.head[i], null, alpha, time, yaw, pulse, newStars);
        if (si >= 0 && ents[si]) starMark(s, ents[si], g.head[si], st, alpha, time, yaw, pulse, newStars);
        aim(s, g, time);
        kick(s, time);
        ob.end(); rings.end(); gb.end(); bases.end();
      },
      dispose() {
        [ob, rb, rings, gb, bases].forEach((b) => { scene.remove(b.mesh); b.dispose(); });
        glowMat.dispose(); baseMat.dispose(); baseGeo.dispose();
        scene.remove(disc);
        boxMat.dispose(); rMat.dispose(); ringMat.dispose(); ringGeo.dispose(); discGeo.dispose(); discMat.dispose();
      }
    };
  };
})(globalThis.PT = globalThis.PT || {});
