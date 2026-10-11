/* Pixel Touchdown: js/data/text.js
 * Owner: WP2. Responsibility: PT.Data.Text: news templates, injury names, school names, award names.
 * Kid-friendly words only (design 1.2 / 1.3). Templates use {T} {T2} {P} {N} {N2} {first} {stat} {twist} {division} {stadium} {award}.
 */
(function (PT) {
  'use strict';
  const T = PT.ns('Data.Text');

  /** Appendix B news ticker templates (+ a few extra franchise lines). Keys are used by PT.League.News.tpl(). */
  T.news = {
    win: '{T} beat {T2} {N}–{N2}',
    upset: 'Upset: {S}-star {T} stun {T2}',
    passTd: '{P} throws {N} TDs in a win',
    rush: '{P} runs for {N} yards',
    catchYds: '{P} catches for {N} yards',
    inj: 'Injury: {P} out {N} wk',
    injOut: 'Injury: {P} out for the season',
    swap: '{T} swap {P} to {T2}',
    sign: '{T} sign {P} (${N}M/yr)',
    keep: '{T} keep {P}: ${N}M a year',
    winStreak: '{T} win {N} straight',
    loseStreak: '{T} drop {N} straight',
    record: 'New record: {P} sets the {stat} mark',
    teamRecord: 'New record: {T} set the {stat} mark',
    retire: '{P} retires after {N}. Thanks, {first}.',
    hof: '{P} enters the Hall of Fame',
    hofFirst: '{P} makes the Hall of Fame on the first try',
    snow: 'Snow game: {T} vs {T2}',
    twist: 'Season Twist: {twist}',
    clinchDiv: '{T} clinch the {division} Division',
    playoffs: '{T} clinch a playoff spot',
    champ: '{T} win the Pixel Bowl!',
    careerTd: '{P} reaches {N} career TDs',
    milestone: '{P} reaches {N} {stat}',
    firstPick: 'Draft Day: {T} take {P} first overall',
    aiFire: '{T} fire their head coach',
    award: '{P} wins {award}',
    coy: '{T} coach wins Coach of the Year',
    retNum: '{T} retire #{N} for {P}',
    walkOn: '{T} sign walk-on {P}.',
    hotSeat: 'The Boss is worried about the {T}.',
    newJob: '{T} hire {P} as head coach',
    achievement: 'Badge earned: {N}'
  };

  /** Appendix B #21 filler lines (10). */
  T.filler = [
    'A duck crossed the road during practice. Everyone cheered.',
    'Traffic jam outside {stadium}. Fans honk for {T}.',
    '{T} fans built a snow fort.',
    'A frog hopped onto the field and stole the show at {stadium}.',
    'The {T} mascot debuts a new dance.',
    'A train went by during {T} practice. Everyone waved.',
    'Rain boots sold out at {stadium}.',
    'A tiny turtle took 10 minutes to cross the 50-yard line.',
    '{T} fans made a giant carrot out of pillows.',
    'The {T} bus got a fresh coat of paint.'
  ];

  /** Injury tiers (design 12.2). index = tier 1..5 */
  T.tiers = ['', 'Ouch', 'Sprain', 'Hurt', 'Bad Hurt', 'Season Over'];
  /** cute injury names by tier (never graphic) */
  T.injTiers = {
    1: ['Bumped Nose', 'Stubbed Toe', 'Bonked Head'],
    2: ['Sprained Paw', 'Twisted Tail', 'Sore Snout', 'Tweaked Wing', 'Wobbly Ankle'],
    3: ['Sore Knee', 'Bruised Shell', 'Pulled Hammy', 'Achy Back', 'Banged-up Hoof'],
    4: ['Big Knee Owie', 'Cracked Claw', 'Hurt Shoulder', 'Bent Beak'],
    5: ['Season-long Knee Owie', 'Big Leg Owie', 'Broken Paw']
  };
  /** flat list (compat with the data stub) */
  T.injuries = [].concat(T.injTiers[2], T.injTiers[3], T.injTiers[4], T.injTiers[5]);

  /** Appendix A schools (20) */
  T.schools = ['Acorn U', 'Pond State', 'Hay Bale Tech', 'Puddle College', 'Big Rock U', 'Sandy Shores State', 'Pinecone Prep',
    'Riverbend U', 'Corn Cob College', 'Frosty Peak State', 'Junkyard Tech', 'Crosswalk Academy', 'Lily Pad U',
    'Desert Wind College', 'Mudflats State', 'Railyard U', 'Snowball State', 'Cloud Valley U', 'Toll Road Tech', 'Meadowbrook College'];

  /** award codes → in-game names (design 1.3 / 10.12) */
  T.awards = { MVP: 'Top Dog', OPOY: 'Best Offense', DPOY: 'Best Defense', ROY: 'Best Newbie', COY: 'Coach of the Year',
    PRO: 'Pixel Pro Team', HOF: 'Hall of Fame', CHAMP: 'Pixel Bowl' };

  /** stat key → short kid words (records, milestones) */
  T.stats = { py: 'pass yards', ptd: 'pass TDs', ry: 'run yards', rtd: 'run TDs', rcy: 'catch yards', rctd: 'catch TDs',
    rc: 'catches', tk: 'tackles', dsk: 'sacks', int: 'picks', fgm: 'field goals', gp: 'games',
    tdPass: 'longest TD pass', tdRun: 'longest TD run', fgLong: 'longest field goal', pickRet: 'longest pick return',
    pts: 'most points', wins: 'most wins', margin: 'biggest win', streak: 'longest win streak', carrots: 'most Pixel Bowl titles' };

  /** Mood faces (design 13.1) */
  T.mood = [[80, 'Happy'], [50, 'Okay'], [30, 'Meh'], [0, 'Grumpy']];
  /** Boss faces (design 1.3) */
  T.boss = [[75, 'happy'], [50, 'okay'], [30, 'worried'], [0, 'angry']];
  T.bossTalk = { happy: 'The Boss is thrilled.', okay: 'The Boss is okay.', worried: 'The Boss looks worried.', angry: 'The Boss is grumpy.' };
  /** Team Spirit labels (design 13.3) */
  T.spirit = [[75, 'In Sync'], [50, 'Good'], [26, 'Okay'], [0, 'Out of Sync']];

  /** Boss goals (design 10.9) index = level */
  T.goals = ['', 'Win 5+ games', 'Win 8+ games', 'Make the playoffs', 'Win a playoff game', 'Reach the Pixel Bowl'];

  /** Legacy titles (design 14.9) */
  T.legacy = [[0, 'Newbie Coach'], [500, 'Rising Coach'], [1500, 'Pro Coach'], [3000, 'Great Coach'], [6000, 'Legend Coach'], [10000, 'Pixel Immortal']];

  /** Wants (design 13.2) */
  T.wants = { money: 'Money', wins: 'Wins', home: 'Home', fame: 'Fame', chill: 'Chill' };

  /** Keep Players verdict chips (design 10.5) */
  T.verdict = { will: 'Will sign', more: 'Wants more', wont: "Won't stay" };
  /** Market interest faces (design 10.7) */
  T.interest = { likely: 'Likely', maybe: 'Maybe', unlikely: 'Unlikely' };

  /** simple result messages (Result.msg) */
  T.msg = {
    noCoins: 'Not enough Coins.', noCash: 'Not enough Team Cash.', rosterFull: 'Your roster is full.', notNow: 'Not right now.',
    maxed: 'Already maxed out.', notFA: 'That player is not on the Market.', notYours: 'That player is not on your team.',
    tooMany: 'Too many offers today.', oneOffer: 'You already made an offer.', partyMax: 'No more parties this season.'
  };
})(globalThis.PT = globalThis.PT || {});
