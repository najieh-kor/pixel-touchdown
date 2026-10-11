/* Pixel Touchdown: js/ui/components.js
 * Owner: WP5. Responsibility: button, card, table, tabs, ratingBar, playerRow, teamBadge, statLine (+ icons,
 * Stars, Growth, Mood, Boss face, portraits, box score). All return Raw HTML built with dom.html (escaped).
 * Words follow GAME_DESIGN 1.3 (Stars, Growth, Pay, Team Cash, Coins, Hype, Mood, Lineup, Hurt, Cut, Keep…).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const K = UI.comp = UI.comp || {};
  const D = () => UI.dom;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const raw = (s) => UI.dom.raw(s);

  // ---------------- words & icons ----------------
  K.POS_LABEL = { QB: 'Quarterback', RB: 'Runner', WR: 'Catcher', TE: 'Big Catcher', OL: 'Blocker', DL: 'Smasher',
    LB: 'Chaser', CB: 'Cover', S: 'Safety', K: 'Kicker', KR: 'Returner' };
  K.POS_JOB = { QB: 'Throws the ball', RB: 'Runs the ball', WR: 'Catches long passes', TE: 'Catches and blocks',
    OL: 'Protects the QB', DL: 'Rushes the QB', LB: 'Stops runs, covers', CB: 'Guards catchers', S: 'Last line of defense',
    K: 'Kicks and punts', KR: 'Returns kicks' };
  K.SLOT_LABEL = { QB: 'QB', RB: 'Runner', WR1: 'Catcher 1', WR2: 'Catcher 2', TE: 'Big Catcher', OL1: 'Blocker 1',
    OL2: 'Blocker 2', DL1: 'Smasher 1', DL2: 'Smasher 2', LB1: 'Chaser 1', LB2: 'Chaser 2', CB1: 'Cover 1', CB2: 'Cover 2',
    S: 'Safety', K: 'Kicker', KR: 'Returner' };
  K.WANT = { money: ['moneybag', 'Money'], fame: ['star', 'Fame'], wins: ['trophy', 'Wins'], home: ['home', 'Home'], chill: ['shades', 'Chill'] };
  K.WX = { sunny: ['sun', 'Sunny'], cloudy: ['cloud', 'Cloudy'], rain: ['rain', 'Rain'], wind: ['wind', 'Windy'], fog: ['fog', 'Fog'],
    snow: ['snow', 'Snow'], clear: ['dome', 'Dome'] };

  // ---------------- pixel icons (js/ui/icons.js) ----------------
  /**
   * K.ic(x, cls) → Raw <svg>. x = icon name ('coin', 'trophy'…), an emoji from data strings (mapped), or Raw (kept).
   * Unknown → '' (never prints an emoji).
   */
  K.ic = function (x, cls) {
    if (x == null || x === '') return '';
    if (UI.dom.isRaw(x)) return x;
    const I = UI.Icons;
    if (!I) return '';
    let name = String(x);
    if (!I.has(name)) name = I.fromEmoji(name) || '';
    return name ? raw(I.svg(name, { cls: cls })) : '';
  };
  /** clean display text from data (emoji removed) */
  K.txt = (s) => (UI.Icons ? UI.Icons.strip(s) : s);

  // ---------------- mascots & portraits of non-players (voxel heads rendered by PT.Render.portrait) ----------------
  const fakes = {};
  function fakePortrait(key, sp, col, size) {
    if (!PT.Render || !PT.Render.portrait || (PT.App && PT.App.noGL)) return '';
    const p = { id: key, sp: sp, num: null, look: { v: 0 } };
    fakes[key] = { p: p, col: col, size: size };
    try { return PT.Render.portrait(p, col, size) || ''; } catch (e) { return ''; }
  }
  /** species mascot head (inline). Falls back to a paw icon. */
  K.sp = function (id, size) {
    const sp = id || 'dog';
    const src = fakePortrait('sp-' + sp, sp, 0x8a8fb3, 64);
    if (!src) return K.ic('paw', 'ic-sp');
    return html`<img class="sp-img pixel" alt="" src="${src}" data-fk="sp-${sp}" width="${size || 64}" height="${size || 64}">`;
  };
  K.spName = function (id) {
    const s = PT.Data && PT.Data.Species && PT.Data.Species.byId ? PT.Data.Species.byId(id) : null;
    return (s && s.id === id && s.name) || (id ? id[0].toUpperCase() + id.slice(1) : '');
  };
  K.posLabel = (pos) => K.POS_LABEL[pos] || pos;

  /** small inline icons drawn with CSS (no emoji font needed) */
  K.icon = (k, cls) => K.ic(k, cls);
  K.coins = (n, cls) => html`<span class="stat stat-coin ${cls || ''}" title="Coins">${K.ic('coin')}<b class="num" data-count="${Math.round(n || 0)}">${D().coins(n)}</b></span>`;
  K.hype = (n) => html`<span class="stat stat-hype" title="Hype">${K.ic('flame')}<b class="num">${Math.round(n)}</b></span>`;
  K.spirit = (n) => html`<span class="stat stat-spirit" title="Team Spirit">${K.ic('heart')}<b class="num">${Math.round(n)}</b></span>`;
  K.cash = (k) => {
    const cls = k >= 5000 ? 'good' : k >= 1000 ? 'warn' : 'bad';
    return html`<span class="stat stat-cash ${cls}" title="Team Cash left">${K.ic('cash')}<b class="num">${D().money(k)}</b></span>`;
  };
  K.bossFaceName = (v) => (v >= 70 ? 'happy' : v >= 50 ? 'ok' : v >= 35 ? 'sad' : 'angry');
  K.bossFace = (v) => K.ic(K.bossFaceName(v));
  K.bossWord = (v) => (v >= 70 ? 'Happy' : v >= 50 ? 'Okay' : v >= 35 ? 'Worried' : 'Angry');
  K.boss = (v) => html`<span class="stat stat-boss" title="Boss: ${K.bossWord(v)}">${K.bossFace(v)}<b class="num">${Math.round(v)}</b></span>`;

  // ---------------- Stars / Growth / Mood ----------------
  /** design 4.4: player OVR → stars 0.5..5 */
  K.starsOf = function (ovr) {
    const T = [[92, 5], [87, 4.5], [82, 4], [77, 3.5], [71, 3], [65, 2.5], [58, 2], [50, 1.5], [40, 1]];
    for (const [min, s] of T) if (ovr >= min) return s;
    return 0.5;
  };
  /** design 4.4: team OVR → stars 1..5 */
  K.teamStarsOf = function (ovr) {
    const T = [[80, 5], [77, 4.5], [74, 4], [72, 3.5], [70, 3], [68, 2.5], [66, 2], [64, 1.5]];
    for (const [min, s] of T) if (ovr >= min) return s;
    return 1;
  };
  /** visual pixel stars + small grey number (design: 3.5 stars then "78") */
  K.stars = function (ovr, opts) {
    opts = opts || {};
    const v = opts.team ? K.teamStarsOf(ovr) : K.starsOf(ovr);
    return html`<span class="stars ${opts.big ? 'stars-big' : ''}" title="${v} Stars (${ovr})" role="img" aria-label="${v} stars">${K.starRow(v)}</span>${opts.noNum ? '' : html`<span class="stars-num num">${ovr}</span>`}`;
  };
  /** five pixel stars for a 0..5 value (halves allowed) */
  K.starRow = function (v) {
    const I = UI.Icons;
    let out = '';
    for (let i = 1; i <= 5; i++) out += I.svg(v >= i ? 'star' : v >= i - 0.5 ? 'star-half' : 'star-empty');
    return raw(out);
  };
  K.starsRange = function (lo, hi) {
    return html`<span class="stars-range">${K.stars(Math.round((lo + hi) / 2), { noNum: true })}<span class="stars-num num">${lo}–${hi}</span></span>`;
  };
  K.growth = function (gl, opts) {
    const g = gl || '?';
    const cls = g === '?' ? 'g-unk' : 'g-' + g.replace('+', 'p').replace('–', '').toLowerCase().slice(0, 2);
    return html`<span class="growth ${cls} ${opts && opts.big ? 'growth-big' : ''}" title="Growth">${g}</span>`;
  };
  K.moodFace = (m) => K.ic(m >= 80 ? 'happy' : m >= 50 ? 'ok' : m >= 30 ? 'meh' : 'angry');
  K.moodWord = (m) => (m >= 80 ? 'Happy' : m >= 50 ? 'Okay' : m >= 30 ? 'Meh' : 'Grumpy');
  K.mood = (m, withWord) => html`<span class="mood" title="Mood: ${K.moodWord(m)}">${K.moodFace(m)}${withWord ? raw('<span class="mood-w">' + D().esc(K.moodWord(m)) + '</span>') : ''}</span>`;
  K.want = (w) => { const x = K.WANT[w]; return x ? html`<span class="chip chip-want">${K.ic(x[0])} ${x[1]}</span>` : ''; };

  K.injuryText = function (p) {
    if (!p || !p.inj) return '';
    const I = PT.League && PT.League.Injuries;
    if (p.inj.w >= 90 || p.inj.sev >= 5) return 'Season Over';
    if (I && I.label && !I.label.__stub) { try { return I.label(p); } catch (e) { /* fall through */ } }
    return p.inj.w <= 0 ? 'Ouch' : 'Back in ' + D().plural(p.inj.w, 'week');
  };
  K.hurt = (p) => (p && p.inj ? html`<span class="chip chip-hurt" title="${p.inj.t || 'Hurt'}">${K.ic('cross')} ${K.injuryText(p)}</span>` : '');
  /** compact hurt chip for list rows: icon + weeks ("3w", "Out" for the season) — the full text is the tooltip */
  K.hurtShort = (p) => (p && p.inj ? html`<span class="chip chip-hurt chip-hurt-s" title="${K.injuryText(p)}">${K.ic('cross')}${p.inj.w >= 90 || p.inj.sev >= 5 ? 'Out' : p.inj.w > 0 ? p.inj.w + 'w' : ''}</span>` : '');

  K.posChip = function (pos) {
    const side = PT.C.OFF_POS.includes(pos) ? 'off' : pos === 'K' ? 'spc' : 'def';
    return html`<span class="pos pos-${side}" title="${K.posLabel(pos)}">${pos}</span>`;
  };

  K.trait = function (id) {
    const T = PT.Data && PT.Data.Traits && PT.Data.Traits.byId ? PT.Data.Traits.byId(id) : null;
    const name = (T && T.name) || id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    const quirk = T ? T.type === 'quirk' : ['glass_bones', 'fumbley', 'stone_hands', 'shaky_paws', 'flag_magnet', 'grumpy_gus', 'early_peak', 'wild_leg'].includes(id);
    return html`<span class="chip ${quirk ? 'chip-quirk' : 'chip-perk'}" title="${(T && T.desc) || ''}">${K.ic(quirk ? 'warn' : 'sparkle')} ${name}</span>`;
  };
  K.traits = (p) => ((p.tr || []).length ? html`<span class="traits">${p.tr.map(K.trait)}</span>` : '');

  K.chip = (text, kind, extra) => html`<span class="chip ${kind ? 'chip-' + kind : ''}" ${raw(extra || '')}>${text}</span>`;

  // ---------------- buttons ----------------
  /**
   * K.btn({ label, action, testid, kind:'go'|'pri'|'sec'|'ghost'|'bad'|'gold', size:'s'|'m'|'l'|'xl', icon, disabled, data:{}, title, cls })
   */
  K.btn = function (o) {
    const attrs = [];
    if (o.action) attrs.push('data-action="' + D().esc(o.action) + '"');
    if (o.testid) attrs.push('data-testid="' + D().esc(o.testid) + '"');
    if (o.title) attrs.push('title="' + D().esc(o.title) + '" aria-label="' + D().esc(o.title) + '"');
    if (o.disabled) attrs.push('disabled aria-disabled="true"');
    if (o.data) for (const k of Object.keys(o.data)) attrs.push('data-' + k + '="' + D().esc(o.data[k]) + '"');
    const cls = 'btn btn-' + (o.kind || 'sec') + ' btn-' + (o.size || 'm') + (o.cls ? ' ' + o.cls : '');
    const ic = o.icon ? K.ic(o.icon) : '';
    const icon = ic ? html`<span class="btn-ic" aria-hidden="true">${ic}</span>` : '';
    const label = o.label != null && o.label !== '' ? html`<span class="btn-t">${o.label}</span>` : '';
    const sub = o.sub ? html`<span class="btn-sub">${o.sub}</span>` : '';
    return raw('<button type="button" class="' + cls + '" ' + attrs.join(' ') + '>' + icon + label + sub + '</button>');
  };
  K.back = () => K.btn({ action: 'back', kind: 'ghost', icon: 'back', title: 'Back', testid: 'btn-back', cls: 'btn-back' });

  // ---------------- tabs ----------------
  /** K.tabs([{id,label,testid,badge}], activeId, action='tab') */
  K.tabs = function (list, active, action) {
    return html`<div class="tabs" role="tablist">${list.map((t) => raw('<button type="button" role="tab" class="tab' + (t.id === active ? ' on' : '') +
      '" aria-selected="' + (t.id === active) + '" data-action="' + D().esc(action || 'tab') + '" data-id="' + D().esc(t.id) + '"' +
      (t.testid ? ' data-testid="' + D().esc(t.testid) + '"' : '') + '>' + (t.icon ? String(K.ic(t.icon)) : '') + D().esc(K.txt(t.label)) +
      (t.badge ? '<span class="dot"></span>' : '') + '</button>'))}</div>`;
  };

  // ---------------- teams & portraits ----------------
  K.team = (tid) => { const L = PT.App && PT.App.L; return L ? L.teams[tid] : null; };
  K.teamName = (t) => (t ? t.name : '');
  K.teamFull = (t) => (t ? t.city + ' ' + t.name : '');
  K.teamVars = function (t) {
    if (!t) return '';
    const pri = D().hex(t.col.pri), sec = D().hex(t.col.sec);
    return '--t-pri:' + pri + ';--t-sec:' + sec + ';--t-pri-ink:' + D().inkOn(t.col.pri) + ';--t-sec-ink:' + D().inkOn(t.col.sec);
  };
  /** blocky logo tile: team colors + mascot animal + abbr. size 's'|'m'|'l'|'xl' */
  K.badge = function (t, size) {
    if (!t) return '';
    const src = fakePortrait('tb-' + t.id, t.sp, { pri: t.col.pri, sec: t.col.sec }, 96);
    const art = src ? html`<img class="badge-img" alt="" src="${src}" data-fk="tb-${t.id}">` : html`<span class="badge-sp">${K.ic('paw')}</span>`;
    return html`<span class="badge badge-${size || 'm'}" style="${K.teamVars(t)}" title="${K.teamFull(t)}">${art}<span class="badge-ab">${t.abbr}</span></span>`;
  };
  K.teamOvr = function (tid) {
    const L = PT.App.L;
    try { return PT.League.Q.teamOvr(L, tid).ovr; } catch (e) { return 60; }
  };

  /** voxel portrait <img> (PT.Render.portrait) with species emoji fallback */
  K.portrait = function (p, size, teamCol) {
    size = size || 64;
    if (!p) return '';
    let col = teamCol;
    if (col == null) {
      const L = PT.App && PT.App.L, t = L && p.tid >= 0 ? L.teams[p.tid] : null;
      col = t ? t.col.pri : 0x8a8fb3;
    }
    let src = '';
    try { if (PT.Render && PT.Render.portrait) src = PT.Render.portrait(p, col, size) || ''; } catch (e) { src = ''; }
    const st = 'width:' + size + 'px;height:' + size + 'px;--pc:' + D().hex(col);
    if (!src) return html`<span class="portrait portrait-emo" style="${st}">${K.ic('paw')}</span>`;
    return html`<span class="portrait" style="${st}"><img alt="" src="${src}" data-pid="${p.id}" data-col="${col}" data-size="${size}" width="${size}" height="${size}"></span>`;
  };
  /** re-pull cached portraits after the renderer finishes one (render:portrait) */
  K.refreshPortraits = function (root) {
    if (!PT.Render || !PT.Render.portrait) return;
    D().$$('img[data-fk]', root).forEach((img) => {
      const f = fakes[img.getAttribute('data-fk')];
      if (!f) return;
      const src = PT.Render.portrait(f.p, f.col, f.size);
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
    if (!PT.App || !PT.App.L) return;
    D().$$('img[data-pid]', root).forEach((img) => {
      const p = PT.League.Q.player(PT.App.L, +img.getAttribute('data-pid'));
      if (!p) return;
      const src = PT.Render.portrait(p, +img.getAttribute('data-col'), +img.getAttribute('data-size'));
      if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
  };

  // ---------------- players ----------------
  K.pname = (p) => (p ? p.fn + ' ' + p.ln : '?');
  K.short = (p) => (p ? p.fn[0] + '. ' + p.ln : '?');
  K.mainSkills = (pos) => Object.keys((PT.C.OVR_W[pos] || {}));
  /** Seasons left on a deal, counted from the book season (QA1: in the offseason the current season is over,
   * so a deal ending next season has 1 year left, and an expiring one 0). */
  K.yrsLeft = function (p, L) {
    L = L || PT.App.L;
    if (!p || !p.con || !L) return 0;
    const Cap = PT.League && PT.League.Cap;
    const s0 = Cap && Cap.bookSeason ? Cap.bookSeason(L) : L.season;
    return Math.max(0, p.con.exp - s0 + 1);
  };
  K.payYears = function (p) {
    if (!p.con) return html`<span class="muted">No deal</span>`;
    const left = K.yrsLeft(p);
    return html`<span class="num">${D().money(p.con.sal)}</span><span class="muted"> · ${left ? D().plural(left, 'yr') : 'ending'}</span>`;
  };

  /**
   * One tappable player row. opts: { action:'player', testid, right:Raw, sub:Raw, sel:bool, slotPos, team:Team, compact }
   */
  K.playerRow = function (p, opts) {
    opts = opts || {};
    const L = PT.App.L;
    const t = opts.team || (p.tid >= 0 ? L.teams[p.tid] : null);
    const ovr = opts.ovr != null ? opts.ovr : p.ovr;
    const capt = t && t.capt === p.id;
    const testid = opts.testid === undefined ? 'player-row-' + p.id : opts.testid;
    return html`<button type="button" class="prow ${opts.sel ? 'sel' : ''} ${p.inj ? 'is-hurt' : ''} ${opts.cls || ''}" data-action="${opts.action || 'player'}" data-pid="${p.id}" ${testid ? raw('data-testid="' + D().esc(testid) + '"') : ''}>
      ${K.portrait(p, opts.compact ? 40 : 48, t ? t.col.pri : undefined)}
      <span class="prow-main">
        <span class="prow-name">${p.num != null ? raw('<span class="jersey num">#' + p.num + '</span>') : ''}${K.pname(p)}${capt ? raw(' <span class="capt" title="Captain">C</span>') : ''}${opts.noStar || !K.isStar(L, p) ? '' : K.starTag()}</span>
        <span class="prow-sub">${K.posChip(p.pos)} ${K.stars(ovr)} ${opts.sub || ''} ${p.inj ? K.hurtShort(p) : ''}</span>
      </span>
      <span class="prow-right">${opts.right || ''}</span>
    </button>`;
  };

  /** skill bar: Speed ███░░ 78 (main skills highlighted) */
  K.ratingBar = function (key, val, main, delta) {
    const nm = PT.C.RATING_NAMES[key] || key;
    const cls = val >= 85 ? 'r-elite' : val >= 70 ? 'r-good' : val >= 55 ? 'r-ok' : 'r-low';
    return html`<div class="rbar ${main ? 'main' : ''}"><span class="rbar-n">${main ? K.ic('star') : ''}${nm}</span><span class="rbar-t"><span class="rbar-f ${cls}" style="width:${Math.max(3, Math.min(100, val))}%"></span></span><b class="rbar-v num">${val}</b>${delta ? raw('<span class="delta ' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '+' : '-') + Math.abs(delta) + '</span>') : ''}</div>`;
  };

  /** one-line season stat summary by position */
  K.statLine = function (st, pos) {
    st = st || {};
    const parts = [];
    const ONE = { catches: 'catch', tackles: 'tackle', sacks: 'sack', picks: 'pick', breakups: 'breakup', 'forced fumbles': 'forced fumble' };
    const add = (k, label) => { if (st[k]) parts.push(D().int(st[k]) + ' ' + (st[k] === 1 && ONE[label] ? ONE[label] : label)); };
    if (pos === 'QB') { if (st.pa) parts.push(st.pc + '/' + st.pa); add('py', 'pass yds'); add('ptd', 'TD'); add('pi', 'picks'); add('ry', 'run yds'); }
    else if (pos === 'RB') { add('ry', 'run yds'); add('rtd', 'TD'); add('rc', 'catches'); add('rcy', 'catch yds'); }
    else if (pos === 'WR' || pos === 'TE') { add('rc', 'catches'); add('rcy', 'yds'); add('rctd', 'TD'); }
    else if (pos === 'K') { if (st.fga) parts.push(st.fgm + '/' + st.fga + ' FG'); if (st.xpa) parts.push(st.xpm + '/' + st.xpa + ' XP'); add('fglg', 'long'); }
    else { add('tk', 'tackles'); add('dsk', 'sacks'); add('int', 'picks'); add('pd', 'breakups'); add('ff', 'forced fumbles'); }
    if (!parts.length && st.gp) parts.push(D().plural(st.gp, 'game'));
    return parts.join(' · ') || 'No stats yet';
  };

  // ---------------- tables & boxes ----------------
  /** K.table(cols:[{k,label,cls,num}], rows:[{...cells as Raw|string}], opts:{rowAction, rowKey, testidPrefix}) */
  K.table = function (cols, rows, opts) {
    opts = opts || {};
    const head = html`<tr>${cols.map((c) => html`<th class="${c.cls || ''} ${c.num ? 'n' : ''}" scope="col">${c.label}</th>`)}</tr>`;
    const body = rows.map((r) => {
      const ra = opts.rowAction ? raw(' data-action="' + D().esc(opts.rowAction) + '" data-id="' + D().esc(r._id) + '" tabindex="0"' +
        (opts.testidPrefix ? ' data-testid="' + D().esc(opts.testidPrefix + r._id) + '"' : '')) : '';
      return html`<tr class="${r._cls || ''}"${ra}>${cols.map((c) => html`<td class="${c.cls || ''} ${c.num ? 'n num' : ''}">${r[c.k]}</td>`)}</tr>`;
    });
    return html`<div class="tbl-wrap"><table class="tbl ${opts.cls || ''}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };

  /** box score block (postgame + Calendar results) */
  /** Game periods of a box (INT2): 4 quarters (q[0..3]) + OT columns from q[4]; box.halves = 2-half format. */
  K.halves = function (box) { return !!(box && box.halves); };
  /** [{i, short}] columns for the line score */
  K.periods = function (box) {
    const q = (box && box.q) || [[], []], n = Math.max(q[0].length, q[1].length), out = [];
    if (K.halves(box)) out.push({ i: 0, short: '1st' }, { i: 1, short: '2nd' });
    else for (let i = 0; i < 4; i++) out.push({ i: i, short: 'Q' + (i + 1) });
    for (let i = 4; i < n; i++) if ((q[0][i] || 0) || (q[1][i] || 0) || (box && box.ot && i === 4)) out.push({ i: i, short: n > 5 ? 'OT' + (i - 3) : 'OT' });
    return out;
  };
  /** scoring-summary label for sc[].q (1–4 quarters, 5+ OT) */
  K.periodName = function (box, qn) {
    if (qn > 4) return 'OT';
    if (K.halves(box)) return qn === 1 ? '1st Half' : '2nd Half';
    return ['1st', '2nd', '3rd', '4th'][qn - 1] + ' Qtr';
  };
  K.boxScore = function (box, opts) {
    opts = opts || {};
    const L = PT.App.L;
    if (!box) return html`<p class="muted">No box score.</p>`;
    const h = L.teams[box.h], a = L.teams[box.a];
    const q = box.q || [[], []];
    const per = K.periods(box);
    const qh = per.map((x) => x.short);
    const qrow = (t, arr, sc) => html`<tr><th scope="row">${K.badge(t, 's')} ${t.abbr}</th>${per.map((x) => html`<td class="n num">${arr[x.i] == null ? 0 : arr[x.i]}</td>`)}<td class="n num tot">${sc}</td></tr>`;
    const lineScore = html`<div class="tbl-wrap"><table class="tbl tbl-line"><thead><tr><th></th>${qh.map((x) => html`<th class="n">${x}</th>`)}<th class="n">Final</th></tr></thead><tbody>${qrow(a, q[1], box.as)}${qrow(h, q[0], box.hs)}</tbody></table></div>`;
    const tl = (tid) => (box.tm || []).find((x) => x.tid === tid) || {};
    const ta = tl(box.a), th = tl(box.h);
    const trow = (label, k, fmt) => html`<tr><td class="n num">${fmt ? fmt(ta[k]) : (ta[k] || 0)}</td><th scope="row">${label}</th><td class="n num">${fmt ? fmt(th[k]) : (th[k] || 0)}</td></tr>`;
    const top = (s) => (s ? Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) : '0:00');
    const teamStats = html`<div class="tbl-wrap"><table class="tbl tbl-vs"><thead><tr><th class="n">${a.abbr}</th><th></th><th class="n">${h.abbr}</th></tr></thead><tbody>
      ${trow('Total yards', 'ty')}${trow('Pass yards', 'py')}${trow('Run yards', 'ry')}${trow('First downs', 'fd')}${trow('Turnovers', 'to')}${trow('Possession', 'top', top)}
    </tbody></table></div>`;
    const leaders = [box.a, box.h].map((tid) => {
      const lines = Object.keys(box.pl || {}).map((pid) => ({ pid: +pid, l: box.pl[pid] })).filter((x) => x.l.t === tid);
      const best = (k) => lines.filter((x) => x.l[k]).sort((x, y) => y.l[k] - x.l[k])[0];
      const out = [];
      const pass = best('py'), run = best('ry'), rec = best('rcy'), tk = best('tk');
      const nm = (pid) => K.short(PT.League.Q.player(L, pid));
      if (pass) out.push(html`<li>${K.ic('football')} ${nm(pass.pid)}: ${pass.l.pc || 0}/${pass.l.pa || 0}, ${pass.l.py} yds${pass.l.ptd ? ', ' + pass.l.ptd + ' TD' : ''}</li>`);
      if (run) out.push(html`<li>${K.ic('boot')} ${nm(run.pid)}: ${run.l.ra || 0} runs, ${run.l.ry} yds${run.l.rtd ? ', ' + run.l.rtd + ' TD' : ''}</li>`);
      if (rec) out.push(html`<li>${K.ic('glove')} ${nm(rec.pid)}: ${rec.l.rc || 0} catches, ${rec.l.rcy} yds${rec.l.rctd ? ', ' + rec.l.rctd + ' TD' : ''}</li>`);
      if (tk) out.push(html`<li>${K.ic('bolt')} ${nm(tk.pid)}: ${tk.l.tk} tackles${tk.l.dsk ? ', ' + D().plural(tk.l.dsk, 'sack') : ''}</li>`);
      const t = L.teams[tid];
      if (opts.leadMax && out.length > opts.leadMax) out.length = opts.leadMax;   // HUNT #10: short screens
      return html`<div class="box-lead card-in"><h4>${K.badge(t, 's')} ${t.name}</h4><ul>${out.length ? out : html`<li class="muted">Quiet day.</li>`}</ul></div>`;
    });
    const scoring = (!opts.noScoring || (opts.parts && opts.parts.indexOf('scoring') >= 0)) && (box.sc || []).length ? html`<div class="card-in"><h4>Scoring</h4><ul class="scoring">${box.sc.map((s) => html`<li><span class="q">${K.periodName(box, s.q)}</span> ${K.badge(L.teams[s.t], 's')} <b>${s.k}</b> <span class="muted">${s.txt || ''}</span></li>`)}</ul></div>` : '';
    // ROUND6 "0 scrolling": opts.parts picks sections ('line', 'leaders', 'team', 'scoring') for tabbed overlays
    if (opts.parts) {
      const part = { line: lineScore, leaders: html`<div class="box-grid">${leaders}</div>`, team: teamStats, scoring: scoring };
      return html`<div class="box box-parts">${opts.parts.map((k) => part[k] || '')}</div>`;
    }
    return html`<div class="box">${lineScore}<div class="box-grid">${leaders}</div>${teamStats}${scoring}</div>`;
  };

  /** HUNT #23: one difficulty table + card row for New Game and Quick Game. testid = prefix + index */
  K.DIFF = [
    { emo: 'sprout', name: 'Beginner', line: 'Learn the game.', more: 'Big aim help · more Coins · no Boss' },
    { emo: 'football', name: 'Normal', line: 'A fair fight.', more: 'The standard game' },
    { emo: 'shield', name: 'Expert', line: 'Sharp AI.', more: 'Less help · tougher Boss' },
    { emo: 'crown', name: 'Legend', line: 'For top coaches.', more: 'Smartest AI · fewer Coins' }
  ];
  K.diffCards = function (cur, testPrefix) {
    return html`<div class="diffs" role="radiogroup" aria-label="Difficulty">${K.DIFF.map((d, i) => html`<button type="button" class="diff ${cur === i ? 'on' : ''}" role="radio" aria-checked="${cur === i}" data-action="diff" data-d="${i}" data-testid="${testPrefix}${i}" title="${d.more}">
      <span class="diff-emo">${K.ic(d.emo)}</span><span class="diff-n">${d.name}</span><span class="diff-l">${d.line}</span></button>`)}</div>`;
  };
  /** HUNT #14: wrap the numbers in a sentence (scores, records, money, counts) in the number font. Text is escaped. */
  K.numify = function (txt) {
    const parts = String(txt == null ? '' : txt).split(/(\$?\d[\d,.]*(?:[\/–-]\d[\d,.]*)*[KMk]?)/);
    return html`${parts.map((p, i) => (i % 2 ? html`<span class="num">${p}</span>` : p))}`;
  };
  /** Colours for a home/away pair that always differ (same kits as the 3D game): {h, a} as '#rrggbb'.
   *  Away side = its jersey colour, or its helmet colour when the away jersey is white. */
  K.kitCols = function (homeTid, awayTid) {
    // ids (loaded league) or team defs/objects with .col (Quick Game options, no league yet)
    const L = PT.App.L;
    const ht = typeof homeTid === 'object' ? homeTid : L.teams[homeTid], at = typeof awayTid === 'object' ? awayTid : L.teams[awayTid];
    const fall = { h: D().hex(ht.col.pri), a: D().hex(at.col.pri), hn: ht.col.pri, an: at.col.pri };
    try {
      const R = PT.Render;
      if (!R || !R.Kits || !R.Kits.make) return fall;
      const k = R.Kits.make(ht.col, at.col), hk = k[0], ak = k[1];
      const WHITE = 0xF4F4F0;
      const an = ak.pri === WHITE ? ak.helm : ak.pri;
      return { h: D().hex(hk.pri), a: D().hex(an), hn: hk.pri, an: an };
    } catch (e) { return fall; }
  };

  // ---------------- layout ----------------
  /** standard screen body: scroll area + optional bottom bar (primary button) */
  K.layout = function (body, foot, cls) {
    return html`<div class="lay ${cls || ''}"><div class="scroll" data-scroll><div class="page">${body}</div></div>${foot ? html`<div class="foot"><div class="page">${foot}</div></div>` : ''}</div>`;
  };
  K.card = (inner, cls, extra) => html`<section class="card ${cls || ''}" ${raw(extra || '')}>${inner}</section>`;

  // ---------------- Star players + Surge abilities (docs/ROUND6.md A; STAR_ABILITIES.md 3) ----------------
  /** ability by kind: display name, plain-words effect, pixel icon */
  K.ABILITY = {
    magnet: { name: 'Magnet Hands', txt: 'Catches anything close. No drops.', icon: 'glove' },
    turbo: { name: 'Turbo', txt: 'Speed boost. Breaks the first tackle.', icon: 'bolt' },
    laser: { name: 'Laser', txt: 'Fast, pinpoint throws.', icon: 'target' },
    pancake: { name: 'Pancake', txt: 'Wins his block and holds it.', icon: 'brick' },
    bulldozer: { name: 'Bulldozer', txt: 'Sheds his block, bursts to the ball.', icon: 'tractor' },
    lockdown: { name: 'Lockdown', txt: 'Sticks to his man. More picks.', icon: 'lock' }
  };
  const AB_POS = { QB: 'laser', RB: 'turbo', WR: 'magnet', TE: 'magnet', OL: 'pancake', DL: 'bulldozer', LB: 'bulldozer', CB: 'lockdown', S: 'lockdown' };
  const AB_SLOT = { WR1: 'magnet', WR2: 'magnet', TE: 'magnet', RB: 'turbo', QB: 'laser', OL1: 'pancake', OL2: 'pancake',
    DL1: 'bulldozer', DL2: 'bulldozer', LB1: 'bulldozer', LB2: 'bulldozer', CB1: 'lockdown', CB2: 'lockdown', S: 'lockdown' };
  K.OFF_POS = { QB: 1, RB: 1, WR: 1, TE: 1, OL: 1 };
  /** 'off' | 'def' | '' (kickers can't be Stars) */
  K.starSide = (pos) => (pos === 'K' ? '' : K.OFF_POS[pos] ? 'off' : 'def');
  /** Surge ability kind for a position ('QB', 'OL', …) or a lineup slot ('WR1', 'OL2', …) */
  K.abilityKind = function (slotOrPos) {
    const E = PT.Engine && PT.Engine.Stars;
    return AB_POS[slotOrPos] || (E && E.KIND && E.KIND[slotOrPos]) || AB_SLOT[slotOrPos] || '';
  };
  /** the field slot a player starts at for his team ('' if he does not start) */
  K.startSlot = function (t, pid) {
    const slots = (PT.C.OFF_SLOTS || []).concat(PT.C.DEF_SLOTS || []);
    for (const s of slots) if (t.dc && t.dc[s] && t.dc[s][0] === pid) return s;
    return '';
  };
  /** a team's Star pids as an array (ROUND6: team.stars = [pid…]; old model {off, def}) */
  K.teamStars = function (t) {
    if (!t || !t.stars) return [];
    if (Array.isArray(t.stars)) return t.stars.filter((x) => x != null);
    return [t.stars.off, t.stars.def].filter((x) => x != null);
  };
  K.isStar = function (L, p) {
    if (!p || p.tid == null || p.tid < 0 || !L || !L.teams[p.tid]) return false;
    return K.teamStars(L.teams[p.tid]).indexOf(p.id) >= 0;
  };
  /** Star info for a player: {side, k, name, txt, icon} when he is one of his team's Stars, else null */
  K.starInfo = function (L, p) {
    if (!K.isStar(L, p)) return null;
    const k = K.abilityKind(p.pos) || K.abilityKind(K.startSlot(L.teams[p.tid], p.id)), a = K.ABILITY[k];
    return a ? Object.assign({ side: K.starSide(p.pos), k: k }, a) : null;
  };
  /** small gold "STAR" tag */
  K.starTag = (title) => html`<span class="star-tag" title="${title || 'Star player'}">${K.ic('star')}<b>STAR</b></span>`;
  /** icon-only STAR mark for tight chips */
  K.starMini = (title) => html`<span class="star-tag star-mini" title="${title || 'Star player'}">${K.ic('star')}</span>`;
  /** panel title; icon = pixel icon name shown before the text */
  K.h2 = (t, right, icon) => html`<div class="card-h"><h2>${icon ? K.ic(icon) : ''}${t}</h2>${right || ''}</div>`;
  K.empty = (icon, text) => html`<div class="empty"><div class="empty-emo">${K.ic(icon || 'question')}</div><p>${text}</p></div>`;
  K.meter = function (v, max, cls, label) {
    const w = Math.max(0, Math.min(100, (v / (max || 100)) * 100));
    return html`<span class="meter ${cls || ''}" role="meter" aria-valuenow="${v}" aria-valuemax="${max || 100}" aria-label="${label || ''}"><span class="meter-f" style="width:${w}%"></span></span>`;
  };

  /** the big NEXT button (label from Calendar.status). Used on HQ and every phase screen. */
  K.nextBtn = function (opts) {
    opts = opts || {};
    const F = UI.Flow;
    const lab = F ? F.label() : { text: 'Next', sub: '' };
    return K.btn({ label: lab.text, sub: lab.sub, action: 'flow-next', testid: opts.testid || 'btn-next', kind: 'go', size: 'xl', icon: lab.icon || 'play', cls: 'btn-next' + (F && F.busy ? ' busy' : ''), disabled: F && F.busy });
  };

  // ---------------- first-time coach tips (stored in prefs.tips) ----------------
  K.tipSeen = function (id) {
    try { const p = PT.Save && PT.Save.prefs ? PT.Save.prefs() : {}; return !!(p.tips && p.tips[id]); } catch (e) { return false; }
  };
  K.tipDone = function (id) {
    try {
      const p = PT.Save && PT.Save.prefs ? PT.Save.prefs() : {};
      const tips = Object.assign({}, p.tips || {}); tips[id] = 1;
      if (PT.Save && PT.Save.setPrefs) PT.Save.setPrefs({ tips: tips });
    } catch (e) { /* ignore */ }
  };
  /** tiny dismissible coach tip shown once (data-action="tip-ok" handled by the router) */
  K.tip = function (id, emoji, text) {
    if (K.tipSeen(id)) return '';
    return html`<div class="tip" role="note" data-tip="${id}"><span class="tip-coach" aria-hidden="true">${K.ic(emoji || 'cap')}</span><p class="tip-t"><b>Coach tip:</b> ${text}</p>${K.btn({ label: 'Got it', action: 'tip-ok', data: { id: id }, kind: 'ghost', size: 's', testid: 'tip-ok-' + id })}</div>`;
  };

  /** weather chip */
  K.wx = function (k, mph) {
    const w = K.WX[k] || K.WX.sunny;
    return html`<span class="chip chip-wx">${K.ic(w[0])} ${w[1]}${mph ? raw(' <span class="muted num">' + mph + ' mph</span>') : ''}</span>`;
  };

  /** confetti burst inside an element (DOM blocks; simpler with reduced motion) */
  K.confetti = function (host, n, colors) {
    const doc = globalThis.document;
    if (!host || !doc) return;
    n = UI.dom.reduced() ? Math.min(12, n || 40) : (n || 60);
    colors = colors || ['#ffd23f', '#ff5a5f', '#3a86ff', '#2ecc71', '#9b5de5', '#ff9f1c'];
    const box = doc.createElement('div');
    colors = colors || ['#ffd23f', '#ff5a5f', '#3a86ff', '#2ecc71', '#9b5de5', '#ff9f1c'];
    box.className = 'confetti' + (UI.dom.reduced() ? ' calm' : '');
    for (let i = 0; i < n; i++) {
      const c = doc.createElement('i');
      const x = (i * 37) % 100, d = (i * 53) % 900, s = 6 + (i % 4) * 2;
      c.style.cssText = 'left:' + x + '%;width:' + s + 'px;height:' + s + 'px;background:' + colors[i % colors.length] + ';animation-delay:' + d + 'ms;--dx:' + (((i * 29) % 60) - 30) + 'px;--rot:' + ((i * 97) % 720) + 'deg';
      box.appendChild(c);
    }
    host.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  };
})(globalThis.PT = globalThis.PT || {});
