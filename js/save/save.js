/* Pixel Touchdown: js/save/save.js
 * Owner: WP6. Responsibility: PT.Save: slots, autosave, meta, prefs, export/import, quota handling.
 *
 * Headless: storage and clock are injected via Save.init({ storage, now }). Keys (ARCHITECTURE 2.8):
 *   pt.s{1..3}       main save   'LZ1:' + LZ.compressToUTF16(JSON SaveEnvelope)
 *   pt.s{1..3}.auto  autosave
 *   pt.meta          JSON { slots: { 1: { main: SlotMeta|null, auto: SlotMeta|null }, … } }
 *   pt.prefs         JSON device prefs (PREFS_DEFAULT)
 * Export strings: 'PTSAVE1:' + LZ.compressToBase64(JSON SaveEnvelope) (copy/paste-safe).
 * Keys starting with '_' are runtime-only and are never written.
 */
(function (PT) {
  'use strict';
  const Save = PT.Save = PT.Save || {};
  const PREFIX = 'pt.';
  const EXPORT_TAG = 'PTSAVE1:';
  const PACK_TAG = 'LZ1:';

  /** Device prefs (not part of the League). */
  Save.PREFS_DEFAULT = {
    sfx: 0.8, music: 0.5, muted: false, quality: 'auto', haptics: true, lastSlot: 1,
    reduceMotion: false, kickMode: 'manual', speed: 0.8      // speed: live-play game speed (0.7 Relaxed / 0.8 Normal / 1.0 Fast)
  };

  const st = { storage: null, now: () => 0, avail: false, inited: false, prefs: null };

  function memStorage() {
    const m = new Map();
    return {
      get length() { return m.size; },
      key: (i) => Array.from(m.keys())[i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(k, String(v)); },
      removeItem: (k) => { m.delete(k); },
      clear: () => m.clear(),
      _mem: true
    };
  }

  function slots() { return (PT.C.SAVE && PT.C.SAVE.SLOTS) || 3; }
  function key(slot, auto) { return PREFIX + 's' + slot + (auto ? '.auto' : ''); }
  Save.key = key;

  function isQuota(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014 ||
      /quota/i.test(String(e.message || ''));
  }
  function emit(n, p) { if (PT.Events && PT.Events.emit) PT.Events.emit(n, p); }
  function strip(k, v) { return k && k[0] === '_' ? undefined : v; }
  function get(k) { try { return st.storage.getItem(k); } catch (e) { return null; } }
  function ensure() { if (!st.inited) Save.init({}); }

  /**
   * @param {{storage?:Storage, now?:function():number}} [o]
   * storage defaults to globalThis.localStorage; if it is missing or throws, an in-memory store is used.
   */
  Save.init = function (o) {
    o = o || {};
    st.inited = true;
    st.now = o.now || (() => Date.now());
    let s = o.storage;
    if (s === undefined) { try { s = globalThis.localStorage; } catch (e) { s = null; } }
    st.avail = false;
    if (s) {
      try { s.setItem(PREFIX + 'probe', '1'); s.removeItem(PREFIX + 'probe'); st.avail = true; } catch (e) { st.avail = isQuota(e); }
    }
    st.storage = st.avail ? s : memStorage();
    st.prefs = null;
    return Save;
  };

  /** @returns {boolean} false → saves live in memory only (UI should offer Export). */
  Save.available = function () { ensure(); return st.avail; };

  // ---------------- meta ----------------
  function userRecord(L) {
    let w = 0, l = 0, t = 0;
    const u = L.userTid;
    (L.sched || []).forEach((g) => {
      if (g.st !== 'F' || g.po || (g.h !== u && g.a !== u)) return;
      const us = g.h === u ? g.hs : g.as, them = g.h === u ? g.as : g.hs;
      if (us > them) w++; else if (us < them) l++; else t++;
    });
    return { w: w, l: l, t: t };
  }
  /** @returns {Object} SlotMeta */
  function slotMeta(L, bytes, at) {
    const tm = (L.teams && L.teams[L.userTid]) || {};
    const r = userRecord(L);
    return {
      at: at, v: L.v, tid: L.userTid, abbr: tm.abbr || '', team: ((tm.city || '') + ' ' + (tm.name || '')).trim(),
      coach: L.coach && typeof L.coach === 'object' ? L.coach.n : String(L.coach || ''),
      season: L.season, phase: L.phase, week: L.week, w: r.w, l: r.l, t: r.t, bytes: bytes
    };
  }
  Save.slotMeta = slotMeta;

  function blankMeta() {
    const m = { slots: {} };
    for (let i = 1; i <= slots(); i++) m.slots[i] = { main: null, auto: null };
    return m;
  }
  function writeMeta(m) { try { st.storage.setItem(PREFIX + 'meta', JSON.stringify(m)); } catch (e) { /* meta is rebuildable */ } }

  /** Rebuild meta by opening every stored slot (used when pt.meta is missing or damaged). */
  function rebuildMeta() {
    const m = blankMeta();
    for (let i = 1; i <= slots(); i++) {
      for (const auto of [false, true]) {
        const raw = get(key(i, auto));
        if (raw == null) continue;
        const env = unpack(raw);
        m.slots[i][auto ? 'auto' : 'main'] = env && env.L ? slotMeta(env.L, raw.length * 2, env.at || 0) : { at: 0, damaged: true, bytes: raw.length * 2 };
      }
    }
    writeMeta(m);
    return m;
  }

  /** @returns {{slots:Object<number,{main:Object|null,auto:Object|null}>}} pt.meta */
  Save.meta = function () {
    ensure();
    let m = null;
    try { m = JSON.parse(get(PREFIX + 'meta') || 'null'); } catch (e) { m = null; }
    if (!m || !m.slots) return rebuildMeta();
    for (let i = 1; i <= slots(); i++) {
      const s = m.slots[i] || (m.slots[i] = { main: null, auto: null });
      // keep meta honest if a key disappeared (e.g. cleared by the browser)
      if (s.main && get(key(i)) == null) s.main = null;
      if (s.auto && get(key(i, true)) == null) s.auto = null;
      if (!s.main && get(key(i)) != null) return rebuildMeta();
      if (!s.auto && get(key(i, true)) != null) return rebuildMeta();
    }
    return m;
  };

  function setMeta(slot, auto, sm) {
    let m = null;
    try { m = JSON.parse(get(PREFIX + 'meta') || 'null'); } catch (e) { m = null; }
    if (!m || !m.slots) m = blankMeta();
    m.slots[slot] = m.slots[slot] || { main: null, auto: null };
    m.slots[slot][auto ? 'auto' : 'main'] = sm;
    writeMeta(m);
  }

  // ---------------- pack / unpack ----------------
  function unpackJSON(raw) {
    if (raw == null) return null;
    if (raw.indexOf(PACK_TAG) === 0) return PT.LZ.decompressFromUTF16(raw.slice(PACK_TAG.length));
    if (raw[0] === '{') return raw;
    return null;
  }
  /** @returns {Object|null} envelope (unmigrated) or null if damaged */
  function unpack(raw) {
    try {
      const json = unpackJSON(raw);
      if (!json) return null;
      const env = JSON.parse(json);
      if (!env || typeof env !== 'object' || !env.L || !Array.isArray(env.L.teams)) return null;
      return env;
    } catch (e) { return null; }
  }
  /** QA1: minimal league shape every screen relies on (a parseable but broken save must read as damaged, not crash). */
  function sane(L) {
    return !!L && typeof L === 'object' && Array.isArray(L.teams) && Array.isArray(L.players) && Array.isArray(L.sched) &&
      L.teams.length > 0 && !!L.teams[L.userTid] && typeof L.teams[L.userTid] === 'object';
  }
  Save.sane = sane;

  function storeEnv(slot, auto, env, L, retried) {
    const json = JSON.stringify(env, strip);
    const packed = PACK_TAG + PT.LZ.compressToUTF16(json);
    try {
      st.storage.setItem(key(slot, auto), packed);
    } catch (e) {
      if (!isQuota(e)) {
        emit('app:saveFailed', { slot: slot, msg: 'Could not save.' });
        return { ok: false, err: 'WRITE', msg: 'Could not save.' };
      }
      if (!retried && L) {
        if (PT.Log) PT.Log.warn('save', 'quota exceeded, running emergencyCompact');
        Save.emergencyCompact(L);
        return storeEnv(slot, auto, Object.assign({}, env, { L: L }), L, true);
      }
      const msg = 'Storage full, export your save';
      emit('app:saveFailed', { slot: slot, msg: msg });
      return { ok: false, err: 'QUOTA', msg: msg };
    }
    const bytes = packed.length * 2;
    setMeta(slot, auto, slotMeta(env.L, bytes, env.at));
    emit('app:saved', { slot: slot, auto: !!auto, bytes: bytes });
    return { ok: true, bytes: bytes, chars: packed.length, raw: json.length, at: env.at };
  }

  // ---------------- public slot API ----------------
  /**
   * Write a save. On a quota error runs emergencyCompact(L) once and retries.
   * @param {number} slot 1..3
   * @param {League} L
   * @param {{auto?:boolean, inGame?:number|null}} [o]
   * @returns {{ok:boolean, bytes?:number, err?:string, msg?:string}}
   */
  Save.write = function (slot, L, o) {
    ensure();
    o = o || {};
    if (!L || !L.teams) return { ok: false, err: 'NO_LEAGUE', msg: 'Nothing to save.' };
    if (!(slot >= 1 && slot <= slots())) return { ok: false, err: 'BAD_SLOT', msg: 'Pick a save slot.' };
    if (L.dv !== 2) L.dv = 2;                       // 4-level difficulty marker (ROUND6 B): leagues in memory are 4-level
    const env = { fmt: 1, v: L.v, at: st.now(), app: PT.VERSION, inGame: o.inGame == null ? null : o.inGame, L: L };
    return storeEnv(slot, !!o.auto, env, L, false);
  };

  /**
   * Read, decompress, migrate and hydrate a save. Damaged or unmigratable data is left untouched in storage.
   * @param {number} slot
   * @param {{auto?:boolean}} [o]
   * @returns {{ok:boolean, L?:League, inGame?:number|null, at?:number, err?:string, msg?:string}}
   */
  Save.read = function (slot, o) {
    ensure();
    const auto = !!(o && o.auto);
    const raw = get(key(slot, auto));
    if (raw == null) return { ok: false, err: 'EMPTY', msg: 'No save here.' };
    const env0 = unpack(raw);
    if (!env0) return { ok: false, err: 'CORRUPT', msg: 'Damaged save. Load the backup?' };
    let env;
    try { env = Save.migrate(env0); }
    catch (e) {
      if (PT.Log) PT.Log.warn('save', 'migration failed', e && e.message);
      return { ok: false, err: 'MIGRATE', msg: 'This save is from a different version of the game.' };
    }
    let L = env.L;
    if (!sane(L)) return { ok: false, err: 'CORRUPT', msg: 'Damaged save. Load the backup?' };
    Save.fixDifficulty(L);                           // old 3-level saves: diff 2 → 3 (ROUND6 B)
    if (PT.League && typeof PT.League.hydrate === 'function') {
      try { L = PT.League.hydrate(L) || L; }
      catch (e) {
        if (PT.Log) PT.Log.warn('save', 'hydrate failed', e && e.message);
        return { ok: false, err: 'CORRUPT', msg: 'Damaged save. Load the backup?' };
      }
    }
    return { ok: true, L: L, inGame: env.inGame == null ? null : env.inGame, at: env.at || 0, v: env.v };
  };

  /** @returns {'main'|'auto'|null} the most recently written copy of a slot */
  Save.newest = function (slot) {
    ensure();
    const hasM = get(key(slot)) != null, hasA = get(key(slot, true)) != null;
    if (!hasM && !hasA) return null;
    if (hasM !== hasA) return hasM ? 'main' : 'auto';
    const s = Save.meta().slots[slot] || {};
    const am = s.main ? s.main.at || 0 : 0, aa = s.auto ? s.auto.at || 0 : 0;
    return aa > am ? 'auto' : 'main';
  };

  /** Delete a slot (main + auto). */
  Save.remove = function (slot) {
    ensure();
    try { st.storage.removeItem(key(slot)); st.storage.removeItem(key(slot, true)); } catch (e) { /* ignore */ }
    setMeta(slot, false, null);
    setMeta(slot, true, null);
  };

  /**
   * @param {number} slot
   * @param {{auto?:boolean}} [o] default: the newest copy
   * @returns {string} 'PTSAVE1:…' or '' when the slot is empty/damaged
   */
  Save.exportString = function (slot, o) {
    ensure();
    const which = o && o.auto != null ? (o.auto ? 'auto' : 'main') : Save.newest(slot);
    if (!which) return '';
    const json = unpackJSON(get(key(slot, which === 'auto')));
    if (!json) return '';
    return EXPORT_TAG + PT.LZ.compressToBase64(json);
  };

  /**
   * Import an export string (or raw envelope JSON) into a slot's main save.
   * @returns {{ok:boolean, meta?:Object, err?:string, msg?:string}}
   */
  Save.importString = function (slot, str) {
    ensure();
    const bad = { ok: false, err: 'BAD_CODE', msg: 'That save code does not work.' };
    if (typeof str !== 'string') return bad;
    let s = str.trim();
    let json = null;
    try {
      if (s.indexOf(EXPORT_TAG) === 0) json = PT.LZ.decompressFromBase64(s.slice(EXPORT_TAG.length).replace(/\s+/g, ''));
      else if (s.indexOf(PACK_TAG) === 0) json = PT.LZ.decompressFromUTF16(s.slice(PACK_TAG.length));
      else if (s[0] === '{') json = s;
    } catch (e) { json = null; }
    if (!json) return bad;
    let env;
    try { env = JSON.parse(json); } catch (e) { return bad; }
    if (env && !env.L && Array.isArray(env.teams) && Array.isArray(env.players)) env = { fmt: 1, v: env.v || 0, at: 0, app: '?', inGame: null, L: env };
    if (!env || !env.L || !Array.isArray(env.L.teams) || !Array.isArray(env.L.players)) return bad;
    try { env = Save.migrate(env); } catch (e) { return { ok: false, err: 'MIGRATE', msg: 'That save is from a different version of the game.' }; }
    if (!sane(env.L)) return bad;
    env = Object.assign({}, env, { at: st.now(), inGame: null });
    Save.fixDifficulty(env.L);
    const r = storeEnv(slot, false, env, env.L, false);
    if (!r.ok) return r;
    try { st.storage.removeItem(key(slot, true)); } catch (e) { /* ignore */ }
    setMeta(slot, true, null);
    return { ok: true, meta: Save.meta().slots[slot].main };
  };

  // ---------------- prefs ----------------
  /** @returns {Object} copy of device prefs merged over PREFS_DEFAULT */
  Save.prefs = function () {
    ensure();
    if (!st.prefs) {
      let p = null;
      try { p = JSON.parse(get(PREFIX + 'prefs') || 'null'); } catch (e) { p = null; }
      st.prefs = sanitizePrefs(p);
    }
    return Object.assign({}, st.prefs);
  };
  /**
   * HUNT4 #9: stored prefs are untrusted (hand edits, old builds): keep only known keys with valid types/ranges, unknown
   * keys pass through only if they are JSON primitives. Anything else falls back to PREFS_DEFAULT.
   */
  function sanitizePrefs(p) {
    const D = Save.PREFS_DEFAULT, out = Object.assign({}, D);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
    const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    for (const k of Object.keys(p)) {
      const v = p[k];
      switch (k) {
        case 'sfx': case 'music': out[k] = num(v, 0, 1, D[k]); break;
        case 'speed': out[k] = num(v, 0.5, 1.5, D[k]); break;
        case 'watch': out[k] = num(v, 0.5, 3, 0.8); break;
        case 'lastSlot': out[k] = Math.round(num(v, 1, slots(), D[k])); break;
        case 'quality': out[k] = ['auto', 'low', 'med', 'high'].indexOf(v) >= 0 ? v : D[k]; break;
        case 'autoTier': if (['low', 'med', 'high'].indexOf(v) >= 0) out[k] = v; break;
        case 'kickMode': out[k] = v === 'auto' || v === 'manual' ? v : D[k]; break;
        case 'aimMode': if (v === 'sling' || v === 'point') out[k] = v; break;
        case 'muted': case 'haptics': case 'reduceMotion': out[k] = typeof v === 'boolean' ? v : D[k]; break;
        case 'lefty': case 'easyThrow': case 'autoDef': if (typeof v === 'boolean') out[k] = v; break;
        default: if (v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0) out[k] = v;   // other WPs' keys (textSize…)
      }
    }
    return out;
  }
  Save.sanitizePrefs = sanitizePrefs;

  /** Merge, persist and return prefs; emits 'app:prefs'. */
  Save.setPrefs = function (partial) {
    const p = sanitizePrefs(Object.assign(Save.prefs(), partial || {}));
    st.prefs = p;
    try { st.storage.setItem(PREFIX + 'prefs', JSON.stringify(p)); } catch (e) { /* non-fatal */ }
    emit('app:prefs', Object.assign({}, p));
    return Object.assign({}, p);
  };

  // ---------------- compaction ----------------
  /**
   * Quota fallback (ARCHITECTURE 2.9): delete all non-user boxes, trim news to 10, legends to 100.
   * Mutates L. @returns {{boxes:number, news:number, legends:number}} removed counts
   */
  Save.emergencyCompact = function (L) {
    const out = { boxes: 0, news: 0, legends: 0 };
    if (!L) return out;
    const u = L.userTid;
    if (L.box) {
      for (const gid of Object.keys(L.box)) {
        const b = L.box[gid];
        if (!b || (b.h !== u && b.a !== u)) { delete L.box[gid]; out.boxes++; }
      }
    }
    if (Array.isArray(L.news) && L.news.length > 10) { out.news = L.news.length - 10; L.news.length = 10; }
    const lg = L.hist && L.hist.legends;
    if (Array.isArray(lg) && lg.length > 100) {
      const score = (e) => (e.hof ? 1e6 : 0) + (e.aw ? e.aw.length * 1000 : 0) + (e.yrs ? (e.yrs[1] - e.yrs[0]) : 0);
      const keep = lg.map((e, i) => ({ e: e, i: i, s: score(e) })).sort((a, b) => (b.s - a.s) || (a.i - b.i)).slice(0, 100)
        .sort((a, b) => a.i - b.i).map((x) => x.e);
      out.legends = lg.length - keep.length;
      L.hist.legends = keep;
    }
    if (PT.Events && PT.Events.emit) PT.Events.emit('league:changed', { what: 'compact' });
    return out;
  };

  /** Remove every pt.* key (debug "Reset all data"). */
  Save.clearAll = function () {
    ensure();
    const ks = [];
    try { for (let i = 0; i < st.storage.length; i++) { const k = st.storage.key(i); if (k && k.indexOf(PREFIX) === 0) ks.push(k); } } catch (e) { /* ignore */ }
    ks.forEach((k) => { try { st.storage.removeItem(k); } catch (e) { /* ignore */ } });
    st.prefs = null;
  };

  /** Total chars used by pt.* keys (for the debug overlay). */
  Save.usage = function () {
    ensure();
    let n = 0;
    try { for (let i = 0; i < st.storage.length; i++) { const k = st.storage.key(i); if (k && k.indexOf(PREFIX) === 0) n += k.length + (get(k) || '').length; } } catch (e) { /* ignore */ }
    return n;
  };
})(globalThis.PT = globalThis.PT || {});
