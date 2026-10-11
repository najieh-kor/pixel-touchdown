/* Pixel Touchdown: js/engine/game.js
 * Owner: WP3. Responsibility: PT.Engine.createGame(): Game object, step(), public API, events.
 * Phases: 'CALL' | 'PRESNAP' | 'LIVE' | 'DEAD' | 'KICK' | 'PAT' | 'BREAK' | 'FINAL' (ARCHITECTURE 3.5 + RECONCILE R9–R11).
 * Headless, deterministic (PT.RNG from cfg.seed), fixed tick (PT.C.DT). See docs/handoff/WP3.md for the full contract.
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const C = PT.C;
  const Eng = PT.ns('Engine');
  const MID = C.FIELD.MID_X;
  const isFinite = globalThis.isFinite;

  /** @returns {Action} a fresh blank Action */
  function blankAction() {
    return { mx: 0, my: 0, sprint: false, aim: { on: false, tx: 0, ty: 0, pow: 0 }, throw: false, lob: false, pass: null,
      snap: false, juke: false, dive: false, spin: false, star: false, starPick: null,
      kickAim: { on: false, dx: 0, dy: 0, pow: 0 }, kick: false, ability: false };
  }
  Eng.blankAction = blankAction;

  function normSkills(sk) {
    const out = {};
    if (!sk) return out;
    for (const k of Object.keys(sk)) {
      const n = PT.Engine.Entity.normKey(k);
      const v = typeof sk[k] === 'number' ? sk[k] : sk[k] ? 1 : 0;
      ['qbwhisperer', 'clockmaster', 'twominutedrill', 'playdesigner', 'irondiscipline', 'redzonewizard', 'goallinestand',
        'kickguru', 'starpower', 'filmroom'].forEach((id) => { if (n.indexOf(id.slice(0, 7)) === 0) out[id] = v; });
    }
    return out;
  }
  /** WP2 PT.League.Coach.mods(L) shape → skill ranks (cfg.coachMods). */
  function modsToSkills(m, out) {
    if (!m) return out;
    if (m.qbAim) out.qbwhisperer = m.qbAim >= 4 ? 2 : 1;
    if (m.timeouts) out.clockmaster = Math.max(out.clockmaster || 0, m.hurryRunoff === 12 ? 2 : 1);
    if (m.hurryRunoff === 10) out.twominutedrill = Math.max(out.twominutedrill || 0, 1);
    if (m.lateEdge) out.twominutedrill = 2;
    if (m.cards >= 4) out.playdesigner = Math.max(out.playdesigner || 0, 1);
    if (m.sigBonus >= 0.5) out.playdesigner = 2;
    if (m.penMult && m.penMult < 1) out.irondiscipline = m.penMult <= 0.5 ? 2 : 1;
    if (m.redZoneEdge) out.redzonewizard = m.redZoneEdge >= 1 ? 2 : 1;
    if (m.goalLineEdge) out.goallinestand = m.goalLineEdge >= 1 ? 2 : 1;
    if (m.kickSigma && m.kickSigma < 1) out.kickguru = m.kickSigma <= 0.8 ? 2 : 1;
    if (m.starWindow) out.starpower = m.starWindow >= 0.1 ? 2 : 1;
    if (m.filmRoom) out.filmroom = m.pCounterAdj ? 2 : 1;
    return out;
  }

  function twistFlags(tw) {
    const n = PT.Engine.Entity.normKey(tw || '');
    const f = {};
    [['butter', 'butterfinger'], ['kicker', 'kickerchaos'], ['groundwar', 'groundwar'], ['airshow', 'airshow'], ['injury', 'injurybug'],
      ['ironyear', 'ironyear'], ['speed', 'speedy'], ['twopoint', 'twopoint']].forEach((p) => { if (n.indexOf(p[0]) >= 0) f[p[1]] = true; });
    return f;
  }

  function hasInput(a) {
    return !!(a.snap || a.throw || a.juke || a.dive || a.spin || a.kick || a.ability || a.pass != null || (a.aim && a.aim.on) ||
      (a.kickAim && a.kickAim.on) || Math.abs(a.mx) + Math.abs(a.my) > 0.15);
  }

  /**
   * Create a game. @param {GameConfig} cfg @param {{debug?:boolean, fast?:boolean}} [opts]
   * @returns {Object} game API (ARCHITECTURE 3.5)
   */
  Eng.createGame = function (cfg, opts) {
    opts = opts || {};
    const E = PT.Engine, T = E.T, RU = E.Rules, F = E.Formation, R = E.Entity.R;
    const em = PT.Events.Emitter('engine');
    const userIdx = cfg.userTid === cfg.home.tid ? 0 : cfg.userTid === cfg.away.tid ? 1 : -1;
    const G = {
      cfg: cfg, T: T, rng: PT.RNG.create(cfg.seed >>> 0), em: em, opts: opts, debug: !!opts.debug,
      teams: [cfg.home, cfg.away], tids: [cfg.home.tid, cfg.away.tid], userIdx: userIdx, diff: cfg.diff || 0,
      fast: opts.fast != null ? !!opts.fast : userIdx < 0, idle: userIdx >= 0 && opts.idle !== false, qLen: cfg.qLen || T.QLEN,
      twist: twistFlags(cfg.twist), sk: modsToSkills(cfg.coachMods, normSkills(cfg.coachSk)), unlock: null, coachLvl: cfg.coachLvl != null ? cfg.coachLvl : null,
      box: PT.Box.create({ gid: cfg.gid, s: cfg.season, wk: cfg.week, po: cfg.po, h: cfg.home.tid, a: cfg.away.tid, sim: false }),
      ents: [], ball: null, snap: null, P: null, phase: 'BREAK', pt: 0, tick: 0, over: false,
      q: 1, clk: 0, pend: 0, pendTeam: 0, score: [0, 0], poss: 0, dir: 1, dir0: 1, los: 35, down: 1, togo: 10, fdY: 45,
      tos: [T.TOS, T.TOS], firstKick: 0, kickTeam: 0, patTeam: 0, safetyTeam: 0, next: 'call', deadT: 1, breakT: 0, breakNext: '', breakKick: 0,
      hist: [[], []], histP: [[], []], dhist: [[], []], typeCount: [{}, {}], offPlays: [0, 0], teamPlays: [0, 0],
      hurry: [false, false], aiHurry: [false, false], flipNext: false, autoDef: !!(cfg.settings && cfg.settings.autoDef),
      ctl: -1, apTick: -9, kickReq: false, kickAimSaved: 0, kickPowSaved: 0, selO: null, selD: null, fourthDone: false, kickWait: null, tryTwo: false, patChosen: false, waitSnap: false,
      canOnside: false, onsideReq: false, deepReq: false, rescue: false, untimed: false, untimedNext: false, close: false, playNo: 0, driveStart: 0,
      ot: { poss: [0, 0], had: [false, false], done: [false, false] }, star: { idx: -1, ring: 'none', t: 0, win: 0.4, left: 0, superJump: false, whiffD: false },
      dec: { act: 'none', tx: 0, ty: 0, lob: false, mx: 0, my: 0, tgt: -1 }, tmpFl: { t: 0, apex: 0, d: 0 },
      sitCache: { tos: [0, 0] }, res: { k: '', team: 0, y: 0, oob: false, good: false }, apAct: blankAction(), lastAct: blankAction(),
      ustats: { jukes: 0, spins: 0, brokenTackles: 0, starPlays: 0, starWhiffs: 0, longTD: 0, sacks: 0, ints: 0, bigPlays: 0 },
      tk: { att: 0, brk: 0, whf: 0, esc: 0, sack: 0, dive: 0, diveMiss: 0 },   // tackle stats (calibrate)
      spiritFast: [false, false], hot: false, lastOob: false, starters: [{}, {}], ballSpotY: 0, api: null, drill: null
    };
    const unl = cfg.unlocked || (userIdx >= 0 ? G.teams[userIdx].unlocked : null);
    if (unl && unl.length) { G.unlock = {}; unl.forEach((id) => { G.unlock[id] = true; }); }
    const wx = cfg.weather || { k: 'sunny' };
    G.hot = wx.k === 'sunny' && cfg.home.clim === 'warm' && (cfg.week || 1) <= 6;
    if (G.sk.clockmaster && userIdx >= 0) G.tos[userIdx] += 1;
    E.Entity.buildInfos(G);
    E.Stars.init(G);
    for (let ti = 0; ti < 2; ti++) {
      G.spiritFast[ti] = G.teams[ti].spirit != null && G.teams[ti].spirit >= 75;
      const dc = G.teams[ti].dc;
      for (const s of C.SLOTS) if (s !== 'KR' && dc[s] && dc[s][0] != null) G.starters[ti][dc[s][0]] = true;
    }
    for (let i = 0; i < 14; i++) G.ents.push(E.Entity.create(i, i < 7 ? 0 : 1));
    G.ball = E.Ball.create();
    G.snap = E.Snapshot.create(G);
    G.snap.hud.wx = wx.k; G.snap.hud.mph = wx.mph || 0;
    G.box.wx = wx.k;
    G.clk = G.qLen;

    // ---------------------------------------------------------------- helpers on G
    G.dirOf = (ti) => RU.dirOf(G, ti);
    G.kicker = (ti) => {
      const dc = G.teams[ti].dc.K || [];
      for (let i = 0; i < dc.length; i++) { const inf = G.info[ti][dc[i]]; if (inf && !inf.out) return inf; }
      const any = G.teams[ti].pl.find((p) => p.pos === 'K' && !G.info[ti][p.pid].out) || G.teams[ti].pl[0];
      return G.info[ti][any.pid];
    };
    G.userSide = () => (userIdx < 0 ? null : (G.poss === userIdx ? 'O' : 'D'));
    /** a real person is playing the user side (not idle demo mode, not the debug Autopilot) — human-only helpers apply */
    G.human = () => userIdx >= 0 && !G.idle && G.apTick < G.tick - 1;
    /** the user controls this team's returner (kick/punt/interception/fumble returns) unless settings.autoReturn */
    G.userRet = (ti) => ti === userIdx && !(cfg.settings && cfg.settings.autoReturn);
    G.setCtl = (i) => {
      if (G.ctl >= 0) G.ents[G.ctl].ctl = false;
      if (i >= 0 && G.ents[i].tm !== userIdx) i = -1;
      G.ctl = i;
      if (i >= 0) G.ents[i].ctl = true;
    };
    G.whistle = (k, team, y, oob, good) => whistle(k, team, y, oob, good);

    function newPlay(kind, off) {
      G.playNo++;
      return {
        kind: kind, off: off, def: 1 - off, dir: RU.dirOf(G, off), los0: G.los, down0: G.down, togo0: G.togo, fdY0: G.fdY,
        play: null, call: null, flip: 1, edge: 0, t: 0, st: 0, stage: '',
        qb: -1, thrown: false, windT: 0, windSafe: true, thTx: 0, thTy: 0, thLob: false, thEasy: false, relT: 0, breakT: 0, tgt: -1, compl: false,
        catcher: -1, picked: false, pickBy: -1, defHad: false, turnY: null, batted: false, batPick: -1, lob: false, sig: 0, passDist: 0, undercut: 0, roughT: 0,
        run: false, runT: 0, crossed: false, handDone: false, handT: 0, faked: false, fakeT: 0, meshDone: false, giveNow: false,
        tossBack: false, qbBack: false, qbMode: '', readStart: 0, waitHandEnt: -1, sneakY: 0, sneakDive: false,
        rusher: -1, sack: false, sackBy: -1, tkBy: -1, pdBy: -1, fumBy: -1, ffBy: -1, frBy: -1, carrierEnd: -1, offEndY: null,
        ret: -1, retY0: null, retEndY: null, tbOk: false, fairCatch: false, kickerEnt: -1, kickDist: null, fgDist: 0, fgGood: false,
        manual: null, koTB: false, puntTB: false, onside: false, onsideOk: false, blocked: false, kicked: false, fgLined: false,
        pen: null, retCall: '', retMoved: false, fumRet: false, exch: false, readEnt: -1, readCommit: 'rb', dived: -1, slide: false, motionT: 0, motionDone: false, jogDone: false, edgeShown: false,
        result: '', desc: '', yds: 0, td: false, endY: 0, incDesc: ''
      };
    }

    function resetStar() { const s = G.star; s.idx = -1; s.ring = 'none'; s.t = 0; s.left = 0; s.superJump = false; s.whiffD = false; }

    // ---------------------------------------------------------------- flow transitions (G.api._*)
    function toCall() {
      G.phase = 'CALL'; G.pt = 0; G.selO = null; G.selD = null; G.fourthDone = false; G.kickWait = null; G.waitSnap = false;
      G.setCtl(-1); resetStar();
      G.close = RU.isClose(G);
      G.P = newPlay('none', G.poss);
      G.snap.aim.on = false; G.snap.kick.on = false;
      E.Snapshot.setRoutes(G, false);
      for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.vx = e.vy = e.dvx = e.dvy = 0; e.spd = 0; e.downT = 0; e.diveT = 0; e.z = 0; if (e.an !== 'celebrate') e.an = 'idle'; e.ball = false; e.eng = -1; e.eng2 = -1; e.dside = false; }
      E.Ball.spot(G, MID, G.los);
      // AI hurry-up
      for (let ti = 0; ti < 2; ti++) {
        const diff = G.score[ti] - G.score[1 - ti], left = RU.clockLeft(G), W = RU.warnT(G);
        G.aiHurry[ti] = ti !== userIdx && ((G.q >= 4 && left <= W * 1.5 && diff < 0) || (G.q === 2 && left <= W));
      }
      if (G.poss !== userIdx) aiOffenseDecide();
    }

    function aiOffenseDecide() {
      const s = RU.situation(G, {}), left = RU.clockLeft(G);
      const lead = G.score[G.poss] - G.score[1 - G.poss];
      if (!G.tryTwo) {
        // victory formation
        const oppTo = G.tos[1 - G.poss];
        // never kneel inside the own 3 (a safety) — HUNT3 #4
        if (lead > 0 && G.q >= 4 && left <= 40 * (5 - G.down) - 34 * oppTo && left > 0 && s.toGoal < 97) { G.selO = PT.Data.Playbook.byId('kneel'); }
        else if (G.q === 2 && left <= RU.warnT(G) / 2 && s.toGoal > 65 && s.toGoal < 97 && lead >= 0) G.selO = PT.Data.Playbook.byId('kneel');
        else if (G.down < 4 && RU.lateFG(G)) return startFG('fg', null);   // end-of-half FG on an early down
        else if (G.down === 4) {
          const d = RU.ai4th(G);
          if (d === 'punt') return startPunt();
          if (d === 'fg') return startFG('fg', null);
        }
        if (!G.selO && RU.halfEndQ(G) && left <= 25 && G.pend >= 20 && G.down < 4 && G.tos[G.poss] === 0 && (G.q === 2 || lead < 0)) {
          G.selO = PT.Data.Playbook.byId('spike');
        }
      }
      if (!G.selO) G.selO = E.PlayCall.aiOffense(G);
      if (userIdx < 0 || G.autoDef) { G.selD = E.PlayCall.aiDefense(G, userIdx >= 0); lineup(); }
    }

    function lineup(keepFlip) {
      const play = G.selO;
      let call = G.selD || PT.Data.Defense.byId('umbrella');
      // formation check (coverage pass): an AI defense in a thin zone vs bunch / empty checks to man coverage
      const DD = PT.Data.Defense, dTeam = 1 - G.poss;
      const thin = (DD.has(call, 'zone') && !DD.has(call, 'blitz') && !DD.has(call, 'prevent')) || (play.form === 'empty' && DD.has(call, 'run'));
      if (!keepFlip && (dTeam !== userIdx || G.autoDef) && T.FORM_CHECK[play.form] && thin && G.rng.chance(T.FORM_CHECK[play.form])) {
        const opts = ['lockdown', 'sneaky_owl', 'robber', 'dime'];
        call = DD.byId(opts[G.rng.int(0, opts.length - 1)]); G.selD = call;
      }
      const kind = play.qb && play.qb.kneel ? 'kneel' : play.qb && play.qb.spike ? 'spike' : G.tryTwo ? 'two' : 'scrim';
      G.P = newPlay(kind, G.poss);
      const P = G.P;
      P.play = play; P.call = call;
      if (G.poss === userIdx) { P.flip = G.flipNext ? -1 : 1; }
      else P.flip = G.rng.chance(0.5) ? -1 : 1;
      if (play.sneak || play.k === 'special') P.flip = 1;
      if (keepFlip) P.flip = keepFlip;
      P.edge = kind === 'scrim' || kind === 'two' ? E.PlayCall.edge(G, play, call) : 0;
      F.scrimmage(G);
      E.Stars.lineup(G);
      G.phase = 'PRESNAP'; G.pt = 0; G.waitSnap = false;
      E.Snapshot.setRoutes(G, G.poss === userIdx);
      // Star defender (design 8.18)
      if (userIdx >= 0 && G.poss !== userIdx) pickStar();
      P.aud = { O: false, D: false };
      if (userIdx >= 0 && P.kind === 'scrim') aiAudiblePlan();
    }

    /** AI audibles on Pro/Legend vs an obvious look (STAR_ABILITIES 7). Scheduled ~0.5 s after the line-up. */
    function aiAudiblePlan() {
      const P = G.P, pr = T.AI_AUDIBLE[G.diff];
      if (!pr || !G.rng.chance(pr)) return;
      const PC = E.PlayCall;
      if (G.poss === userIdx) {
        const cards = PC.audibleOptions(G, 'D');
        if (cards.length && PC.lookScore(G, P.call.id) <= T.AI_AUDIBLE_BAD) P.aiAud = { side: 'D', id: cards[0].id, at: T.LINEUP_T + 0.5 };
      } else if (PC.matrix(P.call.id, P.play.type, G.togo) >= 2) {
        const cards = PC.audibleOptions(G, 'O').filter((c) => c.id !== 'hot_star');
        let best = null, bv = 99;
        for (const c of cards) { const p = PT.Data.Playbook.byId(c.id); const v = PC.matrix(P.call.id, p.type, G.togo); if (v < bv) { bv = v; best = c; } }
        if (best && bv < 1) P.aiAud = { side: 'O', id: best.id, at: T.LINEUP_T + 0.5 };
      }
    }

    /** Change the call after lining up (once per side per play); keeps the clock and an armed ability. */
    function doAudible(side, id, isAI) {
      const P = G.P;
      if (G.phase !== 'PRESNAP' || !P.aud || P.aud[side] || P.motionT > 0 || P.kind !== 'scrim') return false;
      const offTeam = G.poss, ti = side === 'O' ? offTeam : 1 - offTeam;
      let hot = false;
      if (side === 'O') {
        if (id === 'hot_star') { if (!P.starEnt || P.starEnt[offTeam] < 0) return false; hot = true; }
        else { const p = PT.Data.Playbook.byId(id); if (!p || p.clock) return false; G.selO = p; }
      } else { const c = PT.Data.Defense.byId(id); if (!c) return false; G.selD = c; }
      const aud = P.aud, keepAb = P.ab, keepHot = P.hotStar, keepFlip = P.flip, starIdx = G.star.idx;
      if (hot) { P.hotStar = true; P.aud[side] = true; E.Snapshot.setRoutes(G, offTeam === userIdx); }
      else {
        const no = G.playNo, goReq = !!P.goReq;
        lineup(side === 'D' ? keepFlip : 0);
        const N = G.P;
        // an audible re-lines up the SAME snap: keep the play number (Session / suggestions / tests key on it) and a
        // HIKE/GO the user already pressed
        G.playNo = no; N.goReq = goReq;
        N.aud = aud; N.aud[side] = true; N.hotStar = keepHot && side === 'D';
        // an armed Surge survives the audible (members re-read from the new lineup)
        if (keepAb) for (let t = 0; t < 2; t++) {
          const ab = keepAb[t];
          if (!ab || !ab.armed || !N.stars[t].length) continue;
          ab.mem = N.stars[t].map((id) => { const old = ab.mem.find((m) => m.idx === id); return old || { idx: id, k: E.Stars.KIND[G.ents[id].pos], s: ab.s, dur: T.AB_DUR[E.Stars.KIND[G.ents[id].pos]] || 2.5, t: 0, on: false, done: false, armed: true, top0: 0, acc0: 0 }; });
          N.ab[t] = ab;
        }
        if (starIdx >= 0 && userIdx >= 0 && G.poss !== userIdx) setStar(starIdx - (1 - G.poss) * 7);
        N.aiAud = null;
      }
      G.em.emit('audible', { tid: G.tids[ti], side: side, id: id, name: hot ? 'Star Hot Route' : (side === 'O' ? G.selO.name : G.selD.name), ai: !!isAI });
      E.Snapshot.fx(G, 'text', MID, G.los + (side === 'O' ? -4 : 4) * G.dir, 3, 1, G.tids[ti], 'AUDIBLE!');
      return true;
    }

    function pickStar() {
      const d = 1 - G.poss, call = G.P.call;
      let best = G.P.starEnt ? G.P.starEnt[d] : -1, bv = best >= 0 ? 1e9 : -1;
      for (let k = 0; k < 7 && bv < 1e9; k++) {
        const slot = C.DEF_SLOTS[k], a = call.as[slot] || {}, e = G.ents[d * 7 + k];
        let ok;
        if (call.grp === 'rush') ok = a.k === 'rush';
        else if (call.grp === 'run') ok = slot === 'LB1' || slot === 'LB2';
        else ok = slot === 'CB1' || slot === 'CB2' || slot === 'S';
        if (!ok) continue;
        const v = call.grp === 'rush' ? e.rush : e.info.ovr;
        if (v > bv) { bv = v; best = d * 7 + k; }
      }
      if (best < 0) best = d * 7 + 4;
      if (G.drill && G.drill.star != null) {                                // practice: a fixed Star defender (per call)
        const ds = G.drill.star, k = typeof ds === 'number' ? ds : ds[call.id] != null ? ds[call.id] : ds['*'];
        if (k >= 0 && k <= 6) best = d * 7 + (k | 0);
      }
      for (let k = 0; k < 7; k++) { const e = G.ents[d * 7 + k]; if (e.id !== best && e.hi === 2) e.hi = 0; }
      const s = G.star;
      s.idx = best; s.ring = 'wait'; s.t = 0;
      s.win = T.STAR_WIN[G.diff] + 0.05 * (G.sk.starpower || 0);
      G.ents[best].hi = 2;
    }

    function setStar(k) {
      if (G.star.idx < 0 || k == null || k < 0 || k > 6) return;
      G.ents[G.star.idx].hi = 0;
      G.star.idx = (1 - G.poss) * 7 + k;
      G.ents[G.star.idx].hi = 2;
      const P = G.P;
      void P;   // Stars v2: picking the Star Play defender does not change who the Star players are
    }

    function assignRoles() {
      const P = G.P, o = G.poss, d = 1 - o, play = P.play, call = P.call;
      const flipMap = P.flip < 0 ? { DL1: 'DL2', DL2: 'DL1', LB1: 'LB2', LB2: 'LB1' } : null;
      const isRun = play.k === 'run';
      for (let k = 0; k < 7; k++) {
        const e = G.ents[o * 7 + k], slot = C.OFF_SLOTS[k], a = play.as[slot];
        e.asg = typeof a === 'object' ? a : null; e.tgt = -1; e.thinkT = 0; e.pushX = 0; e.pushY = 0; e.wpn = 0;
        e.goBallT = 1e9;
        if (slot === 'QB') { e.role = R.QB; continue; }
        if (a === 'pb') e.role = R.PBLK;
        else if (a === 'block') e.role = R.BLOCK;
        else if (!a) { e.role = isRun ? R.RBLK : R.BLOCK; e.tsel = 'near'; }
        else if (a.rt) { e.role = R.ROUTE; E.Routes.load(G, e, a.rt, a.wait, a.end); e.blkT = typeof a.blk === 'number' ? a.blk : 0; }
        else if (a.lane) { e.role = R.LANE; E.Routes.load(G, e, a.lane, null, a.end); if (a.waitHand) P.waitHandEnt = e.id; }
        else if (a.fake) { e.role = R.FAKE; E.Routes.load(G, e, a.fake, null, 'BLOCK'); }
        else if (a.pull) { e.role = R.RBLK; E.Routes.load(G, e, a.pull, null, ''); e.tsel = a.blk || 'near'; }
        else if (a.pb != null) { e.role = R.PBLK; }
        else if (a.pset != null) { e.role = R.PSET; }
        else if (a.sell != null) { e.role = R.SELL; e.tsel = 'near'; }
        else if (a.blk != null) { e.role = R.RBLK; e.tsel = typeof a.blk === 'string' ? a.blk : 'near'; }
        else e.role = R.BLOCK;
        if (flipMap && flipMap[e.tsel]) e.tsel = flipMap[e.tsel];
        if (e.asg && e.asg.pre) { e.pre = true; e.preX = F.fx(G, e.asg.pre[0]); e.preY = F.fy(G, e.asg.pre[1]); }
        if (e.asg && e.asg.push) {
          const p = e.asg.push;
          let sx = 0;
          if (p === 'out') sx = e.x > MID ? 1 : -1;
          else if (p === 'in') sx = e.x > MID ? -1 : 1;
          else if (p === 'left') sx = -G.dir * P.flip;
          else if (p === 'right') sx = G.dir * P.flip;
          e.pushX = sx; e.pushY = 0.25 * G.dir;
        }
      }
      const D = PT.Data.Defense;
      for (let k = 0; k < 7; k++) {
        const e = G.ents[d * 7 + k], slot = C.DEF_SLOTS[k], a = call.as[slot] || { k: 'rush' };
        e.asg = a; e.tgt = -1; e.thinkT = 0; e.ptx = 0; e.pty = 0; e.rt0 = 0; e.ar = 0; e.ar2 = 0; e.deep = false; e.readDone = false;
        e.goBallT = 1e9;
        const setArea = (id, second) => {
          const ar = D.AREAS[id];
          if (!ar) return;
          // side areas follow the side the defender lined up on (CBs mirror their WR when the offense flips)
          const cx = ar[0];                    // side areas are matched to the defenders' sides below (resolveZones)
          if (second) { e.ax2 = F.dx(G, cx); e.ay2 = F.fy(G, ar[1]); e.ar2 = ar[2]; }
          else { e.ax = F.dx(G, cx); e.ay = F.fy(G, ar[1]); e.ar = ar[2]; e.deep = !!D.DEEP_AREAS[id]; }
        };
        switch (a.k) {
          case 'man': {
            e.role = R.MAN;
            const tk = C.OFF_SLOTS.indexOf(a.on);
            e.tgt = o * 7 + (tk < 0 ? 2 : tk);
            let tr = (a.tight ? T.TRAIL_TIGHT : T.TRAIL) - 0.35 * P.edge;
            if (e.info.t.lockdown) tr -= T.LOCKDOWN_TRAIL;
            if (e.info.q.sidestep) tr -= T.SIDESTEP_TRAIL;
            if (G.ents[e.tgt].info.t.route_artist) tr += T.ROUTE_ARTIST_SEP;
            if (G.poss === userIdx) tr += T.EASY_TRAIL[G.diff];      // Rookie: looser coverage on the user's receivers
            e.trail = Math.max(T.TRAIL_MIN, tr);
            break;
          }
          case 'zone': e.role = R.ZONE; setArea(a.area, false); if (a.then) setArea(a.then, true); break;
          case 'fill': e.role = R.FILL; setArea(a.area || 'ROB', false); break;
          case 'fillrush': e.role = R.FILLRUSH; break;
          case 'spy': e.role = R.SPY; break;
          case 'free': e.role = R.FREE; e.ax = F.dx(G, a.at[0]); e.ay = F.fy(G, a.at[1]); e.ar = 0; break;
          default: e.role = R.RUSH;
        }
      }
      resolveZones(d);
    }

    /**
     * Coverage fix (playtest "corners aren't marking anybody"): each defender used to mirror his side area on his own
     * when he lined up on the other side. Vs trips (both receivers on one side) or a flipped play, both corners then took
     * the SAME deep half and the other half was empty. Now mirrored partner areas (DLH/DRH, CFL/CFR, DLT/DRT, QL/QR...)
     * are swapped between the two defenders who hold them when that shortens their runs, so every area keeps one man.
     */
    function resolveZones(d) {
      const zs = [];
      for (let k = 0; k < 7; k++) { const e = G.ents[d * 7 + k]; if ((e.role === R.ZONE || e.role === R.FILL) && e.ar > 0) zs.push(e); }
      for (let i = 0; i < zs.length; i++) {
        for (let j = i + 1; j < zs.length; j++) {
          const a = zs[i], b = zs[j];
          const ax = a.ax - MID, bx = b.ax - MID;
          if (Math.abs(ax + bx) > 0.1 || Math.abs(ax) < 4 || Math.abs(a.ay - b.ay) > 0.1 || a.ar !== b.ar) continue;   // mirror partners only
          const keep = Math.abs(a.x - a.ax) + Math.abs(b.x - b.ax), swap = Math.abs(a.x - b.ax) + Math.abs(b.x - a.ax);
          if (swap < keep - 0.5) { const t = a.ax; a.ax = b.ax; b.ax = t; }
        }
      }
    }

    /** Star hot route: a quick slant (WR/TE) or a swing (RB) from his spot; he becomes the first read. */
    function hotRoute() {
      const P = G.P, e = G.ents[P.starEnt[G.poss]];
      const pts = hotPts(e);
      e.role = R.ROUTE; e.blkT = 0; e.tgt = -1;
      E.Routes.load(G, e, pts, null, e.pos === 'RB' ? 'SETTLE' : 'CONT');
      P.play = Object.assign({}, P.play, { read: [e.pos].concat((P.play.read || []).filter((r) => r !== e.pos)) });
    }
    function hotPts(e) {
      const P = G.P;
      const ax = F.ox(G, e.lx1) * P.flip, ay = F.oy(G, e.ly1);
      if (e.pos === 'RB') { const sd = ax <= 0 ? -1 : 1; return [[ax, ay], [ax + sd * 4, ay + 1.5], [ax + sd * 8, ay + 2.5]]; }
      const inn = ax > 0 ? -1 : 1;
      return [[ax, ay], [ax, ay + 2.5], [ax + inn * 6, ay + 7]];
    }
    G.hotPts = hotPts;

    function presnapFlag() {
      const P = G.P, o = G.poss, d = 1 - o, rng = G.rng;
      const s = cfg.settings || {};
      if (s.penalties === false || s.penalties === 'off' || P.kind !== 'scrim') return false;
      const oe = G.ents[o * 7 + 5 + rng.int(0, 1)], de = G.ents[d * 7 + rng.int(0, 3)];
      const away = o === 1 && !cfg.neutral ? 1.5 : 1;
      if (rng.chance(T.PEN_FALSE * away * RU.penMul(G, oe))) return flagPlay(o, 'false', 5, 'False start! −5 yards', oe, false);
      if (rng.chance(T.PEN_OFFSIDE * RU.penMul(G, de))) return flagPlay(d, 'offside', 5, 'Offside! +5 yards', de, false);
      return false;
    }

    /** A penalty that replaces the play (presnap fouls, accepted holding, PI, roughing on an incompletion). */
    function flagPlay(ti, kind, yds, txt, e, spotY) {
      const P = G.P, o = P.off;
      RU.flag(G, ti, kind, yds, txt, e);
      G.los = P.los0; G.down = P.down0; G.fdY = P.fdY0;
      if (kind === 'pi' && spotY != null) {
        const goal = RU.goalY(G, o);
        let y = spotY;
        if ((y - goal) * G.dir >= -1) y = goal - G.dir * 1;
        if ((y - G.los) * G.dir < 1) y = G.los + G.dir;
        G.los = y; RU.firstDown(G);
      } else RU.enforce(G, ti, yds, ti !== o);
      G.pend = Math.max(G.pend, 0); G.pendTeam = o;
      RU.warnAtWhistle(G);
      E.Snapshot.fx(G, 'text', G.ball.x, G.ball.y, 2.4, 2, G.tids[ti], 'FLAG! ' + txt.toUpperCase());   // the ruling, at full size (HUNT2 #6)
      if (ti !== o && RU.halfEndQ(G) && G.clk - G.pend <= 0) G.untimed = true;
      P.result = 'penalty'; P.desc = txt;
      G.phase = 'DEAD'; G.pt = 0; G.deadT = (G.fast || G.idle) ? T.FAST.DEAD_T : T.DEAD_TURN_T; G.next = 'call';
      G.setCtl(-1);
      E.Ball.spot(G, G.ball.x, G.ball.y);
      em.emit('playEnd', { result: 'penalty', yds: ti === o ? -yds : yds, desc: txt, kind: 'pen', firstDown: false, turnover: null, sit: RU.situation(G, {}) });
      return true;
    }

    function doSnap() {
      const P = G.P;
      G.rescue = false;
      if (P.kind === 'scrim' && presnapFlag()) return;
      if (P.kind === 'spike') G.pend = 0;       // the spike stops the clock right away (its own runoff is 3 s)
      if (!G.untimed) {
        if (RU.applyPending(G) && RU.periodEnd(G)) return;
      } else G.untimed = false;
      assignRoles();
      if (P.hotStar) hotRoute();
      const qb = G.ents[G.poss * 7];
      P.qb = qb.id;
      E.Ball.give(G, qb.id);
      if (G.q > 4) G.ot.had[G.poss] = true;            // an OT possession counts from its first scrimmage snap (HUNT3 #1)
      E.AIQB.setup(G, qb);
      E.Stars.snap(G);
      P.t = 0; G.phase = 'LIVE'; G.pt = 0; G.waitSnap = false;
      G.teamPlays[G.poss]++;
      if (P.kind === 'scrim') { G.offPlays[G.poss]++; const tc = G.typeCount[G.poss]; tc[P.play.type] = (tc[P.play.type] || 0) + 1; }
      // Ouch players come back after a few plays
      for (let ti = 0; ti < 2; ti++) for (const pid in G.info[ti]) { const inf = G.info[ti][pid]; if (inf.out && inf.backAt >= 0 && G.teamPlays[ti] >= inf.backAt) { inf.out = false; inf.backAt = -1; } }
      if (G.poss === userIdx) G.setCtl(qb.id);
      if (P.play.option) {
        const k = C.DEF_SLOTS.indexOf(P.play.readDef || 'DL1');
        const kk = P.flip < 0 ? (k === 0 ? 1 : k === 1 ? 0 : k) : k;
        P.readEnt = (1 - G.poss) * 7 + kk;
        P.readCommit = G.rng.chance(0.5) ? 'rb' : 'qb';
        if (G.poss === userIdx) G.ents[P.readEnt].hi = 2;
      }
      if (P.play.sneak) {
        const o = G.poss, d = 1 - o;
        let blk = 0, shed = 0;
        for (let k = 5; k <= 6; k++) blk += G.ents[o * 7 + k].block / 2;
        for (let k = 0; k <= 1; k++) shed += G.ents[d * 7 + k].shed / 2;
        const gain = PT.Util.clamp(1.0 + (qb.r.pow + blk - shed * 2) / 40 + G.rng.normal(0, 1) - 0.3 * P.edge + 1.0, -1, 4);
        P.sneakY = G.los + gain * G.dir; P.rusher = qb.id; P.run = true; P.runT = 0;
      }
      if (P.kind === 'kneel' || P.kind === 'spike') { qb.an = P.kind === 'kneel' ? 'down' : 'throw'; qb.at = 0; }
      E.Snapshot.setRoutes(G, false);
      em.emit('snap', { play: P.play.id, side: G.userSide() || 'O', userSide: G.userSide(), edge: P.edge, call: P.call.id });
    }

    function startPunt() {
      if (RU.applyPending(G) && RU.periodEnd(G)) return;
      G.P = newPlay('punt', G.poss);
      E.Kicking.startPunt(G);
      G.phase = 'KICK'; G.pt = 0;
    }
    function startFG(kind, manual) {
      // an untimed down (HUNT2 #2) kicks even at 0:00; otherwise the pending runoff may end the period first
      if (kind === 'fg') { if (G.untimed) G.untimed = false; else if (RU.applyPending(G) && RU.periodEnd(G)) return; }
      const lined = G.P && G.P.kind === kind && G.P.fgLined;
      if (!lined) G.P = newPlay(kind, G.poss);
      G.P.fgLined = lined;
      E.Kicking.startFG(G, kind, manual);
      G.kickWait = null; G.snap.kick.on = false;
      G.phase = 'KICK'; G.pt = 0;
    }
    /** user aims a FG/XP: line up the unit and wait for kickAim/kick or autoKick() */
    function prepKick(kind) {
      G.P = newPlay(kind, G.poss);
      F.fieldGoal(G);
      E.Ball.spot(G, MID, G.los);
      G.kickReq = false;
      G.kickWait = kind; G.phase = 'CALL'; G.pt = 0;
      E.Kicking.preview(G, null);
    }

    function kickoff(kt) {
      G.tryTwo = false;
      G.P = newPlay('kickoff', kt);
      G.poss = kt; G.dir = RU.dirOf(G, kt);
      E.Kicking.startKickoff(G, kt);
      G.phase = 'KICK'; G.pt = 0;
      G.setCtl(-1); resetStar();
    }

    function brk(dur, next, kickT) { G.phase = 'BREAK'; G.pt = 0; G.breakT = dur; G.breakNext = next; G.breakKick = kickT; }

    function final() {
      if (G.over) return;
      E.Stars.refund(G);
      G.over = true; G.phase = 'FINAL'; G.setCtl(-1);
      PT.Box.finalize(G.box);
      E.Snapshot.write(G);
      em.emit('gameEnd', { box: G.box });
    }

    function startPAT() {
      // XP from the 15 (Two-Point Party: 20); 2-pt from the 2 (Party: 1)
      G.poss = G.patTeam; G.dir = RU.dirOf(G, G.patTeam);
    }

    function setupTwo() {
      G.tryTwo = true;
      const from = G.twist.twopoint ? T.TWO_FROM_PARTY : T.TWO_FROM;
      G.los = RU.goalY(G, G.poss) - from * G.dir; G.down = 1; G.fdY = RU.goalY(G, G.poss); G.togo = from;
      toCall();
    }
    function setupXP(auto) {
      const from = G.twist.twopoint ? T.XP_FROM_PARTY : T.XP_FROM;
      G.los = RU.goalY(G, G.poss) - from * G.dir;
      if (auto) { G.P = newPlay('xp', G.poss); startFG('xp', null); }
      else prepKick('xp');
    }

    // ---------------------------------------------------------------- whistle
    function whistle(k, team, y, oob, good) {
      if (G.phase !== 'LIVE' && G.phase !== 'KICK' && G.phase !== 'CALL') return;
      const P = G.P, res = G.res;
      if (G.ball.st === 'held') { if (P.carrierEnd < 0) P.carrierEnd = G.ball.car; G.ball.st = 'dead'; }
      if (P.carrierEnd >= 0 && P.ret === P.carrierEnd && P.retEndY == null) P.retEndY = y;
      if (team === P.off && P.offEndY == null) P.offEndY = y;
      res.k = k; res.team = team; res.y = y; res.oob = !!oob; res.good = !!good;
      // penalties decided at the whistle (design 8.15)
      if (P.kind === 'scrim' && !P.pen) {
        const o = P.off;
        for (let i = 0; i < 7; i++) {
          const b = G.ents[o * 7 + i];
          if (b.beatT >= 0 && P.t - b.beatT >= 1.0 && G.rng.chance(T.PEN_HOLD * RU.penMul(G, b))) {
            P.pen = { kind: 'hold', team: o, yds: 10, txt: 'Holding! −10 yards', e: b };
            break;
          }
        }
      }
      if (P.pen && P.kind === 'scrim') {
        const pen = P.pen, o = P.off;
        const offGain = team === o ? (y - P.los0) * P.dir : -99;
        if (pen.kind === 'hold') {
          if (team === o && k !== 'safety' && offGain > -8) { flagPlay(o, 'hold', 10, pen.txt, pen.e, null); return; }
          P.pen = null;
        } else if (pen.kind === 'pi') { flagPlay(1 - o, 'pi', 0, pen.txt, null, pen.spot); return; }
        else if (pen.kind === 'rough' && k === 'inc') { flagPlay(1 - o, 'rough', 15, pen.txt, null, null); return; }
      }
      if (G.star.ring === 'green') { G.star.ring = 'used'; em.emit('starRing', { on: false, idx: G.star.idx }); }
      E.Rules.endPlay(G, res);
      // post-play defensive fouls: facemask / roughing on a completed play add 15 from the end of the play
      if (P.pen && (P.pen.kind === 'face' || P.pen.kind === 'rough') && G.next === 'call' && G.poss === P.off) {
        RU.flag(G, 1 - P.off, P.pen.kind, 15, P.pen.txt, null);
        RU.enforce(G, 1 - P.off, 15, true);
      }
      G.snap.aim.on = false;
    }

    // ---------------------------------------------------------------- user control
    const mv = { x: 0, y: 0 };
    function userControl(a, dt) {
      const P = G.P;
      const ci = G.ctl;
      if (ci < 0) { G.snap.aim.on = false; return; }
      const e = G.ents[ci];
      const ml = Math.sqrt(a.mx * a.mx + a.my * a.my);
      const moving = ml > T.DEADZONE;
      if (moving) { mv.x = a.mx / ml; mv.y = a.my / ml; }
      const isQB = P.kind === 'scrim' && ci === P.qb && e.ball && !P.thrown && !P.crossed;
      if (isQB) {
        const runScript = P.qbMode === 'hand' || P.qbMode === 'pitch' || P.qbMode === 'mesh' || P.qbMode === 'toss' || P.play.sneak;
        if (P.qbMode === 'mesh' && (a.snap || a.juke || a.pass != null)) P.giveNow = true;
        if (runScript) { E.AIQB.script(G, e, dt, false); G.snap.aim.on = false; return; }
        if (P.windT > 0) {                                   // throw on the run: keep moving through the wind-up
          if (moving) E.AI.runCarrier(G, e, mv.x, mv.y, Math.min(1, ml) * T.RUN_THROW_SPD, false, dt); else E.Physics.stop(e);
          return;
        }
        if (moving) { e.qbMoved = true; E.AI.runCarrier(G, e, mv.x, mv.y, Math.min(1, ml), a.sprint, dt); }
        else if (!E.AIQB.script(G, e, dt, e.qbMoved)) E.Physics.stop(e);
        // aim preview
        const aim = G.snap.aim;
        if (a.aim && a.aim.on && P.t >= 0) {
          const maxT = E.Ball.maxThrow(G, e);
          let tx = a.aim.tx, ty = a.aim.ty;
          const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
          if (d > maxT) { tx = e.x + dx / d * maxT; ty = e.y + dy / d * maxT; }
          const fl = E.Ball.flight(G, e, tx, ty, !!a.lob, G.tmpFl);
          aim.on = true; aim.x = tx; aim.y = ty; aim.apex = fl.apex; aim.t = fl.t; aim.lob = !!a.lob; aim.max = maxT;
          aim.sig = E.Ball.sigma(G, e, fl.d, false, tx);
          aim.ok = Math.abs(tx - MID) <= T.SIDELINE && ty > 0 && ty < 120 && d > 1;
          aim.tgt = E.Ball.magnet(G, e, tx, ty, !!a.lob, E.Ball._mg);   // the receiver the magnet will pick (−1: none)
          if (aim.tgt >= 0 && E.Ball._mg.f < 1) aim.tgt = -1;           // highlight only a full lock
        } else { aim.on = false; aim.max = E.Ball.maxThrow(G, e); }
        if (a.throw && a.aim) {
          const ok = E.Ball.startThrow(G, ci, a.aim.tx, a.aim.ty, !!a.lob, false);
          if (ok) aim.on = false;
        } else if (a.pass != null) {
          const slot = typeof a.pass === 'string' ? a.pass : ['', 'WR1', 'WR2', 'TE', 'RB'][a.pass] || null;
          const k = C.OFF_SLOTS.indexOf(slot);
          if (k > 0) {
            const r = G.ents[G.poss * 7 + k];
            const lp = E.AIQB.leadPoint(G, e, r, false, G.dec);
            E.Ball.startThrow(G, ci, lp.tx, lp.ty, !!a.lob, true);
            aim.on = false;
          }
        }
        return;
      }
      G.snap.aim.on = false;
      if (!e.ball) return;
      if (e.an === 'catch' && e.at < T.CATCH_ANIM) return;
      if (e.diveT > 0) return;
      if (P.play && P.play.sneak && P.kind === 'scrim') { if (a.dive && !P.sneakDive) { P.sneakDive = true; P.sneakY += 0.5 * G.dir; } return; }
      e.carT += dt;
      if (a.dive) { E.Contact.dive(G, e); if (G.phase !== 'LIVE') return; }
      if (a.juke) E.Contact.juke(G, e);
      if (a.spin) E.Contact.spin(G, e);
      if (moving) {
        e.hx = mv.x; e.hy = mv.y;
        E.AI.runCarrier(G, e, mv.x, mv.y, Math.min(1, ml), a.sprint, dt);
      } else {
        // no input: follow the designed lane for a moment, then keep running at 70% (design 9.5)
        if (e.wpn > 0 && e.wpi < e.wpn && e.carT < 1.0 && P.rusher === e.id) {
          const tx = e.wpx[e.wpi], ty = e.wpy[e.wpi];
          if (Math.hypot(tx - e.x, ty - e.y) < 0.8) e.wpi++;
          const dx = tx - e.x, dy = ty - e.y, dl = Math.hypot(dx, dy) || 1;
          E.AI.runCarrier(G, e, dx / dl, dy / dl, 0.85, a.sprint, dt);
          return;
        }
        const dirC = RU.dirOf(G, e.tm);
        let hx = e.vx, hy = e.vy;
        const hl = Math.hypot(hx, hy);
        if (hl < 0.5) { hx = 0; hy = dirC; } else { hx /= hl; hy /= hl; }
        // gently bend toward upfield
        const ang = Math.atan2(hx, hy * dirC), turn = Math.min(Math.abs(ang), 1.0 * dt) * Math.sign(ang);
        const na = ang - turn;
        E.AI.runCarrier(G, e, Math.sin(na), Math.cos(na) * dirC, T.AUTO_RUN, a.sprint, dt);
      }
    }

    function starUpdate(a, dt) {
      const s = G.star, P = G.P;
      if (s.idx < 0 || s.ring === 'none' || s.ring === 'used') return;
      const e = G.ents[s.idx], b = G.ball;
      if (s.ring === 'wait') {
        if (a.star) {
          s.ring = 'used'; e.whiff = true; s.whiffD = true;
          G.ustats.starWhiffs++;
          em.emit('starPlay', { result: 'whiff', pid: e.pid });
          E.Snapshot.fx(G, 'whiff', e.x, e.y, 2, 1, G.tids[e.tm], 'WHIFF');
          return;
        }
        let chance = false;
        if (b.st === 'held' && G.ents[b.car].tm !== e.tm) {
          const c = G.ents[b.car], dx = c.x - e.x, dy = c.y - e.y, dd = Math.hypot(dx, dy);
          // playtest: also a chance while the Star is closing in on the carrier (Super Dive reach covers the gap)
          const closing = dd > 0.01 ? ((e.vx - c.vx) * dx + (e.vy - c.vy) * dy) / dd : 0;
          // HUNT3 #3: no ring in the first STAR_MIN_T s, and only for an unblocked Star (a DL at the snap used to Super-Dive the QB)
          chance = P.t >= T.STAR_MIN_T && e.eng < 0 && (dd <= T.STAR_NEAR || (dd <= T.STAR_CHASE && closing >= T.STAR_CLOSE_V));
        }
        else if (b.st === 'air' && b.kind === 'pass') chance = Math.hypot(b.lx - e.x, b.ly - e.y) <= T.STAR_AIR;
        if (chance && e.downT <= 0) {
          s.ring = 'green'; s.left = s.win; s.t = 1;
          em.emit('starRing', { on: true, idx: s.idx, slowmo: T.STAR_SLOWMO, dur: Math.min(0.8, s.win * 2) });
        }
      } else if (s.ring === 'green') {
        s.left -= dt; s.t = Math.max(0, s.left / s.win);
        if (a.star) {
          s.ring = 'used';
          const air = b.st === 'air' && b.kind === 'pass';
          if (air) s.superJump = true;
          else {
            e.superT = 0.8;
            if (b.st === 'held') {
              const c = G.ents[b.car];
              const dd = Math.hypot(c.x - e.x, c.y - e.y);
              if (dd <= e.rad + c.rad + T.TKL_PAD + T.STAR_SUPER_REACH && e.eng < 0 && e.downT <= 0) {
                e.an = 'dive'; e.at = 0; e.tkCd = 0;
                E.Contact.attempt(G, s.idx, b.car, 1);
              }
            }
          }
          G.ustats.starPlays++;
          em.emit('starPlay', { result: 'super', kind: air ? 'jump' : 'dive', pid: e.pid });
          E.Snapshot.fx(G, 'star', e.x, e.y, 2.5, 1, G.tids[e.tm], 'SUPER!');
          G.snap.cam.shake = Math.max(G.snap.cam.shake, 0.2);
          em.emit('starRing', { on: false, idx: s.idx });
        } else if (s.left <= 0) { s.ring = 'used'; em.emit('starRing', { on: false, idx: s.idx }); }
      }
      void P;
    }

    // ---------------------------------------------------------------- phases
    function stepPresnap(a, dt) {
      const P = G.P;
      const lt = (G.fast || G.idle) ? T.FAST.LINEUP_T : T.LINEUP_T;
      // the HUD shows GO while the defense is still jogging in: a GO tapped then is kept, not dropped (practice QA)
      // (also HIKE for the user's offense: an AI audible's re-lineup used to swallow it — stars.js "audibleO,turbo")
      if (G.poss === userIdx && a.ability && E.Stars.canUse(G, userIdx)) E.Stars.activate(G, userIdx, false, true);   // STAR works during the jog too
      if (G.pt < lt && !P.jogDone) { if (a.snap && userIdx >= 0) P.goReq = true; F.jogStep(G, G.pt / lt); return; }
      if (!P.jogDone) { F.jogStep(G, 1); P.jogDone = true; G.waitSnap = userIdx >= 0; G.pt = lt; }
      const uo = G.poss === userIdx, ud = userIdx >= 0 && !uo;
      if (ud && a.starPick != null) setStar(a.starPick);
      if (P.aiAud && G.pt >= P.aiAud.at && !a.snap && !P.goReq) { const au = P.aiAud; P.aiAud = null; doAudible(au.side, au.id, true); return; }
      if (P.motionT > 0) {
        const m = P.play.motion, k = C.OFF_SLOTS.indexOf(m.slot), e = G.ents[G.poss * 7 + k];
        P.motionT -= dt;
        const f = 1 - Math.max(0, P.motionT) / m.t;
        e.x = F.fx(G, m.from[0] + (m.to[0] - m.from[0]) * f); e.y = F.fy(G, m.from[1] + (m.to[1] - m.from[1]) * f);
        e.an = 'run'; e.spd = 10;
        if (P.motionT <= 0) { P.motionDone = true; e.an = 'stance'; e.spd = 0; doSnap(); }
        return;
      }
      const w = G.pt - lt;
      let go = false;
      if (userIdx < 0) go = w >= (G.fast ? T.FAST.AI_SNAP : T.AI_SNAP);
      // client: the user's offense NEVER snaps without HIKE (no play-clock / Hurry auto-snap; Hurry only shortens the runoff),
      // and the user's defense never auto-GOes unless Auto Defense is on. (Idle demo mode drives the user side via the
      // Autopilot, which presses HIKE itself.)
      else if (uo) go = !!a.snap || !!P.goReq;
      else go = a.snap || !!P.goReq || (G.autoDef && w >= T.AUTO_DEF_GO);
      if (!go) return;
      if (P.play.motion && !P.motionDone) { P.motionT = P.play.motion.t; G.waitSnap = false; return; }
      doSnap();
    }

    function stepLive(a, dt) {
      const P = G.P, b = G.ball;
      P.t += dt;
      if (P.t > T.MAX_PLAY_T) {           // safety net (ARCHITECTURE 7.2)
        if (b.st === 'held') return E.Contact.downAt(G, b.car, G.ents[b.car].y, false, true);
        return whistle('inc', P.off, P.los0, false);
      }
      if (P.kind === 'kneel') {
        E.Physics.stop(G.ents[P.qb]);
        if (P.t >= 0.7) {
          P.rusher = P.qb;
          const og = RU.ownGoalY(G, G.poss), ky = (G.los - G.dir - og) * G.dir < 0.6 ? og + 0.6 * G.dir : G.los - G.dir;   // never in the end zone
          E.Contact.downAt(G, P.qb, ky, false, true);
        }
        return;
      }
      if (P.kind === 'spike') { if (P.t >= 0.5) { b.st = 'dead'; whistle('inc', P.off, P.los0, false); } return; }
      userControl(a, dt);
      if (G.phase !== 'LIVE') return;
      E.AI.update(G, dt);
      E.Stars.update(G, dt);
      if (P.kind === 'scrim' || P.kind === 'two') {
        if (P.play.sneak && b.st === 'held') {
          const q = G.ents[b.car];
          E.Physics.steerTo(q, MID, P.sneakY, 0.25);
          if ((q.y - P.sneakY) * G.dir >= -0.1 || P.t > 1.6) { P.tkBy = E.AI.nearestOpp(G, q, q.x, q.y); return E.Contact.downAt(G, b.car, P.sneakY, false, true); }
        }
      }
      // reverse (Spin Cycle): RB → WR1 exchange when they meet; the defense keeps flowing the wrong way for a moment
      if (P.play && P.play.reverse && !P.exch && b.st === 'held' && G.ents[b.car].pos === 'RB' && G.ents[b.car].tm === P.off) {
        const rb = G.ents[b.car], wr = G.ents[P.off * 7 + 2];
        if (Math.hypot(rb.x - wr.x, rb.y - wr.y) < 1.3 || P.t > 2.5) {
          P.exch = true;
          E.Ball.handoff(G, rb.id, wr.id);
          rb.role = R.ESCORT;
          for (let k = 0; k < 7; k++) { const d = G.ents[P.def * 7 + k]; d.thinkT = 0.5 * (1 - d.r.smt / 150); }
        }
      }
      E.Ball.update(G, dt);
      if (G.phase !== 'LIVE') return;
      E.Physics.integrate(G, dt);
      E.Contact.blocks(G, dt);
      E.Physics.collide(G);
      E.Physics.bounds(G);
      if ((P.kind === 'scrim' || P.kind === 'two') && b.st === 'held' && b.car === P.qb && !P.thrown && !P.crossed && !P.run) {
        const q = G.ents[P.qb];
        if ((q.y - P.los0) * G.dir > 0.4) {
          P.crossed = true; P.rusher = P.qb; P.run = true; P.runT = P.t;
          E.AI.onBallChange(G);
        }
      }
      // roughing the passer (design 8.15)
      if (P.thrown && P.t <= P.roughT && !P.pen && P.kind === 'scrim') {
        const q = G.ents[P.qb];
        const n = E.AI.nearestOpp(G, q, q.x, q.y);
        if (n >= 0 && Math.hypot(G.ents[n].x - q.x, G.ents[n].y - q.y) < q.rad + G.ents[n].rad + 0.2) {
          P.roughT = 0;
          if (G.rng.chance(T.PEN_ROUGH * RU.penMul(G, G.ents[n]))) P.pen = { kind: 'rough', team: 1 - P.off, yds: 15, txt: 'Roughing the passer! +15' };
          q.downT = 0.8; q.an = 'down'; q.at = 0;
        }
      }
      E.Contact.checkScore(G);
      if (G.phase !== 'LIVE') return;
      if (!(P.play && P.play.sneak)) E.Contact.tackles(G, dt);
      if (G.phase !== 'LIVE') return;
      if (P.dived >= 0 && G.ents[P.dived].diveT <= 0 && b.st === 'held' && b.car === P.dived) {
        const e = G.ents[P.dived];
        return E.Contact.downAt(G, P.dived, e.y + T.DIVE_EXTRA * RU.dirOf(G, e.tm), false, true);
      }
      if (a.ability && userIdx >= 0 && E.Stars.canUse(G, userIdx)) {
        const st = G.star, perfect = G.poss !== userIdx && st.ring === 'green';   // PERFECT: Surge on the green ring
        E.Stars.activate(G, userIdx, perfect, false);
      }
      starUpdate(a, dt);
      if (!P.edgeShown && P.t >= 0.3 && P.kind === 'scrim') {
        P.edgeShown = true;
        if (userIdx >= 0 && Math.abs(P.edge) >= T.EDGE_TXT) {
          const uo = G.poss === userIdx;
          const txt = P.edge > 0 ? (uo ? 'They read it!' : 'Great call!') : (uo ? 'Fooled \'em!' : 'Uh oh, wrong call!');
          em.emit('edge', { edge: P.edge, txt: txt, good: uo ? P.edge < 0 : P.edge > 0 });   // HUNT3 #2 (audio: bell vs buzzer)
          E.Snapshot.fx(G, 'text', MID, G.los + 6 * G.dir, 3, 1, -1, txt);
        }
      }
    }

    function stepKick(a, dt) {
      const P = G.P;
      P.t += dt;
      // user receiving: a tap during the flight = touchback / fair catch; steering = return it
      if ((P.kind === 'kickoff' || P.kind === 'punt') && G.userRet(1 - P.off) && G.ball.st === 'air') {
        if (a.snap || a.star || a.juke || a.dive || a.kick) {
          P.retCall = P.kind === 'punt' ? 'fc' : 'tb';
          E.Snapshot.fx(G, 'text', G.ents[P.ret].x, G.ents[P.ret].y, 2.4, 1, G.tids[1 - P.off], P.retCall === 'fc' ? 'FAIR CATCH!' : 'TAKE A KNEE');
        }
        if (Math.abs(a.mx) + Math.abs(a.my) > 0.3) P.retMoved = true;
      }
      if (P.t > T.MAX_PLAY_T) return whistle('touchback', 1 - P.off, G.los, false);
      const moving = P.stage !== 'setup' && !(P.kind === 'punt' && P.stage === 'set') && !((P.kind === 'fg' || P.kind === 'xp') && P.stage === 'set' && !P.fgLined);
      if (moving) E.AI.update(G, dt);
      E.Ball.update(G, dt);
      E.Kicking.update(G, dt);
      if (G.phase !== 'KICK') return;
      if (moving) {
        E.Physics.integrate(G, dt);
        E.Contact.blocks(G, dt);
        E.Physics.collide(G);
        E.Physics.bounds(G);
        if (G.ball.st === 'held') E.Contact.tackles(G, dt);
      }
    }

    function stepCall(a, dt) {
      if (G.kickWait) {
        const P = G.P;
        if (!P.fgLined) {
          const lt = (G.fast || G.idle) ? 0.05 : T.LINEUP_T;
          F.jogStep(G, Math.min(1, G.pt / lt));
          if (G.pt >= lt) P.fgLined = true;
        }
        E.Kicking.preview(G, a.kickAim);
        if (a.kick) { G.kickReq = true; G.kickAimSaved = G.snap.kick.ang; G.kickPowSaved = a.kickAim && a.kickAim.on ? G.snap.kick.pow : G.snap.kick.pow; }
        if (G.kickReq && P.fgLined) {
          G.kickReq = false;
          startFG(G.kickWait, { ang: G.kickAimSaved, pow: G.kickPowSaved || 0 });
        }
      }
    }

    function stepPAT(a, dt) {
      if (G.patTeam === userIdx) return;    // wait for choosePAT
      if (G.pt >= ((G.fast || G.idle) ? T.FAST.PAT_AI_T : T.PAT_AI_T)) {
        startPAT();
        if (RU.aiPAT(G, G.patTeam) === 'two') setupTwo(); else setupXP(true);
      }
    }

    // ---------------------------------------------------------------- public API
    const game = {
      get phase() { return G.phase; },
      _G: G,
      /** @returns {null|Object} what the UI must provide next (see WP3.md) */
      needs: function () {
        if (G.over) return null;
        if (G.phase === 'CALL') {
          if (G.kickWait) {
            const s = G.snap.kick;
            return { k: 'KICK_AIM', kind: G.kickWait, dist: s.dist, pct: s.pct, minPow: s.minPow, sit: RU.situation(G, {}) };
          }
          if (userIdx < 0) return null;
          if (G.poss === userIdx) {
            if (G.down === 4 && !G.fourthDone && !G.tryTwo) {
              const s = RU.situation(G, {});
              return { k: 'FOURTH', sit: s, fgPct: s.fgOk ? s.fgPct : 0, fgOk: s.fgOk };
            }
            if (!G.selO) return { k: 'PLAYCALL', side: 'O', sit: RU.situation(G, {}) };
          } else if (G.selO && !G.selD && !G.autoDef) {
            return { k: 'PLAYCALL', side: 'D', sit: RU.situation(G, {}), love: E.PlayCall.love(G) };
          }
          return null;
        }
        if (G.phase === 'PAT' && G.patTeam === userIdx && !G.patChosen) return { k: 'PAT', sit: RU.situation(G, {}) };
        if (G.phase === 'PRESNAP' && G.waitSnap && userIdx >= 0) return { k: 'SNAP', side: G.userSide() };
        return null;
      },
      /** @param {'O'|'D'} side @returns {Object[]} PlayCards (first 3 = suggested) */
      /** PlayCards; options(side, {audible:true}) → the 4 audible suggestions while lined up (PRESNAP). */
      options: function (side, o) {
        side = side || G.userSide() || 'O';
        if (o && o.audible) return E.PlayCall.audibleOptions(G, side);
        return E.PlayCall.options(G, side);
      },
      /** Change the user's call once per play in PRESNAP: a play id / 'hot_star' (offense) or a defense call id. */
      audible: function (id) { if (userIdx < 0) return false; return doAudible(G.userSide(), id, false); },
      /** Can the user use the Star ability now (meter full, Star on the field, right phase)? */
      canAbility: function () { return userIdx >= 0 && E.Stars.canUse(G, userIdx); },
      /** User's call for the current side. @returns {boolean} */
      callPlay: function (id) {
        if (G.phase !== 'CALL' || G.kickWait || G.over) return false;
        if (userIdx >= 0 && G.poss === userIdx && !G.selO) {
          if (id === 'punt' || id === 'fg' || id === 'timeout') return game.fourth(id);
          const p = PT.Data.Playbook.byId(id);
          if (!p) return false;
          G.fourthDone = true;
          G.selO = p; G.selD = E.PlayCall.aiDefense(G, false);
          lineup();
          return true;
        }
        if (userIdx >= 0 && G.poss !== userIdx && G.selO && !G.selD) {
          const c = PT.Data.Defense.byId(id);
          if (!c) return false;
          G.selD = c; G.lastUserCall = id;
          lineup();
          return true;
        }
        return false;
      },
      choosePAT: function (kind) {
        if (G.phase !== 'PAT' || G.patTeam !== userIdx || G.patChosen) return false;
        G.patChosen = true;
        startPAT();
        if (kind === 'two') setupTwo(); else setupXP(false);
        return true;
      },
      /** 4th down choice for the user's offense: 'go' | 'punt' | 'fg' */
      fourth: function (choice) {
        if (G.phase !== 'CALL' || G.poss !== userIdx || G.kickWait || G.selO) return false;
        if (choice === 'go') { G.fourthDone = true; return true; }
        if (choice === 'punt') { if (G.down !== 4) return false; G.fourthDone = true; startPunt(); return true; }
        if (choice === 'timeout') return game.timeout(G.tids[userIdx]);
        if (choice === 'fg') {
          // client: a field goal on ANY down once past midfield (and in range)
          const s = RU.situation(G, {});
          if (!s.fgOk || (G.down !== 4 && s.toGoal >= 50)) return false;
          // no time left (and not an untimed down): the clock runs out before the kick — never show the aim screen
          if (!G.untimed && G.clk - G.pend <= 0) { G.rescue = false; if (RU.applyPending(G) && RU.periodEnd(G)) return true; }
          G.fourthDone = true; prepKick('fg'); return true;
        }
        return false;
      },
      /** Resolve the pending user FG/XP with the auto-kick formula. */
      autoKick: function () { if (G.kickWait && !(G.drill && G.drill.manualKick)) { startFG(G.kickWait, null); return true; } return false; },
      /** Request an onside kick (user kicking team, during kickoff setup). */
      onside: function () { if (G.phase === 'KICK' && G.P.kind === 'kickoff' && G.P.stage === 'setup' && G.canOnside) { G.onsideReq = true; return true; } return false; },
      /** Kick it deep (the user's choice while the onside option is held, HUNT3 #5). */
      kickDeep: function () { if (G.phase === 'KICK' && G.P.kind === 'kickoff' && G.P.stage === 'setup' && G.canOnside) { G.deepReq = true; return true; } return false; },
      timeout: function (tid) {
        const ti = tid === G.tids[0] ? 0 : tid === G.tids[1] ? 1 : -1;
        if (ti < 0 || G.tos[ti] <= 0 || G.over) return false;
        if (!(G.phase === 'CALL' || G.phase === 'PRESNAP' || G.phase === 'DEAD')) return false;
        G.tos[ti]--;
        if (G.pend > T.RUN_STOP) G.pend = T.RUN_STOP;
        if (G.clk - G.pend > 0) G.rescue = false;          // time is back on the clock: normal play calling
        em.emit('timeout', { tid: tid, auto: false, left: G.tos[ti] });
        return true;
      },
      hurry: function (on) { if (userIdx >= 0 && on != null) G.hurry[userIdx] = !!on; return userIdx >= 0 ? G.hurry[userIdx] : false; },
      flip: function (on) { if (on != null) G.flipNext = !!on; return G.flipNext; },
      setAutoDef: function (on) {
        G.autoDef = !!on;
        if (G.autoDef && G.phase === 'CALL' && userIdx >= 0 && G.poss !== userIdx && G.selO && !G.selD) { G.selD = E.PlayCall.aiDefense(G, true); lineup(); }
        return G.autoDef;
      },
      /** One fixed tick. @param {number} dt @param {Action|null} action */
      step: function (dt, action) {
        if (G.over) return;
        dt = dt || C.DT;
        let a = action || G.lastAct;
        if (!action) { const la = G.lastAct; la.snap = la.throw = la.juke = la.dive = la.spin = la.star = la.kick = la.ability = false; la.pass = null; la.starPick = null; la.mx = la.my = 0; la.aim.on = false; la.kickAim.on = false; }
        if (G.idle && userIdx >= 0) {
          if (action && hasInput(action)) G.idle = false;
          else { const st = a.star; a = E.Autopilot.action(game, G.apAct); a.star = a.star || st; }
        }
        G.tick++;
        if (G.drill) G.drill.t += dt;
        for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.px = e.x; e.py = e.y; e.pz = e.z; }
        G.ball.px = G.ball.x; G.ball.py = G.ball.y; G.ball.pz = G.ball.z; G.ball.tp = false;
        G.pt += dt;
        switch (G.phase) {
          case 'CALL': stepCall(a, dt); break;
          case 'PRESNAP': stepPresnap(a, dt); break;
          case 'LIVE': stepLive(a, dt); break;
          case 'KICK': stepKick(a, dt); break;
          case 'DEAD': {
            for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.dvx = e.dvy = 0; }
            E.Physics.integrate(G, dt);
            // the downed carrier keeps the ball while he slides to a stop (no detached ball between plays)
            const db = G.ball;
            if (db.st === 'dead' && db.car >= 0 && G.ents[db.car].ball) { const c = G.ents[db.car]; db.x = c.x - Math.sin(c.fa) * 0.25; db.y = c.y + Math.cos(c.fa) * 0.25; }
            if (G.pt >= G.deadT) { if (G.drill) drillHold(); else RU.afterDead(G); }
            break;
          }
          case 'HOLD': {                  // practice drill: the play is over, everyone eases to a stop and waits
            for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.dvx = e.dvy = 0; }
            E.Physics.integrate(G, dt);
            break;
          }
          case 'PAT': stepPAT(a, dt); break;
          case 'BREAK':
            if (G.pt >= G.breakT) {
              if (G.breakNext === 'kickoff') kickoff(G.breakKick); else toCall();
            }
            break;
          default: break;
        }
        E.Physics.bounds(G);
        if (G.debug && !G.over) checkNaN();
        else if (!G.over) nanGuard();
        if (!G.over) E.Snapshot.write(G);
      },
      snapshot: function () { return G.snap; },
      /** Per-game counters for the user's team (achievements): {jukes, spins, brokenTackles, starPlays, starWhiffs, longTD, sacks, ints, bigPlays} */
      userStats: function () { return Object.assign({}, G.ustats); },
      situation: function () { return RU.situation(G, {}); },
      partial: function () {
        return { q: G.q, half: G.q <= 2 ? 1 : G.q <= 4 ? 2 : 3, clk: RU.clockLeft(G), hs: G.score[0], as: G.score[1], poss: G.poss === 0 ? 'h' : 'a', y: G.los, dir: G.dir,
          down: G.down, togo: G.togo, tos: G.tos.slice(), ot: G.q > 4, box: G.box };
      },
      box: function () { return G.box; },
      on: em.on,
      isOver: function () { return G.over; },
      destroy: function () { em.clear(); G.over = true; },
      /** Resolve the current play instantly (user on defense; any play works). */
      skipPlay: function () {
        if ((G.phase !== 'LIVE' && G.phase !== 'KICK') || G.drill) return false;    // drills: the user plays every snap
        const start = G.playNo;
        let guard = 0;
        while ((G.phase === 'LIVE' || G.phase === 'KICK') && G.playNo === start && guard++ < 60 * 70) game.step(C.DT, null);
        return true;
      },
      /** Resolve the rest of the AI drive (user on defense) with Auto Defense calls. */
      simDrive: function () {
        if (userIdx < 0 || G.poss === userIdx || G.drill) return false;
        const wasAuto = G.autoDef;
        G.autoDef = true;
        let guard = 0;
        while (!G.over && guard++ < 60 * 60 * 6) {
          if (G.phase === 'CALL' && G.poss === userIdx && !G.kickWait) break;
          if (G.phase === 'PAT' && G.patTeam === userIdx) break;
          if (G.phase === 'CALL' && G.selO && !G.selD && G.poss !== userIdx) { G.selD = E.PlayCall.aiDefense(G, true); lineup(); }
          if (G.phase === 'PRESNAP' && G.waitSnap) { const ap = G.apAct; ap.snap = true; game.step(C.DT, ap); ap.snap = false; continue; }
          game.step(C.DT, null);
        }
        G.autoDef = wasAuto;
        return true;
      },
      /**
       * Practice drill (docs/handoff/PRACTICE.md). Puts the ball on a fixed spot, resets the clock, score, timeouts and
       * Star meters, and turns on drill mode: no penalties, no injuries, no clock runoff, no points on the scoreboard,
       * and after the whistle (+ the normal dead-ball pause) the engine HOLDS (phase 'HOLD', needs() → null) instead
       * of moving on — no PAT, kickoff, change of possession or AI drive — until the next setupDrill / endDrill.
       * Players are placed at once (no jog). Call it between steps / while the Session is paused.
       * @param {{side:'O'|'D', y:number, down?:number, togo?:number, play?:string, defCall?:string, star?:number}} o
       *   side: the user's side. y: yards from the OFFENSE's own goal line. down/togo: default 1st & 10.
       *   play: offense play id — user offense: called now (the user only has to HIKE; omit it to let the play-call /
       *   4th-down tray ask), user defense: the AI's play. defCall: defense call id — user offense: the AI's call; user
       *   defense: called now (omit it to let the tray ask). star: DEF_SLOTS index of the user's Star defender (0..6), or a
       *   map {callId: index, '*': default} so the Star fits the call the user picks. manualKick (default true): autoKick()
       *   is refused, the user aims the kick. skipPlay() / simDrive() are refused in drill mode.
       * @returns {boolean}
       */
      setupDrill: function (o) {
        if (userIdx < 0 || !o || G.over) return false;
        const PB = PT.Data.Playbook, DD = PT.Data.Defense;
        const off = o.side === 'D' ? 1 - userIdx : userIdx;
        G.drill = { t: 0, hold: false, manualKick: o.manualKick !== false, star: o.star != null && (typeof o.star === 'object' || (o.star >= 0 && o.star <= 6)) ? o.star : null, side: o.side === 'D' ? 'D' : 'O' };
        G.q = 1; G.clk = G.qLen; G.pend = 0; G.untimed = false; G.untimedNext = false; G.score[0] = G.score[1] = 0;
        G.tos[0] = G.tos[1] = T.TOS; G.hurry[0] = G.hurry[1] = false; G.aiHurry[0] = G.aiHurry[1] = false; G.flipNext = false;
        G.kickWait = null; G.kickReq = false; G.tryTwo = false; G.patChosen = false; G.fourthDone = false; G.next = 'call';
        G.canOnside = false; G.onsideReq = false; G.waitSnap = false;
        G.meter[0].off = G.meter[0].def = G.meter[1].off = G.meter[1].def = 0;
        for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.hi = 0; e.whiff = false; e.superT = 0; e.jukeT = e.spinT = 0; e.slowT = 0; e.tkCd = 0; }
        RU.setPoss(G, off, RU.ownYard(G, off, o.y != null ? o.y : 25));
        if (o.down >= 1 && o.down <= 4) G.down = o.down | 0;
        if (o.togo > 0) {
          const goal = RU.goalY(G, off);
          G.fdY = (G.los + o.togo * G.dir - goal) * G.dir >= 0 ? goal : G.los + o.togo * G.dir;
          G.togo = Math.max(1, Math.round(Math.abs(G.fdY - G.los)));
        }
        toCall();                                   // AI offense: picks its own play here; overridden below
        if (off !== userIdx) {
          if (o.play && PB.byId(o.play)) G.selO = PB.byId(o.play);
          G.selD = o.defCall && DD.byId(o.defCall) ? DD.byId(o.defCall) : null;
          if (G.selD || G.autoDef) { if (!G.selD) G.selD = E.PlayCall.aiDefense(G, true); lineup(1); }
        } else if (o.play && PB.byId(o.play)) {
          G.fourthDone = true;
          G.selO = PB.byId(o.play);
          G.selD = o.defCall && DD.byId(o.defCall) ? DD.byId(o.defCall) : E.PlayCall.aiDefense(G, false);
          lineup(1);
        }
        if (G.phase === 'PRESNAP') { F.jogStep(G, 1); G.pt = T.LINEUP_T; }
        for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.px = e.x; e.py = e.y; e.pz = e.z; e.vx = e.vy = 0; }
        const b = G.ball; b.px = b.x; b.py = b.y; b.pz = b.z; b.tp = true;
        E.Snapshot.write(G);
        return true;
      },
      /** Leave drill mode; a held game goes on with a normal play call. */
      endDrill: function () {
        if (!G.drill) return false;
        const held = G.phase === 'HOLD';
        G.drill = null;
        if (held && !G.over) { toCall(); E.Snapshot.write(G); }
        return true;
      },
      /** Drill status: null outside drill mode, else {hold: the play is over and the engine waits, t: game seconds since setup}. */
      drill: function () { return G.drill ? { hold: G.phase === 'HOLD', t: G.drill.t, side: G.drill.side } : null; },
      _toCall: toCall, _kickoff: kickoff, _break: brk, _final: final
    };

    /** drill mode: the dead-ball pause is over → wait for the next setupDrill (never a PAT, kickoff or AI drive) */
    function drillHold() {
      G.phase = 'HOLD'; G.pt = 0; G.drill.hold = true; G.pend = 0; G.waitSnap = false;
      G.setCtl(-1); resetStar();
      G.snap.aim.on = false; G.snap.kick.on = false;
    }
    G.api = game;

    /** Production safety net (ARCHITECTURE 7.2): a NaN body resets the play to a dead ball at the LOS and play goes on. */
    function nanGuard() {
      let bad = !(isFinite(G.ball.x) && isFinite(G.ball.y) && isFinite(G.ball.z));
      for (let i = 0; i < 14 && !bad; i++) { const e = G.ents[i]; if (!(isFinite(e.x) && isFinite(e.y) && isFinite(e.z) && isFinite(e.vx) && isFinite(e.vy))) bad = true; }
      if (!bad) return;
      if (PT.Log && PT.Log.error) PT.Log.error('engine', 'NaN body, play reset', { phase: G.phase, play: G.P && G.P.play ? G.P.play.id : G.P.kind });
      for (let i = 0; i < 14; i++) {
        const e = G.ents[i];
        if (!(isFinite(e.x) && isFinite(e.y))) { e.x = MID + (i % 7 - 3) * 2; e.y = G.los; }
        e.z = 0; e.vx = e.vy = e.vz = e.dvx = e.dvy = 0; e.eng = -1; e.eng2 = -1; e.dside = false;
      }
      E.Ball.spot(G, MID, G.los);
      if (G.phase === 'LIVE' || G.phase === 'KICK') {
        if (G.P && G.P.kind === 'kickoff') { G.next = 'call'; E.Rules.setPoss(G, 1 - G.P.off, E.Rules.ownYard(G, 1 - G.P.off, T.TB_KO)); }
        else { G.los = G.P ? G.P.los0 : G.los; G.next = G.P && G.P.kind === 'punt' ? 'call' : 'call'; }
        G.phase = 'DEAD'; G.pt = 0; G.deadT = T.DEAD_T; G.setCtl(-1);
        em.emit('playEnd', { result: 'gain', yds: 0, desc: 'Whistle', kind: 'reset', firstDown: false, turnover: null, sit: RU.situation(G, {}) });
      }
    }

    function checkNaN() {
      for (let i = 0; i < 14; i++) {
        const e = G.ents[i];
        if (!(isFinite(e.x) && isFinite(e.y) && isFinite(e.z))) throw new Error('[Engine] NaN position ent ' + i + ' phase ' + G.phase);
      }
      if (!(isFinite(G.ball.x) && isFinite(G.ball.y))) throw new Error('[Engine] NaN ball');
    }

    // ---------------------------------------------------------------- opening kickoff (coin toss)
    G.firstKick = G.rng.chance(0.5) ? 0 : 1;
    G.poss = 1 - G.firstKick; G.dir = RU.dirOf(G, G.poss);
    G.P = newPlay('none', G.poss);
    for (let i = 0; i < 14; i++) { const e = G.ents[i]; e.x = MID + (i % 7 - 3) * 4; e.y = 60 + (i < 7 ? -8 : 8); }
    kickoff(G.firstKick);
    E.Snapshot.write(G);
    return game;
  };
})(globalThis.PT = globalThis.PT || {});
