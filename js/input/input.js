/* Pixel Touchdown: js/input/input.js
 * Owner: WP6. Responsibility: PT.Input: modes, sample() -> InputFrame, virtual presses.
 *
 * Modes (R9): 'off' | 'menu' | 'presnap' | 'qb' | 'carrier' | 'defense' | 'kick' | 'return' (ball in the air to the
 * user's returner: tap / Space = fair catch or touchback, steering = bring it out).
 * sample() is called once per fixed tick by the Session; edges are true for exactly one sample and are
 * cleared by setMode()/flush() so a press made during a menu never leaks into play.
 *
 * InputFrame (SCREEN space, CSS px, y DOWN):
 * { mx, my,                           move vector |m| ≤ 1 (joystick or WASD/arrows)
 *   sprint, lob,                      held
 *   aim:     { on, sx, sy, ox, oy, dx, dy, pow, cancel },   QB drag; dx/dy = THROW direction (slingshot already inverted)
 *   kickAim: { on, dx, dy, pow, src },                       FG/XP aim (screen dir, y down) + power 0..1
 *   seek:    { on, sx, sy },          mouse: hold left button = run toward cursor (carrier)
 *   tap:     { on, sx, sy },          edge: field tap (defense presnap → move the Star)
 *   throw, throwAway, snap, go, juke, dive, spin, kick, star, pause,   edges
 *   pass,                             edge: Easy Throw badge 1..4 (0 = none)
 *   ff, skip, simDrive, autoDef, autoKick, cycle, onside,            edges (defense / kick trays / onside kick)
 *   ability, audible,                 edges: Star ability (STAR button / G / gamepad Y = press('ability')), open audible tray (V)
 *   ffHeld, device }
 * Internal modules (keyboard, pointer, joystick, gestures) share state through Input._k.
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};

  const EDGES = ['throw', 'throwAway', 'snap', 'go', 'juke', 'dive', 'spin', 'kick', 'star', 'pause',
    'ff', 'skip', 'simDrive', 'autoDef', 'autoKick', 'cycle', 'onside', 'ability', 'audible'];
  const GAME_MODES = { presnap: 1, qb: 1, carrier: 1, defense: 1, kick: 1, return: 1, off: 0 };

  const frame = {
    mx: 0, my: 0, sprint: false, lob: false,
    aim: { on: false, sx: 0, sy: 0, ox: 0, oy: 0, dx: 0, dy: 0, pow: 0, cancel: false },
    kickAim: { on: false, dx: 0, dy: -1, pow: 0, src: '' },
    seek: { on: false, sx: 0, sy: 0 },
    tap: { on: false, sx: 0, sy: 0 },
    pass: 0, ffHeld: false, device: 'kbd'
  };
  EDGES.forEach((e) => { frame[e] = false; });

  /** shared internal state (keyboard/pointer/joystick/gestures write here) */
  const K = Input._k = {
    el: null, mode: 'off', attached: false,
    opts: { lefty: false, aimMode: 'sling' },
    edges: {}, pass: 0,
    tap: { on: false, sx: 0, sy: 0 },
    hold: { sprint: false, lob: false, ff: false },     // HUD buttons held
    joy: { on: false, x: 0, y: 0, mag: 0 },             // written by joystick.js
    aim: { on: false, sx: 0, sy: 0, ox: 0, oy: 0, dx: 0, dy: 0, pow: 0, cancel: false, lob: false, last: null },
    kick: { on: false, dx: 0, dy: -1, pow: 0, src: '' },
    seek: { on: false, sx: 0, sy: 0 },
    keyHandlers: [],
    edge: function (name) { if (name in K.edges) K.edges[name] = true; },
    now: function () { return globalThis.performance ? globalThis.performance.now() : 0; }
  };
  EDGES.forEach((e) => { K.edges[e] = false; });

  Input.lastDevice = 'kbd';

  /** Record which device the player is using; emits 'input:device' {kind} on change. */
  K.device = function (kind) {
    if (kind !== Input.lastDevice) {
      Input.lastDevice = kind;
      const de = globalThis.document && globalThis.document.documentElement;
      if (de) de.classList.toggle('pt-touch', kind === 'touch');
      if (PT.Events) PT.Events.emit('input:device', { kind: kind });
    }
  };
  K.inGame = function () { return !!GAME_MODES[K.mode]; };

  /**
   * Attach pointer + keyboard listeners. Safe to call twice.
   * @param {HTMLElement} touchLayerEl the #touch layer (z 5, below the HUD)
   */
  Input.attach = function (touchLayerEl) {
    if (K.attached) return;
    K.attached = true;
    K.el = touchLayerEl || (globalThis.document && globalThis.document.getElementById('touch'));
    if (Input.Keyboard) Input.Keyboard.attach();
    if (Input.Pointer && K.el) Input.Pointer.attach(K.el);
    if (Input.Joystick && K.el) Input.Joystick.attach(K.el);
    if (Input.Gestures && K.el) Input.Gestures.attach(K.el);
    if (K.el) K.el.setAttribute('data-mode', K.mode);
    const mm = globalThis.matchMedia;
    const coarse = (mm && mm('(pointer: coarse)').matches) || (globalThis.navigator && globalThis.navigator.maxTouchPoints > 0 && mm && mm('(hover: none)').matches);
    if (coarse) {
      K.device('touch');
      const de = globalThis.document && globalThis.document.documentElement;
      if (de) de.classList.add('pt-coarse');        // phones/tablets: the fixed stick shows even after a stray mouse-type event
    }
  };

  /** @param {'off'|'menu'|'presnap'|'qb'|'carrier'|'defense'|'kick'|'return'} m */
  Input.setMode = function (m) {
    if (m === 'watch') m = 'defense';
    if (m === K.mode) return;
    const MOVE = { qb: 1, carrier: 1, return: 1 };
    const keepJoy = !!(MOVE[m] && MOVE[K.mode]);   // qb → carrier (scramble / after the throw): the thumb keeps running
    K.mode = m;
    if (K.el) K.el.setAttribute('data-mode', m);
    Input.flush(keepJoy);
  };
  /** @returns {string} current mode */
  Input.mode = function () { return K.mode; };

  /** @param {{lefty?:boolean, aimMode?:'sling'|'point'}} o */
  Input.setOptions = function (o) { Object.assign(K.opts, o || {}); if (Input.Joystick && Input.Joystick.relayout) Input.Joystick.relayout(); };
  Input.options = function () { return Object.assign({}, K.opts); };

  /** Drop pending edges, active drags and (unless keepJoy) the joystick (mode changes, pause, decisions). */
  Input.flush = function (keepJoy) {
    EDGES.forEach((e) => { K.edges[e] = false; });
    K.pass = 0; K.tap.on = false;
    if (Input.Gestures) Input.Gestures.cancel();
    if (Input.Joystick && keepJoy !== true) Input.Joystick.end();
    K.seek.on = false;
    if (Input.Keyboard) Input.Keyboard.reset();
  };

  /**
   * Virtual press from HUD buttons. btn: 'snap'|'go'|'juke'|'dive'|'spin'|'kick'|'pause'|'ff'|'skip'|'simDrive'|
   * 'autoDef'|'autoKick'|'star'|'throwAway'|'cycle'|'onside'|'ability'|'audible'|'pass1'..'pass4'.
   */
  Input.press = function (btn) {
    if (/^pass[1-4]$/.test(btn)) { K.pass = +btn.slice(4); return; }
    if (btn === 'hike') btn = 'snap';
    if (btn in K.edges) K.edges[btn] = true;
  };
  /** Held HUD buttons: 'sprint' | 'lob' | 'ff' (hold-to-fast-forward). */
  Input.hold = function (btn, on) { if (btn in K.hold) K.hold[btn] = !!on; };

  /**
   * Raw key hook (for decision prompts like 4th down G/P/K). fn(code, event) → true to consume.
   * @returns {Function} unsubscribe
   */
  Input.onKey = function (fn) {
    K.keyHandlers.push(fn);
    return () => { const i = K.keyHandlers.indexOf(fn); if (i >= 0) K.keyHandlers.splice(i, 1); };
  };

  /** Joystick zone rect in CSS px (landscape only: design 9.2 landscape zone), mirrored when lefty. */
  Input.joyZone = function (strict) {
    const W = globalThis.innerWidth || 800, H = globalThis.innerHeight || 600;
    let w, top;
    if (strict) { w = 0.30; top = 0.45; }
    else { w = 0.5; top = 0.15; }                         // carrier mode: no aim zone, be generous
    const x0 = K.opts.lefty ? W * (1 - w) : 0;
    return { x0: x0, x1: x0 + W * w, y0: H * top, y1: H };
  };

  /**
   * Called once per fixed tick. @returns {Object} InputFrame (same object every call)
   */
  Input.sample = function () {
    const f = frame;
    const kb = Input.Keyboard ? Input.Keyboard.state() : null;
    const moveOk = K.mode === 'qb' || K.mode === 'carrier' || K.mode === 'return';
    let mx = 0, my = 0;
    if (moveOk) {
      if (kb) { mx = kb.mx; my = kb.my; }
      if (K.joy.on && K.joy.mag > 0) { mx = K.joy.x; my = K.joy.y; }
    }
    f.mx = mx; f.my = my;
    const joyFull = K.joy.on && K.joy.mag >= 0.9;
    f.sprint = moveOk && (!!(kb && kb.shift) || K.hold.sprint || joyFull);
    f.lob = !!(kb && kb.shift) || K.hold.lob || K.aim.lob;
    f.ffHeld = !!(kb && kb.ffHeld) || K.hold.ff;
    // aim drag (QB)
    const a = K.aim, fa = f.aim;
    fa.on = K.mode === 'qb' && a.on && !a.cancel; fa.sx = a.sx; fa.sy = a.sy; fa.ox = a.ox; fa.oy = a.oy;
    fa.dx = a.dx; fa.dy = a.dy; fa.pow = a.pow; fa.cancel = a.cancel;
    // kick aim: pointer drag wins over keyboard
    const kk = K.mode === 'kick' ? (K.kick.on || K.kick.src === 'ptr' ? K.kick : (kb && kb.kick)) : null;
    const fk = f.kickAim;
    if (kk) { fk.on = !!kk.on; fk.dx = kk.dx; fk.dy = kk.dy; fk.pow = kk.pow; fk.src = kk.src || ''; }
    else { fk.on = false; fk.pow = 0; fk.src = ''; }
    f.seek.on = K.mode === 'carrier' && K.seek.on; f.seek.sx = K.seek.sx; f.seek.sy = K.seek.sy;
    f.tap.on = K.tap.on; f.tap.sx = K.tap.sx; f.tap.sy = K.tap.sy; K.tap.on = false;
    for (let i = 0; i < EDGES.length; i++) { const e = EDGES[i]; f[e] = K.edges[e]; K.edges[e] = false; }
    f.pass = K.pass; K.pass = 0;
    if (f.throw && K.aim.last) {                 // the release tick carries the final drag values
      const l = K.aim.last;
      fa.sx = l.sx; fa.sy = l.sy; fa.ox = l.ox; fa.oy = l.oy; fa.dx = l.dx; fa.dy = l.dy; fa.pow = l.pow;
      f.lob = f.lob || l.lob;
      K.aim.last = null;
    }
    if (f.kick && K.kick.last) {
      const l = K.kick.last;
      fk.dx = l.dx; fk.dy = l.dy; fk.pow = l.pow; fk.src = l.src;
      K.kick.last = null;
    }
    f.device = Input.lastDevice;
    return f;
  };

  /** Debug/visualizer: copy of internal state. */
  Input.debugState = function () {
    return { mode: K.mode, device: Input.lastDevice, joy: Object.assign({}, K.joy), aim: Object.assign({}, K.aim, { last: null }),
      kick: Object.assign({}, K.kick, { last: null }), seek: Object.assign({}, K.seek), hold: Object.assign({}, K.hold) };
  };
})(globalThis.PT = globalThis.PT || {});
