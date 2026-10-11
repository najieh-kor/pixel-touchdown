/* Pixel Touchdown: js/data/traits.js
 * Owner: WP1. Responsibility: PT.Data.Traits: player trait defs (id, name, desc, engine/sim modifiers).
 * Source: GAME_DESIGN.md 5.1–5.2 (34 traits: 26 Perks, 8 Quirks). Ids = PT.C.TRAITS.
 *
 * Entry: { id, name, type:'perk'|'quirk', pos:[POS…] (allowed natural positions; 'any' expanded to all),
 *          desc, eng:{…} (exact engine numbers, WP3), sim:{…} (quick-sim, WP1 StatSim), fr:{…} (franchise, WP2),
 *          maxAgeCreate?:int (only given at creation when age ≤ this) }
 *
 * eng keys (all from design 5.2; *Mult multiply, *Add add, others replace):
 *   ballSpeedMult, maxThrowAdd (yd) · deepSigmaMult + deepMin (yd) · windup (s) · runSpeedMult, runThrowSigmaMult, escapeAdd
 *   closeAll (all skills in a close game) · playoffAll (all skills in playoff games) · contestedAdd, dropMult
 *   breakAdd (his break-tackle chance) · jukeAdd · spinCooldown (s), spinAdd · sprintMult (replaces 1.15), energyMax
 *   turnLossMult, manSepAdd (yd) · intMult · trailAdd (yd) · rushWinMult, stripAdd · breakVsAdd (carrier's chance vs him)
 *   passBlockAdd (s) · shedVsAdd (s, defender shed time vs him) · windMult, kickSigmaMult · fgRangeAdd, puntAdd (yd)
 *   fumbleMult · injMult, sevDown · penaltyMult · autoKickAdd (probability points, e.g. −0.08)
 * sim keys (StatSim): ovr (slot OVR add), close, po (OVR adds in close / playoff games), comp (completion % add as QB or
 *   target), catchW (target-share weight), sack (×, as rusher), sackVs (×, as blocker/QB), qbRun (× QB carry share),
 *   ypc (yards per carry add, carrier/blocker), ypcVs (as defender), big (× long-play chance), int (× pick weight),
 *   compVs (completion add vs him), ff (× forced fumble weight), fum (× fumble weight), inj (× injury weight),
 *   sevDown (injury tier −1), kick (FG/XP make add), punt (net yd add), pen (× penalty weight)
 * fr keys (WP2): teamMood, hypePerTd, captainMult, trainMult, prog + progMaxAge / progMinAge, askMult, hypeSeason, moodLossMult
 */
