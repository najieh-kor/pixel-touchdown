/* Pixel Touchdown: js/ui/screens/free-agency.js
 * Owner: FLOW-UX (was WP5). "Market" (free agency, design 10.7) and "Swaps" (trades, design 10.8) as flow screens
 * (docs/handoff/FLOW-UX.md).
 * Market: header "Market Day 1/3 · Offers today 0/5", a dense paged table (name, pos, Stars, age, ask, interest), a detail
 *   card with an inline offer (Pay stepper, Years, verdict, Send offer = btn-offer-submit), offer answers as a ticker in
 *   the bottom bar, ONE primary "Finish Market" (btn-fa-finish: Calendar.finishMarket → every day left → new season),
 *   secondary "Next day" (btn-fa-next-day) only while offers wait for an answer, else "Swaps". Rows: fa-row-{pid}.
 *   Outside the Market phase the same screen signs leftovers at their Ask (in season) or shows "Market closed".
 * Swaps: two columns (You give | You get), a Fair meter from Trade.evaluate in the bottom bar, primary "Propose".
 *   testids: swap-mine-{pid}, swap-theirs-{pid} (aria-pressed), btn-swap-team, swap-team-{tid}, btn-swap-propose.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp, FK = () => UI.FlowKit;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;

  const FA_CAP = 90;
  const MAX_OFFERS_DAY = 5;
  const mk = { filter: '', sel: null, day: '' };

  function space(lg) { try { return PT.League.Cap.space(lg, lg.userTid); } catch (e) { return 0; } }
  /** my offers still waiting for an answer (the player is still on the Market) */
  function pendingCount(lg) { return myOffers(lg).filter((o) => { const p = PT.League.Q.player(lg, o.pid); return p && p.tid === PT.C.TID.FA; }).length; }
  function myOffers(lg) { return ((lg.fa && lg.fa.offers) || []).filter((o) => o.tid === lg.userTid); }
  function list(lg, pos) {
    try { return PT.League.FA.list(lg, { pos: pos || undefined }) || []; } catch (e) { return []; }
  }
  function mode(lg) {
    if (lg.phase === 'FREE_AGENCY') return 'offer';
    if (lg.phase === 'REGULAR' || lg.phase === 'PRESEASON') return 'sign';
    return 'closed';
  }
  const FACE = { likely: { face: 'happy', word: 'Likely', cls: 'good' }, maybe: { face: 'meh', word: 'Maybe', cls: 'warn' }, unlikely: { face: 'sad', word: 'Unlikely', cls: 'bad' } };
  /** signing chance at his Ask on a spread-out 0..100 scale (score 80 → 0, 110 → 100) so the meter tells players apart */
  function chance(score) { return Math.max(0, Math.min(100, Math.round(((score != null ? score : 95) - 80) / 30 * 100))); }
  /** AI teams with an open offer for him (FA.list counts every team's offers; mine is x.mine) */
  function rivals(x) { return Math.max(0, (x.offers || 0) - (x.mine ? 1 : 0)); }
  /** meter value: his score at the Ask. AI teams bid at day end (FA.day), so even an offer at his Ask can lose:
   * never 5/5; 3/5 at most while other teams already bid on him. */
  function chanceOf(x) { const c = chance(x.score); return Math.min(c, rivals(x) ? 60 : 80); }
  function faceOf(score) { return score >= 105 ? FACE.likely : score >= 90 ? FACE.maybe : FACE.unlikely; }

  /** offers I sent this offseason (UI memo), so answered ones can show "Signed" / "Said no" after the day ends */
  function sent(lg) {
    const m = D().memo.mkSent;
    if (m && m.id === lg.id && m.s === lg.season) return m;
    D().memo.mkSent = { id: lg.id, s: lg.season, o: {} };
    return D().memo.mkSent;
  }
  function results(lg) {
    const memo = sent(lg), pend = {};
    myOffers(lg).forEach((o) => { pend[o.pid] = 1; memo.o[o.pid] = { sal: o.sal, yrs: o.yrs }; });
    return Object.keys(memo.o).map(Number).filter((pid) => !pend[pid]).map((pid) => {
      const p = PT.League.Q.player(lg, pid);
      if (!p) return '';
      const st = p.tid === lg.userTid ? html`<b class="good-l">signed</b>` : p.tid >= 0 ? html`<b class="bad-l">went to ${lg.teams[p.tid].abbr}</b>` : html`<b class="bad-l">said no</b>`;
      return html`<span class="fl-ti">${K().posChip(p.pos)}<span>${K().short(p)}</span>${st}</span>`;
    }).filter(Boolean).reverse();
  }

  /** "Free Agents | Swaps" switch for the header strip (same place on both screens, in and out of season) */
  function mkToggle(on) {
    return html`<span class="fl-segtog" role="tablist" aria-label="Market">
      <button type="button" role="tab" class="fl-seg fl-seg-btn ${on === 'fa' ? 'on' : ''}" aria-selected="${on === 'fa' ? 'true' : 'false'}" data-action="go-market" data-testid="btn-go-market">${K().ic('contract')}<b class="fl-sv"><span class="fl-nf">Free Agents</span><span class="fl-ns">FA</span></b></button>
      <button type="button" role="tab" class="fl-seg fl-seg-btn ${on === 'sw' ? 'on' : ''}" aria-selected="${on === 'sw' ? 'true' : 'false'}" data-action="swaps" data-testid="btn-go-swaps">${K().ic('swap')}<b class="fl-sv">Swaps</b></button>
    </span>`;
  }

  // ---------------- Market ----------------
  function header(lg, m) {
    const F = FK();
    if (m === 'offer') {
      const used = myOffers(lg).filter((o) => o.day === lg.sub).length;
      const n = myOffers(lg).length;
      void n;
      // Swaps stays one tap away (it is not a step of the flow, so it lives in the header, not the bottom bar)
      const swaps = mkToggle('fa');
      return F.head(html`${F.seg(html`<span class="fl-nf">Market </span>Day`, (lg.sub + 1) + '/' + PT.C.FA_DAYS, { icon: 'contract', cls: 'fl-seg-t', testid: 'fa-day' })}${F.seg(html`<span class="fl-nf">Offers today</span><span class="fl-ns">Offers</span>`, used + '/' + MAX_OFFERS_DAY, { cls: used >= MAX_OFFERS_DAY ? 'fl-seg-warn' : '' })}${F.gap()}${F.needSeg(lg)}${F.rosterSeg(lg)}${swaps}`);
    }
    if (m === 'sign') return F.head(html`${F.seg('', 'Free Agents', { icon: 'contract', cls: 'fl-seg-t' })}${F.gap()}${mkToggle('fa')}`);
    return F.head(html`${F.seg('', 'Market Closed', { icon: 'lock', cls: 'fl-seg-t' })}${F.seg('Opens', 'after Draft Day', { cls: 'fl-seg-dim' })}`);
  }

  const COLS = [{ k: 'name', label: 'Name', cls: 'c-name' }, { k: 'pos', label: 'Pos', cls: 'c-pos' }, { k: 'stars', label: 'Stars', cls: 'c-stars' },
    { k: 'age', label: 'Age', cls: 'c-age c-c c-hs' }, { k: 'ask', label: 'Asks', cls: 'c-ask' }, { k: 'int', label: 'Chance', cls: 'c-int' }];

  function rowOf(lg, x, offered) {
    const p = x.p, f = faceOf(x.score != null ? x.score : 95);
    return { id: p.id, testid: 'fa-row-' + p.id, sel: mk.sel === p.id, cls: offered ? 'sent' : '',
      cells: { name: FK().name(p), pos: K().posChip(p.pos), stars: FK().stars(p.ovr), age: html`<span class="num">${p.age}</span>`,
        ask: html`<span class="fl-ask"><b class="num">${D().money(x.ask.sal)}</b><span class="dim">${x.ask.yrs}y</span></span>`,
        int: offered ? FK().tag(html`${K().ic('hourglass')}Sent`, 'gold') : FK().meter(chanceOf(x), rivals(x) ? 'warn' : f.cls, rivals(x) ? 'Other teams want him' : f.word) } };
  }

  function detail(lg, x, m) {
    if (!x) return html`<aside class="fl-card fl-side fl-side-empty"><p class="fl-empty">Tap a player.</p></aside>`;
    const p = x.p;
    const mine = myOffers(lg).find((o) => o.pid === p.id) || null;
    const used = myOffers(lg).filter((o) => o.day === lg.sub && o.pid !== p.id).length;
    const w = K().WANT[p.want];
    const who = html`<div class="fl-who">${K().portrait(p, 56)}<div class="fl-who-t"><b class="fl-pn">${p.fn} ${p.ln}</b>
      <span class="fl-pm">${K().posChip(p.pos)}<span class="fl-hide-s">${K().stars(p.ovr, { noNum: true })}</span><span class="dim">Age ${p.age}</span>${w ? html`<span class="fl-want" title="Wants ${w[1]}">${K().ic(w[0])}<span class="fl-nf">Wants </span>${w[1]}</span>` : ''}</span></div></div>`;
    const asks = html`<p class="fl-note fl-asks"><span>Asks <b class="num">${D().money(x.ask.sal)}</b> × ${D().plural(x.ask.yrs, 'yr')}</span></p>${rivals(x) ? html`<p class="fl-note fl-warn warn" data-testid="fa-rivals">${K().ic('warn')} Other teams want him</p>` : ''}`;
    if (m === 'closed') return html`<aside class="fl-card fl-side" data-testid="fa-detail">${who}${asks}<p class="fl-note dim">${K().ic('lock')} The Market opens after Draft Day.</p></aside>`;
    const key = 'fa:' + p.id + ':' + lg.sub;
    if (mine) FK().offerState(key, { sal: mine.sal, yrs: mine.yrs });
    const full = m === 'offer' && !mine && used >= MAX_OFFERS_DAY;
    const offer = FK().offer({ key: key, ask: x.ask, submit: m === 'sign' ? 'Sign now' : mine ? 'Update offer' : 'Send offer', submitHtml: m === 'sign' ? '' : html`${mine ? 'Update' : 'Send'}<span class="fl-nf"> offer</span>`, disabled: full, why: full ? '5 offers a day.' : '',
      left: (sal) => space(lg) - sal,
      verdict: (sal, yrs) => {
        if (m === 'sign') return sal >= x.ask.sal ? { face: 'happy', word: 'Will sign', cls: 'good' } : { face: 'angry', word: 'Too low', cls: 'bad' };
        let s = 95;
        try { s = PT.League.FA.score(lg, p.id, lg.userTid, { sal: sal, yrs: yrs, gift: 0 }); } catch (e) { s = 95; }
        const f = faceOf(s);
        return rivals(x) && f === FACE.likely ? FACE.maybe : f;
      } });
    return html`<aside class="fl-card fl-side has-offer" data-testid="fa-detail">${who}${asks}${full ? html`<p class="fl-note bad">${K().ic('no')} 5 offers a day. Try tomorrow.</p>` : ''}${offer}</aside>`;
  }

  function mountMarket(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const m = mode(lg);
    if (m === 'offer') FK().noSub(el);
    const dayKey = lg.season + ':' + lg.phase + ':' + lg.sub;
    if (mk.day !== dayKey) { mk.day = dayKey; mk.sel = null; }
    const rowsX = list(lg, mk.filter).slice(0, FA_CAP);
    const offered = {};
    myOffers(lg).forEach((o) => { offered[o.pid] = 1; });
    if (mk.sel == null || !rowsX.concat(list(lg)).some((x) => x.p.id === mk.sel)) mk.sel = rowsX.length ? rowsX[0].p.id : null;
    const selX = mk.sel != null ? (rowsX.find((x) => x.p.id === mk.sel) || list(lg).find((x) => x.p.id === mk.sel)) : null;
    const short = FK().shortPos(lg);
    const filter = FK().filter({ value: mk.filter, title: 'Position',
      list: [{ id: '', label: 'All' }].concat(PT.C.POS.map((pos) => ({ id: pos, label: pos, dot: short.indexOf(pos) >= 0, title: K().posLabel(pos) + (short.indexOf(pos) >= 0 ? ' (need)' : '') }))),
      testid: (id) => 'fa-filter-' + (id || 'all'), pick: (v) => setFilter(v) });
    const table = FK().table({ key: 'fa', cols: COLS, rows: rowsX.map((x) => rowOf(lg, x, !!offered[x.p.id])), tools: filter, cls: 'fl-t-fa', empty: html`<p class="fl-empty">No free agents.</p>` });
    const tip = m === 'offer' ? FK().tip('fl-market', 'Send offers, then Finish Market.') : '';
    const body = html`${header(lg, m)}${tip}<div class="fl-main">${table}${detail(lg, selX, m)}</div>`;
    let foot;
    const res = m === 'offer' ? results(lg) : [];
    const info = res.length ? html`<div class="fl-tick"><span class="fl-tick-l">Answers</span>${res.slice(0, 4)}</div>` : '';
    if (m === 'offer') {
      // client: ≤ 5 Next presses per offseason. ONE primary finishes every Market day left and starts the season;
      // "Next day" (one day, to see answers first) shows only while offers wait for an answer.
      const Cal = PT.League.Calendar;
      const pend = pendingCount(lg) > 0 && lg.sub + 1 < PT.C.FA_DAYS;
      const sec = pend ? FK().sec({ label: 'Next day', icon: 'ff', action: 'flow-next', testid: 'btn-fa-next-day' }) : '';
      const pri = Cal && Cal.finishMarket ? FK().pri({ label: 'Finish Market', sub: 'Start season', icon: 'play', action: 'finish', testid: 'btn-fa-finish' })
        : FK().next({ testid: 'btn-fa-next-day' });
      foot = FK().foot(info, sec, pri);
    }
    else if (['RESIGN', 'DRAFT'].includes(lg.phase)) foot = FK().foot('', '', FK().next());
    else foot = null;                 // in season: signing happens in the card; Swaps is the header switch (no 2nd primary)
    D().set(el, K().layout(body, foot, 'fit flow fl-market'));
    FK().paintOffer(el);
  }

  function setFilter(v) { mk.filter = v || ''; mk.sel = null; if (UI.pgPage) UI.pgPage('fa', 0); UI.refresh(); }

  function send() {
    const lg = L();
    const m = mode(lg);
    const x = list(lg).find((y) => y.p.id === mk.sel);
    if (!x || m === 'closed') return;
    const p = x.p, o = FK().offerValue();
    let r;
    if (m === 'sign') {
      if (o.sal < x.ask.sal) { UI.Toast.show(p.fn + ' wants ' + D().money(x.ask.sal) + '.', 'bad'); return; }
      try { r = PT.League.FA.signNow(lg, p.id, { sal: o.sal, yrs: o.yrs }); } catch (e) { r = { ok: false, msg: 'Could not sign.' }; }
      UI.Toast.show(r && r.ok ? p.fn + ' signed' : (r && r.msg) || 'No deal.', r && r.ok ? 'good' : 'bad');
      if (r && r.ok) mk.sel = null;
    } else {
      try { r = PT.League.FA.offer(lg, p.id, { sal: o.sal, yrs: o.yrs, gift: 0 }); } catch (e) { r = { ok: false, msg: 'Offer failed.' }; }
      if (r && r.ok) sent(lg).o[p.id] = { sal: o.sal, yrs: o.yrs };
      UI.Toast.show(r && r.ok ? (r.status === 'signed' ? p.fn + ' signed' : 'Offer sent') : (r && r.msg) || 'Offer failed.', r && r.ok ? 'good' : 'bad');
    }
    if (PT.Events) PT.Events.emit('league:changed', { what: 'fa' });
    UI.refresh();
  }

  /** Finish Market: every Market day left at once, then the new season starts (Calendar.finishMarket) */
  function finishMarket() {
    const lg = L(), F = UI.Flow;
    const st = F && F.status ? F.status() : null;
    if (!PT.League.Calendar.finishMarket || (st && st.blockers && st.blockers.length)) { if (F) F.next(); return; }
    const short = FK().shortPos(lg);
    if (short.length) {
      UI.Modal.open({ title: 'You still need ' + short.join(', '), icon: 'warn', body: 'Finish anyway? You can sign a walk-on before Week 1.',
        buttons: [{ label: 'Back', value: null, kind: 'cancel', testid: 'btn-finish-back' }, { label: 'Finish anyway', value: 'ok', kind: 'go' }] })
        .then((v) => { if (v === 'ok') checkOver(lg, F); });
      return;
    }
    checkOver(lg, F);
  }
  /** over the Week 1 limit or the Team Cash limit: say so now (who would go + dead money), never as a Week 1 surprise */
  function checkOver(lg, F) {
    const rc = FK().rosterCount(lg);
    const sp = space(lg);
    if (rc.act <= rc.max && sp >= 0) { runFinish(lg, F); return; }
    let cuts = [];
    try { cuts = (PT.League.Cap.fixPlan(lg, lg.userTid, rc.max).cuts || []).map((pid) => PT.League.Q.player(lg, pid)).filter(Boolean); } catch (e) { cuts = []; }
    const cost = (p) => { try { return PT.League.Roster.cutCost(lg, p.id); } catch (e) { return { perYear: 0, years: 0 }; } };
    const rows = cuts.map((p) => { const c = cost(p);
      return html`<div class="fl-lv">${K().posChip(p.pos)}<b class="fl-lv-n">${p.fn.charAt(0)}. ${p.ln}</b><span class="fl-lv-r">${FK().stars(p.ovr)}<b class="num">${p.con ? D().money(p.con.sal) : ''}</b>${c.perYear ? FK().tag('Dead ' + D().money(c.perYear) + (c.years > 1 ? ' ×' + c.years : ''), 'red') : FK().tag('No dead money', 'green')}</span></div>`; });
    const parts = [];
    if (sp < 0) parts.push('Over Team Cash by ' + D().money(-sp));
    if (rc.act > rc.max) parts.push('Week 1 limit ' + rc.max + ' · you have ' + rc.act);
    UI.Modal.open({ title: parts.join(' · '), icon: sp < 0 ? 'cash' : 'players', cls: 'm-list m-leave', dismiss: false,
      body: html`<p class="fl-note">Auto fix would release:</p>${K().pg('cuts', rows, { cls: 'fl-lv-pg' })}`,
      buttons: [{ label: 'Back', value: null, kind: 'cancel', testid: 'cut-back' }, { label: 'Pick myself', value: 'pick', kind: 'sec', testid: 'btn-cut-pick' }, { label: 'Auto fix', value: 'auto', kind: 'go' }] })
      .then((v) => {
        if (v === 'pick') { UI.go('roster'); return; }
        if (v !== 'auto') return;
        try {
          if (FK().rosterCount(lg).act > rc.max) PT.League.Roster.fixIt(lg, lg.userTid, { max: rc.max });
          if (space(lg) < 0) PT.League.Roster.fixCap(lg, lg.userTid);
        } catch (e) { UI.Toast.show('Could not fix it.', 'bad'); return; }
        if (PT.Events) PT.Events.emit('league:changed', { what: 'roster' });
        runFinish(lg, F);
      });
  }
  function runFinish(lg, F) {
    const busy = UI.Modal.busy('Finishing the Market…');
    setTimeout(() => {
      let r = null;
      try { r = PT.League.Calendar.finishMarket(lg); } catch (e) { r = { ok: false, msg: 'Something went wrong. Try again.' }; if (PT.Log) PT.Log.error('ui', 'finish market', e); }
      busy.close();
      if (r && r.ok) {
        try { if (PT.App.save) PT.App.save({}); } catch (e) { /* the auto save will catch up */ }
        UI.Toast.show('Season ' + lg.season + ' begins', 'good', 3000);
      } else UI.Toast.show((r && r.msg) || 'Not yet.', 'bad');
      if (UI.theme) UI.theme();
      if (F) F.goPhase(); else UI.reset();
    }, 30);
  }

  UI.screens.market = {
    title: 'Market',
    nav: 'market',
    mount: (el) => mountMarket(el),
    actions: FK().withActions({
      row: (el) => { mk.sel = +el.getAttribute('data-pid'); UI.refresh(); },
      filter: (el) => setFilter(el.getAttribute('data-pos')),
      'fl-send': () => send(),
      'go-market': () => {},
      swaps: () => UI.go('swaps'),
      finish: () => finishMarket()
    })
  };

  // ---------------- Swaps ----------------
  const sw = { tid: null, give: [], get: [], params: null };

  function evalSwap(lg) {
    const T = PT.League.Trade;
    if (!sw.give.length || !sw.get.length) return { k: 'none', v: 0, word: 'Pick players on both sides.', cls: '' };
    let ev = null;
    try { ev = T && T.evaluate ? T.evaluate(lg, { pids: sw.give.slice() }, { pids: sw.get.slice(), tid: sw.tid }, sw.tid) : null; } catch (e) { ev = null; }
    if (!ev) return { k: 'none', v: 0, word: 'Swaps are not ready.', cls: 'bad' };
    if (!ev.legal) return { k: 'bad', v: 0, word: ev.errors[0] || 'Not allowed.', cls: 'bad' };
    const r = ev.threshold ? ev.ratio / ev.threshold : ev.ratio;
    if (ev.accept) return { k: 'yes', v: 100, word: 'Fair. They may say yes.', cls: 'good' };
    if (ev.meter === 'yellow') return { k: 'close', v: 70, word: 'Close. Add a little more.', cls: 'warn' };
    return { k: 'no', v: Math.max(10, Math.min(50, Math.round(r * 50))), word: 'Not enough for them.', cls: 'bad' };
  }
  function swapOpen(lg) {
    const T = PT.League.Trade;
    try { if (T && T.open) return T.open(lg); } catch (e) { /* fall back */ }
    return !(lg.phase === 'DRAFT' || lg.phase === 'PLAYOFFS' || (lg.phase === 'REGULAR' && lg.week > 10));
  }

  const SW_COLS = [{ k: 'ck', label: '', cls: 'c-ck' }, { k: 'name', label: 'Name', cls: 'c-name' }, { k: 'pos', label: 'Pos', cls: 'c-pos' },
    { k: 'stars', label: 'Stars', cls: 'c-stars' }, { k: 'age', label: 'Age', cls: 'c-age c-c' }];

  function swapRows(lg, ps, side, sel) {
    return ps.map((p) => ({ id: p.id, testid: 'swap-' + side + '-' + p.id, sel: sel.includes(p.id), attrs: 'data-side="' + side + '"',
      cells: { ck: html`<span class="fl-ck">${sel.includes(p.id) ? K().ic('check') : ''}</span>`, name: FK().name(p), pos: K().posChip(p.pos),
        stars: FK().stars(p.ovr), age: html`<span class="num">${p.age}</span>` } }));
  }

  /** team picker sheet (31 badges, one tap) */
  function teamSheet() {
    const lg = L(), u = lg.userTid;
    const body = html`<div class="sw-teams nc-teams" role="toolbar" aria-label="Pick a team">${lg.teams.filter((t) => t.id !== u).map((t) => html`<button type="button" class="sw-team ${t.id === sw.tid ? 'on' : ''}" data-action="sw-team" data-tid="${t.id}" data-testid="swap-team-${t.id}" title="${K().teamFull(t)}">${K().badge(t, 'm')}</button>`)}</div>`;
    UI.Modal.open({ title: 'Swap With', body: body, cls: 'm-teams', buttons: [{ label: 'Close', value: null, kind: 'cancel' }],
      actions: { 'sw-team': (t, card, entry) => { entry.close(+t.getAttribute('data-tid')); } } })
      .then((tid) => { if (tid == null || tid === sw.tid) return; sw.tid = tid; sw.get = []; if (UI.pgPage) UI.pgPage('swtheirs', 0); UI.refresh(); });
  }

  function mountSwaps(el, params) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    FK().noSub(el);
    const u = lg.userTid;
    let reveal = false;
    if (sw.params !== params) {
      sw.params = params; sw.tid = params && params.tid != null ? params.tid : null;
      // QA1: the player card's Swap / Ask for Swap buttons pass the player; start with him picked
      const mineP = params && params.give != null ? PT.League.Q.player(lg, params.give) : null;
      const theirP = params && params.get != null ? PT.League.Q.player(lg, params.get) : null;
      sw.give = mineP && mineP.tid === u ? [mineP.id] : [];
      sw.get = theirP && theirP.tid === sw.tid ? [theirP.id] : [];
      reveal = true;
    }
    if (sw.tid == null || sw.tid === u) sw.tid = lg.teams[u].rival != null && lg.teams[u].rival !== u ? lg.teams[u].rival : (u + 1) % lg.teams.length;
    const them = lg.teams[sw.tid], me = lg.teams[u];
    const on = (tid) => (pid) => { const p = PT.League.Q.player(lg, pid); return !!p && p.tid === tid; };
    sw.give = sw.give.filter(on(u)); sw.get = sw.get.filter(on(sw.tid));     // drop players who moved since
    const open = swapOpen(lg);
    const f = open ? evalSwap(lg) : { k: 'closed', v: 0, word: 'Swaps closed. Open from Keep Players to Week 10.', cls: 'bad' };
    const mine = PT.League.Q.roster(lg, u).slice().sort((a, b) => b.ovr - a.ovr);
    const theirs = PT.League.Q.roster(lg, sw.tid).slice().sort((a, b) => b.ovr - a.ovr);
    const F = FK();
    const head = F.head(html`<span class="fl-seg fl-seg-t">${K().badge(me, 's')}<b class="fl-sv">${F.team(me)}</b></span>${F.seg('', 'swap with', { cls: 'fl-seg-dim' })}<button type="button" class="fl-seg fl-seg-t fl-seg-btn" data-action="sw-pick" data-testid="btn-swap-team" title="Pick a team">${K().badge(them, 's')}<b class="fl-sv">${F.team(them)}</b><i class="fl-caret fl-caret-w" aria-hidden="true"></i></button>${F.gap()}${mkToggle('sw')}`);
    const give = F.table({ key: 'swmine', cols: SW_COLS, rows: swapRows(lg, mine, 'mine', sw.give), action: 'sw-toggle', cls: 'fl-t-swap fl-give',
      tools: html`<span class="fl-sw-h"><b>You give</b><span class="fl-sw-n num">${sw.give.length}/3</span></span>` });
    const get = F.table({ key: 'swtheirs', cols: SW_COLS, rows: swapRows(lg, theirs, 'theirs', sw.get), action: 'sw-toggle', cls: 'fl-t-swap fl-get',
      tools: html`<span class="fl-sw-h"><b>You get</b><span class="fl-sw-n num">${sw.get.length}/3</span></span>` });
    const body = html`${head}<div class="fl-main">${give}${get}</div>`;
    const fair = html`<div class="fl-fair" data-testid="swap-fair">${open ? html`<span class="fl-ol">Fair?</span>${F.meter(f.v, f.cls, f.word)}` : K().ic('lock')}<span class="fl-fair-t ${f.cls}">${f.word}</span></div>`;
    const foot = F.foot(fair, '', F.pri({ label: 'Propose', icon: 'contract', action: 'sw-propose', testid: 'btn-swap-propose', disabled: !open || f.k === 'none' || f.k === 'bad' }));
    D().set(el, K().layout(body, foot, 'fit flow fl-swap'));
    // a fresh visit starts on page 1 (or on the page of the pre-picked player)
    if (reveal && UI.fit && UI.pgReveal) {
      UI.fit(el);
      const g = sw.give[0] != null ? sw.give[0] : mine[0] && mine[0].id, t = sw.get[0] != null ? sw.get[0] : theirs[0] && theirs[0].id;
      if (g != null) UI.pgReveal('swap-mine-' + g);
      if (t != null) UI.pgReveal('swap-theirs-' + t);
    }
  }

  function propose() {
    const lg = L();
    const T = PT.League.Trade;
    let r = null;
    if (T && T.propose) {
      try { r = T.propose(lg, { from: lg.userTid, to: sw.tid, give: sw.give.slice(), get: sw.get.slice() }); } catch (e) { r = { ok: false, msg: 'Swap failed.' }; }
    } else r = { ok: false, msg: 'Swaps are not ready yet.' };
    const yes = r && r.ok && r.accepted;
    UI.Modal.open({ title: yes ? 'Deal Done' : 'No Deal', icon: yes ? 'contract' : 'sad', body: (r && r.msg) || (yes ? 'Swap complete.' : 'They turned it down.'), buttons: [{ label: 'OK', value: true, kind: 'go' }] })
      .then(() => {
        if (yes) { sw.give = []; sw.get = []; if (PT.Events) PT.Events.emit('league:changed', { what: 'trade' }); }
        UI.refresh();
        if (yes) FK().confetti(40);
      });
  }

  UI.screens.swaps = {
    title: 'Swaps',
    nav: 'market',
    mount: mountSwaps,
    actions: FK().withActions({
      'sw-team': (el) => { sw.tid = +el.getAttribute('data-tid'); sw.get = []; if (UI.pgPage) UI.pgPage('swtheirs', 0); UI.refresh(); },
      'sw-pick': () => teamSheet(),
      'go-market': () => { const c = UI.current(); if (UI.depth() > 1 && c && c.name === 'swaps') UI.back(); if (!UI.current() || UI.current().name !== 'market') UI.replace('market'); },
      swaps: () => {},
      'sw-toggle': (el) => {
        const side = el.getAttribute('data-side'), pid = +el.getAttribute('data-pid');
        const arr = side === 'mine' ? sw.give : sw.get;
        const i = arr.indexOf(pid);
        if (i >= 0) arr.splice(i, 1);
        else if (arr.length >= 3) { UI.Toast.show('3 players max per side.', 'bad'); return; }
        else arr.push(pid);
        UI.refresh();
      },
      'sw-propose': () => propose()
    })
  };
})(globalThis.PT = globalThis.PT || {});
