/* Pixel Touchdown: js/ui/screens/season-end.js
 * Owner: WP5. Responsibility: champion, awards, records broken (Awards Night), Growth Day, Goodbyes, Fired.
 * Screens: 'awards' (also 'season-end'), 'growth', 'goodbyes', 'fired'.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const L = () => PT.App.L;
  const P = (lg, pid) => (pid == null ? null : PT.League.Q.player(lg, pid));

  function lastSeason(lg) { const s = (lg.hist && lg.hist.seasons) || []; return s[s.length - 1] || null; }
  function isMine(lg, p) { return p && p.tid === lg.userTid; }

  // ---------------- Awards Night ----------------
  const AWARDS = [
    { k: 'mvp', name: 'Top Dog', icon: 'crown', blurb: 'Best player in the league.' },
    { k: 'opoy', name: 'Best Offense', icon: 'football', blurb: 'Top offensive player.' },
    { k: 'dpoy', name: 'Best Defense', icon: 'shield', blurb: 'Top defensive player.' },
    { k: 'roy', name: 'Best Newbie', icon: 'sprout', blurb: 'Top first-year player.' }
  ];

  // ROUND6 (0 scrolling): champion + your season on the left; award winners then the Pixel Pro Team as one paged list
  function awardItem(lg, a, pid, i) {
    const p = P(lg, pid);
    const mine = isMine(lg, p);
    const t = p && p.tid >= 0 ? lg.teams[p.tid] : null;
    const head = html`<span class="aw-k"><span class="aw-ic" aria-hidden="true">${K().ic(a.icon)}</span>${a.name}</span>`;
    if (!p) return html`<div class="aw-it" style="--d:${i * 120}ms">${head}<span class="muted small">Not awarded.</span></div>`;
    return html`<button type="button" class="aw-it aw-who ${mine ? 'mine' : ''}" style="--d:${i * 120}ms" data-action="player" data-pid="${p.id}" data-testid="award-${a.k}" title="${a.blurb}">
      ${K().portrait(p, 40, t ? t.col.pri : undefined)}
      <span class="aw-tx">${head}<b class="ellip aw-pn">${K().short(p)}</b><span class="small muted ellip">${p.pos} · ${t ? t.name : 'Free Agent'}</span></span>
      ${mine ? K().chip('Yours', 'gold') : t ? K().badge(t, 's') : ''}</button>`;
  }

  function mountAwards(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const S = lastSeason(lg);
    const u = lg.userTid;
    if (!S) { D().set(el, K().layout(K().empty('mask', 'No awards yet.'), K().nextBtn(), 'awards')); return; }
    const champ = S.champ != null ? lg.teams[S.champ] : null, ru = S.ru != null ? lg.teams[S.ru] : null;
    const won = S.champ === u;
    const ur = S.user || {};
    const hero = champ ? html`<section class="card aw-champ ${won ? 'me' : ''}" style="${K().teamVars(champ)}">
        <p class="aw-kicker"><span class="aw-carrot" aria-hidden="true">${K().ic('carrot')}</span>${S.s} Pixel Bowl</p>
        <div class="aw-champ-row">${K().badge(champ, 'l')}</div>
        <h2 class="aw-champ-n">${won ? 'PIXEL BOWL CHAMPIONS!' : champ.name + ' win the Pixel Bowl'}</h2>
        ${ru ? html`<p class="small">Runner-up: <b>${ru.name}</b></p>` : ''}
      </section>` : '';
    const coy = S.coy != null ? lg.teams[S.coy] : null;
    const items = AWARDS.map((a, i) => awardItem(lg, a, S[a.k], i));
    if (coy) items.push(html`<div class="aw-it aw-who ${S.coy === u ? 'mine' : ''}" style="--d:${AWARDS.length * 120}ms" title="Beat expectations by the most.">${K().badge(coy, 'm')}
      <span class="aw-tx"><span class="aw-k"><span class="aw-ic" aria-hidden="true">${K().ic('clipboard')}</span>Coach of the Year</span><b class="ellip aw-pn">${K().teamFull(coy)}</b></span>${S.coy === u ? K().chip('You', 'gold') : ''}</div>`);
    // Pixel Pro Team: yours first
    const pro = (S.allLg || []).map((pid) => P(lg, pid)).filter(Boolean).sort((a, b) => isMine(lg, b) - isMine(lg, a));
    pro.forEach((p) => {
      const t = p.tid >= 0 ? lg.teams[p.tid] : null;
      items.push(html`<button type="button" class="aw-it aw-who aw-pro ${isMine(lg, p) ? 'mine' : ''}" data-action="player" data-pid="${p.id}" data-testid="pro-${p.id}">
        ${K().portrait(p, 40, t ? t.col.pri : undefined)}
        <span class="aw-tx"><span class="aw-k"><span class="aw-ic" aria-hidden="true">${K().ic('star')}</span>Pixel Pro Team</span><b class="ellip aw-pn">${K().short(p)}</b><span class="small muted ellip">${p.pos} · ${t ? t.name : 'Free Agent'}</span></span>
        ${isMine(lg, p) ? K().chip('Yours', 'gold') : t ? K().badge(t, 's') : ''}</button>`);
    });
    const mineN = pro.filter((p) => isMine(lg, p)).length;
    const recap = K().card(html`<div class="aw-recap">${K().badge(lg.teams[u], 'm')}
      <div class="grow"><div class="score-big num">${D().rec(ur.w || 0, ur.l || 0, ur.t || 0)}</div><p class="small">${won ? 'Champions!' : (ur.w || 0) >= 9 ? 'Great season.' : 'Tough season.'}</p>${pro.length ? html`<p class="small muted">${D().plural(mineN, 'Pro Team pick')}</p>` : ''}</div></div>`, 'card-cream aw-rc');
    const body = html`<div class="aw-cols"><div class="aw-left">${hero}${recap}</div>
      ${K().card(html`${K().h2('Award Winners')}${K().pg('aw', items, { grid: true, cls: 'pg-top aw-pg' })}`, 'fill aw-list')}</div>`;
    D().set(el, K().layout(body, K().nextBtn(), 'fit awards'));
    const host = el.querySelector('.lay');
    const key = 'aw-' + lg.id + '-' + S.s;
    if (host && !D().memo[key]) { D().memo[key] = true; K().confetti(host, won ? 120 : 60, champ ? [D().hex(champ.col.pri), D().hex(champ.col.sec), '#ffd23f', '#ff9f1c'] : null); }
  }

  const awards = { title: 'Awards Night', nav: 'history', mount: mountAwards };
  UI.screens.awards = awards;
  UI.screens['season-end'] = awards;

  // ---------------- Growth Day ----------------
  let raf = 0;
  function countUp(root) {
    const els = D().$$('[data-count-to]', root);
    if (!els.length) return;
    if (D().reduced()) { els.forEach((e) => { e.textContent = e.getAttribute('data-count-to'); }); return; }
    const t0 = D().now();
    const step = () => {
      const k = Math.min(1, (D().now() - t0) / 1100);
      const e2 = 1 - Math.pow(1 - k, 3);
      els.forEach((e) => {
        const a = +e.getAttribute('data-count-from'), b = +e.getAttribute('data-count-to');
        e.textContent = String(Math.round(a + (b - a) * e2));
      });
      if (k < 1) raf = (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16)))(step);
    };
    raf = (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16)))(step);
  }

  function mountGrowth(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const snap = D().memo.growth;
    const has = !!(snap && snap.m);
    const roster = PT.League.Q.roster(lg, lg.userTid).map((p) => {
      const b = has ? snap.m[p.id] : null;
      return { p: p, from: b ? b.ovr : p.ovr, d: b ? p.ovr - b.ovr : 0, known: !!b };
    }).sort((a, b) => (b.d - a.d) || (b.p.ovr - a.p.ovr));
    const up = roster.filter((x) => x.d > 0).length, down = roster.filter((x) => x.d < 0).length;
    const same = roster.length - up - down;
    const star = roster.find((x) => x.d > 0);
    const intro = K().card(html`<div class="gr-intro"><span class="gr-emo" aria-hidden="true">${K().ic('sprout')}</span><div class="grow">
        <p class="big"><b>One Year Older</b></p>
        <p class="small">${has ? html`<span class="good">▲ ${up} better</span> · <span class="bad">▼ ${down} worse</span>${same ? html` · ${same} same` : ''}` : 'Young players grow. Old players slow down.'}</p></div></div>`, 'card-cream');
    const hero = star ? html`<section class="card gr-star"><span class="chip chip-gold">Biggest Riser</span>
        <div class="gr-star-row">${K().portrait(star.p, 56)}<div class="grow"><b class="ellip">${K().short(star.p)}</b><div class="row small">${K().posChip(star.p.pos)} ${K().stars(star.p.ovr)}</div></div>
        <span class="gr-big up num">▲${star.d}</span></div></section>` : '';
    // ROUND6: compact chips (no portraits), changed players first; paged
    const rows = roster.map((x, i) => {
      const cls = x.d > 0 ? 'up' : x.d < 0 ? 'down' : 'same';
      return html`<button type="button" class="gr-row gr-c gr-${cls}" style="--d:${Math.min(i, 20) * 40}ms" data-action="player" data-pid="${x.p.id}" data-testid="player-row-${x.p.id}">
        ${K().posChip(x.p.pos)}<span class="gr-n"><b class="ellip">${K().short(x.p)}</b><span class="tiny muted">Age ${x.p.age}</span></span>
        <span class="gr-ovr num">${x.known && x.d ? html`<span class="muted">${x.from}→</span>` : ''}<b data-count-from="${x.from}" data-count-to="${x.p.ovr}">${x.known ? x.from : x.p.ovr}</b></span>
        ${x.known ? html`<span class="gr-d ${cls} num">${x.d > 0 ? '▲' + x.d : x.d < 0 ? '▼' + Math.abs(x.d) : '='}</span>` : ''}</button>`;
    });
    D().set(el, K().layout(html`<div class="gr-cols"><div class="gr-left">${intro}${hero}</div>${K().pg('gr', rows, { grid: true, cls: 'gr-pg' })}</div>`, K().nextBtn(), 'fit growth-scr'));
    countUp(el);
  }

  UI.screens.growth = {
    title: 'Growth Day', nav: 'team', mount: mountGrowth,
    unmount: () => { if (raf) { (globalThis.cancelAnimationFrame || clearTimeout)(raf); raf = 0; } }
  };

  // ---------------- Goodbyes ----------------
  function retiredThisYear(lg) {
    const out = [];
    const seen = {};
    lg.players.filter((p) => p.tid === PT.C.TID.RETIRED).forEach((p) => {
      seen[p.id] = true;
      const tids = (p.cs || []).map((c) => c.t).filter((t) => t >= 0);
      out.push({ id: p.id, fn: p.fn, ln: p.ln, sp: p.sp, pos: p.pos, num: p.num, age: p.age, p: p, tids: tids, yrs: (p.cs || []).length, hof: false });
    });
    ((lg.hist && lg.hist.legends) || []).forEach((g) => {
      if (!g.yrs || g.yrs[1] !== lg.season || seen[g.id]) return;
      out.push({ id: g.id, fn: g.fn, ln: g.ln, sp: g.sp, pos: g.pos, num: g.num, p: null, tids: g.tids || [], yrs: g.yrs[1] - g.yrs[0] + 1, hof: !!g.hof, car: g.car });
    });
    return out;
  }
  function retiredNums(lg) { return (lg.retNums && lg.retNums[lg.userTid]) || []; }
  function canRetireNum(lg, r) {
    const u = lg.userTid;
    if (r.num == null) return false;
    const withUs = (r.p && r.p.cs ? r.p.cs.filter((c) => c.t === u).length : r.tids.filter((t) => t === u).length);
    return withUs >= 1 && !retiredNums(lg).includes(r.num);
  }

  const GB_OTHERS = 14;   // ROUND6: league-wide retirements beyond yours + Hall of Famers are trimmed to the longest careers
  function mountGoodbyes(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const u = lg.userTid;
    const mine = (r) => r.tids.includes(u) || !!(r.p && r.p.cs && r.p.cs.some((c) => c.t === u));
    // INT: your own players first, then Hall of Famers, then the longest careers (the list is league-wide)
    const all = retiredThisYear(lg).sort((a, b) => (mine(b) - mine(a)) || (b.hof - a.hof) || ((b.yrs || 0) - (a.yrs || 0)));
    const keep = all.filter((r) => mine(r) || r.hof);
    const others = all.filter((r) => !mine(r) && !r.hof);
    const list = keep.concat(others.slice(0, GB_OTHERS));
    const more = others.length - Math.min(others.length, GB_OTHERS);
    const card = (r) => {
      const ours = mine(r);
      return html`<div class="gb-card gb-c ${r.hof ? 'hof' : ''} ${ours ? 'ours' : ''}">
        ${r.p ? K().portrait(r.p, 40) : html`<span class="portrait portrait-emo" style="width:40px;height:40px"><span>${K().sp(r.sp)}</span></span>`}
        <span class="gb-tx"><b class="ellip">${r.fn} ${r.ln}</b>
          <span class="gb-sub small">${K().posChip(r.pos)} <span class="muted">${D().plural(r.yrs || 1, 'season')}</span> ${r.hof ? K().chip('Hall of Fame', 'ink') : ours ? K().chip('Yours', 'gold') : ''}</span></span>
        ${canRetireNum(lg, r) ? K().btn({ label: 'Retire #' + r.num, icon: 'jersey', action: 'retire-num', data: { num: r.num, pid: r.id }, kind: 'gold', size: 's', testid: 'btn-retire-num-' + r.id }) : ''}
      </div>`;
    };
    const nums = retiredNums(lg);
    const hofN = all.filter((r) => r.hof).length;
    const body = html`<div class="gb-cols"><div class="gb-left">${K().card(html`<div class="gr-intro"><span class="gr-emo" aria-hidden="true">${K().ic('star')}</span><div class="grow"><p class="big"><b>Goodbyes</b></p>
        <p class="small">${all.length ? D().plural(all.length, 'player') + ' retiring' + (hofN ? ' · ' + hofN + ' to the Hall of Fame' : '') + (more > 0 ? ' · ' + more + ' not shown' : '') : 'No retirements this year.'}</p></div></div>`, 'card-cream')}
      ${nums.length ? K().card(html`<p class="small gb-nt"><b>Retired Numbers</b></p><div class="gb-nums">${nums.slice().sort((a, b) => a - b).map((n) => html`<span class="gb-num num">#${n}</span>`)}</div>`, 'gb-numc') : ''}</div>
      ${list.length ? K().pg('gb', list.map(card), { grid: true, cls: 'gb-pg' }) : ''}</div>`;
    D().set(el, K().layout(body, K().nextBtn(), 'fit goodbyes'));
  }

  UI.screens.goodbyes = {
    title: 'Goodbyes', nav: 'history', mount: mountGoodbyes,
    actions: {
      'retire-num': (el) => {
        const lg = L(), num = +el.getAttribute('data-num');
        UI.Modal.confirm('Retire #' + num + ' forever?', { body: 'No one on your team will wear it again.', icon: 'jersey', yes: 'Retire It' }).then((ok) => {
          if (!ok) return;
          const H = PT.League.History;
          let done = false;
          if (H && H.retireNumber) { try { const r = H.retireNumber(lg, lg.userTid, num); done = !r || r.ok !== false; } catch (e) { done = false; } }
          if (!done) {   // adapter: until WP2 History.retireNumber exists
            lg.retNums = lg.retNums || {};
            const a = lg.retNums[lg.userTid] = lg.retNums[lg.userTid] || [];
            if (!a.includes(num)) a.push(num);
            const t = lg.teams[lg.userTid];
            if (t.fin) t.fin.hype = Math.min(100, t.fin.hype + 5);
          }
          UI.Toast.show('#' + num + ' retired', 'good');
          if (PT.Events) PT.Events.emit('league:changed', { what: 'retire' });
          UI.refresh();
        });
      }
    }
  };

  // ---------------- Fired ----------------
  function offers(lg) {
    const B = PT.League.Boss;
    if (B && B.offers) { try { const o = B.offers(lg); if (Array.isArray(o)) return o.map((x) => (typeof x === 'number' ? { tid: x } : x)); } catch (e) { /* fallback */ } }
    return lg.teams.filter((t) => t.id !== lg.userTid).map((t) => ({ tid: t.id, ovr: K().teamOvr(t.id) })).sort((a, b) => a.ovr - b.ovr).slice(0, 3);
  }
  function mountFired(el) {
    const lg = L();
    if (!lg) { UI.replace('title'); return; }
    const B = PT.League.Boss;
    const canTake = !!(B && B.takeJob);
    const list = offers(lg);
    const body = html`<section class="card card-cream fi-card">
        <div class="fi-face" aria-hidden="true">${K().sp('bear', 76)}<span>${K().ic('drop')}</span></div>
        <div class="grow"><h2 class="hero-t">The Boss wants a new coach.</h2>
        <p>Take a new job or retire.</p></div>
      </section>
      <h2 class="sec-title on-grass">Job Offers</h2>
      <div class="grid3">${list.map((o) => { const t = lg.teams[o.tid]; return html`<section class="card fi-job" style="${K().teamVars(t)}">
        <div class="row">${K().badge(t, 'l')}<div class="grow"><b class="big ellip">${t.name}</b><div>${K().stars(K().teamOvr(t.id), { team: true })}</div></div></div>
        ${K().btn({ label: 'Take Job', icon: 'contract', action: 'take', data: { tid: t.id }, kind: 'go', size: 'm', testid: 'btn-job-' + t.id, cls: 'btn-wide', disabled: !canTake })}
      </section>`; })}</div>
      ${!canTake ? html`<p class="center small fi-note">No jobs open yet. You can retire.</p>` : ''}`;
    const foot = K().btn({ label: 'Retire', icon: 'home', action: 'retire', kind: 'sec', size: 'l', testid: 'btn-fired-retire', cls: 'btn-wide' });
    D().set(el, K().layout(body, foot, 'fit fired'));
  }
  UI.screens.fired = {
    title: 'Big News', chrome: 'head', back: false, mount: mountFired,
    actions: {
      take: (el) => {
        const lg = L(), tid = +el.getAttribute('data-tid');
        let r = null;
        try { r = PT.League.Boss.takeJob(lg, tid); } catch (e) { r = { ok: false, msg: 'Could not take the job.' }; }
        if (r && r.ok === false) { UI.Toast.show(r.msg || 'Could not take the job.', 'bad'); return; }
        UI.Toast.show('You now coach the ' + lg.teams[tid].name, 'good', 3000);
        if (PT.Events) PT.Events.emit('league:changed', { what: 'job' });
        UI.theme();
        if (PT.App.applyTheme) PT.App.applyTheme();
        if (PT.App.save) PT.App.save();                // QA1: the new job is a main-save moment
        UI.reset();
      },
      retire: () => {
        UI.Modal.confirm('Retire as a coach?', { body: 'Your save stays in its slot.', icon: 'home', yes: 'Retire', no: 'Not yet' })
          .then((ok) => {
            if (!ok || !PT.App || !PT.App.quitToTitle) return;
            const lg = L();
            try { if (lg && PT.League.Boss && PT.League.Boss.retire) PT.League.Boss.retire(lg); } catch (e) { /* keep going */ }
            if (PT.App.save) PT.App.save();
            PT.App.quitToTitle();
          });
      }
    }
  };
})(globalThis.PT = globalThis.PT || {});
