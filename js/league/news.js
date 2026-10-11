/* Pixel Touchdown: js/league/news.js
 * Owner: WP2. Responsibility: PT.League.News: push/format news items (capped feed), living league ticker (design 14.12, App. B).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const News = PT.ns('League.News');
  const MAX = 60;
  /** priority for the weekly ticker (design App. B: records > upsets > injuries > swaps/signings > streaks > milestones > filler) */
  const PRIO = { rec: 7, upset: 6, inj: 5, trade: 4, sign: 4, streak: 3, ms: 2, game: 2, award: 6, twist: 6, hof: 6, retire: 4, draft: 5, event: 1, fill: 0 };

  /** Fill {var} placeholders. Unknown vars stay as-is. @param {string} s @param {Object} vars */
  News.fill = function (s, vars) {
    vars = vars || {};
    return String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  };

  /** Template by key from PT.Data.Text.news. */
  News.tpl = function (key, vars) {
    const T = (PT.Data.Text && PT.Data.Text.news) || {};
    return News.fill(T[key] || key, vars);
  };

  /** Display name for news: "Biscuit McFluff the Dog" */
  News.pname = function (p) {
    if (!p) return 'Someone';
    const sp = PT.Data.Species && PT.Data.Species.byId ? PT.Data.Species.byId(p.sp) : null;
    const spn = sp && sp.name ? sp.name : (p.sp ? p.sp[0].toUpperCase() + p.sp.slice(1) : '');
    return p.fn + ' ' + p.ln + (spn ? ' the ' + spn : '');
  };
  News.tname = function (L, tid) { const t = L.teams[tid]; return t ? 'the ' + t.name : 'a team'; };
  News.tName = function (L, tid) { const t = L.teams[tid]; return t ? 'The ' + t.name : 'A team'; };

  /**
   * Add a news item (newest first, capped at 60). Emits league:news.
   * @param {League} L @param {string} k kind @param {string} txt @param {number} [tid] @returns {Object} item
   */
  News.add = function (L, k, txt, tid) {
    const item = { s: L.season, wk: L.week, k: k, txt: String(txt).replace(/\.\s*$/, '') };   // no trailing periods (HUNT-league #3)
    if (tid != null && tid >= 0) item.tid = tid;
    L.news.unshift(item);
    if (L.news.length > MAX) L.news.length = MAX;
    if (PT.Events) PT.Events.emit('league:news', { item: item });
    return item;
  };

  /** @returns {Object[]} newest n items (default 10), optional filter by tid */
  News.list = function (L, n, tid) {
    const src = tid == null ? L.news : L.news.filter((x) => x.tid === tid);
    return src.slice(0, n || 10);
  };

  /** Ticker: the top headlines for the current week by priority (design 14.12). */
  News.ticker = function (L, n) {
    const wk = L.week;
    const cur = L.news.filter((x) => x.s === L.season && (x.wk === wk || x.wk === wk - 1));
    const src = cur.length >= 3 ? cur : L.news.slice(0, 8);
    return src.map((x, i) => [x, (PRIO[x.k] || 1) * 100 - i]).sort((a, b) => b[1] - a[1]).slice(0, n || 6).map((x) => x[0]);
  };

  function teamStars(L, tid) {
    const ovr = PT.League.Q.teamOvr(L, tid).ovr;
    const tbl = [[80, 5], [77, 4.5], [74, 4], [72, 3.5], [70, 3], [68, 2.5], [66, 2], [64, 1.5]];
    for (const r of tbl) if (ovr >= r[0]) return r[1];
    return 1;
  }
  News.teamStars = teamStars;

  /**
   * Weekly living-league headlines (3–6 per week): results, upsets, streaks, big games, filler.
   * Called once per regular-season week (from Economy.weekly). Deterministic (seeded by week).
   */
  News.weekly = function (L) {
    const wk = L.week;
    const games = L.sched.filter((g) => g.wk === wk && g.st === 'F');
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, wk, 'news'));
    const cands = [];
    let stars = null;
    for (const g of games) {
      if (g.hs === g.as) continue;
      const w = g.hs > g.as ? g.h : g.a, l = w === g.h ? g.a : g.h;
      const ws = Math.max(g.hs, g.as), ls = Math.min(g.hs, g.as);
      if (!stars) { stars = {}; for (const t of L.teams) stars[t.id] = teamStars(L, t.id); }
      if (stars[l] - stars[w] >= 2) {
        cands.push([PRIO.upset, 'upset', News.tpl('upset', { S: Math.round(stars[w]), T: L.teams[w].name, T2: L.teams[l].name }), w]);
      } else {
        cands.push([PRIO.game - 1 + (ws - ls) / 100, 'game', News.tpl('win', { T: L.teams[w].name, T2: L.teams[l].name, N: ws, N2: ls }), w]);
      }
      const box = L.box[g.gid];
      if (box && box.pl) {
        for (const pid of Object.keys(box.pl)) {
          const ln = box.pl[pid];
          const p = PT.League.Q.player(L, +pid);
          if (!p) continue;
          if ((ln.ptd || 0) >= 4 && ln.t === w) cands.push([PRIO.game + 0.5, 'game', News.tpl('passTd', { P: News.pname(p), N: ln.ptd }), ln.t]);
          if ((ln.ry || 0) >= 150) cands.push([PRIO.game + 0.4, 'game', News.tpl('rush', { P: News.pname(p), N: ln.ry }), ln.t]);
          if ((ln.rcy || 0) >= 150) cands.push([PRIO.game + 0.3, 'game', News.tpl('catchYds', { P: News.pname(p), N: ln.rcy }), ln.t]);
        }
      }
    }
    // streaks
    const std = PT.League.Standings.get(L);
    for (const row of std) {
      const m = /^([WL])(\d+)$/.exec(row.strk || '');
      if (!m) continue;
      const n = +m[2];
      if (m[1] === 'W' && n >= 4 && n % 2 === 0) cands.push([PRIO.streak, 'streak', News.tpl('winStreak', { T: L.teams[row.tid].name, N: n }), row.tid]);
      if (m[1] === 'L' && n >= 5 && n % 2 === 1) cands.push([PRIO.streak - 0.5, 'streak', News.tpl('loseStreak', { T: L.teams[row.tid].name, N: n }), row.tid]);
    }
    const already = L.news.filter((x) => x.s === L.season && x.wk === wk).length;
    const want = Math.max(0, r.int(3, 6) - already);
    cands.sort((a, b) => b[0] - a[0]);
    const used = {};
    let added = 0;
    for (const c of cands) {
      if (added >= want) break;
      const key = c[1] + ':' + c[3];
      if (used[key]) continue;
      used[key] = 1;
      News.add(L, c[1], c[2], c[3]); added++;
    }
    if (added < want && (L.news.filter((x) => x.s === L.season && x.wk === wk).length < 3)) {
      const T = (PT.Data.Text && PT.Data.Text.filler) || [];
      if (T.length) {
        const t = L.teams[r.int(0, L.teams.length - 1)];
        News.add(L, 'fill', News.fill(r.pick(T), { T: 'the ' + t.name, stadium: t.stad }), t.id);
      }
    }
    return added;
  };

  /** Clinch / playoff lines when the regular season ends (called by Awards on season end or WP1). */
  News.playoffTeams = function (L) {
    const seeds = (L.po && L.po.seeds) || [];
    const DIVS = (PT.Data.Teams && PT.Data.Teams.DIVS) || [['Highway', 'River', 'Farm', 'Desert'], ['Snowy', 'Forest', 'Railway', 'City']];
    seeds.forEach((arr) => arr.forEach((tid, i) => {
      const t = L.teams[tid];
      if (i < C.DIVS_PER_CONF) News.add(L, 'game', News.tpl('clinchDiv', { T: 'The ' + t.name, division: DIVS[t.conf][t.div] }), tid);
      else if (tid === L.userTid) News.add(L, 'game', News.tpl('playoffs', { T: 'The ' + t.name }), tid);
    }));
  };
})(globalThis.PT = globalThis.PT || {});
