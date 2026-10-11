/* Pixel Touchdown: js/ui/screens/player.js
 * Owner: WP5. Responsibility: player card (modal screen): ratings, contract, stats, actions.
 * params.pid. Shows voxel portrait (PT.Render.portrait), Stars + number, Growth letter, 10 skill bars (main skills
 * highlighted), Perks/Quirks, Wants, Mood, Pay/Years, Cut Cost, season & career stats, awards.
 * Actions (your team): Make Captain (btn-captain), Cut (btn-release), Hurt List (btn-ir), Play Hurt (btn-play-hurt),
 * Keep (btn-keep), Swap (btn-swap). Other teams: Ask for a Swap; Free agents: Make Offer.
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

  /** QA1: the same numbers Roster.release books (offseason counts next season's books; an expiring deal is free). */
  function cutCost(L, p) {
    if (!p.con) return { per: 0, years: 0 };
    const R = PT.League.Roster;
    if (R && R.cutCost) { const c = R.cutCost(L, p.id); return { per: c.years ? c.perYear : 0, years: c.years }; }
    const yrs = K().yrsLeft(p, L);
    return { per: yrs ? Math.round(p.con.sal * ((PT.C.CAP && PT.C.CAP.CUT_PCT) || 0.5)) : 0, years: yrs };
  }
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
    const acts = [];
    if (mine) {
      if (!capt) acts.push(K().btn({ label: 'Make Captain', icon: 'crown', action: 'captain', kind: 'sec', testid: 'btn-captain' }));
      if (p.pos !== 'K' && PT.League.Roster && PT.League.Roster.toggleStar) acts.push(K().btn({ label: si ? 'Remove Star' : 'Make Star', icon: 'star', action: 'star', kind: 'sec', testid: 'btn-toggle-star' }));
      if (p.inj && p.inj.w >= PT.C.ROSTER.IR_MIN_WEEKS && !p.ir) acts.push(K().btn({ label: 'Hurt List', icon: 'cross', action: 'ir', data: { on: 1 }, kind: 'sec', testid: 'btn-ir' }));
      if (p.ir) acts.push(K().btn({ label: 'Back from Hurt List', icon: 'dumbbell', action: 'ir', data: { on: 0 }, kind: 'sec', testid: 'btn-ir' }));
      // QA1: league severity is 1 Sprain · 2 Hurt · 3 Bad Hurt · 4 Season Over; only Sprain/Hurt may play hurt
      if (p.inj && p.inj.sev >= 1 && p.inj.sev <= 2 && !p.ir) acts.push(K().btn({ label: p.ph || p.inj.ph ? 'Rest him' : 'Play Hurt', icon: 'cross', action: 'play-hurt', kind: 'sec', testid: 'btn-play-hurt', title: 'He wants to help!' }));
      if (p.con && p.con.exp <= L.season && L.phase === 'RESIGN') acts.push(K().btn({ label: 'Keep', icon: 'contract', action: 'keep', kind: 'go', testid: 'btn-keep' }));
      acts.push(K().btn({ label: 'Swap', icon: 'swap', action: 'swap', kind: 'sec', testid: 'btn-swap' }));
      acts.push(K().btn({ label: 'Cut', icon: 'scissors', action: 'release', kind: 'bad', testid: 'btn-release' }));
    } else if (p.tid === PT.C.TID.FA) {
      acts.push(K().btn({ label: 'Make Offer', icon: 'pencil', action: 'offer', kind: 'go', testid: 'btn-offer' }));
    } else if (p.tid >= 0) {
      acts.push(K().btn({ label: 'Ask for Swap', icon: 'swap', action: 'swap', kind: 'sec', testid: 'btn-swap' }));
    }

    // ROUND6 0-scroll: fixed ID panel on the left + tabbed panel (Overview · Skills · Pay · Stats) on the right
    const hero = html`<section class="card pc-hero pc-side" style="${t ? K().teamVars(t) : ''}">
      <div class="pc-top">
        <div class="pc-por">${K().portrait(p, 96, col)}${p.num != null && !prospect ? html`<span class="pc-num num">#${p.num}</span>` : ''}</div>
        <div class="pc-id grow">
          <h2 class="pc-name">${K().pname(p)} ${capt ? html`<span class="capt" title="Captain">C</span>` : ''}${si ? K().starTag('Star Player') : ''}</h2>
          <div class="pc-sub">${K().posChip(p.pos)} <b>${K().posLabel(p.pos)}</b></div>
        </div>
      </div>
      <div class="pc-rate">${ovrHtml}<span class="pc-gl"><span class="tiny muted">Growth</span>${K().growth(fog && shown ? '?' : gl, { big: true })}</span></div>
      <div class="pc-sub small">${K().sp(p.sp)} ${sp ? sp.name : K().spName(p.sp)} · ${sizeWord(p.sp)} · Age ${p.age}</div>
      <div class="pc-sub small ellip">${t ? html`${K().badge(t, 's')} ` : ''}${where}</div>
    </section>`;

    const tabs = [['overview', 'Overview'], ['skills', 'Skills']].concat(p.con ? [['pay', 'Pay']] : []).concat([['stats', 'Stats']]);
    let tab = pst.tab;
    if (!tabs.some((x) => x[0] === tab)) tab = 'overview';
    const nav = p.tid >= 0 ? html`<span class="pc-nav">${K().btn({ icon: 'back', action: 'p-prev', kind: 'sec', size: 's', title: 'Previous player', testid: 'btn-prev-player' })}${K().btn({ icon: 'play', action: 'p-next', kind: 'sec', size: 's', title: 'Next player', testid: 'btn-next-player' })}</span>` : '';
    const tabBar = html`<div class="pc-tabs"><div class="tabs pc-tabs-in" role="tablist">${tabs.map((x) => html`<button type="button" role="tab" class="tab ${x[0] === tab ? 'on' : ''}" aria-selected="${x[0] === tab}" data-action="pc-tab" data-id="${x[0]}" data-testid="pc-tab-${x[0]}">${x[1]}</button>`)}</div>${nav}</div>`;

    let pane = '';
    if (tab === 'overview') {
      const chips = html`${mine || p.tid === PT.C.TID.FA ? html`${K().mood(p.mor, true)}` : ''}
        ${(!fog) && p.want ? K().want(p.want) : ''}
        ${p.inj ? K().hurt(p) : ''}
        ${p.ir ? html`<span class="chip chip-hurt">On Hurt List</span>` : ''}
        ${p.inj && p.inj.ph ? html`<span class="chip chip-gold">Playing hurt</span>` : ''}`;
      const starAb = si ? html`<div class="star-row pc-star" data-testid="pc-star"><span class="star-row-empty">${K().ic(si.icon)}</span><span class="star-row-m grow"><b>Star Player: ${si.name}</b><span class="small">${si.txt} +5 in his key skills every snap.</span></span></div>` : '';
      const traits = !fog && (p.tr || []).length ? html`<div class="pc-traits">${p.tr.slice(0, 4).map((id) => {
        const T = PT.Data.Traits && PT.Data.Traits.byId ? PT.Data.Traits.byId(id) : null;
        return html`<div class="trait-i">${K().trait(id)}<span class="tiny muted">${(T && T.desc) || ''}</span></div>`;
      })}</div>` : html`<p class="small muted">${fog ? 'Scout him to learn more.' : 'No Perks or Quirks.'}</p>`;
      // tall screens also show the key skills here (hidden on phones: the Skills tab has them all)
      const key = fog ? '' : html`<div class="pc-key"><h3>Key Skills</h3><div class="rbars">${main.map((k) => K().ratingBar(k, p.r[k], true))}</div></div>`;
      pane = html`<div class="pc-chips">${chips}${(p.alt || []).length ? html`<span class="chip">Also ${p.alt.join(', ')}</span>` : ''}</div>${starAb}${traits}${key}`;
    } else if (tab === 'skills') {
      pane = html`<div class="pc-legend tiny muted">${K().ic('star')} = matters for ${K().posLabel(p.pos)}</div>
        ${fog ? html`<p class="small muted">Scout him to see his skills. Speed: <b>${p.r.spd}</b></p>` :
          html`<div class="rbars two">${PT.C.RATINGS.slice().sort((a, b) => (main.includes(b) ? 1 : 0) - (main.includes(a) ? 1 : 0)).map((k) => K().ratingBar(k, p.r[k], main.includes(k)))}</div>`}`;
    } else if (tab === 'pay') {
      const cc = cutCost(L, p), yrs = K().yrsLeft(p, L);
      pane = html`<div class="pc-pay"><div><span class="tiny muted">Pay</span><b class="big num">${D().money(p.con.sal)}</b><span class="small">a year</span></div>
        <div><span class="tiny muted">Years</span><b class="big num">${yrs}</b><span class="small">left</span></div>
        ${p.con.rk ? html`<div>${K().chip('Rookie deal', 'blue')}</div>` : ''}</div>
        ${mine ? html`<p class="small">${cc.per ? html`Cut Cost: <b>${D().money(cc.per)}</b> a year for ${D().plural(cc.years, 'year')}.` : 'No Cut Cost.'}</p>` : ''}
        <p class="small muted pc-dr">${dr}</p>`;
    } else {
      pane = statsPane(L, p);
    }
    const body = html`<div class="pc-cols">${hero}<div class="pc-main">${tabBar}${K().card(pane, 'pc-pane pc-pane-' + tab)}</div></div>`;
    const foot = acts.length ? html`<div class="btn-row pc-acts">${acts}</div>` : '';
    D().set(el, K().layout(body, foot, 'fit nsb pc'));
  }

  function neighbors(L, pid) {
    const p = PT.League.Q.player(L, pid);
    if (!p || p.tid < 0) return null;
    const list = PT.League.Q.roster(L, p.tid).sort((a, b) => PT.C.POS.indexOf(a.pos) - PT.C.POS.indexOf(b.pos) || b.ovr - a.ovr);
    const i = list.findIndex((x) => x.id === pid);
    return { prev: list[(i - 1 + list.length) % list.length].id, next: list[(i + 1) % list.length].id };
  }

  UI.screens.player = {
    title: (p) => { const L = PT.App.L, x = L && PT.League.Q.player(L, p.pid); return x ? K().short(x) : 'Player'; },
    nav: 'roster',
    mount: mount,
    actions: {
      'pc-tab': (el) => { pst.tab = el.getAttribute('data-id'); UI.refresh(); },
      star: (el, ev, params) => {
        const L = PT.App.L, r = PT.League.Roster.toggleStar(L, L.userTid, params.pid);
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
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
      release: (el, ev, params) => {
        const L = PT.App.L, p = PT.League.Q.player(L, params.pid);
        const cc = cutCost(L, p);
        UI.Modal.open({ title: 'Cut ' + K().short(p) + '?', icon: 'scissors',
          body: html`<p>He leaves your team and goes to the Market.</p>${cc.per ? html`<p><b>Cut Cost:</b> ${D().money(cc.per)} of Team Cash ${cc.years > 1 ? html`a year for ${cc.years} years` : 'this year'}.</p>` : ''}`,
          buttons: [{ label: 'Cut', value: true, kind: 'bad', testid: 'btn-release-confirm' }, { label: 'Keep him', value: false, kind: 'cancel' }] })
          .then((ok) => {
            if (!ok) return;
            const r = PT.League.Roster.release(L, p.id);
            if (r && r.ok === false) { UI.Toast.show(r.msg || 'Could not cut him.', 'bad'); return; }
            UI.Toast.show('Bye, ' + p.fn + '!', 'info');
            if (PT.Events) PT.Events.emit('league:changed', { what: 'roster' });
            UI.back();
          });
      },
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
