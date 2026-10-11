/* Pixel Touchdown: js/ui/screens/history.js
 * Owner: WP5. Responsibility: past seasons, champions, legends, records.
 * Screens: 'history' (Trophy Room, params {tab:'trophies'|'seasons'|'records'|'hof'|'ach'|'numbers'})
 *          and 'coach' (Coach Level & Coach Skills, design 14.8).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const STAT = { py: 'Pass Yards', ptd: 'Pass TDs', ry: 'Run Yards', rtd: 'Run TDs', rcy: 'Catch Yards', rctd: 'Catch TDs',
    rc: 'Catches', tk: 'Tackles', dsk: 'Sacks', int: 'Picks', fgm: 'Field Goals', fglg: 'Longest FG', rlg: 'Longest Run',
    rclg: 'Longest Catch', pts: 'Points', w: 'Wins', mov: 'Biggest Win', strk: 'Win Streak', carrots: 'Pixel Bowl Titles' };
  const TITLES = [[10000, 'Pixel Immortal'], [6000, 'Legend Coach'], [3000, 'Great Coach'], [1500, 'Pro Coach'], [500, 'Rising Coach'], [0, 'Newbie Coach']];
  const PO_WINS = { WC: 0, DIV: 1, CONF: 2, RU: 3, CHAMP: 4 };
  const RES_WORD = { WC: 'Wild Card', DIV: 'Divisional', CONF: 'Conf. Final', RU: 'Bowl runner-up', CHAMP: 'Pixel Bowl Champs' };

  function divChamps(L, s) {
    // division winners of a past season from its standings rows [tid,w,l,t,pf,pa]
    const out = [];
    if (!s || !s.std) return out;
    for (let c = 0; c < 2; c++) for (let d = 0; d < 4; d++) {
      const rows = s.std.filter((r) => L.teams[r[0]] && L.teams[r[0]].conf === c && L.teams[r[0]].div === d)
        .sort((a, b) => ((b[1] + b[3] / 2) - (a[1] + a[3] / 2)) || ((b[4] - b[5]) - (a[4] - a[5])));
      // only a clear winner counts (fully tied tables give no banner)
      if (rows[0] && (!rows[1] || rows[0][1] !== rows[1][1] || (rows[0][4] - rows[0][5]) !== (rows[1][4] - rows[1][5]))) out.push(rows[0][0]);
    }
    return out;
  }

  /** franchise summary for the user team (design 14.9 Legacy + Dynasty tracker) */
  function legacy(L) {
    const u = L.userTid, t = L.teams[u];
    const loc = localLegacy(L, u, t);
    // QA1: WP2's History.legacy returns only {score,title,next}; returning it as-is crashed the Trophies tab
    // (recs.forEach) and showed "undefined wins". Keep the local shape; take the career-wide score/counters from WP2.
    const H = PT.League.History;
    if (H && H.legacy && !H.legacy.__stub) { try { const r = H.legacy(L); if (r && typeof r.score === 'number') loc.score = r.score; } catch (e) { /* local */ } }
    try {
      const car = PT.League.Coach && PT.League.Coach.car ? PT.League.Coach.car(L) : null;
      if (car && typeof car.w === 'number') { loc.wins = car.w; loc.poW = car.pw || 0; loc.bowls = (car.bowl || []).length; }
    } catch (e) { /* local */ }
    return loc;
  }
  function localLegacy(L, u, t) {
    const recs = (t.rec || []).slice();
    // seasons archived in history but not yet in team.rec (between Awards Night and the new season)
    (L.hist.seasons || []).forEach((x) => { if (x.user && !recs.some((r) => r.s === x.s)) recs.push({ s: x.s, w: x.user.w, l: x.user.l, t: x.user.t, res: x.user.res }); });
    recs.sort((a, b) => a.s - b.s);
    let wins = 0, ties = 0, poW = 0, divT = 0, confT = 0, bowls = 0;
    recs.forEach((r) => {
      wins += r.w || 0; ties += r.t || 0;
      poW += PO_WINS[r.res] || 0;
      if (r.res === 'RU' || r.res === 'CHAMP') confT++;
      if (r.res === 'CHAMP') bowls++;
      const s = (L.hist.seasons || []).find((x) => x.s === r.s);
      if (s && divChamps(L, s).includes(u)) divT++;
    });
    const ach = Object.keys(L.ach || {}).length;
    const hof = (L.hist.legends || []).filter((x) => x.hof && (x.tids || []).includes(u)).length;
    const score = 10 * wins + 5 * ties + 50 * poW + 25 * divT + 100 * confT + 250 * bowls + 30 * hof + 10 * ach;
    let po = 0, win = 0;
    for (let i = recs.length - 1; i >= 0 && recs[i].res; i--) po++;
    for (let i = recs.length - 1; i >= 0 && recs[i].w > recs[i].l; i--) win++;
    const last5 = recs.filter((r) => r.s > L.season - 6 && r.res === 'CHAMP').length;
    return { score: score, wins: wins, poW: poW, divT: divT, confT: confT, bowls: bowls, hof: hof, ach: ach, poStreak: po, winStreak: win, bowls5: last5, recs: recs };
  }
  function titleFor(score) {
    for (let i = 0; i < TITLES.length; i++) if (score >= TITLES[i][0]) return { t: TITLES[i][1], next: i > 0 ? TITLES[i - 1] : null, min: TITLES[i][0] };
    return { t: 'Newbie Coach', next: TITLES[TITLES.length - 2], min: 0 };
  }
  function pname(L, pid, fallback) {
    const p = pid != null ? PT.League.Q.player(L, pid) : null;
    if (p) return K().short(p);
    const lg = (L.hist.legends || []).find((x) => x.id === pid);
    return lg ? lg.fn[0] + '. ' + lg.ln : (fallback || '—');
  }

  /** CSS voxel trophies (blocky shapes, no images): 'carrot' Pixel Bowl, 'cup' conference cup, 'flag' division banner */
  function vox(kind) {
    if (kind === 'carrot') return D().raw('<span class="vt vt-carrot" aria-hidden="true"><i class="vt-leaf l1"></i><i class="vt-leaf l2"></i><i class="vt-leaf l3"></i><i class="vt-c c1"></i><i class="vt-c c2"></i><i class="vt-c c3"></i><i class="vt-c c4"></i><i class="vt-base"></i></span>');
    if (kind === 'cup') return D().raw('<span class="vt vt-cup" aria-hidden="true"><i class="vt-h hl"></i><i class="vt-h hr"></i><i class="vt-bowl"></i><i class="vt-stem"></i><i class="vt-base"></i></span>');
    return D().raw('<span class="vt vt-flag" aria-hidden="true"><i class="vt-pole"></i><i class="vt-pen"></i><i class="vt-base"></i></span>');
  }

  // ---------------- tabs ----------------
  // ROUND6 (0 scrolling): the Legacy summary lives in the Trophies tab; every long list is paged (K().pg)
  function legacyCard(L, lg) {
    const ti = titleFor(lg.score);
    const c = L.coach || { n: 'Coach', sp: 'dog', lvl: 1 };
    return html`<section class="card legacy-card">
      <div class="legacy-top">
        <span class="coach-ava">${K().sp(c.sp)}</span>
        <div class="grow"><div class="small">Legacy</div><div class="legacy-t">${ti.t}</div></div>
        ${K().btn({ label: 'Lv ' + (c.lvl || 1), icon: 'star', action: 'coach', kind: 'gold', size: 's', testid: 'btn-coach', title: 'Coach Level and Skills' })}
      </div>
      <div class="small"><b class="num">${D().int(lg.score)}</b> points${ti.next ? html` · ${D().int(ti.next[0] - lg.score)} to ${ti.next[1]}` : ''}</div>
      ${ti.next ? K().meter(lg.score - ti.min, ti.next[0] - ti.min, 'm-gold', 'Legacy') : ''}
      <div class="legacy-stats small"><span>${K().ic('football')} <b class="num">${lg.wins}</b> wins</span><span>${K().ic('ticket')} <b class="num">${lg.poW}</b> playoff wins</span><span>${K().ic('carrot')} <b class="num">${lg.bowls}</b> titles</span><span>${K().ic('trophy')} <b class="num">${lg.ach}</b> badges</span></div>
      <div class="dyn">
        <div class="dyn-i" title="Playoff seasons in a row"><b class="num">${lg.poStreak}</b><span class="tiny">Playoff run</span></div>
        <div class="dyn-i" title="Winning seasons in a row"><b class="num">${lg.winStreak}</b><span class="tiny">Win run</span></div>
        <div class="dyn-i ${lg.bowls5 >= 3 ? 'hot' : ''}" title="Pixel Bowl titles in the last 5 seasons"><b class="num">${lg.bowls5}</b><span class="tiny">${lg.bowls5 >= 3 ? 'Dynasty' : 'Titles, 5 yrs'}</span></div>
      </div>
    </section>`;
  }

  function trophiesTab(L, lg) {
    const u = L.userTid;
    const shelf = [];
    lg.recs.slice().reverse().forEach((r) => {
      const s = (L.hist.seasons || []).find((x) => x.s === r.s);
      if (r.res === 'CHAMP') shelf.push(html`<div class="trophy gold">${vox('carrot')}<span class="tr-tx"><b>Pixel Bowl</b><span class="small">${r.s}${s && s.ru != null ? ' · beat the ' + L.teams[s.ru].name : ''}</span></span></div>`);
      if (r.res === 'RU' || r.res === 'CHAMP') shelf.push(html`<div class="trophy silver">${vox('cup')}<span class="tr-tx"><b>Conference Champs</b><span class="small">${r.s}</span></span></div>`);
      if (s && divChamps(L, s).includes(u)) shelf.push(html`<div class="trophy banner">${vox('flag')}<span class="tr-tx"><b>Division Title</b><span class="small">${r.s}</span></span></div>`);
    });
    // award plaques for players who played for you (newest first)
    const plaques = [];
    const AW = (PT.Data.Text && PT.Data.Text.awards) || {};
    const AWN = { MVP: 'Top Dog', OPOY: 'Best Offense', DPOY: 'Best Defense', ROY: 'Best Newbie', COY: 'Coach of the Year', ALL: 'Pixel Pro Team' };
    PT.League.Q.roster(L, u).forEach((p) => (p.aw || []).forEach((a) => plaques.push({ n: K().short(p), a: a })));
    (L.hist.legends || []).filter((x) => (x.tids || []).includes(u)).forEach((x) => (x.aw || []).forEach((a) => plaques.push({ n: x.fn[0] + '. ' + x.ln, a: a })));
    plaques.sort((x, y) => (y.a.s || 0) - (x.a.s || 0));
    const items = shelf.concat(plaques.slice(0, 24).map((x) => html`<div class="trophy plaque"><span class="tr-ic">${K().ic('medal')}</span><span class="tr-tx"><b>${AWN[x.a.a] || AW[x.a.a] || x.a.a}</b><span class="small">${x.n} · ${x.a.s}</span></span></div>`));
    return html`<div class="tr-cols">
      ${legacyCard(L, lg)}
      ${K().card(html`${K().h2('Trophy Shelf')}${K().pg('shelf', items, { grid: true, cls: 'pg-top shelf-pg', empty: html`<div class="trophy ghost">${vox('carrot')}<span class="tr-tx"><b>Pixel Bowl</b><span class="small">Not won yet</span></span></div>` })}`, 'fill shelf-card')}
    </div>`;
  }

  function seasonsTab(L) {
    const ss = (L.hist.seasons || []).slice().sort((a, b) => b.s - a.s);
    if (!ss.length) return K().card(K().empty('scroll', 'No finished seasons yet.'));
    const u = L.userTid;
    const rows = ss.map((s) => { const c = s.champ != null ? L.teams[s.champ] : null; const us = s.user || {}; return html`<div class="sea-r ${s.champ === u ? 'me' : ''}"><b class="num">${s.s}</b>
        <span class="tcell">${c ? html`${K().badge(c, 's')}<span class="ellip">${c.name}</span>` : '—'}</span>
        <span class="num n">${us.w != null ? D().rec(us.w, us.l, us.t) : '—'}</span><span class="ellip">${us.res ? RES_WORD[us.res] || us.res : html`<span class="muted">No playoffs</span>`}</span>
        <span class="ellip sea-x">${s.mvp != null ? pname(L, s.mvp) : '—'}</span></div>`; });
    return html`<div class="sea-r sea-h"><span>Year</span><span>Champion</span><span class="n">You</span><span>Result</span><span class="sea-x">Top Dog</span></div>
      ${K().pg('sea', rows, { cls: 'pg-top sea-pg' })}`;
  }

  // Records: one matrix (stat × Game / Season / Career), League or Your Team, paged by rows
  function recCell(L, r) {
    if (!r) return html`<span class="rec-c muted">—</span>`;
    return html`<span class="rec-c"><b class="num">${D().int(r.v)}</b><span class="small ellip">${r.n || pname(L, r.pid, r.tid != null && L.teams[r.tid] ? L.teams[r.tid].name : '—')}${r.s ? ' · ' + r.s : ''}</span></span>`;
  }
  function recordsTab(L, params) {
    const R = (L.hist && L.hist.rec) || {};
    const lgR = R.league || {};
    const fr = (R.franchise && R.franchise[L.userTid]) || {};
    const any = ['game', 'season', 'career'].some((k) => Object.keys(lgR[k] || {}).length) || Object.keys(fr).some((k) => Object.keys(fr[k] || {}).length);
    if (!any) return K().card(K().empty('chart', 'No records yet.'));
    const team = params.rsc === 'team';
    const src = team ? fr : lgR;
    const cols = team ? ['game', 'season'] : ['game', 'season', 'career'];
    const NAMES = { game: 'Best Game', season: 'Best Season', career: 'Career' };
    const keys = [];
    cols.forEach((c) => Object.keys(src[c] || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    const order = Object.keys(STAT);
    keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
    const seg = html`<span class="rec-seg">${[['league', 'League'], ['team', 'Your Team']].map((x) => html`<button type="button" class="rec-sb ${(team ? 'team' : 'league') === x[0] ? 'on' : ''}" data-action="rscope" data-id="${x[0]}" data-testid="rec-scope-${x[0]}">${x[1]}</button>`)}</span>`;
    const rows = keys.map((k) => html`<div class="rec-r c${cols.length}"><span class="rec-k">${STAT[k] || k}</span>${cols.map((c) => recCell(L, (src[c] || {})[k]))}</div>`);
    return html`<div class="rec-r rec-h c${cols.length}">${seg}${cols.map((c) => html`<span>${NAMES[c]}</span>`)}</div>
      ${K().pg('rec-' + (team ? 'team' : 'league'), rows, { cls: 'pg-top rec-pg', empty: html`<p class="muted small rec-none">No records yet.</p>` })}`;
  }

  function hofTab(L) {
    const list = (L.hist.legends || []).filter((x) => x.hof).sort((a, b) => ((b.yrs || [0, 0])[1] - (a.yrs || [0, 0])[1]));
    if (!list.length) return K().card(K().empty('pillar', 'No Hall of Famers yet.'));
    return K().pg('hof', list.map((x) => {
      const tid = (x.tids || [])[(x.tids || []).length - 1];
      const col = tid != null && L.teams[tid] ? L.teams[tid].col.pri : 0xc9a227;
      return html`<button type="button" class="hof-card ${x.fb ? 'fb' : ''}" data-action="legend" data-id="${x.id}" data-testid="hof-${x.id}">
        ${K().portrait({ id: x.id, sp: x.sp, tid: -3, look: x.look || { v: 0 } }, 56, col)}
        <b class="ellip">${x.fn} ${x.ln}</b><span class="small">${K().posChip(x.pos)} ${(x.yrs || []).join('–')}</span>
        <span class="tiny muted ellip">${K().statLine(x.car, x.pos)}</span></button>`;
    }), { grid: true, cls: 'pg-top hof-pg' });
  }

  function achList(L) {
    const A = PT.League.Achievements;
    try { if (A && A.list) return A.list(L); } catch (e) { /* data */ }
    return ((PT.Data.Achievements && PT.Data.Achievements.list) || []).map((a) => ({ id: a.id, name: a.name, desc: a.desc, coins: a.coins, got: (L.ach || {})[a.id] || null }));
  }
  function achTab(L) {
    const defs = (PT.Data.Achievements && PT.Data.Achievements.list) || [];
    const list = achList(L);
    const got = list.filter((a) => a.got).length;
    // unlocked first, then the locked ones in book order
    const sorted = list.filter((a) => a.got).concat(list.filter((a) => !a.got));
    return html`<div class="ach-head">${K().ic('trophy')}<b class="num">${got} / ${list.length || 32}</b><span>unlocked</span><span class="grow">${K().meter(got, list.length || 32, 'm-gold', 'Achievements')}</span></div>
      ${K().pg('ach', sorted.map((a) => {
        const def = defs.find((d) => d.id === a.id) || {};
        const coins = a.coins != null ? a.coins : def.coins;
        return html`<div class="ach ${a.got ? 'got' : 'locked'}" data-testid="ach-${a.id}"><span class="ach-emo">${K().ic(a.got ? ((a.icon && UI.Icons.has(a.icon) ? a.icon : UI.Icons.fromEmoji(a.icon || a.emo || '')) || 'trophy') : 'lock')}</span>
          <span class="ach-tx"><b class="ellip">${a.name}</b><span class="small ach-d">${a.desc || def.desc || ''}</span></span>
          <span class="ach-f">${coins ? html`<span class="stat stat-coin">${K().icon('coin')}<b class="num">${coins}</b></span>` : ''}${a.got ? html`<span class="ach-y small">${a.got}</span>` : ''}</span></div>`;
      }), { grid: true, cls: 'pg-top ach-pg' })}`;
  }

  function numbersTab(L) {
    const t = L.teams[L.userTid];
    const nums = ((L.retNums && L.retNums[L.userTid]) || []).slice().sort((a, b) => a - b);
    if (!nums.length) return K().card(K().empty('jersey', 'No retired numbers yet.'));
    return K().card(html`${K().h2('Retired Numbers')}<div class="fill" style="${K().teamVars(t)}">${K().pg('nums', nums.map((n) => html`<div class="jersey-b"><span class="num">${n}</span></div>`), { grid: true, cls: 'pg-top jerseys-pg' })}</div>`, 'fill');
  }

  const TABS = [
    { id: 'trophies', label: 'Trophies', testid: 'tab-hist-trophies' },
    { id: 'seasons', label: 'Seasons', testid: 'tab-hist-seasons' },
    { id: 'records', label: 'Records', testid: 'tab-hist-records' },
    { id: 'hof', label: 'Hall of Fame', testid: 'tab-hist-hof' },
    { id: 'ach', label: 'Achievements', testid: 'tab-hist-ach' },
    { id: 'numbers', label: 'Numbers', testid: 'tab-hist-numbers' }
  ];

  function mount(el, params) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'trophies';
    let content;
    switch (tab) {
      case 'seasons': content = seasonsTab(L); break;
      case 'records': content = recordsTab(L, params); break;
      case 'hof': content = hofTab(L); break;
      case 'ach': content = achTab(L); break;
      case 'numbers': content = numbersTab(L); break;
      default: content = trophiesTab(L, legacy(L));
    }
    D().set(el, K().layout(html`${K().tabs(TABS, tab, 'tab')}${content}`, null, 'fit history hist-' + tab));
  }

  UI.screens.history = {
    title: 'Trophy Room',
    nav: 'history',
    mount: mount,
    actions: {
      tab: (el, ev, params) => { params.tab = el.getAttribute('data-id'); UI.refresh(); },
      coach: () => UI.go('coach'),
      rscope: (el, ev, params) => { params.rsc = el.getAttribute('data-id'); UI.refresh(); },
      legend: (el) => {
        const L = PT.App.L, id = +el.getAttribute('data-id');
        const x = (L.hist.legends || []).find((y) => y.id === id);
        if (!x) return;
        const car = x.car || {};
        const keys = Object.keys(car).filter((k) => STAT[k] || PT.C.STATS[k]);
        UI.Modal.open({ title: x.fn + ' ' + x.ln, icon: K().sp(x.sp),
          body: html`<p class="center">${K().posLabel(x.pos)} · ${(x.yrs || []).join('–')}${x.hof ? ' · Hall of Fame' : ''}</p>
            <p class="center small">${(x.tids || []).map((t) => (L.teams[t] ? L.teams[t].name : '')).filter(Boolean).join(', ')}</p>
            <ul class="rec-list">${keys.slice(0, 12).map((k) => html`<li><span class="rec-k">${STAT[k] || k}</span><b class="num rec-v">${D().int(car[k])}</b></li>`)}</ul>`,
          buttons: [{ label: 'Close', value: true, kind: 'go' }] });
      }
    }
  };

  // ---------------- Coach Level & Skills ----------------
  const SKILLS = [
    ['qb_whisperer', 'QB Whisperer', 'target', 'Your QB +2 Aim in games', '+4 Aim'],
    ['money_talks', 'Money Talks', 'moneybag', '+5 Market score on your offers', '+10'],
    ['penny_pincher', 'Penny Pincher', 'snout', 'Facility upgrades −10% Coins', '−20%'],
    ['doc_hands', 'Doc Hands', 'cross', 'Long injuries heal 1 week faster', '2 weeks faster'],
    ['talent_eye', 'Talent Eye', 'scope', '+3 scout points per season', '+6'],
    ['hype_machine', 'Hype Machine', 'megaphone', 'Ticket income +10%', '+20%'],
    ['clock_master', 'Clock Master', 'clock', '+1 timeout per half', 'and Hurry runoff 12 s'],
    ['two_minute', 'Two-Minute Drill', 'ff', 'Hurry runoff 10 s', 'and offense boost late in halves'],
    ['play_designer', 'Play Designer', 'clipboard', '4 suggested play cards', 'and a bigger signature bonus'],
    ['iron_discipline', 'Iron Discipline', 'whistle', 'Penalties ×0.7', '×0.5'],
    ['locker_glue', 'Locker Room Glue', 'contract', 'Mood losses ×0.85', '×0.7'],
    ['rookie_whisperer', 'Rookie Whisperer', 'grad', 'First-year players +1 growth', '+2'],
    ['red_zone', 'Red Zone Wizard', 'flag', 'Offense boost inside the 20', 'bigger boost'],
    ['goal_line', 'Goal Line Stand', 'brick', 'Defense boost inside your 20', 'bigger boost'],
    ['kick_guru', 'Kick Guru', 'boot', 'Kicks a bit straighter', 'even straighter'],
    ['trade_shark', 'Trade Shark', 'swap', 'Swaps are easier', 'even easier'],
    ['star_power', 'Star Power', 'star', 'Star Play window +0.05 s', '+0.10 s'],
    ['film_room', 'Film Room', 'eye', 'See the foe’s top 3 play types', 'and AI reads you less']
  ];
  function coachStatus(L) {
    const C = PT.League.Coach;
    let s = null;
    try { if (C && C.status) s = C.status(L); } catch (e) { s = null; }
    const c = L.coach || { lvl: 1, xp: 0, pts: 0, sk: {} };
    s = Object.assign({ lvl: c.lvl || 1, xp: c.xp || 0, pts: c.pts || 0, sk: c.sk || {} }, s || {});
    if (s.next == null) s.next = 25 * s.lvl * (s.lvl + 1);
    if (s.prev == null) s.prev = 25 * s.lvl * (s.lvl - 1);
    return s;
  }
  function learnFn() {
    const C = PT.League.Coach;
    if (!C) return null;
    return ['pickSkill', 'learn', 'learnSkill', 'addSkill'].map((k) => C[k]).find((f) => typeof f === 'function') || null;
  }
  function offers(L) {
    const C = PT.League.Coach;
    try { if (C && C.offers) return C.offers(L) || null; } catch (e) { /* none */ }
    return null;
  }

  function mountCoach(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const c = L.coach || { n: 'Coach', sp: 'dog' };
    const s = coachStatus(L);
    const offer = offers(L);
    const canLearn = !!learnFn();
    const into = Math.max(0, s.xp - s.prev), need = Math.max(1, s.next - s.prev);
    // ROUND6: one slim level card + the 18 skills as a paged grid (no scrolling)
    const skills = SKILLS.map((k) => {
      const rank = (s.sk && s.sk[k[0]]) || 0;
      const offered = offer ? offer.includes(k[0]) : true;
      const can = s.pts > 0 && rank < 2 && offered;
      return html`<div class="sk ${rank ? 'own' : ''} ${offer && offer.includes(k[0]) ? 'offer' : ''}">
        <span class="sk-emo">${K().ic(k[2])}</span>
        <span class="sk-tx"><span class="sk-top"><b class="ellip">${k[1]}</b><span class="pips">${[1, 2].map((i) => html`<i class="${rank >= i ? 'on' : ''}"></i>`)}</span></span>
        <span class="small sk-d">${rank >= 1 ? html`<b>Rank 2:</b> ${k[4]}` : k[3]}</span></span>
        ${rank >= 2 ? html`<span class="chip chip-green">Maxed</span>` : K().btn({ label: rank ? 'Rank Up' : 'Learn', icon: 'sparkle', action: 'learn', data: { id: k[0] }, kind: can ? 'go' : 'sec', size: 's', testid: 'skill-' + k[0], disabled: !can || !canLearn })}
      </div>`;
    });
    const body = html`
      <section class="card coach-card">
        <div class="legacy-top">
          <div class="lvl-badge"><span class="small">Level</span><b class="num">${s.lvl}</b></div>
          <span class="coach-ava">${K().sp(c.sp)}</span>
          <div class="grow coach-mid"><div class="row between wrap"><span class="legacy-t">${c.n || 'Coach'}</span>${s.pts ? html`<span class="chip chip-gold">${K().ic('sparkle')} ${s.pts} skill point${s.pts === 1 ? '' : 's'}</span>` : ''}</div>
            ${K().meter(into, need, 'm-gold', 'Coach XP')}
            <div class="small coach-xp"><b class="num">${D().int(into)}</b> / ${D().int(need)} XP to Level ${s.lvl + 1} · ${D().int(s.xp)} XP total${s.pts ? '' : html`<span class="coach-tip"> · New skill at Lv 3, 5, 7, 9, then every level from 11</span>`}</div></div>
        </div>
      </section>
      ${K().pg('skills', skills, { grid: true, cls: 'sk-pg' })}`;
    D().set(el, K().layout(body, null, 'fit coach'));
  }

  UI.screens.coach = {
    title: 'Coach Level',
    nav: 'history',
    mount: mountCoach,
    actions: {
      learn: (el) => {
        const L = PT.App.L, f = learnFn();
        if (!f) { UI.Toast.show('Coming soon', 'info'); return; }
        const r = f(L, el.getAttribute('data-id'));
        if (r && r.ok === false) UI.Toast.show(r.msg || 'Not yet.', 'bad');
        else { UI.Toast.show('Skill learned', 'xp'); UI.refresh(); }
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
