/* Pixel Touchdown: js/app/loop.js
 * Owner: WP6. Responsibility: PT.Loop: rAF, fixed-step accumulator, timescale, pause, visibility.
 *
 * One requestAnimationFrame loop (ARCHITECTURE 4). The simulation steps at PT.C.DT (60 Hz) with at most 8 steps
 * per frame (time is dropped instead of spiralling); rendering happens once per frame with alpha interpolation.
 * Time scale = pause (0) | slow-mo from bigPlay (eases back to 1 over 0.3 s; ignored at ≥ 2× watch speed) |
 * watch speed (Session sets L.settings.watch, default 0.8×, » = 2× on defense) | debug slow motion 0.25×.
 * A tickable is { tick(dt), draw(alpha, realDt) }. The menu tickable (App.menuTickable) runs when no game is live.
 * Tab hidden → emits 'app:visibility' {hidden}; Session/App/Audio react. last = 0 on return (no huge first dt).
 */
(function (PT) {
  'use strict';
  const Loop = PT.Loop = PT.Loop || {};
  const MAX_STEPS = 8;
  const st = {
    t: null, raf: 0, running: false, last: 0, acc: 0, scale: 1, paused: false, dbgScale: 1, stepOnce: 0,
    slow: { s: 1, until: 0, ease: 0.3, active: false },
    fps: 60, frames: 0, fpsT: 0, ms: 0, tickMs: 0, steps: 0, eff: 1, frameNo: 0
  };
  const now = () => (globalThis.performance ? globalThis.performance.now() : 0);
  const raf = (fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(fn) : setTimeout(() => fn(now()), 16));
  const caf = (id) => (globalThis.cancelAnimationFrame ? globalThis.cancelAnimationFrame(id) : clearTimeout(id));

  function effective(tNow) {
    if (st.paused) return 0;
    let s = st.scale;
    const sl = st.slow;
    if (sl.active && st.scale < 2) {
      if (tNow < sl.until) s = sl.s;
      else if (tNow < sl.until + sl.ease * 1000) s = sl.s + (st.scale - sl.s) * ((tNow - sl.until) / (sl.ease * 1000));
      else sl.active = false;
    }
    return s * st.dbgScale;
  }

  /** errors inside tick/draw: pause + hand to the global fatal handler (main.js sets Loop.onError) */
  function fail(e) {
    st.paused = true;
    Loop.lastError = e;
    if (typeof Loop.onError === 'function') Loop.onError(e);
    else if (PT.Log) PT.Log.error('loop', e);
  }

  function frame(tNow) {
    if (!st.running) return;
    st.raf = raf(frame);
    const real = st.last ? Math.min((tNow - st.last) / 1000, 0.1) : 0;
    st.last = tNow;
    st.frameNo++;
    const t = st.t;
    if (!t) return;
    const s = effective(tNow);
    st.eff = s;
    st.acc += real * s;
    const DT = PT.C.DT;
    let steps = 0;
    const t0 = now();
    try {
      while (st.acc >= DT && steps < MAX_STEPS) { t.tick(DT); st.acc -= DT; steps++; }
      if (steps === MAX_STEPS) st.acc = 0;
      if (st.paused && st.stepOnce > 0) { st.stepOnce--; t.tick(DT); steps++; }
    } catch (e) {
      st.acc = 0;
      fail(e);
      return;
    }
    const t1 = now();
    st.steps = steps;
    if (steps) st.tickMs = st.tickMs * 0.9 + ((t1 - t0) / steps) * 0.1;
    try { t.draw(st.acc / DT, real); } catch (e) { fail(e); return; }
    st.ms = st.ms * 0.9 + (now() - t0) * 0.1;
    st.frames++; st.fpsT += real;
    if (st.fpsT >= 0.5) { st.fps = st.frames / st.fpsT; st.frames = 0; st.fpsT = 0; }
  }

  /**
   * Run a tickable { tick(dt), draw(alpha, realDt) }. Replaces the current one; keeps the rAF running.
   * @param {Object} tickable
   */
  Loop.start = function (tickable) {
    st.t = tickable; st.acc = 0;
    st.slow.active = false;
    if (!st.running) { st.running = true; st.last = 0; st.raf = raf(frame); }
  };
  Loop.stop = function () { st.running = false; if (st.raf) caf(st.raf); st.raf = 0; st.t = null; };
  /** Base time scale (1 = normal; Session uses 1.5 / 3 for watch speed). */
  Loop.setTimeScale = function (s) { st.scale = s > 0 ? s : 1; };
  Loop.pause = function (on) { st.paused = !!on; if (!on) st.last = 0; };
  Loop.isPaused = function () { return st.paused; };
  /** bigPlay slow motion: scale for dur REAL seconds, then ease back over 0.3 s. Ignored while ≥ 2× watch speed. */
  Loop.slowmo = function (scale, dur) {
    if (!(dur > 0)) { st.slow.active = false; return; }
    st.slow.s = Math.max(0.05, Math.min(1, scale || 0.35));
    st.slow.until = now() + dur * 1000;
    st.slow.active = true;
  };
  /** debug: global multiplier (0.25 = slow motion) */
  Loop.setDebugScale = function (s) { st.dbgScale = s > 0 ? s : 1; };
  /** debug: while paused, run exactly one tick on the next frame */
  Loop.stepFrame = function () { st.stepOnce++; };
  /** @returns {{fps:number, ms:number, tickMs:number, steps:number, scale:number, paused:boolean, slowmo:boolean}} */
  Loop.stats = function () {
    return { fps: Math.round(st.fps), ms: +st.ms.toFixed(2), tickMs: +st.tickMs.toFixed(3), steps: st.steps, scale: +st.eff.toFixed(2),
      base: st.scale, paused: st.paused, slowmo: st.slow.active, frame: st.frameNo, running: st.running };
  };
  Loop.current = function () { return st.t; };

  // tab visibility (ARCHITECTURE 4): reset the clock and tell everyone
  if (globalThis.document && globalThis.document.addEventListener) {
    globalThis.document.addEventListener('visibilitychange', () => {
      const hidden = globalThis.document.visibilityState === 'hidden';
      st.last = 0;
      if (PT.Events) PT.Events.emit('app:visibility', { hidden: hidden });
    });
  }
})(globalThis.PT = globalThis.PT || {});
