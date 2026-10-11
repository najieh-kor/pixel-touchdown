/* Pixel Touchdown: js/ui/screens/postgame.js
 * Owner: WP5. Responsibility: final score, box score, player of game (design 18.3 Final).
 * params: { gid, box?, coins0?, xp0?, lvl0?, ach0?, hype0?, sim? } (snapshot values come from pregame/game).
 * INT2 (client: "no scrolling on the Final screen"): one screen at 390×844 / 844×390 / 1366×768 — result + score,
 * top 3 performers (MVP first), team stats, rewards row, Continue. Box Score and Scoring open in a closable overlay
 * (btn-pgm-box; Scoring is a tab inside it). btn-postgame-continue → events if any, else HQ / phase screen.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  function countUp(el) {
    D().$$('[data-count]', el).forEach((n) => {
      const to = +n.getAttribute('data-count');
      if (D().reduced() || !to) { n.textContent = (to > 0 ? '+' : '') + D().int(to); return; }
      const t0 = D().now(), dur = 900;
      const step = () => {
        const k = Math.min(1, (D().now() - t0) / dur);
        n.textContent = (to > 0 ? '+' : '') + D().int(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1 && globalThis.document.contains(n)) globalThis.requestAnimationFrame(step);
      };
      globalThis.requestAnimationFrame(step);
    });
  }

  /** rough "how big was his day" score for the top-performer list */
  function impact(l) {
    return (l.py || 0) * 0.04 + (l.ptd || 0) * 4 - (l.pi || 0) * 3 + (l.ry || 0) * 0.1 + (l.rtd || 0) * 6 + (l.rcy || 0) * 0.1 + (l.rctd || 0) * 6 +
      (l.rc || 0) * 0.5 + (l.tk || 0) * 0.8 + (l.dsk || 0) * 4 + (l.int || 0) * 5 + (l.ff || 0) * 3 + (l.pd || 0) * 1 + (l.fgm || 0) * 3;
  }
  /** player of the game first, then the next two biggest days (either team) */
  function topThree(L, box) {
    if (!box || !box.pl) return [];
    const all = Object.keys(box.pl).map((pid) => ({ pid: +pid, l: box.pl[pid], v: impact(box.pl[pid]) })).filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    const out = [];
    if (box.pog != null && box.pl[box.pog]) out.push({ pid: box.pog, l: box.pl[box.pog], pog: true });
    for (const x of all) { if (out.length >= 3) break; if (x.pid !== box.pog) out.push(x); }
    return out.map((x) => Object.assign(x, { p: PT.League.Q.player(L, x.pid) })).filter((x) => x.p);
  }

  /** HUNT #20: at most 3 stats on a top-performer line (no run yards for a QB, no catch yards for a RB) */
  function perfLine(l, pos) {
    const drop = pos === 'QB' ? /run yds/ : pos === 'RB' ? /catch yds/ : null;
    const max = (globalThis.innerWidth || 1000) < 700 ? 2 : 3;          // 667px wide: 2 stats fit on one line
    return K().statLine(l, pos).split(' · ').filter((x) => !drop || !drop.test(x)).slice(0, max).join(' · ');
  }

  /** the full box score / scoring list as a closable overlay (kept off the main Final screen). ROUND6: tabs, no scrolling */
  function overlay(kind, box) {
    const L = PT.App.L;
    const tabs = [['sum', 'Summary'], ['team', 'Team Stats'], ['scoring', 'Scoring']];
    let cur = kind === 'scoring' ? 'scoring' : 'sum';
    const scoringList = () => {
      const list = (box && box.sc) || [];
      return list.length ? K().pg('scoring', list.map((x) => html`<div class="sc-row"><span class="q">${K().periodName(box, x.q)}</span> ${K().badge(L.teams[x.t], 's')} <b>${x.k}</b> <span class="muted">${x.txt || ''}</span></div>`))
        : html`<p class="muted">No points scored.</p>`;
    };
    const bodyFor = (k) => (k === 'scoring' ? scoringList() : K().boxScore(box, { parts: k === 'team' ? ['team'] : ['line', 'leaders'], leadMax: (globalThis.innerHeight || 800) < 480 ? 3 : 4 }));
    const render = (card) => {
      const host = card.querySelector('.box-host');
      D().set(host, bodyFor(cur));
      card.querySelectorAll('[data-action="box-tab"]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-k') === cur));
      if (UI.fit) UI.fit(card);
    };
    return UI.Modal.open({ title: 'Box Score', cls: 'm-wide m-box', closeX: true,
      body: html`<div class="seg box-tabs">${tabs.map((t) => html`<button type="button" class="btn btn-sec btn-s ${t[0] === cur ? 'on' : ''}" data-action="box-tab" data-k="${t[0]}" data-testid="box-tab-${t[0]}">${t[1]}</button>`)}</div>
        <div class="box-host">${bodyFor(cur)}</div>`,
      actions: { 'box-tab': (el, card) => { cur = el.getAttribute('data-k'); render(card); } },
      buttons: [{ label: 'Close', value: null, kind: 'cancel', testid: 'btn-pgm-close' }] });
  }

  /**
   * Shared Final screen (postgame + Quick Game): result + score, top performers, team stats, then o.rewards (Raw)
   * and o.foot (Raw buttons). @param {{sub:string, rewards?:Raw, foot:Raw}} o
   */
  UI.finalView = function (box, o) {
    const L = PT.App.L, u = L.userTid, t = L.teams[u];
    const h = box.h, a = box.a, hs = box.hs, as = box.as;
    const us = h === u ? hs : as, them = h === u ? as : hs;
    const res = us > them ? 'W' : us < them ? 'L' : 'T';
    const head = res === 'W' ? 'Victory' : res === 'L' ? 'Defeat' : 'Tie game';
    const sub = o.sub;
    // team stats (away left, home right — same as the score)
    const tl = (tid) => ((box && box.tm) || []).find((x) => x.tid === tid) || {};
    const ta = tl(a), th = tl(h);
    const third = (x) => (x.d3a ? (x.d3c || 0) + '/' + x.d3a : '–');
    const rows = [['Total yards', 'ty'], ['Passing', 'py'], ['Rushing', 'ry'], ['Turnovers', 'to', true], ['3rd down', 'd3', false, third]];
    const statRow = (r) => {
      const va = r[3] ? r[3](ta) : (ta[r[1]] || 0), vh = r[3] ? r[3](th) : (th[r[1]] || 0);
      const na = r[3] ? (ta.d3a ? (ta.d3c || 0) / ta.d3a : 0) : va, nh = r[3] ? (th.d3a ? (th.d3c || 0) / th.d3a : 0) : vh;
      const better = r[2] ? (na < nh ? 'a' : nh < na ? 'h' : '') : (na > nh ? 'a' : nh > na ? 'h' : '');
      // HUNT #44: conversion rows (x/y) draw each side's rate on a 0-100% scale; counts share the total
      const sum = (na + nh) || 1;
      const wa = r[3] ? Math.round(na * 100) : Math.round(na / sum * 100), wh = r[3] ? Math.round(nh * 100) : Math.round(nh / sum * 100);
      return html`<div class="pgx-st"><b class="num ${better === 'a' ? 'up' : ''}">${va}</b><span class="pgx-st-l"><span class="pgx-bar"><i style="width:${wa}%"></i></span>${r[0]}<span class="pgx-bar pgx-bar-h"><i style="width:${wh}%"></i></span></span><b class="num ${better === 'h' ? 'up' : ''}">${vh}</b></div>`;
    };
    const top = topThree(L, box);
    const kc = K().kitCols(h, a);          // same kits as the 3D game: two same-colour teams still differ
    const perf = top.map((x) => html`<div class="pgx-p ${x.pog ? 'pog' : ''}">${K().portrait(x.p, 44, L.teams[x.p.tid] ? L.teams[x.p.tid].col.pri : undefined)}
      <span class="pgx-p-m"><span class="pgx-p-n ellip">${x.pog ? html`<span class="star-tag">${K().ic('star')}<b>MVP</b></span>` : ''}${K().short(x.p)}</span>
      <span class="tiny ellip">${K().posChip(x.p.pos)} ${L.teams[x.l.t] ? L.teams[x.l.t].abbr : ''} · ${perfLine(x.l, x.p.pos)}</span></span></div>`);
    return { res: res, team: t, html: html`<div class="pgx pgx-${res}" style="${K().teamVars(t)};--ca:${kc.a};--ch:${kc.h}">
      <section class="pgx-head" data-testid="pgm-head">
        <div class="pgx-res">${head}</div>
        <div class="pgx-score">
          <span class="pgx-tm pgx-tm-a ${a === u ? 'me' : ''}">${K().badge(L.teams[a], 'l')}<b>${L.teams[a].abbr}</b></span>
          <span class="pgx-n num"><span class="${as > hs ? 'win' : ''}">${as}</span><i>-</i><span class="${hs > as ? 'win' : ''}">${hs}</span></span>
          <span class="pgx-tm pgx-tm-h ${h === u ? 'me' : ''}">${K().badge(L.teams[h], 'l')}<b>${L.teams[h].abbr}</b></span>
        </div>
        <div class="pgx-sub">${sub}</div>
      </section>
      <div class="pgx-mid">
        <section class="pgx-card pgx-perf" data-testid="pgm-top">
          <h3>Top performers</h3>
          ${perf.length ? perf : html`<p class="small muted">Simmed game.</p>`}
        </section>
        <section class="pgx-card pgx-stats" data-testid="pgm-stats">
          <h3><span>${L.teams[a].abbr}</span>Team stats<span>${L.teams[h].abbr}</span></h3>
          ${rows.map(statRow)}
        </section>
      </div>
      ${o.rewards || ''}
      <div class="pgx-foot">${o.foot}</div>
    </div>` };
  };

  function mount(el, params) {
    const L = PT.App.L;
    const g = L.sched.find((x) => x.gid === params.gid);
    const box = params.box || PT.League.Q.box(L, params.gid);
    if (!g && !box) { D().set(el, K().layout(K().empty('football', 'No game found.'), K().btn({ label: 'Continue', action: 'cont', kind: 'go', size: 'xl', testid: 'btn-postgame-continue', cls: 'btn-wide' }))); return; }
    const h = box ? box.h : g.h, a = box ? box.a : g.a;
    const hs = box ? box.hs : g.hs, as = box ? box.as : g.as;
    const u = L.userTid, t = L.teams[u];
    const home = h === u;
    const us = home ? hs : as, them = home ? as : hs;
    const res = us > them ? 'W' : us < them ? 'L' : 'T';
    const sub = [g && g.po ? PT.C.PLAYOFF_NAMES[g.po] : (g && g.wk ? 'Week ' + g.wk : ''), box && box.ot ? 'Overtime' : '', params.sim ? 'Simmed' : 'Final'].filter(Boolean).join(' · ');

    // rewards
    const coinsGot = params.coins0 != null ? t.fin.coins - params.coins0 : null;
    const xpGot = params.xp0 != null && L.coach && typeof L.coach === 'object' ? (L.coach.xp || 0) - params.xp0 : null;
    const lvlUp = params.lvl0 != null && L.coach && L.coach.lvl > params.lvl0;
    const hypeD = params.hype0 != null ? Math.round(t.fin.hype - params.hype0) : null;
    const achNew = params.ach0 ? Object.keys(L.ach || {}).filter((k) => !params.ach0.includes(k)) : [];
    const achDefs = (PT.Data.Achievements && PT.Data.Achievements.list) || [];
    const hurt = box && box.inj ? box.inj.map((i) => PT.League.Q.player(L, i.pid)).filter((p) => p && p.tid === u) : [];

    const badges = achNew.map((id) => (achDefs.find((x) => x.id === id) || { name: id }).name);

    // HUNT2 #10: every reward chip says what it is, and a tap explains it in one line
    const chip = (cls, ic, txt, why, id) => html`<button type="button" class="pgx-r ${cls}" data-action="rew" data-why="${why}" data-testid="pgm-rew-${id}">${K().ic(ic)}<b class="num">${txt}</b></button>`;
    const hurtW = (p) => { const i = (box.inj || []).find((x) => x.pid === p.id); const w = (i && (i.w || i.wk)) || (p.inj && p.inj.w) || 0; return w ? ' (' + w + ' wk)' : ''; };
    const rewards = html`<section class="pgx-rew" data-testid="pgm-rewards">
      ${coinsGot != null ? chip('', 'coin', (coinsGot > 0 ? '+' : '') + D().int(coinsGot) + ' Coins', 'Coins buy Shop upgrades and staff.', 'coins') : ''}
      ${xpGot != null ? chip('', 'grad', (xpGot > 0 ? '+' : '') + D().int(xpGot) + ' XP', 'Coach XP. Each level gives a coach skill point.', 'xp') : ''}
      ${hypeD ? chip(hypeD < 0 ? 'bad' : '', 'flame', 'Hype ' + (hypeD > 0 ? '+' : '−') + Math.abs(hypeD), 'Hype fills the stands: more ticket money.', 'hype') : ''}
      ${lvlUp ? chip('pgx-gold', 'grad', 'Level ' + L.coach.lvl, 'New coach level: pick a skill in Office > Coach.', 'lvl') : ''}
      ${badges.length ? chip('pgx-gold', 'trophy', badges.length === 1 ? badges[0] : badges.length + ' badges', 'New badges: ' + badges.join(', ') + '.', 'ach') : ''}
      ${hurt.length ? chip('bad', 'cross', hurt.length === 1 ? 'Hurt: ' + K().short(hurt[0]) + hurtW(hurt[0]) : hurt.length + ' hurt', 'Hurt: ' + hurt.map((p) => K().short(p) + hurtW(p)).join(', ') + '. See Team > Hurt.', 'hurt') : ''}
    </section>`;
    // HUNT #44: one Box Score button (Scoring is a tab inside it)
    const foot = html`${K().btn({ label: 'Box Score', icon: 'chart', action: 'box', kind: 'sec', size: 'm', testid: 'btn-pgm-box' })}
        ${K().btn({ label: 'Continue', icon: 'play', action: 'cont', kind: 'go', size: 'l', testid: 'btn-postgame-continue', cls: 'pgx-go' })}`;
    const v = UI.finalView(box || { h: h, a: a, hs: hs, as: as, tm: [], pl: {} }, { sub: sub, rewards: rewards, foot: foot });
    const body = v.html;
    D().set(el, body);
    countUp(el);
    if (res === 'W') { const host = el.querySelector('.pgx'); if (host) K().confetti(host, 50, [D().hex(t.col.pri), D().hex(t.col.sec), '#ffd23f', '#ffffff']); }
  }

  function boxOf(params) { params = params || {}; return params.box || (params.gid != null ? PT.League.Q.box(PT.App.L, params.gid) : null); }
  UI.postgameOverlay = overlay;

  UI.screens.postgame = {
    title: 'Final',
    chrome: 'bare',
    back: false,
    noRefresh: true,
    mount: mount,
    actions: {
      // HUNT2 #6: after a regular-season game Continue goes straight on to next week (sims the other games);
      // a Team News / roster stop still opens first (Flow.next routes blockers)
      cont: () => {
        const L = PT.App.L;
        let st = null;
        try { st = L && L.phase === 'REGULAR' ? PT.League.Calendar.status(L) : null; } catch (e) { st = null; }
        const g = L && L.phase === 'REGULAR' ? L.sched.find((x) => x.po === 0 && x.wk === L.week && (x.h === L.userTid || x.a === L.userTid)) : null;
        if (st && g && g.st === 'F' && !(st.blockers && st.blockers.length)) { UI.Flow.next(); return; }
        UI.Flow.goPhase();
      },
      rew: (el) => UI.Toast.show(el.getAttribute('data-why'), 'info', 2600),
      box: (b, ev, params) => overlay('box', boxOf(params)),
      scoring: (b, ev, params) => overlay('scoring', boxOf(params))
    }
  };
})(globalThis.PT = globalThis.PT || {});
