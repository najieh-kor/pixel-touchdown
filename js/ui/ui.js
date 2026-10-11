/* Pixel Touchdown: js/ui/ui.js
 * Owner: WP5. Responsibility: PT.UI root: init, router (stack), layer mgmt, refresh on bus events.
 *
 * Screen contract (each js/ui/screens/*.js registers one or more):
 *   PT.UI.screens[name] = {
 *     title: 'Text' | (params) => 'Text',
 *     chrome: 'full' (top bar + nav, default) | 'head' (top bar only) | 'bare' (nothing),
 *     nav: 'hub'|'team'|… (which nav item is lit; default = name),
 *     mount(viewEl, params), unmount?() (only when leaving), refresh?(viewEl, params) (default = re-mount, scroll kept),
 *     actions?: { [data-action]: (el, ev, params) => void },   onInput?(el, ev, params),  keys?(ev) → bool
 *   }
 * Clicks are delegated: any element with data-action="x" calls the screen's actions.x, else a global action
 * (back, nav, flow-next, player, team-view). PT.UI.Flow owns the one big NEXT button (labels from Calendar.status).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  UI.screens = UI.screens || {};
  const D = () => UI.dom, K = () => UI.comp;

  let roots = null, stack = [], cur = null, refreshQueued = false, portraitQueued = false, inited = false;

  // Main tabs (UI restyle: fewer tabs). Each opens a section; the section's sub-tabs live in a strip under the top bar.
  const NAV = [
    { id: 'hub', icon: 'home', label: 'HQ' },
    { id: 'team', icon: 'jersey', label: 'Team' },
    { id: 'league', icon: 'podium', label: 'League' },
    { id: 'office', icon: 'briefcase', label: 'Office' }
  ];
  /** sub-tabs per section: {id (testid sub-<id>), label, icon, to: screen, tab?: params.tab, when?(L)} */
  const SECTIONS = {
    team: [
      { id: 'team', label: 'Overview', icon: 'jersey', to: 'team', tab: 'overview' },
      { id: 'roster', label: 'Players', icon: 'players', to: 'roster' },
      { id: 'depth', label: 'Lineup', icon: 'clipboard', to: 'depth' },
      { id: 'pay', label: 'Pay', icon: 'cash', to: 'team', tab: 'pay' },
      { id: 'style', label: 'Style', icon: 'tophat', to: 'team', tab: 'style' },
      { id: 'camp', label: 'Camp', icon: 'dumbbell', to: 'camp', when: (L) => L.phase === 'PRESEASON' },
      { id: 'market', label: 'Market', icon: 'contract', to: 'market', also: ['swaps', 'draft', 'resign'] }
    ],
    league: [
      { id: 'standings', label: 'Standings', icon: 'podium', to: 'standings', also: ['teams'] },
      { id: 'schedule', label: 'Calendar', icon: 'calendar', to: 'schedule', also: ['results'] },
      { id: 'playoffs', label: 'Playoffs', icon: 'bracket', to: 'playoffs' },
      { id: 'stats', label: 'Leaders', icon: 'chart', to: 'stats' },
      { id: 'news', label: 'News', icon: 'news', to: 'news' }
    ],
    office: [
      { id: 'shop', label: 'Shop', icon: 'cart', to: 'shop' },
      { id: 'coach', label: 'Coach', icon: 'cap', to: 'coach' },
      { id: 'history', label: 'Trophies', icon: 'trophy', to: 'history' },
      { id: 'settings', label: 'Settings', icon: 'gear', to: 'settings' }
    ]
  };
  /** old nav ids / screen names → section */
  const SECTION_OF = { hub: 'hub', pregame: 'hub', events: 'hub', team: 'team', roster: 'team', depth: 'team', player: 'team', camp: 'team',
    market: 'team', swaps: 'team', draft: 'team', resign: 'team', growth: 'team',
    league: 'league', standings: 'league', schedule: 'league', results: 'league', playoffs: 'league', stats: 'league', news: 'league', teams: 'league', power: 'league',
    office: 'office', shop: 'office', coach: 'office', history: 'office', settings: 'office', awards: 'office', goodbyes: 'office' };
  UI.SECTIONS = SECTIONS;
  UI.NAV = NAV;

  function el(id) { return (roots && roots[id]) || globalThis.document.getElementById(id); }
  const L = () => (PT.App ? PT.App.L : null);

  /** @param {{root:{screen,hud,modal,toast}}} o */
  /**
   * iOS Safari / home-screen app: size the layers to the real visible viewport (--app-w/--app-h) and undo any document
   * scroll the browser applied (a scrolled body showed a sky strip above the top bar in standalone landscape).
   */
  function fitViewport() {
    const g = globalThis, de = g.document && g.document.documentElement;
    if (!de) return;
    const vv = g.visualViewport;
    const w = Math.round(vv ? vv.width : g.innerWidth), h = Math.round(vv ? vv.height : g.innerHeight);
    if (w > 0 && h > 0) { de.style.setProperty('--app-w', w + 'px'); de.style.setProperty('--app-h', h + 'px'); }
    if (g.scrollY || g.scrollX) { try { g.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  }
  UI.fitViewport = fitViewport;
  if (globalThis.addEventListener) {
    fitViewport();
    ['resize', 'orientationchange', 'pageshow'].forEach((ev) => globalThis.addEventListener(ev, () => { fitViewport(); setTimeout(fitViewport, 250); }));
    if (globalThis.visualViewport) globalThis.visualViewport.addEventListener('resize', fitViewport);
  }

  UI.init = function (o) {
    roots = (o && o.root) || { screen: el('screen'), hud: el('hud'), modal: el('modal'), toast: el('toast') };
    UI._roots = roots;
    if (inited) return;
    inited = true;
    const box = roots.screen;
    box.addEventListener('click', onClick);
    box.addEventListener('input', onInput);
    box.addEventListener('change', onInput);
    globalThis.document.addEventListener('keydown', onKey);
    if (PT.Events) {
      PT.Events.on('league:changed', () => UI.refreshSoon());
      PT.Events.on('league:advanced', () => UI.refreshSoon());
      PT.Events.on('app:loaded', () => { UI.theme(); UI.applyPrefs(); });
      PT.Events.on('render:portrait', () => {
        if (portraitQueued) return;
        portraitQueued = true;
        setTimeout(() => { portraitQueued = false; K().refreshPortraits(roots.screen); K().refreshPortraits(roots.modal); }, 60);
      });
      PT.Events.on('app:saveFailed', (p) => UI.Toast.show((p && p.msg) || 'Save failed', 'bad', 3500));
      // INT: badges / level-ups earned by a game are shown on the Final screen; toasting them too covered its headline
      const gameScreen = () => { const c = UI.current(); return !!(c && ['game', 'pregame', 'postgame'].includes(c.name)) || !!(L() && L().tmp); };
      ['league:achievement', 'league:ach'].forEach((n) => PT.Events.on(n, (p) => {
        if (gameScreen()) return;
        const A = PT.Data && PT.Data.Achievements;
        const def = A && A.list ? A.list.find((a) => a.id === (p && (p.id || p.ach))) : null;
        UI.Toast.show('Achievement: ' + ((def && def.name) || (p && p.name) || 'Unlocked'), 'ach', 3500);
      }));
      PT.Events.on('league:levelUp', (p) => gameScreen() || UI.Toast.show('Coach Level ' + ((p && p.lvl) || '') + ' reached', 'xp', 3000));
    }
    UI.applyPrefs();
  };

  // ---------------- router ----------------
  UI.go = function (name, params) { stack.push({ name: name, params: params || {} }); render(); };
  UI.back = function () {
    const lg = L(), top = stack[stack.length - 1];
    if (top && top.name === 'fired' && lg && lg.boss && lg.boss.fired && !lg.boss.retired) return false;   // QA1: modal
    if (stack.length > 1) { stack.pop(); render(); return true; }
    return false;
  };
  UI.replace = function (name, params) { if (stack.length) stack.pop(); stack.push({ name: name, params: params || {} }); render(); };
  /** reset the stack: [hub] or [hub, name] (nav items, phase screens) */
  UI.reset = function (name, params) {
    stack = [{ name: 'hub', params: {} }];
    if (name && name !== 'hub') stack.push({ name: name, params: params || {} });
    render();
  };
  UI.current = function () { const t = stack[stack.length - 1]; return t ? { name: t.name, params: t.params } : null; };
  UI.depth = () => stack.length;
  /** re-render the current screen (auto on 'league:changed') */
  UI.refresh = function () {
    if (!cur) return;
    const scr = cur.scr;
    if (scr.noRefresh) return;
    if (scr.refresh) { try { scr.refresh(cur.view, cur.params); } catch (e) { fail(e, 'refresh'); } return; }
    const scrolls = D().$$('[data-scroll]', cur.view).map((s) => s.scrollTop);
    const focusId = globalThis.document.activeElement && globalThis.document.activeElement.getAttribute && globalThis.document.activeElement.getAttribute('data-testid');
    mountCur(true);
    D().$$('[data-scroll]', cur.view).forEach((s, i) => { if (scrolls[i]) s.scrollTop = scrolls[i]; });
    if (focusId) { const f = cur.view.querySelector('[data-testid="' + focusId + '"]'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  };
  UI.refreshSoon = function () {
    if (refreshQueued) return;
    refreshQueued = true;
    const raf = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
    raf(() => { refreshQueued = false; UI.refresh(); });
  };

  function fail(e, where) {
    if (PT.Log && PT.Log.error) PT.Log.error('ui', where, e);
    else if (globalThis.console) globalThis.console.warn('[ui]', where, e);
  }

  // QA1: while fired (and not retired) the Fired screen is modal: no Back / Esc / nav into the old team's screens
  const FIRED_OK = ['fired', 'awards', 'season-end', 'title', 'slots', 'newgame', 'settings', 'howto', 'postgame'];
  function firedLock() {
    const lg = L();
    const top = stack[stack.length - 1];
    if (!lg || !lg.boss || !lg.boss.fired || lg.boss.retired || !top || FIRED_OK.indexOf(top.name) >= 0) return;
    stack = [{ name: 'fired', params: {} }];
  }
  function render() {
    firedLock();
    const top = stack[stack.length - 1];
    const box = roots ? roots.screen : el('screen');
    if (!box || !top) return;
    if (cur && cur.scr.unmount) { try { cur.scr.unmount(); } catch (e) { fail(e, 'unmount'); } }
    const scr = UI.screens[top.name] || placeholder(top.name);
    UI.theme();
    box.setAttribute('data-screen', top.name);
    const chrome = scr.chrome || 'full';
    box.className = 'chrome-' + chrome;
    box.innerHTML = String(frame(top, scr, chrome));
    cur = { name: top.name, params: top.params, scr: scr, view: box.querySelector('.view') };
    if (!cur.view.classList.contains('enter') && !D().reduced()) cur.view.classList.add('enter');
    mountCur(false);
    const v = cur.view;
    setTimeout(() => v.classList.remove('enter'), 240);
    UI.backdrop(top.name);
    UI.countUp(v);
    try { cur.view.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    // phone bottom bar scrolls sideways: keep the active item visible
    const son = box.querySelector('.subnav .sub-i.on');
    if (son) { const sn = box.querySelector('.subnav'); const a = son.getBoundingClientRect(), b = sn.getBoundingClientRect(); if (a.right > b.right || a.left < b.left) sn.scrollLeft = Math.max(0, sn.scrollLeft + (a.left - b.left) - (b.width - a.width) / 2); }
    const on = box.querySelector('.navbar .nav-i.on');
    if (on && on.parentNode && on.parentNode.scrollWidth > on.parentNode.clientWidth) {
      const nb = on.parentNode;
      const a = on.getBoundingClientRect(), b = nb.getBoundingClientRect();
      nb.scrollLeft = Math.max(0, nb.scrollLeft + (a.left - b.left) - (b.width - a.width) / 2);
    }
    if (PT.Events) PT.Events.emit('ui:navigate', { name: top.name });
  }

  function mountCur(isRefresh) {
    cur.view.innerHTML = '';
    try { cur.scr.mount(cur.view, cur.params || {}); }
    catch (e) {
      fail(e, 'mount ' + cur.name);
      cur.view.innerHTML = String(D().html`<div class="lay"><div class="scroll">${K().empty('question', 'This screen failed to load.')}</div></div>`);
    }
    updateHead();                      // title + Coins/Hype can change on refresh too (e.g. HQ title follows the phase)
    updateDots();                      // HUNT2 #14: rail dots follow a refresh too (Auto-Fix clears the TEAM dot)
    if (UI.fit) { try { UI.fit(cur.view); } catch (e) { fail(e, 'fit'); } }   // ROUND6: no scrolling — page long lists
  }

  function titleOf(scr, params) { return typeof scr.title === 'function' ? scr.title(params || {}) : (scr.title || ''); }
  /**
   * HUNT2 #19: a screen reached by a section sub-tab is titled by its section (your team's name, League, Office);
   * only drill-ins with a back arrow (player card, Swaps, Draft Day, Week Results…) keep their own title.
   */
  function headTitle(name, scr, params) {
    const lg = L();
    const other = lg && params && params.tid != null && params.tid !== lg.userTid && (name === 'roster' || name === 'player');
    if (lg && !lg.tmp && !other) {
      const sec = Object.keys(SECTIONS).find((k) => SECTIONS[k].some((x) => x.to === name));
      if (sec === 'team') return lg.teams[lg.userTid].name;
      if (sec === 'league') return 'League';
      if (sec === 'office') return 'Office';
    }
    return titleOf(scr, params);
  }

  function frame(top, scr, chrome) {
    const h = D().html;
    if (chrome === 'bare') return h`<div class="view view-bare" tabindex="-1"></div>`;
    const lg = L();
    // HUNT #31: another team's roster / player card belongs to League (not your Team section)
    const otherTeam = lg && top.params && top.params.tid != null && top.params.tid !== lg.userTid && (top.name === 'roster' || top.name === 'player');
    // HUNT #47: no back arrow on a section root (the rail is the way between sections)
    const sectionRoot = !otherTeam && Object.keys(SECTIONS).some((k) => SECTIONS[k].some((x) => x.to === top.name && (!x.tab || !top.params || !top.params.tab || x.tab === top.params.tab)));
    const back = stack.length > 1 && scr.back !== false && !sectionRoot ? K().back() : '';
    const navOn = otherTeam ? 'league' : (SECTION_OF[top.name] || SECTION_OF[scr.nav] || scr.nav || top.name);
    const head = h`<header class="topbar">
      <div class="tb-l">${back}${!back && lg && !lg.tmp ? K().badge(lg.teams[lg.userTid], 's') : ''}</div>
      <h1 class="tb-title ellip">${headTitle(top.name, scr, top.params)}</h1>
      <div class="tb-r" data-head-stats>${lg && !lg.tmp ? headStats(lg) : ''}</div>
    </header>`;
    const full = chrome === 'full' && lg && !lg.tmp;
    const nav = full ? h`<nav class="navbar" aria-label="Main">${NAV.map((n) => h`<button type="button" class="nav-i ${n.id === navOn ? 'on' : ''}" data-action="nav" data-id="${n.id}" data-testid="nav-${n.id}" ${n.id === navOn ? D().raw('aria-current="page"') : ''}><span class="nav-ic" aria-hidden="true">${K().ic(n.icon)}</span><span class="nav-t">${n.label}</span>${badgeFor(n.id, lg) ? D().raw('<span class="dot"></span>') : ''}</button>`)}</nav>` : '';
    const sub = full && !otherTeam ? subnav(top, lg) : '';
    return h`<div class="frame ${full ? 'has-nav' : 'no-nav'} ${sub ? 'has-sub' : ''}">${head}${sub}${nav}<main class="view enter" tabindex="-1"></main></div>`;
  }
  /** which sub-tab is lit for a stack entry (null = this screen is not one of the section's tabs) */
  function subOn(list, top) {
    const tab = top.params && top.params.tab;
    const hit = list.filter((x) => x.to === top.name || (x.also && x.also.includes(top.name)));
    if (!hit.length) return null;
    if (hit.length === 1) return hit[0].id;
    const exact = hit.find((x) => x.tab && x.tab === (tab || (top.name === 'team' ? teamTab() : null)));
    return (exact || hit[0]).id;
  }
  function teamTab() { return (UI.screens.team && UI.screens.team.curTab && UI.screens.team.curTab()) || 'overview'; }
  function subnav(top, lg) {
    const sec = SECTION_OF[top.name];
    const list = (SECTIONS[sec] || []).filter((x) => !x.when || x.when(lg));
    const on = subOn(list, top);
    if (!on) return '';
    const h = D().html;
    return h`<nav class="subnav" aria-label="Section"><div class="subnav-in">${list.map((x) => h`<button type="button" class="sub-i ${x.id === on ? 'on' : ''}" data-action="sub" data-id="${x.id}" data-sec="${sec}" data-testid="sub-${x.id}" ${x.id === on ? D().raw('aria-current="page"') : ''}>${K().ic(x.icon)}<span>${x.label}</span>${subBadge(x.id, lg) ? D().raw('<span class="dot"></span>') : ''}</button>`)}</div></nav>`;
  }
  function subBadge() { return false; }   // UI_RULES 5: dots only on the rail, one per icon, real problems only
  function headStats(lg) {
    const t = lg.teams[lg.userTid];
    let space = 0;
    try { space = PT.League.Cap.space(lg, lg.userTid); } catch (e) { space = 0; }
    return D().html`${K().coins(t.fin.coins)}${K().cash(space)}`;   // UI_RULES 3: currency only here — Coins + Team Cash
  }
  function updateHead() {
    const box = roots.screen, lg = L();
    const hs = box.querySelector('[data-head-stats]');
    if (hs && lg && !lg.tmp) D().set(hs, headStats(lg));
    const tt = box.querySelector('.tb-title');
    if (tt && cur) { const t = headTitle(cur.name, cur.scr, cur.params); if (tt.textContent !== t) tt.textContent = t; }
  }
  UI.updateHead = updateHead;

  function updateDots() {
    const lg = L();
    if (!lg || !roots.screen) return;
    D().$$('.navbar .nav-i[data-id]', roots.screen).forEach((b) => {
      const on = badgeFor(b.getAttribute('data-id'), lg);
      const dot = b.querySelector('.dot');
      if (on && !dot) { const d = globalThis.document.createElement('span'); d.className = 'dot'; b.appendChild(d); } else if (!on && dot) dot.remove();
    });
  }
  /** attention dots on nav items (design 18.1) */
  function badgeFor(id, lg) {
    try {
      const t = lg.teams[lg.userTid];
      if (id === 'team') return badgeFor('roster', lg) || badgeFor('depth', lg);
      if (id === 'office') return false;
      if (id === 'roster') return PT.League.Q.roster(lg, lg.userTid).some((p) => p.inj && !p.ir && p.tid === t.id && K().startSlot(t, p.id));
      if (id === 'shop') return PT.C.FACILITIES.some((f) => t.fac[f] < 5 && PT.C.FACILITY_COST[f][t.fac[f]] <= t.fin.coins);
      if (id === 'depth') { const v = PT.League.Roster.validate(lg, lg.userTid); return !v.ok; }
    } catch (e) { return false; }
    return false;
  }

  function placeholder(name) {
    return { title: 'Coming soon', mount: (v) => D().set(v, K().layout(K().empty('hammer', 'Coming soon.'))) };
  }

  // ---------------- overworld backdrop (PT.Render.menuBackdrop, feature-detected) ----------------
  const NO_BACKDROP = ['game', 'practice', 'quickplay'];
  let backdropKey = '';
  UI.backdrop = function (name) {
    const R = PT.Render;
    if (!R || !R.menuBackdrop || (PT.App && PT.App.noGL) || NO_BACKDROP.includes(name)) return;
    if (UI.Hud && UI.Hud.active && UI.Hud.active()) return;
    const lg = L();
    const t = lg && !lg.tmp && lg.teams ? lg.teams[lg.userTid] : null;
    const mode = !t || ['title', 'slots', 'newgame', 'howto'].includes(name) ? 'title'
      : name === 'draft' ? 'draft' : ['market', 'swaps', 'resign'].includes(name) ? 'market' : 'hq';
    const o = { mode: mode };
    if (t) { o.teamCol = t.col.pri; o.sec = t.col.sec; o.sp = t.sp; if (t.clim) o.clim = t.clim; if (t.fac) o.lvl = t.fac.std; if (t.stad) o.stad = t.stad; }
    const key = JSON.stringify(o);
    if (key === backdropKey) return;
    backdropKey = key;
    try { R.menuBackdrop(o); } catch (e) { fail(e, 'backdrop'); }
  };
  UI.backdropReset = () => { backdropKey = ''; };

  /** count-up for numbers marked data-countup="N" (fast, stepped; skipped with reduced motion) */
  UI.countUp = function (root) {
    if (!root || D().reduced()) return;
    D().$$('[data-countup]', root).forEach((el) => {
      const to = +el.getAttribute('data-countup');
      const fmt = el.getAttribute('data-fmt') === 'int' ? D().int : (n) => String(n);
      if (!isFinite(to) || to === 0) return;
      const t0 = D().now(), dur = 520;
      const tick = () => {
        const k = Math.min(1, (D().now() - t0) / dur);
        el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1 && el.isConnected) (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16)))(tick);
      };
      el.textContent = fmt(0);
      tick();
    });
  };

  // ---------------- events ----------------
  UI.click = function (kind) { if (PT.Events) PT.Events.emit('ui:click', { kind: kind || 'tap' }); };

  const GLOBAL = {
    back: () => { UI.click('back'); UI.back(); },
    nav: (t) => {
      const id = t.getAttribute('data-id');
      UI.click('tap');
      if (id === 'hub') UI.reset();
      else if (SECTIONS[id]) { const x = SECTIONS[id][0]; UI.reset(x.to, x.tab ? { tab: x.tab } : {}); }
      else UI.reset(id);
    },
    sub: (t) => {
      const sec = SECTIONS[t.getAttribute('data-sec')] || [];
      const x = sec.find((i) => i.id === t.getAttribute('data-id'));
      if (!x) return;
      UI.click('tap');
      UI.reset(x.to, x.tab ? { tab: x.tab } : {});
    },
    'flow-next': () => UI.Flow.next(),
    player: (t) => { UI.click('tap'); UI.go('player', { pid: +t.getAttribute('data-pid') }); },
    'team-view': (t) => { UI.click('tap'); UI.go('roster', { tid: +t.getAttribute('data-tid') }); },
    'tip-ok': (t) => {
      K().tipDone(t.getAttribute('data-id'));
      const box = t.closest('.tip');
      if (box) { box.classList.add('tip-out'); setTimeout(() => box.remove(), 200); }
    }
  };

  function onClick(ev) {
    const t = ev.target.closest ? ev.target.closest('[data-action]') : null;
    if (!t || !roots.screen.contains(t) || t.disabled) return;
    const a = t.getAttribute('data-action');
    const scr = cur && cur.scr;
    if (a === 'pg' && UI.pgClick && UI.pgClick(t)) return;    // ROUND6: paged lists (pager.js)
    try {
      if (scr && scr.actions && scr.actions[a]) {
        if (a !== 'flow-next' && a !== 'back') UI.click(t.classList.contains('btn-go') ? 'next' : 'tap');
        scr.actions[a](t, ev, cur.params);
      } else if (GLOBAL[a]) GLOBAL[a](t, ev);
    } catch (e) { fail(e, 'action ' + a); UI.Toast.show('Something went wrong. Try again.', 'bad'); }
  }
  function onInput(ev) {
    const scr = cur && cur.scr;
    if (scr && scr.onInput) { try { scr.onInput(ev.target, ev, cur.params); } catch (e) { fail(e, 'input'); } }
  }

  function typing() {
    const a = globalThis.document.activeElement;
    if (!a) return false;
    const tag = a.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable;
  }
  function focusables(root) {
    return D().$$('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex="0"]', root)
      .filter((x) => x.offsetParent !== null || x.getClientRects().length);
  }
  function moveFocus(dir) {
    const m = UI.Modal.top();
    const root = m ? m.wrap : roots.screen;
    const list = focusables(root);
    if (!list.length) return;
    const i = list.indexOf(globalThis.document.activeElement);
    const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
    try { list[n].focus(); list[n].scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
  }

  function onKey(ev) {
    if (ev.defaultPrevented) return;
    const k = ev.key;
    if (UI.Hud && UI.Hud.active && UI.Hud.active()) { if (UI.Hud.key && UI.Hud.key(ev)) { ev.preventDefault(); } return; }
    if (UI.pgKey && UI.pgKey(ev)) { ev.preventDefault(); return; }
    if (UI.Modal.isOpen()) {
      if (k === 'Escape') { ev.preventDefault(); UI.Modal.cancelTop(); return; }
      if (!typing() && (k === 'ArrowDown' || k === 'ArrowRight')) { ev.preventDefault(); moveFocus(1); }
      if (!typing() && (k === 'ArrowUp' || k === 'ArrowLeft')) { ev.preventDefault(); moveFocus(-1); }
      if (k === 'Tab') { // trap focus inside the modal
        const list = focusables(UI.Modal.top().wrap);
        if (list.length) {
          const i = list.indexOf(globalThis.document.activeElement);
          if (ev.shiftKey && i <= 0) { ev.preventDefault(); list[list.length - 1].focus(); }
          else if (!ev.shiftKey && i === list.length - 1) { ev.preventDefault(); list[0].focus(); }
        }
      }
      return;
    }
    if (cur && cur.scr.keys && !typing()) { if (cur.scr.keys(ev)) { ev.preventDefault(); return; } }
    if (k === 'Escape') { if (typing()) { globalThis.document.activeElement.blur(); return; } if (UI.back()) { UI.click('back'); ev.preventDefault(); } return; }
    if (typing()) return;
    if ((k === 'n' || k === 'N') && cur && cur.name === 'hub' && !ev.metaKey && !ev.ctrlKey) { ev.preventDefault(); UI.Flow.next(); return; }
    if (k === 'ArrowDown' || k === 'ArrowRight') { ev.preventDefault(); moveFocus(1); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft') { ev.preventDefault(); moveFocus(-1); }
  }

  // ---------------- theme & prefs ----------------
  /** Team colors → CSS vars (--c-pri, --c-sec, --c-go = most vivid one for primary buttons). */
  UI.theme = function (team) {
    const lg = L();
    const t = team || (lg ? lg.teams[lg.userTid] : null);
    const r = globalThis.document.documentElement.style;
    if (!t) { ['--c-pri', '--c-sec', '--c-pri-ink', '--c-sec-ink', '--c-go', '--c-go-ink'].forEach((v) => r.removeProperty(v)); return; }
    const dd = D();
    const cands = [t.col.pri, t.col.sec, t.col.acc].filter((c) => c != null);
    const vivid = cands.filter((c) => dd.sat(c) > 0.45 && dd.lum(c) > 0.08 && dd.lum(c) < 0.85).sort((a, b) => dd.sat(b) - dd.sat(a))[0];
    const go = vivid != null ? vivid : 0x2ecc71;
    r.setProperty('--c-pri', dd.hex(t.col.pri));
    r.setProperty('--c-sec', dd.hex(t.col.sec));
    r.setProperty('--c-pri-ink', dd.inkOn(t.col.pri));
    r.setProperty('--c-sec-ink', dd.inkOn(t.col.sec));
    r.setProperty('--c-go', dd.hex(go));
    r.setProperty('--c-go-ink', dd.inkOn(go));
  };
  /** device prefs + league settings → root attributes (reduce motion, text size, left-handed) */
  UI.applyPrefs = function () {
    const root = globalThis.document.documentElement;
    let pr = {};
    try { pr = PT.Save && PT.Save.prefs ? PT.Save.prefs() || {} : {}; } catch (e) { pr = {}; }
    const lg = L();
    const st = (lg && lg.settings) || {};
    root.setAttribute('data-motion', pr.reduceMotion ? 'reduce' : 'full');
    root.setAttribute('data-text', pr.textSize === 'big' ? 'big' : 'normal');
    root.setAttribute('data-lefty', st.lefty || pr.lefty ? '1' : '0');
  };

  // ---------------- Flow: the one big NEXT button ----------------
  const Flow = UI.Flow = UI.Flow || {};
  Flow.busy = false;
  Flow.status = function () {
    const lg = L();
    if (!lg || !PT.League || !PT.League.Calendar) return null;
    try { return PT.League.Calendar.status(lg); } catch (e) { fail(e, 'status'); return null; }
  };
  function gameOf(gid) { const lg = L(); return lg.sched.find((g) => g.gid === gid) || null; }
  function oppOf(g) { const lg = L(); return lg.teams[g.h === lg.userTid ? g.a : g.h]; }

  /** { text, sub, icon } for the NEXT button */
  Flow.label = function () {
    if (Flow.busy) return { text: 'Simming…', sub: '', icon: 'hourglass' };
    const st = Flow.status();
    if (!st) return { text: 'Next', sub: '', icon: 'play' };
    const lg0 = L();
    if (lg0 && lg0.boss && lg0.boss.fired) return { text: 'Boss Meeting', sub: 'The Boss wants to see you', icon: 'megaphone' };
    const b = st.blockers && st.blockers[0];
    if (b) {
      if (b.k === 'USER_GAME') {
        const g = gameOf(b.gid), o = g ? oppOf(g) : null;
        const lg = L();
        // short main line (fits a phone button); the opponent goes on the sub line
        return { text: g && !g.po ? 'Play Week ' + g.wk : st.nextLabel && /play/i.test(st.nextLabel) ? st.nextLabel : (g && g.po ? 'Play ' + PT.C.PLAYOFF_NAMES[g.po] : 'Play Week ' + lg.week),
          sub: o ? (g.h === lg.userTid ? 'vs ' : '@ ') + o.name : '', icon: 'football' };
      }
      if (b.k === 'EVENT') return { text: 'Team News', sub: 'Decision needed', icon: 'megaphone' };
      if (b.k === 'ROSTER') return { text: 'Fix Roster', sub: (b.errors && b.errors[0] && b.errors[0].msg) || 'Lineup needs help', icon: 'clipboard' };
      if (b.k === 'CAP') return { text: 'Too Much Pay', sub: 'Over the Team Cash limit', icon: 'cash' };
      if (b.k === 'DRAFT_PICK') return { text: 'On the Clock', sub: 'Make your pick', icon: 'grad' };
      if (b.k === 'FANTASY') return { text: 'Fantasy Draft', sub: '', icon: 'dice' };
    }
    const away = awayFromPhase();
    if (away) return away.label;
    return { text: st.nextLabel || 'Next', sub: subFor(st), icon: 'play' };
  };
  /**
   * HUNT2 #2: in the offseason NEXT first opens the phase screen (Season Recap, Keep Players, Draft Day, Market)
   * when you are somewhere else (HQ after Continue, a Team screen…). It never advances past a screen you have not seen.
   * @returns {{to:string, label:{text,sub,icon}}|null}
   */
  function awayFromPhase() {
    const lg = L();
    if (!lg || ['SEASON_END', 'RESIGN', 'DRAFT', 'FREE_AGENCY'].indexOf(lg.phase) < 0) return null;
    const to = Flow.screenFor();
    const cur = UI.current();
    if (!to || to === 'hub' || to === 'fantasy' || (cur && cur.name === to)) return null;
    let sub = '';
    if (to === 'resign') {
      let n = 0;
      try { n = (PT.League.Contracts.expiring(lg, lg.userTid) || []).length; } catch (e) { n = 0; }
      sub = n === 1 ? '1 deal ending' : n + ' deals ending';
    }
    const NAMES = { awards: ['Season Recap', 'trophy'], growth: ['Season Recap', 'trophy'], goodbyes: ['Season Recap', 'trophy'],
      resign: ['Keep Players', 'contract'], draft: ['Draft Day', 'grad'], market: ['Market', 'cart'] };
    const nm = NAMES[to] || ['Next', 'play'];
    return { to: to, label: { text: nm[0], sub: sub, icon: nm[1] } };
  }
  function subFor(st) {
    const lg = L();
    if (st.phase === 'REGULAR') {
      const g = lg.sched.find((x) => x.po === 0 && x.wk === lg.week && (x.h === lg.userTid || x.a === lg.userTid));
      if (!g) return '';
      if (g.st === 'F') return lg.week < PT.C.REG_WEEKS ? 'Go to week ' + (lg.week + 1) : 'Playoffs next';
    }
    if (st.phase === 'FREE_AGENCY') return 'Players answer offers';
    return '';
  }

  function setBusy(v) {
    Flow.busy = v;
    D().$$('[data-action="flow-next"]', roots.screen).forEach((b) => {
      b.disabled = v;
      b.classList.toggle('busy', v);
      const lab = Flow.label();
      const t = b.querySelector('.btn-t'); if (t) t.textContent = lab.text;
      const s = b.querySelector('.btn-sub'); if (s) s.textContent = lab.sub;
      const i = b.querySelector('.btn-ic'); if (i) D().set(i, K().ic(lab.icon));
    });
  }

  /** snapshot user skills right before Growth Day so the Growth screen can show arrows */
  function snapshotGrowth(lg) {
    const m = {};
    PT.League.Q.roster(lg, lg.userTid).forEach((p) => { m[p.id] = { ovr: p.ovr, r: Object.assign({}, p.r), age: p.age }; });
    D().memo.growth = { s: lg.season, m: m };
  }

  /** where the flow should be for the current phase (screen name) */
  Flow.screenFor = function () {
    const lg = L();
    if (!lg) return 'title';
    if (lg.fd && !lg.fd.done) return 'fantasy';
    switch (lg.phase) {
      case 'SEASON_END': return ['awards', 'growth', 'goodbyes'][lg.sub] || 'awards';
      case 'RESIGN': return 'resign';
      case 'DRAFT': return 'draft';
      case 'FREE_AGENCY': return 'market';
      default: return 'hub';
    }
  };
  Flow.goPhase = function () {
    const lg = L();
    const target = Flow.screenFor();
    // QA1: fired → the Fired screen (Awards Night itself still shows first)
    if (lg && lg.boss && lg.boss.fired && target !== 'awards') { UI.reset('fired'); return; }
    if (lg && lg.ev && lg.ev.pending && lg.ev.pending.length && ['REGULAR', 'PLAYOFFS', 'SEASON_END', 'RESIGN'].includes(lg.phase)) {
      UI.reset(target === 'hub' ? 'events' : target);
      if (target !== 'hub') UI.go('events');
      return;
    }
    const c = UI.current();
    if (c && c.name === target && stack.length <= 2) { UI.refresh(); return; }
    UI.reset(target);
  };

  /** Press NEXT: resolve blockers by opening the right screen, else App.advance(). */
  Flow.next = function () {
    const lg = L();
    if (!lg || Flow.busy) return Promise.resolve(null);
    UI.click('next');
    // QA1: fired at Awards Night → the Fired screen (take a job / retire) before the offseason goes on
    if (lg.boss && lg.boss.fired) { UI.reset('fired'); return Promise.resolve(null); }
    const st = Flow.status();
    if (!st) return Promise.resolve(null);
    const b = st.blockers && st.blockers[0];
    if (b) {
      switch (b.k) {
        case 'USER_GAME': {
          // HUNT2 #7: a regular-season game starts straight from HQ; playoff games keep the Pregame card
          const g = gameOf(b.gid);
          if (g && !g.po && UI.Game && UI.current() && UI.current().name === 'hub') UI.Game.play(b.gid);
          else UI.go('pregame', { gid: b.gid });
          return Promise.resolve(null);
        }
        case 'EVENT': UI.go('events'); return Promise.resolve(null);
        case 'DRAFT_PICK': if (!UI.current() || UI.current().name !== 'draft') UI.reset('draft'); else UI.Toast.show("You're on the clock.", 'info'); return Promise.resolve(null);
        case 'FANTASY': UI.reset('fantasy'); return Promise.resolve(null);
        case 'ROSTER': return rosterHelp(b);
        case 'CAP': return capHelp(b);
        default: UI.Toast.show('Finish this first.', 'bad'); return Promise.resolve(null);
      }
    }
    const away = awayFromPhase();
    if (away) { UI.reset(away.to); return Promise.resolve(null); }
    if (lg.phase === 'SEASON_END' && lg.sub === 0) snapshotGrowth(lg);
    const before = { phase: lg.phase, sub: lg.sub, week: lg.week, season: lg.season };
    setBusy(true);
    return Promise.resolve().then(() => PT.App.advance()).then((res) => {
      setBusy(false);
      if (res && res.ok === false) { UI.Toast.show(res.msg || 'Not yet.', 'bad'); UI.refresh(); return res; }
      afterAdvance(before, res);
      return res;
    }).catch((e) => { setBusy(false); fail(e, 'advance'); UI.Toast.show('Something went wrong. Try again.', 'bad'); });
  };

  function afterAdvance(before, res) {
    const lg = L();
    UI.theme();
    if (before.season !== lg.season) UI.Toast.show('Season ' + lg.season + ' begins', 'good', 3000);
    else if (before.phase === 'REGULAR' && lg.phase === 'REGULAR') UI.Toast.show('Week ' + lg.week, 'good');
    else if (lg.phase === 'PLAYOFFS' && before.phase !== 'PLAYOFFS') UI.Toast.show('Playoffs begin', 'good', 3000);
    else if (before.phase === 'PLAYOFFS' && lg.phase !== 'PLAYOFFS' && lg.bowl && lg.bowl.champ != null && lg.teams[lg.bowl.champ]) {
      // round 2: one press sims the rest of the playoffs — say who won the Pixel Bowl
      const b = lg.bowl, w = lg.teams[b.champ], loser = lg.teams[b.champ === b.h ? b.a : b.h];
      const ws = b.champ === b.h ? b.hs : b.as, ls = b.champ === b.h ? b.as : b.hs;
      UI.Toast.show((b.champ === lg.userTid ? 'You won the Pixel Bowl! ' : 'Pixel Bowl: ') + w.name + ' ' + ws + '-' + ls + (loser ? ' over the ' + loser.name : ''), b.champ === lg.userTid ? 'good' : 'info', 3500);
    }
    else if (lg.phase === 'DRAFT' && before.phase === 'DRAFT') {
      const ds = PT.League.Draft && PT.League.Draft.status ? PT.League.Draft.status(lg) : null;
      if (ds && ds.userOnClock) UI.Toast.show("You're on the clock", 'good');
    } else if (lg.phase === 'FREE_AGENCY' && before.phase === 'FREE_AGENCY') UI.Toast.show('Market Day ' + (lg.sub + 1), 'good');
    Flow.goPhase();
  }

  function rosterHelp(b) {
    const errs = (b.errors || []).map((e) => e.msg);
    // round 2: say exactly what Auto-Fix will do (signings / cuts with names, OVR and dead pay)
    let plan = '';
    try { const lg = L(); const fp = PT.League.Roster.fixPlan && PT.League.Roster.fixPlan(lg, lg.userTid, { useFA: true }); plan = (fp && fp.text) || ''; } catch (e) { plan = ''; }
    return UI.Modal.open({ title: 'Roster Issues', icon: 'clipboard',
      body: D().html`<ul class="bul">${errs.map((m) => D().html`<li>${m}</li>`)}</ul>${plan ? D().html`<p class="small"><b>Auto-Fix:</b> ${plan}</p>` : ''}<p class="muted small">Fix it yourself or use Auto-Fix.</p>`,
      buttons: [{ label: 'Auto-Fix', value: 'fix', kind: 'go', testid: 'btn-fix-roster' }, { label: 'Go to Lineup', value: 'go', kind: 'sec' }, { label: 'Later', value: null, kind: 'cancel' }] })
      .then((v) => {
        if (v === 'fix') { PT.League.Auto.resolve(L(), b); UI.Toast.show('Roster fixed', 'good'); if (PT.Events) PT.Events.emit('league:changed', { what: 'roster' }); UI.refresh(); }
        else if (v === 'go') UI.reset('depth');
      });
  }
  function capHelp(b) {
    return UI.Modal.open({ title: 'Too Much Pay', icon: 'cash',
      body: D().html`<p>Over the Team Cash limit by <b>${D().money(b.over || 0)}</b>. Cut or swap a player.</p>`,
      buttons: [{ label: 'See Pay', value: 'go', kind: 'go' }, { label: 'Auto-Fix', value: 'fix', kind: 'sec' }, { label: 'Later', value: null, kind: 'cancel' }] })
      .then((v) => {
        if (v === 'go') UI.reset('team', { tab: 'pay' });
        else if (v === 'fix') { PT.League.Auto.resolve(L(), b); UI.refresh(); }
      });
  }

  /** Sim several steps (btn-sim-to-end etc.) through PT.App.simUntil with a busy overlay */
  Flow.simUntil = function (kind, text) {
    if (Flow.busy) return Promise.resolve();
    setBusy(true);
    const busy = UI.Modal.busy(text || 'Simming…');
    return Promise.resolve().then(() => PT.App.simUntil(kind)).then(() => {
      busy.close(); setBusy(false); UI.Toast.show('Done', 'good'); Flow.goPhase();
    }).catch((e) => { busy.close(); setBusy(false); fail(e, 'simUntil'); });
  };
})(globalThis.PT = globalThis.PT || {});
