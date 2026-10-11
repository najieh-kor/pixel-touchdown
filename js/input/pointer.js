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
 *
 * Robustness (iPhone bug "the joystick stopped mid-game, throwing still worked"): ROOT CAUSE = a 'joy' pointer whose
 * pointerup/pointercancel never arrived (iOS drops them when the target turns pointer-events:none at a whistle, or when
 * a system gesture ends the touch with only a touchcancel). The stale entry made joyBusy() true forever, so every new
 * thumb on the stick was ignored while aim touches (no joyBusy check) kept working. Defences:
 *   - every pointer entry is validated against the real TouchEvent.touches list (prune) before joyBusy() answers,
 *     on every touch event, and by a watchdog in Input.sample();
 *   - a thumb still held after a reset is ADOPTED again on its next move over the stick;
 *   - hard reset (drop entries, release capture, recenter) on pause, modal, tray-less mode exits, visibility, blur,
 *     orientation change, rotate overlay, game start/exit;
 *   - #touch keeps pointer-events during a live game (html.pt-ingame) and the stick has a top-level hit area
 *     (#pt-joyhit, above HUD banners/toasts) in qb / carrier / return modes.
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const ptrs = new Map();
  let el = null, hitEl = null, lastClick = { t: -1e9, x: 0, y: 0 };
  let curTouches = null;                     // last TouchEvent.touches snapshot [{x, y}] (null until a touch event is seen)
  let lastTouchEvT = 0, wdT = 0;
  const MOVE_MODES = { qb: 1, carrier: 1, return: 1 };
  const K = () => Input._k;

  function kindOf(e) { return e.pointerType === 'mouse' ? 'mouse' : 'touch'; }
  function inRect(r, x, y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
  function nowMs() { const k = K(); return k ? k.now() : 0; }
  function nearTouch(p) {
    if (!curTouches) return true;
    for (let i = 0; i < curTouches.length; i++) if (Math.hypot(curTouches[i].x - p.x, curTouches[i].y - p.y) < 110) return true;
    return false;
  }
  /** drop one pointer entry without side effects (no throw / kick / snap edges) */
  function dropPtr(p, why) {
    if (!ptrs.has(p.id)) return;
    ptrs.delete(p.id);
    try { if (p.cap && p.cap.hasPointerCapture && p.cap.hasPointerCapture(p.id)) p.cap.releasePointerCapture(p.id); } catch (e) { /* gone */ }
    const k = K();
    if (p.role === 'joy') Input.Joystick.end();
    else if (p.role === 'aim' || p.role === 'kick') Input.Gestures.cancel();
    else if (p.role === 'seek' && k) k.seek.on = false;
    if (PT.Log && why) PT.Log.debug('input', 'drop pointer ' + p.id + ' (' + p.role + '): ' + why);
  }
  /**
   * Remove touch pointers that no real finger backs any more. joy entries go quickly (250 ms without an event and no
   * finger near), others only after 1.5 s (their release may still be on its way and carries the throw/kick).
   */
  function prune(force) {
    if (!curTouches && !force) return;
    const now = nowMs();
    for (const p of Array.from(ptrs.values())) {
      if (p.type !== 'touch') continue;
      if (curTouches && curTouches.length && nearTouch(p)) continue;
      const age = now - p.tLast;
      if (age > (p.role === 'joy' ? 250 : 1500) || force) dropPtr(p, 'no finger');
    }
    const k = K();
    if (k && k.joy.on) {                                       // a live stick must have a live 'joy' pointer
      let has = false;
      for (const p of ptrs.values()) if (p.role === 'joy') { has = true; break; }
      if (!has) Input.Joystick.end();
    }
  }
  function joyBusy() { prune(false); for (const p of ptrs.values()) if (p.role === 'joy') return true; return false; }
  function aimBusy() { for (const p of ptrs.values()) if (p.role === 'aim' || p.role === 'kick') return true; return false; }

  function onDown(e) {
    const k = K();
    if (!k.inGame()) return;
    const type = kindOf(e);
    k.device(type);
    e.preventDefault();
    const cap = e.currentTarget || el;
    try { cap.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    const x = e.clientX, y = e.clientY, now = k.now();
    const old = ptrs.get(e.pointerId);
    if (old) dropPtr(old, 'id reused');                       // a reused id means its release was lost
    const p = { id: e.pointerId, type: type, btn: e.button || 0, x0: x, y0: y, x: x, y: y, t0: now, tLast: now, role: 'none', moved: false, cap: cap };
    ptrs.set(e.pointerId, p);
    const G = Input.Gestures, J = Input.Joystick, m = k.mode;
    if (type === 'touch') {
      const moveMode = m === 'qb' || m === 'carrier' || m === 'return';
      const onStick = moveMode && J.hit(x, y, m === 'qb');
      if (onStick) {
        // a new thumb on the stick ALWAYS takes it over: a stale 'joy' entry (lost release) can never block the stick
        for (const q of Array.from(ptrs.values())) if (q.role === 'joy' && q.id !== p.id) dropPtr(q, 'new thumb on the stick');
        p.role = 'joy'; J.start(x, y);
      }
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
    let p = ptrs.get(e.pointerId);
    if (!p) {
      // a thumb still held after a hard reset (pause, modal, whistle…): adopt it again when it moves on the stick
      const k = K();
      if (!k || !MOVE_MODES[k.mode] || kindOf(e) !== 'touch' || !(e.buttons || e.pressure)) return;
      if (!Input.Joystick.hit(e.clientX, e.clientY, k.mode === 'qb') || joyBusy()) return;
      const now = k.now();
      p = { id: e.pointerId, type: 'touch', btn: 0, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, tLast: now, role: 'joy', moved: true, cap: e.currentTarget || el };
      ptrs.set(e.pointerId, p);
      try { p.cap.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      Input.Joystick.start(p.x, p.y);
    }
    p.x = e.clientX; p.y = e.clientY; p.tLast = nowMs();
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

  /** real fingers (TouchEvent.touches) → prune pointers no finger backs */
  function onTouchList(e) {
    const t = e.touches;
    const list = [];
    for (let i = 0; i < t.length; i++) list.push({ x: t[i].clientX, y: t[i].clientY });
    curTouches = list;
    lastTouchEvT = nowMs();
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      if (!list.length) {
        // no finger left on the screen: give the matching pointerup 120 ms to arrive, then drop leftovers
        setTimeout(() => { if (curTouches && !curTouches.length) prune(true); }, 120);
      } else prune(false);
    }
  }

  function positionHit() {
    if (!hitEl || !Input.Joystick || !Input.Joystick.home) return;
    const h = Input.Joystick.home(), r = h.r * 1.7;
    hitEl.style.left = Math.round(h.x - r) + 'px'; hitEl.style.top = Math.round(h.y - r) + 'px';
    hitEl.style.width = hitEl.style.height = Math.round(r * 2) + 'px';
  }

  Input.Pointer = {
    attach: function (layer) {
      el = layer;
      const wire = (node) => {
        node.addEventListener('pointerdown', onDown);
        node.addEventListener('pointermove', onMove);
        node.addEventListener('pointerup', (e) => finish(e, false));
        node.addEventListener('pointercancel', (e) => finish(e, true));
        node.addEventListener('lostpointercapture', (e) => { const p = ptrs.get(e.pointerId); if (p && p.cap === node) finish(e, false); });
        node.addEventListener('touchstart', (e) => { if (K().inGame() && e.cancelable) e.preventDefault(); }, { passive: false });
        node.addEventListener('contextmenu', (e) => e.preventDefault());
      };
      wire(el);
      // the stick's own hit area, above HUD banners/toasts (z 35) — only in qb / carrier / return (see touch.css)
      const doc0 = globalThis.document;
      if (doc0 && doc0.body) {
        hitEl = doc0.createElement('div');
        hitEl.id = 'pt-joyhit';
        hitEl.setAttribute('data-mode', K().mode);
        doc0.body.appendChild(hitEl);
        wire(hitEl);
        positionHit();
        globalThis.addEventListener('resize', positionHit);
      }
      // real finger list (window, capture: sees touches on any layer, even if a pointerup is lost)
      ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((n) => globalThis.addEventListener(n, onTouchList, { capture: true, passive: true }));
      // hard resets: anything that can steal or orphan a held touch
      const reset = () => Input.Pointer.reset();
      ['blur', 'pagehide', 'orientationchange'].forEach((n) => globalThis.addEventListener(n, reset));
      if (PT.Events) {
        PT.Events.on('game:pause', (p) => { if (p && p.on) reset(); });
        PT.Events.on('ui:modal', (p) => { if (p && p.open) reset(); });
        PT.Events.on('app:visibility', (p) => { if (p && p.hidden) reset(); });
        PT.Events.on('app:rotate', reset);
        PT.Events.on('game:start', reset);
        PT.Events.on('game:exit', reset);
      }
      // iOS: a non-passive touchstart/touchmove preventDefault stops long-press callouts/magnifier (which fire
      // pointercancel), double-tap zoom and in-page edge swipes from stealing a held joystick or slingshot touch
      el.addEventListener('touchmove', (e) => { if (K().inGame() && e.cancelable) e.preventDefault(); }, { passive: false });
      el.addEventListener('dblclick', (e) => e.preventDefault());
      el.addEventListener('auxclick', (e) => e.preventDefault());
      const doc = globalThis.document;
      // Playtest fix: HUD action buttons fire on PRESS, not on click. A click is only synthesized for a lone tap, so
      // Juke/Spin/Dive tapped with a second finger while the thumb holds the joystick never fired (0/8 in the
      // multi-touch test), and every button waited for finger-up. The HUD's own click that follows is swallowed.
      if (doc) {
        // pause too: a pause tap while the other thumbs hold the stick / slingshot gets no click on phones (soak test)
        const FAST = { juke: 1, spin: 1, dive: 1, snap: 1, star: 1, ability: 1, pause: 1 };   // HUD STAR button = data-hact="ability"
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
    /** hard reset: drop every pointer (no edges), release captures, recenter the stick, cancel drags */
    reset: function () {
      for (const p of Array.from(ptrs.values())) dropPtr(p, null);
      if (Input.Joystick) Input.Joystick.end();
      if (Input.Gestures) Input.Gestures.cancel();
      const k = K(); if (k) k.seek.on = false;
    },
    /** called every tick by Input.sample(): validate pointers (throttled to 4 Hz) */
    watchdog: function () {
      const now = nowMs();
      if (now - wdT < 250) return;
      wdT = now;
      prune(false);
      // no touch event for 1.5 s while a 'joy' entry claims an idle stick: it is stale
      for (const p of Array.from(ptrs.values())) {
        if (p.role === 'joy' && now - p.tLast > 1500 && now - lastTouchEvT > 1500 && curTouches && !curTouches.length) dropPtr(p, 'watchdog');
      }
    },
    /** keep the top-level hit area in step with the input mode and stick home */
    setMode: function (m) { if (hitEl) { hitEl.setAttribute('data-mode', m); positionHit(); } },
    relayout: positionHit,
    /** active pointers (debug / visualizer) */
    list: function () { return Array.from(ptrs.values()).map((p) => ({ id: p.id, type: p.type, role: p.role, x: p.x, y: p.y })); }
  };
})(globalThis.PT = globalThis.PT || {});
