/* Pixel Touchdown: js/engine/autopilot.js
 * Owner: WP3. Responsibility: generates an Action for the user's side (autoplay, tests, idle demo).
 * Autopilot drives the user's side THROUGH the normal user-input paths (aim + throw, joystick, moves, star taps, kick aim),
 * using the same brains as the AI (AIQB.think, AI.carrier). Autopilot.resolve(game) answers needs() like a coach would.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const AP = PT.ns('Engine.Autopilot');
  const tmpDec = { act: 'none', tx: 0, ty: 0, lob: false, mx: 0, my: 0, tgt: -1 };
  const tmpCar = { mx: 0, my: 0, sprint: false, juke: false, spin: false, dive: false };

  function clear(out) {
    out.mx = 0; out.my = 0; out.sprint = false; out.throw = false; out.lob = false; out.pass = null; out.snap = false;
    out.juke = false; out.dive = false; out.spin = false; out.star = false; out.starPick = null; out.kick = false;
    out.aim.on = false; out.kickAim.on = false; out.ability = false;
  }

  /**
   * Fill `out` with an Action for the user's side this tick.
   * @param {Object} game @param {Action} [out] @returns {Action}
   */
  AP.action = function (game, out) {
    out = out || PT.Engine.blankAction();
    clear(out);
    const G = game._G, T = G.T, P = G.P, E = PT.Engine;
    if (G.userIdx < 0 || G.over) return out;
    if (!G.idle) G.apTick = G.tick;        // the debug Autopilot is driving: human-only helpers (pocket time etc.) are off
    const n = game.needs();
    if (n && n.k === 'SNAP') {
      if (n.side === 'O' && game.canAbility()) { out.ability = true; return out; }     // arm the offensive Star ability
      const lt = (G.fast || G.idle) ? T.FAST.LINEUP_T : T.LINEUP_T;
      out.snap = G.pt >= lt + (G.idle ? T.IDLE_SNAP : 0.5);
      return out;
    }
    if (n && n.k === 'KICK_AIM') {
      out.kickAim.on = true; out.kickAim.dx = 0; out.kickAim.dy = G.dir;
      out.kickAim.pow = Math.min(0.93, (n.minPow || 0.5) + 0.12);
      out.kick = G.pt > 0.9;
      return out;
    }
    if (G.phase !== 'LIVE') return out;
    // star play: tap mid-window
    const s = G.star;
    if (s.ring === 'green' && s.left <= s.win * 0.6) { if (game.canAbility()) out.ability = true; else out.star = true; }
    else if (G.poss !== G.userIdx && game.canAbility() && P.starEnt) {
      // defense: fire the Star ability when he is near the ball
      const st = G.ents[P.starEnt[G.userIdx]], b = G.ball;
      const bx = b.st === 'air' ? b.lx : b.x, by = b.st === 'air' ? b.ly : b.y;
      if (P.t > 0.6 && Math.hypot(st.x - bx, st.y - by) < 6) out.ability = true;
    }
    const ci = G.ctl;
    if (ci < 0) return out;
    const e = G.ents[ci];
    if (P.kind === 'scrim' && ci === P.qb && e.ball && !P.thrown && !P.crossed) {
      if (P.qbMode === 'mesh') { if (E.AIQB.optionRead(G, e)) out.snap = P.t > 0.5; return out; }
      if (P.qbMode !== 'pass' || P.windT > 0) return out;
      const dec = E.AIQB.think(G, e, T.DT || PT.C.DT, tmpDec);
      if (dec.act === 'throw' || dec.act === 'away') {
        out.aim.on = true; out.aim.tx = dec.tx; out.aim.ty = dec.ty; out.aim.pow = 1; out.throw = true; out.lob = dec.lob;
      } else if (dec.act === 'scramble') {
        out.mx = dec.mx; out.my = dec.my;
      } else if (dec.mx || dec.my) {
        out.mx = dec.mx * 0.35; out.my = dec.my * 0.35;     // pocket slide at 35% (like the AI QB)
      }
      return out;
    }
    if (e.ball) {
      E.AI.carrier(G, e, PT.C.DT, tmpCar);
      out.mx = tmpCar.mx; out.my = tmpCar.my; out.sprint = tmpCar.sprint;
      out.juke = tmpCar.juke; out.spin = tmpCar.spin; out.dive = tmpCar.dive;
    }
    return out;
  };

  /**
   * Answer the current need like a sensible coach (tests / autoplay). Returns true if something was resolved.
   * @param {Object} game
   */
  AP.resolve = function (game) {
    const n = game.needs();
    if (!n) return false;
    const G = game._G, RU = PT.Engine.Rules;
    if (n.k === 'PLAYCALL') {
      // the first card that is actually callable (a disabled "Too far" FG card must never stall the Autopilot)
      const cards = game.options(n.side);
      for (let i = 0; i < cards.length; i++) { if (cards[i].ok === false) continue; if (game.callPlay(cards[i].id)) return true; }
      return false;
    }
    if (n.k === 'FOURTH') return game.fourth(RU.ai4th(G));
    if (n.k === 'PAT') return game.choosePAT(RU.aiPAT(G, G.patTeam));
    return false;
  };
})(globalThis.PT = globalThis.PT || {});
