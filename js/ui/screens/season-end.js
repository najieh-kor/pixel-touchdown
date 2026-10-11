/* Pixel Touchdown: js/ui/screens/season-end.js
 * Owner: FLOW-UX (was WP5). "Season Recap" (docs/handoff/FLOW-UX.md): Awards · Growth · Goodbyes as THREE TABS of one
 * screen with ONE Next (the league runs them together on entering SEASON_END). Each tab: a hero card (champion / biggest
 * riser / farewell), a paged grid of two-line rows (full name on line 1, details on line 2: never truncated), summary
 * chips in the list's title bar. The champion moment is confetti + a banner that fades by itself. Also 'fired'.
 * Screens: 'awards' (= 'season-end'), 'growth', 'goodbyes' all mount the recap (on that tab); tabs recap-tab-{id}. Row testids: award-{k}, pro-{pid},
 * player-row-{pid} (Growth), gb-row-{id}, btn-retire-num-{id}.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;
  const P = (lg, pid) => (pid == null ? null : PT.League.Q.player(lg, pid));

  function lastSeason(lg) { const s = (lg.hist && lg.hist.seasons) || []; return s[s.length - 1] || null; }
  function isMine(lg, p) { return p && p.tid === lg.userTid; }

  // ---------------- shared (FLOW-UX: one-screen summaries) ----------------
  const FK = () => UI.FlowKit;
  /** two-line cell: line 1 = full name (never cut), line 2 = details */
  const two = (name, sub, right) => FK().two(name, sub, right);
  const TWO_COLS = [{ k: 'main', label: '', cls: 'c-name' }];
  /** the recap's three tabs (one screen, one Next — client: "no 50 NEXT buttons") */
  const TABS = [{ id: 'awards', label: 'Awards', icon: 'trophy' }, { id: 'growth', label: 'Growth', icon: 'sprout' }, { id: 'goodbyes', label: 'Goodbyes', icon: 'hand' }];
  const recap = { tab: 'awards', key: '', name: '', pro: false };
  function recapLayout(el, lg, v) {
    FK().noSub(el);
    FK().railOn(el, 'hub');            // part of the NEXT flow: the rail lights HQ (ui.js maps awards/goodbyes to Office)
    const S = lastSeason(lg);
    const tabs = html`<div class="fl-tabs" role="tablist">${TABS.map((t) => html`<button type="button" role="tab" class="fl-tab ${recap.tab === t.id ? 'on' : ''}" aria-selected="${recap.tab === t.id ? 'true' : 'false'}" data-action="recap-tab" data-tab="${t.id}" data-testid="recap-tab-${t.id}">${K().ic(t.icon)}<span>${t.label}</span></button>`)}</div>`;
    const head = FK().head(html`${tabs}${FK().gap()}${S ? FK().seg('', S.s + ' Season', { cls: 'fl-seg-dim', testid: 'recap-season' }) : ''}`, 'fl-head-tabs');
    D().set(el, K().layout(html`${head}<div class="fl-main">${v.hero}${v.table}</div>`, FK().foot('', '', FK().next()), 'fit flow fl-sum fl-recap fl-tab-' + recap.tab));
  }
  /** summary chips that sit in the list's title bar */
  const chips = (list) => html`<span class="fl-sumc">${list.filter(Boolean)}</span>`;

  // ---------------- Awards Night ----------------
  const AWARDS = [
    { k: 'mvp', name: 'Top Dog', icon: 'crown' },
    { k: 'opoy', name: 'Best Offense', icon: 'football' },
    { k: 'dpoy', name: 'Best Defense', icon: 'shield' },
    { k: 'roy', name: 'Best Newbie', icon: 'sprout' }
  ];

  /** the Boss goal result for the season (History.ss(L).bossEval, set at season end): green Met / red Missed */
  function bossLine(lg, ur) {
    let ev = null;
    try { const H = PT.League.History; ev = H && H.ss ? H.ss(lg).bossEval : null; } catch (e) { ev = null; }
    if (!ev || ev.met == null) return '';
    const G = PT.Data && PT.Data.Text && PT.Data.Text.goals;
    const gt = (G && G[ev.goal]) || '';
    const rec = ur ? ' (' + D().rec(ur.w || 0, ur.l || 0, ur.t || 0) + ')' : '';
    return html`<span class="fl-line" data-testid="aw-boss">${FK().tag(html`${K().bossFace(ev.met ? 80 : 30)}<span class="fl-nf">Boss goal${gt ? ': ' + gt : ''} · </span>${ev.met ? 'Met' : 'Missed'}${rec}`, ev.met ? 'green' : 'red')}</span>`;
  }
  function awardsView(lg) {
    const S = lastSeason(lg);
    const u = lg.userTid;
    if (!S) return { hero: html`<section class="fl-card fl-hero"><p class="fl-hero-k">${K().ic('trophy')} Awards</p></section>`, table: html`<section class="fl-card"><p class="fl-empty">No awards yet.</p></section>` };
    const champ = S.champ != null ? lg.teams[S.champ] : null, ru = S.ru != null ? lg.teams[S.ru] : null;
    const won = S.champ === u;
    const ur = S.user || {};
    const me = lg.teams[u];
    const rows = [];
    AWARDS.forEach((a) => {
      const p = P(lg, S[a.k]);
      const t = p && p.tid >= 0 ? lg.teams[p.tid] : null;
      if (!p) return;                                   // no winner (e.g. no rookies played): leave it out
      rows.push({ id: p.id, testid: 'award-' + a.k, action: 'player', cls: isMine(lg, p) ? 'mine' : '',
        cells: { main: two(p.fn + ' ' + p.ln, html`${K().ic(a.icon)}<b>${a.name}</b>${K().posChip(p.pos)}${t ? html`${K().badge(t, 's')}<span class="fl-nf">${t.abbr}</span>` : 'Free Agent'}`, isMine(lg, p) ? FK().tag('Yours', 'gold') : '') } });
    });
    const coy = S.coy != null ? lg.teams[S.coy] : null;
    if (coy) rows.push({ id: 'coy', testid: 'award-coy', static: true, cls: S.coy === u ? 'mine' : '',
      cells: { main: two(S.coy === u ? 'Your coach (you)' : coy.name + ' coach', html`${K().ic('whistle')}<b>Coach of the Year</b>`, S.coy === u ? FK().tag('You', 'gold') : K().badge(coy, 's')) } });
    // Pixel Pro Team: yours first
    const pro = (S.allLg || []).map((pid) => P(lg, pid)).filter(Boolean).sort((a, b) => isMine(lg, b) - isMine(lg, a));
    const proRows = [];
    pro.forEach((p) => {
      const t = p.tid >= 0 ? lg.teams[p.tid] : null;
      proRows.push({ id: p.id, testid: 'pro-' + p.id, action: 'player', cls: isMine(lg, p) ? 'mine' : '',
        cells: { main: two(p.fn + ' ' + p.ln, html`${K().ic('star')}<b>Pro Team</b>${K().posChip(p.pos)}${t ? html`${K().badge(t, 's')}<span class="fl-nf">${t.abbr}</span>` : 'Free Agent'}`, isMine(lg, p) ? FK().tag('Yours', 'gold') : '') } });
    });
    const mineN = pro.filter((p) => isMine(lg, p)).length;
    const F = FK();
    const hero = champ ? html`<section class="fl-card fl-hero champ" style="${K().teamVars(champ)}">
        <p class="fl-hero-k">${K().ic('carrot')} Pixel Bowl ${S.s}</p>
        <div class="fl-hero-row">${K().badge(champ, 'l')}<div class="fl-hero-m"><b class="fl-hero-n">${won ? 'Champions!' : champ.name}</b><span class="fl-line">${won ? 'You won it all.' : html`${FK().tag(html`${K().ic('trophy')}Champion`, 'gold')}`}</span></div></div>
        ${ru ? html`<p class="fl-line fl-ru">Runner-up: <b>${ru.name}</b></p>` : ''}
        <div class="fl-mini">${bossLine(lg, ur)}<span class="fl-line fl-myrec">${K().badge(me, 's')}<b class="fl-nf">${me.name}</b> <b class="num">${D().rec(ur.w || 0, ur.l || 0, ur.t || 0)}</b></span></div>
      </section>` : html`<section class="fl-card fl-hero"><p class="fl-hero-k">${K().ic('trophy')} Awards Night</p></section>`;
    // HUNT5 #9: the major awards first; the Pixel Pro Team sits behind its own switch (no player listed twice on a page)
    const showPro = recap.pro && proRows.length;
    const sw = html`<span class="fl-segtog fl-aw-sw" role="tablist">
      <button type="button" role="tab" class="fl-seg fl-seg-btn ${showPro ? '' : 'on'}" data-action="aw-list" data-v="0" data-testid="aw-majors"><b class="fl-sv">Awards</b></button>
      ${proRows.length ? html`<button type="button" role="tab" class="fl-seg fl-seg-btn ${showPro ? 'on' : ''}" data-action="aw-list" data-v="1" data-testid="aw-pro">${K().ic('star')}<b class="fl-sv">Pro Team${mineN ? ' · ' + mineN + ' yours' : ''}</b></button>` : ''}
    </span>`;
    const table = F.table({ key: showPro ? 'awpro' : 'aw', cols: TWO_COLS, rows: showPro ? proRows : rows, noHead: true, grid: true, cls: 'fl-t-two', tools: sw });
    return { hero: hero, table: table, S: S, champ: champ, won: won };
  }

  // ---------------- Growth Day ----------------
  /** this offseason's growth for your team: History.ss(L).gd (league, Season Recap) or the UI snapshot (older flow) */
  function growthRows(lg) {
    let gd = null;
    try { const H = PT.League.History; const ss = H && H.ss ? H.ss(lg) : null; gd = ss && Array.isArray(ss.gd) ? ss.gd : null; } catch (e) { gd = null; }
    const byPid = {};
    if (gd) gd.forEach((c) => { byPid[c.pid] = c; });
    const snap = D().memo.growth;
    const snapOk = !gd && snap && snap.m && snap.s === lg.season;
    return PT.League.Q.roster(lg, lg.userTid).map((p) => {
      const c = byPid[p.id], b = snapOk ? snap.m[p.id] : null;
      const from = c ? c.from : b ? b.ovr : p.ovr;
      return { p: p, from: from, d: c ? c.d : b ? p.ovr - b.ovr : 0, known: !!(c || b) };
    }).sort((a, b) => (b.d - a.d) || (b.p.ovr - a.p.ovr));
  }
  function growthView(lg) {
    const roster = growthRows(lg);
    const has = roster.some((x) => x.known);
    const up = roster.filter((x) => x.d > 0).length, down = roster.filter((x) => x.d < 0).length;
    const same = roster.length - up - down;
    const star = roster.find((x) => x.d > 0);
    const F = FK();
    const hero = star ? html`<section class="fl-card fl-hero" data-testid="gr-riser">
        <p class="fl-hero-k">${K().ic('up')} Biggest Riser</p>
        <div class="fl-hero-row">${K().portrait(star.p, 56)}<div class="fl-hero-m"><b class="fl-hero-n">${star.p.fn} ${star.p.ln}</b>
          <span class="fl-line">${K().posChip(star.p.pos)}<span>Age <b class="num">${star.p.age}</b></span></span></div></div>
        <div class="fl-hero-d"><span class="from num">${star.from}</span><span class="from">to</span><span class="to num">${star.p.ovr}</span><span class="up num">+${star.d}</span></div>
        <div class="fl-line">${K().stars(star.p.ovr, { noNum: true })}</div>
      </section>` : html`<section class="fl-card fl-hero"><p class="fl-hero-k">${K().ic('sprout')} Growth Day</p><p class="fl-line">Nobody moved up this year.</p></section>`;
    const rows = roster.filter((x) => x !== star).map((x) => {          // the hero card shows the biggest riser
      const cls = x.d > 0 ? 'up' : x.d < 0 ? 'down' : 'same';
      const d = x.known ? html`<span class="fl-delta ${cls} num">${x.d > 0 ? '+' + x.d : x.d < 0 ? '−' + Math.abs(x.d) : '='}</span>` : '';
      return { id: x.p.id, testid: 'player-row-' + x.p.id, action: 'player',
        cells: { main: two(x.p.fn + ' ' + x.p.ln, html`${K().posChip(x.p.pos)}<span>Age <b class="num">${x.p.age}</b></span><span class="fl-ovr num">${x.known && x.d ? html`${x.from} → ` : ''}<b>${x.p.ovr}</b></span>${d}`) } };
    });
    const table = F.table({ key: 'gr', cols: TWO_COLS, rows: rows, noHead: true, grid: true, cls: 'fl-t-two fl-t-gr',
      tools: html`<span class="fl-bar-t">Your Team</span>${has ? chips([F.tag(html`${K().ic('up')}${up}`, 'green'), F.tag(html`${K().ic('down')}${down}`, 'red'), F.tag('= ' + same, '')]) : ''}` });
    return { hero: hero, table: table };
  }

  // ---------------- Goodbyes ----------------
  /** seasons played, same formula as Progression.retire: unique archived seasons + this season if he played */
  function careerYears(p) {
    const PG = PT.League && PT.League.Progression;
    if (PG && PG.careerYears) return PG.careerYears(PT.App.L, p);   // includes years before the league began (HUNT5 #4)
    const cs = p.cs || [];
    const set = {};
    cs.forEach((c) => { set[c.s] = 1; });
    return Object.keys(set).length + (p.st && p.st.gp && !set[PT.App.L.season] ? 1 : 0);
  }
  function retiredThisYear(lg) {
    const out = [];
    const seen = {};
    lg.players.filter((p) => p.tid === PT.C.TID.RETIRED).forEach((p) => {
      seen[p.id] = true;
      const tids = (p.cs || []).map((c) => c.t).filter((t) => t >= 0);
      out.push({ id: p.id, fn: p.fn, ln: p.ln, sp: p.sp, pos: p.pos, num: p.num, age: p.age, p: p, tids: tids, ft: p.ft, yrs: careerYears(p), hof: false });
    });
    ((lg.hist && lg.hist.legends) || []).forEach((g) => {
      if (!g.yrs || g.yrs[1] !== lg.season || seen[g.id]) return;
      const tids = g.tids || [];
      out.push({ id: g.id, fn: g.fn, ln: g.ln, sp: g.sp, pos: g.pos, num: g.num, p: null, tids: tids, ft: g.ft != null ? g.ft : tids[tids.length - 1],
        yrs: g.yrs[1] - g.yrs[0] + 1, hof: !!g.hof, car: g.car });
    });
    return out;
  }
  function retiredNums(lg) { return (lg.retNums && lg.retNums[lg.userTid]) || []; }
  /** played for you: archived seasons with you, or his last team (p.ft, set at retirement: covers season 1) */
  function isOurs(lg, r) {
    const u = lg.userTid;
    return r.ft === u || r.tids.includes(u) || !!(r.p && ((r.p.cs && r.p.cs.some((c) => c.t === u)) || r.p.ft === u));
  }
  function canRetireNum(lg, r) {
    const u = lg.userTid;
    if (r.num == null || retiredNums(lg).includes(r.num)) return false;
    const cs = r.p && r.p.cs ? r.p.cs : null;
    let withUs = cs ? cs.filter((c) => c.t === u).length : r.tids.filter((t) => t === u).length;
    if ((r.ft === u || (r.p && r.p.ft === u)) && !(cs && cs.some((c) => c.s === lg.season && c.t === u))) withUs += 1;
    // HUNT5 #5 (design 14.10): a number is retired for a long-tenured player, not a 1-season backup:
    // the league's Goodbyes prompt list (Progression.retire → ss.bye.prompts), or 3+ seasons with you
    let prompted = false;
    try { const H = PT.League.History, ss = H && H.ss ? H.ss(lg) : lg.ss; prompted = !!(ss && ss.bye && ss.bye.prompts.some((x) => x.pid === r.id)); } catch (e) { prompted = false; }
    return prompted || withUs >= 3;
  }

  const GB_OTHERS = 14;   // league-wide retirements beyond yours + Hall of Famers are trimmed to the longest careers
  function goodbyesView(lg) {
    const mine = (r) => isOurs(lg, r);
    // your own players first, then Hall of Famers, then the longest careers (the list is league-wide)
    const all = retiredThisYear(lg).sort((a, b) => (mine(b) - mine(a)) || (b.hof - a.hof) || ((b.yrs || 0) - (a.yrs || 0)));
    const keep = all.filter((r) => mine(r) || r.hof);
    const others = all.filter((r) => !mine(r) && !r.hof);
    const shown = keep.concat(others.slice(0, GB_OTHERS));
    const nums = retiredNums(lg).slice().sort((a, b) => a - b);
    const hofN = all.filter((r) => r.hof).length, mineN = all.filter(mine).length;
    // compact gold chip on line 2 (never pushes the row taller)
    const retireBtn = (r, big) => (canRetireNum(lg, r) ? K().btn({ label: big ? 'Retire #' + r.num : '#' + r.num, icon: 'jersey', action: 'retire-num', data: { num: r.num, pid: r.id },
      kind: 'gold', size: 's', testid: 'btn-retire-num-' + r.id, title: 'Retire #' + r.num, cls: big ? 'fl-hero-btn' : 'fl-retire' }) : '');
    const top = shown[0];
    const list = shown.slice(1);            // the hero card shows the first one: no repeat in the list
    const rows = list.map((r) => ({ id: r.id, testid: 'gb-row-' + r.id, static: true, cls: mine(r) ? 'mine' : '',
      cells: { main: two(r.fn + ' ' + r.ln, html`${K().posChip(r.pos)}<span><b class="num">${r.yrs || 1}</b><span class="fl-nf"> ${(r.yrs || 1) === 1 ? 'season' : 'seasons'}</span><span class="fl-ns"> ${(r.yrs || 1) === 1 ? 'yr' : 'yrs'}</span></span>${r.hof ? FK().tag('Hall of Fame', 'ink') : mine(r) ? FK().tag('Yours', 'gold') : ''}${retireBtn(r)}`) } }));
    const F = FK();
    const hero = top ? html`<section class="fl-card fl-hero ${mine(top) ? 'mine' : ''}" data-testid="gb-row-${top.id}">
        <p class="fl-hero-k">${K().ic(top.hof ? 'crown' : 'hand')} ${mine(top) ? 'Thank you' : top.hof ? 'Hall of Fame' : 'Farewell'}</p>
        <div class="fl-hero-row">${top.p ? K().portrait(top.p, 56) : html`<span class="portrait portrait-emo" style="width:56px;height:56px">${K().sp(top.sp, 48)}</span>`}
          <div class="fl-hero-m"><b class="fl-hero-n">${top.fn} ${top.ln}</b><span class="fl-line">${K().posChip(top.pos)}<span>${D().plural(top.yrs || 1, 'season')}</span>${mine(top) ? FK().tag('Yours', 'gold') : ''}</span></div></div>
        ${retireBtn(top, true)}
        <div class="fl-mini">${nums.length ? html`<span class="fl-line">Retired: ${nums.map((n) => FK().tag('#' + n, 'ink'))}</span>` : ''}</div>
      </section>` : html`<section class="fl-card fl-hero"><p class="fl-hero-k">${K().ic('star')} Goodbyes</p><p class="fl-line">No retirements this year.</p></section>`;
    const table = F.table({ key: 'gb', cols: TWO_COLS, rows: rows, noHead: true, grid: true, cls: 'fl-t-two fl-t-gb',
      tools: html`<span class="fl-bar-t">Retiring</span>${chips([mineN ? F.tag(mineN + ' yours', 'gold') : '', hofN ? F.tag(hofN + ' Hall of Fame', '') : '', F.tag(all.length + ' in league', 'ink')])}`,
      empty: html`<p class="fl-empty">${top ? 'Nobody else retired.' : 'Nobody retired.'}</p>` });
    return { hero: hero, table: table };
  }

  // ---------------- Season Recap: one screen, three tabs, one Next ----------------
  function mountRecap(el, name) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const S = lastSeason(lg);
    const key = lg.id + ':' + (S ? S.s : lg.season);
    if (recap.key !== key || recap.name !== name) { recap.key = key; recap.name = name; recap.pro = false; recap.tab = name === 'growth' || name === 'goodbyes' ? name : 'awards'; }
    const v = recap.tab === 'growth' ? growthView(lg) : recap.tab === 'goodbyes' ? goodbyesView(lg) : awardsView(lg);
    recapLayout(el, lg, v);
    if (recap.tab !== 'awards' || !S) return;
    // the champion moment: confetti + a short banner that fades by itself (no extra button)
    const aw = v;
    const host = el.querySelector('.lay');
    const mk = 'aw-' + lg.id + '-' + S.s;
    if (!host || D().memo[mk]) return;
    D().memo[mk] = true;
    const c = aw.champ;
    if (!aw.won || !c) return;            // a rival's title is shown in the Pixel Bowl card, not celebrated over your screen
    K().confetti(host, 120, [D().hex(c.col.pri), D().hex(c.col.sec), '#ffd23f', '#ff9f1c']);
    const b = globalThis.document.createElement('div');
    b.className = 'fl-cele';
    b.setAttribute('aria-hidden', 'true');
    b.setAttribute('style', K().teamVars(c));
    D().set(b, html`<div class="fl-cele-in">${K().badge(c, 'l')}<b>${aw.won ? 'Pixel Bowl Champions!' : c.name + ' win the Pixel Bowl'}</b></div>`);
    host.appendChild(b);
    setTimeout(() => b.remove(), 2600);
  }

  const recapScreen = (name) => ({
    title: 'Season Recap', nav: 'hub', mount: (el) => mountRecap(el, name),
    actions: FK().withActions({
      'recap-tab': (t) => { recap.tab = t.getAttribute('data-tab'); UI.refresh(); },
      'aw-list': (t) => { recap.pro = t.getAttribute('data-v') === '1'; UI.refresh(); },
      'retire-num': (el) => retireNum(el)
    })
  });
  UI.screens.awards = recapScreen('awards');
  UI.screens['season-end'] = UI.screens.awards;
  UI.screens.growth = recapScreen('growth');
  UI.screens.goodbyes = recapScreen('goodbyes');

  /** Retire a number (inline on the Goodbyes tab) */
  function retireNum(el) {
    const lg = L(), num = +el.getAttribute('data-num');
    UI.Modal.confirm('Retire #' + num + ' forever?', { body: 'No one on your team will wear it again.', icon: 'jersey', yes: 'Retire It' }).then((ok) => {
      if (!ok) return;
      const H = PT.League.History;
      let done = false;
      if (H && H.retireNumber) { try { const r = H.retireNumber(lg, lg.userTid, num); done = !r || r.ok !== false; } catch (e) { done = false; } }
      if (!done) {   // adapter: until WP2 History.retireNumber exists
        lg.retNums = lg.retNums || {};
        const a = lg.retNums[lg.userTid] = lg.retNums[lg.userTid] || [];
        if (!a.includes(num)) a.push(num);
        const t = lg.teams[lg.userTid];
        if (t.fin) t.fin.hype = Math.min(100, t.fin.hype + 5);
      }
      UI.Toast.show('#' + num + ' retired', 'good');
      if (PT.Events) PT.Events.emit('league:changed', { what: 'retire' });
      UI.refresh();
    });
  }

  // ---------------- Fired ----------------
  function offers(lg) {
    const B = PT.League.Boss;
    if (B && B.offers) { try { const o = B.offers(lg); if (Array.isArray(o)) return o.map((x) => (typeof x === 'number' ? { tid: x } : x)); } catch (e) { /* fallback */ } }
    return lg.teams.filter((t) => t.id !== lg.userTid).map((t) => ({ tid: t.id, ovr: K().teamOvr(t.id) })).sort((a, b) => a.ovr - b.ovr).slice(0, 3);
  }
  /** why you were fired, in one line: "Goal: Win 8+ games · You: 5–12" (Boss.evaluate → ss.bossEval, L.boss.goal) */
  function firedWhy(lg) {
    const S = lastSeason(lg), ur = (S && S.user) || null;
    const g = lg.boss && lg.boss.goal;
    let ev = null;
    try { const H = PT.League.History; ev = H && H.ss ? H.ss(lg).bossEval : null; } catch (e) { ev = null; }
    const parts = [];
    const G = PT.Data && PT.Data.Text && PT.Data.Text.goals;
    const gt = g ? (G && G[g.n]) || g.txt : '';
    if (gt) parts.push(html`Goal: <b>${gt}</b>`);
    if (ur) parts.push(html`You: <b class="num">${D().rec(ur.w || 0, ur.l || 0, ur.t || 0)}</b>`);
    if (ev && ev.met === false) parts.push(html`<span>Goal missed</span>`);
    else if (ev && ev.met) parts.push(html`<span>Boss trust too low</span>`);
    if (!parts.length) return '';
    return html`<p class="fi-why" data-testid="fired-why">${K().ic('warn')} ${parts.map((x, i) => (i ? html` · ${x}` : x))}</p>`;
  }
  function jobSpace(lg, tid) { try { return PT.League.Cap.space(lg, tid); } catch (e) { return 0; } }
  function mountFired(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const B = PT.League.Boss;
    const canTake = !!(B && B.takeJob);
    const list = offers(lg);
    const body = html`<section class="card card-cream fi-card">
        <div class="fi-face" aria-hidden="true">${K().sp('bear', 76)}<span>${K().ic('drop')}</span></div>
        <div class="grow"><h2 class="hero-t">The Boss wants a new coach.</h2>
        ${firedWhy(lg)}<p class="fi-sub">Take a new job or retire.</p></div>
      </section>
      <h2 class="sec-title on-grass">Job Offers</h2>
      <div class="grid3">${list.map((o) => { const t = lg.teams[o.tid]; return html`<section class="card fi-job" style="${K().teamVars(t)}">
        <div class="row">${K().badge(t, 'l')}<div class="grow"><b class="big ellip">${t.name}</b><div>${K().stars(K().teamOvr(t.id), { team: true })}</div>
          <div class="fi-bank" title="Team bank: Coins · Team Cash"><span>${K().ic('coin')}<b class="num">${D().coins(t.fin.coins)}</b></span><span>${K().ic('cash')}<b class="num">${D().money(jobSpace(lg, t.id))}</b></span></div></div></div>
        ${K().btn({ label: 'Take Job', icon: 'contract', action: 'take', data: { tid: t.id }, kind: 'go', size: 'm', testid: 'btn-job-' + t.id, cls: 'btn-wide', disabled: !canTake })}
      </section>`; })}</div>
      ${!canTake ? html`<p class="center small fi-note">No jobs open yet. You can retire.</p>` : ''}`;
    const foot = K().btn({ label: 'Retire', icon: 'home', action: 'retire', kind: 'sec', size: 'l', testid: 'btn-fired-retire', cls: 'btn-wide' });
    D().set(el, K().layout(body, foot, 'fit fired'));
  }
  UI.screens.fired = {
    title: 'Big News', chrome: 'head', back: false, mount: mountFired,
    actions: {
      take: (el) => {
        const lg = L(), tid = +el.getAttribute('data-tid');
        let r = null;
        try { r = PT.League.Boss.takeJob(lg, tid); } catch (e) { r = { ok: false, msg: 'Could not take the job.' }; }
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Could not take the job.', 'bad'); return; }
        UI.Toast.show('You now coach the ' + lg.teams[tid].name + ' · team bank ' + D().coins(lg.teams[tid].fin.coins) + ' Coins', 'good', 3500);
        if (PT.Events) PT.Events.emit('league:changed', { what: 'job' });
        UI.theme();
        if (PT.App.applyTheme) PT.App.applyTheme();
        if (PT.App.save) PT.App.save();                // QA1: the new job is a main-save moment
        UI.reset();
      },
      retire: () => {
        UI.Modal.confirm('Retire as a coach?', { body: 'Your save stays in its slot.', icon: 'home', yes: 'Retire', no: 'Not yet' })
          .then((ok) => {
            if (!ok || !PT.App || !PT.App.quitToTitle) return;
            const lg = L();
            try { if (lg && PT.League.Boss && PT.League.Boss.retire) PT.League.Boss.retire(lg); } catch (e) { /* keep going */ }
            if (PT.App.save) PT.App.save();
            PT.App.quitToTitle();
          });
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
