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
    // HUNT3-input #2: control options can be set from the title (App.setSettings saves them to device prefs)
    if (!L) { if (PT.App && PT.App.setSettings) PT.App.setSettings({ [k]: v }); UI.applyPrefs(); return; }
    const fn = (PT.App.setSettings && !PT.App.setSettings.__stub && PT.App.setSettings) || (PT.League.setSettings && !PT.League.setSettings.__stub && PT.League.setSettings);
    if (fn) { fn === PT.App.setSettings ? fn({ [k]: v }) : fn(L, { [k]: v }); }
    else { L.settings = Object.assign({}, L.settings, { [k]: v }); if (PT.Events) PT.Events.emit('league:changed', { what: 'settings' }); }
    UI.applyPrefs();
  };

  function toggle(key, on, label, sub, scope) {
    return html`<div class="set-row"><div class="grow"><b>${label}</b>${sub ? html`<div class="tiny muted">${sub}</div>` : ''}</div>
      <button type="button" class="toggle ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${label}" data-action="tog" data-k="${key}" data-scope="${scope}" data-testid="set-${key}"></button></div>`;
  }
  function seg(key, cur, opts, label, scope, disabled, sub) {
    return html`<div class="set-row col-row"><b>${label}</b>${sub ? html`<div class="tiny muted">${sub}</div>` : ''}<div class="seg" role="radiogroup" aria-label="${label}">${opts.map((o) => html`<button type="button" class="btn btn-sec btn-s ${String(cur) === String(o[0]) ? 'on' : ''}" role="radio" aria-checked="${String(cur) === String(o[0]) ? 'true' : 'false'}" data-action="seg" data-k="${key}" data-v="${o[0]}" data-scope="${scope}" data-testid="set-${key}-${o[0]}" ${disabled ? D().raw('disabled') : ''}>${o[1]}</button>`)}</div></div>`;
  }


  /** volume as a 4-step segmented control (big touch targets instead of a thin slider) */
  const VOL = [[0, 'Off'], [0.35, 'Low'], [0.7, 'Mid'], [1, 'High']];
  const volCur = (v) => { const x = v == null ? 0.7 : v; return VOL.reduce((b, o) => (Math.abs(o[0] - x) < Math.abs(b - x) ? o[0] : b), 0.7); };
  /** the basic options (client: "show fewer options, just basic ones") — shared by the screen and the in-game modal */
  function basicRows(p) {
    return html`${seg('speed', p.speed || 0.8, [[0.7, 'Relaxed'], [0.8, 'Normal'], [1, 'Fast']], 'Game speed', 'P')}
      ${seg('music', volCur(p.music), VOL, 'Music', 'P')}
      ${seg('sfx', volCur(p.sfx), VOL, 'Sound', 'P')}
      ${seg('haptics', p.haptics !== false ? 1 : 0, [[0, 'Off'], [1, 'On']], 'Vibration', 'P')}`;
  }
  /** pause-menu Settings: ONLY the basic options, in a compact 2-column modal that fits 667×375 */
  UI.gameSettings = function () {
    const L = PT.App && PT.App.L, st = (L && L.settings) || {};
    return UI.Modal.open({ title: 'Settings', cls: 'm-settings',
      body: html`<div class="set-modal">${basicRows(prefs())}${L ? seg('lefty', st.lefty ? 1 : 0, [[0, 'Off'], [1, 'On']], 'Left-handed', 'L') : ''}${L ? seg('autoDef', st.autoDef ? 1 : 0, [[0, 'Off'], [1, 'On']], 'Auto-start D', 'L') : ''}</div>`,
      actions: {
        seg: (el, card) => { applySeg(el); D().$$('[data-k="' + el.getAttribute('data-k') + '"]', card).forEach((b) => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); }
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
    if (k === 'haptics' || k === 'lefty' || k === 'autoDef') v = !!v;
    if (k === 'quality') { const was = prefs().quality; if ((was === 'low' && v !== 'low') || (was === 'med' && v === 'high')) qNote = true; else if (v === 'low') qNote = false; }
    if (el.getAttribute('data-scope') === 'P') setPref({ [k]: v });
    else if (k === 'diff') { const L = PT.App.L; const fn = PT.League.setDifficulty; if (fn && !fn.__stub) fn(L, v); else { L.diff = v; if (PT.Events) PT.Events.emit('league:changed', { what: 'diff' }); } }
    else UI.adapt.setSetting(k, v);
    if (k === 'watch') { try { if (PT.Session && PT.Session.setWatchSpeed) PT.Session.setWatchSpeed(v); } catch (e) { /* ignore */ } }
    if (k === 'autoDef') { try { if (PT.Session && PT.Session.setAutoDef) PT.Session.setAutoDef(v); } catch (e) { /* ignore */ } }
    if (k === 'lefty') { try { if (PT.Input && PT.Input.setOptions) PT.Input.setOptions({ lefty: v }); } catch (e) { /* ignore */ } }
  }
  let qNote = false;   // set after stepping up from Fast in this session (the lower-res buffers stay until a reload)
  /**
   * HUNT2 #8: Settings = 3 short tabs that each fit one screen (no long scroll list):
   *   Game (difficulty, quarter length, game speed, defense speed) + one button row,
   *   Controls (aim style, easy throw, left-handed, auto-start D, auto kick, penalties, auto lineup), Sound & Screen (music, sound, vibration, graphics, text, motion).
   * Without a franchise (from the title) only the options that exist there are shown.
   */
  const SET = { tab: 'game' };
  function mount(el, params) {
    const p = prefs();
    const L = PT.App && PT.App.L;
    // without a franchise the control options come from device prefs (App.CONTROL_KEYS)
    const s = (L && L.settings) || ((PT.App && PT.App.CONTROL_KEYS) || []).reduce((o, k) => { if (p[k] !== undefined) o[k] = p[k]; return o; }, {});
    const tabs = [{ id: 'game', label: 'Game', testid: 'tab-set-game' }];
    tabs.push({ id: 'controls', label: 'Controls', testid: 'tab-set-controls' });
    tabs.push({ id: 'screen', label: 'Sound & Screen', testid: 'tab-set-screen' });
    let tab = params.tab || SET.tab;
    if (!tabs.some((t) => t.id === tab)) tab = 'game';
    SET.tab = tab;
    const grid = (inner, cls) => K().card(html`<div class="setz-grid">${inner}</div>`, 'setz fill ' + (cls || ''));
    let body;
    if (tab === 'controls') {
      body = grid(html`${toggle('easyThrow', s.easyThrow, 'Easy Throw', 'Tap numbers to throw', 'L')}
        ${toggle('lefty', s.lefty, 'Left-handed', 'Swap stick and buttons', 'L')}
        ${toggle('autoDef', !!s.autoDef, 'Auto-start defense', 'Coach picks the call, starts the D', 'L')}
        ${toggle('autoKick', s.autoKick, 'Auto Kick', 'Kicks are automatic', 'L')}
        ${L ? toggle('penalties', s.penalties !== false, 'Penalties', 'Flags on the field', 'L') : ''}
        ${L ? toggle('autoLineup', s.autoLineup, 'Auto Lineup', 'Best players start', 'L') : ''}
        <div class="set-aim">${seg('aimMode', s.aimMode || 'sling', [['sling', 'Slingshot'], ['point', 'Point']], 'Aim style', 'L', false, 'Point: drag to the catcher')}</div>`, 'setz-ctl');
    } else if (tab === 'screen') {
      body = grid(html`${seg('music', volCur(p.music), VOL, 'Music', 'P')}
        ${seg('sfx', volCur(p.sfx), VOL, 'Sound', 'P')}
        ${seg('haptics', p.haptics !== false ? 1 : 0, [[0, 'Off'], [1, 'On']], 'Vibration', 'P')}
        ${seg('quality', p.quality || 'auto', [['auto', 'Auto'], ['high', 'High'], ['med', 'Med'], ['low', 'Low']], 'Graphics', 'P')}
        ${seg('textSize', p.textSize || 'normal', [['normal', 'Normal'], ['big', 'Big']], 'Text size', 'P')}
        ${toggle('reduceMotion', p.reduceMotion, 'Reduce Motion', 'Less shake and bounce', 'P')}
        ${qNote ? html`<p class="tiny muted set-note" data-testid="set-quality-note">Restart to get full sharpness.</p>` : ''}`, 'setz-scr');
    } else {
      const autosaveOff = !!(L && PT.App.tainted) || (PT.Save && PT.Save.available && !PT.Save.available());
      body = html`${grid(html`${L ? seg('diff', L.diff, (PT.C.DIFFS || ['Beginner', 'Normal', 'Expert', 'Legend']).map((n, i) => [i, n]), 'Difficulty', 'L') : ''}
        ${L ? seg('qLen', s.qLen || 180, [[120, '2 min'], [180, '3 min'], [300, '5 min']], 'Quarter length', 'L') : ''}
        ${seg('speed', p.speed || 0.8, [[0.7, 'Relaxed'], [0.8, 'Normal'], [1, 'Fast']], 'Game speed', 'P')}
        ${seg('watch', s.watch && s.watch !== 3 ? s.watch : 0.8, [[0.8, '0.8×'], [1, '1×'], [1.5, '1.5×']], 'Defense speed', 'L')}`, 'setz-game')}
        <div class="setz-btns setz-row">
          ${L && autosaveOff ? K().btn({ label: 'Save Now', icon: 'save', action: 'save', kind: 'go', size: 's', testid: 'btn-save' }) : ''}
          ${K().btn({ label: 'Save Slots', icon: 'folder', action: 'slots', kind: 'sec', size: 's', testid: 'btn-set-slots' })}
          ${K().btn({ label: 'How to Play', icon: 'question', action: 'controls', kind: 'sec', size: 's', testid: 'btn-controls' })}
          ${L ? K().btn({ label: 'Quit to Title', icon: 'home', action: 'quit', kind: 'sec', size: 's', testid: 'btn-quit-title' }) : ''}
          <span class="tiny muted setx-ver">v${PT.VERSION || '0.1'}</span>
        </div>`;
    }
    D().set(el, K().layout(html`${K().tabs(tabs, tab, 'set-tab')}${body}`, null, 'fit setx-tabs'));
  }


  // ---------------- How to Play ----------------
  /** HUNT5 #10: words that match the device ('Tap' on touch, 'Press' / keys otherwise) */
  const touchDev = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };
  const HT = { tab: 'controls' };
  const HT_TABS = [{ id: 'controls', label: 'Controls', icon: 'football' }, { id: 'offense', label: 'Offense', icon: 'football' }, { id: 'defense', label: 'Defense', icon: 'shield' }, { id: 'counters', label: 'Counters', icon: 'brain' }, { id: 'manager', label: 'Franchise', icon: 'cap' }, { id: 'modes', label: 'Modes', icon: 'dice' }];
  const kbd = (k) => html`<span class="kbd">${k}</span>`;
  function ctlRow(what, touch, mouse, keys, pad) {
    return html`<div class="htc-row"><b>${what}</b><span>${touch}</span><span class="htc-m">${mouse}</span><span class="htc-k">${keys.map(kbd)}</span><span class="ht-pad">${pad || '–'}</span></div>`;
  }
  /** ROUND6 "0 scrolling": three picture cards on the left, the full button list paged on the right */
  function howControls() {
    return html`<div class="cols2 htx-ctl">
      <div class="ht-pics">
        <figure class="ht-pic"><div class="ht-phone"><span class="ht-joy"><i></i></span><span class="ht-btns"><i>JUKE</i><i>DIVE</i><i>SPRINT</i></span></div><figcaption><b>Touch</b> Drag on the left to run. Buttons on the right.</figcaption></figure>
        <figure class="ht-pic"><div class="ht-sling"><span class="ht-qb">${K().ic('football')}</span><span class="ht-pull"></span><span class="ht-target">${K().ic('target')}</span></div><figcaption><b>Throw</b> Pull back like a slingshot, let go to throw.</figcaption></figure>
        <figure class="ht-pic ht-pic-kbd"><div class="ht-keys">${['W', 'A', 'S', 'D'].map(kbd)}<span class="ht-space">${kbd('Space')}</span></div><figcaption><b>Keyboard</b> WASD to run, Space to hike and juke.</figcaption></figure>
      </div>
      ${K().card(html`${K().h2('All the buttons')}<div class="htc-row htc-head"><span></span><span>Touch</span><span class="htc-m">Mouse</span><span class="htc-k">Keys</span><span class="ht-pad">Gamepad</span></div>
        ${K().pg('ht-ctl', [
    ctlRow('Run', 'Drag left side', 'Hold + point', ['W', 'A', 'S', 'D'], 'Left stick'),
    ctlRow('Sprint', 'SPRINT button (or push the stick all the way)', 'Hold Shift', ['Shift'], 'Hold RT'),
    ctlRow('Hike', 'HIKE button', 'Click HIKE', ['Space'], 'A'),
    ctlRow('Throw', 'Pull back + let go (or drag to the target with Point aim)', 'Drag + let go', ['1', '2', '3', '4'], 'Right stick, then RT'),
    ctlRow('Lob', 'Hold LOB', 'Right button', ['Shift'], 'Hold LT'),
    ctlRow('Juke', 'JUKE (dodges a hit; refills after a moment)', 'Click JUKE', ['Q'], 'A'),
    ctlRow('Dive', 'DIVE', 'Click DIVE', ['E'], 'X'),
    ctlRow('Star Play', 'Tap when green', 'Click', ['Space'], 'A'),
    ctlRow('Control player', 'Tap a defender', 'Click a defender', ['Tab'], 'LB'),
    ctlRow('Surge', 'SURGE button', 'Click SURGE', ['G'], 'Y'),
    ctlRow('Kick', 'Pull back + let go', 'Drag + let go', ['←', '→', 'Space'], 'Stick + hold A'),
    ctlRow('Speed up', '» (tap again: end play)', 'Click »', ['F'], 'RB'),
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
    step(4, 'Star Draft', 'Turn on Star Draft when you start a franchise. Draft your 8 Stars; the rest of the roster fills in.', ''),
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
    step(2, 'Hike', (touchDev() ? 'Tap HIKE.' : 'Click HIKE or press Space.') + ' On run plays the handoff is automatic.', run ? dia(run.id, 'O') : ''),
    step(3, 'Throw', 'Pull back like a slingshot and let go. Throw where the catcher is GOING. Hold LOB to throw over defenders.', ''),
    step(4, 'Run and dodge', 'Steer with the joystick. JUKE to slip a tackle, DIVE for extra yards. Watch the stamina bar.', ''),
    step(5, '4th down', 'Go for it, punt or kick a field goal. The make chance shows on the button.', '')])}`, 'fill');
  }
  function howDefense() {
    const DF = PT.Data.Defense;
    const d = DF && DF.list ? DF.list[0] : null;
    return K().card(html`${K().h2('Defense')}
      ${steps('ht-def', [
    step(1, 'Pick a Defense Call', 'Square blocks are your defenders. Red arrows rush the QB, blue bubbles guard an Area, dashed lines stick to a Buddy.', d ? dia(d.id, 'D') : ''),
    step(2, 'Control a player', 'Tap a defender to control him before the snap.', ''),
    step(3, 'Star Play', 'Tap TAP! when the ring turns green for a Super Dive or Super Jump.', html`<span class="ht-ring"><i></i></span>`),
    step(4, 'Surge', 'When the meter is full, tap SURGE: all your Stars on the field use their power.', ''),
    step(5, 'Speed up', (touchDev() ? 'Tap' : 'Press') + ' » for 2×, again to end the play, or Sim drive.', '')])}`, 'fill');
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
      ${K().card(html`${K().h2('Quick rules')}<ul class="bul small"><li>Stampede beats deep passes. Screens beat Stampede.</li><li>Brick House stops inside runs. Fakes beat it.</li></ul>`)}
    </div>`;
  }
  function howManager() {
    return K().card(html`${K().h2('Franchise Basics')}
      ${steps('ht-coach', [
    step('play', (touchDev() ? 'Tap' : 'Press') + ' NEXT', 'The big button on HQ moves the season forward and shows what comes next.', ''),
    step('chart', 'Rating & Growth', 'Rating stars show how good a player is. Growth (A+ to D) shows how much he can still improve.', ''),
    step('star', 'Stars', 'Your 8 picked players. +5 skills, and they power the SURGE.', ''),
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
      'set-tab': (el, ev, params) => { params.tab = el.getAttribute('data-id'); UI.refresh(); },
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
      controls: () => UI.go('howto')
    },
    onInput: (el) => {
      if (el.type !== 'range') return;
      const k = el.getAttribute('data-k');
      setPref({ [k]: +el.value / 100 });
      const v = el.closest('.set-row').querySelector('.set-v'); if (v) v.textContent = el.value;
    }
  };
})(globalThis.PT = globalThis.PT || {});
