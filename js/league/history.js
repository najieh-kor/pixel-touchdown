/* Pixel Touchdown: js/league/history.js
 * Owner: WP2. Responsibility: PT.League.History: season archive, legends, compaction.
 * Also owns the per-season franchise state L.ss (History.ss / newSeason), rivalries (design 14.3), Trophy Room data
 * (14.6), Hall of Fame list (14.5), dynasty tracker (14.9) and records-book reads (14.4; writes live in awards.js).
 *
 * L.ss (per-season WP2 state, reset when L.season changes; small):
 *   { s, wk:{hook:week}, pty, sw:{tid:n}, so:[tid], nl:[pid], nx:{…next-game mods}, tpt, rivW, ev:{n:{id:c}, last:{id:wk}, quiet},
 *     camp, focus:[pid], prac, gym, rumor:[pid], tm:{pid:weeks}, ovr:[32], merch, tix, inj:{m,g}, led:{…}, gd, bye, aw,
 *     po:{rd:1}, ai:{sw}, last, kept:{pid:n}, rr, sp, fired }
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const History = PT.ns('League.History');

  const Q = () => PT.League.Q;
  const K = () => PT.League.K;

  function fresh(s) {
    return { s: s, wk: {}, pty: 0, sw: {}, so: [], nl: [], nx: {}, tpt: 0, rivW: 0, ev: { n: {}, last: {}, quiet: 0 },
      camp: 0, focus: [], prac: 'normal', gym: 0, rumor: [], tm: {}, ovr: null, merch: 0, tix: 1, inj: { m: 1, g: 0 },
      led: {}, gd: null, bye: null, aw: 0, po: {}, ai: { sw: 0 }, last: null, kept: {}, rr: 0, sp: 0 };
  }

  /**
   * Current season state, created/rolled lazily. Never throws.
   * @param {League} L @returns {Object} L.ss
   */
  History.ss = function (L) {
    if (!L.ss || L.ss.s !== L.season) History.newSeason(L);
    return L.ss;
  };

  /**
   * Start-of-season work (idempotent per season; runs at the first WP2 call of a new season, normally at rollover).
   * First call on a fresh league only initialises state. Later seasons apply the offseason drifts (design 10.10, 12, 13).
   */
  History.newSeason = function (L) {
    const first = !L.ss;
    if (L.ss && L.ss.s === L.season) return L.ss;
    L.ss = fresh(L.season);
    const car = PT.League.Coach.car(L);
    // Front Office skill 1..5 (design 17.1): tied to the starting tier ±1 so good organisations stay good longer (HUNT5 #2)
    L.teams.forEach((t) => { if (t.fo == null) t.fo = Math.max(1, Math.min(5, (t.tier || 3) + (PT.RNG.hash(L.seed, 'fo', t.id) % 3) - 1)); });
    if (!L.scout || typeof L.scout.pts !== 'number') L.scout = { pts: 0, spent: {} };
    if (first) {
      if (car.teams.indexOf(L.userTid) < 0) car.teams.push(L.userTid);
      // generated veterans: years played before the league began (HUNT5 #4), so career counts read right
      for (const p of L.players) {
        if (p.exp0 != null || p.tid === C.TID.PROSPECT || p.dr || p.cs.length) continue;
        p.exp0 = Math.max(0, p.age - 22 - (PT.RNG.hash(L.seed, p.id, 'exp0') % 2));
      }
      return L.ss;
    }
    // ---- a new season begins ----
    car.seasons++;
    if (car.teams.indexOf(L.userTid) < 0) car.teams.push(L.userTid);
    for (const p of L.players) {
      if (p.inj) { p.inj = null; }            // offseason heals everything (Season Over lasts "rest of season + playoffs")
      if (p.ir) p.ir = false;
      if (p.ph) delete p.ph;
      if (p.ak) delete p.ak;
    }
    for (const t of L.teams) {
      // Hype moves 25% toward 50 (design 10.10), Hometown Hero +3 at season start
      t.fin.hype = Math.round(t.fin.hype + (50 - t.fin.hype) * PT.League.K.ECO_HYPE_DRIFT);
      const pl = Q().roster(L, t.id);
      const hh = pl.filter((p) => p.tr.indexOf('hometown_hero') >= 0).length;
      if (hh) PT.League.Economy.addHype(L, t.id, 3 * hh);
      for (const p of pl) {
        if (p.want === 'home' && p.cs.some((c) => c.t === t.id)) p.mor = Math.min(100, p.mor + 2);
      }
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
      PT.League.Spirit.seasonStart(L, t.id);
    }
    // scouting points (design 10.6): 8 + 4 × (ScoutOffice − 1) (+3/+6 Talent Eye, +1 'scout' coach quirk)
    L.scout = { pts: History.scoutPoints(L), spent: {} };
    PT.League.Achievements.check(L, 'preseason');
    return L.ss;
  };

  /**
   * New Season (ROUND6 C: no Preseason). Runs, in order and safe to call more than once: Twists.roll, Economy.season
   * (TV + bills), Boss.setGoal, auto Training Camp for your team (if you have not done camp). Stores and returns the
   * one-card summary for HQ: { s, twist:{id,name,desc}, goal:{k,n,txt}, tv, bills, coins, camp:[{pid,key,d}], hot }.
   * WP1 may call it at rollover and at League.create (its pieces are also safe to call one by one).
   */
  History.startSeason = function (L) {
    const ss = History.ss(L);
    if (ss.card && ss.card.s === L.season) return ss.card;
    PT.League.Twists.roll(L);
    PT.League.Economy.season(L);
    PT.League.Boss.setGoal(L);
    let camp = [];
    if (!PT.League.Progression.campInfo(L).done) {
      const r = PT.League.Progression.camp(L, L.userTid, []);
      if (r.ok) camp = r.changes.map((c) => ({ pid: c.pid, key: c.key, d: c.d }));
    }
    ss.card = History.seasonSummary(L);
    ss.card.camp = camp;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'newSeason' });
    return ss.card;
  };

  /** The "New Season" card data (built from what already ran this season). */
  History.seasonSummary = function (L) {
    const ss = History.ss(L);
    const tw = PT.League.Twists.current(L);
    const led = ss.led || {};
    return { s: L.season, twist: { id: tw.id, name: tw.name, desc: tw.desc }, goal: L.boss.goal ? { k: L.boss.goal.k, n: L.boss.goal.n, txt: L.boss.goal.txt } : null,
      tv: Math.max(0, led.tv || 0), bills: Math.max(0, -((led.upk || 0) + (led.staff || 0))), coins: L.teams[L.userTid].fin.coins, hot: !!ss.hot,
      camp: ss.card && ss.card.camp ? ss.card.camp : [] };
  };

  /** The HQ "New Season" card, or null once dismissed (or before startSeason ran). */
  History.seasonCard = function (L) {
    const ss = History.ss(L);
    if (ss.cardOff) return null;
    if (!ss.card) { if (!ss.tw && !ss.eco) return null; ss.card = History.seasonSummary(L); }
    return ss.card;
  };
  /** Hide the HQ card for the rest of the season. */
  History.dismissCard = function (L) { History.ss(L).cardOff = 1; return { ok: true }; };

  /** @returns {number} scouting points the user gets this season */
  History.scoutPoints = function (L) {
    const t = L.teams[L.userTid];
    const m = PT.League.Coach.mods(L);
    const q = PT.League.Staff.quirks(L, L.userTid);
    return 8 + 4 * (t.fac.sct - 1) + (m.scoutPts || 0) + (q.scout ? 1 : 0);
  };

  /**
   * Once-per-week guard for weekly hooks. Returns true the first time (hook, week) is seen this season.
   * @param {League} L @param {string} hook @param {number} [wk]
   */
  History.once = function (L, hook, wk) {
    const ss = History.ss(L);
    const w = wk == null ? L.week : wk;
    if (ss.wk[hook] === w) return false;
    ss.wk[hook] = w;
    return true;
  };

  // ---------------- archive ----------------

  /** Push a SeasonSummary (dedupes by season). */
  History.archiveSeason = function (L, summary) {
    if (!summary) return;
    if (L.twist && summary.tw == null) summary.tw = L.twist.id;
    const i = L.hist.seasons.findIndex((x) => x.s === summary.s);
    if (i >= 0) L.hist.seasons[i] = summary; else L.hist.seasons.push(summary);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'history' });
  };

  /** Score used to rank legends when trimming (keeps HoF, award winners and your own players). */
  function legendScore(L, lg) {
    const car = PT.League.Coach.car(L);
    return (lg.hp || 0) + (lg.hof ? 100 : 0) + (lg.aw ? lg.aw.length * 5 : 0) + (lg.tids.some((t) => car.teams.indexOf(t) >= 0) ? 25 : 0);
  }

  /** Career totals of a player (cs + current st). */
  History.career = function (p) {
    const out = {};
    const add = (st) => {
      for (const k of Object.keys(st)) {
        if (k === 's' || k === 't' || !C.STATS[k]) continue;
        if (C.STAT_MAX[k]) out[k] = Math.max(out[k] || 0, st[k]); else out[k] = (out[k] || 0) + st[k];
      }
    };
    for (const c of p.cs) add(c);
    if (p.st) add(p.st);
    return out;
  };

  /** Build a Legend record for a retired player. */
  History.toLegend = function (L, p) {
    const seasons = p.cs.map((c) => c.s);
    if (p.st && p.st.gp && seasons.indexOf(L.season) < 0) seasons.push(L.season);
    const pre = Math.max(0, PT.League.Progression.careerYears(L, p) - Object.keys(seasons.reduce((o, s) => { o[s] = 1; return o; }, {})).length);
    const tids = [];
    for (const c of p.cs) if (c.t >= 0 && tids.indexOf(c.t) < 0) tids.push(c.t);
    return {
      id: p.id, fn: p.fn, ln: p.ln, sp: p.sp, pos: p.pos, num: p.num,
      yrs: seasons.length ? [Math.min.apply(null, seasons) - pre, Math.max.apply(null, seasons)] : [L.season - pre, L.season],
      tids: tids, car: History.career(p), aw: p.aw.slice(), hof: !!p.hof, hp: p.hp || 0, fb: p.hof === 2 ? 1 : 0, ovr: p.ovr
    };
  };

  /**
   * Rollover compaction (ARCHITECTURE 2.9). Removes retired players (notable ones become Legends, cap 300),
   * trims the FA pool to C.FA_POOL_MAX, clears old boxes, prunes dead money / picks / cooldowns, decays rivalries.
   */
  History.compact = function (L) {
    const car = PT.League.Coach.car(L);
    const legIds = {};
    for (const lg of L.hist.legends) legIds[lg.id] = 1;
    const keep = [];
    for (const p of L.players) {
      if (p.tid === C.TID.RETIRED) {
        // the final season was archived at rollover with t = RETIRED: credit it to the team he retired from
        for (const c of p.cs) if (c.t === C.TID.RETIRED) c.t = p.ft != null ? p.ft : C.TID.FA;
        const notable = p.hof || p.aw.length > 0 || p.cs.some((c) => car.teams.indexOf(c.t) >= 0);
        if (notable && !legIds[p.id]) { L.hist.legends.push(History.toLegend(L, p)); legIds[p.id] = 1; }
        continue;
      }
      // career seasons: non-zero keys only
      for (const c of p.cs) for (const k of Object.keys(c)) if (c[k] === 0 && k !== 't' && k !== 's') delete c[k];
      keep.push(p);
    }
    L.players = keep;
    // legends cap
    const max = K().LEGENDS_MAX;
    if (L.hist.legends.length > max) {
      L.hist.legends = L.hist.legends.map((lg, i) => [lg, legendScore(L, lg), i]).sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]))
        .slice(0, max).sort((a, b) => a[2] - b[2]).map((x) => x[0]);
    }
    History.trimFA(L);
    // boxes from older seasons
    for (const gid of Object.keys(L.box)) if (L.box[gid].s !== L.season) delete L.box[gid];
    // dead money, picks
    for (const t of L.teams) {
      t.dead = t.dead.filter((d) => d.s >= L.season && d.amt > 0);
      t.picks = t.picks.filter((pk) => pk.s > L.season);
    }
    for (let s = L.season + 1; s <= L.season + 2; s++) {
      for (const t of L.teams) {
        for (let rd = 1; rd <= C.DRAFT_ROUNDS; rd++) {
          const held = L.teams.some((o) => o.picks.some((pk) => pk.s === s && pk.rd === rd && pk.orig === t.id));
          if (!held) t.picks.push({ s: s, rd: rd, orig: t.id });
        }
      }
    }
    // event cooldown memory: only defs with cooldowns, only while active
    const EV = PT.Data.WeeklyEvents;
    for (const id of Object.keys(L.ev.seen)) {
      const d = EV && EV.byId ? EV.byId(id) : null;
      if (!d || !d.cd || L.season - L.ev.seen[id] > d.cd) delete L.ev.seen[id];
    }
    // hot rivalry decay −10 per season
    for (const tid of Object.keys(car.riv)) {
      const r = car.riv[tid];
      r.sc = Math.max(0, (r.sc || 0) - 10);
    }
    if (L.news.length > 60) L.news.length = 60;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'compact' });
    return { players: L.players.length, legends: L.hist.legends.length };
  };

  /** Trim the Market pool to C.FA_POOL_MAX (lowest OVR deleted; your former players are kept first). */
  History.trimFA = function (L) {
    const fas = L.players.filter((p) => p.tid === C.TID.FA);
    if (fas.length > C.FA_POOL_MAX) {
      const drop = {};
      fas.slice().sort((a, b) => (a.ovr - b.ovr) || (b.age - a.age) || (a.id - b.id)).slice(0, fas.length - C.FA_POOL_MAX)
        .forEach((p) => { drop[p.id] = 1; });
      L.players = L.players.filter((p) => !drop[p.id]);
    }
    if (PT.League.hydrate) PT.League.hydrate(L);
  };

  /** Legends sorted (newest retirement first). */
  History.legends = function (L) {
    return L.hist.legends.slice().sort((a, b) => (b.yrs[1] - a.yrs[1]) || ((b.hp || 0) - (a.hp || 0)));
  };

  /** Hall of Fame gallery: inducted legends + retired-this-season inductees, sorted by year. */
  History.hallOfFame = function (L) {
    const out = L.hist.legends.filter((lg) => lg.hof);
    for (const p of L.players) if (p.tid === C.TID.RETIRED && p.hof && !out.some((x) => x.id === p.id)) out.push(History.toLegend(L, p));
    return out.sort((a, b) => a.yrs[1] - b.yrs[1]);
  };

  // ---------------- rivalries (design 14.3) ----------------

  function rivRec(L, tid) {
    const car = PT.League.Coach.car(L);
    if (!car.riv[tid]) car.riv[tid] = { sc: 0, w: 0, l: 0, t: 0 };
    return car.riv[tid];
  }

  /** Hot rival of the user: the non-fixed team with the highest score ≥ 30. */
  History.hotRival = function (L) {
    const car = PT.League.Coach.car(L);
    const fixed = L.teams[L.userTid].rival;
    let best = null;
    for (const k of Object.keys(car.riv)) {
      const tid = +k, r = car.riv[k];
      if (tid === fixed || tid === L.userTid || r.sc < 30) continue;
      if (!best || r.sc > best.sc || (r.sc === best.sc && tid < best.tid)) best = { tid: tid, sc: r.sc };
    }
    return best;
  };

  /** Is this game a rivalry game (fixed rival of either side, or the user's Hot Rival)? */
  History.isRivalGame = function (L, h, a) {
    if (L.teams[h].rival === a || L.teams[a].rival === h) return true;
    const u = L.userTid;
    if (h !== u && a !== u) return false;
    const hr = History.hotRival(L);
    return !!hr && (hr.tid === h || hr.tid === a);
  };

  /** Rival records for the League page: fixed + hot. */
  History.rivals = function (L) {
    const fixed = L.teams[L.userTid].rival;
    const fr = rivRec(L, fixed);
    const hot = History.hotRival(L);
    return { fixed: { tid: fixed, w: fr.w, l: fr.l, t: fr.t }, hot: hot ? Object.assign({ tid: hot.tid, sc: hot.sc }, (({ w, l, t }) => ({ w, l, t }))(rivRec(L, hot.tid))) : null };
  };

  /** Per-game rivalry bookkeeping for the user team (called from the post-game hook). */
  History.onGame = function (L, box) {
    const u = L.userTid;
    if (box.h !== u && box.a !== u) return;
    const opp = box.h === u ? box.a : box.h;
    const r = rivRec(L, opp);
    const us = box.h === u ? box.hs : box.as, them = box.h === u ? box.as : box.hs;
    if (us > them) r.w++; else if (us < them) r.l++; else r.t++;
    if (box.po) { r.sc += 25; if (us !== them) r.sc += 15; } else if (Math.abs(us - them) <= 7) r.sc += 10;
    if (opp === L.teams[u].rival && us > them && !box.po) History.ss(L).rivW++;
  };

  // ---------------- trophy room, dynasty, legacy (design 14.6 / 14.9) ----------------

  /** Seasons (by L.coach career) in which the user's team won the Bowl. */
  History.bowls = function (L) { return PT.League.Coach.car(L).bowl.slice(); };

  /**
   * Dynasty tracker: consecutive playoff seasons, consecutive winning seasons, Bowls in the last 5 seasons.
   * Uses the user's franchise records (team.rec).
   */
  History.dynasty = function (L) {
    const rec = L.teams[L.userTid].rec.slice().sort((a, b) => a.s - b.s);
    let po = 0, win = 0;
    for (let i = rec.length - 1; i >= 0; i--) { if (rec[i].res) po++; else break; }
    for (let i = rec.length - 1; i >= 0; i--) { if (rec[i].w > rec[i].l) win++; else break; }
    const b5 = PT.League.Coach.car(L).bowl.filter((s) => s > L.season - 5).length;
    return { playoffStreak: po, winStreak: win, bowlsLast5: b5, dynasty: b5 >= 3 };
  };

  /**
   * Trophy Room data (list view, design 14.6).
   * @returns {{carrots, conf, div, plaques, retired, hofCoached, achievements, legacy, dynasty}}
   */
  History.trophies = function (L) {
    const car = PT.League.Coach.car(L);
    const mine = (tid) => car.teams.indexOf(tid) >= 0;
    const carrots = [], conf = [], div = [];
    for (const s of L.hist.seasons) {
      if (s.champ != null && mine(s.champ) && car.bowl.indexOf(s.s) >= 0) {
        const row = (s.std || []).find((r) => r[0] === s.champ);
        carrots.push({ s: s.s, tid: s.champ, score: s.bowl || null, w: row ? row[1] : null, l: row ? row[2] : null });
      }
    }
    for (const s of L.hist.seasons) {
      const ut = s.user && s.user.tid != null ? s.user.tid : null;
      if (ut == null || !mine(ut)) continue;
      if (s.champ === ut || s.ru === ut) conf.push({ s: s.s, tid: ut });
      if ((s.divW || []).indexOf(ut) >= 0) div.push({ s: s.s, tid: ut });
    }
    const plaques = [];
    const coachedTeams = car.teams;
    for (const p of L.players) for (const a of p.aw) if (coachedTeams.indexOf(a.t != null ? a.t : p.tid) >= 0 && a.a !== 'CHAMP') plaques.push({ pid: p.id, n: p.fn + ' ' + p.ln, s: a.s, a: a.a });
    const hofCoached = History.hallOfFame(L).filter((lg) => lg.tids.some((t) => mine(t)));
    const ach = PT.League.Achievements.list(L).filter((a) => a.got != null);
    return {
      carrots: carrots, conf: conf, div: div, plaques: plaques.slice(0, 200),
      retired: Object.keys(L.retNums).filter((k) => mine(+k)).map((k) => ({ tid: +k, nums: L.retNums[k].slice() })),
      hofCoached: hofCoached, achievements: ach, legacy: PT.League.Coach.legacy(L), dynasty: History.dynasty(L)
    };
  };

  /** Legacy score + title (alias of Coach.legacy, for the UI). */
  History.legacy = function (L) { return PT.League.Coach.legacy(L); };

  /**
   * Retire a jersey number for a team (UI shape). Answers the Goodbyes prompt when one matches (Hype +5), else just
   * records the number. @returns {Result}
   */
  History.retireNumber = function (L, tid, num) {
    const bye = L.ss && L.ss.bye;
    const pr = bye && tid === L.userTid ? bye.prompts.find((x) => x.num === num) : null;
    if (pr) return PT.League.Progression.retireNumber(L, pr.pid, true);
    // Hype +5 only for an eligible player: a player retiring this season with that number and 3+ seasons on this team
    // (the prompt list is handled above). Anyone else: the number is retired, but no Hype (matches the Goodbyes UI).
    const PG = PT.League.Progression;
    const eligible = L.players.some((p) => p.tid === C.TID.RETIRED && p.num === num &&
      (p.ft === tid || p.cs.some((c) => c.t === tid)) && PG.seasonsWith(p, tid, p.ft, L.season) >= 3);
    const added = PG.retireNum(L, tid, num);
    if (added && eligible) PT.League.Economy.addHype(L, tid, 5);
    return { ok: true, retired: true, num: num, hype: added && eligible ? 5 : 0 };
  };

  /** Records book (design 14.4): league + your franchise. */
  History.records = function (L) {
    const R = L.hist.rec;
    return { league: R.league, franchise: (R.franchise && R.franchise[L.userTid]) || { season: {}, game: {} } };
  };
})(globalThis.PT = globalThis.PT || {});
