/* Pixel Touchdown: js/app/app.js
 * Owner: WP6. Responsibility: PT.App: current league+slot, newGame/load/save/advance/play/sim glue.
 *
 * Autosave policy (ARCHITECTURE 8.3 WP6, design 10.2):
 *   auto slot  after every App.advance, every game end (Session), every user draft pick, FA day (= advance),
 *              on tab hide (with inGame if a game is live), at game start (inGame set → crash = "interrupted")
 *   main slot  on manual App.save() and on every phase change
 * After an uncaught error App.tainted = true and autosave is blocked until the next successful load (7.2).
 * Interrupted games: a save with inGame (or a sched game left at st 'L') prompts "Sim the rest" after load;
 * engine state is not saved, so the game is simmed from scratch via Games.simUserGame.
 */
(function (PT) {
  'use strict';
  const App = PT.App = PT.App || {};
  App.L = null;
  App.slot = null;
  App.tainted = false;
  App.noGL = false;
  App.interrupted = null;
  let busy = false, autoTimer = 0;

  const UI = () => PT.UI || {};
  const toast = (t, k, ms) => { const T = UI().Toast; if (T && T.show) T.show(t, k || 'info', ms); };
  const emit = (n, p) => PT.Events.emit(n, p);
  const yieldFrame = () => new Promise((res) => {
    if (globalThis.requestAnimationFrame && !(globalThis.document && globalThis.document.hidden)) globalThis.requestAnimationFrame(() => setTimeout(res, 0));
    else setTimeout(res, 0);
  });
  const ok = (o) => Object.assign({ ok: true }, o || {});
  const fail = (err, msg, o) => Object.assign({ ok: false, err: err, msg: msg }, o || {});

  /** Menu scene: idle backdrop. Static (drawn rarely) with ?test=1 or reduced motion. */
  let menuN = 0;
  App.menuTickable = {
    tick: function () {},
    draw: function (alpha, real) {
      if (App.noGL || !PT.Render || !PT.Render.draw) return;
      menuN++;
      const still = (PT.Flags && PT.Flags.test) || (PT.Save && PT.Save.prefs && PT.Save.prefs().reduceMotion);
      if (still ? menuN % 30 !== 1 : menuN % 2 !== 0) return;      // 30 fps menus; ~2 fps when static
      PT.Render.draw(null, 1, real * 2);
    }
  };

  // ---------------- lifecycle ----------------
  /** Wire autosave listeners. Called once by main.js. */
  App.init = function () {
    if (App._inited) return;
    App._inited = true;
    PT.Events.on('league:draftPick', (p) => { if (App.L && p && p.tid === App.L.userTid) App.autosaveSoon(); });
    PT.Events.on('league:phase', () => { App._phaseChanged = true; });
    PT.Events.on('app:visibility', (p) => {
      if (p.hidden && App.L && !(PT.Session && PT.Session.active())) App.save({ auto: true });
    });
    PT.Events.on('app:prefs', (p) => App.applyPrefs(p));
    PT.Events.on('render:contextLost', () => {
      if (PT.Session && PT.Session.active()) PT.Session.pause();     // the pause menu's Resume = "tap to continue"
      toast('Graphics hiccup, tap to continue', 'bad', 4000);
    });
    // auto quality: remember the tier it settled on (prefs.quality stays 'auto' unless the player picks one)
    PT.Events.on('render:quality', (p) => {
      if (p && p.q && PT.Save.prefs().quality === 'auto' && PT.Save.prefs().autoTier !== p.q) PT.Save.setPrefs({ autoTier: p.q });
    });
  };

  /** debounced auto save (coalesces bursts like draft picks) */
  App.autosaveSoon = function () {
    if (autoTimer) return;
    autoTimer = setTimeout(() => { autoTimer = 0; App.save({ auto: true }); }, 60);
  };

  function newSeed() {
    if (PT.Flags && PT.Flags.seed != null) return PT.Flags.seed;
    const c = globalThis.crypto;
    if (c && c.getRandomValues) { const a = new Uint32Array(1); c.getRandomValues(a); return a[0]; }
    return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  }

  function onLeagueReady() {
    App.tainted = false;
    App.applyTheme();
    if (PT.Save) PT.Save.setPrefs({ lastSlot: App.slot });
  }

  /** User team → menu backdrop mascot (CSS team colors are WP5's PT.UI theme). */
  App.applyTheme = function () {
    const L = App.L;
    const t = L && L.teams && L.teams[L.userTid];
    if (!t) return;
    if (PT.Render && PT.Render.menuBackdrop && !App.noGL) PT.Render.menuBackdrop({ teamCol: t.col ? t.col.pri : 0x3fae49, sp: t.sp });
  };

  /**
   * Create a new franchise in a slot, save it and go to the hub.
   * @param {number} slot @param {{userTid:number, coach:string|Object, coachSp?:string, diff:number, seed?:number}} o
   * @returns {League}
   */
  App.newGame = function (slot, o) {
    o = o || {};
    if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: false });
    const seed = o.seed != null ? o.seed >>> 0 : newSeed();
    const L = PT.League.create({ seed: seed, userTid: o.userTid || 0, coach: o.coach || 'Coach', coachSp: o.coachSp,
      diff: o.diff == null ? 1 : o.diff, now: Date.now() });
    if (o.coachSp && L.coach && typeof L.coach === 'object') L.coach.sp = o.coachSp;
    L.dv = 2;                                         // created with the 4-level difficulty (ROUND6 B)
    App.L = L; App.slot = slot; App.interrupted = null;
    onLeagueReady();
    App.save();
    App.save({ auto: true });
    emit('app:loaded', { slot: slot, isNew: true });
    if (UI().go) UI().go('hub');
    return L;
  };

  /**
   * Load a slot (newest copy by default; backup:true = the auto copy).
   * @returns {{ok:boolean, interrupted?:Object, canBackup?:boolean, err?:string, msg?:string}}
   */
  App.load = function (slot, o) {
    const backup = !!(o && o.backup);
    // QA1: o.which picks a copy explicitly. The "backup" of a damaged newest AUTO copy is the MAIN copy; before,
    // {backup:false} re-read the newest (damaged) auto copy, so "Load the backup?" always failed in that case.
    const which = o && (o.which === 'main' || o.which === 'auto') ? o.which : backup ? 'auto' : (PT.Save.newest(slot) || 'main');
    const r = PT.Save.read(slot, { auto: which === 'auto' });
    if (!r.ok) {
      const other = which === 'auto' ? 'main' : 'auto';
      const m = PT.Save.meta().slots[slot] || {};
      const canBackup = r.err !== 'EMPTY' && !!m[other];
      return fail(r.err, r.err === 'EMPTY' ? r.msg : canBackup ? 'Damaged save, load backup?' : r.msg, { canBackup: canBackup, backupWhich: other });
    }
    if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: false });
    App.L = r.L; App.slot = slot;
    try { App.interrupted = findInterrupted(r.L, r.inGame); } catch (e) { App.interrupted = null; }
    onLeagueReady();
    emit('app:loaded', { slot: slot, which: which });
    return ok({ interrupted: App.interrupted, which: which });
  };

  function findInterrupted(L, inGame) {
    const u = L.userTid;
    let g = inGame != null ? L.sched.find((x) => x.gid === inGame) : null;
    if (!g || g.st === 'F') g = L.sched.find((x) => x.st === 'L' && (x.h === u || x.a === u)) || null;
    if (!g || g.st === 'F') return null;
    const opp = L.teams[g.h === u ? g.a : g.h];
    return { gid: g.gid, opp: opp ? (opp.city + ' ' + opp.name).trim() : 'them', oppTid: opp ? opp.id : -1 };
  }

  /**
   * Load a slot with prompts (damaged → offer backup), go to the hub and handle an interrupted game.
   * @returns {Promise<Result>}
   */
  App.open = async function (slot, o) {
    let r = App.load(slot);
    if (!r.ok && r.canBackup) {
      const M = UI().Modal;
      const yes = M && M.confirm ? await M.confirm('Damaged save. Load the backup?') : true;
      if (!yes) return r;
      r = App.load(slot, { which: r.backupWhich });
    }
    if (!r.ok) { toast(r.msg, 'bad'); return r; }
    if (UI().go) UI().go((o && o.screen) || 'hub');
    await App.checkInterrupted();
    return r;
  };

  /** "Continue" on the title screen: open the last used slot (or the newest one). */
  App.continue = function () {
    const m = PT.Save.meta();
    let slot = PT.Save.prefs().lastSlot;
    const has = (s) => m.slots[s] && (m.slots[s].main || m.slots[s].auto);
    if (!has(slot)) {
      let best = null, at = -1;
      Object.keys(m.slots).forEach((s) => {
        const e = m.slots[s]; const t = Math.max(e.main ? e.main.at || 0 : -1, e.auto ? e.auto.at || 0 : -1);
        if (t > at) { at = t; best = +s; }
      });
      slot = at >= 0 ? best : null;
    }
    if (!slot) return Promise.resolve(fail('EMPTY', 'No saved game yet.'));
    return App.open(slot);
  };

  /** If the loaded save had a live game, ask to sim the rest (from scratch; engine state isn't saved). */
  App.checkInterrupted = async function () {
    const it = App.interrupted;
    if (!it || !App.L) return null;
    const M = UI().Modal;
    if (M && M.open) {
      await M.open({ title: 'Game interrupted', body: 'Your game vs ' + it.opp + ' was interrupted.',
        buttons: [{ label: 'Sim the rest', value: true, kind: 'primary', testid: 'btn-sim-interrupted' }] });
    }
    if (App.interrupted !== it) return null;
    App.interrupted = null;
    const g = App.L.sched.find((x) => x.gid === it.gid);
    if (!g || g.st === 'F') return null;
    const box = PT.League.Games.simUserGame(App.L, it.gid);
    App.save({ auto: true });
    const u = App.L.userTid, us = g.h === u ? box.hs : box.as, them = g.h === u ? box.as : box.hs;
    toast((us > them ? 'Won ' : us < them ? 'Lost ' : 'Tied ') + us + '-' + them + ' vs ' + it.opp, us > them ? 'good' : 'info', 2500);
    if (UI().refresh) UI().refresh();
    return box;
  };

  /**
   * @param {{auto?:boolean, inGame?:number|null}} [o]
   * @returns {Result} also toasts on failure
   */
  App.save = function (o) {
    o = o || {};
    if (!App.L || !App.slot) return fail('NO_LEAGUE', 'Nothing to save.');
    if (App.tainted && o.auto) return fail('TAINTED', 'Autosave is off after an error.');
    const inGame = o.inGame !== undefined ? o.inGame : (PT.Session && PT.Session.active() ? PT.Session.gid() : null);
    const r = PT.Save.write(App.slot, App.L, { auto: !!o.auto, inGame: inGame });
    if (!r.ok) toast(r.msg || 'Could not save.', 'bad', 3000);
    else if (App.tainted && !o.auto) App.tainted = false;
    return r;
  };

  /**
   * One "Next" press: Calendar.advance + autosave (+ main save on phase change). Yields a frame first.
   * @returns {Promise<Object>} AdvanceResult
   */
  App.advance = async function () {
    if (!App.L) return fail('NO_LEAGUE', 'No league loaded.');
    if (busy) return fail('BUSY', 'Hang on…');
    busy = true;
    try {
      await yieldFrame();
      App._phaseChanged = false;
      const r = PT.League.Calendar.advance(App.L);
      if (r.ok) {
        App.save({ auto: true });
        if (r.phaseChanged || App._phaseChanged) App.save({ auto: false });
      } else if (r.msg) toast(r.msg, 'bad');
      return r;
    } finally { busy = false; }
  };

  const PREDS = {
    week: (L0) => { const w = L0.week, ph = L0.phase; return (L) => L.week !== w || L.phase !== ph; },
    playoffs: () => (L) => L.phase === 'PLAYOFFS',
    seasonEnd: () => (L) => L.phase === 'SEASON_END',
    draft: () => (L) => L.phase === 'DRAFT',
    fa: () => (L) => L.phase === 'FREE_AGENCY',
    nextSeason: (L0) => { const s = L0.season; return (L) => L.season > s; },
    preseason: () => (L) => L.phase === 'PRESEASON',
    regular: () => (L) => L.phase === 'REGULAR'
  };
  /** @returns {Function} predicate from a kind name, a phase name ('DRAFT'), 'week:N', or a function */
  App.predicate = function (kind) {
    if (typeof kind === 'function') return kind;
    if (PREDS[kind]) return PREDS[kind](App.L);
    if (typeof kind === 'string' && /^week:\d+$/i.test(kind)) { const w = +kind.split(':')[1]; return (L) => (L.phase === 'REGULAR' && L.week >= w) || L.phase !== 'REGULAR' && L.phase !== 'PRESEASON'; }
    if (typeof kind === 'string') { const ph = kind.toUpperCase(); return (L) => L.phase === ph; }
    return PREDS.week(App.L);
  };

  /**
   * Sim until a predicate holds, resolving blockers with League.Auto. Yields a frame between steps and emits
   * 'app:progress' {step, label}. Saves auto (+ main on phase change) at the end.
   * @param {string|Function} kind 'week'|'playoffs'|'seasonEnd'|'draft'|'fa'|'nextSeason'|phase|'week:N'|pred
   * @returns {Promise<{ok:boolean, steps:number}>}
   */
  App.simUntil = async function (kind, o) {
    if (!App.L) return fail('NO_LEAGUE', 'No league loaded.');
    if (busy) return fail('BUSY', 'Hang on…');
    busy = true;
    const pred = App.predicate(kind);
    const max = (o && o.maxSteps) || 800;
    const fast = !!(o && o.noYield);
    let steps = 0, phaseChanged = false, stuck = 0;
    try {
      while (steps < max && !pred(App.L)) {
        const st = PT.League.Calendar.status(App.L);
        if ((st.blockers || []).some((b) => b.k === 'FIRED')) break;     // QA1: a firing stops every sim; the UI shows the Fired screen
        (st.blockers || []).forEach((b) => PT.League.Auto.resolve(App.L, b));
        const r = PT.League.Calendar.advance(App.L);
        steps++;
        if (r.phaseChanged) phaseChanged = true;
        if (!r.ok && !(PT.League.Calendar.status(App.L).blockers || []).length) break;
        stuck = r.ok ? 0 : stuck + 1;
        if (stuck >= 5) { if (PT.Log) PT.Log.warn('app', 'simUntil: blocker could not be resolved', r.msg || r.err); break; }
        if (!fast) {
          emit('app:progress', { step: steps, label: PT.League.Calendar.status(App.L).label });
          await yieldFrame();
        }
      }
    } finally { busy = false; }
    App.save({ auto: true });
    if (phaseChanged) App.save({ auto: false });
    if (UI().refresh) UI().refresh();
    return ok({ steps: steps, done: pred(App.L) });
  };

  /**
   * Play a user game live (Session), or sim it when WebGL is missing. Re-entrant per gid: WP5's 'game' screen
   * calls App.playGame(gid) from its mount, so a call made elsewhere navigates to 'game' and the screen's call
   * gets the same promise. When a real 'game' screen exists it routes to postgame/HQ itself; otherwise App does.
   * @returns {Promise<BoxScore|null>}
   */
  App.playGame = function (gid) {
    if (!App.L) return Promise.resolve(null);
    if (App._play && App._play.gid === gid) return App._play.promise;
    const Ui = UI();
    const scr = Ui.screens && Ui.screens.game;
    const realScreen = !!(scr && typeof scr.mount === 'function' && !scr.mount.__stub);
    const cur = Ui.current ? Ui.current() : null;
    const onGame = !!(cur && cur.name === 'game');
    const route = (box) => {
      if (realScreen && (onGame || App._navigated)) return;
      if (box && Ui.replace) Ui.replace('postgame', { gid: gid, box: box });
      else if (Ui.replace) Ui.replace('hub');
    };
    let promise;
    if (App.noGL) {
      toast('3D is off on this device: simming the game.', 'info', 2000);
      const box = App.simGame(gid);
      promise = Promise.resolve(box).then((b) => { route(b); return b; });
      return promise;
    }
    App._navigated = false;
    let started;
    try { started = PT.Session.start(App.L, gid); } catch (e) { started = Promise.reject(e); }
    promise = started.then((box) => box, (e) => {
      if (PT.Log) PT.Log.error('app', 'playGame failed', e);
      toast((e && e.message) || 'Could not start the game.', 'bad');
      return null;
    }).then((box) => { App._play = null; if (App.L) route(box); return box; });
    App._play = { gid: gid, promise: promise };
    if (!onGame && Ui.go) { App._navigated = true; Ui.go('game', { gid: gid }); }
    return promise;
  };

  /** StatSim the user's game, record it, autosave. @returns {BoxScore} */
  App.simGame = function (gid) {
    const box = PT.League.Games.simUserGame(App.L, gid);
    App.save({ auto: true });
    return box;
  };

  /** Leave the franchise (sims a live game from its current score first). */
  App.quitToTitle = function () {
    if (App._stash) App.restore();                  // leaving a Quick Game / Practice: nothing of it is saved
    if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: true });
    if (App.L && !App.tainted) App.save({ auto: true });
    App.L = null; App.slot = null; App.interrupted = null;
    PT.Loop.pause(false);
    if (UI().go) UI().go('title');
  };

  // ---------------- throwaway leagues (Quick Game, Practice Field) ----------------
  /**
   * Make a throwaway in-memory League current (Quick Game / Practice). The franchise (if any) is stashed and comes back
   * with App.restore(). While borrowed App.slot is null, so App.save / autosave are no-ops: no save slot is touched.
   * The temp league is tagged L.tmp = mode so the UI can hide franchise chrome and toasts.
   * @param {League} L @param {'quick'|'practice'} mode @returns {League}
   */
  App.borrow = function (L, mode) {
    if (!App._stash) {
      if (App.L && App.slot && !App.tainted) App.save({ auto: true });
      App._stash = { L: App.L, slot: App.slot };
    }
    L.tmp = mode || 'quick';
    App.L = L; App.slot = null; App.mode = L.tmp; App.interrupted = null;
    return L;
  };
  /** Back to the stashed franchise (or no league). @returns {League|null} */
  App.restore = function () {
    if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: false });
    const s = App._stash;
    App._stash = null; App.mode = null;
    App.L = s ? s.L : null; App.slot = s ? s.slot : null;
    if (App.L) App.applyTheme();
    return App.L;
  };
  /**
   * Build a throwaway league for a one-off game: fixed-seed rosters (the same 32 teams every time, so the Stars on the
   * pick grid match), then a fresh game seed. Adds one scheduled game user vs opponent.
   * @param {{userTid:number, oppTid:number, diff?:number, qLen?:number, wx?:Object|null, home?:boolean, seed?:number}} o
   * @returns {{L:League, gid:number}}
   */
  App.tempLeague = function (o) {
    const L = PT.League.create({ seed: App.TEMP_SEED, userTid: o.userTid, coach: 'Coach', diff: o.diff == null ? 1 : o.diff, now: Date.now() });
    L.seed = o.seed != null ? o.seed >>> 0 : newSeed();
    if (o.qLen) L.settings.qLen = o.qLen;
    L.settings.autoKick = false;
    const home = o.home !== false;
    const gid = L.nextGid++;
    const g = { gid: gid, wk: 1, h: home ? o.userTid : o.oppTid, a: home ? o.oppTid : o.userTid, po: 0, st: 'S', hs: null, as: null, ot: false, sim: false };
    if (o.wx) g.wxSet = Object.assign({}, o.wx);
    L.sched.push(g);
    return { L: L, gid: gid };
  };
  App.TEMP_SEED = 20260;

  // ---------------- prefs / settings / haptics ----------------
  /** Persist + apply device prefs ({sfx, music, muted, quality, haptics, reduceMotion, watch, kickMode}). */
  App.setPrefs = function (partial) { return PT.Save.setPrefs(partial); };       // emits app:prefs → applyPrefs
  App.applyPrefs = function (p) {
    p = p || PT.Save.prefs();
    if (PT.Audio && PT.Audio.setVolumes) { PT.Audio.setVolumes({ sfx: p.sfx, music: p.music }); PT.Audio.mute(!!p.muted); }
    const q = p.quality || 'auto';                 // only on change: re-applying 'auto' would restart the tier probe
    if (PT.Render && PT.Render.setQuality && !App.noGL && !(PT.Flags && PT.Flags.quality) && App._appliedQ !== undefined && App._appliedQ !== q) PT.Render.setQuality(q);
    App._appliedQ = q;
    if (PT.Render && PT.Render.setReduceMotion && !App.noGL) PT.Render.setReduceMotion(!!p.reduceMotion);
    const de = globalThis.document && globalThis.document.documentElement;
    if (de) de.classList.toggle('pt-reduce-motion', !!p.reduceMotion);
  };
  /** Change several league settings at once (WP5 in-game gear: watch, autoDef, lefty, autoKick …). @returns {Result} */
  App.setSettings = function (partial) {
    if (!App.L) return fail('NO_LEAGUE', 'No league loaded.');
    Object.assign(App.L.settings, partial || {});
    emit('league:changed', { what: 'settings' });
    App.save({ auto: true });
    return ok();
  };
  /** Change a league setting (L.settings[k]) and save. @returns {Result} */
  App.setSetting = function (k, v) {
    if (!App.L) return fail('NO_LEAGUE', 'No league loaded.');
    App.L.settings[k] = v;
    emit('league:changed', { what: 'settings' });
    App.save({ auto: true });
    return ok();
  };
  /** Vibrate (15 ms tackle, 30 ms sack/big hit, [60,40,60] TD) when supported and enabled. */
  App.haptic = function (pattern) {
    const n = globalThis.navigator;
    if (!n || typeof n.vibrate !== 'function') return false;
    if (PT.Save && PT.Save.prefs && PT.Save.prefs().haptics === false) return false;
    if (PT.Flags && PT.Flags.test) return false;
    if (n.userActivation && !n.userActivation.hasBeenActive) return false;     // Chrome blocks (and logs) before a tap
    try { return n.vibrate(pattern); } catch (e) { return false; }
  };
})(globalThis.PT = globalThis.PT || {});
