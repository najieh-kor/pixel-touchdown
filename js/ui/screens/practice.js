/* Pixel Touchdown: js/ui/screens/practice.js
 * Owner: PRACTICE (docs/handoff/PRACTICE.md). Responsibility: Practice Field: a guided tutorial on the real
 * engine/render/HUD. Steps: 1 Throw (a catch) · 2 Run & dodge (catch, then Juke/Dive) · 3 Handoff run (5+ yards) ·
 * 4 Defense (pick a call, GO, tap when the Star's ring is GREEN) · 5 Field goal (4th down → Field Goal → kick).
 *
 * Every attempt is an engine DRILL (game.setupDrill, see WP3 / PRACTICE.md): the ball on a fixed spot, fixed plays and a
 * soft defense, no clock / score / penalties / injuries, and after the whistle the engine HOLDS (no PAT, kickoff or AI
 * drive). The practice is a small state machine:
 *   intro  (card, game frozen, field already set for the step) --Start--> play
 *   play   (pill at the top) --verdict (success event / whistle)--> short settle in GAME time --> result
 *   result (card, game frozen, field already reset) --Try again--> play  |  --Next--> next step's intro  |  last → done
 * "Frozen" = PT.Session.pause({menu:false}) + trays closed; nothing ticks (play, clock, HUD) while a card is up, and a
 * resume from anywhere else (HUD pause menu, rotate) is undone while a card is shown. Verdicts are taken once per
 * attempt, so a step can't double-advance. Leaving quits the Session (no sim, no record), restores the franchise.
 * Screen 'practice' {from:'title'|'hub'|'howto'}. testids: practice-coach (data-step / data-stage / data-phase),
 * btn-practice-start, btn-practice-retry, btn-practice-next (skip / next step), btn-practice-leave, btn-practice-done,
 * btn-practice-quick. Test hook: PT.UI.practiceState().
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  // One drill per step: y = yards from the offense's own goal line. Plays / calls were picked with the headless
  // drill harness (PRACTICE.md) so a learner succeeds most of the time.
  const STEPS = [
    { id: 'throw', name: 'Throw', max: 5, drill: { side: 'O', y: 30, play: 'hitch_party', defCall: 'soft_pillow' } },
    { id: 'run', name: 'Run & dodge', max: 4, drill: { side: 'O', y: 30, play: 'bunch_screen', defCall: 'two_clouds' } },   // screen: room to run
    { id: 'handoff', name: 'Handoff run', max: 4, gain: 5, drill: { side: 'O', y: 30, play: 'up_the_gut', defCall: 'prevent' } },
    { id: 'defense', name: 'Defense', max: 4, drill: { side: 'D', y: 30, play: 'zoom_zoom',
      star: { '*': 2, wall: 3, brick_house: 3, sky3: 3, quarters: 3 } } },   // the LB who meets the sweep for that call,
    { id: 'kick', name: 'Field goal', max: 4, drill: { side: 'O', y: 80, down: 4, togo: 6 } }
  ];

  // device-specific words: [touch, mouse, kbd, pad]
  const HOW = {
    throw: [['Tap HIKE.', 'Put a finger on the {aim} side, pull BACK away from a catcher, let go. Longer pull = longer throw.'],
      ['Click HIKE (or press Space).', 'Drag BACK away from a catcher and let go. Longer drag = longer throw.'],
      ['Press Space to hike.', 'Press 1, 2, 3 or 4 to throw to that catcher.'],
      ['Press A to hike.', 'Point the right stick at a catcher, pull RT to throw.']],
    run: [['Hike and throw the short pass to the open catcher.', 'After the catch, steer with the joystick ({stick}) and tap JUKE or DIVE.'],
      ['Hike and throw to a catcher.', 'After the catch, hold the mouse to run. Click JUKE or DIVE.'],
      ['Hike (Space) and throw (1–4).', 'After the catch, steer with WASD. Q = Juke, E = Dive.'],
      ['Hike (A) and throw (RT).', 'After the catch, steer with the left stick. A = Juke, X = Dive.']],
    handoff: [['Tap HIKE. The handoff is automatic.', 'Steer with the joystick ({stick}). Gain 5 yards.'],
      ['Click HIKE. The handoff is automatic.', 'Hold the mouse button to run toward the pointer. Gain 5 yards.'],
      ['Press Space. The handoff is automatic.', 'Steer with WASD. Shift = sprint. Gain 5 yards.'],
      ['Press A. The handoff is automatic.', 'Steer with the left stick. Gain 5 yards.']],
    defense: [['Pick a defense, then tap GO.', 'Watch your Star’s gold ring. Tap TAP! when it turns GREEN.'],
      ['Pick a defense, then click GO.', 'Watch your Star’s gold ring. Click TAP! when it turns GREEN.'],
      ['Pick a defense (1–3), then press Enter.', 'Watch your Star’s gold ring. Press Space when it turns GREEN.'],
      ['Pick a defense, then press A.', 'Watch your Star’s gold ring. Press A when it turns GREEN.']],
    kick: [['It is 4th down: tap Field Goal.', 'Drag from anywhere, pull back, let go in the green.'],
      ['It is 4th down: click Field Goal.', 'Drag from anywhere, pull back, let go in the green.'],
      ['It is 4th down: press K for Field Goal.', '←/→ aim. Hold Space, let go when the bar is in the green.'],
      ['It is 4th down: pick Field Goal.', 'Left stick aims. Hold A, let go in the green.']]
  };
  const BRIEF = {
    throw: 'Complete a pass to a catcher.',
    run: 'Catch a pass, then make a dodge move.',
    handoff: 'Run the ball for 5 yards.',
    defense: 'Make a Star Play on defense.',
    kick: 'Kick a field goal.'
  };
  // one-line pill during play: [touch, mouse, kbd, pad]
  const PILL = {
    hike: ['Tap HIKE', 'Click HIKE', 'Space to hike', 'A to hike'],
    throw: ['Pull back, let go', 'Drag back, let go', 'Press 1–4 to throw', 'Aim, then RT'],
    steer: ['Steer · JUKE · DIVE', 'Steer · JUKE · DIVE', 'WASD · Q E to dodge', 'Stick · A X to dodge'],
    run: ['Steer with the stick', 'Hold the mouse to run', 'WASD to run', 'Left stick to run'],
    go: ['Tap GO', 'Click GO', 'Enter = GO', 'A = GO'],
    star: ['Tap TAP! on GREEN', 'Click TAP! on GREEN', 'Space on GREEN', 'A on GREEN'],
    fourth: ['Pick Field Goal', 'Pick Field Goal', 'K = Field Goal', 'Pick Field Goal'],
    kick: ['Pull back, let go', 'Drag back, let go', 'Hold Space, let go', 'Hold A, let go']
  };
  // the coach's verdict after a missed attempt
  const MISS = {
    throw: { inc: 'Incomplete. Throw to the catcher with the most space.', int: 'Picked off. Throw away from defenders.', sack: 'Sacked. Throw a bit sooner.', none: 'Throw it to a catcher.' },
    run: { nocatch: 'Catch it first, then dodge.', nomove: 'Caught! Now tap JUKE or DIVE while you run.', quick: 'Tackled right away. Throw to the open catcher, then dodge.' },
    handoff: { short: 'Short of 5 yards. Look for a gap.', none: 'Hike it and run.' },
    defense: { whiff: 'Too early. Wait for the GREEN ring.', none: 'No Star Play. Tap TAP! the moment the ring turns GREEN.' },
    kick: { miss: 'No good. Aim between the posts.', short: 'Too short. Pull back further.', wide: 'Wide. Aim between the posts.', wrong: 'On 4th down, pick Field Goal.' }
  };
  const SETTLE = 0.9;              // game seconds the play runs on after a verdict before the card (or the whistle)

  let P = null;                    // the running practice
  /** pixel icon from PT.UI.Icons when the art pack is loaded (no emoji: plain words carry the meaning) */
  const ic = (n) => (UI.Icons && UI.Icons.get ? UI.Icons.get(n) : null) || undefined;
  const game = () => (PT.Session.game ? PT.Session.game() : null);
  const drillOf = (g) => { try { return g && g.drill ? g.drill() : null; } catch (e) { return null; } };

  function devIdx() {
    const d = PT.Input && PT.Input.lastDevice;
    if (P && !P.devSeen && (d === 'kbd' || !d)) {        // nothing pressed yet: guess from the screen
      const n = globalThis.navigator;
      const coarse = (globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches) || (n && n.maxTouchPoints > 0) || 'ontouchstart' in globalThis;
      return coarse ? 0 : 1;
    }
    return d === 'touch' ? 0 : d === 'mouse' ? 1 : d === 'pad' ? 3 : 2;
  }
  const pill = (k) => PILL[k][devIdx()];
  /** Left-handed mode (html[data-lefty="1"], Input lefty) mirrors the stick to the right and the aim zone to the left */
  function lefty() {
    const de = globalThis.document && globalThis.document.documentElement;
    if (de && de.getAttribute('data-lefty') != null) return de.getAttribute('data-lefty') === '1';
    try { return !!(PT.Input && PT.Input.options && PT.Input.options().lefty); } catch (e) { return false; }
  }
  /** the HUD's throw hint for the player's own setting (Easy Throw / Point / slingshot); null when the HUD has none */
  function hudThrow() {
    try { const H = UI.Hud; return H && typeof H.throwHint === 'function' ? H.throwHint() || null : null; } catch (e) { return null; }
  }
  /** touch / mouse: the throw line follows the player's aim setting (feature-detected), keys / pad keep their own */
  function throwLine(dflt) {
    const d = devIdx(), t = d <= 1 ? hudThrow() : null;
    return t && !/^Pull back/i.test(t) ? t : dflt;        // the slingshot default keeps the fuller coaching line
  }
  const sided = (t) => String(t).replace('{aim}', lefty() ? 'left' : 'right').replace('{stick}', lefty() ? 'bottom-right' : 'bottom-left');

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

  /** the step's drill config; a play id the playbook doesn't know falls back to a plain play of that kind */
  function drillCfg(step) {
    const d = Object.assign({}, step.drill), PB = PT.Data.Playbook, DD = PT.Data.Defense;
    if (d.play && PB && PB.byId && !PB.byId(d.play)) {
      const want = step.id === 'handoff' || step.id === 'defense' ? 'run' : 'pass';
      const p = (PB.list || []).find((x) => x.k === want && !x.sneak && !x.option && !x.reverse && !x.flea && !x.hail && !x.draw && !x.clock);
      d.play = p ? p.id : undefined;
    }
    if (d.defCall && DD && DD.byId && !DD.byId(d.defCall)) delete d.defCall;
    return d;
  }

  // ---------------- freeze / unfreeze ----------------
  function docCls(on) {
    const de = globalThis.document && globalThis.document.documentElement;
    if (de) de.classList.toggle('pt-pr-card', !!on);
  }
  /** html.pt-practice for the whole session: css/practice.css hides the full-game HUD extras (Skip Drive, Timeout, Audible, Auto kick…) */
  function sessCls(on) {
    const de = globalThis.document && globalThis.document.documentElement;
    if (de) de.classList.toggle('pt-practice', !!on);
  }
  /** stop everything: no ticks (play, clock, AI), trays closed, slow-mo off, input edges dropped */
  function freeze() {
    if (!P) return;
    P.frozen = true;
    docCls(true);
    const PC = UI.PlayCall;
    if (PC && PC.close) PC.close();
    if (PT.Session.active() && !PT.Session.isPaused()) PT.Session.pause({ menu: false });
    if (PT.Loop && PT.Loop.slowmo) PT.Loop.slowmo(1, 0);
    if (PT.Input && PT.Input.flush) PT.Input.flush();
    if (PT.Input && PT.Input.resetPointers) PT.Input.resetPointers();   // a finger held through a skip can't stick
  }
  function unfreeze() {
    if (!P) return;
    P.frozen = false;
    docCls(false);
    if (PT.Session.active() && PT.Session.isPaused()) PT.Session.resume();
  }
  /** a resume from elsewhere (HUD pause menu Resume, rotate back) while a card is up → freeze again */
  function onPauseEvt(e) {
    if (!P || !P.frozen || !e || e.on !== false) return;
    if (PT.Session.active() && !PT.Session.isPaused()) PT.Session.pause({ menu: false });
  }

  /** (frozen) set the field for the current step, then cb(). Trays are closed first and their promises settle. */
  function prepare(cb) {
    const my = P;
    P.busy = true; P.att = null;
    freeze();
    setTimeout(() => {
      if (P !== my || !PT.Session.active()) return;
      const g = game();
      let ok = false;
      try { ok = !!(g && typeof g.setupDrill === 'function' && g.setupDrill(drillCfg(P.step))); }
      catch (e) { if (PT.Log) PT.Log.warn('practice', 'setupDrill failed', e && e.message); ok = false; }
      if (!ok) {
        if (UI.Toast) UI.Toast.show('Practice could not set up the drill.', 'bad');
        leave(true);
        return;
      }
      P.busy = false;
      cb();
      if (P === my && P.queued) { const q = P.queued; P.queued = null; if (act[q]) act[q](); }   // a tap made while setting up
    }, 60);
  }

  // ---------------- step flow ----------------
  function showIntro() {
    P.phase = 'intro'; P.res = null;
    render(true);
    prepare(() => render(true));
  }
  function beginAttempt() {
    const g = game(), s = g && g.snapshot();
    P.att = { caught: false, handed: false, moved: false, whiff: false, out: null, endAt: 0,
      los: s ? s.los : 0, dir: s && s.dir ? s.dir : 1, uIdx: (PT.Session.state() || {}).userIdx };
    P.phase = 'play'; P.flash = null;
    unfreeze();
    render(true);
  }
  /** the attempt's verdict (once). ok + msg; the card comes after `settle` game seconds or at the whistle. */
  function verdict(ok, msg, settle) {
    const a = P && P.att;
    if (!a || a.out || P.phase !== 'play') return;
    const d = drillOf(game());
    a.out = { ok: !!ok, msg: msg };
    a.endAt = (d ? d.t : 0) + (settle == null ? SETTLE : settle);
    if (ok) flash(msg);
  }
  function endAttempt() {
    const a = P.att;
    freeze();
    P.tries++;
    const ok = a.out.ok;
    if (ok) P.passed[P.i] = true;
    P.res = { ok: ok, msg: a.out.msg, last: !ok && P.tries >= (P.step.max || 4) };
    P.phase = 'result';
    render(true);
    prepare(() => render(true));        // the field is reset for "Try again" while the card is up
  }
  function nextStep() {
    if (P.i >= STEPS.length - 1) { finish(); return; }
    P.i++; P.step = STEPS[P.i]; P.tries = 0; P.flash = null; P.queued = null;
    showIntro();
  }
  function flash(t, ms) { P.flash = { text: t, until: Date.now() + (ms || 1600) }; render(true); }

  // ---------------- engine events → verdicts ----------------
  function onGame(name, q) {
    if (!P || P.phase !== 'play' || !P.att || !q) return;
    const id = P.step.id, a = P.att;
    switch (name) {
      case 'catch':
        if (q.ret) break;
        if (q.user && !q.int) {
          a.caught = true;
          if (id === 'throw') verdict(true, 'Nice throw! Complete.', 1.0);
          else if (id === 'run') { a.catchT = (drillOf(game()) || {}).t || 0; flash('Caught it! Now dodge.', 1400); }
        }
        break;
      case 'handoff': a.handed = true; break;
      case 'juke': case 'spin': case 'dive': case 'brokenTackle':
        if (q.user && id === 'run' && a.caught && !a.moved) {
          a.moved = true;
          verdict(true, name === 'brokenTackle' ? 'Broke a tackle!' : 'Nice ' + name + '!', 0.8);
        }
        break;
      case 'starPlay':
        if (id !== 'defense') break;
        if (q.result === 'super') verdict(true, 'Star Play!', 1.0);
        else if (q.result === 'whiff') { a.whiff = true; flash('Too early!', 1200); }
        break;
      case 'ability':
        if (id === 'defense' && (q.user || q.tid === (PT.Session.state() || {}).userTid) && q.perfect) verdict(true, 'Perfect Surge!', 1.0);
        break;
      case 'fieldGoal':
        if (id === 'kick' && q.user !== false) {
          // HUNT5-practice: say WHY it missed — the kick's power vs the power the distance needed (Session input:action)
          const lk = P && P.lastKick;
          const why = !q.good && lk ? (lk.minPow > 0 && lk.pow < lk.minPow ? MISS.kick.short : MISS.kick.wide) : MISS.kick.miss;
          verdict(!!q.good, q.good ? 'It’s good! ' + (q.yds ? q.yds + ' yards.' : '') : why, q.good ? 1.2 : 0.9);
        }
        break;
      case 'punt':
        if (id === 'kick') verdict(false, MISS.kick.wrong, 0);
        break;
      case 'playEnd': onPlayEnd(q); break;
    }
  }
  function onPlayEnd(q) {
    const id = P.step.id, a = P.att;
    if (a.out) return;
    const r = q.result || '', kind = q.kind || '';
    if (id === 'throw') {
      const int = (q.turnover && (q.turnover === 'int' || q.turnover.kind === 'int')) || /int/.test(r);
      verdict(false, int ? MISS.throw.int : kind === 'sack' || /sack/i.test(q.desc || '') ? MISS.throw.sack : a.caught ? 'Complete!' : MISS.throw.inc);
    } else if (id === 'run') {
      const quick = a.caught && a.catchT != null && ((drillOf(game()) || {}).t || 0) - a.catchT < 1.0;
      verdict(false, !a.caught ? MISS.run.nocatch : quick ? MISS.run.quick : MISS.run.nomove);
    }
    else if (id === 'handoff') {
      const yds = q.yds != null ? q.yds : 0;
      if (yds >= (P.step.gain || 5) || r === 'td') verdict(true, 'Nice run! ' + Math.round(yds) + ' yards.');
      else verdict(false, MISS.handoff.short);
    } else if (id === 'defense') verdict(false, a.whiff ? MISS.defense.whiff : MISS.defense.none);
    else if (id === 'kick') verdict(false, MISS.kick.wrong);
  }

  /** polled checks that have no event: 5 yards on the handoff, a wrong 4th-down choice */
  function poll(g) {
    const id = P.step.id, a = P.att;
    if (!a || a.out) return;
    if (id === 'handoff') {
      const s = g.snapshot(), b = s.ball;
      const car = b && b.st === 'held' ? s.ents.find((e) => e.ball) : null;
      if (car && car.tm === a.uIdx && car.pos !== 'QB' && (b.y - a.los) * a.dir >= (P.step.gain || 5)) verdict(true, 'Nice run! 5+ yards.', 0.9);
    } else if (id === 'kick') {
      const n = g.needs ? g.needs() : null;
      if (n && n.k === 'PLAYCALL' && n.side === 'O') verdict(false, MISS.kick.wrong, 0);
    }
  }

  function tick() {
    if (!P || P.done) return;
    if (!PT.Session.active()) return;
    if (P.phase === 'play' && P.att && !P.busy) {
      const g = game(), d = drillOf(g);
      if (g && d) {
        poll(g);
        const a = P.att;
        if (a.out && (d.hold || d.t >= a.endAt)) { endAttempt(); return; }
        if (!a.out && d.hold) { onPlayEnd({}); if (P.att && P.att.out) { endAttempt(); return; } }
      }
    }
    render(false);
  }

  // ---------------- coach card ----------------
  function card() { return P && P.el ? P.el.querySelector('[data-testid="practice-coach"]') : null; }
  function stageOf() {
    const S = PT.Session.state ? PT.Session.state() : null;
    if (!S) return 'wait';
    const g = game();
    const n = g && g.needs ? g.needs() : null;
    const tray = UI.PlayCall && UI.PlayCall.isOpen && UI.PlayCall.isOpen();
    if (S.pending === 'FOURTH' || (n && n.k === 'FOURTH')) return 'fourth';
    if (S.pending === 'PLAYCALL' || tray || (n && n.k === 'PLAYCALL')) return n && n.side === 'D' ? 'dcall' : 'call';
    if (S.mode === 'presnap') return 'hike';
    if (S.mode === 'qb') return 'qb';
    if (S.mode === 'carrier') return 'carrier';
    if (S.mode === 'defense') return S.phase === 'PRESNAP' ? 'go' : 'watch';
    if (S.mode === 'kick') return 'kick';
    return 'wait';
  }
  function text(stage) {
    const id = P.step.id;
    if (P.flash && P.flash.until > Date.now()) return P.flash.text;
    if (stage === 'hike') return pill('hike');
    if (stage === 'qb') return id === 'handoff' ? '' : (devIdx() <= 1 && hudThrow()) || pill('throw');
    if (stage === 'carrier') return id === 'handoff' || id === 'throw' ? pill('run') : pill('steer');
    if (stage === 'dcall' || stage === 'call') return '';          // the tray is the instruction
    if (stage === 'go') return pill('go');
    if (stage === 'watch') return pill('star');
    if (stage === 'fourth') return pill('fourth');
    if (stage === 'kick') return pill('kick');
    return '';
  }
  function stageNow() { return !P ? 'wait' : P.done ? 'done' : P.phase === 'play' ? stageOf() : P.phase; }

  function render(force) {
    const c = card();
    if (!c || !P) return;
    const stage = stageNow();
    const g = game();
    let air = false;
    try { const sn = g && g.snapshot(); air = !!(sn && sn.phase === 'LIVE' && sn.ball && sn.ball.st === 'air'); } catch (e) { air = false; }
    const t = P.phase === 'play' ? text(stage) : '';
    const key = P.i + '|' + P.phase + '|' + stage + '|' + t + '|' + air + '|' + devIdx() + '|' + lefty() + '|' + P.tries + '|' + !!P.busy;
    if (!force && key === P.key) return;
    P.key = key;
    c.setAttribute('data-step', P.step.id);
    c.setAttribute('data-stage', stage);
    c.setAttribute('data-phase', P.done ? 'done' : P.phase);
    const isCard = !P.done && (P.phase === 'intro' || P.phase === 'result');
    const flashOn = !!(P.flash && P.flash.until > Date.now());
    c.classList.toggle('pr-intro', isCard);
    c.classList.toggle('pr-pill', !isCard && !P.done);
    c.classList.toggle('pr-flash', flashOn && !isCard);
    c.classList.toggle('pr-ok', P.phase === 'result' && !!(P.res && P.res.ok));
    const trayUp = stage === 'dcall' || stage === 'call' || stage === 'fourth';     // keep Skip reachable over a tray
    c.classList.toggle('pr-hide', P.done || (!isCard && ((air && !flashOn) || (!t && !trayUp))));
    const dots = STEPS.map((x, i) => html`<span class="pr-dot ${P.passed[i] ? 'ok' : i === P.i ? 'on' : i < P.i ? 'skip' : ''}" title="${x.name}"></span>`);
    const head = html`<div class="pr-top">${ic('whistle') ? html`<span class="pr-emo" aria-hidden="true">${ic('whistle')}</span>` : ''}<b class="pr-title">${P.i + 1}/${STEPS.length} · ${P.step.name}</b><span class="pr-dots">${dots}</span></div>`;
    const leaveBtn = K().btn({ label: 'Leave', icon: ic('exit'), action: 'pr-leave', kind: 'ghost', size: 's', testid: 'btn-practice-leave' });
    const lastStep = P.i >= STEPS.length - 1;
    if (P.phase === 'intro' && !P.done) {
      const how = ((HOW[P.step.id] || [])[devIdx()] || []).map((h, i) => (P.step.id === 'throw' && i === 1 ? throwLine(h) : h));
      D().set(c, html`${head}
        <p class="pr-brief">${BRIEF[P.step.id] || ''}</p>
        <ol class="pr-how">${how.map((h) => html`<li>${sided(h)}</li>`)}</ol>
        <div class="pr-btns">
          ${leaveBtn}
          ${K().btn({ label: 'Skip', icon: ic('ff'), action: 'pr-next', kind: 'sec', size: 's', testid: 'btn-practice-next' })}
          ${K().btn({ label: 'Start', icon: ic('play'), action: 'pr-start', kind: 'go', size: 'm', testid: 'btn-practice-start' })}
        </div>`);
      return;
    }
    if (P.phase === 'result' && !P.done) {
      const r = P.res || {};
      const title = r.ok ? 'Got it!' : r.last ? 'Nice try' : 'Try again';
      const sub = r.ok ? (lastStep ? 'That’s the last drill.' : 'On to the next drill.') : r.last ? 'Let’s move on to the next drill.' : 'Try ' + (P.tries + 1) + ' of ' + (P.step.max || 4) + '.';
      const btns = r.ok || r.last
        ? html`${K().btn({ label: 'Again', icon: ic('replay') || ic('back'), action: 'pr-retry', kind: 'sec', size: 's', testid: 'btn-practice-retry' })}
            ${K().btn({ label: lastStep ? 'Finish' : 'Next', icon: ic('next'), action: 'pr-next', kind: 'go', size: 'm', testid: 'btn-practice-next' })}`
        : html`${K().btn({ label: 'Skip', icon: ic('ff'), action: 'pr-next', kind: 'sec', size: 's', testid: 'btn-practice-next' })}
            ${K().btn({ label: 'Try again', icon: ic('replay') || ic('play'), action: 'pr-retry', kind: 'go', size: 'm', testid: 'btn-practice-retry' })}`;
      D().set(c, html`${head}
        <p class="pr-brief pr-res ${r.ok ? 'pr-good' : 'pr-bad'}" data-testid="practice-result" data-ok="${r.ok ? '1' : '0'}">${title}</p>
        <p class="pr-text">${r.msg || ''} <span class="pr-sub">${sub}</span></p>
        <div class="pr-btns">${leaveBtn}${btns}</div>`);
      return;
    }
    if (P.done) { D().set(c, ''); return; }
    const tryN = P.tries > 0 ? html`<span class="pr-try">${P.tries + 1}/${P.step.max || 4}</span>` : '';      // only from the 2nd try
    D().set(c, html`<p class="pr-text" aria-live="polite">${t}</p>${tryN}${K().btn({ label: 'Skip', icon: ic('ff'), action: 'pr-next', kind: 'sec', size: 's', testid: 'btn-practice-next' })}`);
  }

  /**
   * Keys while a card is up (capture phase, before the HUD sees them): Enter / Space = the card's main button; Esc and
   * the game keys are swallowed so they can't hike, GO or open the pause menu under the card.
   */
  function onKeyCap(ev) {
    if (!P || P.done || !(P.phase === 'intro' || P.phase === 'result' || P.phase === 'setup')) return;
    if (UI.Modal && UI.Modal.isOpen && UI.Modal.isOpen()) return;
    if (UI.Hud && UI.Hud.paused && UI.Hud.paused()) return;
    const k = ev.key;
    if (k === 'Tab') return;
    ev.preventDefault(); ev.stopPropagation();
    if (ev.repeat || P.busy) return;
    if (k !== 'Enter' && k !== ' ' && k !== 'Spacebar') return;
    P.devSeen = true;
    if (P.phase === 'intro') act.start();
    else if (P.phase === 'result') { if (P.res && (P.res.ok || P.res.last)) act.next(); else act.retry(); }
  }

  // ---------------- lifecycle ----------------
  function start(el, params) {
    const tf = teamsFor();
    let r;
    try {
      r = PT.App.tempLeague({ userTid: tf.user, oppTid: tf.opp, diff: 0, seed: 4242, qLen: 180,   // drills freeze the clock; the scorebug shows PRACTICE (css/practice.css)
        wx: { k: 'sunny', wx: 0, wy: 0, mph: 0 } });
      PT.App.borrow(r.L, 'practice');
    } catch (e) {
      if (PT.Log) PT.Log.error('practice', 'start', e);
      UI.Toast.show('Practice could not start.', 'bad');
      setTimeout(() => leave(true), 0);
      return;
    }
    const pr = PT.Save.prefs();
    P = { el: el, from: params.from || (PT.App._stash && PT.App._stash.L ? 'hub' : 'title'), i: 0, step: STEPS[0], tries: 0, passed: [],
      key: '', flash: null, phase: 'intro', res: null, att: null, busy: false, queued: null, done: false, frozen: false,
      kickMode: pr.kickMode, devSeen: false, unsubs: [], timer: 0, gid: r.gid };
    if (pr.kickMode === 'auto') PT.Save.setPrefs({ kickMode: 'manual' });
    UI.theme(); UI.applyPrefs();
    sessCls(true);
    ['catch', 'handoff', 'juke', 'spin', 'dive', 'brokenTackle', 'starPlay', 'ability', 'fieldGoal', 'punt', 'playEnd']
      .forEach((n) => P.unsubs.push(PT.Events.on('game:' + n, (q) => onGame(n, q))));
    P.unsubs.push(PT.Events.on('game:pause', onPauseEvt));
    P.unsubs.push(PT.Events.on('input:action', (a) => {        // remember the manual kick's power for the miss verdict
      if (!P || !a || a.k !== 'kick') return;
      const g = game(), sk = g && g.snapshot ? g.snapshot().kick : null;
      P.lastKick = { pow: +a.pow || 0, minPow: sk && sk.minPow != null ? sk.minPow : 0 };
    }));
    P.unsubs.push(PT.Events.on('input:device', () => { if (P) { P.devSeen = true; render(true); } }));
    P.unsubs.push(PT.Events.on('practice:leave', () => leave(false)));
    const doc = globalThis.document;
    if (doc) { doc.addEventListener('keydown', onKeyCap, true); P.unsubs.push(() => doc.removeEventListener('keydown', onKeyCap, true)); }
    const my = P;
    let prom;
    try { prom = PT.Session.start(r.L, r.gid); } catch (e) { prom = Promise.reject(e); }
    prom.then(() => { if (P === my && !P.leaving) leave(false); }, (e) => {
      if (PT.Log) PT.Log.error('practice', 'session', e);
      if (P === my) { UI.Toast.show('Practice hit an error.', 'bad'); leave(true); }
    });
    if (!PT.Session.active()) return;
    const g = game();
    if (!g || typeof g.setupDrill !== 'function') {          // engine stub / old engine: no drills
      UI.Toast.show('Practice needs the full game engine.', 'bad');
      setTimeout(() => leave(true), 0);
      return;
    }
    // the HUD keeps the last game's aim options until the Session's first setControls; prime it with this session's
    // settings so the intro's throw line (Hud.throwHint) matches before the first snap (HUD should reset on show)
    try {
      const st = (PT.App.L && PT.App.L.settings) || {};
      if (UI.Hud && typeof UI.Hud.setControls === 'function') UI.Hud.setControls('none', { easyThrow: !!st.easyThrow, aimMode: st.aimMode || 'sling' });
    } catch (e) { /* optional */ }
    P.timer = setInterval(tick, 100);
    showIntro();
  }

  function cleanup() {
    const p = P;
    if (!p) return null;
    P = null;
    p.leaving = true;
    clearInterval(p.timer);
    p.unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    docCls(false); sessCls(false);
    if (UI.PlayCall && UI.PlayCall.close) UI.PlayCall.close();
    if (PT.Session.active()) PT.Session.quit({ simRest: false });
    if (p.kickMode === 'auto') PT.Save.setPrefs({ kickMode: 'auto' });
    if (PT.App.L && PT.App.L.tmp === 'practice') PT.App.restore();
    return p;
  }

  function goBack() {
    UI.theme(); UI.applyPrefs();
    const c = UI.current();
    if (c && c.name === 'practice') {
      if (!UI.back()) { if (PT.App.L) UI.reset(); else UI.replace('title'); }
    }
  }

  /** leave practice and go back where it came from */
  function leave(silent) {
    const p = P;
    if (!p) return;
    if (!p.done && !silent) { try { PT.Save.setPrefs({ practiceSeen: true }); } catch (e) { /* ignore */ } }
    cleanup();
    goBack();
  }

  function finish() {
    if (!P || P.done) return;
    freeze();
    P.done = true; P.phase = 'done';
    try { PT.Save.setPrefs({ practiceDone: true, practiceSeen: true }); } catch (e) { /* ignore */ }
    render(true);
    const hasFr = !!(PT.App._stash && PT.App._stash.L);
    const btns = [{ label: hasFr ? 'Back to My Team' : 'Back', value: 'back', kind: 'go', testid: 'btn-practice-done', icon: ic('home') }];
    let anySave = false;
    try { const m = PT.Save.meta && PT.Save.meta(); anySave = !!(m && m.slots && Object.keys(m.slots).some((k) => { const x = m.slots[k]; return !!(x && (x.main || x.auto)); })); } catch (e) { anySave = false; }
    if (!hasFr && !anySave) btns.unshift({ label: 'New Game', value: 'new', kind: 'go', testid: 'btn-practice-new', icon: ic('sparkle') });
    if (!hasFr) btns.push({ label: 'Quick Game', value: 'quick', kind: 'sec', testid: 'btn-practice-quick', icon: ic('ball') });
    if (!hasFr && !anySave) btns[1].kind = 'sec';
    const n = P.passed.filter(Boolean).length;
    const my = P;
    UI.Modal.open({ title: 'Practice Complete', icon: ic('trophy') || '', dismiss: false,   // a stray tap must not drop the player out
      body: html`<p>${n === STEPS.length ? 'All ' + n + ' drills passed!' : n + ' of ' + STEPS.length + ' drills passed.'} ${n >= 3 ? 'You know the basics.' : 'Come back any time.'}</p><ul class="bul small"><li>On defense, tap when your Star’s ring turns green.</li><li>When SURGE is full, tap it to power up your Stars.</li><li>Full controls are in How to Play.</li></ul>`,
      buttons: btns }).then((v) => {
      if (P !== my) return;
      cleanup();
      if (v === 'quick') { UI.theme(); UI.applyPrefs(); UI.replace('quick'); return; }
      if (v === 'new') { UI.theme(); UI.applyPrefs(); UI.replace('title'); UI.go('slots', { mode: 'new' }); return; }
      goBack();
    });
  }

  // card buttons (guarded by phase + busy: a double tap can't advance twice)
  // (a tap while the field is being set up is queued and runs right after: never lost, never doubled)
  const busyQ = (name) => { if (P && P.busy) { P.queued = name; return true; } return false; };
  const act = {
    start: () => { if (!P || P.done || busyQ('start') || P.phase !== 'intro') return; beginAttempt(); },
    retry: () => {
      if (!P || P.done || busyQ('retry') || P.phase !== 'result') return;
      beginAttempt();                   // endAttempt already set the field
    },
    next: () => {
      if (!P || P.done || busyQ('next') || !(P.phase === 'intro' || P.phase === 'result' || P.phase === 'play')) return;
      if (P.phase === 'play') freeze();
      nextStep();
    }
  };

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
      'pr-start': () => act.start(),
      'pr-retry': () => act.retry(),
      'pr-next': () => act.next(),
      'pr-leave': () => leave(false)
    }
  };

  /** test hook: where the practice is */
  UI.practiceState = function () {
    if (!P) return null;
    const d = drillOf(game());
    return { step: P.step.id, i: P.i, phase: P.done ? 'done' : P.phase, stage: stageNow(), passed: P.passed.slice(), tries: P.tries,
      done: P.done, frozen: !!P.frozen, busy: !!P.busy, res: P.res ? Object.assign({}, P.res) : null, verdict: P.att && P.att.out ? Object.assign({}, P.att.out) : null,
      hold: !!(d && d.hold), forced: !!d };
  };
  /** test hook: the step list */
  UI.practiceSteps = () => STEPS.map((s) => ({ id: s.id, name: s.name, max: s.max }));
})(globalThis.PT = globalThis.PT || {});
