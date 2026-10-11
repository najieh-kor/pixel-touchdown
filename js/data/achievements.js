/* Pixel Touchdown: js/data/achievements.js
 * Owner: WP2. Responsibility: PT.Data.Achievements: the 32 achievements (design 14.7).
 * Fields: id, n (design #), name, desc (kid words), coins (reward), icon (PT.UI.Icons name), on (hook that checks it).
 * The checks live in js/league/achievements.js. Every achievement also gives +25 Coach XP.
 */
(function (PT) {
  'use strict';
  const D = PT.ns('Data.Achievements');

  D.list = [
    { id: 'first_hop', n: 1, name: 'First Hop', desc: 'Win your first game.', coins: 50, icon: 'paw', on: 'game' },
    { id: 'six_points', n: 2, name: 'Six Points', desc: 'Score your first touchdown.', coins: 20, icon: 'football', on: 'game' },
    { id: 'hail_yeah', n: 3, name: 'Hail Yeah', desc: 'Score a TD pass of 50+ yards.', coins: 50, icon: 'rainbow', on: 'game' },
    { id: 'pick_six', n: 4, name: 'Pick Six', desc: 'Return a pick for a TD.', coins: 50, icon: 'plane', on: 'game' },
    { id: 'shutout', n: 5, name: 'Shutout', desc: 'Win and give up 0 points.', coins: 100, icon: 'brick', on: 'game' },
    { id: 'comeback_kid', n: 6, name: 'Comeback Kid', desc: 'Win after being down by 14 or more.', coins: 100, icon: 'loop', on: 'game' },
    { id: 'perfect_season', n: 7, name: 'Perfect Season', desc: 'Go 17–0 in the regular season.', coins: 500, icon: 'hundred', on: 'season' },
    { id: 'golden_carrot', n: 8, name: 'Pixel Bowl', desc: 'Win the Pixel Bowl.', coins: 300, icon: 'carrot', on: 'game' },
    { id: 'dynasty', n: 9, name: 'Dynasty', desc: 'Win 3 Bowls in 5 seasons.', coins: 1000, icon: 'crown', on: 'game' },
    { id: 'underdog', n: 10, name: 'Underdog', desc: 'Win the Bowl as a 2-star team.', coins: 500, icon: 'paw', on: 'game' },
    { id: 'draft_genius', n: 11, name: 'Draft Genius', desc: 'A player you drafted reaches 85.', coins: 100, icon: 'grad', on: 'growth' },
    { id: 'bargain_bin', n: 12, name: 'Bargain Bin', desc: 'Playoffs with a bottom-5 payroll.', coins: 200, icon: 'cart', on: 'season' },
    { id: 'full_house', n: 13, name: 'Full House', desc: 'Get all 5 buildings to level 5.', coins: 500, icon: 'stadium', on: 'facility' },
    { id: 'zoo_keeper', n: 14, name: 'Zoo Keeper', desc: '15 different animals on your team.', coins: 100, icon: 'paw', on: 'roster' },
    { id: 'big_boot', n: 15, name: 'Big Boot', desc: 'Make a 55+ yard field goal.', coins: 100, icon: 'leg', on: 'game' },
    { id: 'iron_coach', n: 16, name: 'Iron Coach', desc: 'Coach 10 seasons.', coins: 300, icon: 'cap', on: 'preseason' },
    { id: 'hall_pass', n: 17, name: 'Hall Pass', desc: 'Your longtime player makes the Hall.', coins: 200, icon: 'pillar', on: 'hof' },
    { id: 'record_breaker', n: 18, name: 'Record Breaker', desc: 'Break a league record.', coins: 100, icon: 'scroll', on: 'record' },
    { id: 'juke_box', n: 19, name: 'Juke Box', desc: 'Dodge 3 tacklers on one play.', coins: 50, icon: 'dance', on: 'engine' },
    { id: 'clean_sheet', n: 20, name: 'Clean Sheet', desc: 'No turnovers, no flags in a game.', coins: 50, icon: 'soap', on: 'game' },
    { id: 'sack_party', n: 21, name: 'Sack Party', desc: 'Get 5+ sacks in one game.', coins: 50, icon: 'party', on: 'game' },
    { id: 'ground_hog', n: 22, name: 'Ground Hog', desc: 'Run for 200+ yards in one game.', coins: 50, icon: 'paw', on: 'game' },
    { id: 'air_mail', n: 23, name: 'Air Mail', desc: 'Pass for 400+ yards in one game.', coins: 50, icon: 'mail', on: 'game' },
    { id: 'rivalry_sweep', n: 24, name: 'Rivalry Sweep', desc: 'Beat your rival twice in one season.', coins: 50, icon: 'swords', on: 'game' },
    { id: 'piggy_bank', n: 25, name: 'Piggy Bank', desc: 'Hold 5,000 Coins.', coins: 0, icon: 'snout', on: 'coins' },
    { id: 'on_fire', n: 26, name: 'On Fire', desc: 'Reach 100 Hype.', coins: 100, icon: 'flame', on: 'hype' },
    { id: 'two_for_two', n: 27, name: 'Two for Two', desc: '5 two-point tries in a season.', coins: 50, icon: 'victory', on: 'game' },
    { id: 'turnaround', n: 28, name: 'Turnaround', desc: 'Playoffs right after a 5-win season.', coins: 200, icon: 'uturn', on: 'season' },
    { id: 'snow_angel', n: 29, name: 'Snow Angel', desc: 'Win a snow game by 21 or more.', coins: 50, icon: 'snow', on: 'game' },
    { id: 'superstar_stop', n: 30, name: 'Superstar Stop', desc: 'Make 5 Star Plays in one game.', coins: 50, icon: 'star', on: 'engine' },
    { id: 'bosss_pet', n: 31, name: 'Boss’s Pet', desc: 'Make the Boss 100% happy.', coins: 100, icon: 'happy', on: 'boss' },
    { id: 'fresh_start', n: 32, name: 'Fresh Start', desc: 'Get a new job after being let go.', coins: 50, icon: 'sprout', on: 'hired' }
  ];

  /** @param {string} id */
  D.byId = function (id) {
    for (let i = 0; i < D.list.length; i++) if (D.list[i].id === id) return D.list[i];
    return null;
  };
})(globalThis.PT = globalThis.PT || {});
