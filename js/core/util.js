/* Pixel Touchdown: js/core/util.js
 * Owner: WP0. Responsibility: PT.Util math/array/format helpers, vec2 ops (allocation-free variants).
 */
(function (PT) {
  'use strict';

  const U = PT.Util = PT.Util || {};
  const TAU = Math.PI * 2;

  U.TAU = TAU;
  U.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
  /** smoothstep of t between a and b */
  U.smooth = (a, b, t) => { const x = U.clamp(U.invLerp(a, b, t), 0, 1); return x * x * (3 - 2 * x); };
  U.approach = (cur, target, maxDelta) => (cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target));
  U.wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  U.angleDiff = (a, b) => U.wrapAngle(b - a);

  U.v2len = (x, y) => Math.sqrt(x * x + y * y);
  /** normalize (x,y) into out {x,y}; zero vector stays zero. Returns out. */
  U.v2norm = (out, x, y) => {
    const l = Math.sqrt(x * x + y * y);
    if (l > 1e-9) { out.x = x / l; out.y = y / l; } else { out.x = 0; out.y = 0; }
    return out;
  };
  U.dist = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); };
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };

  U.sum = (arr, fn) => { let s = 0; for (let i = 0; i < arr.length; i++) s += fn ? fn(arr[i], i) : arr[i]; return s; };
  U.avg = (arr, fn) => (arr.length ? U.sum(arr, fn) / arr.length : 0);
  /** stable sort copy by key fn; desc optional */
  U.sortBy = (arr, fn, desc) => arr
    .map((v, i) => [v, fn(v), i])
    .sort((a, b) => (a[1] < b[1] ? (desc ? 1 : -1) : a[1] > b[1] ? (desc ? -1 : 1) : a[2] - b[2]))
    .map((x) => x[0]);
  U.groupBy = (arr, fn) => { const o = {}; for (const v of arr) { const k = fn(v); (o[k] = o[k] || []).push(v); } return o; };
  U.pickTop = (arr, n, fn) => U.sortBy(arr, fn, true).slice(0, n);
  U.deepClone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  U.range = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; };
  U.round1 = (v) => Math.round(v * 10) / 10;

  /** money in $K → '$4.5M' / '$750K' */
  U.fmtMoney = (k) => {
    const neg = k < 0; k = Math.abs(Math.round(k));
    let s;
    if (k >= 1000) { const m = k / 1000; s = '$' + (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + 'M'; }
    else s = '$' + k + 'K';
    return neg ? '-' + s : s;
  };
  /** field y (0..120) + offense dir → 'OWN 25' | 'OPP 25' | '50' */
  U.fmtYardLine = (y, dir) => {
    const fromOwnGoal = dir >= 0 ? y - 10 : 110 - y;
    const yl = Math.round(U.clamp(fromOwnGoal, 0, 100));
    if (yl === 50) return '50';
    return yl < 50 ? 'OWN ' + yl : 'OPP ' + (100 - yl);
  };
  U.fmtClock = (sec) => {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  U.ordinal = (n) => {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    switch (n % 10) { case 1: return n + 'st'; case 2: return n + 'nd'; case 3: return n + 'rd'; default: return n + 'th'; }
  };
  U.plural = (n, word, pl) => n + ' ' + (n === 1 ? word : (pl || word + 's'));
  /** random id from a PT.RNG instance */
  U.uid = (rng, prefix) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(rng.next() * chars.length)];
    return (prefix || '') + s;
  };
  /** int color 0xRRGGBB → '#rrggbb' */
  U.hex = (c) => '#' + ('000000' + (c >>> 0).toString(16)).slice(-6);
})(globalThis.PT = globalThis.PT || {});
