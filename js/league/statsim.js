/* Pixel Touchdown: js/league/statsim.js
 * Owner: WP1. Responsibility: PT.League.StatSim: fast statistical game sim → BoxScore.
 *
 * Model (GAME_DESIGN Appendix C): team unit ratings from starters' slot OVR (+ weather, coach stars, playoff/close-game
 * traits, quick-sim user bonus; Mood/Spirit/difficulty are already baked into GameTeam.r by Games.config).
 * Each team gets randInt(10,12) alternating possessions. Per possession:
 *   d = SIM_D_SCALE × (Off − Def) + home + − 3 × styleMatchup
 *   P(TD) = clamp(0.22 + 0.012 d, .06, .50) · P(FG try) = clamp(0.16 + 0.004 d, .08, .25) · P(lost ball) = clamp(0.11 − 0.003 d,
 *   .04, .20) · else punt. Late game: trailing by > 3 in a team's last 2 possessions turns FG tries into 4th-down tries.
 *   AI 2-pt rule (8.7) in the last 3 possessions of Q4. Overtime per Appendix C (regular season 10% tie).
 * Each possession is then played out as a down-and-distance play sequence that reaches the chosen outcome, so every
 * box stat is consistent: team py = Σ player py − sack yards, pass TDs = receiving TDs, score = Σ periods.
 * Four quarters of cfg.qLen (default 180 s): box.q[t][0..3] = quarters, OT at index 4; scoring-summary q = 1–4, 5 = OT.
 * Per-possession odds are scaled up (PT.League.K.SIM_P_*) so ~5–6 drives per team score ~16–20 points, like a played game.
 * Pure: never touches L. Deterministic per cfg.seed (and `from`).
 */
