/* Pixel Touchdown: js/engine/entity.js
 * Owner: WP3. Responsibility: entity struct, ratings→physical attributes.
 * One Ent per field slot (14, fixed for the whole game: 0..6 home, 7..13 away). Each play the Ent gets a pid + slot.
 * Effective skills = base + home/difficulty/coach/twist/out-of-position/close-game/weather (design 4, 5, 8.17, 14.1, 16).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const E = PT.ns('Engine.Entity');

  /** Role codes (shared by all engine modules) */
  E.R = {
    NONE: 0, QB: 1, ROUTE: 2, PBLK: 3, BLOCK: 4, RBLK: 5, CARRIER: 6, ESCORT: 7, FAKE: 8,
    RUSH: 10, MAN: 11, ZONE: 12, FILL: 13, SPY: 14, FREE: 15, PURSUE: 16, BREAK: 17, FILLRUSH: 18,
    KCOVER: 20, KRET: 21, KBLOCK: 22, KICKER: 23, HOLDER: 24, IDLE: 25, LANE: 26, PSET: 27, SELL: 28
  };

  /** @constructor */
  function Ent(id, tm) {
    this.id = id; this.tm = tm; this.pid = 0; this.pos = ''; this.side = 'O'; this.info = null; this.sz = 'M';
    this.x = 0; this.y = 0; this.z = 0; this.px = 0; this.py = 0; this.pz = 0;
    this.vx = 0; this.vy = 0; this.vz = 0; this.dvx = 0; this.dvy = 0;
    this.fa = 0; this.spd = 0; this.an = 'idle'; this.at = 0; this.ball = false; this.ctl = false; this.hi = 0;
    this.lx0 = 0; this.ly0 = 0; this.lx1 = 0; this.ly1 = 0;             // presnap jog from → to
    // skills (effective) and physical attributes
    this.r = { spd: 50, pow: 50, mov: 50, hnd: 50, arm: 50, aim: 50, tkl: 50, cov: 50, smt: 50, kck: 50 };
    this.top = 7; this.acc = 14; this.rad = 0.5; this.mass = 2; this.reach = 1.1; this.jumpH = 2.9; this.diveL = 2;
    this.block = 50; this.rush = 50; this.shed = 50; this.react = 0.3;
    // role/AI state
    this.role = 0; this.rs = 0; this.rt0 = 0; this.tgt = -1; this.tx = 0; this.ty = 0; this.asg = null;
    this.ax = 0; this.ay = 0; this.ar = 0; this.ax2 = 0; this.ay2 = 0; this.ar2 = 0; this.deep = false; this.area2T = 0;
    this.thinkT = 0; this.ptx = 0; this.pty = 0; this.readDone = false; this.bite = 0; this.trail = 1; this.fake = 0;
    this.pushX = 0; this.pushY = 0; this.blkT = 0; this.pre = false; this.preX = 0; this.preY = 0; this.tsel = '';
    // engagement (blocks)
    this.eng = -1; this.eng2 = -1; this.engT = 0; this.engMax = 0; this.engWin = false; this.engRun = false; this.engPush = 0;
    this.noEng = -1; this.noEngT = 0; this.beatT = -1; this.pushed = 0; this.engX = 0; this.engY = 0;
    // routes (field-space waypoints)
    this.wpx = new Float64Array(12); this.wpy = new Float64Array(12); this.wpw = new Float64Array(12);
    this.wpn = 0; this.wpi = 0; this.wpEnd = 0; this.wpWait = 0; this.turnT = 0; this.hx = 0; this.hy = 1; this.setX = 0; this.setY = 0; this.setOn = false; this.drT = 0; this.drOn = false; this.drRe = 0; this.drX = 0; this.drY = 0; this.drHold = 0; this.jkT = 0; this.reactMul = 1; this.readMul = 1;
    // carrier moves
    this.energy = 100; this.enMax = 100; this.sprint = false; this.jukeCd = 0; this.jukeCdMax = 1.5; this.jukeSoft = 0; this.spinCd = 0; this.jukeT = 0; this.jukeWin = 0;
    this.spinT = 0; this.diveT = 0; this.jvx = 0; this.jvy = 0; this.slowT = 0; this.carT = 0;
    // defense / contact
    this.downT = 0; this.tkCd = 0; this.dvT = 0; this.dvx0 = 0; this.dvy0 = 0; this.diving = false; this.superT = 0; this.whiff = false;
    // QB
    this.qbRead = 0; this.qbNext = 0; this.qbDropX = 0; this.qbDropY = 0; this.qbDropT = 0; this.qbX0 = 0; this.qbY0 = 0; this.qbMoved = false;
    this.goBallT = 1e9; this.dside = false; this.pressT = -1; this.abK = ''; this.turboBrk = false; this.lagX = 0; this.lagY = 0;
  }
  E.Ent = Ent;

  /** @param {number} id @param {number} tm @returns {Ent} */
  E.create = function (id, tm) { return new Ent(id, tm); };

  function normKey(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }
  E.normKey = normKey;

  /**
   * Build per-team player info maps (G.info[ti][pid]) and team-wide skill bonuses.
   * @param {Object} G game state
   */
  E.buildInfos = function (G) {
    const T = G.T, cfg = G.cfg;
    G.info = [{}, {}];
    G.tb = [0, 0];
    G.coachOff = [0, 0]; G.coachDef = [0, 0]; G.smtAdj = [0, 0]; G.penMul = [1, 1];
    for (let ti = 0; ti < 2; ti++) {
      const gt = G.teams[ti];
      let b = 0;
      if (!cfg.neutral && ti === 0) b += (gt.hype != null && gt.hype >= 80) ? 2 : 1;    // home field (design 8.17)
      if (G.userIdx >= 0 && ti !== G.userIdx) b += T.AI_SKILL[G.diff] || 0;             // difficulty (design 16)
      G.tb[ti] = b;
      const co = gt.coach || {};
      G.coachOff[ti] = Math.max(0, Math.min(4, (co.off || 1) - 1));
      G.coachDef[ti] = Math.max(0, Math.min(4, (co.def || 1) - 1));
      if (gt.spirit != null) {
        if (gt.spirit >= 75) G.smtAdj[ti] = 2;
        else if (gt.spirit <= 25) { G.smtAdj[ti] = -2; G.penMul[ti] = 1.25; }
      }
      for (let i = 0; i < gt.pl.length; i++) {
        const p = gt.pl[i];
        const t = {};
        for (let j = 0; j < (p.tr || []).length; j++) t[p.tr[j]] = true;
        G.info[ti][p.pid] = {
          pid: p.pid, n: p.n, num: p.num, pos: p.pos, alt: p.alt || [], sp: p.sp, sz: C.SIZES[p.sz] ? p.sz : 'M', cs: p.cs || 0,
          r: p.r, t: t, q: T.SPQ[p.sp] || {}, age: p.age || 26, ovr: p.ovr || 60,
          out: false, backAt: -1, injured: false, tm: ti
        };
      }
    }
  };

  /**
   * Compute effective skills + physical attributes for an Ent playing `slot` on `side` ('O'|'D'|'K').
   * @param {Object} G @param {Ent} e @param {Object} info @param {string} slot @param {string} side
   */
  E.rate = function (G, e, info, slot, side) {
    const T = G.T, ti = e.tm, t = info.t, q = info.q, wx = G.cfg.weather ? G.cfg.weather.k : 'sunny';
    let all = G.tb[ti];
    if (side === 'O') all += G.coachOff[ti]; else if (side === 'D') all += G.coachDef[ti];
    const nat = C.SLOT_POS[slot];
    if (nat && nat !== info.pos && info.alt.indexOf(nat) < 0) all -= C.OUT_OF_POS_PENALTY;
    if (G.close) { if (t.ice_cold) all += 5; if (t.shaky_paws) all -= 5; }
    if (G.cfg.po > 0 && t.big_game) all += 4;
    const r = e.r, b = info.r;
    for (let i = 0; i < C.RATINGS.length; i++) {
      const k = C.RATINGS[i];
      r[k] = (b[k] || 40) + all;
    }
    if (G.twist.speedy) r.spd += 2;
    r.smt += G.smtAdj[ti];
    // Star player (ROUND6 A): +STAR_PASSIVE to his position's main skills (OVR weight ≥ 0.15)
    if (info.star) { const w = C.OVR_W[info.pos]; if (w) for (const k in w) if (w[k] >= 0.15) r[k] += T.STAR_PASSIVE; }
    if (ti === G.userIdx && slot === 'QB') r.aim += 2 * (G.sk.qbwhisperer || 0);
    if (wx === 'rain' && !q.rainImm) r.spd *= 0.97;
    if (wx === 'snow' && !q.snowImm) { r.spd *= 0.92; if (!q.snowMov) r.mov -= 8; }
    for (let i = 0; i < C.RATINGS.length; i++) {
      const k = C.RATINGS[i];
      r[k] = r[k] < 1 ? 1 : r[k] > 99 ? 99 : r[k];
    }
    const S = C.SIZES[info.sz];
    e.sz = info.sz;
    e.top = T.SPD_BASE + r.spd * T.SPD_K;
    if (slot === 'QB' && t.scrambler) e.top *= T.QB_SCRAMBLE_MUL;
    const accT = Math.max(0.2, T.ACC_BASE - r.mov * T.ACC_K);
    e.acc = e.top / accT;
    e.rad = S.r + (q.hitbox || 0);
    e.mass = S.mass;
    e.reach = S.reach + (q.reach || 0);
    e.jumpH = S.jump + (q.height || 0);
    e.diveL = S.dive + (q.dive || 0);
    e.block = 0.60 * r.pow + 0.25 * r.smt + 0.15 * r.mov;
    e.rush = 0.50 * r.pow + 0.35 * r.spd + 0.15 * r.smt;
    e.shed = 0.50 * r.pow + 0.30 * r.tkl + 0.20 * r.smt;
    e.react = T.REACT_BASE - r.smt * T.REACT_K;
    e.enMax = t.speed_demon ? T.ENERGY_MAX_DEMON : T.ENERGY_MAX;
  };

  /**
   * Put a player into an Ent for the next play and reset per-play state.
   * @param {Object} G @param {Ent} e @param {number} pid @param {string} slot @param {string} side
   */
  E.place = function (G, e, pid, slot, side) {
    const info = G.info[e.tm][pid];
    e.pid = pid; e.pos = slot; e.side = side; e.info = info;
    E.rate(G, e, info, slot, side);
    E.reset(e);
  };

  /** Reset per-play state (keeps identity, ratings and position). @param {Ent} e */
  E.reset = function (e) {
    e.vx = 0; e.vy = 0; e.vz = 0; e.dvx = 0; e.dvy = 0; e.z = 0; e.spd = 0;
    e.an = 'stance'; e.at = 0; e.ball = false; e.ctl = false; e.hi = 0;
    e.role = 0; e.rs = 0; e.rt0 = 0; e.tgt = -1; e.asg = null; e.deep = false; e.area2T = 0; e.ar = 0; e.ar2 = 0;
    e.thinkT = 0; e.readDone = false; e.bite = 0; e.trail = 1; e.fake = 0; e.blkT = 0; e.pre = false; e.tsel = '';
    e.pushX = 0; e.pushY = 0;
    e.eng = -1; e.eng2 = -1; e.dside = false; e.engT = 0; e.engMax = 0; e.engWin = false; e.engRun = false; e.noEng = -1; e.noEngT = 0; e.beatT = -1; e.pushed = 0;
    e.wpn = 0; e.wpi = 0; e.wpEnd = 0; e.wpWait = 0; e.turnT = 0; e.setOn = false; e.drT = 0; e.drOn = false; e.drRe = 0; e.jkT = 0;
    e.energy = e.enMax; e.sprint = false; e.jukeCd = 0; e.jukeSoft = 0; e.spinCd = 0; e.jukeT = 0; e.jukeWin = 0; e.spinT = 0; e.diveT = 0;
    e.jvx = 0; e.jvy = 0; e.slowT = 0; e.carT = 0;
    e.downT = 0; e.tkCd = 0; e.dvT = 0; e.diving = false; e.superT = 0; e.whiff = false;
    e.qbRead = 0; e.qbNext = 0; e.qbMoved = false; e.pressT = -1; e.turboBrk = false;
  };

  /** Ent is free to act (not on the ground, not engaged). */
  E.free = function (e) { return e.downT <= 0 && e.eng < 0; };
})(globalThis.PT = globalThis.PT || {});
