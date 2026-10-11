/* Pixel Touchdown: js/core/namespace.js
 * Owner: WP0. Responsibility: PT root, PT.ns(path), PT.stub(path, impl), PT.VERSION.
 */
(function (PT) {
  'use strict';

  PT.VERSION = '0.1.0';

  /**
   * Ensure a nested namespace exists under PT and return it.
   * PT.ns('League.Draft') → PT.League.Draft
   * @param {string} path
   * @returns {Object}
   */
  PT.ns = function (path) {
    let o = PT;
    const parts = String(path).split('.');
    for (let i = 0; i < parts.length; i++) {
      const k = parts[i];
      if (!k) continue;
      if (o[k] == null) o[k] = {};
      o = o[k];
    }
    return o;
  };

  /**
   * Install stub members only where missing. Every stub function gets __stub = true.
   * A real implementation loaded earlier always wins, member by member.
   * Nested plain objects are merged recursively.
   * @param {string} path
   * @param {Object} impl
   * @returns {Object} the namespace object
   */
  PT.stub = function (path, impl) {
    const target = PT.ns(path);
    mergeMissing(target, impl);
    return target;
  };

  function isPlain(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);       // realm-agnostic (works across node:vm contexts)
    return proto === null || Object.getPrototypeOf(proto) === null;
  }

  function mergeMissing(target, impl) {
    for (const k of Object.keys(impl)) {
      const v = impl[k];
      if (!(k in target) || target[k] === undefined) {
        if (typeof v === 'function') v.__stub = true;
        else if (isPlain(v)) markFns(v);
        target[k] = v;
      } else if (isPlain(target[k]) && isPlain(v)) {
        mergeMissing(target[k], v);
      }
    }
  }

  function markFns(o) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'function') v.__stub = true;
      else if (isPlain(v)) markFns(v);
    }
  }

  /**
   * List every reachable PT function path marked __stub (for INT checks).
   * @returns {string[]}
   */
  PT.listStubs = function () {
    const out = [];
    const seen = new Set();
    (function walk(o, p, depth) {
      if (!o || depth > 6 || seen.has(o)) return;
      seen.add(o);
      for (const k of Object.keys(o)) {
        if (k === 'Fixtures') continue;
        let v;
        try { v = o[k]; } catch (e) { continue; }
        if (typeof v === 'function') {
          if (v.__stub) out.push(p + k);
        } else if (isPlain(v)) walk(v, p + k + '.', depth + 1);
      }
    })(PT, 'PT.', 0);
    return out;
  };
})(globalThis.PT = globalThis.PT || {});
