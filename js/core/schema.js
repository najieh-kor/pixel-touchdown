/* Pixel Touchdown: js/core/schema.js
 * Owner: WP0. Responsibility: JSDoc typedefs for all schemas + PT.Schema.validate*(): validators used in tests.
 * Mirrors docs/ARCHITECTURE.md section 2 as amended by docs/RECONCILE.md. Keys starting with '_' are runtime-only and ignored.
 */

/**
 * @typedef {Object} Player
 * @property {number} id
 * @property {string} fn
 * @property {string} ln
 * @property {string} sp       species id (PT.C.SPECIES)
 * @property {string} pos      natural position, PT.C.POS
 * @property {string[]} alt    extra natural positions earned by starting (R5), e.g. ['TE']
 * @property {Object<string,number>} sg  games started per non-natural position, e.g. { TE: 2 }
 * @property {number} age
 * @property {number} tid      team id or PT.C.TID.*
 * @property {number} num
 * @property {Object<string,number>} r  skills (PT.C.RATINGS: spd pow mov hnd arm aim tkl cov smt kck), 1..99
 * @property {number} ovr      cached OVR at natural position
 * @property {number} pot      hidden ceiling OVR (design 4.5)
 * @property {string} gl       Growth letter 'A+'|'A'|'B'|'C'|'D' (frozen at age 25)
 * @property {string[]} tr     trait ids (PT.C.TRAITS), max 3
 * @property {number} mor      Mood 0..100
 * @property {string} want     personality, PT.C.WANTS
 * @property {boolean} ir      on the Hurt List
 * @property {{v:number, acc:(string|null)}} look   v = color scheme 0|1, acc = accessory id
 * @property {Contract|null} con
 * @property {null|{t:string,w:number,sev:number}} inj  weeks remaining; sev 1..4
 * @property {Object<string,number>} st   current season stats (non-zero keys)
 * @property {Object[]} cs     career seasons
 * @property {{s:number,a:string}[]} aw
 * @property {null|{s:number,rd:number,pk:number,t:number}} dr
 * @property {{sch:string,rank:number,sc:number}} [pr]  prospects only; sc scouting level 0..2
 */
/**
 * @typedef {Object} Contract   money in $K (Team Cash)
 * @property {number} sal  pay per season
 * @property {number} exp  last season covered (inclusive)
 * @property {number} sgn  season signed
 * @property {boolean} rk  rookie deal
 * @property {number} gtd  0..1 (design: Cut Cost = 50% × pay × yearsLeft → gtd 0.5)
 */
/**
 * @typedef {Object} StaffCoach  P1 named candidate (P0 stores plain star ints)
 * @property {string} n
 * @property {string} sp
 * @property {number} st   stars 1..5
 * @property {string} q    bonus quirk id
 */
/**
 * @typedef {Object} Team
 * @property {number} id
 * @property {string} city
 * @property {string} name
 * @property {string} abbr     3-letter short code
 * @property {string} sp       logo mascot species (cosmetic only)
 * @property {string} logo     short logo idea text
 * @property {{pri:number,sec:number,acc:number}} col
 * @property {number} conf
 * @property {number} div
 * @property {boolean} human
 * @property {number[]} roster   player ids (incl. Hurt List)
 * @property {Object<string,number[]>} dc   slot → [starter, sub1, sub2] (PT.C.SLOTS; KR: [pid])
 * @property {{off:(number|StaffCoach), def:(number|StaffCoach), grw:(number|StaffCoach)}} stf  coach stars 1..5
 * @property {{trn:number,med:number,sct:number,std:number,shop:number}} fac  levels 1..5
 * @property {{coins:number,hype:number,revS:number,expS:number,last:number}} fin  Coins + Hype 0..100
 * @property {number} spirit   Team Spirit 0..100
 * @property {number|null} capt  captain pid
 * @property {number[]} stars  Star player pids, ≤ C.STAR_MAX (8), ≥ 2 offense + ≥ 2 defense, no K (docs/ROUND6.md A)
 * @property {{off:string, def:string}} style   PT.C.OFF_STYLES / DEF_STYLES keys
 * @property {number} rival    tid
 * @property {string} clim     PT.C.CLIMATES
 * @property {string} stad     stadium name
 * @property {{s:number,amt:number}[]} dead   Cut Cost entries ($K)
 * @property {{s:number,rd:number,orig:number}[]} picks
 * @property {string} strat    AI mode 'contend'|'rebuild'|'balanced'
 * @property {number} tier     starting Stars tier 1..5 (design 15.3)
 * @property {Object[]} rec    franchise season records {s,w,l,t,res}
 */
