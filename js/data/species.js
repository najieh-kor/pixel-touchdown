/* Pixel Touchdown: js/data/species.js
 * Owner: WP1. Responsibility: PT.Data.Species: species ids, display names, rating biases, size class.
 * Source: GAME_DESIGN.md 3.2–3.4 (exact). Ids per RECONCILE R2 (lowercase English, Crocodile → 'croc').
 *
 * Entry: { id, name, size:'S'|'M'|'L', best:[pos], bias:{skill:+n}, quirk:{ id, name, desc, eng:{…}, sim:{…}, fr:{…} },
 *          colors:[{main,acc},{main,acc}] (scheme A/B = player.look.v), kr:bool (also a natural returner) }
 * quirk.eng keys (engine, WP3), all additive unless named *Mult:
 *   blockShedAdd (s added to a defender's shed time vs this blocker), rushWinAdd (s, his pass-rush win time),
 *   maxPushback (yd), chaseSpeedMult, reachAdd / heightAdd (catch reach & height, yd), fumbleMult, ffMult (his tackles),
 *   intMult, dropMult, jukeAdd, diveAdd (yd), hitboxAdd (yd), trailAdd (yd, buddy coverage), passBlockAdd (s),
 *   sprintMult, sprintDrainMult, readAdd (s, AI QB read time), deepReadSmt, tklNearAdd (+TKL with a defender ≤ 3 yd),
 *   immune:[weather keys] ('rain','snow','fog','snowMov' = only the Moves part of Snow).
 * quirk.fr keys (franchise, WP2): moodMult, moodFloor, noLossMood, injMult, injIgnore (Nine Lives chance),
 *   spiritPerSack + spiritMax, hypePerScore.
 */
