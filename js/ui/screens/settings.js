/* Pixel Touchdown: js/ui/screens/settings.js
 * Owner: WP5. Responsibility: sound, music, quality, controls help, delete data (design 18.3 Settings).
 * Device prefs (PT.Save.prefs): sfx, music, haptics, quality, reduceMotion, textSize.
 * League settings (L.settings, R8): qLen, penalties, aimMode, easyThrow, autoDef, watch, autoKick, lefty, autoLineup;
 * difficulty only in the Preseason. testids: set-{key}, set-{key}-{value}, btn-save, btn-quit-title, btn-controls, btn-credits.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function prefs() { try { return (PT.Save && PT.Save.prefs && PT.Save.prefs()) || {}; } catch (e) { return {}; } }
  function setPref(o) {
    try { if (PT.Save && PT.Save.setPrefs) PT.Save.setPrefs(o); } catch (e) { /* ignore */ }
    const p = prefs();
    try { if (PT.Audio && PT.Audio.setVolumes && ('sfx' in o || 'music' in o)) PT.Audio.setVolumes({ sfx: p.sfx, music: p.music }); } catch (e) { /* ignore */ }
    try { if ('quality' in o && PT.Render && PT.Render.setQuality) PT.Render.setQuality(o.quality); } catch (e) { /* ignore */ }
    try { if ('speed' in o && PT.Session && typeof PT.Session.setSpeed === 'function') PT.Session.setSpeed(o.speed); } catch (e) { /* ignore */ }
    UI.applyPrefs();
  }
  /** adapter: league settings (feature-detect a League/App setter) */
  UI.adapt = UI.adapt || {};
  UI.adapt.setSetting = function (k, v) {
    const L = PT.App && PT.App.L;
    if (!L) return;
    const fn = (PT.App.setSettings && !PT.App.setSettings.__stub && PT.App.setSettings) || (PT.League.setSettings && !PT.League.setSettings.__stub && PT.League.setSettings);
    if (fn) { fn === PT.App.setSettings ? fn({ [k]: v }) : fn(L, { [k]: v }); }
    else { L.settings = Object.assign({}, L.settings, { [k]: v }); if (PT.Events) PT.Events.emit('league:changed', { what: 'settings' }); }
    UI.applyPrefs();
  };

  function toggle(key, on, label, sub, scope) {
    return html`<div class="set-row"><div class="grow"><b>${label}</b>${sub ? html`<div class="tiny muted">${sub}</div>` : ''}</div>
      <button type="button" class="toggle ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}" data-action="tog" data-k="${key}" data-scope="${scope}" data-testid="set-${key}"></button></div>`;
  }
  function seg(key, cur, opts, label, scope, disabled) {
    return html`<div class="set-row col-row"><b>${label}</b><div class="seg" role="radiogroup" aria-label="${label}">${opts.map((o) => html`<button type="button" class="btn btn-sec btn-s ${String(cur) === String(o[0]) ? 'on' : ''}" role="radio" aria-checked="${String(cur) === String(o[0]) ? 'true' : 'false'}" data-action="seg" data-k="${key}" data-v="${o[0]}" data-scope="${scope}" data-testid="set-${key}-${o[0]}" ${disabled ? D().raw('disabled') : ''}>${o[1]}</button>`)}</div></div>`;
  }
  function slider(key, v, label, icon) {
    return html`<div class="set-row"><span class="set-ic">${K().ic(icon)}</span><div class="grow"><b>${label}</b><input class="rng" type="range" min="0" max="100" step="5" value="${Math.round((v == null ? 0.7 : v) * 100)}" data-k="${key}" data-testid="set-${key}" aria-label="${label}"></div><b class="num set-v">${Math.round((v == null ? 0.7 : v) * 100)}</b></div>`;
  }

  /**
   * ROUND6 E: the in-game pace controls live in Settings only (the pause menu opens the same rows via UI.gameSettings).
   * Game speed = prefs.speed (Session.setSpeed); Defense speed = L.settings.watch; Auto-start defense = L.settings.autoDef
   * (the coach calls the defense and starts the play; default OFF).
   */
  function gameplayRows(p, s, hasL) {
    return html`${seg('speed', p.speed || 0.8, [[0.7, 'Relaxed'], [0.8, 'Normal'], [1, 'Fast']], 'Game speed', 'P')}
      ${hasL ? seg('watch', s.watch && s.watch !== 3 ? s.watch : 0.8, [[0.8, '0.8×'], [1, '1×'], [1.5, '1.5×']], 'Defense speed', 'L') : ''}
      ${hasL ? toggle('autoDef', !!s.autoDef, 'Auto-start defense', 'The coach calls the defense and starts the play', 'L') : ''}`;
  }
  /** pause-menu entry point: the same Gameplay rows in a modal (works mid-game, no screen change) */
  UI.gameSettings = function () {
    const L = PT.App && PT.App.L;
    return UI.Modal.open({ title: 'Settings', icon: 'gear', cls: 'm-settings',
      body: html`<div class="set-modal">${gameplayRows(prefs(), (L && L.settings) || {}, !!L)}</div>`,
      actions: {
        seg: (el, card) => { applySeg(el); D().$$('[data-k="' + el.getAttribute('data-k') + '"]', card).forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); },
        tog: (el) => applyTog(el)
      },
      buttons: [{ label: 'Done', value: true, kind: 'go', testid: 'btn-settings-done' }] });
  };
  function applyTog(el) {
    const k = el.getAttribute('data-k'), on = !el.classList.contains('on');
    if (el.getAttribute('data-scope') === 'P') setPref({ [k]: on }); else UI.adapt.setSetting(k, on);
    el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on));
    if (k === 'autoDef') { try { if (PT.Session && PT.Session.setAutoDef) PT.Session.setAutoDef(on); } catch (e) { /* ignore */ } }
  }
  function applySeg(el) {
    const k = el.getAttribute('data-k'); let v = el.getAttribute('data-v');
    if (!isNaN(+v)) v = +v;
    if (k === 'quality') { const was = prefs().quality; if ((was === 'low' && v !== 'low') || (was === 'med' && v === 'high')) qNote = true; else if (v === 'low') qNote = false; }
    if (el.getAttribute('data-scope') === 'P') setPref({ [k]: v });
    else if (k === 'diff') { const L = PT.App.L; const fn = PT.League.setDifficulty; if (fn && !fn.__stub) fn(L, v); else { L.diff = v; if (PT.Events) PT.Events.emit('league:changed', { what: 'diff' }); } }
    else UI.adapt.setSetting(k, v);
    if (k === 'watch') { try { if (PT.Session && PT.Session.setWatchSpeed) PT.Session.setWatchSpeed(v); } catch (e) { /* ignore */ } }
  }
  let qNote = false;   // set after stepping up from Fast in this session (the lower-res buffers stay until a reload)
  /** ROUND6 "0 scrolling": Settings is split into tabs; each tab is two short columns */
  const SET = { tab: 'sound' };
  function mount(el, params) {
    if (params && params.tab) { SET.tab = params.tab; params.tab = null; }
    const p = prefs();
    const L = PT.App && PT.App.L;
    const s = (L && L.settings) || {};
    const tabs = [{ id: 'sound', label: 'Sound', icon: 'speaker' }, { id: 'play', label: 'Controls', icon: 'football' }].concat(L ? [{ id: 'rules', label: 'Rules', icon: 'clock' }] : []).concat([{ id: 'save', label: 'Save', icon: 'save' }]);
    if (!tabs.some((x) => x.id === SET.tab)) SET.tab = 'sound';
    const col = (inner, cls) => html`<section class="card setx-col ${cls || ''}">${inner}</section>`;
    let cols;
    if (SET.tab === 'play') {
      cols = html`${col(gameplayRows(p, s, !!L), 'set-gameplay')}
        ${col(L ? html`${seg('aimMode', s.aimMode || 'sling', [['sling', 'Slingshot'], ['point', 'Point']], 'Aim style', 'L')}
          ${toggle('easyThrow', s.easyThrow, 'Easy Throw', 'Tap numbered badges to throw', 'L')}
          ${toggle('autoKick', s.autoKick, 'Auto Kick', 'Kicks are automatic', 'L')}
          ${toggle('lefty', s.lefty, 'Left-handed', 'Swap the joystick and buttons', 'L')}` : html`<p class="small muted">More controls show up once a franchise is loaded.</p>
          ${K().btn({ label: 'How to Play', icon: 'question', action: 'controls', kind: 'sec', testid: 'btn-controls', cls: 'btn-wide' })}`)}`;
    } else if (SET.tab === 'rules' && L) {
      cols = html`${col(html`${seg('qLen', s.qLen || 180, [[120, '2 min'], [180, '3 min'], [300, '5 min']], 'Quarter length', 'L')}
          ${toggle('penalties', s.penalties !== false, 'Penalties', 'Flags on the field', 'L')}
          ${toggle('autoLineup', s.autoLineup, 'Auto Lineup', 'Best players start each week', 'L')}`)}
        ${col(html`${seg('diff', L.diff, (PT.C.DIFFS || ['Beginner', 'Normal', 'Expert', 'Legend']).map((n, i) => [i, n]), 'Difficulty', 'L')}
          <div class="set-row setx-help">${K().btn({ label: 'How to Play', icon: 'question', action: 'controls', kind: 'sec', testid: 'btn-controls', cls: 'btn-wide' })}</div>`)}`;
    } else if (SET.tab === 'save') {
      cols = html`${col(html`<div class="setx-btns">
          ${L ? K().btn({ label: 'Save Now', icon: 'save', action: 'save', kind: 'go', size: 'l', testid: 'btn-save' }) : ''}
          ${L ? K().btn({ label: 'Quit to Title', icon: 'home', action: 'quit', kind: 'sec', size: 'l', testid: 'btn-quit-title' }) : ''}
          ${K().btn({ label: 'Save Slots', icon: 'folder', action: 'slots', kind: 'sec', size: 'l', testid: 'btn-set-slots' })}
        </div>`)}
        ${col(html`<div class="setx-btns">
          ${L ? '' : K().btn({ label: 'How to Play', icon: 'question', action: 'controls', kind: 'sec', size: 'l', testid: 'btn-controls' })}
          ${K().btn({ label: 'Credits', icon: 'heart', action: 'credits', kind: 'ghost', size: 'l', testid: 'btn-credits' })}
        </div><p class="tiny muted setx-ver">Pixel Touchdown v${PT.VERSION || '0.1'}</p>`)}`;
    } else {
      cols = html`${col(html`${slider('sfx', p.sfx, 'Sounds', 'speaker')}${slider('music', p.music, 'Music', 'music')}${toggle('haptics', p.haptics !== false, 'Vibration', 'Buzz on big hits', 'P')}`)}
        ${col(html`${seg('quality', p.quality || 'auto', [['auto', 'Auto'], ['high', 'Sharp'], ['med', 'Balanced'], ['low', 'Fast']], 'Graphics', 'P')}
          ${qNote ? html`<p class="tiny muted set-note" data-testid="set-quality-note">Restart to get full sharpness.</p>` : ''}
          ${toggle('reduceMotion', p.reduceMotion, 'Reduce Motion', 'Less shake and bounce', 'P')}
          ${seg('textSize', p.textSize || 'normal', [['normal', 'Normal'], ['big', 'Big']], 'Text size', 'P')}`)}`;
    }
    const body = html`${K().tabs(tabs.map((x) => ({ id: x.id, label: x.label, icon: x.icon, testid: 'tab-set-' + x.id })), SET.tab, 'set-tab')}
      <div class="cols2 setx">${cols}</div>`;
    D().set(el, K().layout(body, null, 'fit nsa setx-lay'));
  }


  // ---------------- How to Play ----------------
  const HT = { tab: 'controls' };
  const HT_TABS = [{ id: 'controls', label: 'Controls', icon: 'football' }, { id: 'offense', label: 'Offense', icon: 'football' }, { id: 'defense', label: 'Defense', icon: 'shield' }, { id: 'counters', label: 'Counters', icon: 'brain' }, { id: 'manager', label: 'Coach', icon: 'cap' }, { id: 'modes', label: 'Modes', icon: 'dice' }];
  const kbd = (k) => html`<span class="kbd">${k}</span>`;
  function ctlRow(what, touch, mouse, keys, pad) {
    return html`<div class="htc-row"><b>${what}</b><span>${touch}</span><span>${mouse}</span><span>${keys.map(kbd)}</span><span class="ht-pad">${pad || '–'}</span></div>`;
  }
  /** ROUND6 "0 scrolling": three picture cards on the left, the full button list paged on the right */
  function howControls() {
    return html`<div class="cols2 htx-ctl">
      <div class="ht-pics">
        <figure class="ht-pic"><div class="ht-phone"><span class="ht-joy"><i></i></span><span class="ht-btns"><i>JUKE</i><i>SPIN</i><i>DIVE</i><i>SPRINT</i></span></div><figcaption><b>Touch</b> Drag on the left to run. Buttons on the right.</figcaption></figure>
        <figure class="ht-pic"><div class="ht-sling"><span class="ht-qb">${K().ic('football')}</span><span class="ht-pull"></span><span class="ht-target">${K().ic('target')}</span></div><figcaption><b>Throw</b> Pull back like a slingshot, let go to throw.</figcaption></figure>
        <figure class="ht-pic"><div class="ht-keys">${['W', 'A', 'S', 'D'].map(kbd)}<span class="ht-space">${kbd('Space')}</span></div><figcaption><b>Keyboard</b> WASD to run, Space to hike and juke.</figcaption></figure>
      </div>
      ${K().card(html`${K().h2('All the buttons')}<div class="htc-row htc-head"><span></span><span>Touch</span><span>Mouse</span><span>Keys</span><span>Gamepad</span></div>
        ${K().pg('ht-ctl', [
    ctlRow('Run', 'Drag left side', 'Hold + point', ['W', 'A', 'S', 'D'], 'Left stick'),
    ctlRow('Sprint', 'Push stick all the way', 'Hold Shift', ['Shift'], 'Hold RT'),
    ctlRow('Hike', 'HIKE button', 'Click HIKE', ['Space'], 'A'),
    ctlRow('Throw', 'Pull back + let go', 'Drag + let go', ['1', '2', '3', '4'], 'Right stick, then RT'),
    ctlRow('Lob', 'Hold LOB', 'Right button', ['Shift'], 'Hold LT'),
    ctlRow('Juke', 'JUKE', 'Click JUKE', ['Q'], 'A'),
    ctlRow('Spin', 'SPIN', 'Click SPIN', ['R'], 'B'),
    ctlRow('Dive', 'DIVE', 'Click DIVE', ['E'], 'X'),
    ctlRow('Star Play', 'Tap when green', 'Click', ['Space'], 'A'),
    ctlRow('Move Star', 'Tap a defender', 'Click a defender', ['Tab'], 'LB'),
    ctlRow('Kick', 'Pull back + let go', 'Drag + let go', ['←', '→', 'Space'], 'Stick + hold A'),
    ctlRow('Fast', '» button', 'Click »', ['F'], 'RB'),
    ctlRow('Pause', 'Tap Pause', 'Click Pause', ['Esc'], 'Start'),
    ctlRow('Menus', 'Tap', 'Click', ['Arrows', 'Enter', 'Esc'], 'D-pad, A = OK'),
    ctlRow('Next (HQ)', 'NEXT', 'Click NEXT', ['N'], 'A on NEXT'),
    html`<p class="small muted htc-note">Plug in a gamepad and press any button to connect.</p>`
  ])}`, 'fill htx-tbl')}
    </div>`;
  }
  /** FEATURES: game modes (Practice Field, Quick Game, Fantasy Draft, Power Rankings) */
  function howModes() {
    const inFr = !!(PT.App.L && !PT.App.L.tmp);
    return K().card(html`${K().h2('Game Modes', html`<div class="htx-acts">${K().btn({ label: 'Practice', action: 'ht-practice', kind: 'go', size: 's', testid: 'btn-howto-practice' })}${inFr ? '' : K().btn({ label: 'Quick Game', action: 'ht-quick', kind: 'sec', size: 's', testid: 'btn-howto-quick' })}</div>`)}
      ${steps('ht-modes', [
    step(1, 'Practice Field', 'Learn to pass, run, defend and kick, one drill at a time. Skip any drill.', ''),
    step(2, 'Quick Game', 'Pick two teams, set the weather and quarter length, and play.', ''),
    step(3, 'Franchise', 'Run a team season after season. Manage the roster, the Draft and the Market.', ''),
    step(4, 'Fantasy Draft', 'Turn on Fantasy Draft when you start a franchise. All 32 teams draft new rosters from one pool.', ''),
    step(5, 'Power Rankings', 'All 32 teams ranked each week by record, points, Stars and form. Find it under League, Power Rank.', '')])}`, 'fill');
  }
  /** a paged grid of how-to steps (two columns on wide screens) */
  function steps(key, list) { return K().pg(key, list, { grid: true, cls: 'htx-steps' }); }
  function step(n, title, text, pic) {
    return html`<div class="ht-step"><span class="ht-n">${typeof n === 'number' ? n : K().ic(n)}</span><div class="grow"><b>${title}</b><p class="small">${text}</p></div>${pic ? html`<div class="ht-mini">${pic}</div>` : ''}</div>`;
  }
  function dia(id, side) {
    const P = UI.PlayCall && UI.PlayCall.diagram ? UI.PlayCall.diagram(id, side, false) : '';
    return P ? html`<span class="pc-dia">${D().raw(P)}</span>` : '';
  }
  function howOffense() {
    const PB = PT.Data.Playbook;
    const first = PB && PB.list ? PB.list.find((p) => p.k === 'pass') : null;
    const run = PB && PB.list ? PB.list.find((p) => p.k === 'run') : null;
    return K().card(html`${K().h2('Offense')}
      ${steps('ht-off', [
    step(1, 'Pick a play', 'Pick one of three play cards. The flame marks the coach’s pick. White lines are routes; yellow is the first read.', first ? dia(first.id, 'O') : ''),
    step(2, 'Hike', 'Tap HIKE or press Space. On run plays the handoff is automatic.', run ? dia(run.id, 'O') : ''),
    step(3, 'Throw', 'Pull back like a slingshot and let go. Throw where the catcher is GOING. Hold LOB to throw over defenders.', ''),
    step(4, 'Run and dodge', 'Steer with the joystick. JUKE, SPIN and DIVE to slip past tacklers.', ''),
    step(5, '4th down', 'Go for it, punt or kick a field goal. The make chance shows on the button.', '')])}`, 'fill');
  }
  function howDefense() {
    const DF = PT.Data.Defense;
    const d = DF && DF.list ? DF.list[0] : null;
    return K().card(html`${K().h2('Defense')}
      ${steps('ht-def', [
    step(1, 'Pick a Defense Call', 'Square blocks are your defenders. Red arrows rush the QB, blue bubbles guard an Area, dashed lines stick to a Buddy.', d ? dia(d.id, 'D') : ''),
    step(2, 'Move the Star', 'Your Star defender has a gold ring. Tap another defender to move the Star before the snap.', ''),
    step(3, 'Star Play', 'Tap when the gold ring turns green for a Super Dive or Super Jump.', html`<span class="ht-ring"><i></i></span>`),
    step(4, 'Speed Up', 'Press » to go fast, Skip to jump to the result, or Sim Drive to finish their drive.', '')])}`, 'fill');
  }
  function howCounters() {
    const DF = PT.Data.Defense, PB = PT.Data.Playbook;
    if (!DF || !DF.MATRIX || !PB || !PB.TYPES) return K().card(K().empty('brain', 'Counters are coming soon.'));
    const names = PB.TYPE_NAMES || {};
    const rows = PB.TYPES.map((ty) => {
      const good = [], bad = [];
      const vals = DF.list.map((c) => ({ n: c.name, v: (DF.MATRIX[c.id] || {})[ty] || 0 }));
      const hi = Math.max.apply(null, vals.map((x) => x.v)), lo = Math.min.apply(null, vals.map((x) => x.v));
      vals.forEach((x) => { if (hi > 0 && x.v === hi) good.push(x.n); else if (lo < 0 && x.v === lo) bad.push(x.n); });
      return html`<div class="htk-row"><b>${PB.TYPE_ICONS && PB.TYPE_ICONS[ty] ? K().ic(PB.TYPE_ICONS[ty]) : ''} ${names[ty] || ty}</b><span class="good">${good.join(', ') || '—'}</span><span class="bad">${bad.join(', ') || '—'}</span></div>`;
    });
    return html`<div class="cols2 htx-cnt">
      ${K().card(html`${K().h2('Counters')}<div class="htk-row htk-head"><span>Their play</span><span>Great defense</span><span>Weak defense</span></div>${K().pg('ht-cnt', rows)}`, 'fill')}
      ${K().card(html`${K().h2('Quick rules')}<p class="small">Every Defense Call beats some plays and loses to others.</p><ul class="bul small"><li>Rush (blitz) beats deep passes, but screens beat rush.</li><li>Wall stops runs up the middle, but fakes beat Wall.</li><li>Areas stop long bombs; quick short passes beat soft Areas.</li></ul>`)}
    </div>`;
  }
  function howManager() {
    return K().card(html`${K().h2('Franchise Basics')}
      ${steps('ht-coach', [
    step('play', 'Press NEXT', 'The big button on HQ moves the season forward and shows what comes next.', ''),
    step('star', 'Stars & Growth', 'Stars show how good a player is. Growth (A+ to D) shows how much he can still improve.', ''),
    step('cash', 'Team Cash', 'All Pay must fit under the Team Cash limit. Cutting a player has a Cut Cost.', ''),
    step('coin', 'Coins', 'Earn Coins from games and fans. Spend them in the Shop on facilities and coaches.', ''),
    step('flame', 'Hype & Boss', 'Win to keep fans hyped and the Boss happy. Hit the Boss Goal each season.', '')])}`, 'fill');
  }
  UI.screens.howto = {
    title: 'How to Play',
    chrome: 'head',
    mount: (el, params) => {
      if (params.tab) { HT.tab = params.tab; params.tab = null; }
      const t = HT.tab;
      const body = t === 'offense' ? howOffense() : t === 'defense' ? howDefense() : t === 'counters' ? howCounters() : t === 'manager' ? howManager() : t === 'modes' ? howModes() : howControls();
      D().set(el, K().layout(html`${K().tabs(HT_TABS.map((x) => ({ id: x.id, label: x.label, icon: x.icon, testid: 'tab-howto-' + x.id })), t, 'ht-tab')}${body}`, null, 'fit nsa howto'));
    },
    actions: {
      'ht-tab': (el) => { HT.tab = el.getAttribute('data-id'); UI.refresh(); },
      'ht-practice': () => { if (PT.App.L) PT.App.save({ auto: true }); UI.go('practice', { from: 'howto' }); },
      'ht-quick': () => UI.go('quick')
    }
  };

  UI.screens.settings = {
    title: 'Settings',
    nav: 'settings',
    chrome: 'full',
    mount: mount,
    actions: {
      'set-tab': (el) => { SET.tab = el.getAttribute('data-id'); UI.refresh(); },
      tog: (el) => applyTog(el),
      seg: (el) => { applySeg(el); UI.refresh(); },
      save: () => { const r = PT.App.save({}); UI.Toast.show(r && r.ok === false ? 'Save failed' : 'Saved', r && r.ok === false ? 'bad' : 'good'); },
      quit: () => UI.Modal.confirm('Quit to the title screen?', { body: 'Your game is saved.', icon: 'home' }).then((ok) => {
        if (!ok) return;
        try { PT.App.save({}); } catch (e) { /* ignore */ }
        PT.App.quitToTitle();
        if (!UI.current() || UI.current().name !== 'title') { UI.reset(); UI.replace('title'); }
      }),
      slots: () => UI.go('slots', { mode: 'load' }),
      controls: () => UI.go('howto'),
      credits: () => UI.Modal.alert('Pixel Touchdown', html`<p>Thanks for playing.</p><p class="small muted">Version ${PT.VERSION || '0.1'}</p>`, 'heart')
    },
    onInput: (el) => {
      if (el.type !== 'range') return;
      const k = el.getAttribute('data-k');
      setPref({ [k]: +el.value / 100 });
      const v = el.closest('.set-row').querySelector('.set-v'); if (v) v.textContent = el.value;
    }
  };
})(globalThis.PT = globalThis.PT || {});