/**
 * @typedef {Object} SchedGame
 * @property {number} gid
 * @property {number} wk
 * @property {number} h
 * @property {number} a
 * @property {number} po
 * @property {string} st  'S'|'F'|'L'
 * @property {number|null} hs
 * @property {number|null} as
 * @property {boolean} ot
 * @property {boolean} sim
 */
/**
 * @typedef {Object} League  root object (equals the save payload)
 * @property {number} v
 * @property {string} id
 * @property {number} seed
 * @property {number[]} rng
 * @property {number} created
 * @property {{n:string, sp:string, xp:number, lvl:number, sk:Object<string,number>, pts:number}} coach  (R8)
 * @property {number} diff        0 Rookie, 1 Pro, 2 Legend
 * @property {Object} settings    PT.C.SETTINGS_DEFAULT shape
 * @property {number} season
 * @property {string} phase
 * @property {number} week
 * @property {number} sub         phase sub-step (PT.C.SUB, playoff round, draft pick index, FA day)
 * @property {number} userTid
 * @property {Team[]} teams
 * @property {Player[]} players
 * @property {number} nextPid
 * @property {number} nextGid
 * @property {SchedGame[]} sched
 * @property {Object<string,BoxScore>} box
 * @property {{seeds:number[][], rd:number, champ:(number|null)}} po
 * @property {Object|null} draft
 * @property {Object|null} fa
 * @property {{pending:Object[], seen:Object}} ev
 * @property {Object[]} news
 * @property {Object} hist
 * @property {{id:string, s:number}} twist
 * @property {{goal:(null|{k:string,n:number,txt:string}), conf:number}} boss
 * @property {Object<string,number>} ach      achId → season earned
 * @property {{pts:number, spent:Object<string,number>}} scout
 * @property {Object<string,number[]>} retNums  tid → retired numbers
 */
/**
 * @typedef {Object} BoxScore
 * @property {number} gid
 * @property {number} s
 * @property {number} wk
 * @property {number} po
 * @property {number} h
 * @property {number} a
 * @property {number} hs
 * @property {number} as
 * @property {boolean} ot
 * @property {boolean} sim
 * @property {number[][]} q
 * @property {Object[]} tm
 * @property {Object<string,Object>} pl
 * @property {Object[]} sc     {q, clk, t, k, pts, txt}
 * @property {{pid:number,sev:number}[]} inj
 * @property {number|null} pog
 */
/**
 * @typedef {Object} GameTeam
 * @property {number} tid
 * @property {string} abbr
 * @property {string} city
 * @property {string} name
 * @property {string} sp
 * @property {{pri:number,sec:number,acc:number}} col
 * @property {{pid:number,n:string,num:number,pos:string,sp:string,sz:string,cs:number,r:Object,tr:string[],ovr:number,look:Object,alt:string[]}[]} pl
 * @property {Object<string,number[]>} dc   same slot shape as Team.dc, filtered to healthy
 * @property {{off:number,def:number,aggr:number}} coach   off/def = coach stars 1..5, aggr 0..1
 * @property {{pass:number, off:string, def:string}} tend   pass rate + team styles
 */
/**
 * @typedef {Object} GameConfig
 * @property {number} gid
 * @property {number} seed
 * @property {number} season
 * @property {number} week
 * @property {number} po
 * @property {boolean} neutral
 * @property {number} qLen
 * @property {number} diff
 * @property {number} userTid        -1 = AI vs AI
 * @property {{k:string,wx:number,wy:number,mph:number}} weather
 * @property {string} [twist]        season twist id
 * @property {Object} [settings]     user settings relevant to play (aimMode, easyThrow, penalties, autoDef, lefty)
 * @property {GameTeam} home
 * @property {GameTeam} away
 */
