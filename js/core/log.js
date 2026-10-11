/* Pixel Touchdown: js/core/log.js
 * Owner: WP0. Responsibility: PT.Log levels, ring buffer, error capture hooks.
 */
(function (PT) {
  'use strict';

  const Log = PT.Log = PT.Log || {};
  const MAX = 200;
  const buf = [];
  let seq = 0;
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  Log.level = 'info';        // minimum level echoed to console
  Log.echo = true;           // echo to console (warn/error always echo)

  function fmt(a) {
    if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
    return String(a);
  }

  function push(lvl, tag, args) {
    const msg = Array.prototype.map.call(args, fmt).join(' ');
    const e = { n: ++seq, t: seq, lvl: lvl, tag: String(tag), msg: msg };
    buf.push(e);
    if (buf.length > MAX) buf.shift();
    const con = globalThis.console;
    if (con && (LEVELS[lvl] >= LEVELS[Log.level] && Log.echo || lvl === 'error' || lvl === 'warn')) {
      const f = con[lvl === 'debug' ? 'log' : lvl] || con.log;
      if (lvl !== 'error' || !Log.quietErrors) f.call(con, '[' + tag + ']', msg);
    }
    return e;
  }

  Log.debug = function (tag) { return push('debug', tag, Array.prototype.slice.call(arguments, 1)); };
  Log.info = function (tag) { return push('info', tag, Array.prototype.slice.call(arguments, 1)); };
  Log.warn = function (tag) { return push('warn', tag, Array.prototype.slice.call(arguments, 1)); };
  Log.error = function (tag) {
    const args = Array.prototype.slice.call(arguments, 1);
    const e = push('error', tag, args);
    const err = args.find((a) => a instanceof Error) || new Error(e.msg);
    if (PT.Events && PT.Events.emit) PT.Events.emit('app:error', { err: err, tag: tag, fatal: false });
    return e;
  };
  Log.entries = function () { return buf.slice(); };
  Log.clear = function () { buf.length = 0; };
  Log.text = function () { return buf.map((e) => e.lvl.toUpperCase() + ' [' + e.tag + '] ' + e.msg).join('\n'); };
})(globalThis.PT = globalThis.PT || {});
