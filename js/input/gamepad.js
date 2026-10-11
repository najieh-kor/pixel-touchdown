/* Pixel Touchdown: js/input/gamepad.js
 * Owner: FEATURES. Responsibility: PT.Input.Gamepad: Gamepad API support (design 9.8), standard mapping.
 *
 * Polls navigator.getGamepads() on requestAnimationFrame while a pad is connected and feeds the same shared input
 * state the touch/keyboard modules use (PT.Input._k): K.joy (move), K.aim (+ .last and the 'throw' edge), K.kick
 * (+ .last and the 'kick' edge), Input.press(edge) and Input.hold('sprint'|'lob'|'ff'). No changes to input.js needed.
 *
 *   any game mode   left stick move · RT hold = sprint · LT hold = lob · Start = pause · Y = Star ability
 *   presnap         A = snap · LB = audible
 *   qb              right stick = aim (points AT the target, push farther = longer) → RT press or let the stick go = throw
 *                   · B = throw away
 *   carrier/return  A = juke · B = spin · X = dive
 *   defense         A = GO (presnap) / Star Play (live) · LB = move the Star · RB = fast » · X = skip
 *   kick            left stick left/right = aim (±15°) · hold A = power (loops like the keyboard bar), let go = kick ·
 *                   Back = auto kick
 *   menus / trays   D-pad or left stick = move focus (arrow keys) · A = press the focused button · B = back (Esc)
 * Shows a "Gamepad connected" toast; PT.Input.lastDevice becomes 'pad' while it is used (emits input:device).
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const DEAD = 0.18, AIM_ON = 0.3, AIM_REL = 0.2, MENU_STICK = 0.6, REPEAT0 = 380, REPEAT = 140;
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

  const st = {
    on: false, raf: 0, idx: -1, prev: [], held: { sprint: false, lob: false },
    joyOwned: false, aimOwned: false, aimT: 0, aimLast: null, kickOwned: false, kickCharge: false, kickT0: 0,
    nav: { dir: '', t: 0, next: 0 }
  };
  const K = () => Input._k;
  const now = () => (globalThis.performance ? globalThis.performance.now() : 0);

  function pads() {
    const n = globalThis.navigator;
    if (!n || typeof n.getGamepads !== 'function') return [];
    try { return Array.prototype.filter.call(n.getGamepads() || [], (p) => p && p.connected); } catch (e) { return []; }
  }
  function pressed(gp, i) { const b = gp.buttons[i]; return !!b && (b.pressed || b.value > 0.5); }
  function axis(gp, i) { const v = gp.axes[i] || 0; return Math.abs(v) < DEAD ? 0 : v; }
  function stick(gp, ax, ay) {
    const x = gp.axes[ax] || 0, y = gp.axes[ay] || 0, m = Math.hypot(x, y);
    if (m < DEAD) return { x: 0, y: 0, m: 0 };
    const mag = Math.min(1, (m - DEAD) / (1 - DEAD));
    return { x: x / m * mag, y: y / m * mag, m: mag };
  }
  function toast(t) { const T = PT.UI && PT.UI.Toast; if (T && T.show) T.show(t, 'info', 1800); }

  // ---------------- menus: synthetic arrow / Esc keys, A clicks the focused button ----------------
  function key(k) {
    const doc = globalThis.document;
    if (!doc) return;
    const code = k === 'Escape' ? 'Escape' : k;
    doc.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: k, code: code, bubbles: true, cancelable: true }));
    doc.dispatchEvent(new globalThis.KeyboardEvent('keyup', { key: k, code: code, bubbles: true, cancelable: true }));
  }
  function clickFocused() {
    const doc = globalThis.document;
    const a = doc && doc.activeElement;
    if (a && a !== doc.body && typeof a.click === 'function' && (a.tagName === 'BUTTON' || a.hasAttribute('data-action') || a.tagName === 'A')) { a.click(); return; }
    key('ArrowDown');                              // nothing focused yet: focus the first button
  }
  function menuNav(gp, t) {
    const ls = stick(gp, 0, 1);
    const dir = pressed(gp, B.UP) || ls.y < -MENU_STICK ? 'ArrowUp' : pressed(gp, B.DOWN) || ls.y > MENU_STICK ? 'ArrowDown'
      : pressed(gp, B.LEFT) || ls.x < -MENU_STICK ? 'ArrowLeft' : pressed(gp, B.RIGHT) || ls.x > MENU_STICK ? 'ArrowRight' : '';
    const n = st.nav;
    if (!dir) { n.dir = ''; return; }
    if (dir !== n.dir) { n.dir = dir; n.next = t + REPEAT0; key(dir); return; }
    if (t >= n.next) { n.next = t + REPEAT; key(dir); }
  }

  // ---------------- game modes ----------------
  function releaseOwned() {
    const k = K();
    if (st.joyOwned) { k.joy.on = false; k.joy.x = 0; k.joy.y = 0; k.joy.mag = 0; st.joyOwned = false; }
    if (st.aimOwned) { k.aim.on = false; st.aimOwned = false; st.aimLast = null; }
    if (st.kickOwned) { k.kick.on = false; k.kick.src = ''; st.kickOwned = false; st.kickCharge = false; }
  }
  function hold(name, on) {
    if (st.held[name] === on) return;
    st.held[name] = on;
    Input.hold(name, on);
  }

  function aimQB(gp, edge) {
    const k = K(), rs = stick(gp, 2, 3), t = now();
    const W = globalThis.innerWidth || 800, H = globalThis.innerHeight || 600;
    if (rs.m >= AIM_ON || (st.aimOwned && rs.m >= AIM_REL)) {
      const pow = Math.max(0.05, Math.min(1, (rs.m - 0.25) / 0.7));
      if (!st.aimOwned) { st.aimOwned = true; st.aimT = t; }
      const a = k.aim;
      a.on = true; a.cancel = false; a.ox = W / 2; a.oy = H / 2;
      a.dx = rs.x; a.dy = rs.y; a.pow = pow; a.sx = a.ox - rs.x * 100; a.sy = a.oy - rs.y * 100; a.lob = pressed(gp, B.LT);
      st.aimLast = { sx: a.sx, sy: a.sy, ox: a.ox, oy: a.oy, dx: a.dx, dy: a.dy, pow: pow, lob: a.lob };
      if (edge(B.RT)) fireThrow();
    } else if (st.aimOwned) {
      // stick let go: a flick throws (slingshot feel); a slow drift back to center cancels
      const flick = st.aimLast && st.aimLast.pow >= 0.25 && t - st.aimT > 120;
      if (flick) fireThrow(); else { k.aim.on = false; st.aimOwned = false; st.aimLast = null; }
    }
  }
  function fireThrow() {
    const k = K();
    if (!st.aimLast) return;
    k.aim.last = Object.assign({}, st.aimLast);
    k.aim.on = false;
    k.edge('throw');
    st.aimOwned = false; st.aimLast = null;
  }

  function kickMode(gp) {
    const k = K(), t = now();
    const ang = axis(gp, 0) * 15 * Math.PI / 180;
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const a = pressed(gp, B.A);
    if (a && !st.kickCharge) { st.kickCharge = true; st.kickT0 = t; }
    const ph = ((t - st.kickT0) / 1200) % 2, pow = st.kickCharge ? (ph <= 1 ? ph : 2 - ph) : 0;
    if (st.kickCharge && !a) {
      st.kickCharge = false;
      k.kick.last = { dx: dx, dy: dy, pow: pow, src: 'pad' };
      k.kick.on = false; k.kick.src = ''; st.kickOwned = false;
      k.edge('kick');
      return;
    }
    if (st.kickCharge || Math.abs(axis(gp, 0)) > 0) {
      st.kickOwned = true;
      k.kick.on = true; k.kick.dx = dx; k.kick.dy = dy; k.kick.pow = pow; k.kick.src = 'pad';
    } else if (st.kickOwned) { k.kick.on = false; k.kick.src = ''; st.kickOwned = false; }
  }

  function gameModes(gp, mode, edge) {
    const k = K();
    // move (left stick) — any mode that moves; the joystick module owns K.joy while a finger is down
    const ls = stick(gp, 0, 1);
    if (mode !== 'kick' && ls.m > 0 && !(k.joy.on && !st.joyOwned)) {
      st.joyOwned = true; k.joy.on = true; k.joy.x = ls.x; k.joy.y = ls.y; k.joy.mag = ls.m;
    } else if (st.joyOwned && (ls.m === 0 || mode === 'kick')) { k.joy.on = false; k.joy.x = 0; k.joy.y = 0; k.joy.mag = 0; st.joyOwned = false; }
    hold('sprint', pressed(gp, B.RT) && mode !== 'qb' || (mode === 'qb' && pressed(gp, B.RT) && !st.aimOwned));
    hold('lob', pressed(gp, B.LT));
    if (edge(B.START)) Input.press('pause');
    if (edge(B.Y)) Input.press('ability');
    switch (mode) {
      case 'presnap': if (edge(B.A)) Input.press('snap'); if (edge(B.LB)) Input.press('audible'); break;
      case 'qb': aimQB(gp, edge); if (edge(B.B)) Input.press('throwAway'); if (edge(B.A)) Input.press('snap'); break;
      case 'carrier': case 'return':
        if (edge(B.A)) Input.press('juke');
        if (edge(B.B)) Input.press('spin');
        if (edge(B.X)) Input.press('dive');
        break;
      case 'defense':
        if (edge(B.A)) { Input.press('go'); Input.press('star'); }
        if (edge(B.LB)) Input.press('cycle');
        if (edge(B.RB)) Input.press('ff');
        if (edge(B.X)) Input.press('skip');
        break;
      case 'kick': kickMode(gp); if (edge(B.BACK)) Input.press('autoKick'); break;
    }
    if (mode !== 'qb' && st.aimOwned) { k.aim.on = false; st.aimOwned = false; st.aimLast = null; }
    if (mode !== 'kick' && st.kickOwned) { k.kick.on = false; k.kick.src = ''; st.kickOwned = false; st.kickCharge = false; }
  }

  function poll() {
    st.raf = 0;
    const list = pads();
    if (!list.length) { st.on = false; releaseOwned(); return; }
    const gp = list[0], k = K(), t = now();
    const prev = st.prev;
    const edge = (i) => pressed(gp, i) && !prev[i];
    let active = false;
    for (let i = 0; i < gp.buttons.length; i++) if (pressed(gp, i)) { active = true; break; }
    if (!active) for (let i = 0; i < Math.min(4, gp.axes.length); i++) if (Math.abs(gp.axes[i] || 0) > 0.5) { active = true; break; }
    if (k) {
      if (active) k.device('pad');
      const mode = k.mode;
      if (k.inGame()) gameModes(gp, mode, edge);
      else {
        releaseOwned();
        hold('sprint', false); hold('lob', false);
        menuNav(gp, t);
        if (edge(B.A)) clickFocused();
        if (edge(B.B)) key('Escape');
        if (edge(B.START)) {
          const H = PT.UI && PT.UI.Hud;
          if (H && H.active && H.active()) key('Escape');      // in a game: open / close the pause menu
          else clickFocused();
        }
      }
    }
    st.prev = gp.buttons.map((b, i) => pressed(gp, i));
    st.raf = globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(poll) : setTimeout(poll, 16);
  }
  function start() {
    if (st.on) return;
    st.on = true;
    st.prev = [];
    poll();
  }

  Input.Gamepad = {
    /** @returns {boolean} a pad is connected and being polled */
    connected: function () { return st.on; },
    /** @returns {string|null} id of the first pad */
    id: function () { const p = pads()[0]; return p ? p.id : null; },
    /** debug: copy of the poll state */
    state: function () { return { on: st.on, joy: st.joyOwned, aim: st.aimOwned, kick: st.kickOwned, held: Object.assign({}, st.held) }; },
    /** test hook: run one poll now (with a stubbed navigator.getGamepads) */
    _poll: function () { if (!st.on) { st.on = true; st.prev = []; } const r = st.raf; if (r && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(r); poll(); },
    start: start
  };

  if (globalThis.addEventListener) {
    globalThis.addEventListener('gamepadconnected', () => {
      toast('Gamepad connected');
      if (PT.Events) PT.Events.emit('input:gamepad', { on: true });
      start();
    });
    globalThis.addEventListener('gamepaddisconnected', () => {
      if (!pads().length) {
        toast('Gamepad disconnected');
        if (PT.Events) PT.Events.emit('input:gamepad', { on: false });
      }
    });
  }
})(globalThis.PT = globalThis.PT || {});