/**
 * @typedef {Object} Action  Input → Engine, one per tick, FIELD space (R9–R11)
 * @property {number} mx            move dir x, |m| ≤ 1
 * @property {number} my            move dir y
 * @property {boolean} sprint       held
 * @property {{on:boolean, tx:number, ty:number, pow:number}} aim   throw target (field yd), pow 0..1
 * @property {boolean} throw        edge: release pass
 * @property {boolean} lob          held at release → lob
 * @property {number|null} pass     Easy Throw: slot index of the badge tapped (or null)
 * @property {boolean} snap         edge: hike / GO
 * @property {boolean} juke         edge
 * @property {boolean} dive         edge
 * @property {boolean} spin         edge
 * @property {boolean} star         edge: Star Play (Super Dive / Super Jump) during defense
 * @property {number|null} starPick presnap: DEF slot index chosen as the Star (or null = keep)
 * @property {{on:boolean, dx:number, dy:number, pow:number}} kickAim   FG/XP drag-back aim (field-space dir), pow 0..1
 * @property {boolean} kick         edge: kick release
 */
/**
 * @typedef {Object} Snapshot  Engine → Render, read-only, preallocated (ARCHITECTURE 3.5 + R4/R9)
 * @property {number} tick
 * @property {string} phase
 * @property {Object[]} ents   14 × {id,pid,tm,pos,x,y,z,px,py,pz,fa,an,at,spd,ball,ctl,hi,sz}
 * @property {Object} ball     {x,y,z,px,py,pz,st,car,sp}
 * @property {number} los
 * @property {number} fd
 * @property {number} dir      offense attack direction (+1 → y=120)
 * @property {number} udir     direction the USER team attacks this half (+1/−1; camera puts it UP the screen, R4); AI vs AI: home's
 * @property {number} poss
 * @property {{on:boolean,x:number,y:number,ok:boolean,apex:number,t:number}} aim
 * @property {{on:boolean,x:number,y:number,pct:number}} kick   FG aim preview
 * @property {{idx:number, ring:string, t:number}} star   ring 'none'|'wait'|'green'|'used'
 * @property {{mode:string,fx:number,fy:number,lead:number,zoom:number,shake:number}} cam
 * @property {Object[]} fx
 * @property {number} fxSeq
 * @property {Object} hud      {q,clk,pc,down,togo,ballOn,hs,as,poss,tos,wx}
 * @property {Object|null} dbg
 */
/** @typedef {Object} InputFrame see ARCHITECTURE.md 3.7 (+ star, lob, kickAim per R9–R11) */
/** @typedef {{ok:boolean, err?:string, msg?:string}} Result */

