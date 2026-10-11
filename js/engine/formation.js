/* Pixel Touchdown: js/engine/formation.js
 * Owner: WP3. Responsibility: lineup from play + depth, LOS placement, hash marks.
 * No hash marks (design 8.1): the ball is always spotted at x = MID_X. Offense-frame (x right, y downfield) → field via
 * fx = MID + x·dir·flip, fy = los + y·dir. Defense art uses the same frame but is never flipped (design 7.1).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const F = PT.ns('Engine.Formation');
  const MID = C.FIELD.MID_X;

  /** offense-frame x → field x (with flip) */
  F.fx = function (G, ox) { return MID + ox * G.dir * G.P.flip; };
  /** offense-frame x → field x (no flip: defense art, areas) */
  F.dx = function (G, ox) { return MID + ox * G.dir; };
  F.fy = function (G, oy) { return G.los + oy * G.dir; };
  /** field → offense frame (unflipped) */
  F.ox = function (G, x) { return (x - MID) * G.dir; };
  F.oy = function (G, y) { return (y - G.los) * G.dir; };

  /**
   * Pick a healthy pid for a slot, honoring the depth chart and skipping players already used this lineup.
   * @returns {number} pid
   */
  F.pick = function (G, ti, slot, used) {
    const gt = G.teams[ti], info = G.info[ti], dc = gt.dc[slot] || [];
    for (let i = 0; i < dc.length; i++) {
      const pid = dc[i];
      if (info[pid] && !info[pid].out && !used[pid]) return pid;
    }
    const pos = C.SLOT_POS[slot];
    let best = -1, bo = -1;
    for (let i = 0; i < gt.pl.length; i++) {
      const p = gt.pl[i];
      if (info[p.pid].out || used[p.pid]) continue;
      if (pos && p.pos !== pos) continue;
      if (p.ovr > bo) { bo = p.ovr; best = p.pid; }
    }
    if (best >= 0) return best;
    for (let i = 0; i < gt.pl.length; i++) {
      const p = gt.pl[i];
      if (info[p.pid].out || used[p.pid] || (p.pos === 'K' && slot !== 'K')) continue;
      if (p.ovr > bo) { bo = p.ovr; best = p.pid; }
    }
    if (best >= 0) return best;
    for (let i = 0; i < gt.pl.length; i++) if (!used[gt.pl[i].pid]) return gt.pl[i].pid;
    return gt.pl[0].pid;
  };

  function jog(e, x, y, fa) {
    e.lx0 = e.x; e.ly0 = e.y; e.lx1 = x; e.ly1 = y; e.fa = fa;
  }
  F.jog = jog;

  /** Put team ti's 7 Ents on the given slots/side. Returns nothing; sets pids + ratings + reset. */
  function fill(G, ti, slots, side, used) {
    const E = PT.Engine.Entity;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[ti * 7 + k];
      const slot = slots[k];
      const pid = F.pick(G, ti, slot, used);
      used[pid] = 1;
      E.place(G, e, pid, slot, side);
      PT.Box.markPlayed(G.box, pid, G.tids[ti], !!G.starters[ti][pid]);
    }
  }

  /** Scrimmage lineup for G.P.play (offense) and G.P.call (defense). */
  F.scrimmage = function (G) {
    const P = G.P, o = G.poss, d = 1 - o, play = P.play, call = P.call, R = PT.Engine.Entity.R;
    const used = {};
    fill(G, o, C.OFF_SLOTS, 'O', used);
    const usedD = {};
    fill(G, d, C.DEF_SLOTS, 'D', usedD);
    const form = PT.Data.Playbook.FORMS[play.form] || PT.Data.Playbook.FORMS.gun;
    const offFa = G.dir > 0 ? 0 : Math.PI, defFa = G.dir > 0 ? Math.PI : 0;
    // offense spots
    for (let k = 0; k < 7; k++) {
      const e = G.ents[o * 7 + k], slot = C.OFF_SLOTS[k];
      let s = form[slot];
      const as = play.as[slot];
      if (as && as.rt) s = as.rt[0];
      else if (as && as.lane && slot !== 'QB') s = as.lane[0];
      if (play.motion && play.motion.slot === slot) s = play.motion.from;
      jog(e, F.fx(G, s[0]), F.fy(G, s[1]), offFa);
    }
    // defense spots
    const D = PT.Data.Defense, base = D.BASE;
    // zone corners vs trips: both receivers on one side would pull both corners over there and empty the other half;
    // the corner over the inside receiver walks over to the empty side instead (coverage fix)
    const c1 = call.as.CB1 || {}, c2 = call.as.CB2 || {};
    let walk = -1;
    if (c1.k === 'zone' && c2.k === 'zone') {
      const x1 = F.ox(G, G.ents[o * 7 + 2].lx1), x2 = F.ox(G, G.ents[o * 7 + 3].lx1);
      if (x1 * x2 > 0) walk = Math.abs(x1) < Math.abs(x2) ? 4 : 5;   // DEF_SLOTS index of the inside corner
    }
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k], slot = C.DEF_SLOTS[k], a = call.as[slot] || { k: 'rush' };
      let ox = base[slot][0], oy = base[slot][1];
      if (slot === 'CB1' || slot === 'CB2') {
        const wr = G.ents[o * 7 + (slot === 'CB1' ? 2 : 3)];
        ox = F.ox(G, wr.lx1); oy = a.press ? 1 : a.tight ? 1.5 : a.off ? a.off : 6;
        if (a.k === 'zone') oy = 6;
        ox += ox > 0 ? 0.6 : -0.6;
      }
      if (k === walk) { const w = G.ents[o * 7 + (slot === 'CB1' ? 2 : 3)]; ox = F.ox(G, w.lx1) > 0 ? -13 : 13; oy = 7; }
      if (a.at) { ox = a.at[0]; oy = a.at[1]; }
      if (a.k === 'man' && (a.on === 'TE' || a.on === 'RB') && !a.at) {
        const tgt = G.ents[o * 7 + C.OFF_SLOTS.indexOf(a.on)];
        const tox = F.ox(G, tgt.lx1);
        ox = tox * 0.6 + ox * 0.4;
      }
      if (oy < 0.8) oy = 0.8;
      jog(e, F.dx(G, ox), F.fy(G, oy), defFa);
    }
    P.rolesSet = false;
    void R;
  };

  /** Kickoff lineup: team kt kicks from its own 35 (design 8.4). */
  F.kickoff = function (G, kt) {
    const rt = 1 - kt, dirK = G.dirOf(kt);
    const used = {}, usedR = {};
    const kSlots = ['K', 'DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2'];
    fill(G, kt, kSlots, 'K', used);
    // receiving team: KR + six blockers
    const krPid = F.pick(G, rt, 'KR', usedR);
    usedR[krPid] = 1;
    const rSlots = ['KR', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2'];
    const E = PT.Engine.Entity;
    for (let k = 0; k < 7; k++) {
      const e = G.ents[rt * 7 + k];
      const pid = k === 0 ? krPid : F.pick(G, rt, rSlots[k], usedR);
      usedR[pid] = 1;
      E.place(G, e, pid, rSlots[k], 'K');
      PT.Box.markPlayed(G.box, pid, G.tids[rt], !!G.starters[rt][pid]);
    }
    const ballY = (dirK > 0 ? C.FIELD.GOAL_LO : C.FIELD.GOAL_HI) + G.T.KO_LINE * dirK;
    G.ballSpotY = ballY;
    const lanes = [0, -20, -12, -5, 5, 12, 20];
    for (let k = 0; k < 7; k++) {
      const e = G.ents[kt * 7 + k];
      if (k === 0) jog(e, MID - 1.5 * dirK, ballY - 6 * dirK, dirK > 0 ? 0 : Math.PI);
      else jog(e, MID + lanes[k], ballY - 1 * dirK, dirK > 0 ? 0 : Math.PI);
    }
    const rSpots = [[0, 62], [-7, 18], [7, 18], [-15, 14], [15, 14], [-4, 30], [4, 30]];
    for (let k = 0; k < 7; k++) {
      const e = G.ents[rt * 7 + k];
      jog(e, MID + rSpots[k][0], ballY + rSpots[k][1] * dirK, dirK > 0 ? Math.PI : 0);
    }
  };

  /** Punt lineup (offense = G.poss, LOS = G.los). */
  F.punt = function (G) {
    const o = G.poss, d = 1 - o, E = PT.Engine.Entity;
    const used = {}, usedR = {};
    fill(G, o, ['K', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2'], 'K', used);
    const krPid = F.pick(G, d, 'KR', usedR);
    usedR[krPid] = 1;
    const rSlots = ['KR', 'DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2'];
    for (let k = 0; k < 7; k++) {
      const e = G.ents[d * 7 + k];
      const pid = k === 0 ? krPid : F.pick(G, d, rSlots[k], usedR);
      usedR[pid] = 1;
      E.place(G, e, pid, rSlots[k], 'K');
      PT.Box.markPlayed(G.box, pid, G.tids[d], !!G.starters[d][pid]);
    }
    const oS = [[0, -12], [-4, -2.5], [-20, -1], [20, -1], [4, -2.5], [-1.5, -1], [1.5, -1]];
    const offFa = G.dir > 0 ? 0 : Math.PI, defFa = G.dir > 0 ? Math.PI : 0;
    for (let k = 0; k < 7; k++) jog(G.ents[o * 7 + k], F.dx(G, oS[k][0]), F.fy(G, oS[k][1]), offFa);
    const exp = G.T.PUNT_NET + 75 * G.T.PUNT_KCK + G.T.PUNT_RET_ADD;
    const dS = [[0, Math.min(exp, F.oy(G, G.dir > 0 ? 118 : 2))], [-1.5, 1], [1.5, 1], [-5, 4], [5, 4], [-19, 1.5], [19, 1.5]];
    for (let k = 0; k < 7; k++) jog(G.ents[d * 7 + k], F.dx(G, dS[k][0]), F.fy(G, dS[k][1]), defFa);
  };

  /** Field goal / extra point lineup. */
  F.fieldGoal = function (G) {
    const o = G.poss, d = 1 - o;
    const used = {}, usedD = {};
    fill(G, o, ['K', 'QB', 'OL1', 'OL2', 'TE', 'RB', 'WR1'], 'K', used);
    fill(G, d, C.DEF_SLOTS, 'D', usedD);
    const offFa = G.dir > 0 ? 0 : Math.PI, defFa = G.dir > 0 ? Math.PI : 0;
    const oS = [[-1.2, -9.5], [0, -7], [-1.5, -1], [1.5, -1], [3.2, -1], [-3.2, -1], [5, -1.2]];
    for (let k = 0; k < 7; k++) jog(G.ents[o * 7 + k], F.dx(G, oS[k][0]), F.fy(G, oS[k][1]), offFa);
    const dS = [[-1.5, 1], [1.5, 1], [-3.5, 1.2], [3.5, 1.2], [-6, 2], [6, 2], [0, 8]];
    for (let k = 0; k < 7; k++) jog(G.ents[d * 7 + k], F.dx(G, dS[k][0]), F.fy(G, dS[k][1]), defFa);
  };

  /** Finish (or advance) the presnap jog. @param {number} f 0..1 */
  F.jogStep = function (G, f) {
    const s = f >= 1 ? 1 : f * f * (3 - 2 * f);
    for (let i = 0; i < 14; i++) {
      const e = G.ents[i];
      const nx = e.lx0 + (e.lx1 - e.lx0) * s, ny = e.ly0 + (e.ly1 - e.ly0) * s;
      e.vx = 0; e.vy = 0;
      e.spd = f < 1 ? Math.hypot(nx - e.x, ny - e.y) * 60 : 0;
      e.x = nx; e.y = ny; e.z = 0;
      e.an = f < 1 && e.spd > 0.5 ? 'run' : 'stance';
    }
  };
})(globalThis.PT = globalThis.PT || {});
