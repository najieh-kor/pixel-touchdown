/* Pixel Touchdown: js/input/joystick.js
 * Owner: WP6. Responsibility: virtual joystick (DOM in #touch layer): FIXED home stick + floating fallback.
 *
 * Client fix ("run and throw at the same time on a phone"): during QB / carrier / return control on touch devices
 * a semi-transparent stick always sits at a fixed HOME spot in the bottom-left thumb zone (mirrored when lefty).
 * A thumb landing within 1.7 R of home drives it relative to the home center; a thumb elsewhere in the zone floats
 * the base under the thumb (then it returns home on release). Dragging past 1.6 R pulls a floating base along.
 * Output (Input._k.joy): x, y in screen space (y down), mag 0..1 after a 12% dead zone; mag ≥ 0.9 = sprint.
 * The aim zone excludes the stick area (Joystick.hit), so thumb 2 can slingshot while thumb 1 runs.
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const DEAD = 0.12;
  let base = null, knob = null, R = 56, bx = 0, by = 0;
  const K = () => Input._k;

  function place(node, x, y) { node.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; }
  function radius() {
    const W = globalThis.innerWidth || 800, H = globalThis.innerHeight || 600;
    return Math.max(44, Math.min(72, Math.min(W, H) * 0.11));
  }
  /** fixed home center (CSS px): bottom-left thumb spot, clear of the HUD's bottom-left pill in landscape */
  function home() {
    const W = globalThis.innerWidth || 800, H = globalThis.innerHeight || 600, r = radius();
    const k = K(), lefty = !!(k && k.opts && k.opts.lefty);      // landscape only (client decision)
    const pad = 22 + r * 1.15;
    const cx = lefty ? W - pad : pad;
    const cy = Math.min(H * 0.70, H - pad - 40);
    return { x: cx, y: cy, r: r };
  }
  function sizeBase() {
    R = radius();
    base.style.width = base.style.height = (R * 2) + 'px';
    base.style.marginLeft = base.style.marginTop = (-R) + 'px';
    knob.style.width = knob.style.height = Math.round(R * 0.9) + 'px';
  }
  function park() {                             // idle: base + centered knob at home
    if (!base) return;
    const h = home();
    sizeBase();
    bx = h.x; by = h.y; fixed = true;
    place(base, bx, by); place(knob, R - R * 0.45, R - R * 0.45);
  }
  function layoutHint() { if (!(K() && K().joy.on)) park(); }
  let fixed = true;

  Input.Joystick = {
    attach: function (el) {
      const doc = globalThis.document;
      if (!doc || base) return;
      base = doc.createElement('div'); base.className = 'pt-joy';
      knob = doc.createElement('div'); knob.className = 'pt-joy-knob';
      base.appendChild(knob);
      el.appendChild(base);
      park();
      globalThis.addEventListener('resize', layoutHint);
    },
    /** is (x, y) on the stick (near home, or inside the thumb zone)? The aim zone excludes this area. */
    hit: function (x, y, strictZone) {
      const h = home();
      if (Math.hypot(x - h.x, y - h.y) <= h.r * 1.7) return true;
      const z = Input.joyZone(strictZone);
      return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
    },
    home: home,
    /** thumb down at (x, y) CSS px: fixed (relative to home) when near home, else floating under the thumb */
    start: function (x, y) {
      const h = home();
      R = h.r;
      fixed = Math.hypot(x - h.x, y - h.y) <= R * 1.7;
      bx = fixed ? h.x : x; by = fixed ? h.y : y;
      const k = K();
      k.joy.on = true; k.joy.x = 0; k.joy.y = 0; k.joy.mag = 0;
      if (base) {
        sizeBase();
        place(base, bx, by); place(knob, R - R * 0.45, R - R * 0.45);
        base.classList.add('on');
      }
      if (fixed) Input.Joystick.move(x, y);
    },
    move: function (x, y) {
      const k = K();
      if (!k.joy.on) return;
      let dx = x - bx, dy = y - by, len = Math.hypot(dx, dy);
      if (!fixed && len > R * 1.6) {           // floating: drag the base along
        const pull = len - R * 1.6;
        bx += dx / len * pull; by += dy / len * pull;
        dx = x - bx; dy = y - by; len = Math.hypot(dx, dy);
        if (base) place(base, bx, by);
      }
      const raw = Math.min(1, len / R);
      const mag = raw <= DEAD ? 0 : (raw - DEAD) / (1 - DEAD);
      k.joy.mag = mag;
      k.joy.x = len ? dx / len * mag : 0;
      k.joy.y = len ? dy / len * mag : 0;
      if (knob) {
        const kl = Math.min(len, R), kx = len ? dx / len * kl : 0, ky = len ? dy / len * kl : 0;
        place(knob, R - R * 0.45 + kx, R - R * 0.45 + ky);
        knob.classList.toggle('sprint', mag >= 0.9);
      }
    },
    end: function () {
      const k = K();
      if (!k) return;
      k.joy.on = false; k.joy.x = 0; k.joy.y = 0; k.joy.mag = 0;
      if (base) base.classList.remove('on');
      if (knob) knob.classList.remove('sprint');
      park();
    },
    relayout: layoutHint
  };
})(globalThis.PT = globalThis.PT || {});
