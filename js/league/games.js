/* Pixel Touchdown: js/league/games.js
 * Owner: WP1. Responsibility: PT.League.Games: GameConfig builder, recordResult (stats into players).
 *
 * GameConfig contract (League → Engine / StatSim), see schema.js GameConfig/GameTeam:
 *  - GameTeam.pl[].r ALREADY includes franchise-side modifiers ("baked", listed in GameTeam.bake):
 *      Mood (≥ 80 Happy +2 all skills, < 30 Grumpy −3, design 13.1), Team Spirit (≥ 75 +2 Smarts, ≤ 25 −2, 13.3),
 *      Play Hurt (p.inj.ph: −10% Sprain / −15% Hurt, 12.3), and in the USER's played games the AI opponent's
 *      difficulty delta (Rookie −4, Pro 0, Legend +3, design 16).
 *  - Game-context effects are NOT baked (engine/StatSim apply them): home field (8.17, cfg.neutral, GameTeam.hype/std),
 *    coach stars (GameTeam.coach), weather (cfg.weather), traits/species quirks, close-game / playoff traits, twist.
 *  - qLen = QUARTER length in seconds (L.settings.qLen: 120 / 180 / 300 = 2 / 3 / 5 min quarters; default 180; 4 quarters).
 *  - weather = { k, wx, wy, mph }: k ∈ PT.C.WEATHER, (wx, wy) = wind velocity in yd/s in field space, mph = speed.
 *    The weather of a played/started game is also stored on the schedule entry (sched.wx).
 *  - With real WP2, franchise modifiers come from Spirit.gameMods(L, tid) (Mood, Spirit Smarts, next-game event effects,
 *    QB Whisperer, play-hurt multiplier); benched players (event) do not start. GameTeam also carries q1, edge, oppEdge,
 *    snowImm (user next-game effects for the engine) and injMult (Injuries.chanceMult team multiplier, or null).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Games = PT.ns('League.Games');
  const Q = () => PT.League.Q;

  const ok = (o) => Object.assign({ ok: true }, o || {});
  const fail = (err, msg) => ({ ok: false, err: err, msg: msg });
  const clampS = (v) => Math.max(1, Math.min(99, Math.round(v)));

  /** Offensive style play mix (design 6.2): IRUN ORUN SHORT DEEP SCREEN PA TRICK (%) */
  Games.STYLE_MIX = {
    air: { IRUN: 12, ORUN: 8, SHORT: 35, DEEP: 25, SCREEN: 8, PA: 7, TRICK: 5 },
    ground: { IRUN: 35, ORUN: 20, SHORT: 15, DEEP: 8, SCREEN: 5, PA: 15, TRICK: 2 },
    west: { IRUN: 20, ORUN: 15, SHORT: 38, DEEP: 10, SCREEN: 9, PA: 6, TRICK: 2 },
    trick: { IRUN: 12, ORUN: 18, SHORT: 25, DEEP: 12, SCREEN: 8, PA: 10, TRICK: 15 },
    speed: { IRUN: 13, ORUN: 25, SHORT: 30, DEEP: 14, SCREEN: 10, PA: 5, TRICK: 3 }
  };
  /** Style matchup (design 7.5), defense row vs offense column, + = defense advantage */
  Games.STYLE_MATCHUP = {
    wall: { air: -1, ground: 1, west: 0, trick: 0.5, speed: -0.5 },
    nofly: { air: 1, ground: -1, west: 0.5, trick: -0.5, speed: 0 },
    wild: { air: 1, ground: 0, west: -1, trick: 0.5, speed: -0.5 },
    think: { air: -0.5, ground: -0.5, west: 0.5, trick: 0.5, speed: 0.5 }
  };
  /** run share (IRUN + ORUN) / 100 */
  Games.runShare = (off) => { const m = Games.STYLE_MIX[off] || Games.STYLE_MIX.west; return (m.IRUN + m.ORUN) / 100; };
  /** AI opponent skill delta in the user's played games (design 16) */
  Games.DIFF_AI_SKILLS = [-4, 0, 2, 3];          // Beginner, Normal, Expert (= Pro + 0.75 × (Legend − Pro), rounded), Legend
  /** Quick-sim user team bonus (design 16 "Sim Game") */
  Games.DIFF_SIM_BONUS = [2, 0, -0.75, -1];

  // ---------------- twists (WP2 owns the ids; matched loosely by name) ----------------
  const TWIST_KEYS = ['normal_season', 'windy_year', 'snow_globe', 'butterfinger_season', 'rookie_rush', 'cap_boom', 'cap_crunch',
    'kicker_chaos', 'ground_war', 'air_show', 'injury_bug', 'iron_year', 'fan_frenzy', 'golden_ticket', 'two_point_party',
    'speedy_season', 'trade_frenzy', 'rivalry_season', 'long_bomb_bonus', 'mystery_weather'];
  /** Canonical twist key (design 14.2 name in snake_case) for a twist id, e.g. 'windy' → 'windy_year'. */
  Games.twistKey = function (id) {
    if (!id) return 'normal_season';
    const norm = String(id).toLowerCase().replace(/[^a-z]/g, '');
    let name = '';
    const D = PT.Data.Twists;
    if (D && D.list) { const d = D.list.find((t) => t.id === id); if (d && d.name) name = String(d.name).toLowerCase().replace(/[^a-z]/g, ''); }
    for (const k of TWIST_KEYS) {
      const kn = k.replace(/_/g, '');
      const first = k.split('_')[0];
      if (norm === kn || name === kn) return k;
      if (norm.indexOf(first.slice(0, 4)) === 0 && (first !== 'cap' && first !== 'rookie' ? true : norm === kn)) return k;
    }
    return norm || 'normal_season';
  };

  /** Twist effects for the quick sim / weather: PT.Data.Twists fx when present (WP2), else design 14.2 defaults. */
  const FX_FALLBACK = {
    windy_year: { windMult: 1.5, windChance: 2 }, snow_globe: { snowMult: 2, snowEarly: true }, butterfinger_season: { fumbleMult: 1.3 },
    kicker_chaos: { fg50Pts: 4 }, ground_war: { shedTime: 0.3 }, air_show: { ballSpeed: 1.05, catchBonus: 0.03 },
    injury_bug: { injMult: 1.25 }, iron_year: { injMult: 0.75 }, two_point_party: { twoPtFrom: 1, xpFrom: 20 },
    speedy_season: { spd: 2 }, mystery_weather: { mystery: true }
  };
  Games.twistFx = function (id) {
    const D = PT.Data.Twists;
    const d = D && D.list ? D.list.find((t) => t.id === id) : null;
    if (d && d.fx && Object.keys(d.fx).length) return d.fx;
    return FX_FALLBACK[Games.twistKey(id)] || {};
  };

  // ---------------- weather (design 14.1) ----------------
  const WX = ['sunny', 'cloudy', 'rain', 'wind', 'fog', 'snow'];
  const WX_TABLE = {
    warm: [[1, 99, [55, 20, 12, 10, 3, 0]]],
    mild: [[1, 12, [40, 25, 18, 12, 5, 0]], [13, 99, [35, 25, 18, 12, 5, 5]]],
    cold: [[1, 8, [40, 30, 15, 12, 3, 0]], [9, 99, [25, 20, 8, 15, 2, 30]]],
    rainy: [[1, 12, [20, 25, 35, 8, 12, 0]], [13, 99, [20, 20, 35, 8, 12, 5]]]
  };
  Games.WX_TABLE = WX_TABLE;
  const MPH_TO_YDS = 0.48889;

  /**
   * Forecast / game weather (rolled from the home climate and week; deterministic per game). A schedule entry may pin it
   * with `wxSet` ({k, wx, wy, mph}; used by Quick Game).
   * @returns {{k:string, wx:number, wy:number, mph:number}}
   */
  Games.weather = function (L, gid) {
    const g = Q().game(L, gid);
    if (!g) throw new Error('[Games] no game ' + gid);
    if (g.wxSet && typeof g.wxSet === 'object') return Object.assign({}, g.wxSet);     // Quick Game: weather picked by the player
    const clim = g.po === C.PLAYOFF_ROUNDS ? 'dome' : L.teams[g.h].clim;
    if (clim === 'dome') return { k: 'clear', wx: 0, wy: 0, mph: 0 };
    const rng = PT.RNG.create(PT.RNG.hash(L.seed, L.season, gid, 'wx'));
    const fx = Games.twistFx(L.twist && L.twist.id);
    let w;
    if (fx.mystery) w = [1, 1, 1, 1, 1, 1];
    else {
      const rows = WX_TABLE[clim] || WX_TABLE.mild;
      w = (rows.find((r) => g.wk >= r[0] && g.wk <= r[1]) || rows[rows.length - 1])[2].slice();
      if (fx.windChance) w[3] *= fx.windChance;
      if (fx.snowEarly && clim === 'cold' && !w[5]) w[5] = 15;
      if (fx.snowMult && (clim === 'cold' || clim === 'mild')) w[5] *= fx.snowMult;
    }
    const k = rng.weighted(WX.map((x, i) => [x, w[i]]));
    let mph = k === 'wind' ? rng.int(12, 25) : rng.int(0, 8);
    if (fx.windMult) mph = Math.round(mph * fx.windMult);
    const ang = rng.int(0, 7) * Math.PI / 4;
    const r2 = (v) => Math.round(v * 100) / 100;
    return { k: k, wx: r2(Math.sin(ang) * mph * MPH_TO_YDS), wy: r2(Math.cos(ang) * mph * MPH_TO_YDS), mph: mph };
  };

  // ---------------- lineups / GameTeam ----------------
  /**
   * The lineup a team would use now: slot lists filtered to healthy players, every slot filled (subs, then best natural
   * fit, then anyone), a player starts in one field slot only, K players only at K. KR may be a starter.
   * @returns {Object<string,number[]>}
   */
  Games.lineup = function (L, tid, noStart) {
    const t = L.teams[tid];
    const benched = {};
    (noStart || []).forEach((pid) => { benched[pid] = true; });
    const pl = Q().roster(L, tid).filter((p) => Q().isHealthy(p));
    const ids = {};
    pl.forEach((p) => { ids[p.id] = p; });
    const dc = {};
    const starting = {};
    const R = PT.League.Ratings;
    const order = PT.League.Roster.AUTO_ORDER.concat(['KR']);
    order.forEach((s) => {
      let list = (t.dc[s] || []).filter((pid) => ids[pid] && (s === 'K' || ids[pid].pos !== 'K'));
      if (s !== 'KR') {
        const st = list.find((pid) => !starting[pid] && !benched[pid]);
        list = st != null ? [st].concat(list.filter((x) => x !== st)) : [];
      }
      if (!list.length) {
        const pos = C.SLOT_POS[s];
        const cand = pl.filter((p) => (s === 'KR' || (!starting[p.id] && !benched[p.id])) && (s === 'K' || p.pos !== 'K'))
          .sort((a, b) => (R.slotOvr(b, s) - R.slotOvr(a, s)) || (a.id - b.id));
        const nat = pos ? cand.filter((p) => R.isNatural(p, pos)) : cand;
        const pick = nat[0] || cand[0] || pl[0];
        if (pick) list = [pick.id];
      }
      if (s !== 'KR' && list.length) starting[list[0]] = s;
      dc[s] = list.slice(0, s === 'KR' ? 1 : 1 + C.SUBS_PER_SLOT);
    });
    const out = {};
    C.SLOTS.forEach((s) => { out[s] = dc[s] || []; });
    return out;
  };

  /** team injury chance multiplier (WP2 Injuries.chanceMult: medical, difficulty, practice, events, twist) or null */
  function injMultOf(L, tid) {
    const I = PT.League.Injuries;
    return I && typeof I.chanceMult === 'function' && !I.chanceMult.__stub ? I.chanceMult(L, null, { team: tid }) : null;
  }

  /** franchise-side skill modifiers for one player in a game (fallback when WP2 Spirit.gameMods is absent) */
  function bakedSkills(p, t, diffDelta) {
    let all = diffDelta || 0;
    if (p.mor >= 80) all += 2; else if (p.mor < 30) all -= 3;
    const r = {};
    let mult = 1;
    if (p.inj && (p.ph || p.inj.ph) && p.inj.w > 0) mult = p.inj.sev >= 3 ? 0.85 : 0.9;
    for (const k of C.RATINGS) r[k] = clampS(p.r[k] * mult + all);
    if (t.spirit >= 75) r.smt = clampS(r.smt + 2); else if (t.spirit <= 25) r.smt = clampS(r.smt - 2);
    return r;
  }

  /**
   * GameTeam for a team now. @param {{diffDelta?:number}} [o]
   * @returns {GameTeam}
   */
  /** WP2 franchise modifiers when the real Spirit.gameMods exists (else the local fallback in bakedSkills). */
  function franchiseMods(L, tid) {
    const Sp = PT.League.Spirit;
    return Sp && typeof Sp.gameMods === 'function' && !Sp.gameMods.__stub ? Sp.gameMods(L, tid) : null;
  }
  function modSkills(p, gm, diffDelta) {
    const r = {};
    const mult = gm.mult[p.id] || 1, all = (gm.all[p.id] || 0) + (diffDelta || 0), sk = gm.sk[p.id] || {};
    for (const k of C.RATINGS) r[k] = clampS(p.r[k] * mult + all + (sk[k] || 0));
    return r;
  }

  /** Star players in this game (ROUND6 A): the team's Stars who are healthy and dressed (in GameTeam.pl). */
  function gameStars(L, t, dc, pl) {
    const dressed = {};
    pl.forEach((p) => { dressed[p.pid] = true; });
    const list = Array.isArray(t.stars) ? t.stars : t.stars ? [t.stars.off, t.stars.def] : [];
    return list.filter((pid) => pid != null && dressed[pid]);
  }

  Games.gameTeam = function (L, tid, o) {
    o = o || {};
    const t = L.teams[tid];
    const gm = franchiseMods(L, tid);
    const dc = Games.lineup(L, tid, gm ? gm.bench : null);
    const used = {};
    C.SLOTS.forEach((s) => dc[s].forEach((pid) => { used[pid] = true; }));
    const S = PT.Data.Species;
    const R = PT.League.Ratings;
    const pl = Q().roster(L, tid).filter((p) => Q().isHealthy(p)).map((p) => {
      const r = gm ? modSkills(p, gm, o.diffDelta) : bakedSkills(p, t, o.diffDelta);
      return {
        pid: p.id, n: p.fn.charAt(0) + '. ' + p.ln, num: p.num, pos: p.pos, alt: p.alt.slice(), sp: p.sp,
        sz: S.byId(p.sp).size, cs: p.look.v, r: r, tr: p.tr.slice(), ovr: R.ovr({ r: r, pos: p.pos, alt: p.alt }, p.pos),
        look: { v: p.look.v, acc: p.look.acc }, age: p.age,
        star: Array.isArray(t.stars) && t.stars.indexOf(p.id) >= 0
      };
    });
    const stars = (v) => (typeof v === 'number' ? v : v.st);
    const aggr = t.human ? 0.5 : t.strat === 'contend' ? 0.6 : t.strat === 'rebuild' ? 0.4 : 0.5;
    return {
      tid: t.id, abbr: t.abbr, city: t.city, name: t.name, sp: t.sp,
      col: { pri: t.col.pri, sec: t.col.sec, acc: t.col.acc },
      pl: pl, dc: dc,
      coach: { off: stars(t.stf.off), def: stars(t.stf.def), aggr: aggr },
      tend: { pass: Math.round((1 - Games.runShare(t.style.off)) * 100) / 100, off: t.style.off, def: t.style.def },
      hype: t.fin.hype, std: t.fac.std, med: t.fac.med, clim: t.clim, spirit: t.spirit, capt: t.capt, rival: t.rival, human: t.human,
      stars: gameStars(L, t, dc, pl),
      q1: gm ? gm.q1 || 0 : 0, edge: gm ? gm.edge || 0 : 0, oppEdge: gm ? gm.oppEdge || null : null, snowImm: gm ? !!gm.snowImm : false,
      injMult: injMultOf(L, tid),
      bake: { mood: true, spirit: true, playHurt: true, events: !!gm, diff: o.diffDelta || 0 }
    };
  };

  /**
   * GameConfig for a scheduled game.
   * @param {{sim?:boolean, userTid?:number}} [opts] sim: built for StatSim (no difficulty skill delta);
   *   userTid: override who the user controls (−1 = AI vs AI)
   * @returns {GameConfig}
   */
  Games.config = function (L, gid, opts) {
    opts = opts || {};
    const g = Q().game(L, gid);
    if (!g) throw new Error('[Games] no game ' + gid);
    const userIn = g.h === L.userTid || g.a === L.userTid;
    const userTid = opts.userTid != null ? opts.userTid : userIn ? L.userTid : -1;
    const delta = userTid >= 0 && !opts.sim ? Games.DIFF_AI_SKILLS[L.diff] || 0 : 0;
    const s = L.settings;
    return {
      gid: gid, seed: PT.RNG.hash(L.seed, L.season, gid), season: L.season, week: g.wk, po: g.po,
      neutral: g.po === C.PLAYOFF_ROUNDS,
      qLen: s.qLen || PT.League.SETTINGS_EXTRA.qLen, diff: L.diff, userTid: userTid,
      weather: Games.weather(L, gid),
      twist: L.twist ? L.twist.id : 'normal',
      settings: { aimMode: s.aimMode, easyThrow: s.easyThrow, penalties: s.penalties, autoDef: s.autoDef, lefty: s.lefty,
        watch: s.watch == null ? PT.League.SETTINGS_EXTRA.watch : s.watch, autoReturn: !!s.autoReturn },
      rival: L.teams[g.h].rival === g.a,
      home: Games.gameTeam(L, g.h, { diffDelta: g.h !== userTid ? delta : 0 }),
      away: Games.gameTeam(L, g.a, { diffDelta: g.a !== userTid ? delta : 0 })
    };
  };

  /** Prepare an AI team for a game: legal roster (free agents / walk-ons) + Auto Lineup. */
  Games.prepTeam = function (L, tid) {
    const t = L.teams[tid];
    if (!t.human) PT.League.Roster.ensurePlayable(L, tid);
    else if (L.settings.autoLineup) PT.League.Roster.autoDepth(L, tid, { silent: true });
    else {
      const Ro = PT.League.Roster;
      Ro.markHurtStarters(L, tid);                                // HUNT4 #1: keep the hurt starter's slot …
      Ro.restoreHealed(L, tid);                                   // … and give it back when he is healthy and better
      Ro.repairDepth(L, tid); Ro.autoDepth(L, tid, { onlyEmpty: true, silent: true });
    }
    PT.League.Roster.updateStars(L, tid);
  };

  /**
   * The user starts playing a game: marks st 'L' so a reload knows a game was interrupted.
   * @returns {Result} {cfg}
   */
  Games.startUserGame = function (L, gid) {
    const g = Q().game(L, gid);
    if (!g) return fail('NO_GAME', 'Game not found.');
    if (g.st === 'F') return fail('FINAL', 'That game is already over.');
    if (g.h !== L.userTid && g.a !== L.userTid) return fail('NOT_YOURS', 'That is not your game.');
    const v = PT.League.Roster.validate(L, L.userTid);
    if (!v.ok) return fail('ROSTER', v.errors[0].msg);
    Games.prepTeam(L, g.h); Games.prepTeam(L, g.a);
    g.st = 'L';
    g.wx = Games.weather(L, gid);
    PT.League.emit('league:changed', { what: 'game', gid: gid });
    return ok({ cfg: Games.config(L, gid) });
  };

  /**
   * Store a finished game: schedule result, box (full; Calendar compacts old AI boxes), player season stats,
   * starts in new positions (R5), then WP2 hooks Injuries.fromBox(L, box) and Awards.checkGameRecords(L, box).
   * @param {BoxScore} box @returns {Result} {box}
   */
  Games.record = function (L, gid, box) {
    const g = Q().game(L, gid);
    if (!g) return fail('NO_GAME', 'Game not found.');
    if (g.st === 'F') return fail('FINAL', 'That game is already over.');
    if (!box || box.gid !== gid || box.h !== g.h || box.a !== g.a) throw new Error('[Games] box does not match game ' + gid);
    if (g.po > 0 && box.hs === box.as) throw new Error('[Games] playoff game cannot end tied');
    const lineups = [Games.lineup(L, g.h), Games.lineup(L, g.a)];
    g.st = 'F'; g.hs = box.hs; g.as = box.as; g.ot = !!box.ot; g.sim = !!box.sim;
    g.wx = Games.weather(L, gid);
    L.box[gid] = box;
    for (const pid of Object.keys(box.pl)) {
      const p = Q().player(L, +pid);
      if (!p) continue;
      const l = box.pl[pid];
      for (const k of Object.keys(l)) {
        if (k === 't' || !C.STATS[k]) continue;
        if (C.STAT_MAX[k]) p.st[k] = Math.max(p.st[k] || 0, l[k]);
        else p.st[k] = (p.st[k] || 0) + l[k];
      }
      // team he played this season for: rollover archives p.st with it (p.tid may have changed by then: Market, retirement)
      if (l.t != null && l.t >= 0) p.st.t = l.t;
    }
    lineups.forEach((dc) => {
      const started = {};
      C.SLOTS.forEach((s) => {
        const pid = dc[s][0];
        started[s] = pid != null && box.pl[pid] && box.pl[pid].gs ? [pid] : [];
      });
      PT.League.Roster.recordStarts(L, started);
    });
    PT.League.Injuries.fromBox(L, box);
    PT.League.Awards.checkGameRecords(L, box);
    const u = L.userTid;
    if (g.h === u || g.a === u) {
      const opp = L.teams[g.h === u ? g.a : g.h], me = L.teams[u];
      const my = g.h === u ? g.hs : g.as, their = g.h === u ? g.as : g.hs;
      const txt = my > their ? 'The ' + me.name + ' beat the ' + opp.name + ' ' + my + '–' + their + '.'
        : my < their ? 'The ' + opp.name + ' beat the ' + me.name + ' ' + their + '–' + my + '.'
          : 'The ' + me.name + ' and the ' + opp.name + ' tie ' + my + '–' + their + '.';
      PT.League.News.add(L, 'game', txt, u);
    }
    PT.League.emit('league:changed', { what: 'game', gid: gid });
    return ok({ box: box });
  };

  /**
   * Quick-sim a game (the user's "Sim Game", or "sim the rest" from a partial engine state) and record it.
   * The user team gets the design-16 quick-sim bonus. @param {PartialState} [from] @returns {BoxScore}
   */
  Games.simUserGame = function (L, gid, from) {
    const g = Q().game(L, gid);
    if (!g) throw new Error('[Games] no game ' + gid);
    if (g.st === 'F') return L.box[gid];
    Games.prepTeam(L, g.h); Games.prepTeam(L, g.a);
    const cfg = Games.config(L, gid, { sim: true });
    const userIn = g.h === L.userTid || g.a === L.userTid;
    const opts = { from: from || null };
    if (userIn) opts.bonus = { tid: L.userTid, n: Games.DIFF_SIM_BONUS[L.diff] || 0 };
    const box = PT.League.StatSim.sim(cfg, opts);
    Games.record(L, gid, box);
    return box;
  };

  /** Sim one AI game (no user bonus). @returns {BoxScore} */
  Games.simGame = function (L, gid) {
    const g = Q().game(L, gid);
    Games.prepTeam(L, g.h); Games.prepTeam(L, g.a);
    const box = PT.League.StatSim.sim(Games.config(L, gid, { sim: true, userTid: -1 }), {});
    Games.record(L, gid, box);
    return box;
  };
})(globalThis.PT = globalThis.PT || {});
