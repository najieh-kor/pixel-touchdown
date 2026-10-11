/* Pixel Touchdown: js/ui/screens/title.js
 * Owner: WP5. Responsibility: Continue / New / Load / Settings.
 * A Crossy-Road style scene (sky, grass strips, a road with lanes) with blocky animals hopping across.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  /** newest save slot with data: { slot, which:'main'|'auto', meta } | null */
  function newestSave() {
    if (!PT.Save || !PT.Save.meta) return null;
    let meta;
    try { meta = PT.Save.meta(); } catch (e) { return null; }
    if (!meta || !meta.slots) return null;
    let best = null;
    let pref = null;
    try { pref = PT.Save.prefs ? PT.Save.prefs().lastSlot : null; } catch (e) { pref = null; }
    Object.keys(meta.slots).forEach((s) => {
      const m = meta.slots[s] || {};
      ['main', 'auto'].forEach((w) => {
        const x = m[w];
        if (!x) return;
        const score = (x.at || 0) + (+s === pref ? 1e15 : 0);
        if (!best || score > best.score) best = { slot: +s, which: w, meta: x, score: score };
      });
    });
    if (best && PT.Save.newest) { try { best.which = PT.Save.newest(best.slot) || best.which; } catch (e) { /* keep */ } }
    return best;
  }
  UI.newestSave = newestSave;

  /** load a slot and go to HQ (shared with the slots screen) */
  UI.loadSlot = function (slot, backup) {
    const busy = UI.Modal.busy('Loading…');
    return new Promise((resolve) => setTimeout(resolve, 30)).then(() => PT.App.load(slot, { backup: !!backup })).then((r) => {
      busy.close();
      // QA1: a damaged copy with a good other copy → offer it (was only a toast asking a question with no buttons)
      if (r && r.ok === false && r.canBackup) {
        return UI.Modal.confirm('Damaged save. Load the backup?', { icon: 'cross', yes: 'Load backup', no: 'Not now' }).then((ok) => {
          if (!ok) return r;
          const r2 = PT.App.load(slot, { which: r.backupWhich });
          if (r2 && r2.ok === false) { UI.Toast.show(r2.msg || 'Could not load that save.', 'bad', 3000); return r2; }
          return opened(slot, r2);
        });
      }
      if (r && r.ok === false) { UI.Toast.show(r.msg || 'Could not load that save.', 'bad', 3000); return r; }
      return opened(slot, r);
    }).catch((e) => { busy.close(); UI.Toast.show('Could not load that save.', 'bad'); if (PT.Log) PT.Log.error('ui', 'load', e); });
  };
  function opened(slot, r) {
    try { if (PT.Save.setPrefs) PT.Save.setPrefs({ lastSlot: slot }); } catch (e) { /* ignore */ }
    UI.theme(); UI.applyPrefs();
    UI.reset();
    // QA1: a save made mid-game (tab closed / crash) → "Game interrupted · Sim the rest" like App.open does;
    // before, Continue dropped you on HQ with the game half-started and replayable from kickoff.
    if (r && r.interrupted && PT.App.checkInterrupted) PT.App.checkInterrupted();
    return r;
  }

  /** FEATURES: Practice button sub line (done / new) */
  function practiceSub() {
    let p = {};
    try { p = PT.Save.prefs() || {}; } catch (e) { p = {}; }
    return p.practiceDone ? 'Done' : p.practiceSeen ? '' : 'Start here';
  }

  function mount(el) {
    PT.UI.theme(null);
    const save = newestSave();
    const def = save && PT.Data.Teams && PT.Data.Teams.byId ? PT.Data.Teams.byId(save.meta.tid) : null;
    const sub = save ? (def ? def.name : save.meta.team) + ' · ' + save.meta.season + (save.meta.phase === 'REGULAR' ? ' · Week ' + save.meta.week : '') : '';
    // UI restyle: the voxel title diorama (PT.Render.menuBackdrop mode 'title') is the backdrop; this is a pixel logo + menu
    D().set(el, html`<div class="title-scr">
      <div class="t-main">
        <div class="logo" role="img" aria-label="Pixel Touchdown">
          <div class="logo-l1"><span>P</span><span>I</span><span>X</span><span>E</span><span>L</span></div>
          <div class="logo-l2">TOUCHD<span class="logo-ball">${K().ic('football')}</span>WN</div>
          <div class="logo-tag">Cute critters. Big plays.</div>
        </div>
        <div class="t-btns">
          <button type="button" class="t-press" data-action="${save ? 'continue' : 'new'}" data-testid="btn-press-start">Press Start</button>
          ${save ? K().btn({ label: 'Continue', sub: sub, icon: 'play', action: 'continue', kind: 'go', size: 'xl', testid: 'btn-continue', cls: 'btn-wide' }) : ''}
          ${save ? '' : K().btn({ label: 'New Game', icon: 'sparkle', action: 'new', kind: 'go', size: 'xl', testid: 'btn-new-game', cls: 'btn-wide' })}
          <div class="t-grid">
            ${save ? K().btn({ label: 'New Game', icon: 'sparkle', action: 'new', kind: 'sec', size: 'l', testid: 'btn-new-game' }) : ''}
            ${K().btn({ label: 'Quick Game', icon: 'bolt', action: 'quick', kind: 'gold', size: 'l', testid: 'btn-quick-game' })}
            ${K().btn({ label: 'Practice', sub: practiceSub(), icon: 'whistle', action: 'practice', kind: 'sec', size: 'l', testid: 'btn-practice' })}
            ${K().btn({ label: 'Load', icon: 'folder', action: 'load', kind: 'sec', size: 'l', testid: 'btn-load' })}
          </div>
        </div>
        <div class="t-corner">
          ${K().btn({ icon: 'question', action: 'howto', kind: 'ghost', size: 's', testid: 'btn-howto', title: 'How to Play', label: 'Help' })}
          ${K().btn({ icon: 'gear', action: 'settings', kind: 'ghost', size: 's', testid: 'btn-settings', title: 'Settings' })}
        </div>
        <p class="t-ver">v${PT.VERSION || '0.1'}</p>
      </div>
    </div>`);
    if (PT.Render && PT.Render.setScene) { try { PT.Render.setScene('menu'); } catch (e) { /* ignore */ } }
    if (UI.backdropReset) { UI.backdropReset(); UI.backdrop('title'); }
  }

  UI.screens.title = {
    title: 'Pixel Touchdown',
    chrome: 'bare',
    mount: mount,
    actions: {
      continue: () => { const s = newestSave(); if (s) UI.loadSlot(s.slot, s.which === 'auto'); },
      new: () => UI.go('slots', { mode: 'new' }),
      load: () => UI.go('slots', { mode: 'load' }),
      settings: () => UI.go('settings'),
      howto: () => UI.go('howto'),
      quick: () => UI.go('quick'),
      practice: () => UI.go('practice', { from: 'title' })
    },
    keys: (ev) => {
      if (ev.key === 'Enter' && globalThis.document.activeElement === globalThis.document.body) {
        const b = globalThis.document.querySelector('[data-testid="btn-continue"]') || globalThis.document.querySelector('[data-testid="btn-new-game"]');
        if (b) { b.click(); return true; }
      }
      return false;
    }
  };
})(globalThis.PT = globalThis.PT || {});
