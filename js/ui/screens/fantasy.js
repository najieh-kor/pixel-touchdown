/* Pixel Touchdown: js/ui/screens/fantasy.js
 * Owner: FLOW-UX (was FEATURES / INT2). "Star Draft" (PT.League.Fantasy): 8 snake rounds, every pick becomes one of the
 * user's 8 Stars (>= 2 offense, >= 2 defense); after round 8 the rest of the roster auto-fills with normal players.
 * Same flow layout as Draft Day (docs/handoff/FLOW-UX.md): header strip "Round 3/8 · On the clock · Your Stars 2/8
 * (Off 1 · Def 1)", the 2/2 rule as one red line when it forces a side, a dense paged pool table, a detail card with the
 * Surge ability, ONE primary bottom-right ("Pick J. Name" on the clock, else "Sim to my pick"), secondary "Auto draft".
 * After the draft: a one-screen summary "Your 8 Stars" + "Roster filled with N players" → "Start Season".
 * testids: fd-row-{pid}, fd-filter-{pos|all}, fd-round, fd-stars, fd-force, btn-fd-pick, btn-fd-sim, btn-fd-auto,
 * btn-fd-done, fd-star-{pid}, fd-filled.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp, FK = () => UI.FlowKit;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const F = () => PT.League.Fantasy;

  const POOL_CAP = 120;
  const ui = { filter: '', sel: null, auto: null, at: -1 };
  const SMIN = () => PT.C.STAR_MIN_SIDE || 2;

  function changed() { PT.Events.emit('league:changed', { what: 'fantasy' }); UI.refresh(); }

  function myStars(L) {
    const fd = L.fd, out = [];
    if (fd.done && fd.mine) return fd.mine.slice();
    (fd.picks || []).forEach((pid, i) => { if (F().tidAt(L, i) === L.userTid) out.push(pid); });
    return out;
  }
  function starState(L) {
    const mine = myStars(L).map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const c = { off: 0, def: 0 };
    mine.forEach((p) => { const sd = K().starSide(p.pos); if (sd) c[sd]++; });
    return { mine: mine, off: c.off, def: c.def, total: Math.min(L.fd.n || 8, PT.C.STAR_MAX || 8) };
  }
  /** Surge ability; Lockdown shows a shield here (a padlock read as "locked" in the pool table) */
  const ability = (p) => { const k = K().abilityKind(p.pos), a = K().ABILITY[k]; return a ? Object.assign({}, a, k === 'lockdown' ? { icon: 'shield' } : {}) : null; };

  function header(L, st, ss) {
    const Fk = FK();
    const on = st.pick ? L.teams[st.pick.tid] : null, mine = st.userOnClock;
    const clock = html`<span class="fl-seg fl-clock ${mine ? 'me' : ''}"><span class="fl-sl">On the clock</span> ${mine ? html`<b class="fl-sv">You</b>` : html`${K().badge(on, 's')}<b class="fl-sv">${Fk.team(on)}</b>`}</span>`;
    const stars = html`<span class="fl-seg fl-seg-gold" data-testid="fd-stars">${K().ic('star')}<span class="fl-sl">Your Stars</span> <b class="fl-sv">${ss.mine.length}/${ss.total}</b> <span class="fl-sx">(Off ${ss.off} · Def ${ss.def})</span></span>`;
    return Fk.head(html`${Fk.seg('Round', (st.pick ? st.pick.rd : L.fd.n) + '/' + L.fd.n, { cls: 'fl-seg-t', testid: 'fd-round' })}${clock}${Fk.gap()}${stars}`);
  }

  /** HUNT5 #7: what happened since your last pick, in one line (the other teams' picks are otherwise invisible) */
  function sinceMine(L) {
    const fd = L.fd, n = (fd.picks || []).length;
    let last = -1;
    for (let j = n - 1; j >= 0; j--) if (F().tidAt(L, j) === L.userTid) { last = j; break; }
    if (last < 0) return '';
    const me = PT.League.Q.player(L, fd.picks[last]);
    const after = fd.picks.slice(last + 1).map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const c = {};
    after.forEach((p) => { c[p.pos] = (c[p.pos] || 0) + 1; });
    const top = Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 3).map((pos) => c[pos] + ' ' + pos).join(', ');
    return html`<p class="fl-ftip fl-since" data-testid="fd-since">${K().ic('star')}<span>You took <b>${me ? K().short(me) : ''}</b> (${me ? me.pos : ''})${after.length ? html` · then ${after.length} picks: ${top}` : ''}</span></p>`;
  }
  function ticker(L, st) {
    const s = sinceMine(L);
    if (s) return s;
    if (!st.recent || !st.recent.length) return '';
    return html`<div class="fl-tick" aria-label="Recent picks"><span class="fl-tick-l">Picks</span>${st.recent.slice(0, 4).map((r) => {
      const p = PT.League.Q.player(L, r.pid), t = L.teams[r.tid];
      return html`<span class="fl-ti ${r.tid === L.userTid ? 'me' : ''}"><b class="num">#${r.pk}</b>${K().badge(t, 's')}<span>${p ? K().short(p) : ''}</span>${p ? K().posChip(p.pos) : ''}</span>`;
    })}</div>`;
  }

  const COLS = [{ k: 'name', label: 'Name', cls: 'c-name' }, { k: 'pos', label: 'Pos', cls: 'c-pos' }, { k: 'stars', label: 'Rating', cls: 'c-stars' },
    { k: 'age', label: 'Age', cls: 'c-age c-c' }, { k: 'gr', label: K().ic('sprout'), cls: 'c-gr c-c' }, { k: 'ab', label: K().ic('bolt'), cls: 'c-ab c-c' }];

  function detail(L, p, x, st) {
    if (!p) return html`<aside class="fl-card fl-side fl-side-empty"><p class="fl-empty">Tap a player.</p></aside>`;
    const a = ability(p);
    const why = x && !x.ok ? x.why : (p.pos === 'K' ? 'A Kicker cannot be a Star.' : '');
    // HUNT5 #7: a 2nd Star at a one-starter spot sits on the bench
    const ONE = { QB: 1, RB: 1, TE: 1 };
    const dup = ONE[p.pos] && myStars(L).some((pid) => { const q = PT.League.Q.player(L, pid); return q && q.pos === p.pos; });
    return html`<aside class="fl-card fl-side" data-testid="fd-detail">
      <div class="fl-who">${K().portrait(p, 56, 0x8a8fb3)}<div class="fl-who-t"><b class="fl-pn">${p.fn} ${p.ln}</b>
        <span class="fl-pm">${K().posChip(p.pos)}<span>${K().posLabel(p.pos)}</span><span class="dim">Age ${p.age}</span></span></div></div>
      <dl class="fl-facts">
        <div><dt>Stars</dt><dd>${FK().stars(p.ovr)}</dd></div>
        <div><dt>Growth</dt><dd>${K().growth(p.gl)}</dd></div>
        <div><dt>Speed</dt><dd><b class="num">${p.r.spd}</b></dd></div>
        ${a ? html`<div><dt>Surge</dt><dd>${K().ic(a.icon)} ${a.name}</dd></div>` : ''}
      </dl>
      ${why ? html`<p class="fl-note bad">${K().ic('no')} ${why}</p>` : a ? html`<p class="fl-note fl-hint dim">${a.txt}</p>` : ''}
      ${!why && dup ? html`<p class="fl-note bad" data-testid="fd-dup">${K().ic('warn')} Only 1 ${p.pos} starts. He would sit.</p>` : ''}
      ${!why && st.userOnClock && ui.auto === p.id ? html`<p class="fl-note fl-hint good">${K().ic('check')} Best pick for you.</p>` : ''}
      <div class="fl-more">${K().traits(p)}</div>
    </aside>`;
  }

  // ---------------- after the draft: one-screen summary ----------------
  function doneView(L) {
    const t = L.teams[L.userTid];
    let stars = K().teamStars(t);
    if (!stars.length && L.fd.mine) stars = L.fd.mine.slice(0, PT.C.STAR_MAX || 8);
    const sp = stars.map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const filled = Math.max(0, PT.League.Q.roster(L, L.userTid).length - sp.length);
    const off = sp.filter((p) => K().starSide(p.pos) === 'off').length;
    const tile = (p) => { const a = ability(p);
      return html`<div class="fl-star" data-testid="fd-star-${p.id}">${K().portrait(p, 40, t.col.pri)}<span class="fl-l2"><b>${p.fn} ${p.ln}</b><span>${K().posChip(p.pos)}${a ? html`${K().ic(a.icon)} ${a.name}` : ''}</span></span></div>`; };
    const body = html`${FK().head(html`${FK().seg('', 'Star Draft done', { icon: 'check', cls: 'fl-seg-t' })}${FK().gap()}${FK().seg('Offense', String(off))}${FK().seg('Defense', String(sp.length - off))}`)}
      <section class="fl-card fl-stars-card"><div class="fl-bar"><span class="fl-bar-t">${K().starTag()} Your ${sp.length} Stars</span></div>
        <div class="fl-stars-grid">${sp.map(tile)}</div></section>`;
    const info = html`<p class="fl-done-sub" data-testid="fd-filled">Roster filled with ${filled} players</p>`;
    return K().layout(body, FK().foot(info, '', FK().pri({ label: 'Start Season', icon: 'play', action: 'done', testid: 'btn-fd-done' })), 'fit flow fl-star-scr fl-star-done');
  }

  function mount(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    if (!L.fd) { UI.reset(); return; }
    if (L.fd.done) { D().set(el, doneView(L)); return; }
    const st = F().status(L);
    const ss = starState(L);
    const all = F().board(L, {});
    const list = (ui.filter ? all.filter((x) => x.p.pos === ui.filter) : all.filter((x) => x.p.pos !== 'K')).slice(0, POOL_CAP);
    const visible = (pid) => pid != null && list.some((x) => x.p.id === pid);
    const bestVisible = () => { const ok = list.find((x) => x.ok); return ok ? ok.p.id : list.length ? list[0].p.id : null; };
    if (ui.at !== st.made) {                               // a new pick: select the best allowed player you can SEE
      ui.at = st.made;
      ui.auto = st.userOnClock ? F().choose(L, L.userTid) : null;
      ui.sel = visible(ui.auto) ? ui.auto : bestVisible();
    }
    // HUNT5 #1: the selection (detail card + PICK button) is always a row in the filtered list, never a hidden player
    if (!visible(ui.sel)) ui.sel = bestVisible();
    const rows = list.map((x) => { const a = ability(x.p);
      return { id: x.p.id, testid: 'fd-row-' + x.p.id, sel: ui.sel === x.p.id, cls: x.ok ? '' : 'dim',
        cells: { name: FK().name(x.p), pos: K().posChip(x.p.pos), stars: FK().stars(x.p.ovr), age: html`<span class="num">${x.p.age}</span>`, gr: K().growth(x.p.gl),
          ab: a ? html`<span class="fl-ab" title="${a.name}">${K().ic(a.icon)}</span>` : '' } }; });
    const selX = all.find((x) => x.p.id === ui.sel) || null;
    const selP = selX ? selX.p : null;
    const filter = FK().filter({ value: ui.filter, title: 'Position',
      list: [{ id: '', label: 'All' }].concat(PT.C.POS.filter((x) => x !== 'K').map((pos) => ({ id: pos, label: pos, title: K().posLabel(pos) }))),
      testid: (id) => 'fd-filter-' + (id || 'all'), pick: (v) => setFilter(v) });
    const table = FK().table({ key: 'fdpool', cols: COLS, rows: rows, tools: filter, cls: 'fl-t-star', empty: html`<p class="fl-empty">No players here.</p>` });
    const rule = st.why ? html`<div class="fl-tip fl-rule" role="status" data-testid="fd-force">${K().ic('warn')}<span class="fl-tip-t">${st.why}</span></div>`
      : FK().tip('fl-star', 'Every pick is a Star. ' + SMIN() + '+ offense, ' + SMIN() + '+ defense.');
    const body = html`${header(L, st, ss)}${rule}<div class="fl-main">${table}${detail(L, selP, selX, st)}</div>`;
    const canPick = !!(selX && selX.ok);
    const pri = st.userOnClock
      ? FK().pri({ label: selP ? 'Pick ' + K().short(selP) : 'Pick', icon: 'star', action: 'pick', testid: 'btn-fd-pick', disabled: !canPick })
      : FK().pri({ label: 'Sim to my pick', icon: 'ff', action: 'simme', testid: 'btn-fd-sim' });
    const sec = FK().sec({ label: 'Auto draft', icon: 'robot', action: 'auto', testid: 'btn-fd-auto' });
    D().set(el, K().layout(body, FK().foot(ticker(L, st), sec, pri), 'fit flow fl-star-scr'));
    if (ui.revealed !== st.made + ':' + ui.filter) {
      ui.revealed = st.made + ':' + ui.filter;
      if (UI.fit) UI.fit(el);
      if (ui.sel != null && UI.pgReveal) UI.pgReveal('fd-row-' + ui.sel);
    }
  }

  function setFilter(v) { ui.filter = v || ''; ui.sel = null; if (UI.pgPage) UI.pgPage('fdpool', 0); UI.refresh(); }

  function doPick(pid) {
    const L = PT.App.L, p = PT.League.Q.player(L, pid);
    const r = F().pick(L, pid);
    if (r && r.ok) {
      F().simToUser(L);                           // the other teams pick right away, back to you
      if (!L.fd.done) UI.Toast.show((p ? K().short(p) : 'He') + ' is your Star', 'good');
    } else UI.Toast.show((r && r.msg) || 'Pick failed.', 'bad');
    changed();
  }

  UI.screens.fantasy = {
    title: 'Star Draft',
    chrome: 'head',
    back: false,
    mount: mount,
    actions: FK().withActions({
      row: (el) => { ui.sel = +el.getAttribute('data-pid'); UI.refresh(); },
      filter: (el) => setFilter(el.getAttribute('data-pos')),
      pick: () => { if (ui.sel != null) doPick(ui.sel); },
      simme: () => {
        const r = F().simToUser(PT.App.L);
        UI.Toast.show(PT.App.L.fd.done ? 'Draft complete' : r.userOnClock ? 'You’re on the clock' : 'Picks made.', 'good');
        changed();
      },
      auto: () => {
        UI.Modal.confirm('Auto draft the rest?', { body: 'Your scouts pick your Stars and fill the roster.', icon: 'robot', yes: 'Auto draft', no: 'Cancel' }).then((ok) => {
          if (!ok) return;
          const busy = UI.Modal.busy('Drafting…');
          setTimeout(() => {
            try { F().autoRest(PT.App.L); } catch (e) { if (PT.Log) PT.Log.error('ui', 'fantasy auto', e); }
            busy.close();
            PT.App.save({ auto: true });
            changed();                      // the summary screen says it (no toast over its note)
          }, 30);
        });
      },
      done: () => { PT.App.save({}); UI.reset(); }
    })
  };
})(globalThis.PT = globalThis.PT || {});
