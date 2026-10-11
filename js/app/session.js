/* Pixel Touchdown: js/app/session.js
 * Owner: WP6. Responsibility: PT.Session: one user game: Engine+Render+Input+HUD wiring.
 *
 * Session.start(L, gid) builds the GameConfig (PT.League.Games.config), creates the engine game, loads the
 * Render scene and HUD, and runs as the Loop tickable until the game ends, then records the box
 * (PT.League.Games.record) and resolves with it. Per tick:
 *   needs() → PLAYCALL / PAT / FOURTH (await a UI promise; no stepping meanwhile) | KICK_AIM / SNAP (input modes)
 *   Input.sample() (SCREEN space) → Action (FIELD space) via Render.screenDirToField / screenToField
 *   game.step(DT, action) → star-ring watch, input mode, watch speed
 * Engine events are re-emitted on the bus as 'game:'+name (payload copied + enriched with sp/sz/home/user);
 * Audio and HUD listen there (the HUD shows its own banners). Session also: haptics, bigPlay slow-mo, pause, FF / skip /
 * sim drive on defense, autoplay (PT.Debug.autoplay), sim-the-rest quit.
 */
(function (PT) {
  'use strict';
  const Session = PT.Session = PT.Session || {};
  const ENGINE_EVENTS = ['snap', 'handoff', 'throw', 'catch', 'incomplete', 'tackle', 'sack', 'brokenTackle', 'juke', 'dive', 'spin',
    'firstDown', 'touchdown', 'fieldGoal', 'pat', 'safety', 'turnover', 'fumble', 'interception', 'bigPlay', 'playEnd', 'quarterEnd',
    'halftime', 'twoMinute', 'gameEnd', 'kickoff', 'punt', 'penalty', 'timeout', 'doink', 'onside', 'edge', 'star', 'superPlay',
    'whiff', 'injury', 'possession', 'returnTd', 'starRing', 'starPlay', 'kick', 'recover', 'batted', 'overtime',
    'ability', 'abilityArmed', 'abilityWarn', 'abilityRefund', 'audible', 'hitstop'];
  Session.autoplay = false;
  /** dev only: force an input mode during the user's LIVE offense (e.g. 'qb' with the engine stub) */
  Session.debugForceMode = null;

  let S = null;                       // the active session

  const U = () => PT.UI || {};
  const R = () => PT.Render;
  const prefs = () => (PT.Save && PT.Save.prefs ? PT.Save.prefs() : {});
  const emit = (n, p) => PT.Events.emit(n, p);
  const now = () => (globalThis.performance ? globalThis.performance.now() : 0);
  const reduceMotion = () => !!(prefs().reduceMotion || (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches));

  function blankAction() {
    if (PT.Engine && PT.Engine.blankAction) return PT.Engine.blankAction();
    return { mx: 0, my: 0, sprint: false, aim: { on: false, tx: 0, ty: 0, pow: 0 }, throw: false, lob: false, pass: null,
      snap: false, juke: false, dive: false, spin: false, star: false, starPick: null,
      kickAim: { on: false, dx: 0, dy: 0, pow: 0 }, kick: false };
  }

  // ---------------- lookups ----------------
  function plIndex(cfg) {
    const m = {};
    [cfg.home, cfg.away].forEach((gt) => (gt.pl || []).forEach((p) => { m[p.pid] = { sp: p.sp, sz: p.sz, tid: gt.tid, n: p.n, r: p.r, tr: p.tr }; }));
    return m;
  }
  function userTeam() { return S.userIdx === 0 ? S.cfg.home : S.cfg.away; }
  function maxThrow() {
    if (S.game && typeof S.game.maxThrow === 'function') { const m = S.game.maxThrow(); if (m > 0) return m; }
    const gt = userTeam(), qb = gt.dc && gt.dc.QB && gt.dc.QB[0];
    const p = S.pl[qb];
    const arm = p && p.r && p.r.arm != null ? p.r.arm : 70;
    return 30 + arm * 0.35 + (p && p.tr && p.tr.indexOf('rocket_arm') >= 0 ? 10 : 0);
  }
  function ctlEnt(snap) { const e = snap.ents; for (let i = 0; i < e.length; i++) if (e[i].ctl) return e[i]; return null; }
  function haptic(pattern) { if (PT.App && PT.App.haptic) PT.App.haptic(pattern); }

  function crowdLevel(L, cfg) {
    const home = L && L.teams && L.teams[cfg.home.tid];
    const hype = home && home.fin && typeof home.fin.hype === 'number' ? home.fin.hype : 50;
    let lvl = 0.3 + 0.5 * hype / 100;
    if (home && home.rival === cfg.away.tid) lvl *= 1.2;
    return Math.min(1, lvl);
  }
  function hornFor(L, tid) {
    const D = PT.Data && PT.Data.Teams;
    const t = L && L.teams && L.teams[tid];
    let name = '';
    try { if (D && typeof D.divName === 'function') name = D.divName(t.conf, t.div) || ''; } catch (e) { name = ''; }
    return /rail/i.test(name) ? 'train' : /(city|highway)/i.test(name) ? 'car' : null;
  }

  // ---------------- event bridge ----------------
  function enrich(name, p) {
    const q = Object.assign({}, p || {});
    const add = (pid, pre) => { const x = S.pl[pid]; if (x) { q[pre + 'sp'] = x.sp; q[pre + 'sz'] = x.sz; if (q[pre + 'tid'] == null) q[pre + 'tid'] = x.tid; } };
    if (q.pid != null) add(q.pid, '');
    if (q.carrier != null) add(q.carrier, 'c');
    if (q.from != null && q.pid == null) add(q.from, '');
    const tid = q.tid != null ? q.tid : null;
    if (tid != null) { q.home = tid === S.cfg.home.tid; q.user = tid === S.userTid; }
    q.gid = S.gid;
    return q;
  }
  // ---------------- achievements the league can't see in a box (WP2 Achievements.engine) ----------------
  function ach(kind, n) {
    const A = PT.League && PT.League.Achievements;
    if (!A || typeof A.engine !== 'function' || !(n > 0) || S.autoplay) return;   // debug autoplay never earns badges
    if (S.L && S.L.tmp) return;                     // Quick Game / Practice: throwaway league, no badges
    try { A.engine(S.L, kind, n); } catch (e) { if (PT.Log) PT.Log.warn('session', 'Achievements.engine failed', e && e.message); }
  }
  function userStats() {
    try { return typeof S.game.userStats === 'function' ? S.game.userStats() || null : null; } catch (e) { return null; }
  }
  function flushAch() {
    if (!S || S.achDone) return;
    S.achDone = true;
    const us = userStats();
    ach('starPlays', us && us.starPlays != null ? us.starPlays : S.starPlays);
  }
  function dodges(us) { return (us.jukes || 0) + (us.spins || 0) + (us.brokenTackles || 0); }
  function countJukes(name, q) {
    const us0 = (name === 'snap' || name === 'kickoff' || name === 'playEnd') ? userStats() : null;
    if (us0 && us0.jukes != null) {                  // WP3 userStats(): game totals → per-play delta
      if (name === 'playEnd') ach('jukes', dodges(us0) - S.jukeBase);
      S.jukeBase = dodges(us0);
      return;
    }
    if (name === 'brokenTackle' || name === 'juke') {
      const c = ctlEnt(S.game.snapshot());
      if (q.tid === S.userTid && c && c.pid === q.pid) S.playJukes++;      // only the player-controlled carrier
    }
    else if (name === 'snap') S.playJukes = 0;
    else if (name === 'playEnd') { ach('jukes', S.playJukes); S.playJukes = 0; }
  }

  function onEngine(name, p) {
    if (!S) return;
    const q = enrich(name, p);
    countJukes(name, q);
    emit('game:' + name, q);
    react(name, q);
  }
  /** Session-side reactions only (haptics, slow-mo, game end). Banners are the HUD's job: it listens to game:*. */
  function react(name, p) {
    switch (name) {
      // slow-mo / hit-stop only for the user's plays (engine marks AI-vs-AI moments user:false)
      case 'bigPlay': if (p.user !== false && !reduceMotion() && !S.fast && !(PT.Flags && PT.Flags.test)) PT.Loop.slowmo(p.slowmo || 0.4, p.dur || 1); break;
      case 'hitstop': if (p.user !== false && !reduceMotion() && !S.fast && !(PT.Flags && PT.Flags.test)) PT.Loop.slowmo(0.02, (p.ms || 60) / 1000); break;
      case 'snap': PT.Input.guard(350, true); break;  // HUNT4 #1: the 2nd tap/press of a double GO!/HIKE can't become a Star tap
      case 'playEnd': S.fast = false; S.ctlKey = ''; S.abQ = 0; break;   // HUNT4 #6: » 2× is per play; a queued STAR never carries over
      case 'tackle': haptic(p.big ? 30 : 15); break;
      case 'sack': haptic(30); break;
      case 'touchdown': haptic([60, 40, 60]); break;
      case 'turnover': haptic(30); break;
      case 'starRing':                              // engine: {on, idx, slowmo, dur}
        S.engStar = true;
        if (p.on) { if (!S.fast && !reduceMotion()) PT.Loop.slowmo(p.slowmo || 0.5, p.dur || 0.8); haptic(10); }
        else PT.Loop.slowmo(1, 0);
        break;
      case 'starPlay':                              // engine: {result:'super'|'whiff', kind, pid}
        S.engStar = true;
        if (p.result === 'super') { S.starPlays++; haptic(30); }
        break;
      case 'ability': if (p.user || p.tid === S.userTid) { S.abQ = 0; haptic(p.perfect ? [30, 30, 30] : 30); } break;
      case 'abilityArmed': if (p.user || p.tid === S.userTid) { S.abQ = 0; haptic(20); } break;
      case 'abilityRefund': if (p.user || p.tid === S.userTid) S.abQ = 0; break;
      case 'abilityWarn': haptic(10); break;
      case 'gameEnd': onOver(p.box); break;
    }
  }

  // ---------------- decisions ----------------
  function setMode(m, info) {
    const snap = S.game.snapshot();
    const pre = snap.phase === 'PRESNAP';
    const key = m + '|' + pre + '|' + S.fast + '|' + (info || '');
    if (m !== S.mode) { PT.Input.setMode(m); S.modeT = 0; }
    S.mode = m;
    if (key !== S.ctlKey) {
      S.ctlKey = key;
      const H = U().Hud;
      if (H && H.setControls) {
        const hm = m === 'off' || m === 'return' ? 'none' : m === 'defense' ? (pre ? 'defense' : 'watch') : m;
        H.setControls(hm, { pre: pre, fast: S.fast, watch: S.watch, autoDef: !!S.settings.autoDef, kickPct: snap.kick && snap.kick.pct,
          easyThrow: !!S.settings.easyThrow, lefty: !!S.settings.lefty, canSkip: m === 'defense' && !pre });
      }
    }
  }

  function decide(kind, promise, apply) {
    S.pending = kind;
    setMode('off');
    const g = S.game;
    Promise.resolve(promise).then((v) => {
      if (!S || S.game !== g) return;
      S.pending = null;
      apply(v);
    }, (e) => {
      if (S && S.game === g) S.pending = null;
      if (PT.Log) PT.Log.warn('session', kind + ' decision failed', e && e.message);
    });
  }

  function autoPlayId(side, sit, cards) {
    const gt = side === 'O' ? userTeam() : userTeam();
    try {
      if (PT.Engine.PlayCall && PT.Engine.PlayCall.choose && !PT.Engine.PlayCall.choose.__stub) {
        const id = PT.Engine.PlayCall.choose(sit, side, gt, S.rng);
        if (id && cards.some((c) => c.id === id)) return id;
      }
    } catch (e) { /* fall through */ }
    const ok = cards.filter((c) => c.id !== 'punt' && c.k !== 'special');
    return (ok.length ? ok[Math.floor(S.rng.next() * Math.min(3, ok.length))] : cards[0]).id;
  }

  function openPlayCall(n) {
    S.abQ = 0;                                          // a new play: no STAR press carries over
    const g = S.game, side = n.side, cards = g.options(side) || [];
    const sit = n.sit || g.situation();
    const tos = sit.tos ? sit.tos[S.userIdx] : 0;
    const auto = S.autoplay || (side === 'D' && autoDefOn());
    if (auto && cards.length) {
      S.pending = 'PLAYCALL';
      const delay = side === 'D' ? 400 : 250;
      const t0 = setTimeout(() => { if (S && S.game === g && S.pending === 'PLAYCALL') { S.pending = null; g.callPlay(autoPlayId(side, sit, cards)); } }, delay);
      S.timers.push(t0);
      return;
    }
    const PC = U().PlayCall;
    const p = PC && PC.open ? PC.open({ side: side, sit: sit, cards: cards, canTimeout: tos > 0, tos: tos, autoDef: !!S.settings.autoDef,
      canSimDrive: side === 'D', userTid: S.userTid, gid: S.gid }) : Promise.resolve(cards[0] && cards[0].id);
    decide('PLAYCALL', p, (choice) => {
      if (choice === 'TIMEOUT') { if (g.timeout(S.userTid)) emit('game:timeout', { tid: S.userTid, user: true, gid: S.gid }); return; }
      if (choice === 'SIM_DRIVE' || choice === 'SIMDRIVE') { simDrive(); return; }
      if (choice === 'AUTODEF') return;             // ROUND6 E: Auto-start defense is a Settings toggle only
      if (choice == null) return;                   // closed without a choice → reopens next tick
      if ((choice === 'PUNT' || choice === 'FG') && g.fourth && sit.down === 4) { g.fourth(choice === 'FG' ? 'fg' : 'punt'); return; }
      if (choice === 'PUNT') choice = 'punt';
      const st = (U().PlayCall && U().PlayCall.state) || {};
      if (side === 'O') {                           // tray chips → engine toggles (WP3)
        if (typeof g.flip === 'function') g.flip(!!st.flip);
        if (typeof g.hurry === 'function') g.hurry(!!st.hurry);
      }
      syncAutoDef();
      if (!g.callPlay(choice, { flip: !!st.flip, hurry: !!st.hurry })) {
        // e.g. the "Field Goal — Too far!" card: say why instead of silently reopening the tray
        const T = U().Toast;
        if (T && T.show) T.show(choice === 'fg' ? 'Too far for a field goal!' : 'Can\'t run that one now', 'info', 1200);
        return;
      }
      emit('game:call', { side: side, id: choice, gid: S.gid });
    });
  }

  function openPAT(n) {
    const g = S.game;
    if (S.autoplay) { S.pending = null; g.choosePAT('kick'); return; }
    const PC = U().PlayCall, M = U().Modal;
    const p = PC && PC.pat ? PC.pat({ sit: n.sit })
      : M && M.open ? M.open({ title: 'Extra point', body: 'Kick it for 1, or go for 2?', buttons: [
        { label: 'Kick (1 pt)', value: 'kick', kind: 'primary', testid: 'btn-pat-kick' },
        { label: 'Go for 2', value: 'two', testid: 'btn-pat-two' }] })
        : Promise.resolve('kick');
    decide('PAT', p, (v) => g.choosePAT(v === 'two' ? 'two' : 'kick'));
  }

  function openFourth(n) {
    const g = S.game, sit = n.sit || g.situation();
    const fgPct = n.fgPct == null ? 0 : n.fgPct;
    if (S.autoplay) {
      S.pending = null;
      g.fourth(fgPct >= 60 ? 'fg' : sit.togo <= 2 ? 'go' : 'punt');
      return;
    }
    const PC = U().PlayCall, M = U().Modal;
    let unKey = null;
    const keyed = new Promise((res) => {
      unKey = PT.Input.onKey((code) => {
        const v = code === 'KeyG' ? 'go' : code === 'KeyP' ? 'punt' : code === 'KeyK' && fgPct > 0 ? 'fg' : null;
        if (!v) return false;
        res(v); return true;
      });
    });
    const ui = PC && PC.fourth ? PC.fourth({ sit: sit, fgPct: fgPct, canFg: fgPct > 0 })
      : M && M.open ? M.open({ title: '4th & ' + sit.togo + ' at ' + sit.ballOn, body: 'What do you want to do?', buttons: [
        { label: 'Go for it', value: 'go', kind: 'primary', testid: 'btn-fourth-go' },
        { label: 'Punt', value: 'punt', testid: 'btn-fourth-punt' },
        { label: fgPct > 0 ? 'Field Goal (' + fgPct + '%)' : 'Field Goal (too far)', value: fgPct > 0 ? 'fg' : 'go', testid: 'btn-fourth-fg' }] })
        : Promise.resolve('go');
    const p = Promise.race([ui, keyed]).then((v) => {
      if (unKey) unKey();
      if (PC && PC.close) PC.close();
      if (M && M.close) M.close(v);
      return v;
    });
    decide('FOURTH', p, (v) => g.fourth(v === 'fg' || v === 'punt' ? v : 'go'));
  }

  function handleNeed(n) {
    switch (n.k) {
      case 'PLAYCALL': openPlayCall(n); return true;
      case 'PAT': openPAT(n); return true;
      case 'FOURTH': openFourth(n); return true;
      case 'KICK_AIM': {
        const auto = S.autoplay || prefs().kickMode === 'auto' || !!S.settings.autoKick;
        if (auto) { S.game.autoKick(); return true; }
        setMode('kick', 'aim');
        const PC = U().PlayCall;
        if (S.kickAsk !== S.needSeq && PC && PC.kick) {
          S.kickAsk = S.needSeq;
          const g = S.game, snap = g.snapshot();
          if (PT.Input.Gestures && n.minPow != null) {
            const ET = PT.Engine && PT.Engine.T, kmax = ET && ET.KICK_POW_MAX > 0 ? ET.KICK_POW_MAX : 0.95;
            PT.Input.Gestures.setKickZone(n.minPow, kmax, !!(snap.kick && snap.kick.outRange));
          }
          PC.kick({ pct: n.pct != null ? n.pct : snap.kick && snap.kick.pct }).then((v) => { if (v === 'auto' && S && S.game === g && g.needs() && g.needs().k === 'KICK_AIM') g.autoKick(); });
        }
        return false;
      }
      case 'KICK_METER': setMode('kick', 'meter'); return false;
      case 'SNAP': setMode(n.side === 'D' ? 'defense' : 'presnap'); return false;
      default: return false;
    }
  }

  // ---------------- input → action ----------------
  function toField(dx, dyDown) {
    const d = R().screenDirToField(dx, -dyDown);
    const l = Math.hypot(d.x, d.y);
    return l > 1e-6 ? { x: d.x / l, y: d.y / l } : { x: 0, y: 0 };
  }
  /**
   * Screen direction → field direction AS SEEN at field point (fx, fy) (playtest fix). The camera is a ¾ perspective,
   * so depth is foreshortened: the old flat mapping turned a pull "toward" a deep receiver 10–18° wide of him.
   * Ground lines stay straight on screen, so unprojecting a short screen step from the player's own screen spot gives
   * exactly the field heading a human means. Used for throws and kicks (open-loop: the ball can't be steered after
   * release). Movement keeps the flat mapping so "up" is always straight upfield. Falls back to the flat mapping.
   */
  const _fd = { x: 0, y: 0 };
  function toFieldAt(dx, dyDown, fx, fy) {
    const l = Math.hypot(dx, dyDown);
    const Rr = R();
    if (l > 1e-6 && Rr && Rr.fieldToScreen && Rr.screenToField && !(PT.App && PT.App.noGL)) {
      const p0 = Rr.fieldToScreen(fx, fy, 0);
      if (p0 && isFinite(p0.x) && isFinite(p0.y)) {
        const k = 24 / l;
        const a = Rr.screenToField(p0.x, p0.y), b = Rr.screenToField(p0.x + dx * k, p0.y + dyDown * k);
        if (a && b) {
          const vx = b.x - a.x, vy = b.y - a.y, vl = Math.hypot(vx, vy);
          if (vl > 1e-4 && isFinite(vl)) { _fd.x = vx / vl; _fd.y = vy / vl; return _fd; }
        }
      }
    }
    return toField(dx, dyDown);
  }

  function aimTarget(aim, snap) {
    const qb = ctlEnt(snap) || snap.ents[snap.poss * 7];
    const len = Math.hypot(aim.dx, aim.dy);
    if (!len) return { x: qb.x, y: qb.y };
    const mt = snap.aim && snap.aim.max > 0 ? snap.aim.max : S.maxThrow;      // engine's max throw when exposed
    const d = toFieldAt(aim.dx, aim.dy, qb.x, qb.y), dist = aim.pow * mt;
    return { x: qb.x + d.x * dist, y: qb.y + d.y * dist };
  }

  function nearestDefender(snap, pt) {
    let best = null, bd = 9;                      // within 3 yd
    for (const e of snap.ents) {
      if (e.tm !== S.userIdx) continue;
      const d = (e.x - pt.x) * (e.x - pt.x) + (e.y - pt.y) * (e.y - pt.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function buildAction(f, snap) {
    const a = S.action;
    a.throw = a.snap = a.juke = a.dive = a.spin = a.star = a.kick = a.ability = false;
    a.pass = null; a.starPick = null;
    // Star ability (STAR_ABILITIES 3): STAR button / G / gamepad Y. Offense can arm it pre-snap (receivers) too.
    // A deliberate press is QUEUED (≤ 0.9 s real) and re-sent until the engine acknowledges it (ability / abilityArmed):
    // right after the snap the input guard and the engine's 0.35 s post-snap backstop would otherwise drop it.
    if (f.ability && S.mode !== 'kick' && S.mode !== 'off') S.abQ = now();
    if (S.abQ) { if (now() - S.abQ > 900 || S.mode === 'kick' || S.mode === 'off') S.abQ = 0; else a.ability = true; }
    if (f.audible) openAudible();
    a.sprint = !!f.sprint; a.lob = !!f.lob;
    a.mx = 0; a.my = 0;
    if (f.mx || f.my) {
      // movement stays on the flat mapping: "up" = straight upfield, "right" = along the yard line (closed-loop steering)
      const mag = Math.min(1, Math.hypot(f.mx, f.my)), d = toField(f.mx, f.my);
      a.mx = d.x * mag; a.my = d.y * mag;
    } else if (f.seek.on) {
      const e = ctlEnt(snap), p = R().screenToField(f.seek.sx, f.seek.sy);
      if (e && p) { const dx = p.x - e.x, dy = p.y - e.y, l = Math.hypot(dx, dy); if (l > 0.6) { a.mx = dx / l; a.my = dy / l; } }
    }
    if (S.mode !== 'qb') a.aim.on = false;
    if (S.mode !== 'kick') a.kickAim.on = false;
    // juke / spin / dive pressed during the dropback or while the ball is in the air: hold them 0.5 s and apply
    // them on the catch (the HUD buffers its taps the same way; this covers keyboard / gamepad)
    const cb = ctlEnt(snap), hasBall = !!(cb && cb.ball);
    if ((S.mode === 'qb' || S.mode === 'off' || (S.mode === 'carrier' && !hasBall)) && (f.juke || f.spin || f.dive)) {
      S.moveBuf = { juke: f.juke, spin: f.spin, dive: f.dive, t: now() };
    }
    switch (S.mode) {
      case 'presnap': a.snap = f.snap || f.go; break;
      case 'qb': {
        if (f.aim.on || f.throw) {
          const t = aimTarget(f.aim, snap);
          a.aim.on = true; a.aim.tx = t.x; a.aim.ty = t.y; a.aim.pow = f.aim.pow;
        } else a.aim.on = false;
        a.throw = f.throw;
        if (f.pass) a.pass = f.pass;                // Easy Throw badge number 1..4 (1 WR1, 2 WR2, 3 TE, 4 RB) — WP3 Action.pass
        if (f.throwAway) {
          const qb = ctlEnt(snap) || snap.ents[snap.poss * 7];
          a.aim.on = true; a.aim.tx = qb.x < PT.C.FIELD.MID_X ? -4 : PT.C.FIELD.W + 4; a.aim.ty = qb.y + 4 * snap.dir; a.aim.pow = 0.6;
          a.throw = true;
        }
        a.snap = f.snap;
        break;
      }
      case 'carrier': {
        a.juke = f.juke; a.dive = f.dive; a.spin = f.spin;
        const mb = S.moveBuf;
        if (mb && now() - mb.t > 500) S.moveBuf = null;                    // too old
        else if (mb && hasBall) {                                           // the catch: apply once
          a.juke = a.juke || !!mb.juke; a.spin = a.spin || !!mb.spin; a.dive = a.dive || !!mb.dive;
          S.moveBuf = null;
        }
        break;
      }
      case 'return':                                  // ball in the air to the user's returner (snap.hud.retHint)
        a.snap = f.snap || f.juke || f.dive || f.go;  // tap = fair catch / touchback; steering (mx/my) = bring it out
        break;
      case 'defense': {
        const pre = snap.phase === 'PRESNAP';
        if (pre) {
          if (f.tap.on) {
            const p = R().screenToField(f.tap.sx, f.tap.sy), e = p && nearestDefender(snap, p);
            if (e) a.starPick = e.id % 7;               // index inside the defense's 7-entity block (engine setStar)
          }
          if (f.cycle) {
            const ci = snap.star && snap.star.idx >= 0 ? snap.star.idx % 7 : -1;
            a.starPick = (ci + 1) % 7;
          }
          // Auto Defense: the engine GOes after 1 s via setAutoDef; Session does it only for engines without that API
          // INT2: keyboard Space (the Star Play key) also means GO before the snap — it was a dead key, only Enter
          // worked. Touch field taps also send 'star' (they pick the Star here), so only the keyboard counts.
          a.snap = f.go || f.snap || (f.star && f.device === 'kbd' && !f.tap.on) || (typeof S.game.setAutoDef !== 'function' && autoDefOn() && S.tNeed > 1.0);
        } else if (f.star) {
          // Space / field tap: use the ability when the meter is full, otherwise it is the ring Star Play tap
          if (canAbility(snap, 'def') && !(snap.star && snap.star.ring === 'green')) a.ability = true;
          else a.star = true;
        }
        if (f.ff) S.fast = !S.fast;
        if (f.skip && snap.phase === 'LIVE' && S.game.skipPlay) S.game.skipPlay();
        // D / A share keys with WASD movement: a player still steering when the ball changes hands must not sim the
        // whole drive or flip Auto Defense by accident — only honour them pre-snap, after the GO prompt has settled
        // keyboard D = SKIP DRIVE (presnap or mid-play) once the defense view has settled for 0.6 s
        if (f.simDrive && (S.modeT > 0.6 || f.device !== 'kbd')) simDrive();
        // (ROUND6 E: no in-game Auto Defense toggle — the A key does nothing)
        break;
      }
      case 'kick': {
        const k = f.kickAim;
        if (k.on || f.kick) {
          const kk = snap.kick || {};
          const d = kk.kx != null && kk.ky != null ? toFieldAt(k.dx, k.dy, kk.kx, kk.ky) : toField(k.dx, k.dy);
          a.kickAim.on = true; a.kickAim.dx = d.x; a.kickAim.dy = d.y; a.kickAim.pow = k.pow;
        } else a.kickAim.on = false;
        a.kick = f.kick;
        if (f.autoKick) Session.autoKick();
        break;
      }
    }
    return a;
  }

  function autopilot(n, snap) {
    const a = S.action;
    if (S.mode === 'defense') {
      if (snap.phase === 'PRESNAP' && S.tNeed > 0.4) a.snap = true;
      if (snap.star && snap.star.ring === 'green') { a.star = true; if (canAbility(snap, 'def')) a.ability = true; }
      return;
    }
    if (S.mode === 'return') { if (S.tNeed > 0.3) a.snap = false; return; }
    if (n && n.k === 'SNAP' && n.side !== 'D') { if (S.tNeed > 0.5) a.snap = true; return; }
    if (S.mode === 'qb' || S.mode === 'carrier' || S.mode === 'kick' || S.mode === 'presnap') {
      if (PT.Engine.Autopilot && PT.Engine.Autopilot.action) PT.Engine.Autopilot.action(S.game, a);
    }
  }

  /**
   * SKIP DRIVE (ROUND6 E): from the defensive play call, presnap or mid-play. The engine finishes the current play
   * instantly and sims the rest of the AI possession, landing on the user's next offensive call (or kickoff return).
   */
  function simDrive() {
    const g = S.game;
    if (!g.simDrive) return false;
    const snap = g.snapshot();
    if (snap.poss === S.userIdx && snap.phase !== 'KICK') return false;    // only while the AI has the ball
    const PC = U().PlayCall;
    if (S.pending === 'PLAYCALL' && PC && PC.close) PC.close();           // tray open → its promise resolves null
    PT.Loop.slowmo(1, 0);
    PT.Input.flush();
    const ok = g.simDrive() !== false;
    S.ring = 'none'; S.needKey = ''; S.ctlKey = '';
    emit('game:simDrive', { gid: S.gid, ok: ok });
    if (g.isOver && g.isOver() && !S.over) onOver(g.box());
    return ok;
  }
  /** Auto-start defense (Settings, L.settings.autoDef) → game.setAutoDef (engine auto-GOes after 1 s). */
  function autoDefOn() { return !!S.settings.autoDef; }      // ROUND6 E: Settings → "Auto-start defense" only (no in-game chip)
  /**
   * The engine's auto-GO counts presnap time from lineup, so turning Auto-start D on (or resuming) at a waiting defensive
   * presnap would GO instantly (HUNT3 #3). Session keeps the engine's autoDef off for 1 s of play first (S.autoDefHold).
   */
  function holdAutoDef() {
    const n = S.game.needs();
    if (autoDefOn() && n && n.k === 'SNAP' && n.side === 'D') { S.autoDefHold = 1.0; syncAutoDef(); }
  }
  function syncAutoDef() {
    const on = autoDefOn() && !(S.autoDefHold > 0);
    if (on !== S.autoDefSent && typeof S.game.setAutoDef === 'function') { S.game.setAutoDef(on); S.autoDefSent = on; }
  }


  function modeFor(snap, n) {
    if (Session.debugForceMode && snap.phase === 'LIVE' && snap.poss === S.userIdx) return Session.debugForceMode;
    if (n && n.k === 'SNAP') return n.side === 'D' ? 'defense' : 'presnap';
    if (n && (n.k === 'KICK_AIM' || n.k === 'KICK_METER')) return 'kick';
    if (snap.hud && snap.hud.retHint) return 'return';
    // the user controls a ball carrier: kick/punt returner after the catch, or a defender after an interception
    if (snap.phase === 'LIVE' || snap.phase === 'KICK') {
      const c0 = ctlEnt(snap);
      if (c0 && c0.tm === S.userIdx && c0.ball && (snap.poss !== S.userIdx || snap.phase === 'KICK')) return 'carrier';
    }
    const userO = snap.poss === S.userIdx;
    if (!userO) return snap.phase === 'PRESNAP' || snap.phase === 'LIVE' ? 'defense' : 'off';
    if (snap.phase !== 'LIVE') return 'off';
    const c = ctlEnt(snap);
    if (!c) return 'off';
    if (c.pos === 'QB' && c.ball && snap.ball.st !== 'air' && (c.y - snap.los) * snap.dir <= 0.05) return 'qb';
    return 'carrier';
  }

  function postStep(snap, n) {
    S.lastPossUser = snap.poss === S.userIdx;
    const m = modeFor(snap, n);
    setMode(m, n && n.k);
    // Pace (client: "only ~1 s to respond"): live play runs slower than real time. Offense / kicks / returns use the
    // device GAME SPEED (prefs.speed: 0.7 Relaxed, 0.8 Normal (default), 1.0 Fast); defense uses its watch speed
    // (L.settings.watch, default 0.8×; » = 2×). Pre-snap, play calls and dead balls run at 1×. Engine windows (Star
    // ring, abilities) are in game time, so they get proportionally longer in real time. bigPlay slow-mo stacks on top.
    const live = snap.phase === 'LIVE' || snap.phase === 'KICK';
    const watching = m === 'defense' && snap.phase === 'LIVE';
    let sc = watching ? (S.fast || S.fastHold ? 2 : S.watch) : live ? S.speed : 1;
    if (S.phaseT) { const pk = watching ? 'LIVE_D' : snap.phase; S.phaseT[pk] = (S.phaseT[pk] || 0) + PT.C.DT; }   // game-time per phase (debug/pace)
    // keep reaction windows fair in REAL time: never faster than 1× while the ring is green or an ability can fire
    if (watching && sc > 1 && ((snap.star && snap.star.ring === 'green') || canAbility(snap, 'def'))) sc = 1;
    PT.Loop.setTimeScale(sc);
    // Star Play ring (R9)
    const st = snap.star;
    if (st && !S.engStar) {
      if (st.ring !== S.ring) {
        if (st.ring === 'green') {
          emit('game:starRing', { on: true, ring: 'green', idx: st.idx, gid: S.gid });
          if (!S.fast && !reduceMotion()) PT.Loop.slowmo(0.5, 0.8);
          haptic(10);
        } else if (st.ring === 'used') {
          PT.Loop.slowmo(1, 0);
          S.starPlays++;
          emit('game:starPlay', { result: 'super', idx: st.idx, gid: S.gid });
          haptic(30);
        }
        S.ring = st.ring;
      }
    }
  }

  // ---------------- Star abilities + audibles (STAR_ABILITIES 3, 7) ----------------
  /** meter full for the user's side? game.canAbility() when present, else snap.meters.u[side] ≥ 100 */
  function canAbility(snap, side) {
    const g = S.game;
    try { if (typeof g.canAbility === 'function') return !!g.canAbility(); } catch (e) { /* fall through */ }
    const m = snap && snap.meters && snap.meters.u;
    return !!(m && m[side] >= 100);
  }
  /** audible tray: UI owns it (PlayCall.audible / Hud.audible); otherwise 'game:audibleOpen' is emitted */
  function openAudible() {
    const opts = Session.audibleOptions();
    if (!opts) return;
    const PC = U().PlayCall, H = U().Hud;
    const ui = PC && typeof PC.audible === 'function' ? PC.audible.bind(PC) : H && typeof H.audible === 'function' ? H.audible.bind(H) : null;
    // HUNT4 #4: no Auto-start GO while the audible tray is open; afterwards 1 s grace and push the real controls again
    S.audibleOpen = true; S.autoDefHold = Infinity; syncAutoDef();
    const g = S.game;
    const done = () => { if (!S || S.game !== g) return; S.audibleOpen = false; S.autoDefHold = 1.0; S.ctlKey = ''; syncAutoDef(); };
    if (!ui) { emit('game:audibleOpen', opts); done(); return; }
    Promise.resolve(ui(opts)).then((id) => { if (id && S && S.game === g) Session.audible(id); done(); }, done);
  }
  /**
   * The 4 audible suggestions for the user's side, valid pre-snap. @returns {{side, cards:PlayCard[], gid}|null}
   */
  Session.audibleOptions = function () {
    if (!S) return null;
    const g = S.game, snap = g.snapshot();
    if (snap.phase !== 'PRESNAP') return null;
    const side = snap.poss === S.userIdx ? 'O' : 'D';
    let cards = null;
    try { cards = g.options(side, { audible: true }); } catch (e) { cards = null; }
    if (!cards || !cards.length) return null;
    return { side: side, cards: cards.slice(0, 4), gid: S.gid, used: !!(snap.hud && snap.hud.audibled) };
  };
  /** Change the call pre-snap (once per play; the engine validates). @returns {boolean} */
  Session.audible = function (id) {
    if (!S || typeof S.game.audible !== 'function') return false;
    let ok = false;
    try { ok = S.game.audible(id) !== false; } catch (e) { ok = false; }
    if (ok) emit('game:audibleCall', { id: id, gid: S.gid });
    return ok;
  };
  /** live-play game speed from device prefs (0.5..1.5, default 0.8) */
  function speedPref() { const v = +prefs().speed; return v >= 0.5 && v <= 1.5 ? v : 0.8; }
  /**
   * Set the live-play GAME SPEED (0.7 Relaxed / 0.8 Normal / 1.0 Fast). Persisted per device in prefs.speed;
   * applies immediately to a running game. @returns {number} the speed in use
   */
  Session.setSpeed = function (x) {
    const v = x >= 0.5 && x <= 1.5 ? x : 0.8;
    if (PT.Save && PT.Save.setPrefs) PT.Save.setPrefs({ speed: v });     // emits app:prefs → running session updates
    if (S) S.speed = v;
    return v;
  };
  Session.speed = function () { return S ? S.speed : speedPref(); };
  Session.SPEEDS = [{ v: 0.7, label: 'Relaxed' }, { v: 0.8, label: 'Normal' }, { v: 1.0, label: 'Fast' }];
  /** HUD STAR button / gamepad Y: same as PT.Input.press('ability') */
  Session.ability = function () { PT.Input.press('ability'); };

  // ---------------- #touch overlay: Easy Throw badges (the onside choice is the HUD's Kick deep / Onside tray) ----------------
  function overlay() {
    if (S.ov !== null) return S.ov;
    const doc = globalThis.document, layer = doc && doc.getElementById('touch');
    if (!layer) { S.ov = false; return false; }
    const root = doc.createElement('div'); root.className = 'pt-ov';
    const badges = [];
    for (let n = 1; n <= 4; n++) {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'pt-badge pt-badge-' + n; b.textContent = n;
      b.setAttribute('data-testid', 'badge-' + n); b.setAttribute('aria-label', 'Throw to ' + ['', 'WR1', 'WR2', 'TE', 'RB'][n]);
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); PT.Input.press('pass' + n); });
      root.appendChild(b); badges.push(b);
    }
    layer.appendChild(root);
    S.ov = { root: root, badges: badges, shown: '' };
    return S.ov;
  }
  function removeOverlay(s) { if (s.ov && s.ov.root) s.ov.root.remove(); }
  function updateOverlay(snap) {
    const ov = overlay();
    if (!ov) return;
    const showBadges = S.mode === 'qb' && !!S.settings.easyThrow && !(PT.App && PT.App.noGL);
    for (let n = 0; n < 4; n++) {
      const b = ov.badges[n];
      let e = null;
      if (showBadges) for (const x of snap.ents) { if (x.tm === S.userIdx && x.badge === n + 1) { e = x; break; } }
      const p = e && R().fieldToScreen(e.x, e.y, 2.4);
      if (p && isFinite(p.x) && isFinite(p.y)) {       // clamp to the screen edge so deep/wide receivers stay tappable
        const W = globalThis.innerWidth || 800, H = globalThis.innerHeight || 600;
        const x = Math.max(30, Math.min(W - 30, p.x)), y = Math.max(70, Math.min(H - 30, p.y));
        b.style.display = 'block'; b.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
      else if (b.style.display !== 'none') b.style.display = 'none';
    }
  }
  /** Onside kick (offered by the engine via snap.hud.onside: user kicking, Q4, trailing). Also key O. */
  Session.onside = function () {
    if (!S || typeof S.game.onside !== 'function') return false;
    const ok = S.game.onside();
    if (ok !== false) emit('game:onsideCall', { gid: S.gid });
    return ok;
  };

  // ---------------- tickable ----------------
  const tickable = {
    tick: function (dt) {
      if (!S || S.paused) return;
      const g = S.game;
      if (S.over) { S.endT += dt; if (S.endT >= 2.2 && !S.finishing) finish(); return; }
      if (S.pending) return;
      const n = g.needs();
      const nk = n ? n.k + (n.side || '') : '';
      if (nk !== S.needKey) { S.needKey = nk; S.tNeed = 0; S.needSeq++; } else S.tNeed += dt;
      S.modeT = (S.modeT || 0) + dt;
      if (S.autoDefHold > 0 && S.autoDefHold !== Infinity) { S.autoDefHold -= dt; if (S.autoDefHold <= 0) syncAutoDef(); }
      if (n && handleNeed(n)) return;
      const f = PT.Input.sample();
      if (f.pause) { Session.pause(); return; }
      if (f.onside) Session.onside();
      S.fastHold = !!f.ffHeld;
      const snap0 = g.snapshot();
      buildAction(f, snap0);
      if (S.autoplay) autopilot(n, snap0);
      const a = S.action;
      if (a.throw || a.kick || a.star || a.snap || a.pass != null || a.ability) {
        emit('input:action', { k: a.throw ? 'throw' : a.kick ? 'kick' : a.ability ? 'ability' : a.star ? 'star' : a.snap ? 'snap' : 'pass', mode: S.mode,
          tx: a.aim.tx, ty: a.aim.ty, pow: a.throw ? a.aim.pow : a.kick ? a.kickAim.pow : 0, lob: a.lob, pass: a.pass, mx: a.mx, my: a.my, sprint: a.sprint });
      }
      const t0 = now();
      g.step(dt, a);
      S.engMs = S.engMs * 0.9 + (now() - t0) * 0.1;
      if (!S) return;                                 // gameEnd → finish() can't run here, but be safe
      postStep(g.snapshot(), g.needs());
      if (!S.over && g.isOver && g.isOver()) onOver(g.box());
    },
    draw: function (alpha, real) {
      if (!S) return;
      const snap = S.game.snapshot();
      if (R() && !(PT.App && PT.App.noGL)) R().draw(snap, alpha, real);
      const H = U().Hud;
      if (H && H.update) H.update(snap.hud, snap);
      if (PT.Debug && PT.Debug.frame) PT.Debug.frame(snap);
      updateOverlay(snap);
    }
  };

  function onOver(box) {
    if (!S || S.over) return;
    S.over = true; S.endT = 0;
    S.box = box || S.game.box();
    setMode('off');
    PT.Loop.setTimeScale(1);
    const b = S.box, us = S.userIdx === 0 ? b.hs : b.as, them = S.userIdx === 0 ? b.as : b.hs;
    if (us > them) haptic([60, 40, 60, 40, 120]);
  }

  function cleanup(won) {
    const s = S;
    if (!s) return;
    s.unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    s.timers.forEach((t) => clearTimeout(t));
    S = null;
    removeOverlay(s);
    try { s.game.destroy(); } catch (e) { /* ignore */ }
    PT.Input.setMode('menu');
    const Ui = U();
    if (Ui.PlayCall && Ui.PlayCall.close) Ui.PlayCall.close();
    if (Ui.Hud && Ui.Hud.hide) Ui.Hud.hide();
    if (R() && !(PT.App && PT.App.noGL)) { R().unloadGame(); R().setScene('menu'); }
    PT.Loop.setTimeScale(1); PT.Loop.slowmo(1, 0); PT.Loop.pause(false);
    if (PT.App && PT.App.menuTickable) PT.Loop.start(PT.App.menuTickable);
    const de = globalThis.document && globalThis.document.documentElement;
    if (de) de.classList.remove('pt-ingame');
    emit('game:exit', { gid: s.gid, won: !!won });
  }

  function userWon(box) {
    if (!box || !S) return false;
    return S.userIdx === 0 ? box.hs > box.as : box.as > box.hs;
  }

  function finish() {
    const s = S;
    s.finishing = true;
    const box = s.box;
    const won = userWon(box);
    let res = null;
    flushAch();
    try { res = PT.League.Games.record(s.L, s.gid, box); }
    catch (e) { if (PT.Log) PT.Log.error('session', 'record failed', e); }
    cleanup(won);
    if (PT.App && PT.App.save) PT.App.save({ auto: true, inGame: null });
    emit('game:recorded', { gid: s.gid, box: box, res: res });
    s.resolve(box);
  }

  /** User coach data the engine reads from cfg (WP3): coachSk, coachMods, coachLvl, unlocked (play ids). */
  function addCoach(L, cfg) {
    if (L && L.settings && L.settings.autoReturn != null) {          // returns (WP3): keep the AI returner
      cfg.settings = cfg.settings || {};
      if (cfg.settings.autoReturn == null) cfg.settings.autoReturn = !!L.settings.autoReturn;
    }
    const co = L && L.coach;
    if (co && typeof co === 'object') {
      if (cfg.coachSk == null && co.sk) cfg.coachSk = Object.assign({}, co.sk);
      if (cfg.coachLvl == null && co.lvl != null) cfg.coachLvl = co.lvl;
    }
    const Co = PT.League && PT.League.Coach;
    try { if (cfg.unlocked == null && Co && typeof Co.unlockedPlays === 'function') cfg.unlocked = Co.unlockedPlays(L); } catch (e) { /* optional */ }
    try { if (cfg.coachMods == null && Co && typeof Co.mods === 'function') cfg.coachMods = Co.mods(L); } catch (e) { /* optional */ }
  }

  /** createGame opts: debug + the user's Coach skill mods (WP2 Coach.mods) + Season Twist fx (feature-detected). */
  function engineOpts(L, cfg) {
    const o = { debug: !!(PT.Debug && PT.Debug.enabled), idle: false };    // idle:false → the engine never auto-plays the user side
    try { const C = PT.League && PT.League.Coach; if (C && typeof C.mods === 'function') o.coachMods = C.mods(L); } catch (e) { /* optional */ }
    try { const T = PT.Data && PT.Data.Twists; const tw = cfg.twist && T && T.byId ? T.byId(cfg.twist) : null; if (tw && tw.fx) o.twistFx = tw.fx; } catch (e) { /* optional */ }
    return o;
  }

  // ---------------- public API ----------------
  /**
   * Play one user game. Resolves with the final BoxScore after it is recorded (or after "sim the rest").
   * @param {League} L @param {number} gid @returns {Promise<BoxScore|null>}
   */
  Session.start = function (L, gid) {
    if (S) return Promise.reject(new Error('[Session] a game is already running'));
    const G = PT.League.Games;
    const st = G.startUserGame ? G.startUserGame(L, gid) : { ok: true };
    if (st && st.ok === false) return Promise.reject(new Error(st.msg || 'Cannot start game'));
    const cfg = G.config(L, gid);
    addCoach(L, cfg);
    const p = prefs();
    const game = PT.Engine.createGame(cfg, engineOpts(L, cfg));
    const userIdx = cfg.userTid === cfg.home.tid ? 0 : 1;
    const flagFF = PT.Flags && PT.Flags.ff > 0 ? PT.Flags.ff : 0;
    S = {
      L: L, gid: gid, cfg: cfg, game: game, userIdx: userIdx, userTid: cfg.userTid,
      oppTid: userIdx === 0 ? cfg.away.tid : cfg.home.tid,
      settings: Object.assign({}, (L && L.settings) || {}, cfg.settings || {}),
      action: blankAction(), pl: plIndex(cfg), mode: '', ctlKey: '', pending: null, paused: false, over: false, finishing: false,
      fast: false, fastHold: false, watch: flagFF || (L && L.settings && L.settings.watch) || 0.8, speed: speedPref(), phaseT: {}, ring: 'none', playJukes: 0, starPlays: 0, achDone: false, needKey: '', tNeed: 0, needSeq: 0, kickAsk: -1,
      endT: 0, engMs: 0, unsubs: [], timers: [], autoplay: Session.autoplay, autoDef: false, lastPossUser: true,
      autoDefSent: null, jukeBase: 0, ov: null, rng: PT.RNG.create(PT.RNG.hash ? PT.RNG.hash(cfg.seed, 'session') : (cfg.seed ^ 0x5eed) >>> 0)
    };
    S.maxThrow = maxThrow();
    const promise = new Promise((res, rej) => { S.resolve = res; S.reject = rej; });
    S.unsubs.push(PT.Events.on('app:prefs', (p) => { if (S && p && p.speed) S.speed = speedPref(); }));
    S.unsubs.push(PT.Events.on('league:changed', (e) => {     // in-game settings (HUD gear): watch speed, auto defense, lefty
      if (!S || !e || e.what !== 'settings' || !L.settings) return;
      const was = autoDefOn();
      Object.assign(S.settings, L.settings);
      if (!was && autoDefOn()) holdAutoDef();
      syncAutoDef();
      if (L.settings.watch && !flagFF) S.watch = L.settings.watch;
      PT.Input.setOptions({ lefty: !!S.settings.lefty, aimMode: S.settings.aimMode || 'sling' });
      S.ctlKey = '';
    }));
    ENGINE_EVENTS.forEach((name) => { const u = game.on(name, (pl) => onEngine(name, pl)); if (typeof u === 'function') S.unsubs.push(u); });
    if (PT.App && PT.App.save) PT.App.save({ auto: true, inGame: gid });     // a crash/reload → "interrupted" flow
    const homeTeam = L.teams && L.teams[cfg.home.tid];
    if (R() && !(PT.App && PT.App.noGL)) {
      R().loadGame({ home: cfg.home, away: cfg.away, weather: cfg.weather, userTid: cfg.userTid,
        stadium: { lvl: (homeTeam && homeTeam.fac && homeTeam.fac.std) || 1, homeCol: cfg.home.col.pri, clim: homeTeam && homeTeam.clim,
          name: homeTeam && homeTeam.stad }, clim: homeTeam && homeTeam.clim });
      R().setScene('game');
    }
    const H = U().Hud;
    if (H && H.show) H.show({ home: cfg.home, away: cfg.away, userTid: cfg.userTid, gid: gid, settings: S.settings, weather: cfg.weather, mode: (L && L.tmp) || null });
    PT.Input.setOptions({ lefty: !!S.settings.lefty, aimMode: S.settings.aimMode || 'sling' });
    PT.Input.setMode('off');
    const de = globalThis.document && globalThis.document.documentElement;
    if (de) de.classList.add('pt-ingame');
    emit('game:start', { gid: gid, home: cfg.home.tid, away: cfg.away.tid, userTid: cfg.userTid, weather: cfg.weather, po: cfg.po,
      crowd: crowdLevel(L, cfg), horn: hornFor(L, cfg.home.tid), userSide: null });
    syncAutoDef();
    PT.Loop.pause(false);
    PT.Loop.start(tickable);
    return promise;
  };

  /**
   * Freeze the game. The pause MENU belongs to the HUD (WP5): Hud.pauseMenu(true) calls back Session.pause(),
   * Hud.pauseMenu(false) calls Session.resume(). When Session pauses on its own (Input pause edge, tab hidden,
   * context lost) it asks the HUD to show the menu; without a HUD pause menu it falls back to a Modal.
   * @param {{menu?:boolean}} [o] menu:false = freeze silently (fatal error overlay)
   */
  Session.pause = function (o) {
    if (!S || S.paused || S.over) return;
    const H = U().Hud, hudMenu = !!(H && H.pauseMenu && (!H.active || H.active()));
    const wantMenu = !(o && o.menu === false);
    if (wantMenu && hudMenu && !S.hudCall && !(H.paused && H.paused())) {
      S.hudCall = true;
      try { H.pauseMenu(true); } finally { if (S) S.hudCall = false; }
      if (!S || S.paused) return;                  // the HUD called back into Session.pause()
    }
    S.paused = true;
    PT.Loop.pause(true);
    PT.Input.setMode('off');
    emit('game:pause', { on: true, gid: S.gid });
    if (!wantMenu || hudMenu) return;
    const g = S.game, sit = g.situation(), M = U().Modal;
    const score = S.cfg.home.abbr + ' ' + sit.hs + ' - ' + sit.as + ' ' + S.cfg.away.abbr + ' · Q' + sit.q + ' ' + PT.Util.fmtClock(sit.clk);
    const p = M && M.open ? M.open({ title: 'Paused', body: score, buttons: [
      { label: 'Resume', value: 'resume', kind: 'primary', testid: 'btn-resume' },
      { label: 'Sim Rest of Game', value: 'simRest', testid: 'btn-sim-rest' },
      { label: 'Quit to HQ', value: 'quit', kind: 'danger', testid: 'btn-quit-game' }] }) : Promise.resolve('resume');
    Promise.resolve(p).then((v) => {
      if (!S || S.game !== g || !S.paused) return;
      if (v === 'simRest' || v === 'quit') Session.quit({ simRest: true });
      else Session.resume();
    });
  };

  /** Unfreeze. If the HUD pause menu is up, it is closed too (it calls back here). */
  Session.resume = function () {
    if (!S || !S.paused) return;
    const H = U().Hud;
    if (H && H.pauseMenu && H.paused && H.paused() && !S.hudCall) {
      S.hudCall = true;
      try { H.pauseMenu(false); } finally { if (S) S.hudCall = false; }
      if (!S || !S.paused) return;
    }
    S.paused = false;
    PT.Loop.pause(false);
    PT.Input.setMode(S.mode || 'off');
    PT.Input.flush();
    PT.Input.guard(350, true);                      // HUNT4 #3: a double tap on RESUME must not snap the ball
    holdAutoDef();
    emit('game:pause', { on: false, gid: S.gid });
  };

  /** HUD helpers (defense tray / kick button) */
  Session.skipPlay = function () { if (S && S.game.skipPlay) S.game.skipPlay(); };
  /** SKIP DRIVE: works from the defensive play call, presnap and mid-play. @returns {boolean} */
  Session.simDrive = function () { return S ? simDrive() : false; };
  Session.autoKick = function () { if (!S || !S.game.autoKick) return; const n = S.game.needs(); if (n && n.k === 'KICK_AIM') S.game.autoKick(); };

  /**
   * Leave the game. simRest (default true): StatSim the rest from game.partial() and record it (design: quitting
   * auto-sims from the current score). simRest:false abandons (sched game stays 'L' → interrupted flow).
   * @returns {BoxScore|null}
   */
  Session.quit = function (o) {
    if (!S) return null;
    const s = S;
    const simRest = !o || o.simRest !== false;
    let box = null;
    if (simRest) flushAch();
    if (simRest) {
      let partial = null;
      try { partial = s.over ? null : s.game.partial(); } catch (e) { partial = null; }
      if (s.over && s.box) {
        try { PT.League.Games.record(s.L, s.gid, s.box); } catch (e) { if (PT.Log) PT.Log.error('session', e); }
        box = s.box;
      } else {
        try { box = PT.League.Games.simUserGame(s.L, s.gid, partial || undefined); }
        catch (e) {
          if (PT.Log) PT.Log.warn('session', 'sim from partial failed, simming from scratch', e && e.message);
          box = PT.League.Games.simUserGame(s.L, s.gid);
        }
      }
    }
    cleanup(userWonBox(s, box));
    if (simRest && PT.App && PT.App.save) PT.App.save({ auto: true, inGame: null });
    emit('game:recorded', { gid: s.gid, box: box, simmed: true });
    s.resolve(box);
    return box;
  };
  function userWonBox(s, box) { return !!box && (s.userIdx === 0 ? box.hs > box.as : box.as > box.hs); }

  /** debug: end the current game as a win for the user (StatSim from a winning partial) */
  Session.debugWin = function () {
    if (!S) return null;
    let part = {};
    try { part = S.game.partial() || {}; } catch (e) { part = {}; }
    const lead = Math.max(part.hs || 0, part.as || 0) + 14;
    part = Object.assign({}, part, { q: 4, clk: 0 });
    if (S.userIdx === 0) part.hs = lead; else part.as = lead;
    flushAch();
    const s = S;
    let box;
    try { box = PT.League.Games.simUserGame(s.L, s.gid, part); } catch (e) { box = PT.League.Games.simUserGame(s.L, s.gid); }
    cleanup(true);
    if (PT.App && PT.App.save) PT.App.save({ auto: true, inGame: null });
    s.resolve(box);
    return box;
  };

  Session.active = function () { return !!S; };
  Session.gid = function () { return S ? S.gid : null; };
  Session.game = function () { return S ? S.game : null; };
  Session.isPaused = function () { return !!(S && S.paused); };
  Session.setAutoplay = function (on) { Session.autoplay = !!on; if (S) S.autoplay = !!on; };
  Session.setWatchSpeed = function (x) { if (S) S.watch = x > 0 ? x : 0.8; };
  /** debug/test snapshot of the session state */
  Session.state = function () {
    if (!S) return null;
    const snap = S.game.snapshot();
    return { gid: S.gid, mode: S.mode, pending: S.pending, paused: S.paused, over: S.over, fast: S.fast, watch: S.watch, speed: S.speed,
      phaseT: Object.assign({}, S.phaseT),
      phase: snap.phase, userIdx: S.userIdx, poss: snap.poss, engMs: +S.engMs.toFixed(3), maxThrow: S.maxThrow, autoplay: S.autoplay,
      action: JSON.parse(JSON.stringify(S.action)) };
  };
  Session._tickable = tickable;

  // tab hidden → pause + autosave with inGame (ARCHITECTURE 4)
  if (globalThis.document) {
    globalThis.document.addEventListener('visibilitychange', () => {
      if (globalThis.document.visibilityState !== 'hidden' || !S) return;
      if (!S.paused && !S.over) Session.pause();
      if (PT.App && PT.App.save) PT.App.save({ auto: true, inGame: S.gid });
    });
  }
})(globalThis.PT = globalThis.PT || {});
