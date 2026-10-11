/* Pixel Touchdown: js/core/constants.js
 * Owner: WP0. Responsibility: PT.C shared constants (field dims, positions, phases, stat keys, cap defaults).
 * Values follow docs/RECONCILE.md (binding) and docs/GAME_DESIGN.md. Edit values here, not in schemas.
 */
(function (PT) {
  'use strict';

  const C = PT.C = PT.C || {};

  C.SCHEMA_VERSION = 1;
  C.DT = 1 / 60;

  // Field space (R3): x 0..53.333 lateral, y 0..120 (endzones 0..10, 110..120). Ball re-spots to x = MID_X.
  C.FIELD = { W: 53.333, L: 120, GOAL_LO: 10, GOAL_HI: 110, MID_X: 26.667 };

  // Positions & lineup slots (design 2.1, R5)
  C.POS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K'];
  C.OFF_SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2'];
  C.DEF_SLOTS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
  /** all lineup slots: 15 starters + KR. team.dc[slot] = [starter, sub1, sub2] (KR: [pid]) */
  C.SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'TE', 'OL1', 'OL2', 'DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S', 'K', 'KR'];
  /** slot → natural position (KR: any) */
  C.SLOT_POS = { QB: 'QB', RB: 'RB', WR1: 'WR', WR2: 'WR', TE: 'TE', OL1: 'OL', OL2: 'OL', DL1: 'DL', DL2: 'DL',
    LB1: 'LB', LB2: 'LB', CB1: 'CB', CB2: 'CB', S: 'S', K: 'K', KR: null };
  C.SUBS_PER_SLOT = 2;
  C.OUT_OF_POS_PENALTY = 3;          // −3 every skill until NEW_POS_STARTS starts there (R5)
  C.NEW_POS_STARTS = 4;
  C.OFF_POS = ['QB', 'RB', 'WR', 'TE', 'OL'];
  C.DEF_POS = ['DL', 'LB', 'CB', 'S'];

  // Skills (R1, design 4.1)
  C.RATINGS = ['spd', 'pow', 'mov', 'hnd', 'arm', 'aim', 'tkl', 'cov', 'smt', 'kck'];
  C.RATING_NAMES = { spd: 'Speed', pow: 'Power', mov: 'Moves', hnd: 'Hands', arm: 'Arm', aim: 'Aim',
    tkl: 'Tackle', cov: 'Cover', smt: 'Smarts', kck: 'Kick' };
  C.RATING_SHORT = { spd: 'SPD', pow: 'POW', mov: 'MOV', hnd: 'HND', arm: 'ARM', aim: 'AIM', tkl: 'TKL', cov: 'COV', smt: 'SMT', kck: 'KCK' };
  C.SKILL_MIN = 15; C.SKILL_MAX = 99;
  /** OVR weights per position (design 4.3) */
  C.OVR_W = {
    QB: { spd: 0.10, mov: 0.05, arm: 0.25, aim: 0.35, smt: 0.25 },
    RB: { spd: 0.30, pow: 0.20, mov: 0.25, hnd: 0.15, smt: 0.10 },
    WR: { spd: 0.35, pow: 0.05, mov: 0.15, hnd: 0.35, smt: 0.10 },
    TE: { spd: 0.20, pow: 0.30, mov: 0.10, hnd: 0.30, smt: 0.10 },
    OL: { spd: 0.10, pow: 0.55, mov: 0.05, smt: 0.30 },
    DL: { spd: 0.25, pow: 0.40, tkl: 0.25, smt: 0.10 },
    LB: { spd: 0.20, pow: 0.15, tkl: 0.35, cov: 0.15, smt: 0.15 },
    CB: { spd: 0.35, hnd: 0.10, tkl: 0.05, cov: 0.40, smt: 0.10 },
    S: { spd: 0.25, hnd: 0.05, tkl: 0.20, cov: 0.30, smt: 0.20 },
    K: { smt: 0.15, kck: 0.85 }
  };
  C.GROWTH_LETTERS = ['A+', 'A', 'B', 'C', 'D'];
  C.GROWTH_MULT = { 'A+': 1.6, A: 1.3, B: 1.0, C: 0.7, D: 0.4 };

  // Species (R2): ids are lowercase English names; mixed rosters everywhere.
  C.SPECIES = ['elephant', 'rhino', 'hippo', 'bear', 'gorilla', 'walrus', 'moose', 'bull', 'panda', 'lion', 'croc',
    'giraffe', 'ostrich', 'penguin', 'owl', 'fox', 'wolf', 'cheetah', 'kangaroo', 'turtle', 'dog', 'pig', 'goat',
    'eagle', 'beaver', 'raccoon', 'monkey', 'rabbit', 'frog', 'chicken', 'duck', 'cat', 'hamster', 'crab', 'squirrel'];
  C.SIZES = { S: { scale: 0.80, r: 0.40, mass: 1, reach: 1.0, jump: 2.6, dive: 1.5 },
    M: { scale: 1.00, r: 0.50, mass: 2, reach: 1.1, jump: 2.9, dive: 2.0 },
    L: { scale: 1.25, r: 0.65, mass: 3, reach: 1.2, jump: 3.2, dive: 2.5 } };

  // Traits (design 5.2): canonical ids = snake_case of the design name. Data lives in PT.Data.Traits (WP1).
  C.TRAITS = ['rocket_arm', 'dime_dropper', 'quick_release', 'scrambler', 'ice_cold', 'big_game', 'glue_paws',
    'truck_stick', 'ankle_breaker', 'spin_doctor', 'speed_demon', 'route_artist', 'ball_hawk', 'lockdown',
    'sack_master', 'sure_tackler', 'brick_wall', 'road_grader', 'ice_toes', 'boomer', 'hype_pup', 'leader',
    'gym_rat', 'late_bloomer', 'iron_hide', 'hometown_hero',
    'glass_bones', 'fumbley', 'stone_hands', 'shaky_paws', 'flag_magnet', 'grumpy_gus', 'early_peak', 'wild_leg'];
  C.MAX_TRAITS = 3;                   // 2 normally, 3 if one came from a milestone

  C.WANTS = ['money', 'fame', 'wins', 'home', 'chill'];   // personality (design 13.2)

  C.TID = { FA: -1, PROSPECT: -2, RETIRED: -3 };

  C.PHASE = {
    PRESEASON: 'PRESEASON', REGULAR: 'REGULAR', PLAYOFFS: 'PLAYOFFS', SEASON_END: 'SEASON_END',
    RESIGN: 'RESIGN', DRAFT: 'DRAFT', FREE_AGENCY: 'FREE_AGENCY'
  };
  C.PHASE_ORDER = ['PRESEASON', 'REGULAR', 'PLAYOFFS', 'SEASON_END', 'RESIGN', 'DRAFT', 'FREE_AGENCY'];
  /** L.sub meaning inside phases (R6) */
  C.SUB = {
    PRESEASON: ['TWIST', 'BOSS_GOAL', 'CAMP'],                 // 0 Twist reveal, 1 Boss Goal, 2 Training Camp
    SEASON_END: ['AWARDS', 'GROWTH', 'GOODBYES']               // 0 Awards Night, 1 Growth Day, 2 Goodbyes
  };

  C.STATS = {
    gp: 1, gs: 1,
    pa: 1, pc: 1, py: 1, ptd: 1, pi: 1, psk: 1,
    ra: 1, ry: 1, rtd: 1, rlg: 1,
    tg: 1, rc: 1, rcy: 1, rctd: 1, rclg: 1,
    fum: 1, fl: 1,
    tk: 1, dsk: 1, int: 1, pd: 1, ff: 1, fr: 1, dtd: 1,
    fga: 1, fgm: 1, fglg: 1, xpa: 1, xpm: 1, pn: 1, pny: 1,
    kr: 1, kry: 1, krtd: 1
  };
  C.STAT_KEYS = Object.keys(C.STATS);
  C.STAT_MAX = { rlg: 1, rclg: 1, fglg: 1 };      // "longest" stats keep the max
  C.TEAM_STATS = ['fd', 'ty', 'py', 'ry', 'to', 'top', 'd3a', 'd3c', 'pen', 'peny'];

  C.NUM_TEAMS = 32;
  C.CONFS = 2;
  C.DIVS_PER_CONF = 4;
  C.TEAMS_PER_DIV = 4;

  // Roster (design 2.2, R6)
  C.ROSTER = {
    MAX_SEASON: 22, MAX_OFF: 30, MIN_PLAY: 16,
    NEED: { QB: 2, RB: 1, WR: 2, TE: 1, OL: 2, DL: 2, LB: 2, CB: 2, S: 1, K: 1 },        // healthy minimums, sum 16
    TEMPLATE: { QB: 2, RB: 2, WR: 3, TE: 2, OL: 3, DL: 3, LB: 2, CB: 3, S: 1, K: 1 },    // AI 22-man template
    IR_MIN_WEEKS: 4                                                                    // Hurt List needs ≥ 4 weeks out
  };

  // Calendar (R6)
  C.REG_WEEKS = 18;                  // 17 games + 1 Rest Week per team
  C.GAMES_PER_TEAM = 17;
  C.BYE_WEEKS = [6, 13];             // Rest Week range (inclusive)
  C.PLAYOFF_PER_CONF = 7;
  C.PLAYOFF_ROUNDS = 4;              // Wild Card, Divisional, Conference, Pixel Bowl (neutral)
  C.PLAYOFF_NAMES = ['', 'Wild Card', 'Divisional', 'Conference Final', 'Pixel Bowl'];
  C.DRAFT_ROUNDS = 4;
  C.FA_DAYS = 3;
  C.FA_POOL_MAX = 150;
  C.QUARTER_SEC = 180;
  C.QLEN_OPTIONS = [120, 180, 300];
  C.START_SEASON = 2026;

  // Team Cash = salary cap, in $K (design 10.4, R7)
  C.CAP = { BASE: 100000, GROWTH: 0.03, GROWTH_RAND: 0.02, MIN_PCT: 0.005, MAX_PCT: 0.25,
    MIN_SAL: 500, MAX_SAL: 25000, MAX_YRS: 5, CUT_PCT: 0.5 };
  C.POS_PAY_MULT = { QB: 1.6, WR: 1.1, DL: 1.1, CB: 1.05, OL: 1.0, LB: 0.95, S: 0.95, RB: 0.9, TE: 0.9, K: 0.4 };

  // Coins & facilities & staff (design 10.11, R7)
  C.FACILITIES = ['trn', 'med', 'sct', 'std', 'shop'];
  C.FACILITY_NAMES = { trn: 'Training Field', med: 'Medical Center', sct: 'Scout Office', std: 'Stadium', shop: 'Fan Shop' };
  C.FACILITY_COST = { trn: [0, 400, 800, 1400, 2200], med: [0, 400, 800, 1400, 2200], sct: [0, 300, 600, 1000, 1600],
    std: [0, 600, 1200, 2000, 3000], shop: [0, 300, 600, 1000, 1500] };          // cost to reach level i+1 (index = level−1)
  C.STAFF = ['off', 'def', 'grw'];
  C.STAFF_NAMES = { off: 'Offense Coach', def: 'Defense Coach', grw: 'Growth Coach' };
  C.STAFF_COST = [0, 0, 150, 350, 650, 1000];                                    // by stars 1..5

  // Difficulty (R13, design 16)
  C.DIFFS = ['Beginner', 'Normal', 'Expert', 'Legend'];   // ROUND6 B: index 0..3 (old saves: 2 -> 3)
  C.STAR_MAX = 8; C.STAR_MIN_SIDE = 2;                       // ROUND6 A
  C.START_COINS = [1000, 600, 400, 300];
  C.BOSS_START = 60;

  // Team identity (design 15)
  C.OFF_STYLES = { air: 'Air Raid', ground: 'Ground & Pound', west: 'West Coast', trick: 'Trick Bag', speed: 'Speed Spread' };
  C.DEF_STYLES = { wild: 'Wild Pack', wall: 'Brick Wall', think: 'Thinking Cap', nofly: 'No Fly Zone' };
  C.CLIMATES = ['warm', 'mild', 'cold', 'rainy', 'dome'];

  // Weather (design 14.1); 'clear' = dome
  C.WEATHER = ['sunny', 'cloudy', 'rain', 'wind', 'fog', 'snow', 'clear'];

  C.SETTINGS_DEFAULT = { qLen: 180, autoLineup: false, penalties: true, easyThrow: false, aimMode: 'sling', autoDef: false, lefty: false };

  C.SAVE = { SLOTS: 3, PREFIX: 'pt.', MAX_CHARS: 1000000 };
})(globalThis.PT = globalThis.PT || {});
