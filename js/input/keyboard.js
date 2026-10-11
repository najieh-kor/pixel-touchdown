/* Pixel Touchdown: js/input/keyboard.js
 * Owner: WP6. Responsibility: key map -> buttons/move.
 *
 * Map (design 9.3–9.8, ARCHITECTURE 3.7):
 *   any game mode   WASD / arrows move · Shift sprint (+ lob at release) · Esc / P pause (only when no WP5 HUD owns
 *                   those keys: PT.UI.Hud.key handles Esc/P and calls PT.Session.pause/resume itself)
 *   presnap         Space / Enter = snap
 *   qb              1–4 Easy Throw to badge n · Q throw away · Space = snap edge (option "give")
 *   carrier         Q / J / Space juke · R / K spin · E / L dive   (Q/E/R match the HUD button hints, ARCHITECTURE 3.7)
 *   defense         Space Star Play (GO before the snap) · Enter GO · Tab move the Star · F » 2× toggle (hold also works; speeds otherwise come only from Settings) · X skip ·
 *                   D SKIP DRIVE (presnap or mid-play) · Auto-start defense is a Settings toggle only
 *   kickoff setup   O = onside kick (only when the engine offers it: snap.hud.onside)
 *   presnap/qb/carrier/defense   G = Star ability (STAR_ABILITIES 3) · V = audible tray (presnap, offense or defense)
 *   defense         Space = ability when the meter is full, else the ring Star Play (Session decides)
 *   return          Space / Enter / J = fair catch or touchback (snap.hud.retHint) · WASD = bring it out
 *   kick            ← / → aim (0.5° per press, ±15°) · hold Space to fill power (0→100% in 2.0 s, loops — relaxed per client), release
 *                   to kick · A auto kick
 * Keys typed into text fields are ignored. Decision prompts can intercept keys with PT.Input.onKey().
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const held = Object.create(null);
  const kick = { ang: 0, charging: false, t0: 0, touched: false };
  const kickOut = { on: false, dx: 0, dy: -1, pow: 0, src: 'kbd' };
  const st = { mx: 0, my: 0, shift: false, ffHeld: false, kick: kickOut };
  const PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1, Enter: 1 };
  let attached = false;
  const MOVE_KEYS = { KeyJ: 'juke', KeyK: 'spin', KeyR: 'spin', KeyL: 'dive', KeyE: 'dive' };
  const KICK_SWEEP_MS = 2000;            // one 0→100% power sweep (was 1.2 s; client: kick timing too tight)

  function K() { return Input._k; }
  function editable(t) {
    if (!t || !t.tagName) return false;
    const n = t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || t.isContentEditable;
  }

  function kickPow(now) {
    if (!kick.charging) return 0;
    const t = ((now - kick.t0) / KICK_SWEEP_MS) % 2;
    return t <= 1 ? t : 2 - t;
  }
  function kickDir() {
    const r = kick.ang * Math.PI / 180;
    kickOut.dx = Math.sin(r); kickOut.dy = -Math.cos(r);
  }

  function onDown(e) {
    const k = K();
    if (!k || editable(e.target)) return;
    const code = e.code || e.key;
    for (let i = k.keyHandlers.length - 1; i >= 0; i--) {
      if (k.keyHandlers[i](code, e)) { e.preventDefault(); return; }
    }
    held[code] = true;
    if (code === 'KeyO' && k.mode === 'off' && PT.Session && PT.Session.active && PT.Session.active()) { k.edge('onside'); return; }
    // ball in the air (mode off during a live game): juke / spin / dive presses are buffered by the Session for the catch
    if (k.mode === 'off' && !e.repeat && PT.Session && PT.Session.active && PT.Session.active()) {
      const mv = MOVE_KEYS[code];
      if (mv) { k.edge(mv); return; }
    }
    if (!k.inGame()) return;
    k.device('kbd');
    if (PREVENT[code]) e.preventDefault();
    const rep = e.repeat;
    // HUNT4: right after a snap / resume the 2nd press of a double Space must not become a Star tap. HIKE / GO keys are
    // never dropped (a quick hike right after the play call must work), and G / STAR (ability) is queued by the Session.
    const edge = (n) => { if (!rep && !(n === 'star' && Input.guardedKeys && Input.guardedKeys())) k.edge(n); };
    if (code === 'Escape' || code === 'KeyP') {
      const H = PT.UI && PT.UI.Hud;
      if (!(H && H.key && (!H.active || H.active()))) edge('pause');
      return;
    }
    if (code === 'KeyG' && k.mode !== 'kick') { edge('ability'); return; }
    if (code === 'KeyV' && (k.mode === 'presnap' || k.mode === 'defense')) { edge('audible'); return; }
    switch (k.mode) {
      case 'return':
        if (code === 'Space' || code === 'Enter' || code === 'KeyJ') edge('snap');
        break;
      case 'presnap':
        if (code === 'Space' || code === 'Enter') edge('snap');
        break;
      case 'qb':
        if (/^Digit[1-4]$/.test(code) || /^Numpad[1-4]$/.test(code)) { if (!rep) k.pass = +code.slice(-1); }
        else if (code === 'KeyQ') edge('throwAway');
        else if (code === 'Space') edge('snap');
        else if (MOVE_KEYS[code]) edge(MOVE_KEYS[code]);     // buffered by the Session, applied on the catch
        break;
      case 'carrier':
        if (code === 'KeyJ' || code === 'Space' || code === 'KeyQ') edge('juke');
        else if (code === 'KeyK' || code === 'KeyR') edge('spin');
        else if (code === 'KeyL' || code === 'KeyE') edge('dive');
        break;
      case 'defense':
        if (code === 'Space') { edge('star'); }
        else if (code === 'Enter') edge('go');
        else if (code === 'Tab') edge('cycle');
        else if (code === 'KeyF') edge('ff');
        else if (code === 'KeyX') edge('skip');
        else if (code === 'KeyD') edge('simDrive');      // SKIP DRIVE (presnap or mid-play); A no longer toggles Auto Defense
        break;
      case 'kick':
        if (code === 'ArrowLeft') { kick.ang = Math.max(-15, kick.ang - 0.5); kick.touched = true; kickDir(); }
        else if (code === 'ArrowRight') { kick.ang = Math.min(15, kick.ang + 0.5); kick.touched = true; kickDir(); }
        else if (code === 'Space' && !rep && !kick.charging) { kick.charging = true; kick.t0 = k.now(); kick.touched = true; }
        else if (code === 'KeyA') edge('autoKick');
        break;
    }
  }

  function onUp(e) {
    const k = K();
    const code = e.code || e.key;
    held[code] = false;
    if (!k || !k.inGame()) return;
    if (k.mode === 'kick' && code === 'Space' && kick.charging) {
      const pow = kickPow(k.now());
      kick.charging = false;
      kickDir();
      k.kick.last = { dx: kickOut.dx, dy: kickOut.dy, pow: pow, src: 'kbd' };
      k.edge('kick');
    }
  }

  function onBlur() { for (const c of Object.keys(held)) held[c] = false; kick.charging = false; }

  Input.Keyboard = {
    attach: function () {
      if (attached || !globalThis.addEventListener) return;
      attached = true;
      globalThis.addEventListener('keydown', onDown);
      globalThis.addEventListener('keyup', onUp);
      globalThis.addEventListener('blur', onBlur);
    },
    /** @returns {{mx:number,my:number,shift:boolean,ffHeld:boolean,kick:Object}} */
    state: function () {
      const x = (held.KeyD || held.ArrowRight ? 1 : 0) - (held.KeyA || held.ArrowLeft ? 1 : 0);
      const y = (held.KeyS || held.ArrowDown ? 1 : 0) - (held.KeyW || held.ArrowUp ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      st.mx = x / l; st.my = y / l;
      st.shift = !!(held.ShiftLeft || held.ShiftRight || held.Shift);
      st.ffHeld = !!held.KeyF;
      kickOut.on = kick.charging || kick.touched;
      kickOut.pow = kickPow(K().now());
      kickDir();
      return st;
    },
    reset: function () { kick.charging = false; kick.ang = 0; kick.touched = false; },
    held: function (code) { return !!held[code]; }
  };
})(globalThis.PT = globalThis.PT || {});
