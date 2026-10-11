/* Pixel Touchdown: js/data/defense.js
 * Owner: WP3. Responsibility: PT.Data.Defense: defensive calls (shell, assignments, blitzers).
 * Design 7.1–7.6. Coordinates are in the OFFENSE frame (x + = offense's right, y + = downfield = toward the defense's goal).
 * Call shape: { id, name, form:'base'|'big'|'spread'|'pressure', grp:'buddy'|'area'|'run'|'rush', desc, rushers, lv (coach level),
 *   tags:['cover'|'man'|'zone'|'spy'|'run'|'heavy'|'goal'|'blitz'|'prevent'] (engine situation logic),
 *   as: { SLOT: { k:'rush'|'man'|'zone'|'fill'|'spy'|'free'|'fillrush', on:'WR1'…, area:'DLT'…, then:'ROB', press, tight, at:[x,y],
 *                 aimX, wide, contain } } }
 */
(function (PT) {
  'use strict';
  const D = PT.ns('Data.Defense');

  /** Base alignment (design 7.1). CBs are placed over their WR (y = 6 off, 1 press). */
  D.BASE = { DL1: [-1.5, 1], DL2: [1.5, 1], LB1: [-3, 5], LB2: [3, 5], CB1: [0, 6], CB2: [0, 6], S: [0, 13] };

  /** Areas: [cx, cy, r] (design 7.1) */
  D.AREAS = {
    DLT: [-17, 25, 9], DMT: [0, 25, 9], DRT: [17, 25, 9], DLH: [-13, 22, 12], DRH: [13, 22, 12],
    CFL: [-11, 6, 7], CFR: [11, 6, 7], HKL: [-6, 8, 5], HKR: [6, 8, 5], SM: [0, 5, 5], ROB: [0, 11, 6],
    MDL: [-9, 12, 7], MDR: [9, 12, 7], DOL: [-19, 28, 8], DOR: [19, 28, 8], LID: [0, 30, 10],
    QL1: [-18, 20, 8], QL2: [-6, 22, 8], QR2: [6, 22, 8], QR1: [18, 20, 8]   // quarters (four deep)
  };
  D.DEEP_AREAS = { DLT: 1, DMT: 1, DRT: 1, DLH: 1, DRH: 1, DOL: 1, DOR: 1, LID: 1, QL1: 1, QL2: 1, QR2: 1, QR1: 1 };

  const R = { k: 'rush' };
  D.list = [
    { id: 'lockdown', name: 'Lockdown', form: 'base', grp: 'buddy', desc: 'Stick to your buddy!', rushers: 2, lv: 1, tags: ['cover', 'man'],
      as: { DL1: R, DL2: R, LB1: { k: 'man', on: 'RB' }, LB2: { k: 'man', on: 'TE' }, CB1: { k: 'man', on: 'WR1', press: 1 },
        CB2: { k: 'man', on: 'WR2', press: 1 }, S: { k: 'free', at: [0, 18] } } },
    { id: 'umbrella', name: 'Umbrella', form: 'base', grp: 'area', desc: 'Guard deep areas.', rushers: 2, lv: 1, tags: ['cover', 'zone'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'CFL' }, LB2: { k: 'zone', area: 'CFR' }, CB1: { k: 'zone', area: 'DLT' },
        CB2: { k: 'zone', area: 'DRT' }, S: { k: 'zone', area: 'DMT' } } },
    { id: 'peekaboo', name: 'Peekaboo', form: 'base', grp: 'buddy', desc: 'Watch the QB!', rushers: 2, lv: 1, tags: ['cover', 'man', 'spy'],
      as: { DL1: R, DL2: R, LB1: { k: 'spy' }, LB2: { k: 'man', on: 'TE' }, CB1: { k: 'man', on: 'WR1' }, CB2: { k: 'man', on: 'WR2' },
        S: { k: 'man', on: 'RB', at: [0, 9] } } },
    { id: 'wall', name: 'Wall', form: 'big', grp: 'run', desc: 'Stop the run up the middle.', rushers: 2, lv: 1, tags: ['run', 'heavy'],
      as: { DL1: { k: 'rush', aimX: -0.7 }, DL2: { k: 'rush', aimX: 0.7 }, LB1: { k: 'fill', area: 'HKL', at: [-2, 3] },
        LB2: { k: 'fill', area: 'HKR', at: [2, 3] }, CB1: { k: 'man', on: 'WR1', press: 1 }, CB2: { k: 'man', on: 'WR2', press: 1 },
        S: { k: 'fill', area: 'ROB', at: [0, 6] } } },
    { id: 'pinch', name: 'Pinch', form: 'big', grp: 'run', desc: 'Stop runs to the outside.', rushers: 2, lv: 1, tags: ['run'],
      as: { DL1: { k: 'rush', at: [-4, 1], contain: 1 }, DL2: { k: 'rush', at: [4, 1], contain: 1 },
        LB1: { k: 'fill', area: 'HKL', edge: [-8, 2] }, LB2: { k: 'fill', area: 'HKR', edge: [8, 2] },
        CB1: { k: 'man', on: 'WR1', press: 1 }, CB2: { k: 'man', on: 'WR2', press: 1 }, S: { k: 'free', at: [0, 16] } } },
    { id: 'brick_house', name: 'Brick House', form: 'big', grp: 'run', desc: 'Goal line! Nobody gets in!', rushers: 3, lv: 1, tags: ['goal', 'heavy'],
      as: { DL1: { k: 'rush', at: [-1, 1] }, DL2: { k: 'rush', at: [1, 1] }, LB1: { k: 'man', on: 'RB', at: [-2, 3] },
        LB2: { k: 'fillrush', at: [2, 3] }, CB1: { k: 'man', on: 'WR1', tight: 1 }, CB2: { k: 'man', on: 'WR2', tight: 1 },
        S: { k: 'man', on: 'TE', at: [0, 5] } } },
    { id: 'two_clouds', name: 'Two Clouds', form: 'spread', grp: 'area', desc: 'Two deep, nothing over the top.', rushers: 2, lv: 1, tags: ['cover', 'zone'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'CFL' }, LB2: { k: 'zone', area: 'CFR' }, CB1: { k: 'zone', area: 'DLH' },
        CB2: { k: 'zone', area: 'DRH' }, S: { k: 'zone', area: 'SM', then: 'ROB' } } },
    { id: 'soft_pillow', name: 'Soft Pillow', form: 'spread', grp: 'area', desc: 'Stop the long bomb.', rushers: 2, lv: 1, tags: ['cover', 'zone', 'prevent'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'MDL' }, LB2: { k: 'zone', area: 'MDR' }, CB1: { k: 'zone', area: 'DOL' },
        CB2: { k: 'zone', area: 'DOR' }, S: { k: 'zone', area: 'LID' } } },
    { id: 'sneaky_owl', name: 'Sneaky Owl', form: 'spread', grp: 'buddy', desc: 'Jump the short routes.', rushers: 2, lv: 1, tags: ['cover', 'man'],
      as: { DL1: R, DL2: R, LB1: { k: 'man', on: 'RB' }, LB2: { k: 'man', on: 'TE' }, CB1: { k: 'man', on: 'WR1', off: 4 },
        CB2: { k: 'man', on: 'WR2', off: 4 }, S: { k: 'zone', area: 'ROB' } } },
    { id: 'zoo_rush', name: 'Zoo Rush', form: 'pressure', grp: 'rush', desc: 'Send 4 at the QB!', rushers: 4, lv: 1, tags: ['blitz'],
      as: { DL1: R, DL2: R, LB1: R, LB2: R, CB1: { k: 'man', on: 'WR1' }, CB2: { k: 'man', on: 'WR2' }, S: { k: 'man', on: 'TE' } } },
    { id: 'stampede', name: 'Stampede', form: 'pressure', grp: 'rush', desc: 'Everybody go!', rushers: 5, lv: 1, tags: ['blitz'],
      as: { DL1: R, DL2: R, LB1: R, LB2: R, CB1: { k: 'man', on: 'WR1', press: 1 }, CB2: { k: 'man', on: 'WR2', press: 1 },
        S: { k: 'rush', at: [0, 7] } } },
    { id: 'switcheroo', name: 'Switcheroo', form: 'pressure', grp: 'rush', desc: 'Surprise rush, sneaky drop.', rushers: 3, lv: 1, tags: ['blitz', 'zone'],
      as: { DL1: R, DL2: { k: 'zone', area: 'SM' }, LB1: R, LB2: R, CB1: { k: 'zone', area: 'DLH' }, CB2: { k: 'zone', area: 'DRH' },
        S: { k: 'zone', area: 'ROB' } } },
    // ---------------- playtest expansion ----------------
    { id: 'robber', name: 'Robber', form: 'base', grp: 'buddy', desc: 'Man on everybody, a free safety deep, a lineman drops to rob the middle.', rushers: 1, lv: 2, tags: ['cover', 'man'],
      as: { DL1: R, DL2: { k: 'zone', area: 'ROB', at: [1, 3] }, LB1: { k: 'man', on: 'RB' }, LB2: { k: 'man', on: 'TE' }, CB1: { k: 'man', on: 'WR1' },
        CB2: { k: 'man', on: 'WR2' }, S: { k: 'free', at: [0, 17] } } },
    { id: 'sky3', name: 'Sky Three', form: 'base', grp: 'area', desc: 'Three deep; the outside backer sinks to the flat.', rushers: 2, lv: 2, tags: ['cover', 'zone'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'SM' }, LB2: { k: 'zone', area: 'CFR', at: [5, 6] }, CB1: { k: 'zone', area: 'DLT' },
        CB2: { k: 'zone', area: 'DRT' }, S: { k: 'zone', area: 'DMT' } } },
    { id: 'quarters', name: 'Quarters', form: 'spread', grp: 'area', desc: 'Four deep. Nothing gets over the top.', rushers: 2, lv: 3, tags: ['cover', 'zone'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'SM' }, LB2: { k: 'zone', area: 'QR2', at: [4, 7] }, CB1: { k: 'zone', area: 'QL1' },
        CB2: { k: 'zone', area: 'QR1' }, S: { k: 'zone', area: 'QL2', at: [-3, 12] } } },
    { id: 'tampa2', name: 'Tampa Two', form: 'spread', grp: 'area', desc: 'Two deep halves; the middle backer runs the seam.', rushers: 2, lv: 4, tags: ['cover', 'zone'],
      as: { DL1: R, DL2: R, LB1: { k: 'zone', area: 'DMT', at: [0, 5] }, LB2: { k: 'zone', area: 'DRH', at: [4, 8] }, CB1: { k: 'zone', area: 'CFL' },
        CB2: { k: 'zone', area: 'CFR' }, S: { k: 'zone', area: 'DLH' } } },
    { id: 'fire_zone', name: 'Fire Zone', form: 'pressure', grp: 'rush', desc: 'Bring three, drop a lineman, three deep.', rushers: 3, lv: 3, tags: ['blitz', 'zone'],
      as: { DL1: R, LB1: R, LB2: R, DL2: { k: 'zone', area: 'HKR', at: [2, 2] }, CB1: { k: 'zone', area: 'DLT' },
        CB2: { k: 'zone', area: 'DRT' }, S: { k: 'zone', area: 'DMT' } } },
    { id: 'zero_blitz', name: 'Zero Blitz', form: 'pressure', grp: 'rush', desc: 'Man on everybody, three come, no deep help!', rushers: 3, lv: 6, tags: ['blitz', 'man'],
      as: { DL1: R, DL2: R, LB1: R, LB2: { k: 'man', on: 'RB' }, CB1: { k: 'man', on: 'WR1', press: 1 },
        CB2: { k: 'man', on: 'WR2', press: 1 }, S: { k: 'man', on: 'TE', tight: 1, at: [0, 7] } } },
    { id: 'bear', name: 'Bear Front', form: 'big', grp: 'run', desc: 'Three big bodies on the line. Run inside? No way.', rushers: 3, lv: 5, tags: ['run', 'heavy'],
      as: { DL1: { k: 'rush', at: [-2.5, 1] }, DL2: { k: 'rush', at: [2.5, 1] }, LB1: { k: 'rush', at: [0, 3.5], aimX: 0 },
        LB2: { k: 'fill', area: 'HKR', at: [3, 4] }, CB1: { k: 'man', on: 'WR1', press: 1 }, CB2: { k: 'man', on: 'WR2', press: 1 },
        S: { k: 'fill', area: 'ROB', at: [0, 7] } } },
    { id: 'dime', name: 'Dime', form: 'spread', grp: 'buddy', desc: 'Extra cover guys for passing downs.', rushers: 2, lv: 4, tags: ['cover', 'man'],
      as: { DL1: R, DL2: R, LB1: { k: 'man', on: 'RB' }, LB2: { k: 'man', on: 'TE' }, CB1: { k: 'man', on: 'WR1', off: 4 },
        CB2: { k: 'man', on: 'WR2', off: 4 }, S: { k: 'zone', area: 'DMT' } } },
    { id: 'prevent', name: 'Prevent', form: 'spread', grp: 'area', desc: 'Late lead: give up short, never the big one.', rushers: 1, lv: 1, tags: ['prevent', 'zone'],
      as: { DL1: R, DL2: { k: 'zone', area: 'SM', at: [1, 3] }, LB1: { k: 'zone', area: 'MDL' }, LB2: { k: 'zone', area: 'MDR' },
        CB1: { k: 'zone', area: 'DOL' }, CB2: { k: 'zone', area: 'DOR' }, S: { k: 'zone', area: 'LID' } } }
  ];
  D.FORMS = { base: 'Base', big: 'Big', spread: 'Spread', pressure: 'Pressure' };
  D.GROUP_HINT = { buddy: 'vs Buddy', area: 'vs Area', run: 'vs Wall', rush: 'vs Rush' };

  /** Counter matrix (design 7.3): + = defense advantage */
  D.MATRIX = {
    lockdown: { SHORT: 1, DEEP: 1, IRUN: -1, ORUN: -1, SCREEN: 0, PA: 0, TRICK: -1 },
    umbrella: { SHORT: -1, DEEP: 2, IRUN: -1, ORUN: 0, SCREEN: 0, PA: 1, TRICK: 0 },
    peekaboo: { SHORT: 0, DEEP: -1, IRUN: 0, ORUN: 1, SCREEN: 1, PA: -1, TRICK: 1 },
    wall: { SHORT: 0, DEEP: -2, IRUN: 2, ORUN: 1, SCREEN: -1, PA: -2, TRICK: 0 },
    pinch: { SHORT: -1, DEEP: -1, IRUN: -1, ORUN: 2, SCREEN: 1, PA: -1, TRICK: 1 },
    brick_house: { SHORT: -2, DEEP: -2, IRUN: 2, ORUN: 1, SCREEN: -1, PA: -2, TRICK: -1 },
    two_clouds: { SHORT: 1, DEEP: 0, IRUN: 0, ORUN: -1, SCREEN: 1, PA: 0, TRICK: 0 },
    soft_pillow: { SHORT: -2, DEEP: 2, IRUN: -2, ORUN: -2, SCREEN: -1, PA: 2, TRICK: -1 },
    sneaky_owl: { SHORT: 2, DEEP: -2, IRUN: 0, ORUN: -1, SCREEN: 0, PA: -1, TRICK: 0 },
    zoo_rush: { SHORT: 0, DEEP: 1, IRUN: 1, ORUN: 0, SCREEN: -2, PA: 0, TRICK: 0 },
    stampede: { SHORT: -2, DEEP: 2, IRUN: 1, ORUN: 0, SCREEN: -2, PA: 1, TRICK: 1 },
    switcheroo: { SHORT: 0, DEEP: 0, IRUN: 0, ORUN: -1, SCREEN: 2, PA: 0, TRICK: 0 },
    robber: { SHORT: 1, DEEP: 0, IRUN: 0, ORUN: -1, SCREEN: -1, PA: 0, TRICK: 0 },
    sky3: { SHORT: -1, DEEP: 1, IRUN: 0, ORUN: 1, SCREEN: 0, PA: 0, TRICK: 0 },
    quarters: { SHORT: -1, DEEP: 2, IRUN: 0, ORUN: -1, SCREEN: -1, PA: 1, TRICK: -1 },
    tampa2: { SHORT: 1, DEEP: 1, IRUN: -1, ORUN: 0, SCREEN: 0, PA: -1, TRICK: 0 },
    fire_zone: { SHORT: -1, DEEP: 1, IRUN: 1, ORUN: 0, SCREEN: -1, PA: 0, TRICK: 1 },
    zero_blitz: { SHORT: -1, DEEP: 1, IRUN: 1, ORUN: 1, SCREEN: -2, PA: -1, TRICK: 0 },
    bear: { SHORT: 0, DEEP: -1, IRUN: 2, ORUN: 0, SCREEN: -1, PA: -2, TRICK: 0 },
    dime: { SHORT: 1, DEEP: 1, IRUN: -2, ORUN: -1, SCREEN: 0, PA: 0, TRICK: -1 },
    prevent: { SHORT: -2, DEEP: 2, IRUN: -2, ORUN: -1, SCREEN: -1, PA: 1, TRICK: -1 }
  };

  /** Team defensive styles (design 7.5) */
  D.STYLE_SIG = {
    wall: ['wall', 'pinch', 'brick_house', 'bear'],
    nofly: ['umbrella', 'two_clouds', 'soft_pillow', 'lockdown', 'quarters', 'tampa2'],
    wild: ['zoo_rush', 'stampede', 'switcheroo', 'fire_zone', 'zero_blitz'],
    think: ['peekaboo', 'sneaky_owl', 'umbrella', 'robber', 'sky3']
  };
  /** Style matchup [defStyle][offStyle] (+ = defense advantage) */
  D.STYLE_MATCH = {
    wall: { air: -1, ground: 1, west: 0, trick: 0.5, speed: -0.5 },
    nofly: { air: 1, ground: -1, west: 0.5, trick: -0.5, speed: 0 },
    wild: { air: 1, ground: 0, west: -1, trick: 0.5, speed: -0.5 },
    think: { air: -0.5, ground: -0.5, west: 0.5, trick: 0.5, speed: 0.5 }
  };
  /** AI base call weights by defensive style (design 7.6) */
  D.STYLE_W = {
    wall: { lockdown: 8, umbrella: 5, peekaboo: 4, wall: 16, pinch: 9, brick_house: 0, two_clouds: 5, soft_pillow: 0, sneaky_owl: 4, zoo_rush: 8, stampede: 4, switcheroo: 5, robber: 6, sky3: 5, quarters: 2, tampa2: 3, fire_zone: 4, zero_blitz: 2, bear: 9, dime: 1, prevent: 0 },
    nofly: { lockdown: 8, umbrella: 11, peekaboo: 4, wall: 4, pinch: 4, brick_house: 0, two_clouds: 11, soft_pillow: 3, sneaky_owl: 7, zoo_rush: 4, stampede: 1, switcheroo: 4, robber: 6, sky3: 8, quarters: 8, tampa2: 7, fire_zone: 2, zero_blitz: 0, bear: 2, dime: 6, prevent: 0 },
    wild: { lockdown: 7, umbrella: 4, peekaboo: 4, wall: 7, pinch: 5, brick_house: 0, two_clouds: 4, soft_pillow: 0, sneaky_owl: 4, zoo_rush: 12, stampede: 9, switcheroo: 9, robber: 5, sky3: 3, quarters: 2, tampa2: 2, fire_zone: 10, zero_blitz: 7, bear: 4, dime: 2, prevent: 0 },
    think: { lockdown: 7, umbrella: 6, peekaboo: 10, wall: 5, pinch: 7, brick_house: 0, two_clouds: 8, soft_pillow: 1, sneaky_owl: 8, zoo_rush: 4, stampede: 1, switcheroo: 7, robber: 8, sky3: 6, quarters: 5, tampa2: 6, fire_zone: 3, zero_blitz: 1, bear: 3, dime: 4, prevent: 0 }
  };

  const byId = {};
  D.list.forEach((c) => { byId[c.id] = c; });
  /** @param {Object} c @param {string} t @returns {boolean} */
  D.has = function (c, t) { return !!(c && c.tags && c.tags.indexOf(t) >= 0); };
  /** @param {string} id @returns {Object|null} */
  D.byId = function (id) { return byId[id] || null; };
})(globalThis.PT = globalThis.PT || {});
