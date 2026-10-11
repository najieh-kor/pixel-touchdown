/* Pixel Touchdown: js/ui/playcall.js
 * Owner: WP5. Responsibility: PT.UI.PlayCall: play card picker (offense/defense/special/PAT/4th).
 *
 *   open({ side:'O'|'D', sit, cards:PlayCard[], canTimeout, love?, fourth?:{fgPct} })
 *        → Promise<cardId | 'TIMEOUT' | 'SIM_DRIVE' | 'PUNT' | 'FG' | null>
 *   fourth({ sit, fgPct }) → Promise<'go'|'punt'|'fg'|null>          (design 8.2 / 9.7)
 *   pat({ sit })            → Promise<'kick'|'two'|null>
 *   kick({ pct })           → Promise<'auto'|null>   (shows the Auto (NN%) button; close() when the user kicks by hand)
 *   close()  isOpen()  key(ev)   state = { flip, hurry, autoDef }   (Session reads flip/hurry when calling the play)
 * Cards: 3 suggested (card.sug flags, else the first 3) + "More" (all cards, filter tabs). testids play-card-{i}
 * use the card's index in `cards`. The best card (card.best/card.hot, else the first) gets "Coach likes this".
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const PC = UI.PlayCall = UI.PlayCall || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  PC.state = PC.state || { flip: false, hurry: false, autoDef: false };
  let cur = null, autoTimer = 0, autoTick = 0, kickRes = null, stateInit = false;

  const TYPE = {
    run: ['up', 'Run'], pass: ['ball', 'Pass'], pa: ['flip', 'Fake'], screen: ['back', 'Screen'], trick: ['trick', 'Trick'],
    special: ['boot', 'Kick'], def: ['shield', 'Defense'], clock: ['clock', 'Clock']
  };
  const GROUP = { run: 'run', pass: 'pass', pa: 'pass', screen: 'pass' };

  /** pixel icon (shared with the HUD; no emoji) */
  function ic(n) { return UI.Hud && UI.Hud.icon ? UI.Hud.icon(n) : D().raw(''); }

  function layer() {
    const h = UI.Hud && UI.Hud._host ? UI.Hud._host() : globalThis.document.getElementById('hud');
    if (!h) return null;
    let l = h.querySelector('.pc-layer');
    if (!l) { l = globalThis.document.createElement('div'); l.className = 'pc-layer'; h.appendChild(l); }
    h.classList.add('on');
    return l;
  }
  function initState() {
    stateInit = true;
    const L = PT.App && PT.App.L;   // ROUND6 E: "Auto-start defense" is a main-Settings option only (no in-game chip)
    PC.state.autoDef = !!(L && L.settings && L.settings.autoDef);
  }
  /** '& 7' | '& Goal' | '& inches' (engine round 2: togo < 0.5) */
  function togoText(togo, goal) { return goal ? 'Goal' : togo < 0.5 ? 'inches' : String(Math.max(1, Math.round(togo))); }
  PC.togoText = togoText;
  function sitText(sit) {
    if (sit && (sit.two || sit.tryTwo)) return '2-PT TRY · one play';   // HUNT3 #8
    if (!sit || !sit.down) return '';
    const goal = sit.dir > 0 ? sit.y + sit.togo >= 110 : sit.y - sit.togo <= 10;
    // HUNT2 #6: ball spot from the user's side with team abbreviations (Hud.yardFor), not OWN/OPP of the offense
    const bo = sit.y != null && UI.Hud && UI.Hud.yardFor ? UI.Hud.yardFor(sit.y) : sit.ballOn;
    return PT.Util.ordinal(sit.down) + ' & ' + togoText(sit.togo, goal) + (bo ? ' · ' + bo : '');
  }

  // ---------------- mini diagrams ----------------
  // Field frame: x lateral (+ = offense's right), y depth (+ = downfield). Screen up = downfield.
  // Deep yards are squashed so short routes stay readable at card size. Works with the real PT.Data formats
  // (form + absolute waypoints, lane, blk, pull, fake; defense k:'rush'|'man'|'zone'|'fill'…) and the dev stub format.
  const SQ = (d) => (d <= 8 ? d : 8 + (d - 8) * 0.2);
  const SQD = (d) => (d <= 6 ? d : 6 + (d - 6) * 0.3);
  /** spread the crowded middle (line) a bit, keep wide-outs on the card */
  const SX = (x) => { const a = Math.abs(x), v = a < 4 ? a * 1.6 : 6.4 + (a - 4) * 0.85; return Math.sign(x) * Math.min(22.4, v); };
  const f1 = (v) => (Math.round(v * 10) / 10).toString();
  function teamCols() {
    const L = PT.App && PT.App.L, t = L ? L.teams[L.userTid] : null;
    const dd = D();
    if (!t) return { a: '#3a86ff', b: '#ffd23f' };
    // pick the brighter of the two team colors for player dots (readable on grass)
    const c = [t.col.pri, t.col.sec].sort((x, y) => dd.lum(y) - dd.lum(x));
    return { a: dd.hex(t.col.pri), b: dd.hex(c[0]) };
  }
  function ah(x0, y0, x1, y1, cls) {
    const a = Math.atan2(y1 - y0, x1 - x0), s = 2.9;
    const p = (g) => f1(x1 - Math.cos(g) * s) + ',' + f1(y1 - Math.sin(g) * s);
    return '<polygon class="' + cls + '" points="' + f1(x1) + ',' + f1(y1) + ' ' + p(a + 0.55) + ' ' + p(a - 0.55) + '"/>';
  }
  function path(pts, cls, headCls) {
    if (pts.length < 2) return '';
    const s = pts.map((q) => f1(q[0]) + ',' + f1(q[1])).join(' ');
    const n = pts.length;
    return '<polyline class="' + cls + '" points="' + s + '"/>' + (headCls ? ah(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1], headCls) : '');
  }
  function tbar(x, y, ang) {   // block "T": a short stem + bar, ang = direction (screen coords)
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const ex = x + dx * 2.6, ey = y + dy * 2.6;
    return '<line class="dg-blk" x1="' + f1(x) + '" y1="' + f1(y) + '" x2="' + f1(ex) + '" y2="' + f1(ey) + '"/>' +
      '<line class="dg-blk" x1="' + f1(ex - dy * 1.8) + '" y1="' + f1(ey + dx * 1.8) + '" x2="' + f1(ex + dy * 1.8) + '" y2="' + f1(ey - dx * 1.8) + '"/>';
  }
  function frame(inner, cols, cls, vb) {
    return '<svg class="dg ' + (cls || '') + '" viewBox="' + (vb || '-24.5 -15.5 49 24') + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="--dg-a:' + cols.a + ';--dg-b:' + cols.b + '">' +
      '<line class="dg-los" x1="-24" y1="0" x2="24" y2="0"/>' + inner + '</svg>';
  }

  /** offense play card diagram (exported as PT.UI.PlayCall.diagram) */
  function routeSvg(id, flip) {
    const P = PT.Data && PT.Data.Playbook;
    const pb = P && P.byId ? P.byId(id) : null;
    if (!pb) return '';
    const real = !pb.spots;
    const spots = pb.spots || (P.FORMS && P.FORMS[pb.form]) || null;
    if (!spots) return '';
    const fx = flip ? -1 : 1;
    const X = (x) => SX(x * fx), Yd = (y) => -SQ(y);
    const pt = (q) => [X(q[0]), Yd(q[1])];
    const cols = teamCols();
    const start = {};
    Object.keys(spots).forEach((sl) => { start[sl] = spots[sl]; });
    if (pb.motion && pb.motion.slot) start[pb.motion.slot] = pb.motion.to;
    let under = '', over = '', dots = '', top = '';
    const read0 = pb.read && pb.read[0];
    const as = pb.as || {};
    if (pb.motion && pb.motion.from) under += path([pt(pb.motion.from), pt(pb.motion.to)], 'dg-mot');
    // QB movement
    const qb = pb.qb || {};
    const q0 = start.QB || [0, -5];
    if (qb.fake && qb.fake.roll) under += path([pt(q0), pt(qb.fake.roll)], 'dg-fake', 'dg-ah-fake');
    if (qb.mesh && qb.mesh.keep) under += path(qb.mesh.keep.map(pt), 'dg-fake', 'dg-ah-fake');
    if (qb.sneak) top += path([pt(q0), pt([q0[0], 3.5])], 'dg-run', 'dg-ah-run');
    Object.keys(spots).forEach((slot) => {
      const sp = start[slot];
      const a = as[slot];
      const x = X(sp[0]), y = Yd(sp[1]);
      if (a && typeof a === 'object' && a.rt && a.rt.length) {
        const pts = real ? a.rt.map(pt) : [[x, y]].concat(a.rt.map((w) => pt([sp[0] + w[0], sp[1] + w[1]])));
        if (real && (Math.abs(pts[0][0] - x) > 0.5 || Math.abs(pts[0][1] - y) > 0.5)) pts.unshift([x, y]);
        over += path(pts, 'dg-rt' + (slot === read0 ? ' dg-hot' : ''), slot === read0 ? 'dg-ah-hot' : 'dg-ah');
      } else if (a && typeof a === 'object' && a.lane) {
        top += path(a.lane.map(pt), 'dg-run', 'dg-ah-run');
      } else if (a && typeof a === 'object' && a.fake) {
        under += path(a.fake.map(pt), 'dg-fake', 'dg-ah-fake');
      } else if (a && typeof a === 'object' && a.pull) {
        const pp = a.pull.map(pt);
        under += path(pp, 'dg-fake');
        const l = pp[pp.length - 1];
        under += tbar(l[0], l[1], -Math.PI / 2);
      } else if (a && typeof a === 'object' && a.rt == null && (a.blk != null || a.push || a.pset || a.sell || a.pre)) {
        const push = a.push === 'left' || a.push === 'out' && sp[0] < 0 ? -1 : a.push === 'right' || a.push === 'out' && sp[0] >= 0 ? 1 : a.push === 'in' ? (sp[0] < 0 ? 1 : -1) : 0;
        const ang = -Math.PI / 2 + push * 0.55 * fx;
        under += tbar(x, y - 1.6, ang);
      } else if (a === 'pb' || a === 'block' || a === 'rb' || (a && typeof a === 'object' && a.pb != null)) {
        under += tbar(x, y - 1.4, -Math.PI / 2);
      }
      dots += '<circle class="dg-o' + (slot === 'QB' ? ' dg-qb' : '') + (slot === read0 ? ' dg-o-hot' : '') + '" cx="' + f1(x) + '" cy="' + f1(y) + '" r="2.3"/>';
    });
    dots += '<ellipse class="dg-ball" cx="0" cy="0.2" rx="1.1" ry="0.75"/>';
    return frame(under + over + dots + top, cols, 'dg-off');
  }

  /** defense call diagram: offense ghosts, defenders, rush arrows, Area ovals, Buddy lines */
  function defSvg(id, flip) {
    const P = PT.Data && PT.Data.Defense;
    const d = P && P.byId ? P.byId(id) : null;
    if (!d || !d.as) return '';
    const PB = PT.Data.Playbook;
    const off = (PB && PB.FORMS && PB.FORMS.gun) || { QB: [0, -5], RB: [-2, -5], WR1: [-20, -1], WR2: [20, -1], TE: [4, -1], OL1: [-1.5, -1], OL2: [1.5, -1] };
    const base = P.BASE || { DL1: [-1.5, 1], DL2: [1.5, 1], LB1: [-3, 5], LB2: [3, 5], CB1: [-20, 6], CB2: [20, 6], S: [0, 13] };
    const AR = P.AREAS || {};
    const fx = flip ? -1 : 1;
    // R4: on defense the AI offense comes DOWN the screen, so defenders sit below the line here
    const X = (x) => SX(x * fx), Yd = (y) => Math.sign(y) * SQD(Math.abs(y));
    const pt = (q) => [X(q[0]), Yd(q[1])];
    const cols = teamCols();
    let zones = '', lines = '', dots = '';
    Object.keys(off).forEach((sl) => { const q = pt(off[sl]); dots += '<circle class="dg-ghost" cx="' + f1(q[0]) + '" cy="' + f1(q[1]) + '" r="1.8"/>'; });
    Object.keys(d.as).forEach((slot) => {
      let a = d.as[slot];
      if (a === 'rush') a = { k: 'rush' };
      if (a && a.zone && !a.k) a = { k: 'zone', z: a.zone };
      if (a && a.man && !a.k) a = { k: 'man', on: a.man };
      a = a || {};
      let at = a.at || base[slot] || [0, 6];
      if (!a.at && (slot === 'CB1' || slot === 'CB2')) { const wr = off[slot === 'CB1' ? 'WR1' : 'WR2']; at = [wr[0], a.press ? 1.5 : a.off ? 6 + a.off : 6]; }
      if (a.k === 'man' && a.on && off[a.on] && !a.at && slot !== 'CB1' && slot !== 'CB2') at = [off[a.on][0] * 0.6, at[1]];
      const p = pt(at);
      if (a.k === 'rush' || a.k === 'fillrush') {
        const tx = a.aimX != null ? a.aimX : at[0] * 0.25;
        lines += path([p, pt([tx, -3.2])], 'dg-rush', 'dg-ah-rush');
      } else if (a.k === 'zone' || (a.k === 'fill' && a.area)) {
        const z = a.z || AR[a.area];
        if (z) {
          const c = pt([z[0], z[1]]);
          const rx = Math.max(3.2, Math.abs(SX(z[0] + z[2] * 0.7) - SX(z[0] - z[2] * 0.7)) / 2), ry = Math.max(2.4, SQD(z[1] + z[2] * 0.8) - SQD(Math.max(0, z[1] - z[2] * 0.8))) / 2;
          zones += '<ellipse class="dg-zone' + (a.k === 'fill' ? ' dg-fill' : '') + '" cx="' + f1(c[0]) + '" cy="' + f1(c[1]) + '" rx="' + f1(rx) + '" ry="' + f1(Math.max(2.2, ry)) + '"/>';
          lines += path([p, c], 'dg-drop');
        }
        if (a.then && AR[a.then]) lines += path([pt([AR[a.area][0], AR[a.area][1]]), pt([AR[a.then][0], AR[a.then][1]])], 'dg-drop');
      } else if (a.k === 'man' && a.on && off[a.on]) {
        lines += path([p, pt(off[a.on])], 'dg-man');
      } else if (a.k === 'spy') {
        lines += path([p, pt([0, -4])], 'dg-man');
        zones += '<circle class="dg-spy" cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="3.4"/>';
      } else if (a.k === 'fill') {
        lines += path([p, pt([at[0], 1.5])], 'dg-rush', 'dg-ah-rush');
      } else if (a.k === 'free') {
        zones += '<ellipse class="dg-zone" cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" rx="7" ry="2.6"/>';
      }
      dots += '<rect class="dg-d" x="' + f1(p[0] - 2.1) + '" y="' + f1(p[1] - 2.1) + '" width="4.2" height="4.2" rx="1"/>';
    });
    return frame(zones + lines + dots, cols, 'dg-def', '-24.5 -7.5 49 22.5');
  }
  PC.diagram = function (id, side, flip) { return side === 'D' ? defSvg(id, flip) : routeSvg(id, flip); };

  // ---------------- cards (in-game overlay, "pk-" classes) ----------------
  // Offense playbook groups (More view tabs) and defense groups. Grouped by the play's type/k/tags.
  const OFF_GROUPS = [['all', 'All'], ['run', 'Runs'], ['short', 'Short'], ['deep', 'Deep'], ['screen', 'Screens'], ['trick', 'Trick'], ['special', 'Special']];
  const DEF_GROUPS = [['all', 'All'], ['run', 'Run Stop'], ['zone', 'Zone'], ['man', 'Man'], ['blitz', 'Blitz']];
  function playData(c, side) {
    try {
      const P = side === 'D' ? PT.Data.Defense : PT.Data.Playbook;
      return P && P.byId ? P.byId(c.id) : null;
    } catch (e) { return null; }
  }
  function groupOf(c, side) {
    const d = playData(c, side);
    const tags = (c.tags || (d && d.tags) || []).concat(c.tag ? [c.tag] : []);
    if (side === 'D') {
      const g = (d && d.grp) || c.grp || '';
      if (g === 'run' || tags.includes('run')) return 'run';
      if (g === 'area' || g === 'zone' || tags.includes('zone') || tags.includes('area')) return 'zone';
      if (g === 'rush' || g === 'blitz' || tags.includes('blitz') || tags.includes('rush')) return 'blitz';
      return 'man';
    }
    // kicks / clock plays (Field Goal on any down in range, Punt, Spike, Kneel) → Special
    if (c.k === 'special' || /^(SPECIAL|CLOCK)$/i.test(String(c.type || '')) || c.id === 'fg' || c.id === 'punt' || (d && d.clock)) return 'special';
    const ty = String((d && d.type) || c.type || '').toUpperCase();
    if (ty === 'IRUN' || ty === 'ORUN') return 'run';
    if (ty === 'SHORT') return 'short';
    if (ty === 'DEEP') return 'deep';
    if (ty === 'SCREEN') return 'screen';
    if (ty === 'PA' || ty === 'TRICK') return 'trick';
    const k = c.k || (d && d.k);
    if (k === 'run') return tags.includes('trick') ? 'trick' : 'run';
    if (k === 'screen') return 'screen';
    if (k === 'pa' || k === 'trick' || k === 'special' || tags.includes('trick')) return 'trick';
    return tags.includes('deep') ? 'deep' : 'short';
  }
  const GROUP_ICON = { run: 'up', short: 'ball', deep: 'lob', screen: 'back', trick: 'trick', zone: 'shield', man: 'eye', blitz: 'bolt', special: 'posts', all: 'plus' };
  /** card icon: the play's icon NAME from the data ('run','pass','deep','screen','trick','blitz','zone','man', …) through
   *  PT.UI.Icons (via Hud.icon); emoji / unknown icons fall back to the group icon */
  const ICON_ALIAS = { pass: 'ball', short: 'ball', run: 'up', deep: 'lob', screen: 'back', trick: 'trick', pa: 'flip', fake: 'flip',
    blitz: 'bolt', rush: 'bolt', zone: 'shield', area: 'shield', man: 'eye', buddy: 'eye', kick: 'boot', punt: 'boot', fg: 'posts', clock: 'clock' };
  function cardIcon(c, side, g) {
    const d = playData(c, side);
    const nm = String((c && c.icon) || (d && d.icon) || '');
    if (/^[a-z][a-z0-9_-]*$/i.test(nm)) {
      const I = UI.Icons;
      if (I && typeof I.has === 'function' ? I.has(nm) : false) return nm;
      if (ICON_ALIAS[nm]) return ICON_ALIAS[nm];
      return nm;
    }
    return GROUP_ICON[g] || 'ball';
  }
  const GROUP_WORD = { run: 'Run', short: 'Short', deep: 'Deep', screen: 'Screen', trick: 'Trick', zone: 'Zone', man: 'Man', blitz: 'Blitz', special: 'Special' };

  function diaHtml(c, side, big) {
    const svg = side === 'D' ? defSvg(c.id, false) : routeSvg(c.id, PC.state.flip);
    const g = groupOf(c, side);
    return svg ? html`<span class="pk-dia${big ? ' pk-dia-big' : ''}">${D().raw(svg)}</span>`
      : html`<span class="pk-dia pk-dia-ico${big ? ' pk-dia-big' : ''}">${ic(cardIcon(c, side, g))}</span>`;
  }
  /** big suggestion card (play-card-{i}); n = 1..3 keyboard number */
  function cardHtml(c, i, best, side, n) {
    // engine round 2: the 0:00 rescue tray leads with a TIMEOUT card (k special, id 'timeout')
    if (c.id === 'timeout') {
      const tl = UI.Hud && UI.Hud.timeoutsLeft ? UI.Hud.timeoutsLeft() : null;
      c = Object.assign({}, c, { icon: 'clock', name: c.name || 'Timeout', desc: c.desc || ('Stop the clock' + (tl != null ? ' · ' + tl + ' left' : '')) });
    }
    const g = c.id === 'timeout' ? 'special' : groupOf(c, side);
    const word = c.id === 'timeout' ? 'Clock' : side === 'D' && g === 'run' ? 'Run Stop' : GROUP_WORD[g] || '';
    const off = c.ok === false;      // e.g. an out-of-range FG ("Too far!") is shown but can't be called
    return html`<button type="button" class="pk-card pk-g-${g} ${best && !off ? 'pk-best' : ''} ${off ? 'pk-off' : ''} ${c.id === 'timeout' ? 'pk-card-to' : ''}" data-pact="card" data-i="${i}" data-testid="play-card-${i}" aria-label="${c.name}"${off ? D().raw(' disabled aria-disabled="true"') : ''}>
      ${best ? html`<span class="pk-coach">${ic('flame')} Coach pick</span>` : ''}
      ${diaHtml(c, side, true)}
      <span class="pk-info">
        <span class="pk-type">${ic(cardIcon(c, side, g))} ${word}</span>
        <span class="pk-name">${c.name}</span>
        ${c.desc ? html`<span class="pk-desc">${c.desc}</span>` : ''}
      </span>
      ${n ? html`<span class="pk-num" aria-hidden="true">${n}</span>` : ''}
    </button>`;
  }
  /** small playbook card in the More view (same testid scheme) */
  function miniHtml(c, i, best, side) {
    const g = groupOf(c, side);
    const off = c.ok === false;
    if (c.id === 'timeout') c = Object.assign({}, c, { icon: 'clock', name: c.name || 'Timeout' });
    return html`<button type="button" class="pk-mini pk-g-${g} ${best && !off ? 'pk-best' : ''} ${off ? 'pk-off' : ''}" data-pact="card" data-i="${i}" data-testid="play-card-${i}" aria-label="${c.name}"${off ? D().raw(' disabled aria-disabled="true"') : ''}>
      ${diaHtml(c, side, false)}<span class="pk-mini-n">${c.name}</span>${off && c.desc ? html`<span class="pk-lock">${c.desc}</span>` : ''}</button>`;
  }
  /** plays/calls not offered yet because the coach level is too low (cards carry lv; data lists carry lv) */
  function coachLvl() {
    const L = PT.App && PT.App.L;
    return (L && L.coach && L.coach.lvl) || 1;
  }
  function lockedPlays(side, cards) {
    const P = side === 'D' ? PT.Data.Defense : PT.Data.Playbook;
    if (!P || !P.list) return [];
    const have = {};
    cards.forEach((c) => { have[c.id] = 1; });
    const lv = coachLvl();
    return P.list.filter((p) => !have[p.id] && !p.clock && (p.lv || 1) > lv)
      .map((p) => ({ id: p.id, name: p.name, k: side === 'D' ? 'def' : p.k, type: p.type, grp: p.grp, tags: p.tags, lv: p.lv || 1 }))
      .sort((a, b) => a.lv - b.lv);
  }
  function lockedHtml(c, side) {
    const g = groupOf(c, side);
    return html`<div class="pk-mini pk-locked pk-g-${g}" data-testid="locked-card-${c.id}" title="Unlocks at Coach Level ${c.lv}">
      ${diaHtml(c, side, false)}<span class="pk-mini-n">${c.name}</span><span class="pk-lock">${ic('lock')} Coach Lv ${c.lv}</span></div>`;
  }
  function suggested(cards) {
    const flagged = cards.map((c, i) => ({ c: c, i: i })).filter((x) => x.c.sug);
    return (flagged.length ? flagged : cards.map((c, i) => ({ c: c, i: i }))).slice(0, 3);
  }
  function bestIdx(cards) {
    const b = cards.findIndex((c) => c.best || c.hot);
    return b >= 0 ? b : 0;
  }
  function loveText(o) {
    const lv = o.love || (o.sit && o.sit.love);
    if (!lv) return '';
    if (typeof lv === 'string') return lv;
    if (Array.isArray(lv)) return lv.slice(0, 2).map((x) => (x.name || x.k || x.type) + ' ' + Math.round((x.p > 1 ? x.p : x.p * 100)) + '%').join(' · ');
    return '';
  }

  /** engine round 2: 0:00 rescue tray (sit.rescue) shows the REAL clock, not the HUD's 0:00 */
  function rescueClock(sit) {
    // HUNT3 #2: also in the last 10 s of Q2 / Q4 when the tray is not a rescue
    if (!sit || sit.clk == null || !(sit.rescue || (sit.clk <= 10 && (sit.q === 2 || sit.q === 4)))) return '';
    return html`<span class="pk-clk" data-testid="pc-rescue-clock">${ic('clock')}<b class="num">${PT.Util.fmtClock(sit.clk)}</b> left</span>`;
  }
  function chip(label, icon, pact, testid, onState, extra, cls) {
    return html`<button type="button" class="pk-chip ${onState ? 'pk-on' : ''} ${cls || ''}" data-pact="${pact}" data-testid="${testid}" ${D().raw(extra || '')}>${icon ? html`<span class="pk-chip-ic" aria-hidden="true">${ic(icon)}</span>` : ''}<span class="pk-chip-t">${label}</span></button>`;
  }
  function sheet(cls, inner, label) {
    return html`<div class="pk-sheet ${cls}" role="dialog" aria-label="${label}">${inner}</div>`;
  }

  function render() {
    const l = layer();
    if (!l || !cur) return;
    const o = cur.o;
    const root = l.closest('.hud-root');
    if (root) root.classList.add('hud-tray-open');
    if (cur.kind === 'fourth') { l.innerHTML = String(fourthHtml(o)); show(l); return; }
    if (cur.kind === 'pat') { l.innerHTML = String(patHtml(o)); show(l); return; }
    if (cur.kind === 'audible') { l.innerHTML = String(audibleHtml(o)); show(l); return; }
    const side = o.side === 'D' ? 'D' : 'O';
    const cards = o.cards || [];
    const best = bestIdx(cards);
    // HUNT3 #2: the count Session passes (fresh g.situation()) wins; the HUD's last frame may predate a timeout
    const tos = o.tos != null ? o.tos : o.sit && o.sit.tos && UI.Hud && UI.Hud.userIdx ? o.sit.tos[UI.Hud.userIdx()] : UI.Hud && UI.Hud.timeoutsLeft ? UI.Hud.timeoutsLeft() : 3;
    const chips = side === 'O'
      ? html`${chip('Flip', 'flip', 'flip', 'btn-flip', PC.state.flip)}${chip('Hurry', 'bolt', 'hurry', 'btn-hurry', PC.state.hurry)}${o.canTimeout !== false ? chip('Timeout', 'clock', 'timeout', 'btn-timeout', false, (tos > 0 ? '' : 'disabled') + ' data-n="' + tos + '"') : ''}`
      : html`${chip('Sim drive', 'robot', 'simdrive', 'btn-sim-drive', false, '', 'pk-chip-skip')}${o.canTimeout ? chip('Timeout', 'clock', 'timeout', 'btn-timeout', false, (tos > 0 ? '' : 'disabled') + ' data-n="' + tos + '"') : ''}`;
    // special chips: 4th-down Punt/FG (resolve PUNT/FG → Session → game.fourth), else any offered Field Goal (in range,
    // any down), Spike and Kneel cards → tapping resolves that card's id (game.callPlay('fg') starts the kick flow)
    const spc = (id) => { const i = cards.findIndex((c) => c.id === id); return i >= 0 ? { c: cards[i], i: i } : null; };
    const fgC = spc('fg'), spikeC = spc('spike'), kneelC = spc('kneel');
    const fgPct = (x) => (x.c.pct != null ? x.c.pct : +((String(x.c.desc || '').match(/(\d+)\s*%/) || [])[1] || 0));
    const cardChip = (x, label, icon, testid, cls) => html`<button type="button" class="pk-chip ${cls || ''} ${x.c.ok === false ? 'pk-chip-off' : ''}" data-pact="card" data-i="${x.i}" data-testid="${testid}"${x.c.ok === false ? D().raw(' disabled aria-disabled="true" title="Too far"') : ''}><span class="pk-chip-ic" aria-hidden="true">${ic(icon)}</span><span class="pk-chip-t">${label}</span></button>`;
    const fourth = side !== 'O' ? '' : html`${o.fourth ? html`${chip('Punt', 'boot', 'punt', 'btn-4th-punt', false, '', 'pk-chip-4th')}${o.fourth.fgPct ? chip('FG ' + o.fourth.fgPct + '%', 'posts', 'fg', 'btn-4th-fg', false, '', 'pk-chip-4th pk-chip-gold') : ''}` : ''}
      ${!(o.fourth && o.fourth.fgPct) && fgC ? (fgC.c.ok !== false ? cardChip(fgC, 'FG ' + fgPct(fgC) + '%', 'posts', 'btn-fg', 'pk-chip-4th pk-chip-gold') : cardChip(fgC, 'FG Too far', 'posts', 'btn-fg', 'pk-chip-4th')) : ''}
      ${spikeC ? cardChip(spikeC, 'Spike', 'clock', 'btn-spike', 'pk-chip-4th') : ''}${kneelC ? cardChip(kneelC, 'Kneel', 'clock', 'btn-kneel', 'pk-chip-4th') : ''}`;
    const love = side === 'D' ? loveText(o) : '';
    const head = html`<div class="pk-head">
        <div class="pk-title"><b>${side === 'O' ? 'Pick a Play' : 'Pick a Defense'}</b><span class="pk-sit">${sitText(o.sit)}</span>${rescueClock(o.sit)}</div>
        <div class="pk-chips">${fourth}${chips}</div>
      </div>
      ${tipHtml(side)}${love ? html`<div class="pk-love">${ic('eye')} They love: <b>${love}</b></div>` : ''}
      ${side === 'D' && PC.state.autoDef && cur.view !== 'more' ? html`<div class="pk-auto">${ic('robot')} Auto Defense picks in a moment…</div>` : ''}`;
    if (cur.view === 'more') {
      const groups = (side === 'O' ? OFF_GROUPS : DEF_GROUPS).filter((g) => g[0] === 'all' || cards.some((c) => groupOf(c, side) === g[0]));
      if (!groups.some((g) => g[0] === cur.filter)) cur.filter = 'all';
      const list = cards.map((c, i) => ({ c: c, i: i })).filter((x) => cur.filter === 'all' || groupOf(x.c, side) === cur.filter);
      const allLocked = lockedPlays(side, cards);
      const locked = allLocked.filter((c) => cur.filter === 'all' || groupOf(c, side) === cur.filter);
      // HUNT2 #12: tab counts = plays you can call (matches "More · N plays"); locked plays get their own chip
      const countIn = (gid) => (gid === 'all' ? cards.length : cards.filter((c) => groupOf(c, side) === gid).length);
      // ZERO SCROLL: pages sized to what fits (cur.per is measured after render, see fitPage)
      const items = list.map((x) => miniHtml(x.c, x.i, x.i === best, side)).concat(locked.map((c) => lockedHtml(c, side)));
      const per = Math.max(1, cur.per || 8);
      const pages = Math.max(1, Math.ceil(items.length / per));
      cur.pages = pages;
      cur.page = Math.max(0, Math.min(pages - 1, cur.page || 0));
      const shown = items.slice(cur.page * per, cur.page * per + per);
      const pager = html`<div class="pk-pager">
          <button type="button" class="pk-tab pk-pg" data-pact="pageprev" data-testid="btn-page-prev" aria-label="Previous page" ${cur.page > 0 ? '' : D().raw('disabled')}>${ic('back')}</button>
          <span class="pk-pg-n" data-testid="page-indicator">${cur.page + 1}/${pages}</span>
          <button type="button" class="pk-tab pk-pg pk-pg-next" data-pact="pagenext" data-testid="btn-page-next" aria-label="Next page" ${cur.page < pages - 1 ? '' : D().raw('disabled')}>${ic('play')}</button></div>`;
      const headMore = html`<div class="pk-head">
          <div class="pk-title"><b>${side === 'O' ? 'Playbook' : 'Defense Calls'}</b><span class="pk-sit">${sitText(o.sit)}</span></div>
          <div class="pk-chips">${pager}<button type="button" class="pk-tab pk-back" data-pact="less" data-testid="btn-less">${ic('back')} Back</button></div></div>`;
      l.innerHTML = String(sheet('pk-more pk-side-' + side, html`${headMore}
        <div class="pk-tabsrow"><div class="pk-tabs" role="tablist">${groups.map((g) => html`<button type="button" role="tab" aria-selected="${cur.filter === g[0]}" class="pk-tab ${cur.filter === g[0] ? 'pk-on' : ''}" data-pact="filter" data-f="${g[0]}" data-testid="pc-filter-${g[0]}">${g[1]}<span class="pk-tab-n">${countIn(g[0])}</span></button>`)}
</div>${allLocked.length ? html`<span class="pk-lockn" data-testid="pc-locked-count">${ic('lock')}+${allLocked.length} locked</span>` : ''}</div>
        <div class="pk-book">${shown}</div>`, side === 'O' ? 'Playbook' : 'Defense calls'));
      show(l);
      fitPage(l);
      return;
    } else {
      const sug = suggested(cards);
      l.innerHTML = String(sheet('pk-sug pk-side-' + side, html`${head}
        <div class="pk-row">${sug.map((x, n) => cardHtml(x.c, x.i, x.i === best, side, n + 1))}
          <button type="button" class="pk-morebtn" data-pact="more" data-testid="btn-more">${ic('plus')}<span class="pk-more-t">More</span><span class="pk-more-n">${cards.length} plays</span><span class="pk-num" aria-hidden="true">4</span></button>
        </div>`, side === 'O' ? 'Pick a play' : 'Pick a defense'));
    }
    show(l);
  }
  /** measure how many mini cards fit in the book (no scrolling anywhere); re-render once when it changes */
  function fitPage(l) {
    const book = l.querySelector('.pk-book');
    const first = book && book.querySelector('.pk-mini');
    if (!book || !first || !cur.needFit) return;      // HUNT #1: size pages only on open / filter / resize, never on a page turn
    cur.needFit = false;
    const cs = globalThis.getComputedStyle(book);
    const cols = Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length);
    const gap = parseFloat(cs.rowGap || cs.gap) || 8;
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const h = book.clientHeight - padV;
    let tallest = 0;
    book.querySelectorAll('.pk-mini').forEach((m) => { tallest = Math.max(tallest, m.getBoundingClientRect().height); });
    const ch = tallest + 4;      // + the card's drop shadow (all minis share one fixed height in CSS)
    const rows = Math.max(1, Math.floor((h + gap) / (ch + gap)));
    const per = cols * rows;
    if (per !== cur.per) { cur.per = per; cur.page = 0; render(); }
  }
  function show(l) {
    const t = l.firstElementChild;
    if (t && !cur.shown) { t.classList.add('pk-enter'); cur.shown = true; }
  }
  function tipHtml(side) {
    const id = side === 'D' ? 'defense' : 'playcall';
    if (K().tipSeen(id)) return '';
    const txt = side === 'D' ? "Pick a defense. Tap TAP! when the ring turns green. Tap SURGE when it's full." : 'Tap a play, then HIKE. ' + (UI.Hud && UI.Hud.throwHint ? UI.Hud.throwHint() : 'Pull back to throw!');
    return html`<div class="pk-tip"><span aria-hidden="true">${ic('cap')}</span><span class="pk-tip-t">${txt}</span><button type="button" class="pk-chip" data-pact="tipok" data-id="${id}" data-testid="tip-ok-${id}">Got it</button></div>`;
  }

  function fourthHtml(o) {
    const sit = o.sit || {};
    return sheet('pk-small', html`
      <div class="pk-big-t">${sit.down ? PT.Util.ordinal(sit.down) + ' & ' + togoText(sit.togo == null ? 1 : sit.togo, false) : '4th Down'}!</div>
      <p class="pk-q">What do you want to do?</p>
      <div class="pk-choice">
        ${K().btn({ label: 'Go for it', icon: ic('ball'), kind: 'go', size: 'l', testid: 'btn-4th-go', data: { pact: 'go' } })}
        ${K().btn({ label: 'Punt', icon: ic('boot'), kind: 'sec', size: 'l', testid: 'btn-4th-punt', data: { pact: 'punt' } })}
        ${o.fgPct ? K().btn({ label: 'Field Goal', sub: 'Chance ' + o.fgPct + '%', icon: ic('posts'), kind: 'gold', size: 'l', testid: 'btn-4th-fg', data: { pact: 'fg' } }) : ''}
      </div>
      <p class="pk-keys"><span class="hud-kbd">G</span> go · <span class="hud-kbd">P</span> punt${o.fgPct ? D().raw(' · <span class="hud-kbd">K</span> kick') : ''}</p>`, 'Fourth down');
  }
  function audibleHtml(o) {
    const side = o.side === 'D' ? 'D' : 'O';
    const cards = (o.cards || []).slice(0, 4);
    // the look: opts.look / cards[i].look ('pass'|'run'), or the engine's card hint "They look like …"
    const hintTxt = (cards.find((c) => c.hint && /look/i.test(c.hint)) || {}).hint || '';
    const look = o.look || (cards[0] && cards[0].look) || (hintTxt.match(/look(?:s)? like\s+(.+?)[:!.]*$/i) || [])[1] || '';
    const sub = side === 'D'
      ? (look ? html`They look like <span class="pk-look">${String(look).toUpperCase()}</span>:` : html`Pick a counter:`)
      : html`Change the play:`;
    return sheet('pk-aud pk-side-' + side, html`<div class="pk-head">
        <div class="pk-title"><b>${ic('swap')} Audible!</b><span class="pk-sit">${sub}</span></div>
        <div class="pk-chips"><button type="button" class="pk-chip" data-pact="audcancel" data-testid="btn-audible-cancel">Keep it</button></div></div>
      <div class="pk-row pk-row4">${cards.map((c, i) => html`<button type="button" class="pk-mini pk-g-${groupOf(c, side)}" data-pact="audcard" data-i="${i}" data-testid="audible-card-${i}">
        ${diaHtml(c, side, false)}<span class="pk-mini-n">${c.name}</span>${c.tag ? html`<span class="pk-type pk-aud-tag">${ic(cardIcon(c, side, groupOf(c, side)))} ${c.tag}</span>` : ''}<span class="pk-num" aria-hidden="true">${i + 1}</span></button>`)}</div>`, 'Audible');
  }
  function patHtml() {
    return sheet('pk-small', html`
      <div class="pk-big-t">Bonus Points!</div>
      <p class="pk-q">Kick for 1, or try for 2?</p>
      <div class="pk-choice">
        ${K().btn({ label: 'Kick', sub: '+1 · Easy', icon: ic('boot'), kind: 'go', size: 'l', testid: 'btn-pat-kick', data: { pact: 'kick' } })}
        ${K().btn({ label: 'Go for 2', sub: '+2 · 50/50', icon: ic('two'), kind: 'gold', size: 'l', testid: 'btn-pat-two', data: { pact: 'two' } })}
      </div>`, 'Extra point');
  }

  // re-layout on resize / fullscreen / rotation (the sheet uses dvh units; re-render keeps scroll + focus sane)
  let relayT = 0;
  function relayout() {
    clearTimeout(relayT);
    relayT = setTimeout(() => {
      if (!cur) return;
      cur.needFit = true;
      render();   // the More view re-measures its page size (fitPage)
    }, 80);
  }
  if (globalThis.addEventListener) {
    globalThis.addEventListener('resize', relayout);
    globalThis.addEventListener('orientationchange', relayout);
  }
  if (globalThis.document && globalThis.document.addEventListener) {
    globalThis.document.addEventListener('fullscreenchange', relayout);
    globalThis.document.addEventListener('webkitfullscreenchange', relayout);
  }

  // ---------------- lifecycle ----------------
  function begin(kind, o) {
    if (cur) done(null);
    initState();
    return new Promise((resolve) => {
      cur = { kind: kind, o: o || {}, resolve: resolve, view: 'sug', filter: 'all', shown: false };
      if (UI.Hud && UI.Hud.setControls && UI.Hud.active && UI.Hud.active()) UI.Hud.setControls('none');
      render();
      const first = layer() && layer().querySelector('[data-testid="play-card-0"], [data-testid="btn-4th-go"], [data-testid="btn-pat-kick"]');
      if (first && PT.Input && PT.Input.lastDevice === 'kbd') { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (kind === 'call' && cur.o.side === 'D' && PC.state.autoDef) startAuto();
    });
  }
  function startAuto() {
    clearTimeout(autoTimer);
    const my = cur;
    autoTimer = setTimeout(() => {
      if (cur !== my || !cur || !PC.state.autoDef || cur.view === 'more') return;
      const cards = cur.o.cards || [];
      if (cards.length) done(cards[suggested(cards)[0].i].id);
    }, 1000);
  }
  function done(v) {
    const c = cur;
    cur = null;
    clearTimeout(autoTimer); clearInterval(autoTick);
    const l = layer();
    if (l) { l.innerHTML = ''; const root = l.closest('.hud-root'); if (root) root.classList.remove('hud-tray-open'); }
    if (c) c.resolve(v);
    if (UI.Hud && UI.Hud.flushBanners) setTimeout(() => UI.Hud.flushBanners(), 250);
  }

  /** @returns {Promise<string|null>} card id | 'TIMEOUT' | 'SIM_DRIVE' | 'PUNT' | 'FG' */
  PC.open = (o) => begin('call', o || {});
  /** @returns {Promise<'go'|'punt'|'fg'|null>} */
  PC.fourth = (o) => begin('fourth', o || {});
  /** @returns {Promise<'kick'|'two'|null>} */
  PC.pat = (o) => begin('pat', o || {});
  /**
   * Audible mini tray (STAR_ABILITIES 7). Called by PT.Session (V / AUDIBLE button) with
   * Session.audibleOptions() = { side, cards:PlayCard[4], look? }. @returns {Promise<cardId|null>}
   */
  PC.audible = function (o) {
    o = o || {};
    if (!o.cards || !o.cards.length || o.used) return Promise.resolve(null);
    // HUNT4-input #4: no setControls(old mode) restore on close; the play may have gone LIVE under the tray. Session
    // forces the real controls on close (S.ctlKey = ''), and the HUD closes this tray on 'game:snap'.
    return begin('audible', o);
  };
  /** 'call' | 'fourth' | 'pat' | 'audible' | 'kick' | null */
  PC.kind = () => (cur ? cur.kind : null);
  /** Shows the Auto (NN%) kick button. @returns {Promise<'auto'|null>} */
  PC.kick = function (o) {
    if (kickRes) { const r = kickRes; kickRes = null; r(null); }
    PC._kickPct = o && o.pct != null ? o.pct : null;
    return new Promise((resolve) => {
      kickRes = resolve;
      if (UI.Hud && UI.Hud.setControls) { UI.Hud.setControls('none'); UI.Hud.setControls('kick'); }
    });
  };
  /** Auto-kick button hook (Hud). true when a kick() promise was waiting. */
  PC._kickAuto = function () {
    if (!kickRes) return false;
    const r = kickRes; kickRes = null; PC._kickPct = null;
    if (UI.Hud && UI.Hud.setControls) UI.Hud.setControls('none');
    r('auto');
    return true;
  };
  PC.close = function () {
    if (cur) done(null);
    if (kickRes) { const r = kickRes; kickRes = null; PC._kickPct = null; r(null); }
  };
  PC.isOpen = () => !!cur;

  function pickIdx(i) {
    const cards = (cur && cur.o.cards) || [];
    if (cards[i] && cards[i].ok !== false) done(cards[i].id);
  }
  PC._act = function (t) {
    if (!cur) return;
    const a = t.getAttribute('data-pact');
    if (UI.click) UI.click(a === 'card' ? 'next' : 'tap');
    switch (a) {
      case 'card': pickIdx(+t.getAttribute('data-i')); break;
      case 'audcard': { const c = (cur.o.cards || [])[+t.getAttribute('data-i')]; done(c ? c.id : null); break; }
      case 'audcancel': done(null); break;
      case 'more': cur.view = 'more'; cur.filter = 'all'; cur.page = 0; cur.needFit = true; clearTimeout(autoTimer); render(); break;
      case 'less': cur.view = 'sug'; render(); break;
      case 'filter': cur.filter = t.getAttribute('data-f'); cur.page = 0; cur.needFit = true; render(); break;
      case 'pageprev': cur.page = Math.max(0, (cur.page || 0) - 1); render(); break;
      case 'pagenext': cur.page = Math.min((cur.pages || 1) - 1, (cur.page || 0) + 1); render(); break;
      case 'tipok': K().tipDone(t.getAttribute('data-id')); render(); break;
      case 'flip': PC.state.flip = !PC.state.flip; render(); break;
      case 'hurry': PC.state.hurry = !PC.state.hurry; render(); break;
      case 'timeout': done('TIMEOUT'); break;
      case 'simdrive': done('SIM_DRIVE'); break;
      case 'autodef':
        PC.state.autoDef = !PC.state.autoDef;
        render();
        if (PC.state.autoDef) startAuto(); else clearTimeout(autoTimer);
        break;
      case 'go': done(a); break;
      case 'kick': if (cur.kind === 'pat' && UI.Hud && UI.Hud.markXP) UI.Hud.markXP(); done(a); break;
      case 'two': if (cur.kind === 'pat' && UI.Hud && UI.Hud.markTwo) UI.Hud.markTwo(); done(a); break;
      case 'punt': done(cur.kind === 'fourth' ? 'punt' : 'PUNT'); break;
      case 'fg': done(cur.kind === 'fourth' ? 'fg' : 'FG'); break;
      default: break;
    }
  };

  /** keys while the tray is open (design 9.6 / 9.7) */
  PC.key = function (ev) {
    if (!cur) return false;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    if (cur.kind === 'fourth') {
      if (k === 'g') { done('go'); return true; }
      if (k === 'p') { done('punt'); return true; }
      if (k === 'k' && cur.o.fgPct) { done('fg'); return true; }
      return false;
    }
    if (cur.kind === 'audible') {
      if (k >= '1' && k <= '4') { const c = (cur.o.cards || [])[+k - 1]; if (c) { done(c.id); return true; } }
      if (k === 'Escape' || k === 'v') { done(null); return true; }
      return false;
    }
    if (cur.kind === 'pat') {
      if (k === '1' || k === 'k') { if (UI.Hud && UI.Hud.markXP) UI.Hud.markXP(); done('kick'); return true; }
      if (k === '2') { if (UI.Hud && UI.Hud.markTwo) UI.Hud.markTwo(); done('two'); return true; }
      return false;
    }
    const side = cur.o.side === 'D' ? 'D' : 'O';
    if (k === '1' || k === '2' || k === '3') {
      const s = cur.view === 'more' ? null : suggested(cur.o.cards || [])[+k - 1];
      if (s) { done(s.c.id); return true; }
      if (cur.view === 'more') { pickIdx(+k - 1); return true; }
    }
    if (k === '4') { cur.view = cur.view === 'more' ? 'sug' : 'more'; cur.page = 0; cur.needFit = true; render(); return true; }
    if (cur.view === 'more' && (k === 'ArrowLeft' || k === 'ArrowRight')) {
      cur.page = Math.max(0, Math.min((cur.pages || 1) - 1, (cur.page || 0) + (k === 'ArrowRight' ? 1 : -1))); render(); return true;
    }
    if (k === 't' && cur.o.canTimeout !== false && side === 'O') { done('TIMEOUT'); return true; }
    if (side === 'D' && k === 'd') { done('SIM_DRIVE'); return true; }
    if (side === 'O' && k === 'h') { PC.state.hurry = !PC.state.hurry; render(); return true; }
    if (cur.o.fourth && k === 'p') { done('PUNT'); return true; }
    if (cur.o.fourth && k === 'k' && cur.o.fourth.fgPct) { done('FG'); return true; }
    return false;
  };
})(globalThis.PT = globalThis.PT || {});
