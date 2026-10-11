/* Pixel Touchdown: js/engine/rules.js
 * Owner: WP3. Responsibility: downs, distance, clock, scoring, possession, OT, end-of-play spotting.
 * Clock = runoff model (design 8.3). The runoff of a finished play is PENDING until the next snap/kick so a timeout
 * (→ 6 s) or a spike (→ 3 s) can still shorten it; if nobody can stop it the pending runoff is applied at once.
 * Stats are credited here at the whistle through PT.Box only (so box totals stay consistent).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const RU = PT.ns('Engine.Rules');
  const GL = C.FIELD.GOAL_LO, GH = C.FIELD.GOAL_HI;

  RU.dirOf = function (G, ti) { return ti === 0 ? G.dir0 : -G.dir0; };
  /** goal line team ti attacks */
  RU.goalY = function (G, ti) { return RU.dirOf(G, ti) > 0 ? GH : GL; };
  RU.ownGoalY = function (G, ti) { return RU.dirOf(G, ti) > 0 ? GL : GH; };
  /** field y of team ti's own n-yard line */
  RU.ownYard = function (G, ti, n) { return RU.ownGoalY(G, ti) + n * RU.dirOf(G, ti); };
  /** yards from the offense's LOS to the goal it attacks */
  RU.toGoal = function (G) { return (RU.goalY(G, G.poss) - G.los) * G.dir; };
  RU.fgDist = function (G) { return Math.round(RU.toGoal(G) + G.T.FG_ADD); };
  RU.clockLeft = function (G) { return Math.max(0, G.clk - G.pend); };
  RU.halfEndQ = function (G) { return G.q === 2 || G.q >= 4; };
  /** Box-score column for the current period: halves 1..2 (columns 3..4 stay 0), OT periods 5+. */
  RU.boxQ = function (G) { return G.q; };   // quarters 1..4, OT 5+
  RU.isOT = function (G) { return G.q > 4; };
  /** Late-half window: the warning comes at min(60 s, qLen/3) left in Q2/Q4 (one-minute warning at 3:00 quarters). */
  RU.warnT = function (G) { return Math.min(60, G.qLen / 3); };
  /** 1 | 2, 3 = OT */
  RU.half = function (G) { return G.q <= 2 ? 1 : G.q <= 4 ? 2 : 3; };

  /** Fill a Situation object (also used for the HUD). */
  RU.situation = function (G, out) {
    out = out || {};
    const T = G.T;
    out.q = G.q; out.clk = Math.ceil(RU.clockLeft(G)); out.hs = G.score[0]; out.as = G.score[1];
    out.poss = G.poss === 0 ? 'h' : 'a'; out.possTid = G.tids[G.poss]; out.y = G.los; out.dir = G.dir;
    out.down = G.down; out.togo = G.togo; out.ballOn = PT.Util.fmtYardLine(G.los, G.dir);
    if (!out.tos) out.tos = [0, 0];
    out.tos[0] = G.tos[0]; out.tos[1] = G.tos[1];
    out.goal = (G.fdY - RU.goalY(G, G.poss)) * G.dir >= -0.01;
    out.two = !!G.tryTwo; out.ot = G.q > 4; out.half = RU.half(G); out.warn = RU.warnT(G); out.toGoal = Math.round(RU.toGoal(G));
    const k = PT.Engine.Kicking;
    const kp = G.kicker(G.poss);
    const dist = RU.fgDist(G);
    out.fgDist = dist;
    out.fgOk = !!kp && dist <= k.maxRange(G, kp) && !G.tryTwo;
    out.fgPct = out.fgOk ? Math.round(k.autoPct(G, kp, dist) * 100) : 0;
    out.expiring = G.clk - G.pend <= 0 && G.pend > 0;
    out.lead = (G.score[G.poss] - G.score[1 - G.poss]);
    void T;
    return out;
  };

  /** Line to gain from the current LOS (design 8.2 goal-to-go). */
  RU.firstDown = function (G) {
    G.down = 1;
    const g = RU.goalY(G, G.poss);
    let fd = G.los + 10 * G.dir;
    if ((fd - g) * G.dir >= 0) fd = g;
    G.fdY = fd;
    G.togo = Math.max(1, Math.round(Math.abs(fd - G.los)));
  };

  /** Give team ti the ball at field y (1st & 10). */
  RU.setPoss = function (G, ti, y) {
    const changed = ti !== G.poss;
    G.poss = ti; G.dir = RU.dirOf(G, ti);
    G.los = PT.Util.clamp(y, GL + 0.5, GH - 0.5);
    RU.firstDown(G);
    G.driveStart = G.los;
    if (G.q > 4) G.ot.poss[ti]++;
    if (changed) G.em.emit('possession', { tid: G.tids[ti] });
  };

  /** Apply the pending runoff. Returns true if the period clock expired. */
  RU.applyPending = function (G) {
    if (G.pend <= 0) return G.clk <= 0;
    const before = G.clk;
    G.clk -= G.pend;
    PT.Box.team(G.box, G.tids[G.pendTeam], 'top', Math.round(Math.min(G.pend, before)));
    G.pend = 0;
    const W = RU.warnT(G);
    if ((G.q === 2 || G.q === 4) && before > W && G.clk <= W && G.clk > 0) {
      G.clk = W;
      G.em.emit('minuteWarning', { q: G.q, t: W });
      G.em.emit('twoMinute', { q: G.q, t: W });          // alias (older HUD)
    }
    if (G.clk <= 0) { G.clk = 0; return true; }
    return false;
  };

  /** Can the user still stop a pending runoff that would end the half (timeout or spike)? */
  RU.userCanRescue = function (G) {
    if (G.userIdx < 0 || !RU.halfEndQ(G)) return false;
    return G.tos[G.userIdx] > 0 || G.poss === G.userIdx;
  };

  /** AI timeout logic (design 8.3) after a play whose runoff is R. Returns the (possibly reduced) runoff. */
  RU.aiTimeout = function (G, R, nextPoss) {
    if (R <= G.T.RUN_STOP) return R;
    const left = G.clk - R;
    for (let ti = 0; ti < 2; ti++) {
      if (ti === G.userIdx || G.tos[ti] <= 0) continue;
      const diff = G.score[ti] - G.score[1 - ti];
      const W = RU.warnT(G);
      const want = (G.q >= 4 && left <= W * 1.5 && diff < 0) || (G.q === 2 && left <= W && nextPoss === ti && G.clk > 5);
      if (want) {
        G.tos[ti]--;
        G.em.emit('timeout', { tid: G.tids[ti], auto: true, left: G.tos[ti] });
        return G.T.RUN_STOP;
      }
    }
    return R;
  };

  function name(G, e) { return e && e.info ? e.info.n : 'Someone'; }
  function scoreText(G, kind, e, yds, extra) {
    const n = name(G, e);
    if (kind === 'pass') return n + ' ' + yds + ' yd pass from ' + extra;
    if (kind === 'rush') return n + ' ' + yds + ' yd run';
    if (kind === 'int') return n + ' ' + yds + ' yd interception return';
    if (kind === 'fum') return n + ' fumble recovery';
    if (kind === 'ret') return n + ' ' + yds + ' yd ' + extra + ' return';
    return n;
  }

  /** Add points. */
  /** Add points. extra = {yd, pid, how} is copied onto the scoring-summary entry (WP2 records). */
  RU.score = function (G, ti, pts, kind, txt, extra) {
    G.score[ti] += pts;
    PT.Box.score(G.box, G.tids[ti], pts, RU.boxQ(G), Math.max(0, G.clk), kind, txt);
    const e = G.box.sc[G.box.sc.length - 1];
    e.yd = extra && extra.yd != null ? extra.yd : 0; e.yds = e.yd;
    e.pid = extra && extra.pid != null ? extra.pid : null;
    e.how = extra && extra.how ? extra.how : kind === 'FG' ? 'fg' : kind === 'XP' ? 'xp' : kind === '2PT' ? 'two' : kind === 'SAF' ? 'saf' : 'run';
    if (ti === G.userIdx && kind === 'TD' && extra && extra.yd >= 40) G.ustats.longTD = Math.max(G.ustats.longTD, extra.yd);
  };

  /**
   * The whistle. Credits stats, moves the ball, scores, sets runoff and what comes next.
   * @param {Object} G @param {Object} res {k, team, y, oob, reason, good}
   */
  RU.endPlay = function (G, res) {
    const T = G.T, P = G.P, B = PT.Box, box = G.box;
    const off = P.off, def = 1 - off, tid = G.tids[off], dtid = G.tids[def];
    const ent = (i) => (i >= 0 ? G.ents[i] : null);
    const pid = (i) => (i >= 0 ? G.ents[i].pid : -1);
    const dirO = P.dir;
    let R = T.RUN_STOP, result = 'gain', desc = '', yds = 0, next = 'call', kindTag = res.k, deadT = T.DEAD_T;
    let firstDown = false, scored = false, turnover = null;
    P.endY = res.y;
    G.lastOob = !!res.oob;

    const passer = ent(P.qb), tgt = ent(P.tgt);
    if (P.kind === 'scrim' || P.kind === 'two' || P.kind === 'kneel' || P.kind === 'spike') {
      const los0 = P.los0;
      const offGain = (P.offEndY - los0) * dirO;                        // yards for offense stats (to where it lost the ball)
      const gain = res.team === off ? Math.round((res.y - los0) * dirO) : Math.round(offGain);
      yds = gain;
      // ----- offense stats -----
      if (P.kind !== 'two') {
        if (P.kind === 'spike') {
          B.add(box, pid(P.qb), tid, 'pa');
        } else if (P.thrown && P.compl) {
          const g = Math.round(offGain);
          B.add(box, pid(P.qb), tid, 'pa'); B.add(box, pid(P.qb), tid, 'pc'); B.add(box, pid(P.qb), tid, 'py', g);
          B.add(box, pid(P.catcher), tid, 'tg'); B.add(box, pid(P.catcher), tid, 'rc'); B.add(box, pid(P.catcher), tid, 'rcy', g);
          B.add(box, pid(P.catcher), tid, 'rclg', g);
          B.team(box, tid, 'py', g); B.team(box, tid, 'ty', g);
        } else if (P.thrown) {
          B.add(box, pid(P.qb), tid, 'pa');
          if (P.tgt >= 0) B.add(box, pid(P.tgt), tid, 'tg');
          if (P.picked) { B.add(box, pid(P.qb), tid, 'pi'); B.add(box, pid(P.pickBy), dtid, 'int'); }
        } else if (P.sack) {
          const g = Math.round(offGain);
          B.add(box, pid(P.qb), tid, 'psk');
          B.team(box, tid, 'py', g); B.team(box, tid, 'ty', g);
        } else if (P.rusher >= 0) {
          const g = Math.round(offGain);
          const rp = pid(P.rusher);
          B.add(box, rp, tid, 'ra'); B.add(box, rp, tid, 'ry', g); B.add(box, rp, tid, 'rlg', g);
          B.team(box, tid, 'ry', g); B.team(box, tid, 'ty', g);
        }
        if (P.pdBy >= 0) B.add(box, pid(P.pdBy), dtid, 'pd');
        if (P.sack && P.sackBy >= 0) { B.add(box, pid(P.sackBy), dtid, 'dsk'); B.add(box, pid(P.sackBy), dtid, 'tk'); }
        else if (P.tkBy >= 0 && G.ents[P.tkBy].tm === def) B.add(box, pid(P.tkBy), dtid, 'tk');
        if (P.fumBy >= 0) {
          B.add(box, pid(P.fumBy), tid, 'fum');
          if (P.ffBy >= 0) B.add(box, pid(P.ffBy), dtid, 'ff');
          if (res.team === def) { B.add(box, pid(P.fumBy), tid, 'fl'); if (P.frBy >= 0) B.add(box, pid(P.frBy), dtid, 'fr'); }
        }
        if (G.down === 3 && P.kind === 'scrim') B.team(box, tid, 'd3a');
      }
      // ----- outcome -----
      if (res.k === 'td' && res.team === off) {
        scored = true; result = 'td';
        if (P.kind === 'two') {
          RU.score(G, off, 2, '2PT', 'Two-point try is good', { yd: 0, pid: pid(P.thrown ? P.catcher : (P.rusher >= 0 ? P.rusher : P.carrierEnd)), how: 'two' });
          G.em.emit('pat', { tid: tid, good: true, kind: 'two' });
          next = 'kickoff'; G.kickTeam = off; desc = 'Two-point try is GOOD!';
        } else {
          const car = ent(G.ball.car >= 0 ? G.ball.car : P.carrierEnd);
          const tdYds = Math.round((RU.goalY(G, off) - los0) * dirO);
          let txt, kd;
          if (P.thrown && P.compl) {
            B.add(box, pid(P.qb), tid, 'ptd'); B.add(box, pid(P.catcher), tid, 'rctd');
            txt = scoreText(G, 'pass', ent(P.catcher), tdYds, name(G, passer)); kd = 'pass';
          } else {
            B.add(box, pid(P.rusher >= 0 ? P.rusher : P.carrierEnd), tid, 'rtd');
            txt = scoreText(G, 'rush', ent(P.rusher >= 0 ? P.rusher : P.carrierEnd), tdYds); kd = 'rush';
          }
          RU.score(G, off, 6, 'TD', txt, { yd: tdYds, pid: kd === 'pass' ? pid(P.catcher) : pid(P.rusher >= 0 ? P.rusher : P.carrierEnd), how: kd === 'pass' ? 'pass' : 'run', qb: kd === 'pass' ? pid(P.qb) : null });
          G.em.emit('touchdown', { tid: tid, pid: car ? car.pid : -1, kind: kd, yds: tdYds });
          next = 'pat'; G.patTeam = off; desc = 'Touchdown!';
          B.team(box, tid, 'fd'); if (G.down === 3) B.team(box, tid, 'd3c');
        }
        deadT = T.DEAD_TD_T;
      } else if (res.k === 'td' && res.team === def) {
        // defensive TD (pick-six / fumble return)
        scored = true; result = 'td'; turnover = P.picked ? 'int' : 'fumble';
        const scorer = ent(P.carrierEnd);
        const ry = Math.round(Math.abs(RU.goalY(G, def) - (P.turnY != null ? P.turnY : res.y)));
        B.add(box, pid(P.carrierEnd), dtid, 'dtd');
        B.team(box, tid, 'to');
        if (P.kind === 'two') { next = 'kickoff'; G.kickTeam = off; desc = 'No good!'; scored = false; G.score[def] += 0; }
        else {
          RU.score(G, def, 6, 'TD', scoreText(G, P.picked ? 'int' : 'fum', scorer, ry), { yd: ry, pid: scorer ? scorer.pid : null, how: P.picked ? 'pick' : 'fum' });
          G.em.emit('turnover', { kind: turnover, by: scorer ? scorer.pid : -1, tid: dtid });
          G.em.emit('touchdown', { tid: dtid, pid: scorer ? scorer.pid : -1, kind: 'def', yds: ry });
          next = 'pat'; G.patTeam = def; desc = 'Defensive touchdown!';
        }
        deadT = T.DEAD_TD_T;
      } else if (res.k === 'safety') {
        scored = true; result = 'score';
        if (P.kind === 'two') { next = 'kickoff'; G.kickTeam = off; desc = 'No good!'; }
        else {
          const sc = res.team === off ? def : off;
          RU.score(G, sc, 2, 'SAF', 'Safety');
          G.em.emit('safety', { tid: G.tids[sc] });
          next = 'safety'; G.safetyTeam = sc; desc = 'Safety!';
          if (res.team === def) B.team(box, tid, 'to');
        }
        deadT = T.DEAD_TURN_T;
      } else if (P.kind === 'two') {
        result = res.k === 'inc' ? 'inc' : 'gain'; desc = 'Two-point try fails.';
        G.em.emit('pat', { tid: tid, good: false, kind: 'two' });
        next = 'kickoff'; G.kickTeam = off;
      } else if (res.team === def) {
        // turnover, ball dead at recovery / end of return
        turnover = P.picked ? 'int' : 'fumble';
        result = 'turnover'; desc = turnover === 'int' ? 'Intercepted!' : 'Fumble! Turnover!';
        B.team(box, tid, 'to');
        G.em.emit('turnover', { kind: turnover, by: pid(P.carrierEnd), tid: dtid });
        let y = res.y;
        if ((y - RU.ownGoalY(G, def)) * RU.dirOf(G, def) <= 0) y = RU.ownYard(G, def, T.TB_PUNT);   // touchback
        RU.setPoss(G, def, y);
        deadT = T.DEAD_TURN_T;
      } else {
        // offense keeps it (or incomplete)
        let spot = P.los0;
        if (res.k === 'inc') { result = 'inc'; desc = P.incDesc || 'Incomplete'; }
        else { spot = res.y; desc = (yds >= 0 ? 'Gain of ' : 'Loss of ') + Math.abs(yds); if (P.sack) desc = 'Sacked! ' + desc; }
        G.los = PT.Util.clamp(spot, GL + 0.5, GH - 0.5);
        if ((G.los - G.fdY) * dirO >= -0.01) {
          firstDown = true;
          B.team(box, tid, 'fd'); if (G.down === 3) B.team(box, tid, 'd3c');
          RU.firstDown(G);
          G.em.emit('firstDown', { y: G.los });
        } else {
          G.down++;
          G.togo = Math.max(1, Math.round(Math.abs(G.fdY - G.los)));
          if (G.down > 4) {
            turnover = 'downs'; result = 'turnover'; desc = 'Turnover on downs';
            G.em.emit('turnover', { kind: 'downs', tid: dtid });
            RU.setPoss(G, def, G.los);
            deadT = T.DEAD_TURN_T;
          }
        }
      }
      // ----- runoff -----
      if (P.kind === 'two') R = 0;
      else if (P.kind === 'kneel') R = T.RUN_KNEEL;
      else if (P.kind === 'spike') R = T.RUN_SPIKE;
      else if (scored || turnover === 'int' || turnover === 'fumble' || res.k === 'inc' || res.oob) R = T.RUN_STOP;
      else if (P.sack) R = T.RUN_SACK;
      else {
        R = T.RUN_INB;
        if (G.hurry[off] || G.aiHurry[off]) {
          R = T.RUN_HURRY;
          if (off === G.userIdx) { if (G.sk.twominutedrill) R = 10; else if ((G.sk.clockmaster || 0) >= 2) R = 12; }
        }
        if (firstDown && RU.halfEndQ(G) && G.clk <= RU.warnT(G)) R = Math.min(R, T.RUN_LAST_MIN_FD);
      }
      if (P.pen) R = T.RUN_STOP;
    } else if (P.kind === 'kickoff' || P.kind === 'punt' || P.kind === 'onside') {
      const kt = off, rt = def;
      const isPunt = P.kind === 'punt';
      R = isPunt ? T.RUN_STOP : 0;
      if (isPunt && P.kickDist != null) { B.add(box, pid(P.kickerEnt), tid, 'pn'); B.add(box, pid(P.kickerEnt), tid, 'pny', Math.round(P.kickDist)); }
      if (P.ret >= 0 && P.retY0 != null) {
        const rp = pid(P.ret);
        const ry = Math.round((P.retEndY - P.retY0) * RU.dirOf(G, rt));
        B.add(box, rp, dtid, 'kr'); B.add(box, rp, dtid, 'kry', ry);
        if (res.k === 'td' && res.team === rt) B.add(box, rp, dtid, 'krtd');
      }
      if (P.tkBy >= 0 && G.ents[P.tkBy].tm === kt) B.add(box, pid(P.tkBy), tid, 'tk');
      if (P.fumBy >= 0) {
        B.add(box, pid(P.fumBy), dtid, 'fum');
        if (res.team === kt) { B.add(box, pid(P.fumBy), dtid, 'fl'); if (P.frBy >= 0) B.add(box, pid(P.frBy), tid, 'fr'); }
      }
      result = isPunt ? 'punt' : 'kick';
      if (res.k === 'td') {
        scored = true; result = 'td';
        const sc = res.team;
        const scorer = ent(P.carrierEnd);
        const ry = P.retY0 != null ? Math.round(Math.abs(RU.goalY(G, sc) - P.retY0)) : 0;
        RU.score(G, sc, 6, 'TD', sc === rt ? scoreText(G, 'ret', scorer, ry, isPunt ? 'punt' : 'kickoff') : scoreText(G, 'fum', scorer, 0), { yd: ry, pid: scorer ? scorer.pid : null, how: sc === rt ? 'ret' : 'fum' });
        G.em.emit('touchdown', { tid: G.tids[sc], pid: scorer ? scorer.pid : -1, kind: 'ret', yds: ry });
        next = 'pat'; G.patTeam = sc; desc = 'Return touchdown!'; deadT = T.DEAD_TD_T;
        G.poss = sc; G.dir = RU.dirOf(G, sc);
      } else if (res.k === 'safety') {
        scored = true; result = 'score';
        const sc = res.team === rt ? kt : rt;
        RU.score(G, sc, 2, 'SAF', 'Safety');
        G.em.emit('safety', { tid: G.tids[sc] });
        next = 'safety'; G.safetyTeam = sc; desc = 'Safety!';
      } else {
        let y = res.y;
        if (res.k === 'touchback') { y = RU.ownYard(G, rt, isPunt ? T.TB_PUNT : T.TB_KO); desc = 'Touchback'; }
        else desc = res.team === rt ? (P.fairCatch ? 'Fair catch' : 'Return to the ' + PT.Util.fmtYardLine(y, RU.dirOf(G, rt))) : 'Recovered by the kicking team!';
        if (res.team === kt && P.kind !== 'onside') { G.em.emit('turnover', { kind: 'fumble', by: pid(P.frBy), tid: tid }); B.team(box, dtid, 'to'); }
        if (P.kind === 'onside') { desc = res.team === kt ? 'Onside kick recovered!' : 'Onside kick fails'; G.em.emit('onside', { tid: tid, good: res.team === kt }); }
        if (P.blocked) { desc = 'Blocked punt!'; G.em.emit('turnover', { kind: 'blocked', tid: dtid }); }
        RU.setPoss(G, res.team, y);
      }
      if (isPunt) G.em.emit('punt', { tid: tid, yds: Math.round(P.kickDist || 0) });
    } else if (P.kind === 'fg' || P.kind === 'xp') {
      const kp = pid(P.kickerEnt);
      if (P.kind === 'fg') {
        R = T.RUN_STOP;
        const d = P.fgDist;
        B.add(box, kp, tid, 'fga');
        if (res.good) {
          B.add(box, kp, tid, 'fgm'); B.add(box, kp, tid, 'fglg', d);
          const pts = (G.twist.kickerchaos && d >= 50) ? 4 : 3;
          RU.score(G, off, pts, 'FG', name(G, ent(P.kickerEnt)) + ' ' + d + ' yd field goal', { yd: d, pid: kp, how: 'fg' });
          scored = true; next = 'kickoff'; G.kickTeam = off; desc = 'Field goal is GOOD!';
        } else {
          desc = 'No good!';
          let y = P.los0;
          const own20 = RU.ownYard(G, def, 20);
          if ((y - own20) * RU.dirOf(G, def) < 0) y = own20;
          RU.setPoss(G, def, y);
          turnover = 'miss';
        }
        G.em.emit('fieldGoal', { tid: tid, good: !!res.good, yds: d });
        result = 'kick';
      } else {
        R = 0;
        B.add(box, kp, tid, 'xpa');
        if (res.good) { B.add(box, kp, tid, 'xpm'); RU.score(G, off, 1, 'XP', name(G, ent(P.kickerEnt)) + ' kick', { yd: P.fgDist, pid: kp, how: 'xp' }); }
        G.em.emit('pat', { tid: tid, good: !!res.good, kind: 'kick' });
        next = 'kickoff'; G.kickTeam = off; desc = res.good ? 'Extra point is good!' : 'Extra point missed!';
        result = 'kick';
      }
    }
    // presnap penalties (no play): handled by RU.penaltyPresnap → res.k === 'pen'
    if (res.k === 'pen') { result = 'gain'; desc = P.pen.txt; R = T.RUN_STOP; }
    // penalty after a play (holding, PI, roughing, facemask)
    if (P.pen && res.k !== 'pen') desc = P.pen.txt + (desc ? ' — ' + desc : '');

    // ----- clock -----
    const nextPoss = next === 'call' ? G.poss : -1;
    R = RU.aiTimeout(G, R, nextPoss);
    // pending runoff is applied at the next snap/kick; untimed tries (XP / 2-pt) keep the score's runoff pending
    G.pend += R; if (R > 0) G.pendTeam = off;
    if (G.untimedNext) { G.untimed = true; G.untimedNext = false; }

    // ----- OT sudden death -----
    G.next = next;
    if (G.q > 4 && next !== 'pat') RU.otCheck(G);

    // history for AI counters
    if (P.kind === 'scrim' && P.play) {
      const h = G.hist[off];
      h.push(P.play.type); if (h.length > 8) h.shift();
      const hp = G.histP[off];
      hp.push(P.play.id); if (hp.length > 4) hp.shift();
    }
    if (P.call && P.kind === 'scrim') { const dh = G.dhist[def]; dh.push(P.call.id); if (dh.length > 6) dh.shift(); }

    // Star Meters (STAR_ABILITIES 2)
    if (P.kind === 'scrim') {
      PT.Engine.Stars.playEnd(G, { firstDown: firstDown, td: res.k === 'td' && res.team === off, turnover: turnover === 'int' || turnover === 'fumble' || turnover === 'downs',
        sack: !!P.sack, pd: P.pdBy >= 0, tfl: !P.sack && res.k === 'down' && res.team === off && yds < 0,
        starCatch: !!(P.compl && P.stars && P.stars[off].indexOf(P.catcher) >= 0) });
    }
    P.result = result; P.desc = desc; P.yds = yds;
    G.phase = 'DEAD'; G.pt = 0; G.deadT = (G.fast || G.idle) ? (scored ? T.FAST.DEAD_TD_T : T.FAST.DEAD_T) : deadT;
    G.ctl = -1;
    P.td = result === 'td';
    if (desc && !G.fast) PT.Engine.Snapshot.fx(G, 'text', G.ball.x, G.ball.y, 2, 1, -1, desc);
    G.em.emit('playEnd', { result: result, yds: yds, desc: desc, kind: kindTag, firstDown: firstDown, turnover: turnover,
      sit: RU.situation(G, {}) });
  };

  /** OT: after both teams have had a possession, the next score (or a lead) wins (design 8.16). */
  RU.otCheck = function (G) {
    const o = G.ot;
    if (o.poss[0] >= 1 && o.poss[1] >= 1 && G.score[0] !== G.score[1]) G.next = 'final';
    else if (G.next === 'kickoff' || G.next === 'safety' || G.next === 'call') {
      // first possession scored a FG or TD: the other team still gets its chance
    }
  };

  /** What happens after the dead-ball pause. */
  RU.afterDead = function (G) {
    const game = G.api;
    if (G.next === 'final') return game._final();
    if (G.next === 'pat') { G.phase = 'PAT'; G.pt = 0; G.patChosen = false; return; }
    if (G.next === 'safety') {
      if (RU.applyPending(G) && RU.periodEnd(G)) return;
      RU.setPoss(G, G.safetyTeam, RU.ownYard(G, G.safetyTeam, G.T.SAFETY_SPOT));
      return game._toCall();
    }
    if (G.next === 'kickoff') {
      if (RU.applyPending(G) && RU.periodEnd(G)) return;
      return game._kickoff(G.kickTeam);
    }
    // next scrimmage call
    if (G.clk - G.pend <= 0 && !G.untimed && !RU.userCanRescue(G)) {
      if (RU.applyPending(G) && RU.periodEnd(G)) return;
    }
    game._toCall();
  };

  /**
   * End of a period (4 quarters of G.qLen; OT 5+). Returns true if the flow was redirected (BREAK/FINAL);
   * false if play continues (Q1→Q2, Q3→Q4).
   */
  RU.periodEnd = function (G) {
    const game = G.api, T = G.T;
    G.em.emit('quarterEnd', { q: G.q, half: RU.half(G) });
    if (G.q === 2 || G.q >= 4) G.em.emit('halfEnd', { half: RU.half(G) });
    G.untimed = false;
    if (G.q === 1 || G.q === 3) {
      G.q++; G.clk = G.qLen; G.close = RU.isClose(G);
      return false;
    }
    if (G.q === 2) {
      G.q = 3; G.clk = G.qLen; G.dir0 = -G.dir0; G.tos[0] = T.TOS + (G.userIdx === 0 ? (G.sk.clockmaster ? 1 : 0) : 0);
      G.tos[1] = T.TOS + (G.userIdx === 1 ? (G.sk.clockmaster ? 1 : 0) : 0);
      G.hurry[0] = G.hurry[1] = false;
      G.em.emit('halftime', {});
      game._break((G.fast || G.idle) ? T.FAST.BREAK_HALF_T : T.BREAK_HALF_T, 'kickoff', 1 - G.firstKick);
      return true;
    }
    // Q4 or OT period end
    if (G.score[0] !== G.score[1]) { game._final(); return true; }
    if (G.q >= 5 && !(G.cfg.po > 0)) { game._final(); return true; }   // regular season: tie after one OT
    RU.startOT(G);
    return true;
  };

  RU.startOT = function (G) {
    const T = G.T, game = G.api;
    const first = G.q === 4;
    G.q = first ? 5 : G.q + 1;
    G.clk = G.qLen;
    G.tos[0] = G.tos[1] = T.TOS_OT;
    while (G.box.q[0].length < G.q) { G.box.q[0].push(0); G.box.q[1].push(0); }
    G.box.ot = true;
    if (first) {
      const recv = G.rng.chance(0.5) ? 0 : 1;
      G.dir0 = recv === 0 ? 1 : -1;
      G.ot.poss[0] = 0; G.ot.poss[1] = 0;
      G.em.emit('overtime', { q: G.q, half: 3, recvTid: G.tids[recv] });
      game._break((G.fast || G.idle) ? T.FAST.BREAK_HALF_T : T.BREAK_HALF_T, 'kickoff', 1 - recv);
    } else {
      G.em.emit('overtime', { q: G.q, half: 3 });
      game._break((G.fast || G.idle) ? T.FAST.BREAK_Q_T : T.BREAK_Q_T, 'call', -1);
    }
  };

  RU.isClose = function (G) { return G.q >= 4 && Math.abs(G.score[0] - G.score[1]) <= 8; };

  /** AI 4th-down decision (design 8.8). @returns {'go'|'punt'|'fg'} */
  RU.ai4th = function (G) {
    const k = PT.Engine.Kicking, kp = G.kicker(G.poss);
    const dist = RU.fgDist(G), maxR = kp ? k.maxRange(G, kp) : 0;
    const inRange = dist <= maxR;
    const diff = G.score[G.poss] - G.score[1 - G.poss];
    const left = RU.clockLeft(G);
    const toGoal = RU.toGoal(G);
    const ownY = 100 - toGoal;                       // yards from own goal
    const W = RU.warnT(G);
    if (G.q >= 4 && left <= W * 1.5 && diff < 0) {
      if (inRange && diff >= -3) return 'fg';
      return 'go';
    }
    if (RU.halfEndQ(G) && left <= 8 && inRange && (G.q === 2 || diff >= -3)) return 'fg';
    // two short halves: drives are precious, so the AI goes for it more (playtest pass 3)
    const pct = inRange && kp ? k.autoPct(G, kp, dist) : 0;
    if (G.togo <= 1 && ownY > 35) return 'go';
    if (G.togo <= 3 && toGoal < 62 && pct < 0.7) return 'go';
    if (G.togo <= 5 && toGoal < 45 && pct < 0.55) return 'go';
    if (inRange && dist <= maxR - 3 && pct >= 0.45) return 'fg';
    if (G.q >= 4 && left <= W * 2.5 && diff < -8 && toGoal < 60) return 'go';
    return 'punt';
  };

  /** AI 2-pt decision (design 8.7). @returns {'kick'|'two'} */
  RU.aiPAT = function (G, ti) {
    if (G.q < 4) return 'kick';
    const d = G.score[ti] - G.score[1 - ti];
    return [-2, -5, -10, -13, 1, 5, 12].indexOf(d) >= 0 ? 'two' : 'kick';
  };

  /** Penalty chance multiplier for one player (design 8.15). */
  RU.penMul = function (G, e) {
    const s = G.cfg.settings || {};
    let set = s.penalties;
    let m = set === false || set === 'off' ? 0 : set === 'fewer' ? 0.5 : (G.diff === 0 && e.tm === G.userIdx && set !== 'on' ? 0.5 : 1);
    if (!m) return 0;
    if (e.info && e.info.t.flag_magnet) m *= 3;
    m *= Math.max(0.5, 1.25 - e.r.smt * 0.005);
    m *= G.penMul[e.tm];
    if (e.tm === G.userIdx && G.sk.irondiscipline) m *= G.sk.irondiscipline >= 2 ? 0.5 : 0.7;
    return m;
  };

  /** Record a penalty in the box + event. */
  RU.flag = function (G, ti, kind, yds, txt, e) {
    PT.Box.team(G.box, G.tids[ti], 'pen');
    PT.Box.team(G.box, G.tids[ti], 'peny', yds);
    G.em.emit('penalty', { tid: G.tids[ti], kind: kind, yds: yds, txt: txt, pid: e ? e.pid : -1 });
    PT.Engine.Snapshot.fx(G, 'flag', e ? e.x : C.FIELD.MID_X, e ? e.y : G.los, 0, 1, G.tids[ti], txt);
  };

  /**
   * Apply a penalty yardage change to the LOS (half the distance to the goal rule).
   * ti = penalized team; yds > 0. fd = automatic first down (defensive fouls).
   */
  RU.enforce = function (G, ti, yds, fd, fromY) {
    const off = G.poss, dir = G.dir;
    let y = fromY == null ? G.los : fromY;
    if (ti === off) {
      const own = RU.ownGoalY(G, off);
      const room = (y - own) * dir;
      y -= Math.min(yds, room / 2) * dir;
      G.los = y;
      G.togo = Math.max(1, Math.round(Math.abs(G.fdY - G.los)));
    } else {
      const goal = RU.goalY(G, off);
      const room = (goal - y) * dir;
      y += Math.min(yds, room / 2) * dir;
      G.los = y;
      if (fd || (G.los - G.fdY) * dir >= -0.01) RU.firstDown(G);
      else G.togo = Math.max(1, Math.round(Math.abs(G.fdY - G.los)));
    }
  };

  // ====================================================================== Star players v2 + Star Surge (docs/ROUND6.md A)
  // Each team has up to 8 Star players (cfg team.stars = [pid…]; old {off, def} objects are migrated here).
  // Passive: a Star on the field gets +STAR_PASSIVE to his position's main skills (Entity.rate).
  // Surge: when a side's meter is full, EVERY Star of that side on the field uses his position ability (~2.5 s).
  const ST = PT.ns('Engine.Stars');
  ST.KIND = { WR1: 'magnet', WR2: 'magnet', TE: 'magnet', RB: 'turbo', QB: 'laser', OL1: 'pancake', OL2: 'pancake',
    DL1: 'bulldozer', DL2: 'bulldozer', LB1: 'bulldozer', LB2: 'bulldozer', CB1: 'lockdown', CB2: 'lockdown', S: 'lockdown' };
  ST.NAME = { magnet: 'Magnet Hands', turbo: 'Turbo', laser: 'Laser', bulldozer: 'Bulldozer', lockdown: 'Lockdown', pancake: 'Pancake' };
  const OFFP = { QB: 1, RB: 1, WR: 1, TE: 1, OL: 1 }, DEFP = { DL: 1, LB: 1, CB: 1, S: 1 };

  /** The 8 Star pids for team ti: cfg array, or a migrated {off, def} object, filled up by OVR with the 2/2 rule. */
  ST.pickStars = function (G, ti) {
    const gt = G.teams[ti], max = (C.STAR_MAX || 8);
    const pl = gt.pl.filter((p) => p.pos !== 'K');
    const byOvr = pl.slice().sort((a, b) => (b.ovr || 0) - (a.ovr || 0));
    const raw = gt.stars;
    let out = [];
    const add = (pid) => { if (pid != null && out.indexOf(pid) < 0 && out.length < max && pl.some((p) => p.pid === pid)) out.push(pid); };
    if (Array.isArray(raw)) raw.forEach(add);
    else if (raw && typeof raw === 'object') { add(raw.off); add(raw.def); }
    if (Array.isArray(raw) && raw.length) return out;           // the user's / GM's choice is final (fewer than 8 allowed)
    const side = (p, S) => !!S[p.pos];
    for (const S of [OFFP, DEFP]) {
      let n = out.filter((pid) => side(pl.find((p) => p.pid === pid), S)).length;
      for (let i = 0; i < byOvr.length && n < 2; i++) if (side(byOvr[i], S) && out.indexOf(byOvr[i].pid) < 0) { add(byOvr[i].pid); n++; }
    }
    for (let i = 0; i < byOvr.length && out.length < max; i++) add(byOvr[i].pid);
    return out;
  };

  ST.init = function (G) {
    G.meter = [{ off: 0, def: 0 }, { off: 0, def: 0 }];
    G.starPids = [ST.pickStars(G, 0), ST.pickStars(G, 1)];
    for (let ti = 0; ti < 2; ti++) for (const pid of G.starPids[ti]) { const inf = G.info[ti][pid]; if (inf) inf.star = true; }
    G.abUse = [0, 0];
    G.mGain = [[0, 0, 0, 0], [0, 0, 0, 0]];    // meter gain stats: [offSum, offPlays, defSum, defPlays]
  };
  ST.side = function (G, ti) { return ti === G.poss ? 'off' : 'def'; };

  /** After a scrimmage lineup: each team's Stars on the field (P.stars[ti]) and its lead Star (P.starEnt[ti]). */
  ST.lineup = function (G) {
    const P = G.P;
    P.starEnt = [-1, -1]; P.stars = [[], []]; P.ab = [null, null]; P.aiPlan = [null, null];
    for (let i = 0; i < 14; i++) G.ents[i].abK = '';
    if (P.kind !== 'scrim') return;
    for (let ti = 0; ti < 2; ti++) {
      let lead = -1, bo = -1;
      for (let k = 0; k < 7; k++) {
        const e = G.ents[ti * 7 + k];
        if (!e.info || !e.info.star || e.info.out || !ST.KIND[e.pos]) continue;
        P.stars[ti].push(e.id); e.abK = ST.KIND[e.pos];
        // lead Star (hot route / ring default): a skill player on offense, anyone on defense
        const skill = ST.side(G, ti) === 'def' || e.pos === 'WR1' || e.pos === 'WR2' || e.pos === 'TE' || e.pos === 'RB';
        const v = (skill ? 100 : 0) + e.info.ovr;
        if (v > bo) { bo = v; lead = e.id; }
      }
      P.starEnt[ti] = lead;
    }
  };

  ST.fillMul = function (G, ti) {
    const T = G.T;
    if (G.userIdx < 0) return 1;
    return ti === G.userIdx ? T.METER_USER[G.diff] : T.METER_AI[G.diff];
  };

  /** Can team ti fire its Surge right now? */
  ST.canUse = function (G, ti) {
    const P = G.P;
    if (!P || P.kind !== 'scrim' || !P.stars || !P.stars[ti].length || P.ab[ti]) return false;
    const side = ST.side(G, ti);
    if (G.meter[ti][side] < 100) return false;
    if (G.phase === 'PRESNAP') return side === 'off';          // the offense can arm it pre-snap
    return G.phase === 'LIVE' && !P.windEnd;
  };

  function strength(G, e, perfect) {
    const ovr = e.info.ovr || 70;
    return (0.9 + PT.Util.clamp((ovr - 60) / 200, -0.1, 0.2)) * (perfect ? G.T.AB_PERFECT : 1);
  }

  /** Fire the Surge (armed = pressed pre-snap: each Star's ability starts at its own trigger after the snap). */
  ST.activate = function (G, ti, perfect, armed) {
    const P = G.P, T = G.T, side = ST.side(G, ti);
    G.meter[ti][side] = 0;
    G.abUse[ti]++;
    if (ti === G.userIdx && G.ustats) G.ustats.abilities = (G.ustats.abilities || 0) + 1;
    const mem = P.stars[ti].map((id) => {
      const e = G.ents[id], k = ST.KIND[e.pos];
      return { idx: id, k: k, s: strength(G, e, perfect), dur: T.AB_DUR[k] || 2.5, t: 0, on: false, done: false, armed: true, top0: 0, acc0: 0 };
    });
    const lead = P.starEnt[ti] >= 0 ? P.starEnt[ti] : (mem.length ? mem[0].idx : -1);
    const ab = P.ab[ti] = { k: lead >= 0 ? ST.KIND[G.ents[lead].pos] : '', idx: lead, side: side, t: 0, dur: 2.5, perfect: !!perfect,
      s: lead >= 0 ? strength(G, G.ents[lead], perfect) : 1, armed: !!armed, on: false, tm: ti, mem: mem, started: false, fired: 0 };
    const names = [];
    for (const m of mem) { const n = ST.NAME[m.k]; if (names.indexOf(n) < 0) names.push(n); }
    ab.names = names;
    if (armed) {
      G.em.emit('abilityArmed', { tid: G.tids[ti], pid: lead >= 0 ? G.ents[lead].pid : -1, name: names.join(' + '), names: names, count: mem.length });
      return ab;
    }
    for (const m of mem) startMember(G, ab, m);
    announce(G, ab);
    return ab;
  };

  function announce(G, ab) {
    if (ab.started) return;
    ab.started = true;
    const lead = ab.idx >= 0 ? G.ents[ab.idx] : null;
    const name = ab.names.join(' + ');
    G.em.emit('ability', { tid: G.tids[ab.tm], pid: lead ? lead.pid : -1, name: name, names: ab.names, count: ab.mem.length, perfect: ab.perfect, k: ab.k, side: ab.side });
    if (lead) PT.Engine.Snapshot.fx(G, 'ability', lead.x, lead.y, 2.6, ab.perfect ? 2 : 1, G.tids[ab.tm], (ab.perfect ? 'PERFECT ' : '') + 'STAR SURGE!', ab.names[0] || '');
    if (ab.tm === G.userIdx) G.snap.cam.shake = Math.max(G.snap.cam.shake, 0.15);
  }

  /** One Star's ability begins. */
  function startMember(G, ab, m) {
    const P = G.P, T = G.T, e = G.ents[m.idx], R = PT.Engine.Entity.R;
    m.armed = false; m.on = true; m.t = m.dur; ab.on = true; ab.armed = false; ab.fired++;
    m.top0 = e.top; m.acc0 = e.acc;
    if (m.k === 'turbo') { e.top *= 1 + T.AB_TURBO_SPD * m.s; e.acc *= 1 + T.AB_TURBO_ACC * m.s; e.turboBrk = true; }
    else if (m.k === 'bulldozer') {
      if (e.eng >= 0) PT.Engine.Contact.release(G, e, true);
      e.downT = 0; e.top *= 1 + T.AB_DOZER_SPD * m.s;
      const b = G.ball;
      e.role = (b.st === 'held' && b.car === P.qb && !P.run && !P.crossed) ? R.RUSH : R.PURSUE;
      e.readDone = true; e.thinkT = 0;
    } else if (m.k === 'lockdown') {
      if (e.role !== R.MAN || e.tgt < 0) {
        let best = -1, bd = 1e9;
        for (let k = 1; k <= 4; k++) { const r = G.ents[P.off * 7 + k]; const d = Math.hypot(r.x - e.x, r.y - e.y); if (d < bd) { bd = d; best = r.id; } }
        if (best >= 0 && !(G.ball.st === 'held' && G.ents[G.ball.car].tm === P.off && G.ball.car !== P.qb)) { e.role = R.MAN; e.tgt = best; e.ptx = 0; e.pty = 0; }
      }
      e.trail = T.TRAIL_MIN * 0.25;
    }
    // pancake: handled in Contact.blocks (the block is won and held while it is on)
  }

  function stopMember(G, m) {
    const e = G.ents[m.idx];
    if (!m.on) return;
    m.on = false; m.done = true;
    if (m.k === 'turbo' || m.k === 'bulldozer') { e.top = m.top0; e.acc = m.acc0; }
    e.turboBrk = false;
  }

  function member(G, e) {
    const P = G.P;
    if (!P || !P.ab) return null;
    const ab = P.ab[e.tm];
    if (!ab || !ab.mem) return null;
    for (let i = 0; i < ab.mem.length; i++) if (ab.mem[i].idx === e.id) return ab.mem[i];
    return null;
  }
  /** Strength (0 = not active) of ability k on ent e. */
  ST.active = function (G, e, k) {
    const m = member(G, e);
    return m && m.on && m.k === k ? m.s : 0;
  };
  /** Laser on the offense right now? (defenders react later) */
  ST.offLaser = function (G) {
    const P = G.P; if (!P || !P.ab) return 0;
    const ab = P.ab[P.off];
    if (!ab || !ab.mem) return 0;
    for (const m of ab.mem) if (m.on && m.k === 'laser') return m.s;
    return 0;
  };
  /** Snapshot flag helper: is ent e's ability armed or active (part of a fired Surge)? */
  ST.surging = function (G, e) { const m = member(G, e); return !!(m && !m.done); };

  /** At the snap: AI sides decide whether they WILL Surge this play (red warning on all their Stars from the snap). */
  ST.snap = function (G) {
    const P = G.P, T = G.T, rng = G.rng;
    if (P.kind !== 'scrim') return;
    for (let ti = 0; ti < 2; ti++) {
      if (ti === G.userIdx || !P.stars[ti].length) continue;
      const side = ST.side(G, ti);
      if (G.meter[ti][side] < 100) continue;
      let will = side === 'def';
      if (!will) {
        const pass = P.play.k !== 'run', read = P.play.read || [];
        for (const id of P.stars[ti]) {
          const e = G.ents[id], k = ST.KIND[e.pos];
          if (k === 'magnet' && pass && read.slice(0, 3).indexOf(e.pos) >= 0) will = true;
          else if (k === 'turbo' && (P.play.k === 'run' || read.indexOf('RB') >= 0)) will = true;
          else if (k === 'laser' && pass) will = true;
          else if (k === 'pancake') will = true;
        }
      }
      if (!will || !rng.chance(T.AB_AI_USE)) continue;
      P.aiPlan[ti] = { at: T.AB_WARN_T + (side === 'def' ? rng.range(0, 0.6) : 0) };
      const lead = G.ents[P.starEnt[ti] >= 0 ? P.starEnt[ti] : P.stars[ti][0]];
      G.em.emit('abilityWarn', { tid: G.tids[ti], pid: lead.pid, name: 'Star Surge', count: P.stars[ti].length });
      PT.Engine.Snapshot.fx(G, 'abilityWarn', lead.x, lead.y, 2.6, 1, G.tids[ti], '', 'Star Surge');
    }
  };

  function trigger(G, m) {
    const P = G.P, b = G.ball;
    if (m.k === 'magnet') return (P.thrown && P.tgt === m.idx) || (b.st === 'held' && b.car === m.idx);
    if (m.k === 'turbo') return b.st === 'held' && b.car === m.idx;
    if (m.k === 'laser') return (P.qbMode === 'pass' && b.st === 'held' && b.car === m.idx) || P.windT > 0;
    return true;                                       // pancake / bulldozer / lockdown start at once
  }

  /** Per LIVE tick: armed triggers, AI Surges, timers. */
  ST.update = function (G, dt) {
    const P = G.P;
    if (!P || P.kind !== 'scrim' || !P.ab) return;
    for (let ti = 0; ti < 2; ti++) {
      const ab = P.ab[ti];
      if (ab) {
        for (const m of ab.mem) {
          if (m.armed && !m.done && trigger(G, m)) { startMember(G, ab, m); announce(G, ab); }
          else if (m.on) { m.t -= dt; if (m.t <= 0) stopMember(G, m); }
        }
        ab.on = ab.mem.some((m) => m.on);
        if (ab.on) { let t = 0; for (const m of ab.mem) if (m.on && m.t > t) t = m.t; ab.t = t; }
      } else if (P.aiPlan[ti]) {
        if (P.t < P.aiPlan[ti].at) continue;
        const side = ST.side(G, ti);
        if (G.meter[ti][side] >= 100) ST.activate(G, ti, false, side === 'off');
        P.aiPlan[ti] = null;
      }
    }
  };

  /** Meter fill at the whistle (STAR_ABILITIES 2). info = {firstDown, td, turnover, sack, pd, tfl, starCatch} */
  ST.playEnd = function (G, info) {
    const P = G.P, T = G.T;
    if (P.kind !== 'scrim' || !P.ab) return;
    const off = P.off, def = 1 - off;
    for (let ti = 0; ti < 2; ti++) {
      const ab = P.ab[ti];
      if (!ab) continue;
      if (!ab.fired) { G.meter[ti][ab.side] = 100; G.abUse[ti]--; if (ti === G.userIdx && G.ustats) G.ustats.abilities--; P.ab[ti] = null; continue; }   // never triggered: refund
      for (const m of ab.mem) stopMember(G, m);
      ab.on = false;
    }
    const add = (ti, side, n) => {
      const g = n * ST.fillMul(G, ti) * T.METER_SCALE;
      const st = G.mGain[ti]; st[side === 'off' ? 0 : 2] += g; st[side === 'off' ? 1 : 3]++;
      if (P.ab[ti]) return;                     // no refill on the play the Surge was used
      const m = G.meter[ti];
      m[side] = Math.min(100, m[side] + g);
    };
    let o = T.METER_PLAY, d = T.METER_PLAY;
    if (info.firstDown || info.starCatch) o += T.METER_GOOD;
    if (info.td) o += T.METER_BIG;
    if (info.sack || info.pd || info.tfl) d += T.METER_GOOD;
    if (info.turnover) d += T.METER_BIG;
    add(off, 'off', o); add(def, 'def', d);
  };
})(globalThis.PT = globalThis.PT || {});
