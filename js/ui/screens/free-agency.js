/* Pixel Touchdown: js/ui/screens/free-agency.js
 * Owner: WP5. Responsibility: FA list, offers, day advance ("Market", design 10.7) + Swaps (trades, design 10.8).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;

  let filter = '';
  const MAX_OFFERS_DAY = 5;

  function space(lg) { try { return PT.League.Cap.space(lg, lg.userTid); } catch (e) { return 0; } }
  function myOffers(lg) { return ((lg.fa && lg.fa.offers) || []).filter((o) => o.tid === lg.userTid); }
  function list(lg) {
    try { return PT.League.FA.list(lg, { pos: filter || undefined }) || []; } catch (e) { return []; }
  }
  function mode(lg) {
    if (lg.phase === 'FREE_AGENCY') return 'offer';
    if (lg.phase === 'REGULAR' || lg.phase === 'PRESEASON') return 'sign';
    return 'closed';
  }
  /** user-side interest estimate (design 10.7 score, simplified to what the UI knows) */
  function score(lg, p, ask, sal, yrs, gift) {
    const t = lg.teams[lg.userTid];
    const mw = { money: 1.3, fame: 1.0, wins: 0.8, home: 0.9, chill: 1.0 }[p.want] || 1;
    let s = 100 * (sal / Math.max(1, ask.sal)) * mw + (t.fin.hype - 50) * 0.2 + (gift || 0) / 10;
    if (p.want === 'fame' && t.fin.hype >= 70) s += 5;
    if (ask.yrs && Math.abs(yrs - ask.yrs) > 1) s -= 5;
    s += [10, 0, -8, -10][lg.diff] || 0;   // ROUND6 B: Expert = Normal + 0.75 x (Legend - Normal)
    s += ((lg.coach && lg.coach.lvl) || 1) * 0.3;
    return s;
  }
  function face(s) {
    if (s >= 105) return { face: 'happy', word: 'Likely', cls: 'good' };
    if (s >= 90) return { face: 'meh', word: 'Maybe', cls: 'warn' };
    return { face: 'sad', word: 'Unlikely', cls: 'bad' };
  }
  function interestFace(x) {
    const i = x.interest == null ? 50 : x.interest;
    return i >= 65 ? face(110) : i >= 40 ? face(95) : face(80);
  }

  // ---------------- Market ----------------
  // ROUND6 "0 scrolling": side panel (day, cash, links) + position chips + one paged list (pager.js). My Offers opens a sheet.
  const FA_CAP = 60;           // best 60 per filter; the position chips reach the rest
  function side(lg, m) {
    const t = lg.teams[lg.userTid];
    const left = Math.max(0, MAX_OFFERS_DAY - myOffers(lg).filter((o) => o.day === lg.sub).length);
    const txt = m === 'offer' ? html`<b class="nc-t">Market Day ${lg.sub + 1}/${PT.C.FA_DAYS}</b><span class="small">Offers left today: <b class="num">${left}</b></span>`
      : m === 'sign' ? html`<b class="nc-t">Free Agents</b><span class="small">Sign now at his Ask.</span>`
      : html`<b class="nc-t">Market Closed</b><span class="small">Opens after Draft Day.</span>`;
    const memo = sent(lg);
    myOffers(lg).forEach((o) => { memo.o[o.pid] = { sal: o.sal, yrs: o.yrs }; });
    const n = Object.keys(memo.o).length;
    return html`<aside class="card card-cream nc-side-card">
      <div class="nc-head"><span class="nc-emo" aria-hidden="true">${K().ic('contract')}</span><div class="nc-head-t">${txt}</div></div>
      <div class="nc-stats">${K().cash(space(lg))}${K().coins(t.fin.coins)}</div>
      <div class="nc-links">
        ${n ? K().btn({ label: 'My Offers', sub: String(n), icon: 'contract', action: 'offers', kind: 'gold', size: 's', testid: 'btn-fa-offers', cls: 'nc-wide' }) : ''}
        ${K().btn({ label: 'Swaps', icon: 'swap', action: 'swaps', kind: 'sec', size: 's', testid: 'btn-go-swaps' })}
        ${K().btn({ label: 'Board', icon: 'scope', action: 'board', kind: 'sec', size: 's', testid: 'btn-go-board', title: 'Draft Board' })}
      </div>
    </aside>`;
  }

  /** offers I sent this offseason (UI memo), so resolved ones can show "Signed" after the day ends */
  function sent(lg) {
    const m = D().memo.mkSent;
    if (m && m.id === lg.id && m.s === lg.season) return m;
    D().memo.mkSent = { id: lg.id, s: lg.season, o: {} };
    return D().memo.mkSent;
  }
  function offerRows(lg) {
    const offs = myOffers(lg);
    const memo = sent(lg);
    const pend = {};
    offs.forEach((o) => { pend[o.pid] = o; memo.o[o.pid] = { sal: o.sal, yrs: o.yrs }; });
    return Object.keys(memo.o).map(Number).map((pid) => {
      const p = PT.League.Q.player(lg, pid);
      if (!p) return '';
      const o = pend[pid] || memo.o[pid];
      const st = p.tid === lg.userTid ? K().chip(html`${K().ic('check')} Signed`, 'green') : pend[pid] ? K().chip(html`${K().ic('hourglass')} Waiting`, 'gold')
        : p.tid >= 0 ? K().chip('Went to ' + lg.teams[p.tid].abbr, 'red') : K().chip('Said no', 'red');
      return html`<div class="mk-off">${K().portrait(p, 40)}<span class="grow ellip"><b>${K().pname(p)}</b><br><span class="small num">${D().money(o.sal)} × ${D().plural(o.yrs, 'yr')}</span></span>${st}</div>`;
    }).filter(Boolean);
  }
  function offersSheet() {
    const lg = L();
    UI.Modal.open({ title: 'My Offers', body: html`${K().pg('offers', offerRows(lg), { cls: 'nc-side' })}`, cls: 'm-offers', buttons: [{ label: 'Close', value: true, kind: 'go' }] });
  }

  function filters() {
    const all = [''].concat(PT.C.POS);
    return html`<div class="fchips nc-chips" role="toolbar" aria-label="Position">${all.map((pos) => html`<button type="button" class="fchip ${filter === pos ? 'on' : ''}" data-action="filter" data-pos="${pos}" data-testid="fa-filter-${pos || 'all'}">${pos || 'All'}</button>`)}</div>`;
  }

  function row(lg, x) {
    const p = x.p;
    const f = interestFace(x);
    const offered = myOffers(lg).some((o) => o.pid === p.id);
    const right = html`<span class="num"><b>${D().money(x.ask.sal)}</b></span><span class="small muted">${D().plural(x.ask.yrs, 'yr')}</span>`;
    const sub = html`<span class="muted num">${p.age}y</span> <span class="chip mk-face ${f.cls}" title="${f.word}">${K().ic(f.face)}<span class="nc-fw">${f.word}</span></span>${offered ? html` <span class="chip chip-gold">Offered</span>` : ''}`;
    return K().playerRow(p, { action: 'row', testid: 'fa-row-' + p.id, sub: sub, right: right, compact: true, cls: 'nc-prow' });
  }

  function mountMarket(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const m = mode(lg);
    const all = list(lg);
    const shown = all.slice(0, FA_CAP);
    const count = all.length > FA_CAP ? FA_CAP + ' of ' + all.length : String(all.length);
    const main = html`<div class="nc-main"><div class="nc-tools">${filters()}<span class="nc-count small" title="Free agents">${count}</span></div>
      <div class="fill">${K().pg('fa', shown.map((x) => row(lg, x)), { grid: true, cls: 'nc-side nc-plist', empty: K().empty('players', 'No free agents.') })}</div></div>`;
    const body = html`${K().tip('market', 'contract', 'Tap a player to make an offer. Players answer at the end of each Market Day.')}
      <div class="nc-split">${side(lg, m)}${main}</div>`;
    const foot = m === 'offer' ? K().nextBtn({ testid: 'btn-fa-next-day' })
      : ['RESIGN', 'DRAFT'].includes(lg.phase) ? K().nextBtn()
      : K().btn({ label: 'Swaps', icon: 'swap', action: 'swaps', kind: 'pri', size: 'l', testid: 'btn-foot-swaps' });
    D().set(el, K().layout(body, foot, 'fit market nc'));
  }

  function offer(pid) {
    const lg = L();
    const m = mode(lg);
    const x = (PT.League.FA.list(lg, {}) || []).find((y) => y.p.id === pid);
    if (!x) return;
    const p = x.p, t = lg.teams[lg.userTid];
    if (m === 'closed') {
      UI.Modal.open({ title: K().pname(p), icon: 'hourglass', body: html`<p>The Market opens after Draft Day.</p><p class="small muted">He asks ${D().money(x.ask.sal)} for ${D().plural(x.ask.yrs, 'year')}.</p>`, buttons: [{ label: 'OK', value: true, kind: 'go' }] });
      return;
    }
    if (m === 'offer' && !myOffers(lg).some((o) => o.pid === pid) && myOffers(lg).filter((o) => o.day === lg.sub).length >= MAX_OFFERS_DAY) {
      UI.Toast.show('Max 5 offers per day.', 'bad');
      return;
    }
    UI.parts.offerSheet({
      p: p, ask: x.ask, title: m === 'sign' ? 'Sign ' + p.fn + '?' : 'Offer to ' + p.fn, submit: m === 'sign' ? 'Sign Now' : 'Send Offer',
      gift: m === 'offer', coins: t.fin.coins,
      left: (sal) => space(lg) - sal,
      verdict: (sal, yrs, gift) => (m === 'sign' ? (sal >= x.ask.sal ? { face: 'happy', word: 'Will sign', cls: 'good' } : { face: 'angry', word: 'Too low', cls: 'bad' }) : face(score(lg, p, x.ask, sal, yrs, gift)))
    }).then((o) => {
      if (!o) return;
      let r;
      if (m === 'sign') {
        if (o.sal < x.ask.sal) { UI.Toast.show(p.fn + ' wants ' + D().money(x.ask.sal) + '.', 'bad'); return; }
        try { r = PT.League.FA.signNow(lg, pid, { sal: o.sal, yrs: o.yrs }); } catch (e) { r = { ok: false, msg: 'Could not sign.' }; }
        UI.Toast.show(r && r.ok ? p.fn + ' signed' : (r && r.msg) || 'No deal.', r && r.ok ? 'good' : 'bad');
      } else {
        try { r = PT.League.FA.offer(lg, pid, { sal: o.sal, yrs: o.yrs, gift: o.gift }); } catch (e) { r = { ok: false, msg: 'Offer failed.' }; }
        UI.Toast.show(r && r.ok ? (r.status === 'signed' ? p.fn + ' signed' : 'Offer sent') : (r && r.msg) || 'Offer failed.', r && r.ok ? 'good' : 'bad');
      }
      if (PT.Events) PT.Events.emit('league:changed', { what: 'fa' });
      UI.refresh();
    });
  }

  UI.screens.market = {
    title: 'Market',
    nav: 'market',
    mount: (el) => mountMarket(el),
    actions: {
      row: (el) => offer(+el.getAttribute('data-pid')),
      filter: (el) => { filter = el.getAttribute('data-pos') || ''; if (UI.pgPage) UI.pgPage('fa', 0); UI.refresh(); },
      offers: () => offersSheet(),
      swaps: () => UI.go('swaps'),
      board: () => UI.go('draft')
    }
  };

  // ---------------- Swaps ----------------
  const sw = { tid: null, give: [], get: [], params: null };

  function swapOpen(lg) {
    if (lg.phase === 'DRAFT' || lg.phase === 'PLAYOFFS') return false;
    if (lg.phase === 'REGULAR' && lg.week > 10) return false;
    return true;
  }
  function val(lg, pid) {
    const T = PT.League.Trade;
    if (T && T.value) { try { const v = T.value(lg, pid); if (typeof v === 'number' && !isNaN(v)) return v; } catch (e) { /* fallback */ } }
    const p = PT.League.Q.player(lg, pid);
    return p ? Math.max(1, (p.ovr - 40) * 2 + Math.max(0, 28 - p.age) * 3) : 0;
  }
  /** AI view: what they get (your side) vs what they give (their side), × difficulty threshold */
  function fair(lg) {
    const inV = sw.give.reduce((s, pid) => s + val(lg, pid), 0);
    const outV = sw.get.reduce((s, pid) => s + val(lg, pid), 0);
    const thr = [1.0, 1.1, 1.21, 1.25][lg.diff] || 1.1;
    if (!sw.give.length || !sw.get.length) return { k: 'none', pct: 0, word: 'Pick players on both sides', cls: '' };
    const r = inV / Math.max(1, outV * thr);
    if (r >= 1) return { k: 'yes', pct: Math.min(100, 70 + (r - 1) * 60), word: 'Fair deal. They may accept.', cls: 'm-green' };
    if (r >= 0.85) return { k: 'close', pct: 40 + (r - 0.85) * 200, word: 'Close. Add a little more.', cls: 'm-gold' };
    return { k: 'no', pct: Math.max(6, r * 45), word: 'Not enough for them.', cls: 'm-red' };
  }

  function pickRow(lg, p, side, on) {
    return html`<button type="button" class="sw-p nc-swp ${on ? 'on' : ''}" data-action="sw-toggle" data-side="${side}" data-pid="${p.id}" data-testid="swap-${side}-${p.id}" aria-pressed="${on ? 'true' : 'false'}">
      ${K().posChip(p.pos)}<span class="nc-swp-m"><b class="ellip">${K().short(p)}</b><span class="nc-swp-s">${K().stars(p.ovr)}</span></span><span class="sw-chk">${K().ic(on ? 'check' : 'plus')}</span></button>`;
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
    const f = fair(lg);
    const mine = PT.League.Q.roster(lg, u).slice().sort((a, b) => b.ovr - a.ovr);
    const theirs = PT.League.Q.roster(lg, sw.tid).slice().sort((a, b) => b.ovr - a.ovr);
    const names = (ids) => ids.map((pid) => { const p = PT.League.Q.player(lg, pid); return p ? p.pos + ' ' + K().short(p) : ''; }).filter(Boolean).join(', ');
    const pick = K().btn({ label: 'Team', icon: 'swap', action: 'sw-pick', kind: 'gold', size: 's', testid: 'btn-swap-team', cls: 'nc-pick' });
    const col = (title, t, ps, side, sel, extra) => html`<section class="card nc-swc ${side === 'mine' ? 'nc-give' : 'nc-get'}">
      <div class="nc-swh">${K().badge(t, 's')}<b class="nc-swh-t ellip">${title}</b><span class="nc-swh-n num ${sel.length ? 'on' : ''}" title="${names(sel) || 'Nobody yet'}">${sel.length}/3</span>${extra || ''}</div>
      ${K().pg(side === 'mine' ? 'swmine' : 'swtheirs', ps.map((p) => pickRow(lg, p, side, sel.includes(p.id))), { grid: true, cls: 'nc-side nc-swl' })}</section>`;
    const body = html`<div class="cols2 nc-swcols">${col('You give', me, mine, 'mine', sw.give)}${col('You get: ' + them.name, them, theirs, 'theirs', sw.get, pick)}</div>`;
    const fairBox = html`<div class="sw-fair nc-fair">${open ? html`<span class="field-l">Fairness</span>${K().meter(Math.round(f.pct), 100, f.cls, 'Fair')}<p class="small sw-fair-t ${f.k === 'yes' ? 'good' : f.k === 'no' ? 'bad' : ''}">${f.word}</p>`
      : html`<p class="hot-seat small">${K().ic('lock')} Swaps closed. Open from Keep Players to Week 10.</p>`}</div>`;
    const foot = html`${fairBox}${K().btn({ label: 'Propose', icon: 'contract', action: 'sw-propose', kind: 'go', size: 'l', testid: 'btn-swap-propose', disabled: !open || f.k === 'none' })}`;
    D().set(el, K().layout(body, foot, 'fit swaps nc'));
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
      });
    if (yes) { const v = D().$('#screen .lay'); if (v) K().confetti(v, 40); }
  }

  UI.screens.swaps = {
    title: 'Swaps',
    nav: 'market',
    mount: mountSwaps,
    actions: {
      'sw-team': (el) => { sw.tid = +el.getAttribute('data-tid'); sw.get = []; if (UI.pgPage) UI.pgPage('swtheirs', 0); UI.refresh(); },
      'sw-pick': () => teamSheet(),
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
    }
  };
})(globalThis.PT = globalThis.PT || {});
