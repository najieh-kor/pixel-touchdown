/* Pixel Touchdown: js/core/rng.js
 * Owner: WP0. Responsibility: PT.RNG seeded PRNG (sfc32), stream derivation, serializable state.
 */
(function (PT) {
  'use strict';

  const RNG = PT.RNG = PT.RNG || {};

  /** Mix any numbers/strings into a uint32 (FNV-1a over a string form + murmur finalizer). */
  RNG.hash = function () {
    let h = 0x811c9dc5;
    for (let a = 0; a < arguments.length; a++) {
      const s = String(arguments[a]) + '\u0001';
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  };

  function Rng(a, b, c, d) { this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0; }

  /** sfc32 → uint32 */
  Rng.prototype.u32 = function () {
    let a = this.a, b = this.b, c = this.c, d = this.d;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0;
    return t >>> 0;
  };
  /** [0,1) */
  Rng.prototype.next = function () { return this.u32() / 4294967296; };
  /** inclusive int */
  Rng.prototype.int = function (lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); };
  Rng.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  /** [[item, weight], ...] → item */
  Rng.prototype.weighted = function (pairs) {
    let tot = 0;
    for (let i = 0; i < pairs.length; i++) tot += Math.max(0, pairs[i][1]);
    if (tot <= 0) return pairs.length ? pairs[0][0] : undefined;
    let r = this.next() * tot;
    for (let i = 0; i < pairs.length; i++) {
      r -= Math.max(0, pairs[i][1]);
      if (r < 0) return pairs[i][0];
    }
    return pairs[pairs.length - 1][0];
  };
  /** Box-Muller normal */
  Rng.prototype.normal = function (mean, sd) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    return (mean || 0) + (sd == null ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  /** in-place Fisher-Yates, returns arr */
  Rng.prototype.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  Rng.prototype.state = function () { return [this.a, this.b, this.c, this.d]; };
  Rng.prototype.setState = function (s) { this.a = s[0] >>> 0; this.b = s[1] >>> 0; this.c = s[2] >>> 0; this.d = s[3] >>> 0; return this; };
  /** New independent stream derived from current state + label. Does not advance parent. */
  Rng.prototype.fork = function (label) {
    return RNG.create(RNG.hash(this.a, this.b, this.c, this.d, label == null ? '' : label));
  };

  /** @param {number} seed uint32 */
  RNG.create = function (seed) {
    seed = seed >>> 0;
    const r = new Rng(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed);
    for (let i = 0; i < 15; i++) r.u32();   // warm-up
    return r;
  };
  RNG.fromState = function (s) { return new Rng(s[0], s[1], s[2], s[3]); };
  RNG.Rng = Rng;
})(globalThis.PT = globalThis.PT || {});