(function (PT) {
  'use strict';
  const Species = PT.ns('Data.Species');

  const ALL_POS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
  const hx = (s) => parseInt(s.slice(1), 16);

  // id | name | size | best spots | biases | colors A main/acc | colors B main/acc
  const RAW = [
    'elephant|Elephant|L|OL,DL|pow+12 tkl+4 spd-10 mov-6|#9AA3AD #D9DDE2|#E7A6B9 #F7D9E2',
    'rhino|Rhino|L|DL,OL|pow+10 tkl+6 spd-6 hnd-6|#8C8F94 #C4C1B8|#B9A089 #E3D3C2',
    'hippo|Hippo|L|OL,DL|pow+10 tkl+4 spd-8 mov-4|#A68BA8 #E8B7C8|#7D8CA3 #C7D2E0',
    'bear|Bear|L|DL,LB|pow+8 tkl+6 spd-3 aim-4|#7A4E2D #C79A6B|#EDEDED #BFD7E6',
    'gorilla|Gorilla|L|OL,TE,DL|pow+9 hnd+3 spd-3 aim-4|#3B3B3F #7E7A80|#5A4632 #9C8770',
    'walrus|Walrus|L|OL|pow+8 smt+3 spd-8 mov-4|#9C6B4E #EAD7C3|#6E5A4B #F2EEE6',
    'moose|Moose|L|LB,DL|pow+6 tkl+5 spd-2 hnd-3|#5B3A24 #D9C3A0|#3E2F25 #A68A64',
    'bull|Bull|L|DL,LB|pow+7 tkl+4 smt-4|#6B3A2A #F2E6D8|#2B2B2B #E0E0E0',
    'panda|Panda|L|OL,DL|pow+8 tkl+2 smt+2 spd-6|#F4F4F4 #222222|#C0583C #2C1B14',
    'lion|Lion|L|LB,DL|tkl+8 pow+6 spd+2 cov-4|#D9A441 #8C4A1E|#F1E3C5 #C9A25E',
    'croc|Crocodile|L|DL,LB|tkl+8 pow+6 spd-4 hnd-4|#4F7942 #C9D88B|#7E8C54 #E8E2B8',
    'giraffe|Giraffe|L|TE,WR|hnd+8 spd+2 mov-6 pow-4|#E8B04A #8A5A2B|#F2D7A1 #B5651D',
    'ostrich|Ostrich|L|WR,K|spd+10 kck+6 hnd-4 smt-6|#2E2E2E #F2D5D5|#8A7F72 #F5E8E0',
    'penguin|Penguin|M|QB|aim+6 smt+4 spd-6 mov+2|#1F2A36 #F7F7F2|#3B4A5A #FFE8A3',
    'owl|Owl|M|QB,S|smt+10 aim+4 cov+3 pow-6|#8B6B4A #E9D8B4|#F5F5F5 #B8B8B8',
    'fox|Fox|M|RB,CB|mov+8 smt+4 spd+4 pow-6|#E07A2F #FFFFFF|#E8ECEF #9FB3C8',
    'wolf|Wolf|M|LB,S|spd+4 tkl+5 smt+3 hnd-2|#7D8590 #DADFE4|#3A3A3A #A0A0A0',
    'cheetah|Cheetah|M|WR,CB|spd+12 mov+4 pow-8 tkl-4|#E9B949 #3A2A1A|#F3E2B3 #5A4632',
    'kangaroo|Kangaroo|M|K,RB|kck+12 spd+4 pow+2 hnd-2|#B5783F #E8C9A0|#8E8E8E #D6D2CC',
    'turtle|Turtle|M|OL,LB|pow+6 tkl+4 spd-12|#5E9E4B #C9A86B|#3F7F7F #8FB8A0',
    'dog|Dog|M|any|smt+4 hnd+4|#C88A4A #F5E6D0|#FFFFFF #333333',
    'pig|Pig|M|OL,TE,LB|pow+6 tkl+2 smt+2 spd-4|#F4A9B8 #FAD4DC|#6B4A3A #C9A890',
    'goat|Goat|M|LB,K|pow+4 tkl+4 mov+2 kck+4|#EDEDE8 #A89F91|#6E5A46 #D8CBB8',
    'eagle|Eagle|M|QB,S|aim+6 arm+6 smt+2 pow-6|#5A3E2B #FFFFFF|#8A6B3E #E6C88A',
    'beaver|Beaver|M|OL,TE|pow+4 smt+4 tkl+2 spd-4|#7B4B2A #D9A066|#5C3B23 #E8D2B0',
    'raccoon|Raccoon|M|CB,S|cov+8 hnd+6 smt+2 pow-6|#8D8F96 #2C2C2C|#A88F7A #3A2E26',
    'monkey|Monkey|M|WR,RB|hnd+8 mov+4 smt-2 pow-4|#8A5A3B #F0C9A0|#C9B79C #F6E9D8',
    'rabbit|Rabbit|S|RB,WR|spd+8 mov+8 pow-10 tkl-6|#FFFFFF #F7B6C8|#B58B63 #EFDCC5',
    'frog|Frog|S|WR|hnd+6 spd+2 pow-8|#6CC24A #F0F5A0|#3FA7D6 #F7D046',
    'chicken|Chicken|S|WR,RB|spd+4 mov+6 hnd+2 smt-6|#FFFFFF #E63B2E|#D9A066 #E63B2E',
    'duck|Duck|S|WR,QB|hnd+4 aim+3 spd-2|#FFD84D #F28C28|#FFFFFF #F28C28',
    'cat|Cat|S|CB,RB|mov+10 cov+4 pow-6|#F2A65A #FFFFFF|#404040 #F2F2F2',
    'hamster|Hamster|S|RB,KR|spd+4 mov+8 pow-12|#E9C08A #FFFFFF|#C7C7C7 #FFFFFF',
    'crab|Crab|S|CB,LB|cov+6 tkl+4 pow+2 spd-4|#E8513A #F7B79E|#4A90C2 #CBE4F2',
    'squirrel|Squirrel|S|CB,WR|mov+8 spd+4 smt+2 pow-8|#B5652B #F2D3B0|#6D6D6D #D9D9D9'
  ];

  // Body quirks (design 3.3 "Body quirk" column), exact values
  const QUIRKS = {
    elephant: { id: 'big_ears', name: 'Big Ears', desc: 'Run-block shed time vs him +0.2 s.', eng: { blockShedAdd: 0.2 }, sim: { ypc: 0.05 } },
    rhino: { id: 'horn_rush', name: 'Horn Rush', desc: 'Pass-rush win time −0.15 s.', eng: { rushWinAdd: -0.15 }, sim: { sack: 1.06 } },
    hippo: { id: 'heavy', name: 'Heavy', desc: 'Cannot be pushed back more than 1 yd on run blocks.', eng: { maxPushback: 1 }, sim: { ypcVs: -0.05 } },
    bear: null,
    gorilla: null,
    walrus: { id: 'blubber', name: 'Blubber', desc: 'No Snow penalty.', eng: { immune: ['snow'] }, sim: {} },
    moose: null,
    bull: { id: 'charge', name: 'Charge', desc: 'Closing speed +5% when chasing a ball carrier.', eng: { chaseSpeedMult: 1.05 }, sim: {} },
    panda: { id: 'chill', name: 'Chill', desc: 'Mood changes ×0.75.', eng: {}, sim: {}, fr: { moodMult: 0.75 } },
    lion: { id: 'roar', name: 'Roar', desc: '+1 Team Spirit per sack he makes (max +3 per game).', eng: {}, sim: {}, fr: { spiritPerSack: 1, spiritMax: 3 } },
    croc: { id: 'chomp', name: 'Chomp', desc: 'Forced-fumble chance on his tackles ×1.25.', eng: { ffMult: 1.25 }, sim: { ff: 1.25 } },
    giraffe: { id: 'long_neck', name: 'Long Neck', desc: 'Catch reach +0.6 yd, catch height +0.8 yd.', eng: { reachAdd: 0.6, heightAdd: 0.8 }, sim: { catchW: 1.05 } },
    ostrich: { id: 'long_legs', name: 'Long Legs', desc: 'Fumble chance ×1.2.', eng: { fumbleMult: 1.2 }, sim: { fum: 1.2 } },
    penguin: { id: 'ice_feet', name: 'Ice Feet', desc: 'No Snow penalty.', eng: { immune: ['snow'] }, sim: {} },
    owl: { id: 'night_eyes', name: 'Night Eyes', desc: 'No Fog penalty; reads 0.1 s faster (AI).', eng: { immune: ['fog'], readAdd: -0.1 }, sim: {} },
    fox: null,
    wolf: { id: 'pack', name: 'Pack', desc: '+3 Tackle when another defender is within 3 yd.', eng: { tklNearAdd: 3 }, sim: {} },
    cheetah: { id: 'burst', name: 'Burst', desc: 'Sprint speed +5%, sprint drain ×1.2.', eng: { sprintMult: 1.05, sprintDrainMult: 1.2 }, sim: { big: 1.05 } },
    kangaroo: { id: 'big_hop', name: 'Big Hop', desc: 'Dive length +1 yd.', eng: { diveAdd: 1 }, sim: {} },
    turtle: { id: 'shell', name: 'Shell', desc: 'Injury chance ×0.75.', eng: { injMult: 0.75 }, sim: { inj: 0.75 }, fr: { injMult: 0.75 } },
    dog: { id: 'good_pup', name: 'Good Pup', desc: 'Mood never below 25.', eng: {}, sim: {}, fr: { moodFloor: 25 } },
    pig: { id: 'mud_lover', name: 'Mud Lover', desc: 'No Rain penalty.', eng: { immune: ['rain'] }, sim: {} },
    goat: { id: 'sure_foot', name: 'Sure Foot', desc: 'No Snow penalty on Moves.', eng: { immune: ['snowMov'] }, sim: {} },
    eagle: { id: 'sky_view', name: 'Sky View', desc: 'QB sees every catcher\'s openness ring (AI: +5 Smarts on deep reads).', eng: { deepReadSmt: 5, openRings: true }, sim: { comp: 0.005 } },
    beaver: { id: 'builder', name: 'Builder', desc: 'Pass-block hold time +0.2 s.', eng: { passBlockAdd: 0.2 }, sim: { sackVs: 0.97 } },
    raccoon: { id: 'sticky_paws', name: 'Sticky Paws', desc: 'Interception chance ×1.15.', eng: { intMult: 1.15 }, sim: { int: 1.15 } },
    monkey: { id: 'grabby', name: 'Grabby', desc: 'Drop chance ×0.85.', eng: { dropMult: 0.85 }, sim: { catchW: 1.03 } },
    rabbit: { id: 'hop', name: 'Hop', desc: 'Juke success +5%.', eng: { jukeAdd: 0.05 }, sim: { ypc: 0.05 } },
    frog: { id: 'sticky_tongue', name: 'Sticky Tongue', desc: 'Catch reach +0.4 yd, catch height +0.5 yd.', eng: { reachAdd: 0.4, heightAdd: 0.5 }, sim: { catchW: 1.03 } },
    chicken: { id: 'road_crosser', name: 'Road Crosser', desc: 'Juke success +5%; never gets −Mood from losses.', eng: { jukeAdd: 0.05 }, sim: { ypc: 0.05 }, fr: { noLossMood: true } },
    duck: { id: 'waterproof', name: 'Waterproof', desc: 'No Rain penalty.', eng: { immune: ['rain'] }, sim: {} },
    cat: { id: 'nine_lives', name: 'Nine Lives', desc: '50% chance to ignore one injury per season.', eng: {}, sim: {}, fr: { injIgnore: 0.5 } },
    hamster: { id: 'tiny', name: 'Tiny', desc: 'Hitbox −0.1 yd.', eng: { hitboxAdd: -0.1 }, sim: {} },
    crab: { id: 'sidestep', name: 'Sidestep', desc: 'Buddy-coverage trail distance −0.2 yd.', eng: { trailAdd: -0.2 }, sim: { compVs: -0.003 } },
    squirrel: { id: 'nutty', name: 'Nutty', desc: '+2 Hype each time he scores.', eng: {}, sim: {}, fr: { hypePerScore: 2 } }
  };

  Species.list = RAW.map((line) => {
    const f = line.split('|');
    const bias = {};
    f[4].split(' ').forEach((b) => { const m = /^([a-z]+)([+-]\d+)$/.exec(b); bias[m[1]] = +m[2]; });
    const best = f[3] === 'any' ? ALL_POS.slice() : f[3].split(',').filter((p) => p !== 'KR');
    const q = QUIRKS[f[0]];
    const cA = f[5].split(' '), cB = f[6].split(' ');
    return {
      id: f[0], name: f[1], size: f[2], best: best, kr: f[3].indexOf('KR') >= 0, bias: bias,
      quirk: q ? { id: q.id, name: q.name, desc: q.desc, eng: q.eng || {}, sim: q.sim || {}, fr: q.fr || {} } : null,
      colors: [{ main: hx(cA[0]), acc: hx(cA[1]) }, { main: hx(cB[0]), acc: hx(cB[1]) }]
    };
  });

  const IDX = {};
  Species.list.forEach((s) => { IDX[s.id] = s; });

  /** @returns {Object} species def (falls back to dog for unknown ids) */
  Species.byId = (id) => IDX[id] || IDX.dog;
  Species.ids = Species.list.map((s) => s.id);
  /** size class data from PT.C.SIZES ('S'|'M'|'L') */
  Species.size = (id) => Species.byId(id).size;
  /** species whose Best spots include pos (design 3.4; 'any' counts for every position) */
  Species.fitting = (pos) => Species.list.filter((s) => s.best.indexOf(pos) >= 0);
  /** design 3.4: 65% from fitting species, 35% from all */
  Species.PICK_FIT = 0.65;
  /** true if this species ignores a weather penalty ('rain'|'snow'|'fog'|'snowMov') */
  Species.immune = (id, wx) => {
    const q = Species.byId(id).quirk;
    const im = q && q.eng.immune;
    if (!im) return false;
    return im.indexOf(wx) >= 0 || (wx === 'snowMov' && im.indexOf('snow') >= 0);
  };
})(globalThis.PT = globalThis.PT || {});
