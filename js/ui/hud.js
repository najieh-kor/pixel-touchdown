/* Pixel Touchdown: js/ui/hud.js
 * Owner: WP5. Responsibility: PT.UI.Hud: scoreboard, down/dist, banners, pause/FF/timeout buttons.
 *
 *   Hud.show({ home, away, userTid?, weather? })   Hud.hide()   Hud.active() → bool
 *   Hud.update(snap.hud, snap)      no DOM writes when nothing changed (per-field string cache)
 *   Hud.banner(text, style='td'|'turnover'|'firstDown'|'info'|'good'|'bad'|'super'|'record', ms)
 *   Hud.pop(text, kind)             floating number pop ("+12 yds")
 *   Hud.setControls(mode)           'none'|'presnap'|'qb'|'carrier'|'defense'|'watch'|'kick'
 *   Hud.pauseMenu(bool) / paused()  Hud.key(ev) → bool (PT.UI's keydown hands keys here while active)
 *   Hud.quitRequested() → bool      true after "Quit to HQ" (game screen goes to HQ, not the results)
 * While shown, the HUD listens to the bus (game:* events re-emitted by PT.Session) and shows banners itself,
 * so Session does not need to call banner() for engine events. HUD buttons call PT.Input.press(btn).
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  const Hud = UI.Hud = UI.Hud || {};
  const D = () => UI.dom, K = () => UI.comp;
  const html = function () { return UI.dom.html.apply(null, arguments); };

  let host = null, on = false, cfg = null, userIdx = 0, els = {}, last = {}, subs = [];
  let mode = 'none', paused = false, quitReq = false, ffOn = false, lastBan = { t: '', at: 0 }, banTimer = 0;
  let lastSnap = null, audUsed = false, kickPlay = false;

  // ---------------- pixel icons (no emoji) ----------------
  // PT.UI.Icons.get(name) (UI art system) when present, else these tiny 8×8 pixel SVGs.
  // '#' = currentColor, '-' = white. Shared with PlayCall through Hud.icon().
  const PIX = {
    star: ['...##...', '...##...', '########', '.######.', '..####..', '.######.', '.##..##.', '.#....#.'],
    ball: ['........', '...###..', '..#####.', '.##-#-#.', '.#-#-##.', '.#####..', '..###...', '........'],
    pause: ['........', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '.##..##.', '........'],
    play: ['..#.....', '..##....', '..###...', '..####..', '..###...', '..##....', '..#.....', '........'],
    ff: ['........', '#..#....', '##.##...', '.##.##..', '.##.##..', '##.##...', '#..#....', '........'],
    skip: ['........', '#...##..', '##..##..', '###.##..', '###.##..', '##..##..', '#...##..', '........'],
    gear: ['..#..#..', '.######.', '###..###', '.##..##.', '.##..##.', '###..###', '.######.', '..#..#..'],
    home: ['...##...', '..####..', '.######.', '########', '.##..##.', '.##..##.', '.##..##.', '........'],
    shield: ['########', '########', '########', '.######.', '.######.', '..####..', '...##...', '........'],
    boot: ['..##....', '..##....', '..##....', '..##....', '..#####.', '..######', '..######', '........'],
    lob: ['........', '..####..', '.#....#.', '#......#', '#......#', '#......#', '........', '........'],
    bolt: ['....##..', '...##...', '..##....', '.######.', '....##..', '...##...', '..##....', '.##.....'],
    juke: ['..#.....', '.##.....', '#######.', '.##.....', '..#..#..', '.....##.', '.#######', '.....##.'],
    spin: ['..####..', '.#....#.', '#......#', '#....#.#', '#...###.', '.#......', '..###...', '........'],
    dive: ['#.......', '.#......', '..#.....', '...#..#.', '....#.#.', '.....##.', '...####.', '........'],
    eye: ['........', '..####..', '.#----#.', '#--##--#', '#--##--#', '.#----#.', '..####..', '........'],
    plus: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
    back: ['...#....', '..##....', '.#######', '########', '.#######', '..##....', '...#....', '........'],
    cap: ['........', '..####..', '.######.', '########', '########', '######..', '........', '........'],
    flip: ['..#..#..', '.##..##.', '########', '########', '.##..##.', '..#..#..', '........', '........'],
    clock: ['..####..', '.#----#.', '#---#--#', '#---#--#', '#---###.', '#------#', '.#----#.', '..####..'],
    robot: ['...##...', '..####..', '.######.', '.#-##-#.', '.######.', '.#----#.', '.######.', '..#..#..'],
    flame: ['...#....', '..##....', '..###.#.', '.######.', '.######.', '########', '.######.', '..####..'],
    up: ['...##...', '..####..', '.######.', '########', '...##...', '...##...', '...##...', '...##...'],
    trick: ['..####..', '.##..##.', '.....##.', '....##..', '...##...', '...##...', '........', '...##...'],
    two: ['..####..', '.##..##.', '.....##.', '...###..', '..##....', '.##.....', '.######.', '........'],
    posts: ['#.....#.', '#.....#.', '#.....#.', '#######.', '...#....', '...#....', '...#....', '........'],
    swap: ['......#.', '.#######', '......#.', '........', '.#......', '#######.', '.#......', '........'],
    warn: ['...##...', '...##...', '..####..', '..#--#..', '.##--##.', '.######.', '##-##-##', '########'],
    sun: ['...#....', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '...#....', '........'],
    cloud: ['........', '...##...', '..####..', '.######.', '########', '########', '........', '........'],
    rain: ['...##...', '..####..', '.######.', '########', '........', '.#..#..#', '#..#..#.', '........'],
    snow: ['#..#..#.', '.#.#.#..', '..###...', '#######.', '..###...', '.#.#.#..', '#..#..#.', '........'],
    wind: ['........', '#####...', '.....#..', '######..', '........', '####.#..', '.....#..', '........'],
    fog: ['........', '######..', '........', '.######.', '........', '######..', '........', '.######.'],
    dome: ['........', '..####..', '.######.', '########', '#......#', '#......#', '########', '........'],
    lock: ['..####..', '.#....#.', '.#....#.', '########', '###--###', '###--###', '########', '........']
  };
  const iconCache = {};
  function pixSvg(name) {
    if (iconCache[name]) return iconCache[name];
    const g = PIX[name] || PIX.star;
    let a = '', b = '';
    g.forEach((row, y) => { for (let x = 0; x < row.length; x++) { if (row[x] === '#') a += 'M' + x + ' ' + y + 'h1v1h-1z'; else if (row[x] === '-') b += 'M' + x + ' ' + y + 'h1v1h-1z'; } });
    const svg = '<svg class="hud-px" viewBox="0 0 8 8" width="1em" height="1em" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="' + a + '"/>' + (b ? '<path fill="#fff" d="' + b + '"/>' : '') + '</svg>';
    iconCache[name] = svg;
    return svg;
  }
  /** pixel icon as Raw HTML (PT.UI.Icons when the art system provides it) */
  Hud.icon = function (name) {
    const I = UI.Icons;
    if (I && typeof I.get === 'function') {
      try { const v = I.get(name); if (v) return D().isRaw(v) ? v : D().raw(String(v)); } catch (e) { /* local fallback */ }
    }
    return D().raw(pixSvg(name));
  };
  const ic = (n) => Hud.icon(n);
  const WX_ICON = { sunny: 'sun', cloudy: 'cloud', rain: 'rain', wind: 'wind', fog: 'fog', snow: 'snow', clear: 'dome' };

  function hostEl() { return (UI._roots && UI._roots.hud) || globalThis.document.getElementById('hud'); }
  function press(btn) { if (PT.Input && PT.Input.press) PT.Input.press(btn); }
  function hold(btn, v) {
    if (PT.Input && typeof PT.Input.hold === 'function') PT.Input.hold(btn, v);
    else if (v) press(btn);
  }
  function sess(fn) {
    const S = PT.Session;
    if (!S) return false;
    if (typeof S[fn] === 'function') { S[fn](); return true; }
    if (S.game && typeof S.game[fn] === 'function') { S.game[fn](); return true; }
    return false;
  }

  /** shared click/pointer wiring for the #hud layer (Hud + PlayCall). Installed once per element. */
  Hud._wire = function (h) {
    if (!h || h.__ptWired) return;
    h.__ptWired = true;
    h.addEventListener('click', (ev) => {
      const t = ev.target.closest ? ev.target.closest('[data-hact],[data-pact]') : null;
      if (!t || !h.contains(t) || t.disabled) return;
      if (t.hasAttribute('data-pact')) { if (UI.PlayCall && UI.PlayCall._act) UI.PlayCall._act(t, ev); return; }
      act(t.getAttribute('data-hact'), t, ev);
    });
    const holdOn = (ev) => {
      const t = ev.target.closest ? ev.target.closest('[data-hold]') : null;
      if (!t) return;
      t.classList.add('hud-pressed');
      hold(t.getAttribute('data-hold'), true);
    };
    const holdOff = (ev) => {
      const t = ev.target.closest ? ev.target.closest('[data-hold]') : null;
      if (!t || !t.classList.contains('hud-pressed')) return;
      t.classList.remove('hud-pressed');
      hold(t.getAttribute('data-hold'), false);
    };
    h.addEventListener('pointerdown', holdOn);
    h.addEventListener('pointerup', holdOff);
    h.addEventListener('pointercancel', holdOff);
    h.addEventListener('pointerout', holdOff);
  };
  Hud._host = function () { const h = hostEl(); Hud._wire(h); return h; };

  function teamBlock(gt, side, idx) {
    return html`<div class="hud-sb-tm hud-sb-${side} ${idx === userIdx ? 'hud-me' : ''}" data-h="${side}" style="${K().teamVars({ col: gt.col })}">
      <span class="hud-sb-ab">${idx === userIdx ? html`<span class="hud-sb-you" aria-label="Your team">${ic('star')}</span>` : ''}<span class="hud-sb-ball" aria-label="has the ball">${ic('ball')}</span> ${abbrOf(gt)}</span>
      <b class="hud-sb-sc num" data-h="${side}s">0</b>
      <span class="hud-sb-to" data-h="${side}t" aria-label="Timeouts"></span>
    </div>`;
  }

  /** short scorebug name: abbr, else the first 3 letters of the (short) team name */
  function abbrOf(gt) { return (gt && (gt.abbr || String(gt.name || gt.city || '').slice(0, 3).toUpperCase())) || '???'; }
  Hud.abbrOf = abbrOf;

  /** @param {{home:GameTeam, away:GameTeam, userTid?:number, weather?:Object}} c */
  Hud.show = function (c) {
    host = Hud._host();
    if (!host) return;
    cfg = c || {};
    const L = PT.App && PT.App.L;
    const ut = cfg.userTid != null ? cfg.userTid : (L ? L.userTid : -1);
    userIdx = cfg.away && cfg.away.tid === ut ? 1 : 0;
    unsub();
    last = {}; els = {}; paused = false; quitReq = false; ffOn = false; mode = 'none'; lastSnap = null;
    const home = cfg.home || { abbr: 'HOM', col: { pri: 0x3a86ff, sec: 0xffffff }, sp: 'dog' };
    const away = cfg.away || { abbr: 'AWY', col: { pri: 0xff5a5f, sec: 0xffffff }, sp: 'cat' };
    host.innerHTML = String(html`<div class="hud-root" data-h="root">
      <div class="hud-top">
        <div class="hud-sb" data-testid="hud-score">
          ${teamBlock(away, 'a', 1)}
          <div class="hud-sb-mid"><span class="hud-sb-q" data-h="q">Q1</span><span class="hud-sb-clk num" data-h="clk">5:00</span></div>
          ${teamBlock(home, 'h', 0)}
        </div>
        <button type="button" class="hud-pause-btn" data-hact="pause" data-testid="btn-pause" aria-label="Pause">${ic('pause')}</button>
      </div>
      <div class="hud-dd" data-h="ddrow"><span class="hud-dd-chip" data-h="dd"></span><span class="hud-dd-bo" data-h="bo"></span><span class="hud-dd-wx" data-h="wx"></span></div>
      <div class="hud-meters" data-h="meters" hidden>
        <div class="hud-mt" data-h="mtoff"><span class="hud-mt-l">ATK</span><span class="hud-mt-bar"><i data-h="mtoffbar"></i></span></div>
        <div class="hud-mt" data-h="mtdef"><span class="hud-mt-l">DEF</span><span class="hud-mt-bar"><i data-h="mtdefbar"></i></span></div>
      </div>
      <div class="hud-hint" data-h="hint"></div>
      <div class="hud-aimt" data-h="aimt" data-testid="hud-aim-target" hidden></div>
      <div class="hud-ret" data-h="ret" data-testid="hud-ret" hidden></div>
      <div class="hud-warn" data-h="warn" data-testid="hud-warn" hidden></div>
      <button type="button" class="hud-star" data-h="star" data-hact="star" data-testid="btn-star" hidden>TAP!</button>
      <div class="hud-kick" data-h="kick" hidden></div>
      <div class="hud-ban" data-h="ban" aria-live="assertive"></div>
      <div class="hud-pops" data-h="pop"></div>
      <div class="hud-ctl2" data-h="ctl2">
        <button type="button" class="hud-skipd" data-hact="skipdrive" data-testid="btn-skip-drive" data-h="skipd" hidden>${ic('ff')}<span class="hud-skipd-t">Skip Drive</span><span class="hud-kbd">D</span></button>
        <button type="button" class="hud-aud" data-hact="audible" data-testid="btn-audible" data-h="aud" hidden>${ic('swap')}<span class="hud-aud-t">Audible</span><span class="hud-kbd">V</span></button>
        <button type="button" class="hud-ab" data-hact="ability" data-testid="btn-ability" data-h="ab" hidden disabled aria-label="Star ability">
          <span class="hud-ab-ring"></span><span class="hud-ab-ic">${ic('star')}</span><span class="hud-ab-t" data-h="abt">SURGE</span><span class="hud-ab-n" data-h="abn" hidden></span><span class="hud-kbd">G</span>
        </button>
      </div>
      <div class="hud-ctl" data-h="ctl"></div>
      <div class="pc-layer" data-h="tray"></div>
      <div class="hud-pausel" data-h="pause" hidden></div>
    </div>`);
    D().$$('[data-h]', host).forEach((e) => { els[e.getAttribute('data-h')] = e; });
    host.classList.add('on');
    host.removeAttribute('data-phase');
    on = true;
    subscribe();
    rivalIntro();
  };

  // ---------------- rivalry + halftime ----------------
  function rivalIntro() {
    const L = PT.App && PT.App.L;
    if (!L || !cfg.home || !cfg.away) return;
    let riv = false, hot = false;
    try {
      const H = PT.League.History;
      if (H && H.isRivalGame) riv = !!H.isRivalGame(L, cfg.home.tid, cfg.away.tid);
      else riv = L.teams[cfg.home.tid].rival === cfg.away.tid || L.teams[cfg.away.tid].rival === cfg.home.tid;
      const hr = H && H.hotRival ? H.hotRival(L) : null;
      hot = !!hr && (hr.tid === cfg.home.tid || hr.tid === cfg.away.tid);
    } catch (e) { riv = false; }
    if (!riv) return;
    const sb = host && host.querySelector('.hud-sb');
    if (sb) sb.classList.add('hud-riv');
    setTimeout(() => { if (on) Hud.banner(hot ? 'HOT RIVALRY' : 'RIVALRY GAME', 'record', 2200); }, 700);
  }
  function halftimeTip(me, them, us, opp) {
    if (us < opp - 7) return 'Trailing. Short passes move the chains.';
    if ((me.to || 0) > 0) return 'Protect the ball. Throw it away under pressure.';
    if ((them.ry || 0) > (them.py || 0)) return 'They run a lot. Call Wall or Pinch.';
    if ((them.py || 0) > 120) return 'They throw a lot. Call Umbrella or Two Clouds.';
    if (us > opp + 7) return 'Up big. Run the ball and burn clock.';
    return 'Mix runs and passes. Keep them guessing.';
  }
  /** Halftime card: score, 3 quick stats each, a coach tip. Does not pause; closes on tap or after 6 s. */
  Hud.halftime = function () {
    if (!on || !els.root) return;
    const S = PT.Session, g = S && typeof S.game === 'function' ? S.game() : null;
    let box = null;
    try { box = g && g.box ? g.box() : null; } catch (e) { box = null; }
    const hs = (lastSnap && lastSnap.hud && lastSnap.hud.hs) || (box && box.hs) || 0;
    const as = (lastSnap && lastSnap.hud && lastSnap.hud.as) || (box && box.as) || 0;
    const tl = (tid) => ((box && box.tm) || []).find((x) => x.tid === tid) || {};
    const home = cfg.home || {}, away = cfg.away || {};
    const th = tl(home.tid), ta = tl(away.tid);
    const meH = userIdx === 0;
    const tip = halftimeTip(meH ? th : ta, meH ? ta : th, meH ? hs : as, meH ? as : hs);
    const row = (lab, k) => html`<tr><td class="num">${ta[k] || 0}</td><th>${lab}</th><td class="num">${th[k] || 0}</td></tr>`;
    const old = els.root.querySelector('.hud-half');
    if (old) old.remove();
    const d = globalThis.document.createElement('div');
    d.className = 'hud-half';
    d.setAttribute('data-testid', 'hud-halftime');
    d.innerHTML = String(html`<div class="hud-half-c">
      <div class="hud-half-t">${ic('pause')} HALFTIME</div>
      <div class="hud-half-sc"><span>${abbrOf(away)}</span><b class="num">${as}–${hs}</b><span>${abbrOf(home)}</span></div>
      <table class="hud-half-tb"><tbody>${row('Yards', 'ty')}${row('Pass yds', 'py')}${row('Run yds', 'ry')}</tbody></table>
      <p class="hud-half-tip">${ic('cap')} <b>Coach:</b> ${tip}</p>
      <button type="button" class="btn btn-go btn-l" data-hact="half-ok" data-testid="btn-second-half"><span class="btn-t">Second Half</span></button>
    </div>`);
    els.root.appendChild(d);
    setTimeout(() => { d.remove(); Hud.flushBanners(); }, 6500);
  };

  Hud.hide = function () {
    unsub();
    if (UI.PlayCall && UI.PlayCall.close) UI.PlayCall.close();
    const h = hostEl();
    if (h) { h.innerHTML = ''; h.classList.remove('on'); h.removeAttribute('data-phase'); h.removeAttribute('data-mode'); }
    on = false; els = {}; last = {}; paused = false; mode = 'none';
  };
  Hud.active = () => on;
  Hud.paused = () => paused;
  Hud.quitRequested = () => quitReq;
  Hud.userIdx = () => userIdx;
  Hud.timeoutsLeft = function () {
    const s = lastSnap && lastSnap.hud;
    return s && s.tos ? s.tos[userIdx] : 3;
  };
  Hud.el = (k) => els[k] || null;

  // ---------------- per-frame update ----------------
  function setText(k, v) {
    if (last[k] === v) return;
    last[k] = v;
    const e = els[k];
    if (e) e.textContent = v;
  }
  function setKey(k, v) { if (last[k] === v) return false; last[k] = v; return true; }
  function dots(n) {
    let s = '';
    for (let i = 0; i < 3; i++) s += '<i class="' + (i < n ? 'hud-on' : '') + '"></i>';
    return s;
  }

  /** @param {Object} hud snap.hud  @param {Snapshot} snap */
  Hud.update = function (hud, snap) {
    if (!on || !hud) return;
    lastSnap = snap || lastSnap;
    // 4 quarters (client decision): Q1–Q4, OT after
    setText('q', hud.q > 4 ? 'OT' : 'Q' + hud.q);
    updateAim(snap);
    setText('clk', PT.Util.fmtClock(hud.clk));
    setText('hs', String(hud.hs));
    setText('as', String(hud.as));
    const tos = hud.tos || [3, 3];
    if (setKey('tos', tos[0] + ',' + tos[1])) {
      if (els.ht) els.ht.innerHTML = dots(tos[0]);
      if (els.at) els.at.innerHTML = dots(tos[1]);
    }
    if (setKey('poss', hud.poss)) {
      if (els.h) els.h.classList.toggle('hud-ball', hud.poss === 0);
      if (els.a) els.a.classList.toggle('hud-ball', hud.poss === 1);
    }
    let dd = '';
    if (hud.down >= 1 && hud.down <= 4) {
      const goal = snap ? (snap.dir > 0 ? snap.los + hud.togo >= 110 : snap.los - hud.togo <= 10) : false;
      dd = PT.Util.ordinal(hud.down) + ' & ' + (goal ? 'Goal' : Math.max(1, Math.round(hud.togo)));
    }
    if (setKey('ddv', dd) && els.ddrow) els.ddrow.classList.toggle('hud-empty', !dd);
    setText('dd', dd);
    setText('bo', hud.ballOn ? 'Ball on ' + hud.ballOn : '');
    if (setKey('wxk', hud.wx || '') && els.wx) { els.wx.innerHTML = hud.wx ? String(ic(WX_ICON[hud.wx] || 'sun')) : ''; els.wx.title = (K().WX[hud.wx] || ['', ''])[1]; }
    if (snap && setKey('phase', snap.phase)) host.setAttribute('data-phase', snap.phase);
    // Star Play ring (R9)
    const st = snap && snap.star;
    let ring = st && st.idx >= 0 && snap.phase === 'LIVE' ? st.ring : 'none';
    if (ring === 'wait') {   // U3: "Get ready…" only when the Star is within ~8 yd of the ball
      const se = snap.ents && snap.ents[st.idx], b = snap.ball;
      if (!se || !b || Math.hypot(se.x - b.x, se.y - b.y) > 8) ring = 'none';
    }
    if (setKey('ring', ring)) {
      const b = els.star;
      if (b) {
        b.hidden = ring !== 'green' && ring !== 'wait';
        b.classList.toggle('hud-green', ring === 'green');
        b.textContent = ring === 'green' ? 'TAP!' : 'Get ready…';
      }
    }
    updateStar(hud, snap);
    // return hint pill ('fc' fair catch, 'tb' touchback)
    const rh = hud.retHint || '';
    if (setKey('ret', rh) && els.ret) {
      els.ret.hidden = !rh;
      els.ret.textContent = rh === 'fc' ? 'TAP = Fair catch' : rh === 'tb' ? 'TAP = Touchback' : '';
    }
    // FG aim / kick preview
    const kk = snap && snap.kick;
    const kOn = !!(kk && kk.on);
    const kTxt = kOn ? String(kk.pct == null ? '' : kk.pct) : '';
    if (setKey('kick', kOn + ':' + kTxt)) renderKick(kOn, kk);
  };

  /** snap.aim.tgt: the receiver the throw drag is locking onto → a subtle "To #18 Mudsley" pill (render may ring him) */
  function playerName(pid) {
    const pl = [].concat((cfg.home && cfg.home.pl) || [], (cfg.away && cfg.away.pl) || []);
    const p = pl.find((x) => x.pid === pid);
    return p ? { n: p.n || '', num: p.num } : null;
  }
  function updateAim(snap) {
    const a = snap && snap.aim;
    const t = a && a.on && a.tgt != null && a.tgt >= 0 ? a.tgt : -1;
    if (!setKey('aimTgt', t) || !els.aimt) return;
    if (t < 0) { els.aimt.hidden = true; if (els.hint) els.hint.classList.remove('hud-hint-hid'); return; }
    const e = snap.ents && snap.ents[t];
    const who = e ? playerName(e.pid) : null;
    const slot = e && e.pos ? String(e.pos) : '';
    els.aimt.innerHTML = String(html`${ic('ball')}<span>To ${who && who.num != null ? '#' + who.num + ' ' : ''}${who ? who.n : slot}</span>${slot && who ? html`<span class="hud-aimt-pos">${slot}</span>` : ''}`);
    els.aimt.hidden = false;
    if (els.hint) els.hint.classList.add('hud-hint-hid');
  }

  function watchSpeed() {
    const L = PT.App && PT.App.L;
    const w = L && L.settings && L.settings.watch;
    return w && w !== 1.5 ? w : 0.8;   // STAR_ABILITIES 8: 0.8× default (the old 1.5× default is gone)
  }
  /** STAR button + both meters (STAR_ABILITIES 6). snap.meters = { u:{off,def}, ai:{off,def} } */
  function updateStar(hud, snap) {
    const m = snap && snap.meters && snap.meters.u;
    if (setKey('mOn', !!m) && els.meters) els.meters.hidden = !m;
    if (!m) { if (els.ab && setKey('abVis', false)) els.ab.hidden = true; return; }
    const off = Math.round(m.off || 0), def = Math.round(m.def || 0);
    if (setKey('mOff', off) && els.mtoffbar) { els.mtoffbar.style.width = off + '%'; els.mtoff.classList.toggle('hud-full', off >= 100); }
    if (setKey('mDef', def) && els.mtdefbar) { els.mtdefbar.style.width = def + '%'; els.mtdef.classList.toggle('hud-full', def >= 100); }
    const userO = hud.poss === userIdx;
    const v = userO ? off : def;
    const live = snap.phase === 'PRESNAP' || snap.phase === 'LIVE';
    const ab = snap.ability;
    const act = !!(ab && (ab.user || ab.side === (userO ? 'off' : 'def') && ab.mine !== false && (ab.tid == null || isUser(ab.tid))));
    // no abilities on kickoffs / punts / FGs and their returns (engine: scrimmage plays only) → hide the button there
    if (snap.phase === 'PRESNAP' || snap.phase === 'CALL') kickPlay = false;
    const bk = snap.ball && snap.ball.kind;
    if (snap.phase === 'KICK' || (bk && /^(ko|kickoff|punt|fg|pat|onside)$/.test(bk)) || hud.retHint || (snap.cam && snap.cam.mode === 'kick')) kickPlay = true;
    const show = live && !kickPlay && mode !== 'kick' && mode !== 'none';
    if (setKey('abVis', show) && els.ab) els.ab.hidden = !show;
    const armed = !act && snap.phase === 'PRESNAP' && userO && (snap.ents || []).some((e) => e.star === 3 && e.tm === hud.poss);
    const st = act ? 'act' : armed ? 'armed' : v >= 100 ? 'full' : 'fill';
    if (setKey('abSt', st + ':' + v) && els.ab) {
      els.ab.disabled = st !== 'full';
      els.ab.setAttribute('aria-disabled', String(st !== 'full'));
      els.ab.classList.toggle('hud-full', st === 'full');
      els.ab.classList.toggle('hud-act', st === 'act' || st === 'armed');
      els.ab.style.setProperty('--m', (st === 'act' || st === 'armed' ? 100 : v) + '%');
      if (els.abt) els.abt.textContent = st === 'act' ? 'GO!' : st === 'armed' ? 'SET!' : 'SURGE';
    }
    // ROUND6 A: one Surge fires every Star of that side on the field → show how many ("SURGE x3")
    let n = 0;
    (snap.ents || []).forEach((e) => { if (e && e.tm === userIdx && (e.star === 1 || e.star === 3)) n++; });
    if (setKey('abN', n) && els.abn) { els.abn.textContent = n ? 'x' + n : ''; els.abn.hidden = !n; }
  }

  function windInfo() {
    const w = cfg && cfg.weather;
    if (!w || !w.mph) return null;
    const udir = (lastSnap && lastSnap.udir) || (userIdx === 1 ? -1 : 1);
    const ang = Math.atan2((w.wx || 0) * udir, (w.wy || 0) * udir) * 180 / Math.PI;
    return { mph: Math.round(w.mph), ang: Math.round(ang) };
  }
  function renderKick(kOn, kk) {
    const e = els.kick;
    if (!e) return;
    e.hidden = !kOn;
    if (!kOn) return;
    const w = windInfo();
    e.innerHTML = String(html`<div class="hud-kick-card"><span class="hud-kick-t">Field Goal</span>
      ${kk.pct != null ? html`<span class="hud-kick-pct num">${kk.pct}%</span>` : ''}
      ${w ? html`<span class="hud-kick-wind"><i class="hud-wind" style="transform:rotate(${w.ang}deg)">${ic('up')}</i><b class="num">${w.mph}</b> mph</span>` : html`<span class="hud-kick-wind muted">No wind</span>`}</div>`);
    if (mode === 'kick') renderControls();
  }

  // ---------------- controls ----------------
  const CTL = {
    presnap: { big: true, aud: true, btns: [{ id: 'snap', label: 'HIKE!', icon: 'ball', testid: 'btn-hike', key: 'Space' }], hint: '' },
    qb: { btns: [{ id: 'lob', label: 'LOB', icon: 'lob', testid: 'btn-lob', hold: true, key: 'Shift' }], hint: 'Pull back to throw!' },
    carrier: { btns: [
      { id: 'juke', label: 'Juke', icon: 'juke', testid: 'btn-juke', key: 'Q' },
      { id: 'spin', label: 'Spin', icon: 'spin', testid: 'btn-spin', key: 'R' },
      { id: 'dive', label: 'Dive', icon: 'dive', testid: 'btn-dive', key: 'E' },
      { id: 'sprint', label: 'Sprint', icon: 'bolt', testid: 'btn-sprint', hold: true, key: 'Shift' }], hint: '' },
    defense: { big: true, aud: true, btns: [{ id: 'snap', label: 'GO!', icon: 'shield', testid: 'btn-go', key: 'Enter' }], hint: 'Tap a defender to make him your Star' },
    watch: { row: true, btns: [
      { id: 'ff', label: '2×', icon: 'ff', testid: 'btn-ff', toggle: true, key: 'F', title: 'Fast (2×)' },
      { id: 'skip', label: 'Skip', icon: 'skip', testid: 'btn-skip', key: 'X' }], hint: '' },
    kick: { big: true, btns: [{ id: 'autokick', label: 'Auto', icon: 'boot', testid: 'btn-auto-kick', key: 'A' }], hint: 'Drag back to aim, let go to kick' }
  };
  CTL.defensePlay = CTL.watch;

  function renderControls() {
    const e = els.ctl;
    if (!e) return;
    const m = CTL[mode];
    host.setAttribute('data-mode', mode);
    if (!m) { e.innerHTML = ''; e.className = 'hud-ctl'; setText('hint', ''); if (els.aud) els.aud.hidden = true; if (els.skipd) els.skipd.hidden = true; return; }
    e.className = 'hud-ctl ' + (m.big ? 'hud-ctl-big' : m.row ? 'hud-ctl-row' : 'hud-ctl-cluster') + ' hud-n' + m.btns.length;
    const pct = lastSnap && lastSnap.kick && lastSnap.kick.pct != null ? lastSnap.kick.pct : (UI.PlayCall && UI.PlayCall._kickPct != null ? UI.PlayCall._kickPct : null);
    let hint = m.hint || '';
    if (mode === 'qb' && qbHintCount(0) > QB_HINTS) hint = '';
    if (els.hint) els.hint.classList.toggle('hud-hint-top', mode === 'qb');
    e.innerHTML = String(html`${m.btns.map((b) => {
      const label = b.id === 'autokick' && pct != null ? 'Auto (' + pct + '%)' : b.label;
      const holdA = b.hold ? D().raw(' data-hold="' + b.id + '"') : '';
      const onCls = b.toggle && b.id === 'ff' && ffOn ? ' hud-on' : '';
      return html`<button type="button" class="hud-btn hud-btn-${b.id}${onCls}" data-hact="${b.hold ? 'noop' : b.id}" data-testid="${b.testid}"${holdA} ${b.title ? D().raw('title="' + D().esc(b.title) + '"') : ''}>${b.icon ? html`<span class="hud-btn-ic" aria-hidden="true">${ic(b.icon)}</span>` : ''}<span class="hud-btn-t">${label}</span>${b.key ? html`<span class="hud-kbd">${b.key}</span>` : ''}</button>`;
    })}`);
    if (els.aud) { els.aud.hidden = !m.aud || audUsed; }
    if (els.skipd) els.skipd.hidden = !(mode === 'defense' || mode === 'watch' || mode === 'defensePlay');
    setText('hint', hint);
  }

  /** @param {'none'|'presnap'|'qb'|'carrier'|'defense'|'watch'|'kick'} m */
  Hud.setControls = function (m) {
    m = m || 'none';
    if (!on) { mode = m; return; }
    if (m === mode && els.ctl && els.ctl.childElementCount) return;
    if (m === 'qb' && mode !== 'qb') qbHintCount(1);
    mode = m;
    renderControls();
  };
  /** U2: "Pull back to throw!" only for the first 3 dropbacks (counter kept in prefs.qbHints) */
  const QB_HINTS = 3;
  function qbHintCount(add) {
    let n = 0;
    try {
      const p = PT.Save && PT.Save.prefs ? PT.Save.prefs() : {};
      n = p.qbHints || 0;
      if (add && n < QB_HINTS + 1 && PT.Save.setPrefs) { n += add; PT.Save.setPrefs({ qbHints: n }); }
    } catch (e) { n = QB_HINTS + 1; }
    return n;
  }
  Hud.mode = () => mode;

  function act(a, t) {
    if (UI.click) UI.click(a === 'pause' ? 'back' : 'tap');
    switch (a) {
      case 'half-ok': { const hf = host && host.querySelector('.hud-half'); if (hf) hf.remove(); Hud.flushBanners(); break; }
      case 'snap': press('snap'); break;
      case 'juke': case 'spin': case 'dive': press(a); break;
      case 'star': press('star'); break;
      case 'ability': press('ability'); break;
      case 'skipdrive': if (!sess('simDrive')) press('simDrive'); if (els.skipd) els.skipd.hidden = true; break;
      case 'audible': press('audible'); break;
      case 'ff': {
        ffOn = !ffOn; press('ff');
        t.classList.toggle('hud-on', ffOn);
        break;
      }
      case 'skip': if (!sess('skipPlay')) press('skip'); break;
      case 'autokick':
        if (UI.PlayCall && UI.PlayCall._kickAuto && UI.PlayCall._kickAuto()) break;
        if (!sess('autoKick')) press('autoKick');
        break;
      case 'pause': Hud.pauseMenu(true); break;
      case 'resume': Hud.pauseMenu(false); break;
      case 'settings':
        // UI agent's in-game settings modal (Game speed, Defense speed, Auto-start defense); fallback = left-handed sheet
        if (typeof UI.gameSettings === 'function') { try { UI.gameSettings(); } catch (e) { openSettings(); } } else openSettings();
        break;
      case 'simrest': simRest(false); break;
      case 'quit':
        if (hudMode() === 'practice') { Hud.pauseMenu(false); PT.Events.emit('practice:leave', {}); break; }
        UI.Modal.confirm(hudMode() === 'quick' ? 'Quit this game?' : 'Quit to HQ?', { body: 'The rest of the game will be simmed.', icon: ic('home'), yes: 'Quit', no: 'Keep playing' })
          .then((ok) => { if (ok) simRest(true); });
        break;
      default: break;
    }
  }

  /** 'quick' | 'practice' | null: Quick Game / Practice Field run on a throwaway league (PT.App.borrow) */
  function hudMode() { return cfg.mode || (PT.App && PT.App.L && PT.App.L.tmp) || null; }

  function simRest(toHub) {
    quitReq = !!toHub;
    paused = false;
    if (els.pause) els.pause.hidden = true;
    const S = PT.Session;
    if (S && typeof S.quit === 'function') S.quit({ simRest: true });
  }

  // ---------------- pause menu ----------------
  Hud.pauseMenu = function (show) {
    if (!on || !els.pause) return;
    show = !!show;
    if (show === paused) return;
    paused = show;
    const S = PT.Session;
    if (show) {
      if (S && typeof S.pause === 'function') S.pause();
      els.pause.innerHTML = String(html`<div class="hud-pm-back"></div><div class="hud-pm-card" role="dialog" aria-label="Paused">
        <div class="hud-pm-emo" aria-hidden="true">${ic('pause')}</div>
        <h2 class="hud-pm-t">Paused</h2>
        <div class="hud-pm-btns">
          ${K().btn({ label: 'Resume', icon: ic('play'), kind: 'go', size: 'l', testid: 'btn-resume', cls: 'btn-wide', data: { hact: 'resume' } })}
          ${K().btn({ label: 'Settings', icon: ic('gear'), kind: 'sec', size: 'm', testid: 'btn-game-settings', cls: 'btn-wide', data: { hact: 'settings' } })}
          ${hudMode() === 'practice' ? '' : K().btn({ label: 'Sim to End', icon: ic('ff'), kind: 'sec', size: 'm', testid: 'btn-sim-rest', cls: 'btn-wide', data: { hact: 'simrest' } })}
          ${K().btn({ label: hudMode() === 'practice' ? 'Leave Practice' : hudMode() === 'quick' ? 'Quit Game' : 'Quit to HQ', icon: ic('home'), kind: 'bad', size: 'm', testid: 'btn-quit-game', cls: 'btn-wide', data: { hact: 'quit' } })}
        </div></div>`);
      els.pause.hidden = false;
      const r = els.pause.querySelector('[data-testid="btn-resume"]');
      try { if (r) r.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    } else {
      els.pause.hidden = true;
      els.pause.innerHTML = '';
      if (S && typeof S.resume === 'function') S.resume();
    }
    if (els.root) els.root.classList.toggle('hud-paused', show);
  };

  function openSettings() {
    // ROUND6 E: game speed and auto-start live only in the main Settings screen. In-game: left-handed only + a pointer.
    const L = PT.App && PT.App.L;
    const s = (L && L.settings) || {};
    UI.Modal.open({
      title: 'Game Settings', icon: ic('gear'), cls: 'm-hudset',
      body: html`<button type="button" class="hud-set-row" data-action="tog" data-k="lefty" data-testid="tog-lefty"><span class="grow">Left-handed</span><span class="toggle ${s.lefty ? 'on' : ''}"></span></button>
        <p class="small muted hud-set-note">Game speed and Auto-start defense are in Settings (from HQ or the title).</p>`,
      actions: { tog: (el) => { const tg = el.querySelector('.toggle'); if (tg) tg.classList.toggle('on'); } },
      buttons: [{ label: 'Done', value: true, kind: 'go', testid: 'btn-game-settings-done' }],
      collect: (card) => {
        if (!L) return true;
        const r = card.querySelector('[data-k="lefty"] .toggle');
        L.settings = L.settings || {};
        L.settings.lefty = !!(r && r.classList.contains('on'));
        if (UI.applyPrefs) UI.applyPrefs();
        if (PT.Events) PT.Events.emit('league:changed', { what: 'settings' });
        return true;
      }
    });
  }


  // ---------------- banners & pops ----------------
  /** Big bouncy centered text. style: td|turnover|firstDown|info|good|bad|super|record */
  /** a choice is on screen (play / audible tray, 4th down, PAT, halftime card, pause): charged-up UI must not cover it */
  function choiceOpen() {
    if (!els.root) return false;
    return els.root.classList.contains('hud-tray-open') || !!els.root.querySelector('.hud-half') || paused;
  }
  const banQ = [];
  /** show banners queued while a choice was open (called by PlayCall when its tray closes) */
  Hud.flushBanners = function () {
    if (!on || choiceOpen()) return;
    const now = D().now();
    const fresh = banQ.splice(0).filter((x) => now - x.at < 4000);
    fresh.forEach((x, i) => setTimeout(() => { if (on) Hud.banner(x.text, x.style, x.ms); }, i * 900));
  };
  Hud.banner = function (text, style, ms) {
    if (!on || !els.ban || !text) return;
    if (choiceOpen()) {     // queue until the choice closes (never on top of cards / HIKE / GO)
      if (!banQ.some((x) => x.text === text)) banQ.push({ text: text, style: style, ms: ms, at: D().now() });
      while (banQ.length > 3) banQ.shift();
      return;
    }
    const now = D().now();
    if (lastBan.t === text && now - lastBan.at < 400) return;
    lastBan = { t: text, at: now };
    style = style || 'info';
    const b = globalThis.document.createElement('div');
    b.className = 'hud-bn hud-bn-' + style + (String(text).length > 11 ? ' hud-bn-long' : '');
    b.setAttribute('data-testid', 'hud-banner');
    b.innerHTML = String(html`<span class="hud-bn-t">${text}</span>`);
    els.ban.innerHTML = '';
    els.ban.appendChild(b);
    clearTimeout(banTimer);
    banTimer = setTimeout(() => { b.classList.add('hud-out'); setTimeout(() => b.remove(), 300); }, ms || (style === 'td' ? 2200 : 1400));
  };
  /** floating pop near the field center ("+12 yds") */
  Hud.pop = function (text, kind) {
    if (!on || !els.pop || !text) return;
    const p = globalThis.document.createElement('span');
    p.className = 'hud-pop hud-pop-' + (kind || 'info');
    p.textContent = text;
    els.pop.appendChild(p);
    setTimeout(() => p.remove(), 1300);
    while (els.pop.children.length > 3) els.pop.removeChild(els.pop.firstChild);
  };

  function teamOf(tid) {
    if (!cfg) return null;
    if (cfg.home && cfg.home.tid === tid) return cfg.home;
    if (cfg.away && cfg.away.tid === tid) return cfg.away;
    return null;
  }
  function isUser(tid) { const gt = userIdx === 1 ? cfg.away : cfg.home; return gt && gt.tid === tid; }
  function inPlayFx(fn) { return (p) => { if (on) fn(p || {}); }; }

  function subscribe() {
    const E = PT.Events;
    if (!E) return;
    const on_ = (n, fn) => subs.push(E.on(n, inPlayFx(fn)));
    on_('game:touchdown', (p) => {
      Hud.banner('TOUCHDOWN!', 'td', 2400);
      const gt = teamOf(p.tid);
      if (els.root) K().confetti(els.root, 70, gt ? [D().hex(gt.col.pri), D().hex(gt.col.sec), '#ffd23f', '#ffffff'] : null);
      if (p.yds) Hud.pop(p.yds + ' yd TD!', 'good');
    });
    on_('game:turnover', (p) => {
      const t = p.kind === 'int' ? 'PICK!' : p.kind === 'fumble' ? 'FUMBLE!' : 'LOST BALL!';
      Hud.banner(t, isUser(p.tid) ? 'good' : 'turnover');
      // a user pick / fumble recovery in a live play: the user runs it back → carrier controls
      if (isUser(p.tid) && p.kind !== 'downs' && lastSnap && lastSnap.phase === 'LIVE') Hud.setControls('carrier');
    });
    on_('game:firstDown', () => Hud.banner('FIRST DOWN!', 'firstDown', 1100));
    on_('game:fieldGoal', (p) => Hud.banner(p.good ? 'FIELD GOAL!' : 'NO GOOD!', p.good ? (isUser(p.tid) ? 'td' : 'info') : 'bad', 1800));
    on_('game:pat', (p) => {
      if (p.kind === 'two') Hud.banner(p.good ? 'TWO POINTS!' : 'NO GOOD!', p.good ? 'good' : 'bad');
      else if (!p.good) Hud.banner('NO GOOD!', 'bad');
      else Hud.pop('+1 Extra point', 'good');
    });
    on_('game:safety', () => Hud.banner('SAFETY!', 'turnover'));
    on_('game:sack', () => Hud.banner('SACK!', 'bad'));
    on_('game:edge', (p) => {
      // INT: the real engine draws p.txt in the world at the line (fx 'text'); a full-width banner 0.3 s into a
      // live play hid the field and duplicated it. Banners stay for k-only payloads (stub / older engines).
      if (p.txt) return;
      else if (p.k === 'fooled') Hud.banner("Fooled 'em!", 'good', 1300);
      else if (p.k === 'read') Hud.banner('They read it!', 'bad', 1300);
    });
    // end of Q1 / Q3 get a small banner; Q2 → the halftime card (game:halftime); Q4 → FINAL (or overtime)
    on_('game:quarterEnd', (p) => { if (p.q && p.q !== 2 && p.q < 4) Hud.banner('End of Q' + p.q, 'info', 1300); });
    on_('game:halftime', () => Hud.halftime());
    // one-minute warning (3:00 quarters): engine emits 'minuteWarning' ('twoMinute' kept as an alias);
    // both can arrive for the same moment, the banner's 400 ms de-dupe shows it once
    on_('game:minuteWarning', () => Hud.banner('1:00 WARNING', 'info', 1500));
    on_('game:twoMinute', () => Hud.banner('1:00 WARNING', 'info', 1500));
    on_('game:dive', () => { if (mode === 'watch' || (lastSnap && lastSnap.star && lastSnap.star.ring === 'used')) Hud.banner('SUPER!', 'super', 1000); });
    on_('game:star', () => Hud.banner('SUPER!', 'super', 1000));
    on_('game:record', () => Hud.banner('NEW RECORD!', 'record', 2200));
    on_('game:ability', (p) => {
      const list = Array.isArray(p.names) ? p.names : Array.isArray(p.abilities) ? p.abilities.map((a) => (a && (a.name || a.k)) || a) : [p.name || 'Star Power'];
      const uniq = list.filter((x, i) => x && list.indexOf(x) === i);
      const nm = uniq.map((x) => String(x).toUpperCase()).join(' + ') + '!';
      const mine = p.user || isUser(p.tid);
      if (p.perfect && mine) { Hud.banner('PERFECT!', 'super', 900); setTimeout(() => { if (on) Hud.banner(nm, 'super', 1300); }, 850); }
      else Hud.banner(nm, mine ? 'super' : 'bad', 1400);
    });
    on_('game:abilityWarn', () => warn('Their Star is powered up!'));
    // INT2: an offense Star armed pre-snap fires on the catch / handoff / throw — say so (it was silent before)
    on_('game:abilityArmed', (p) => {
      if (!(p.user || isUser(p.tid))) return;
      const when = /magnet/i.test(p.name || '') ? 'on the catch' : /turbo/i.test(p.name || '') ? 'when he gets the ball' : 'on the throw';
      Hud.pop(String(p.name || 'Star').toUpperCase() + ' READY ' + when, 'good');
    });
    on_('game:audibleCall', () => { audUsed = true; if (els.aud) els.aud.hidden = true; });
    // one audible per play (INT2): reset only when a new play is called / the old one ends. Resetting on a mode
    // change brought the button back after the audible's re-lineup, and the engine then refused the 2nd audible.
    on_('game:call', () => { audUsed = false; });
    on_('game:playEnd', () => { audUsed = false; });
    // Yards / incomplete text is drawn in the 3D world by the renderer (engine fx 'text' = play desc), so the HUD
    // adds no second "+N yds" / "No catch" line (too much text at once). Only the big banners above stay.
    on_('game:gameEnd', () => { Hud.setControls('none'); Hud.banner('FINAL!', 'record', 2600); });
  }
  let warnT = 0;
  /** small warning pill in the top band (enemy Star ready) */
  function warn(text) {
    if (!on || !els.warn) return;
    els.warn.innerHTML = String(html`${ic('warn')}<span>${text}</span>`);
    els.warn.hidden = false;
    els.warn.classList.remove('hud-pulse'); void els.warn.offsetWidth; els.warn.classList.add('hud-pulse');
    clearTimeout(warnT);
    warnT = setTimeout(() => { if (els.warn) els.warn.hidden = true; }, 2600);
  }
  Hud.warn = warn;
  function unsub() { subs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); subs = []; }

  // ---------------- keyboard ----------------
  /** Called by PT.UI's keydown while the HUD is active. Return true when handled. */
  Hud.key = function (ev) {
    const k = ev.key;
    if (UI.Modal && UI.Modal.isOpen()) {
      if (k === 'Escape') { UI.Modal.cancelTop(); return true; }
      return false;
    }
    if (paused) {
      if (k === 'Escape' || k === 'p' || k === 'P') { Hud.pauseMenu(false); return true; }
      return false;
    }
    if (UI.PlayCall && UI.PlayCall.isOpen && UI.PlayCall.isOpen() && UI.PlayCall.key(ev)) return true;
    if (k === 'Escape' || k === 'p' || k === 'P') { Hud.pauseMenu(true); return true; }
    if (mode === 'defense' && k === 'Enter') { press('snap'); return true; }
    if (mode === 'presnap' && k === 'Enter') { press('snap'); return true; }
    if (mode === 'watch' && (k === 'x' || k === 'X')) { act('skip'); return true; }
    if (mode === 'kick' && (k === 'a' || k === 'A')) { act('autokick'); return true; }
    return false;
  };
})(globalThis.PT = globalThis.PT || {});
