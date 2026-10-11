/* Pixel Touchdown: js/data/twists.js
 * Owner: WP2. Responsibility: PT.Data.Twists: the 20 Season Twists (design 14.2) with machine-readable effects.
 * `fx` is read by PT.League.Twists.fx(L) (league side) and may be read by the engine via GameConfig.twist + byId().
 *   windMult      wind speed ×           windChance  Wind weather chance ×
 *   snowMult      Snow chance × (Cold/Mild)          snowEarly   Cold climates can snow from Week 1
 *   fumbleMult    fumble chance ×        draftOvr    this year's draft class +N OVR
 *   capBoom       Team Cash limit × this season       capCrunch   no Team Cash growth this season
 *   fg50Pts       points for a 50+ yd FG shedTime    run-block shed time +s
 *   ballSpeed     ball speed ×           catchBonus  uncontested catch chance +
 *   injMult       injury chance ×        ticketMult  ticket income ×      hypeBonus  every Hype gain +N
 *   playoffMoney  playoff checks and Bowl bonus ×    twoPtFrom   2-pt try yard line   xpFrom  XP kick yard line
 *   spd           all players +N Speed in games      tradeThr    AI swap threshold +N (negative = easier)
 *   aiSwaps       AI-to-AI swaps ×       rivalMult   rival game Hype & Boss changes ×
 *   longBomb      { yd, hype, coins } bonus per long TD                  mystery    outdoor weather uniform over 6 types
 */
(function (PT) {
  'use strict';
  const D = PT.ns('Data.Twists');

  D.list = [
    { id: 'normal', n: 1, name: 'Normal Season', desc: 'No twist this year. Just football.', p0: true, fx: {} },
    { id: 'windy', n: 2, name: 'Windy Year', desc: 'Wind blows harder and more often.', p0: true, fx: { windMult: 1.5, windChance: 2 } },
    { id: 'snow_globe', n: 3, name: 'Snow Globe', desc: 'Twice the snow in cold and mild towns.', p0: false, fx: { snowMult: 2, snowEarly: true } },
    { id: 'butterfinger', n: 4, name: 'Butterfinger Season', desc: 'The ball is slippery. More fumbles.', p0: true, fx: { fumbleMult: 1.3 } },
    { id: 'rookie_rush', n: 5, name: 'Rookie Rush', desc: 'This year’s draft class is +3 overall.', p0: false, fx: { draftOvr: 3 } },
    { id: 'cap_boom', n: 6, name: 'Cap Boom', desc: 'Team Cash limit is 10% bigger this season.', p0: true, fx: { capBoom: 1.1 } },
    { id: 'cap_crunch', n: 7, name: 'Cap Crunch', desc: 'Team Cash limit does not grow this year.', p0: true, fx: { capCrunch: true } },
    { id: 'kicker_chaos', n: 8, name: 'Kicker Chaos', desc: 'Field goals of 50+ yards are worth 4 points.', p0: true, fx: { fg50Pts: 4 } },
    { id: 'ground_war', n: 9, name: 'Ground War', desc: 'Blockers are tougher. Running is easier.', p0: false, fx: { shedTime: 0.3 } },
    { id: 'air_show', n: 10, name: 'Air Show', desc: 'Passes fly faster and catches are easier.', p0: false, fx: { ballSpeed: 1.05, catchBonus: 0.03 } },
    { id: 'injury_bug', n: 11, name: 'Injury Bug', desc: 'More injuries this year.', p0: true, fx: { injMult: 1.25 } },
    { id: 'iron_year', n: 12, name: 'Iron Year', desc: 'Fewer injuries this year.', p0: true, fx: { injMult: 0.75 } },
    { id: 'fan_frenzy', n: 13, name: 'Fan Frenzy', desc: 'More ticket money and extra Hype.', p0: true, fx: { ticketMult: 1.25, hypeBonus: 1 } },
    { id: 'golden_ticket', n: 14, name: 'Golden Ticket', desc: 'Playoff money is doubled.', p0: false, fx: { playoffMoney: 2 } },
    { id: 'two_point_party', n: 15, name: 'Two-Point Party', desc: '2-point tries from the 1. Extra points from the 20.', p0: false, fx: { twoPtFrom: 1, xpFrom: 20 } },
    { id: 'speedy', n: 16, name: 'Speedy Season', desc: 'Every player gets +2 Speed in games.', p0: true, fx: { spd: 2 } },
    { id: 'trade_frenzy', n: 17, name: 'Trade Frenzy', desc: 'Swaps are easier, and teams swap more.', p0: false, fx: { tradeThr: -0.10, aiSwaps: 2 } },
    { id: 'rivalry', n: 18, name: 'Rivalry Season', desc: 'Rival games count double for Hype and the Boss.', p0: false, fx: { rivalMult: 2 } },
    { id: 'long_bomb', n: 19, name: 'Long Bomb Bonus', desc: 'Every 40+ yard TD gives Hype and Coins.', p0: false, fx: { longBomb: { yd: 40, hype: 2, coins: 10 } } },
    { id: 'mystery_weather', n: 20, name: 'Mystery Weather', desc: 'Any weather can hit any outdoor field.', p0: false, fx: { mystery: true } }
  ];

  /** @param {string} id @returns {Object|null} */
  D.byId = function (id) {
    for (let i = 0; i < D.list.length; i++) if (D.list[i].id === id) return D.list[i];
    return null;
  };
})(globalThis.PT = globalThis.PT || {});
