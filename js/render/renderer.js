/* Pixel Touchdown: js/render/renderer.js
 * Owner: WP4. Responsibility: PT.Render: init, resize, quality tiers, draw(snapshot), scenes.
 *
 * Public API (ARCHITECTURE 3.6, camera per RECONCILE R4: the USER's attack direction is always screen-up):
 *   init(canvas, {quality}) → bool · resize() · setScene('menu'|'game'|'none') · menuBackdrop({teamCol, sp})
 *   loadGame({home, away, weather, stadium:{lvl, homeCol, clim?, name?}}) · draw(snap, alpha, dtReal) · unloadGame()
 *   screenDirToField(dx, dyUp) · screenToField(px, py) · fieldToScreen(x, y, z) · orientation()
 *   setQuality(q) · stats() · setDebug({hitboxes, routes, zones}) · portrait(player, teamCol, size)
 * Extras (documented in docs/handoff/WP4.md): cue(kind, opts), setReduceMotion(on), Q (quality tiers), ready().
 *
 * World mapping (ARCHITECTURE 5.2): world.x = x − 26.667, world.z = 60 − y, world.y = z. 1 unit = 1 yd.
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const T = globalThis.THREE;
  const MIDX = 26.667;

  /** Quality tiers (ARCHITECTURE 6). Package tuning object PT.Render.Q. */
  const Q = R.Q = {
    low: { name: 'low', dpr: 1.5, aa: false, crowd: 0, crowdAnim: false, particles: 64, weather: 150, tex: 1024, aniso: 4, numbers: true, front: false, banners: 6 },
    med: { name: 'med', dpr: 2.0, aa: true, crowd: 600, crowdAnim: true, particles: 160, weather: 400, tex: 2048, aniso: 16, numbers: true, front: true, banners: 10 },
    high: { name: 'high', dpr: 3.0, aa: true, crowd: 1500, crowdAnim: true, particles: 320, weather: 800, tex: 2048, aniso: 16, numbers: true, front: true, banners: 16 }
  };
  const TIERS = ['low', 'med', 'high'];
  /** visual scale: yards per voxel at size M (models are chunky on purpose, ARCHITECTURE 5.2) */
  R.VOX = 1 / 8 * 1.3;

  // ---------------------------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------------------------
  const S = {
    gl: null, canvas: null, q: Q.med, auto: true, dprScale: 1, scene: 'none', w: 1, h: 1, dpr: 1,
    lost: false, time: 0, lastExt: 0, ownRaf: 0, aaCreated: false,
    fps: 60, ms: 16.7, frames: 0, fpsT: 0,
    aq: { acc: 0, n: 0, win: 0, under: 0, last: -100 },
    debug: { hitboxes: false, routes: false, zones: false },
    backdrop: { teamCol: 0x3BB273, sp: 'frog', sec: 0xF7D046, mode: 'title', clim: 'mild', lvl: 3, stad: '' }
  };
  let G = null;           // game world
  let MENU = null;        // menu world
  let gameOpts = null;

  // temporaries
  let _m, _m2, _v, _v2, _q, _e, _ray, _ndc, _plane, _hit, _proj, _projDown, _tint, _ballQ, _ballS;
  function temps() {
    _m = new T.Matrix4(); _m2 = new T.Matrix4(); _v = new T.Vector3(); _v2 = new T.Vector3(); _q = new T.Quaternion(); _e = new T.Euler();
    _ray = new T.Raycaster(); _ndc = new T.Vector2(); _plane = new T.Plane(new T.Vector3(0, 1, 0), 0); _hit = new T.Vector3();
    _proj = new T.Matrix4(); _projDown = new T.Matrix4(); _tint = new Float32Array([1, 1, 1]);
    _ballQ = new T.Quaternion(); _ballS = new T.Vector3();
  }

  function now() { return (globalThis.performance && performance.now) ? performance.now() : Date.now(); }
  function emit(name, p) { if (PT.Events && PT.Events.emit) PT.Events.emit(name, p); }
  function log(level, msg, e) { if (PT.Log && PT.Log[level]) PT.Log[level]('render', msg, e); }

  // ---------------------------------------------------------------------------------------------
  // init / resize / quality
  // ---------------------------------------------------------------------------------------------
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{quality?:'auto'|'low'|'med'|'high'}} [opts]
   * @returns {boolean} false = no WebGL
   */
  R.init = function (canvas, opts) {
    opts = opts || {};
    if (!T || !canvas) return false;
    if (S.gl) return true;
    S.canvas = canvas;
    let want = opts.quality || (PT.Flags && PT.Flags.quality) || 'auto';
    S.auto = !(want in Q);
    if (S.auto) want = pickStartTier();
    S.q = Q[want];
    try {
      S.gl = new T.WebGLRenderer({ canvas: canvas, antialias: S.q.aa || (S.auto && S.q.name !== 'low'), alpha: false, stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    } catch (e) {
      log('warn', 'WebGL unavailable', e);
      S.gl = null;
      return false;
    }
    S.aaCreated = S.q.aa;
    S.gl.setClearColor(0x8fd3ff, 1);
    S.gl.info.autoReset = true;
    temps();
    busHooks();
    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    R.resize();
    return true;
  };
  /** true once init() succeeded */
  R.ready = function () { return !!S.gl && !S.lost; };

  function pickStartTier() {
    const nav = globalThis.navigator || {};
    const dpr = globalThis.devicePixelRatio || 1;
    const sw = (globalThis.screen && Math.min(globalThis.screen.width, globalThis.screen.height)) || 800;
    // phones start at 'med' too (iOS reports 4 cores even on fast chips); only measured slowness drops the tier
    if (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2) return 'low';
    void dpr; void sw;
    return 'med';
  }

  function onLost(ev) {
    ev.preventDefault();
    S.lost = true;
    emit('render:contextLost', {});
    log('warn', 'WebGL context lost');
  }
  function onRestored() {
    S.lost = false;
    try {
      if (gameOpts) { const o = gameOpts; R.unloadGame(); R.loadGame(o); }
      if (MENU) { disposeMenu(); }
      if (R.Portrait && R.Portrait.reset) R.Portrait.reset();
    } catch (e) { log('error', 'context restore failed', e); }
    emit('render:contextRestored', {});
  }

  /** reads canvas client size, applies the DPR cap */
  R.resize = function () {
    if (!S.gl) return;
    const c = S.canvas;
    const w = Math.max(1, c.clientWidth || c.width || 1), h = Math.max(1, c.clientHeight || c.height || 1);
    S.w = w; S.h = h;
    S.dpr = Math.max(0.5, Math.min((globalThis.devicePixelRatio || 1), S.q.dpr) * S.dprScale);
    S.gl.setPixelRatio(S.dpr);
    S.gl.setSize(w, h, false);
    if (G) G.camera.resize(w, h);
    if (MENU) { MENU.cam.aspect = w / h; MENU.cam.updateProjectionMatrix(); }
  };

  /** 'low'|'med'|'high'|'auto' */
  R.setQuality = function (q) {
    if (q === 'auto') { S.auto = true; return; }
    if (!(q in Q)) return;
    S.auto = false;
    setTier(q, false);
  };
  function setTier(q, auto) {
    if (S.q.name === q) return;
    S.q = Q[q];
    S.aq.last = S.time;
    if (S.gl) {
      R.resize();
      if (gameOpts) { const o = gameOpts; const camState = G ? G.camera.save() : null; R.unloadGame(); R.loadGame(o); if (camState) G.camera.restore(camState); }
      if (MENU) disposeMenu();
    }
    emit('render:quality', { q: q, auto: !!auto });
  }

  /**
   * Auto tier (ARCHITECTURE 6, sharpness-first): ignore the first 4 s after a scene / game load (shader warm-up),
   * then measure 3 s windows. Two consecutive windows > 22 ms: first step the DPR down (0.25 of the cap, not
   * below 1.25), then drop a tier. At most one change per 8 s. Low → med after 10 s under 12 ms.
   */
  function autoQuality(dt) {
    if (!S.auto || dt <= 0 || dt > 0.25) return;
    const a = S.aq;
    if (S.time - (S.warm || 0) < 4) { a.acc = 0; a.n = 0; a.win = 0; return; }
    a.acc += dt; a.n++; a.win += dt;
    if (a.win < 3) return;
    const avg = a.acc / a.n * 1000;
    const since = S.time - a.last;
    a.bad = avg > 22 ? (a.bad || 0) + 1 : 0;
    if (a.bad >= 2 && since >= 8) {
      a.bad = 0;
      const cap = Math.min(globalThis.devicePixelRatio || 1, S.q.dpr);
      if (cap * S.dprScale > 1.3) {
        S.dprScale = Math.max(1.25 / cap, S.dprScale - 0.25 / cap * 2);
        a.last = S.time; R.resize();
        emit('render:quality', { q: S.q.name, auto: true, dpr: S.dpr });
      } else {
        const i = TIERS.indexOf(S.q.name);
        if (i > 0) { S.dprScale = 1; setTier(TIERS[i - 1], true); }
      }
    }
    if (avg < 12) a.under += a.win; else a.under = 0;
    if (S.q.name === 'low' && a.under >= 10 && since >= 8) { a.under = 0; setTier('med', true); }
    a.acc = 0; a.n = 0; a.win = 0;
  }

  /** @returns {{fps:number, ms:number, calls:number, tris:number, dpr:number, q:string}} */
  R.stats = function () {
    const info = S.gl ? S.gl.info.render : { calls: 0, triangles: 0 };
    return { fps: Math.round(S.fps), ms: +S.ms.toFixed(2), calls: info.calls, tris: info.triangles, dpr: S.dpr, q: S.q.name, auto: S.auto };
  };

  R.orientation = function () {
    const c = S.canvas;
    const w = c ? (c.clientWidth || c.width) : 800, h = c ? (c.clientHeight || c.height) : 600;
    return w >= h ? 'landscape' : 'portrait';
  };

  /** Reduce Motion setting (design 9.8): no screen shake, no slow-mo zoom, lighter confetti */
  R.setReduceMotion = function (on) { if (R.Camera) R.Camera.reduceMotion = !!on; S.reduceMotion = !!on; };

  R.setDebug = function (o) {
    Object.assign(S.debug, o || {});
    if (G && G.debugDraw) G.debugDraw.set(S.debug);
  };

  // ---------------------------------------------------------------------------------------------
  // scenes
  // ---------------------------------------------------------------------------------------------
  R.setScene = function (s) {
    S.scene = s === 'menu' || s === 'game' ? s : 'none';
    S.warm = S.time;
    if (S.scene === 'menu') startOwnLoop();
  };

  /**
   * Menu / HQ backdrop (a little voxel diorama of the user's team world).
   * @param {{teamCol?:number, sec?:number, sp?:string, stad?:string, clim?:string, lvl?:number,
   *          mode?:'title'|'hq'|'draft'|'market'}} o   only the given fields change
   */
  R.menuBackdrop = function (o) {
    o = o || {};
    const bd = S.backdrop;
    let changed = false;
    ['teamCol', 'sec', 'sp', 'stad', 'clim', 'lvl', 'mode'].forEach((k) => {
      if (o[k] != null && o[k] !== bd[k]) { bd[k] = o[k]; changed = true; }
    });
    if (o.teamCol != null && o.sec == null && bd._secFor !== o.teamCol) {
      // derive a readable secondary when the caller only gives the primary
      bd.sec = R.Voxel.lum(o.teamCol) > 160 ? 0x1b1f3a : 0xffffff; bd._secFor = o.teamCol; changed = true;
    }
    if (changed && MENU) MENU.setTeam(bd);
  };

  // own rAF for the menu backdrop when nobody calls draw()
  function startOwnLoop() {
    if (S.ownRaf || !globalThis.requestAnimationFrame) return;
    let last = now();
    const tick = function () {
      S.ownRaf = 0;
      if (S.scene !== 'menu' || !S.gl) return;
      const t = now();
      if (t - S.lastExt > 150) {
        const dt = Math.min(0.1, (t - last) / 1000);
        frame(null, 1, dt, false);
      }
      last = t;
      S.ownRaf = globalThis.requestAnimationFrame(tick);
    };
    S.ownRaf = globalThis.requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------------------------------
  // game world
  // ---------------------------------------------------------------------------------------------
  /**
   * Uniform kits so the two teams always contrast (client: "can't tell my team"). HOME wears its primary
   * jersey + primary helmet; AWAY wears a white kit trimmed in its primary — or, when that is too close to
   * the home look, its alternate (primary / secondary / dark) kit. Kit = {pri: jersey, sec: trim & numbers,
   * acc: pants, helm, hstripe}. PT.Render.Kits.make(homeCol, awayCol) → [homeKit, awayKit] (UI may reuse).
   */
  const Kits = R.Kits = {
    /** perceptual-ish RGB distance (redmean), 0..~765 */
    dist(a, b) {
      const r1 = (a >> 16) & 255, g1 = (a >> 8) & 255, b1 = a & 255, r2 = (b >> 16) & 255, g2 = (b >> 8) & 255, b2 = b & 255;
      const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
      return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
    },
    MIN: 170,
    make(hc, ac) {
      hc = hc || {}; ac = ac || {};
      const V = R.Voxel, WHITE = 0xF4F4F0, DARK = 0x23263F;
      const hp = hc.pri != null ? hc.pri : 0x3a6fd8, hs = hc.sec != null ? hc.sec : 0xffffff;
      const ap = ac.pri != null ? ac.pri : 0xe63946, as = ac.sec != null ? ac.sec : 0xffffff;
      const pantsH = V.lum(hp) < 120 ? (Kits.dist(hs, hp) > 200 ? hs : WHITE) : (V.lum(hs) < 120 ? hs : DARK);
      const home = { pri: hp, sec: hs, acc: Kits.dist(pantsH, hp) < 90 ? V.shade(hp, 0.6) : pantsH, helm: hp, hstripe: hs, kit: 'home' };
      const D = (x) => Math.min(Kits.dist(x, home.pri), Kits.dist(x, home.helm));
      const trimOn = (bg, c, alt) => (Kits.dist(bg, c) > 140 ? c : alt);
      const cands = [
        { pri: WHITE, sec: trimOn(WHITE, ap, DARK), acc: ap, helm: ap, hstripe: WHITE, kit: 'away' },
        { pri: WHITE, sec: trimOn(WHITE, ap, DARK), acc: ap, helm: WHITE, hstripe: trimOn(WHITE, ap, DARK), kit: 'away-white-helmet' },
        { pri: ap, sec: trimOn(ap, as, WHITE), acc: WHITE, helm: ap, hstripe: trimOn(ap, as, WHITE), kit: 'alt' },
        { pri: as, sec: trimOn(as, ap, DARK), acc: ap, helm: as, hstripe: ap, kit: 'alt2' },
        { pri: DARK, sec: trimOn(DARK, ap, WHITE), acc: DARK, helm: DARK, hstripe: trimOn(DARK, ap, WHITE), kit: 'dark' }
      ];
      let away = null;
      for (let i = 0; i < cands.length && !away; i++) {
        const c = cands[i];
        if (Kits.dist(c.pri, home.pri) >= Kits.MIN && D(c.helm) >= Kits.MIN * 0.8) away = c;
      }
      if (!away) away = cands[4].pri !== home.pri && Kits.dist(DARK, home.pri) > 120 ? cands[4] : cands[0];
      if (away.helm === WHITE && Kits.dist(WHITE, home.helm) < 100) away.helm = DARK;
      return [home, away];
    }
  };

  /**
   * The kits in use for the loaded game: [homeKit, awayKit] (null when no game). UI/HUD should colour the
   * scoreboard, VS card and stat bars with kit.pri (jersey) / kit.helm, not the raw team primary, so two
   * same-colour teams always differ. Also emitted on load as PT.Events 'render:kits' {home, away}.
   * Before a game (VS card) call PT.Render.Kits.make(homeTeam.col, awayTeam.col) — no WebGL needed.
   */
  R.kits = function () { return G && G.kits ? [Object.assign({}, G.kits[0]), Object.assign({}, G.kits[1])] : null; };

  function teamColors(gt) {
    const c = (gt && gt.col) || {};
    return { pri: c.pri != null ? c.pri : 0x3a6fd8, sec: c.sec != null ? c.sec : 0xffffff, acc: c.acc };
  }

  /** Build a rig for one roster entry. */
  function makeRig(pl, team, q) {
    const sp = R.Models.has(pl.sp) ? pl.sp : 'dog';
    const look = pl.look || {};
    const def = R.Models.def(sp, { num: pl.num, acc: look.acc || null, numbers: q.numbers, front: q.front, helmet: !pl.noHelmet });
    const cs = pl.cs != null ? pl.cs : (look.v || 0);
    const rig = R.Voxel.rig(def, R.Models.palette(sp, cs, team));
    const sz = pl.sz || R.Models.size(sp);
    rig.scale = R.VOX * ((PT.C.SIZES[sz] || PT.C.SIZES.M).scale);
    rig.info = { h: def.h, dance: R.Models.dance(sp), sz: sz };
    return rig;
  }

  /**
   * @param {{home:GameTeam, away:GameTeam, weather:(Object|string), stadium:{lvl:number, homeCol:number, clim?:string, name?:string}}} o
   */
  R.loadGame = function (o) {
    if (!S.gl) return;
    if (G) R.unloadGame();
    gameOpts = o;
    const q = S.q;
    const home = o.home || {}, away = o.away || {};
    const wx = typeof o.weather === 'string' ? { k: o.weather } : (o.weather || { k: 'sunny' });
    const stad = o.stadium || {};
    const scene = new T.Scene();
    const g = G = {
      scene: scene, home: home, away: away, wx: wx, stad: stad, last: null, udir: 1,
      cols: [teamColors(home), teamColors(away)], kits: null,
      rigs: new Map(), fallback: [], st: [], pose: [], fa: new Float32Array(16), faInit: new Uint8Array(16),
      head: [], hand: [], lastFx: 0, flash: 0, slow: 0, side: null, sideCheer: [0, 0], sideSad: [0, 0],
      celePrev: new Uint8Array(16), celeFa: new Float32Array(16), proxy: [], vx: new Float32Array(16), vy: new Float32Array(16),
      cele: { active: false, idx: -1, style: '', t: 0, k: 0, n: 0, members: [-1, -1, -1, -1], slots: [{}, {}, {}, {}], zones: [] },
      mini: { pid: -1, idx: -1, t: -1, style: '' }, celeBallOn: false, cbx: 0, cby: 0, cbz: 0, cbyaw: 0
    };
    // lights
    g.hemi = new T.HemisphereLight(0xffffff, 0x8f9c84, 0.56);
    g.sun = new T.DirectionalLight(0xffffff, 0.52);
    scene.add(g.hemi, g.sun, g.sun.target);
    // players: one instanced batch (+ ball), shadows in a second batch (planar, stencil so overlaps don't double-darken)
    g.matPlayers = new T.MeshLambertMaterial({ color: 0xffffff });
    g.players = R.Voxel.batch(6000, g.matPlayers);
    g.players.mesh.renderOrder = 2;
    scene.add(g.players.mesh);
    g.matShadow = shadowMaterial();
    g.shadows = R.Voxel.batch(3400, g.matShadow);
    g.shadows.mesh.renderOrder = 1;
    g.shadows.proj = _proj;
    scene.add(g.shadows.mesh);
    // uniforms: home kit vs contrasting away kit; rigs for both rosters
    g.kits = Kits.make(g.cols[0], g.cols[1]);
    emit('render:kits', { home: Object.assign({}, g.kits[0]), away: Object.assign({}, g.kits[1]) });
    [home, away].forEach((t, ti) => {
      (t.pl || []).forEach((pl) => g.rigs.set(pl.pid, makeRig(pl, g.kits[ti], q)));
      g.fallback[ti] = makeRig({ sp: 'dog', num: 0, cs: 0, look: {} }, g.kits[ti], q);
    });
    for (let i = 0; i < 16; i++) {
      g.proxy.push({ an: 'idle', at: 0, cele: null, spd: 0, z: 0, ball: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, vfa: null, vk: 0, vmove: false });
      g.st.push(R.Animate.state()); g.pose.push(R.Voxel.newPose());
      g.head.push(new T.Vector3()); g.hand.push(new T.Vector3());
    }
    // world
    const ctx = { scene: scene, q: q, home: home, away: away, cols: g.cols, kits: g.kits, wx: wx, stad: stad, gl: S.gl, VOX: R.VOX, hemi: g.hemi, sun: g.sun };
    g.ctx = ctx;
    g.field = R.Field.build(ctx);
    g.stadium = R.Stadium.build(ctx);
    g.overlay = R.Field.overlay(ctx);
    g.fx = R.Fx.create(ctx);
    g.weather = R.Weather.create(ctx);
    g.camera = R.Camera.create(ctx);
    g.camera.resize(S.w, S.h);
    g.debugDraw = R.DebugDraw ? R.DebugDraw.create(ctx) : null;
    g.side = buildSideline(g, q);
    if (g.debugDraw) g.debugDraw.set(S.debug);
    scene.background = g.stadium.sky;
    scene.fog = g.stadium.fog;
    setLight(1);
    S.scene = 'game';
    S.warm = S.time;
  };

  function shadowMaterial() {
    const m = new T.MeshBasicMaterial({ color: 0x163a10, transparent: true, opacity: 0.26, depthWrite: false });
    m.stencilWrite = true;
    m.stencilRef = 1;
    m.stencilFunc = T.NotEqualStencilFunc;
    m.stencilZPass = T.ReplaceStencilOp;
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    return m;
  }
  R._shadowMaterial = shadowMaterial;

  /** light direction is fixed relative to the camera: shadows always fall to the right and away (Crossy Road look) */
  function setLight(udir) {
    const g = G;
    const lx = 0.55 * udir, ly = -1, lz = -0.42 * udir;
    g.lightDir = g.lightDir || new T.Vector3();
    g.lightDir.set(lx, ly, lz).normalize();
    R.Voxel.shadowMatrix(_proj, lx, ly, lz, 0.05);
    R.Voxel.shadowMatrix(_projDown, 0, -1, 0, 0.05);
    g.sun.position.set(-lx * 40, 40, -lz * 40);
    g.sun.target.position.set(0, 0, 0);
    g.udir = udir;
    if (g.stadium && g.stadium.setLight) g.stadium.setLight(lx, ly, lz);
    if (g.field && g.field.setLight) g.field.setLight(lx, ly, lz, udir);
  }

  R.unloadGame = function () {
    const g = G;
    if (!g) return;
    ['field', 'stadium', 'overlay', 'fx', 'weather', 'debugDraw'].forEach((k) => { if (g[k] && g[k].dispose) g[k].dispose(); });
    g.players.dispose(); g.shadows.dispose();
    g.matPlayers.dispose(); g.matShadow.dispose();
    G = null;
    gameOpts = null;
    if (S.scene === 'game') S.scene = 'none';
  };

  // ---------------------------------------------------------------------------------------------
  // draw
  // ---------------------------------------------------------------------------------------------
  /**
   * @param {Snapshot|null} snap
   * @param {number} alpha  0..1 interpolation between previous and current tick
   * @param {number} dtReal seconds since the last frame
   */
  R.draw = function (snap, alpha, dtReal) {
    S.lastExt = now();
    frame(snap, alpha, dtReal, true);
  };

  function frame(snap, alpha, dtReal, external) {
    if (!S.gl || S.lost) return;
    const dt = Math.min(Math.max(dtReal || 0, 0), 0.1);
    S.time += dt;
    S.frames++; S.fpsT += dtReal || 0;
    if (S.fpsT >= 0.5) { S.fps = S.frames / S.fpsT; S.ms = 1000 * S.fpsT / S.frames; S.frames = 0; S.fpsT = 0; }
    if (external) autoQuality(dtReal || 0);
    try {
      if (S.scene === 'game' && G) drawGame(snap, alpha == null ? 1 : alpha, dt);
      else if (S.scene === 'menu') drawMenu(dt);
      else { S.gl.setClearColor(0x1b1f3a, 1); S.gl.clear(); }
      if (R.Portrait && R.Portrait.pump) R.Portrait.pump(S.gl);
    } catch (e) {
      log('error', 'draw failed', e);
      throw e;
    }
  }

  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  function rigFor(e) {
    const r = G.rigs.get(e.pid);
    return r || G.fallback[e.tm ? 1 : 0];
  }

  function drawGame(snap, alpha, dt) {
    const g = G;
    if (snap) g.last = snap;
    const s = g.last;
    const gdt = dt * (g.slow > 0 ? 0.45 : 1);
    if (g.slow > 0) g.slow -= dt;
    if (s) {
      const udir = s.udir || 1;
      if (udir !== g.udir) { setLight(udir); g.camera.snap(); }
      drawPlayers(s, alpha, gdt);
      g.overlay.update(s, alpha, dt, S.time, g);
      const surged = g.fx.surge ? g.fx.surge(s.ents, g, gdt) : false;
      if (!surged && g.fx.ability) g.fx.ability(s.ability, s.ents, g, gdt);
      consumeFx(s);
      if (g.debugDraw) g.debugDraw.update(s, alpha, g);
    } else {
      g.players.begin(); g.players.end(); g.shadows.begin(); g.shadows.end();
    }
    g.fx.update(gdt, g);
    g.camera.update(s, alpha, dt, g);
    g.weather.update(dt, g.camera.target, g.camera.cam);
    if (g.field.fade) g.field.fade(g.camera.cam, dt);
    g.stadium.update(dt, S.time, g.camera.cam, g.camera.dist, s && s.hud ? Math.max(-1, Math.min(1, ((s.hud.hs || 0) - (s.hud.as || 0)) / 14)) : 0);
    S.gl.render(g.scene, g.camera.cam);
  }

  // ---------------------------------------------------------------------------------------------
  // Celebration director (render-only): picks a celebration per score (seeded + species preference), pulls
  // nearby teammates into group celebrations with visual offsets (never touches gameplay positions), draws
  // ball props, and plays short defensive celebrations after sacks / interceptions.
  // ---------------------------------------------------------------------------------------------
  const SOLO = ['spike', 'robot', 'moonwalk', 'worm', 'pushups', 'flex', 'salute', 'snowangel', 'sprinkler', 'phone', 'heart', 'dab', 'groundspin', 'leap'];
  const GROUPS = ['sword', 'bowl', 'grouphop'];
  const PREF = {
    L: { flex: 3, stomp: 3, bowl: 2, pushups: 2, robot: 1 }, S: { worm: 2, moonwalk: 2, heart: 2, groundspin: 2, leap: 2 },
    bird: { flap: 3, salute: 2, heart: 2, sprinkler: 2 }, hop: { hop: 3, leap: 3, grouphop: 2 }
  };
  const BIRDS = { chicken: 1, duck: 1, eagle: 1, owl: 1, penguin: 1, ostrich: 1 };
  function seeded(n) { let x = n >>> 0; return function () { x = (x + 0x6D2B79F5) >>> 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pickCele(rig, pid, s, mates) {
    if (R._forceCele) return R._forceCele;
    const sp = rig.sp || (rig.info && rig.info.sp) || '';
    const w = {};
    const base = rig.info.dance || 'hop';
    w[base] = 4;
    SOLO.forEach((k) => { w[k] = (w[k] || 0) + 1; });
    if (mates >= 1) w.sword = 1.2;
    if (mates >= 3) { w.bowl = 1.4; w.grouphop = 1.4; }
    const size = rig.info.sz || 'M';
    const add = (o) => { if (o) Object.keys(o).forEach((k) => { if (w[k] != null || GROUPS.indexOf(k) < 0 || (k === 'bowl' && mates >= 3) || (k === 'grouphop' && mates >= 3)) w[k] = (w[k] || 0) + o[k]; }); };
    add(PREF[size]); if (BIRDS[sp]) add(PREF.bird); if (base === 'hop') add(PREF.hop);
    if (s.wxk === 'snow') w.snowangel = (w.snowangel || 0) + 3;
    const rnd = seeded((pid * 7919) ^ (((s.hud && (s.hud.hs + s.hud.as)) || 0) * 104729) ^ ((s.fxSeq || 0) * 31) ^ (S.seedMix || 0));
    let tot = 0; Object.keys(w).forEach((k) => { tot += w[k]; });
    let r = rnd() * tot;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return base;
  }

  /** body footprint radius in yd (visual, by size class; L animals need more room) */
  function fpOf(e) { const z = (PT.C.SIZES[e.sz] || PT.C.SIZES.M).scale; return 0.95 * z + (z > 1.1 ? 0.2 : 0); }

  /**
   * Stage a group celebration: size-aware slots for the joiners, clamped to the field, plus "keep-out" zones that
   * push every other body (both teams) out of the way, render-only. Returns false (→ solo) when a downed opponent
   * lies inside the area, since a lying body can't be moved cleanly.
   */
  function layoutGroup(s, i, style, need, fa, mates) {
    const g = G, C = g.cele, ents = s.ents, sc = ents[i];
    const fx = -Math.sin(fa), fy = Math.cos(fa), rx = Math.cos(fa), ry = Math.sin(fa);
    const fpS = fpOf(sc);
    let fpM = 0;
    for (let m = 0; m < need; m++) fpM = Math.max(fpM, fpOf(ents[mates[m][1]]));
    const zones = C.zones; zones.length = 0;
    const clampX = (x) => Math.max(1.2, Math.min(52.1, x)), clampY = (y) => Math.max(0.8, Math.min(119.2, y));
    if (style === 'sword') {
      const d = fpS + fpM + 0.9;
      const sl = C.slots[0]; sl.x = clampX(sc.x + fx * d); sl.y = clampY(sc.y + fy * d); sl.fa = fa + Math.PI;
      zones.push({ x: (sc.x + sl.x) / 2, y: (sc.y + sl.y) / 2, r: d / 2 + Math.max(fpS, fpM) + 0.6 });
    } else if (style === 'bowl') {
      const lane = 5 + fpS, lat = 2 * fpM + 0.35;
      [[lane, 0], [lane + 2 * fpM + 0.3, -lat / 2], [lane + 2 * fpM + 0.3, lat / 2]].forEach((o, m) => {
        const sl = C.slots[m]; sl.x = clampX(sc.x + fx * o[0] + rx * o[1]); sl.y = clampY(sc.y + fy * o[0] + ry * o[1]); sl.fa = fa + Math.PI;
      });
      zones.push({ x: sc.x, y: sc.y, r: fpS + 1.0 });
      for (let k = 1; k <= 3; k++) zones.push({ x: sc.x + fx * lane * k / 3.3, y: sc.y + fy * lane * k / 3.3, r: 1.0 });   // the ball's lane
      zones.push({ x: sc.x + fx * (lane + fpM), y: sc.y + fy * (lane + fpM), r: lat / 2 + fpM + 1.2 });
    } else {
      // ring: far enough that neighbours don't overlap (chord ≥ 2·fp) and clear of the scorer
      const R = Math.max(fpS + fpM + 0.45, (fpM + 0.25) / Math.sin(Math.PI / need), 2.3);
      for (let m = 0; m < need; m++) {
        const a = m / need * Math.PI * 2 + 0.6, ox = Math.cos(a) * R, oy = Math.sin(a) * R;
        const sl = C.slots[m]; sl.x = clampX(sc.x + ox); sl.y = clampY(sc.y + oy); sl.fa = Math.atan2(sl.x - sc.x, -(sl.y - sc.y));
      }
      zones.push({ x: sc.x, y: sc.y, r: R + fpM + 0.5 });
    }
    // a downed opponent inside the area → no group celebration
    for (let j = 0; j < ents.length && j < 16; j++) {
      if (j === i || ents[j].tm === sc.tm) continue;
      const e = ents[j];
      if (e.an !== 'down' && e.an !== 'tackled' && e.an !== 'dive') continue;
      for (let z = 0; z < zones.length; z++) if (Math.hypot(e.x - zones[z].x, e.y - zones[z].y) < zones[z].r + fpOf(e)) return false;
    }
    C.active = true; C.idx = i; C.style = style; C.t = 0; C.k = 0; C.n = need;
    for (let m = 0; m < need; m++) C.members[m] = mates[m][1];
    for (let m = need; m < C.members.length; m++) C.members[m] = -1;
    return true;
  }

  function celeDirector(s, alpha, dt) {
    const g = G, ents = s.ents, C = g.cele;
    s.wxk = g.wx.k;
    // starts
    for (let i = 0; i < ents.length && i < 16; i++) {
      const on = ents[i].an === 'celebrate';
      if (on && !g.celePrev[i]) {
        const rig = rigFor(ents[i]);
        // teammates near the scorer (for group celebrations)
        const mates = [];
        for (let j = 0; j < ents.length && j < 16; j++) {
          if (j === i || ents[j].tm !== ents[i].tm || ents[j].an === 'celebrate') continue;
          const d = Math.hypot(ents[j].x - ents[i].x, ents[j].y - ents[i].y);
          if (d < 16) mates.push([d, j]);
        }
        mates.sort((a, b) => a[0] - b[0]);
        let style = pickCele(rig, ents[i].pid, s, C.active ? 0 : mates.length);
        let need = R.Animate.GROUP[style] || 0;
        if (need && (C.active || mates.length < need)) { style = rig.info.dance || 'hop'; need = 0; }
        g.st[i].cele = style;
        // face the camera (fans + viewer); sword / bowling play out sideways toward the field centre; the leap keeps
        // heading for the stands. Render-only: gameplay facing is untouched.
        const ud = s.udir || 1, lat = ents[i].x < MIDX ? 1 : -1;
        const faceCam = ud > 0 ? Math.PI : 0;
        let cfa = faceCam;
        if (style === 'leap') cfa = ents[i].fa || 0;
        else if (style === 'sword' || style === 'bowl') cfa = -lat * Math.PI / 2;
        g.celeFa[i] = cfa;
        if (need && mates.length >= need && !layoutGroup(s, i, style, need, cfa, mates)) {
          style = rig.info.dance || 'hop';                       // can't stage it cleanly → solo
          g.st[i].cele = style; g.celeFa[i] = faceCam;
        }
      }
      if (!on && g.celePrev[i]) g.st[i].cele = null;
      g.celePrev[i] = on;
    }
    // group progress / end
    if (C.active) {
      C.t += dt;
      const sc = ents[C.idx];
      if (!sc || sc.an !== 'celebrate') { C.k = Math.max(0, C.k - dt / 0.3); if (C.k <= 0) { C.active = false; for (let m = 0; m < C.members.length; m++) C.members[m] = -1; } }
      else C.k = Math.min(1, C.t / 0.5);
    }
    // defensive mini celebrations (sack / INT): wait for the whistle, play ~1.6 s, stop at the next line-up
    const M = g.mini;
    if (M.pid >= 0) {
      if (M.t < 0) {
        if (s.phase !== 'LIVE') { M.idx = -1; for (let i = 0; i < ents.length && i < 16; i++) if (ents[i].pid === M.pid) M.idx = i; M.t = M.idx >= 0 ? 0 : -1; if (M.idx < 0) M.pid = -1; }
      } else {
        M.t += dt;
        if (M.t > 1.7 || s.phase === 'PRESNAP' || s.phase === 'LIVE' || !ents[M.idx] || ents[M.idx].pid !== M.pid) { M.pid = -1; M.t = -1; M.idx = -1; }
      }
    }
  }

  /** visual override for entity i: fills proxy and returns it (or null = use the snapshot entity) */
  function celeProxy(i, e, x, y) {
    const g = G, C = g.cele, M = g.mini;
    const pr = g.proxy[i];
    if (M.idx === i && M.t >= 0 && (e.an === 'idle' || e.an === 'stance' || e.an === 'run' || e.an === 'down' || e.an === 'tackle')) {
      pr.an = 'celebrate'; pr.at = M.t; pr.cele = M.style; pr.spd = 0; pr.z = 0; pr.ball = false;
      pr.px = pr.x = x; pr.py = pr.y = y; pr.vx = x; pr.vy = y; pr.vfa = (G.udir || 1) > 0 ? Math.PI : 0; pr.vk = Math.min(1, M.t * 3); pr.vmove = true;
      return pr;
    }
    if (!C.active) return null;
    let member = false;
    for (let m = 0; m < C.members.length; m++) if (C.members[m] === i) member = true;
    if (!member && i !== C.idx) {
      // keep-out: ease this body (either team) to the edge of any celebration zone it stands in (render-only)
      let px = x, py = y, moved = false;
      const fp = fpOf(e);
      for (let z = 0; z < C.zones.length; z++) {
        const zn = C.zones[z], dx = px - zn.x, dy = py - zn.y, d = Math.hypot(dx, dy), need = zn.r + fp;
        if (d < need) {
          const ux = d > 0.05 ? dx / d : (e.tm === G.last.ents[C.idx].tm ? 1 : -1), uy = d > 0.05 ? dy / d : 0;
          px = zn.x + ux * need; py = zn.y + uy * need; moved = true;
        }
      }
      if (!moved) return null;
      const k = C.k * C.k * (3 - 2 * C.k);
      pr.an = e.an; pr.at = e.at; pr.spd = 0; pr.z = e.z || 0; pr.ball = e.ball; pr.cele = null;
      pr.vx = x + (px - x) * k; pr.vy = y + (py - y) * k; pr.vfa = null; pr.vmove = true;
      pr.px = pr.x = pr.vx; pr.py = pr.y = pr.vy;
      return pr;
    }
    for (let m = 0; m < C.members.length; m++) {
      if (C.members[m] !== i) continue;
      const sl = C.slots[m], k = C.k * C.k * (3 - 2 * C.k);
      pr.vx = x + (sl.x - x) * k; pr.vy = y + (sl.y - y) * k; pr.vfa = sl.fa; pr.vk = k; pr.vmove = true;
      pr.px = pr.x = pr.vx; pr.py = pr.y = pr.vy; pr.z = 0; pr.spd = 0; pr.ball = false;
      const t = C.t;
      if (C.style === 'sword') { pr.an = 'celebrate'; pr.cele = 'sword2'; pr.at = t; }
      else if (C.style === 'grouphop') { pr.an = 'celebrate'; pr.cele = 'grouphop'; pr.at = t; }
      else { const hit = 1.05 + m * 0.08; if (t < hit) { pr.an = 'stance'; pr.at = t; } else { pr.an = 'tackled'; pr.at = t - hit; } pr.cele = null; }
      return pr;
    }
    return null;
  }

  function drawPlayers(s, alpha, dt) {
    const g = G, P = g.players, SH = g.shadows;
    const ents = s.ents;
    const fog = g.wx.k === 'fog';
    P.begin(); SH.begin();
    const fk = 1 - Math.exp(-dt * 16);
    const by = s.ball ? s.ball.py + (s.ball.y - s.ball.py) * alpha : 60;
    celeDirector(s, alpha, dt);
    for (let i = 0; i < ents.length && i < 16; i++) {
      const e = ents[i];
      const rig = rigFor(e);
      const st = g.st[i], pose = g.pose[i];
      const ka = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 3 ? 1 : alpha;      // teleport (line-up): no lerp
      let x = e.px + (e.x - e.px) * ka, y = e.py + (e.y - e.py) * ka;
      const z = (e.pz || 0) + ((e.z || 0) - (e.pz || 0)) * ka;
      if (!g.faInit[i] || st.pid !== e.pid) { g.fa[i] = e.fa || 0; g.faInit[i] = 1; st.pid = e.pid; }
      else g.fa[i] = lerpAngle(g.fa[i], e.fa || 0, fk);
      if (e.an === 'celebrate' && st.cele && g.celeFa) g.fa[i] = lerpAngle(g.fa[i], g.celeFa[i], Math.min(1, dt * 8));
      const pr = celeProxy(i, e, x, y);
      if (pr && pr.vmove) { x = pr.vx; y = pr.vy; if (pr.vfa != null) g.fa[i] = lerpAngle(g.fa[i], pr.vfa, Math.min(1, fk * 2 * (pr.vk || 1))); }
      R.Animate.pose(pose, pr || e, st, rig.info, dt);
      const sc = rig.scale;
      _q.setFromAxisAngle(_v.set(0, 1, 0), g.fa[i]);
      _m.compose(_v2.set(x - MIDX, z, 60 - y), _q, _v.set(sc, sc, sc));
      let tint = null;
      if (fog && Math.abs(y - by) > 25) { _tint[0] = 0.55; _tint[1] = 0.58; _tint[2] = 0.63; tint = _tint; }
      R.Voxel.poseRig(rig, pose, _m, P, SH, tint);
      R.Voxel.headPos(rig, g.head[i]);
      R.Voxel.handPos(rig, g.hand[i]);
      g.vx[i] = x; g.vy[i] = y;
    }
    celeBall(s);
    drawBall(s, alpha);
    drawSideline(s, dt);
    P.end(); SH.end();
  }

  // ball: chunky voxel football (fat middle, tapered pointed tips, white laces + stripes), ~1.5× the old size.
  // held → in the carrier's hand; in flight → points along velocity with a spiral. Teleports (snap.ball.tp, or a jump
  // > 3 yd between ticks: re-spot / new play) are never interpolated, streaked or trailed.
  let ballSpin = 0;
  // football parts in ball-local units (length along z): [cx, cy, cz, w, h, d, r, g, b]
  const BALL = [
    [0, 0, 0, 0.42, 0.42, 0.44, 0.58, 0.3, 0.16],
    [0, 0, 0.27, 0.34, 0.34, 0.12, 0.55, 0.28, 0.15],
    [0, 0, -0.27, 0.34, 0.34, 0.12, 0.55, 0.28, 0.15],
    [0, 0, 0.37, 0.22, 0.22, 0.1, 0.5, 0.26, 0.14],
    [0, 0, -0.37, 0.22, 0.22, 0.1, 0.5, 0.26, 0.14],
    [0, 0, 0.44, 0.1, 0.1, 0.06, 0.45, 0.23, 0.12],
    [0, 0, -0.44, 0.1, 0.1, 0.06, 0.45, 0.23, 0.12],
    [0, 0.215, 0, 0.06, 0.03, 0.26, 1, 1, 1],                                  // lace seam
    [0, 0.22, -0.08, 0.14, 0.03, 0.035, 1, 1, 1], [0, 0.22, 0, 0.14, 0.03, 0.035, 1, 1, 1], [0, 0.22, 0.08, 0.14, 0.03, 0.035, 1, 1, 1],
    [0, 0, 0.3, 0.355, 0.355, 0.03, 1, 1, 1], [0, 0, -0.3, 0.355, 0.355, 0.03, 1, 1, 1]   // white stripes near the tips
  ];
  const BALL_SCALE = 1.25;
  let ballLast = { x: 0, y: 0, z: 0, ok: false };
  /** ball prop for spike / ground-spin / bowling celebrations (render-only) */
  function celeBall(s) {
    const g = G;
    g.celeBallOn = false;
    const ents = s.ents;
    for (let i = 0; i < ents.length && i < 16; i++) {
      const style = g.st[i].cele;
      if (!style || !R.Animate.BALLPROP[style] || ents[i].an !== 'celebrate') continue;
      const t = ents[i].at != null ? ents[i].at : g.st[i].t;
      const fa = g.fa[i], fx = -Math.sin(fa), fz = -Math.cos(fa);
      let d = 0, y = 0.2, yaw = fa;
      if (style === 'spike') { if (t < 0.45) return; const u = t - 0.45; d = 0.8; y = 0.2 + Math.abs(Math.sin(u * 9)) * 1.4 * Math.exp(-u * 2.5); yaw = fa + u * 8; }
      else if (style === 'groundspin') { if (t < 0.25) return; d = 1.0; yaw = t * 26; }
      else if (style === 'bowl') { if (t < 0.7) return; d = 0.8 + Math.min(4.4, (t - 0.7) * 12); yaw = fa; }
      g.celeBallOn = true;
      g.cbx = g.vx[i] - MIDX + fx * d; g.cby = y; g.cbz = 60 - g.vy[i] + fz * d; g.cbyaw = yaw;
      return;
    }
  }

  function drawBall(s, alpha) {
    const b = s.ball;
    if (!b) return;
    const g = G;
    let x, y, z, yaw = 0, pitch = 0;
    let held = b.st === 'held' && b.car >= 0 && b.car < 16;
    if (g.celeBallOn) held = false;
    const jump = Math.hypot((b.x || 0) - (b.px || 0), (b.y || 0) - (b.py || 0)) > 3;
    const tp = !!b.tp || jump;
    if (held) {
      const hp = g.hand[b.car];
      x = hp.x; y = hp.y; z = hp.z;
      yaw = g.fa[b.car];
      pitch = -0.3;
    } else {
      const k = tp ? 1 : alpha;
      const fx = b.px + (b.x - b.px) * k, fy = b.py + (b.y - b.py) * k;
      x = fx - MIDX; z = 60 - fy; y = Math.max(0.2, (tp ? (b.z || 0) : (b.pz || 0) + ((b.z || 0) - (b.pz || 0)) * alpha) + 0.2);
      if (!tp) {
        const vx = b.x - b.px, vy = b.y - b.py, vz = (b.z || 0) - (b.pz || 0);
        const hv = Math.hypot(vx, vy);
        if (hv > 0.01) { yaw = Math.atan2(-vx, vy); pitch = Math.atan2(vz, hv); }
        if (b.st === 'air' || b.st === 'kick') ballSpin += 0.6; else if (b.st === 'loose') ballSpin += 0.25;
        // ribbon only on real passes in flight (never on a re-spot, never when the frame-to-frame jump is huge)
        const moved = ballLast.ok ? Math.hypot(x - ballLast.x, z - ballLast.z) : 0;
        if (b.st === 'air' && b.kind !== 'spot' && g.fx && hv > 0.25 && hv < 2.5 && moved < 3) g.fx.trail(x, y, z, hv > 0.6);
      } else if (b.st === 'dead' || b.st === 'spot') { yaw = 0; }
    }
    if (g.celeBallOn) { x = g.cbx; y = g.cby; z = g.cbz; yaw = g.cbyaw; pitch = 0; }
    ballLast.x = x; ballLast.y = y; ballLast.z = z; ballLast.ok = true;
    _e.set(pitch, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    if (!held && !tp && (b.st === 'air' || b.st === 'kick')) { _ballQ.setFromAxisAngle(_v.set(0, 0, 1), ballSpin); _q.multiply(_ballQ); }
    if (!held && !tp && b.st === 'loose') { _ballQ.setFromAxisAngle(_v.set(1, 0, 0), ballSpin); _q.multiply(_ballQ); }
    const stretch = !held && !tp && b.st === 'air' ? 1.1 : 1;
    const S0 = BALL_SCALE;
    _m.compose(_v2.set(x, y, z), _q, _ballS.set(S0, S0, S0 * stretch));
    for (let i = 0; i < BALL.length; i++) {
      const p = BALL[i];
      _m2.compose(_v.set(p[0], p[1], p[2]), _ballQ.identity(), _ballS.set(p[3], p[4], p[5]));
      _m2.premultiply(_m);
      g.players.add(_m2, p[6], p[7], p[8]);
    }
    // ball shadow straight down (readable for catching)
    if (!held) {
      _m.compose(_v2.set(x, y, z), _q, _ballS.set(0.42 * S0 + y * 0.02, 0.42 * S0, 0.8 * S0 + y * 0.02));
      _m2.multiplyMatrices(_projDown, _m);
      g.shadows.add(_m2, 1, 1, 1);
    }
    g.ballPos = g.ballPos || new T.Vector3();
    g.ballPos.set(x, y, z);
  }

  // ---------------------------------------------------------------------------------------------
  // sideline life: bench subs (real bench players), coach with headset, mascot, chain crew, photographers
  // (all in the players' instanced batch → no extra draw calls; static tables / coolers / cart live in stadium.js)
  // ---------------------------------------------------------------------------------------------
  const HWF = 26.667;
  /** sideline life per quality tier (phones first: low = a lighter sideline) */
  const SIDE = {
    low: { bench: 5, staff: 1, trainer: 0, kicker: 0, cheer: 0, photo: 2, ballboys: 0 },
    med: { bench: 8, staff: 2, trainer: 1, kicker: 1, cheer: 3, photo: 6, ballboys: 2 },
    high: { bench: 10, staff: 2, trainer: 1, kicker: 1, cheer: 4, photo: 8, ballboys: 4 }
  };
  function buildSideline(g, q) {
    const A = [];
    const T0 = SIDE[q.name] || SIDE.med;
    const BN = (R.Stadium && R.Stadium.BENCH) || { top0: 0.42, top1: 0.78, dx0: 4.3, dx1: 5.4 };
    const mk = (pl, team, scale) => { const rig = makeRig(pl, team, q); if (scale) rig.scale *= scale; return rig; };
    const actor = (rig, wx, wz, fa, kind, extra) => {
      const a = Object.assign({ rig: rig, wx: wx, wz: wz, fa: fa, kind: kind, st: R.Animate.state(), P: R.Voxel.newPose(),
        e: { an: 'idle', at: -1, spd: 0, z: 0, ball: false }, tz: wz, tx: wx, ph: Math.random() * 6.28, seat: 0 }, extra || {});
      A.push(a); return a;
    };
    const staffKit = (col) => ({ pri: col.pri, sec: col.sec, acc: 0xC8B48A });
    [g.home, g.away].forEach((t, ti) => {
      const sgn = ti === 0 ? -1 : 1, kit = g.kits[ti], col = g.cols[ti];
      const face = sgn < 0 ? -Math.PI / 2 : Math.PI / 2;
      // bench: the real non-starters in kit — some sit on the two bench rows, some stand at the sideline
      const starters = new Set();
      if (t.dc) Object.keys(t.dc).forEach((k) => { if (t.dc[k] && t.dc[k].length) starters.add(t.dc[k][0]); });
      const kickerPid = t.dc && t.dc.K ? t.dc.K[0] : -1;
      const bench = (t.pl || []).filter((p) => !starters.has(p.pid) || p.pid === kickerPid).filter((p) => p.pid !== kickerPid).slice(0, T0.bench);
      while (bench.length < Math.min(4, T0.bench)) bench.push({ sp: ['dog', 'pig', 'cat', 'goat'][bench.length], num: 40 + bench.length, cs: bench.length % 2, look: {} });
      bench.forEach((p, k) => {
        const sit = k % 2 === 1;                                    // half sit, half stand at the white border
        const row = sit ? (k % 2) : -1;
        const z = -23 + (k / Math.max(1, bench.length - 1)) * 46 + (Math.random() - 0.5) * 1.5;
        const dx = sit ? (row ? BN.dx1 : BN.dx0) - 0.05 : 1.5 + Math.random() * 0.9;
        actor(mk(p, kit), sgn * (HWF + dx), z, face + (sit ? 0 : (Math.random() - 0.5) * 0.5), 'bench', { team: ti, seat: sit ? (row ? BN.top1 : BN.top0) : 0 });
      });
      // head coach (polo in team colors, khakis, headset) + a headset coordinator, both follow the LOS
      const coachSp = ['bear', 'owl', 'goat', 'walrus', 'dog'][(t.tid || 0) % 5];
      actor(mk({ sp: coachSp, num: -1, cs: 0, look: { acc: 'headset' }, noHelmet: true }, staffKit(col)), sgn * (HWF + 1.5), -1, face, 'coach', { team: ti, off: 0 });
      if (T0.staff > 1) actor(mk({ sp: ['monkey', 'penguin', 'fox', 'beaver'][(t.tid || 0) % 4], num: -1, cs: 1, look: { acc: 'headset' }, noHelmet: true }, staffKit(col)), sgn * (HWF + 2.1), -3, face, 'coach', { team: ti, off: -3.5 });
      // trainer by the medical cart
      if (T0.trainer) actor(mk({ sp: 'owl', num: -1, cs: 1, look: {}, noHelmet: true }, { pri: 0xffffff, sec: 0xE63B2E, acc: 0x2b2b30 }), sgn * (HWF + 2.0), -29, face, 'staff', { team: ti });
      // the kicker warming up into the net (real K in kit)
      if (T0.kicker) {
        const kp = (t.pl || []).find((p) => p.pid === kickerPid) || { sp: 'kangaroo', num: 3, cs: 0, look: {} };
        actor(mk(kp, kit), sgn * (HWF + 3.6), 28.5, 0, 'kicker', { team: ti });
      }
    });
    // home mascot (big, no helmet, no number) + cheer squad with pom-poms behind the home bench
    const hsp = g.home && R.Models.has(g.home.sp) ? g.home.sp : 'frog';
    actor(mk({ sp: hsp, num: -1, cs: 0, look: {}, noHelmet: true }, g.kits[0], 1.45), -(HWF + 2.2), 16, -Math.PI / 2, 'mascot', { team: 0 });
    const cheerKit = { pri: 0xffffff, sec: g.cols[0].pri, acc: g.cols[0].pri };
    for (let k = 0; k < T0.cheer; k++) actor(mk({ sp: ['cat', 'rabbit', 'fox', 'squirrel'][k % 4], num: -1, cs: k % 2, look: { acc: 'pompom' }, noHelmet: true }, cheerKit), -(HWF + 1.9), (k % 2 ? 1 : -1) * (31 + (k >> 1) * 3.2), -Math.PI / 2, 'cheer', { team: 0 });
    // chain crew on the away sideline (orange vests): line-to-gain pole, chain start pole, down marker
    const vest = { pri: 0xFF7B1C, sec: 0xffffff, acc: 0x2b2b2b };
    ['pig', 'goat', 'beaver'].forEach((sp, k) => actor(mk({ sp: sp, num: -1, cs: k % 2, look: {}, noHelmet: true }, vest), HWF + 1.6, 0, Math.PI / 2, 'chain', { k: k }));
    // TV cameraman riding a cart on rails (home side), tracking the line of scrimmage
    const press = { pri: 0x3a3f4b, sec: 0xffffff, acc: 0x2b2b2b };
    actor(mk({ sp: 'raccoon', num: -1, cs: 1, look: { acc: 'camera' }, noHelmet: true }, press), -(HWF + 1.35), 0, -Math.PI / 2, 'cam');
    // photographers kneeling along both end lines
    for (let k = 0; k < T0.photo; k++) {
      const end = k % 2, side = (k >> 1) % 2 ? 1 : -1, wz = end === 0 ? 61.7 : -61.7;
      const xx = side * (HWF - 6 - (k >> 2) * 7);
      actor(mk({ sp: ['raccoon', 'cat', 'owl', 'rabbit', 'goat', 'penguin', 'fox', 'dog'][k % 8], num: -1, cs: k % 2, look: { acc: 'camera' }, noHelmet: true }, press), xx, wz, end === 0 ? 0 : Math.PI, 'photo');
    }
    // ball boys (small, grey staff shirts) jogging between their spots near the 20s
    const bbKit = { pri: 0x8a8f99, sec: 0xffffff, acc: 0x2b2b30 };
    for (let k = 0; k < T0.ballboys; k++) {
      const side = k % 2 ? 1 : -1, z0 = (k >> 1) % 2 ? 34 : -34;
      actor(mk({ sp: k % 2 ? 'hamster' : 'squirrel', num: -1, cs: 0, look: {}, noHelmet: true }, bbKit), side * (HWF + 1.2), z0, side < 0 ? -Math.PI / 2 : Math.PI / 2, 'ballboy', { z0: z0 });
    }
    return A;
  }

  function drawSideline(s, dt) {
    const g = G, A = g.side;
    if (!A) return;
    const P = g.players;
    g.sideCheer[0] = Math.max(0, g.sideCheer[0] - dt); g.sideCheer[1] = Math.max(0, g.sideCheer[1] - dt);
    g.sideSad[0] = Math.max(0, g.sideSad[0] - dt); g.sideSad[1] = Math.max(0, g.sideSad[1] - dt);
    const t = S.time;
    const dir = s.dir || 1, los = s.los || 60, fd = s.fd || los + 10 * dir;
    const hideChain = !!g.markHide;
    for (let i = 0; i < A.length; i++) {
      const a = A[i], e = a.e;
      let an = 'idle', spd = 0, lift = 0;
      const cheer = a.team != null && g.sideCheer[a.team] > 0, sad = a.team != null && g.sideSad[a.team] > 0;
      if (a.kind === 'bench' || a.kind === 'coach' || a.kind === 'staff') {
        if (cheer) an = 'celebrate'; else if (sad) an = 'sad';
        if (a.kind === 'coach' && an === 'idle') a.tz = Math.max(-24, Math.min(24, 60 - los)) + (a.off || 0) + Math.sin(t * 0.3 + a.ph) * 2;
        if (a.kind === 'bench' && a.seat && an !== 'celebrate') { an = 'sit'; lift = a.seat; }     // big play → they jump up
      } else if (a.kind === 'mascot') {
        an = g.sideCheer[0] > 0 || ((t + a.ph) % 9) > 6.5 ? 'celebrate' : 'idle';
      } else if (a.kind === 'cheer') {
        an = g.sideCheer[0] > 0 || ((t * 0.7 + a.ph) % 5) > 3.2 ? 'celebrate' : 'idle';
      } else if (a.kind === 'chain') {
        if (!hideChain) { const y = a.k === 0 ? fd : a.k === 1 ? fd - 10 * dir : los; a.tz = 60 - Math.max(0, Math.min(120, y)); }
      } else if (a.kind === 'photo') {
        an = 'stance';
      } else if (a.kind === 'cam') {
        a.tz = 60 - Math.max(12, Math.min(108, los - 3 * dir));
        lift = 0.55;
        if (Math.abs(a.tz - a.wz) < 0.4) an = 'stance';
      } else if (a.kind === 'kicker') {
        const c = (t + a.ph) % 3.2;
        if (c < 0.45) { an = 'run'; spd = 3; a.wz = 28.5 - c * 2.2; } else if (c < 0.85) { an = 'kick'; e.at = c - 0.45; a.wz = 27.5; } else { an = 'idle'; a.wz = 27.5 + Math.min(1, (c - 0.85)) ; }
      } else if (a.kind === 'ballboy') {
        a.tz = a.z0 + (((t * 0.15 + a.ph) % 2) < 1 ? 0 : -6 * Math.sign(a.z0));
      }
      // walk toward the target spot (not the kicker: scripted above; not riders)
      let dz = 0;
      if (a.kind !== 'kicker') {
        dz = a.tz - a.wz; const dist = Math.abs(dz);
        if (dist > 0.05) {
          const fast = a.kind === 'chain' || a.kind === 'cam';
          const step = Math.min(dist, (fast ? 7 : a.kind === 'coach' ? 3 : 1.8) * dt);
          a.wz += Math.sign(dz) * step;
          if (dist > 0.4 && a.kind !== 'cam') { an = 'run'; spd = fast ? 6 : 2.5; lift = 0; }
        }
      }
      e.an = an === 'sit' ? 'idle' : an; e.spd = spd; if (a.kind !== 'kicker' || an !== 'kick') e.at = -1;
      R.Animate.pose(a.P, e, a.st, a.rig.info, dt);
      const sc = a.rig.scale;
      if (an === 'sit') {
        // hips on the bench, legs straight forward (toy pose); slight idle sway
        const hip = a.rig.piv[16];
        a.P.y = lift / sc - hip; a.P.llx = a.P.lrx = 1.45; a.P.brx = -0.05; a.P.alx = a.P.arx = 0.5;
        a.P.hry = Math.sin(t * 0.7 + a.ph) * 0.35;
      } else if (lift) a.P.y += lift / sc;
      const fa = an === 'run' && a.kind !== 'kicker' ? (dz < 0 ? 0 : Math.PI) : a.fa;
      _q.setFromAxisAngle(_v.set(0, 1, 0), fa);
      _m.compose(_v2.set(a.wx, 0, a.wz), _q, _v.set(sc, sc, sc));
      R.Voxel.poseRig(a.rig, a.P, _m, P, null, null);           // sideline actors: no planar shadows (perf)
      if (a.kind === 'cam') {
        // camera cart on the rails
        P.addBox(a.wx, 0.3, a.wz, 0.95, 0.4, 1.3, 0.25, 0.27, 0.32);
        P.addBox(a.wx, 0.08, a.wz - 0.5, 1.0, 0.16, 0.2, 0.12, 0.12, 0.14); P.addBox(a.wx, 0.08, a.wz + 0.5, 1.0, 0.16, 0.2, 0.12, 0.12, 0.14);
      } else if (a.kind === 'chain' && !hideChain) {
        // pole + marker: orange stick, black top (chain poles) / down box with the down number
        const px = a.wx - 0.55;
        P.addBox(px, 1.3, a.wz, 0.12, 2.6, 0.12, 0.15, 0.15, 0.17);
        if (a.k < 2) P.addBox(px, 2.7, a.wz, 0.42, 0.42, 0.42, 1, 0.48, 0.1);
        else {
          P.addBox(px, 2.85, a.wz, 0.16, 0.8, 0.8, 1, 0.48, 0.1);
          downDigit(px - 0.1, 2.85, a.wz, (s.hud && s.hud.down) || 1);
        }
      } else if (a.kind === 'kicker') {
        P.addBox(a.wx, 0.2, 27.0 - (an === 'idle' ? 6 : 0), 0.22, 0.22, 0.32, 0.58, 0.3, 0.16);   // practice ball (in the net after the kick)
      }
    }
    // the chain between the two chain poles
    if (!hideChain) {
      let za = null, zb = null, cx = 0;
      for (let i = 0; i < A.length; i++) { const a = A[i]; if (a.kind === 'chain' && a.k === 0) { za = a.wz; cx = a.wx - 0.55; } if (a.kind === 'chain' && a.k === 1) zb = a.wz; }
      if (za != null && zb != null) P.addBox(cx, 0.35, (za + zb) / 2, 0.06, 0.06, Math.abs(za - zb), 0.75, 0.75, 0.78);
    }
  }
  /** white pixel digit on the down marker (faces the field / −x) */
  function downDigit(x, y, z, d) {
    const gl = R.Models.FONT[String(Math.max(1, Math.min(4, d | 0)))];
    if (!gl) return;
    const px = 0.13;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (gl[r][c] !== '1') continue;
      G.players.addBox(x, y + (2 - r) * px, z + (c - 1) * px * (G.udir || 1), 0.04, px, px, 1, 1, 1);
    }
  }

  function consumeFx(s) {
    const g = G;
    if (!s.fx || s.fxSeq == null) return;
    if (s.fxSeq < g.lastFx) g.lastFx = 0;               // new game / reset
    if (s.fxSeq === g.lastFx) return;
    const list = s.fx;
    // process in seq order
    for (let pass = 0; pass < list.length; pass++) {
      let best = null;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (f.seq > g.lastFx && (!best || f.seq < best.seq)) best = f;
      }
      if (!best) break;
      g.lastFx = best.seq;
      handleFx(best, s);
    }
  }

  function handleFx(f, s) {
    const g = G;
    g.fx.spawn(f, s, g);
    if (f.k === 'td') {
      g.stadium.cheer(1.0); g.camera.cue('celebrate');
      const ti = g.away && f.tid === g.away.tid ? 1 : g.home && f.tid === g.home.tid ? 0 : (s.poss || 0);
      g.sideCheer[ti] = 3.2; g.sideSad[1 - ti] = 3.2;
    }
    else if (f.k === 'hit') { g.stadium.cheer(0.35); }
    else if (f.k === 'catch') { g.stadium.cheer(0.4); }
    else if (f.k === 'fumble') { g.stadium.cheer(0.6); }
  }

  /**
   * Extra cue for juice the snapshot can't express (optional; Session may call it from bus events).
   * kind: 'slowmo' {dur} · 'shake' {amt} · 'cheer' {amt} · 'flash'
   */
  R.cue = function (kind, o) {
    o = o || {};
    if (!G) return;
    if (kind === 'slowmo') { if (o.user === false) return; G.slow = o.dur || 1.2; G.camera.cue('slowmo', o.dur || 1.2); }
    else if (kind === 'shake') G.camera.shake(o.amt || 0.2);
    else if (kind === 'cheer') G.stadium.cheer(o.amt || 0.6);
  };

  // bus listeners (Session re-emits engine events as game:*)
  function Cm() { return R.Camera; }
  function busHooks() {
    if (!PT.Events || !PT.Events.on || busHooks.done) return;
    busHooks.done = true;
    // slow-mo camera framing on big plays; when the engine says the play isn't the user's (p.user === false) skip it.
    // Feature-detected: events without a `user` field keep the old behaviour.
    const userPlay = (p) => !(p && p.user === false);
    PT.Events.on('game:bigPlay', (p) => { if (G && userPlay(p)) { G.camera.cue('slowmo', (p && p.dur) || 1.2); } });
    PT.Events.on('game:hitstop', (p) => { if (G && userPlay(p)) { G.camera.cue('slowmo', (p && p.dur) || 0.3); } });
    PT.Events.on('game:tackle', (p) => { if (G && p) G.camera.shake(p.big ? 0.2 : 0.08); });
    PT.Events.on('game:firstDown', () => { if (G) G.stadium.cheer(0.4); });
    const teamOf = (tid) => (G.home && G.home.tid === tid ? 0 : G.away && G.away.tid === tid ? 1 : -1);
    const mini = (pid, list) => {
      if (!G || pid == null || pid < 0 || (Cm() && Cm().reduceMotion)) return;
      const r = seeded((pid * 131) ^ ((G.lastFx || 0) * 977) ^ (S.seedMix || 0));
      G.mini.pid = pid; G.mini.t = -1; G.mini.idx = -1; G.mini.style = list[Math.floor(r() * list.length)];
    };
    PT.Events.on('game:sack', (p) => { if (G && p) { mini(p.by, ['flex', 'salute', 'dab', 'robot']); } });
    PT.Events.on('game:turnover', (p) => {
      if (!G) return;
      G.stadium.cheer(0.8);
      if (p && p.kind === 'int') mini(p.by, ['phone', 'salute', 'heart', 'sprinkler']);
      const ti = p ? teamOf(p.tid) : -1;
      if (ti >= 0) { G.sideCheer[ti] = 2.5; G.sideSad[1 - ti] = 2.5; }
    });
    PT.Events.on('game:fieldGoal', (p) => { if (G && p && p.good) G.stadium.cheer(0.8); });
  }

  // ---------------------------------------------------------------------------------------------
  // menu backdrop
  // ---------------------------------------------------------------------------------------------
  function disposeMenu() { if (MENU) { MENU.dispose(); MENU = null; } }
  function drawMenu(dt) {
    if (!MENU) {
      MENU = R.Stadium.menu({ q: S.q, gl: S.gl, VOX: R.VOX, backdrop: S.backdrop, makeRig: makeRig, shadowMaterial: shadowMaterial });
      MENU.cam.aspect = S.w / S.h; MENU.cam.updateProjectionMatrix();
    }
    MENU.update(dt, S.time, S.w / S.h);
    S.gl.render(MENU.scene, MENU.cam);
  }

  // ---------------------------------------------------------------------------------------------
  // screen <-> field mapping
  // ---------------------------------------------------------------------------------------------
  /**
   * Screen direction (x right, y UP) → unit field direction. The user's attack direction is screen-up (R4).
   * @returns {{x:number, y:number}}
   */
  R.screenDirToField = function (dx, dyUp) {
    const u = G ? G.udir : 1;
    return { x: dx * u, y: dyUp * u };
  };

  /** CSS pixels → field point on the ground plane, or null */
  R.screenToField = function (px, py) {
    if (!G || !S.canvas) return null;
    const cam = G.camera.cam;
    _ndc.set(px / S.w * 2 - 1, -(py / S.h) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    return { x: _hit.x + MIDX, y: 60 - _hit.z };
  };

  /** field yards → CSS pixels {x, y, vis} */
  R.fieldToScreen = function (x, y, z) {
    if (!G) return { x: 0, y: 0, vis: false };
    const cam = G.camera.cam;
    _v.set(x - MIDX, z || 0, 60 - y).project(cam);
    const sx = (_v.x + 1) / 2 * S.w, sy = (1 - _v.y) / 2 * S.h;
    return { x: sx, y: sy, vis: _v.z < 1 && sx >= 0 && sy >= 0 && sx <= S.w && sy <= S.h };
  };

  /**
   * Offscreen portrait (cached dataURL). Returns a placeholder at once, then emits 'render:portrait' {key}.
   * @param {Object} player  Player or GameTeam.pl entry
   * @param {number|{pri,sec,acc}} teamCol
   * @param {number} [size=96]
   */
  R.portrait = function (player, teamCol, size) {
    return R.Portrait.get(player, teamCol, size || 96, S.gl);
  };

  // internals for other render files and the dev page
  R._state = S;
  R._game = function () { return G; };
  R._menu = function () { return MENU; };
  R._makeRig = makeRig;
})(globalThis.PT = globalThis.PT || {});
