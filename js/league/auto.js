/* Pixel Touchdown: js/league/auto.js
 * Owner: WP1. Responsibility: PT.League.Auto: auto-resolve blockers, simUntil (used by "sim to…" and debug).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Auto = PT.ns('League.Auto');
  const LG = () => PT.League;

  /**
   * Let the AI decide for the user on one Calendar blocker.
   * USER_GAME → quick-sim the game · EVENT → WeeklyEvents.choose(L, iid, 'auto') (free option) · ROSTER → "Fix it for me" + Auto Lineup ·
   * CAP → cut lowest value-per-pay players · DRAFT_PICK → AI GM pick for the user's needs (Draft.board top as fallback).
   * @param {{k:string, gid?:number, iid?:number}} b @returns {Result}
   */
  Auto.resolve = function (L, b) {
    switch (b.k) {
      case 'USER_GAME': {
        const box = LG().Games.simUserGame(L, b.gid);
        return { ok: true, box: box };
      }
      case 'EVENT': {
        const W = LG().WeeklyEvents;
        const a = W.choose(L, b.iid, 'auto');                     // WP2: the free / affordable option
        if (a && a.ok) return a;
        for (let i = 0; i < 3; i++) {
          const r = W.choose(L, b.iid, i);
          if (r && r.ok) return r;
        }
        L.ev.pending = L.ev.pending.filter((e) => e.iid !== b.iid);
        return { ok: true, dropped: true };
      }
      case 'ROSTER': {
        const max = L.phase === C.PHASE.PRESEASON ? C.ROSTER.MAX_SEASON : undefined;
        const r = LG().Roster.fixIt(L, L.userTid, { max: max, useFA: true });   // best free agents first (HUNT2-league #1)
        LG().Roster.autoDepth(L, L.userTid, { silent: true });
        return Object.assign({}, r, { ok: true });
      }
      case 'CAP':
        return { ok: true, cut: LG().Roster.fixCap(L, L.userTid) };
      case 'FANTASY':
        return Object.assign({ ok: true }, LG().Fantasy.autoRest(L));
      case 'DRAFT_PICK': {
        let pid = LG().AIGM.chooseDraftPick(L, L.userTid);
        if (pid == null) { const board = LG().Draft.board(L, {}); pid = board.length ? board[0].p.id : null; }
        if (pid == null) return { ok: false, err: 'NO_PICK', msg: 'No rookies left.' };
        const r = LG().Draft.pick(L, pid);
        // like the draft screen's Pick: run on to the user's next pick (or the end), so picks never cost Next presses
        if (r && r.ok && !LG().Draft.status(L).done) LG().Draft.simToUser(L);
        return r;
      }
      case 'FIRED':                                                 // QA1: the user must choose (new job / retire)
        return { ok: false, err: 'FIRED', msg: 'The Boss wants to talk. Take a new job first.' };
      default:
        return { ok: false, err: 'UNKNOWN', msg: 'Nothing to do.' };
    }
  };

  /** resolve every blocker Auto can resolve (repeats while new ones appear; never FIRED) @returns {number} resolved count */
  Auto.resolveAll = function (L) {
    // repeat: resolving one blocker can raise the next (e.g. a draft pick runs on to the user's next pick)
    let n = 0;
    for (let pass = 0; pass < 40; pass++) {
      const bl = LG().Calendar.status(L).blockers.filter((b) => b.k !== 'FIRED');   // FIRED is the user's choice
      if (!bl.length) break;
      const where = () => [L.phase, L.week, L.sub, L.season, L.ev.pending.length].join('/');
      const key = JSON.stringify(bl) + where();
      bl.forEach((b) => Auto.resolve(L, b));
      n += bl.length;
      if (JSON.stringify(LG().Calendar.status(L).blockers.filter((b) => b.k !== 'FIRED')) + where() === key) break;   // no progress
    }
    return n;
  };

  /**
   * Advance (auto-resolving blockers) until pred(L) is true. Synchronous; App chunks long runs.
   * @param {function(League):boolean} pred @param {{maxSteps?:number}} [o]
   * @returns {{steps:number, ok:boolean, reason?:string}}
   */
  Auto.simUntil = function (L, pred, o) {
    const max = (o && o.maxSteps) || 500;
    let steps = 0;
    while (steps < max && !pred(L)) {
      Auto.resolveAll(L);
      const r = LG().Calendar.advance(L);
      if (!r.ok) {
        if (r.blockers && r.blockers.some((b) => b.k === 'FIRED')) return { steps: steps, ok: false, reason: r.msg, fired: true };
        Auto.resolveAll(L);
        const r2 = LG().Calendar.advance(L);
        if (!r2.ok) return { steps: steps, ok: false, reason: r2.msg };
      }
      steps++;
    }
    return { steps: steps, ok: pred(L) };
  };

  /**
   * Common stop conditions for "Sim to…": 'week' (next calendar step), 'playoffs', 'seasonEnd', 'draft', 'fa',
   * 'nextSeason' (PRESEASON of the next season). @returns {function(League):boolean}
   */
  Auto.until = function (kind, L0) {
    const s0 = L0 ? L0.season : null, w0 = L0 ? L0.week : null, p0 = L0 ? L0.phase : null;
    switch (kind) {
      case 'week': return (L) => L.week !== w0 || L.phase !== p0;
      case 'playoffs': return (L) => L.phase === C.PHASE.PLAYOFFS || (s0 != null && L.season > s0);
      case 'seasonEnd': return (L) => L.phase === C.PHASE.SEASON_END || (s0 != null && L.season > s0);
      case 'draft': return (L) => L.phase === C.PHASE.DRAFT || (s0 != null && L.season > s0);
      case 'fa': return (L) => L.phase === C.PHASE.FREE_AGENCY || (s0 != null && L.season > s0);
      case 'nextSeason': return (L) => s0 != null && L.season > s0;
      default: throw new Error('[Auto] unknown until ' + kind);
    }
  };

  /** Cut lowest-value players until the roster fits (alias of Roster.cutToMax; used by AI GM). */
  Auto.cutToMax = function (L, tid, max) { return LG().Roster.cutToMax(L, tid, max); };
})(globalThis.PT = globalThis.PT || {});
