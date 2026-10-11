/* Pixel Touchdown: js/ui/dom.js
 * Owner: WP5. Responsibility: h()/esc()/html``, delegate(), $/$$, number/money formatters for display.
 * Every interpolation in html`` is escaped unless wrapped in raw(). Arrays are joined (each item escaped
 * unless it is a raw() value or the result of another html`` call).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const dom = UI.dom = UI.dom || {};

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  /** Escape any value for HTML text or attribute context. */
  dom.esc = function (s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"'`]/g, (c) => ESC[c]);
  };

  /** Marks a string as already-safe HTML. Only wrap strings built by html`` or by escaping. */
  function Raw(s) { this.s = s; }
  Raw.prototype.toString = function () { return this.s; };
  dom.raw = (s) => (s instanceof Raw ? s : new Raw(s == null ? '' : String(s)));
  dom.isRaw = (v) => v instanceof Raw;

  function part(v) {
    if (v == null || v === false || v === true) return '';
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(part).join('');
    return dom.esc(UI.Icons && typeof v === 'string' ? UI.Icons.strip(v) : v);
  }
  /** Tagged template: html`<b>${name}</b>` → Raw (escaped). */
  dom.html = function (strings) {
    let out = strings[0];
    for (let i = 1; i < strings.length; i++) out += part(arguments[i]) + strings[i];
    return new Raw(out);
  };
  /** Join a list of Raw/strings (escaping plain strings). */
  dom.join = (arr, sep) => new Raw((arr || []).map(part).join(sep ? dom.esc(sep) : ''));

  /** Build an element: h('div', {class:'x', 'data-testid':'y'}, 'text' | Node | [..]) */
  dom.h = function (tag, attrs, kids) {
    const el = globalThis.document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = part(v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (typeof c === 'string' || typeof c === 'number') el.appendChild(globalThis.document.createTextNode(String(c)));
      else el.appendChild(c);
    };
    add(kids);
    return el;
  };

  dom.$ = (sel, root) => (root || globalThis.document).querySelector(sel);
  dom.$$ = (sel, root) => Array.prototype.slice.call((root || globalThis.document).querySelectorAll(sel));

  /** Set innerHTML from a Raw (or escaped string). */
  dom.set = function (el, content) { if (el) el.innerHTML = part(content); return el; };

  /** Delegated listener: fn(matchedEl, ev). Returns an unsubscribe fn. */
  dom.delegate = function (root, type, selector, fn, opts) {
    const handler = (ev) => {
      let t = ev.target;
      if (t && t.nodeType !== 1) t = t.parentElement;
      const m = t && t.closest ? t.closest(selector) : null;
      if (m && root.contains(m)) fn(m, ev);
    };
    root.addEventListener(type, handler, opts);
    return () => root.removeEventListener(type, handler, opts);
  };

  // ---------------- formatters ----------------
  const U = () => PT.Util;
  /** $K → '$4.5M' */
  dom.money = (k) => (k == null ? '—' : !k ? '$0' : U().fmtMoney(k));   // HUNT #48: never '$0K'
  /** int with thousands separator */
  dom.int = (n) => (n == null || isNaN(n) ? '0' : Math.round(n).toLocaleString('en-US'));
  dom.coins = (n) => dom.int(n);
  dom.pct = (v) => Math.round((v || 0) * 100) + '%';
  dom.signed = (n) => (n > 0 ? '+' + n : String(n));
  dom.clock = (s) => U().fmtClock(s);
  dom.ord = (n) => U().ordinal(n);
  dom.plural = (n, w, pl) => U().plural(n, w, pl);
  dom.hex = (c) => (typeof c === 'string' ? c : '#' + ('000000' + ((c >>> 0) & 0xffffff).toString(16)).slice(-6));
  dom.rec = (w, l, t) => w + '–' + l + (t ? '–' + t : '');

  /** relative luminance 0..1 of an int color */
  dom.lum = function (c) {
    const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
    const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** HSL saturation 0..1 of an int color */
  dom.sat = function (c) {
    const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return 0;
    return (mx - mn) / (l > 0.5 ? 2 - mx - mn : mx + mn);
  };
  /** readable text color for a background int color */
  dom.inkOn = (c) => (dom.lum(c) > 0.42 ? '#1b1f3a' : '#ffffff');

  /** now in ms (UI may read clocks) */
  dom.now = () => (globalThis.performance && globalThis.performance.now ? globalThis.performance.now() : 0);

  /** Reduced motion: OS setting or app setting */
  dom.reduced = function () {
    const d = globalThis.document;
    if (d && d.documentElement.getAttribute('data-motion') === 'reduce') return true;
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  /** Safe localStorage-free tiny memo for per-session UI flags */
  dom.memo = {};
})(globalThis.PT = globalThis.PT || {});
