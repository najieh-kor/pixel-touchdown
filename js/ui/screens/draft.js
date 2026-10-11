/* Pixel Touchdown: js/ui/screens/draft.js
 * Owner: FLOW-UX (was WP5). Draft Day (phase DRAFT) and the Draft Board (scouting before Draft Day), design 10.6.
 * One focused flow screen (docs/handoff/FLOW-UX.md): header strip (Round · Pick · On the clock · Your next pick ·
 * Scouts left), a dense paged table of rookies with a one-row position filter, a detail card for the selected rookie
 * (Scout button), recent picks as a ticker in the bottom bar, ONE primary bottom-right:
 *   on the clock → "Draft J. Name" (btn-draft-pick) · done → NEXT (btn-next, "Market"). After each pick the other teams
 *   pick right away (Draft.simToUser), so there is no "sim" press; "Sim to my pick" (btn-draft-sim-to-me) is only a fallback.
 * Secondary: "Auto draft" (btn-draft-auto, confirm). Rows: draft-row-{pid} (tap = select).
 * Fog: Stars range from Draft.board().shown, Growth "?" (scout 0) / two letters (1) / exact (2), Speed always exact.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp, FK = () => UI.FlowKit;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;
  const Dr = () => PT.League.Draft;

  const BOARD_CAP = 96;
  const ui = { filter: '', sel: null, auto: null, revealed: '' };

  function status(lg) {
    try { return lg.draft && Dr() && Dr().status ? Dr().status(lg) : null; } catch (e) { return null; }
  }
  function board(lg, pos) {
    try { return Dr().board(lg, { pos: pos || undefined }) || []; } catch (e) { return []; }
  }
  function scoutPts(lg) { return (lg.scout && lg.scout.pts) || 0; }
  function scLevel(p) { return (p.pr && p.pr.sc) || 0; }
  function needs(lg) {
    try { if (Dr().needs) return Dr().needs(lg, lg.userTid) || {}; } catch (e) { /* fallback below */ }
    return {};
  }
  /** Growth as the fog allows: '?' · 'B–A' · 'A' */
  function growthShown(lg, p) {
    if (!p.pr) return p.gl;
    try { return Dr().view(lg, p).gl; } catch (e) { return scLevel(p) >= 2 ? p.gl : '?'; }
  }
  function growthChip(g) {
    if (g.indexOf('–') > 0) return html`<span class="growth g-b fl-g2" title="Growth">${g}</span>`;
    return K().growth(g);
  }
  /** suggested pick for the user (what Auto would take) */
  function suggest(lg) {
    try { return PT.League.AIGM.chooseDraftPick(lg, lg.userTid); } catch (e) { const b = board(lg); return b.length ? b[0].p.id : null; }
  }

  // ---------------- pieces ----------------
  function header(lg, st) {
    const F = FK();
    const scouts = F.seg('Scouts left', String(scoutPts(lg)), { icon: 'scope', cls: 'fl-seg-gold', testid: 'draft-scouts' });
    if (!lg.draft || lg.phase !== 'DRAFT') {
      return F.head(html`${F.seg('', 'Draft Board', { icon: 'grad', cls: 'fl-seg-t' })}${F.seg('Draft Day', 'after Keep Players', { cls: 'fl-seg-dim' })}${F.gap()}${scouts}`);
    }
    if (!st || st.done) {
      const n = lg.draft.order.filter((o) => o.tid === lg.userTid && o.pid != null).length;
      void n;
      return F.head(html`${F.seg('', 'Draft done', { icon: 'check', cls: 'fl-seg-t' })}${F.gap()}`);
    }
    const on = lg.teams[st.pick.tid], mine = st.userOnClock;
    const clock = html`<span class="fl-seg fl-clock ${mine ? 'me' : ''}" data-testid="draft-clock"><span class="fl-sl">On the clock</span>${mine ? html`<b class="fl-sv">You</b>` : html`${K().badge(on, 's')}<b class="fl-sv">${FK().team(on)}</b>`}</span>`;
    const nextPk = mine ? '' : st.next ? F.seg('Your next pick', '#' + st.next) : F.seg('Your picks', 'Done', { cls: 'fl-seg-dim' });
    return F.head(html`${F.seg('Round', String(st.pick.rd), { cls: 'fl-seg-t', testid: 'draft-round' })}${F.seg('Pick', String(st.pick.pk), { cls: 'fl-seg-t' })}${clock}${F.gap()}${nextPk}${scouts}`);
  }

  function ticker(lg, st) {
    if (!st || !st.recent || !st.recent.length) return '';
    return html`<div class="fl-tick" aria-label="Last pick"><span class="fl-tick-l">Last pick</span>${st.recent.slice(0, 1).map((r) => {
      const p = PT.League.Q.player(lg, r.pid), t = lg.teams[r.tid];
      return html`<span class="fl-ti ${r.tid === lg.userTid ? 'me' : ''}"><b class="num">#${r.pk}</b>${K().badge(t, 's')}<span>${p ? K().short(p) : ''}</span>${p ? K().posChip(p.pos) : ''}</span>`;
    })}</div>`;
  }

  function cols(done) {
    return [
      { k: 'name', label: 'Name', cls: 'c-name' }, { k: 'pos', label: 'Pos', cls: 'c-pos' }, { k: 'stars', label: 'Stars', cls: 'c-stars' },
      { k: 'age', label: 'Age', cls: 'c-age c-c' }, { k: 'gr', label: K().ic('sprout'), cls: 'c-gr c-c' },
      done ? { k: 'pk', label: 'Pick', cls: 'c-tag' } : { k: 'need', label: 'Need', cls: 'c-tag' }
    ];
  }

  function rowOf(lg, x, nd, sel) {
    const p = x.p, sc = scLevel(p);
    return { id: p.id, testid: 'draft-row-' + p.id, sel: sel === p.id, cls: 'sc-' + sc,
      cells: { name: FK().name(p), pos: K().posChip(p.pos), stars: sc >= 2 ? FK().stars(p.ovr) : FK().range(x.shown.ovr[0], x.shown.ovr[1]),
        age: html`<span class="num">${p.age}</span>`, gr: growthChip(x.shown.gl), need: nd[p.pos] ? FK().tag('Need', 'red') : '' } };
  }

  function detail(lg, p, x, st, nd) {
    if (!p) return html`<aside class="fl-card fl-side fl-side-empty"><p class="fl-empty">Tap a rookie.</p></aside>`;
    const v = x ? x.shown : null;
    const sc = scLevel(p), drafted = !p.pr || p.tid >= 0;
    const g = drafted ? p.gl : (v ? v.gl : '?');
    const stars = drafted || sc >= 2 ? FK().stars(p.ovr) : FK().range(v.ovr[0], v.ovr[1]);
    const scoutBtn = drafted ? '' : K().btn({ label: sc >= 2 ? 'Fully scouted' : 'Scout', sub: sc >= 2 ? '' : '1 point', icon: 'scope', action: 'scout', data: { pid: p.id }, kind: 'gold', size: 'm', testid: 'btn-scout', cls: 'fl-sbtn', disabled: sc >= 2 || scoutPts(lg) <= 0 });
    const tip = !drafted && st && st.userOnClock && ui.auto === p.id ? html`<p class="fl-note fl-hint good">${K().ic('check')} Scouts like him.</p>`
      : nd[p.pos] && !drafted ? html`<p class="fl-note fl-hint">${FK().tag('Need', 'red')} Your ${p.pos} spot is weak.</p>` : '';
    const more = sc >= 2 || drafted ? html`<div class="fl-more">${K().want(p.want)}${K().traits(p)}</div>` : html`<p class="fl-note dim fl-more">${sc ? 'Scout again for the full report.' : 'Scout him to see more.'}</p>`;
    return html`<aside class="fl-card fl-side" data-testid="draft-detail">
      <div class="fl-who">${K().portrait(p, 56, 0x8a8fb3)}<div class="fl-who-t"><b class="fl-pn">${p.fn} ${p.ln}</b>
        <span class="fl-pm">${K().posChip(p.pos)}<span>${K().posLabel(p.pos)}</span><span class="dim">Age ${p.age}</span></span></div></div>
      <dl class="fl-facts">
        <div><dt>Stars</dt><dd>${stars}</dd></div>
        <div><dt>Growth</dt><dd>${growthChip(g)}</dd></div>
        <div><dt>Speed</dt><dd><b class="num">${p.r.spd}</b></dd></div>
        ${p.pr && p.pr.sch ? html`<div class="fl-f-sch"><dt>School</dt><dd>${p.pr.sch}</dd></div>` : ''}
      </dl>
      ${tip}${more}
      ${scoutBtn}
    </aside>`;
  }

  // ---------------- mount ----------------
  function mount(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    FK().noSub(el);
    const st = status(lg);
    const live = lg.phase === 'DRAFT' && st && !st.done;
    const done = lg.phase === 'DRAFT' && st && st.done;
    const nd = needs(lg);
    let list, rows;
    if (done) {
      list = lg.draft.order.filter((o) => o.tid === lg.userTid && o.pid != null).map((o) => ({ o: o, p: PT.League.Q.player(lg, o.pid) })).filter((x) => x.p);
      if (ui.sel == null || !list.some((x) => x.p.id === ui.sel)) ui.sel = list.length ? list[0].p.id : null;
      rows = list.map((x) => ({ id: x.p.id, testid: 'draft-row-' + x.p.id, sel: ui.sel === x.p.id,
        cells: { name: FK().name(x.p), pos: K().posChip(x.p.pos), stars: FK().stars(x.p.ovr), age: html`<span class="num">${x.p.age}</span>`, gr: K().growth(x.p.gl), pk: FK().tag('R' + x.o.rd + ' #' + x.o.pk, 'ink') } }));
    } else {
      list = board(lg, ui.filter).slice(0, BOARD_CAP);
      const pickKey = (lg.draft ? lg.sub : 'b') + ':' + ui.filter;
      if (live && st.userOnClock && ui.revealed !== pickKey) {
        ui.auto = suggest(lg);
        if (ui.auto != null && (!ui.filter || list.some((x) => x.p.id === ui.auto))) ui.sel = ui.auto;
      }
      const all = board(lg);
      if (ui.sel == null || !all.some((x) => x.p.id === ui.sel)) ui.sel = list.length ? list[0].p.id : null;
      rows = list.map((x) => rowOf(lg, x, nd, ui.sel));
    }
    const selP = ui.sel != null ? PT.League.Q.player(lg, ui.sel) : null;
    const selX = selP && selP.pr ? board(lg).find((x) => x.p.id === selP.id) : null;
    const filter = done ? html`<span class="fl-bar-t">Your rookies</span>` : FK().filter({
      value: ui.filter, title: 'Position',
      list: [{ id: '', label: 'All' }].concat(PT.C.POS.map((pos) => ({ id: pos, label: pos, dot: !!nd[pos], title: K().posLabel(pos) + (nd[pos] ? ' (need)' : '') }))),
      testid: (id) => 'draft-filter-' + (id || 'all'), pick: (v) => setFilter(v)
    });
    const table = FK().table({ key: 'board', cols: cols(done), rows: rows, tools: filter, cls: 'fl-t-draft' + (done ? ' done' : ''),
      empty: html`<p class="fl-empty">${done ? 'No picks this year.' : 'No rookies here.'}</p>` });
    const tipLine = live || !lg.draft ? FK().tip('fl-draft', 'Tap a rookie. Scout him to narrow his Stars.') : '';
    const body = html`${header(lg, st)}${tipLine}<div class="fl-main">${table}${detail(lg, selP, selX, st, nd)}</div>`;
    let sec = '', pri = '';
    if (live) {
      sec = FK().sec({ label: 'Auto draft', icon: 'robot', action: 'auto', testid: 'btn-draft-auto' });
      pri = st.userOnClock
        ? FK().pri({ label: selP ? 'Draft ' + K().short(selP) : 'Draft', icon: 'grad', action: 'pick', testid: 'btn-draft-pick', disabled: !selP || !selP.pr })
        : FK().pri({ label: st.next ? 'Sim to my pick' : 'Finish draft', sub: st.next ? 'Pick #' + st.next : '', icon: 'ff', action: 'simme', testid: 'btn-draft-sim-to-me' });
    } else if (done) pri = FK().next();
    const foot = live || done ? FK().foot(live ? ticker(lg, st) : '', sec, pri) : null;
    D().set(el, K().layout(body, foot, 'fit flow fl-draft'));
    // a new pick (or filter) starts on the page that shows the selected rookie
    const key = (lg.draft ? lg.sub : 'b') + ':' + ui.filter;
    if (ui.revealed !== key) {
      ui.revealed = key;
      if (UI.fit) UI.fit(el);
      if (ui.sel != null && UI.pgReveal) UI.pgReveal('draft-row-' + ui.sel);
    }
  }

  function setFilter(v) { ui.filter = v || ''; if (UI.pgPage) UI.pgPage('board', 0); UI.refresh(); }
  function changed(what) { if (PT.Events) PT.Events.emit('league:changed', { what: what || 'draft' }); UI.refresh(); }

  function doScout(pid) {
    const lg = L();
    if (scoutPts(lg) <= 0) { UI.Toast.show('No scout points left.', 'bad'); return; }
    let r;
    try { r = Dr().scout(lg, pid); } catch (e) { r = { ok: false, msg: 'Scout is busy.' }; }
    if (!r || !r.ok) { UI.Toast.show((r && r.msg) || 'Could not scout.', 'bad'); return; }
    UI.Toast.show('Scouted', 'good');
    changed('scout');
  }

  function doPick(pid) {
    const lg = L();
    const p = PT.League.Q.player(lg, pid);
    let r;
    try { r = Dr().pick(lg, pid); } catch (e) { r = { ok: false, msg: 'Pick failed.' }; }
    if (r && r.ok) {
      ui.sel = null;
      // no decision until your next pick: the other teams pick right away (client: fewer Next presses)
      let st = null;
      try { if (!Dr().status(lg).done) Dr().simToUser(lg); st = Dr().status(lg); } catch (e) { st = null; }
      UI.Toast.show((p ? K().pname(p) : 'Rookie') + ' drafted' + (st && st.userOnClock ? ". You're up again." : ''), 'good');
      const v = D().$('#screen .lay');
      if (v) K().confetti(v, 50);
    } else UI.Toast.show((r && r.msg) || 'Pick failed.', 'bad');
    changed('draft');
  }

  UI.screens.draft = {
    title: () => (PT.App.L && PT.App.L.phase === 'DRAFT' ? 'Draft Day' : 'Draft Board'),
    nav: 'market',
    mount: (el) => mount(el),
    actions: FK().withActions({
      row: (el) => { ui.sel = +el.getAttribute('data-pid'); UI.refresh(); },
      filter: (el) => setFilter(el.getAttribute('data-pos')),
      scout: (el) => doScout(+el.getAttribute('data-pid')),
      pick: () => { if (ui.sel != null) doPick(ui.sel); },
      simme: () => {
        const lg = L();
        let r = null;
        try { r = Dr().simToUser(lg); } catch (e) { r = null; }
        const st = status(lg);
        UI.Toast.show(st && st.done ? 'Draft complete' : st && st.userOnClock ? "You're on the clock" : 'Picks made.', 'good');
        changed('draft');
        return r;
      },
      auto: () => {
        UI.Modal.confirm('Auto draft the rest?', { body: 'Your scouts make your picks.', icon: 'robot', yes: 'Auto draft', no: 'Cancel' }).then((ok) => {
          if (!ok) return;
          try { Dr().autoRest(L()); } catch (e) { UI.Toast.show('Auto draft failed.', 'bad'); }
          ui.sel = null;
          changed('draft');
        });
      }
    })
  };
})(globalThis.PT = globalThis.PT || {});
