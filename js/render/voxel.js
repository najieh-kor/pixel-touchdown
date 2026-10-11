/* Pixel Touchdown: js/render/voxel.js
 * Owner: WP4. Responsibility: instanced box batches, per-part matrix composition, color slots.
 *
 *   R.Voxel.batch(max, material)      → Batch: one InstancedMesh of a unit box (1 draw call), filled every frame
 *   R.Voxel.rig(def, colors)          → Rig: per-player parts with resolved colors (built once per player)
 *   R.Voxel.poseRig(rig, pose, root, batch, shadowBatch) → writes every part matrix (no allocations)
 *   R.Voxel.builder()                 → static merge helper: boxes → one BufferGeometry with vertex colors
 *   R.Voxel.newPose() / resetPose(p)  → pose record (bone offsets / rotations) filled by R.Animate
 *
 * Model space: voxel units, feet at y = 0, authored with the face toward +z. The rig flips z so the
 * model faces −Z (ARCHITECTURE 5.2: rotation.y = facing).
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const V = R.Voxel = R.Voxel || {};
  const T = globalThis.THREE;

  // Bone indices
  const B = V.BONE = { root: 0, body: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6, tail: 7 };
  V.BONES = ['root', 'body', 'head', 'armL', 'armR', 'legL', 'legR', 'tail'];

  let _unit = null;
  /** Shared unit box geometry (centered, 1×1×1). */
  V.unitBox = function () {
    if (!_unit) _unit = new T.BoxGeometry(1, 1, 1);
    return _unit;
  };

  // ---------------------------------------------------------------------------------------------
  // Batch
  // ---------------------------------------------------------------------------------------------
  /**
   * One InstancedMesh holding up to `max` boxes. Call begin(), add…(), end() every frame.
   * @param {number} max
   * @param {THREE.Material} material
   * @param {THREE.BufferGeometry} [geo]
   */
  V.batch = function (max, material, geo) {
    const mesh = new T.InstancedMesh(geo || V.unitBox(), material, max);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    const col = new T.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    col.setUsage(T.DynamicDrawUsage);
    mesh.instanceColor = col;
    mesh.frustumCulled = false;
    mesh.count = 0;
    const mArr = mesh.instanceMatrix.array, cArr = col.array;
    const b = {
      mesh: mesh, max: max, n: 0,
      begin() { b.n = 0; },
      /** add a box with a full matrix (THREE.Matrix4) and color 0..1 */
      add(m, r, g, bl) {
        if (b.n >= max) return -1;
        const i = b.n++;
        const e = m.elements, o = i * 16;
        for (let k = 0; k < 16; k++) mArr[o + k] = e[k];
        cArr[i * 3] = r; cArr[i * 3 + 1] = g; cArr[i * 3 + 2] = bl;
        return i;
      },
      /** add an axis-aligned box (center, size, rotation about Y) */
      addBox(x, y, z, w, h, d, r, g, bl, ry) {
        if (b.n >= max) return -1;
        const i = b.n++, o = i * 16;
        const c = ry ? Math.cos(ry) : 1, s = ry ? Math.sin(ry) : 0;
        mArr[o] = c * w; mArr[o + 1] = 0; mArr[o + 2] = -s * w; mArr[o + 3] = 0;
        mArr[o + 4] = 0; mArr[o + 5] = h; mArr[o + 6] = 0; mArr[o + 7] = 0;
        mArr[o + 8] = s * d; mArr[o + 9] = 0; mArr[o + 10] = c * d; mArr[o + 11] = 0;
        mArr[o + 12] = x; mArr[o + 13] = y; mArr[o + 14] = z; mArr[o + 15] = 1;
        cArr[i * 3] = r; cArr[i * 3 + 1] = g; cArr[i * 3 + 2] = bl;
        return i;
      },
      setColor(i, r, g, bl) { cArr[i * 3] = r; cArr[i * 3 + 1] = g; cArr[i * 3 + 2] = bl; },
      end() {
        mesh.count = b.n;
        mesh.instanceMatrix.needsUpdate = true;
        col.needsUpdate = true;
      },
      dispose() { mesh.dispose(); }
    };
    return b;
  };

  // ---------------------------------------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------------------------------------
  /** hex int → [r,g,b] 0..1 (allocates; build time only) */
  V.rgb = function (hex, mul) {
    mul = mul == null ? 1 : mul;
    return [Math.min(1, ((hex >> 16) & 255) / 255 * mul), Math.min(1, ((hex >> 8) & 255) / 255 * mul), Math.min(1, (hex & 255) / 255 * mul)];
  };
  /** perceived luminance 0..255 */
  V.lum = function (hex) { return 0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255); };
  /** mix two hex colors */
  V.mix = function (a, b, t) {
    const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
    const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
    const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return (r << 16) | (g << 8) | bl;
  };
  V.shade = function (hex, m) {
    const r = Math.min(255, Math.round(((hex >> 16) & 255) * m)), g = Math.min(255, Math.round(((hex >> 8) & 255) * m)), b = Math.min(255, Math.round((hex & 255) * m));
    return (r << 16) | (g << 8) | b;
  };
  V.hexStr = function (c) { return '#' + ('000000' + ((c >>> 0) & 0xffffff).toString(16)).slice(-6); };

  // ---------------------------------------------------------------------------------------------
  // Rig
  // ---------------------------------------------------------------------------------------------
  /**
   * Build a rig instance from a model def ({piv, parts, hand, h}) and a color resolver.
   * @param {Object} def   model def from R.Models.build()
   * @param {function(string|number):number} colorOf  slot → hex
   */
  V.rig = function (def, colorOf) {
    const n = def.parts.length;
    const local = new Float32Array(n * 16);
    const bone = new Uint8Array(n);
    const col = new Float32Array(n * 3);
    const m = new T.Matrix4(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
    const piv = def.piv;
    for (let i = 0; i < n; i++) {
      const pt = def.parts[i];
      bone[i] = pt.b;
      const pv = piv[V.BONES[pt.b]] || ZERO3;
      // part centers are stored bone-relative already (models.js); flip z (face toward −Z)
      p.set(pt.c[0], pt.c[1], -pt.c[2]);
      if (pt.r) q.setFromEuler(new T.Euler(-pt.r[0], -pt.r[1], pt.r[2])); else q.identity();
      s.set(pt.s[0], pt.s[1], pt.s[2]);
      m.compose(p, q, s);
      local.set(m.elements, i * 16);
      const c = V.rgb(colorOf(pt.k), pt.m || 1);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      void pv;
    }
    const pivs = new Float32Array(8 * 3);
    for (let b = 1; b < 8; b++) {
      const pv = piv[V.BONES[b]] || piv.body;
      pivs[b * 3] = pv[0]; pivs[b * 3 + 1] = pv[1]; pivs[b * 3 + 2] = -pv[2];
    }
    const hand = def.hand || [0, -4, 0.5];
    return {
      n: n, local: local, bone: bone, col: col, piv: pivs, h: def.h || 16, sp: def.sp,
      hand: new T.Vector3(hand[0], hand[1], -hand[2]),
      head: new T.Vector3(0, (def.headTop || def.h || 16), 0),
      boneM: [0, 1, 2, 3, 4, 5, 6, 7].map(() => new T.Matrix4())
    };
  };
  const ZERO3 = [0, 0, 0];

  /** Pose record: offsets/rotations per bone. Radians; positive rx = limbs swing forward, body/head/root lean forward. */
  V.newPose = function () {
    return {
      y: 0, ox: 0, oz: 0, sx: 1, sy: 1, sz: 1, rx: 0, ry: 0, rz: 0, cy: 8, // root lift, squash, whole-body tilt about height cy, extra yaw
      bx: 0, by: 0, bz: 0, brx: 0, bry: 0, brz: 0,          // body
      hrx: 0, hry: 0, hrz: 0,                               // head
      alx: 0, aly: 0, alz: 0, arx: 0, ary: 0, arz: 0,        // arms
      llx: 0, llz: 0, lrx: 0, lrz: 0, ly: 0,                // legs (ly = hip lift)
      trx: 0, try_: 0, trz: 0,                              // tail
      vis: 1
    };
  };
  V.resetPose = function (p) {
    p.y = 0; p.ox = 0; p.oz = 0; p.sx = p.sy = p.sz = 1; p.rx = p.ry = p.rz = 0;
    p.bx = p.by = p.bz = p.brx = p.bry = p.brz = 0;
    p.hrx = p.hry = p.hrz = 0;
    p.alx = p.aly = p.alz = p.arx = p.ary = p.arz = 0;
    p.llx = p.llz = p.lrx = p.lrz = p.ly = 0;
    p.trx = p.try_ = p.trz = 0; p.vis = 1;
    return p;
  };

  // temporaries (no per-frame allocation)
  const _e = T ? new T.Euler() : null, _q = T ? new T.Quaternion() : null, _v = T ? new T.Vector3() : null;
  const _one = T ? new T.Vector3(1, 1, 1) : null, _m = T ? new T.Matrix4() : null, _m2 = T ? new T.Matrix4() : null;
  const _pm = T ? new T.Matrix4() : null;

  function boneLocal(out, px, py, pz, rx, ry, rz) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _v.set(px, py, pz);
    return out.compose(_v, _q, _one);
  }

  /**
   * Compose bones and push every part of `rig` into `batch`.
   * @param {Object} rig
   * @param {Object} P   pose
   * @param {THREE.Matrix4} root  world matrix: T(pos)·Ry(facing)·S(scale) (scale in yd per voxel)
   * @param {Object} batch
   * @param {Object} [shadow]  optional shadow batch (planar projection matrix in shadow.proj)
   * @param {Float32Array} [tint]  optional rgb multiplier [r,g,b] (fog silhouettes, flashes)
   */
  V.poseRig = function (rig, P, root, batch, shadow, tint) {
    if (!P.vis) return;
    const bm = rig.boneM, pv = rig.piv;
    // root with whole-body tilt about height cy and squash
    const cy = P.cy;
    _m.makeTranslation(P.ox || 0, P.y + cy, -(P.oz || 0));
    _e.set(-P.rx, P.ry, P.rz, 'YXZ'); _q.setFromEuler(_e); _m2.makeRotationFromQuaternion(_q);
    _m.multiply(_m2);
    _m2.makeTranslation(0, -cy, 0); _m.multiply(_m2);
    _m2.makeScale(P.sx, P.sy, P.sz); _m.multiply(_m2);
    bm[0].multiplyMatrices(root, _m);
    // body
    boneLocal(_m, pv[3] + P.bx, pv[4] + P.by, pv[5] - P.bz, -P.brx, P.bry, P.brz);
    bm[1].multiplyMatrices(bm[0], _m);
    // head / arms / tail relative to body pivot
    const bx = pv[3], by = pv[4], bz = pv[5];
    boneLocal(_m, pv[6] - bx, pv[7] - by, pv[8] - bz, -P.hrx, P.hry, P.hrz); bm[2].multiplyMatrices(bm[1], _m);
    boneLocal(_m, pv[9] - bx, pv[10] - by, pv[11] - bz, P.alx, P.aly, P.alz); bm[3].multiplyMatrices(bm[1], _m);
    boneLocal(_m, pv[12] - bx, pv[13] - by, pv[14] - bz, P.arx, P.ary, P.arz); bm[4].multiplyMatrices(bm[1], _m);
    boneLocal(_m, pv[21] - bx, pv[22] - by, pv[23] - bz, P.trx, P.try_, P.trz); bm[7].multiplyMatrices(bm[1], _m);
    // legs relative to root
    boneLocal(_m, pv[15], pv[16] + P.ly, pv[17], P.llx, 0, P.llz); bm[5].multiplyMatrices(bm[0], _m);
    boneLocal(_m, pv[18], pv[19] + P.ly, pv[20], P.lrx, 0, P.lrz); bm[6].multiplyMatrices(bm[0], _m);

    const L = rig.local, C = rig.col, bones = rig.bone;
    const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
    const le = _pm.elements;
    for (let i = 0; i < rig.n; i++) {
      const o = i * 16;
      for (let k = 0; k < 16; k++) le[k] = L[o + k];
      _m.multiplyMatrices(bm[bones[i]], _pm);
      batch.add(_m, C[i * 3] * tr, C[i * 3 + 1] * tg, C[i * 3 + 2] * tb);
      if (shadow) {
        _m2.multiplyMatrices(shadow.proj, _m);
        shadow.add(_m2, 1, 1, 1);
      }
    }
  };

  /** World position of the right hand (after poseRig) → out Vector3 */
  V.handPos = function (rig, out) {
    return out.copy(rig.hand).applyMatrix4(rig.boneM[4]);
  };
  /** World position of the head top (after poseRig) → out Vector3 */
  V.headPos = function (rig, out) {
    return out.copy(rig.head).sub(_v.set(rig.piv[6], rig.piv[7], rig.piv[8])).applyMatrix4(rig.boneM[2]);
  };

  /**
   * Planar shadow projection onto y = h along light direction L (direction the light travels, L.y < 0).
   * Affine, so it can premultiply instance matrices.
   */
  V.shadowMatrix = function (out, lx, ly, lz, h) {
    const ax = -lx / ly, az = -lz / ly;
    // x' = x + (y - h)·ax ; y' = h ; z' = z + (y - h)·az
    out.set(
      1, ax, 0, -h * ax,
      0, 0, 0, h,
      0, az, 1, -h * az,
      0, 0, 0, 1);
    return out;
  };

  // ---------------------------------------------------------------------------------------------
  // Static merge builder (stands, goalposts, dioramas): boxes → one BufferGeometry, vertex colors
  // ---------------------------------------------------------------------------------------------
  // unit cube faces: normal, 4 corners (CCW from outside)
  const FACES = [
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
  ];

  /** Static geometry builder. box(cx,cy,cz,w,h,d,hex,ry?, skipBottom?) */
  V.builder = function () {
    const pos = [], nor = [], col = [], idx = [];
    let nv = 0;
    const bld = {
      count() { return idx.length / 3; },
      /** axis-aligned (optionally Y-rotated) box */
      box(cx, cy, cz, w, h, d, hex, ry, noBottom) {
        const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
        const c = ry ? Math.cos(ry) : 1, s = ry ? Math.sin(ry) : 0;
        for (let f = 0; f < 6; f++) {
          if (noBottom && f === 3) continue;
          const n = FACES[f][0], cs = FACES[f][1];
          const nx = n[0] * c + n[2] * s, nz = -n[0] * s + n[2] * c;
          for (let k = 0; k < 4; k++) {
            const lx = cs[k][0] * w / 2, ly = cs[k][1] * h / 2, lz = cs[k][2] * d / 2;
            pos.push(cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c);
            nor.push(nx, n[1], nz);
            col.push(r, g, b);
          }
          idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
          nv += 4;
        }
        return bld;
      },
      /** box with an arbitrary Matrix4 applied to a unit cube */
      boxM(m, hex) {
        const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
        const e = m.elements;
        const nm = new T.Matrix3().getNormalMatrix(m).elements;
        for (let f = 0; f < 6; f++) {
          const n = FACES[f][0], cs = FACES[f][1];
          let nx = nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2], ny = nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2], nz = nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2];
          const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
          for (let k = 0; k < 4; k++) {
            const x = cs[k][0] / 2, y = cs[k][1] / 2, z = cs[k][2] / 2;
            pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
            nor.push(nx, ny, nz);
            col.push(r, g, b);
          }
          idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
          nv += 4;
        }
        return bld;
      },
      /** flat quad on y = h (for painted ground decals) */
      quad(cx, h, cz, w, d, hex) {
        const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
        pos.push(cx - w / 2, h, cz + d / 2, cx + w / 2, h, cz + d / 2, cx + w / 2, h, cz - d / 2, cx - w / 2, h, cz - d / 2);
        for (let k = 0; k < 4; k++) { nor.push(0, 1, 0); col.push(r, g, b); }
        idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
        nv += 4;
        return bld;
      },
      /** project every vertex onto y = h along light direction (for baked planar shadows) */
      flatten(lx, ly, lz, h) {
        const ax = -lx / ly, az = -lz / ly;
        for (let i = 0; i < pos.length; i += 3) {
          const dy = pos[i + 1] - h;
          pos[i] += dy * ax; pos[i + 2] += dy * az; pos[i + 1] = h;
        }
        return bld;
      },
      geometry() {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
        g.setIndex(nv > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        return g;
      }
    };
    return bld;
  };
})(globalThis.PT = globalThis.PT || {});
