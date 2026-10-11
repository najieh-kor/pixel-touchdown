/* Pixel Touchdown: js/league/awards.js
 * Owner: WP2. Responsibility: PT.League.Awards: MVP/OPOY/DPOY/ROY/Coach, All-League, records (design 10.12, 14.4, 14.5, 14.11).
 * Award codes in p.aw: MVP (Top Dog) · OPOY (Best Offense) · DPOY (Best Defense) · ROY (Best Newbie) · PRO (Pixel Pro Team).
 * Awards.checkGameRecords(L, box) is the per-game franchise hook (Games.record calls it for every game): money, Hype,
 * Mood/Spirit, Boss, Coach XP, rivalries, achievements, records, milestones, playoff-week ticks.
 * Records: L.hist.rec = { league:{game,season,career,play,team}, franchise:{[tid]:{game,season,play,team}} },
 * entry = { v, pid, s, t, n } (n = holder name). Season 1 sets records quietly; later breaks are announced.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Aw = PT.ns('League.Awards');
  const Q = () => PT.League.Q;
  const H = () => PT.League.History;

  Aw.REC_KEYS = ['py', 'ptd', 'ry', 'rtd', 'rcy', 'rctd', 'rc', 'tk', 'dsk', 'int', 'fgm'];
  Aw.MILESTONES = {
    career: { py: [10000, 25000, 50000], ptd: [100, 250], ry: [5000, 10000], rcy: [5000, 10000], dsk: [50, 100], int: [25, 50], gp: [100, 200] },
    season: { py: [4000], ry: [1000], rcy: [1000], dsk: [10], int: [5] }
  };
  const OFF = { QB: 1, RB: 1, WR: 1, TE: 1 }, DEF = { DL: 1, LB: 1, CB: 1, S: 1 };

  // ---------------- scores (10.12) ----------------

  /** Season score parts for a stat line. */
  Aw.parts = function (st) {
    st = st || {};
    const g = (k) => st[k] || 0;
    return {
      off: g('py') / 25 + g('ptd') * 4 - g('pi') * 2 + g('ry') / 10 + g('rtd') * 6 + g('rcy') / 10 + g('rctd') * 6 + g('rc') * 0.5 - g('fl') * 2,
      def: g('tk') + g('dsk') * 4 + g('int') * 6 + g('ff') * 4 + g('pd') * 1.5 + g('dtd') * 6,
      k: g('fgm') * 3 + (g('fglg') >= 50 ? 2 : 0) - (g('fga') - g('fgm')) * 2 + g('xpm') * 0.5
    };
  };
  /** A player's season score at his position (OL: 3 × OVR × starts / 17). */
  Aw.score = function (p) {
    const s = Aw.parts(p.st);
    if (p.pos === 'OL') return 3 * p.ovr * ((p.st && p.st.gs) || 0) / C.GAMES_PER_TEAM;
    if (p.pos === 'K') return s.k;
    if (DEF[p.pos]) return s.def;
    return s.off;
  };

  function teamWins(L) {
    const w = {};
    for (const r of PT.League.Standings.get(L)) w[r.tid] = r;
    return w;
  }
  function isNewbie(L, p) { return p.yr1 === L.season || (p.dr && p.dr.s === L.season); }

  function giveAward(L, p, code, big) {
    if (!p) return;
    if (!p.aw.some((a) => a.s === L.season && a.a === code)) p.aw.push({ s: L.season, a: code, t: p.tid });
    PT.League.Spirit.addMood(L, p, big ? 10 : 5, 'award');
    if (big && p.tid >= 0) PT.League.Economy.addHype(L, p.tid, 3);
    if (big && p.tid === L.userTid) PT.League.Coach.addXp(L, PT.League.Coach.XP.award, 'award');
    if (big) {
      const N = PT.League.News, names = (PT.Data.Text && PT.Data.Text.awards) || {};
      N.add(L, 'award', N.tpl('award', { P: N.pname(p), award: names[code] || code }), p.tid >= 0 ? p.tid : undefined);
    }
  }

  /** Playoff result code for a team this season: CHAMP · RU · CONF · DIV · WC · null. */
  Aw.result = function (L, tid) {
    if (L.po && L.po.champ === tid) return 'CHAMP';
    let lost = 0;
    for (const g of L.sched) {
      if (!g.po || g.st !== 'F' || (g.h !== tid && g.a !== tid)) continue;
      const won = g.h === tid ? g.hs > g.as : g.as > g.hs;
      if (!won) lost = g.po;
    }
    return lost === 4 ? 'RU' : lost === 3 ? 'CONF' : lost === 2 ? 'DIV' : lost === 1 ? 'WC' : null;
  };

  /**
   * Awards Night (enter SEASON_END). Idempotent per season. Also: HoF points, Boss evaluation, Coach XP, season
   * achievements, season/career records, AI team modes. @returns {SeasonSummary}
   */
  Aw.compute = function (L) {
    const ss = H().ss(L);
    if (ss.sum) return ss.sum;
    const W = teamWins(L);
    const active = L.players.filter((p) => p.tid >= 0 && p.st && p.st.gp);
    let mvp = null, mv = -Infinity, opoy = null, ov = -Infinity, dpoy = null, dv = -Infinity, roy = null, rv = -Infinity;
    for (const p of active) {
      const s = Aw.parts(p.st);
      const wins = W[p.tid] ? W[p.tid].w : 0;
      const m = Math.max(OFF[p.pos] ? s.off : -Infinity, DEF[p.pos] ? s.def * 1.2 : -Infinity);
      if (isFinite(m) && m + wins * 5 > mv) { mv = m + wins * 5; mvp = p; }
      if (OFF[p.pos]) { const o = s.off * (p.pos === 'QB' ? 1 : 1.1); if (o > ov) { ov = o; opoy = p; } }
      if (DEF[p.pos] && s.def > dv) { dv = s.def; dpoy = p; }
      if (isNewbie(L, p) && isFinite(m) && m > rv) { rv = m; roy = p; }
    }
    // Pixel Pro Team: best score at each of the 15 starter slots
    const allLg = [];
    const used = {};
    for (const slot of C.SLOTS) {
      if (slot === 'KR') continue;
      const pos = C.SLOT_POS[slot];
      let best = null, bv = -Infinity;
      for (const p of active) { if (p.pos !== pos || used[p.id]) continue; const v = Aw.score(p); if (v > bv) { bv = v; best = p; } }
      if (best) { used[best.id] = 1; allLg.push(best.id); }
    }
    // Coach of the Year: wins − expected (8.5 + (teamOVR − leagueAvg) × 0.6), preseason OVR snapshot
    const ovr = ss.ovr || L.teams.map((t) => Q().teamOvr(L, t.id).ovr);
    const avg = ovr.reduce((a, b) => a + b, 0) / ovr.length;
    let coy = 0, cv = -Infinity;
    for (const t of L.teams) { const d = (W[t.id] ? W[t.id].w + 0.5 * W[t.id].t : 0) - (8.5 + (ovr[t.id] - avg) * 0.6); if (d > cv) { cv = d; coy = t.id; } }

    const fin = L.sched.find((g) => g.po === C.PLAYOFF_ROUNDS && g.st === 'F');
    const champ = L.po ? L.po.champ : null;
    const ru = fin ? (fin.h === champ ? fin.a : fin.h) : null;
    const lead = (k) => {
      let b = null;
      for (const p of active) if ((p.st[k] || 0) > 0 && (!b || p.st[k] > b.st[k])) b = p;
      return b ? [b.id, b.st[k]] : [null, 0];
    };
    const divW = (L.po && L.po.seeds ? L.po.seeds.map((s) => s.slice(0, C.DIVS_PER_CONF)) : []).reduce((a, b) => a.concat(b), []);
    const u = L.userTid, ur = W[u] || { w: 0, l: 0, t: 0 };
    const sum = {
      s: L.season, champ: champ, ru: ru, mvp: mvp ? mvp.id : null, opoy: opoy ? opoy.id : null, dpoy: dpoy ? dpoy.id : null,
      roy: roy ? roy.id : null, coy: coy, allLg: allLg,
      std: L.teams.map((t) => { const r = W[t.id] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 }; return [t.id, r.w, r.l, r.t, r.pf, r.pa]; }),
      user: { tid: u, w: ur.w, l: ur.l, t: ur.t, res: Aw.result(L, u), coins: L.teams[u].fin.coins, hype: L.teams[u].fin.hype,
        goal: L.boss.goal ? L.boss.goal.n : null },
      leaders: { py: lead('py'), ry: lead('ry'), rcy: lead('rcy'), dsk: lead('dsk'), int: lead('int') },
      tw: L.twist ? L.twist.id : 'normal', divW: divW, bowl: fin ? Math.max(fin.hs, fin.as) + '–' + Math.min(fin.hs, fin.as) : null,
      cap: PT.League.Cap.cap(L)
    };
    // rewards
    const P = (pid) => (pid != null ? Q().player(L, pid) : null);
    giveAward(L, P(sum.mvp), 'MVP', true);
    giveAward(L, P(sum.opoy), 'OPOY', true);
    giveAward(L, P(sum.dpoy), 'DPOY', true);
    giveAward(L, P(sum.roy), 'ROY', true);
    for (const pid of allLg) giveAward(L, P(pid), 'PRO', false);
    if (coy === u) PT.League.Coach.addXp(L, PT.League.Coach.XP.award, 'coy');
    // Hall of Fame points (14.5)
    const starterChamp = {};
    if (champ != null) for (const s of C.SLOTS) { const t = L.teams[champ]; if (s !== 'KR' && t.dc[s] && t.dc[s][0] != null) starterChamp[t.dc[s][0]] = 1; }
    for (const p of L.players) {
      if (p.tid < 0 && p.tid !== C.TID.FA) continue;
      let hp = p.ovr >= 90 ? 4 : p.ovr >= 85 ? 3 : p.ovr >= 80 ? 2 : p.ovr >= 75 ? 1 : 0;
      if (p.id === sum.mvp) hp += 6;
      if (p.id === sum.opoy || p.id === sum.dpoy) hp += 4;
      if (p.id === sum.roy) hp += 1;
      if (allLg.indexOf(p.id) >= 0) hp += 2;
      if (starterChamp[p.id]) hp += 2;
      if (hp) p.hp = (p.hp || 0) + hp;
    }
    // coach career + Boss + achievements
    const car = PT.League.Coach.car(L);
    if (divW.indexOf(u) >= 0) { car.div++; PT.League.Coach.addXp(L, PT.League.Coach.XP.div, 'div'); }
    PT.League.Boss.evaluate(L);
    seasonRecords(L, ur);
    PT.League.Achievements.check(L, 'season', { sum: sum });
    if (champ != null) {                     // HUNT5 #3: the calendar may already have posted the same headline
      const txt = PT.League.News.tpl('champ', { T: 'The ' + L.teams[champ].name });
      if (!L.news.some((x) => x.s === L.season && x.txt === txt)) PT.League.News.add(L, 'award', txt, champ);
    }
    if (coy != null) PT.League.News.add(L, 'award', PT.League.News.tpl('coy', { T: 'The ' + L.teams[coy].name }), coy);
    PT.League.AIGM.setModes(L, true);
    ss.sum = sum;
    ss.aw = 1;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'awards' });
    return sum;
  };

  /** Awards Night cards for the UI. @returns {{code, name, pid, tid, line}[]} */
  Aw.night = function (L) {
    const sum = (L.ss && L.ss.sum) || L.hist.seasons.find((s) => s.s === L.season);
    if (!sum) return [];
    const names = (PT.Data.Text && PT.Data.Text.awards) || {};
    const out = [];
    const add = (code, pid) => { const p = pid != null ? Q().player(L, pid) : null; if (p) out.push({ code: code, name: names[code] || code, pid: pid, tid: p.tid, line: p.fn + ' ' + p.ln }); };
    add('MVP', sum.mvp); add('OPOY', sum.opoy); add('DPOY', sum.dpoy); add('ROY', sum.roy);
    out.push({ code: 'COY', name: names.COY || 'Coach of the Year', pid: null, tid: sum.coy, line: L.teams[sum.coy].name });
    return out;
  };

  // ---------------- records (14.4) ----------------

  function recRoot(L) {
    const R = L.hist.rec = L.hist.rec || {};
    R.league = R.league || {};
    for (const k of ['game', 'season', 'career', 'play', 'team']) R.league[k] = R.league[k] || {};
    R.franchise = R.franchise || {};
    return R;
  }
  function fr(L, tid) {
    const R = recRoot(L);
    if (!R.franchise[tid]) R.franchise[tid] = { game: {}, season: {}, play: {}, team: {} };
    return R.franchise[tid];
  }
  function announce(L) { return L.hist.seasons.some((s) => s.s < L.season) || L.season > C.START_SEASON; }

  /**
   * Try to set a record. Returns 'new' when a different holder's mark (or another season's own mark) is beaten.
   */
  function trySet(book, key, v, holder) {
    const cur = book[key];
    if (cur && v <= cur.v) return null;
    book[key] = { v: v, pid: holder.pid, s: holder.s, t: holder.t, n: holder.n };
    // only a mark that stood from an earlier season counts as "broken" (no spam while a season's marks settle)
    return cur && cur.s < holder.s ? 'new' : cur ? 'extend' : 'first';
  }

  function onRecord(L, p, label, tid, out, isLeague) {
    out.push({ pid: p ? p.id : null, tid: tid, stat: label, league: isLeague });
    if (!isLeague) return;
    const N = PT.League.News;
    const names = (PT.Data.Text && PT.Data.Text.stats) || {};
    if (p) N.add(L, 'rec', N.tpl('record', { P: N.pname(p), stat: names[label] || label }), tid);
    else N.add(L, 'rec', N.tpl('teamRecord', { T: 'The ' + L.teams[tid].name, stat: names[label] || label }), tid);
    if (p) PT.League.Spirit.addMood(L, p, 5, 'record');
    PT.League.Economy.addHype(L, tid, 2);
    if (tid === L.userTid) PT.League.Achievements.award(L, 'record_breaker');
  }

  /** Single-play TD lengths from the scoring summary (sc.yd or "NN yd … pass/run/pick" text). */
  function playLens(box, tid) {
    const out = { tdPass: 0, tdRun: 0, pickRet: 0 };
    for (const s of box.sc || []) {
      if (s.t !== tid || s.k !== 'TD') continue;
      const txt = String(s.txt || '').toLowerCase();
      let y = typeof s.yd === 'number' ? s.yd : null;
      if (y == null) { const m = /(\d+)\s*-?\s*(yd|yard)/.exec(txt); if (m) y = +m[1]; }
      if (y == null) continue;
      const kind = s.how || (txt.indexOf('pick') >= 0 || txt.indexOf('intercept') >= 0 ? 'pick' : txt.indexOf('pass') >= 0 ? 'pass' : txt.indexOf('run') >= 0 || txt.indexOf('rush') >= 0 ? 'run' : null);
      if (kind === 'pass') out.tdPass = Math.max(out.tdPass, y);
      else if (kind === 'run') out.tdRun = Math.max(out.tdRun, y);
      else if (kind === 'pick') out.pickRet = Math.max(out.pickRet, y);
    }
    return out;
  }

  /** Game + season + play records from one box. @returns {{pid, tid, stat, league}[]} */
  function gameRecords(L, box) {
    const R = recRoot(L);
    const out = [];
    const loud = announce(L);
    const users = PT.League.Coach.car(L).teams;
    for (const pid of Object.keys(box.pl || {})) {
      const ln = box.pl[pid];
      const p = Q().player(L, +pid);
      if (!p) continue;
      const h = { pid: p.id, s: L.season, t: ln.t, n: p.fn + ' ' + p.ln };
      for (const k of Aw.REC_KEYS) {
        if (!ln[k]) continue;
        const r1 = trySet(R.league.game, k, ln[k], Object.assign({ g: box.gid }, h));
        if (r1 === 'new' && loud) onRecord(L, p, k, ln.t, out, true);
        const sv = (p.st && p.st[k]) || 0;
        const r2 = trySet(R.league.season, k, sv, h);
        if (r2 === 'new' && loud) onRecord(L, p, k, ln.t, out, true);
        if (ln.t === L.userTid || users.indexOf(ln.t) >= 0) {
          const F = fr(L, ln.t);
          if (trySet(F.game, k, ln[k], h) === 'new' && loud) onRecord(L, p, k, ln.t, out, false);
          if (trySet(F.season, k, sv, h) === 'new' && loud) onRecord(L, p, k, ln.t, out, false);
        }
      }
      if (ln.fglg && ln.fgm) {
        if (trySet(R.league.play, 'fgLong', ln.fglg, h) === 'new' && loud) onRecord(L, p, 'fgLong', ln.t, out, true);
        if (ln.t === L.userTid) trySet(fr(L, ln.t).play, 'fgLong', ln.fglg, h);
      }
    }
    // single plays & team game records
    [box.h, box.a].forEach((tid) => {
      const pl = playLens(box, tid);
      const h = { pid: null, s: L.season, t: tid, n: L.teams[tid].name };
      for (const k of ['tdPass', 'tdRun', 'pickRet']) {
        if (!pl[k]) continue;
        if (trySet(R.league.play, k, pl[k], h) === 'new' && loud) onRecord(L, null, k, tid, out, true);
        if (tid === L.userTid) trySet(fr(L, tid).play, k, pl[k], h);
      }
      const us = tid === box.h ? box.hs : box.as, them = tid === box.h ? box.as : box.hs;
      if (trySet(R.league.team, 'pts', us, h) === 'new' && loud) onRecord(L, null, 'pts', tid, out, true);
      if (us > them && trySet(R.league.team, 'margin', us - them, h) === 'new' && loud) onRecord(L, null, 'margin', tid, out, true);
      if (tid === L.userTid) { trySet(fr(L, tid).team, 'pts', us, h); if (us > them) trySet(fr(L, tid).team, 'margin', us - them, h); }
    });
    return out;
  }

  /** Season-end team records + career records. */
  function seasonRecords(L) {
    const R = recRoot(L);
    const loud = announce(L);
    const out = [];
    for (const row of PT.League.Standings.get(L)) {
      const h = { pid: null, s: L.season, t: row.tid, n: L.teams[row.tid].name };
      if (trySet(R.league.team, 'wins', row.w, h) === 'new' && loud) onRecord(L, null, 'wins', row.tid, out, true);
      // longest win streak this season
      let best = 0, cur = 0;
      for (const g of L.sched.filter((x) => x.st === 'F' && (x.h === row.tid || x.a === row.tid)).sort((a, b) => (a.po - b.po) || (a.wk - b.wk))) {
        const won = g.h === row.tid ? g.hs > g.as : g.as > g.hs;
        cur = won ? cur + 1 : 0; best = Math.max(best, cur);
      }
      trySet(R.league.team, 'streak', best, h);
      if (row.tid === L.userTid) { trySet(fr(L, row.tid).team, 'wins', row.w, h); trySet(fr(L, row.tid).team, 'streak', best, h); }
    }
    // Pixel Bowl Titles
    const champs = {};
    for (const s of L.hist.seasons) if (s.champ != null && s.s !== L.season) champs[s.champ] = (champs[s.champ] || 0) + 1;
    if (L.po && L.po.champ != null) champs[L.po.champ] = (champs[L.po.champ] || 0) + 1;
    for (const tid of Object.keys(champs)) trySet(R.league.team, 'carrots', champs[tid], { pid: null, s: L.season, t: +tid, n: L.teams[+tid].name });
    // career records (active players)
    for (const p of L.players) {
      if (p.tid < 0) continue;
      const car = H().career(p);
      const h = { pid: p.id, s: L.season, t: p.tid, n: p.fn + ' ' + p.ln };
      for (const k of Aw.REC_KEYS) if (car[k] && trySet(R.league.career, k, car[k], h) === 'new' && loud) onRecord(L, p, k, p.tid, out, true);
    }
    return out;
  }

  // ---------------- milestones (14.11) ----------------

  function milestones(L, box) {
    const out = [];
    const N = PT.League.News;
    const names = (PT.Data.Text && PT.Data.Text.stats) || {};
    for (const pid of Object.keys(box.pl || {})) {
      const ln = box.pl[pid];
      const p = Q().player(L, +pid);
      if (!p) continue;
      const car = H().career(p);
      for (const kind of ['season', 'career']) {
        const M = Aw.MILESTONES[kind];
        for (const k of Object.keys(M)) {
          const add = ln[k] || (k === 'gp' ? (ln.gp ? 1 : 0) : 0);
          if (!add) continue;
          const now = kind === 'season' ? (p.st[k] || 0) : (car[k] || 0);
          const before = now - add;
          for (const thr of M[k]) {
            if (before < thr && now >= thr) {
              out.push({ pid: p.id, tid: ln.t, stat: k, n: thr, kind: kind });
              PT.League.Spirit.addMood(L, p, 5, 'milestone');
              PT.League.Economy.addHype(L, ln.t, 1);
              if (kind === 'career') p.hp = (p.hp || 0) + 1;
              // HUNT4-league #5: headlines only for your players and the league leader in that stat; the rest merge
              const top3 = kind === 'season' && Q().leaders(L, k, 1).some((x) => x.pid === p.id);
              if (ln.t === L.userTid || top3) {
                N.add(L, 'ms', N.tpl('milestone', { P: N.pname(p), N: thr.toLocaleString ? thr.toLocaleString('en-US') : thr, stat: names[k] || k }), ln.t);
              } else {
                const agg = L.news.find((x) => x.k === 'ms' && x.agg && x.s === L.season && x.wk === L.week);
                if (agg) { agg.agg++; agg.txt = agg.agg + ' more players hit milestones this week'; }
                else { const it = N.add(L, 'ms', '1 more player hit a milestone this week'); it.agg = 1; }
              }
            }
          }
        }
      }
    }
    return out;
  }

  // ---------------- the per-game hook ----------------

  /**
   * Games.record hook (every game). Applies all franchise effects of one final box and returns what the Final screen
   * shows: { records, milestones, achievements, coins, hype, xp, boss }. Also kept in L.ss.last for user games.
   */
  Aw.checkGameRecords = function (L, box) {
    if (!box || box.h == null) return { records: [], milestones: [], achievements: [] };
    const ss = H().ss(L);
    const u = L.userTid;
    const userIn = box.h === u || box.a === u;
    // playoff weeks: run the weekly upkeep the calendar runs in the regular season (guarded per week)
    if (box.po >= 1 && L.phase === 'PLAYOFFS') {
      PT.League.Injuries.weekly(L);
      PT.League.Progression.weekly(L);
      PT.League.Economy.weekly(L);
      PT.League.AIGM.weekly(L);
    }
    const eco = PT.League.Economy.onGame(L, box);
    PT.League.Spirit.onGame(L, box);
    H().onGame(L, box);
    let xp = 0, boss = 0, ach = [];
    if (userIn) {
      const us = box.h === u ? box.hs : box.as, them = box.h === u ? box.as : box.hs;
      boss = PT.League.Boss.onGame(L, box);
      xp = PT.League.Coach.onGame(L, box);
      for (const s of box.sc || []) if (s.t === u && s.k === '2PT') ss.tpt++;
      PT.League.WeeklyEvents.afterUserGame(L, us > them ? true : us < them ? false : null);
      ach = PT.League.Achievements.check(L, 'game', { box: box });
    }
    const records = gameRecords(L, box);
    const ms = milestones(L, box);
    if (userIn && box.po >= 1 && box.po < C.PLAYOFF_ROUNDS) {
      const won = box.h === u ? box.hs > box.as : box.as > box.hs;
      if (won) PT.League.WeeklyEvents.generate(L);
    }
    const res = { gid: box.gid, records: records, milestones: ms, achievements: ach, coins: eco.coins[u] || 0, hype: eco.hype[u] || 0, xp: xp, boss: boss };
    if (userIn) ss.last = res;
    return res;
  };

  /** What the Final screen shows for the user's last game (coins, XP, achievements, milestones, records). */
  Aw.lastGame = function (L) { return (L.ss && L.ss.s === L.season && L.ss.last) || null; };
})(globalThis.PT = globalThis.PT || {});
