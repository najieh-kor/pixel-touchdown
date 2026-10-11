/* Pixel Touchdown: js/render/portrait.js
 * Owner: WP4. Responsibility: offscreen voxel head portraits for UI (cached dataURLs).
 *
 *   R.Portrait.get(player, teamCol, size, gl) → dataURL (real portrait if cached, else a 2D placeholder;
 *       the real one is queued, rendered offscreen with the main WebGLRenderer (2 per frame), cached, and
 *       announced with PT.Events 'render:portrait' {key}). LRU cache of 200 entries (ARCHITECTURE 6).
 *   R.Portrait.key(player, teamCol, size) → cache key ('pid:col:size')
 *   R.Portrait.pump(gl)  (called by the renderer every frame; a timer also pumps when no frames run)
 *   R.Portrait.reset()   (after a context loss)
 * player: a league Player {id, sp, num, look:{v, acc}} or a GameTeam.pl entry {pid, sp, num, cs, look}.
 * teamCol: number (primary) or {pri, sec, acc}.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const Po = R.Portrait = R.Portrait || {};
  const T = globalThis.THREE;
  const MAX = 200;
  const cache = new Map();          // key → dataURL (LRU: Map insertion order)
  const holders = new Map();        // key → placeholder dataURL
  const queue = [];                 // {key, player, team, size}
  let world = null, timer = 0, glRef = null;

  function teamOf(tc) {
    if (tc && typeof tc === 'object') return { pri: tc.pri != null ? tc.pri : 0x3a6fd8, sec: tc.sec != null ? tc.sec : 0xffffff, acc: tc.acc };
    const pri = tc == null ? 0x8a8f99 : tc;
    const V = R.Voxel;
    return { pri: pri, sec: V.lum(pri) > 170 ? 0x1b1f3a : 0xffffff };
  }
  Po.key = function (p, tc, size) {
    const id = p ? (p.id != null ? p.id : p.pid) : 'x';
    const c = tc && typeof tc === 'object' ? tc.pri + '-' + tc.sec : tc;
    return id + ':' + c + ':' + (size || 96);
  };

  function lruGet(k) {
    const v = cache.get(k);
    if (v !== undefined) { cache.delete(k); cache.set(k, v); }
    return v;
  }
  function lruSet(k, v) {
    cache.delete(k); cache.set(k, v);
    while (cache.size > MAX) cache.delete(cache.keys().next().value);
  }

  /** simple 2D voxel-ish head while the real portrait renders (or when WebGL is missing) */
  function placeholder(p, team, size) {
    const doc = globalThis.document;
    if (!doc) return '';
    const c = doc.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const sp = R.Models.SPECIES[p && p.sp] || R.Models.SPECIES.dog;
    const cs = p ? (p.cs != null ? p.cs : (p.look && p.look.v) || 0) : 0;
    const fur = cs ? sp.B : sp.A;
    const hex = R.Voxel.hexStr;
    const u = size / 16;
    g.fillStyle = hex(team.pri); g.fillRect(3 * u, 11 * u, 10 * u, 5 * u);       // jersey
    g.fillStyle = hex(R.Voxel.shade(fur[0], 0.8)); g.fillRect(3.4 * u, 2.4 * u, 10 * u, 9 * u);
    g.fillStyle = hex(fur[0]); g.fillRect(3 * u, 2 * u, 10 * u, 9 * u);            // head
    g.fillStyle = hex(team.sec); g.fillRect(2.8 * u, 3.6 * u, 10.4 * u, 1.2 * u); // headband
    g.fillStyle = '#1b1b20'; g.fillRect(5 * u, 6 * u, 1.4 * u, 1.8 * u); g.fillRect(9.6 * u, 6 * u, 1.4 * u, 1.8 * u);
    g.fillStyle = hex(fur[1]); g.fillRect(6.6 * u, 8.2 * u, 2.8 * u, 1.8 * u);
    return c.toDataURL();
  }

  /**
   * @param {Object} p player
   * @param {number|Object} tc team color(s)
   * @param {number} size px
   * @param {THREE.WebGLRenderer|null} gl
   */
  Po.get = function (p, tc, size, gl) {
    size = size || 96;
    const key = Po.key(p, tc, size);
    const hit = lruGet(key);
    if (hit) return hit;
    const team = teamOf(tc);
    let ph = holders.get(key);
    if (!ph) {
      ph = placeholder(p, team, size);
      holders.set(key, ph);
      if (holders.size > MAX) holders.delete(holders.keys().next().value);
      if (gl || glRef) {
        queue.push({ key: key, p: p, team: team, size: size });
        if (gl) glRef = gl;
        schedule();
      } else {
        lruSet(key, ph);
      }
    }
    return ph;
  };

  function schedule() {
    if (timer || !globalThis.setTimeout) return;
    timer = globalThis.setTimeout(() => { timer = 0; if (queue.length) { Po.pump(glRef, true); if (queue.length) schedule(); } }, 40);
  }

  function buildWorld() {
    const scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x9aa0b0, 0.72));
    const key = new T.DirectionalLight(0xffffff, 0.55);
    key.position.set(-3, 5, 6);
    scene.add(key);
    const mat = new T.MeshLambertMaterial({ color: 0xffffff });
    const batch = R.Voxel.batch(400, mat);
    scene.add(batch.mesh);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    return { scene: scene, batch: batch, cam: cam, mat: mat, rt: null, rtSize: 0, pose: R.Voxel.newPose(), m: new T.Matrix4(), v: new T.Vector3(), v2: new T.Vector3(), q: new T.Quaternion() };
  }

  function renderOne(gl, job) {
    if (!world) world = buildWorld();
    const W = world;
    const s = job.size * 2;                          // supersample ×2, downscale on the 2D canvas
    if (!W.rt || W.rtSize !== s) {
      if (W.rt) W.rt.dispose();
      W.rt = new T.WebGLRenderTarget(s, s);
      W.rtSize = s;
    }
    const p = job.p || {};
    const sp = R.Models.has(p.sp) ? p.sp : 'dog';
    const look = p.look || {};
    const def = R.Models.def(sp, { num: p.num, acc: look.acc || null, numbers: true, front: true });
    const cs = p.cs != null ? p.cs : (look.v || 0);
    const rig = R.Voxel.rig(def, R.Models.palette(sp, cs, job.team));
    const P = R.Voxel.resetPose(W.pose);
    P.hrx = -0.06; P.hrz = 0.05; P.alz = 0.12; P.arz = -0.12;
    // face the camera, turned 3/4
    W.q.setFromAxisAngle(W.v.set(0, 1, 0), Math.PI - 0.5);
    W.m.compose(W.v2.set(0, 0, 0), W.q, W.v.set(1, 1, 1));
    W.batch.begin();
    R.Voxel.poseRig(rig, P, W.m, W.batch, null);
    W.batch.end();
    // frame head + shoulders
    const piv = def.piv;
    const neck = piv.head[1];
    const top = def.headTop + (sp === 'rabbit' || sp === 'kangaroo' ? 3 : sp === 'moose' ? 2 : 1);
    const span = Math.max(top - neck, 7);
    const cy = sp === 'giraffe' || sp === 'ostrich' ? top - span * 0.42 : neck + span * 0.42;
    const half = sp === 'giraffe' || sp === 'ostrich' ? span * 0.55 : span * 0.92;
    const cam = W.cam;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.position.set(Math.sin(0.25) * 30, cy + 4, Math.cos(0.25) * 30);
    cam.lookAt(0, cy, 0);
    cam.updateProjectionMatrix();
    // render
    const prevT = gl.getRenderTarget();
    const prevC = new T.Color(); gl.getClearColor(prevC); const prevA = gl.getClearAlpha();
    gl.setRenderTarget(W.rt);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, true);
    gl.render(W.scene, cam);
    const buf = new Uint8Array(s * s * 4);
    gl.readRenderTargetPixels(W.rt, 0, 0, s, s, buf);
    gl.setRenderTarget(prevT);
    gl.setClearColor(prevC, prevA);
    // to dataURL (flip Y, downscale)
    const doc = globalThis.document;
    const big = doc.createElement('canvas'); big.width = big.height = s;
    const bg = big.getContext('2d');
    const img = bg.createImageData(s, s);
    for (let y = 0; y < s; y++) img.data.set(buf.subarray((s - 1 - y) * s * 4, (s - y) * s * 4), y * s * 4);
    bg.putImageData(img, 0, 0);
    const out = doc.createElement('canvas'); out.width = out.height = job.size;
    const og = out.getContext('2d');
    og.imageSmoothingEnabled = true;
    og.drawImage(big, 0, 0, job.size, job.size);
    return out.toDataURL('image/png');
  }

  /** render up to 2 queued portraits */
  Po.pump = function (gl, fromTimer) {
    gl = gl || glRef;
    if (!gl || !queue.length) return;
    glRef = gl;
    const n = fromTimer ? 4 : 2;
    for (let i = 0; i < n && queue.length; i++) {
      const job = queue.shift();
      if (cache.has(job.key)) continue;
      let url = null;
      try { url = renderOne(gl, job); } catch (e) { if (PT.Log) PT.Log.warn('render', 'portrait failed', e); url = holders.get(job.key); }
      lruSet(job.key, url);
      holders.delete(job.key);
      if (PT.Events) PT.Events.emit('render:portrait', { key: job.key });
    }
  };

  Po.reset = function () {
    if (world) { if (world.rt) world.rt.dispose(); world.batch.dispose(); world.mat.dispose(); world = null; }
  };
  Po._cache = cache;
})(globalThis.PT = globalThis.PT || {});
