/* Pixel Touchdown: js/core/flags.js
 * Owner: WP0. Responsibility: PT.Flags URL query flags (?debug=1 etc.), Node-safe.
 */
(function (PT) {
  'use strict';

  const Flags = PT.Flags = PT.Flags || {};
  const q = {};

  function parse(search) {
    for (const k of Object.keys(q)) delete q[k];
    if (!search) return;
    search.replace(/^\?/, '').split('&').forEach((pair) => {
      if (!pair) return;
      const i = pair.indexOf('=');
      const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i));
      const v = i < 0 ? '1' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
      q[k] = v;
    });
  }

  /** Re-read flags (tests may call with a custom search string). */
  Flags.init = function (search) {
    if (search === undefined) {
      const loc = globalThis.location;
      search = loc && typeof loc.search === 'string' ? loc.search : '';
    }
    parse(search);
    Flags.debug = Flags.get('debug', '0') === '1';
    Flags.test = Flags.get('test', '0') === '1';
    const s = Flags.get('seed', null);
    Flags.seed = s == null || s === '' || isNaN(+s) ? (Flags.test ? 42 : null) : (+s >>> 0);
    Flags.autoplay = Flags.get('autoplay', '0') === '1';
    Flags.quality = Flags.get('quality', null);
    Flags.screen = Flags.get('screen', null);
    Flags.ff = +Flags.get('ff', '0') || 0;
    return Flags;
  };

  /** Raw string value or default. Numbers come back as strings except via getNum. */
  Flags.get = function (name, def) { return Object.prototype.hasOwnProperty.call(q, name) ? q[name] : def; };
  Flags.getNum = function (name, def) { const v = Flags.get(name, null); return v == null || isNaN(+v) ? def : +v; };
  Flags.all = function () { return Object.assign({}, q); };

  Flags.init();
})(globalThis.PT = globalThis.PT || {});
