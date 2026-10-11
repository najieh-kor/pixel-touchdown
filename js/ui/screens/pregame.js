/* Pixel Touchdown: js/ui/screens/pregame.js
 * Owner: WP5. Responsibility: matchup card: Play / Sim (design 18.3 Pre-game).
 * params.gid. Both teams' Stars + styles + matchup line (design 7.5), weather + wind, "They love", your 3 best
 * players, your hurt players, Rival / playoff tags. Buttons: btn-play-game (→ 'game'), btn-sim-game (→ 'postgame').
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const C = PT.C;

  // design 7.5 style matchup: defense row vs offense column (positive = defense advantage)
  const MATCH = {
    wall: { air: -1, ground: 1, west: 0, trick: 0.5, speed: -0.5 },
    nofly: { air: 1, ground: -1, west: 0.5, trick: -0.5, speed: 0 },
    wild: { air: 1, ground: 0, west: -1, trick: 0.5, speed: -0.5 },
    think: { air: -0.5, ground: -0.5, west: 0.5, trick: 0.5, speed: 0.5 }
  };
  const LOVE = { air: 'Deep passes', ground: 'Runs up the middle', west: 'Short passes', trick: 'Trick plays', speed: 'Outside runs' };

  function rec(L, tid) { try { return PT.League.Standings.get(L).find((x) => x.tid === tid) || { w: 0, l: 0, t: 0 }; } catch (e) { return { w: 0, l: 0, t: 0 }; } }
  function matchLine(us, them) {
    const ours = MATCH[them.style && them.style.def] ? MATCH[them.style.def][us.style && us.style.off] : 0;
    const theirs = MATCH[us.style && us.style.def] ? MATCH[us.style.def][them.style && them.style.off] : 0;
    const a = ours >= 0.5 ? 'Their defense is good vs your style.' : ours <= -0.5 ? 'Your style is good vs their defense.' : 'Even matchup on offense.';
    const b = theirs >= 0.5 ? 'Your defense is good vs their style.' : theirs <= -0.5 ? 'Their style is good vs your defense.' : 'Even matchup on defense.';
    return [a, b, ours, theirs];
  }



  /** HUNT #46: one team panel; col = its kit colour (same kits as the 3D game, so same-colour teams differ) */
  function side(L, t, label, col, me) {
    const r = rec(L, t.id);
    const vars = K().teamVars(t) + (col != null ? ';--t-pri:' + D().hex(col) + ';--t-pri-ink:' + D().inkOn(col) : '');
    return html`<div class="pg-side ${me ? 'me' : ''}" style="${vars}">
      <span class="tiny pg-ha">${me ? 'You · ' + label : label}</span>
      ${K().badge(t, 'xl')}
      <b class="pg-name">${t.name}</b>
      ${K().stars(K().teamOvr(t.id), { team: true })}
      <span class="num pg-rec">${D().rec(r.w, r.l, r.t)}</span>
    </div>`;
  }

  function mount(el, params) {
    const L = PT.App.L;
    const g = L.sched.find((x) => x.gid === params.gid);
    if (!g) { D().set(el, K().layout(K().empty('football', 'No game found.'))); return; }
    const u = L.teams[L.userTid];
    const home = g.h === L.userTid;
    const opp = L.teams[home ? g.a : g.h];
    let cfg = null;
    try { cfg = PT.League.Games.config(L, g.gid); } catch (e) { cfg = null; }
    const wx = cfg && cfg.weather;
    const ml = matchLine(u, opp);
    const kc = K().kitCols(g.h, g.a);
    let rival = u.rival === opp.id, hot = false;
    try {
      const H = PT.League.History;
      if (H && H.isRivalGame) rival = !!H.isRivalGame(L, g.h, g.a);
      const hr = H && H.hotRival ? H.hotRival(L) : null;
      hot = !!hr && hr.tid === opp.id;
    } catch (e) { /* keep fixed rival */ }
    const title = g.po ? C.PLAYOFF_NAMES[g.po] : 'Week ' + g.wk;
    const done = g.st === 'F';
    // UI_RULES 6: two style tags + ONE short single line per side, no wrapped sentences
    const love = (LOVE[opp.style && opp.style.off] || 'Mixing it up').toLowerCase();
    const them = html`${K().ic('eye')} They love ${love}.`;
    const us = ml[2] <= -0.5 ? 'Your offense has the edge.' : ml[3] <= -0.5 ? 'Their offense has the edge.'
      : ml[3] >= 0.5 ? 'Your defense has the edge.' : ml[2] >= 0.5 ? 'Their defense has the edge.' : 'Even matchup.';
    const usCls = ml[2] <= -0.5 || ml[3] >= 0.5 ? 'good' : ml[3] <= -0.5 || ml[2] >= 0.5 ? 'bad' : '';
    const tags = html`<span class="chip chip-blue">${K().ic('football')} ${C.OFF_STYLES[opp.style && opp.style.off] || 'Balanced'}</span><span class="chip chip-red">${K().ic('shield')} ${C.DEF_STYLES[opp.style && opp.style.def] || 'Balanced'}</span>`;
    const body = html`<div class="prex prez">
      <section class="card pg-match">
        ${side(L, u, home ? 'HOME' : 'AWAY', home ? kc.hn : kc.an, true)}
        <div class="pg-vs"><span>VS</span>
          <div class="pg-tags">${K().chip(title, 'ink')}${rival ? K().chip(hot ? html`${K().ic('flame')} Hot Rival` : 'Rival', 'rival') : ''}</div>
          ${wx ? K().wx(wx.k, wx.mph) : ''}
        </div>
        ${side(L, opp, home ? 'AWAY' : 'HOME', home ? kc.an : kc.hn, false)}
      </section>
      <section class="card prez-scout" data-testid="pg-scout">
        <div class="prez-tags">${tags}</div>
        <p class="prez-line">${them}</p>
        <p class="prez-line ${usCls}">${K().ic('shield')} ${us}</p>
      </section>
    </div>`;
    const foot = done
      ? K().btn({ label: 'See Result', icon: 'clipboard', action: 'result', kind: 'go', size: 'xl', testid: 'btn-pg-result', cls: 'btn-wide' })
      : html`${K().btn({ label: 'Sim', icon: 'bolt', action: 'sim', kind: 'sec', size: 'l', testid: 'btn-sim-game', cls: 'pg-sim' })}${K().btn({ label: 'Play', icon: 'football', action: 'play', kind: 'go', size: 'xl', testid: 'btn-play-game', cls: 'pg-play' })}`;
    D().set(el, K().layout(body, foot, 'fit pregame'));
  }

  function snapshot(L) {
    const t = L.teams[L.userTid];
    return { coins0: t.fin.coins, xp0: L.coach && typeof L.coach === 'object' ? L.coach.xp || 0 : 0, lvl0: L.coach && L.coach.lvl, ach0: Object.keys(L.ach || {}), hype0: t.fin.hype };
  }
  UI.preGameSnapshot = snapshot;

  /** QA1: HQ's Game Day button skips NEXT; a team news / roster / Pay problem must be handled before kickoff
   * (else Play failed into a fake "A tie!" Final, and Sim played a game with no QB). @returns {boolean} */
  function blocked(L) {
    let st = null;
    try { st = PT.League.Calendar.status(L); } catch (e) { st = null; }
    const b = st && st.blockers && st.blockers[0];
    if (!b || b.k === 'USER_GAME' || b.k === 'DRAFT_PICK') return false;
    UI.Flow.next();
    return true;
  }

  UI.screens.pregame = {
    title: (p) => {
      const L = PT.App.L, g = L && L.sched.find((x) => x.gid === p.gid);
      if (!g) return 'Game Day';
      const opp = L.teams[g.h === L.userTid ? g.a : g.h];
      return (g.h === L.userTid ? 'vs ' : '@ ') + opp.name;
    },
    nav: 'hub',
    mount: mount,
    actions: {
      play: (el, ev, params) => {
        const L = PT.App.L;
        if (blocked(L)) return;
        UI.replace('game', Object.assign({ gid: params.gid }, snapshot(L)));
      },
      sim: (el, ev, params) => {
        const L = PT.App.L;
        if (blocked(L)) return;
        const snap = snapshot(L);
        const busy = UI.Modal.busy('Simming the game…');
        setTimeout(() => {
          Promise.resolve().then(() => PT.App.simGame(params.gid)).then((box) => {
            busy.close();
            UI.replace('postgame', Object.assign({ gid: params.gid, box: box, sim: true }, snap));
          }).catch((e) => { busy.close(); if (PT.Log) PT.Log.error('ui', 'simGame', e); UI.Toast.show('Could not sim the game.', 'bad'); });
        }, 30);
      },
      result: (el, ev, params) => UI.replace('postgame', { gid: params.gid })
    },
    keys: (ev) => {
      if (ev.key === 'Enter' && globalThis.document.activeElement && globalThis.document.activeElement.classList.contains('view')) {
        const b = globalThis.document.querySelector('[data-testid="btn-play-game"]'); if (b) { b.click(); return true; }
      }
      return false;
    }
  };
})(globalThis.PT = globalThis.PT || {});
