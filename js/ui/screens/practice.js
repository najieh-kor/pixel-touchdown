/* Pixel Touchdown: js/ui/screens/practice.js
 * Owner: FEATURES. Responsibility: Practice Field: a guided tutorial on the real engine/render/HUD with coach tips.
 * Steps: 1 Throw (retry until a catch) · 2 Run & dodge (catch, then Juke/Spin/Dive) · 3 Handoff run · 4 Defense (pick a
 * call, GO, tap the Star when green) · 5 Field goal (drag-back kick). Every tip adapts to touch / mouse / keyboard /
 * gamepad (PT.Input.lastDevice). "Skip step" and "Leave" are always there; finishing sets prefs.practiceDone.
 *
 * How it works: a throwaway league (PT.App.tempLeague, long quarters, Rookie) is borrowed (PT.App.borrow → no save is
 * touched) and played with PT.Session. The engine has no public "set the situation" API yet, so each step sets the
 * ball from the outside through the engine's exposed internals (game._G + PT.Engine.Rules.setPoss + game._toCall, the
 * same calls the engine uses between plays) while the Session is silently paused, then calls the play with
 * game.callPlay (offense steps) or lets the real tray ask (defense / 4th down). Without those internals it falls back to
 * normal plays with coach prompts. Requests for a real API: docs/handoff/FEATURES-engine-requests.md.
 * Screen 'practice' {from:'title'|'hub'|'howto'}. testids: practice-coach, btn-practice-start (intro card), btn-practice-next (skip step),
 * btn-practice-leave, btn-practice-done, btn-practice-quick; coach card has data-step / data-stage for tests.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const STEPS = [
    { id: 'throw', name: 'Throw', side: 'O', play: 'pass', yd: 25 },
    { id: 'run', name: 'Run & dodge', side: 'O', play: 'pass', yd: 30 },
    { id: 'handoff', name: 'Handoff run', side: 'O', play: 'run', yd: 30 },
    { id: 'defense', name: 'Defense', side: 'D', yd: 30 },
    { id: 'kick', name: 'Field goal', side: 'K', yd: 80 }
  ];
  const MAX_TRIES = { throw: 99, run: 5, handoff: 4, defense: 3, kick: 4 };

  // device-specific words: [touch, mouse, kbd, pad]
  const H = {
    hike: ['Tap HIKE to start the play.', 'Click HIKE to start the play.', 'Press Space to hike.', 'Press A to hike.'],
    throw: ['Put a finger on the field, pull BACK away from a catcher, then let go. A longer pull throws farther.',
      'Click and drag BACK away from a catcher, then let go. A longer pull throws farther.',
      'Press 1, 2, 3 or 4 to throw to that catcher. (You can also drag with the mouse.)',
      'Point the right stick at a catcher, then pull RT to throw. Push farther for a longer throw.'],
    steer: ['Steer with your left thumb. Tap JUKE, SPIN or DIVE to dodge.',
      'Hold the mouse button to run toward the pointer. Click JUKE, SPIN or DIVE to dodge.',
      'Steer with WASD or the arrows. Q = Juke, R = Spin, E = Dive. Shift = sprint.',
      'Steer with the left stick. A = Juke, B = Spin, X = Dive. Hold RT to sprint.'],
    go: ['Tap GO to start. (Tap a defender first to make him your Star.)', 'Click GO to start. (Click a defender to make him your Star.)',
      'Press Enter for GO. Tab moves the Star.', 'Press A for GO. LB moves the Star.'],
    star: ['Watch your Star’s gold ring. Tap when it turns GREEN.', 'Watch your Star’s gold ring. Click when it turns GREEN.',
      'Watch your Star’s gold ring. Press Space when it turns GREEN.', 'Watch your Star’s gold ring. Press A when it turns GREEN.'],
    fourth: ['4th down. Tap Field Goal.', '4th down. Click Field Goal.', '4th down. Press K for Field Goal.', '4th down. Pick Field Goal with the D-pad and A.'],
    kick: ['Pull BACK from the kicker to aim between the posts. Let go when the power is in the green.',
      'Drag BACK from the kicker to aim between the posts. Let go when the power is in the green.',
      'Left and Right arrows aim. Hold Space and let go when the bar is in the green.',
      'Left stick to aim. Hold A and let go when the bar is in the green.']
  };

  // INT2 (client: "the instructions blocked the view"): full instructions only on the intro card before a step;
  // during play a one-line pill at the very top (hidden while the ball is in the air). [touch, mouse, kbd, pad]
  const PILL = {
    hike: ['Tap HIKE', 'Click HIKE', 'Space to hike', 'A to hike'],
    throw: ['Pull back, let go', 'Drag back, let go', 'Press 1–4 to throw', 'Aim, then RT'],
    steer: ['Steer · JUKE · SPIN · DIVE', 'Steer · JUKE · SPIN · DIVE', 'WASD · Q R E to dodge', 'Stick · A B X to dodge'],
    go: ['Tap GO', 'Click GO', 'Enter = GO', 'A = GO'],
    star: ['Tap on GREEN', 'Click on GREEN', 'Space on GREEN', 'A on GREEN'],
    fourth: ['Pick Field Goal', 'Pick Field Goal', 'Pick Field Goal', 'Pick Field Goal'],
    kick: ['Pull back, let go in the green', 'Drag back, let go in the green', 'Hold Space, let go in the green', 'Hold A, let go in the green']
  };
  const BRIEF = {
    throw: 'Throw a pass to an open catcher.',
    run: 'Catch a pass, then dodge a tackler.',
    handoff: 'Run play. The handoff is automatic. Find a gap.',
    defense: 'Pick a defense, press GO, then tap when your Star’s ring turns green.',
    kick: 'Kick a field goal on 4th down.'
  };
  const pill = (k) => PILL[k][devIdx()];

  let P = null;           // the running practice
  /** pixel icon from PT.UI.Icons when the art pack is loaded (no emoji: plain words carry the meaning) */
  const ic = (n) => (UI.Icons && UI.Icons.get ? UI.Icons.get(n) : null) || undefined;

  function devIdx() {
    const d = PT.Input && PT.Input.lastDevice;
    if (P && !P.devSeen && d === 'kbd') {          // nothing pressed yet: guess from the screen
      const n = globalThis.navigator;
      const coarse = (globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches) || (n && n.maxTouchPoints > 0) || 'ontouchstart' in globalThis;
      return coarse ? 0 : 1;
    }
    return d === 'touch' ? 0 : d === 'mouse' ? 1 : d === 'pad' ? 3 : 2;
  }
  const hint = (k) => H[k][devIdx()];

  function pickPlay(kind) {
    const PB = PT.Data.Playbook, list = (PB && PB.list) || [];
    const prefer = kind === 'pass' ? ['hitch_party', 'quick_slants', 'snack_time'] : ['up_the_gut', 'bulldozer', 'zoom_zoom'];
    for (const id of prefer) { const p = PB.byId ? PB.byId(id) : null; if (p && p.id === id) return id; }
    const p = list.find((x) => x.k === kind && !x.sneak && !x.option && !x.reverse && !x.flea && !x.hail && !x.draw && !x.clock);
    return p ? p.id : (list[0] && list[0].id);
  }

  function teamsFor() {
    const st = PT.App._stash && PT.App._stash.L;
    let ovr = null;
    try {
      const L = PT.League.create({ seed: PT.App.TEMP_SEED || 20260, userTid: 0, coach: 'Coach', diff: 0, now: 0 });
      ovr = L.teams.map((t) => PT.League.Q.teamOvr(L, t.id).ovr);
    } catch (e) { ovr = null; }
    const ids = PT.Data.Teams.list.map((t) => t.id);
    const best = ovr ? ids.slice().sort((a, b) => ovr[b] - ovr[a])[0] : 0;
    const user = st ? st.userTid : best;
    const opp = ovr ? ids.filter((x) => x !== user).sort((a, b) => ovr[a] - ovr[b])[0] : (user + 1) % ids.length;
    return { user: user, opp: opp };
  }

  // ---------------- coach card ----------------
  function card() { return P && P.el ? P.el.querySelector('[data-testid="practice-coach"]') : null; }
  function stageOf() {
    const S = PT.Session.state ? PT.Session.state() : null;
    if (!S) return 'wait';
    const tray = UI.PlayCall && UI.PlayCall.isOpen && UI.PlayCall.isOpen();
    // while a decision is pending the Session stops stepping, so the snapshot is stale: ask the engine what it needs
    const g = PT.Session.game && PT.Session.game();
    const n = g && g.needs ? g.needs() : null;
    if (S.pending === 'FOURTH' || (n && n.k === 'FOURTH')) return 'fourth';
    if (S.pending === 'PLAYCALL' || tray) return n && n.k === 'PLAYCALL' ? (n.side === 'D' ? 'dcall' : 'call') : S.poss === S.userIdx ? 'call' : 'dcall';
    if (S.mode === 'presnap') return 'hike';
    if (S.mode === 'qb') return 'qb';
    if (S.mode === 'carrier') return 'carrier';
    if (S.mode === 'defense') return S.phase === 'PRESNAP' ? 'go' : 'watch';
    if (S.mode === 'kick') return 'kick';
    return 'wait';
  }
  /** full instructions for the intro card */
  function introText() {
    const id = P.step.id;
    const how = { throw: [hint('hike'), hint('throw')], run: [hint('throw'), hint('steer')], handoff: [hint('hike'), hint('steer')],
      defense: [hint('go'), hint('star')], kick: [hint('fourth'), hint('kick')] }[id] || [];
    return { brief: BRIEF[id] || '', how: how };
  }
  /** the one-line pill during play ('' = hidden) */
  function text(stage) {
    const id = P.step.id;
    if (P.flash && P.flash.until > Date.now()) return P.flash.text;
    if (stage === 'hike') return pill('hike');
    if (stage === 'qb') return id === 'handoff' ? '' : pill('throw');
    if (stage === 'carrier') return pill('steer');
    if (stage === 'dcall') return 'Pick a defense';
    if (stage === 'go') return pill('go');
    if (stage === 'watch') return pill('star');
    if (stage === 'fourth') return pill('fourth');
    if (stage === 'kick') return pill('kick');
    if (stage === 'call') return 'Pick Field Goal';
    return '';
  }
  function render(force) {
    const c = card();
    if (!c || !P) return;
    const stage = P.done ? 'done' : P.intro ? 'intro' : stageOf();
    const tray = !!(UI.PlayCall && UI.PlayCall.isOpen && UI.PlayCall.isOpen());
    const g = PT.Session.game && PT.Session.game();
    let air = false;
    try { const sn = g && g.snapshot(); air = !!(sn && sn.phase === 'LIVE' && sn.ball && sn.ball.st === 'air'); } catch (e) { air = false; }
    const t = P.done ? 'Practice complete.' : P.intro ? '' : text(stage);
    const key = P.i + '|' + stage + '|' + t + '|' + tray + '|' + air + '|' + devIdx();
    if (!force && key === P.key) return;
    P.key = key;
    c.setAttribute('data-step', P.step.id);
    c.setAttribute('data-stage', stage);
    const flashOn = !!(P.flash && P.flash.until > Date.now());
    c.classList.toggle('pr-intro', !!P.intro && !P.done);
    c.classList.toggle('pr-pill', !P.intro && !P.done);
    c.classList.toggle('pr-mini', false);
    c.classList.toggle('pr-flash', flashOn);
    c.classList.toggle('pr-hide', !P.intro && !P.done && (air && !flashOn || !t));
    const dots = STEPS.map((x, i) => html`<span class="pr-dot ${i < P.i || (P.passed[i]) ? 'ok' : i === P.i ? 'on' : ''}" title="${x.name}"></span>`);
    const skip = K().btn({ label: P.i < STEPS.length - 1 ? 'Skip' : 'Finish', icon: ic('next'), action: 'pr-next', kind: 'sec', size: 's', testid: 'btn-practice-next' });
    if (P.intro && !P.done) {
      const it = introText();
      D().set(c, html`<div class="pr-top">${ic('coach') ? html`<span class="pr-emo" aria-hidden="true">${ic('coach')}</span>` : ''}<b class="pr-title">${P.i + 1}/${STEPS.length} · ${P.step.name}</b><span class="pr-dots">${dots}</span></div>
        <p class="pr-brief">${it.brief}</p>
        <ul class="pr-how">${it.how.map((h) => html`<li>${h}</li>`)}</ul>
        <div class="pr-btns">
          ${K().btn({ label: 'Start', icon: ic('play'), action: 'pr-start', kind: 'go', size: 'm', testid: 'btn-practice-start' })}
          ${skip}
          ${K().btn({ label: 'Leave', icon: ic('exit'), action: 'pr-leave', kind: 'ghost', size: 's', testid: 'btn-practice-leave' })}
        </div>`);
      return;
    }
    D().set(c, html`<span class="pr-n">${P.i + 1}/${STEPS.length}</span><p class="pr-text" aria-live="polite">${t}</p>${skip}`);
  }
  function flash(t, ms) { P.flash = { text: t, until: Date.now() + (ms || 1600) }; render(true); }

  // ---------------- situations ----------------
  /** set the ball for the current step (engine internals, see header); returns false when it can't */
  function setup() {
    const g = PT.Session.game && PT.Session.game();
    if (!g || !P) return;
    P.setupAt = 0; P.busy = true;
    PT.Session.pause({ menu: false });
    if (UI.PlayCall && UI.PlayCall.close) UI.PlayCall.close();
    const my = P;
    setTimeout(() => {
      if (P !== my || !PT.Session.active()) return;
      const G = g._G, RU = PT.Engine && PT.Engine.Rules;
      const st = P.step;
      if (G && RU && typeof RU.setPoss === 'function' && typeof g._toCall === 'function' && G.userIdx >= 0) {
        try {
          const u = G.userIdx;
          G.q = 1; G.clk = G.qLen; G.pend = 0; G.kickWait = null; G.tryTwo = false; G.patChosen = false; G.fourthDone = false;
          if (st.side === 'D') RU.setPoss(G, 1 - u, RU.ownYard(G, 1 - u, st.yd));
          else RU.setPoss(G, u, RU.ownYard(G, u, st.yd));
          if (st.side === 'K') { G.down = 4; G.togo = 5; G.fdY = G.los + 5 * G.dir; }
          g._toCall();
          if (st.play) g.callPlay(pickPlay(st.play));
          P.forced = true;
        } catch (e) {
          if (PT.Log) PT.Log.warn('practice', 'could not set the situation', e && e.message);
          P.forced = false;
        }
      } else P.forced = false;
      P.play = { snap: false, caught: false, moved: false, handed: false, superStar: false, fg: null, def: false, kickPicked: false };
      P.busy = false;
      if (!P.intro) PT.Session.resume();
      render(true);
    }, 80);
  }
  function retry(msg) {
    P.tries++;
    const max = MAX_TRIES[P.step.id] || 99;
    if (P.tries >= max) { pass('Good effort. Moving on.'); return; }
    if (msg) flash(msg, 1800);
    P.setupAt = Date.now() + 1300;
  }
  function pass(msg) {
    P.passed[P.i] = true;
    flash(msg, 1700);
    P.advanceAt = Date.now() + 1700;
  }
  function nextStep() {
    P.advanceAt = 0;
    if (P.i >= STEPS.length - 1) { finish(); return; }
    P.i++; P.step = STEPS[P.i]; P.tries = 0; P.flash = null; P.intro = true;
    P.setupAt = Date.now() + 50;
    render(true);
  }

  // ---------------- events ----------------
  function onGame(name, q) {
    if (!P || P.busy || P.done || !q) return;
    const id = P.step.id, pl = P.play || {};
    switch (name) {
      case 'snap': pl.snap = true; break;
      case 'catch': if (q.user) { pl.caught = true; if (id === 'throw') pass('Nice throw. Complete.'); } break;
      case 'handoff': pl.handed = true; break;
      case 'juke': case 'spin': case 'dive': case 'brokenTackle':
        if (q.user && id === 'run' && pl.caught && !pl.moved) { pl.moved = true; pass(name === 'brokenTackle' ? 'Broke a tackle!' : 'Nice ' + name + '!'); }
        break;
      case 'starPlay': if (q.result === 'super') { pl.superStar = true; if (id === 'defense') pass('Star Play!'); } break;
      case 'fieldGoal':
        if (id === 'kick' && q.user !== false) { pl.fg = !!q.good; if (q.good) pass('It’s good! ' + (q.yds ? q.yds + ' yards.' : '')); }
        break;
      case 'playEnd': onPlayEnd(q); break;
    }
  }
  function onPlayEnd(q) {
    const id = P.step.id, pl = P.play || {};
    if (P.passed[P.i]) return;                         // already passed: the step advances on its timer
    const r = q.result || '';
    if (id === 'throw') {
      if (pl.caught) return;
      retry(/turnover/.test(r) || (q.turnover && q.turnover.kind === 'int') ? 'Picked off. Throw to a catcher with space around him.'
        : /sack/.test(q.desc || '') || q.kind === 'sack' ? 'Sacked. Throw a little faster.' : 'Incomplete. Lead the catcher a bit.');
    } else if (id === 'run') {
      retry(pl.caught ? 'Caught. Now use a dodge move while you run.' : 'Catch it first, then dodge.');
    } else if (id === 'handoff') {
      if (pl.handed || pl.snap) pass('Nice run. ' + (q.yds ? Math.round(q.yds) + ' yards.' : ''));
      else retry('Hike it and run.');
    } else if (id === 'defense') {
      P.defPlays = (P.defPlays || 0) + 1;
      if (pl.superStar) return;
      if (P.defPlays >= 3) pass('Good defense. Watch for the green ring on every play.');
      else retry('Watch the Star’s ring. Tap when it turns GREEN.');
    } else if (id === 'kick') {
      if (pl.fg === true) return;
      retry(pl.fg === false ? 'No good. Aim between the posts.' : 'Pick Field Goal on 4th down.');
    }
  }

  function tick() {
    if (!P || P.done) return;
    if (!PT.Session.active()) return;
    const now = Date.now();
    if (P.advanceAt && now >= P.advanceAt) nextStep();
    if (P.setupAt && now >= P.setupAt && !P.busy) {
      const g = PT.Session.game();
      if (g && g.phase !== 'LIVE') setup();
    }
    render(false);
  }

  // ---------------- lifecycle ----------------
  function start(el, params) {
    const tf = teamsFor();
    let r;
    try {
      r = PT.App.tempLeague({ userTid: tf.user, oppTid: tf.opp, diff: 0, qLen: 900, wx: { k: 'sunny', wx: 0, wy: 0, mph: 2 } });
      PT.App.borrow(r.L, 'practice');
    } catch (e) {
      if (PT.Log) PT.Log.error('practice', 'start', e);
      UI.Toast.show('Practice could not start.', 'bad');
      setTimeout(() => leave(true), 0);
      return;
    }
    const pr = PT.Save.prefs();
    P = { el: el, from: params.from || (PT.App._stash && PT.App._stash.L ? 'hub' : 'title'), i: 0, step: STEPS[0], tries: 0, passed: [],
      key: '', flash: null, intro: true, setupAt: Date.now() + 200, advanceAt: 0, busy: false, done: false, play: {}, defPlays: 0,
      kickMode: pr.kickMode, devSeen: false, unsubs: [], timer: 0, gid: r.gid };
    if (pr.kickMode === 'auto') PT.Save.setPrefs({ kickMode: 'manual' });
    UI.theme(); UI.applyPrefs();
    ['snap', 'catch', 'handoff', 'juke', 'spin', 'dive', 'brokenTackle', 'starPlay', 'fieldGoal', 'playEnd']
      .forEach((n) => P.unsubs.push(PT.Events.on('game:' + n, (q) => onGame(n, q))));
    P.unsubs.push(PT.Events.on('input:device', () => { if (P) { P.devSeen = true; render(true); } }));
    P.unsubs.push(PT.Events.on('practice:leave', () => leave(false)));
    const my = P;
    let prom;
    try { prom = PT.Session.start(r.L, r.gid); } catch (e) { prom = Promise.reject(e); }
    prom.then(() => { if (P === my && !P.leaving) leave(false); }, (e) => {
      if (PT.Log) PT.Log.error('practice', 'session', e);
      if (P === my) { UI.Toast.show('Practice hit an error.', 'bad'); leave(true); }
    });
    P.timer = setInterval(tick, 120);
    render(true);
  }

  function cleanup() {
    const p = P;
    if (!p) return null;
    P = null;
    p.leaving = true;
    clearInterval(p.timer);
    p.unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    if (PT.Session.active()) PT.Session.quit({ simRest: false });
    if (p.kickMode === 'auto') PT.Save.setPrefs({ kickMode: 'auto' });
    if (PT.App.L && PT.App.L.tmp === 'practice') PT.App.restore();
    return p;
  }

  /** leave practice and go back where it came from */
  function leave(silent) {
    const p = P;
    if (!p) return;
    if (!p.done && !silent) { try { PT.Save.setPrefs({ practiceSeen: true }); } catch (e) { /* ignore */ } }
    cleanup();
    UI.theme(); UI.applyPrefs();
    const c = UI.current();
    if (c && c.name === 'practice') {
      if (!UI.back()) { if (PT.App.L) UI.reset(); else UI.replace('title'); }
    }
  }

  function finish() {
    if (!P) return;
    P.done = true;
    PT.Session.pause({ menu: false });
    if (UI.PlayCall && UI.PlayCall.close) UI.PlayCall.close();
    try { PT.Save.setPrefs({ practiceDone: true, practiceSeen: true }); } catch (e) { /* ignore */ }
    render(true);
    const hasFr = !!(PT.App._stash && PT.App._stash.L);
    const btns = [{ label: hasFr ? 'Back to My Team' : 'Back', value: 'back', kind: 'go', testid: 'btn-practice-done', icon: ic('home') }];
    if (!hasFr) btns.push({ label: 'Quick Game', value: 'quick', kind: 'sec', testid: 'btn-practice-quick', icon: ic('ball') });
    UI.Modal.open({ title: 'Practice Complete', icon: ic('trophy') || '',
      body: html`<p>You know the basics.</p><ul class="bul small"><li>The flame marks the coach’s pick.</li><li>Tap when the Star ring turns green.</li><li>Full controls are in How to Play.</li></ul>`,
      buttons: btns }).then((v) => {
      if (!P) return;
      cleanup();
      UI.theme(); UI.applyPrefs();
      if (v === 'quick') { UI.replace('quick'); return; }
      if (!UI.back()) { if (PT.App.L) UI.reset(); else UI.replace('title'); }
    });
  }

  UI.screens.practice = {
    title: 'Practice',
    chrome: 'bare',
    back: false,
    noRefresh: true,
    mount: function (el, params) {
      if (P) cleanup();
      el.innerHTML = String(html`<div class="game-host pr-host" data-testid="practice-host"><div class="pr-coach" data-testid="practice-coach" role="status"></div></div>`);
      if (PT.App.noGL) {
        UI.Toast.show('Practice needs 3D graphics.', 'bad', 2500);
        setTimeout(() => { if (!UI.back()) UI.replace('title'); }, 0);
        return;
      }
      start(el, params || {});
    },
    unmount: function () { if (P) cleanup(); },
    actions: {
      'pr-start': () => {
        if (!P || P.done || !P.intro) return;
        P.intro = false;
        if (!P.busy && PT.Session.active()) PT.Session.resume();
        render(true);
      },
      'pr-next': () => { if (!P || P.done) return; P.passed[P.i] = P.passed[P.i] || false; nextStep(); },
      'pr-leave': () => leave(false)
    }
  };

  /** test hook: where the practice is ({step, i, stage, passed}) */
  UI.practiceState = function () {
    if (!P) return null;
    return { step: P.step.id, i: P.i, stage: P.done ? 'done' : P.intro ? 'intro' : stageOf(), passed: P.passed.slice(), forced: !!P.forced, tries: P.tries, done: P.done };
  };
})(globalThis.PT = globalThis.PT || {});
