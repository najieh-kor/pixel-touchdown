/* Pixel Touchdown: js/league/coach.js
 * Owner: WP2. Responsibility: PT.League.Coach: Coach XP, levels, play unlocks, 18 Coach Skills (2 ranks), legacy (design 14.8, 14.9).
 * L.coach = { n, sp, xp, lvl, sk:{skillId:rank}, pts (skill picks waiting), offer:[3 skill ids]|undefined, car:{career} }.
 * Pacing (tuned via PT.League.K, not the design's 50 × level): total XP for level n ≤ 10 = 250 × (n − 1)^1.6
 * (Lv 2 250, Lv 3 750, Lv 4 1,450, Lv 10 8,400), then +1,000 per level (Lv 30 = 28,400). ≈ Lv 3 after season 1, Lv 10 after 7–10.
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Coach = PT.ns('League.Coach');
  const MAX_LVL = 30;

  /** XP sources (design 14.8) */
  Coach.XP = { win: 40, tie: 20, loss: 15, td: 5, poWin: 100, bowl: 300, div: 60, goal: 100, award: 30, ach: 25, tv: 10 };

  /** 18 Coach Skills (design 14.8). r1/r2 = kid text per rank. */
  Coach.SKILLS = [
    { id: 'qb_whisperer', name: 'QB Whisperer', r1: 'Your QB +2 Aim in games', r2: 'Your QB +4 Aim in games' },
    { id: 'money_talks', name: 'Money Talks', r1: '+5 Market score on your offers', r2: '+10 Market score on your offers' },
    { id: 'penny_pincher', name: 'Penny Pincher', r1: 'Building upgrades cost 10% less', r2: 'Building upgrades cost 20% less' },
    { id: 'doc_hands', name: 'Doc Hands', r1: 'Long injuries heal 1 week faster', r2: 'Long injuries heal 2 weeks faster' },
    { id: 'talent_eye', name: 'Talent Eye', r1: '+3 scout points per season', r2: '+6 scout points per season' },
    { id: 'hype_machine', name: 'Hype Machine', r1: 'Ticket money +10%', r2: 'Ticket money +20%' },
    { id: 'clock_master', name: 'Clock Master', r1: '+1 timeout each half', r2: '+1 timeout and a faster Hurry' },
    { id: 'two_minute', name: 'Two-Minute Drill', r1: 'Faster Hurry plays', r2: 'Faster Hurry and an edge late in halves' },
    { id: 'play_designer', name: 'Play Designer', r1: '4 suggested play cards', r2: '4 cards and a bigger style bonus' },
    { id: 'iron_discipline', name: 'Iron Discipline', r1: 'Fewer flags (×0.7)', r2: 'Even fewer flags (×0.5)' },
    { id: 'locker_glue', name: 'Locker Room Glue', r1: 'Mood drops are 15% smaller', r2: 'Mood drops are 30% smaller' },
    { id: 'rookie_whisperer', name: 'Rookie Whisperer', r1: 'First-year players grow +1', r2: 'First-year players grow +2' },
    { id: 'red_zone', name: 'Red Zone Wizard', r1: 'Offense edge near the goal', r2: 'Big offense edge near the goal' },
    { id: 'goal_line', name: 'Goal Line Stand', r1: 'Defense edge near your goal', r2: 'Big defense edge near your goal' },
    { id: 'kick_guru', name: 'Kick Guru', r1: 'Kicks are 10% steadier', r2: 'Kicks are 20% steadier' },
    { id: 'trade_shark', name: 'Trade Shark', r1: 'Swaps are a bit easier', r2: 'Swaps are easier' },
    { id: 'star_power', name: 'Star Power', r1: 'Star Play window +0.05 s', r2: 'Star Play window +0.10 s' },
    { id: 'film_room', name: 'Film Room', r1: 'See their top 3 play types', r2: 'See them and the AI reads you less' }
  ];

  /**
   * Play unlocks (design 6.6): Coach Level → play. Keys are the design codes; plays are matched by `lv` on the
   * PT.Data.Playbook entry first, then by design code (P05…) or snake_case name in PLAY_LV.
   */
  Coach.PLAY_LV = {
    P05: 2, corner_smash: 2, P08: 3, waterfall: 3, P09: 4, tunnel_dig: 4, P10: 5, tall_tower: 5, P16: 6, big_bluff: 6,
    P23: 7, pick_one: 7, P22: 8, jet_zoom: 8, P24: 9, spin_cycle: 9, P25: 10, boomerang: 10
  };
  Coach.UNLOCKS = { 2: 'Corner Smash', 3: 'Waterfall', 4: 'Tunnel Dig', 5: 'Tall Tower', 6: 'Big Bluff', 7: 'Pick One', 8: 'Jet Zoom', 9: 'Spin Cycle', 10: 'Boomerang' };

  /** Coach career counters (persisted in L.coach.car). */
  Coach.car = function (L) {
    const c = L.coach;
    if (!c.car) c.car = { w: 0, l: 0, t: 0, pw: 0, div: 0, conf: 0, bowl: [], hof: 0, seasons: 1, fired: 0, hired: 0, teams: [L.userTid], riv: {}, gm: 0 };
    return c.car;
  };

  /** Total XP needed to reach level n. */
  Coach.xpFor = function (n) {
    const K = PT.League.K;
    const early = (m) => Math.round(K.COACH_XP_A * Math.pow(Math.max(0, m - 1), K.COACH_XP_P) / 50) * 50;
    return n <= 10 ? early(n) : early(10) + K.COACH_XP_LATE * (n - 10);
  };

  /**
   * Add Coach XP and level up. Level rewards: Lv 2–10 unlock a play, every level from 3 a skill pick (2 at Lv 10/20/30), Lv 20/25/30 +100 Coins.
   * @returns {{lvl:number, levels:number[], plays:string[], picks:number, coins:number}}
   */
  Coach.addXp = function (L, n, why) {
    const c = L.coach;
    n = Math.max(0, Math.round(n * (PT.League.Staff.quirks(L, L.userTid).xp ? 1.1 : 1)));
    c.xp += n;
    const levels = [], plays = [];
    let picks = 0, coins = 0;
    while (c.lvl < MAX_LVL && c.xp >= Coach.xpFor(c.lvl + 1)) {
      c.lvl++;
      levels.push(c.lvl);
      if (c.lvl <= 10 && Coach.UNLOCKS[c.lvl]) plays.push(Coach.UNLOCKS[c.lvl]);
      if (c.lvl >= 3) { const n = c.lvl % 10 === 0 ? 2 : 1; c.pts += n; picks += n; }
      if (c.lvl === 20 || c.lvl === 25 || c.lvl === 30) { PT.League.Economy.addCoins(L, L.userTid, 100, 'ach'); coins += 100; }
    }
    if (levels.length) {
      if (PT.Events) { PT.Events.emit('league:levelUp', { lvl: c.lvl, levels: levels, plays: plays }); PT.Events.emit('league:changed', { what: 'coach' }); }
      PT.League.News.add(L, 'award', 'Coach reaches Level ' + c.lvl + '.' + (plays.length ? ' New play: ' + plays.join(', ') + '.' : ''), L.userTid);
    }
    const ss = PT.League.History.ss(L);
    ss.led.xp = (ss.led.xp || 0) + n;
    return { lvl: c.lvl, levels: levels, plays: plays, picks: picks, coins: coins, why: why || '' };
  };

  /** @returns {{lvl, xp, cur, need, next, pts, offer, sk, outfit, legacy}} */
  Coach.status = function (L) {
    const c = L.coach;
    const base = Coach.xpFor(c.lvl), next = c.lvl >= MAX_LVL ? base : Coach.xpFor(c.lvl + 1);
    return { lvl: c.lvl, xp: c.xp, cur: c.xp - base, need: next - base, next: next, pts: c.pts, offer: c.offer || null,
      sk: Object.assign({}, c.sk), outfit: c.lvl >= 30 ? 3 : c.lvl >= 25 ? 2 : c.lvl >= 20 ? 1 : 0, legacy: Coach.legacy(L) };
  };

  /**
   * The 1-of-3 skill choice for a waiting pick (deterministic; offered skills can be rank 2 of one you own).
   * @returns {{id,name,rank,txt}[]}
   */
  Coach.offer = function (L) {
    const c = L.coach;
    if (c.pts <= 0) return [];
    if (!c.offer || !c.offer.length) {
      const pool = Coach.SKILLS.filter((s) => (c.sk[s.id] || 0) < 2).map((s) => s.id);
      const r = PT.RNG.create(PT.RNG.hash(L.seed, 'skill', c.lvl, c.pts, Object.keys(c.sk).length));
      r.shuffle(pool);
      c.offer = pool.slice(0, 3);
    }
    return c.offer.map((id) => {
      const s = Coach.SKILLS.find((x) => x.id === id), rank = (c.sk[id] || 0) + 1;
      return { id: id, name: s.name, rank: rank, txt: rank === 1 ? s.r1 : s.r2 };
    });
  };

  /** Alias used by the UI (WP5). */
  Coach.offers = function (L) { return Coach.offer(L); };

  /** Pick one of the offered skills. @returns {Result} */
  Coach.pickSkill = function (L, id) {
    const c = L.coach;
    if (c.pts <= 0) return { ok: false, err: 'NO_PICK', msg: 'No skill to pick yet.' };
    const offer = Coach.offer(L);
    if (!offer.some((o) => o.id === id)) return { ok: false, err: 'NOT_OFFERED', msg: 'Pick one of the three.' };
    c.sk[id] = (c.sk[id] || 0) + 1;
    c.pts--;
    delete c.offer;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'coach' });
    return { ok: true, id: id, rank: c.sk[id] };
  };

  /**
   * All Coach Skill effects as numbers (for engine via Session/UI, and for other league systems).
   * Neutral values when a skill is not owned.
   */
  Coach.mods = function (L) {
    const sk = (L.coach && L.coach.sk) || {};
    const r = (id) => sk[id] || 0;
    const pick = (id, a, b, c0) => (r(id) === 2 ? b : r(id) === 1 ? a : c0);
    return {
      qbAim: pick('qb_whisperer', 2, 4, 0),
      marketScore: pick('money_talks', 5, 10, 0),
      facDiscount: pick('penny_pincher', 0.10, 0.20, 0),
      healWeeks: pick('doc_hands', 1, 2, 0),
      scoutPts: pick('talent_eye', 3, 6, 0),
      ticketMult: pick('hype_machine', 1.10, 1.20, 1),
      timeouts: r('clock_master') ? 1 : 0,
      hurryRunoff: r('clock_master') === 2 ? 12 : r('two_minute') ? 10 : 0,
      lateEdge: r('two_minute') === 2 ? 0.5 : 0,
      cards: r('play_designer') ? 4 : 3,
      sigBonus: r('play_designer') === 2 ? 0.5 : 0.25,
      penMult: pick('iron_discipline', 0.7, 0.5, 1),
      moodLoss: pick('locker_glue', 0.85, 0.7, 1),
      rookieProg: pick('rookie_whisperer', 1, 2, 0),
      redZoneEdge: pick('red_zone', 0.5, 1.0, 0),
      goalLineEdge: pick('goal_line', 0.5, 1.0, 0),
      kickSigma: pick('kick_guru', 0.9, 0.8, 1),
      tradeThr: pick('trade_shark', -0.05, -0.10, 0),
      starWindow: pick('star_power', 0.05, 0.10, 0),
      filmRoom: r('film_room') > 0,
      pCounterAdj: r('film_room') === 2 ? -0.10 : 0
    };
  };

  /** Level a play unlocks at (1 = starter). */
  Coach.playLevel = function (play) {
    if (!play) return 1;
    if (typeof play.lv === 'number') return play.lv;
    if (typeof play.lvl === 'number') return play.lvl;
    const id = String(play.id || '');
    const code = /^P\d\d/i.test(id) ? id.slice(0, 3).toUpperCase() : null;
    if (code && Coach.PLAY_LV[code]) return Coach.PLAY_LV[code];
    if (Coach.PLAY_LV[id]) return Coach.PLAY_LV[id];
    const nm = String(play.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return Coach.PLAY_LV[nm] || 1;
  };

  /** Play ids the user may call (AI teams always have every play). @returns {string[]} */
  Coach.unlockedPlays = function (L) {
    const list = (PT.Data.Playbook && PT.Data.Playbook.list) || [];
    const lvl = L.coach.lvl;
    return list.filter((p) => Coach.playLevel(p) <= lvl).map((p) => p.id);
  };

  /** Locked plays with the level that unlocks them. @returns {{id:string, name:string, lv:number}[]} */
  Coach.lockedPlays = function (L) {
    const list = (PT.Data.Playbook && PT.Data.Playbook.list) || [];
    return list.filter((p) => Coach.playLevel(p) > L.coach.lvl).map((p) => ({ id: p.id, name: p.name, lv: Coach.playLevel(p) }));
  };

  /**
   * Legacy score + title (design 14.9).
   * 10×wins + 5×ties + 50×playoff wins + 25×division titles + 100×conference titles + 250×Bowls + 30×HoF coached + 10×achievements
   */
  Coach.legacy = function (L) {
    const car = Coach.car(L);
    const ach = Object.keys(L.ach || {}).length;
    const score = 10 * car.w + 5 * car.t + 50 * car.pw + 25 * car.div + 100 * car.conf + 250 * car.bowl.length + 30 * car.hof + 10 * ach;
    const T = (PT.Data.Text && PT.Data.Text.legacy) || [[0, 'Newbie Coach']];
    let title = T[0][1], next = null;
    for (let i = 0; i < T.length; i++) { if (score >= T[i][0]) { title = T[i][1]; next = T[i + 1] ? T[i + 1][0] : null; } }
    return { score: score, title: title, next: next };
  };

  /**
   * Post-game XP + career counters for the user's team (design 14.8): win 40 · tie 20 · loss 15 · +5 per TD ·
   * playoff win 100 · Bowl win 300. @returns {number} XP earned
   */
  Coach.onGame = function (L, box) {
    const u = L.userTid;
    if (box.h !== u && box.a !== u) return 0;
    const car = Coach.car(L);
    const us = box.h === u ? box.hs : box.as, them = box.h === u ? box.as : box.hs;
    let xp = us > them ? Coach.XP.win : us < them ? Coach.XP.loss : Coach.XP.tie;
    let tds = 0;
    for (const s of box.sc || []) if (s.t === u && s.k === 'TD') tds++;
    xp += Coach.XP.td * tds;
    if (us > them) car.w++; else if (us < them) car.l++; else car.t++;
    car.gm++;
    if (box.po && us > them) {
      car.pw++;
      xp += Coach.XP.poWin;
      if (box.po === C.PLAYOFF_ROUNDS) { xp += Coach.XP.bowl; if (car.bowl.indexOf(L.season) < 0) car.bowl.push(L.season); }
    }
    if (box.po === C.PLAYOFF_ROUNDS - 1 && us > them) car.conf++;
    Coach.addXp(L, xp, 'game');
    return xp;
  };
})(globalThis.PT = globalThis.PT || {});
