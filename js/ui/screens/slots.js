/* Pixel Touchdown: js/ui/screens/slots.js
 * Owner: WP5. Responsibility: 3 slots with meta, load/backup/delete/export/import.
 * params.mode: 'new' (tap a slot → New Game flow) | 'load' (tap a slot → load it).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function meta() {
    try { return (PT.Save && PT.Save.meta && PT.Save.meta()) || { slots: {} }; } catch (e) { return { slots: {} }; }
  }
  function teamDef(tid) {
    const T = PT.Data && PT.Data.Teams;
    return T && T.byId ? T.byId(tid) : null;
  }
  function when(at) {
    if (!at) return '';
    try {
      const d = new Date(at);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  const PHASE_WORD = { PRESEASON: 'Preseason', REGULAR: 'Week', PLAYOFFS: 'Playoffs', SEASON_END: 'Awards', RESIGN: 'Keep Players', DRAFT: 'Draft Day', FREE_AGENCY: 'Market' };

  function slotCard(s, m, mode) {
    const main = m && m.main, auto = m && m.auto;
    const x = main || auto;
    if (!x) {
      return html`<section class="card slot-card empty-slot">
        <button type="button" class="slot-main" data-action="pick" data-slot="${s}" data-testid="slot-${s}">
          <span class="slot-num">${s}</span>
          <span class="grow slot-info"><b class="big">Empty slot</b><span class="small muted">${mode === 'load' ? 'Nothing saved here.' : 'Start a new game'}</span></span>
          <span class="slot-go">${mode === 'load' ? '' : K().ic('sparkle')}</span>
        </button>
        <div class="btn-row slot-tools">${K().btn({ label: 'Import', icon: 'folder', action: 'import', data: { slot: s }, kind: 'ghost', size: 's', testid: 'slot-' + s + '-import' })}</div>
      </section>`;
    }
    const def = teamDef(x.tid);
    const fake = def ? Object.assign({ id: x.tid }, def) : null;   // HUNT #18: the real team (its own mascot badge)
    const ph = x.phase === 'REGULAR' ? 'Week ' + x.week : (PHASE_WORD[x.phase] || x.phase);
    return html`<section class="card slot-card">
      <button type="button" class="slot-main" data-action="pick" data-slot="${s}" data-testid="slot-${s}">
        <span class="slot-num">${s}</span>
        ${fake ? K().badge(fake, 'l') : ''}
        <span class="grow slot-info">
          <b class="big ellip">${def ? def.name : (x.team || 'Team')}</b>
          <span class="small slot-line"><b class="num">${x.season}</b> · ${ph} · <span class="num">${D().rec(x.w || 0, x.l || 0, x.t || 0)}</span></span>
          <span class="tiny muted">${when((main || auto).at)}</span>
        </span>
        <span class="slot-go">${K().ic(mode === 'new' ? 'sparkle' : 'play')}</span>
      </button>
      <div class="btn-row slot-tools">
        ${auto && mode === 'load' ? K().btn({ label: 'Load Autosave', icon: 'save', action: 'backup', data: { slot: s }, kind: 'sec', size: 's', testid: 'slot-' + s + '-backup' }) : ''}
        ${K().btn({ label: 'Export', icon: 'scroll', action: 'export', data: { slot: s }, kind: 'ghost', size: 's', testid: 'slot-' + s + '-export' })}
        ${K().btn({ label: 'Delete', icon: 'x', action: 'delete', data: { slot: s }, kind: 'ghost', size: 's', testid: 'slot-' + s + '-delete' })}
      </div>
    </section>`;
  }

  function mount(el, params) {
    const m = meta();
    const n = (PT.C.SAVE && PT.C.SAVE.SLOTS) || 3;
    const cards = [];
    for (let s = 1; s <= n; s++) cards.push(slotCard(s, m.slots[s], params.mode));
    const avail = PT.Save && PT.Save.available ? PT.Save.available() : true;
    D().set(el, K().layout(html`
      ${avail ? '' : html`<p class="card card-cream small">${K().ic('warn')} Saving is off in this browser. Use Export to keep your game.</p>`}
      <div class="slots">${cards}</div>`, null, 'fit nsa slotsx'));
  }

  function hasSave(s) { const m = meta().slots[s]; return !!(m && (m.main || m.auto)); }

  UI.screens.slots = {
    title: (p) => (p.mode === 'load' ? 'Load Game' : 'New Game'),
    chrome: 'head',
    mount: mount,
    actions: {
      pick: (el, ev, params) => {
        const s = +el.getAttribute('data-slot');
        if (params.mode === 'load') { if (hasSave(s)) UI.loadSlot(s, PT.Save.newest && PT.Save.newest(s) === 'auto'); else UI.Toast.show('Nothing saved here.', 'info'); return; }
        if (!hasSave(s)) { UI.go('newgame', { slot: s }); return; }
        const x = meta().slots[s] || {}, mm = x.main || x.auto || {}, d = teamDef(mm.tid);
        const what = (d ? d.name : (mm.team || 'This save')) + (mm.season ? ' · ' + mm.season : '') + (mm.phase === 'REGULAR' && mm.week ? ' · Week ' + mm.week : '');
        UI.Modal.confirm('Replace this save?', { body: what + ' will be deleted.', icon: 'warn', yes: 'Replace', danger: true })
          .then((ok) => { if (ok) UI.go('newgame', { slot: s }); });
      },
      load: (el) => UI.loadSlot(+el.getAttribute('data-slot'), false),
      backup: (el) => UI.loadSlot(+el.getAttribute('data-slot'), true),
      delete: (el) => {
        const s = +el.getAttribute('data-slot');
        UI.Modal.confirm('Delete save ' + s + '?', { body: 'This cannot be undone.', icon: 'x', yes: 'Delete', danger: true }).then((ok) => {
          if (!ok) return;
          try { PT.Save.remove(s); } catch (e) { /* ignore */ }
          if (PT.App && PT.App.slot === s) { PT.App.L = null; }
          UI.Toast.show('Save deleted', 'info');
          UI.refresh();
        });
      },
      export: (el) => {
        const s = +el.getAttribute('data-slot');
        let str = '';
        try { str = PT.Save.exportString(s) || ''; } catch (e) { str = ''; }
        if (!str) { UI.Toast.show('Nothing to export.', 'bad'); return; }
        UI.Modal.open({ title: 'Save code', icon: 'scroll',
          body: html`<p class="small">Keep this code. Paste it into Import to restore the save.</p><textarea class="inp code" readonly rows="5" data-testid="export-code">${str}</textarea>`,
          mount: (card) => { const t = card.querySelector('textarea'); if (t) { t.focus(); t.select(); } },
          actions: { copy: (b, card) => { const t = card.querySelector('textarea'); t.select(); try { globalThis.navigator.clipboard.writeText(t.value); UI.Toast.show('Copied', 'good'); } catch (e) { UI.Toast.show('Select and copy it.', 'info'); } } },
          buttons: [{ label: 'Copy', value: 'copy', kind: 'go' }, { label: 'Close', value: null, kind: 'cancel' }],
          collect: (card, v) => { if (v === 'copy') { const t = card.querySelector('textarea'); try { globalThis.navigator.clipboard.writeText(t.value); UI.Toast.show('Copied', 'good'); } catch (e) { /* ignore */ } } return v; } });
      },
      import: (el) => {
        const s = +el.getAttribute('data-slot');
        UI.Modal.open({ title: 'Import Save', icon: 'folder',
          body: html`<p class="small">Paste a save code.</p><textarea class="inp code" rows="5" data-testid="import-code" placeholder="PTSAVE…"></textarea>`,
          buttons: [{ label: 'Import', value: 'ok', kind: 'go', testid: 'btn-import-ok' }, { label: 'Cancel', value: null, kind: 'cancel' }],
          collect: (card, v) => (v === 'ok' ? card.querySelector('textarea').value.trim() : null) })
          .then((code) => {
            if (!code) return;
            const r = PT.Save.importString(s, code);
            if (r && r.ok) { UI.Toast.show('Save imported', 'good'); UI.refresh(); }
            else UI.Toast.show((r && r.msg) || 'Invalid save code.', 'bad', 3000);
          });
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
