/* Pixel Touchdown: js/input/gestures.js
 * Owner: WP6. Responsibility: aim-drag (slingshot), tap, swipe recognition.
 *
 * Slingshot (design 9.4): drag = start − current; power = clamp((|drag| − 0.06 ss) / (0.34 × ss), 0, 1) (ss = screen
 * short side; full power still at 0.40 ss, the cancel ring is a dead zone so short dump-offs are possible).
 * Point mode (setting aimMode:'point'): drag = current − start (same math, not inverted).
 * A drag shorter than 0.06 × screenShortSide does nothing; sliding back inside it and lifting cancels.
 * Kicking always uses drag-back (design 8.6). Writes Input._k.aim / Input._k.kick; release raises the
 * 'throw' / 'kick' edge with the final values in `.last`. Draws the 2D rubber-band + power arrow feedback
 * (the field arc + landing circle is drawn by Render from snapshot.aim).
 */
(function (PT) {
  'use strict';
  const Input = PT.Input = PT.Input || {};
  const NS = 'http://www.w3.org/2000/svg';
  const POW_K = 0.40, CANCEL_K = 0.06, KICK_SLOW = 1.4;
  let svg = null, band = null, arrow = null, head = null, ring = null, label = null, meter = null, meterFill = null, meterZone = null;
  let zone = null;                       // kick "enough power" band {lo, hi}
  const K = () => Input._k;

  function shortSide() { return Math.min(globalThis.innerWidth || 800, globalThis.innerHeight || 600); }
  function mk(tag, cls, parent) { const n = globalThis.document.createElementNS(NS, tag); if (cls) n.setAttribute('class', cls); parent.appendChild(n); return n; }
  function setAttrs(n, o) { for (const k in o) n.setAttribute(k, o[k]); }
  function powColor(p, kick) {
    if (kick && zone && zone.out) return '#ff5a4f';
    if (kick && zone) return p > zone.hi ? '#ff5a4f' : p >= zone.lo ? '#55e07a' : '#ffd23f';
    return p >= 0.95 ? '#ff5a4f' : p >= 0.7 ? '#ffd23f' : '#55e07a';
  }

  /** compute drag → state (screen space, throw direction) */
  function compute(s, x, y, alwaysSling, kick) {
    s.sx = x; s.sy = y;
    const rx = x - s.ox, ry = y - s.oy;
    const sling = alwaysSling || K().opts.aimMode !== 'point';
    s.dx = sling ? -rx : rx; s.dy = sling ? -ry : ry;
    const len = Math.hypot(rx, ry), ss = shortSide();
    // playtest: power counts from the edge of the cancel ring (a dead zone), not from the touch point. Before, the
    // shortest possible throw was 15% of max (~8 yd) and RB dump-offs / screens sat right on the cancel edge.
    // kicks: ~40% less power per pixel than throws (client: relaxed kick timing) → full power at ~0.54 × short side
    const span = (POW_K - CANCEL_K) * (kick ? KICK_SLOW : 1);
    s.pow = Math.max(0, Math.min(1, (len - CANCEL_K * ss) / (span * ss)));
    s.cancel = len < CANCEL_K * ss;
  }

  function draw(s, kick) {
    if (!svg) return;
    svg.classList.add('on');
    const ss = shortSide();
    setAttrs(ring, { cx: s.ox, cy: s.oy, r: CANCEL_K * ss });
    setAttrs(band, { x1: s.ox, y1: s.oy, x2: s.sx, y2: s.sy });
    const len = Math.hypot(s.dx, s.dy);
    const show = !s.cancel && len > 0;
    arrow.style.display = head.style.display = label.style.display = show ? '' : 'none';
    svg.classList.toggle('cancel', !!s.cancel);
    if (show) {
      const L = (CANCEL_K + s.pow * (POW_K - CANCEL_K)) * ss, ux = s.dx / len, uy = s.dy / len;
      const ex = s.ox + ux * L, ey = s.oy + uy * L, col = powColor(s.pow, kick);
      setAttrs(arrow, { x1: s.ox, y1: s.oy, x2: ex, y2: ey, stroke: col });
      const hs = 14, px = -uy, py = ux;
      setAttrs(head, { points: [ex + ux * hs, ey + uy * hs, ex + px * hs * 0.6, ey + py * hs * 0.6, ex - px * hs * 0.6, ey - py * hs * 0.6].join(','), fill: col });
      setAttrs(label, { x: s.ox + ux * (L + 34), y: s.oy + uy * (L + 34) + 6 });
      label.textContent = Math.round(s.pow * 100) + '%' + (s.lob ? ' LOB' : '');
    }
    meter.style.display = kick ? '' : 'none';
    if (kick) {
      const mx = Math.max(16, s.ox - 70), my = s.oy - 60, mh = 120;
      setAttrs(meter, { x: mx, y: my, width: 14, height: mh });
      setAttrs(meterFill, { x: mx, y: my + mh * (1 - s.pow), width: 14, height: mh * s.pow, fill: powColor(s.pow, true) });
      // the green "enough power" band is clamped to the meter; out of range (engine snap.kick.outRange) → no band, red frame
      const showZone = !!(zone && !zone.out && zone.hi > zone.lo);
      if (showZone) setAttrs(meterZone, { x: mx - 4, y: my + mh * (1 - zone.hi), width: 22, height: Math.max(0, mh * (zone.hi - zone.lo)) });
      meterZone.style.display = showZone ? '' : 'none';
      meter.classList.toggle('out', !!(zone && zone.out));
    } else { meterFill.setAttribute('height', 0); meterZone.style.display = 'none'; }
  }
  function hide() { if (svg) svg.classList.remove('on'); }

  Input.Gestures = {
    attach: function (el) {
      const doc = globalThis.document;
      if (!doc || svg) return;
      svg = doc.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'pt-aim');
      el.appendChild(svg);
      ring = mk('circle', 'pt-aim-ring', svg);
      band = mk('line', 'pt-aim-band', svg);
      arrow = mk('line', 'pt-aim-arrow', svg);
      head = mk('polygon', 'pt-aim-head', svg);
      meterZone = mk('rect', 'pt-kick-zone', svg);
      meter = mk('rect', 'pt-kick-meter', svg);
      meterFill = mk('rect', 'pt-kick-fill', svg);
      label = mk('text', 'pt-aim-label', svg);
    },
    aimStart: function (x, y, lob) {
      const a = K().aim;
      a.on = true; a.ox = x; a.oy = y; a.lob = !!lob; a.last = null;
      compute(a, x, y, false); draw(a, false);
    },
    aimMove: function (x, y) { const a = K().aim; if (!a.on) return; compute(a, x, y, false); draw(a, false); },
    aimEnd: function () {
      const k = K(), a = k.aim;
      if (!a.on) return;
      a.on = false; hide();
      if (!a.cancel) { a.last = { sx: a.sx, sy: a.sy, ox: a.ox, oy: a.oy, dx: a.dx, dy: a.dy, pow: a.pow, lob: a.lob }; k.edge('throw'); }
      a.lob = false;
    },
    kickStart: function (x, y) {
      const c = K().kick;
      c.on = true; c.ox = x; c.oy = y; c.src = 'ptr'; c.last = null;
      compute(c, x, y, true, true); draw(c, true);
    },
    kickMove: function (x, y) { const c = K().kick; if (!c.on) return; compute(c, x, y, true, true); draw(c, true); },
    kickEnd: function () {
      const k = K(), c = k.kick;
      if (!c.on) return;
      c.on = false; hide();
      if (!c.cancel) { c.last = { dx: c.dx, dy: c.dy, pow: c.pow, src: 'ptr' }; k.edge('kick'); }
      c.src = '';
    },
    /** drop any active drag without a throw/kick */
    cancel: function () {
      const k = K();
      if (!k) return;
      k.aim.on = false; k.aim.lob = false; k.aim.last = null;
      k.kick.on = false; k.kick.src = ''; k.kick.last = null;
      hide();
    },
    /** kick power band shown in green (design 8.6: dist/maxRange .. 0.95) */
    /**
     * Kick-meter green zone (design 8.6: dist/maxRange .. KICK_POW_MAX). Clamped to 0..1 with hi ≥ lo so it can never
     * render inverted or outside the meter. out = engine snap.kick.outRange (too far: no zone, red meter frame).
     */
    setKickZone: function (lo, hi, out) {
      if (lo == null) { zone = null; return; }
      const c = (v) => Math.max(0, Math.min(1, +v || 0));
      const h = c(hi == null ? 0.95 : hi), l = Math.min(c(lo), h);
      zone = { lo: l, hi: h, out: !!out || c(lo) > h };          // same rule as the engine (minPow > KICK_POW_MAX)
    },
    /**
     * @param {{x0:number,y0:number,x:number,y:number,t0:number}} p
     * @returns {'tap'|'swipeUp'|'swipeDown'|'swipe'|'hold'}
     */
    classify: function (p, now) {
      const dx = p.x - p.x0, dy = p.y - p.y0, d = Math.hypot(dx, dy), dt = now - p.t0;
      if (d < 12) return dt < 450 ? 'tap' : 'hold';
      if (dt < 700 && Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.2) return dy < 0 ? 'swipeUp' : 'swipeDown';
      return 'swipe';
    },
    constants: { POW_K: POW_K, CANCEL_K: CANCEL_K }
  };
})(globalThis.PT = globalThis.PT || {});
