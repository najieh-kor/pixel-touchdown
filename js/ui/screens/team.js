/* Pixel Touchdown: js/ui/screens/team.js
 * Owner: WP5. Responsibility: finances, facilities, staff, ticket price → in design words:
 *   'team'  Team section tabs Contracts (tab 'pay') · Style (tab 'style'); 'overview'/'players' → roster, 'lineup' → depth
 *           + the shared Team kit (UI.parts.teamStrip, pickCaptain, release, extend, cutCost) — docs/handoff/TEAM-UX.md
 *   'shop'  Shop: facilities (5 levels), coaches (3 slots, 1–5 Stars), Fan Party, Coach Skills link (design 10.11)
 *   'camp'  Training Camp: Focus players + skill (design 4.5), coaches, style (Preseason 3)
 * testids: sub-{roster|depth|pay|style} (ui.js strip), btn-captain-pick, pay-row-{pid}, pay-card, btn-pay-release,
 *          btn-pay-extend, btn-pay-keep, style-off-{id}, style-def-{id}, btn-upgrade-{fac},
 *          coach-{role}-{stars}, btn-fan-party, camp-pick-{pid}, camp-skill-{pid}-{skill}, btn-camp-train.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const C = PT.C;
  /** ROUND6: each paged row sits in a .pg-cell so its pixel frame + drop shadow count toward the measured height */
  const cells = (rows) => rows.map((r) => html`<div class="pg-cell">${r}</div>`);

  const L = () => PT.App.L;
  const me = () => L().teams[L().userTid];
  function changed(what) { if (PT.Events) PT.Events.emit('league:changed', { what: what }); }
  function safe(fn, d) { try { const v = fn(); return v == null ? d : v; } catch (e) { return d; } }

  const OFF_BLURB = { air: ['Air it out.', 'Deep + short passes'], ground: ['Pound the rock.', 'Inside runs + fakes'], west: ['Short and sure.', 'Short passes + screens'],
    trick: ['Keep them guessing.', 'Trick plays + fakes'], speed: ['Get to the edge.', 'Outside runs + screens'] };
  const DEF_BLURB = { wall: ['Nobody runs on us.', 'Stops runs'], nofly: ['Nobody throws on us.', 'Stops passes'], wild: ['Hunt the QB.', 'Rushes a lot'], think: ['Smart and tricky.', 'Fools the QB'] };
  const OFF_EMO = { air: 'plane', ground: 'tractor', west: 'target', trick: 'tophat', speed: 'bolt' };
  const DEF_EMO = { wall: 'brick', nofly: 'no', wild: 'paw', think: 'brain' };
  const FAC_EMO = { trn: 'dumbbell', med: 'cross', sct: 'scope', std: 'stadium', shop: 'bag' };
  // HUNT #51: one short line each (the full rules live in How to Play)
  const FAC_FX = {
    trn: 'Young players grow faster',
    med: 'Heal faster, get hurt less',
    sct: '+4 scout points a level',
    std: '+15% ticket Coins',
    shop: '+5 merch Coins a week'
  };
  const STAFF_EMO = { off: 'football', def: 'shield', grw: 'sprout' };
  // HUNT #33: one short line each
  const STAFF_FX = { off: '+1 Offense per level', def: '+1 Defense per level', grw: 'Young players grow faster' };   // HUNT2 #7

  // ---------------- adapters ----------------
  UI.adapt = UI.adapt || {};
  /** team style (Preseason only, design 6.2) */
  UI.adapt.setStyle = function (lg, tid, side, id) {
    const R = PT.League.Roster, T = PT.League.TeamGen;
    const fn = (R && R.setStyle) || (PT.League.Staff && PT.League.Staff.setStyle) || (T && T.setStyle);
    if (fn && !fn.__stub) return fn(lg, tid, side, id);
    const t = lg.teams[tid];
    t.style = Object.assign({}, t.style, { [side]: id }); changed('style'); return { ok: true };
  };
  /** Training Camp focus (design 4.5): picks = [{pid, skill}] */
  UI.adapt.campFocus = function (lg, tid, picks) {
    const P = PT.League.Progression;
    const fn = (P && (P.camp || P.campFocus || P.trainingCamp)) || (PT.League.Staff && PT.League.Staff.camp);
    if (fn && !fn.__stub) return fn(lg, tid, picks);
    const t = lg.teams[tid];
    if (t.campS === lg.season) return { ok: false, msg: 'Camp is done for this season.' };
    const gain = campGain();
    picks.forEach((x) => {
      const p = PT.League.Q.player(lg, x.pid);
      if (!p) return;
      const g = (p.tr || []).includes('gym_rat') ? Math.ceil(gain * 1.5) : gain;
      p.r[x.skill] = Math.min(C.SKILL_MAX || 99, p.r[x.skill] + g);
      try { p.ovr = PT.League.Ratings.ovr(p); } catch (e) { /* keep */ }
    });
    t.campS = lg.season;
    changed('camp');
    return { ok: true };
  };
  function campInfo() {
    const P = PT.League.Progression;
    try { if (P && P.campInfo && !P.campInfo.__stub) return P.campInfo(L()); } catch (e) { /* fall back */ }
    const t = me();
    return { n: L().diff === 0 ? 4 : 3, gain: 2 + ((t.fac && t.fac.trn) || 1) - 1, done: t.campS === L().season };
  }
  function campGain() { return campInfo().gain; }
  function focusCount() { return campInfo().n; }

  // ---------------- Team section (TEAM-UX redesign) ----------------
  // Sub-tabs: Roster (roster.js) · Lineup (depth.js) · Contracts ('team' tab 'pay') · Style ('team' tab 'style') · Market. Overview is gone: its useful bits live in the header strip (teamStrip)
  // shown on every Team tab. The section list lives in ui.js (UI.SECTIONS, not ours): re-shape it here at load.
  (function retab() {
    const list = UI.SECTIONS && UI.SECTIONS.team;
    if (!list) return;
    // HUNT #38: Camp never shows (ROUND6 C runs camp automatically at rollover) → no Camp tab; the screen stays for old saves
    const keep = list.filter((x) => ['team', 'roster', 'depth', 'pay', 'style', 'camp'].indexOf(x.id) < 0);
    const mine = [
      { id: 'roster', label: 'Roster', icon: 'players', to: 'roster' },
      { id: 'depth', label: 'Lineup', icon: 'clipboard', to: 'depth' },
      { id: 'pay', label: 'Contracts', icon: 'cash', to: 'team', tab: 'pay' },
      { id: 'style', label: 'Style', icon: 'tophat', to: 'team', tab: 'style' }
    ];
    list.splice.apply(list, [0, list.length].concat(mine, keep));
  })();

  /** shared Team-section kit (roster.js / depth.js / player.js call it at click / mount time) */
  const kit = UI.parts = UI.parts || {};
  /** one slim strip on every Team tab: rating · record · spirit · hype · captain (tap = change). Other teams: styles + Swap. */
  kit.teamStrip = function (tid) {
    const lg = L();
    if (tid == null) tid = lg.userTid;
    const t = lg.teams[tid], mine = tid === lg.userTid;
    const o = safe(() => PT.League.Q.teamOvr(lg, t.id), { ovr: 60 });
    const r = safe(() => PT.League.Standings.get(lg).find((x) => x.tid === t.id), null) || { w: 0, l: 0, t: 0 };
    const item = (label, val, cls) => html`<span class="tx-si ${cls || ''}"><span class="tx-sl">${label}</span><span class="tx-sv">${val}</span></span>`;
    const head = html`${item('Team', K().stars(o.ovr, { team: true }), 'tx-rate')}${item('Record', html`<b class="num">${D().rec(r.w, r.l, r.t)}</b>`, 'tx-rec')}`;
    if (!mine) {
      const off = t.style && t.style.off, def = t.style && t.style.def;
      return html`<section class="tx-strip" style="${K().teamVars(t)}">${K().badge(t, 's')}${head}
        ${item('Offense', html`${K().ic(OFF_EMO[off])}${C.OFF_STYLES[off] || '—'}`)}${item('Defense', html`${K().ic(DEF_EMO[def])}${C.DEF_STYLES[def] || '—'}`)}
        <span class="grow"></span>${K().btn({ label: 'Swap', icon: 'swap', action: 'swap', kind: 'sec', size: 's', testid: 'btn-team-swap', cls: 'tx-sbtn' })}</section>`;
    }
    const spirit = t.spirit == null ? 50 : t.spirit;
    const spLabel = safe(() => PT.League.Spirit.label(spirit), spirit >= 75 ? 'In Sync' : spirit <= 25 ? 'Out of Sync' : 'Okay');
    const hype = Math.round((t.fin && t.fin.hype) || 0);
    const capt = t.capt != null ? PT.League.Q.player(lg, t.capt) : null;
    return html`<section class="tx-strip" style="${K().teamVars(t)}">${head}
      ${item('Spirit', html`${K().ic('heart')}<b>${spLabel}</b>`, 'tx-keep ' + (spirit <= 25 ? 'tx-bad' : spirit >= 75 ? 'tx-good' : ''))}
      ${item('Hype', html`${K().ic('flame')}<b class="num">${hype}</b>`, 'tx-keep')}
      <span class="grow"></span>
      <button type="button" class="tx-si tx-capt" data-action="tm-capt" data-testid="btn-captain-pick" title="Change Captain">
        <span class="tx-sl">Captain</span><span class="tx-sv"><span class="capt">C</span><b>${capt ? K().pname(capt) : 'Pick one'}</b>${K().ic('pencil')}</span></button>
    </section>`;
  };
  /** captain picker (modal list, smartest first) */
  /** HUNT2 #6: captain picker = the 6 smartest on one page (name, pos, Smarts); "Show all" pages the rest */
  kit.pickCaptain = function (all) {
    const lg = L(), t = me();
    const list = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir).sort((a, b) => (b.r.smt - a.r.smt) || (b.ovr - a.ovr));
    const row = (p) => html`<button type="button" class="cap-r ${t.capt === p.id ? 'on' : ''}" data-action="pick" data-pid="${p.id}" data-testid="capt-pick-${p.id}">
      ${K().portrait(p, 32, t.col.pri)}<span class="cap-n"><b>${K().pname(p)}</b>${t.capt === p.id ? html`<span class="capt">C</span>` : ''}</span>${K().posChip(p.pos)}<span class="cap-s"><span class="tiny muted">Smarts</span><b class="num">${p.r.smt}</b></span></button>`;
    const shown = all ? list : list.slice(0, 6);
    const body = all ? K().pg('capt', shown.map(row), { grid: true, cls: 'cap-pg' })
      : html`<div class="cap-grid">${shown.map(row)}</div>${list.length > 6 ? html`<button type="button" class="cap-more" data-action="all" data-testid="capt-show-all">Show all ${list.length}</button>` : ''}`;
    return UI.Modal.open({ title: 'Pick a Captain', icon: 'crown', cls: 'm-list m-capt',
      body: html`<p class="small muted cap-h">Smart players make the best Captains.</p>${body}`,
      actions: { pick: (b, card, entry) => entry.close(+b.getAttribute('data-pid')), all: (b, card, entry) => entry.close('all') },
      buttons: [{ label: 'Cancel', value: null, kind: 'cancel' }] })
      .then((pid) => {
        if (pid === 'all') { kit.pickCaptain(true); return; }
        if (pid == null || pid === t.capt) return;
        const r = UI.adapt && UI.adapt.setCaptain ? UI.adapt.setCaptain(lg, t.id, pid) : null;
        if (!r) { t.capt = pid; changed('captain'); }
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
        UI.Toast.show('New Captain!', 'good');
        UI.refresh();
      });
  };
  /** Cut Cost per year + years (same numbers Roster.release books) */
  kit.cutCost = function (p) {
    const lg = L();
    if (!p.con) return { per: 0, years: 0 };
    const R = PT.League.Roster;
    if (R && R.cutCost) { const c = R.cutCost(lg, p.id); return { per: c.years ? c.perYear : 0, years: c.years }; }
    const yrs = K().yrsLeft(p, lg);
    return { per: yrs ? Math.round(p.con.sal * ((C.CAP && C.CAP.CUT_PCT) || 0.5)) : 0, years: yrs };
  };
  kit.cutText = function (p) {
    const cc = kit.cutCost(p);
    return cc.per ? html`Cut Cost <b class="num">${D().money(cc.per)}</b> ${cc.years > 1 ? html`a year for ${cc.years} years` : 'this year'}` : html`No Cut Cost`;
  };
  /** Cut (release) with the Cut Cost shown first. after(): called once he is gone. */
  kit.release = function (pid, after) {
    const lg = L(), p = PT.League.Q.player(lg, pid);
    if (!p) return;
    UI.Modal.open({ title: 'Cut ' + K().short(p) + '?', icon: 'scissors',
      body: html`<p>He leaves your team and goes to the Market.</p><p>${kit.cutText(p)}.</p>`,
      buttons: [{ label: 'Cut', value: true, kind: 'bad', testid: 'btn-release-confirm' }, { label: 'Keep him', value: false, kind: 'cancel' }] })
      .then((ok) => {
        if (!ok) return;
        const r = PT.League.Roster.release(lg, p.id);
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Could not cut him.', 'bad'); return; }
        UI.Toast.show('Bye, ' + p.fn + '!', 'info');
        changed('roster');
        UI.updateHead();
        if (after) after(); else UI.refresh();
      });
  };
  /** in-season extension: his final season, REGULAR phase (Contracts.extend). 'keep' = Keep Players phase. */
  kit.contractAct = function (p) {
    const lg = L();
    if (!p || p.tid !== lg.userTid || !p.con) return null;
    if (lg.phase === 'RESIGN' && p.con.exp <= lg.season) return 'keep';
    if (lg.phase === 'REGULAR' && p.con.exp === lg.season && PT.League.Contracts && PT.League.Contracts.extend) return 'extend';
    return null;
  };
  kit.extend = function (pid) {
    const lg = L(), p = PT.League.Q.player(lg, pid), Ct = PT.League.Contracts;
    const a = safe(() => Ct.ask(lg, pid), null);
    if (!p || !a) return;
    if (a.verdict === 'wont') { UI.Modal.alert(p.fn + ' wants a new team.', html`<p>He will test the Market.</p>`, 'contract'); return; }
    UI.Modal.open({ title: 'Extend ' + K().short(p) + '?', icon: 'contract',
      body: html`<p>He asks <b class="num">${D().money(a.need)}</b> a year for <b>${D().plural(a.yrs, 'year')}</b>.</p><p class="small muted">Now: ${D().money(p.con.sal)} a year.</p>`,
      buttons: [{ label: 'Offer', value: true, kind: 'go', testid: 'btn-extend-ok' }, { label: 'Not now', value: false, kind: 'cancel' }] })
      .then((ok) => {
        if (!ok) return;
        const r = safe(() => Ct.extend(lg, pid, { sal: a.need, yrs: a.yrs }), { ok: false, msg: 'Not now.' });
        UI.Toast.show((r && r.msg) || 'Done', r && r.accepted ? 'good' : 'bad', 2600);
        UI.updateHead();
        UI.refresh();
      });
  };
  /** the actions every Team tab shares (strip) */
  kit.teamHeadActions = { 'tm-capt': () => kit.pickCaptain() };

  // ---------------- Contracts ----------------
  const pst = { sel: null };
  function yrsWord(p, lg) {
    const yrs = K().yrsLeft(p, lg);
    return yrs === 0 ? html`<span class="chip chip-hurt tiny">Ends</span>` : yrs === 1 ? html`<span class="chip chip-gold tiny">Last yr</span>` : html`<span class="num">${yrs}</span> yrs`;
  }
  function pay() {
    const lg = L(), t = me();
    const list = PT.League.Q.roster(lg, t.id).filter((p) => p.con)
      .sort((a, b) => (Math.min(2, K().yrsLeft(a, lg)) - Math.min(2, K().yrsLeft(b, lg))) || (b.con.sal - a.con.sal));
    if (!list.some((p) => p.id === pst.sel)) pst.sel = list.length ? list[0].id : null;
    const rows = list.map((p) => {
      const yrs = K().yrsLeft(p, lg);
      return html`<button type="button" class="tx-row tx-prow ${yrs <= 1 ? 'tx-exp' : ''} ${p.id === pst.sel ? 'sel' : ''}" data-action="pay-row" data-id="${p.id}" data-testid="pay-row-${p.id}">
        <span class="tx-nm"><b>${K().pname(p)}</b>${p.con.rk ? html`<span class="chip chip-blue tiny">Rookie</span>` : ''}</span>
        <span class="tx-c-pos">${K().posChip(p.pos)}</span>
        <span class="tx-c-pay num">${D().money(p.con.sal)}</span>
        <span class="tx-c-yrs">${yrsWord(p, lg)}</span></button>`;
    });
    const sel = list.find((p) => p.id === pst.sel);
    const act = sel ? kit.contractAct(sel) : null;
    const detail = sel ? html`
      <button type="button" class="tx-dhead" data-action="pay-card" data-id="${sel.id}" data-testid="pay-card" title="Open player card">
        ${K().portrait(sel, 40, t.col.pri)}<span class="tx-dname"><b>${K().pname(sel)}</b><span class="tx-dsub">${K().posChip(sel.pos)}<span class="tx-dstars">${K().stars(sel.ovr)}</span></span></span></button>
      <p class="tx-cut small">${kit.cutText(sel)}</p>
      <div class="tx-acts">
        ${act === 'extend' ? K().btn({ label: 'Extend', icon: 'contract', action: 'pay-extend', data: { id: sel.id }, kind: 'go', size: 's', testid: 'btn-pay-extend' }) : ''}
        ${act === 'keep' ? K().btn({ label: 'Keep', icon: 'contract', action: 'pay-keep', kind: 'go', size: 's', testid: 'btn-pay-keep' }) : ''}
        ${K().btn({ label: 'Cut', icon: 'scissors', action: 'pay-release', data: { id: sel.id }, kind: 'bad', size: 's', testid: 'btn-pay-release' })}
      </div>` : K().empty('contract', 'No contracts.');
    // HUNT2 #4/#5: no strip, no Pay bar (Team Cash is in the top bar); the side card only says what a Cut costs + the moves
    return html`<div class="tx-pay">
        ${K().card(html`<div class="tx-thead tx-prow"><span class="tx-nm">Player</span><span class="tx-c-pos">Pos</span><span class="tx-c-pay">Pay</span><span class="tx-c-yrs">Left</span></div>
          ${K().pg('pay', rows, { cls: 'tx-pg tx-side-pg' })}`, 'fill tx-list')}
        ${K().card(detail, 'fill tx-detail')}
      </div>`;
  }

  // ---------------- Style ----------------
  function styleTab() {
    const lg = L(), t = me();
    const open = PT.League.canChangeSetup ? safe(() => PT.League.canChangeSetup(lg), false) : lg.phase === 'PRESEASON';
    const side = (sd, title, icon, table, blurb, emo) => {
      const cur = t.style && t.style[sd];
      const opts = Object.keys(table).map((id) => {
        const on = cur === id, b = blurb[id] || ['', ''];
        return html`<button type="button" class="tx-opt ${on ? 'on' : ''}" data-action="style" data-side="${sd}" data-id="${id}" data-testid="style-${sd}-${id}" aria-pressed="${on}" ${open ? '' : D().raw('disabled')}>
          <span class="tx-opt-ic">${K().ic(emo[id])}</span><span class="tx-opt-m"><b>${table[id]}</b><span class="tx-opt-fx">${b[1]}</span></span>${on ? html`<span class="tx-opt-on">${K().ic('check')}</span>` : ''}</button>`;
      });
      return K().card(html`${K().h2(title, '', icon)}<div class="tx-opts n${opts.length}">${opts}</div>`, 'fill tx-style-c');
    };
    const lock = open ? '' : html`<p class="tx-lock small">${K().ic('lock')} Change style before Week 1 or after the season.</p>`;
    return html`${lock}<div class="tx-style">
      ${side('off', 'Offense', 'football', C.OFF_STYLES, OFF_BLURB, OFF_EMO)}
      ${side('def', 'Defense', 'shield', C.DEF_STYLES, DEF_BLURB, DEF_EMO)}</div>`;
  }

  const tst = { tab: 'pay' };
  function mountTeam(el, params) {
    if (params.tab) { tst.tab = params.tab; params.tab = null; }
    const tab = tst.tab;
    // Overview / Players / Lineup now live on their own screens
    if (tab !== 'pay' && tab !== 'style') { tst.tab = 'pay'; UI.replace(tab === 'lineup' ? 'depth' : 'roster'); return; }
    D().set(el, K().layout(tab === 'pay' ? pay() : styleTab(), null, 'fit tx team-' + tab));
  }

  UI.screens.team = {
    title: () => me().name,
    nav: 'team',
    curTab: () => tst.tab,
    mount: mountTeam,
    actions: Object.assign({}, kit.teamHeadActions, {
      'pay-row': (el) => { pst.sel = +el.getAttribute('data-id'); UI.refresh(); },
      'pay-card': (el) => UI.go('player', { pid: +el.getAttribute('data-id') }),
      'pay-release': (el) => kit.release(+el.getAttribute('data-id')),
      'pay-extend': (el) => kit.extend(+el.getAttribute('data-id')),
      'pay-keep': () => UI.reset('resign'),
      style: (el) => {
        const r = UI.adapt.setStyle(L(), L().userTid, el.getAttribute('data-side'), el.getAttribute('data-id'));
        if (r && r.ok === false) UI.Toast.show(r.msg, 'bad'); else UI.Toast.show('Style set', 'good');
        UI.refresh();
      }
    })
  };

  // ---------------- Shop ----------------
  // ROUND6 0-scroll: two panes (Facilities · Coaches). Short screens show one pane at a time (tab buttons);
  // tall screens (CSS) show both and hide the tab buttons. Coins live in the top bar, so no bank panel.
  const shopSt = { pane: 'fac' };
  function shopMount(el) {
    const lg = L(), t = me();
    const coins = t.fin.coins;
    const facCards = C.FACILITIES.map((f) => {
      const lv = t.fac[f];
      const cost = safe(() => PT.League.Economy.upgradeCost(lg, t.id, f), lv >= 5 ? 0 : C.FACILITY_COST[f][lv]);
      const max = lv >= 5;
      return html`<section class="fac">
        <span class="fac-emo">${K().ic(FAC_EMO[f])}</span>
        <div class="fac-m"><div class="fac-t"><b class="fac-n">${C.FACILITY_NAMES[f]}</b><div class="fac-pips" aria-label="Level ${lv} of 5" title="Level ${lv} of 5">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= lv ? 'on' : ''}"></i>`)}</div></div><p class="tiny fac-fx">${FAC_FX[f]}</p></div>
        ${max ? html`<div class="chip chip-gold fac-max">${K().ic('star')} Max</div>` : K().btn({ label: 'Upgrade', sub: D().coins(cost) + ' Coins', icon: 'up', action: 'upgrade', data: { fac: f }, kind: cost <= coins ? 'go' : 'sec', size: 's', testid: 'btn-upgrade-' + f, disabled: cost > coins, cls: 'fac-b' })}
      </section>`;
    });
    // HUNT #35: show how many parties are left; at 0 the button is off and a Done chip shows
    const pMax = (PT.League.K && PT.League.K.ECO_PARTY_MAX) || 3;
    const pLeft = Math.max(0, pMax - (safe(() => PT.League.History.ss(lg).pty, 0) || 0));
    const party = html`<section class="fac fac-party">
      <span class="fac-emo">${K().ic('balloon')}</span>
      <div class="fac-m"><b class="fac-n">Fan Party</b><p class="tiny fac-fx">+5 Hype · ${pLeft ? D().plural(pLeft, 'party', 'parties') + ' left' : 'none left'} this season</p></div>
      ${pLeft ? K().btn({ label: 'Party', sub: '100 Coins', icon: 'balloon', action: 'party', kind: coins >= 100 ? 'go' : 'sec', size: 's', disabled: coins < 100, testid: 'btn-fan-party', cls: 'fac-b' })
        : html`<div class="chip chip-green fac-max" data-testid="fan-party-done">${K().ic('check')} Done</div>`}
    </section>`;
    const staff = C.STAFF.map((role) => {
      const cur = safe(() => PT.League.Staff.stars(lg, t.id, role), typeof t.stf[role] === 'number' ? t.stf[role] : (t.stf[role] && t.stf[role].st) || 1);
      return html`<div class="staff">
        <span class="fac-emo">${K().ic(STAFF_EMO[role])}</span><div class="fac-m"><b>${C.STAFF_NAMES[role]}</b><div class="tiny muted">${STAFF_FX[role]}</div></div>
        <div class="star-pick" role="radiogroup" aria-label="${C.STAFF_NAMES[role]} level">${[1, 2, 3, 4, 5].map((n) => {
          const delta = C.STAFF_COST[n] - C.STAFF_COST[cur];
          const can = delta <= coins || n <= cur;
          // HUNT #33 + HUNT2 #7: levels Lv 1-5 (not "stars"); gold up to the current level, price above it
          return html`<button type="button" class="sp-star ${n <= cur ? 'on' : ''} ${n === cur ? 'cur' : ''}" role="radio" aria-checked="${n === cur}" data-action="staff" data-role="${role}" data-n="${n}" data-testid="coach-${role}-${n}" ${can ? '' : D().raw('disabled')} title="Level ${n} · ${D().coins(C.STAFF_COST[n])} Coins a season"><span class="sp-lv">Lv <b class="num">${n}</b></span><span class="tiny num">${n === cur ? 'Now' : C.STAFF_COST[n] ? D().coins(C.STAFF_COST[n]) : 'Free'}</span></button>`;
        })}</div>
      </div>`;
    });
    const pane = shopSt.pane;
    const tabBtn = (id, label, icon) => html`<button type="button" class="tab shop-tab ${pane === id ? 'on' : ''}" role="tab" aria-selected="${pane === id}" data-action="shop-pane" data-id="${id}" data-testid="shop-tab-${id}">${K().ic(icon)}${label}</button>`;
    D().set(el, K().layout(html`
      <div class="shop-bar" role="tablist">${tabBtn('fac', 'Facilities', 'hammer')}${tabBtn('staff', 'Staff', 'players')}
        <span class="grow"></span></div>
      <div class="shop-panes">
        <div class="shop-pane ${pane === 'fac' ? 'on' : ''}">${K().pg('fac', cells(facCards.concat([party])), { grid: true, cls: 'fac-pg' })}</div>
        <div class="shop-pane ${pane === 'staff' ? 'on' : ''}">${K().card(html`${K().h2('Staff', html`<span class="tiny muted shop-paid">Paid every season</span>`)}${staff}`, 'staff-card')}</div>
      </div>`, null, 'fit nsb shop'));
  }

  UI.screens.shop = {
    title: 'Shop',
    nav: 'shop',
    mount: shopMount,
    actions: {
      upgrade: (el) => {
        const lg = L(), f = el.getAttribute('data-fac');
        const r = PT.League.Economy.upgrade(lg, lg.userTid, f);
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not enough Coins.', 'bad'); return; }
        UI.Toast.show(C.FACILITY_NAMES[f] + ' upgraded', 'good');
        UI.updateHead();
        UI.refresh();
      },
      staff: (el) => {
        const lg = L(), role = el.getAttribute('data-role'), n = +el.getAttribute('data-n');
        const S = PT.League.Staff;
        const r = S && S.setStars ? S.setStars(lg, lg.userTid, role, n) : { ok: false, msg: 'Coaches are not ready yet.' };
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not enough Coins.', 'bad'); return; }
        UI.Toast.show(C.STAFF_NAMES[role] + ': Lv ' + n, 'good');
        UI.updateHead();
        UI.refresh();
      },
      party: () => {
        const lg = L();
        const E = PT.League.Economy;
        const r = E && E.fanParty ? E.fanParty(lg, lg.userTid) : { ok: false, msg: 'No parties yet.' };
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not enough Coins.', 'bad'); return; }
        UI.Toast.show('Fan Party: +5 Hype', 'good');
        changed('party');
        UI.updateHead();
        UI.refresh();
      },
      coach: () => UI.go('coach'),
      'shop-pane': (el) => { shopSt.pane = el.getAttribute('data-id') === 'staff' ? 'staff' : 'fac'; UI.refresh(); }
    }
  };

  // ---------------- Training Camp ----------------
  const cst = { picks: {} };   // pid → skill
  function campMount(el) {
    const lg = L(), t = me();
    const ci = campInfo();
    const done = !!ci.done;
    const can = lg.phase === 'PRESEASON';
    const n = ci.n;
    const gain = ci.gain;
    const roster = PT.League.Q.roster(lg, t.id).filter((p) => !p.ir).sort((a, b) => a.age - b.age || b.ovr - a.ovr);
    // QA1: picks are a UI memo; drop ones from another league/season or players who left (they blocked new picks)
    const key = lg.id + ':' + lg.season + ':' + t.id;
    if (cst.key !== key) { cst.key = key; cst.picks = {}; }
    Object.keys(cst.picks).forEach((pid) => { if (!roster.some((p) => p.id === +pid)) delete cst.picks[pid]; });
    const chosen = Object.keys(cst.picks).map(Number);
    const rows = roster.map((p) => {
      const on = cst.picks[p.id] != null;
      const skills = K().mainSkills(p.pos);
      return html`<div class="camp-row ${on ? 'on' : ''}">
        ${K().playerRow(p, { action: 'camp-pick', testid: 'camp-pick-' + p.id, sel: on, compact: true, right: html`<span class="small">Age ${p.age}</span>${K().growth(p.gl)}` })}
        ${on ? html`<div class="camp-skills">${skills.map((k) => html`<button type="button" class="fchip ${cst.picks[p.id] === k ? 'on' : ''}" data-action="camp-skill" data-pid="${p.id}" data-k="${k}" data-testid="camp-skill-${p.id}-${k}">${C.RATING_NAMES[k]} <span class="num">${p.r[k]}${cst.picks[p.id] === k ? ' → ' + Math.min(99, p.r[k] + gain) : ''}</span></button>`)}</div>` : ''}
      </div>`;
    });
    const nRoster = roster.length, max = C.ROSTER.MAX_SEASON;
    const body = html`
      ${K().card(html`<div class="camp-head"><span class="big-emo">${K().ic('dumbbell')}</span><div class="grow"><b>Pick ${n} Focus players</b><p class="small">Each gets <b>+${gain}</b> to one skill.</p></div>
        ${K().chip('Picked ' + chosen.length + '/' + n, chosen.length === n ? 'green' : 'gold')}${K().chip('Roster ' + nRoster + '/' + max, nRoster > max ? 'red' : 'blue')}
        ${K().btn({ label: 'Coaches', icon: 'cap', action: 'go', data: { to: 'shop' }, kind: 'ghost', size: 's', testid: 'btn-camp-coaches' })}
        ${K().btn({ label: 'Style', icon: 'tophat', action: 'go-style', kind: 'ghost', size: 's', testid: 'btn-camp-style' })}</div>`, 'card-cream camp-top')}
      ${done ? K().card(html`<p class="big center">${K().ic('check')} Camp complete.</p>`) : !can ? K().card(html`<p class="center">${K().ic('lock')} Camp opens in the Preseason.</p>`) : K().pg('camp', cells(rows), { grid: true, cls: 'camp-list' })}`;
    const ready = chosen.length > 0 && chosen.every((pid) => cst.picks[pid]);
    const foot = done || !can ? K().nextBtn() : html`${K().btn({ label: 'Train', icon: 'dumbbell', action: 'train', kind: ready ? 'go' : 'sec', size: 'l', disabled: !ready, testid: 'btn-camp-train' })}${K().nextBtn()}`;
    D().set(el, K().layout(body, foot, 'fit nsb camp'));
  }
  UI.screens.camp = {
    title: 'Training Camp',
    nav: 'team',
    mount: campMount,
    actions: {
      'camp-pick': (el) => {
        const pid = +el.getAttribute('data-pid');
        if (cst.picks[pid] != null) delete cst.picks[pid];
        else {
          if (Object.keys(cst.picks).length >= focusCount()) { UI.Toast.show('Max ' + focusCount() + ' Focus players.', 'bad'); return; }
          const p = PT.League.Q.player(L(), pid);
          const main = K().mainSkills(p.pos);
          cst.picks[pid] = main.slice().sort((a, b) => (PT.C.OVR_W[p.pos][b] || 0) - (PT.C.OVR_W[p.pos][a] || 0))[0] || 'spd';
        }
        UI.refresh();
      },
      'camp-skill': (el) => { cst.picks[+el.getAttribute('data-pid')] = el.getAttribute('data-k'); UI.refresh(); },
      go: (el) => UI.go(el.getAttribute('data-to')),
      'go-style': () => UI.go('team', { tab: 'style' }),
      train: () => {
        const picks = Object.keys(cst.picks).map((pid) => ({ pid: +pid, skill: cst.picks[pid] }));
        const r = UI.adapt.campFocus(L(), L().userTid, picks);
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not now.', 'bad'); return; }
        cst.picks = {};
        UI.Toast.show('Camp complete. Skills improved.', 'good', 2600);
        UI.refresh();
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
