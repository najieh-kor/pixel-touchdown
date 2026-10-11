/* Pixel Touchdown: js/league/free-agency.js
 * Owner: WP2. Responsibility: PT.League.FA: pool, offers, player decision model, FA days (design 10.7, 17.3).
 * L.fa = { offers:[{pid, tid, sal, yrs, gift, day}], day, res:[{pid, tid, status, msg}] } during FREE_AGENCY.
 * Market Days = L.sub 0..2 (WP1 advances L.sub after FA.day). After Day 3 leftovers stay available all season:
 * Ask × 0.8, sign instantly (FA.signNow / FA.offer outside the Market).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const FA = PT.ns('League.FA');
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;
  const Cap = () => PT.League.Cap;
  const Con = () => PT.League.Contracts;

  const MONEY_W = { money: 1.3, fame: 1.0, wins: 0.8, home: 0.9, chill: 1.0 };
  const DIFF_BONUS = [10, 0, -8, -10];          // Beginner · Normal · Expert · Legend (ROUND6 B)
  const GIFTS = [0, 50, 100, 200];

  function maxRoster(L) { return Cap().offView(L) || L.phase === 'SEASON_END' ? C.ROSTER.MAX_OFF : C.ROSTER.MAX_SEASON; }
  function activeCount(L, tid) { return Q().roster(L, tid).filter((p) => !p.ir).length; }
  function inMarket(L) { return L.phase === 'FREE_AGENCY'; }

  /** Ask for a Market player (leftover discount × 0.8 outside the Market). */
  FA.ask = function (L, pid, tid) {
    const a = Con().ask(L, pid, tid == null ? L.userTid : tid);
    if (!inMarket(L)) a.sal = Math.max(Cap().minPay(L), Cap().round100(a.sal * K().FA_LEFTOVER_MULT));
    return a;
  };

  /** "Would he be a starter there?" (OVR > their current starter at his position). */
  function wouldStart(L, tid, p) { return p.ovr > Con().starterOvr(L, tid, p.pos); }

  /**
   * Player decision score for an offer (design 10.7). o = { sal, yrs, gift }. Higher is better.
   */
  FA.score = function (L, pid, tid, o) {
    const p = Q().player(L, pid);
    const t = L.teams[tid];
    const ask = Con().ask(L, pid, tid);
    const winsW = p.want === 'wins' ? 2.0 : 1.0;
    let s = 100 * (o.sal / Math.max(1, ask.sal)) * (MONEY_W[p.want] || 1);
    s += (t.fin.hype - 50) * 0.2;
    s += (Con().lastWins(L, tid) - 8.5) * 1.5 * winsW;
    if (wouldStart(L, tid, p)) s += 8;
    s += t.human ? L.coach.lvl * 0.3 : (t.tier || 3) * 2;
    s += (o.gift || 0) / 10;
    if (p.want === 'home' && p.ft === tid) s += 20;
    if (p.want === 'fame' && t.fin.hype >= 70) s += 5;
    if (o.yrs < ask.lo || o.yrs > ask.hi) s -= 5;
    if (t.human) s += (DIFF_BONUS[L.diff] || 0) + PT.League.Coach.mods(L).marketScore;
    return Math.round(s * 10) / 10;
  };

  /** Interest face from the user's own score: ≥ 105 Likely · 90–104 Maybe · < 90 Unlikely. */
  FA.face = function (score) { return score >= 105 ? 'likely' : score >= 90 ? 'maybe' : 'unlikely'; };

  /** Enter FREE_AGENCY. */
  FA.begin = function (L) {
    L.fa = { offers: [], day: 0, res: [] };
    PT.League.History.ss(L);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'fa' });
    return L.fa;
  };

  /**
   * Market list. opts { pos?, sort?: 'ovr'|'ask'|'age'|'interest' }.
   * @returns {{p, ask:{sal,yrs,lo,hi}, interest:number, face:string, offers:number, mine:Object|null}[]}
   */
  FA.list = function (L, opts) {
    opts = opts || {};
    const offers = (L.fa && L.fa.offers) || [];
    const rows = Q().freeAgents(L).filter((p) => !opts.pos || p.pos === opts.pos).map((p) => {
      const a = FA.ask(L, p.id, L.userTid);
      const mine = offers.find((x) => x.pid === p.id && x.tid === L.userTid) || null;
      const sc = FA.score(L, p.id, L.userTid, mine || { sal: a.sal, yrs: a.yrs, gift: 0 });
      return { p: p, ask: { sal: a.sal, yrs: a.yrs, lo: a.lo, hi: a.hi }, interest: Math.max(0, Math.min(100, Math.round(sc - 20))),
        score: sc, face: FA.face(sc), offers: offers.filter((x) => x.pid === p.id).length, mine: mine };
    });
    const sort = opts.sort || 'ovr';
    rows.sort((a, b) => sort === 'ask' ? b.ask.sal - a.ask.sal : sort === 'age' ? a.p.age - b.p.age :
      sort === 'interest' ? b.score - a.score : (b.p.ovr - a.p.ovr) || (a.p.id - b.p.id));
    return rows;
  };

  function validOffer(L, tid, pid, o) {
    const p = Q().player(L, pid);
    if (!p || p.tid !== C.TID.FA) return { ok: false, err: 'NOT_FA', msg: 'That player is not on the Market.' };
    if (!o || !(o.sal > 0)) return { ok: false, err: 'BAD_OFFER', msg: 'Pick a pay amount.' };
    if (o.sal < Cap().minPay(L) || o.sal > Cap().maxPay(L)) return { ok: false, err: 'BAD_PAY', msg: 'Pay must be between ' + PT.Util.fmtMoney(Cap().minPay(L)) + ' and ' + PT.Util.fmtMoney(Cap().maxPay(L)) + '.' };
    if (!(o.yrs >= 1 && o.yrs <= C.CAP.MAX_YRS)) return { ok: false, err: 'BAD_YEARS', msg: 'Pick 1 to 5 years.' };
    if (GIFTS.indexOf(o.gift || 0) < 0) return { ok: false, err: 'BAD_GIFT', msg: 'Pick a Welcome Gift.' };
    if ((o.gift || 0) > L.teams[tid].fin.coins) return { ok: false, err: 'NO_COINS', msg: 'Not enough Coins for that gift.' };
    if (!Cap().canAfford(L, tid, o.sal)) return { ok: false, err: 'CAP', msg: 'Not enough Team Cash.' };
    if (activeCount(L, tid) >= maxRoster(L)) return { ok: false, err: 'ROSTER_FULL', msg: 'Your roster is full.' };
    return { ok: true };
  }

  /**
   * User offer. During the Market: up to 5 offers per day, one per player (replaces), decided at day end.
   * Outside the Market: leftovers sign instantly if pay ≥ Ask × 0.8 (signNow).
   * @returns {{ok, status:'pending'|'signed'|'rejected', ask, score?, face?, msg}}
   */
  FA.offer = function (L, pid, o) {
    o = Object.assign({ gift: 0 }, o || {});
    if (!inMarket(L)) return FA.signNow(L, pid, o);
    const v = validOffer(L, L.userTid, pid, o);
    if (!v.ok) return v;
    if (!L.fa) FA.begin(L);
    const today = L.fa.offers.filter((x) => x.tid === L.userTid && x.day === L.sub && x.pid !== pid).length;
    if (today >= K().FA_MAX_USER_OFFERS) return { ok: false, err: 'TOO_MANY', msg: 'Only 5 offers per day.' };
    L.fa.offers = L.fa.offers.filter((x) => !(x.pid === pid && x.tid === L.userTid));
    L.fa.offers.push({ pid: pid, tid: L.userTid, sal: Math.round(o.sal / 100) * 100, yrs: o.yrs | 0, gift: o.gift || 0, day: L.sub });
    const sc = FA.score(L, pid, L.userTid, o);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'fa' });
    return { ok: true, status: 'pending', ask: FA.ask(L, pid, L.userTid), score: sc, face: FA.face(sc), msg: 'Offer sent. He decides at day end.' };
  };

  /** Withdraw a pending user offer. */
  FA.cancel = function (L, pid) {
    if (L.fa) L.fa.offers = L.fa.offers.filter((x) => !(x.pid === pid && x.tid === L.userTid));
    return { ok: true };
  };

  /** Sign a Market player right now (in-season pickups / after Day 3): pay ≥ Ask × 0.8. @returns {Result} */
  FA.signNow = function (L, pid, o, tid) {
    tid = tid == null ? L.userTid : tid;
    o = Object.assign({ yrs: 1, gift: 0 }, o || {});
    if (inMarket(L) && tid === L.userTid) return { ok: false, err: 'MARKET_OPEN', msg: 'Make an offer. He decides at day end.' };
    const v = validOffer(L, tid, pid, o);
    if (!v.ok) return v;
    const a = FA.ask(L, pid, tid);
    if (o.sal < a.sal) return { ok: true, status: 'rejected', ask: a, msg: 'He wants ' + PT.Util.fmtMoney(a.sal) + ' a year.' };
    sign(L, pid, tid, o);
    return { ok: true, status: 'signed', ask: a, msg: 'Signed. Welcome to the team.' };
  };

  function sign(L, pid, tid, o) {
    const p = Q().player(L, pid);
    const con = Con().make(L, o.sal, o.yrs, false);
    Con().attach(L, pid, tid, con);
    p.mor = 70;
    if (o.gift) PT.League.Economy.addCoins(L, tid, -o.gift, 'gift');
    if (tid === L.userTid || p.ovr >= 75) {
      const N = PT.League.News;
      N.add(L, 'sign', N.tpl('sign', { P: N.pname(p), T: L.teams[tid].name, N: Math.round(o.sal / 100) / 10 }), tid);
    }
    if (PT.Events) PT.Events.emit('league:signed', { pid: pid, tid: tid });
    if (tid === L.userTid) PT.League.Achievements.check(L, 'roster');
  }
  FA._sign = sign;

  /**
   * One Market Day: AI offers (17.3), then every Market player with offers decides (10.7):
   * signs with the best score if ≥ 95 (Days 1–2) or ≥ 85 (Day 3), else waits. On the last day AI teams fill needs.
   * @returns {{signed:{pid,tid,sal,yrs}[], user:{pid, status, msg}[]}}
   */
  FA.day = function (L) {
    if (!L.fa) FA.begin(L);
    const day = L.sub;
    L.fa.day = day;
    const last = day + 1 >= C.FA_DAYS;
    // AI bids
    for (const t of L.teams) if (!t.human) PT.League.AIGM.marketDay(L, t.id, day);
    // decisions (deterministic order: best players first)
    const byPid = {};
    for (const of of L.fa.offers) (byPid[of.pid] = byPid[of.pid] || []).push(of);
    const pids = Object.keys(byPid).map(Number).map((pid) => Q().player(L, pid)).filter((p) => p && p.tid === C.TID.FA)
      .sort((a, b) => (b.ovr - a.ovr) || (a.id - b.id)).map((p) => p.id);
    const signed = [], user = [];
    const thr = last ? K().FA_SIGN_SCORE_LAST : K().FA_SIGN_SCORE;
    for (const pid of pids) {
      const offs = byPid[pid].map((of) => ({ of: of, sc: FA.score(L, pid, of.tid, of) })).sort((a, b) => (b.sc - a.sc) || (a.of.tid - b.of.tid));
      let done = null;
      for (const x of offs) {
        if (x.sc < thr) break;
        const v = validOffer(L, x.of.tid, pid, x.of);
        if (!v.ok) continue;
        sign(L, pid, x.of.tid, x.of);
        done = x.of;
        signed.push({ pid: pid, tid: x.of.tid, sal: x.of.sal, yrs: x.of.yrs });
        break;
      }
      const mine = byPid[pid].find((of) => of.tid === L.userTid);
      if (mine) {
        const p = Q().player(L, pid);
        if (done && done.tid === L.userTid) user.push({ pid: pid, status: 'signed', msg: p.fn + ' signs with you.' });
        else if (done) user.push({ pid: pid, status: 'rejected', msg: p.fn + ' picked the ' + L.teams[done.tid].name + '.' });
        else user.push({ pid: pid, status: 'pending', msg: p.fn + ' is still thinking.' });
      }
    }
    // offers stay alive for players still on the Market; resolved ones are removed
    L.fa.offers = L.fa.offers.filter((of) => { const p = Q().player(L, of.pid); return p && p.tid === C.TID.FA; });
    L.fa.res = user;
    if (last) {
      L.fa.offers = [];
      for (const t of L.teams) if (!t.human) PT.League.AIGM.fillNeeds(L, t.id, false);
    }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'fa' });
    return { signed: signed, user: user };
  };

  /**
   * Sign Walk-on (design 2.2): a generated Market player at pos, OVR 45–55, min pay, 1 year. @returns {Result & {pid}}
   */
  FA.walkOn = function (L, tid, pos) {
    if (C.POS.indexOf(pos) < 0) return { ok: false, err: 'BAD_POS', msg: 'Pick a position.' };
    if (activeCount(L, tid) >= maxRoster(L)) return { ok: false, err: 'ROSTER_FULL', msg: 'Your roster is full.' };
    if (!Cap().canAfford(L, tid, Cap().minPay(L))) return { ok: false, err: 'CAP', msg: 'Not enough Team Cash.' };
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, L.nextPid, 'walkon'));
    const ovr = r.int(45, 55);
    const p = PT.League.PlayerGen.create(L, { pos: pos, tid: C.TID.FA, age: r.int(22, 27), ovr: ovr });
    p.tid = C.TID.FA; p.pos = pos; p.con = null; p.inj = null; p.ir = false; delete p.pr;
    p.alt = p.alt || []; p.sg = p.sg || {};
    PT.League.Draft.fitOvr(p, ovr);
    p.pot = Math.max(p.pot || 0, p.ovr);
    L.players.push(p);
    if (PT.League.hydrate) PT.League.hydrate(L);
    sign(L, p.id, tid, { sal: Cap().minPay(L), yrs: 1, gift: 0 });
    return { ok: true, pid: p.id };
  };

  /**
   * "Fix it for me" (design 2.2): sign walk-ons for every missing position minimum; if the roster would go over the
   * max, cut the lowest-Stars bench player at the most crowded position first. @returns {{signed:number[], cut:number[]}}
   */
  FA.fixRoster = function (L, tid) {
    if (tid == null) tid = L.userTid;
    const signed = [], cut = [];
    const need = C.ROSTER.NEED;
    for (let guard = 0; guard < 20; guard++) {
      const pl = Q().roster(L, tid).filter((p) => !p.ir && !p.inj);
      const cnt = {};
      for (const p of pl) cnt[p.pos] = (cnt[p.pos] || 0) + 1;
      const miss = C.POS.find((pos) => (cnt[pos] || 0) < need[pos]);
      if (!miss) break;
      if (activeCount(L, tid) >= maxRoster(L)) {
        const all = Q().roster(L, tid).filter((p) => !p.ir);
        const all2 = {};
        for (const p of all) all2[p.pos] = (all2[p.pos] || 0) + 1;
        const crowd = C.POS.slice().sort((a, b) => ((all2[b] || 0) - need[b]) - ((all2[a] || 0) - need[a]))[0];
        const victim = all.filter((p) => p.pos === crowd && !PT.League.Spirit.isStarter(L, p.id)).sort((a, b) => a.ovr - b.ovr)[0];
        if (!victim) break;
        PT.League.Roster.release(L, victim.id);
        cut.push(victim.id);
      }
      const r = FA.walkOn(L, tid, miss);
      if (!r.ok) break;
      signed.push(r.pid);
    }
    return { signed: signed, cut: cut };
  };
})(globalThis.PT = globalThis.PT || {});
