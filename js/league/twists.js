/* Pixel Touchdown: js/league/twists.js
 * Owner: WP2. Responsibility: PT.League.Twists: Season Twist roll at rollover / new league (design 14.2, R8, ROUND6 C).
 * Year 1 is always 'normal'. Then a uniform pick among twists not used in the last 3 seasons ('normal' weight 1/3).
 * Effects live in PT.Data.Twists (fx); league systems read Twists.fx(L); the engine reads GameConfig.twist.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Tw = PT.ns('League.Twists');

  function list() { return (PT.Data.Twists && PT.Data.Twists.list) || [{ id: 'normal', name: 'Normal Season', desc: 'No twist this year.', fx: {} }]; }
  function byId(id) { return list().find((t) => t.id === id) || null; }

  /** Twist ids used in the last n seasons (from hist.seasons[].tw). */
  Tw.recent = function (L, n) {
    return L.hist.seasons.filter((s) => s.s >= L.season - (n || 3) && s.s < L.season && s.tw).map((s) => s.tw);
  };

  /**
   * Roll this season's twist (idempotent per season). Also grows the Team Cash limit (needs the twist: Cap Crunch),
   * generates the draft class (Rookie Rush), starts season state, and posts the news line.
   * @returns {{id:string, s:number}} L.twist
   */
  Tw.roll = function (L) {
    const ss = PT.League.History.ss(L);
    if (ss.tw && L.twist && L.twist.s === L.season) return L.twist;
    let id = 'normal';
    const first = L.season === C.START_SEASON || L.hist.seasons.filter((s) => s.s < L.season && s.s >= C.START_SEASON).length === 0;
    if (!first) {
      const recent = Tw.recent(L, 3);
      const pool = list().filter((t) => recent.indexOf(t.id) < 0).map((t) => [t.id, t.id === 'normal' ? 1 : 3]);
      const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'twist'));
      id = pool.length ? r.weighted(pool) : 'normal';
    }
    L.twist = { id: id, s: L.season };
    ss.tw = 1;
    PT.League.Cap.grow(L);
    PT.League.Draft.ensureClass(L);
    if (id !== 'normal') PT.League.News.add(L, 'twist', PT.League.News.tpl('twist', { twist: byId(id).name }));
    if (PT.Events) PT.Events.emit('league:changed', { what: 'twist' });
    return L.twist;
  };

  /** Current twist def ({id,name,desc,fx}). */
  Tw.current = function (L) {
    const id = L.twist && L.twist.s === L.season ? L.twist.id : 'normal';
    return byId(id) || { id: 'normal', name: 'Normal Season', desc: 'No twist this year.', fx: {} };
  };

  /** Effects of the active twist (empty object when none). */
  Tw.fx = function (L) { return Tw.current(L).fx || {}; };

  /** @returns {boolean} */
  Tw.is = function (L, id) { return Tw.current(L).id === id; };
})(globalThis.PT = globalThis.PT || {});
