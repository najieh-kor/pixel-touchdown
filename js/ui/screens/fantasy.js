/* Pixel Touchdown: js/ui/screens/fantasy.js
 * Owner: FEATURES / INT2. Responsibility: "Star Draft" screen (PT.League.Fantasy). Client change: the user drafts
 * 8 rounds and every pick becomes one of his 8 Stars (>= 2 offense, >= 2 defense); the rest of the roster auto-fills
 * with normal players after round 8. One screen, no scrolling: the clock + Stars count on the left, the paged pool right;
 * after the draft a one-screen summary "Your 8 Stars" + "Roster filled with N players".
 * Reuses the Draft Day look (dr-* classes, K.playerRow, position chips): an on-the-clock card, your position needs,
 * recent picks, and the player pool with filters. Players show true Stars (they are pros, no scouting fog).
 * When the draft is done it shows your new roster and "Start Preseason" (→ HQ, normal Preseason flow).
 * testids: fd-row-{pid}, fd-filter-{pos|all}, btn-fd-pick, btn-fd-autopick, btn-fd-sim, btn-fd-auto, btn-fd-more, btn-fd-done.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const F = () => PT.League.Fantasy;
  /** ROUND6: each paged row sits in a .pg-cell so its pixel frame + drop shadow count toward the measured height */
  const cells = (rows) => rows.map((r) => html`<div class="pg-cell">${r}</div>`);
  const ic = (n) => (UI.Icons && UI.Icons.get ? UI.Icons.get(n) : null) || undefined;

  let filter = '', showN = 24;

  function changed() { PT.Events.emit('league:changed', { what: 'fantasy' }); UI.refresh(); }

  const SMIN = () => PT.C.STAR_MIN_SIDE || 2;
  /** the user's picks so far (= his Stars) and the 2/2 side rule */
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
    const total = Math.min(L.fd.n || 8, PT.C.STAR_MAX || 8), left = Math.max(0, total - mine.length);
    const needOff = Math.max(0, SMIN() - c.off), needDef = Math.max(0, SMIN() - c.def);
    const forced = left > 0 && needDef > 0 && needDef >= left ? 'def' : left > 0 && needOff > 0 && needOff >= left ? 'off' : '';
    return { mine: mine, off: c.off, def: c.def, total: total, left: left, forced: forced, needOff: needOff, needDef: needDef };
  }

  function clock(L, st) {
    const on = st.pick ? L.teams[st.pick.tid] : null;
    const mine = st.userOnClock, ss = starState(L);
    return html`<section class="card dr-clock fd-clock ${mine ? 'up' : ''}" style="${on ? K().teamVars(on) : ''}">
      <div class="dr-head">
        ${on ? K().badge(on, 'l') : ''}
        <div class="grow">
          <div class="dr-pick num" data-testid="fd-round">Round ${st.pick.rd}/${L.fd.n}</div>
          <p class="dr-who">${mine ? 'You’re on the clock.' : (on ? on.name + ' are picking…' : '')}</p>
        </div>
      </div>
      <p class="fd-stars" data-testid="fd-stars">${K().starTag()} <b>Your Stars ${ss.mine.length}/${ss.total}</b> <span class="small">(Off ${ss.off} · Def ${ss.def})</span></p>
      ${ss.forced ? html`<p class="fd-force" role="status" data-testid="fd-force">Pick a ${ss.forced === 'def' ? 'defense' : 'offense'} Star — you need ${SMIN()}.</p>` : html`<p class="tiny fd-tip">Every pick is a Star. Need ${SMIN()} offense + ${SMIN()} defense.</p>`}
      <div class="btn-row dr-btns">
        ${mine ? K().btn({ label: 'Auto Pick', icon: ic('target'), action: 'autopick', kind: 'gold', size: 'm', testid: 'btn-fd-autopick' })
          : K().btn({ label: 'Sim to My Pick', icon: ic('ff'), action: 'simme', kind: 'pri', size: 'm', testid: 'btn-fd-sim' })}
        ${K().btn({ label: 'Auto Draft', icon: ic('robot'), action: 'auto', kind: 'sec', size: 'm', testid: 'btn-fd-auto' })}
      </div>
    </section>`;
  }

  function recent(L, st) {
    if (!st.recent.length) return '';
    return html`<div class="dr-recent" aria-label="Recent picks">${st.recent.map((r) => {
      const p = PT.League.Q.player(L, r.pid), t = L.teams[r.tid];
      return html`<div class="dr-rp ${r.tid === L.userTid ? 'me' : ''}">${K().badge(t, 's')}<span class="dr-rp-t"><b class="num">#${r.pk}</b> ${p ? K().short(p) : ''}${r.tid === L.userTid ? K().starTag() : ''}</span>${p ? K().posChip(p.pos) : ''}</div>`;
    })}</div>`;
  }

  function filters(st) {
    void st;
    return html`<div class="fchips" role="toolbar" aria-label="Position">${[''].concat(PT.C.POS.filter((x) => x !== 'K')).map((pos) => html`<button type="button" class="fchip ${filter === pos ? 'on' : ''}" data-action="filter" data-pos="${pos}" data-testid="fd-filter-${pos || 'all'}">${pos || 'All'}</button>`)}</div>`;
  }

  // ROUND6 0-scroll: clock + needs + buttons on the left, the player pool as a paged grid on the right
  function doneView(L) {
    const t = L.teams[L.userTid];
    let stars = K().teamStars(t);
    if (!stars.length && L.fd.mine) stars = L.fd.mine.slice(0, PT.C.STAR_MAX || 8);
    const sp = stars.map((pid) => PT.League.Q.player(L, pid)).filter(Boolean);
    const filled = Math.max(0, PT.League.Q.roster(L, L.userTid).length - sp.length);
    const tile = (p) => { const a = K().ABILITY[K().abilityKind(p.pos)];
      return html`<div class="star-chip fd-star" data-testid="fd-star-${p.id}">${K().portrait(p, 40, t.col.pri)}<span class="star-chip-m"><b class="star-chip-n">${K().short(p)}</b><span class="tiny">${K().posChip(p.pos)} ${a ? html`<span class="star-ab" title="${a.name}">${K().ic(a.icon)}<span class="star-ab-n">${a.name}</span></span>` : ''}</span></span></div>`; };
    const body = html`<div class="fd-done">
      <h2 class="fd-done-t">${K().starTag()} Your ${sp.length} Stars</h2>
      ${K().pg('fdstars', sp.map(tile), { grid: true, cls: 'star-pg fd-stars-pg' })}
      <p class="fd-done-sub" data-testid="fd-filled">Roster filled with ${filled} players ${K().stars(K().teamOvr(L.userTid), { team: true })}</p>
    </div>`;
    return K().layout(body, K().btn({ label: 'Start Season', icon: ic('play'), action: 'done', kind: 'go', size: 'xl', testid: 'btn-fd-done', cls: 'btn-wide' }), 'fit nsb draft fantasy fd-done-lay');
  }

  function mount(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    if (!L.fd) { UI.reset(); return; }
    if (L.fd.done) { D().set(el, doneView(L)); return; }
    const st = F().status(L);
    const ss = starState(L);
    const b = F().board(L, { pos: filter || undefined }).filter((x) => x.p.pos !== 'K' && (!ss.forced || K().starSide(x.p.pos) === ss.forced));
    const rows = b.slice(0, showN).map((x) => { const a = K().ABILITY[K().abilityKind(x.p.pos)];
      return K().playerRow(x.p, { action: 'row', testid: 'fd-row-' + x.p.id, team: null,
        right: html`<span class="dr-rank num">#${x.rank}</span>${a ? html`<span class="star-ab small" title="Surge: ${a.name}">${K().ic(a.icon)}</span>` : ''}` }); });
    if (b.length > showN) rows.push(K().btn({ label: 'Show More', sub: (b.length - showN) + ' more players', action: 'more', kind: 'sec', size: 'm', testid: 'btn-fd-more', cls: 'btn-wide fd-more' }));
    void st.need;
    const body = html`<div class="fd-cols">
      <div class="fd-side">${clock(L, st)}${recent(L, st)}</div>
      <div class="fd-main">
        <div class="fd-bar"><span class="fd-cnt small"><b>Players</b> <span class="num">${b.length}</span></span>${filters(st)}</div>
        ${K().pg('fdpool', cells(rows), { grid: true, cls: 'fd-pg' })}
      </div>
    </div>`;
    D().set(el, K().layout(body, null, 'fit nsb draft fantasy'));
  }

  function detail(pid) {
    const L = PT.App.L, p = PT.League.Q.player(L, pid);
    if (!p) return;
    const st = F().status(L);
    const a = K().ABILITY[K().abilityKind(p.pos)];
    const body = html`<div class="dr-detail">
      <div class="offer-who">${K().portrait(p, 72, 0x8a8fb3)}<div class="grow"><b class="offer-n">${K().pname(p)}</b>
        <div class="row wrap small">${K().posChip(p.pos)} <span>${K().posLabel(p.pos)}</span> <span class="muted">${K().spName(p.sp)} · Age ${p.age}</span></div></div></div>
      <div class="dr-facts">
        <div><span class="field-l">Stars</span>${K().stars(p.ovr)}</div>
        <div><span class="field-l">Growth</span>${K().growth(p.gl)}</div>
        <div><span class="field-l">Speed</span><b class="num">${p.r.spd}</b></div>
      </div>
      <div class="row wrap">${K().traits(p)}</div>
      ${a ? html`<p class="small star-ab">${K().starTag()} Surge: ${K().ic(a.icon)} <b>${a.name}</b> · ${a.txt}</p>` : ''}
    </div>`;
    const btns = st.userOnClock ? [{ label: 'Make Him a Star', value: 'pick', kind: 'go', testid: 'btn-fd-pick' }]
      : [{ label: 'Not Your Pick', value: null, kind: 'sec', testid: 'btn-fd-pick', disabled: true }];
    btns.push({ label: 'Close', value: null, kind: 'cancel' });
    UI.Modal.open({ title: st.userOnClock ? 'On the Clock' : 'Player', body: body, buttons: btns, cls: 'm-draft' }).then((v) => { if (v === 'pick') doPick(pid); });
  }

  function doPick(pid) {
    const L = PT.App.L, p = PT.League.Q.player(L, pid);
    const r = F().pick(L, pid);
    if (r && r.ok) {
      UI.Toast.show((p ? K().short(p) : 'He') + ' is your Star', 'good');
      F().simToUser(L);                           // the other teams pick right away, back to you
    }
    else UI.Toast.show((r && r.msg) || 'Pick failed.', 'bad');
    changed();
  }

  UI.screens.fantasy = {
    title: 'Star Draft',
    chrome: 'head',
    back: false,
    mount: mount,
    actions: {
      row: (el) => detail(+el.getAttribute('data-pid')),
      filter: (el) => { filter = el.getAttribute('data-pos') || ''; showN = 24; UI.refresh(); },
      more: () => { showN += 24; UI.refresh(); },
      simme: () => {
        const r = F().simToUser(PT.App.L);
        UI.Toast.show(PT.App.L.fd.done ? 'Draft complete' : r.userOnClock ? 'You’re on the clock' : 'Picks made.', 'good');
        changed();
      },
      autopick: () => { const pid = F().choose(PT.App.L, PT.App.L.userTid); if (pid != null) doPick(pid); },
      auto: () => {
        UI.Modal.confirm('Auto Draft the rest?', { body: 'Your scouts pick your remaining Stars and fill the roster.' }).then((ok) => {
          if (!ok) return;
          const busy = UI.Modal.busy('Drafting…');
          setTimeout(() => {
            try { F().autoRest(PT.App.L); } catch (e) { if (PT.Log) PT.Log.error('ui', 'fantasy auto', e); }
            busy.close();
            PT.App.save({ auto: true });
            UI.Toast.show('Draft complete', 'good');
            changed();
          }, 30);
        });
      },
      done: () => { PT.App.save({}); UI.reset(); }
    }
  };
})(globalThis.PT = globalThis.PT || {});
