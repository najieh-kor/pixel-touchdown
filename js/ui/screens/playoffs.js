/* Pixel Touchdown: js/ui/screens/playoffs.js
 * Owner: WP5. Responsibility: bracket (both conferences + the Pixel Bowl).
 * Rounds side by side like a real bracket; conferences + Pixel Bowl paged when the screen is short (no scrolling).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function confName(c) { const n = (PT.Data.Teams && PT.Data.Teams.CONFS) || ['Sunny Conference', 'Frosty Conference']; return n[c]; }
  function bracket(L) {
    try { if (PT.League.Playoffs && PT.League.Playoffs.bracket) return PT.League.Playoffs.bracket(L); } catch (e) { /* fall through */ }
    const out = [];
    for (let rd = 1; rd <= PT.C.PLAYOFF_ROUNDS; rd++) out.push(L.sched.filter((g) => g.po === rd).map((g) => ({ gid: g.gid, h: g.h, a: g.a, hs: g.hs, as: g.as, st: g.st })));
    return out;
  }
  function seedOf(L, tid) {
    const s = L.po && L.po.seeds;
    if (!s) return null;
    for (const c of [0, 1]) { const i = (s[c] || []).indexOf(tid); if (i >= 0) return i + 1; }
    return null;
  }
  /** projected seeds before the playoffs start */
  function projected(L, c) {
    try { return PT.League.Standings.conference(L, c).filter((r) => r.seed).sort((a, b) => a.seed - b.seed).map((r) => r.tid).slice(0, PT.C.PLAYOFF_PER_CONF); }
    catch (e) { return []; }
  }

  function line(L, tid, sc, win, done, u, seed) {
    if (tid == null) return html`<div class="bk-line tbd"><span class="bk-seed"></span><span class="grow muted">TBD</span></div>`;
    const t = L.teams[tid];
    return html`<div class="bk-line ${win ? 'win' : done ? 'lose' : ''} ${tid === u ? 'me' : ''}"><span class="bk-seed num">${seed || ''}</span>${K().badge(t, 's')}<span class="grow ellip bk-n"><span class="bk-full">${t.name}</span><span class="bk-ab">${t.abbr}</span></span><b class="num">${done ? sc : ''}</b></div>`;
  }
  function match(L, g, u, seeds) {
    const done = g.st === 'F';
    const sa = seeds ? seeds.a : seedOf(L, g.a), sh = seeds ? seeds.h : seedOf(L, g.h);
    const inner = html`${line(L, g.a, g.as, done && g.as > g.hs, done, u, sa)}${line(L, g.h, g.hs, done && g.hs > g.as, done, u, sh)}`;
    if (g.gid != null && done) return html`<button type="button" class="bk-match done" data-action="box" data-gid="${g.gid}" data-testid="po-game-${g.gid}">${inner}</button>`;
    return html`<div class="bk-match ${g.gid == null ? 'proj' : ''}">${inner}</div>`;
  }
  function emptyMatch() { return html`<div class="bk-match proj">${line(PT.App.L, null)}${line(PT.App.L, null)}</div>`; }

  // ROUND6 "0 scrolling": compact rounds; one card per conference + the Pixel Bowl, paged (pager.js) when they do not fit.
  // The seed-1 bye shows in the Divisional round slot instead of a separate box.
  function confBracket(L, c, br, u, started) {
    const games = (rd) => (br[rd - 1] || []).filter((g) => L.teams[g.h].conf === c);
    const seeds = started ? (L.po.seeds[c] || []) : projected(L, c);
    const cols = [];
    // Wild Card: 2v7, 3v6, 4v5 (projected if not started); seed 1 rests
    let wc = games(1);
    if (!wc.length && seeds.length >= 7) wc = [[1, 6], [2, 5], [3, 4]].map((p) => ({ gid: null, h: seeds[p[0]], a: seeds[p[1]], st: 'S', _s: { h: p[0] + 1, a: p[1] + 1 } }));
    cols.push({ t: PT.C.PLAYOFF_NAMES[1], m: wc.length ? wc.map((g) => match(L, g, u, g._s)) : [emptyMatch(), emptyMatch(), emptyMatch()] });
    const dv = games(2), cf = games(3);
    const bye = seeds[0] != null ? html`<div class="bk-match proj nc-bye">${line(L, seeds[0], null, false, false, u, 1)}<div class="bk-line tbd"><span class="bk-seed"></span><span class="chip chip-gold">Bye</span><span class="grow muted small">waits</span></div></div>` : emptyMatch();
    cols.push({ t: PT.C.PLAYOFF_NAMES[2], m: dv.length ? dv.map((g) => match(L, g, u)) : [bye, emptyMatch()] });
    cols.push({ t: 'Conf. Final', m: cf.length ? cf.map((g) => match(L, g, u)) : [emptyMatch()] });
    return html`<section class="card bk-card nc-bk">${K().h2(confName(c), started ? '' : html`<span class="chip chip-ink nc-proj">Projected</span>`, c === 0 ? 'sun' : 'snow')}
      <div class="bk">${cols.map((col) => html`<div class="bk-col"><h4 class="bk-rd">${col.t}</h4><div class="bk-ms">${col.m}</div></div>`)}</div></section>`;
  }

  function mount(el) {
    const L = PT.App.L;
    if (!L) { UI.replace('title'); return; }
    const u = L.userTid;
    const br = bracket(L);
    const started = !!(L.po && L.po.seeds && L.po.seeds[0] && L.po.seeds[0].length) && ['PLAYOFFS', 'SEASON_END', 'RESIGN', 'DRAFT', 'FREE_AGENCY'].includes(L.phase);
    const bowl = (br[3] || [])[0];
    const champ = L.po && L.po.champ != null ? L.teams[L.po.champ] : null;
    const champRow = champ ? html`<div class="nc-champ" style="${K().teamVars(champ)}">${K().badge(champ, 'm')}<div class="grow"><div class="small">Champions ${L.season}</div><div class="champ-n">${champ.name}</div></div><span class="champ-carrot" aria-hidden="true">${K().ic('carrot')}</span></div>` : '';
    const bowlCard = html`<section class="card bowl-card nc-bowl ${champ ? 'champ-card' : ''}">${K().h2('Pixel Bowl', null, 'trophy')}
      <div class="bowl">${bowl ? match(L, bowl, u) : emptyMatch()}${champRow || (started ? '' : html`<p class="small muted center">Playoffs start in Week ${PT.C.REG_WEEKS + 1}.</p>`)}</div></section>`;
    // HUNT2 #16: until the bracket exists this tab shows the Playoff Picture (seeds 1-7 and the playoff line)
    if (!started && !champ && UI.leagueParts && UI.leagueParts.picture) {
      D().set(el, K().layout(UI.leagueParts.picture(L, u), null, 'fit playoffs standings nc'));
      return;
    }
    const body = html`<div class="fill">${K().pg('bk', champ ? [bowlCard, confBracket(L, 0, br, u, started), confBracket(L, 1, br, u, started)] : [confBracket(L, 0, br, u, started), confBracket(L, 1, br, u, started), bowlCard], { grid: true, cls: 'nc-side nc-bks' + (champ ? ' nc-champd' : '') })}</div>`;
    D().set(el, K().layout(body, null, 'fit playoffs nc'));
    if (champ) K().confetti(el.querySelector('.nc-bowl'), 40);
  }

  UI.screens.playoffs = {
    title: 'Playoff Bracket',
    nav: 'standings',
    mount: mount,
    actions: {
      box: (el) => {
        const gid = +el.getAttribute('data-gid');
        if (UI.openBoxScore) UI.openBoxScore(gid);
        else UI.Modal.open({ title: 'Box Score', body: K().boxScore(PT.League.Q.box(PT.App.L, gid)), buttons: [{ label: 'Close', value: true, kind: 'go' }] });
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
