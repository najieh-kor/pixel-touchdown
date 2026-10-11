/* Pixel Touchdown: js/league/league.js
 * Owner: WP1. Responsibility: PT.League.create/hydrate/rng + PT.League.Q (read-only queries).
 * Also PT.League.K (WP1 tuning, keys prefixed SIM_/CAL_/ROS_) and small helpers (addPlayer, emit).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const League = PT.ns('League');
  const Q = PT.ns('League.Q');

  /** WP1 tuning (ARCHITECTURE 10.4). WP2 adds its own keys with other prefixes. */
  const K = League.K = League.K || {};
  Object.assign(K, {
    SIM_POSS: [5, 6],            // possessions per team in 4 × 3:00 quarters (Appendix C has 10–12 for long games)
    SIM_P_TD: 0.41,              // per-possession odds at d = 0 (Appendix C 0.22/0.16/0.11, scaled up so ~5 drives score ~16)
    SIM_P_FG: 0.17,
    SIM_P_TO: 0.13,
    SIM_D_SCALE: 0.75,           // rating gap → d. Appendix C uses 1.0; 0.5 meets the "+10 OVR wins 70–85%" calibration
    SIM_HOME: 3.0,               // home d bonus (Appendix C 1.5; 3.0 keeps ~54% home wins in 2-half games)
    SIM_HOME_HYPE: 0.5,          // + if home Hype ≥ 80 (design 8.17: +2 instead of +1)
    SIM_HOME_STAD5: 0.5,         // + Stadium level 5 (design 10.11)
    SIM_STYLE: 3,                // × styleMatchup (Appendix C)
    SIM_SACKS: 2.4,              // sacks per 34 dropbacks at even rush/block (per-dropback rate = SIM_SACKS / 34)
    SIM_SACK_SLOPE: 0.05,
    SIM_YPC: 5.4,                // base carry mean; stalled/short-yardage runs bring the league YPC to ~4.0
    SIM_COMP_ADJ: -0.07,         // completion % offset (forced 3rd-down conversions inflate it)
    SIM_YPC_SLOPE: 0.04,         // per point of RunOff − RunDef (scaled)
    SIM_3OUT: 0.45,              // share of punt drives that are three-and-outs
    SIM_INJ: 0.35,               // Poisson mean injuries per team-game (design 12.1)
    SIM_PEN: 2,                  // mean accepted penalties per team-game (2 halves)
    CAL_FA_POOL_START: 60        // free agents generated at League.create
  });

  /** WP1 settings defaults on top of PT.C.SETTINGS_DEFAULT: quarter length 180 s (3:00; options 120/180/300),
   *  defense watch speed 0.8/1/1.5 (STAR_ABILITIES §8), kick returns; qv = settings version (quarter-length migration) */
  League.SETTINGS_EXTRA = { qLen: 180, watch: 0.8, autoReturn: false, qv: 2 };
  /** quarter length options in seconds (2 / 3 / 5 min quarters) */
  League.QLEN_OPTIONS = [120, 180, 300];

  // ---------------- helpers ----------------
  League.emit = function (name, payload) { if (PT.Events) PT.Events.emit(name, payload); };

  function def(L, k, v) { Object.defineProperty(L, k, { value: v, writable: true, configurable: true, enumerable: false }); }

  /** Rebuild runtime indexes (_pidx, _std). Call after load/migrate and after removing players. @returns {League} */
  League.hydrate = function (L) {
    reindex(L);
    def(L, '_std', null);
    // defensive defaults for older saves (no-op on fresh leagues)
    const old = L.settings || {};
    L.settings = Object.assign({}, C.SETTINGS_DEFAULT, League.SETTINGS_EXTRA, old);
    // saves from before 3:00 quarters (no qv marker) used 300 s as the default → 180 s, once
    if (!old.qv) { if (L.settings.qLen === 300 || !old.qLen) L.settings.qLen = 180; L.settings.qv = 2; }
    // ROUND6 B: 4 difficulties (Beginner, Normal, Expert, Legend). PT.Save already remaps old saves (diff 2 → 3) and stamps
    // L.dv = 2 before hydrate; this only covers leagues that never went through the save layer (no marker at all).
    if (L.dv == null) { if (L.diff === 2) L.diff = 3; L.dv = 2; }
    if (!L.retNums) L.retNums = {};
    if (!L.ach) L.ach = {};
    if (!L.scout) L.scout = { pts: 0, spent: {} };
    // team names/abbr/logo/stadium come from data (renamed teams in older saves pick up the new identity)
    const TD = PT.Data && PT.Data.Teams;
    if (TD && L.teams) L.teams.forEach((t) => {
      const d = TD.byId(t.id);
      if (d) { t.city = d.city; t.name = d.name; t.abbr = d.abbr; t.logo = d.logo; t.stad = d.stad; }
    });
    // Stars (older saves have none)
    if (L.teams && L.teams.length && PT.League.Roster) L.teams.forEach((t) => { if (!Array.isArray(t.stars)) PT.League.Roster.updateStars(L, t.id); });
    return L;
  };

  function reindex(L) {
    const idx = {};
    for (const p of L.players) idx[p.id] = p;
    def(L, '_pidx', idx);
    def(L, '_pidxN', L.players.length);
  }
  League.reindex = reindex;

  /** Push a new player into L.players and the index. */
  League.addPlayer = function (L, p) {
    L.players.push(p);
    if (!L._pidx || L._pidxN !== L.players.length - 1) reindex(L);
    else { L._pidx[p.id] = p; L._pidxN = L.players.length; }
    return p;
  };

  /**
   * Live Rng bound to L.rng: every draw writes the state back into L.rng (in place).
   * The same object is returned while L.rng is the same array.
   */
  League.rng = function (L) {
    if (L._rng && L._rngArr === L.rng) return L._rng;
    const arr = L.rng;
    const r = PT.RNG.fromState(arr);
    const u32 = r.u32;
    r.u32 = function () {
      const v = u32.call(this);
      arr[0] = this.a; arr[1] = this.b; arr[2] = this.c; arr[3] = this.d;
      return v;
    };
    def(L, '_rng', r);
    def(L, '_rngArr', arr);
    return r;
  };

  /**
   * Create a full league: 32 teams with design rosters, lineups, staff, facilities, finances, FA pool, schedule.
   * Starts at REGULAR week 1 (ROUND6 C): Twists.roll (year 1 = 'normal'), Economy.season (TV money / bills), then
   * Calendar.startSeason (Boss.setGoal, Training Camp auto-pick, roster prep, L.newSeasonCard).
   * @param {{seed?:number, userTid:number, coach?:string, coachSp?:string, diff?:number, season?:number, now?:number,
   *          settings?:Object}} o
   * @returns {League}
   */
  League.create = function (o) {
    o = o || {};
    const seed = (o.seed == null ? 1 : o.seed) >>> 0;
    const userTid = o.userTid == null ? 0 : o.userTid;
    if (!(userTid >= 0 && userTid < C.NUM_TEAMS)) throw new Error('[League] bad userTid ' + userTid);
    const diff = o.diff == null ? 1 : o.diff;
    if (!(diff >= 0 && diff < C.DIFFS.length)) throw new Error('[League] bad diff ' + diff);
    const season = o.season || C.START_SEASON;
    const L = {
      v: C.SCHEMA_VERSION, id: 'lg', seed: seed, rng: PT.RNG.create(seed).state(), created: o.now || 0,
      coach: { n: '', sp: o.coachSp && C.SPECIES.indexOf(o.coachSp) >= 0 ? o.coachSp : 'dog', xp: 0, lvl: 1, sk: {}, pts: 0 },
      diff: diff, dv: 2,
      settings: Object.assign({}, C.SETTINGS_DEFAULT, League.SETTINGS_EXTRA, { autoLineup: diff === 0 }, o.settings || {}),
      season: season, phase: C.PHASE.PRESEASON, week: 0, sub: 0, userTid: userTid,
      teams: [], players: [], nextPid: 1, nextGid: 1,
      sched: [], box: {}, po: { seeds: [[], []], rd: 0, champ: null }, draft: null, fa: null,
      ev: { pending: [], seen: {} }, news: [],
      hist: { seasons: [], legends: [], rec: { league: { season: {}, game: {}, career: {} }, franchise: {} } },
      twist: { id: 'normal', s: season },
      boss: { goal: null, conf: C.BOSS_START },
      ach: {}, scout: { pts: 0, spent: {} }, retNums: {}
    };
    League.hydrate(L);
    const rng = League.rng(L);
    L.id = PT.Util.uid(rng, 'lg_');
    L.coach.n = (o.coach && String(o.coach).trim()) || PT.Data.Names.coach(rng);
    PT.League.TeamGen.build(L);
    PT.League.TeamGen.freeAgents(L, K.CAL_FA_POOL_START);
    PT.League.Schedule.generate(L);
    // season start (ROUND6 C): Twist (year 1 = 'normal'), bills / TV money, then Boss goal, Training Camp, roster prep
    // → REGULAR week 1 with the "New Season" card
    PT.League.Twists.roll(L);
    PT.League.Economy.season(L);
    L.scout.pts = League.scoutPoints(L);
    PT.League.Calendar.startSeason(L);
    const ut = L.teams[userTid];
    L.news.unshift({ s: season, wk: 0, k: 'event', txt: L.coach.n + ' takes over the ' + ut.city + ' ' + ut.name + '.', tid: userTid });
    return L;
  };

  /**
   * Change difficulty (design 16; ROUND6 B/C: Settings, setup window only). Starting Coins are not changed.
   * @param {number} d 0 Beginner, 1 Normal, 2 Expert, 3 Legend @returns {Result}
   */
  League.setDifficulty = function (L, d) {
    if (!(d >= 0 && d < C.DIFFS.length) || d !== Math.floor(d)) return { ok: false, err: 'BAD_DIFF', msg: 'Pick ' + C.DIFFS.join(', ') + '.' };
    if (!League.canChangeSetup(L)) return { ok: false, err: 'NOT_NOW', msg: 'Change it before Week 1 kicks off or after the season.' };
    L.diff = d;
    League.emit('league:changed', { what: 'settings' });
    return { ok: true };
  };

  /**
   * Setup window (replaces "Preseason only", ROUND6 C): before any game of the season is played, or in the offseason
   * (Awards Night → Market Days). Used for difficulty and team style changes.
   */
  League.canChangeSetup = function (L) {
    if (L.phase === C.PHASE.PRESEASON || L.phase === C.PHASE.SEASON_END || L.phase === C.PHASE.RESIGN ||
      L.phase === C.PHASE.DRAFT || L.phase === C.PHASE.FREE_AGENCY) return true;
    return L.phase === C.PHASE.REGULAR && L.week === 1 && !L.sched.some((g) => g.st === 'F' || g.st === 'L');
  };

  /** The UI dismissed the "New Season" card (ROUND6 C). */
  League.dismissNewSeasonCard = function (L) {
    L.newSeasonCard = null;
    League.emit('league:changed', { what: 'card' });
    return { ok: true };
  };

  /** Scout points per season (design 10.6): WP2 History.scoutPoints (Talent Eye, staff quirks) or 8 + 4 × (Scout Office − 1) */
  League.scoutPoints = function (L) {
    const H = PT.League.History;
    if (H && typeof H.scoutPoints === 'function' && !H.scoutPoints.__stub) return H.scoutPoints(L);
    return 8 + 4 * (L.teams[L.userTid].fac.sct - 1);
  };

  // ---------------- read-only queries ----------------
  function idx(L) {
    if (!L._pidx || L._pidxN !== L.players.length) reindex(L);
    return L._pidx;
  }

  Q.team = (L, tid) => L.teams[tid] || null;
  /** @returns {Player|null} */
  Q.player = function (L, pid) {
    let p = idx(L)[pid];
    if (p && p.id !== pid) { reindex(L); p = L._pidx[pid]; }
    return p || null;
  };
  /** @returns {Player[]} roster incl. Hurt List */
  Q.roster = (L, tid) => {
    const out = [];
    for (const pid of L.teams[tid].roster) { const p = Q.player(L, pid); if (p) out.push(p); }
    return out;
  };
  /** active players (not on the Hurt List) */
  Q.active = (L, tid) => Q.roster(L, tid).filter((p) => !p.ir);
  /** players on the Hurt List */
  Q.hurtList = (L, tid) => Q.roster(L, tid).filter((p) => p.ir);
  /** can play: not on the Hurt List and not injured (weeks left), or allowed to Play Hurt (p.ph, WP2). p.inj.ph is only a
   *  display mirror; it can outlive p.ph (cut / swap / Hurt List clear p.ph), so it must not make a hurt player healthy. */
  Q.isHealthy = (p) => !p.ir && (!p.inj || p.inj.w <= 0 || !!p.ph);
  Q.userTeam = (L) => L.teams[L.userTid];
  Q.freeAgents = (L) => L.players.filter((p) => p.tid === C.TID.FA);
  Q.prospects = (L) => L.players.filter((p) => p.tid === C.TID.PROSPECT);
  /** @returns {SchedGame[]} a team's games (regular + playoff), in week order */
  Q.schedule = (L, tid) => L.sched.filter((g) => g.h === tid || g.a === tid).sort((a, b) => (a.wk - b.wk) || (a.gid - b.gid));
  /** regular-season games of a week (playoff weeks: that round's games) */
  Q.week = (L, wk) => L.sched.filter((g) => g.wk === wk);
  Q.game = (L, gid) => L.sched.find((g) => g.gid === gid) || null;
  /** @returns {SchedGame|null} earliest unfinished user game */
  Q.nextUserGame = (L) => {
    const u = L.userTid;
    let best = null;
    for (const g of L.sched) {
      if ((g.h !== u && g.a !== u) || g.st === 'F') continue;
      if (!best || g.wk < best.wk || (g.wk === best.wk && g.gid < best.gid)) best = g;
    }
    return best;
  };
  /** the user's game in the current calendar week (null on a Rest Week / outside game weeks) */
  Q.userGameThisWeek = (L) => {
    if (L.phase !== C.PHASE.REGULAR && L.phase !== C.PHASE.PLAYOFFS) return null;
    const u = L.userTid;
    return L.sched.find((g) => g.wk === L.week && (g.h === u || g.a === u)) || null;
  };
  Q.opponent = (g, tid) => (g.h === tid ? g.a : g.h);
  Q.box = (L, gid) => L.box[gid] || null;
  /** @returns {{pid:number, v:number}[]} season leaders by a stat key */
  Q.leaders = (L, key, n, filter) => L.players
    .filter((p) => p.st && p.st[key] && (!filter || filter(p)))
    .sort((a, b) => (b.st[key] - a.st[key]) || (a.id - b.id))
    .slice(0, n || 10)
    .map((p) => ({ pid: p.id, v: p.st[key] }));
  Q.teamOvr = (L, tid) => PT.League.Ratings.teamOvr(L, tid);
  /** 'Blacktop City Blitz' */
  Q.teamName = (L, tid) => (L.teams[tid] ? L.teams[tid].name : '?');
})(globalThis.PT = globalThis.PT || {});
