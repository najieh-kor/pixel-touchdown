/* Pixel Touchdown: js/ui/screens/player.js
 * Owner: WP5. Responsibility: player card (modal screen): ratings, contract, stats, actions.
 * params.pid. Shows voxel portrait (PT.Render.portrait), Stars + number, Growth letter, 10 skill bars (main skills
 * highlighted), Perks/Quirks, Wants, Mood, Pay/Years, Cut Cost, season & career stats, awards.
 * TEAM-UX: ID panel + tabs Overview (key skills, Surge, traits) · Skills · Stats · Contract; one action row:
 * Cut (btn-release, left) … Swap (btn-swap), Captain (btn-captain), Hurt List (btn-ir), Play Hurt (btn-play-hurt),
 * Keep (btn-keep) / Extend (btn-extend), Make/Remove Star (btn-toggle-star, right). Other teams: Ask for Swap; FA: Make Offer.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  // ---- adapters (feature-detect WP1/WP2 ops; fall back to a direct, minimal change + league:changed) ----
  function changed(what) { if (PT.Events) PT.Events.emit('league:changed', { what: what }); }
  function call(paths, args) {
    for (const p of paths) {
      const parts = p.split('.');
      let o = PT.League;
      for (let i = 0; i < parts.length - 1 && o; i++) o = o[parts[i]];
      const fn = o && o[parts[parts.length - 1]];
      if (typeof fn === 'function' && !fn.__stub) return { ok: true, r: fn.apply(null, args) };
    }
    return null;
  }
  UI.adapt = UI.adapt || {};
  UI.adapt.setCaptain = function (L, tid, pid) {
    const r = call(['Spirit.setCaptain', 'Roster.setCaptain'], [L, tid, pid]);
    if (r) return r.r || { ok: true };
    L.teams[tid].capt = pid; changed('captain'); return { ok: true };
  };
  UI.adapt.setIR = function (L, pid, on) {
    const r = call(['Roster.setIR', 'Injuries.setIR'], [L, pid, on]);
    if (r) return r.r || { ok: true };
    const p = PT.League.Q.player(L, pid);
    if (on && (!p.inj || p.inj.w < PT.C.ROSTER.IR_MIN_WEEKS)) return { ok: false, msg: 'Only players out 4+ weeks.' };
    p.ir = !!on; changed('ir'); return { ok: true };
  };
  UI.adapt.playHurt = function (L, pid, on) {
    const r = call(['Injuries.playHurt', 'Roster.playHurt'], [L, pid, on]);
    if (r) return r.r || { ok: true };
    const p = PT.League.Q.player(L, pid);
    if (p.inj) p.inj.ph = !!on;
    changed('hurt'); return { ok: true };
  };

  function growthShown(L, p) {
    if (p.tid === L.userTid) return p.gl;
    const t = L.teams[L.userTid];
    return t.fac && t.fac.sct >= 3 ? p.gl : '?';
  }
  function sizeWord(sp) {
    const s = PT.Data.Species && PT.Data.Species.byId ? PT.Data.Species.byId(sp) : null;
    return s ? ({ S: 'Small', M: 'Medium', L: 'Big' }[s.size] || '') : '';
  }

  const STAT_COLS = {
    QB: [['pc', 'Comp'], ['pa', 'Att'], ['py', 'Yds'], ['ptd', 'TD'], ['pi', 'Picks']],
    RB: [['ra', 'Runs'], ['ry', 'Yds'], ['rtd', 'TD'], ['rc', 'Catches'], ['rcy', 'Rec Yds']],
    WR: [['rc', 'Catches'], ['rcy', 'Yds'], ['rctd', 'TD'], ['tg', 'Targets']],
    TE: [['rc', 'Catches'], ['rcy', 'Yds'], ['rctd', 'TD'], ['tg', 'Targets']],
    OL: [['gs', 'Starts']],
    K: [['fgm', 'FG'], ['fga', 'FG Att'], ['fglg', 'Long'], ['xpm', 'XP']],
    DEF: [['tk', 'Tackles'], ['dsk', 'Sacks'], ['int', 'Picks'], ['pd', 'Breakups'], ['ff', 'FF']]
  };
  function colsFor(pos) { return STAT_COLS[pos] || STAT_COLS.DEF; }

  /** Stats tab: this season's line + a paged season table (div grid, no horizontal scroll) + awards */
  function statsPane(L, p) {
    const cols = [['s', 'Year'], ['tm', 'Team'], ['gp', 'GP']].concat(colsFor(p.pos));
    const grid = 'grid-template-columns: 50px 44px repeat(' + (cols.length - 2) + ', minmax(0, 1fr))';
    const cell = (c, i, v) => html`<span class="${i > 1 ? 'n num' : ''}">${v}</span>`;
    const row = (s, tid, st, me) => html`<div class="pc-st-r ${me ? 'me' : ''}" style="${grid}">${cols.map((c, i) =>
      cell(c, i, c[0] === 's' ? s : c[0] === 'tm' ? (tid >= 0 && L.teams[tid] ? L.teams[tid].abbr : '—') : (st[c[0]] || 0)))}</div>`;
    const rows = (p.cs || []).slice().reverse().map((c) => row(c.s, c.t, c));
    if (p.st && Object.keys(p.st).length) rows.unshift(row(L.season, p.tid, p.st, true));
    return html`<p class="statline small"><b>${L.season}:</b> ${K().statLine(p.st, p.pos)}</p>
      ${(p.aw || []).length ? html`<div class="awards-row pc-aw">${p.aw.slice(-4).map((a) => html`<span class="chip chip-gold">${K().ic('medal')} ${a.s} ${awardName(a.a)}</span>`)}</div>` : ''}
      ${rows.length ? html`<div class="pc-st"><div class="pc-st-r pc-st-h" style="${grid}">${cols.map((c, i) => html`<span class="${i > 1 ? 'n' : ''}">${c[1]}</span>`)}</div>
        ${K().pg('pcstats', rows, { cls: 'pc-st-pg' })}</div>` : html`<p class="muted small">No games yet.</p>`}`;
  }
  function awardName(a) {
    const n = { MVP: 'Top Dog', mvp: 'Top Dog', OPOY: 'Best Offense', opoy: 'Best Offense', DPOY: 'Best Defense', dpoy: 'Best Defense',
      ROY: 'Best Newbie', roy: 'Best Newbie', ALL: 'Pixel Pro Team', allLg: 'Pixel Pro Team', CHAMP: 'Pixel Bowl' };
    return n[a] || a;
  }

  const pst = { tab: 'overview' };
  function mount(el, params) {
    const L = PT.App.L;
    const p = PT.League.Q.player(L, params.pid);
    if (!p) { D().set(el, K().layout(K().empty('players', 'That player is gone.'))); return; }
    const t = p.tid >= 0 ? L.teams[p.tid] : null;
    const mine = p.tid === L.userTid;
    const col = t ? t.col.pri : 0x8a8fb3;
    const sp = PT.Data.Species && PT.Data.Species.byId ? PT.Data.Species.byId(p.sp) : null;
    const main = K().mainSkills(p.pos);
    const capt = t && t.capt === p.id;
    const gl = growthShown(L, p);
    const where = p.tid === PT.C.TID.FA ? 'Free agent' : p.tid === PT.C.TID.PROSPECT ? 'Rookie prospect' : p.tid === PT.C.TID.RETIRED ? 'Retired' : (t ? t.name : '');
    const prospect = p.tid === PT.C.TID.PROSPECT;
    let shown = null;
    if (prospect && PT.League.Draft && PT.League.Draft.board) {
      try { const b = PT.League.Draft.board(L, {}).find((x) => x.p.id === p.id); shown = b ? b.shown : null; } catch (e) { shown = null; }
    }
    const fog = prospect && p.pr && p.pr.sc < 2;
    const ovrHtml = shown && fog ? K().starsRange(shown.ovr[0], shown.ovr[1]) : K().stars(p.ovr, { big: true });

    const si = K().starInfo ? K().starInfo(L, p) : null;
    const dr = p.dr ? html`Drafted ${p.dr.s} · Round ${p.dr.rd}, Pick ${p.dr.pk}${L.teams[p.dr.t] ? ' by ' + L.teams[p.dr.t].name : ''}` : (prospect ? html`${(p.pr && p.pr.sch) || ''} · Rank #${(p.pr && p.pr.rank) || '?'}` : 'Undrafted');
    // TEAM-UX: one action row — Cut on the far left (danger), the main move (Make Star) on the far right
    const left = [], right = [];
    const slot0 = mine && t ? K().startSlot(t, p.id) || (t.dc && t.dc.K && t.dc.K[0] === p.id ? 'K' : '') : '';
    const kit = UI.parts || {};
    if (mine) {
      left.push(K().btn({ label: 'Cut', icon: 'scissors', action: 'release', kind: 'bad', size: 's', testid: 'btn-release' }));
      right.push(K().btn({ label: 'Swap', icon: 'swap', action: 'swap', kind: 'sec', size: 's', testid: 'btn-swap' }));
      if (!capt) right.push(K().btn({ label: 'Captain', icon: 'crown', action: 'captain', kind: 'sec', size: 's', testid: 'btn-captain' }));
      if (p.inj && p.inj.w >= PT.C.ROSTER.IR_MIN_WEEKS && !p.ir) right.push(K().btn({ label: 'Hurt List', icon: 'cross', action: 'ir', data: { on: 1 }, kind: 'sec', size: 's', testid: 'btn-ir' }));
      if (p.ir) right.push(K().btn({ label: 'Off Hurt List', icon: 'dumbbell', action: 'ir', data: { on: 0 }, kind: 'sec', size: 's', testid: 'btn-ir' }));
      // QA1: league severity is 1 Sprain · 2 Hurt · 3 Bad Hurt · 4 Season Over; only Sprain/Hurt may play hurt
      if (p.inj && p.inj.sev >= 1 && p.inj.sev <= 2 && !p.ir) right.push(K().btn({ label: p.ph || p.inj.ph ? 'Rest him' : 'Play Hurt', icon: 'cross', action: 'play-hurt', kind: 'sec', size: 's', testid: 'btn-play-hurt', title: 'He wants to help!' }));
      const ca = kit.contractAct ? kit.contractAct(p) : null;
      if (ca === 'keep') right.push(K().btn({ label: 'Keep', icon: 'contract', action: 'keep', kind: 'go', size: 's', testid: 'btn-keep' }));
      if (ca === 'extend') right.push(K().btn({ label: 'Extend', icon: 'contract', action: 'extend', kind: 'go', size: 's', testid: 'btn-extend' }));
      // HUNT #36: no Make Star for kickers / long-term hurt; at 8/8 it is a disabled grey button ("8/8 full")
      const sInfo = PT.League.Roster && PT.League.Roster.starInfo ? PT.League.Roster.starInfo(L, L.userTid) : null;
      const longHurt = p.ir || (p.inj && p.inj.w >= PT.C.ROSTER.IR_MIN_WEEKS);
      if (si) right.push(K().btn({ label: 'Remove Star', icon: 'star', action: 'star', kind: 'sec', size: 's', testid: 'btn-toggle-star' }));
      else if (p.pos !== 'K' && !longHurt && sInfo) {
        const full = sInfo.n >= sInfo.max;
        right.push(K().btn({ label: 'Make Star', sub: full ? sInfo.max + '/' + sInfo.max + ' full' : '', icon: 'star', action: 'star', kind: full ? 'sec' : 'gold', size: 's', testid: 'btn-toggle-star', disabled: full, title: full ? 'Remove a Star first' : '' }));
      }
    } else if (p.tid === PT.C.TID.FA) {
      right.push(K().btn({ label: 'Make Offer', icon: 'pencil', action: 'offer', kind: 'go', size: 's', testid: 'btn-offer' }));
    } else if (p.tid >= 0) {
      right.push(K().btn({ label: 'Ask for Swap', icon: 'swap', action: 'swap', kind: 'sec', size: 's', testid: 'btn-swap' }));
    }

    // TEAM-UX: ID panel (left) + one tabbed panel (Overview · Skills · Stats · Contract) — no long columns
    const hero = html`<section class="card pc2-hero" style="${t ? K().teamVars(t) : ''}">
      <div class="pc2-por">${K().portrait(p, 88, col)}${p.num != null && !prospect ? html`<span class="pc2-num num">#${p.num}</span>` : ''}</div>
      <h2 class="pc2-name">${K().pname(p)}</h2>
      <div class="pc2-tags">${K().posChip(p.pos)}<b class="pc2-pos">${K().posLabel(p.pos)}</b>${capt ? html`<span class="capt" title="Captain">C</span>` : ''}${si ? K().starTag('Star Player') : ''}</div>
      <div class="pc2-rate">${ovrHtml}</div>
      <div class="pc2-meta"><span class="pc2-gl" title="Growth">Growth ${K().growth(fog && shown ? '?' : gl)}</span><span>Age <b class="num">${p.age}</b></span></div>
      <div class="pc2-meta">${K().sp(p.sp)}<span>${sp ? sp.name : K().spName(p.sp)} · ${sizeWord(p.sp)}</span></div>
      ${mine ? '' : html`<div class="pc2-meta">${t ? K().badge(t, 's') : ''}<span>${where}</span></div>`}
      ${p.con ? html`<div class="pc2-meta pc2-con" data-testid="pc-contract">${K().ic('contract')}<span><b class="num">${D().money(p.con.sal)}</b> · ${K().yrsLeft(p, L) ? D().plural(K().yrsLeft(p, L), 'yr') + ' left' : 'ends now'}${mine && UI.parts.cutCost && UI.parts.cutCost(p).per ? html` · Cut cost <b class="num">${D().money(UI.parts.cutCost(p).per)}</b>` : ''}${p.con.rk ? ' · Rookie' : ''}</span></div>` : ''}
      ${mine ? html`<div class="pc2-meta pc2-role">${K().ic(slot0 ? 'clipboard' : 'zzz')}<span>${slot0 ? 'Starts: ' + (K().SLOT_LABEL[slot0] || slot0) : 'Bench'}</span></div>` : ''}
    </section>`;

    const tabs = [['overview', 'Overview'], ['skills', 'Skills'], ['stats', 'Stats']];   // HUNT2 #5: contract is one line on the ID card
    let tab = pst.tab;
    if (!tabs.some((x) => x[0] === tab)) tab = 'overview';
    const nav = p.tid >= 0 ? html`<span class="pc-nav">${K().btn({ icon: 'back', action: 'p-prev', kind: 'sec', size: 's', title: 'Previous player', testid: 'btn-prev-player' })}${K().btn({ icon: 'play', action: 'p-next', kind: 'sec', size: 's', title: 'Next player', testid: 'btn-next-player' })}</span>` : '';
    const tabBar = html`<div class="pc2-tabs"><div class="pc2-tabs-in" role="tablist">${tabs.map((x) => html`<button type="button" role="tab" class="pc2-tab ${x[0] === tab ? 'on' : ''}" aria-selected="${x[0] === tab}" data-action="pc-tab" data-id="${x[0]}" data-testid="pc-tab-${x[0]}">${x[1]}</button>`)}</div>${nav}</div>`;

    let pane = '';
    if (tab === 'overview') {
      const chips = html`${mine || p.tid === PT.C.TID.FA ? html`${K().mood(p.mor, true)}` : ''}
        ${(!fog) && p.want && K().WANT[p.want] ? html`<span class="chip chip-want">${K().ic(K().WANT[p.want][0])} Wants: ${K().WANT[p.want][1]}</span>` : ''}
        ${p.inj ? K().hurt(p) : ''}
        ${p.ir ? html`<span class="chip chip-hurt">On Hurt List</span>` : ''}
        ${p.inj && p.inj.ph ? html`<span class="chip chip-gold">Playing hurt</span>` : ''}
        ${(p.alt || []).length ? html`<span class="chip">Also ${p.alt.join(', ')}</span>` : ''}`;
      const starAb = si ? html`<div class="pc2-surge" data-testid="pc-star"><span class="pc2-surge-ic">${K().ic(si.icon)}</span><span class="pc2-surge-m"><b>Surge: ${si.name}</b><span>${si.txt}</span></span></div>` : '';
      const traits = !fog && (p.tr || []).length ? html`<div class="pc2-traits">${p.tr.slice(0, 4).map((id) => {
        const T = PT.Data.Traits && PT.Data.Traits.byId ? PT.Data.Traits.byId(id) : null;
        return html`<span class="pc2-trait" title="${(T && T.desc) || ''}">${K().trait(id)}</span>`;
      })}</div>` : '';
      const key = fog ? html`<p class="small muted">Scout him to learn more.</p>` : html`<div class="rbars pc2-bars">${main.map((k) => K().ratingBar(k, p.r[k], true))}</div>`;
      pane = html`<div class="pc2-chips">${chips}</div>${starAb}${key}${traits}`;
    } else if (tab === 'skills') {
      pane = fog ? html`<p class="small muted">Scout him to see his skills. Speed: <b>${p.r.spd}</b></p>` :
        html`<div class="rbars two pc2-all">${PT.C.RATINGS.slice().sort((a, b) => (main.includes(b) ? 1 : 0) - (main.includes(a) ? 1 : 0)).map((k) => K().ratingBar(k, p.r[k], main.includes(k)))}</div>
        <p class="tiny muted pc2-legend">${K().ic('star')} = key skill for ${K().posLabel(p.pos)}</p>`;
    } else {
      pane = html`${statsPane(L, p)}<p class="small muted pc-dr">${dr}</p>`;
    }
    const body = html`<div class="pc2">${hero}<div class="pc2-main">${tabBar}${K().card(pane, 'fill pc2-pane pc2-pane-' + tab)}</div></div>`;
    const foot = left.length || right.length ? html`<div class="pc2-acts">${left}<span class="grow"></span>${right}</div>` : '';
    D().set(el, K().layout(body, foot, 'fit tx pc2-lay'));
  }

  function neighbors(L, pid) {
    const p = PT.League.Q.player(L, pid);
    if (!p || p.tid < 0) return null;
    const list = PT.League.Q.roster(L, p.tid).sort((a, b) => PT.C.POS.indexOf(a.pos) - PT.C.POS.indexOf(b.pos) || b.ovr - a.ovr);
    const i = list.findIndex((x) => x.id === pid);
    return { prev: list[(i - 1 + list.length) % list.length].id, next: list[(i + 1) % list.length].id };
  }

  UI.screens.player = {
    // HUNT #47: the card shows the name; the top bar says what he is and where
    title: (p) => {
      const L = PT.App.L, x = L && PT.League.Q.player(L, p.pid);
      if (!x) return 'Player';
      const t = x.tid >= 0 ? L.teams[x.tid] : null;
      return K().posLabel(x.pos) + (t ? ' · ' + t.name : x.tid === PT.C.TID.FA ? ' · Free agent' : '');
    },
    nav: 'roster',
    mount: mount,
    actions: {
      'pc-tab': (el) => { pst.tab = el.getAttribute('data-id'); UI.refresh(); },
      star: (el, ev, params) => {
        const L = PT.App.L, r = PT.League.Roster.toggleStar(L, L.userTid, params.pid);
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
        UI.Toast.show(r && r.on ? 'Now a Star' : 'Not a Star now', r && r.on ? 'good' : 'info');
        if (PT.Events) PT.Events.emit('league:changed', { what: 'star' });
        UI.refresh();
      },
      captain: (el, ev, params) => {
        const L = PT.App.L;
        const r = UI.adapt.setCaptain(L, L.userTid, params.pid);
        UI.Toast.show(r && r.ok === false ? r.msg : 'New Captain!', r && r.ok === false ? 'bad' : 'good');
      },
      ir: (el, ev, params) => {
        const r = UI.adapt.setIR(PT.App.L, params.pid, el.getAttribute('data-on') === '1');
        if (r && r.ok === false) UI.Toast.show(r.msg, 'bad');
      },
      'play-hurt': (el, ev, params) => {
        const p = PT.League.Q.player(PT.App.L, params.pid);
        const r = UI.adapt.playHurt(PT.App.L, params.pid, !(p.ph || (p.inj && p.inj.ph)));
        if (r && r.ok === false) UI.Toast.show(r.msg || 'Not now.', 'bad');
      },
      keep: () => UI.reset('resign'),
      swap: (el, ev, params) => {
        const L = PT.App.L, p = PT.League.Q.player(L, params.pid);
        UI.go('swaps', p.tid === L.userTid ? { give: p.id } : { tid: p.tid, get: p.id });
      },
      offer: (el, ev, params) => UI.reset('market', { pid: params.pid }),
      release: (el, ev, params) => UI.parts.release(params.pid, () => UI.back()),
      extend: (el, ev, params) => UI.parts.extend(params.pid),
      'p-prev': (el, ev, params) => { const n = neighbors(PT.App.L, params.pid); if (n) UI.replace('player', { pid: n.prev }); },
      'p-next': (el, ev, params) => { const n = neighbors(PT.App.L, params.pid); if (n) UI.replace('player', { pid: n.next }); }
    },
    keys: (ev) => {
      const c = UI.current();
      if (!c) return false;
      if (ev.key === '[' || ev.key === ',') { UI.screens.player.actions['p-prev'](null, ev, c.params); return true; }
      if (ev.key === ']' || ev.key === '.') { UI.screens.player.actions['p-next'](null, ev, c.params); return true; }
      return false;
    }
  };
})(globalThis.PT = globalThis.PT || {});
