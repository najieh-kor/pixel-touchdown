/* Pixel Touchdown: js/input/pointer.js
 * Owner: WP6. Responsibility: pointer events (mouse+touch unified), capture, multi-touch tracking.
 *
 * Every pointer that lands on the #touch layer gets ONE role for its whole life (pointer capture keeps it):
 *   touch  qb       joystick zone → 'joy' (floating joystick) · elsewhere → 'aim' (slingshot drag)
 *          carrier  left half → 'joy' · elsewhere nothing (HUD buttons are on the HUD layer)
 *          presnap  tap or swipe up → snap
 *          defense  touch-down → Star Play edge; tap-up → field tap (move the Star before the snap)
 *          kick     drag back → kick aim + power, release → kick
 *   mouse  qb       left drag = aim · right drag = aim + LOB
 *          carrier  hold left = run toward cursor · right click = juke · middle click = spin · double-click = dive
 *          presnap  click / swipe = snap · defense: click = Star / tap · kick: drag back like touch
 * Multi-touch: joystick + aim (or joystick + HUD button) at the same time.
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const ptrs = new Map();
  let el = null, lastClick = { t: -1e9, x: 0, y: 0 };
  const K = () => Input._k;

  function kindOf(e) { return e.pointerType === 'mouse' ? 'mouse' : 'touch'; }
  function inRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
  function joyBusy() { for (const p of ptrs.values()) if (p.role === 'joy') return true; return false; }
  function aimBusy() { for (const p of ptrs.values()) if (p.role === 'aim' || p.role === 'kick') return true; return false; }

  function onDown(e) {
    const k = K();
    if (!k.inGame()) return;
    const type = kindOf(e);
    k.device(type);
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    const x = e.clientX, y = e.clientY, now = k.now();
    const p = { id: e.pointerId, type: type, btn: e.button || 0, x0: x, y0: y, x: x, y: y, t0: now, role: 'none', moved: false };
    ptrs.set(e.pointerId, p);
    const G = Input.Gestures, J = Input.Joystick, m = k.mode;
    if (type === 'touch') {
      const moveMode = m === 'qb' || m === 'carrier' || m === 'return';
      const onStick = moveMode && J.hit(x, y, m === 'qb');
      if (onStick && !joyBusy()) { p.role = 'joy'; J.start(x, y); }
      else if (onStick) { /* second thumb on the stick area: ignore (the aim zone excludes the stick) */ }
      else if (m === 'return') p.role = 'swipe';      // tap = fair catch / touchback
      else if (m === 'qb') { if (!aimBusy()) { p.role = 'aim'; G.aimStart(x, y, false); } }
      else if (m === 'presnap') p.role = 'swipe';
      else if (m === 'defense') { k.edge('star'); p.role = 'tap'; }
      else if (m === 'kick') { if (!aimBusy()) { p.role = 'kick'; G.kickStart(x, y); } }
      return;
    }
    // mouse
    if (p.btn === 2) {
      if (m === 'qb') { p.role = 'aim'; G.aimStart(x, y, true); }
      else if (m === 'carrier') k.edge('juke');
      else if (m === 'defense') k.edge('star');
    } else if (p.btn === 1) {
      if (m === 'carrier') k.edge('spin');
    } else {
      if (m === 'qb') { p.role = 'aim'; G.aimStart(x, y, false); }
      else if (m === 'carrier') {
        if (now - lastClick.t < 320 && Math.hypot(x - lastClick.x, y - lastClick.y) < 24) { k.edge('dive'); lastClick.t = -1e9; }
        else lastClick = { t: now, x: x, y: y };
        p.role = 'seek'; k.seek.on = true; k.seek.sx = x; k.seek.sy = y;
      } else if (m === 'presnap' || m === 'return') p.role = 'swipe';
      else if (m === 'defense') { k.edge('star'); p.role = 'tap'; }
      else if (m === 'kick') { p.role = 'kick'; G.kickStart(x, y); }
    }
  }

  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.x0, p.y - p.y0) > 10) p.moved = true;
    const G = Input.Gestures, k = K();
    switch (p.role) {
      case 'joy':
        // the stick was reset by a mode change (e.g. off during a whistle) but the thumb never left: pick it back up
        if (!k.joy.on && (k.mode === 'qb' || k.mode === 'carrier' || k.mode === 'return')) Input.Joystick.start(p.x, p.y);
        Input.Joystick.move(p.x, p.y);
        break;
      case 'aim': G.aimMove(p.x, p.y); break;
      case 'kick': G.kickMove(p.x, p.y); break;
      case 'seek': k.seek.sx = p.x; k.seek.sy = p.y; break;
    }
  }

  function finish(e, cancelled) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    const k = K(), G = Input.Gestures;
    p.x = e.clientX || p.x; p.y = e.clientY || p.y;
    switch (p.role) {
      case 'joy': Input.Joystick.end(); break;
      case 'aim': if (cancelled) G.cancel(); else { G.aimMove(p.x, p.y); G.aimEnd(); } break;
      case 'kick': if (cancelled) G.cancel(); else { G.kickMove(p.x, p.y); G.kickEnd(); } break;
      case 'seek': k.seek.on = false; break;
      case 'swipe': {
        if (cancelled) break;
        const g = G.classify(p, k.now());
        if (g === 'tap' || g === 'swipeUp') k.edge('snap');
        break;
      }
      case 'tap': {
        if (cancelled) break;
        if (G.classify(p, k.now()) === 'tap') { k.tap.on = true; k.tap.sx = p.x; k.tap.sy = p.y; }
        break;
      }
    }
  }

  function preventIfGame(e) { if (K().inGame()) e.preventDefault(); }

  Input.Pointer = {
    attach: function (layer) {
      el = layer;
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', (e) => finish(e, false));
      el.addEventListener('pointercancel', (e) => finish(e, true));
      el.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) finish(e, false); });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      // iOS: a non-passive touchstart preventDefault stops long-press callouts/magnifier (which fire pointercancel),
      // double-tap zoom and in-page edge swipes from stealing a held joystick or slingshot touch
      el.addEventListener('touchstart', (e) => { if (K().inGame() && e.cancelable) e.preventDefault(); }, { passive: false });
      el.addEventListener('touchmove', (e) => { if (K().inGame() && e.cancelable) e.preventDefault(); }, { passive: false });
      el.addEventListener('dblclick', (e) => e.preventDefault());
      el.addEventListener('auxclick', (e) => e.preventDefault());
      const doc = globalThis.document;
      // Playtest fix: HUD action buttons fire on PRESS, not on click. A click is only synthesized for a lone tap, so
      // Juke/Spin/Dive tapped with a second finger while the thumb holds the joystick never fired (0/8 in the
      // multi-touch test), and every button waited for finger-up. The HUD's own click that follows is swallowed.
      if (doc) {
        const FAST = { juke: 1, spin: 1, dive: 1, snap: 1, star: 1, ability: 1 };   // HUD STAR button = data-hact="ability"
        let swallow = null;
        doc.addEventListener('pointerdown', (e) => {
          const k = K();
          if (!k || !k.inGame() || (e.pointerType === 'mouse' && e.button !== 0)) return;
          const t = e.target && e.target.closest ? e.target.closest('[data-hact]') : null;
          if (!t || t.disabled || !FAST[t.getAttribute('data-hact')]) return;
          Input.press(t.getAttribute('data-hact'));
          swallow = { el: t, until: k.now() + 1500 };
        }, true);
        doc.addEventListener('click', (e) => {
          if (!swallow) return;
          const t = e.target && e.target.closest ? e.target.closest('[data-hact]') : null;
          if (t === swallow.el && K().now() < swallow.until) { e.stopPropagation(); e.preventDefault(); }
          swallow = null;
        }, true);
      }
      // device detection everywhere (HUD buttons, menus) so hints match the device in use
      globalThis.addEventListener('pointerdown', (e) => {
        const k = K(); if (k) k.device(kindOf(e));
      }, true);
      // no pinch-zoom / pull-to-refresh / page scroll while playing
      if (doc) {
        doc.addEventListener('gesturestart', preventIfGame);
        doc.addEventListener('touchmove', (e) => {
          if (!K().inGame()) return;
          const t = e.target;
          if (t && t.closest && t.closest('#screen,#modal')) return;
          e.preventDefault();
        }, { passive: false });
      }
    },
    /** active pointers (debug / visualizer) */
    list: function () { return Array.from(ptrs.values()).map((p) => ({ id: p.id, type: p.type, role: p.role, x: p.x, y: p.y })); }
  };
})(globalThis.PT = globalThis.PT || {});