(function (PT) {
  'use strict';

  const S = PT.Schema = PT.Schema || {};

  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isStr = (v) => typeof v === 'string';
  const isBool = (v) => typeof v === 'boolean';
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isArr = Array.isArray;

  function req(errs, cond, msg) { if (!cond) errs.push(msg); }

  /** Walk for JSON-unsafe values (undefined, functions, NaN/Infinity) outside '_' keys. */
  function jsonSafe(errs, v, path, depth) {
    if (depth > 12) return;
    if (v === undefined) { errs.push(path + ': undefined'); return; }
    if (typeof v === 'function') { errs.push(path + ': function'); return; }
    if (typeof v === 'number' && !isFinite(v)) { errs.push(path + ': non-finite number'); return; }
    if (v && typeof v === 'object') {
      if (isArr(v)) { for (let i = 0; i < v.length; i++) jsonSafe(errs, v[i], path + '[' + i + ']', depth + 1); }
      else for (const k of Object.keys(v)) { if (k[0] === '_') continue; jsonSafe(errs, v[k], path + '.' + k, depth + 1); }
    }
  }
  S.jsonSafe = function (v, path) { const e = []; jsonSafe(e, v, path || 'v', 0); return e; };

  function validateStats(errs, st, p) {
    if (!isObj(st)) { errs.push(p + ' not object'); return; }
    for (const k of Object.keys(st)) {
      if (!PT.C.STATS[k] && !['t', 's'].includes(k)) errs.push(p + '.' + k + ' unknown stat key');
      else if (!isNum(st[k])) errs.push(p + '.' + k + ' not number');
    }
  }

  S.validateContract = function (c, p) {
    const e = []; p = p || 'con';
    if (!isObj(c)) return [p + ' not object'];
    req(e, isInt(c.sal) && c.sal >= 0, p + '.sal');
    req(e, isInt(c.exp), p + '.exp');
    req(e, isInt(c.sgn), p + '.sgn');
    req(e, isBool(c.rk), p + '.rk');
    req(e, isNum(c.gtd) && c.gtd >= 0 && c.gtd <= 1, p + '.gtd');
    return e;
  };

  S.validatePlayer = function (pl, p) {
    const e = []; p = p || ('player' + (pl && pl.id != null ? '#' + pl.id : ''));
    if (!isObj(pl)) return [p + ' not object'];
    req(e, isInt(pl.id) && pl.id >= 0, p + '.id');
    req(e, isStr(pl.fn) && pl.fn.length > 0, p + '.fn');
    req(e, isStr(pl.ln), p + '.ln');
    req(e, PT.C.SPECIES.includes(pl.sp), p + '.sp ' + pl.sp);
    req(e, PT.C.POS.includes(pl.pos), p + '.pos ' + pl.pos);
    req(e, isArr(pl.alt) && pl.alt.every((x) => PT.C.POS.includes(x)), p + '.alt');
    req(e, isObj(pl.sg) && Object.keys(pl.sg).every((k) => PT.C.POS.includes(k) && isInt(pl.sg[k])), p + '.sg');
    req(e, isInt(pl.age) && pl.age >= 16 && pl.age <= 50, p + '.age');
    req(e, isInt(pl.tid) && pl.tid >= -3 && pl.tid < PT.C.NUM_TEAMS, p + '.tid');
    req(e, isInt(pl.num) && pl.num >= 0 && pl.num <= 99, p + '.num');
    if (!isObj(pl.r)) e.push(p + '.r');
    else {
      for (const k of PT.C.RATINGS) req(e, isInt(pl.r[k]) && pl.r[k] >= 1 && pl.r[k] <= 99, p + '.r.' + k + '=' + pl.r[k]);
      for (const k of Object.keys(pl.r)) req(e, PT.C.RATINGS.includes(k), p + '.r.' + k + ' unknown skill');
    }
    req(e, isInt(pl.ovr) && pl.ovr >= 1 && pl.ovr <= 99, p + '.ovr');
    req(e, isInt(pl.pot) && pl.pot >= 1 && pl.pot <= 99, p + '.pot');
    req(e, PT.C.GROWTH_LETTERS.includes(pl.gl), p + '.gl');
    req(e, isArr(pl.tr) && pl.tr.length <= PT.C.MAX_TRAITS && pl.tr.every((t) => PT.C.TRAITS.includes(t)), p + '.tr ' + JSON.stringify(pl.tr));
    req(e, isNum(pl.mor) && pl.mor >= 0 && pl.mor <= 100, p + '.mor');
    req(e, PT.C.WANTS.includes(pl.want), p + '.want');
    req(e, isBool(pl.ir), p + '.ir');
    req(e, isObj(pl.look) && (pl.look.v === 0 || pl.look.v === 1) && (pl.look.acc === null || isStr(pl.look.acc)), p + '.look');
    if (pl.con !== null) e.push.apply(e, S.validateContract(pl.con, p + '.con'));
    if (pl.tid >= 0 && pl.con === null) e.push(p + '.con missing for rostered player');
    if (pl.inj !== null) req(e, isObj(pl.inj) && isStr(pl.inj.t) && isInt(pl.inj.w) && isInt(pl.inj.sev), p + '.inj');
    if (pl.ir) req(e, pl.inj !== null && pl.tid >= 0, p + '.ir without injury/team');
    validateStats(e, pl.st, p + '.st');
    req(e, isArr(pl.cs), p + '.cs');
    req(e, isArr(pl.aw), p + '.aw');
    req(e, pl.dr === null || (isObj(pl.dr) && isInt(pl.dr.s) && isInt(pl.dr.rd) && isInt(pl.dr.pk)), p + '.dr');
    if (pl.tid === PT.C.TID.PROSPECT) req(e, isObj(pl.pr) && isStr(pl.pr.sch) && isInt(pl.pr.rank) && isInt(pl.pr.sc) && pl.pr.sc >= 0 && pl.pr.sc <= 2, p + '.pr');
    return e;
  };

  function validStaff(v) {
    return (isInt(v) && v >= 1 && v <= 5) || (isObj(v) && isInt(v.st) && v.st >= 1 && v.st <= 5 && isStr(v.n));
  }

  S.validateTeam = function (t, p) {
    const e = []; p = p || ('team' + (t && t.id != null ? '#' + t.id : ''));
    if (!isObj(t)) return [p + ' not object'];
    req(e, isInt(t.id) && t.id >= 0 && t.id < PT.C.NUM_TEAMS, p + '.id');
    req(e, isStr(t.city) && t.city.length > 0, p + '.city');
    req(e, isStr(t.name) && t.name.length > 0, p + '.name');
    req(e, isStr(t.abbr) && t.abbr.length >= 2 && t.abbr.length <= 4, p + '.abbr');
    req(e, PT.C.SPECIES.includes(t.sp), p + '.sp');
    req(e, isStr(t.logo), p + '.logo');
    req(e, isObj(t.col) && isInt(t.col.pri) && isInt(t.col.sec) && isInt(t.col.acc), p + '.col');
    req(e, isInt(t.conf) && t.conf >= 0 && t.conf < PT.C.CONFS, p + '.conf');
    req(e, isInt(t.div) && t.div >= 0 && t.div < PT.C.DIVS_PER_CONF, p + '.div');
    req(e, isBool(t.human), p + '.human');
    req(e, isArr(t.roster) && t.roster.every(isInt), p + '.roster');
    if (!isObj(t.dc)) e.push(p + '.dc');
    else {
      for (const g of Object.keys(t.dc)) {
        req(e, PT.C.SLOTS.includes(g), p + '.dc.' + g + ' unknown slot');
        req(e, isArr(t.dc[g]) && t.dc[g].every(isInt) && t.dc[g].length <= 1 + PT.C.SUBS_PER_SLOT, p + '.dc.' + g);
      }
      // a player may START in only one field slot (KR excluded)
      const starters = {};
      for (const g of PT.C.SLOTS) {
        if (g === 'KR' || !isArr(t.dc[g]) || t.dc[g][0] == null) continue;
        const pid = t.dc[g][0];
        if (starters[pid]) e.push(p + '.dc pid ' + pid + ' starts in ' + starters[pid] + ' and ' + g);
        starters[pid] = g;
      }
    }
    req(e, isObj(t.stf) && PT.C.STAFF.every((k) => validStaff(t.stf[k])), p + '.stf');
    req(e, isObj(t.fac) && PT.C.FACILITIES.every((k) => isInt(t.fac[k]) && t.fac[k] >= 1 && t.fac[k] <= 5), p + '.fac');
    req(e, isObj(t.fin) && ['coins', 'hype', 'revS', 'expS', 'last'].every((k) => isNum(t.fin[k])) && isInt(t.fin.coins), p + '.fin');
    if (isObj(t.fin)) req(e, t.fin.hype >= 0 && t.fin.hype <= 100, p + '.fin.hype');
    req(e, isNum(t.spirit) && t.spirit >= 0 && t.spirit <= 100, p + '.spirit');
    req(e, t.capt === null || isInt(t.capt), p + '.capt');
    // Stars (STAR_ABILITIES §1): League.create/hydrate always set them; older fixtures may lack the field
    if (t.stars !== undefined) req(e, isArr(t.stars) && t.stars.length <= (PT.C.STAR_MAX || 8) && t.stars.every(isInt) && new Set(t.stars).size === t.stars.length, p + '.stars');
    req(e, isObj(t.style) && PT.C.OFF_STYLES[t.style.off] && PT.C.DEF_STYLES[t.style.def], p + '.style');
    req(e, isInt(t.rival) && t.rival >= 0 && t.rival < PT.C.NUM_TEAMS && t.rival !== t.id, p + '.rival');
    req(e, PT.C.CLIMATES.includes(t.clim), p + '.clim');
    req(e, isStr(t.stad), p + '.stad');
    req(e, isArr(t.dead) && t.dead.every((d) => isInt(d.s) && isInt(d.amt)), p + '.dead');
    req(e, isArr(t.picks) && t.picks.every((k) => isInt(k.s) && isInt(k.rd) && isInt(k.orig)), p + '.picks');
    req(e, ['contend', 'rebuild', 'balanced'].includes(t.strat), p + '.strat');
    req(e, isInt(t.tier) && t.tier >= 1 && t.tier <= 5, p + '.tier');
    req(e, isArr(t.rec), p + '.rec');
    return e;
  };

  S.validateSchedGame = function (g, p) {
    const e = []; p = p || ('sched#' + (g && g.gid));
    if (!isObj(g)) return [p + ' not object'];
    req(e, isInt(g.gid), p + '.gid');
    req(e, isInt(g.wk), p + '.wk');
    req(e, isInt(g.h) && isInt(g.a) && g.h !== g.a, p + '.h/a');
    req(e, isInt(g.po) && g.po >= 0 && g.po <= PT.C.PLAYOFF_ROUNDS, p + '.po');
    req(e, ['S', 'F', 'L'].includes(g.st), p + '.st');
    if (g.st === 'F') req(e, isInt(g.hs) && isInt(g.as), p + ' final without scores');
    else req(e, g.hs === null && g.as === null, p + ' scores before final');
    req(e, isBool(g.ot), p + '.ot');
    req(e, isBool(g.sim), p + '.sim');
    return e;
  };

  S.validateBox = function (b, p) {
    const e = []; p = p || ('box#' + (b && b.gid));
    if (!isObj(b)) return [p + ' not object'];
    for (const k of ['gid', 's', 'wk', 'po', 'h', 'a', 'hs', 'as']) req(e, isInt(b[k]), p + '.' + k);
    req(e, isBool(b.ot) && isBool(b.sim), p + '.ot/sim');
    req(e, isArr(b.q) && b.q.length === 2 && b.q[0].length >= 4 && b.q[0].length === b.q[1].length, p + '.q');
    if (isArr(b.q) && b.q.length === 2) {
      const hs = b.q[0].reduce((a, c) => a + c, 0), as = b.q[1].reduce((a, c) => a + c, 0);
      req(e, hs === b.hs && as === b.as, p + ' score != sum of quarters');
    }
    if (b.c) return e;   // compact box
    req(e, isArr(b.tm) && b.tm.length === 2 && b.tm[0].tid === b.h && b.tm[1].tid === b.a, p + '.tm');
    if (isArr(b.tm)) b.tm.forEach((t, i) => { for (const k of PT.C.TEAM_STATS) req(e, isNum(t[k]), p + '.tm[' + i + '].' + k); });
    if (!isObj(b.pl)) e.push(p + '.pl');
    else for (const pid of Object.keys(b.pl)) {
      const l = b.pl[pid];
      req(e, l.t === b.h || l.t === b.a, p + '.pl.' + pid + '.t');
      validateStats(e, l, p + '.pl.' + pid);
    }
    req(e, isArr(b.sc), p + '.sc');
    req(e, isArr(b.inj) && b.inj.every((i) => isInt(i.pid) && isInt(i.sev)), p + '.inj');
    req(e, b.pog === null || isInt(b.pog), p + '.pog');
    return e;
  };

  S.validateGameTeam = function (t, p) {
    const e = []; p = p || 'gameTeam';
    if (!isObj(t)) return [p + ' not object'];
    req(e, isInt(t.tid), p + '.tid');
    req(e, isStr(t.abbr) && isStr(t.city) && isStr(t.name) && isStr(t.sp), p + ' names');
    req(e, isObj(t.col) && isInt(t.col.pri) && isInt(t.col.sec), p + '.col');
    req(e, isArr(t.pl) && t.pl.length >= 7, p + '.pl');
    const ids = new Set();
    if (isArr(t.pl)) t.pl.forEach((pl, i) => {
      const q = p + '.pl[' + i + ']';
      req(e, isInt(pl.pid) && isStr(pl.n) && isInt(pl.num) && PT.C.POS.includes(pl.pos) && PT.C.SPECIES.includes(pl.sp), q + ' fields');
      req(e, PT.C.SIZES[pl.sz] && (pl.cs === 0 || pl.cs === 1), q + ' sz/cs');
      req(e, isObj(pl.r) && PT.C.RATINGS.every((k) => isInt(pl.r[k])), q + '.r');
      req(e, isArr(pl.tr) && isInt(pl.ovr) && isObj(pl.look) && isArr(pl.alt), q + ' tr/ovr/look/alt');
      ids.add(pl.pid);
    });
    if (!isObj(t.dc)) e.push(p + '.dc');
    else {
      for (const g of Object.keys(t.dc)) {
        req(e, PT.C.SLOTS.includes(g), p + '.dc.' + g + ' unknown slot');
        req(e, isArr(t.dc[g]) && t.dc[g].every((pid) => ids.has(pid)), p + '.dc.' + g + ' references unknown pid');
      }
      for (const g of PT.C.SLOTS) req(e, isArr(t.dc[g]) && t.dc[g].length > 0, p + '.dc.' + g + ' empty');
    }
    req(e, isObj(t.coach) && isNum(t.coach.off) && isNum(t.coach.def) && isNum(t.coach.aggr), p + '.coach');
    req(e, isObj(t.tend) && isNum(t.tend.pass) && PT.C.OFF_STYLES[t.tend.off] && PT.C.DEF_STYLES[t.tend.def], p + '.tend');
    return e;
  };

  S.validateGameConfig = function (c) {
    const e = [];
    if (!isObj(c)) return ['cfg not object'];
    for (const k of ['gid', 'seed', 'season', 'week', 'po', 'qLen', 'diff', 'userTid']) req(e, isInt(c[k]), 'cfg.' + k);
    req(e, c.diff >= 0 && c.diff < PT.C.DIFFS.length, 'cfg.diff');
    req(e, isBool(c.neutral), 'cfg.neutral');
    req(e, isObj(c.weather) && PT.C.WEATHER.includes(c.weather.k) && isNum(c.weather.wx) && isNum(c.weather.wy) && isNum(c.weather.mph), 'cfg.weather');
    e.push.apply(e, S.validateGameTeam(c.home, 'cfg.home'));
    e.push.apply(e, S.validateGameTeam(c.away, 'cfg.away'));
    if (isObj(c.home) && isObj(c.away)) {
      req(e, c.home.tid !== c.away.tid, 'cfg same team');
      req(e, c.userTid === -1 || c.userTid === c.home.tid || c.userTid === c.away.tid, 'cfg.userTid not in game');
    }
    return e;
  };

  /** @param {League} L @returns {string[]} errors */
  S.validateLeague = function (L) {
    const e = [];
    if (!isObj(L)) return ['League not object'];
    req(e, L.v === PT.C.SCHEMA_VERSION, 'L.v');
    req(e, isStr(L.id), 'L.id');
    req(e, isInt(L.seed), 'L.seed');
    req(e, isArr(L.rng) && L.rng.length === 4 && L.rng.every(isInt), 'L.rng');
    req(e, isNum(L.created), 'L.created');
    req(e, isObj(L.coach) && isStr(L.coach.n) && PT.C.SPECIES.includes(L.coach.sp) && isInt(L.coach.xp) && isInt(L.coach.lvl) &&
      isObj(L.coach.sk) && isInt(L.coach.pts), 'L.coach');
    req(e, isInt(L.diff) && L.diff >= 0 && L.diff < PT.C.DIFFS.length, 'L.diff');
    req(e, isObj(L.settings) && Object.keys(PT.C.SETTINGS_DEFAULT).every((k) => k in L.settings), 'L.settings');
    req(e, isObj(L.twist) && isStr(L.twist.id) && isInt(L.twist.s), 'L.twist');
    req(e, isObj(L.boss) && isNum(L.boss.conf) && (L.boss.goal === null || (isObj(L.boss.goal) && isStr(L.boss.goal.k) && isStr(L.boss.goal.txt))), 'L.boss');
    req(e, isObj(L.ach) && Object.keys(L.ach).every((k) => isInt(L.ach[k])), 'L.ach');
    req(e, isObj(L.scout) && isInt(L.scout.pts) && isObj(L.scout.spent), 'L.scout');
    req(e, isObj(L.retNums) && Object.keys(L.retNums).every((k) => isArr(L.retNums[k])), 'L.retNums');
    req(e, isInt(L.season), 'L.season');
    req(e, PT.C.PHASE_ORDER.includes(L.phase), 'L.phase ' + L.phase);
    req(e, isInt(L.week) && L.week >= 0, 'L.week');
    req(e, isInt(L.sub) && L.sub >= 0, 'L.sub');
    req(e, isInt(L.userTid) && L.userTid >= 0 && L.userTid < PT.C.NUM_TEAMS, 'L.userTid');
    req(e, isInt(L.nextPid) && isInt(L.nextGid), 'L.nextPid/nextGid');

    if (!isArr(L.teams) || L.teams.length !== PT.C.NUM_TEAMS) e.push('L.teams length');
    if (!isArr(L.players)) e.push('L.players');
    if (e.length) return e;

    const byId = {};
    let maxPid = -1;
    L.players.forEach((pl) => {
      e.push.apply(e, S.validatePlayer(pl));
      if (byId[pl.id]) e.push('duplicate pid ' + pl.id);
      byId[pl.id] = pl;
      if (pl.id > maxPid) maxPid = pl.id;
    });
    req(e, L.nextPid > maxPid, 'L.nextPid <= max pid');

    let humans = 0;
    const onRoster = {};
    L.teams.forEach((t, i) => {
      e.push.apply(e, S.validateTeam(t));
      if (t.id !== i) e.push('team index != id at ' + i);
      if (t.human) { humans++; if (t.id !== L.userTid) e.push('human team != userTid'); }
      (t.roster || []).forEach((pid) => {
        const pl = byId[pid];
        if (!pl) e.push('team ' + t.id + ' roster has unknown pid ' + pid);
        else if (pl.tid !== t.id) e.push('pid ' + pid + ' tid ' + pl.tid + ' on roster of team ' + t.id);
        if (onRoster[pid] != null) e.push('pid ' + pid + ' on two rosters');
        onRoster[pid] = t.id;
      });
      if (t.dc) for (const g of Object.keys(t.dc)) t.dc[g].forEach((pid) => {
        if (onRoster[pid] !== t.id && !(t.roster || []).includes(pid)) e.push('team ' + t.id + ' dc.' + g + ' pid ' + pid + ' not on roster');
      });
      if (t.capt != null && !(t.roster || []).includes(t.capt)) e.push('team ' + t.id + ' captain not on roster');
      if (isArr(t.stars)) t.stars.forEach((pid) => {
        if (!(t.roster || []).includes(pid)) e.push('team ' + t.id + ' star ' + pid + ' not on roster');
      });
    });
    req(e, humans === 1, 'exactly one human team');
    L.players.forEach((pl) => {
      if (pl.tid >= 0 && onRoster[pl.id] !== pl.tid) e.push('pid ' + pl.id + ' tid ' + pl.tid + ' but not on that roster');
    });

    if (!isArr(L.sched)) e.push('L.sched');
    else {
      const gids = {};
      L.sched.forEach((g) => {
        e.push.apply(e, S.validateSchedGame(g));
        if (gids[g.gid]) e.push('duplicate gid ' + g.gid);
        gids[g.gid] = 1;
        if (g.gid >= L.nextGid) e.push('gid >= nextGid ' + g.gid);
      });
    }
    if (!isObj(L.box)) e.push('L.box');
    else for (const gid of Object.keys(L.box)) e.push.apply(e, S.validateBox(L.box[gid]));
    req(e, isObj(L.po) && isArr(L.po.seeds) && isInt(L.po.rd), 'L.po');
    req(e, L.draft === null || (isObj(L.draft) && isArr(L.draft.order) && isArr(L.draft.cls)), 'L.draft');
    req(e, L.fa === null || (isObj(L.fa) && isArr(L.fa.offers)), 'L.fa');
    req(e, isObj(L.ev) && isArr(L.ev.pending) && isObj(L.ev.seen), 'L.ev');
    req(e, isArr(L.news), 'L.news');
    req(e, isObj(L.hist) && isArr(L.hist.seasons) && isArr(L.hist.legends) && isObj(L.hist.rec), 'L.hist');

    jsonSafe(e, L, 'L', 0);
    return e;
  };
})(globalThis.PT = globalThis.PT || {});
