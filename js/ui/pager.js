/* Pixel Touchdown: js/ui/pager.js
 * Owner: INT2 (ROUND6 "0 scrolling allowed"). Fit-to-height paging for long lists: no screen or panel may scroll.
 *
 *   K().pg(key, rows, opts)  → Raw: <div class="pg" data-pg="key"><div class="pg-list">rows…</div><div class="pg-ctl">[prev] 1/3 [next]</div></div>
 *      rows: array of Raw html (each becomes one child of .pg-list). opts: { cls, grid:true (CSS grid list), empty:Raw }
 *   UI.fit(root)             → for every .pg in root: measure how many rows fit in .pg-list's height, show one page.
 *                              Called by ui.js after every mount / refresh / resize and by Modal after open.
 *   UI.pgPage(key, n)        → jump to page n (0-based) and re-fit; UI.pgReveal(root, testid) → page that shows a row.
 *
 * Layout contract: the .pg element must get a definite height from its parent (flex column with min-height:0, or a
 * fixed height). .pg-list hides overflow; page size = rows whose bottom edge fits. Pages are kept per screen + key, so a
 * refresh keeps the page. Rows stay in the DOM (testids intact); rows on other pages are [hidden].
 * Pager buttons: data-action="pg" data-pg=key data-d=-1|1 (handled here, before screen actions). Keys: PageUp/PageDown.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const pages = {};               // 'screen:key' → page
  const html = function () { return UI.dom.html.apply(null, arguments); };
  const scope = () => { const c = UI.current && UI.current(); return (c ? c.name : '') + ':'; };

  UI.comp = UI.comp || {};
  /** paged list (see header) */
  UI.comp.pg = function (key, rows, opts) {
    opts = opts || {};
    const K = UI.comp;
    const list = rows && rows.length ? rows : [opts.empty || html`<p class="muted pg-empty">Nothing here yet.</p>`];
    return html`<div class="pg ${opts.cls || ''}" data-pg="${key}">
      <div class="pg-list ${opts.grid ? 'pg-grid' : ''}">${list}</div>
      <div class="pg-ctl" hidden>
        <button type="button" class="btn btn-sec btn-s pg-b" data-action="pg" data-pg="${key}" data-d="-1" data-testid="pg-prev-${key}" aria-label="Previous page">${K.ic ? K.ic('back') : '<'}</button>
        <span class="pg-n num" data-testid="pg-n-${key}">1/1</span>
        <button type="button" class="btn btn-sec btn-s pg-b" data-action="pg" data-pg="${key}" data-d="1" data-testid="pg-next-${key}" aria-label="Next page">${K.ic ? K.ic('play') : '>'}</button>
      </div>
    </div>`;
  };

  /** fit, then publish the side pager's width as --pgw on the parent (column headers above a side-paged grid use it) */
  function fitOne(pg) {
    fitCore(pg);
    const ctl = pg.querySelector(':scope > .pg-ctl');
    if (pg.parentElement && pg.classList.contains('nc-side')) pg.parentElement.style.setProperty('--pgw', ctl && !ctl.hidden ? ctl.offsetWidth + 'px' : '0px');
  }
  function fitCore(pg) {
    const key = scope() + pg.getAttribute('data-pg');
    const list = pg.querySelector(':scope > .pg-list'), ctl = pg.querySelector(':scope > .pg-ctl');
    if (!list) return;
    const rows = Array.from(list.children);
    rows.forEach((r) => { r.hidden = false; });
    if (!rows.length) { ctl.hidden = true; return; }
    const top0 = rows[0].offsetTop;
    // pixel frames draw outside the box (box-shadow edges + a small drop): leave that room under the last row
    const extra = 2 + (parseFloat(getComputedStyle(rows[0]).marginBottom) || 0);
    const grid = list.classList.contains('pg-grid');
    const count = (H) => {
      const fits = (r) => r.offsetTop - top0 + r.offsetHeight + extra <= H + 4;   // HUNT5 #5: 4px tolerance (frame shadow room)
      if (grid) return rows.filter(fits).length;          // a grid fills row by row: every child whose bottom fits
      let k = 0; for (const r of rows) { if (fits(r)) k++; else break; }
      return k;
    };
    // pass 1: without the pager row — if everything fits, there is no pager at all (no wasted height)
    ctl.hidden = true;
    const H0 = list.clientHeight;
    if (H0 <= 0) return;
    if (count(H0) >= rows.length) { pages[key] = 0; pg.setAttribute('data-per', rows.length); pg.setAttribute('data-pages', 1); return; }
    // pass 2: reserve the pager row and fill the rest
    ctl.hidden = false;
    let per = count(list.clientHeight);
    // HUNT4 #2: a grid whose first row is taller than the list still shows a full row (never 1 card a page)
    if (!per && grid) per = rows.filter((r) => r.offsetTop === top0).length;
    per = Math.max(1, per);
    const n = Math.max(1, Math.ceil(rows.length / per));
    if (n === 1) { ctl.hidden = true; rows.forEach((r) => { r.hidden = false; }); pages[key] = 0; return; }
    let p = Math.min(Math.max(0, pages[key] || 0), n - 1);
    pages[key] = p;
    rows.forEach((r, i) => { r.hidden = i < p * per || i >= (p + 1) * per; });
    ctl.querySelector('.pg-n').textContent = (p + 1) + '/' + n;
    const b = ctl.querySelectorAll('.pg-b');
    b[0].disabled = p === 0; b[1].disabled = p === n - 1;
    pg.setAttribute('data-per', per); pg.setAttribute('data-pages', n);
  }
  /** fit every paged list inside root (default: the screen + open modals) */
  UI.fit = function (root) {
    const roots = root ? [root] : [globalThis.document.getElementById('screen'), globalThis.document.getElementById('modal')];
    roots.forEach((r) => { if (r) r.querySelectorAll('.pg').forEach(fitOne); });
  };
  UI.pgPage = function (key, n) { pages[scope() + key] = n; UI.fit(); };
  /** show the page that holds the row with this testid (tests / keyboard focus). @returns {boolean} */
  UI.pgReveal = function (testid) {
    const el = globalThis.document.querySelector('[data-testid="' + testid + '"]');
    const pg = el && el.closest('.pg');
    if (!pg) return !!el;
    const list = pg.querySelector(':scope > .pg-list');
    const row = Array.from(list.children).find((c) => c === el || c.contains(el));
    const per = +pg.getAttribute('data-per') || 1;
    const i = Array.from(list.children).indexOf(row);
    if (i < 0) return false;
    pages[scope() + pg.getAttribute('data-pg')] = Math.floor(i / per);
    fitOne(pg);
    return true;
  };
  /** pager click (called from ui.js / modal.js before screen actions). @returns {boolean} handled */
  UI.pgClick = function (t) {
    if (!t || t.getAttribute('data-action') !== 'pg') return false;
    const key = t.getAttribute('data-pg'), d = +t.getAttribute('data-d') || 0;
    const k = scope() + key;
    pages[k] = Math.max(0, (pages[k] || 0) + d);
    const pg = t.closest('.pg');
    if (pg) fitOne(pg); else UI.fit();
    if (UI.click) UI.click('tap');
    return true;
  };
  /** PageUp / PageDown flip the first visible pager */
  UI.pgKey = function (ev) {
    if (ev.key !== 'PageDown' && ev.key !== 'PageUp') return false;
    const pg = Array.from(globalThis.document.querySelectorAll('#modal .pg, #screen .pg')).find((x) => x.offsetParent && !x.querySelector('.pg-ctl').hidden);
    if (!pg) return false;
    const b = pg.querySelectorAll('.pg-b')[ev.key === 'PageDown' ? 1 : 0];
    if (b && !b.disabled) UI.pgClick(b);
    return true;
  };
  if (globalThis.addEventListener) {
    let t = 0;
    globalThis.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => UI.fit(), 60); });
  }
})(globalThis.PT = globalThis.PT || {});
