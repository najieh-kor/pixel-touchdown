/* Pixel Touchdown: js/ui/screens/events.js
 * Owner: FLOW-UX (was WP5). Between-week "Team News" (design 11) as one compact card (docs/handoff/FLOW-UX.md):
 * left = art (player portrait or team badge) + title + 1–2 short lines; right = 2–3 choice buttons, each with its
 * cost / effect tags (from WeeklyEvents.pending hint). No paragraphs. Then a result card with effect tags and OK.
 * testids: event-choice-{i}, btn-event-ok, btn-event-done.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp, FK = () => UI.FlowKit;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  const st = { result: null };
  /** result effect kinds → [icon, label, tone]; tone 'cost' = a positive number is bad (a raise costs Team Cash).
   * Kinds missing here (askAdj, tradeVal, oppEdge, tmAck) are invisible bookkeeping and are not shown. */
  const FX = {
    coins: ['coin', 'Coins'], hype: ['flame', 'Hype'], boss: ['happy', 'Boss'], spirit: ['heart', 'Spirit'], xp: ['star', 'Coach XP'],
    scout: ['scope', 'Scout pts'], merch: ['bag', 'Merch'], mor: ['ok', 'Mood'], teamMor: ['happy', 'Team Mood'], rat: ['dumbbell', 'Skill'],
    nx: ['bolt', 'Next game'], edge: ['bolt', 'Edge next game'], tix: ['ticket', 'Tickets'], cash: ['cash', 'Pay', 'cost'],
    injMult: ['cross', 'Owie risk'], snowImm: ['snow', 'Snow-proof'], gym: ['dumbbell', 'New gym'], inj: ['cross', 'hurt'], bench: ['cross', 'sits next game'],
    sign: ['contract', 'signed'], swap: ['swap', 'Swap']
  };
  const TAG_IC = [[/^Coins/, 'coin'], [/^Hype/, 'flame'], [/^Boss/, 'happy'], [/^Spirit/, 'heart'], [/^Coach XP/, 'star'], [/Mood/, 'ok'],
    [/Owie/, 'cross'], [/next game/, 'football'], [/^Edge/, 'bolt'], [/^Scout/, 'scope'], [/^Tickets/, 'ticket'], [/^Merch/, 'bag']];

  function pending(L) {
    const W = PT.League.WeeklyEvents;
    try { if (W && W.pending) return W.pending(L) || []; } catch (e) { /* fall back */ }
    return (L.ev && L.ev.pending || []).map((e) => ({ iid: e.iid, title: 'Team News', text: 'A decision is waiting.', choices: [{ label: 'OK', hint: '' }], art: { pid: e.pid } }));
  }

  function art(L, ev) {
    const a = ev.art || {};
    const p = a.pid != null ? PT.League.Q.player(L, a.pid) : null;
    if (p) return html`<div class="fl-ev-art">${K().portrait(p, 88)}</div>`;
    return html`<div class="fl-ev-art">${K().badge(L.teams[a.tid != null ? a.tid : L.userTid], 'l')}</div>`;
  }

  /** "Coins -30 · Team Mood +4" → small tags (green = good, red = bad) */
  function tags(hint) {
    if (!hint) return '';
    return hint.split(' · ').filter(Boolean).map((t) => {
      const m = /([+-]\d+)/.exec(t);
      const n = m ? +m[1] : 0;
      const ic = (TAG_IC.find((x) => x[0].test(t)) || [])[1];
      return FK().tag(html`${ic ? K().ic(ic) : ''}${t}`, /chance|%/i.test(t) ? 'blue' : n > 0 ? 'green' : n < 0 ? 'red' : '');
    });
  }

  /** one result tag (never a raw key, never a wrong sign) */
  function effectTag(f) {
    const x = FX[f.k];
    if (!x) return '';
    const L = PT.App.L;
    const who = f.pid != null && L ? PT.League.Q.player(L, f.pid) : null;
    const nm = who ? who.fn : '';
    const n = typeof f.n === 'number' ? f.n : 0;
    const T = (txt, tone) => FK().tag(html`${K().ic(x[0])}${txt}`, tone);
    switch (f.k) {
      case 'inj': return T(html`${nm || 'A player'} hurt${n > 0 ? html` · ${D().plural(n, 'wk')}` : ''}`, 'red');
      case 'bench': return T(html`${nm || 'A player'} sits next game`, 'red');
      case 'sign': return T(html`${nm || 'A player'} signed`, 'green');
      case 'swap': return T(n ? 'Swap done' : 'No swap', n ? 'green' : '');
      case 'snowImm': return T('Snow-proof next game', 'green');
      case 'gym': return T('New gym', 'green');
      case 'cash': return T(html`${nm ? nm + ' ' : ''}Pay +${D().money(n)}`, 'red');      // a raise costs Team Cash
      case 'injMult': return T(n < 1 ? 'Fewer owies ×' + n : 'More owies ×' + n, n < 1 ? 'green' : 'red');
      case 'tix': return T('Tickets ×' + n, n >= 1 ? 'green' : 'red');
      case 'edge': return T('Edge next game', n >= 0 ? 'green' : 'red');
      case 'hype': if (!n) return T('Hype maxed', ''); break;
      default: break;
    }
    if (!n) return '';
    const sk = f.key && f.key !== 'all' ? (PT.C.RATING_NAMES[f.key] || 'Skill') : f.k === 'nx' ? 'Skills' : '';
    const label = f.k === 'rat' ? sk || 'Skill' : f.k === 'nx' ? sk + ' next game' : x[1];
    const num = n % 1 && Math.abs(n) < 1 ? '×' + n : (n > 0 ? '+' : '−') + Math.abs(n);
    return T(html`${label} ${num}${nm ? ' (' + nm + ')' : ''}`, n > 0 ? 'green' : 'red');
  }
  function effects(list) {
    const tags = (list || []).map(effectTag).filter(Boolean);
    return tags.length ? html`<div class="fl-fx">${tags}</div>` : '';
  }

  function mount(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    if (st.result) {
      const r = st.result;
      D().set(el, K().layout(html`<section class="fl-card fl-evc fl-res" data-testid="event-result">
        <div class="micon">${K().ic(r.ok === false ? 'question' : 'party')}</div>
        <h2 class="fl-ev-h">${r.title || 'Done'}</h2>
        <p class="fl-ev-p">${r.resultText || r.msg || 'Done.'}</p>
        ${effects(r.effects)}
      </section>`, FK().foot('', '', FK().pri({ label: 'OK', icon: 'check', action: 'ok', testid: 'btn-event-ok' })), 'fit flow fl-ev'));
      return;
    }
    const list = pending(L);
    if (!list.length) {
      D().set(el, K().layout(K().empty('news', 'No news right now.'), FK().foot('', '', FK().pri({ label: 'Back', icon: 'back', action: 'done', testid: 'btn-event-done' })), 'fit flow fl-ev'));
      return;
    }
    const ev = list[0];
    const choices = (ev.choices || []).map((c, i) => {
      const off = c.disabled || c.can === false;
      return html`<button type="button" class="fl-choice" data-action="choose" data-iid="${ev.iid}" data-i="${i}" data-testid="event-choice-${i}" ${off ? D().raw('disabled aria-disabled="true"') : ''} title="${c.why || ''}">
        <span class="fl-choice-l">${c.label}</span>${c.hint || c.why ? html`<span class="fl-choice-tags">${tags(c.hint)}${off && c.why ? FK().tag(c.why, 'red') : ''}</span>` : ''}</button>`;
    });
    D().set(el, K().layout(html`
      <section class="fl-card fl-evc" data-testid="event-card">
        <div class="fl-ev-story">${art(L, ev)}<div class="fl-ev-t">
          <p class="fl-ev-k">${K().ic('megaphone')} Team News${list.length > 1 ? html` <span>· 1 of ${list.length}</span>` : ''}</p>
          <h2 class="fl-ev-h">${ev.title}</h2>
          <p class="fl-ev-p">${ev.text}</p>
        </div></div>
        <div class="fl-ev-ch">${choices}</div>
      </section>`, null, 'fit flow fl-ev'));
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
