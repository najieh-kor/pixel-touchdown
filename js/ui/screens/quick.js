/* Pixel Touchdown: js/ui/screens/quick.js
 * Owner: FEATURES. Responsibility: Quick Game: pick your team + opponent (32-team grids with Stars), difficulty, quarter
 * length and weather, then play one real game (engine + render + HUD). Nothing touches a franchise save: the game runs
 * in a throwaway in-memory league (PT.App.tempLeague: fixed-seed rosters, fresh game seed) made current with
 * PT.App.borrow(L, 'quick'); App.slot stays null so autosave is a no-op. The 'game' screen routes a finished quick game
 * to 'quickpost' (Play again / Change teams / Title).
 * Screens: 'quick' {step?}, 'quickpost' {gid, box, quit}.
 * testids: qg-team-{tid}, qg-opp-{tid}, btn-qg-random, btn-qg-change-team, btn-qg-change-opp, qg-diff-{0..3},
 *          qg-q-{sec}, qg-wx-{key}, btn-quick-play · btn-qg-again, btn-qg-teams, btn-qg-title.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  // HUNT #23: difficulty cards come from K().diffCards (same table as New Game)
  /** pixel icon from PT.UI.Icons when the art pack is loaded (no emoji fallback: plain words carry the meaning) */
  const ic = (n) => (UI.Icons && UI.Icons.get ? UI.Icons.get(n) : null) || undefined;
  const QLEN = [[120, '2 min'], [180, '3 min'], [300, '5 min'], [420, '7 min']];
  const MPH = 0.48889;
  const WX = {
    random: { name: 'Any', set: null },          // HUNT3 #11: short enough for the 4-column weather row
    sunny: { name: 'Sunny', set: { k: 'sunny', wx: 0, wy: 0, mph: 3 } },
    rain: { name: 'Rain', set: { k: 'rain', wx: 0, wy: 0, mph: 6 } },
    snow: { name: 'Snow', set: { k: 'snow', wx: 0, wy: 0, mph: 5 } },
    wind: { name: 'Windy', set: { k: 'wind', wx: Math.round(18 * MPH * 100) / 100, wy: 0, mph: 18 } },
    fog: { name: 'Fog', set: { k: 'fog', wx: 0, wy: 0, mph: 2 } },
    clear: { name: 'Dome', set: { k: 'clear', wx: 0, wy: 0, mph: 0 } }
  };
  const st = { step: 'you', tid: null, opp: null, diff: 1, q: 180, wx: 'random' };
  let ovrCache = null;

  function teams() { return (PT.Data && PT.Data.Teams && PT.Data.Teams.list) || []; }
  function teamDef(tid) { return teams().find((t) => t.id === tid) || null; }
  /** team OVR per tid from the same fixed-seed rosters Quick Game plays with (built once, ~0.1 s) */
  function ovrs() {
    if (ovrCache) return ovrCache;
    try {
      const L = PT.League.create({ seed: PT.App.TEMP_SEED || 20260, userTid: 0, coach: 'Coach', diff: 1, now: 0 });
      ovrCache = L.teams.map((t) => PT.League.Q.teamOvr(L, t.id).ovr);
    } catch (e) { ovrCache = teams().map((t) => 60 + (t.tier || 3) * 3); }
    return ovrCache;
  }
  const rnd = (n) => Math.floor(Math.random() * n);

  function tile(t, kind, sel) {
    return html`<button type="button" class="tteam tteamx qg-tile ${sel ? 'sel' : ''}" data-action="${kind}" data-tid="${t.id}" data-testid="qg-${kind === 'pick-opp' ? 'opp' : 'team'}-${t.id}" style="${K().teamVars(t)}">
      ${K().badge(t, 'm')}
      <span class="tteam-txt">
        <span class="tteam-n ellip">${t.name}</span>
        <span class="tteam-row">${K().stars(ovrs()[t.id], { team: true })}</span>
        <span class="tteam-c tiny ellip">${t.city}</span>
      </span>
    </button>`;
  }
  /** ROUND6 "0 scrolling": one paged grid (conference, then division order) */
  function grid(kind, skip) {
    const list = teams().filter((t) => t.id !== skip).sort((a, b) => (a.conf - b.conf) || (a.div - b.div) || (a.id - b.id));
    return K().pg(kind === 'pick-opp' ? 'qg-opp' : 'qg-team', list.map((t) => tile(t, kind, kind === 'pick-opp' ? st.opp === t.id : st.tid === t.id)), { grid: true, cls: 'qgx-teams' });
  }
  function steps(n) {
    return html`<div class="ng-steps"><span class="${n === 1 ? 'on' : ''}">1 Your team</span><span class="${n === 2 ? 'on' : ''}">2 Opponent</span><span class="${n === 3 ? 'on' : ''}">3 Play</span></div>`;
  }
  function picked(t, label, action, testid) {
    return html`<div class="ng-picked qg-picked qgx-picked" style="${K().teamVars(t)}">
      ${K().badge(t, 'm')}
      <div class="grow"><div class="tiny">${label}</div><div class="ellip"><b>${t.name}</b></div></div>
      ${K().btn({ label: 'Change', action: action, kind: 'sec', size: 's', testid: testid })}
    </div>`;
  }
  const randBtn = (label) => K().btn({ label: 'Random', icon: ic('dice'), action: 'random', kind: 'gold', size: 's', testid: 'btn-qg-random', title: label, cls: 'qgx-rand' });

  function stepYou() {
    return K().layout(html`<div class="qgx-head">${steps(1)}${randBtn('Random Team')}</div>${grid('pick-team', -1)}`, null, 'fit nsa quick');
  }
  function stepOpp() {
    const t = teamDef(st.tid);
    return K().layout(html`<div class="qgx-head">${steps(2)}${picked(t, 'You play as', 'change-team', 'btn-qg-change-team')}${randBtn('Random Opponent')}</div>${grid('pick-opp', st.tid)}`, null, 'fit nsa quick');
  }
  function stepOpts() {
    const t = teamDef(st.tid), o = teamDef(st.opp);
    const kc = K().kitCols(t, o);                  // HUNT3 #12: you are home; colours as the kits on the field
    const seg = (list, cur, act, pre) => html`<div class="seg qg-seg-${act}">${list.map((x) => K().btn({ label: x[1], kind: 'sec', size: 's', action: act, cls: x[0] === cur ? 'on' : '', data: { v: x[0] }, testid: pre + x[0] }))}</div>`;
    return K().layout(html`<div class="cols2 qgx">
      <div>
        <section class="card qg-vs">
          <button type="button" class="qg-side" data-action="change-team" data-testid="btn-qg-change-team" style="${K().teamVars(t)};--t-pri:${kc.h};--t-pri-ink:${D().inkOn(kc.hn)}">${K().badge(t, 'l')}<b class="ellip">${t.name}</b>${K().stars(ovrs()[t.id], { team: true })}</button>
          <span class="qg-vs-t">VS</span>
          <button type="button" class="qg-side" data-action="change-opp" data-testid="btn-qg-change-opp" style="${K().teamVars(o)};--t-pri:${kc.a};--t-pri-ink:${D().inkOn(kc.an)}">${K().badge(o, 'l')}<b class="ellip">${o.name}</b>${K().stars(ovrs()[o.id], { team: true })}</button>
        </section>
        <section class="card">${K().h2('Difficulty')}
          ${K().diffCards(st.diff, 'qg-diff-')}
        </section>
      </div>
      <div>
        <section class="card">${K().h2('Quarter length')}${seg(QLEN, st.q, 'qlen', 'qg-q-')}</section>
        <section class="card qg-wx-card">${K().h2('Weather')}${seg(Object.keys(WX).map((k) => [k, WX[k].name]), st.wx, 'wx', 'qg-wx-')}</section>
      </div>
    </div>`,
    K().btn({ label: 'Kick Off', icon: ic('ball'), action: 'play', kind: 'go', size: 'xl', testid: 'btn-quick-play', cls: 'btn-wide' }), 'fit nsa quick');
  }

  function mount(el, params) {
    if (params.step) { st.step = params.step; params.step = null; }
    if (st.step !== 'you' && st.tid == null) st.step = 'you';
    if (st.step === 'opts' && (st.opp == null || st.opp === st.tid)) st.step = 'opp';
    UI.theme(st.tid != null ? teamDef(st.tid) : null);
    D().set(el, st.step === 'opts' ? stepOpts() : st.step === 'opp' ? stepOpp() : stepYou());
  }
  function go(step) { st.step = step; UI.refresh(); const s = D().$('#screen [data-scroll]'); if (s) s.scrollTop = 0; }

  /** build the throwaway league and start the game (shared with Play again) */
  function start(replace) {
    if (st.tid == null || st.opp == null) return;
    const busy = UI.Modal.busy('Getting the field ready…');
    setTimeout(() => {
      let r;
      try {
        r = PT.App.tempLeague({ userTid: st.tid, oppTid: st.opp, diff: st.diff, qLen: st.q, wx: WX[st.wx] ? WX[st.wx].set : null });
        PT.App.borrow(r.L, 'quick');
      } catch (e) {
        busy.close();
        if (PT.Log) PT.Log.error('ui', 'quick game', e);
        UI.Toast.show('Could not start the game.', 'bad');
        return;
      }
      busy.close();
      UI.theme(); UI.applyPrefs();
      if (replace) UI.replace('game', { gid: r.gid }); else UI.go('game', { gid: r.gid });
    }, 30);
  }

  UI.screens.quick = {
    title: 'Quick Game',
    chrome: 'head',
    mount: mount,
    actions: {
      back: () => {
        if (st.step === 'opts') go('opp');
        else if (st.step === 'opp') go('you');
        else UI.back();
      },
      'pick-team': (el) => { st.tid = +el.getAttribute('data-tid'); if (st.opp === st.tid) st.opp = null; go(st.opp != null ? 'opts' : 'opp'); },
      'pick-opp': (el) => { st.opp = +el.getAttribute('data-tid'); go('opts'); },
      random: () => {
        const ts = teams();
        if (st.step === 'you') { st.tid = ts[rnd(ts.length)].id; if (st.opp === st.tid) st.opp = null; go('opp'); return; }
        const others = ts.filter((t) => t.id !== st.tid);
        st.opp = others[rnd(others.length)].id; go('opts');
      },
      'change-team': () => go('you'),
      'change-opp': () => go('opp'),
      diff: (el) => { st.diff = +el.getAttribute('data-d'); UI.refresh(); },
      qlen: (el) => { st.q = +el.getAttribute('data-v'); UI.refresh(); },
      wx: (el) => { st.wx = el.getAttribute('data-v'); UI.refresh(); },
      play: () => start(false)
    },
    keys: (ev) => {
      if (ev.key === 'Escape' && st.step !== 'you') { go(st.step === 'opts' ? 'opp' : 'you'); return true; }
      return false;
    }
  };

  // ---------------- Final ----------------
  function postMount(el, params) {
    const L = PT.App.L;
    const box = params.box;
    if (!L || !L.tmp || !box) { UI.replace('quick'); return; }
    const u = L.userTid, h = box.h, a = box.a, home = h === u;
    const us = home ? box.hs : box.as, them = home ? box.as : box.hs;
    const res = us > them ? 'W' : us < them ? 'L' : 'T';
    const t = L.teams[u];
    // INT2: same one-screen Final as the franchise (UI.finalView); Box Score opens in an overlay
    const foot = html`${K().btn({ label: 'Stats', icon: 'chart', action: 'box', kind: 'sec', size: 'm', testid: 'btn-pgm-box', title: 'Box Score' })}
      ${K().btn({ label: 'Teams', icon: ic('team'), action: 'teams', kind: 'sec', size: 'm', testid: 'btn-qg-teams' })}
      ${K().btn({ label: 'Title', icon: ic('home'), action: 'title', kind: 'sec', size: 'm', testid: 'btn-qg-title' })}
      ${K().btn({ label: 'Play Again', icon: ic('replay'), action: 'again', kind: 'go', size: 'l', testid: 'btn-qg-again', cls: 'pgx-go' })}`;
    const v = UI.finalView(box, { sub: ['Quick Game', box.ot ? 'Overtime' : '', params.quit ? 'Simmed' : 'Final'].filter(Boolean).join(' · '), foot: foot });
    D().set(el, html`<div class="pgx-q">${v.html}</div>`);
    if (res === 'W') { const host = el.querySelector('.pgx'); if (host) K().confetti(host, 50, [D().hex(t.col.pri), D().hex(t.col.sec), '#ffd23f', '#ffffff']); }
  }

  UI.screens.quickpost = {
    title: 'Final',
    chrome: 'bare',
    back: false,
    noRefresh: true,
    mount: postMount,
    actions: {
      again: () => { PT.App.restore(); start(true); },
      box: (b, ev, params) => { if (UI.postgameOverlay && params && params.box) UI.postgameOverlay('box', params.box); },
      teams: () => { PT.App.restore(); st.step = 'opts'; if (!UI.back()) UI.replace('quick'); },
      title: () => { PT.App.restore(); UI.reset(); if (!UI.current() || UI.current().name !== 'title') UI.replace('title'); }
    }
  };
})(globalThis.PT = globalThis.PT || {});
