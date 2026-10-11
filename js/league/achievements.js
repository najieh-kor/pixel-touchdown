/* Pixel Touchdown: js/league/achievements.js
 * Owner: WP2. Responsibility: PT.League.Achievements: the 32 achievements (design 14.7, R8), checks + Coin rewards.
 * L.ach = { achId: season earned }. Each award: Coins (PT.Data.Achievements[].coins) + 25 Coach XP + news + bus
 * 'league:achievement' {id}. Checked at hooks: 'game' {box} · 'season' · 'growth' · 'facility' · 'roster' · 'coins' ·
 * 'hype' · 'boss' · 'preseason'. Engine-only ones (Juke Box, Superstar Stop) come from Session via Achievements.engine().
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Ach = PT.ns('League.Achievements');
  const Q = () => PT.League.Q;
  const H = () => PT.League.History;

  function defs() { return (PT.Data.Achievements && PT.Data.Achievements.list) || []; }
  function def(id) { return defs().find((d) => d.id === id) || null; }

  /** @returns {{id, name, desc, coins, icon, got:number|null}[]} */
  Ach.list = function (L) {
    return defs().map((a) => ({ id: a.id, n: a.n, name: a.name, desc: a.desc, coins: a.coins, icon: a.icon, got: L.ach[a.id] != null ? L.ach[a.id] : null }));
  };

  /** Award once. @returns {boolean} newly earned */
  Ach.award = function (L, id) {
    const d = def(id);
    if (!d || L.ach[id] != null) return false;
    if (L.tmp) return false;                       // Quick Game / Practice throwaway league: no badges
    L.ach[id] = L.season;
    if (d.coins) PT.League.Economy.addCoins(L, L.userTid, d.coins, 'ach');
    PT.League.Coach.addXp(L, PT.League.Coach.XP.ach, 'ach');
    PT.League.News.add(L, 'award', PT.League.News.tpl('achievement', { N: d.name }), L.userTid);
    const ss = H().ss(L);
    ss.newAch = (ss.newAch || []).concat([id]);
    if (PT.Events) PT.Events.emit('league:achievement', { id: id });
    if (id !== 'piggy_bank' && L.teams[L.userTid].fin.coins >= 5000) Ach.award(L, 'piggy_bank');
    return true;
  };

  /** Achievements earned since the UI last asked (clears the list). */
  Ach.takeNew = function (L) { const ss = H().ss(L); const a = ss.newAch || []; ss.newAch = []; return a; };

  function userScore(box, u) { return box.h === u ? [box.hs, box.as] : [box.as, box.hs]; }
  function sumTeam(box, tid, k) { let s = 0; for (const pid of Object.keys(box.pl || {})) if (box.pl[pid].t === tid) s += box.pl[pid][k] || 0; return s; }
  function teamLine(box, tid) { return (box.tm || []).find((t) => t.tid === tid) || null; }

  /** Biggest deficit the user faced (from the scoring summary in time order). */
  function maxDeficit(box, u) {
    const sc = (box.sc || []).map((s, i) => [s, i]).sort((a, b) => (a[0].q - b[0].q) || (b[0].clk - a[0].clk) || (a[1] - b[1]));
    let us = 0, them = 0, worst = 0;
    for (const x of sc) { const s = x[0]; if (s.t === u) us += s.pts || 0; else them += s.pts || 0; worst = Math.max(worst, them - us); }
    return worst;
  }

  const GAME = {
    first_hop: (L, b, u, us, th) => us > th,
    six_points: (L, b, u) => (b.sc || []).some((s) => s.t === u && s.k === 'TD') || sumTeam(b, u, 'rtd') + sumTeam(b, u, 'rctd') + sumTeam(b, u, 'dtd') > 0,
    hail_yeah: (L, b, u) => {
      for (const s of b.sc || []) {
        if (s.t !== u || s.k !== 'TD') continue;
        const txt = String(s.txt || '').toLowerCase();
        const y = typeof s.yd === 'number' ? s.yd : (/(\d+)\s*-?\s*(yd|yard)/.exec(txt) || [])[1];
        if (y != null && +y >= 50 && (s.how === 'pass' || txt.indexOf('pass') >= 0)) return true;
      }
      return Object.keys(b.pl || {}).some((pid) => { const l = b.pl[pid]; return l.t === u && (l.rclg || 0) >= 50 && (l.rctd || 0) > 0 && (l.rc || 0) === 1; });
    },
    pick_six: (L, b, u) => Object.keys(b.pl || {}).some((pid) => { const l = b.pl[pid]; return l.t === u && (l.dtd || 0) > 0 && (l.int || 0) > 0; }),
    shutout: (L, b, u, us, th) => us > th && th === 0,
    comeback_kid: (L, b, u, us, th) => us > th && maxDeficit(b, u) >= 14,
    golden_carrot: (L, b, u, us, th) => b.po === C.PLAYOFF_ROUNDS && us > th,
    dynasty: (L) => PT.League.Coach.car(L).bowl.filter((s) => s > L.season - 5).length >= 3,
    underdog: (L, b, u, us, th) => {
      if (b.po !== C.PLAYOFF_ROUNDS || us <= th) return false;
      const ss = H().ss(L);
      const ovr = ss.ovr ? ss.ovr[u] : Q().teamOvr(L, u).ovr;
      return PT.League.News.teamStars ? teamStarsOf(ovr) <= 2 : ovr < 68;
    },
    big_boot: (L, b, u) => Object.keys(b.pl || {}).some((pid) => { const l = b.pl[pid]; return l.t === u && (l.fgm || 0) > 0 && (l.fglg || 0) >= 55; }),
    clean_sheet: (L, b, u) => { const t = teamLine(b, u); return !!t && !b.c && (t.to || 0) === 0 && (t.pen || 0) === 0 && sumTeam(b, u, 'fl') === 0 && sumTeam(b, u, 'pi') === 0; },
    sack_party: (L, b, u) => sumTeam(b, u, 'dsk') >= 5,
    ground_hog: (L, b, u) => { const t = teamLine(b, u); return (t ? t.ry : sumTeam(b, u, 'ry')) >= 200; },
    air_mail: (L, b, u) => { const t = teamLine(b, u); return (t ? t.py : sumTeam(b, u, 'py')) >= 400; },
    rivalry_sweep: (L) => H().ss(L).rivW >= 2,
    two_for_two: (L) => H().ss(L).tpt >= 5,
    snow_angel: (L, b, u, us, th) => {
      if (us - th < 21) return false;
      const g = L.sched.find((x) => x.gid === b.gid);
      const wx = b.wx ? (typeof b.wx === 'string' ? b.wx : b.wx.k) : PT.League.WeeklyEvents.weatherOf(L, g);
      return wx === 'snow';
    }
  };
  /** In-game feats only count in games the user actually played (not quick-sim), so badges trickle in (pacing). */
  Ach.PLAYED_ONLY = { hail_yeah: 1, pick_six: 1, comeback_kid: 1, big_boot: 1, clean_sheet: 1, sack_party: 1, ground_hog: 1, air_mail: 1 };

  function teamStarsOf(ovr) {
    const tbl = [[80, 5], [77, 4.5], [74, 4], [72, 3.5], [70, 3], [68, 2.5], [66, 2], [64, 1.5]];
    for (const r of tbl) if (ovr >= r[0]) return r[1];
    return 1;
  }

  /**
   * Check achievements for a hook. ctx: { box } for 'game'. @returns {string[]} newly earned ids
   */
  Ach.check = function (L, hook, ctx) {
    ctx = ctx || {};
    const u = L.userTid;
    const t = L.teams[u];
    const got = [];
    const tryA = (id, cond) => { if (L.ach[id] == null && cond && Ach.award(L, id)) got.push(id); };
    switch (hook) {
      case 'game': {
        const b = ctx.box;
        if (!b || (b.h !== u && b.a !== u)) break;
        const sc = userScore(b, u);
        for (const id of Object.keys(GAME)) {
          if (L.ach[id] != null || (b.sim && Ach.PLAYED_ONLY[id])) continue;
          tryA(id, GAME[id](L, b, u, sc[0], sc[1]));
        }
        tryA('perfect_season', perfect(L));
        tryA('zoo_keeper', zoo(L));
        break;
      }
      case 'season': {
        tryA('perfect_season', perfect(L));
        const inPo = !!(L.po && L.po.seeds && L.po.seeds.some((s) => s.indexOf(u) >= 0));
        tryA('bargain_bin', inPo && PT.League.Cap.rank(L, u) >= C.NUM_TEAMS - 4);
        const prev = t.rec.find((r) => r.s === L.season - 1);
        tryA('turnaround', inPo && !!prev && prev.w <= 5);
        tryA('dynasty', GAME.dynasty(L));
        break;
      }
      case 'growth':
        tryA('draft_genius', Q().roster(L, u).some((p) => p.dr && p.dr.t === u && p.ovr >= 85));
        break;
      case 'facility':
        tryA('full_house', C.FACILITIES.every((f) => t.fac[f] >= 5));
        break;
      case 'roster':
        tryA('zoo_keeper', zoo(L));
        break;
      case 'coins':
        tryA('piggy_bank', t.fin.coins >= 5000);
        break;
      case 'hype':
        tryA('on_fire', t.fin.hype >= 100);
        break;
      case 'boss':
        tryA('bosss_pet', L.boss.conf >= 100);
        break;
      case 'preseason':
        tryA('iron_coach', PT.League.Coach.car(L).seasons >= 10);
        tryA('zoo_keeper', zoo(L));
        break;
      default: break;
    }
    return got;
  };

  function perfect(L) {
    const u = L.userTid;
    const games = L.sched.filter((g) => !g.po && (g.h === u || g.a === u));
    if (games.length < C.GAMES_PER_TEAM || games.some((g) => g.st !== 'F')) return false;
    return games.every((g) => (g.h === u ? g.hs > g.as : g.as > g.hs));
  }
  function zoo(L) {
    const sp = {};
    for (const p of Q().roster(L, L.userTid)) sp[p.sp] = 1;
    return Object.keys(sp).length >= 15;
  }

  /**
   * Engine events the league can't see in a box (Session calls these on the user's plays):
   * kind 'jukes' n = tacklers broken/dodged on one play (≥ 3 → Juke Box); 'starPlays' n = successful Star Plays in this game
   * (≥ 5 → Superstar Stop). @returns {string[]} newly earned
   */
  Ach.engine = function (L, kind, n) {
    const got = [];
    if (kind === 'jukes' && n >= 3 && Ach.award(L, 'juke_box')) got.push('juke_box');
    if (kind === 'starPlays' && n >= 5 && Ach.award(L, 'superstar_stop')) got.push('superstar_stop');
    return got;
  };
})(globalThis.PT = globalThis.PT || {});
