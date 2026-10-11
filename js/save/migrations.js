/* Pixel Touchdown: js/save/migrations.js
 * Owner: WP6. Responsibility: PT.Save.migrations[v] = fn(oldData) -> data.
 *
 * migrations[n] upgrades an envelope from version n-1 to n. Each step is PURE: it never mutates its input,
 * and returns a new envelope with `v === n`. PT.Save.migrate(env) runs steps v+1..C.SCHEMA_VERSION in order.
 * Adding a schema change = bump PT.C.SCHEMA_VERSION (WP0/INT) and add migrations[newV] here.
 */
(function (PT) {
  'use strict';
  const Save = PT.Save = PT.Save || {};
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  Save.migrations = Save.migrations || {};

  /**
   * v0 → v1: pre-release prototype saves (before RECONCILE). Fills every RECONCILE R7/R8 field with defaults,
   * converts the old string coach and 4-level difficulty. Safe to run on an already-v1-shaped league.
   */
  Save.migrations[1] = function (env) {
    const out = clone(env);
    const L = out.L;
    const C = PT.C;
    if (typeof L.coach === 'string' || !isObj(L.coach)) {
      L.coach = { n: typeof L.coach === 'string' ? L.coach : 'Coach', sp: 'dog', xp: 0, lvl: 1, sk: {}, pts: 0 };
    }
    if (typeof L.diff !== 'number') L.diff = 1;
    if (L.diff > 2) L.diff = 2;
    L.settings = Object.assign({}, C.SETTINGS_DEFAULT, isObj(L.settings) ? L.settings : {});
    if (!isObj(L.twist)) L.twist = { id: 'normal', s: L.season || C.START_SEASON || 2026 };
    if (!isObj(L.boss)) L.boss = { goal: null, conf: typeof C.BOSS_START === 'number' ? C.BOSS_START : 60 };
    if (typeof L.boss.conf !== 'number') L.boss.conf = 60;
    if (!isObj(L.ach)) L.ach = {};
    if (!isObj(L.scout)) L.scout = { pts: 0, spent: {} };
    if (!isObj(L.retNums)) L.retNums = {};
    if (!isObj(L.ev)) L.ev = { pending: [], seen: {} };
    if (!Array.isArray(L.news)) L.news = [];
    if (!isObj(L.hist)) L.hist = { seasons: [], legends: [], rec: { league: { season: {}, game: {}, career: {} }, franchise: {} } };
    if (!isObj(L.box)) L.box = {};
    (L.teams || []).forEach((t) => {
      if (typeof t.spirit !== 'number') t.spirit = 50;
      if (t.capt === undefined) t.capt = null;
      if (!isObj(t.fac)) t.fac = { trn: 1, med: 1, sct: 1, std: 1, shop: 1 };
      if (!isObj(t.stf)) t.stf = { off: 2, def: 2, grw: 2 };
      if (!isObj(t.fin)) t.fin = { coins: 0, hype: 50, revS: 0, expS: 0, last: null };
      delete t.job;
    });
    (L.players || []).forEach((p) => {
      if (!Array.isArray(p.alt)) p.alt = [];
      if (!isObj(p.sg)) p.sg = {};
      if (typeof p.ir !== 'boolean') p.ir = false;
    });
    L.v = 1;
    out.v = 1;
    return out;
  };

  /**
   * ROUND6 B: difficulty went from 3 levels (0 Rookie, 1 Pro, 2 Legend) to 4 (0 Beginner, 1 Normal, 2 Expert, 3 Legend).
   * Leagues without the `dv:2` marker are old 3-level saves: diff 2 → 3. Every league this build writes carries dv:2
   * (Save.write stamps it), so the remap runs exactly once. Mutates and returns L.
   */
  Save.fixDifficulty = function (L) {
    if (!L || L.dv === 2) return L;
    if (L.diff === 2) L.diff = 3;
    L.dv = 2;
    return L;
  };

  /**
   * Run migrations from env.v up to `target` (default PT.C.SCHEMA_VERSION). Throws on a missing step,
   * a step that does not bump v, or a save from a NEWER version. The input envelope is never mutated.
   * @param {Object} env SaveEnvelope
   * @param {number} [target]
   * @returns {Object} SaveEnvelope
   */
  Save.migrate = function (env, target) {
    target = target == null ? PT.C.SCHEMA_VERSION : target;
    if (!env || typeof env !== 'object') throw new Error('[Save] migrate: no envelope');
    let v = typeof env.v === 'number' ? env.v : (env.L && typeof env.L.v === 'number' ? env.L.v : 0);
    if (v > target) throw new Error('[Save] save is from a newer version (v' + v + ' > v' + target + ')');
    let cur = env;
    if (cur.v !== v) cur = Object.assign({}, cur, { v: v });
    while (v < target) {
      const fn = Save.migrations[v + 1];
      if (typeof fn !== 'function') throw new Error('[Save] missing migration to v' + (v + 1));
      const next = fn(cur);
      if (!next || next.v !== v + 1) throw new Error('[Save] migration to v' + (v + 1) + ' did not set v');
      cur = next;
      v = cur.v;
    }
    return cur;
  };
})(globalThis.PT = globalThis.PT || {});
