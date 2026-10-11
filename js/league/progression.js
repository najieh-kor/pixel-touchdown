/* Pixel Touchdown: js/league/progression.js
 * Owner: WP2. Responsibility: PT.League.Progression: weekly growth, offseason aging, retirement (design 4.5, 5, 14.5, 14.10).
 * Hooks (R6): weekly(L) after each regular week · offseason(L) at Growth Day (SEASON_END sub 1) · retire(L) at Goodbyes (sub 2).
 * UI: camp(L, picks) Training Camp Focus · practice(L, mode) Weekly Practice · retireNumber(L, pid, yes) at Goodbyes.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Prog = PT.ns('League.Progression');
  const H = () => PT.League.History;
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;

  /** baseΔ by age (design 4.5); index by age, 34+ = −5 */
  const BASE = { 21: 4, 22: 4, 23: 3, 24: 2, 25: 1.5, 26: 1, 27: 0.5, 28: 0, 29: -0.5, 30: -1.5, 31: -2, 32: -3, 33: -4 };
  Prog.baseDelta = function (age, pos) {
    const a = pos === 'K' ? age - 4 : age;
    if (a <= 21) return 4;
    if (a >= 34) return -5;
    return BASE[a];
  };
  /** Retirement chance by (kicker-adjusted) age (design 4.5). */
  const RET = { 30: 0.05, 31: 0.10, 32: 0.20, 33: 0.35, 34: 0.50, 35: 0.65 };
  Prog.retireChance = function (p, champ) {
    const a = p.pos === 'K' ? p.age - 4 : p.age;
    if (p.age >= K().PROG_RETIRE_MAX_AGE) return 1;
    if (a < 30) return 0;
    let c = a >= 36 ? 0.85 : RET[a];
    if (p.ovr >= 85) c *= 0.5;
    if (p.ovr < 60) c += 0.20;
    if (champ) c *= 0.7;
    return Math.max(0, Math.min(1, c));
  };

  /** Trait positions (design 5.2) for earned Perks. */
  const TRAIT_POS = {
    rocket_arm: ['QB'], dime_dropper: ['QB'], quick_release: ['QB'], scrambler: ['QB'], glue_paws: ['WR', 'TE', 'RB'],
    truck_stick: ['RB', 'TE', 'QB'], ankle_breaker: ['RB', 'WR', 'QB'], spin_doctor: ['RB', 'WR'], speed_demon: ['RB', 'WR', 'CB', 'S'],
    route_artist: ['WR', 'TE'], ball_hawk: ['CB', 'S', 'LB'], lockdown: ['CB', 'S'], sack_master: ['DL', 'LB'],
    sure_tackler: ['DL', 'LB', 'CB', 'S'], brick_wall: ['OL', 'TE'], road_grader: ['OL', 'TE'], ice_toes: ['K'], boomer: ['K']
  };
  const QUIRKS = ['glass_bones', 'fumbley', 'stone_hands', 'shaky_paws', 'flag_magnet', 'grumpy_gus', 'early_peak', 'wild_leg'];
  Prog.perksFor = function (pos) {
    return C.TRAITS.filter((t) => QUIRKS.indexOf(t) < 0 && t !== 'late_bloomer' && (!TRAIT_POS[t] || TRAIT_POS[t].indexOf(pos) >= 0));
  };

  /** Growth letter from ceiling − OVR (design 4.5). */
  Prog.letter = function (gap) { return gap >= 20 ? 'A+' : gap >= 14 ? 'A' : gap >= 8 ? 'B' : gap >= 3 ? 'C' : 'D'; };

  function mainKeys(pos) { return Object.keys(C.OVR_W[pos]); }
  function ovrOf(p) { return PT.League.Ratings && PT.League.Ratings.ovr ? PT.League.Ratings.ovr(p) : p.ovr; }
  function clampS(v) { return Math.max(C.SKILL_MIN, Math.min(C.SKILL_MAX, v)); }
  /** stochastic rounding keeps small yearly changes (×0.3) meaningful */
  function sround(r, v) { const f = Math.floor(v); return f + (r.next() < v - f ? 1 : 0); }
  function addTrait(p, id) {
    if (p.tr.indexOf(id) >= 0 || p.tr.length >= C.MAX_TRAITS) return false;
    p.tr.push(id);
    return true;
  }

  // ---------------- weekly ----------------

  /**
   * After each regular week: Weekly Practice (Hard: 3 random starters +1 main skill; Rest handled by Injuries),
   * every 4th week Hot Streak (+1 random main skill for each Player of the Game in those 4 weeks), then Mood/Spirit upkeep.
   */
  Prog.weekly = function (L) {
    if (!H().once(L, 'prog')) return;
    const ss = H().ss(L);
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, 'prog'));
    const ut = L.teams[L.userTid];
    if (ss.prac === 'hard' && L.phase === 'REGULAR') {
      const st = [];
      for (const s of C.SLOTS) if (s !== 'KR' && ut.dc[s] && ut.dc[s][0] != null && st.indexOf(ut.dc[s][0]) < 0) st.push(ut.dc[s][0]);
      r.shuffle(st);
      for (const pid of st.slice(0, 3)) {
        const p = Q().player(L, pid);
        if (!p) continue;
        const k = r.pick(mainKeys(p.pos));
        const gain = p.tr.indexOf('gym_rat') >= 0 ? 2 : 1;
        p.r[k] = clampS(p.r[k] + gain);
        p.ovr = ovrOf(p);
      }
    }
    if (ss.prac === 'rest' && L.phase === 'REGULAR') for (const p of Q().roster(L, L.userTid)) PT.League.Spirit.addMood(L, p, 1, 'rest');
    if (L.phase === 'REGULAR' && L.week % 4 === 0) {
      const pogs = {};
      for (const gid of Object.keys(L.box)) {
        const b = L.box[gid];
        if (b.s === L.season && !b.po && b.wk > L.week - 4 && b.wk <= L.week && b.pog != null) pogs[b.pog] = 1;
      }
      for (const pid of Object.keys(pogs)) {
        const p = Q().player(L, +pid);
        if (!p || p.tid < 0) continue;
        const k = r.pick(mainKeys(p.pos));
        p.r[k] = clampS(p.r[k] + 1);
        p.ovr = ovrOf(p);
      }
    }
    PT.League.Spirit.weekly(L);
  };

  /** Weekly Practice choice for your team: 'hard' | 'normal' | 'rest'. @returns {Result} */
  Prog.practice = function (L, mode) {
    if (['hard', 'normal', 'rest'].indexOf(mode) < 0) return { ok: false, err: 'BAD_MODE', msg: 'Pick Hard, Normal or Rest.' };
    H().ss(L).prac = mode;
    return { ok: true, mode: mode };
  };

  // ---------------- Training Camp (preseason) ----------------

  /** Camp info: how many Focus players, the gain, whether done. */
  Prog.campInfo = function (L) {
    const ss = H().ss(L);
    const t = L.teams[L.userTid];
    const trn = Math.min(6, t.fac.trn + (t.gym ? 1 : 0));
    return { n: L.diff === 0 ? 4 : 3, gain: 2 + (trn - 1), done: !!ss.camp || t.campS === L.season, picks: ss.focus.slice() };
  };

  /**
   * Training Camp Focus (design 4.5): each pick {pid, key} gets +2 + (TrainingField − 1) to one main skill
   * (Gym Rat ×1.5 rounded up); 5% chance to learn a random allowed Perk. Once per season (no Preseason since ROUND6 C:
   * runs at rollover; with no picks it auto-picks the Focus players with the most Growth room, see autoCampPicks).
   * @returns {{ok, changes:{pid, key, from, to, d, ovr:[from,to], perk?}[]}}
   */
  Prog.camp = function (L, tidOrPicks, maybePicks) {
    let picks = tidOrPicks;
    if (typeof tidOrPicks === 'number') { picks = maybePicks; if (tidOrPicks !== L.userTid) return { ok: false, err: 'NOT_YOURS', msg: 'Only your team has camp.' }; }
    const info = Prog.campInfo(L);
    if (info.done) return { ok: false, err: 'DONE', msg: 'Camp is done for this year.' };
    if (L.phase === 'PLAYOFFS' || (L.phase === 'REGULAR' && L.week > 1)) return { ok: false, err: 'NOT_NOW', msg: 'Training Camp is before Week 1.' };
    if (!picks || !picks.length) picks = Prog.autoCampPicks(L);
    picks = picks.slice(0, info.n);
    const ss = H().ss(L);
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'camp'));
    const changes = [];
    const seen = {};
    for (const pk of picks) {
      const p = Q().player(L, pk.pid);
      if (!p || p.tid !== L.userTid || seen[p.id]) continue;
      seen[p.id] = 1;
      const want = pk.key || pk.skill;
      const key = want && C.OVR_W[p.pos][want] ? want : mainKeys(p.pos).sort((a, b) => C.OVR_W[p.pos][b] - C.OVR_W[p.pos][a])[0];
      let g = info.gain;
      if (p.tr.indexOf('gym_rat') >= 0) g = Math.ceil(g * 1.5);
      const from = p.r[key], o0 = p.ovr;
      p.r[key] = clampS(p.r[key] + g);
      p.ovr = ovrOf(p);
      const ch = { pid: p.id, key: key, from: from, to: p.r[key], d: p.r[key] - from, ovr: [o0, p.ovr] };
      if (r.chance(0.05)) {
        const pool = Prog.perksFor(p.pos).filter((t) => p.tr.indexOf(t) < 0);
        if (pool.length && p.tr.length < 2) { const t = r.pick(pool); addTrait(p, t); ch.perk = t; }
      }
      changes.push(ch);
      ss.focus.push(p.id);
    }
    ss.camp = 1;
    L.teams[L.userTid].campS = L.season;
    delete L.teams[L.userTid].gym;
    PT.League.Achievements.check(L, 'growth');
    if (PT.Events) PT.Events.emit('league:changed', { what: 'camp' });
    return { ok: true, changes: changes };
  };

  /**
   * Auto Training Camp picks (ROUND6 C): the Focus players with the most Growth room (ceiling − OVR, younger first),
   * each on his heaviest main skill. @returns {{pid, key}[]}
   */
  Prog.autoCampPicks = function (L) {
    const n = Prog.campInfo(L).n;
    return Q().roster(L, L.userTid).filter((p) => !p.ir && p.pos !== 'K')
      .sort((a, b) => ((b.pot - b.ovr) - (a.pot - a.ovr)) || (a.age - b.age) || (b.ovr - a.ovr) || (a.id - b.id))
      .slice(0, n).map((p) => ({ pid: p.id, key: mainKeys(p.pos).sort((x, y) => C.OVR_W[p.pos][y] - C.OVR_W[p.pos][x])[0] }));
  };

  // ---------------- Growth Day ----------------

  /**
   * One player's yearly progression (design 4.5). Mutates p. @returns {{d:number, sk:Object}}
   */
  Prog.grow = function (L, p, r, ctx) {
    ctx = ctx || {};
    const before = Object.assign({}, p.r), o0 = p.ovr;
    p.age = Math.min(50, p.age + 1);
    const base = Prog.baseDelta(p.age, p.pos);
    const gm = C.GROWTH_MULT[p.gl] || 1;
    const roll = r.normal(0, K().PROG_ROLL_SD);
    const t = p.tid >= 0 ? L.teams[p.tid] : null;
    let d;
    if (base > 0) {
      const gs = (p.st && p.st.gs) || 0;
      d = base * gm + (gs >= 8 ? 1 : gs >= 4 ? 0.5 : 0) + roll;
      if (t && p.age <= 27) d += 0.25 * (t.fac.trn - 1);
      if (t && p.age <= 25) d += PT.League.Staff.effects(L, t.id).grw;
      if (p.tr.indexOf('late_bloomer') >= 0 && p.age <= 27) d += 2;
      if (t && t.id === L.userTid && ctx.firstYear) d += PT.League.Coach.mods(L).rookieProg;
      if (p.ovr + d > p.pot) d = p.ovr < p.pot ? Math.max(0.5, p.pot - p.ovr) : Math.min(d, 0.5);
      // HUNT5 #2: diminishing returns near the top, and kickers (who age slower) grow at most +2 (+1 above 90)
      if (p.ovr >= K().PROG_TOP_FROM) d *= Math.max(0.15, (99 - p.ovr) / K().PROG_TOP_SPAN);
      if (p.pos === 'K') d = Math.min(d, p.ovr >= 90 ? 1 : 2);
    } else {
      d = base + roll * 0.5;
      if (p.tr.indexOf('early_peak') >= 0 && p.age >= 27) d -= 1;
    }
    const mains = C.OVR_W[p.pos];
    for (const k of C.RATINGS) {
      const v = mains[k] ? d * r.range(0.6, 1.4) : d * 0.3;
      p.r[k] = p.r[k] + v;
    }
    if (p.age >= 29) p.r.spd -= 1;
    if (p.age >= 28) p.r.smt += 0.5;
    for (const k of C.RATINGS) p.r[k] = clampS(sround(r, p.r[k]));
    p.ovr = ovrOf(p);
    if (d < 0) p.pot = Math.max(p.ovr, p.pot - 1);
    if (p.ovr > p.pot) p.pot = Math.min(99, p.ovr);
    if (p.age <= 25) p.gl = Prog.letter(p.pot - p.ovr);
    const sk = {};
    for (const k of C.RATINGS) if (p.r[k] !== before[k]) sk[k] = p.r[k] - before[k];
    return { d: p.ovr - o0, sk: sk, from: o0, to: p.ovr };
  };

  /**
   * Growth Day (SEASON_END sub 1, R6): everyone (rostered + Market) ages +1 and progresses. Prospects do not.
   * Also: milestone Perks (design 5.2), AI Front Office drift, draft-genius check.
   * @returns {{retired:number[], changes:{pid, d, from, to, sk}[]}} changes = your team, biggest risers first
   */
  Prog.offseason = function (L) {
    const ss = H().ss(L);
    if (ss.gd) return { retired: [], changes: ss.gd };
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'growth'));
    const changes = [];
    for (const p of L.players) {
      if (p.tid === C.TID.PROSPECT || p.tid === C.TID.RETIRED) continue;
      const firstYear = p.yr1 === L.season || (p.dr && p.dr.s === L.season);
      const res = Prog.grow(L, p, r, { firstYear: firstYear });
      milestonePerks(L, p);
      if (p.tid === L.userTid) changes.push({ pid: p.id, d: res.d, from: res.from, to: res.to, sk: res.sk });
    }
    changes.sort((a, b) => (b.d - a.d) || (a.pid - b.pid));
    ss.gd = changes;
    for (const t of L.teams) {
      if (!t.human && r.chance(0.2)) t.fo = Math.max(1, Math.min(5, (t.fo || 3) + (r.chance(0.5) ? 1 : -1)));
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
    }
    PT.League.Achievements.check(L, 'growth');
    if (PT.Events) PT.Events.emit('league:changed', { what: 'growth' });
    return { retired: [], changes: changes };
  };

  /** Milestone trait awards (design 5.2, P1). Earned traits may use the 3rd slot. */
  function milestonePerks(L, p) {
    const pro = p.aw.filter((a) => a.a === 'PRO').length;
    if (pro >= 3) addTrait(p, 'big_game');
    if (p.tid >= 0) {
      const yrs = p.cs.filter((c) => c.t === p.tid).length;
      if (yrs >= 10) addTrait(p, 'hometown_hero');
    }
    const car = H().career(p);
    if ((car.dsk || 0) >= 50 && (p.pos === 'DL' || p.pos === 'LB')) addTrait(p, 'sack_master');
    if ((car.int || 0) >= 30 && (p.pos === 'CB' || p.pos === 'S' || p.pos === 'LB')) addTrait(p, 'ball_hawk');
  }

  // ---------------- Goodbyes ----------------

  /**
   * Career length in seasons (HUNT5 #4): seasons played in this league + p.exp0 (years played before the league began,
   * set for generated veterans; estimated from age for older saves / later generated veterans; 0 for drafted rookies).
   */
  Prog.careerYears = function (L, p) {
    const set = {};
    for (const c of p.cs || []) set[c.s] = 1;
    if (p.st && p.st.gp) set[L.season] = 1;
    const played = Object.keys(set).length;
    let pre = p.exp0;
    if (pre == null) {
      if (p.dr || p.yr1 != null) pre = 0;
      else {
        const first = played ? Math.min.apply(null, Object.keys(set).map(Number)) : L.season;
        pre = Math.max(0, p.age - (L.season - first) - 22 - (PT.RNG.hash(L.seed, p.id, 'exp0') % 2));
      }
    }
    return Math.max(1, pre + played);
  };

  /** Seasons a player spent with a team (career entries + this season). */
  function seasonsWith(p, tid, curTid, season) {
    const s = {};
    for (const c of p.cs) if (c.t === tid) s[c.s] = 1;
    if (curTid === tid && p.st && p.st.gp && season != null) s[season] = 1;
    return Object.keys(s).length;
  }
  Prog.seasonsWith = seasonsWith;

  /**
   * Goodbyes (SEASON_END sub 2): retirement rolls (age ≥ 30, kickers −4; age 39 always), Hall of Fame vote
   * (≥ 25 HoF points, first ballot ≥ 35), retire-number prompts for your team, AI auto-retire for HoF with ≥ 6 seasons.
   * Retired players get tid −3 (History.compact removes them at rollover). Then 2 offseason events.
   * @returns {{retired:number[], hof:number[], prompts:{pid, num, n, yrs, why}[]}}
   */
  Prog.retire = function (L) {
    const ss = H().ss(L);
    if (ss.bye) return ss.bye;
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'retire'));
    const champ = L.po ? L.po.champ : null;
    const out = { retired: [], hof: [], prompts: [] };
    const car = PT.League.Coach.car(L);
    const N = PT.League.News;
    for (const p of L.players.slice()) {
      if (p.tid === C.TID.PROSPECT || p.tid === C.TID.RETIRED) continue;
      const ch = Prog.retireChance(p, champ != null && p.tid === champ);
      if (!ch || r.next() >= ch) continue;
      const tid = p.tid;
      const lastTeam = tid >= 0 ? tid : (p.cs.length ? p.cs[p.cs.length - 1].t : -1);
      const yrsWith = lastTeam >= 0 ? seasonsWith(p, lastTeam, tid, L.season) : 0;
      let withYou = 0;
      for (const t of car.teams) withYou += seasonsWith(p, t, tid, L.season);
      if (tid >= 0) Con().detach(L, p.id);
      if (lastTeam >= 0) p.ft = lastTeam;     // QA1: rollover archives this season under p.tid; History.compact maps it back
      p.tid = C.TID.RETIRED;
      p.con = null;
      p.inj = null; p.ir = false;
      out.retired.push(p.id);
      const yrs = Prog.careerYears(L, p);
      if (tid === L.userTid || p.ovr >= 80 || (p.hp || 0) >= 15) {
        N.add(L, 'retire', N.tpl('retire', { P: N.pname(p), N: Math.max(1, yrs) === 1 ? '1 season' : Math.max(1, yrs) + ' seasons', first: p.fn }), tid >= 0 ? tid : undefined);
      }
      const hp = p.hp || 0;
      if (hp >= K().HOF_POINTS) {
        p.hof = hp >= K().HOF_FIRST ? 2 : 1;
        out.hof.push(p.id);
        N.add(L, 'hof', N.tpl(p.hof === 2 ? 'hofFirst' : 'hof', { P: N.pname(p) }), tid >= 0 ? tid : undefined);
        // Hall Pass: played ≥ 3 seasons for you
        if (withYou >= 3) { car.hof++; PT.League.Achievements.award(L, 'hall_pass'); }
      }
      // retired numbers (design 14.10)
      if (lastTeam >= 0) {
        const topDog = p.aw.some((a) => a.a === 'MVP');
        if (lastTeam === L.userTid && yrsWith >= 6 && (p.hof || yrsWith >= 8 || topDog)) {
          out.prompts.push({ pid: p.id, num: p.num, n: p.fn + ' ' + p.ln, yrs: yrsWith, why: p.hof ? 'hof' : topDog ? 'mvp' : 'years' });
        } else if (lastTeam !== L.userTid && p.hof && yrsWith >= 6) {
          Prog.retireNum(L, lastTeam, p.num);
        }
      }
    }
    for (const t of L.teams) if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
    ss.bye = out;
    PT.League.WeeklyEvents.generateOffseason(L);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'retire' });
    return out;
  };

  /** Answer a retire-number prompt: yes → banner, number never reused, Hype +5. @returns {Result} */
  Prog.retireNumber = function (L, pid, yes) {
    const ss = H().ss(L);
    const bye = ss.bye || { prompts: [] };
    const i = bye.prompts.findIndex((x) => x.pid === pid);
    if (i < 0) return { ok: false, err: 'NO_PROMPT', msg: 'Nothing to answer.' };
    const pr = bye.prompts.splice(i, 1)[0];
    if (yes) {
      Prog.retireNum(L, L.userTid, pr.num);
      PT.League.Economy.addHype(L, L.userTid, 5);
      const N = PT.League.News;
      const p = Q().player(L, pid);
      N.add(L, 'award', N.tpl('retNum', { T: 'The ' + L.teams[L.userTid].name, N: pr.num, P: p ? N.pname(p) : pr.n }), L.userTid);
    }
    return { ok: true, retired: !!yes, num: pr.num };
  };

  /**
   * Add num to a team's retired numbers. A current player still wearing it (e.g. signed after the legend left as a free
   * agent) gets a new free number, so a retired number is never on the field. @returns {boolean} newly retired
   */
  Prog.retireNum = function (L, tid, num) {
    const list = L.retNums[tid] = L.retNums[tid] || [];
    if (list.indexOf(num) >= 0) return false;
    list.push(num);
    for (const pid of L.teams[tid].roster) {
      const q = Q().player(L, pid);
      if (q && q.num === num) q.num = Con().freeNum(L, tid, q.pos);
    }
    return true;
  };

  function Con() { return PT.League.Contracts; }
})(globalThis.PT = globalThis.PT || {});
