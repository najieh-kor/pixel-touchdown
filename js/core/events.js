/* Pixel Touchdown: js/core/events.js
 * Owner: WP0. Responsibility: PT.Events global bus (on/once/off/emit), safe dispatch.
 * Also exposes PT.Events.Emitter for local emitters (engine game.on).
 */
(function (PT) {
  'use strict';

  /** Create an independent emitter. */
  function Emitter(tag) {
    const map = Object.create(null);
    const anyHandlers = [];
    const em = {
      /** @returns {Function} unsubscribe */
      on(name, fn) {
        if (name === '*') { anyHandlers.push(fn); return () => em.off('*', fn); }
        (map[name] = map[name] || []).push(fn);
        return () => em.off(name, fn);
      },
      once(name, fn) {
        const off = em.on(name, function w(p) { off(); fn(p); });
        return off;
      },
      off(name, fn) {
        const arr = name === '*' ? anyHandlers : map[name];
        if (!arr) return;
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      emit(name, payload) {
        const arr = map[name];
        if (arr && arr.length) {
          const list = arr.slice();
          for (let i = 0; i < list.length; i++) safeCall(list[i], payload, name);
        }
        if (anyHandlers.length) {
          const list = anyHandlers.slice();
          for (let i = 0; i < list.length; i++) safeCall(list[i], payload, name, true);
        }
      },
      clear() { for (const k of Object.keys(map)) delete map[k]; anyHandlers.length = 0; },
      count(name) { return (map[name] || []).length; }
    };
    function safeCall(fn, payload, name, isAny) {
      try { isAny ? fn(name, payload) : fn(payload); }
      catch (e) {
        if (PT.Log && PT.Log.error && name !== 'app:error') PT.Log.error(tag || 'bus', name, e);
      }
    }
    return em;
  }

  const bus = Emitter('bus');
  PT.Events = PT.Events || {};
  PT.Events.on = bus.on;
  PT.Events.once = bus.once;
  PT.Events.off = bus.off;
  PT.Events.emit = bus.emit;
  PT.Events.clear = bus.clear;
  PT.Events.count = bus.count;
  PT.Events.Emitter = Emitter;
})(globalThis.PT = globalThis.PT || {});
