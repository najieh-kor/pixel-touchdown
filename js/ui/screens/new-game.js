/* Pixel Touchdown: js/ui/screens/new-game.js
 * Owner: WP5. Responsibility: pick team (32 grid), difficulty, coach name.
 * Flow (design 10.1, tuned for "3 taps"): Step 1 Pick Your Team (tap a tile → step 2) → Step 2 You & Difficulty
 * (coach name, coach animal, Rookie/Pro/Legend, Start!) → HQ with the Welcome card (Boss Goal + Season Twist).
 * testids: team-card-{tid}, btn-random-team, diff-{0..3}, input-coach, coach-sp-{id}, tog-fantasy, btn-start-franchise.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const FIRST = ['Biscuit', 'Pickles', 'Waffles', 'Nugget', 'Pebble', 'Sprout', 'Mochi', 'Bean', 'Clover', 'Tater', 'Noodle', 'Peanut',
    'Muffin', 'Ziggy', 'Bubbles', 'Rocco', 'Pepper', 'Toffee', 'Juniper', 'Bongo', 'Doodle', 'Fizz', 'Gus', 'Hazel', 'Kiwi', 'Lulu', 'Maple'];
  // HUNT #23: the difficulty table is shared with Quick Game (K().DIFF / K().diffCards)
  const COACH_SP = ['dog', 'cat', 'rabbit', 'bear', 'fox', 'penguin', 'owl', 'frog', 'pig', 'duck', 'lion', 'panda', 'monkey', 'chicken', 'hamster', 'elephant', 'turtle', 'goat'];
  const st = { slot: 1, step: 'team', tid: null, diff: 1, coach: '', sp: 'dog', filter: 'all' };

  function teams() { return (PT.Data && PT.Data.Teams && PT.Data.Teams.list) || []; }
  function tierOf(t) { return t.tier || 3; }
  function tag(tier) { return tier >= 4 ? ['Easy start', 'green'] : tier === 3 ? ['Normal', 'blue'] : ['Big challenge', 'red']; }

  function teamTile(t) {
    const tier = tierOf(t), tg = tag(tier);
    return html`<button type="button" class="tteam tteamx ${st.tid === t.id ? 'sel' : ''}" data-action="team" data-tid="${t.id}" data-testid="team-card-${t.id}" style="${K().teamVars(t)}">
      ${K().badge(t, 'm')}
      <span class="tteam-txt">
        <span class="tteam-n ellip">${t.name}</span>
        <span class="stars" title="${tier} Stars" role="img" aria-label="${tier} stars">${K().starRow(tier)}</span>
        <span class="tteam-row"><span class="chip chip-${tg[1]} tiny">${tg[0]}</span><span class="tteam-c tiny ellip">${t.city}</span></span>
      </span>
    </button>`;
  }

  /** ROUND6 "0 scrolling": one paged grid of all teams (conference, then division order) */
  function stepTeam() {
    const keep = (t) => st.filter === 'all' || (st.filter === 'easy' && tierOf(t) >= 4) || (st.filter === 'mid' && tierOf(t) === 3) || (st.filter === 'hard' && tierOf(t) <= 2);
    const list = teams().filter(keep).slice().sort((a, b) => (a.conf - b.conf) || (a.div - b.div) || (a.id - b.id));
    const chips = [['all', 'All'], ['easy', 'Easy'], ['mid', 'Normal'], ['hard', 'Hard']];
    return K().layout(html`
      <div class="ng-head">
        <div class="ng-steps"><span class="on">1 Team</span><span>2 Coach</span></div>
        <div class="fchips">${chips.map((c) => html`<button type="button" class="fchip ${st.filter === c[0] ? 'on' : ''}" data-action="filter" data-f="${c[0]}" data-testid="team-filter-${c[0]}">${c[1]}</button>`)}</div>
        ${K().btn({ label: 'Random', icon: 'dice', action: 'random', kind: 'gold', size: 's', testid: 'btn-random-team', title: 'Random Team', cls: 'ngx-rand' })}
      </div>
      ${K().pg('ng-teams', list.map(teamTile), { grid: true, cls: 'ngx-teams', empty: K().empty('question', 'No teams match.') })}`, null, 'fit nsa ngx');
  }

  function stepCoach() {
    const t = teams().find((x) => x.id === st.tid);
    return K().layout(html`<div class="cols2 ngx-coach">
      <section class="card">
        <div class="ng-picked ngx-picked" style="${K().teamVars(t)}">
          ${K().badge(t, 'm')}
          <div class="grow"><div class="tiny">Your team</div><div class="big ellip"><b>${t.city} ${t.name}</b></div></div>
          ${K().btn({ label: 'Change', action: 'change-team', kind: 'sec', size: 's', testid: 'btn-change-team' })}
        </div>
        <div class="field ngx-name">
          <label for="ng-coach">Coach</label>
          <input id="ng-coach" class="inp" type="text" maxlength="24" autocomplete="off" spellcheck="false" data-testid="input-coach" value="${st.coach}">
        </div>
        <span class="tiny muted ngx-sp-l">Coach animal</span>
        <div class="sp-pick ngx-sp-grid" role="radiogroup" aria-label="Coach animal">${COACH_SP.map((s) => html`<button type="button" class="sp-b ${st.sp === s ? 'on' : ''}" role="radio" aria-checked="${st.sp === s}" data-action="sp" data-sp="${s}" data-testid="coach-sp-${s}" title="${K().spName(s)}">${K().sp(s)}</button>`)}</div>
      </section>
      <section class="card">
        ${K().h2('Difficulty')}
        ${K().diffCards(st.diff, 'diff-')}
        <div class="set-row ng-fantasy"><div class="grow"><b>Star Draft</b><div class="tiny muted">Draft your 8 Stars. The rest fills in.</div></div>
          <button type="button" class="toggle ${st.fantasy ? 'on' : ''}" role="switch" aria-checked="${st.fantasy ? 'true' : 'false'}" aria-label="Star Draft" data-action="fantasy" data-testid="tog-fantasy"></button></div>
      </section>
    </div>`,
    K().btn({ label: 'Start Franchise', icon: 'rocket', action: 'start', kind: 'go', size: 'xl', testid: 'btn-start-franchise', cls: 'btn-wide' }), 'fit nsa ngx');
  }

  function mount(el, params) {
    if (params.slot) st.slot = params.slot;
    if (params.fresh !== false && !st._init) { st._init = true; st.coach = 'Coach ' + FIRST[Math.floor(Math.random() * FIRST.length)]; }
    D().set(el, st.step === 'coach' && st.tid != null ? stepCoach() : stepTeam());
  }

  function readCoach() {
    const i = globalThis.document.getElementById('ng-coach');
    if (i) st.coach = i.value.trim().slice(0, 24);
  }

  function start() {
    readCoach();
    if (st.tid == null) { st.step = 'team'; UI.refresh(); return; }
    const name = st.coach || 'Coach';
    const busy = UI.Modal.busy('Building your league…');
    setTimeout(() => {
      let L = null;
      try {
        L = PT.App.newGame(st.slot, { userTid: st.tid, coach: name, coachSp: st.sp, diff: st.diff });
      } catch (e) { busy.close(); if (PT.Log) PT.Log.error('ui', 'newGame', e); UI.Toast.show('Could not start the game.', 'bad'); return; }
      Promise.resolve(L).then((lg) => {
        busy.close();
        lg = lg || PT.App.L;
        if (lg && lg.coach && typeof lg.coach === 'object' && !lg.coach.sp) lg.coach.sp = st.sp;   // adapter: coach animal (cosmetic)
        if (lg) D().memo.welcome = lg.id;
        const fresh = st.fantasy;
        st.step = 'team'; st.tid = null; st._init = false; st.fantasy = false;
        UI.theme(); UI.applyPrefs();
        // FEATURES: fantasy draft start → League.Fantasy (the Fantasy Draft screen; the Welcome card waits for HQ)
        if (fresh && lg && PT.League.Fantasy && PT.League.Fantasy.begin(lg).ok) {
          PT.League.Fantasy.simToUser(lg);
          PT.App.save({}); PT.App.save({ auto: true });
          UI.reset('fantasy');
          return;
        }
        UI.reset();
      });
    }, 40);
  }

  UI.screens.newgame = {
    title: () => (st.step === 'coach' ? 'Coach Setup' : 'Pick Your Team'),
    chrome: 'head',
    mount: mount,
    unmount: readCoach,
    actions: {
      back: () => {
        if (st.step === 'coach') { readCoach(); st.step = 'team'; UI.replace('newgame', { slot: st.slot, fresh: false }); }
        else UI.back();
      },
      team: (el) => { st.tid = +el.getAttribute('data-tid'); st.step = 'coach'; UI.replace('newgame', { slot: st.slot, fresh: false }); },
      random: () => { const ts = teams(); st.tid = ts[Math.floor(Math.random() * ts.length)].id; st.step = 'coach'; UI.replace('newgame', { slot: st.slot, fresh: false }); },
      filter: (el) => { st.filter = el.getAttribute('data-f'); if (UI.pgPage) UI.pgPage('ng-teams', 0); UI.refresh(); },
      'change-team': () => { readCoach(); st.step = 'team'; UI.replace('newgame', { slot: st.slot, fresh: false }); },
      sp: (el) => { readCoach(); st.sp = el.getAttribute('data-sp'); UI.refresh(); },
      diff: (el) => { readCoach(); st.diff = +el.getAttribute('data-d'); UI.refresh(); },
      fantasy: () => { readCoach(); st.fantasy = !st.fantasy; UI.refresh(); },
      start: start
    },
    keys: (ev) => {
      if (ev.key === 'Escape' && st.step === 'coach') { readCoach(); st.step = 'team'; UI.replace('newgame', { slot: st.slot, fresh: false }); return true; }
      return false;
    }
  };
})(globalThis.PT = globalThis.PT || {});
