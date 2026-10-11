/* Pixel Touchdown: js/main.js
 * Owner: WP6. Responsibility: bootstrap: feature checks, init order, flags, first screen.
 *
 * Order: flags → global error handlers → Save (storage probe) → Render (WebGL probe; false → "Sim only" mode)
 * → UI → Input → Audio (unlock on first gesture; off with ?test=1) → App → Debug → Loop (menu scene) → first screen.
 * Flags (ARCHITECTURE 7.3): ?debug=1 ?test=1 ?seed=N ?quality=low|med|high ?screen=hub|game|… ?autoplay=1 ?ff=N
 * ?screen=X auto-loads slot 1 (or creates a test league in slot 1) and jumps there; ?screen=game starts the next user game.
 */
(function (PT) {
  'use strict';
  const Boot = PT.Boot = PT.Boot || {};
  const doc = globalThis.document;
  let fatalOpen = false;

  const $ = (id) => doc.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- errors (ARCHITECTURE 7.2) ----------------
  function toError(x) { return x instanceof Error ? x : new Error(String((x && x.message) || x || 'Unknown error')); }
  function copyText(t) {
    const nav = globalThis.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) return nav.clipboard.writeText(t).catch(() => {});
    return Promise.resolve();
  }
  /** Uncaught error: log, taint (no autosave), freeze the game and show "Oops! Something fumbled." */
  function fatal(err, src) {
    const e = toError(err);
    if (PT.App) PT.App.tainted = true;
    PT.Log.error('app', 'uncaught ' + (src || ''), e);
    PT.Events.emit('app:error', { err: e, fatal: true });
    showFatal(e);
  }
  Boot.fatal = fatal;
  function showFatal(e) {
    if (fatalOpen) return;
    fatalOpen = true;
    try { if (PT.Session && PT.Session.active()) PT.Session.pause({ menu: false }); } catch (x) { /* ignore */ }
    const M = PT.UI && PT.UI.Modal;
    if (!M || !M.open) { fatalOpen = false; return; }
    M.open({ title: 'Oops! Something fumbled.', body: '<p>' + esc(e.message) + '</p>', buttons: [
      { label: 'Back to menu', value: 'menu', kind: 'primary', testid: 'btn-error-menu' },
      { label: 'Copy error', value: 'copy', testid: 'btn-error-copy' }] }).then((v) => {
      fatalOpen = false;
      if (v === 'copy') {
        copyText(PT.Log.text() + '\n' + (e.stack || '')).then(() => { if (PT.UI.Toast) PT.UI.Toast.show('Error copied', 'info', 1500); showFatal(e); });
        return;
      }
      try {
        if (PT.Session && PT.Session.active()) PT.Session.quit({ simRest: false });
        PT.Loop.pause(false);
        if (PT.App) { PT.App.L = null; PT.App.slot = null; }
        if (PT.UI && PT.UI.go) PT.UI.go('title');
      } catch (x) { PT.Log.warn('app', 'recover failed', x && x.message); }
    });
  }

  // ---------------- boot ----------------
  function initRender(prefs) {
    const canvas = $('gl');
    let ok = false;
    try {
      ok = !!(canvas && PT.Render && PT.Render.init && PT.Render.init(canvas, { quality: PT.Flags.quality || prefs.quality || 'auto' }));
    } catch (e) { PT.Log.warn('boot', 'Render.init failed', e && e.message); ok = false; }
    PT.App.noGL = !ok;
    if (!ok) {
      doc.documentElement.classList.add('pt-nogl');
      if (canvas) canvas.style.display = 'none';
    } else if (canvas) {
      canvas.addEventListener('webglcontextlost', () => { if (PT.Session && PT.Session.active()) PT.Session.pause(); });
    }
    return ok;
  }

  // ---------------- landscape only (client decision) ----------------
  // Touch device held upright → full-screen "turn your phone" overlay; the game/loop pause and audio ducks while it
  // shows, and resume on rotate. Desktop windows narrower than tall → html.pt-letterbox (the canvas is letterboxed
  // to 16:9; no overlay). Android fullscreen/standalone → screen.orientation.lock('landscape') (iOS: ignored).
  const rot = { el: null, shown: false, pausedGame: false, pausedLoop: false };
  const mq = (q) => !!(globalThis.matchMedia && globalThis.matchMedia(q).matches);
  function coarse() { return mq('(pointer: coarse)') || (mq('(hover: none)') && globalThis.navigator && globalThis.navigator.maxTouchPoints > 0); }
  function portraitNow() { return mq('(orientation: portrait)') || (globalThis.innerHeight > globalThis.innerWidth); }
  function rotateEl() {
    if (rot.el) return rot.el;
    const d = doc.createElement('div');
    d.id = 'pt-rotate'; d.setAttribute('data-testid', 'rotate-overlay'); d.setAttribute('role', 'alert');
    d.innerHTML = '<div class="pt-rot-box"><div class="pt-rot-phone" aria-hidden="true"><i></i></div>' +
      '<p class="pt-rot-t">Turn your phone sideways to play</p></div>';
    doc.body.appendChild(d);
    rot.el = d;
    return d;
  }
  function checkOrientation() {
    const touchDev = coarse(), portrait = portraitNow();
    const show = touchDev && portrait;
    doc.documentElement.classList.toggle('pt-letterbox', !touchDev && portrait);
    if (show === rot.shown) return;
    rot.shown = show;
    const el = rotateEl();
    el.classList.toggle('on', show);
    doc.documentElement.classList.toggle('pt-rotate', show);
    const S = PT.Session, A = PT.Audio;
    if (show) {
      rot.pausedGame = !!(S && S.active() && !S.isPaused());
      if (rot.pausedGame) S.pause({ menu: false });
      rot.pausedLoop = !(S && S.active()) && !PT.Loop.isPaused();
      if (rot.pausedLoop) PT.Loop.pause(true);
      if (A && A.duck) A.duck(true);
    } else {
      if (rot.pausedGame && S && S.active()) S.resume();
      if (rot.pausedLoop) PT.Loop.pause(false);
      rot.pausedGame = rot.pausedLoop = false;
      if (A && A.duck) A.duck(false);
    }
    PT.Events.emit('app:rotate', { show: show });
  }
  Boot.checkOrientation = checkOrientation;
  function tryLock() {
    const so = globalThis.screen && globalThis.screen.orientation;
    const full = doc.fullscreenElement || doc.webkitFullscreenElement || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)');
    if (!so || typeof so.lock !== 'function' || !full) return;
    try { const p = so.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (e) { /* iOS / unsupported */ }
  }
  Boot.tryLock = tryLock;

  let rz = 0;
  function onResize() {
    checkOrientation();
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!PT.App.noGL && PT.Render && PT.Render.resize) PT.Render.resize();
      if (PT.Input.Joystick) PT.Input.Joystick.relayout();
      PT.Events.emit('app:resize', { w: globalThis.innerWidth, h: globalThis.innerHeight });
    }, 100);
  }

  async function firstScreen() {
    const F = PT.Flags, UI = PT.UI;
    const scr = F.screen;
    if (!scr) { UI.go('title'); return; }
    const m = PT.Save.meta();
    let loaded = false;
    if (m.slots[1] && (m.slots[1].main || m.slots[1].auto)) loaded = PT.App.load(1).ok;
    if (!loaded) PT.App.newGame(1, { userTid: 0, coach: 'Coach Test', diff: 1, seed: F.seed != null ? F.seed : 42 });
    else {
      if (scr !== 'hub') UI.go('hub');
      const it = PT.App.checkInterrupted();          // a modal; only block when we are about to start a game
      if (scr === 'game') await it;
    }
    if (scr === 'game') {
      const L = PT.App.L;
      if (L.phase === 'PRESEASON') await PT.App.simUntil('REGULAR', { noYield: true });
      const g = PT.League.Q.nextUserGame(PT.App.L);
      if (g) { PT.App.playGame(g.gid); return; }
      UI.go('hub');
      return;
    }
    if (scr !== 'hub' || !PT.UI.current || !PT.UI.current() || PT.UI.current().name !== 'hub') UI.go(scr);
  }

  /** call PT.<path>(…args) if it exists (packages may still be placeholders during parallel builds) */
  function call(path, args) {
    const parts = path.split('.');
    let o = PT;
    for (let i = 0; i < parts.length - 1; i++) { o = o && o[parts[i]]; }
    const fn = o && o[parts[parts.length - 1]];
    if (typeof fn !== 'function') { PT.Log.warn('boot', 'missing PT.' + path); return undefined; }
    return fn.apply(o, args || []);
  }
  const toast = (t, k, ms) => { if (PT.UI && PT.UI.Toast && PT.UI.Toast.show) PT.UI.Toast.show(t, k, ms); };

  Boot.start = function () {
    const F = PT.Flags;
    F.init();
    if (F.test) {
      try { Object.defineProperty(globalThis, '__ptLog', { get: () => PT.Log.entries(), configurable: true }); } catch (e) { /* ignore */ }
    }
    globalThis.addEventListener('error', (ev) => fatal(ev.error || ev.message, 'error'));
    globalThis.addEventListener('unhandledrejection', (ev) => fatal(ev.reason, 'promise'));
    PT.Loop.onError = (e) => fatal(e, 'loop');

    PT.Save.init();
    const prefs = PT.Save.prefs();
    initRender(prefs);
    call('UI.init', [{ root: { screen: $('screen'), hud: $('hud'), modal: $('modal'), toast: $('toast') } }]);
    PT.Input.attach($('touch'));
    PT.Input.setMode('menu');
    PT.Audio.init({ disabled: F.test, sfx: prefs.sfx, music: prefs.music, muted: prefs.muted });
    PT.App.init();
    PT.App.applyPrefs(prefs);
    PT.Debug.init({ overlay: F.debug });
    if (F.autoplay) PT.Debug.autoplay(true);
    globalThis.addEventListener('resize', onResize);
    globalThis.addEventListener('orientationchange', onResize);
    if (globalThis.matchMedia) {
      const m = globalThis.matchMedia('(orientation: portrait)');
      if (m.addEventListener) m.addEventListener('change', checkOrientation); else if (m.addListener) m.addListener(checkOrientation);
    }
    doc.addEventListener('fullscreenchange', tryLock);
    doc.addEventListener('webkitfullscreenchange', tryLock);
    globalThis.addEventListener('pointerdown', tryLock, { once: true, capture: true });
    tryLock();
    checkOrientation();
    if (!PT.App.noGL) call('Render.setScene', ['menu']);
    PT.Loop.start(PT.App.menuTickable);
    PT.Audio.music('menu');
    if (!PT.Save.available()) toast('Saving is off in this browser mode. Use Export to keep your game.', 'bad', 4000);
    if (PT.App.noGL) toast('3D graphics are not available here. Menus work, and games will be simmed.', 'bad', 5000);
    const ready = PT.UI && typeof PT.UI.go === 'function' ? firstScreen() : Promise.resolve();
    Boot.ready = ready.then(() => { PT.Events.emit('app:ready', { noGL: PT.App.noGL, test: F.test }); },
      (e) => fatal(e, 'boot'));
    return Boot.ready;
  };

  if (doc && !globalThis.PT_NO_BOOT) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', Boot.start);
    else Boot.start();
  }
})(globalThis.PT = globalThis.PT || {});
