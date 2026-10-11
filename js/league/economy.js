/* Pixel Touchdown: js/league/economy.js
 * Owner: WP2. Responsibility: PT.League.Economy: Coins income/spending/upkeep, facility upgrades, Fan Party, Hype (design 10.10, 10.11).
 * Coins are integers in team.fin.coins; revS/expS are this season's totals; fin.last = last season's profit.
 * The user team also gets a category ledger in L.ss.led (tv, tix, merch, win, po, ev, ach, fac, staff, upk, gift, party).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Eco = PT.ns('League.Economy');
  const K = () => PT.League.K;
  const H = () => PT.League.History;

  function twfx(L) { return PT.League.Twists ? PT.League.Twists.fx(L) : {}; }
  function ledger(L, tid, cat, n) {
    if (tid !== L.userTid || !cat) return;
    const led = H().ss(L).led;
    led[cat] = (led[cat] || 0) + n;
  }

  /**
   * Change a team's Coins (income > 0, spending < 0). Spending from choices should be checked by the caller;
   * this never lets Coins go below 0 unless allowNeg (Preseason bills).
   * @returns {number} new coins
   */
  Eco.addCoins = function (L, tid, n, cat, allowNeg) {
    const t = L.teams[tid];
    n = Math.round(n);
    if (!n) return t.fin.coins;
    t.fin.coins += n;
    if (!allowNeg && t.fin.coins < 0) t.fin.coins = 0;
    if (n > 0) t.fin.revS += n; else t.fin.expS += -n;
    ledger(L, tid, cat, n);
    if (tid === L.userTid && n > 0 && PT.League.Achievements) PT.League.Achievements.check(L, 'coins');
    return t.fin.coins;
  };

  /** Hype floor = 10 + 3 × (Stadium − 1) (design 10.10). */
  Eco.hypeFloor = function (L, tid) { return 10 + 3 * (L.teams[tid].fac.std - 1); };

  /**
   * Change Hype (0..100, floor by Stadium). Fan Frenzy: every Hype gain +1. Staff quirk 'hype': +1 per gain ≥ 3.
   * @returns {number} new hype
   */
  Eco.addHype = function (L, tid, n) {
    const t = L.teams[tid];
    if (!n) return t.fin.hype;
    if (n > 0) n += (twfx(L).hypeBonus || 0);
    let v = Math.min(100, Math.max(0, t.fin.hype + n));
    if (n < 0) v = Math.max(v, Math.min(Eco.hypeFloor(L, tid), t.fin.hype));   // losses never push below the floor
    t.fin.hype = Math.round(v);
    if (tid === L.userTid && t.fin.hype >= 100 && PT.League.Achievements) PT.League.Achievements.check(L, 'hype');
    return t.fin.hype;
  };

  /** Merch per week (design 10.11). */
  Eco.merch = function (L, tid) {
    const t = L.teams[tid];
    let stars = 0;
    for (const pid of t.roster) { const p = PT.League.Q.player(L, pid); if (p && p.ovr >= 85) stars++; }
    let m = 5 + 0.2 * t.fin.hype + 5 * (t.fac.shop - 1) + 3 * Math.min(5, stars);
    if (PT.League.Staff.quirks(L, tid).merch) m *= 1.10;
    return Math.round(m);
  };

  /** Ticket income for one home game (design 10.11). */
  Eco.tickets = function (L, tid, po) {
    const t = L.teams[tid];
    let v = (40 + 2 * t.fin.hype) * (1 + 0.15 * (t.fac.std - 1));
    if (po) v *= 2;
    v *= (twfx(L).ticketMult || 1);
    if (tid === L.userTid) {
      v *= PT.League.Coach.mods(L).ticketMult;
      v *= H().ss(L).tix || 1;
    }
    return Math.round(v);
  };

  /** Home-field skill bonus for the engine/StatSim (design 8.17 + Stadium L5 +1). 0 at neutral sites. */
  Eco.homeField = function (L, tid, neutral) {
    if (neutral) return 0;
    const t = L.teams[tid];
    return (t.fin.hype >= 80 ? 2 : 1) + (t.fac.std >= 5 ? 1 : 0);
  };

  /** Regular-season week (incl. Rest Week): merch for every team + living-league headlines. Once per week. */
  Eco.weekly = function (L) {
    if (!H().once(L, 'eco')) return;
    const ss = H().ss(L);
    for (const t of L.teams) {
      // fans calm down: Hype drifts 1 point per K.ECO_HYPE_CALM (10) away from 50 each week (pacing; good teams still climb)
      const off = t.fin.hype - 50, step = Math.floor(Math.abs(off) / K().ECO_HYPE_CALM);
      if (step && L.phase === 'REGULAR') t.fin.hype = Math.max(Eco.hypeFloor(L, t.id), Math.round(t.fin.hype - Math.sign(off) * step));
      let m = Eco.merch(L, t.id);
      if (t.id === L.userTid && ss.merch) { m += ss.merch; ss.merch = 0; }
      Eco.addCoins(L, t.id, m, 'merch');
    }
    if (L.phase === 'REGULAR') PT.League.News.weekly(L);
  };

  /**
   * Post-game money + Hype for both teams (design 10.10 / 10.11). Called from the per-game hook.
   * Tickets (home), win bonus, playoff checks, Bowl bonus, Hype for win/loss/rival/long TDs/scorers.
   * @returns {{coins:Object<number,number>, hype:Object<number,number>}}
   */
  Eco.onGame = function (L, box) {
    const fx = twfx(L);
    const out = { coins: {}, hype: {} };
    const add = (tid, n, cat) => { Eco.addCoins(L, tid, n, cat); out.coins[tid] = (out.coins[tid] || 0) + n; };
    const hy = (tid, n) => { const b = L.teams[tid].fin.hype; Eco.addHype(L, tid, n); out.hype[tid] = (out.hype[tid] || 0) + (L.teams[tid].fin.hype - b); };
    const po = box.po || 0;
    const neutral = po === C.PLAYOFF_ROUNDS;
    if (!neutral) add(box.h, Eco.tickets(L, box.h, po > 0), 'tix');
    if (box.h === L.userTid && !neutral) H().ss(L).tix = 1;
    const rival = H().isRivalGame(L, box.h, box.a);
    const rMult = rival ? (fx.rivalMult || 1) : 1;
    const pm = fx.playoffMoney || 1;
    [box.h, box.a].forEach((tid) => {
      const t = L.teams[tid];
      const us = tid === box.h ? box.hs : box.as, them = tid === box.h ? box.as : box.hs;
      const win = us > them, loss = us < them;
      if (win) add(tid, po ? K().ECO_PO_WIN_BONUS : K().ECO_WIN_BONUS, 'win');
      if (po) add(tid, K().ECO_PO_CHECK * pm, 'po');
      if (po === C.PLAYOFF_ROUNDS && win) add(tid, K().ECO_BOWL_BONUS * pm, 'po');
      // Hype
      let h = 0;
      if (win) {
        if (rival && !po) h = K().ECO_HYPE_RIVAL_WIN;
        else h = (tid === box.h && !neutral ? K().ECO_HYPE_HOME_WIN : K().ECO_HYPE_WIN) + (t.fac.shop >= 3 ? 1 : 0);
        if (PT.League.Staff.quirks(L, tid).hype) h += 1;
        if (po) h = 6;
        if (po === C.PLAYOFF_ROUNDS) h = 15;
      } else if (loss) {
        h = rival && !po ? K().ECO_HYPE_RIVAL_LOSS : K().ECO_HYPE_LOSS;
      }
      h *= rMult;
      // long TDs: +1 (max +2 per game); Long Bomb twist bonus
      const longs = longTds(box, tid);
      h += Math.min(2, longs.filter((y) => y >= 50).length);
      if (fx.longBomb) {
        const n = longs.filter((y) => y >= fx.longBomb.yd).length;
        if (n) { h += n * fx.longBomb.hype; add(tid, n * fx.longBomb.coins, 'ev'); }
      }
      // scorers: Hype Pup +1 per TD, Squirrel (Nutty) +2 per score — capped per game (pacing)
      let sc = 0;
      for (const pid of Object.keys(box.pl || {})) {
        const ln = box.pl[pid];
        if (ln.t !== tid) continue;
        const tds = (ln.rtd || 0) + (ln.rctd || 0) + (ln.dtd || 0) + (ln.krtd || 0);
        if (!tds) continue;
        const p = PT.League.Q.player(L, +pid);
        if (!p) continue;
        if (p.tr.indexOf('hype_pup') >= 0) sc += tds;
        if (p.sp === 'squirrel') sc += 2 * tds;
      }
      h += Math.min(K().ECO_SCORER_MAX, sc);
      if (h) hy(tid, h);
    });
    return out;
  };

  /** Lengths (yd) of TDs scored by tid, parsed from the scoring summary (sc.yd if present, else "NN yd" in txt). */
  function longTds(box, tid) {
    const out = [];
    for (const s of box.sc || []) {
      if (s.t !== tid || s.k !== 'TD') continue;
      let y = typeof s.yd === 'number' ? s.yd : null;
      if (y == null) { const m = /(\d+)\s*-?\s*(yd|yard)/i.exec(s.txt || ''); if (m) y = +m[1]; }
      if (y != null) out.push(y);
    }
    return out;
  }
  Eco.longTds = longTds;

  /** Season cost of a team's coaches. */
  Eco.staffCost = function (L, tid) {
    let n = 0;
    for (const k of C.STAFF) n += C.STAFF_COST[PT.League.Staff.stars(L, tid, k)] || 0;
    return n;
  };
  /** Facility upkeep: 40 × (level − 1) each (design 10.11). */
  Eco.upkeep = function (L, tid) {
    const t = L.teams[tid];
    let n = 0;
    for (const f of C.FACILITIES) n += K().ECO_UPKEEP * (t.fac[f] - 1);
    return n;
  };

  /**
   * Preseason 1 (R6): TV money +400, bills (coaches + upkeep). If Coins < 0: the priciest coach drops a star at a time
   * (refund) until ≥ 0; still negative → Coins = 0 and Boss −10. Idempotent per season. Also the Hot Seat check.
   */
  Eco.season = function (L) {
    const ss = H().ss(L);
    if (ss.eco) return;
    ss.eco = 1;
    for (const t of L.teams) {
      t.fin.last = Math.round(t.fin.revS - t.fin.expS);
      t.fin.revS = 0; t.fin.expS = 0;
      Eco.addCoins(L, t.id, K().ECO_TV, 'tv');
      Eco.addCoins(L, t.id, -Eco.upkeep(L, t.id), 'upk', true);
      Eco.addCoins(L, t.id, -Eco.staffCost(L, t.id), 'staff', true);
      let guard = 0;
      while (t.fin.coins < 0 && guard++ < 15) {
        let best = null;
        for (const k of C.STAFF) { const s = PT.League.Staff.stars(L, t.id, k); if (s > 1 && (!best || s > best.s)) best = { k: k, s: s }; }
        if (!best) break;
        const refund = (C.STAFF_COST[best.s] || 0) - (C.STAFF_COST[best.s - 1] || 0);
        PT.League.Staff.put(L, t.id, best.k, best.s - 1);
        Eco.addCoins(L, t.id, refund, 'staff', true);
      }
      if (t.fin.coins < 0) {
        t.fin.coins = 0;
        if (t.id === L.userTid) PT.League.Boss.change(L, -10, 'coins');
      }
    }
    if (L.boss && L.boss.conf < 35) {
      ss.hot = 1;
      PT.League.News.add(L, 'event', PT.League.News.tpl('hotSeat', { T: L.teams[L.userTid].name }), L.userTid);
    }
  };

  /** Coins to reach the next level (Penny Pincher discount for the user). 0 when maxed. */
  Eco.upgradeCost = function (L, tid, fac) {
    const lv = L.teams[tid].fac[fac];
    if (lv >= 5) return 0;
    let cost = Math.round(C.FACILITY_COST[fac][lv] * K().ECO_FAC_MULT / 50) * 50;
    if (tid === L.userTid) cost = Math.round(cost * (1 - PT.League.Coach.mods(L).facDiscount));
    return cost;
  };

  /** Upgrade a facility instantly (Shop). @returns {Result} */
  Eco.upgrade = function (L, tid, fac) {
    const t = L.teams[tid];
    if (C.FACILITIES.indexOf(fac) < 0) return { ok: false, err: 'BAD_FAC', msg: 'Pick a building.' };
    if (t.fac[fac] >= 5) return { ok: false, err: 'MAXED', msg: 'Already maxed out.' };
    const cost = Eco.upgradeCost(L, tid, fac);
    if (t.fin.coins < cost) return { ok: false, err: 'NO_COINS', msg: 'Not enough Coins.' };
    Eco.addCoins(L, tid, -cost, 'fac');
    t.fac[fac]++;
    if (fac === 'sct' && tid === L.userTid && L.scout) L.scout.pts += 4;
    if (tid === L.userTid) PT.League.Achievements.check(L, 'facility');
    if (PT.Events) PT.Events.emit('league:changed', { what: 'facility' });
    return { ok: true, lvl: t.fac[fac], cost: cost, msg: C.FACILITY_NAMES[fac] + ' is now level ' + t.fac[fac] + '.' };
  };

  /** Fan Party: 100 Coins → Hype +5, max 3 per season. @returns {Result} */
  Eco.fanParty = function (L, tid) {
    if (tid == null) tid = L.userTid;
    const t = L.teams[tid];
    const ss = H().ss(L);
    if (tid === L.userTid && ss.pty >= K().ECO_PARTY_MAX) return { ok: false, err: 'MAX', msg: 'No more parties this season.' };
    if (t.fin.coins < K().ECO_PARTY_COST) return { ok: false, err: 'NO_COINS', msg: 'Not enough Coins.' };
    Eco.addCoins(L, tid, -K().ECO_PARTY_COST, 'party');
    Eco.addHype(L, tid, K().ECO_PARTY_HYPE);
    if (tid === L.userTid) ss.pty++;
    if (PT.Events) PT.Events.emit('league:changed', { what: 'hype' });
    return { ok: true, left: K().ECO_PARTY_MAX - ss.pty, msg: 'Team party. Hype +' + K().ECO_PARTY_HYPE + '.' };
  };

  /** Ticket tiers were dropped (R7); kept for API compatibility. */
  Eco.setTickets = function () { return { ok: true, msg: 'Events set ticket prices.' }; };

  /**
   * Finance report for the Shop/Team screen.
   * @returns {{coins, hype, rev:{tv,tix,merch,win,po,ev,ach}, exp:{staff,upk,fac,ev,gift,party}, revS, expS, last, upkeep, staffCost, merch}}
   */
  Eco.report = function (L, tid) {
    if (tid == null) tid = L.userTid;
    const t = L.teams[tid];
    const led = tid === L.userTid ? H().ss(L).led : {};
    const pos = (k) => Math.max(0, led[k] || 0), neg = (k) => Math.max(0, -(led[k] || 0));
    return {
      coins: t.fin.coins, hype: t.fin.hype, revS: t.fin.revS, expS: t.fin.expS, last: t.fin.last,
      rev: { tv: pos('tv'), tix: pos('tix'), merch: pos('merch'), win: pos('win'), po: pos('po'), ev: pos('ev'), ach: pos('ach') },
      exp: { staff: neg('staff'), upk: neg('upk'), fac: neg('fac'), ev: neg('ev'), gift: neg('gift'), party: neg('party') },
      upkeep: Eco.upkeep(L, tid), staffCost: Eco.staffCost(L, tid), merch: Eco.merch(L, tid),
      cash: PT.League.Cap.space(L, tid)
    };
  };
})(globalThis.PT = globalThis.PT || {});
