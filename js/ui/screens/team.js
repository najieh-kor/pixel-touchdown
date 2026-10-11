/* Pixel Touchdown: js/ui/screens/team.js
 * Owner: WP5. Responsibility: finances, facilities, staff, ticket price → in design words:
 *   'team'  Team view with tabs Overview · Players · Lineup · Pay (Team Cash) · Style        params {tab}
 *   'shop'  Shop: facilities (5 levels), coaches (3 slots, 1–5 Stars), Fan Party, Coach Skills link (design 10.11)
 *   'camp'  Training Camp: Focus players + skill (design 4.5), coaches, style (Preseason 3)
 * testids: tab-{overview|players|lineup|pay|style}, style-off-{id}, style-def-{id}, btn-upgrade-{fac},
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
  const FAC_FX = {
    trn: 'Young players grow faster. Camp gains +1.',
    med: 'Hurt players heal faster and get hurt less.',
    sct: '+4 scout points. Lv 3: see Growth on other teams.',
    std: '+15% ticket Coins. Hype stays higher.',
    shop: '+5 merch Coins a week. Lv 3: +1 Hype per win.'
  };
  const STAFF_EMO = { off: 'football', def: 'shield', grw: 'sprout' };
  const STAFF_FX = { off: '+1 to all offense skills in games per Star above 1', def: '+1 to all defense skills in games per Star above 1', grw: 'Young players (≤ 25) grow +0.5 per Star above 1' };

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

  // ---------------- Team view ----------------
  const tst = { tab: 'overview' };

  function overview() {
    const lg = L(), t = me();
    const o = safe(() => PT.League.Q.teamOvr(lg, t.id), { ovr: 60, off: 60, def: 60, st: 60 });
    const r = safe(() => PT.League.Standings.get(lg).find((x) => x.tid === t.id), { w: 0, l: 0, t: 0 });
    const spirit = t.spirit == null ? 50 : t.spirit;
    const spLabel = safe(() => PT.League.Spirit.label(spirit), spirit >= 75 ? 'In Sync' : spirit <= 25 ? 'Out of Sync' : 'Okay');
    const capt = t.capt != null ? PT.League.Q.player(lg, t.capt) : null;
    const rival = lg.teams[t.rival];
    const cs = safe(() => PT.League.Coach.status(lg), { lvl: (lg.coach && lg.coach.lvl) || 1, xp: (lg.coach && lg.coach.xp) || 0, next: 50 });
    const coach = lg.coach || {};
    const star = (role) => safe(() => PT.League.Staff.stars(lg, t.id, role), typeof t.stf[role] === 'number' ? t.stf[role] : 1);
    const off = t.style && t.style.off, def = t.style && t.style.def;
    // ROUND6 0-scroll: one ID strip + three equal panels (Ratings + Captain · Spirit & Fans · Coaches)
    return html`
      <section class="card team-id tm-id" style="${K().teamVars(t)}">
        ${K().badge(t, 'l')}
        <div class="tm-name"><div class="small">${t.city}</div><div class="hero-t">${t.name}</div></div>
        <div class="tm-rec">${K().stars(o.ovr, { team: true, big: true })}<b class="num big">${D().rec(r.w, r.l, r.t)}</b></div>
        <div class="tm-more">
          <span class="row wrap tm-style"><span class="chip chip-blue">${K().ic(OFF_EMO[off])} ${C.OFF_STYLES[off] || '—'}</span><span class="chip chip-red">${K().ic(DEF_EMO[def])} ${C.DEF_STYLES[def] || '—'}</span></span>
          <span class="small ellip">${K().ic('stadium')} ${t.stad || 'Home Field'}${rival ? html` · Rival: <b>${rival.name}</b>` : ''}</span>
        </div>
      </section>
      <div class="cols3 tm-cols">
        ${K().card(html`${K().h2('Ratings')}
          <div class="unit-row"><span>${K().ic('football')} Offense</span>${K().stars(o.off, { team: true })}</div>
          <div class="unit-row"><span>${K().ic('shield')} Defense</span>${K().stars(o.def, { team: true })}</div>
          <div class="unit-row"><span>${K().ic('boot')} Kicking</span>${K().stars(o.st)}</div>
          <div class="unit-row capt-line"><span class="capt">C</span>${capt ? html`<b class="grow ellip">${K().pname(capt)}</b>${K().mood(capt.mor)}` : html`<span class="muted grow">No Captain</span>`}
          ${K().btn({ icon: 'pencil', action: 'tab', data: { id: 'lineup' }, kind: 'sec', size: 's', testid: 'btn-team-captain', title: 'Change Captain' })}</div>`, 'tm-c')}
        ${K().card(html`${K().h2('Spirit & Fans')}
          <div class="unit-row"><span>${K().ic('heart')} ${spLabel}</span><span class="grow">${K().meter(spirit, 100, spirit >= 75 ? '' : spirit <= 25 ? 'm-red' : 'm-gold', 'Team Spirit')}</span></div>
          <div class="unit-row"><span>${K().bossFace(lg.boss ? lg.boss.conf : 50)} Boss</span><span class="grow">${K().meter(lg.boss ? lg.boss.conf : 50, 100, 'm-gold', 'Boss')}</span></div>
          <div class="unit-row"><span>${K().ic('flame')} Hype</span><span class="grow">${K().meter(t.fin.hype, 100, 'm-red', 'Hype')}</span></div>
          ${lg.boss && lg.boss.goal ? html`<p class="small tm-goal">Boss goal: <b>${lg.boss.goal.txt}</b></p>` : ''}`, 'tm-c')}
        ${K().card(html`${K().h2('Coaches')}
          <div class="unit-row tm-coach"><span class="ellip">${K().sp(coach.sp || 'dog')} <b>${coach.n || 'You'}</b></span><span class="chip chip-gold">Lv ${cs.lvl}</span><span class="grow">${K().meter(cs.xp, cs.next || 100, 'm-blue', 'Coach XP')}</span></div>
          ${C.STAFF.map((role) => html`<div class="unit-row"><span title="${C.STAFF_NAMES[role]}">${K().ic(STAFF_EMO[role])} ${C.STAFF_NAMES[role].replace(' Coach', '')}</span>${staffStars(star(role))}</div>`)}
          <div class="btn-row tm-btns">${K().btn({ label: 'Shop', icon: 'cart', action: 'go', data: { to: 'shop' }, kind: 'sec', size: 's', testid: 'btn-team-shop' })}${K().btn({ label: 'Skills', icon: 'cap', action: 'go', data: { to: 'coach' }, kind: 'sec', size: 's', testid: 'btn-team-coach', title: 'Coach Skills' })}</div>`, 'tm-c')}
      </div>`;
  }
  function staffStars(n) {
    return html`<span class="stars" title="${n} Stars" role="img" aria-label="${n} stars">${K().starRow(n)}</span>`;
  }

  function pay() {
    const lg = L(), t = me();
    const cap = safe(() => PT.League.Cap.cap(lg), C.CAP.BASE);
    const used = safe(() => PT.League.Cap.payroll(lg, t.id), 0);
    const dead = safe(() => PT.League.Cap.dead(lg, t.id), 0);
    const left = cap - used;
    const list = PT.League.Q.roster(lg, t.id).filter((p) => p.con).sort((a, b) => b.con.sal - a.con.sal);
    const deadRows = (t.dead || []).filter((d) => d.s >= lg.season);
    // ROUND6 0-scroll: Team Cash panel on the left, the payroll as a paged 2-column list on the right
    const rows = list.map((p) => {
      const yrs = K().yrsLeft(p, lg);
      return html`<button type="button" class="pay-r ${yrs <= 1 ? 'me' : ''}" data-action="pay-row" data-id="${p.id}" data-testid="pay-row-${p.id}">
        ${K().posChip(p.pos)}<b class="ellip pay-n">${K().short(p)}${p.con.rk ? html` <span class="chip chip-blue tiny">Rookie</span>` : ''}</b>
        <span class="num pay-s">${D().money(p.con.sal)}</span>
        <span class="pay-y">${yrs === 0 ? html`<span class="bad">Ending</span>` : yrs === 1 ? html`<span class="warn">Last yr</span>` : D().plural(yrs, 'yr')}</span></button>`;
    });
    const pctUsed = Math.min(100, ((used - dead) / cap) * 100), pctDead = Math.min(100 - pctUsed, (dead / cap) * 100);
    return html`<div class="pay-cols">
      ${K().card(html`${K().h2('Team Cash')}
        <div class="cash-big ${left >= 5000 ? 'good' : left >= 1000 ? 'warn' : 'bad'}"><span class="small muted">Left to spend</span><b class="num">${D().money(left)}</b></div>
        <div class="cash-bar" role="img" aria-label="Team Cash used"><span class="cb-pay" style="width:${pctUsed}%"></span><span class="cb-dead" style="width:${pctDead}%"></span></div>
        <div class="cash-legend small"><span><i class="lg lg-pay"></i>Pay ${D().money(used - dead)}</span><span><i class="lg lg-dead"></i>Cut Costs ${D().money(dead)}</span><span><i class="lg lg-left"></i>Limit ${D().money(cap)}</span></div>
        ${deadRows.length ? html`<p class="tiny muted pay-dead">Cut Costs by season: ${deadRows.slice(0, 3).map((d, i) => html`${i ? ' · ' : ''}${d.s} ${D().money(d.amt)}`)}</p>` : ''}`, 'pay-cash')}
      ${K().card(html`${K().h2('Payroll', html`<span class="tiny muted">Yellow = last year</span>`)}${K().pg('pay', cells(rows), { grid: true, cls: 'pay-pg' })}`, 'fill pay-list')}
    </div>`;
  }

  function styleTab() {
    const lg = L(), t = me();
    const open = lg.phase === 'PRESEASON';
    const card = (side, id, name, blurb, emo) => {
      const on = t.style && t.style[side] === id;
      return html`<button type="button" class="style-c ${on ? 'on' : ''}" data-action="style" data-side="${side}" data-id="${id}" data-testid="style-${side}-${id}" ${open ? '' : D().raw('disabled')}>
        <span class="style-emo">${K().ic(emo)}</span><b>${name}</b><span class="tiny style-fx" title="${blurb[0]}">${blurb[1]}</span>${on ? D().raw('<span class="chip chip-go tiny style-yours">Yours</span>') : ''}</button>`;
    };
    const lock = open ? html`<span class="tiny muted">Pick one of each</span>` : html`<span class="chip chip-want tiny">${K().ic('lock')} Preseason only</span>`;
    return K().card(html`${K().h2('Team Style', lock)}
      <div class="style-rows">
        <div class="style-row"><span class="style-side">${K().ic('football')}<b>Offense</b></span><div class="style-grid st-5">${Object.keys(C.OFF_STYLES).map((id) => card('off', id, C.OFF_STYLES[id], OFF_BLURB[id] || ['', ''], OFF_EMO[id]))}</div></div>
        <div class="style-row"><span class="style-side">${K().ic('shield')}<b>Defense</b></span><div class="style-grid st-4">${Object.keys(C.DEF_STYLES).map((id) => card('def', id, C.DEF_STYLES[id], DEF_BLURB[id] || ['', ''], DEF_EMO[id]))}</div></div>
      </div>`, 'fill style-card');
  }

  function mountTeam(el, params) {
    if (params.tab) { tst.tab = params.tab; params.tab = null; }
    const tab = tst.tab;
    let body;
    if (tab === 'players' || tab === 'lineup') { tst.tab = 'overview'; UI.replace(tab === 'players' ? 'roster' : 'depth'); return; }
    if (tab === 'pay') body = pay();
    else if (tab === 'style') body = styleTab();
    else body = overview();
    // UI restyle: Overview · Pay · Style are sub-tabs of the Team section (frame .subnav), so no tab strip here
    D().set(el, K().layout(body, null, 'fit nsb team-' + tab));
  }

  UI.screens.team = {
    title: (p) => ({ pay: 'Team Pay', style: 'Team Style' })[(p && p.tab) || tst.tab] || 'Team',
    nav: 'team',
    curTab: () => tst.tab,
    mount: mountTeam,
    actions: Object.assign({}, {
      tab: (el) => { const id = el.getAttribute('data-id'); if (id === 'players' || id === 'lineup') { UI.reset(id === 'players' ? 'roster' : 'depth'); return; } UI.reset('team', { tab: id }); },
      go: (el) => { const to = el.getAttribute('data-to'); if (to === 'coach') UI.go('coach'); else UI.reset(to); },
      'pay-row': (el) => UI.go('player', { pid: +el.getAttribute('data-id') }),
      style: (el) => {
        const r = UI.adapt.setStyle(L(), L().userTid, el.getAttribute('data-side'), el.getAttribute('data-id'));
        if (r && r.ok === false) UI.Toast.show(r.msg, 'bad'); else UI.Toast.show('Style set', 'good');
        UI.refresh();
      }
    })
  };
  // shared actions from roster.js / depth.js, resolved at click time (no load-time cross-file reads)
  const teamActions = UI.screens.team.actions;
  ['r-filter', 'r-sort', 'd-chip', 'd-pick', 'd-cancel', 'd-auto', 'd-capt'].forEach((a) => {
    if (!teamActions[a]) teamActions[a] = function (el, ev, p) { const src = Object.assign({}, UI.parts && UI.parts.rosterActions, UI.parts && UI.parts.lineupActions); return src[a] && src[a](el, ev, p); };
  });

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
        <div class="fac-m"><div class="fac-t"><b class="ellip">${C.FACILITY_NAMES[f]}</b><div class="fac-pips" aria-label="Level ${lv} of 5" title="Level ${lv} of 5">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= lv ? 'on' : ''}"></i>`)}</div></div><p class="tiny fac-fx">${FAC_FX[f]}</p></div>
        ${max ? html`<div class="chip chip-gold fac-max">${K().ic('star')} Max</div>` : K().btn({ label: 'Upgrade', sub: D().coins(cost) + ' Coins', icon: 'up', action: 'upgrade', data: { fac: f }, kind: cost <= coins ? 'go' : 'sec', size: 's', testid: 'btn-upgrade-' + f, disabled: cost > coins, cls: 'fac-b' })}
      </section>`;
    });
    const party = html`<section class="fac fac-party">
      <span class="fac-emo">${K().ic('balloon')}</span>
      <div class="fac-m"><b class="ellip">Fan Party</b><p class="tiny fac-fx">+5 Hype. Up to 3 a season.</p></div>
      ${K().btn({ label: 'Party', sub: '100 Coins', icon: 'balloon', action: 'party', kind: coins >= 100 ? 'go' : 'sec', size: 's', disabled: coins < 100, testid: 'btn-fan-party', cls: 'fac-b' })}
    </section>`;
    const staff = C.STAFF.map((role) => {
      const cur = safe(() => PT.League.Staff.stars(lg, t.id, role), typeof t.stf[role] === 'number' ? t.stf[role] : (t.stf[role] && t.stf[role].st) || 1);
      return html`<div class="staff">
        <span class="fac-emo">${K().ic(STAFF_EMO[role])}</span><div class="fac-m"><b>${C.STAFF_NAMES[role]}</b><div class="tiny muted">${STAFF_FX[role]}</div></div>
        <div class="star-pick" role="radiogroup" aria-label="${C.STAFF_NAMES[role]} stars">${[1, 2, 3, 4, 5].map((n) => {
          const delta = C.STAFF_COST[n] - C.STAFF_COST[cur];
          const can = delta <= coins || n <= cur;
          return html`<button type="button" class="sp-star ${n <= cur ? 'on' : ''} ${n === cur ? 'cur' : ''}" role="radio" aria-checked="${n === cur}" data-action="staff" data-role="${role}" data-n="${n}" data-testid="coach-${role}-${n}" ${can ? '' : D().raw('disabled')} title="${n} Stars · ${C.STAFF_COST[n]} Coins a season"><span>${K().ic('star')}</span><span class="tiny">${C.STAFF_COST[n] ? C.STAFF_COST[n] : 'Free'}</span></button>`;
        })}</div>
      </div>`;
    });
    const pane = shopSt.pane;
    const tabBtn = (id, label, icon) => html`<button type="button" class="tab shop-tab ${pane === id ? 'on' : ''}" role="tab" aria-selected="${pane === id}" data-action="shop-pane" data-id="${id}" data-testid="shop-tab-${id}">${K().ic(icon)}${label}</button>`;
    D().set(el, K().layout(html`
      <div class="shop-bar" role="tablist">${tabBtn('fac', 'Facilities', 'hammer')}${tabBtn('staff', 'Coaches', 'cap')}
        <span class="grow"></span>${K().btn({ label: 'Coach Skills', icon: 'grad', action: 'coach', kind: 'sec', size: 's', testid: 'btn-shop-coach' })}</div>
      <div class="shop-panes">
        <div class="shop-pane ${pane === 'fac' ? 'on' : ''}">${K().pg('fac', cells(facCards.concat([party])), { grid: true, cls: 'fac-pg' })}</div>
        <div class="shop-pane ${pane === 'staff' ? 'on' : ''}">${K().card(html`${K().h2('Coaches', html`<span class="tiny muted">Paid every season</span>`)}${staff}`, 'staff-card')}</div>
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
        UI.Toast.show(C.STAFF_NAMES[role] + ': ' + n + ' Stars', 'good');
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
