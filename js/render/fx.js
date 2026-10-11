/* Pixel Touchdown: js/render/fx.js
 * Owner: WP4. Responsibility: pooled voxel particles (dust, confetti, sparks), screen shake.
 *
 *   R.Fx.create(ctx) → { spawn(fxEntry, snap, g), puff(x,y,z,n,kind), coins(x,y,n), text(txt,x,y,z,col),
 *                        update(dt, g), dispose }
 * Snapshot fx kinds: dust · hit (impact stars + grass chips + shake) · catch (sparkle) · td (burst + text +
 * confetti) · confetti (200 team-color cubes, design 19.4) · fumble · text (floating bouncy text) · coin.
 * One InstancedMesh for every particle (pool size by quality tier), a small pool of text sprites.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const Fx = R.Fx = R.Fx || {};
  const T = globalThis.THREE;
  const MIDX = 26.667;

  const GRASS = [[0.52, 0.8, 0.3], [0.45, 0.72, 0.26], [0.6, 0.45, 0.28]];
  const STARC = [[1, 0.9, 0.25], [1, 1, 1], [1, 0.75, 0.2]];

  /** 3D 'TOUCHDOWN!' text on td fx (off: the UI shows its own banner; the dev sandbox turns it on) */
  Fx.tdText = false;
  /** longer engine texts are left to the UI banners (avoids duplicates and off-screen text) */
  Fx.MAX_TEXT = 12;

  Fx.create = function (ctx) {
    const scene = ctx.scene;
    const N = ctx.q.particles;
    const mat = new T.MeshLambertMaterial({ color: 0xffffff });
    const batch = R.Voxel.batch(N, mat);
    batch.mesh.renderOrder = 5;
    scene.add(batch.mesh);
    // particle state (struct of arrays)
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
    const life = new Float32Array(N), max = new Float32Array(N), size = new Float32Array(N);
    const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N);
    const rot = new Float32Array(N), spin = new Float32Array(N), kind = new Uint8Array(N);   // 0 chip, 1 confetti, 2 spark, 3 coin
    let next = 0;
    const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), s = new T.Vector3();

    // floating text sprites
    const texts = [];
    for (let i = 0; i < 4; i++) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const tex = new T.CanvasTexture(cv);
      const sm = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const sp = new T.Sprite(sm);
      sp.visible = false; sp.renderOrder = 10;
      scene.add(sp);
      texts.push({ cv: cv, tex: tex, mat: sm, sp: sp, t: 0, dur: 1, x: 0, y: 0, z: 0, w: 8 });
    }
    let textNext = 0;

    function alloc() {
      // reuse the oldest slot when full
      const i = next; next = (next + 1) % N;
      return i;
    }
    function emit(x, y, z, vxx, vyy, vzz, lf, sz, c, k) {
      const i = alloc();
      px[i] = x; py[i] = y; pz[i] = z; vx[i] = vxx; vy[i] = vyy; vz[i] = vzz;
      life[i] = lf; max[i] = lf; size[i] = sz; cr[i] = c[0]; cg[i] = c[1]; cb[i] = c[2];
      rot[i] = Math.random() * 6; spin[i] = (Math.random() - 0.5) * 14; kind[i] = k;
    }
    function rgb(hex) { return R.Voxel.rgb(hex); }

    /** grass chips / dust at field (x, y) */
    function puff(x, y, z, n, k) {
      const wx = x - MIDX, wz = 60 - y;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
        const c = k === 'snow' ? [0.95, 0.97, 1] : k === 'splash' ? [0.75, 0.85, 0.95] : GRASS[(Math.random() * GRASS.length) | 0];
        emit(wx, (z || 0) + 0.15, wz, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp, 0.45 + Math.random() * 0.3, 0.12 + Math.random() * 0.1, c, 0);
      }
    }
    function burst(x, y, z, n, cols, speed, k, sz) {
      const wx = x - MIDX, wz = 60 - y;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, el = Math.random() * 1.2, sp = speed * (0.5 + Math.random() * 0.7);
        emit(wx, z, wz, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp + 2, Math.sin(a) * Math.cos(el) * sp, 0.5 + Math.random() * 0.4, sz * (0.7 + Math.random() * 0.6), cols[(Math.random() * cols.length) | 0], k);
      }
    }
    function confetti(x, y, n, cols) {
      const wx = x - MIDX, wz = 60 - y;
      for (let i = 0; i < n; i++) {
        emit(wx + (Math.random() - 0.5) * 18, 6 + Math.random() * 9, wz + (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 2.6 + Math.random() * 1.6, 0.16 + Math.random() * 0.08, cols[(Math.random() * cols.length) | 0], 1);
      }
    }
    function coins(x, y, n) {
      const wx = x - MIDX, wz = 60 - y;
      for (let i = 0; i < n; i++) emit(wx, 1.5, wz, (Math.random() - 0.5) * 3, 6 + Math.random() * 3, (Math.random() - 0.5) * 3, 1.0, 0.45, [1, 0.8, 0.15], 3);
    }
    function text(txt, x, y, z, col, big) {
      const t = texts[textNext]; textNext = (textNext + 1) % texts.length;
      const g = t.cv.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      const str = String(txt || '').toUpperCase();
      let fs = big ? 86 : 70;
      g.font = '900 ' + fs + 'px "Arial Black", Impact, sans-serif';
      const w = g.measureText(str).width;
      if (w > 480) { fs = fs * 480 / w; g.font = '900 ' + fs + 'px "Arial Black", Impact, sans-serif'; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round';
      g.lineWidth = fs * 0.26; g.strokeStyle = '#1b1f3a'; g.strokeText(str, 256, 70);
      g.fillStyle = col || '#ffffff'; g.fillText(str, 256, 64);
      t.tex.needsUpdate = true;
      t.t = 0; t.dur = big ? 1.5 : 1.0; t.x = x - MIDX; t.y = z || 2.5; t.z = 60 - y; t.w = big ? 15 : 9;
      t.sp.visible = true;
    }

    const TRAIL = [1, 1, 1], GOLD = [1, 0.82, 0.2];
    /** white ribbon bit behind a long pass (world coords); gold for Hail Marys */
    function trail(wx, wy, wz, gold) {
      emit(wx, wy, wz, 0, 0.3, 0, 0.32, 0.13, gold ? GOLD : TRAIL, 4);
    }

    // ---- Star abilities (STAR_ABILITIES 6) ----
    const SPARK = [[1, 1, 1], [0.7, 0.9, 1], [1, 0.95, 0.6]], TURBO = [[1, 0.75, 0.15], [1, 0.45, 0.1], [1, 0.95, 0.5]];
    const LASER = [[1, 0.2, 0.2], [0.3, 1, 1], [1, 1, 1]], CHAIN = [[0.78, 0.8, 0.85], [1, 0.82, 0.2]], RED = [[1, 0.2, 0.15], [1, 0.5, 0.3]];
    let abAcc = 0, abKey = '';
    /** 'turbo'|'magnet'|'laser'|'bulldozer'|'lockdown' from any engine spelling */
    function abilityKind(name) {
      const n = String(name || '').toLowerCase();
      if (n.indexOf('turbo') >= 0) return 'turbo';
      if (n.indexOf('magnet') >= 0) return 'magnet';
      if (n.indexOf('laser') >= 0) return 'laser';
      if (n.indexOf('bull') >= 0) return 'bulldozer';
      if (n.indexOf('lock') >= 0) return 'lockdown';
      if (n.indexOf('pancake') >= 0) return 'pancake';
      return n ? 'other' : '';
    }
    function shockwave(wx, wz, n, col) {
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        emit(wx + Math.cos(a) * 0.5, 0.25, wz + Math.sin(a) * 0.5, Math.cos(a) * 9, 1.2, Math.sin(a) * 9, 0.45, 0.24, col[i % col.length], 0);
      }
    }
    /** continuous VFX for the active ability; world position of the player (feet), ball position */
    function abilityTick(name, wx, wy, wz, fa, dt, ballPos, ballAir, started) {
      const k = abilityKind(name);
      abAcc += dt;
      const t = abAcc;
      if (started) {
        if (k === 'bulldozer') { shockwave(wx, wz, 22, GRASS); }
        if (k === 'pancake') { shockwave(wx, wz, 28, GRASS); shockwave(wx, wz, 14, [[1, 1, 1], [0.9, 0.9, 0.85]]); }
        for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28; emit(wx, 1.4, wz, Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3, 0.5, 0.16, STARC[i % 3], 2); }
      }
      if (k === 'turbo') {
        // speed trail: streaks left behind the runner
        const bx = Math.sin(fa) * 0.6, bz = Math.cos(fa) * 0.6;
        for (let i = 0; i < 2; i++) emit(wx + bx + (Math.random() - 0.5) * 0.5, 0.5 + Math.random() * 1.4, wz + bz + (Math.random() - 0.5) * 0.5, 0, 0, 0, 0.28, 0.2, TURBO[(Math.random() * 3) | 0], 4);
      } else if (k === 'magnet') {
        for (let i = 0; i < 2; i++) {
          const a = t * 7 + i * Math.PI;
          emit(wx + Math.cos(a) * 1.1, 1.5 + Math.sin(t * 5 + i) * 0.4, wz + Math.sin(a) * 1.1, 0, 1.2, 0, 0.35, 0.12, SPARK[(Math.random() * 3) | 0], 4);
        }
      } else if (k === 'laser') {
        if (ballAir && ballPos) for (let i = 0; i < 3; i++) emit(ballPos.x + (Math.random() - 0.5) * 0.2, ballPos.y + (Math.random() - 0.5) * 0.2, ballPos.z + (Math.random() - 0.5) * 0.2, 0, 0, 0, 0.3, 0.16, LASER[(Math.random() * 3) | 0], 4);
        else emit(wx + 0.5, 1.8, wz, 0, 0.8, 0, 0.3, 0.1, LASER[(Math.random() * 3) | 0], 4);
      } else if (k === 'bulldozer') {
        emit(wx + (Math.random() - 0.5), 0.15, wz + (Math.random() - 0.5), (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.45, 0.16, GRASS[(Math.random() * 3) | 0], 0);
      } else if (k === 'pancake') {
        if (Math.random() < 0.35) emit(wx + (Math.random() - 0.5) * 1.4, 0.15, wz + (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.4, 0.15, GRASS[(Math.random() * 3) | 0], 0);
      } else if (k === 'lockdown') {
        for (let i = 0; i < 2; i++) {
          const a = t * 4 + i * Math.PI;
          emit(wx + Math.cos(a) * 1.3, 0.9 + 0.4 * Math.sin(a * 2), wz + Math.sin(a) * 1.3, 0, 0, 0, 0.3, 0.15, CHAIN[i], 4);
        }
      } else {
        emit(wx, 1.6, wz, (Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2, 0.35, 0.12, STARC[(Math.random() * 3) | 0], 2);
      }
    }

    // Round 6 Star Surge: every Star with ents[i].star === 3 runs his position's ability VFX
    const surgePrev = new Uint8Array(16);
    function surgeKind(pos) {
      const p = String(pos || '');
      if (p === 'QB') return 'laser';
      if (p === 'RB') return 'turbo';
      if (p.indexOf('WR') === 0 || p === 'TE') return 'magnet';
      if (p.indexOf('OL') === 0) return 'pancake';
      if (p.indexOf('DL') === 0 || p.indexOf('LB') === 0) return 'bulldozer';
      if (p.indexOf('CB') === 0 || p === 'S') return 'lockdown';
      return 'other';
    }

    return {
      abilityTick: abilityTick, abilityKind: abilityKind, surgeKind: surgeKind,
      /** @returns {boolean} true when any Star surge VFX ran (then the single-ability path is skipped) */
      surge(ents, g, dt) {
        let any = false;
        const b = g.last && g.last.ball;
        for (let i = 0; i < ents.length && i < 16; i++) {
          const on = ents[i].star === 3;
          if (on) {
            any = true;
            const hp = g.head[i];
            abilityTick(surgeKind(ents[i].pos), hp.x, 0, hp.z, g.fa ? g.fa[i] : ents[i].fa, dt / Math.max(1, 1), g.ballPos, !!(b && b.st === 'air'), !surgePrev[i]);
          }
          surgePrev[i] = on ? 1 : 0;
        }
        return any;
      },
      /** track the active snapshot ability and run its VFX (called by the renderer every frame) */
      ability(ab, ents, g, dt) {
        if (!ab || ab.idx == null || ab.idx < 0 || !ents[ab.idx]) { abKey = ''; return; }
        const key = ab.k + ':' + ab.idx;
        const started = key !== abKey;
        abKey = key;
        const e = ents[ab.idx], hp = g.head[ab.idx];
        const wx = hp ? hp.x : e.x - MIDX, wz = hp ? hp.z : 60 - e.y;
        const b = g.last && g.last.ball;
        abilityTick(ab.k, wx, 0, wz, g.fa ? g.fa[ab.idx] : e.fa, dt, g.ballPos, !!(b && b.st === 'air'), started);
      },
      puff: puff, coins: coins, text: text, trail: trail,
      /** handle one snapshot fx entry */
      spawn(f, snap, g) {
        const team = f.tid != null && g.home && g.home.tid === f.tid ? 0 : (f.tid != null && g.away && g.away.tid === f.tid ? 1 : (snap.poss || 0));
        const tc = g.cols[team] || g.cols[0];
        const tcols = [rgb(tc.pri), rgb(tc.sec), [1, 1, 1], [1, 0.82, 0.2]];
        switch (f.k) {
          case 'dust': puff(f.x, f.y, f.z, Math.max(4, Math.min(10, f.n || 6)), ctx.wx.k === 'snow' ? 'snow' : ctx.wx.k === 'rain' ? 'splash' : 'grass'); break;
          case 'hit':
            burst(f.x, f.y, 1.2, 10, STARC, 7, 2, 0.2);
            puff(f.x, f.y, 0, 8, ctx.wx.k === 'snow' ? 'snow' : 'grass');
            g.camera.shake(f.n >= 2 && f.n < 8 ? 0.2 : 0.08);
            break;
          case 'catch': burst(f.x, f.y, 1.8, 10, [[1, 1, 1], [1, 0.95, 0.5]], 3.5, 2, 0.14); break;
          case 'td':
            burst(f.x, f.y, 1.5, 40, tcols, 10, 2, 0.24);
            if (Fx.tdText) text(f.txt || 'TOUCHDOWN!', f.x, f.y, 4, R.Voxel.hexStr(tc.sec === 0xffffff ? 0xffd23f : tc.sec), true);
            if (g.stadium) g.stadium.cheer(1);
            break;
          case 'confetti': confetti(f.x, f.y, Math.min(R._state && R._state.reduceMotion ? 60 : 200, N - 20), tcols); break;
          case 'fumble': burst(f.x, f.y, 0.6, 12, [[0.55, 0.29, 0.16], [1, 1, 1]], 5, 0, 0.16); text(f.txt || 'FUMBLE!', f.x, f.y, 3, '#ffb03a'); break;
          case 'text': if (String(f.txt || '').length <= Fx.MAX_TEXT) text(f.txt, f.x, f.y, 3.2, '#ffffff', false); break;
          case 'coin': coins(f.x, f.y, f.n || 6); break;
          case 'ability': {
            const kc = g.kits && g.kits[team] ? [rgb(g.kits[team].pri), rgb(g.kits[team].helm)] : tcols;
            burst(f.x, f.y, 1.4, 24, [[1, 0.85, 0.2], [1, 1, 1], kc[0], kc[1]], 8, 2, 0.2);
            if (abilityKind(f.name) === 'bulldozer') shockwave(f.x - MIDX, 60 - f.y, 22, GRASS);
            g.camera.shake(0.12);
            if (g.stadium) g.stadium.cheer(0.5);
            break;
          }
          case 'abilityWarn': burst(f.x, f.y, 2.2, 14, RED, 3.5, 2, 0.18); break;
          default: if (f.txt) text(f.txt, f.x, f.y, 3, '#ffffff');
        }
      },
      update(dt, g) {
        batch.begin();
        for (let i = 0; i < N; i++) {
          if (life[i] <= 0) continue;
          life[i] -= dt;
          if (life[i] <= 0) continue;
          const k = kind[i];
          if (k === 1) {
            // confetti: slow fall with flutter
            vy[i] = Math.max(vy[i] - 6 * dt, -2.2);
            vx[i] += Math.sin((life[i] + i) * 5) * 4 * dt; vz[i] += Math.cos((life[i] + i * 1.3) * 4) * 4 * dt;
            vx[i] *= 0.97; vz[i] *= 0.97;
          } else if (k === 3) {
            vy[i] -= 18 * dt;
          } else if (k === 4) {
            // trail: no gravity
          } else {
            vy[i] -= (k === 2 ? 10 : 22) * dt;
            vx[i] *= 1 - 2 * dt; vz[i] *= 1 - 2 * dt;
          }
          px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
          if (py[i] < 0.05) {
            py[i] = 0.05;
            if (k === 1) { vx[i] = vz[i] = 0; vy[i] = 0; spin[i] = 0; }
            else { vy[i] = -vy[i] * 0.3; vx[i] *= 0.5; vz[i] *= 0.5; }
          }
          rot[i] += spin[i] * dt;
          const fade = Math.min(1, life[i] / Math.min(0.3, max[i]) );
          const sz = size[i] * (k === 1 ? 1 : fade);
          e.set(rot[i], rot[i] * 0.7, k === 1 ? rot[i] * 1.3 : 0);
          q.setFromEuler(e);
          if (k === 1) s.set(sz, sz * 0.25, sz * 1.4);
          else if (k === 3) s.set(sz, sz, sz * 0.25);
          else s.set(sz, sz, sz);
          m.compose(v.set(px[i], py[i], pz[i]), q, s);
          batch.add(m, cr[i], cg[i], cb[i]);
        }
        batch.end();
        // text sprites: pop (out-back), rise, fade
        for (let i = 0; i < texts.length; i++) {
          const t = texts[i];
          if (!t.sp.visible) continue;
          t.t += dt;
          const k = t.t / t.dur;
          if (k >= 1) { t.sp.visible = false; continue; }
          const pop = k < 0.2 ? outBack(k / 0.2) : 1;
          const vw = g && g.camera ? g.camera.width : 40;
          const base = Math.min(t.w, vw * 0.42);
          const w = base * pop;
          t.sp.scale.set(w, w / 4, 1);
          // keep the text inside the view horizontally
          const cx = g && g.camera ? g.camera.target.x : 0, lim = Math.max(0, vw / 2 - base / 2 - 0.5);
          t.sp.position.set(Math.max(cx - lim, Math.min(cx + lim, t.x)), t.y + k * 2.2, t.z);
          t.mat.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        }
      },
      dispose() {
        scene.remove(batch.mesh); batch.dispose(); mat.dispose();
        texts.forEach((t) => { scene.remove(t.sp); t.tex.dispose(); t.mat.dispose(); });
      }
    };
  };

  function outBack(t) { const c = 2.2; t = Math.max(0, Math.min(1, t)); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
})(globalThis.PT = globalThis.PT || {});
