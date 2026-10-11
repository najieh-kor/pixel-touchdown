/* Pixel Touchdown: js/league/spirit.js
 * Owner: WP2. Responsibility: PT.League.Spirit: player Mood, Wants, Team Spirit, Captain (design 13, R8).
 * Mood (p.mor, 0..100, one decimal) changes go through Spirit.addMood so every rule applies once:
 *   Home ×0.5 losses · Chill ×0.5 all · Panda ×0.75 all · Grumpy Gus ×2 own losses · Captain Smarts ≥ 70 → teammates'
 *   losses ×0.75 (Leader: ×0.5) · Captain Hype Pup → event gains ×1.5 (Leader: ×2) · Locker Room Glue · Dog floor 25 ·
 *   Chicken ignores losses from defeats · Trade Me lock (≤ 20 after 3 ignored weeks).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const Sp = PT.ns('League.Spirit');
  const H = () => PT.League.History;
  const Q = () => PT.League.Q;

  function has(p, tr) { return p.tr.indexOf(tr) >= 0; }
  function captainOf(L, tid) { const t = L.teams[tid]; return t && t.capt != null ? Q().player(L, t.capt) : null; }
  function isStarter(t, pid) { for (const s of C.SLOTS) if (s !== 'KR' && t.dc[s] && t.dc[s][0] === pid) return true; return false; }
  Sp.isStarter = function (L, pid) { const p = Q().player(L, pid); return !!p && p.tid >= 0 && isStarter(L.teams[p.tid], pid); };

  /**
   * Change one player's Mood with all modifiers. @param {string} [why] 'loss'|'event'|'game'|'contract'|…
   * @returns {number} applied change
   */
  Sp.addMood = function (L, p, n, why) {
    if (!p || !n) return 0;
    let v = n;
    const capt = p.tid >= 0 ? captainOf(L, p.tid) : null;
    const lead = capt && has(capt, 'leader');
    if (v < 0) {
      if (why === 'loss' && p.sp === 'chicken') return 0;
      if (p.want === 'home') v *= 0.5;
      if (has(p, 'grumpy_gus')) v *= 2;
      if (capt && capt.id !== p.id && capt.r.smt >= 70) v *= lead ? 0.5 : 0.75;
      if (p.tid === L.userTid) v *= PT.League.Coach.mods(L).moodLoss;
    } else if (why === 'event' && capt && has(capt, 'hype_pup')) {
      v *= lead ? 2 : 1.5;
    }
    if (p.want === 'chill') v *= 0.5;
    if (p.sp === 'panda') v *= 0.75;
    const before = p.mor;
    let m = Math.max(0, Math.min(100, Math.round((p.mor + v) * 10) / 10));
    if (p.sp === 'dog') m = Math.max(25, m);
    const ss = L.ss;
    if (ss && ss.tm && ss.tm[p.id] >= 3) m = Math.min(20, m);
    p.mor = m;
    return p.mor - before;
  };

  /** Team Mood: every rostered player. */
  Sp.teamMood = function (L, tid, n, why) {
    for (const p of Q().roster(L, tid)) Sp.addMood(L, p, n, why);
  };

  /** Team Spirit 0..100. */
  Sp.addSpirit = function (L, tid, n) {
    const t = L.teams[tid];
    t.spirit = Math.max(0, Math.min(100, Math.round(t.spirit + n)));
    return t.spirit;
  };

  /** Face word for a mood value. */
  Sp.face = function (mor) {
    const T = (PT.Data.Text && PT.Data.Text.mood) || [[80, 'Happy'], [50, 'Okay'], [30, 'Meh'], [0, 'Grumpy']];
    for (const r of T) if (mor >= r[0]) return r[1];
    return 'Grumpy';
  };
  /** Spirit label (In Sync / Good / Okay / Out of Sync). */
  Sp.label = function (v) {
    const T = (PT.Data.Text && PT.Data.Text.spirit) || [[75, 'In Sync'], [50, 'Good'], [26, 'Okay'], [0, 'Out of Sync']];
    for (const r of T) if (v >= r[0]) return r[1];
    return 'Out of Sync';
  };
  /** In-game skill change from Mood: Happy +2 · Grumpy −3. */
  Sp.moodSkill = function (p) { return p.mor >= 80 ? 2 : p.mor < 30 ? -3 : 0; };

  /** Spirit effects for games (design 13.3). */
  Sp.effects = function (L, tid) {
    const v = L.teams[tid].spirit;
    if (v >= 75) return { smt: 2, recvReact: -0.05, penMult: 1, label: 'In Sync' };
    if (v <= 25) return { smt: -2, recvReact: 0, penMult: 1.25, label: 'Out of Sync' };
    return { smt: 0, recvReact: 0, penMult: 1, label: Sp.label(v) };
  };

  /** Default Captain: the highest-Smarts starter with Mood ≥ 50 (AI: highest-Smarts starter). */
  Sp.autoCaptain = function (L, tid) {
    const t = L.teams[tid];
    const st = Q().roster(L, tid).filter((p) => isStarter(t, p.id));
    const pool = t.human ? st.filter((p) => p.mor >= 50) : st;
    const best = (pool.length ? pool : st).sort((a, b) => (b.r.smt - a.r.smt) || (a.id - b.id))[0];
    t.capt = best ? best.id : null;
    return t.capt;
  };

  /**
   * Name a Captain (Team › Lineup). New Captain Mood +8, old −8; mid-season change costs Spirit −5. @returns {Result}
   */
  Sp.setCaptain = function (L, tid, pid) {
    const t = L.teams[tid];
    if (t.roster.indexOf(pid) < 0) return { ok: false, err: 'NOT_ON_TEAM', msg: 'That player is not on your team.' };
    if (t.capt === pid) return { ok: true };
    const old = t.capt != null ? Q().player(L, t.capt) : null;
    t.capt = pid;
    if (old) Sp.addMood(L, old, -8, 'captain');
    Sp.addMood(L, Q().player(L, pid), 8, 'captain');
    if (old && (L.phase === 'REGULAR' || L.phase === 'PLAYOFFS')) Sp.addSpirit(L, tid, -5);
    if (PT.Events) PT.Events.emit('league:changed', { what: 'captain' });
    return { ok: true };
  };

  /** Start of season: Spirit = 40 + 3 × returning starters (max 14), capped at 85 (design 13.3). */
  Sp.seasonStart = function (L, tid) {
    const t = L.teams[tid];
    let ret = 0;
    for (const s of C.SLOTS) {
      if (s === 'KR' || !t.dc[s] || t.dc[s][0] == null) continue;
      const p = Q().player(L, t.dc[s][0]);
      if (p && (p.cs.some((c) => c.s === L.season - 1 && c.t === tid) || (p.st && p.st.gp && p.tid === tid))) ret++;
    }
    t.spirit = Math.min(85, 40 + 3 * Math.min(14, ret));
    if (t.capt == null || t.roster.indexOf(t.capt) < 0) Sp.autoCaptain(L, tid);
    return t.spirit;
  };

  /**
   * Weekly Mood/Spirit upkeep for every team (called from Progression.weekly):
   * drift 2 toward 60 (+5 per Hype Pup, −3 per Grumpy Gus, staff 'mood' quirk +1), Money/Fame wants, captain Spirit,
   * Trade Me cards for the user team (Mood < 15 → 25% per week).
   */
  Sp.weekly = function (L) {
    if (!H().once(L, 'spirit')) return;
    const ss = H().ss(L);
    for (const t of L.teams) {
      const pl = Q().roster(L, t.id);
      let target = 60;
      for (const p of pl) { if (has(p, 'hype_pup')) target += 5; if (has(p, 'grumpy_gus')) target -= 3; }
      if (PT.League.Staff.quirks(L, t.id).mood) target += 1;
      target = Math.max(20, Math.min(95, target));
      for (const p of pl) {
        // drift (not a "Mood change": no multipliers)
        if (p.mor < target) p.mor = Math.min(target, p.mor + 2); else if (p.mor > target) p.mor = Math.max(target, p.mor - 2);
        if (p.want === 'money' && p.con && p.con.sal < 0.8 * PT.League.Cap.fairPay(L, p)) Sp.addMood(L, p, -3, 'wants');
        if (p.want === 'fame' && !isStarter(t, p.id) && !p.inj && L.phase === 'REGULAR') Sp.addMood(L, p, -3, 'wants');
        if (ss.tm[p.id] >= 3) p.mor = Math.min(20, p.mor);
      }
      const capt = captainOf(L, t.id);
      if (capt) {
        const dbl = has(capt, 'leader') ? 2 : 1;
        if (capt.mor >= 60) Sp.addSpirit(L, t.id, 1 * dbl);
        else if (capt.mor < 30) Sp.addSpirit(L, t.id, -2 * dbl);
      } else Sp.autoCaptain(L, t.id);
    }
    // Trade Me! cards (user team, design 13.1)
    if (L.phase === 'REGULAR') {
      const r = PT.RNG.create(PT.RNG.hash(L.seed, L.season, L.week, 'tm'));
      for (const p of Q().roster(L, L.userTid)) {
        if (p.mor < 15) {
          const open = L.ev.pending.some((e) => e.def === 'trade_me' && e.pid === p.id);
          if (ss.tm[p.id] != null && !open) ss.tm[p.id]++;
          if (!open && r.chance(0.25)) {
            if (ss.tm[p.id] == null) ss.tm[p.id] = 0;
            PT.League.WeeklyEvents.push(L, 'trade_me', p.id, {});
          }
        } else if (ss.tm[p.id] != null && ss.tm[p.id] < 3) delete ss.tm[p.id];
      }
    }
  };

  /**
   * Post-game Mood + Spirit for both teams (design 13.1–13.3): win +2 / loss −1 (Wants Wins ×2), Player of the Game +3,
   * benched OVR ≥ 70 −1, Fame +3 after 100+ yd / TD / sack / pick, Spirit win +2 / loss −1, Lion Roar +1 per sack (max 3).
   */
  Sp.onGame = function (L, box) {
    [box.h, box.a].forEach((tid) => {
      const t = L.teams[tid];
      const us = tid === box.h ? box.hs : box.as, them = tid === box.h ? box.as : box.hs;
      const win = us > them, loss = us < them;
      if (win) Sp.addSpirit(L, tid, 2); else if (loss) Sp.addSpirit(L, tid, -1);
      let roar = 0;
      for (const p of Q().roster(L, tid)) {
        const ln = box.pl ? box.pl[p.id] : null;
        if (win) Sp.addMood(L, p, p.want === 'wins' ? 4 : 2, 'win');
        else if (loss) Sp.addMood(L, p, p.want === 'wins' ? -2 : -1, 'loss');
        if (box.pog === p.id) Sp.addMood(L, p, 3, 'game');
        if (!ln || !ln.gs) { if (p.ovr >= 70 && !p.inj && !p.ir) Sp.addMood(L, p, -1, 'bench'); }
        if (ln && p.want === 'fame' && ((ln.py || 0) >= 100 || (ln.ry || 0) >= 100 || (ln.rcy || 0) >= 100 ||
          (ln.ptd || 0) + (ln.rtd || 0) + (ln.rctd || 0) + (ln.dtd || 0) > 0 || (ln.dsk || 0) > 0 || (ln.int || 0) > 0)) Sp.addMood(L, p, 3, 'game');
        if (ln && p.sp === 'lion' && ln.dsk) roar += ln.dsk;
      }
      if (roar) Sp.addSpirit(L, tid, Math.min(3, Math.floor(roar)));
      if (t.capt != null && t.roster.indexOf(t.capt) < 0) Sp.autoCaptain(L, tid);
    });
  };

  /**
   * Franchise-side per-player skill changes for this team's next game, for WP1 Games.config / StatSim to apply
   * (engine-applied items like coach stars, home field, weather, twists are NOT included):
   * Mood (+2/−3), Spirit Smarts (±2), next-game event effects (incl. Q1-only), QB Whisperer, play-hurt multipliers.
   * @returns {{all:Object<pid,number>, sk:Object<pid,Object<skill,number>>, q1:number, mult:Object<pid,number>,
   *            bench:number[], edge:number, oppEdge:Object|null, snowImm:boolean, injMult:number, spirit:Object}}
   */
  Sp.gameMods = function (L, tid) {
    const t = L.teams[tid];
    const out = { all: {}, sk: {}, q1: 0, mult: {}, bench: [], edge: 0, oppEdge: null, snowImm: false, injMult: 1, spirit: Sp.effects(L, tid) };
    const nx = tid === L.userTid ? (H().ss(L).nx || {}) : {};
    const addAll = (pid, n) => { out.all[pid] = (out.all[pid] || 0) + n; };
    const addSk = (pid, k, n) => { (out.sk[pid] = out.sk[pid] || {})[k] = (out.sk[pid][k] || 0) + n; };
    for (const p of Q().roster(L, tid)) {
      const m = Sp.moodSkill(p);
      if (m) addAll(p.id, m);
      if (out.spirit.smt) addSk(p.id, 'smt', out.spirit.smt);
      if (p.ph && p.inj) out.mult[p.id] = PT.League.Injuries.hurtMult(p);
      if (nx.all) addAll(p.id, nx.all);
    }
    for (const pid of Object.keys(nx.p || {})) {
      const e = nx.p[pid];
      for (const k of Object.keys(e)) { if (k === 'g') continue; if (k === 'all') addAll(+pid, e[k]); else addSk(+pid, k, e[k]); }
    }
    if (tid === L.userTid) {
      const qa = PT.League.Coach.mods(L).qbAim;
      const qb = t.dc.QB && t.dc.QB[0];
      if (qa && qb != null) addSk(qb, 'aim', qa);
      out.q1 = nx.q1 || 0;
      out.bench = (nx.bench || []).slice();
      out.edge = nx.edge || 0;
      out.oppEdge = nx.oppEdge || null;
      out.snowImm = !!nx.snowImm;
      out.injMult = PT.League.Injuries.chanceMult(L, null, { team: tid });
    }
    return out;
  };
})(globalThis.PT = globalThis.PT || {});
