/* Pixel Touchdown: js/app/debug.js
 * Owner: WP6. Responsibility: PT.Debug: overlay (FPS, draw calls), quick actions, test hooks.
 *
 * Always available (Playwright uses it with ?test=1): events (last 200 bus events), simTo, autoplay,
 * waitFor, count, state, listStubs, actions.*. The overlay (?debug=1, toggle with `) shows FPS, frame ms,
 * engine ms/tick, draw calls, triangles, DPR, quality, phase/week, seed, plus toggles (hitboxes/routes/zones,
 * 2D minimap, 0.25× slow motion, frame step with '.', autoplay) and quick actions (ARCHITECTURE 7.3).
 */
(function (PT) {
  'use strict';
  const Debug = PT.Debug = PT.Debug || {};
  const MAX = 200;
  Debug.enabled = false;
  Debug.events = [];
  Debug.counts = {};
  Debug.autoplayOn = false;
  let el = null, statsEl = null, mini = null, miniG = null, lastSnap = null, miniT = 0, inited = false, statTimer = 0;
  const tog = { hitboxes: false, routes: false, zones: false, minimap: false, slow: false, step: false };
  const waiters = [];

  const doc = () => globalThis.document;
  const emitLog = (name, p) => {
    const e = { name: name, p: p, t: globalThis.performance ? Math.round(globalThis.performance.now()) : 0 };
    Debug.events.push(e);
    if (Debug.events.length > MAX) Debug.events.shift();
    Debug.counts[name] = (Debug.counts[name] || 0) + 1;
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.name === name && Debug.counts[name] >= w.target) { waiters.splice(i, 1); clearTimeout(w.timer); w.res(Debug.counts[name]); }
    }
  };

  /**
   * @param {{overlay?:boolean}} [o] overlay defaults to PT.Flags.debug
   */
  Debug.init = function (o) {
    if (inited) return;
    inited = true;
    Debug.enabled = o && o.overlay != null ? !!o.overlay : !!(PT.Flags && PT.Flags.debug);
    PT.Events.on('*', emitLog);
    if (PT.Flags && PT.Flags.autoplay) Debug.autoplay(true);
    if (Debug.enabled) buildOverlay();
    if (globalThis.addEventListener) globalThis.addEventListener('keydown', onKey);
  };

  // ---------------- test hooks ----------------
  /** Sim the league until a phase ('PLAYOFFS', 'DRAFT', …), 'week:N', a kind ('week','nextSeason'…) or a predicate. */
  Debug.simTo = async function (target, o) {
    if (!PT.App || !PT.App.L) return { ok: false, err: 'NO_LEAGUE' };
    if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: true });
    const r = await PT.App.simUntil(target, Object.assign({ maxSteps: 1200 }, o || {}));
    const L = PT.App.L;
    return Object.assign({}, r, { phase: L.phase, week: L.week, season: L.season, sub: L.sub });
  };
  /** Autopilot drives the user's side (also auto play-calls, PATs, 4th downs, kicks, Star Plays). */
  Debug.autoplay = function (on) {
    Debug.autoplayOn = on !== false;
    if (PT.Session && PT.Session.setAutoplay) PT.Session.setAutoplay(Debug.autoplayOn);
    if (el) refreshButtons();
    return Debug.autoplayOn;
  };
  Debug.listStubs = function () { return PT.listStubs ? PT.listStubs() : []; };
  /** Resolve when `name` has been emitted n more times (counting from now). */
  Debug.waitFor = function (name, n, timeoutMs) {
    const target = (Debug.counts[name] || 0) + (n || 1);
    return new Promise((res, rej) => {
      const w = { name: name, target: target, res: res };
      w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error('timeout waiting for ' + name)); }, timeoutMs || 30000);
      waiters.push(w);
    });
  };
  Debug.count = function (name) { return Debug.counts[name] || 0; };
  Debug.clear = function () { Debug.events.length = 0; Debug.counts = {}; };
  Debug.game = function () { return PT.Session && PT.Session.game ? PT.Session.game() : null; };
  Debug.snapshot = function () { const g = Debug.game(); return g ? g.snapshot() : null; };
  /** compact app state for tests */
  Debug.state = function () {
    const L = PT.App && PT.App.L, cur = PT.UI && PT.UI.current ? PT.UI.current() : null;
    return { screen: cur ? cur.name : null, slot: PT.App ? PT.App.slot : null, phase: L ? L.phase : null, week: L ? L.week : null,
      season: L ? L.season : null, sub: L ? L.sub : null, session: PT.Session && PT.Session.state ? PT.Session.state() : null,
      loop: PT.Loop.stats(), input: PT.Input && PT.Input.mode ? PT.Input.mode() : null, audio: PT.Audio && PT.Audio.state ? PT.Audio.state() : null,
      noGL: PT.App ? PT.App.noGL : null, tainted: PT.App ? PT.App.tainted : null };
  };
  /** called by Session.draw each frame (cheap: keeps a reference for the minimap) */
  Debug.frame = function (snap) { lastSnap = snap; if (tog.minimap && mini) drawMini(); };

  // ---------------- quick actions ----------------
  const L = () => PT.App && PT.App.L;
  const toast = (t, k) => { if (PT.UI && PT.UI.Toast) PT.UI.Toast.show(t, k || 'info', 1500); };
  const changed = (what) => { PT.Events.emit('league:changed', { what: what }); if (PT.UI && PT.UI.refresh) PT.UI.refresh(); };
  Debug.actions = {
    simWeek: () => Debug.simTo('week'),
    simPlayoffs: () => Debug.simTo('PLAYOFFS'),
    simSeasonEnd: () => Debug.simTo('SEASON_END'),
    simDraft: () => Debug.simTo('DRAFT'),
    simFA: () => Debug.simTo('FREE_AGENCY'),
    nextSeason: () => Debug.simTo('nextSeason'),
    cash: () => { const t = L() && L().teams[L().userTid]; if (!t) return; t.fin.coins = (t.fin.coins || 0) + 5000; changed('coins'); toast('+5000 coins'); },
    heal: () => {
      const lg = L(); if (!lg) return;
      lg.players.forEach((p) => { if (p.tid === lg.userTid) { p.inj = null; p.ir = false; } });
      changed('injuries'); toast('Team healed');
    },
    maxOvr: () => {
      const lg = L(); if (!lg) return;
      const Rt = PT.League && PT.League.Ratings;
      lg.players.forEach((p) => {
        if (p.tid !== lg.userTid) return;
        Object.keys(p.r).forEach((k) => { p.r[k] = 99; });
        p.ovr = Rt && Rt.ovr ? Rt.ovr(p) : 99;
      });
      changed('ratings'); toast('User team maxed');
    },
    winGame: () => {
      if (!(PT.Session && PT.Session.active())) { toast('No live game', 'bad'); return; }
      PT.Session.debugWin();
    },
    genEvent: () => {
      const W = PT.League && PT.League.WeeklyEvents;
      if (L() && W && W.generate) { W.generate(L()); changed('events'); toast('Events: ' + L().ev.pending.length); }
    },
    dumpSave: () => { if (L()) PT.Log.info('debug', 'save', JSON.stringify(L()).length + ' chars', L()); },
    copySave: () => {
      const s = PT.App && PT.App.slot ? PT.Save.exportString(PT.App.slot) : '';
      const nav = globalThis.navigator;
      if (s && nav && nav.clipboard) nav.clipboard.writeText(s).then(() => toast('Save copied'), () => toast('Copy failed', 'bad'));
      return s;
    },
    resetAll: () => {
      const M = PT.UI && PT.UI.Modal;
      const go = () => { PT.Save.clearAll(); if (globalThis.location) globalThis.location.reload(); };
      if (M && M.confirm) M.confirm('Delete ALL saves and settings?').then((y) => { if (y) go(); }); else go();
    }
  };

  // ---------------- overlay ----------------
  function btn(parent, label, fn, key) {
    const b = doc().createElement('button');
    b.type = 'button'; b.textContent = label;
    if (key) b.setAttribute('data-k', key);
    b.setAttribute('data-testid', 'dbg-' + (key || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); refreshButtons(); });
    parent.appendChild(b);
    return b;
  }
  function setToggle(k) {
    tog[k] = !tog[k];
    if (k === 'hitboxes' || k === 'routes' || k === 'zones') {
      if (PT.Render && PT.Render.setDebug) PT.Render.setDebug({ hitboxes: tog.hitboxes, routes: tog.routes, zones: tog.zones });
    } else if (k === 'slow') PT.Loop.setDebugScale(tog.slow ? 0.25 : 1);
    else if (k === 'minimap') { if (mini) mini.style.display = tog.minimap ? 'block' : 'none'; }
    else if (k === 'step') { PT.Loop.pause(tog.step); }
  }
  function refreshButtons() {
    if (!el) return;
    el.querySelectorAll('button[data-k]').forEach((b) => {
      const k = b.getAttribute('data-k');
      const on = k === 'autoplay' ? Debug.autoplayOn : tog[k];
      if (on !== undefined) b.classList.toggle('on', !!on);
    });
  }
  function buildOverlay() {
    const root = doc() && doc().getElementById('debug');
    if (!root || el) return;
    el = doc().createElement('div');
    el.className = 'pt-dbg';
    el.setAttribute('data-testid', 'debug-overlay');
    const head = doc().createElement('div'); head.className = 'pt-dbg-head';
    statsEl = doc().createElement('pre'); statsEl.className = 'pt-dbg-stats';
    const body = doc().createElement('div'); body.className = 'pt-dbg-body';
    const t = doc().createElement('div'); t.className = 'pt-dbg-row';
    [['hitboxes', 'Hitbox'], ['routes', 'Routes'], ['zones', 'Zones'], ['minimap', 'Map'], ['slow', '0.25×'], ['step', 'Pause/step']]
      .forEach(([k, lab]) => btn(t, lab, () => setToggle(k), k));
    btn(t, 'Step .', () => { if (!tog.step) setToggle('step'); PT.Loop.stepFrame(); }, 'stepOnce');
    btn(t, 'Autoplay', () => Debug.autoplay(!Debug.autoplayOn), 'autoplay');
    const q = doc().createElement('div'); q.className = 'pt-dbg-row';
    [['Sim week', 'simWeek'], ['→ Playoffs', 'simPlayoffs'], ['→ Season end', 'simSeasonEnd'], ['→ Draft', 'simDraft'], ['→ FA', 'simFA'],
      ['Next season', 'nextSeason'], ['+5000 coins', 'cash'], ['Heal team', 'heal'], ['Max OVR', 'maxOvr'], ['Win game', 'winGame'],
      ['Gen event', 'genEvent'], ['Dump save', 'dumpSave'], ['Copy save', 'copySave'], ['Reset ALL', 'resetAll']]
      .forEach(([lab, k]) => btn(q, lab, () => Debug.actions[k]()));
    const coll = btn(head, '▾ DEBUG', () => { el.classList.toggle('min'); });
    coll.className = 'pt-dbg-title';
    head.appendChild(statsEl);
    body.appendChild(t); body.appendChild(q);
    el.appendChild(head); el.appendChild(body);
    mini = doc().createElement('canvas'); mini.className = 'pt-dbg-mini'; mini.width = 120; mini.height = 240; mini.style.display = 'none';
    el.appendChild(mini);
    miniG = mini.getContext('2d');
    root.appendChild(el);
    statTimer = setInterval(updateStats, 250);
    updateStats(); refreshButtons();
  }
  function updateStats() {
    if (!statsEl) return;
    const lp = PT.Loop.stats();
    const rs = PT.Render && PT.Render.stats && !(PT.App && PT.App.noGL) ? PT.Render.stats() : {};
    const ss = PT.Session && PT.Session.state ? PT.Session.state() : null;
    const lg = L();
    const lines = [
      'FPS ' + lp.fps + '  frame ' + lp.ms + 'ms  x' + lp.scale + (lp.paused ? ' PAUSED' : '') + (lp.slowmo ? ' SLOWMO' : ''),
      'eng ' + (ss ? ss.engMs : '-') + 'ms/tick  calls ' + (rs.calls == null ? '-' : rs.calls) + '  tris ' + (rs.tris == null ? '-' : rs.tris),
      'dpr ' + (rs.dpr == null ? '-' : (+rs.dpr).toFixed(2)) + '  q ' + (rs.q || '-') + '  input ' + (PT.Input.mode ? PT.Input.mode() : '-') + '/' + PT.Input.lastDevice,
      lg ? (lg.season + ' ' + lg.phase + ' wk' + lg.week + ' sub' + lg.sub + '  seed ' + lg.seed) : 'no league',
      ss ? ('game ' + ss.gid + ' ' + ss.phase + ' mode ' + ss.mode + (ss.pending ? ' wait:' + ss.pending : '')) : ''
    ];
    statsEl.textContent = lines.join('\n');
  }
  function drawMini() {
    const now = globalThis.performance ? globalThis.performance.now() : 0;
    if (now - miniT < 100 || !lastSnap) return;
    miniT = now;
    const g = miniG, s = lastSnap, W = mini.width, Hh = mini.height, k = W / 53.333, flip = (s.udir || 1) < 0;
    const P = (x, y) => (flip ? [W - x * k, y * Hh / 120] : [x * k, Hh - y * Hh / 120]);
    g.fillStyle = '#245c2c'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, flip ? 0 : Hh - 10 * Hh / 120, W, 10 * Hh / 120); g.fillRect(0, flip ? Hh - 10 * Hh / 120 : 0, W, 10 * Hh / 120);
    const line = (y, c) => { const a = P(0, y); g.fillStyle = c; g.fillRect(0, a[1] - 1, W, 2); };
    line(s.los, '#3da5ff'); line(s.fd, '#ffe14d');
    for (const e of s.ents) { const p = P(e.x, e.y); g.fillStyle = e.tm === 0 ? '#ff6b5a' : '#5ab0ff'; g.fillRect(p[0] - 2, p[1] - 2, 4, 4); if (e.ctl) { g.strokeStyle = '#fff'; g.strokeRect(p[0] - 3.5, p[1] - 3.5, 7, 7); } }
    const b = P(s.ball.x, s.ball.y); g.fillStyle = '#ffb347'; g.fillRect(b[0] - 1.5, b[1] - 1.5, 3, 3);
  }
  function onKey(e) {
    if (!Debug.enabled) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Backquote') { if (el) el.classList.toggle('hidden'); }
    else if (e.code === 'Period') { if (!tog.step) setToggle('step'); PT.Loop.stepFrame(); refreshButtons(); }
  }
  Debug.toggle = function (k) { setToggle(k); refreshButtons(); return tog[k]; };
  Debug.destroy = function () { if (statTimer) clearInterval(statTimer); if (el) el.remove(); el = null; };
})(globalThis.PT = globalThis.PT || {});
