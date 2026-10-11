/* Pixel Touchdown: js/ui/screens/game.js
 * Owner: WP5. Responsibility: in-game screen host (HUD + play call + pause menu).
 * Transparent screen (#screen gets pointer-events:none); PT.Session draws the field and drives PT.UI.Hud and
 * PT.UI.PlayCall. mount() calls PT.App.playGame(gid) and goes to 'postgame' { gid, box, coins0, xp0, lvl0 }
 * when it resolves, or back to HQ when the user picked "Quit to HQ" in the pause menu.
 */
(function (PT) {
  'use strict';
  const UI = PT.UI = PT.UI || {};
  let token = 0;

  UI.screens.game = {
    title: 'Game',
    chrome: 'bare',
    back: false,
    noRefresh: true,
    mount: function (el, params) {
      const L = PT.App && PT.App.L;
      const gid = params.gid;
      el.innerHTML = '<div class="game-host" data-testid="game-host"></div>';
      if (!L || gid == null) { UI.reset(); return; }
      const t = L.teams[L.userTid];
      const coins0 = t.fin.coins, xp0 = L.coach ? L.coach.xp : 0, lvl0 = L.coach ? L.coach.lvl : 1;
      const ach0 = params.ach0 || Object.keys(L.ach || {}), hype0 = params.hype0 != null ? params.hype0 : t.fin.hype;
      const my = ++token;
      let p;
      try { p = Promise.resolve(PT.App.playGame(gid)); } catch (e) { p = Promise.reject(e); }
      p.then((box) => {
        if (my !== token) return;
        const quit = UI.Hud && UI.Hud.quitRequested && UI.Hud.quitRequested();
        if (UI.Hud && UI.Hud.active && UI.Hud.active()) UI.Hud.hide();
        const b = box || (PT.App.L ? PT.League.Q.box(PT.App.L, gid) : null);
        if (PT.App.L && PT.App.L.tmp === 'quick') {   // Quick Game: its own Final screen (nothing is saved)
          if (b) UI.replace('quickpost', { gid: gid, box: b, quit: !!quit });
          else { PT.App.restore(); UI.replace('quick'); }
          return;
        }
        if (!b) { UI.reset(); return; }               // QA1: the game never started (App.playGame toasted why)
        if (quit) {
          UI.reset();
          if (b) {
            const u = PT.App.L.userTid, us = b.h === u ? b.hs : b.as, them = b.h === u ? b.as : b.hs;
            UI.Toast.show((us > them ? 'Won ' : us < them ? 'Lost ' : 'Tied ') + us + '–' + them, us >= them ? 'good' : 'info', 3000);
          }
          return;
        }
        UI.replace('postgame', { gid: gid, box: b, coins0: coins0, xp0: xp0, lvl0: lvl0, ach0: ach0, hype0: hype0 });
      }).catch((e) => {
        if (my !== token) return;
        if (PT.Log && PT.Log.error) PT.Log.error('ui', 'playGame', e);
        if (UI.Hud && UI.Hud.active && UI.Hud.active()) UI.Hud.hide();
        UI.Toast.show('The game hit an error. Try again.', 'bad');
        if (PT.App.L && PT.App.L.tmp && PT.App.restore) { PT.App.restore(); if (!PT.App.L) { UI.replace('title'); return; } }
        UI.reset();
      });
    },
    unmount: function () {
      token++;
      if (UI.PlayCall && UI.PlayCall.close) UI.PlayCall.close();
      if (UI.Hud && UI.Hud.active && UI.Hud.active()) UI.Hud.hide();
    }
  };
})(globalThis.PT = globalThis.PT || {});
