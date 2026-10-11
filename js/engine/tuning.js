/* Pixel Touchdown: js/engine/tuning.js
 * Owner: WP3. Responsibility: PT.Engine.T: all engine tuning constants (speeds, radii, odds).
 * Values follow docs/GAME_DESIGN.md sections 3–8, 12, 14, 16 unless marked "tuned" (calibration, tests/sim/calibrate.js).
 */
(function (PT) {
  'use strict';
  const Math = globalThis.Math;   // local ref: fast in node:vm test contexts (global lookups go through interceptors)
  const T = PT.ns('Engine').T = {
    // ---------- flow timings (seconds of game-sim time) ----------
    LINEUP_T: 0.6,            // players jog to their spots after a call (design 9.3)
    DEAD_T: 0.65,             // whistle → next call (playtest: 0.85 → 0.65, snappier between plays)
    DEAD_TD_T: 2.2,           // celebration
    DEAD_TURN_T: 1.5,
    BREAK_Q_T: 1.2, BREAK_HALF_T: 2.5,
    PAT_AI_T: 0.6,
    KICKOFF_SETUP_T: 1.0,     // ball on the tee (onside button window for the user)
    PLAY_CLOCK: 25,           // unused since client pass 5 (the user always snaps); kept for compatibility
    IDLE_SNAP: 0.8,           // demo/idle mode (no user input yet this game): autopilot snaps after this
    HURRY_SNAP: 0.8,          // design 8.3
    AUTO_DEF_GO: 1.0,         // design 9.6
    AI_SNAP: 0.35,            // AI offense vs AI defense presnap
    FAST: { LINEUP_T: 0.15, DEAD_T: 0.2, DEAD_TD_T: 0.3, DEAD_TURN_T: 0.25, BREAK_Q_T: 0.1, BREAK_HALF_T: 0.1, PAT_AI_T: 0.05, KICKOFF_SETUP_T: 0.1, AI_SNAP: 0.05 },
    MAX_PLAY_T: 60,           // stuck-play safety net (ARCHITECTURE 7.2)

    // ---------- field ----------
    SIDELINE: 26.65,          // |x − MID| beyond this = out of bounds (design 8.1)
    BOUND_X0: -2.4, BOUND_X1: 55.7, BOUND_Y0: -2.4, BOUND_Y1: 122.4,  // hard clamp for every body
    GOAL_HALF_W: 3.08, CROSSBAR: 3.33,

    // ---------- movement (design 4.1, 8.11) ----------
    SPD_BASE: 5.0, SPD_K: 0.045,
    ACC_BASE: 0.65, ACC_K: 0.003,
    BRAKE_MUL: 1.7,           // decel/turn authority vs accel (tuned)
    ENERGY_MAX: 100, ENERGY_MAX_DEMON: 130, ENERGY_DRAIN: 25, ENERGY_REGEN: 12, SPRINT_MIN: 20,
    SPRINT_MUL: 1.15, SPRINT_MUL_DEMON: 1.20, BURST_ADD: 0.05,
    AUTO_RUN: 0.7,            // carrier keeps running at 70% with no input (design 9.5)
    DEADZONE: 0.15,
    JUKE: { cd: 1.5, en: 15, dist: 1.5, t: 0.25, win: 0.35 },
    SPIN: { cd: 2.0, cdDoc: 1.0, en: 20, t: 0.5, spd: 0.8 },
    DIVE_T: 0.3, DIVE_EXTRA: 0.3,
    FALL_FWD: { S: 1.2, M: 1.6, L: 2.0 },   // scoring pass: a little more after contact
    RZ_PUSH: 1.0, RZ_CON: 0.08,             // red zone: runs push the pile (yd), end-zone throws win more 50/50s
    QB_SCRAMBLE_MUL: 1.06,
    BACKPEDAL: 0.7,

    // ---------- passing (design 8.9) ----------
    BALL_SPD_BASE: 16, BALL_SPD_K: 0.12, ROCKET_SPD: 1.15, AIR_SHOW_SPD: 1.05,
    MAX_THROW_BASE: 30, MAX_THROW_K: 0.35, ROCKET_DIST: 10,
    WINDUP: 0.25, WINDUP_QR: 0.10, WIND_SAFE_USER: 1.6,
    APEX_A: 1.5, APEX_B: 0.08, LOB_A: 3.0, LOB_B: 0.18, LOB_SPD: 0.75,
    RELEASE_Z: 1.9, ARRIVE_Z: 1.2, MIN_FLIGHT: 0.25,
    SIG_PRESSURE: 1.25, SIG_MOVING: 1.5, SIG_MOVING_SCR: 1.25, SIG_DIME: 0.75,
    SIG_RAIN: 1.1, SIG_SNOW: 1.15,
    USER_SIG: [0.55, 0.68, 0.807, 0.85],       // by difficulty (design 16)
    ASSIST: [7.5, 6, 4.125, 3.5], ASSIST_ANG: [18, 16, 12.25, 11], ASSIST_SOFT: 1.6, ASSIST_SOFT_F: 0.6,   // playtest: bigger magnet (yd around the aim point / degrees off the drag line)
    USER_SIG_SM: [0.62, 0.68, 0.77, 0.8], SIG_HIT_R: 1.4, SIG_PRESS_NEAR: 1.05, EASY_CON: [0.14, 0.08, 0.068, 0.05],
    SIG_RUN: 0.15, SIG_ROLL: 0.5, RUN_THROW_SPD: 0.75,   // throw on the run (σ ×1.15 at full speed; rolling to the throw side half)
    EASY_SIG: 1.3,
    WIND_DRIFT: 0.04,                 // yd per mph per second of flight
    BAT: { S: 0.01, M: 0.03, L: 0.06 }, BAT_RANGE: 1.5, BAT_PICK: 0.10,
    AI_QB_SIG: 1.0, LONG_SIG_D: 25, LONG_SIG_K: 40, DEEP_CATCH_D: 18, DEEP_CATCH_K: 0.004, DEEP_CON_K: 0.008,

    // ---------- catching (design 8.10) ----------
    UNCON_BASE: 0.95, UNCON_HND: 0.004, UNCON_OFF: 0.12, UNCON_MIN: 0.35, UNCON_MAX: 0.99,
    CON_BASE: 0.6, CON_K: 0.012, CON_MIN: 0.10, CON_MAX: 0.92,
    PICK_BASE: 0.03, PICK_K: 0.004, PICK_MIN: 0.02, PICK_MAX: 0.30,
    DPICK_BASE: 0.14, DPICK_K: 0.008, DPICK_MIN: 0.10, DPICK_MAX: 0.80,
    CATCH_TACKLE_R: 0.8, CATCH_ANIM: 0.15,
    HAIL_R: 2.5,

    // ---------- tackling (design 8.12) ----------
    DRILL_STEM: 0.9, DRILL_SIT: 0.8, DRILL_R: 5, DRILL_RE: 0.35, DRILL_SPD: 0.8, DRILL_BACK_T: 3.2, DRILL_BACK_K: 0.35, DRILL_HOLD: 0.5,   // scramble drill (playtest)
    TKL_PAD: 0.5, TKL_CD: 0.6,
    BRK_BASE: 0.055, BRK_POW: 0.007, BRK_MASS: 0.05, BRK_EDGE: 0.03, BRK_BEHIND: 0.10, BRK_SQUARE: 0.05, BRK_SIDE: 0.03,
    USER_TKL: [0.06, 0.03, 0.007, 0], BIG_HIT_MASS: 1.0, DRAG_YD: 0.8, STONE_YD: 0.4, DIVE_TKL_P: 0.025,   // playtest tackling pass BRK_TRUCK: 0.15, BRK_SURE: 0.15,
    BRK_GANG: 0.4, BRK_MIN: 0.03, BRK_MAX: 0.60, GANG_R: 1.2,
    BRK_SLOW: 0.85, BRK_SLOW_T: 0.3, STUMBLE_T: 1.0,
    DIVE_TKL_MIN: 0.5, DIVE_TKL_MAX: 2.3, DIVE_TKL_REACH: 1.5, DIVE_TKL_BRK: 0.08, DIVE_MISS_DOWN: 1.2,
    RET_TKL_BONUS: 0.0,       // tuned: kick coverage tackling help
    FUM_BASE: 0.008, FUM_BIG: 1.8, FUM_SACK_BEHIND: 1.8, FUM_SACK_FRONT: 1.2, FUM_SPIN: 1.5,
    BIG_HIT_V: 7,
    LOOSE_T: 0.5, FUM_RET: 0.45,
    SACK_ESC_BASE: 0.10, SACK_ESC_MIN: 0.02, SACK_ESC_MAX: 0.35, SACK_FALL: 1.0,

    // ---------- line play & coverage (design 8.13) ----------
    // playtest (human QB only, by difficulty): pass-rush win time ×USER_POCKET (TWIN was tuned for the instant AI QB;
    // a standing human was sacked 28% of dropbacks by 2.0 s), second-level blitzers read for USER_BLITZ_GO s at 45%
    // pace, and +USER_SACK_ESC "break free" chance on a sack
    TWIN: 1.35, TWIN_SD: 0.25, USER_POCKET: [2.0, 2.2, 1.45, 1.2], USER_POCKET_ADD: [0.7, 0.7, 0.175, 0], USER_POCKET_MIN: [2.6, 2.4, 1.65, 1.4], USER_BLITZ_GO: [1.1, 1.0, 0.55, 0.4], USER_BLITZ_PACE: 0.95, USER_STEM: [0.85, 0.85, 0.963, 1], JUKE_REACT: [0.22, 0.22, 0.13, 0.1], JUKE_REACT_R: 5, USER_SACK_ESC: [0.15, 0.10, 0.062, 0.05], TSHED: 2.2, TSHED_SD: 0.2, DOUBLE: 1.8, ESCORT_SHED: 0.6, SCREEN_HOLD: 0.5,
    POCKET_PUSH: 0.6, RUN_PUSH: 1.0, ENGAGE_PAD: 0.35, REENGAGE_CD: 1.2,
    BRICK_WALL_T: 1.0, ROAD_GRADER_T: 0.5, BUILDER_T: 0.2, BIG_EARS_T: 0.2, HORN_T: 0.15, SACK_MASTER_W: 0.85,
    GREEN_DOG_T: 0.8,
    TRAIL: 1.0, TRAIL_PRESS: 0.5, PRESS_T: 1.5, TRAIL_TIGHT: 0.5, TRAIL_MIN: 0.2, LOCKDOWN_TRAIL: 0.5, SIDESTEP_TRAIL: 0.2, ROUTE_ARTIST_SEP: 0.3,
    ZONE_DROP_T: 1.0, ZONE_DROP_UNDER: 0.45, ZONE_REACH: 7, ZONE_COVERED: 8, ZONE_SQUEEZE_D: 6, ZONE_CUSHION: 2.5, ZONE_DEPTH_W: 0.25, ZONE_CHECKDOWN: 3,   // zone coverage fix (playtest)
    BREAK_R: 10,
    PURSUIT_DT: 0.1, HUSTLE: 1.10, HUSTLE_R: 15, HUSTLE_PAST: 3, HUSTLE_RET: 18, KCOVER_PACE: 0.96, CONTAIN_GAP: 1.0, CONTAIN_R: 5,
    REACT_BASE: 0.40, REACT_K: 0.002, REACT_MIN: 0.10, REACT_MAX: 0.50,
    PA_BITE: 0.60, PA_BITE_SMT: 0.01, PA_BITE_EDGE: 0.10, PA_BITE_RUNCALL: 0.20, PA_BITE_DIST: 1.5, DRAW_FOOL: 0.9, DRAW_ARM: 0.4, DEEP_RUN_READ: 0.7,

    // ---------- AI QB & carriers (design 8.14) ----------
    QB_READ_BASE: 0.5, QB_SET: 0.4, QB_READ_K: 0.003, QB_OWL: 0.1,
    OPEN_PROJ: 0.6, OPEN_MIN: 2.6, OPEN_PRESS: 2.0, OPEN_DEEP: 4.8, PRESS_R: 3.0, QB_MAX_T: 4.0,
    CAR_THINK: 0.3, CAR_FWD: 1.2, CAR_HEADINGS: 7, CAR_SPREAD: Math.PI / 3,
    CAR_JUKE: 0.12, CAR_SPIN: 0.06, CAR_SPRINT_FREE: 8,

    // ---------- kicking (design 8.4–8.6) ----------
    KO_LINE: 35, KO_DIST: 60, KO_KCK: 0.1, KO_SD: 4, KO_TB: 0.75, KO_HANG: 3.0,
    TB_KO: 35, TB_PUNT: 20,   // scoring pass: kickoff touchback to the 35
    ONSIDE_BASE: 0.12, ONSIDE_K: 0.003, ONSIDE_ROOKIE: 0.10,
    PUNT_NET: 30, PUNT_KCK: 0.15, PUNT_SD: 5, PUNT_BOOM: 5, PUNT_RET_ADD: 4, PUNT_HANG: 4.2, PUNT_BLOCK: 0.005, PUNT_MUFF: 0.01, PUNT_DEPTH: 11,
    FG_ADD: 17, FG_RANGE: 38, FG_RANGE_K: 0.3, FG_BOOM: 5,
    FG_P0: 0.99, FG_PD: 0.0062, FG_PK: 0.0003, FG_WIND: 0.003, FG_WILD: 0.08, FG_WET: 0.97,
    KICK_SIG0: 0.8, KICK_SIGK: 0.04, KICK_AIM_MAX: 15, KICK_WIND: 0.15, DOINK: 0.3,
    XP_FROM: 15, XP_FROM_PARTY: 20, TWO_FROM: 2, TWO_FROM_PARTY: 1,
    SAFETY_SPOT: 35,

    // ---------- clock (design 8.3) ----------
    // 4 × 3:00 quarters (client pass 4): 15 s → ~5.5 drives per team, ~8.5 real minutes. Before (2 × 5:00 halves): 12–13 s;
    // 20 → 24 s. Human games ran 12–13.5 min of real time at 5:00 quarters (target 8–12); fewer snaps per game
    RUN_INB: 15, RUN_HURRY: 8, RUN_LAST_MIN_FD: 10, RUN_STOP: 6, RUN_SACK: 15, RUN_KNEEL: 40, RUN_SPIKE: 3,
    SUG_HIST: 6, SUG_CALLED: 25, SUG_SHOWN: 14, SUG_FRESH: 8, SUG_TEMP: 7,   // play-card suggestion variety (client pass 4)
    FORM_CHECK: { bunch: 0.7, empty: 0.7 },   // AI zone → man check vs these formations (coverage pass)
    QLEN: 180,                // default quarter length when cfg.qLen is missing (4 quarters, client pass 4)
    TOS: 3, TOS_OT: 2,

    // ---------- injuries (design 12) ----------
    INJ_BASE: 0.005, INJ_BIG: 2.0, INJ_SACK: 1.5, INJ_DIVE: 0.5, INJ_BROKEN: 0.5, INJ_AGE: 0.08,
    INJ_SEV: [0.50, 0.28, 0.15, 0.06, 0.01],

    // ---------- penalties (design 8.15) ----------
    PEN_FALSE: 0.005, PEN_OFFSIDE: 0.006, PEN_HOLD: 0.014, PEN_PI: 0.12, PEN_ROUGH: 0.03, PEN_FACE: 0.003,

    // ---------- difficulty (design 16) ----------
    // playtest: STAR_NEAR 2.5→3.0, STAR_AIR 3→4 and the STAR_CHASE ring (Star closing on the carrier) give the Star a
    // ring on ~40% of defensive plays (was ~33%; 11% on runs)
    // Rookie-only helpers (playtest: a brand-new human must win most Rookie games). EASY_*[diff]; index 0 = Rookie.
    EASY_REACT: [0.08, 0.04, 0.01, 0], EASY_TRAIL: [0.5, 0.25, 0.062, 0], EASY_BRK: [0.06, 0.06, 0.037, 0.03], EASY_AIQB_SIG: [1.25, 1.08, 1.02, 1], EASY_PICK: [0.7, 0.85, 0.963, 1],
    // Star abilities (docs/STAR_ABILITIES.md). Meter fill per play: METER_PLAY (+ METER_GOOD on a good play, + METER_BIG on a
    // TD / takeaway) × difficulty × METER_SCALE (tuned so the user can use one about every 3–4 plays per side).
    METER_PLAY: 12, METER_GOOD: 15, METER_BIG: 25, METER_USER: [1.25, 1.0, 0.887, 0.85], METER_AI: [0.8, 1.0, 1.112, 1.15], METER_SCALE: 1.65,
    AB_DUR: { magnet: 2.5, turbo: 2.5, laser: 2.5, bulldozer: 1.5, lockdown: 3.0, pancake: 2.5 }, STAR_PASSIVE: 5, AB_PANCAKE_PUSH: 1.6, AB_PERFECT: 1.5,
    AB_MAGNET_REACH: 1.2, AB_MAGNET_WIN: 1.6, AB_TURBO_SPD: 0.15, AB_TURBO_ACC: 0.5, AB_LASER_SIG: 0.4, AB_LASER_SPD: 0.2, AB_LASER_REACT: 0.15,
    AI_AUDIBLE: [0, 0.2, 0.312, 0.35], AI_AUDIBLE_BAD: -0.5, DEF_AUTO_GO: [0, 0, 0, 0],   // client pass 5: never auto-GO for the user's defense (only Auto Defense)
    AB_DOZER_SPD: 0.2, AB_DOZER_TKL: 1.5, AB_LOCK_INT: 1.8, AB_WARN_T: 0.8, AB_AI_USE: 0.8,
    AI_SKILL: [-4, 0, 1.125, 1.5], PCOUNTER: [0.20, 0.40, 0.55, 0.60], STAR_WIN: [0.90, 0.60, 0.487, 0.45],   // decision-time pass: +50%
    USER_FUM: [0.7, 1, 1, 1], USER_INJ: [0.6, 1, 1.15, 1.2],
    STAR_NEAR: 3.0, STAR_AIR: 4.0, STAR_CHASE: 5.0, STAR_CLOSE_V: 2.0, STAR_SUPER_BRK: 0.25, STAR_SUPER_REACH: 1.5, STAR_WHIFF_BRK: 0.20, STAR_JUMP_D: 20, STAR_JUMP_PICK: 0.10,
    STAR_WHIFF_D: 10, STAR_SLOWMO: 0.5,

    // ---------- Edge (design 7.4) ----------
    EDGE_MAX: 3, EDGE_TXT: 1.5,

    // ---------- tuned balance knobs (calibration) ----------
    OFF_REACT_PASS: 1.0
  };

  /**
   * Species body quirks with in-engine effects (design 3.3). Keys:
   * reach/height/dive/hitbox adds (yd), fumble/injury/int/drop/juke multipliers or adds, flags.
   */
  T.SPQ = {
    elephant: { bigEars: 1 }, rhino: { horn: 1 }, hippo: { heavy: 1 }, walrus: { snowImm: 1 }, bull: { charge: 1 },
    croc: { chomp: 1 }, giraffe: { reach: 0.6, height: 0.8 }, ostrich: { fum: 1.2 }, penguin: { snowImm: 1 },
    owl: { fogImm: 1, owl: 1 }, wolf: { pack: 1 }, cheetah: { burst: 1 }, kangaroo: { dive: 1 }, turtle: { inj: 0.75 },
    goat: { snowMov: 1 }, eagle: { eagle: 1 }, beaver: { builder: 1 }, raccoon: { int: 1.15 }, monkey: { drop: 0.85 },
    rabbit: { juke: 0.05 }, frog: { reach: 0.4, height: 0.5 }, chicken: { juke: 0.05 }, duck: { rainImm: 1 }, pig: { rainImm: 1 },
    hamster: { hitbox: -0.1 }, crab: { sidestep: 1 }
  };
  // T has ~250 keys: V8 keeps such literals in slow (dictionary) mode. Using it once as a prototype makes it fast again.
  T.SPQ = Object.assign({}, T.SPQ);
  Object.create(T);
})(globalThis.PT = globalThis.PT || {});
