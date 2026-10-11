/* Pixel Touchdown: js/league/weekly-events.js
 * Owner: WP2. Responsibility: PT.League.WeeklyEvents: pick/instantiate events, apply choice effects (design 11).
 * Frequency (11.1): regular weeks 55% one event (+15% a second); guaranteed after 2 quiet weeks; playoffs 30% (P-tagged
 * only); offseason exactly 2 O-tagged between Growth Day and Keep Players. No repeat within 8 weeks, max 2 per season,
 * def.cd = cooldown seasons (L.ev.seen). Weights C 3 · U 2 · R 1.
 * EventInst = { iid, def, pid, tid, wk, vars }. Next-game effects go to L.ss.nx (read via Spirit.gameMods / nextGameMods).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const WE = PT.ns('League.WeeklyEvents');
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;
  const H = () => PT.League.History;
  const PLAY_TYPES = ['SHORT', 'DEEP', 'IRUN', 'ORUN', 'SCREEN', 'PA', 'TRICK'];

  function defs() { return (PT.Data.WeeklyEvents && PT.Data.WeeklyEvents.list) || []; }
  function def(id) { return defs().find((d) => d.id === id) || null; }
  function weight(d) { const W = (PT.Data.WeeklyEvents && PT.Data.WeeklyEvents.WEIGHT) || { C: 3, U: 2, R: 1 }; return d.w != null ? d.w : (W[d.tag] || 1); }

  // ---------------- helpers for predicates ----------------

  function userGames(L) {
    const u = L.userTid;
    return L.sched.filter((g) => g.st === 'F' && (g.h === u || g.a === u)).sort((a, b) => (a.po - b.po) || (a.wk - b.wk));
  }
  function lastGame(L) { const g = userGames(L); return g.length ? g[g.length - 1] : null; }
  function results(L) {
    const u = L.userTid;
    return userGames(L).map((g) => { const us = g.h === u ? g.hs : g.as, th = g.h === u ? g.as : g.hs; return us > th ? 'W' : us < th ? 'L' : 'T'; });
  }
  function streak(L, ch, n) { const r = results(L); if (r.length < n) return false; for (let i = r.length - n; i < r.length; i++) if (r[i] !== ch) return false; return true; }
  function nextGame(L) { return Q().nextUserGame(L); }
  /** Weather key of a game (sched.wx, box.wx, or the WP1 game config). */
  WE.weatherOf = function (L, g) {
    if (!g) return null;
    if (g.wx) return typeof g.wx === 'string' ? g.wx : g.wx.k;
    const b = L.box[g.gid];
    if (b && b.wx) return typeof b.wx === 'string' ? b.wx : b.wx.k;
    try { const cfg = PT.League.Games.config(L, g.gid); return cfg && cfg.weather ? cfg.weather.k : null; } catch (e) { return null; }
  };
  function roster(L) { return Q().roster(L, L.userTid); }
  function starters(L) {
    const t = L.teams[L.userTid];
    const out = [];
    for (const s of C.SLOTS) if (s !== 'KR' && t.dc[s] && t.dc[s][0] != null && out.indexOf(t.dc[s][0]) < 0) out.push(t.dc[s][0]);
    return out.map((pid) => Q().player(L, pid)).filter(Boolean);
  }
  function isRookie(L, p) { return p.yr1 === L.season || (p.dr && p.dr.s === L.season); }

  /** Named predicates for def.when.need: return false, true, or a pid for {P}. */
  WE.NEEDS = {
    any: () => true,
    rainLast: (L) => WE.weatherOf(L, lastGame(L)) === 'rain',
    tdLast: (L, r) => {
      const g = lastGame(L); const b = g ? L.box[g.gid] : null;
      if (!b || !b.pl) return false;
      const ids = Object.keys(b.pl).filter((pid) => b.pl[pid].t === L.userTid && ((b.pl[pid].rtd || 0) + (b.pl[pid].rctd || 0) + (b.pl[pid].dtd || 0) + (b.pl[pid].krtd || 0)) > 0)
        .map(Number).filter((pid) => { const p = Q().player(L, pid); return p && p.tid === L.userTid; });
      return ids.length ? r.pick(ids) : false;
    },
    nextAway: (L) => { const g = nextGame(L); return !!g && g.a === L.userTid && g.po !== C.PLAYOFF_ROUNDS; },
    nextHome: (L) => { const g = nextGame(L); return !!g && g.h === L.userTid && g.po !== C.PLAYOFF_ROUNDS; },
    nextRival: (L) => { const g = nextGame(L); if (!g) return false; const opp = g.h === L.userTid ? g.a : g.h; return opp === L.teams[L.userTid].rival; },
    nextSnow: (L) => WE.weatherOf(L, nextGame(L)) === 'snow',
    rookies2: (L) => roster(L).filter((p) => isRookie(L, p)).length >= 2,
    underpaid: (L, r) => { const c = roster(L).filter((p) => p.ovr >= 75 && p.con && p.con.sal < 0.7 * PT.League.Cap.fairPay(L, p)); return c.length ? r.pick(c).id : false; },
    bigEater: (L, r) => { const c = roster(L).filter((p) => p.pos === 'OL' || p.pos === 'DL'); return c.length ? r.pick(c).id : false; },
    fastP: (L, r) => { const c = roster(L).filter((p) => p.r.spd >= 80); return c.length ? r.pick(c).id : false; },
    rosterRoom: (L) => roster(L).filter((p) => !p.ir).length < C.ROSTER.MAX_SEASON,
    contractYear: (L, r) => { const c = starters(L).filter((p) => p.con && p.con.exp === L.season); return c.length ? r.pick(c).id : false; },
    bouncy: (L, r) => { const c = roster(L).filter((p) => ['kangaroo', 'frog', 'rabbit'].indexOf(p.sp) >= 0); return c.length ? r.pick(c).id : false; },
    preDeadline: (L) => L.phase === 'REGULAR' && L.week <= K().TR_DEADLINE_WEEK,
    won3: (L) => streak(L, 'W', 3),
    won4: (L) => streak(L, 'W', 4),
    lost3: (L) => streak(L, 'L', 3),
    hype60: (L) => L.teams[L.userTid].fin.hype >= 60,
    wk1to17: (L) => L.phase === 'REGULAR' && L.week >= 1 && L.week <= 17,
    starPlayer: (L) => { const s = starters(L).sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id))[0]; return s ? s.id : false; }
  };

  function needsP(d) {
    const txt = d.text + ' ' + d.choices.map((c) => c.label + ' ' + (c.res || '') + JSON.stringify(c.fx)).join(' ');
    return txt.indexOf('{P}') >= 0 || JSON.stringify(d.choices).indexOf('"who":"p') >= 0 || d.choices.some((c) => (c.fx || []).some((f) => f.k === 'bench' || f.k === 'raise' || f.k === 'askAdj' || f.k === 'tradeVal'));
  }
  function pickP(L, d, r) {
    const pl = roster(L).filter((p) => !p.ir);
    if (!pl.length) return null;
    if (d.pick === 'best') return pl.slice().sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id))[0].id;
    if (d.pick === 'starter') { const s = starters(L); return s.length ? r.pick(s).id : r.pick(pl).id; }
    return r.pick(pl).id;
  }

  /** Is a def eligible now (phase, weeks, cooldowns, limits, predicate)? @returns {false|{pid:number|null}} */
  WE.eligible = function (L, d, mode, r) {
    if (d.sys) return false;
    if (mode === 'REG' && (d.off)) return false;
    if (mode === 'PO' && (!d.po || d.off)) return false;
    if (mode === 'OFF' && !d.off) return false;
    const w = d.when || {};
    if (w.minWk != null && L.week < w.minWk && mode !== 'OFF') return false;
    if (w.maxWk != null && L.week > w.maxWk && mode !== 'OFF') return false;
    if (d.cd && L.ev.seen[d.id] != null && L.season - L.ev.seen[d.id] < d.cd) return false;
    const ss = H().ss(L);
    if ((ss.ev.n[d.id] || 0) >= K().EV_MAX_PER_SEASON) return false;
    if (ss.ev.last[d.id] != null && L.week - ss.ev.last[d.id] < K().EV_GAP_WEEKS) return false;
    if (L.ev.pending.some((e) => e.def === d.id)) return false;
    let pid = null;
    if (w.need) {
      const fn = WE.NEEDS[w.need];
      if (!fn) return false;
      const res = fn(L, r);
      if (!res) return false;
      if (typeof res === 'number') pid = res;
    }
    if (pid == null && needsP(d)) pid = pickP(L, d, r);
    if (needsP(d) && pid == null) return false;
    return { pid: pid };
  };

  /** Create an event instance (also used for system cards like 'swap_offer' / 'trade_me'). @returns {EventInst} */
  WE.push = function (L, defId, pid, vars) {
    let max = L.ev.last || 0;
    for (const e of L.ev.pending) if (e.iid > max) max = e.iid;
    const iid = max + 1;
    L.ev.last = iid;
    const g = nextGame(L);
    const v = Object.assign({}, vars || {});
    if (g) v.next = g.h === L.userTid ? g.a : g.h;
    const inst = { iid: iid, def: defId, pid: pid == null ? null : pid, tid: L.userTid, wk: L.week, vars: v };
    L.ev.pending.push(inst);
    const ss = H().ss(L);
    ss.ev.n[defId] = (ss.ev.n[defId] || 0) + 1;
    ss.ev.last[defId] = L.week;
    if (PT.Events) PT.Events.emit('league:event', { iid: iid });
    return inst;
  };

  function roll(L, mode, n) {
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.phase, L.week, 'ev', n));
    const pool = [];
    for (const d of defs()) { const e = WE.eligible(L, d, mode, r); if (e) pool.push([[d, e], weight(d)]); }
    if (!pool.length) return null;
    const pick = r.weighted(pool);
    return WE.push(L, pick[0].id, pick[1].pid, {});
  }

  /**
   * After each week (hook): 0..2 events for the human team. Regular weeks 55% (+15% second), guaranteed after 2 quiet
   * weeks; playoff weeks 30% with P-tagged events only (team still alive). @returns {EventInst[]}
   */
  WE.generate = function (L) {
    if (!H().once(L, 'ev')) return [];
    const ss = H().ss(L);
    const out = [];
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.phase, L.week, 'evgen'));
    if (L.phase === 'PLAYOFFS') {
      const alive = L.sched.some((g) => g.po === L.po.rd && (g.h === L.userTid || g.a === L.userTid));
      if (alive && r.chance(K().EV_PO_CHANCE)) { const e = roll(L, 'PO', 0); if (e) out.push(e); }
      return out;
    }
    if (L.phase !== 'REGULAR') return out;
    const must = ss.ev.quiet >= K().EV_GUARANTEE_AFTER;
    if (must || r.chance(K().EV_CHANCE)) {
      const e = roll(L, 'REG', 0);
      if (e) { out.push(e); if (r.chance(K().EV_SECOND)) { const e2 = roll(L, 'REG', 1); if (e2) out.push(e2); } }
    }
    ss.ev.quiet = out.length ? 0 : ss.ev.quiet + 1;
    return out;
  };

  /** Offseason: exactly 2 O-tagged events between Growth Day and Keep Players (called at Goodbyes). */
  WE.generateOffseason = function (L) {
    const ss = H().ss(L);
    if (ss.evOff) return [];
    ss.evOff = 1;
    const out = [];
    for (let i = 0; i < K().EV_OFF_COUNT; i++) { const e = roll(L, 'OFF', 10 + i); if (e) out.push(e); }
    return out;
  };

  // ---------------- presentation ----------------

  function vars(L, e) {
    const p = e.pid != null ? Q().player(L, e.pid) : null;
    const t = L.teams[e.tid] || L.teams[L.userTid];
    const v = { P: p ? p.fn + ' ' + p.ln : 'Someone', Team: t.name, Rival: 'The ' + L.teams[t.rival].name };
    const nx = e.vars && e.vars.next != null ? e.vars.next : null;
    v.Next = nx != null ? 'the ' + L.teams[nx].name : 'your next opponent';
    if (e.def === 'swap_offer' && e.vars && e.vars.tid != null) {
      v.Them = 'The ' + L.teams[e.vars.tid].name;
      const get = (e.vars.get && e.vars.get.pids) || [];
      const picks = (e.vars.get && e.vars.get.picks) || [];
      const parts = get.map((pid) => { const q = Q().player(L, pid); return q ? q.fn + ' ' + q.ln + ' (' + q.pos + ')' : 'a player'; })
        .concat(picks.map((pk) => 'a round ' + pk.rd + ' pick'));
      v.Offer = parts.join(' + ') || 'a deal';
    }
    return v;
  }
  WE.vars = vars;

  /** HUNT4-league #3: event coin costs grow with the bank: cost = round10(base × max(1, Coins / 500)). */
  function coinsFx(L, n) {
    if (!(n < 0)) return n;
    const coins = L.teams[L.userTid].fin.coins;
    return -Math.round(-n * Math.max(1, coins / 500) / 10) * 10;
  }
  WE.coinsFx = coinsFx;
  function costOf(ch, L) {
    let c = 0;
    for (const f of ch.fx || []) if (f.k === 'coins' && f.n < 0 && f.p == null) c += -(L ? coinsFx(L, f.n) : f.n);
    return c;
  }
  /** Why a choice is greyed out ('' when OK). */
  function blocked(L, e, ch) {
    const t = L.teams[L.userTid];
    if (costOf(ch, L) > t.fin.coins) return 'Not enough Coins.';
    for (const f of ch.fx || []) {
      const p = e.pid != null ? Q().player(L, e.pid) : null;
      if (f.k === 'raise' && (!p || !p.con || PT.League.Cap.space(L, L.userTid) < Math.round(p.con.sal * f.pct / 100))) return 'Not enough Team Cash.';
      if (f.k === 'sign' && Q().roster(L, L.userTid).filter((x) => !x.ir).length >= C.ROSTER.MAX_SEASON) return 'Your roster is full.';
      if (f.k === 'swap' && !(PT.League.Trade.open(L))) return 'Swaps are closed.';
    }
    return '';
  }
  const WORD = { coins: 'Coins', hype: 'Hype', boss: 'Boss', spirit: 'Spirit', xp: 'Coach XP', scout: 'Scout points', merch: 'Merch' };
  function hint(ch, L) {
    const parts = [];
    for (const f of ch.fx || []) {
      const sg = (n) => (n > 0 ? '+' : '') + n;
      if (f.k === 'coins' && L) parts.push('Coins ' + sg(coinsFx(L, f.n)));
      else if (WORD[f.k] && typeof f.n === 'number') parts.push(WORD[f.k] + ' ' + sg(f.n));
      else if (f.k === 'mor') parts.push((f.who === 'p' ? 'Mood ' : f.who === 'team' ? 'Team Mood ' : 'Mood ') + sg(f.n));
      else if (f.k === 'rat') parts.push((C.RATING_NAMES[f.key] || 'Skill') + ' ' + sg(f.n));
      else if (f.k === 'nx') parts.push((f.key === 'all' ? 'Skills ' : (C.RATING_NAMES[f.key] || 'Skill') + ' ') + sg(f.n) + ' next game');
      else if (f.k === 'edge') parts.push('Edge next game');
      else if (f.k === 'inj') parts.push('Owie risk');
      else if (f.k === 'tix') parts.push('Tickets ×' + f.n);
    }
    return (ch.odds ? ch.odds + ' · ' : '') + parts.join(' · ');
  }

  /**
   * Pending events as UI cards. @returns {{iid, id, title, text, choices:{label, hint, cost, disabled, why, odds}[], art:{sp, pid, tid}}[]}
   */
  WE.pending = function (L) {
    const N = PT.League.News;
    return L.ev.pending.map((e) => {
      const d = def(e.def) || { title: 'Team News', text: 'Something happened.', choices: [{ label: 'OK', fx: [], res: 'OK.' }] };
      const v = vars(L, e);
      const p = e.pid != null ? Q().player(L, e.pid) : null;
      return {
        iid: e.iid, id: e.def, title: d.title, text: N.fill(d.text, v),
        choices: d.choices.map((c) => { const why = blocked(L, e, c); return { label: N.fill(c.label, v), hint: hint(c, L), cost: costOf(c, L), disabled: !!why, can: !why, why: why, odds: c.odds || '' }; }),
        art: { sp: p ? p.sp : L.teams[e.tid].sp, pid: p ? p.id : null, tid: e.tid }
      };
    });
  };

  /** The "free option" Auto picks: first affordable choice with no coin cost (else the cheapest affordable). */
  WE.autoChoice = function (L, iid) {
    const e = L.ev.pending.find((x) => x.iid === iid);
    const d = e ? def(e.def) : null;
    if (!d) return 0;
    if (e.def === 'swap_offer') return 1;
    let best = -1, bc = Infinity;
    d.choices.forEach((c, i) => { const cost = costOf(c, L); if (!blocked(L, e, c) && cost < bc) { bc = cost; best = i; } });
    return best < 0 ? d.choices.length - 1 : best;
  };

  // ---------------- effects ----------------

  function nx(L) {
    const ss = H().ss(L);
    if (!ss.nx) ss.nx = {};
    return ss.nx;
  }
  function addNxP(L, pid, key, n, games) {
    const o = nx(L);
    o.p = o.p || {};
    const e = o.p[pid] = o.p[pid] || {};
    e[key] = (e[key] || 0) + n;
    e.g = Math.max(e.g || 0, games || 1);
  }
  function setSkill(L, p, key, n) {
    p.r[key] = Math.max(C.SKILL_MIN, Math.min(C.SKILL_MAX, p.r[key] + n));
    if (PT.League.Ratings && PT.League.Ratings.ovr) p.ovr = PT.League.Ratings.ovr(p);
  }

  function apply(L, e, f, r, out) {
    const u = L.userTid;
    // QA1: the event's player may have been cut / swapped / retired while the card was open: player effects then do
    // nothing (they must never touch another team's player or contract)
    const p0 = e.pid != null ? Q().player(L, e.pid) : null;
    const p = p0 && p0.tid === u ? p0 : null;
    if (f.k !== 'roll' && f.p != null && !r.chance(f.p)) return '';
    const S = PT.League.Spirit;
    switch (f.k) {
      case 'coins': { const n = coinsFx(L, f.n); PT.League.Economy.addCoins(L, u, n, 'ev'); out.push({ k: 'coins', n: n }); break; }
      case 'hype': { const b = L.teams[u].fin.hype; PT.League.Economy.addHype(L, u, f.n); out.push({ k: 'hype', n: L.teams[u].fin.hype - b }); break; }
      case 'boss': PT.League.Boss.change(L, f.n, 'event'); out.push({ k: 'boss', n: f.n }); break;
      case 'spirit': S.addSpirit(L, u, f.n); out.push({ k: 'spirit', n: f.n }); break;
      case 'xp': PT.League.Coach.addXp(L, f.n, 'event'); out.push({ k: 'xp', n: f.n }); break;
      case 'scout': L.scout.pts += f.n; out.push({ k: 'scout', n: f.n }); break;
      case 'merch': H().ss(L).merch += f.n; out.push({ k: 'merch', n: f.n }); break;
      case 'tix': H().ss(L).tix = f.n; out.push({ k: 'tix', n: f.n }); break;
      case 'mor': {
        let list = [];
        if (f.who === 'p') list = p ? [p] : [];
        else if (f.who === 'rookies') list = roster(L).filter((x) => isRookie(L, x));
        else if (f.who === 'vets') list = roster(L).filter((x) => !isRookie(L, x));
        else list = roster(L);
        for (const x of list) S.addMood(L, x, f.n, 'event');
        out.push(f.who === 'p' && p ? { k: 'mor', n: f.n, pid: p.id } : { k: 'teamMor', n: f.n });
        break;
      }
      case 'rat': {
        let list = [];
        let key = f.key;
        if (f.who === 'p' && p) list = [p];
        else if (f.who === 'pmain' && p) { list = [p]; key = r.pick(Object.keys(C.OVR_W[p.pos])); }
        else if (f.who === 'rand') list = r.shuffle(roster(L).slice()).slice(0, f.cnt || 1);
        else if (f.who === 'young') { const y = roster(L).filter((x) => x.age <= 24); list = y.length ? [r.pick(y)] : roster(L).sort((a, b) => a.age - b.age).slice(0, 1); }
        else if (f.who === 'group') { const pos = r.pick(C.POS.filter((x) => x !== 'K')); list = roster(L).filter((x) => x.pos === pos); }
        for (const x of list) { setSkill(L, x, key, f.n); out.push({ k: 'rat', n: f.n, pid: x.id, key: key }); }
        break;
      }
      case 'nx': {
        const o = nx(L);
        if (f.who === 'team') {
          if (f.q1) o.q1 = (o.q1 || 0) + f.n; else o.all = (o.all || 0) + f.n;
          out.push({ k: 'nx', n: f.n, key: f.key, q1: !!f.q1 });
        } else {
          let list = [];
          if (f.who === 'p' && p) list = [p.id];
          else if (f.who === 'starter') list = starters(L).length ? [r.pick(starters(L)).id] : [];
          else if (f.who === 'starters') list = r.shuffle(starters(L).map((x) => x.id)).slice(0, f.cnt || 2);
          for (const pid of list) { addNxP(L, pid, f.key || 'all', f.n, f.games); out.push({ k: 'nx', n: f.n, key: f.key, pid: pid }); }
        }
        break;
      }
      case 'edge': nx(L).edge = (nx(L).edge || 0) + f.n; out.push({ k: 'edge', n: f.n }); break;
      case 'oppEdge': { const ty = r.shuffle(PLAY_TYPES.slice()).slice(0, f.types || 2); nx(L).oppEdge = { n: f.n, types: ty }; out.push({ k: 'oppEdge', n: f.n }); break; }
      case 'snowImm': nx(L).snowImm = true; out.push({ k: 'snowImm', n: 1 }); break;
      case 'loseHype': nx(L).loseHype = f.n; break;
      case 'injMult': H().ss(L).inj = { m: f.n, g: f.games || 1 }; out.push({ k: 'injMult', n: f.n }); break;
      case 'inj': {
        if (f.who === 'p' && !p) break;
        const pool = f.who === 'p' ? [p] : roster(L).filter((x) => !x.inj && !x.ir);
        if (pool.length) { const x = r.pick(pool); const res = PT.League.Injuries.apply(L, x.id, f.tier || 2); if (res && res.out) out.push({ k: 'inj', n: res.w, pid: x.id }); }
        break;
      }
      case 'bench': if (p) { const o = nx(L); o.bench = o.bench || []; if (o.bench.indexOf(p.id) < 0) o.bench.push(p.id); out.push({ k: 'bench', n: 1, pid: p.id }); } break;
      case 'raise': if (p) { const res = PT.League.Contracts.raise(L, p.id, f.pct); if (res.ok) out.push({ k: 'cash', n: res.add, pid: p.id }); } break;
      case 'askAdj': if (p) { p.ak = Math.round(((p.ak || 0) + f.n) * 100) / 100; out.push({ k: 'askAdj', n: f.n, pid: p.id }); } break;
      case 'tradeVal': if (p) { const ss = H().ss(L); if (ss.rumor.indexOf(p.id) < 0) ss.rumor.push(p.id); out.push({ k: 'tradeVal', n: f.n, pid: p.id }); } break;
      case 'gym': L.teams[u].gym = 1; out.push({ k: 'gym', n: 1 }); break;
      case 'pep': {
        const capt = L.teams[u].capt != null ? Q().player(L, L.teams[u].capt) : null;
        const n = capt && capt.r.smt >= 70 ? 4 : 2;
        S.addSpirit(L, u, n); out.push({ k: 'spirit', n: n });
        break;
      }
      case 'sign': {
        const res = signNephew(L);
        if (res) out.push({ k: 'sign', n: 1, pid: res });
        break;
      }
      case 'swap': {
        const res = PT.League.Trade.acceptOffer(L, e.vars || {});
        out.push({ k: 'swap', n: res.ok ? 1 : 0 });
        if (!res.ok) return res.msg;
        break;
      }
      case 'tmAck': if (p) { delete H().ss(L).tm[p.id]; out.push({ k: 'tmAck', n: 1, pid: p.id }); } break;
      case 'roll': {
        const a = r.chance(f.p == null ? 0.5 : f.p);
        // note: f.p on a roll is the A-chance, not a skip chance
        for (const g of (a ? f.a : f.b) || []) apply(L, e, g, r, out);
        return a ? f.ra : f.rb;
      }
      default: break;
    }
    return '';
  }

  /** "The Boss's nephew": a 1-star Hamster, min pay, 1 year. @returns {number|null} pid */
  function signNephew(L) {
    const u = L.userTid;
    if (Q().roster(L, u).filter((x) => !x.ir).length >= C.ROSTER.MAX_SEASON) return null;
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, 'nephew'));
    const pos = r.pick(['RB', 'WR', 'CB']);
    const ovr = r.int(42, 46);
    const p = PT.League.PlayerGen.create(L, { pos: pos, tid: C.TID.FA, age: r.int(21, 24), ovr: ovr });
    p.sp = 'hamster'; p.tid = C.TID.FA; p.pos = pos; p.con = null; p.inj = null; p.ir = false; delete p.pr;
    p.alt = p.alt || []; p.sg = p.sg || {};
    PT.League.Draft.fitOvr(p, ovr);
    p.pot = Math.max(p.ovr, p.pot || 0);
    L.players.push(p);
    if (PT.League.hydrate) PT.League.hydrate(L);
    PT.League.Contracts.attach(L, p.id, u, PT.League.Contracts.make(L, PT.League.Cap.minPay(L), 1, false));
    p.mor = 90;
    return p.id;
  }

  /**
   * Choose an option. idx = number, or 'auto' / −1 for the free option. Unaffordable choices fall back to the free one.
   * @returns {{ok, resultText, effects:{k, n, pid?}[], idx}}
   */
  WE.choose = function (L, iid, idx) {
    const e = L.ev.pending.find((x) => x.iid === iid);
    if (!e) return { ok: false, err: 'NO_EVENT', msg: 'That event is gone.' };
    const d = def(e.def);
    if (!d) { L.ev.pending = L.ev.pending.filter((x) => x.iid !== iid); return { ok: true, resultText: 'OK.', effects: [], idx: 0 }; }
    if (idx === 'auto' || idx == null || idx < 0 || idx >= d.choices.length || blocked(L, e, d.choices[idx])) idx = WE.autoChoice(L, iid);
    const ch = d.choices[idx];
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, iid, idx, 'choose'));
    const effects = [];
    let res = ch.res || '';
    for (const f of ch.fx || []) { const t = apply(L, e, f, r, effects); if (t) res = t; }
    if (!res) res = 'Done.';
    L.ev.pending = L.ev.pending.filter((x) => x.iid !== iid);
    if (d.cd) L.ev.seen[d.id] = L.season;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'event' });
    return { ok: true, resultText: PT.League.News.fill(res, vars(L, e)), effects: effects, idx: idx };
  };

  /** Next-game effects for a team (user team only; others empty). See Spirit.gameMods for the merged view. */
  WE.nextGameMods = function (L, tid) {
    if (tid !== L.userTid) return {};
    return JSON.parse(JSON.stringify(H().ss(L).nx || {}));
  };

  /** After the user's game: one-game effects end, multi-game ones count down; Trash Talk loss → Hype. */
  WE.afterUserGame = function (L, won) {
    const ss = H().ss(L);
    const o = ss.nx || {};
    if (o.loseHype && won === false) PT.League.Economy.addHype(L, L.userTid, o.loseHype);
    const keep = {};
    for (const pid of Object.keys(o.p || {})) { const e = o.p[pid]; if ((e.g || 1) > 1) { e.g--; keep[pid] = e; } }
    ss.nx = Object.keys(keep).length ? { p: keep } : {};
    if (ss.inj && ss.inj.g > 0) { ss.inj.g--; if (!ss.inj.g) ss.inj.m = 1; }
  };
})(globalThis.PT = globalThis.PT || {});