(function (PT) {
  'use strict';
  const C = PT.C;
  const StatSim = PT.ns('League.StatSim');

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const K = () => PT.League.K;
  const B = () => PT.Box;

  const DEF_SLOTS = C.DEF_SLOTS;
  const TACKLE_W = { DL: 30, LB: 40, CB: 18, S: 12 };
  const INT_W = { CB: 45, S: 35, LB: 20 };
  const PD_W = { CB: 50, S: 25, LB: 25 };
  const TARGET_W = { WR1: 32, WR2: 28, TE: 22, RB: 18 };
  const CATCH_MEAN = { WR1: 15, WR2: 15, TE: 12, RB: 8 };
  const INJ_SEV = [[1, 50], [2, 28], [3, 15], [4, 6], [5, 1]];

  function poisson(rng, mean) {
    if (mean <= 0) return 0;
    const lim = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= rng.next(); } while (p > lim && k < 50);
    return k - 1;
  }

  /** trait/quirk sim modifiers of a GameTeam player */
  function simMods(pl) {
    const out = [];
    (pl.tr || []).forEach((id) => { const t = PT.Data.Traits.byId(id); if (t && t.sim) out.push(t.sim); });
    const q = PT.Data.Species.byId(pl.sp).quirk;
    if (q && q.sim) out.push(q.sim);
    return out;
  }
  function modSum(mods, key) { let s = 0; mods.forEach((m) => { if (m[key] != null) s += m[key]; }); return s; }
  function modMul(mods, key) { let s = 1; mods.forEach((m) => { if (m[key] != null) s *= m[key]; }); return s; }

  /** weather-adjusted skills (design 14.1), species immunities */
  function weatherSkills(r, sp, wx) {
    const out = Object.assign({}, r);
    const S = PT.Data.Species;
    if (wx === 'rain' && !S.immune(sp, 'rain')) out.spd = r.spd * 0.97;
    if (wx === 'snow' && !S.immune(sp, 'snow')) {
      out.spd = r.spd * 0.92;
      if (!S.immune(sp, 'snowMov')) out.mov = r.mov - 8;
    }
    return out;
  }

  /**
   * Build one side's model.
   * @param {GameConfig} cfg @param {GameTeam} gt @param {number} bonus all-skill bonus (quick-sim user bonus)
   */
  function side(cfg, gt, bonus, fx) {
    const R = PT.League.Ratings;
    const byId = {};
    gt.pl.forEach((p) => { byId[p.pid] = p; });
    const wx0 = cfg.weather ? cfg.weather.k : 'clear';
    const wx = wx0 === 'snow' && gt.snowImm ? 'clear' : wx0;   // event: heaters (no Snow penalty)
    const off = (gt.coach ? gt.coach.off : 1) - 1, def = (gt.coach ? gt.coach.def : 1) - 1;
    const speedy = fx.spd || 0;
    const po = cfg.po > 0;
    const S = { gt: gt, tid: gt.tid, byId: byId, slot: {}, so: {}, soClose: {}, sr: {}, mods: {} };
    const stars = {};
    (Array.isArray(gt.stars) ? gt.stars : []).forEach((pid) => { stars[pid] = true; });
    const slotPlayer = (slot) => byId[(gt.dc[slot] || [])[0]] || gt.pl[0];
    C.SLOTS.forEach((slot) => {
      const p = slotPlayer(slot);
      S.slot[slot] = p;
      if (slot === 'KR') return;
      const mods = simMods(p);
      S.mods[slot] = mods;
      const side = C.OFF_SLOTS.indexOf(slot) >= 0 || slot === 'K' ? off : def;
      const add = bonus + side + (po ? modSum(mods, 'po') : 0);
      const r0 = weatherSkills(p.r, p.sp, wx);
      const r = {};
      for (const k of C.RATINGS) r[k] = r0[k] + add + (k === 'spd' ? speedy : 0);
      // Star players: +5 to their position's main skills (ROUND6 A, same as the engine's passive)
      if (stars[p.pid]) (R.MAIN[p.pos] || []).forEach((k) => { r[k] += R.STAR_BONUS; });
      const pos = C.SLOT_POS[slot];
      const pen = R.isNatural(p, pos) ? 0 : C.OUT_OF_POS_PENALTY;
      S.sr[slot] = r;
      S.so[slot] = R.ovrRaw(r, pos) - pen + modSum(mods, 'ovr');
      S.soClose[slot] = S.so[slot] + modSum(mods, 'close');
    });
    S.u = R.unitsFrom(S.so, S.sr);
    S.uClose = R.unitsFrom(S.soClose, S.sr);
    S.rs = PT.League.Games.runShare(gt.tend ? gt.tend.off : 'west');
    S.offStyle = gt.tend ? gt.tend.off : 'west';
    S.defStyle = gt.tend ? gt.tend.def : 'think';
    const qb = S.slot.QB;
    const qbMods = S.mods.QB;
    // offense trait aggregates
    S.qbRunShare = clamp((S.offStyle === 'trick' || S.sr.QB.spd >= 75 ? 0.30 : 0.15) * modMul(qbMods, 'qbRun'), 0, 0.45);
    S.compAdd = modSum(qbMods, 'comp');
    S.sackVs = modMul(qbMods, 'sackVs') * modMul(S.mods.OL1, 'sackVs') * modMul(S.mods.OL2, 'sackVs') * modMul(S.mods.TE, 'sackVs');
    S.ypcAdd = (modSum(S.mods.RB, 'ypc') + modSum(S.mods.OL1, 'ypc') + modSum(S.mods.OL2, 'ypc') + modSum(S.mods.TE, 'ypc') * 0.5);
    S.big = modMul(S.mods.RB, 'big') * modMul(qbMods, 'big');
    S.targets = ['WR1', 'WR2', 'TE', 'RB'].map((slot) => ({ slot: slot, p: S.slot[slot],
      w: TARGET_W[slot] * modMul(S.mods[slot], 'catchW'), comp: modSum(S.mods[slot], 'comp'), big: modMul(S.mods[slot], 'big'),
      fum: modMul(S.mods[slot], 'fum') }));
    S.qb = qb;
    S.qbFum = modMul(qbMods, 'fum');
    S.rb1 = S.slot.RB;
    const rb2id = (gt.dc.RB || [])[1];
    S.rb2 = rb2id != null && byId[rb2id] && byId[rb2id].pid !== qb.pid ? byId[rb2id] : null;
    S.rbFum = modMul(S.mods.RB, 'fum');
    // defense aggregates
    S.def = DEF_SLOTS.map((slot) => ({ slot: slot, grp: C.SLOT_POS[slot], p: S.slot[slot], r: S.sr[slot], mods: S.mods[slot] }));
    S.sackMul = S.def.reduce((m, d) => m * modMul(d.mods, 'sack'), 1);
    S.ypcVs = S.def.reduce((s, d) => s + modSum(d.mods, 'ypcVs'), 0);
    S.compVs = S.def.reduce((s, d) => s + modSum(d.mods, 'compVs'), 0);
    S.k = S.slot.K;
    S.kick = S.sr.K.kck;
    S.kickAdd = modSum(S.mods.K, 'kick');
    S.puntAdd = modSum(S.mods.K, 'punt');
    S.kr = S.slot.KR;
    // penalties weight: flag magnets among starters, low Team Spirit
    const starters = C.SLOTS.filter((s) => s !== 'KR').map((s) => S.mods[s]);
    S.penMul = starters.reduce((s, m) => s + modMul(m, 'pen'), 0) / starters.length * ((gt.spirit != null && gt.spirit <= 25) ? 1.25 : 1);
    return S;
  }

  function pickW(rng, items, wf) { return rng.weighted(items.map((x) => [x, Math.max(0.0001, wf(x))])); }

  /** defender for a tackle (design: DL 30%, LB 40%, CB 18%, S 12%; by TKL within group) */
  function tackler(rng, D, exclude) {
    const grp = rng.weighted(Object.keys(TACKLE_W).map((g) => [g, TACKLE_W[g]]));
    const pool = D.def.filter((d) => d.grp === grp && d.p.pid !== exclude);
    return pickW(rng, pool.length ? pool : D.def, (d) => d.r.tkl).p;
  }
  function groupPick(rng, D, W, wf) {
    const grp = rng.weighted(Object.keys(W).map((g) => [g, W[g]]));
    const pool = D.def.filter((d) => d.grp === grp);
    return pickW(rng, pool.length ? pool : D.def, wf).p;
  }

  /**
   * Simulate a game. @param {GameConfig} cfg
   * @param {{from?:PartialState, bonus?:{tid:number,n:number}}} [opts]
   *   from = { q, clk, hs, as, poss:'h'|'a', y, dir, down, togo, box? } (engine partial state, field space y/dir)
   * @returns {BoxScore}
   */
  StatSim.sim = function (cfg, opts) {
    opts = opts || {};
    const from = opts.from || null;
    const rng = PT.RNG.create(from ? PT.RNG.hash(cfg.seed, 'rest', from.q, from.clk, from.hs, from.as, from.y) : cfg.seed);
    const k = K();
    const Bx = B();
    const fx = PT.League.Games.twistFx(cfg.twist);
    const bonusOf = (tid) => (opts.bonus && opts.bonus.tid === tid ? opts.bonus.n : 0);
    const H = side(cfg, cfg.home, bonusOf(cfg.home.tid), fx);
    const A = side(cfg, cfg.away, bonusOf(cfg.away.tid), fx);
    const home = cfg.home.tid, away = cfg.away.tid;
    const qLen = cfg.qLen || C.QUARTER_SEC;
    const G = 4 * qLen;                                         // four quarters
    const wx = cfg.weather || { k: 'clear', mph: 0 };
    const mph = wx.mph || 0;

    let box;
    if (from && from.box) box = PT.Util.deepClone(from.box);
    else {
      box = Bx.create({ gid: cfg.gid, s: cfg.season, wk: cfg.week, po: cfg.po, h: home, a: away, sim: true });
      if (from) {                                               // score so far without a box: book it in Q1
        if (from.hs) box.q[0][0] += from.hs;
        if (from.as) box.q[1][0] += from.as;
        box.hs = from.hs || 0; box.as = from.as || 0;
      }
    }
    box.sim = true;
    if (box.c) throw new Error('[StatSim] cannot continue a compact box');

    // everyone dressed in the lineup played; starters started
    [H, A].forEach((S) => {
      C.SLOTS.forEach((slot) => (S.gt.dc[slot] || []).forEach((pid, i) => {
        if (!S.byId[pid]) return;
        if (i === 0 && slot !== 'KR') Bx.markPlayed(box, pid, S.tid, true);
        else if (!box.pl[pid]) Bx.markPlayed(box, pid, S.tid, false);
      }));
    });

    const score = { [home]: box.hs, [away]: box.as };
    const plays = { [home]: 0, [away]: 0 };

    // ---- d per offense ----
    const homeAdv = cfg.neutral ? 0 : k.SIM_HOME + ((cfg.home.hype || 0) >= 80 ? k.SIM_HOME_HYPE : 0) + ((cfg.home.std || 1) >= 5 ? k.SIM_HOME_STAD5 : 0);
    function dOf(O, D, close) {
      const uo = close ? O.uClose : O.u, ud = close ? D.uClose : D.u;
      const rs = O.rs;
      const off = rs * uo.run + (1 - rs) * uo.pass;
      const def = rs * ud.runD + (1 - rs) * ud.passD;
      const sm = (PT.League.Games.STYLE_MATCHUP[D.defStyle] || {})[O.offStyle] || 0;
      // next-game event edges (user team): own edge helps its offense (Sim Drive scale: 2 × Edge); oppEdge hurts it
      const ev = 2 * (O.gt.edge || 0) - (O.gt.oppEdge ? 0.6 : 0);
      return k.SIM_D_SCALE * (off - def) + (O === H ? homeAdv : 0) - k.SIM_STYLE * sm + ev;
    }
    const dFull = { [home]: dOf(H, A, false), [away]: dOf(A, H, false) };

    // ---- per-play helpers (O offense, D defense) ----
    function ypcFor(O, D) {
      const base = k.SIM_YPC + k.SIM_YPC_SLOPE * k.SIM_D_SCALE * 2 * (O.u.run - D.u.runD) + O.ypcAdd + D.ypcVs + (fx.shedTime ? 0.3 : 0);
      return clamp(base, 2.8, 6.2);
    }
    function compFor(O, D) {
      let c = clamp(0.62 + (O.sr.QB.aim - 70) * 0.004, 0.45, 0.78) + k.SIM_COMP_ADJ;
      c += 0.003 * k.SIM_D_SCALE * 2 * (O.u.pass - D.u.passD) + O.compAdd + D.compVs;
      if (wx.k === 'rain' || wx.k === 'snow') c -= 0.03;
      if (wx.k === 'fog' && !PT.Data.Species.immune(O.qb.sp, 'fog')) c -= 0.02;
      c -= mph * 0.001;
      if (fx.catchBonus) c += fx.catchBonus;
      return clamp(c, 0.40, 0.80);
    }
    function sackRateFor(O, D) {
      const rushV = D.u.rush, blockV = O.u.block;
      const mean = Math.max(0.4, k.SIM_SACKS + (rushV - blockV) * k.SIM_SACK_SLOPE);
      return clamp(mean / 34 * D.sackMul * O.sackVs, 0.015, 0.16);
    }
    function runGain(O, D, ypc) {
      const pBig = 0.015 * O.big;
      const u = rng.next();
      if (u < 0.10) return -rng.int(1, 3);
      if (u < 0.10 + pBig) return rng.int(20, 60);
      const m = Math.max(1, (ypc + 0.2 - pBig * 40) / (0.9 - pBig));
      return Math.round(-Math.log(1 - rng.next()) * m);
    }
    function catchGain(t) {
      const m = CATCH_MEAN[t.slot] * (t.big || 1);
      const g = Math.round(m * Math.exp(rng.normal(-0.245, 0.7)));
      return t.slot === 'RB' ? Math.max(-2, g - 2) : Math.max(0, g);
    }
    function nameOf(p) { return p.n; }

    // ---- one drive ----
    /**
     * @param O offense side @param D defense side @param start yard line 0..100 from own goal
     * @param {string} outcome 'TD'|'FG'|'TO'|'PUNT'|'DOWNS'  @param st {down,togo} optional  @param endAt target yard line
     * @returns {{end:number, kind:string, scorer?, tdText?, retY?:number, plays:number}}
     */
    function drive(O, D, start, outcome, st, endAt) {
      const ot = O.tid, dt = D.tid;
      const ypc = ypcFor(O, D), comp = compFor(O, D), sackP = sackRateFor(O, D);
      const rsD = clamp(O.rs + rng.range(-0.1, 0.1), 0.05, 0.9);
      let y = start, down = (st && st.down) || 1, togo = (st && st.togo) || Math.min(10, 100 - start);
      let n = 0;
      let E = endAt;
      if (E == null) {
        if (outcome === 'TD') E = 100;
        else if (outcome === 'FG') E = Math.min(97, Math.max(start + rng.int(0, 8), rng.int(58, 82)));
        else if (outcome === 'PUNT') E = Math.min(70, start + rng.int(5, 28));
        else E = Math.min(95, start + rng.int(0, 40));            // TO / DOWNS
      }
      let tdText = null;

      const firstDown = () => { Bx.team(box, ot, 'fd', 1); down = 1; togo = Math.min(10, 100 - y); };
      const run = (forceGain, mode) => {
        // carrier
        const u = rng.next();
        const carrier = u < O.qbRunShare ? O.qb : (O.rb2 && rng.chance(0.12) ? O.rb2 : O.rb1);
        let g = forceGain != null ? forceGain : runGain(O, D, ypc);
        if (mode === 'stall') g = Math.min(g, Math.max(-2, togo - 1));
        if (mode === 'adv' && outcome !== 'TD' && y + g > E + 3) g = Math.max(togo <= E + 3 - y ? 0 : g, E + rng.int(0, 3) - y);
        if (outcome !== 'TD' && y + g >= 99) g = Math.max(0, 98 - y - rng.int(0, 3));
        if (outcome === 'TD' && y + g >= 100) g = 100 - y;
        Bx.add(box, carrier.pid, ot, 'ra', 1);
        Bx.add(box, carrier.pid, ot, 'ry', g);
        Bx.team(box, ot, 'ry', g);
        if (g > 0) Bx.add(box, carrier.pid, ot, 'rlg', g);
        y += g; n++;
        if (y >= 100) { Bx.add(box, carrier.pid, ot, 'rtd', 1); tdText = nameOf(carrier) + ' ' + g + ' yd run'; return { g: g, td: true, carrier: carrier }; }
        Bx.add(box, tackler(rng, D).pid, dt, 'tk', 1);
        return { g: g, td: false, carrier: carrier };
      };
      const pickTarget = () => pickW(rng, O.targets, (t) => t.w);
      const pass = (mode, force) => {
        // sack?
        if (!force && rng.chance(sackP) && y > 3) {
          const loss = Math.min(y - 1, rng.int(3, 9));
          const sacker = groupPick(rng, D, { DL: 70, LB: 30 }, (d) => PT.League.Ratings.rush(d.r));
          Bx.add(box, O.qb.pid, ot, 'psk', 1);
          Bx.add(box, sacker.pid, dt, 'dsk', 1);
          Bx.add(box, sacker.pid, dt, 'tk', 1);
          Bx.team(box, ot, 'py', -loss);
          y -= loss; n++;
          return { g: -loss, sack: true };
        }
        const t = pickTarget();
        Bx.add(box, O.qb.pid, ot, 'pa', 1);
        Bx.add(box, t.p.pid, ot, 'tg', 1);
        n++;
        const c = clamp(comp + t.comp, 0.3, 0.9);
        if (!force && !rng.chance(c)) {
          if (rng.chance(0.35)) Bx.add(box, groupPick(rng, D, PD_W, (d) => d.r.cov).pid, dt, 'pd', 1);
          return { g: 0, inc: true };
        }
        let g = force != null ? force : catchGain(t);
        if (mode === 'stall') g = Math.min(g, Math.max(0, togo - 1));
        if (mode === 'adv' && outcome !== 'TD' && y + g > E + 3) g = Math.max(0, E + rng.int(0, 3) - y);
        if (outcome !== 'TD' && y + g >= 99) g = Math.max(0, 98 - y - rng.int(0, 3));
        if (outcome === 'TD' && y + g >= 100) g = 100 - y;
        Bx.add(box, O.qb.pid, ot, 'pc', 1);
        Bx.add(box, O.qb.pid, ot, 'py', g);
        Bx.add(box, t.p.pid, ot, 'rc', 1);
        Bx.add(box, t.p.pid, ot, 'rcy', g);
        if (g > 0) Bx.add(box, t.p.pid, ot, 'rclg', g);
        Bx.team(box, ot, 'py', g);
        y += g;
        if (y >= 100) {
          Bx.add(box, O.qb.pid, ot, 'ptd', 1);
          Bx.add(box, t.p.pid, ot, 'rctd', 1);
          tdText = nameOf(t.p) + ' ' + g + ' yd pass from ' + nameOf(O.qb);
          return { g: g, td: true, rec: t.p };
        }
        Bx.add(box, tackler(rng, D).pid, dt, 'tk', 1);
        return { g: g, rec: t.p };
      };
      const choosePass = () => (down >= 3 && togo >= 7 ? rng.chance(0.85) : togo <= 2 ? rng.chance(0.3) : togo <= 4 && down >= 2 ? rng.chance(0.45) : !rng.chance(rsD));

      // advance phase
      let guard = 60;
      while (guard-- > 0) {
        if (outcome === 'TD' ? y >= 100 : y >= E) break;
        const third = down >= 3;
        if (third) Bx.team(box, ot, 'd3a', 1);
        let res;
        if (third) {
          // must convert to keep the drive alive (the outcome is already decided)
          const need = Math.min(togo, 100 - y);
          if (choosePass()) res = pass('adv', Math.max(need, catchGain(pickTarget())));
          else res = run(Math.max(need, Math.min(need + rng.int(0, 4), runGain(O, D, ypc))), 'adv');
        } else res = choosePass() ? pass('adv') : run(null, 'adv');
        if (res.td) { if (third) Bx.team(box, ot, 'd3c', 1); if (res.g >= togo) Bx.team(box, ot, 'fd', 1); break; }
        if (res.g >= togo) { if (third) Bx.team(box, ot, 'd3c', 1); firstDown(); }
        else { togo -= res.g; down++; if (down > 4) { down = 4; } }
      }
      plays[ot] += n;
      if (outcome === 'TD') return { end: 100, kind: 'TD', txt: tdText || 'Touchdown', plays: n };

      if (outcome === 'TO') {
        Bx.team(box, ot, 'to', 1);
        const fumbleP = 0.4 * (wx.k === 'rain' ? 1.4 : wx.k === 'snow' ? 1.2 : 1) * (fx.fumbleMult || 1);
        if (rng.chance(clamp(fumbleP, 0.2, 0.7))) {
          // fumble on a run or after a catch
          let who, g;
          if (rng.chance(O.rs + 0.1)) { const r = run(rng.int(0, 5), 'stall'); who = r.carrier; g = r.g; }
          else { const r = pass('stall', rng.int(2, 9)); who = r.rec || O.rb1; g = r.g; }
          plays[ot] += 1;
          Bx.add(box, who.pid, ot, 'fum', 1);
          Bx.add(box, who.pid, ot, 'fl', 1);
          const ff = pickW(rng, D.def, (d) => d.r.tkl * modMul(d.mods, 'ff'));
          Bx.add(box, ff.p.pid, dt, 'ff', 1);
          Bx.add(box, rng.chance(0.6) ? ff.p.pid : pickW(rng, D.def, () => 1).p.pid, dt, 'fr', 1);
          return { end: clamp(y, 1, 99), kind: 'FUM', plays: n + 1 };
        }
        const t = pickTarget();
        Bx.add(box, O.qb.pid, ot, 'pa', 1);
        Bx.add(box, O.qb.pid, ot, 'pi', 1);
        Bx.add(box, t.p.pid, ot, 'tg', 1);
        const pick = groupPick(rng, D, INT_W, (d) => d.r.hnd * modMul(d.mods, 'int'));
        Bx.add(box, pick.pid, dt, 'int', 1);
        Bx.add(box, pick.pid, dt, 'pd', 1);
        plays[ot] += 1;
        const air = rng.int(5, 25);
        return { end: clamp(y + air, 1, 99), kind: 'INT', ret: rng.int(0, 20), plays: n + 1 };
      }
      // stall: fail the rest of the series
      let g2 = 8;
      while (down <= 3 && g2-- > 0) {
        if (down === 3) Bx.team(box, ot, 'd3a', 1);
        const res = (down === 3 && togo >= 4) || (down < 3 && !rng.chance(rsD + 0.1)) ? pass('stall') : run(null, 'stall');
        plays[ot] += 1;
        togo -= res.g; down++;
        if (y >= 99) { y = 98; }
      }
      y = clamp(y, 1, 99);
      return { end: y, kind: outcome, plays: n };
    }

    // ---- kicks ----
    function kickoff(R, KT) {
      // R receives, KT kicks (design 8.4)
      const dist = 60 + KT.kick * 0.1 + rng.normal(0, 4);
      const land = 35 + dist;
      if (land >= 100 && rng.chance(0.75)) return 25;
      const ret = Math.max(5, Math.round(rng.normal(22, 7) + (R.kr.r.spd + R.kr.r.mov - 140) * 0.15));
      Bx.add(box, R.kr.pid, R.tid, 'kr', 1);
      Bx.add(box, R.kr.pid, R.tid, 'kry', ret);
      return clamp(Math.max(0, Math.round(100 - land)) + ret, 1, 60);
    }
    function fgMake(O, dist) {
      let p = clamp(0.70 + (O.kick - 70) * 0.008, 0.40, 0.95) - (dist - 40) * 0.008 + O.kickAdd - mph * 0.003;
      if (wx.k === 'rain' || wx.k === 'snow') p *= 0.97;
      return clamp(p, 0.15, 0.98);
    }
    function xpMake(O) {
      const dist = fx.xpFrom ? fx.xpFrom + 18 : 33;
      let p = 0.99 - Math.max(0, dist - 25) * (0.008 + (90 - O.kick) * 0.0003) - mph * 0.003;
      if ((O.k.tr || []).indexOf('wild_leg') >= 0) p -= 0.08;
      if (wx.k === 'rain' || wx.k === 'snow') p *= 0.97;
      return clamp(p, 0.05, 0.99);
    }

    // ---- possessions ----
    const n = rng.int(k.SIM_POSS[0], k.SIM_POSS[1]);
    let t0 = 0, total = 2 * n - (rng.chance(0.5) ? 1 : 0), first, startY = null, firstState = null;
    let firstRecv = rng.chance(0.5) ? H : A;
    if (from) {
      const q = from.q || 1;
      t0 = q > 4 ? G : (q - 1) * qLen + (qLen - clamp(from.clk == null ? qLen : from.clk, 0, qLen));   // q = quarter (5+ = OT)
      total = t0 >= G ? 0 : Math.max(1, Math.round(2 * n * (G - t0) / G));
      first = from.poss === 'a' ? A : H;
      if (from.y != null) {
        const dir = from.dir || 1;
        startY = clamp(Math.round(dir > 0 ? from.y - 10 : 110 - from.y), 1, 99);
        firstState = { down: from.down || 1, togo: from.togo || 10 };
      }
      firstRecv = first;
    } else first = firstRecv;

    let O = first, D = O === H ? A : H;
    if (startY == null) kickoff(O, D);                          // return stats only
    const span = total > 0 ? (G - t0) / total : 0;
    // index of the first drive of the 2nd half (−1 if the half already passed)
    const half = t0 < G / 2 && span > 0 ? Math.ceil((G / 2 - t0) / span - 1e-9) : -1;
    for (let i = 0; i < total; i++) {
      const tEnd = t0 + (i + 1) * span;
      const q = clamp(Math.floor((tEnd - 1e-6) / qLen) + 1, 1, 4);    // quarter
      const clk = Math.round(clamp(q * qLen - tEnd, 0, qLen));
      const lead = score[O.tid] - score[D.tid];
      const late = q === 4 && tEnd > G - qLen / 2;                    // the last ~1:30 of Q4 (3:00 quarters)
      const close = late && Math.abs(lead) <= 8;
      const d = close ? dOf(O, D, true) : dFull[O.tid];
      const pTD = clamp(k.SIM_P_TD + 0.012 * d, 0.08, 0.70);
      const pFG = clamp(k.SIM_P_FG + 0.004 * d, 0.08, 0.28);
      const pTO = clamp(k.SIM_P_TO - 0.003 * d, 0.04, 0.20);
      const r = rng.next();
      let outcome = r < pTD ? 'TD' : r < pTD + pFG ? 'FG' : r < pTD + pFG + pTO ? 'TO' : 'PUNT';
      const lastTwo = i >= total - 4;
      if (outcome === 'FG' && lastTwo && lead < -3) outcome = rng.chance(clamp(0.5 + (pTD - k.SIM_P_TD), 0.2, 0.8)) ? 'TD' : 'DOWNS';
      // Appendix C drive yards decide where a drive starts: TD 60–80, FG 40–60, punt 10–35, lost ball 0–40
      let start, endAt = null;
      if (i === 0 && startY != null) start = startY;
      else if (outcome === 'TD') start = 100 - rng.int(60, 80);
      else if (outcome === 'FG') { endAt = rng.int(62, 83); start = clamp(endAt - rng.int(40, 60), 1, endAt); }
      else if (outcome === 'PUNT') { start = rng.int(8, 40); endAt = rng.chance(k.SIM_3OUT) ? start : Math.min(70, start + rng.int(6, 25)); }
      else { start = rng.int(10, 45); endAt = Math.min(95, start + rng.int(0, 40)); }
      const res = drive(O, D, start, outcome, i === 0 ? firstState : null, endAt);
      let nextStart;
      if (res.kind === 'TD') {
        Bx.score(box, O.tid, 6, q, clk, 'TD', res.txt);
        score[O.tid] += 6;
        const diffAfter = score[O.tid] - score[D.tid];
        const goTwo = late && i >= total - 6 && [-2, -5, -10, -13, 1, 5, 12].indexOf(diffAfter) >= 0;
        if (goTwo) {
          if (rng.chance(clamp(0.45 + 0.01 * d + (fx.twoPtFrom && fx.twoPtFrom < 2 ? 0.1 : 0), 0.2, 0.8))) {
            Bx.score(box, O.tid, 2, q, clk, '2PT', 'Two-point try good');
            score[O.tid] += 2;
          }
        } else {
          Bx.add(box, O.k.pid, O.tid, 'xpa', 1);
          if (rng.chance(xpMake(O))) {
            Bx.add(box, O.k.pid, O.tid, 'xpm', 1);
            Bx.score(box, O.tid, 1, q, clk, 'XP', nameOf(O.k) + ' extra point');
            score[O.tid] += 1;
          }
        }
        nextStart = 'KO';
      } else if (res.kind === 'FG') {
        const dist = 100 - res.end + 17;
        Bx.add(box, O.k.pid, O.tid, 'fga', 1);
        if (rng.chance(fgMake(O, dist))) {
          const pts = fx.fg50Pts && dist >= 50 ? fx.fg50Pts : 3;
          Bx.add(box, O.k.pid, O.tid, 'fgm', 1);
          Bx.add(box, O.k.pid, O.tid, 'fglg', dist);
          Bx.score(box, O.tid, pts, q, clk, 'FG', nameOf(O.k) + ' ' + dist + ' yd field goal');
          score[O.tid] += pts;
          nextStart = 'KO';
        } else nextStart = clamp(100 - (res.end - 7), 20, 99);
      } else if (res.kind === 'PUNT') {
        const net = Math.round(30 + O.kick * 0.15 + rng.normal(0, 5) + O.puntAdd);
        Bx.add(box, O.k.pid, O.tid, 'pn', 1);
        Bx.add(box, O.k.pid, O.tid, 'pny', net);
        const land = res.end + net;
        nextStart = land >= 100 ? 20 : clamp(100 - land, 1, 99);
      } else if (res.kind === 'INT') {
        nextStart = clamp(100 - res.end + (res.ret || 0), 1, 95);
      } else nextStart = clamp(100 - res.end, 1, 99);       // fumble / downs

      // next possession; at halftime the team that did not receive the opening kickoff receives
      const atHalf = i + 1 === half;
      const nO = atHalf && !from ? (firstRecv === H ? A : H) : D;
      const nD = nO === H ? A : H;
      if (atHalf || nextStart === 'KO') kickoff(nO, nD);           // return stats only
      O = nO; D = nD;
    }

    // ---- overtime (Appendix C) ----
    if (score[home] === score[away]) {
      const dh = dFull[home], da = dFull[away];
      const ph = 0.45 + 0.02 * dh, pa = 0.45 + 0.02 * da;
      const r = rng.next();
      box.q[0].push(0); box.q[1].push(0);
      let w = null;
      const pw = clamp(ph, 0.05, 0.95) / (clamp(ph, 0.05, 0.95) + clamp(pa, 0.05, 0.95));
      if (cfg.po > 0) w = r < pw ? H : A;
      else if (r < 0.9 * pw) w = H;                              // regular season: 10% tie (Appendix C)
      else if (r < 0.9) w = A;
      if (w) {
        if (rng.chance(0.65)) {
          const dist = rng.int(25, 45);
          Bx.add(box, w.k.pid, w.tid, 'fga', 1);
          Bx.add(box, w.k.pid, w.tid, 'fgm', 1);
          Bx.add(box, w.k.pid, w.tid, 'fglg', dist);
          Bx.score(box, w.tid, 3, 5, Math.round(qLen * rng.range(0.2, 0.8)), 'FG', nameOf(w.k) + ' ' + dist + ' yd field goal (OT)');
        } else {
          const L2 = w === H ? A : H;
          const res = drive(w, L2, 25, 'TD', null);
          Bx.score(box, w.tid, 6, 5, Math.round(qLen * rng.range(0.2, 0.8)), 'TD', res.txt + ' (OT)');
        }
      }
    }

    // ---- injuries (Poisson 0.35 per team; starters ×4, bench ×1) ----
    [H, A].forEach((S) => {
      let mult = 1;
      if (S.gt.injMult != null) mult = S.gt.injMult;           // WP2 Injuries.chanceMult (medical, difficulty, events, twist)
      else {
        if (cfg.userTid === S.tid) mult *= [0.6, 1.0, 1.15, 1.2][cfg.diff] || 1;   // Expert = Pro + 0.75 × (Legend − Pro)
        mult *= fx.injMult || 1;
      }
      if (wx.k === 'snow') mult *= 1.1;
      const nInj = poisson(rng, k.SIM_INJ * mult);
      const starters = {};
      C.SLOTS.forEach((s) => { if (s !== 'KR' && S.gt.dc[s][0] != null) starters[S.gt.dc[s][0]] = true; });
      for (let i = 0; i < nInj; i++) {
        const p = pickW(rng, S.gt.pl, (pl) => (starters[pl.pid] ? 4 : 1) * modMul(simMods(pl), 'inj'));
        let sev = rng.weighted(INJ_SEV);
        if (modSum(simMods(p), 'sevDown') > 0 && sev > 1) sev -= 1;
        if (!box.pl[p.pid]) Bx.markPlayed(box, p.pid, S.tid, false);
        Bx.injury(box, p.pid, sev);
      }
    });

    // ---- penalties, time of possession, totals ----
    const penOn = !(cfg.settings && cfg.settings.penalties === false);
    [H, A].forEach((S) => {
      if (!penOn) return;
      const np = poisson(rng, k.SIM_PEN * S.penMul * (cfg.userTid === S.tid && cfg.diff === 0 ? 0.5 : 1));
      for (let i = 0; i < np; i++) { Bx.team(box, S.tid, 'pen', 1); Bx.team(box, S.tid, 'peny', rng.pick([5, 5, 5, 10, 10, 15])); }
    });
    const totPlays = plays[home] + plays[away];
    const remain = Math.max(0, G - t0);
    const topH = totPlays ? Math.round(remain * plays[home] / totPlays) : Math.round(remain / 2);
    Bx.team(box, home, 'top', topH);
    Bx.team(box, away, 'top', remain - topH);
    box.tm.forEach((tl) => { tl.ty = tl.py + tl.ry; });
    return Bx.finalize(box);
  };
})(globalThis.PT = globalThis.PT || {});
