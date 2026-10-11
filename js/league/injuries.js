/* Pixel Touchdown: js/league/injuries.js
 * Owner: WP2. Responsibility: PT.League.Injuries: box injuries→weeks, recovery, medical facility effect (design 12).
 * Box injuries: box.inj = [{pid, sev}] where sev = design tier 1..5 (1 Ouch · 2 Sprain · 3 Hurt · 4 Bad Hurt · 5 Season Over),
 * rolled by the engine / StatSim with Injuries.chanceMult + Injuries.rollTier. Ouch never costs weeks.
 * Player injury: p.inj = { t: name, w: weeks left, sev: 1..4 } (sev = tier − 1: 1 Sprain · 2 Hurt · 3 Bad Hurt · 4 Season Over).
 * Hurt List: p.ir (needs ≥ 4 weeks out; frees a roster spot, still paid). Play Hurt: p.ph (Sprain/Hurt only, user team).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Inj = PT.ns('League.Injuries');
  const H = () => PT.League.History;
  const Q = () => PT.League.Q;

  /** severity chances (design 12.2) by tier 1..5 */
  Inj.TIER_W = [[1, 50], [2, 28], [3, 15], [4, 6], [5, 1]];
  /** weeks out range by tier */
  Inj.WEEKS = { 2: [1, 2], 3: [3, 5], 4: [6, 10] };
  Inj.DIFF_MULT = [0.6, 1.0, 1.15, 1.2];          // Beginner · Normal · Expert · Legend (ROUND6 B)

  /** Roster size limit now (WP1 Roster.limit: 22 in season, 30 in the offseason). */
  function rosterLimit(L) {
    const R = PT.League.Roster;
    if (R && typeof R.limit === 'function') return R.limit(L);
    return L.phase === 'REGULAR' || L.phase === 'PLAYOFFS' ? C.ROSTER.MAX_SEASON : C.ROSTER.MAX_OFF;
  }
  /** players on the roster, Hurt List excluded */
  function activeCount(L, tid) { return Q().roster(L, tid).filter((x) => !x.ir).length; }

  /** Weeks left in the season incl. playoffs, from now. */
  function weeksToEnd(L) {
    const total = C.REG_WEEKS + C.PLAYOFF_ROUNDS;
    const wk = L.phase === 'PRESEASON' || !L.week ? 1 : L.week;
    return Math.max(1, total - wk + 1);
  }

  /** Display name for an injury tier. */
  Inj.tierName = function (tier) { return ((PT.Data.Text && PT.Data.Text.tiers) || [])[tier] || 'Hurt'; };

  /**
   * Injury chance multiplier (design 12.1) for a player (p may be null for team-level factors only).
   * ctx: { team?, hit?, weather?, playHurt? }. Multiply the engine/StatSim base chance (K.INJ_BASE) by this.
   */
  Inj.chanceMult = function (L, p, ctx) {
    ctx = ctx || {};
    const tid = p ? p.tid : ctx.team;
    let m = 1;
    if (p) {
      m *= 1 + Math.max(0, p.age - 29) * 0.08;
      if (p.tr.indexOf('glass_bones') >= 0) m *= 1.75;
      if (p.tr.indexOf('iron_hide') >= 0) m *= 0.5;
      if (p.sp === 'turtle') m *= 0.75;
      if (p.ph && p.inj) m *= 3;
    }
    if (tid != null && tid >= 0) {
      const t = L.teams[tid];
      m *= 1 - 0.05 * (t.fac.med - 1);
      if (tid === L.userTid) {
        m *= Inj.DIFF_MULT[L.diff] || 1;
        const ss = H().ss(L);
        if (ss.prac === 'hard') m *= 1.10;
        if (ss.inj && ss.inj.g > 0) m *= ss.inj.m;
      }
    }
    if (ctx.weather === 'snow') m *= 1.1;
    m *= PT.League.Twists.fx(L).injMult || 1;
    return Math.round(m * 1000) / 1000;
  };

  /** Roll a severity tier 1..5 (Iron Hide: one tier lower, Ouch stays Ouch). */
  Inj.rollTier = function (rng, p) {
    let tier = rng.weighted(Inj.TIER_W);
    if (p && p.tr.indexOf('iron_hide') >= 0) tier = Math.max(1, tier - 1);
    return tier;
  };

  function injName(rng, tier) {
    const T = PT.Data.Text && PT.Data.Text.injTiers ? PT.Data.Text.injTiers[tier] : null;
    return T && T.length ? rng.pick(T) : Inj.tierName(tier);
  }

  /**
   * Turn a tier into weeks out (Medical Center, Doc Hands for the user, staff 'heal' quirk). Season Over → rest of season.
   */
  Inj.weeksFor = function (L, p, tier, rng) {
    if (tier <= 1) return 0;
    if (tier >= 5) return weeksToEnd(L);
    const t = p.tid >= 0 ? L.teams[p.tid] : null;
    const rg = Inj.WEEKS[tier];
    let w = rng.int(rg[0], rg[1]);
    const med = t ? t.fac.med : 1;
    w = Math.ceil(w * (1 - 0.10 * (med - 1)));
    if (t && PT.League.Staff.quirks(L, t.id).heal) w = Math.ceil(w * 0.9);
    if (t && t.id === L.userTid && w >= 3) w -= PT.League.Coach.mods(L).healWeeks;
    return Math.max(1, w);
  };

  /**
   * Apply one injury to a player (tier 1..5). Handles Nine Lives (Cat, once per season 50%), Iron Hide (box tiers are
   * assumed already rolled; pass opts.roll to apply it here), Second Opinion (Medical L3+, once per season, Season Over
   * reroll keeps the better), playing hurt (old tier + 1 with fresh weeks). @returns {{pid, tier, w, out:boolean, saved?:string}}
   */
  Inj.apply = function (L, pid, tier, opts) {
    opts = opts || {};
    const p = Q().player(L, pid);
    if (!p) return null;
    const ss = H().ss(L);
    const rng = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, pid, 'inj', tier));
    if (opts.roll && p.tr.indexOf('iron_hide') >= 0) tier = Math.max(1, tier - 1);
    if (p.inj && p.ph) tier = Math.min(5, p.inj.sev + 2);                           // hurt again while playing hurt: old tier + 1
    if (tier <= 1) return { pid: pid, tier: 1, w: 0, out: false };
    if (p.sp === 'cat' && ss.nl.indexOf(pid) < 0) {
      ss.nl.push(pid);
      if (rng.chance(0.5)) return { pid: pid, tier: tier, w: 0, out: false, saved: 'Nine Lives' };
    }
    const t = p.tid >= 0 ? L.teams[p.tid] : null;
    if (tier === 5 && t && t.fac.med >= 3 && ss.so.indexOf(t.id) < 0) {
      ss.so.push(t.id);
      const re = rng.weighted(Inj.TIER_W);
      tier = Math.min(tier, re);
      if (tier <= 1) return { pid: pid, tier: 1, w: 0, out: false, saved: 'Second Opinion' };
    }
    const w = Inj.weeksFor(L, p, tier, rng);
    const prev = p.inj;
    if (prev && !p.ph && prev.w >= w && prev.sev >= tier - 1) return { pid: pid, tier: prev.sev + 1, w: prev.w, out: true };
    p.inj = { t: injName(rng, tier), w: w, sev: tier - 1, at: L.week };
    if (p.ph) delete p.ph;
    if (tier === 5) p.r.spd = Math.max(C.SKILL_MIN, p.r.spd - rng.int(1, 3));
    if (tier === 5 && PT.League.Ratings && PT.League.Ratings.ovr) p.ovr = PT.League.Ratings.ovr(p);
    if (PT.Events) PT.Events.emit('league:injury', { pid: pid });
    // news: 4★+ players (OVR ≥ 82) or anyone on the user team
    if (p.ovr >= 82 || (t && t.id === L.userTid)) {
      const N = PT.League.News;
      N.add(L, 'inj', tier === 5 ? N.tpl('injOut', { P: N.pname(p) }) : N.tpl('inj', { P: N.pname(p), N: w }), p.tid);
    }
    return { pid: pid, tier: tier, w: w, out: true };
  };

  /**
   * Games.record hook: convert box injuries to weeks. AI teams re-run Auto Lineup.
   * @returns {{pid, tier, w, out, saved?}[]}
   */
  Inj.fromBox = function (L, box) {
    const out = [];
    const touched = {};
    for (const i of box.inj || []) {
      const tier = Math.max(1, Math.min(5, i.sev | 0));
      const r = Inj.apply(L, i.pid, tier);
      if (!r) continue;
      out.push(r);
      const p = Q().player(L, i.pid);
      if (r.out && p && p.tid >= 0) touched[p.tid] = 1;
    }
    for (const tid of Object.keys(touched)) {
      const t = L.teams[+tid];
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
    }
    return out;
  };

  /**
   * Weekly countdown (games and Rest Week). Healed players come off the Hurt List; AI teams make room if needed.
   * Weekly Practice "Rest": players with ≥ 2 weeks left heal 1 extra week (user team).
   */
  Inj.weekly = function (L) {
    if (!H().once(L, 'inj')) return;
    const ss = H().ss(L);
    const rest = ss.prac === 'rest';
    const healed = {};
    for (const p of L.players) {
      if (!p.inj) continue;
      if (p.ir && p.inj.w <= 0) continue;                                 // healed, waiting on the Hurt List for a spot
      if (p.inj.at === L.week && L.phase !== 'PRESEASON') continue;      // hurt this week: misses the next game first
      let d = 1;
      if (rest && p.tid === L.userTid && p.inj.w >= 2) d = 2;
      p.inj.w -= d;
      if (p.inj.w <= 0) {
        if (p.ph) delete p.ph;
        const t = p.tid >= 0 ? L.teams[p.tid] : null;
        // Design 2.2: coming back from the Hurt List needs an open roster spot. AI teams make room (fitRoster below);
        // your healed player waits on the Hurt List (inj.w 0, "Ready to come back") until you free a spot.
        if (p.ir && t && t.human && activeCount(L, t.id) >= rosterLimit(L)) {
          p.inj.w = 0;
          if (p.inj.ph) delete p.inj.ph;
          if (t.id === L.userTid) PT.League.News.add(L, 'inj', p.fn + ' ' + p.ln + ' is healthy. Free a roster spot to bring him back from the Hurt List.', t.id);
          continue;
        }
        p.inj = null;
        if (p.ir) p.ir = false;
        if (p.tid >= 0) healed[p.tid] = 1;
      }
    }
    for (const tid of Object.keys(healed)) {
      const t = L.teams[+tid];
      if (!t.human) PT.League.AIGM.fitRoster(L, t.id);
      if (!t.human || L.settings.autoLineup) PT.League.Roster.autoDepth(L, t.id);
    }
  };

  /** 'Healthy' | 'Back in 3 weeks' | 'Out for the season' | 'Hurt List · 5 weeks' | 'Playing hurt' */
  Inj.label = function (p) {
    if (!p || !p.inj) return 'Healthy';
    if (p.ir && p.inj.w <= 0) return 'Cleared to return';
    if (p.inj.sev >= 4) return 'Out for the season';
    const wk = PT.Util.plural(p.inj.w, 'week');
    if (p.ph) return 'Playing hurt';
    return (p.ir ? 'Hurt List · ' : 'Back in ') + wk;
  };

  /** Can this player be put on / taken off the Hurt List? */
  Inj.canIR = function (p) { return !!p && !!p.inj && p.inj.w >= C.ROSTER.IR_MIN_WEEKS && !p.ir; };

  /**
   * Move a player on/off the Hurt List. On: needs ≥ 4 weeks out. Off: needs an open roster spot. @returns {Result}
   */
  Inj.setIR = function (L, pid, on) {
    const p = Q().player(L, pid);
    if (!p || p.tid < 0) return { ok: false, err: 'NOT_ON_TEAM', msg: 'That player is not on a team.' };
    if (on) {
      if (!Inj.canIR(p)) return { ok: false, err: 'NOT_HURT_ENOUGH', msg: 'Only players out 4+ weeks can go on the Hurt List.' };
      p.ir = true;
      if (p.ph) delete p.ph;
      if (p.inj.ph) delete p.inj.ph;
    } else {
      if (!p.ir) return { ok: true };
      const active = Q().roster(L, p.tid).filter((x) => !x.ir).length;
      const max = rosterLimit(L);
      if (active >= max) return { ok: false, err: 'ROSTER_FULL', msg: 'Make room on the roster first.' };
      if (p.inj && p.inj.w > 0) return { ok: false, err: 'STILL_HURT', msg: 'He is still hurt.' };
      p.ir = false;
      p.inj = null;
    }
    const t = L.teams[p.tid];
    const R = PT.League.Roster;
    if (!t.human || L.settings.autoLineup) R.autoDepth(L, t.id);
    else if (typeof R.repairDepth === 'function') {
      R.repairDepth(L, t.id);                                                       // QA1: drop the Hurt List player from your Lineup
      R.autoDepth(L, t.id, { onlyEmpty: true, silent: true });
    }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'roster' });
    return { ok: true };
  };

  /**
   * Play Hurt toggle (Sprain/Hurt only, your players). Mood: Wants Wins +3 when allowed, others −2. @returns {Result}
   */
  Inj.playHurt = function (L, pid, on) {
    const p = Q().player(L, pid);
    if (!p || p.tid !== L.userTid) return { ok: false, err: 'NOT_YOURS', msg: 'That player is not on your team.' };
    if (on) {
      if (!p.inj || p.inj.sev > 2 || p.ir) return { ok: false, err: 'CANT', msg: 'He is too hurt to play.' };
      if (p.ph) return { ok: true };
      p.ph = 1; p.inj.ph = 1;
      PT.League.Spirit.addMood(L, p, p.want === 'wins' ? 3 : -2, 'hurt');
    } else { if (p.ph) delete p.ph; if (p.inj && p.inj.ph) delete p.inj.ph; }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'roster' });
    return { ok: true };
  };

  /** Skill multiplier while playing hurt: Sprain 0.90, Hurt 0.85, healthy 1. */
  Inj.hurtMult = function (p) { return !p || !p.inj ? 1 : p.inj.sev <= 1 ? 0.90 : 0.85; };

  /** Can play in the next game (healthy, or allowed to play hurt; never from the Hurt List). */
  Inj.canPlay = function (p) { return !!p && !p.ir && (!p.inj || !!p.ph); };

  /**
   * Quick-sim helper (design 12.1 / App. C): pick this team's injuries for a simmed game: Poisson(0.35 × team mult),
   * starters weighted ×4, bench ×1, tier via rollTier. Pure w.r.t. L (uses the passed rng). @returns {{pid, sev}[]}
   */
  Inj.simPick = function (L, tid, rng, starters) {
    const pl = Q().roster(L, tid).filter((p) => Inj.canPlay(p));
    if (!pl.length) return [];
    const st = {};
    (starters || []).forEach((pid) => { st[pid] = 1; });
    const lambda = PT.League.K.INJ_SIM_LAMBDA * Inj.chanceMult(L, null, { team: tid });
    let n = 0, pr = Math.exp(-lambda), cum = pr;
    const u = rng.next();
    while (u > cum && n < 4) { n++; pr *= lambda / n; cum += pr; }
    const out = [];
    for (let i = 0; i < n; i++) {
      const pick = rng.weighted(pl.filter((p) => !out.some((o) => o.pid === p.id)).map((p) => [p, (st[p.id] ? 4 : 1) * Inj.chanceMult(L, p)]));
      if (pick) out.push({ pid: pick.id, sev: Inj.rollTier(rng, pick) });
    }
    return out;
  };

  /** Debug: heal a team. */
  Inj.healAll = function (L, tid) {
    for (const p of Q().roster(L, tid)) { p.inj = null; p.ir = false; if (p.ph) delete p.ph; }
    PT.League.Roster.autoDepth(L, tid);
  };
})(globalThis.PT = globalThis.PT || {});
