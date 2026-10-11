/* Pixel Touchdown: js/engine/playcall.js
 * Owner: WP3. Responsibility: AI play-calling + the user play-option list per situation.
 * Design 6.2 (style mixes + situation overrides), 6.7 (3 suggested cards + rest, Rookie counter hints), 7.3–7.4 (Edge),
 * 7.6 (AI defense weights, situation multipliers, smart counter pCounter), 7.7 (user defense cards, "They love", Coach Tip).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const PC = PT.ns('Engine.PlayCall');
  const TYPES = ['SHORT', 'DEEP', 'IRUN', 'ORUN', 'SCREEN', 'PA', 'TRICK'];

  function PB() { return PT.Data.Playbook; }
  function DF() { return PT.Data.Defense; }

  /** Situation-override key (design 6.2) for a situation-like object, or null. */
  PC.overrideKey = function (s) {
    const toGoal = s.toGoal != null ? s.toGoal : 99;
    if (s.two || (s.goal && toGoal <= 2)) return 'goal';
    if (s.down >= 3 && s.togo >= 7) return 'long';
    if (s.down >= 3 && s.togo <= 2) return 'short';
    const halfEnd = s.q === 2 || s.q >= 4;
    const lead = s.lead != null ? s.lead : 0;
    const W = s.warn || 60;                                  // late-half window scales with the quarter length
    if ((halfEnd && s.clk <= W) || (s.q >= 4 && s.clk < W * 1.5 && lead < 0)) return 'hurry';
    if (s.q >= 4 && s.clk < W * 2 && lead >= 9) return 'clock';
    return null;
  };

  /** Type weights for an offense style + situation. */
  PC.typeMix = function (style, s) {
    const key = PC.overrideKey(s);
    return key ? PB().OVERRIDES[key] : (PB().STYLE_MIX[style] || PB().STYLE_MIX.west);
  };

  function pickPlayOfType(rng, type, s, lastId, allowed) {
    const list = PB().list;
    const cands = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.type !== type || p.clock || p.k === 'special') continue;
      if (p.hail && !(s.hail)) continue;
      if (p.sneak && s.togo > 1) continue;
      if (allowed && !allowed(p)) continue;
      cands.push(p);
    }
    if (!cands.length) return null;
    if (cands.length > 1) { const j = cands.findIndex((p) => p.id === lastId); if (j >= 0) cands.splice(j, 1); }
    return rng.pick(cands);
  }

  /**
   * Public: choose an offensive play id or defensive call id for a situation (ARCHITECTURE 3.5).
   * @param {Object} sit Situation @param {'O'|'D'} side @param {GameTeam} gt @param {Object} rng PT.RNG
   * @param {Object} [ctx] {lastId, hist:[types], pCounter}
   */
  PC.choose = function (sit, side, gt, rng, ctx) {
    ctx = ctx || {};
    const style = side === 'O' ? (gt.tend && gt.tend.off) || 'west' : (gt.tend && gt.tend.def) || 'think';
    if (side === 'O') {
      const s = Object.assign({}, sit);
      if (s.hail == null) s.hail = (s.q === 2 || s.q >= 4) && s.clk <= 10 && (s.toGoal || 99) > 30;
      if (s.hail) return 'hail_mary';
      const mix = PC.typeMix(style, s);
      if (PC.overrideKey(s) === 'short' && s.togo <= 1 && rng.chance(0.2)) return 'snout_sneak';
      for (let tries = 0; tries < 6; tries++) {
        const type = rng.weighted(Object.keys(mix).map((k) => [k, mix[k]]));
        const p = pickPlayOfType(rng, type, s, ctx.lastId, ctx.allowed);
        if (p) return p.id;
      }
      return 'quick_slants';
    }
    return PC.defWeightsPick(sit, style, rng, ctx);
  };

  /** AI defense call (design 7.6). Situation multipliers work on call tags (cover/blitz/run/heavy/goal/prevent). */
  PC.defWeightsPick = function (s, style, rng, ctx) {
    const D = DF(), base = D.STYLE_W[style] || D.STYLE_W.think, has = D.has;
    const w = {};
    for (const id in base) w[id] = base[id];
    const toGoal = s.toGoal != null ? s.toGoal : 99;
    if (s.down >= 3 && s.togo >= 8) {
      D.list.forEach((c) => {
        if (has(c, 'cover')) w[c.id] *= 1.5;
        else if (has(c, 'blitz')) w[c.id] *= 1.3;
        else if (has(c, 'run')) w[c.id] *= 0.3;
      });
    }
    if (s.togo <= 2 && toGoal > 3) D.list.forEach((c) => { if (has(c, 'run')) w[c.id] *= has(c, 'heavy') ? 2 : 1.5; if (has(c, 'prevent')) w[c.id] = 0; });
    const defLead = -(s.lead || 0);
    const preventTime = s.q >= 4 && s.clk <= (s.warn || 60) && defLead >= 9;
    if (!preventTime) w.prevent = 0;
    if (preventTime) {
      let rest = 0; for (const id in w) if (!has(D.byId(id), 'prevent')) rest += w[id];
      w.soft_pillow = Math.max(rest * 0.6, 1); w.prevent = Math.max(rest * 0.4, 1);
    }
    if (toGoal <= 3 || (s.togo <= 1 && toGoal <= 10) || s.two) {
      let rest = 0; for (const id in w) if (!has(D.byId(id), 'goal')) rest += w[id];
      w.brick_house = Math.max(rest, 1);
    } else w.brick_house = 0;
    // smart counter vs the most used type over the last 8 plays
    const hist = ctx.hist || [];
    if (hist.length >= 3 && rng.chance(ctx.pCounter == null ? 0.4 : ctx.pCounter)) {
      const cnt = {};
      let top = null, tc = 0;
      for (let i = 0; i < hist.length; i++) { cnt[hist[i]] = (cnt[hist[i]] || 0) + 1; if (cnt[hist[i]] > tc) { tc = cnt[hist[i]]; top = hist[i]; } }
      let best = null, bv = -99, bw = -1;
      for (const id in D.MATRIX) {
        const c = D.byId(id);
        if (has(c, 'goal') && toGoal > 5) continue;
        if (has(c, 'prevent') && !preventTime) continue;
        // a "smart" counter never leaves the deep part of the field empty against a short-pass habit (tuned)
        if (D.MATRIX[id].DEEP <= -2 && top !== 'IRUN' && top !== 'ORUN' && toGoal > 20) continue;
        const v = D.MATRIX[id][top];
        if (v > bv || (v === bv && base[id] > bw)) { bv = v; best = id; bw = base[id]; }
      }
      if (best) return best;
    }
    return rng.weighted(Object.keys(w).filter((k) => w[k] > 0).map((k) => [k, w[k]]));
  };

  /** Counter-matrix value incl. the Brick House special rule. */
  PC.matrix = function (callId, type, togo) {
    let v = (DF().MATRIX[callId] || {})[type] || 0;
    if (callId === 'brick_house') {
      if (togo <= 3 && (type === 'IRUN' || type === 'ORUN')) v += 1;
      if (togo >= 8) v -= 1;
    }
    return v;
  };

  /** Edge for this snap (design 7.4). + = defense advantage. */
  PC.edge = function (G, play, call) {
    const o = G.poss, d = 1 - o, D = DF(), B = PB();
    const offStyle = G.teams[o].tend.off, defStyle = G.teams[d].tend.def;
    let e = PC.matrix(call.id, play.type, G.togo);
    e += 0.5 * ((D.STYLE_MATCH[defStyle] || {})[offStyle] || 0);
    if ((B.STYLE_SIG[offStyle] || []).indexOf(play.type) >= 0) e -= (o === G.userIdx && (G.sk.playdesigner || 0) >= 2) ? 0.5 : 0.25;
    if ((D.STYLE_SIG[defStyle] || []).indexOf(call.id) >= 0) e += 0.25;
    const h = G.hist[o];
    let n = 0;
    for (let i = Math.max(0, h.length - 4); i < h.length; i++) if (h[i] === play.type) n++;
    if (n >= 3) e += 0.5;
    const hp = G.histP[o];
    if (hp.length >= 2 && hp[hp.length - 1] === play.id && hp[hp.length - 2] === play.id) e += 1.0;
    const toGoal = PT.Engine.Rules.toGoal(G);
    if (o === G.userIdx) {
      if (G.sk.redzonewizard && toGoal <= 20) e -= 0.5 * G.sk.redzonewizard;
      if ((G.sk.twominutedrill || 0) >= 2 && PT.Engine.Rules.halfEndQ(G) && PT.Engine.Rules.clockLeft(G) <= PT.Engine.Rules.warnT(G) * 1.5) e -= 0.5;
    }
    if (d === G.userIdx && G.sk.goallinestand && toGoal <= 20) e += 0.5 * G.sk.goallinestand;
    return PT.Util.clamp(e, -G.T.EDGE_MAX, G.T.EDGE_MAX);
  };

  function sitFor(G) {
    const s = PT.Engine.Rules.situation(G, {});
    s.clk = PT.Engine.Rules.clockLeft(G);
    s.hail = PT.Engine.Rules.halfEndQ(G) && s.clk <= 10 && s.toGoal > 30;
    return s;
  }

  /** AI offense play for the current situation. */
  PC.aiOffense = function (G) { return PC.aiPick(G, G.rng); };

  /** AI defense call (user's opponent uses difficulty pCounter; Auto Defense 0.40). */
  PC.aiDefense = function (G, forUser) {
    const d = 1 - G.poss, s = sitFor(G);
    let pc = G.T.PCOUNTER[G.diff];
    if (G.userIdx < 0 || forUser) pc = 0.40;
    if (G.poss === G.userIdx && (G.sk.filmroom || 0) >= 2) pc -= 0.10;
    const id = PC.defWeightsPick(s, G.teams[d].tend.def, G.rng, { hist: G.hist[G.poss], pCounter: pc });
    return DF().byId(id);
  };

  /** Is play p unlocked for the user? */
  PC.unlocked = function (G, p) {
    if (G.unlock) return G.unlock[p.id] === true;
    if (G.coachLvl != null) return (p.lv || 1) <= G.coachLvl;
    return true;
  };

  function suggRng(G, side) { return PT.RNG.create(PT.RNG.hash(G.cfg.seed, G.playNo, side, 'sugg')); }

  function deepest(p) {
    let m = -99;
    for (const slot in p.as) {
      const a = p.as[slot];
      if (a && a.rt) for (let i = 0; i < a.rt.length; i++) if (a.rt[i][1] > m) m = a.rt[i][1];
    }
    return m;
  }

  /** Mini route art for a play card (offense frame, read-only references). */
  function art(p) {
    const out = {};
    for (const slot in p.as) { const a = p.as[slot]; if (a && typeof a === 'object' && (a.rt || a.lane)) out[slot] = a.rt || a.lane; }
    return out;
  }

  /** Recent defensive tendency group of the AI vs the user (for Rookie card hints). */
  function dominantGroup(G) {
    const dh = G.dhist[1 - G.poss], cnt = {};
    let top = null, tc = 0;
    for (let i = 0; i < dh.length; i++) {
      const c = DF().byId(dh[i]);
      if (!c) continue;
      cnt[c.grp] = (cnt[c.grp] || 0) + 1;
      if (cnt[c.grp] > tc) { tc = cnt[c.grp]; top = c.grp; }
    }
    return top;
  }

  /**
   * Offensive play score (shared by the user's cards and the AI offense, so AI teams feel different by style):
   * style identity (the style's signature plays get SUG_STYLE ≈ 70% of picks) + type mix + situation override + situation
   * fit + the defense this game (counter-matrix vs the calls they've shown; their style before 3 calls) + hot hand
   * (plays that worked this game) − plays that failed − strong repetition penalty over the last SUG_REP snaps.
   */
  PC.offScore = function (G, o, p, s, okey, ov, mix, style) {
    const T = G.T, D = DF();
    let sc = (mix[p.type] || 0) * 0.3;
    if (p.st && p.st.indexOf(style) >= 0) sc += T.SUG_STYLE;
    if (ov) sc += (ov[p.type] || 0) * 0.6;
    sc += fitO(p, s, okey);
    if (p.tags && p.tags.indexOf('goal') >= 0) { const tg = s.toGoal != null ? s.toGoal : 99; sc += tg <= 5 || s.two ? 12 : tg > 20 ? -10 : 0; }
    // the defense this game: calls shown (last 8) or, early, their style's signature calls
    const dh = G.dhist[1 - o];
    let mv = 0, mn = 0;
    if (dh.length >= 3) { for (let j = Math.max(0, dh.length - 8); j < dh.length; j++) { mv += PC.matrix(dh[j], p.type, s.togo); mn++; } }
    else { const sig = D.STYLE_SIG[G.teams[1 - o].tend.def] || []; for (const c of sig) { mv += PC.matrix(c, p.type, s.togo); mn++; } }
    if (mn) sc -= T.SUG_DEF * mv / mn;
    // hot hand / cold hand this game
    const pr = G.pres && G.pres[o][p.id];
    if (pr && pr.n) sc += Math.max(-T.SUG_HOT, Math.min(T.SUG_HOT, (pr.y / pr.n - 5) * 0.8)) - Math.min(2, pr.bad) * T.SUG_COLD;
    // repetition: called in the last SUG_REP snaps
    const hp = G.histP[o];
    let used = 0; for (let j = Math.max(0, hp.length - T.SUG_REP); j < hp.length; j++) if (hp[j] === p.id) used++;
    sc -= T.SUG_CALLED * used;
    if (p.hail && !s.hail) sc -= 200;
    if (p.sneak && s.togo > 2) sc -= 200;
    if (s.hail && p.hail) sc += 100;
    return sc;
  };

  /** AI offense play (same logic as the user's suggestions, one weighted draw). */
  PC.aiPick = function (G, rng) {
    const o = G.poss, B = PB(), s = sitFor(G), T = G.T;
    const style = G.teams[o].tend.off, mix = B.STYLE_MIX[style] || B.STYLE_MIX.west;
    const okey = PC.overrideKey(s), ov = okey ? B.OVERRIDES[okey] : null;
    if (s.hail) return B.byId('hail_mary');
    if (okey === 'short' && s.togo <= 1 && rng.chance(0.2)) return B.byId('snout_sneak');
    const sc = [];
    let top = -1e9;
    for (const p of B.list) {
      if (p.clock || p.k === 'special') continue;
      const v = PC.offScore(G, o, p, s, okey, ov, mix, style);
      if (v < -100) continue;
      sc.push([p, v]); if (v > top) top = v;
    }
    let tot = 0; for (const x of sc) { x[1] = Math.exp((x[1] - top) / T.SUG_TEMP); tot += x[1]; }
    let r = rng.next() * tot;
    for (const x of sc) { r -= x[1]; if (r <= 0) return x[0]; }
    return sc.length ? sc[0][0] : B.byId('quick_slants');
  };

  /** Is defensive call c unlocked for the user? (coach level; with only an offensive unlock list, its top level) */
  PC.unlockedD = function (G, c) {
    const lv = c.lv || 1;
    if (lv <= 1) return true;
    if (G.coachLvl != null) return lv <= G.coachLvl;
    if (G.unlock) {
      if (G.unlockLv == null) { let m = 1; PB().list.forEach((p) => { if (G.unlock[p.id] && (p.lv || 1) > m) m = p.lv || 1; }); G.unlockLv = m; }
      return lv <= G.unlockLv;
    }
    return true;
  };

  const SAFE = { SHORT: 1, SCREEN: 1 };
  /**
   * Situation fit of an offensive play (playtest: suggestions follow the team style but vary with down, distance,
   * field position, score and time).
   */
  function fitO(p, s, okey) {
    const toGoal = s.toGoal != null ? s.toGoal : 99, run = p.k === 'run', dp = deepest(p);
    const lead = s.lead || 0;
    let f = 0;
    if (!run) { if (dp >= s.togo + 2) f += 8; else if (s.down >= 3 && dp < s.togo) f -= 12; }
    if (run) {
      if (s.togo <= 3) f += 10;
      if (s.down >= 3 && s.togo >= 7) f += p.draw ? 2 : -18;
      if (s.down === 1 && s.togo >= 10) f += 4;
    }
    if (toGoal <= 20 && p.type === 'DEEP' && dp > toGoal + 8) f -= 10;      // red zone: no bombs past the end line
    if (toGoal <= 3) { if (run) f += 10; if (p.type === 'DEEP' || p.type === 'SCREEN') f -= 20; }
    if (toGoal >= 92) { if (p.type === 'TRICK') f -= 15; if (p.type === 'DEEP') f -= 6; if (run && p.type === 'IRUN') f += 6; }
    if (okey === 'hurry') { if (run && !p.draw) f -= 15; if (p.type === 'SHORT' || p.type === 'DEEP') f += 5; }
    if (okey === 'clock' || (s.q >= 4 && s.clk <= (s.warn || 60) * 2 && lead >= 4)) { if (run) f += 12; if (p.type === 'DEEP' || p.type === 'TRICK') f -= 10; }
    if (s.q >= 4 && s.clk <= (s.warn || 60) * 2 && lead <= -9 && run) f -= 8;
    return f;
  }

  /**
   * User's play cards (design 6.7 / 7.7). Each card: {id,name,k,type,icon,desc,tag,sug,best,hint,tip,form,lv,art,...}.
   * The first 3 are the suggested cards (sug:true) — the rest is the full book.
   * Playtest rules: style-led but balanced (3 different types, at least one run or safe throw, never all runs or all
   * passes unless the situation demands it), and not the same three cards every snap.
   */
  PC.options = function (G, side) {
    const rng = suggRng(G, side);
    const s = sitFor(G);
    if (side === 'D') return PC.defOptions(G, s, rng);
    const o = G.poss, B = PB();
    const style = G.teams[o].tend.off;
    const mix = B.STYLE_MIX[style] || B.STYLE_MIX.west;
    const okey = PC.overrideKey(s);
    const ov = okey ? B.OVERRIDES[okey] : null;
    const hp = G.histP[o];
    const rookie = G.diff === 0;
    const grp = rookie ? dominantGroup(G) : null;
    // suggestion memory (stable while the same call screen re-asks for options): the last SUG_HIST snaps' cards
    if (!G.sugO) G.sugO = [{ no: -1, hist: [], cur: [], seen: {} }, { no: -1, hist: [], cur: [], seen: {} }];
    const st = G.sugO[o], T = G.T;
    if (st.no !== G.playNo) {
      if (st.cur.length) { st.hist.push(st.cur); if (st.hist.length > T.SUG_HIST) st.hist.shift(); }
      st.no = G.playNo;
      st.cur = [];
    } else if (st.cache) return finish(st.cache);
    const prevSet = st.hist.length ? st.hist[st.hist.length - 1].slice().sort().join(',') : '';
    const lvMax = G.coachLvl != null ? G.coachLvl : 0;
    const scored = [];
    for (let i = 0; i < B.list.length; i++) {
      const p = B.list[i];
      if (p.clock || !PC.unlocked(G, p)) continue;
      let sc = PC.offScore(G, o, p, s, okey, ov, mix, style);
      let shown = 0; for (let j = 0; j < st.hist.length; j++) if (st.hist[j].indexOf(p.id) >= 0) shown++;
      sc -= T.SUG_SHOWN * shown;
      if (!st.seen[p.id]) sc += T.SUG_FRESH;                                       // not suggested yet this game
      if (lvMax > 1 && (p.lv || 1) === lvMax && rng.chance(0.5)) sc += T.SUG_FRESH;   // a new unlock
      scored.push({ p: p, sc: sc, w: 0 });
    }
    // weighted random among the fitting plays (softmax on the score)
    let top = -1e9; for (const x of scored) if (x.sc > top) top = x.sc;
    for (const x of scored) x.w = x.sc < -100 ? 0 : Math.exp((x.sc - top) / T.SUG_TEMP);
    const pickW = (ok) => {
      let tot = 0; for (const x of scored) if (ok(x)) tot += x.w;
      if (tot <= 0) return null;
      let r = rng.next() * tot;
      for (const x of scored) if (ok(x)) { r -= x.w; if (r <= 0) return x; }
      return null;
    };
    scored.sort((a, b) => b.sc - a.sc);
    const sug = [];
    const types = {};
    const add = (x) => { if (x && sug.indexOf(x) < 0) { sug.push(x); types[x.p.type] = 1; } };
    const free = (x) => sug.indexOf(x) < 0 && !types[x.p.type];
    if (s.hail) add(scored[0]); else add(pickW(free));
    add(pickW(free));
    // third: balance — a run (or a safe throw when runs make no sense), never three of a kind
    const hurry = okey === 'hurry' || okey === 'long' || s.hail;
    const nRun = sug.filter((x) => x.p.k === 'run').length;
    let third = null;
    if (nRun === 0 && !hurry) third = pickW((x) => free(x) && x.p.k === 'run');
    if (!third && nRun === 0 && !sug.some((x) => SAFE[x.p.type])) third = pickW((x) => free(x) && SAFE[x.p.type]);
    if (!third && nRun === sug.length && !(s.toGoal <= 2 || okey === 'short')) third = pickW((x) => free(x) && x.p.k !== 'run');
    add(third || pickW(free));
    for (let i = 0; i < scored.length && sug.length < 3; i++) add(scored[i]);
    // never the same 3-card set twice in a row
    if (sug.length >= 3 && sug.map((x) => x.p.id).sort().join(',') === prevSet) {
      const alt = pickW((x) => sug.indexOf(x) < 0 && x.p.type === sug[2].p.type) || pickW((x) => sug.indexOf(x) < 0);
      if (alt) sug[2] = alt;
    }
    const nSug = (G.sk.playdesigner || 0) >= 1 ? 4 : 3;
    while (sug.length < nSug) { const x = pickW((y) => sug.indexOf(y) < 0); if (!x) break; add(x); }
    st.cur = sug.map((x) => x.p.id);
    st.cur.forEach((id) => { st.seen[id] = 1; });
    st.cache = sug;
    return finish(sug);

    function finish(sug) {
    const card = (x, isSug, best) => {
      const p = x.p;
      let hint = null;
      if (rookie && grp) {
        let v = 0, n = 0;
        const dh = G.dhist[1 - o];
        for (let j = 0; j < dh.length; j++) { v += PC.matrix(dh[j], p.type, s.togo); n++; }
        if (n && v / n <= -0.5) hint = DF().GROUP_HINT[grp];
      }
      return { id: p.id, name: p.name, k: p.k, type: p.type, icon: p.icon || B.TYPE_ICONS[p.type], desc: p.desc || '',
        tag: B.TYPE_NAMES[p.type], sug: isSug, best: !!best, hint: hint, tip: false, form: p.form, lv: p.lv || 1, art: art(p) };
    };
    const out = sug.map((x, i) => card(x, true, i === 0));
    const rest = B.list.filter((p) => !p.clock && PC.unlocked(G, p) && !sug.some((x) => x.p === p));
    rest.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
    rest.forEach((p) => out.push(card({ p: p }, false, false)));
    // specials: PUNT on 4th down; FIELD GOAL on 4th down or on ANY down past midfield (client) — disabled "Too far!" when out of range
    if (G.down === 4 && !G.tryTwo) {
      out.push({ id: 'punt', name: 'Punt', k: 'special', type: 'SPECIAL', icon: 'boot', desc: 'Kick it away.', tag: 'Special', sug: false, best: false, hint: null, tip: false });
    }
    if (G.rescue) {
      // 0:00 with a runoff pending (HUNT2 #2): only a TIMEOUT (or a SPIKE) can help; no field goal (no time to line up)
      for (const c of out) { c.sug = false; c.best = false; }
      if (G.tos[o] > 0) out.unshift({ id: 'timeout', name: 'Timeout', k: 'special', type: 'CLOCK', icon: 'clock', desc: 'Stop the clock (' + G.tos[o] + ' left).',
        tag: 'Clock', sug: true, best: true, hint: null, tip: false });
    }
    if (!G.tryTwo && !G.rescue && (G.down === 4 || s.toGoal < 50)) {
      const late = s.fgOk && PT.Engine.Rules.lateFG(G, true);
      const fg = { id: 'fg', name: 'Field Goal', k: 'special', type: 'SPECIAL', icon: 'posts', desc: s.fgOk ? 'Chance: ' + s.fgPct + '%' : 'Too far!',
        tag: 'Special', sug: late, best: late, hint: null, tip: false, ok: s.fgOk, pct: s.fgPct };
      if (late) {
        // end of the half in range: the FG leads the 3 suggested cards (the third play card drops to the book)
        for (const c of out) c.best = false;
        const nSugC = out.filter((c) => c.sug).length;
        if (nSugC >= 3) { const last = out.filter((c) => c.sug).pop(); last.sug = false; }
        out.unshift(fg);
      } else out.push(fg);
    }
    if (!G.tryTwo) {
      const halfEnd = G.q === 2 || G.q >= 4;
      if (G.score[o] > G.score[1 - o] && s.toGoal < 97 && (G.q >= 4 || (G.q === 2 && s.clk <= (s.warn || 60)))) {   // no kneel inside the own 3
        const k = B.byId('kneel');
        out.push({ id: 'kneel', name: k.name, k: 'special', type: 'CLOCK', icon: k.icon, desc: k.desc, tag: 'Clock', sug: false, best: false, hint: null, tip: false });
      }
      if (halfEnd && s.clk <= (s.warn || 60) && G.pend > 3 && G.down < 4) {
        const k = B.byId('spike');
        const sp = { id: 'spike', name: k.name, k: 'special', type: 'CLOCK', icon: k.icon, desc: k.desc, tag: 'Clock', sug: !!G.rescue, best: !!G.rescue && !G.tos[o], hint: null, tip: false };
        if (G.rescue) out.splice(G.tos[o] > 0 ? 1 : 0, 0, sp); else out.push(sp);
      }
    }
    return out;
    }
  };

  /** Most likely offensive type for the AI offense in this situation. */
  PC.likelyType = function (G, s) {
    const mix = PC.typeMix(G.teams[G.poss].tend.off, s);
    let best = 'SHORT', m = -1;
    for (const k in mix) if (mix[k] > m) { m = mix[k]; best = k; }
    return best;
  };

  PC.defOptions = function (G, s, rng) {
    const D = DF(), d = 1 - G.poss, has = D.has;
    const base = D.STYLE_W[G.teams[d].tend.def] || D.STYLE_W.think;
    const lt = PC.likelyType(G, s);
    const toGoal = s.toGoal != null ? s.toGoal : 99;
    const late = s.q >= 4 && s.clk <= (s.warn || 60) * 1.5 && -(s.lead || 0) >= 9;
    if (!G.sugD) G.sugD = { no: -1, prev: [], cur: [] };
    const st = G.sugD;
    if (st.no !== G.playNo) { st.prev = st.cur; st.no = G.playNo; }
    const ok = (c) => PC.unlockedD(G, c);
    // what the offense is likely to do: its situation mix, blended with the types it ran over its last 3 plays (HUNT2 #5)
    const mix = PC.typeMix(G.teams[G.poss].tend.off, s), recent = G.hist[G.poss].slice(-3);
    const expM = (id) => {
      let v = 0, w = 0;
      for (const t in mix) { v += mix[t] * PC.matrix(id, t, s.togo); w += mix[t]; }
      v = w ? v / w : 0;
      if (recent.length) { let r = 0; for (const t of recent) r += PC.matrix(id, t, s.togo); v = 0.6 * v + 0.4 * r / recent.length; }
      return v;
    };
    const sc = D.list.filter(ok).map((c) => {
      let v = expM(c.id) * 2 + (base[c.id] || 0) / 20 + rng.range(0, 1.6) + PC.matrix(c.id, lt, s.togo) * 0.5;
      if (has(c, 'goal')) v += toGoal <= 5 ? 3 : -50;
      if (has(c, 'prevent')) v += late ? 3 : c.id === 'prevent' ? -50 : -1;
      if (s.down >= 3 && s.togo >= 8) { if (has(c, 'run')) v -= 3; if (has(c, 'cover') || has(c, 'zone')) v += 2; }
      if (s.togo <= 2 && toGoal > 3 && has(c, 'run')) v += 3;
      if (st.prev[0] === c.id) v -= 1.5;                 // last snap's Coach Pick
      else if (st.prev.indexOf(c.id) >= 0) v -= 0.6;
      return { c: c, sc: v };
    });
    sc.sort((a, b) => b.sc - a.sc);
    const card = (x, i, sug) => ({ id: x.c.id, name: x.c.name, k: 'def', type: 'DEF', icon: 'shield', desc: x.c.desc, tag: D.FORMS[x.c.form],
      form: x.c.form, grp: x.c.grp, lv: x.c.lv || 1, sug: sug, best: sug && i === 0, tip: sug && i === 0 && G.diff === 0, hint: null });
    // 3 suggestions from different groups (never three of a kind)
    const pick = [], grps = {};
    for (let i = 0; i < sc.length && pick.length < 3; i++) if (!grps[sc[i].c.grp]) { grps[sc[i].c.grp] = 1; pick.push(sc[i]); }
    for (let i = 0; i < sc.length && pick.length < 3; i++) if (pick.indexOf(sc[i]) < 0) pick.push(sc[i]);
    st.cur = pick.map((x) => x.c.id);
    const out = pick.map((x, i) => card(x, i, true));
    D.list.forEach((c) => { if (ok(c) && !out.some((o) => o.id === c.id)) out.push(card({ c: c }, 9, false)); });
    return out;
  };

  /** "They love" strip: the opponent offense's top play types this game (or style mix before 6 plays). */
  PC.love = function (G) {
    const o = G.poss, n = G.typeCount[o], tot = G.offPlays[o];
    const B = PB();
    let arr;
    if (tot >= 6) arr = Object.keys(n).map((k) => ({ type: k, pct: Math.round(n[k] / tot * 100) }));
    else { const mix = B.STYLE_MIX[G.teams[o].tend.off] || B.STYLE_MIX.west; arr = Object.keys(mix).map((k) => ({ type: k, pct: mix[k] })); }
    arr.sort((a, b) => b.pct - a.pct);
    const cnt = G.sk.filmroom ? 3 : 2;
    return arr.slice(0, cnt).map((x) => ({ type: x.type, name: B.TYPE_NAMES[x.type], pct: x.pct }));
  };

  // ---------------------------------------------------------------- audibles (STAR_ABILITIES 7)
  const LOOK = {
    big: { IRUN: 40, ORUN: 20, PA: 30, DEEP: 10 },
    trips: { SHORT: 45, SCREEN: 25, DEEP: 20, ORUN: 10 },
    spread: { DEEP: 45, SHORT: 40, SCREEN: 15 },
    gun: { SHORT: 35, DEEP: 20, IRUN: 15, ORUN: 15, SCREEN: 10, TRICK: 5 },
    bunch: { SHORT: 50, SCREEN: 25, DEEP: 15, ORUN: 10 },
    empty: { SHORT: 45, DEEP: 45, SCREEN: 10 },
    iform: { IRUN: 45, ORUN: 25, PA: 25, DEEP: 5 },
    pistol: { IRUN: 30, ORUN: 15, PA: 25, SHORT: 20, DEEP: 10 }
  };
  /** What the shown offensive formation looks like (type weights, sums to 100). */
  PC.lookMix = function (G) { return LOOK[(G.P && G.P.play && G.P.play.form) || 'gun'] || LOOK.gun; };
  /** Counter-matrix value of a defense call vs the shown look (+ = good for the defense). */
  PC.lookScore = function (G, callId) {
    const mix = PC.lookMix(G);
    let v = 0;
    for (const t in mix) v += mix[t] * PC.matrix(callId, t, G.togo);
    return v / 100;
  };
  PC.lookLabel = function (G) { const m = PC.lookMix(G); return (m.IRUN || 0) + (m.ORUN || 0) >= 50 ? 'RUN' : 'PASS'; };

  /** 4 audible cards for the user's side while lined up. */
  PC.audibleOptions = function (G, side) {
    const P = G.P, B = PB(), D = DF();
    if (!P || !P.play) return [];
    if (side === 'D') {
      const label = PC.lookLabel(G);
      const userD = 1 - G.poss === G.userIdx;
      const s0 = sitFor(G), late = s0.q >= 4 && s0.clk <= (s0.warn || 60) * 1.5 && -(s0.lead || 0) >= 9;
      const sc = D.list.filter((c) => c.id !== P.call.id && (!D.has(c, 'goal') || PT.Engine.Rules.toGoal(G) <= 5) &&
        (c.id !== 'prevent' || late) && (!userD || PC.unlockedD(G, c)))
        .map((c) => ({ c: c, v: PC.lookScore(G, c.id) }));
      sc.sort((a, b) => b.v - a.v);
      return sc.slice(0, 4).map((x, i) => ({ id: x.c.id, name: x.c.name, k: 'def', type: 'DEF', icon: '!', desc: x.c.desc, tag: D.FORMS[x.c.form],
        form: x.c.form, grp: x.c.grp, sug: true, best: i === 0, tip: false, audible: true, hint: 'They look like ' + label }));
    }
    const cur = P.play, isUser = G.poss === G.userIdx;
    const pool = B.list.filter((p) => !p.clock && !p.hail && !p.sneak && p.id !== cur.id && (!isUser || PC.unlocked(G, p)));
    const vs = (p) => PC.matrix(P.call.id, p.type, G.togo);       // the offense sees the defensive look: lower = better
    const same = pool.filter((p) => p.form === cur.form).sort((a, b) => vs(a) - vs(b));
    const out = [];
    const take = (p) => { if (p && !out.some((c) => c.id === p.id)) out.push(p); };
    take(same.find((p) => p.k === 'run') || pool.filter((p) => p.k === 'run').sort((a, b) => vs(a) - vs(b))[0]);
    take(same.find((p) => p.k !== 'run') || pool.filter((p) => p.k !== 'run').sort((a, b) => vs(a) - vs(b))[0]);
    const card = (p) => ({ id: p.id, name: p.name, k: p.k, type: p.type, icon: p.icon || B.TYPE_ICONS[p.type], desc: p.desc || '', tag: B.TYPE_NAMES[p.type],
      sug: true, best: false, hint: null, tip: false, form: p.form, lv: p.lv || 1, art: art(p), audible: true });
    const cards = out.map(card);
    if (P.starEnt && P.starEnt[G.poss] >= 0) {
      const se = G.ents[P.starEnt[G.poss]];
      cards.push({ id: 'hot_star', name: 'Star Hot Route', k: 'pass', type: 'SHORT', icon: 'flame', desc: 'Quick route for ' + (se.info ? se.info.n : 'your Star') + '. He is the first read.',
        tag: 'Hot route', sug: true, best: false, hint: null, tip: false, form: cur.form, audible: true });
    }
    for (let i = 0; cards.length < 4 && i < same.length + pool.length; i++) {
      const p = i < same.length ? same[i] : pool.slice().sort((a, b) => vs(a) - vs(b))[i - same.length];
      if (p && !cards.some((c) => c.id === p.id)) cards.push(card(p));
    }
    if (cards.length) cards[0].best = true;
    return cards.slice(0, 4);
  };
})(globalThis.PT = globalThis.PT || {});
