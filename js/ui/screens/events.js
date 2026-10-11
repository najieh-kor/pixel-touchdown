/* Pixel Touchdown: js/ui/screens/events.js
 * Owner: WP5. Responsibility: between-week event modal(s) (design 11).
 * Shows each pending event as a big card: art (player portrait or team badge), title, 1–2 lines, 2–3 choice buttons
 * (event-choice-{i}); then a result card with effect icons and OK (btn-event-ok) → next event or back to the flow.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const st = { result: null };
  const FX = {
    mor: ['ok', 'Mood'], hype: ['flame', 'Hype'], coins: ['coin', 'Coins'], cash: ['coin', 'Coins'], spirit: ['heart', 'Team Spirit'], boss: ['happy', 'Boss'],
    rat: ['dumbbell', 'Skill'], teamMor: ['happy', 'Team Mood'], inj: ['cross', 'Hurt'], fans: ['flame', 'Hype'], job: ['happy', 'Boss'], xp: ['star', 'Coach XP']
  };

  function pending(L) {
    const W = PT.League.WeeklyEvents;
    try { if (W && W.pending) return W.pending(L) || []; } catch (e) { /* fall back */ }
    return (L.ev && L.ev.pending || []).map((e) => ({ iid: e.iid, title: 'Team News', text: 'A decision is waiting.', choices: [{ label: 'OK', hint: '' }], art: { pid: e.pid } }));
  }

  function art(L, ev) {
    const a = ev.art || {};
    const p = a.pid != null ? PT.League.Q.player(L, a.pid) : null;
    if (p) return html`<div class="ev-art">${K().portrait(p, 120)}<span class="ev-who">${K().pname(p)}</span></div>`;
    const t = L.teams[L.userTid];
    return html`<div class="ev-art">${K().badge(t, 'xl')}</div>`;
  }

  function effects(list) {
    if (!list || !list.length) return '';
    return html`<div class="ev-fx">${list.map((f) => {
      const x = FX[f.k] || ['sparkle', f.k];
      const n = f.n == null ? '' : (f.n > 0 ? '+' + f.n : String(f.n));
      const L = PT.App.L;
      const who = f.pid != null && L ? PT.League.Q.player(L, f.pid) : null;
      return html`<span class="chip ${f.n > 0 ? 'chip-green' : f.n < 0 ? 'chip-red' : ''}">${K().ic(x[0])} ${x[1]} <b class="num">${n}</b>${who ? html` <span class="tiny">(${who.fn})</span>` : ''}</span>`;
    })}</div>`;
  }

  function mount(el) {
    const L = PT.App.L;
    if (st.result) {
      const r = st.result;
      D().set(el, K().layout(html`<section class="card ev-card ev-res">
        <div class="micon">${K().ic(r.ok === false ? 'question' : 'party')}</div>
        <h2 class="ev-title">${r.title || 'Done'}</h2>
        <p class="ev-text">${r.resultText || r.msg || 'Done.'}</p>
        ${effects(r.effects)}
      </section>`, K().btn({ label: 'OK', icon: 'check', action: 'ok', kind: 'go', size: 'xl', testid: 'btn-event-ok', cls: 'btn-wide' }), 'fit nsa events'));
      return;
    }
    const list = pending(L);
    if (!list.length) {
      D().set(el, K().layout(K().empty('news', 'No news right now.'), K().btn({ label: 'Back', action: 'done', kind: 'go', size: 'l', cls: 'btn-wide', testid: 'btn-event-done' }), 'fit nsa events'));
      return;
    }
    const ev = list[0];
    const btns = (ev.choices || []).map((c, i) => K().btn({ label: c.label, sub: c.hint || '', action: 'choose', data: { iid: ev.iid, i: i },
      kind: i === 0 ? 'go' : 'sec', size: 'l', testid: 'event-choice-' + i, disabled: c.disabled || c.can === false, cls: 'btn-wide ev-choice' }));
    // ROUND6 "0 scrolling": story on the left, choices on the right
    D().set(el, K().layout(html`
      <section class="card ev-card evx">
        <div class="evx-story">
          ${list.length > 1 ? html`<p class="ev-count">${K().ic('megaphone')} ${list.length} decisions waiting</p>` : ''}
          ${art(L, ev)}
          <h2 class="ev-title">${ev.title}</h2>
          <p class="ev-text">${ev.text}</p>
        </div>
        <div class="ev-choices">${btns}</div>
      </section>`, null, 'fit nsa events'));
  }

  UI.screens.events = {
    title: 'Team News',
    chrome: 'head',
    back: false,
    mount: mount,
    unmount: () => { st.result = null; },            // QA1: Esc/back left a stale result card for the next event
    actions: {
      choose: (el) => {
        const L = PT.App.L;
        const iid = +el.getAttribute('data-iid'), i = +el.getAttribute('data-i');
        const ev = pending(L).find((x) => x.iid === iid);
        let r;
        try { r = PT.League.WeeklyEvents.choose(L, iid, i); }
        catch (e) { r = { ok: false, msg: 'Something went wrong. Try again.' }; if (PT.Log) PT.Log.error('ui', 'event choose', e); }
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Not possible.', 'bad'); return; }
        st.result = Object.assign({ title: ev ? ev.title : '' }, r || {});
        if (PT.Events) PT.Events.emit('league:changed', { what: 'event' });
        UI.updateHead();
        UI.refresh();
      },
      ok: () => {
        st.result = null;
        const L = PT.App.L;
        if (pending(L).length) UI.refresh();
        else UI.Flow.goPhase();
      },
      done: () => UI.Flow.goPhase()
    }
  };
})(globalThis.PT = globalThis.PT || {});
