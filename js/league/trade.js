/* Pixel Touchdown: js/league/trade.js
 * Owner: WP2. Responsibility: PT.League.Trade: Swaps (design 10.8) with AI swap values (design 17.4), R12.
 * A side = { pids:[…], picks:[{s, rd, orig}] } (or a plain pid array). Window: Keep Players → Week 10 (not Draft, not
 * Playoffs). Max 3 items per side, each AI team accepts ≤ 2 user swaps per season. AI accepts if
 * valueIn ≥ valueOut × threshold (Rookie 1.00 · Pro 1.10 · Legend 1.25; Trade Shark −0.05/−0.10; Trade Frenzy −0.10).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Tr = PT.ns('League.Trade');
  const Q = () => PT.League.Q;
  const K = () => PT.League.K;
  const Cap = () => PT.League.Cap;
  const H = () => PT.League.History;

  Tr.THRESH = [1.00, 1.10, 1.21, 1.25];          // Beginner · Normal · Expert · Legend (ROUND6 B)
  const AGE_F = (a) => (a <= 24 ? 1.25 : a <= 27 ? 1.10 : a <= 29 ? 1.00 : a <= 31 ? 0.70 : 0.40);
  const GROW_F = { 'A+': 1.3, A: 1.2, B: 1.0, C: 0.9, D: 0.8 };

  /**
   * playerValue (17.4) from the receiving team's view (tid). Trade Rumor ("Maybe…") +10% this season.
   * max(0, OVR − 50)^1.8 × ageF × posF × growthF − contractPenalty, then mode adjustments.
   */
  Tr.playerValue = function (L, pid, tid) {
    const p = Q().player(L, pid);
    if (!p) return 0;
    let v = Math.pow(Math.max(0, p.ovr - 50), 1.8) * AGE_F(p.age) * (p.pos === 'QB' ? 1.5 : p.pos === 'K' ? 0.4 : 1.0) *
      (p.age <= 25 ? GROW_F[p.gl] || 1 : 1);
    if (p.con) {
      const fair = Cap().fairPay(L, p);
      const yl = Math.max(1, Cap().yearsLeft(L, p));
      v -= Math.max(0, p.con.sal - fair) / 1000 * yl * 15;
    }
    v = Math.max(0, v);
    const t = tid != null && tid >= 0 ? L.teams[tid] : null;
    if (t && !t.human) {
      if (t.strat === 'rebuild' && p.age >= 29) v *= 0.7;
      if (t.strat === 'contend' && p.ovr >= 78) v *= 1.15;
    }
    if (L.ss && L.ss.s === L.season && L.ss.rumor.indexOf(pid) >= 0) v *= 1.10;
    return Math.round(v * 10) / 10;
  };

  /** Slot (1..32) a pick would have this year: from the live draft order or projected standings. */
  function pickSlot(L, pk) {
    if (L.draft && L.draft.s === pk.s) {
      const o = L.draft.order.find((x) => x.rd === pk.rd && x.orig === pk.orig);
      if (o) return ((o.pk - 1) % C.NUM_TEAMS) + 1;
    }
    if (pk.s !== L.season + 1) return null;      // next year's picks
    try {
      const order = PT.League.Draft.baseOrder(L);
      return order.indexOf(pk.orig) + 1;
    } catch (e) { return 16; }
  }

  /** pickValue (17.4). This year's draft by slot; later years = slot 16 × 0.9. Mode: Rebuild ×1.2, Contender ×0.85. */
  Tr.pickValue = function (L, pk, tid) {
    let slot = pickSlot(L, pk);
    let mult = 1;
    if (slot == null || slot < 1) { slot = 16; mult = 0.9; }
    const s = slot - 1;
    let v = pk.rd === 1 ? 600 - s * 10 : pk.rd === 2 ? 160 - s * 2 : pk.rd === 3 ? 60 - s * 0.7 : 25 - s * 0.3;
    v *= mult;
    const t = tid != null && tid >= 0 ? L.teams[tid] : null;
    if (t && !t.human) { if (t.strat === 'rebuild') v *= 1.2; if (t.strat === 'contend') v *= 0.85; }
    return Math.round(v * 10) / 10;
  };

  function side(x) {
    if (!x) return { pids: [], picks: [] };
    if (Array.isArray(x)) return { pids: x.slice(), picks: [] };
    return { pids: (x.pids || []).slice(), picks: (x.picks || []).slice() };
  }

  /** AI acceptance threshold for user swaps. */
  Tr.threshold = function (L) {
    return Math.round(((Tr.THRESH[L.diff] || 1.10) + PT.League.Coach.mods(L).tradeThr + (PT.League.Twists.fx(L).tradeThr || 0)) * 100) / 100;
  };

  /** Is the swap window open? */
  Tr.open = function (L) {
    if (L.phase === 'RESIGN' || L.phase === 'FREE_AGENCY' || L.phase === 'PRESEASON' || L.phase === 'SEASON_END') return true;
    return L.phase === 'REGULAR' && L.week <= K().TR_DEADLINE_WEEK;
  };

  /** Owner of a pick. */
  function pickOwner(L, pk) {
    const t = L.teams.find((x) => x.picks.some((q) => q.s === pk.s && q.rd === pk.rd && q.orig === pk.orig));
    return t ? t.id : -1;
  }

  /** Legality after the swap: cap, roster size, position minimums for both teams. @returns {string[]} errors (kid words) */
  function legality(L, a, b, give, get) {
    const errs = [];
    const max = Cap().offView(L) || L.phase === 'SEASON_END' || L.phase === 'PRESEASON' ? C.ROSTER.MAX_OFF : C.ROSTER.MAX_SEASON;
    const sal = (pids) => pids.reduce((s, pid) => { const p = Q().player(L, pid); return s + (p && p.con ? p.con.sal : 0); }, 0);
    const check = (tid, out, inn, who) => {
      const space = Cap().space(L, tid) + sal(out) - sal(inn);
      if (space < 0) errs.push(who + ' would go over the Team Cash limit.');
      // QA1: a Hurt List player sent away frees no active spot (he never counted); arriving players come off the list
      const n = Q().roster(L, tid).filter((p) => !p.ir && out.indexOf(p.id) < 0).length + inn.length;
      if (n > max) errs.push(who + ' would have too many players.');
      const c = {}, b0 = {};
      for (const p of Q().roster(L, tid)) if (!p.ir) { b0[p.pos] = (b0[p.pos] || 0) + 1; if (out.indexOf(p.id) < 0) c[p.pos] = (c[p.pos] || 0) + 1; }
      for (const pid of inn) { const p = Q().player(L, pid); if (p) c[p.pos] = (c[p.pos] || 0) + 1; }
      // HUNT3-league #4: only a swap that makes a shortage worse is refused; the offseason skips minimums (Week 1 checks them)
      const offseason = ['SEASON_END', 'RESIGN', 'DRAFT', 'FREE_AGENCY'].indexOf(L.phase) >= 0;
      if (!offseason) for (const pos of C.POS) {
        if ((c[pos] || 0) < C.ROSTER.NEED[pos] && (c[pos] || 0) < (b0[pos] || 0)) { errs.push(who + ' would not have enough ' + pos + 's.'); break; }
      }
    };
    check(a, give.pids, get.pids, a === L.userTid ? 'You' : 'They');
    check(b, get.pids, give.pids, b === L.userTid ? 'You' : 'They');
    return errs;
  }

  /**
   * Evaluate a swap from the user's side: give = what you send, get = what you receive (partner inferred from get,
   * or give.tid/get.tid/opts.tid). @returns {{tid, valueIn, valueOut, ratio, threshold, meter:'red'|'yellow'|'green',
   * accept:boolean, legal:boolean, errors:string[]}}
   */
  Tr.evaluate = function (L, give, get, tid) {
    const g = side(give), r = side(get);
    if (tid == null) tid = (get && get.tid != null) ? get.tid : (give && give.tid != null) ? give.tid : null;
    if (tid == null) { const p = r.pids.length ? Q().player(L, r.pids[0]) : null; tid = p ? p.tid : (r.picks.length ? pickOwner(L, r.picks[0]) : -1); }
    const u = L.userTid;
    const errors = [];
    if (tid == null || tid < 0 || tid === u) errors.push('Pick a team to swap with.');
    if (g.pids.length + g.picks.length > 3 || r.pids.length + r.picks.length > 3) errors.push('Up to 3 on each side.');
    if (!g.pids.length && !g.picks.length) errors.push('Add something to give.');
    if (!r.pids.length && !r.picks.length) errors.push('Add something to get.');
    for (const pid of g.pids) { const p = Q().player(L, pid); if (!p || p.tid !== u) errors.push('You can only give your own players.'); }
    // QA1: in Keep Players the AI teams already made their Keep decisions, so an unkept expiring player would just walk
    // to the Market at Draft Day after the AI paid full value for him. Keep him first.
    if (L.phase === 'RESIGN') {
      for (const pid of g.pids) {
        const p = Q().player(L, pid);
        if (p && p.tid === u && p.con && p.con.exp <= L.season) errors.push(p.fn + '\'s deal is ending. Keep him first.');
      }
    }
    for (const pid of r.pids) { const p = Q().player(L, pid); if (!p || p.tid !== tid) errors.push('They can only give their own players.'); }
    for (const pk of g.picks) if (pickOwner(L, pk) !== u) errors.push('You do not own that pick.');
    for (const pk of r.picks) if (pickOwner(L, pk) !== tid) errors.push('They do not own that pick.');
    if (!Tr.open(L)) errors.push('Swaps are closed right now.');
    const ss = H().ss(L);
    if (tid >= 0 && (ss.sw[tid] || 0) >= K().TR_MAX_PER_TEAM) errors.push('They already made 2 swaps with you this season.');
    // values from the AI team's view
    let vin = 0, vout = 0;
    if (tid >= 0 && tid !== u) {
      for (const pid of g.pids) vin += Tr.playerValue(L, pid, tid);
      for (const pk of g.picks) vin += Tr.pickValue(L, pk, tid);
      for (const pid of r.pids) vout += Tr.playerValue(L, pid, tid);
      for (const pk of r.picks) vout += Tr.pickValue(L, pk, tid);
      if (!errors.length) errors.push.apply(errors, legality(L, u, tid, g, r));
    }
    const thr = Tr.threshold(L);
    const ratio = vout > 0 ? vin / vout : vin > 0 ? 99 : 0;
    const meter = ratio >= thr ? 'green' : ratio >= thr * 0.9 ? 'yellow' : 'red';
    const legal = errors.length === 0;
    return { tid: tid, valueIn: Math.round(vin), valueOut: Math.round(vout), ratio: Math.round(ratio * 100) / 100, threshold: thr,
      meter: meter, accept: legal && vin >= vout * thr && vin > 0, legal: legal, errors: errors };
  };

  /** Move players/picks between two teams (no Cut Cost). Mood −5 (Wants Home −15); Spirit −4 per starter sent in-season. */
  function execute(L, a, b, give, get) {
    const inSeason = L.phase === 'REGULAR';
    const move = (pids, from, to) => {
      for (const pid of pids) {
        const p = Q().player(L, pid);
        const starter = PT.League.Spirit.isStarter(L, pid);
        const con = p.con;
        PT.League.Contracts.detach(L, pid);
        PT.League.Contracts.attach(L, pid, to, con);
        PT.League.Spirit.addMood(L, p, p.want === 'home' ? -15 : -5, 'swap');
        if (inSeason && starter) PT.League.Spirit.addSpirit(L, from, -4);
      }
    };
    move(give.pids, a, b);
    move(get.pids, b, a);
    const movePick = (pk, from, to) => {
      const t = L.teams[from];
      const i = t.picks.findIndex((q) => q.s === pk.s && q.rd === pk.rd && q.orig === pk.orig);
      if (i < 0) return;
      const q = t.picks.splice(i, 1)[0];
      L.teams[to].picks.push(q);
      if (L.draft && L.draft.s === q.s) { const o = L.draft.order.find((x) => x.rd === q.rd && x.orig === q.orig && x.pid == null); if (o) o.tid = to; }
    };
    give.picks.forEach((pk) => movePick(pk, a, b));
    get.picks.forEach((pk) => movePick(pk, b, a));
    for (const tid of [a, b]) {
      const t = L.teams[tid];
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, tid);
      if (t.capt == null) PT.League.Spirit.autoCaptain(L, tid);
    }
    const N = PT.League.News;
    const first = give.pids.length ? Q().player(L, give.pids[0]) : get.pids.length ? Q().player(L, get.pids[0]) : null;
    if (first) {
      const from = give.pids.length ? a : b, to = from === a ? b : a;
      N.add(L, 'trade', N.tpl('swap', { T: L.teams[from].name, P: N.pname(first), T2: 'the ' + L.teams[to].name }), from);
    }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'swap' });
  }
  Tr._execute = execute;

  /**
   * Propose a swap to AI team tid: givePids (yours) for getPids (theirs), picks = { give:[pk], get:[pk] }.
   * @returns {{ok, accepted, eval, msg}}
   */
  Tr.propose = function (L, tid, givePids, getPids, picks) {
    if (tid && typeof tid === 'object') {                         // UI shape: { from, to, give, get }
      const o = tid, gs = side(o.give), rs = side(o.get);
      tid = o.to != null && o.to !== L.userTid ? o.to : o.from;
      givePids = gs.pids; getPids = rs.pids; picks = { give: gs.picks, get: rs.picks };
    }
    picks = picks || {};
    const give = { pids: givePids || [], picks: picks.give || [] }, get = { pids: getPids || [], picks: picks.get || [] };
    const ev = Tr.evaluate(L, give, get, tid);
    if (!ev.legal) return { ok: false, err: 'ILLEGAL', msg: ev.errors[0], eval: ev, accepted: false };
    if (!ev.accept) return { ok: true, accepted: false, eval: ev, msg: ev.meter === 'yellow' ? 'Close. Add a little more.' : 'They said no thanks.' };
    execute(L, L.userTid, tid, give, get);
    const ss = H().ss(L);
    ss.sw[tid] = (ss.sw[tid] || 0) + 1;
    return { ok: true, accepted: true, eval: ev, msg: 'Swap done.' };
  };

  /**
   * Value for the Fair? meter: a pid, a pick {s,rd,orig}, an array of pids, or a side {pids, picks}, seen by team tid.
   * @returns {number}
   */
  Tr.value = function (L, x, tid) {
    if (x == null) return 0;
    if (typeof x === 'number') return Tr.playerValue(L, x, tid);
    if (x.rd != null && x.orig != null) return Tr.pickValue(L, x, tid);
    const s = side(x);
    let v = 0;
    for (const pid of s.pids) v += Tr.playerValue(L, pid, tid);
    for (const pk of s.picks) v += Tr.pickValue(L, pk, tid);
    return Math.round(v * 10) / 10;
  };

  // ---------------- AI-initiated (P1) ----------------

  /** Surplus assets of an AI team (bench players over template + picks), cheapest value first. */
  function surplus(L, tid, avoidPos) {
    const t = L.teams[tid];
    const c = {};
    for (const p of Q().roster(L, tid)) if (!p.ir) c[p.pos] = (c[p.pos] || 0) + 1;
    const pl = Q().roster(L, tid).filter((p) => !p.ir && p.pos !== avoidPos && !PT.League.Spirit.isStarter(L, p.id) && (c[p.pos] || 0) > C.ROSTER.NEED[p.pos]);
    const picks = t.picks.filter((pk) => pk.s >= L.season + 1);
    return { pl: pl, picks: picks };
  }

  /** Build a package worth ≥ target from assets (greedy, up to 3 items). */
  function pack(L, recvTid, assets, target) {
    const items = assets.pl.map((p) => ({ k: 'p', id: p.id, v: Tr.playerValue(L, p.id, recvTid) }))
      .concat(assets.picks.map((pk) => ({ k: 'k', pk: pk, v: Tr.pickValue(L, pk, recvTid) }))).filter((x) => x.v > 0)
      .sort((a, b) => a.v - b.v);
    // smallest single item that covers the target, else greedy biggest-first up to 3
    const one = items.find((x) => x.v >= target);
    const chosen = one ? [one] : [];
    if (!one) {
      let sum = 0;
      for (const x of items.slice().reverse()) { if (chosen.length >= 3 || sum >= target) break; chosen.push(x); sum += x.v; }
      if (sum < target) return null;
    }
    return { pids: chosen.filter((x) => x.k === 'p').map((x) => x.id), picks: chosen.filter((x) => x.k === 'k').map((x) => x.pk),
      v: chosen.reduce((s, x) => s + x.v, 0) };
  }

  /**
   * Each week before the deadline, 10% chance an AI team with a need asks for one of your players at that position
   * (OVR ≥ their starter + 3) and offers 1.05 × his value. Creates a 'swap_offer' event card. @returns {Object|null} offer
   */
  Tr.aiOffer = function (L) {
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, 'aioffer'));
    if (!r.chance(K().AI_SWAP_CHANCE) || !Tr.open(L)) return null;
    if (L.ev.pending.some((e) => e.def === 'swap_offer')) return null;
    const u = L.userTid;
    const teams = L.teams.filter((t) => !t.human && (H().ss(L).sw[t.id] || 0) < K().TR_MAX_PER_TEAM).map((t) => t.id);
    r.shuffle(teams);
    for (const tid of teams) {
      const needs = C.POS.filter((pos) => pos !== 'K' && PT.League.Contracts.starterOvr(L, tid, pos) < 72);
      for (const pos of needs) {
        const so = PT.League.Contracts.starterOvr(L, tid, pos);
        const mine = Q().roster(L, u).filter((p) => p.pos === pos && !p.ir && !p.inj && p.ovr >= so + 3).sort((a, b) => a.ovr - b.ovr);
        for (const p of mine) {
          const target = 1.05 * Tr.playerValue(L, p.id, tid);
          if (target <= 0) continue;
          const pk = pack(L, u, surplus(L, tid, pos), target);
          if (!pk) continue;
          const give = { pids: [p.id], picks: [] }, get = { pids: pk.pids, picks: pk.picks };
          if (legality(L, u, tid, give, get).length) continue;
          const offer = { tid: tid, give: give, get: get };
          PT.League.WeeklyEvents.push(L, 'swap_offer', p.id, { tid: tid, give: give, get: get });
          return offer;
        }
      }
    }
    return null;
  };

  /** Accept an AI offer (from the swap_offer card). @returns {Result} */
  Tr.acceptOffer = function (L, offer) {
    const give = side(offer.give), get = side(offer.get);
    const errs = legality(L, L.userTid, offer.tid, give, get);
    for (const pid of give.pids) { const p = Q().player(L, pid); if (!p || p.tid !== L.userTid) errs.push('That player is gone.'); }
    for (const pid of get.pids) { const p = Q().player(L, pid); if (!p || p.tid !== offer.tid) errs.push('Their player is gone.'); }
    if (errs.length || !Tr.open(L)) return { ok: false, err: 'ILLEGAL', msg: errs[0] || 'Swaps are closed right now.' };
    execute(L, L.userTid, offer.tid, give, get);
    const ss = H().ss(L);
    ss.sw[offer.tid] = (ss.sw[offer.tid] || 0) + 1;
    return { ok: true };
  };

  /**
   * AI-to-AI swaps (P1): 0–3 per season (Trade Frenzy ×2) on random weeks 3–10. A Contender buys a Rebuild team's player
   * (age ≥ 28, OVR ≥ 78, at a need) with picks/young players worth 1.05 × value. @returns {boolean} happened
   */
  Tr.aiToAi = function (L) {
    const ss = H().ss(L);
    const fx = PT.League.Twists.fx(L);
    const maxN = Math.round(3 * (fx.aiSwaps || 1));
    if (!ss.ai.plan) {
      const r0 = PT.RNG.create(PT.RNG.hash(L.seed, L.season, 'aiplan'));
      const n = Math.min(maxN, r0.int(0, 3) * (fx.aiSwaps || 1));
      const wks = [];
      for (let i = 0; i < n; i++) wks.push(r0.int(3, K().TR_DEADLINE_WEEK));
      ss.ai.plan = wks;
    }
    if (ss.ai.plan.indexOf(L.week) < 0 || ss.ai.sw >= maxN) return false;
    const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, 'ai2ai'));
    const buyers = L.teams.filter((t) => !t.human && t.strat === 'contend').map((t) => t.id);
    const sellers = L.teams.filter((t) => !t.human && t.strat === 'rebuild').map((t) => t.id);
    r.shuffle(buyers); r.shuffle(sellers);
    for (const b of buyers) {
      for (const s of sellers) {
        const cands = Q().roster(L, s).filter((p) => p.age >= 28 && p.ovr >= 78 && !p.ir && !p.inj &&
          PT.League.Contracts.starterOvr(L, b, p.pos) < p.ovr).sort((x, y) => y.ovr - x.ovr);
        for (const p of cands) {
          const target = 1.05 * Tr.playerValue(L, p.id, s);
          const pk = pack(L, s, surplus(L, b, p.pos), target);
          if (!pk) continue;
          const give = { pids: pk.pids, picks: pk.picks }, get = { pids: [p.id], picks: [] };
          if (legality(L, b, s, give, get).length) continue;
          execute(L, b, s, give, get);
          ss.ai.sw++;
          return true;
        }
      }
    }
    return false;
  };
})(globalThis.PT = globalThis.PT || {});