(function (PT) {
  'use strict';
  const Traits = PT.ns('Data.Traits');

  const ANY = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
  const P = (s) => (s === 'any' ? ANY.slice() : s.split(','));

  Traits.list = [
    { id: 'rocket_arm', name: 'Rocket Arm', type: 'perk', pos: P('QB'), desc: 'Ball speed +15%; max throw distance +10 yd.',
      eng: { ballSpeedMult: 1.15, maxThrowAdd: 10 }, sim: { ovr: 1, big: 1.1 } },
    { id: 'dime_dropper', name: 'Dime Dropper', type: 'perk', pos: P('QB'), desc: 'Throw error ×0.75 on throws of 20+ yd.',
      eng: { deepSigmaMult: 0.75, deepMin: 20 }, sim: { comp: 0.01, big: 1.05 } },
    { id: 'quick_release', name: 'Quick Release', type: 'perk', pos: P('QB'), desc: 'Throw wind-up 0.10 s instead of 0.25 s.',
      eng: { windup: 0.10 }, sim: { sackVs: 0.85 } },
    { id: 'scrambler', name: 'Scrambler', type: 'perk', pos: P('QB'), desc: 'Run speed +6%; throw-on-the-run error penalty halved.',
      eng: { runSpeedMult: 1.06, runThrowSigmaMult: 1.25, escapeAdd: 0.10 }, sim: { sackVs: 0.9, qbRun: 1.5 } },
    { id: 'ice_cold', name: 'Ice Cold', type: 'perk', pos: P('any'), desc: 'In a close game: all skills +5.',
      eng: { closeAll: 5 }, sim: { close: 5 } },
    { id: 'big_game', name: 'Big Game', type: 'perk', pos: P('any'), desc: 'Playoff games: all skills +4.',
      eng: { playoffAll: 4 }, sim: { po: 4 } },
    { id: 'glue_paws', name: 'Glue Paws', type: 'perk', pos: P('WR,TE,RB'), desc: 'Contested catch score +12; drop chance ×0.5.',
      eng: { contestedAdd: 12, dropMult: 0.5 }, sim: { comp: 0.01, catchW: 1.1 } },
    { id: 'truck_stick', name: 'Truck Stick', type: 'perk', pos: P('RB,TE,QB'), desc: 'Break-tackle chance +0.15.',
      eng: { breakAdd: 0.15 }, sim: { ypc: 0.3 } },
    { id: 'ankle_breaker', name: 'Ankle Breaker', type: 'perk', pos: P('RB,WR,QB'), desc: 'Juke success +0.20.',
      eng: { jukeAdd: 0.20 }, sim: { ypc: 0.2, big: 1.05 } },
    { id: 'spin_doctor', name: 'Spin Doctor', type: 'perk', pos: P('RB,WR'), desc: 'Spin cooldown 1.0 s (from 2.0 s); spin success +0.15.',
      eng: { spinCooldown: 1.0, spinAdd: 0.15 }, sim: { ypc: 0.15 } },
    { id: 'speed_demon', name: 'Speed Demon', type: 'perk', pos: P('RB,WR,CB,S'), desc: 'Sprint speed bonus 1.20 (from 1.15); Energy max 130.',
      eng: { sprintMult: 1.20, energyMax: 130 }, sim: { big: 1.15 } },
    { id: 'route_artist', name: 'Route Artist', type: 'perk', pos: P('WR,TE'), desc: 'Route turns lose half the time; +0.3 yd separation vs Buddy coverage.',
      eng: { turnLossMult: 0.5, manSepAdd: 0.3 }, sim: { catchW: 1.15, comp: 0.005 } },
    { id: 'ball_hawk', name: 'Ball Hawk', type: 'perk', pos: P('CB,S,LB'), desc: 'Interception chance ×1.5.',
      eng: { intMult: 1.5 }, sim: { int: 1.5 } },
    { id: 'lockdown', name: 'Lockdown', type: 'perk', pos: P('CB,S'), desc: 'Buddy-coverage trail distance −0.5 yd.',
      eng: { trailAdd: -0.5 }, sim: { compVs: -0.008 } },
    { id: 'sack_master', name: 'Sack Master', type: 'perk', pos: P('DL,LB'), desc: 'Pass-rush win time ×0.85; strip-sack fumble chance +0.10.',
      eng: { rushWinMult: 0.85, stripAdd: 0.10 }, sim: { sack: 1.18, ff: 1.1 } },
    { id: 'sure_tackler', name: 'Sure Tackler', type: 'perk', pos: P('DL,LB,CB,S'), desc: 'Break-tackle chance vs him −0.15.',
      eng: { breakVsAdd: -0.15 }, sim: { ypcVs: -0.15 } },
    { id: 'brick_wall', name: 'Brick Wall', type: 'perk', pos: P('OL,TE'), desc: 'Pass-block hold time +1.0 s.',
      eng: { passBlockAdd: 1.0 }, sim: { sackVs: 0.85 } },
    { id: 'road_grader', name: 'Road Grader', type: 'perk', pos: P('OL,TE'), desc: 'Run-block: defender shed time +0.5 s.',
      eng: { shedVsAdd: 0.5 }, sim: { ypc: 0.2 } },
    { id: 'ice_toes', name: 'Ice Toes', type: 'perk', pos: P('K'), desc: 'Wind drift ×0.5; kick error ×0.8.',
      eng: { windMult: 0.5, kickSigmaMult: 0.8 }, sim: { kick: 0.03 } },
    { id: 'boomer', name: 'Boomer', type: 'perk', pos: P('K'), desc: 'Max field goal range +5 yd; punt distance +5 yd.',
      eng: { fgRangeAdd: 5, puntAdd: 5 }, sim: { kick: 0.02, punt: 5 } },
    { id: 'hype_pup', name: 'Hype Pup', type: 'perk', pos: P('any'), desc: 'Team Mood +5 while on the roster; +1 Hype per TD he scores.',
      eng: {}, sim: {}, fr: { teamMood: 5, hypePerTd: 1 } },
    { id: 'leader', name: 'Leader', type: 'perk', pos: P('any'), desc: 'When Captain: Captain effects doubled.',
      eng: {}, sim: {}, fr: { captainMult: 2 } },
    { id: 'gym_rat', name: 'Gym Rat', type: 'perk', pos: P('any'), desc: 'Training Camp and Practice gains ×1.5 (round up).',
      eng: {}, sim: {}, fr: { trainMult: 1.5 } },
    { id: 'late_bloomer', name: 'Late Bloomer', type: 'perk', pos: P('any'), desc: '+2 growth per year until age 27.', maxAgeCreate: 25,
      eng: {}, sim: {}, fr: { prog: 2, progMaxAge: 27 } },
    { id: 'iron_hide', name: 'Iron Hide', type: 'perk', pos: P('any'), desc: 'Injury chance ×0.5; injuries one tier milder.',
      eng: { injMult: 0.5, sevDown: 1 }, sim: { inj: 0.5, sevDown: 1 }, fr: { sevDown: 1 } },
    { id: 'hometown_hero', name: 'Hometown Hero', type: 'perk', pos: P('any'), desc: 'Asks 20% less to stay; +3 Hype at season start.',
      eng: {}, sim: {}, fr: { askMult: 0.8, hypeSeason: 3 } },
    { id: 'glass_bones', name: 'Glass Bones', type: 'quirk', pos: P('any'), desc: 'Injury chance ×1.75.',
      eng: { injMult: 1.75 }, sim: { inj: 1.75 } },
    { id: 'fumbley', name: 'Fumble-y', type: 'quirk', pos: P('RB,WR,TE,QB'), desc: 'Fumble chance ×2.',
      eng: { fumbleMult: 2 }, sim: { fum: 2 } },
    { id: 'stone_hands', name: 'Stone Hands', type: 'quirk', pos: P('WR,TE,RB'), desc: 'Drop chance ×1.6; contested catch score −8.',
      eng: { dropMult: 1.6, contestedAdd: -8 }, sim: { comp: -0.015, catchW: 0.9 } },
    { id: 'shaky_paws', name: 'Shaky Paws', type: 'quirk', pos: P('any'), desc: 'In a close game: all skills −5.',
      eng: { closeAll: -5 }, sim: { close: -5 } },
    { id: 'flag_magnet', name: 'Flag Magnet', type: 'quirk', pos: P('any'), desc: 'Penalty chance on his snaps ×3.',
      eng: { penaltyMult: 3 }, sim: { pen: 3 } },
    { id: 'grumpy_gus', name: 'Grumpy Gus', type: 'quirk', pos: P('any'), desc: 'Team Mood −3 while on the roster; his Mood losses ×2.',
      eng: {}, sim: {}, fr: { teamMood: -3, moodLossMult: 2 } },
    { id: 'early_peak', name: 'Early Peak', type: 'quirk', pos: P('any'), desc: '−1 growth per year from age 27.',
      eng: {}, sim: {}, fr: { prog: -1, progMinAge: 27 } },
    { id: 'wild_leg', name: 'Wild Leg', type: 'quirk', pos: P('K'), desc: 'Kick error ×1.3; Auto kick chance −8 points.',
      eng: { kickSigmaMult: 1.3, autoKickAdd: -0.08 }, sim: { kick: -0.08 } }
  ];
  Traits.list.forEach((t) => { if (!t.fr) t.fr = {}; });

  const IDX = {};
  Traits.list.forEach((t) => { IDX[t.id] = t; });

  /** @returns {Object|null} */
  Traits.byId = (id) => IDX[id] || null;
  Traits.perks = Traits.list.filter((t) => t.type === 'perk').map((t) => t.id);
  Traits.quirks = Traits.list.filter((t) => t.type === 'quirk').map((t) => t.id);
  /** trait ids allowed for a natural position */
  Traits.forPos = (pos, type) => Traits.list.filter((t) => t.pos.indexOf(pos) >= 0 && (!type || t.type === type)).map((t) => t.id);
  /** design 5.1 generation odds */
  Traits.GEN = { COUNT: [[0, 50], [1, 40], [2, 10]], QUIRK_CHANCE: 0.25, STAR_OVR: 82, MAX_GEN: 2 };
})(globalThis.PT = globalThis.PT || {});
