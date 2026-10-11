/* Pixel Touchdown: js/audio/music.js
 * Owner: WP6 / AUDIO. Responsibility: chiptune sequencer engine, the soundtrack and the musical stingers.
 *
 * Everything is synthesized (no files). How it works:
 *  - A song is data: tempo, transpose, swing, patches, sections and a form (section order + loop point or chain).
 *    A section has chords ('C | Am | F G | ...', one bar per '|'), a hand-written lead melody, an optional
 *    counter line ('harm' = chord-tone harmony under the lead, 'oct' = lead an octave down, or written out) and
 *    generated accompaniment: bass / pad / stab / arp styles and a drum groove. compile() flattens a song once
 *    into per-16th-step event lists. Drum fills land every 8 bars and on section ends; crashes on section starts.
 *  - Melody tokens: 'c5' 'f#4' 'bb5' (+ ':n' = n sixteenths, default 2), 'r' rest, '-' tie, '~e5' glide, '|' bar.
 *  - Look-ahead scheduler: a 25 ms timer schedules notes ≤ 0.2 s ahead on the AudioContext clock (no drift);
 *    loops jump back to the loop step on that same clock, so they are seamless. Chained songs (hq <-> hq2) switch
 *    at the bar line.
 *  - Each playing song is an instance: channel buses (gain → pan) → duck → fade → music bus, plus reverb
 *    (ConvolverNode, generated impulse) and tempo-synced echo sends. Song changes crossfade (≤ 0.85 s).
 *    Stingers are one-shot instances that duck the song; duckFor() ducks it under big sfx.
 *  - Intensity 0..1 (setIntensity): song.layers fades channels in/out; sections may swap to a hotter groove.
 *  - render(name, secs, o) renders offline (OfflineAudioContext) for the dev board and level tests.
 * Voices: 12.5/25/50 % pulse (PeriodicWave), saw, tri, sine, unison detune, sub osc, FM (bell, marimba,
 * e-piano), ADSR + filter envelope, delayed vibrato, portamento. Drums: kick, snare, rim, clap, hats, shaker,
 * 3 toms, crash, timpani (tuned to the chord), woodblock — noise + pitched synthesis.
 */
(function (PT) {
  'use strict';
  const Audio = PT.Audio = PT.Audio || {};
  const LOOK = 0.2, TICK = 25, XFADE = 0.85;
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const warns = [];
  function warn(msg) { warns.push(msg); if (PT.Log && PT.Log.warn) PT.Log.warn('music', msg); }

  // =====================================================================================================
  // Theory: pitches, chords, voicings
  // =====================================================================================================
  const PCN = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const acc = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
  function pitchOf(s) {
    const m = /^([a-g])(#|b)?(\d)$/.exec(s);
    return m ? PCN[m[1]] + acc(m[2]) + (+m[3] + 1) * 12 : null;
  }
  const QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], 6: [0, 4, 7, 9],
    m6: [0, 3, 7, 9], sus4: [0, 5, 7], sus2: [0, 2, 7], '7sus': [0, 5, 7, 10], dim: [0, 3, 6], aug: [0, 4, 8],
    add9: [0, 4, 7, 2], m9: [0, 3, 7, 10, 2], 9: [0, 4, 7, 10, 2]
  };
  function parseChord(sym) {
    const m = /^([A-G])(#|b)?([a-z0-9]*)(?:\/([A-G])(#|b)?)?$/.exec(sym);
    if (!m || !QUAL[m[3]]) { warn('bad chord ' + sym); return parseChord('C'); }
    const pc = (l, a) => (PCN[l.toLowerCase()] + acc(a) + 12) % 12;
    const root = pc(m[1], m[2]);
    const ints = QUAL[m[3]].slice(0, 4);
    return { sym: sym, root: root, ints: ints, pcs: ints.map((i) => (root + i) % 12), bass: m[4] ? pc(m[4], m[5]) : root };
  }
  /** lowest midi ≥ lo with pitch class pc */
  const fit = (pc, lo) => { let n = lo; while (((n % 12) + 12) % 12 !== pc) n++; return n; };
  /** chord voicing inside [lo, hi] with the smallest movement from prev (voice leading) */
  function voicing(pcs, lo, hi, prev) {
    let best = null, bd = 1e9;
    const n = pcs.length;
    for (let r = 0; r < n; r++) {
      for (let oct = 0; oct < 2; oct++) {
        const v = [fit(pcs[r], lo) + oct * 12];
        for (let k = 1; k < n; k++) v.push(fit(pcs[(r + k) % n], v[k - 1] + 1));
        if (v[n - 1] > hi) continue;
        const d = prev ? v.reduce((a, x) => a + Math.min.apply(null, prev.map((p) => Math.abs(p - x))), 0)
          : Math.abs(v[0] + v[n - 1] - lo - hi);
        if (d < bd) { bd = d; best = v; }
      }
    }
    if (!best) { best = [fit(pcs[0], lo)]; for (let k = 1; k < n; k++) best.push(fit(pcs[k], best[k - 1] + 1)); }
    return best;
  }
  /** chord string → bars of segments [{s0, s1, c}] ('|' between bars; n chords in a bar split it evenly; '%' = same) */
  function parseChords(str) {
    let last = parseChord('C');
    return String(str || 'C').split('|').map((bar) => {
      const toks = bar.trim().split(/\s+/).filter(Boolean);
      const w = 16 / Math.max(1, toks.length);
      return toks.map((tk, i) => { if (tk !== '%') last = parseChord(tk); return { s0: Math.round(i * w), s1: Math.round((i + 1) * w), c: last }; });
    });
  }
  /** melody string → notes [{s, d, n, sl}] (steps relative to the section) */
  function parseMel(str, tag) {
    const out = [];
    let s = 0, bar = 0, last = null;
    String(str).trim().split(/\s+/).forEach((tok) => {
      if (tok === '|') { bar++; if (s !== bar * 16) warn(tag + ': bar ' + bar + ' has ' + (s - (bar - 1) * 16) + ' steps'); s = bar * 16; return; }
      const m = /^(~?)([a-g](?:#|b)?\d|r|-)(?::(\d+))?$/.exec(tok);
      if (!m) { warn(tag + ': bad token ' + tok); return; }
      const d = m[3] ? +m[3] : 2;
      if (m[2] === 'r') last = null;
      else if (m[2] === '-') { if (last) last.d += d; }
      else { last = { s: s, d: d, n: pitchOf(m[2]), sl: m[1] === '~' }; out.push(last); }
      s += d;
    });
    if (s % 16) warn(tag + ': last bar has ' + (s % 16) + ' steps');
    return out;
  }
  const hash = (str, n) => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return ((h ^ n * 2654435761) >>> 0); };

  // =====================================================================================================
  // Patches (gain = peak per voice before the channel bus)
  // =====================================================================================================
  const PATCH = {
    lead: { w: 'p25', a: 0.006, d: 0.25, s: 0.7, r: 0.09, gain: 0.12, lp: 6000, vib: { r: 5.5, d: 16, dl: 0.18 }, leg: 0.92 },
    softLead: { w: 'p50', a: 0.014, d: 0.3, s: 0.65, r: 0.14, gain: 0.085, lp: 2200, vib: { r: 5, d: 22, dl: 0.2 }, leg: 0.9 },
    counter: { w: 'p12', a: 0.005, d: 0.2, s: 0.55, r: 0.08, gain: 0.11, lp: 4500, vib: { r: 6, d: 12, dl: 0.2 }, leg: 0.85 },
    whistle: { w: 'triangle', a: 0.02, d: 0.2, s: 0.85, r: 0.1, gain: 0.2, vib: { r: 5.2, d: 22, dl: 0.12 }, leg: 0.95 },
    brass: { w: 'sawtooth', uni: 2, det: 7, a: 0.025, d: 0.3, s: 0.75, r: 0.12, gain: 0.12, lp: 1300, lpEnv: 2800, lpT: 0.09, q: 1.2, vib: { r: 5, d: 10, dl: 0.25 }, leg: 0.94 },
    arp: { w: 'p12', a: 0.002, d: 0.1, s: 0.25, r: 0.05, gain: 0.08, lp: 4200, leg: 0.6, lo: 64, hi: 86 },
    pizz: { w: 'p25', a: 0.002, d: 0.13, s: 0, r: 0.05, gain: 0.1, lp: 2600, leg: 0.5, lo: 62, hi: 84 },
    bellArp: { w: 'sine', fm: { ratio: 3.5, idx: 2.5, t: 0.12 }, a: 0.002, d: 0.6, s: 0, r: 0.2, gain: 0.075, lo: 72, hi: 93 },
    marimba: { w: 'sine', fm: { ratio: 4, idx: 1.8, t: 0.03 }, a: 0.002, d: 0.45, s: 0, r: 0.12, gain: 0.22, leg: 1 },
    bell: { w: 'sine', fm: { ratio: 3.5, idx: 3, t: 0.3 }, a: 0.002, d: 1.2, s: 0, r: 0.4, gain: 0.12, leg: 1 },
    uke: { w: 'sawtooth', a: 0.002, d: 0.35, s: 0, r: 0.1, gain: 0.05, lp: 700, lpEnv: 3000, lpT: 0.05, strum: 0.014, lo: 55, hi: 74, leg: 1 },
    epiano: { w: 'sine', fm: { ratio: 1, idx: 1.4, t: 0.35, min: 0.2 }, a: 0.004, d: 1.6, s: 0.3, r: 0.3, gain: 0.07, lo: 52, hi: 74, strum: 0.006, leg: 0.95 },
    pad: { w: 'sawtooth', uni: 2, det: 10, a: 0.3, d: 0.6, s: 0.85, r: 0.5, gain: 0.03, lp: 1500, lo: 52, hi: 74, leg: 1 },
    padSoft: { w: 'triangle', uni: 2, det: 8, a: 0.25, d: 0.5, s: 0.85, r: 0.5, gain: 0.06, lo: 52, hi: 74, leg: 1 },
    strings: { w: 'sawtooth', uni: 2, det: 13, a: 0.18, d: 0.4, s: 0.9, r: 0.4, gain: 0.032, lp: 2400, vib: { r: 5, d: 7, dl: 0.2 }, lo: 55, hi: 79, leg: 1 },
    brassPad: { w: 'sawtooth', uni: 2, det: 8, a: 0.06, d: 0.5, s: 0.7, r: 0.25, gain: 0.034, lp: 900, lpEnv: 1800, lpT: 0.2, lo: 55, hi: 76, leg: 0.95 },
    stab: { w: 'sawtooth', uni: 2, det: 9, a: 0.006, d: 0.12, s: 0.3, r: 0.07, gain: 0.042, lp: 900, lpEnv: 3200, lpT: 0.05, lo: 60, hi: 79, leg: 0.6 },
    organ: { w: 'square', a: 0.008, d: 0.1, s: 0.85, r: 0.05, gain: 0.03, lp: 2400, lo: 58, hi: 77, leg: 0.6, vib: { r: 6.5, d: 6, dl: 0 } },
    chipBass: { w: 'p50', a: 0.003, d: 0.12, s: 0.55, r: 0.05, gain: 0.07, lp: 650, lpEnv: 1500, lpT: 0.05, sub: { w: 'triangle', g: 2.2 }, leg: 0.8, lo: 33 },
    bassTri: { w: 'triangle', a: 0.004, d: 0.2, s: 0.8, r: 0.06, gain: 0.24, leg: 0.85, lo: 36 },
    pluckBass: { w: 'sawtooth', a: 0.003, d: 0.28, s: 0.35, r: 0.06, gain: 0.09, lp: 280, lpEnv: 1300, lpT: 0.07, sub: { w: 'sine', g: 1.6 }, leg: 0.85, lo: 33 },
    coin: { w: 'square', a: 0.002, d: 0.3, s: 0.4, r: 0.1, gain: 0.06, lp: 6000, leg: 1 }
  };

  // =====================================================================================================
  // Accompaniment styles
  // =====================================================================================================
  /** bass: [step, degree, dur]; degree R root/slash bass, 5 fifth, 8 octave, 3 third, 7 seventh, A approach to next root */
  const BASS = {
    whole: [[0, 'R', 16]],
    half: [[0, 'R', 8], [8, '5', 8]],
    root8: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 'R', 2]),
    oct8: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, i % 2 ? '8' : 'R', 2]),
    pump: [[0, 'R', 2], [2, 'R', 1], [3, '8', 1], [4, 'R', 2], [6, '8', 2], [8, 'R', 2], [10, 'R', 1], [11, '8', 1], [12, 'R', 2], [14, '5', 2]],
    walk: [[0, 'R', 4], [4, '3', 4], [8, '5', 4], [12, 'A', 4]],
    bounce: [[0, 'R', 4], [6, '5', 2], [8, '8', 3], [11, '5', 1], [12, 'R', 2], [14, 'A', 2]],
    funk: [[0, 'R', 2], [3, 'R', 1], [4, '8', 2], [7, '5', 1], [8, 'R', 2], [10, '7', 2], [12, '8', 1], [14, '5', 2]],
    gallop: [0, 4, 8, 12].reduce((a, b) => a.concat([[b, 'R', 1], [b + 1, 'R', 1], [b + 2, b === 12 ? '8' : 'R', 2]]), []),
    ostinato: [[0, 'R', 2], [2, 'R', 2], [4, '5', 2], [6, 'R', 2], [8, 'R', 2], [10, 'R', 2], [12, '5', 2], [14, '8', 2]],
    anthem: [[0, 'R', 2], [2, 'R', 2], [4, '8', 2], [6, 'R', 2], [8, 'R', 2], [10, 'R', 2], [12, '8', 2], [14, '5', 2]]
  };
  /** pad / stab rhythm: [step, dur, vel]; hold = one chord per chord change */
  const PADS = {
    hold: 'hold',
    stab: [[2, 1, 0.9], [6, 1, 0.8], [10, 1, 0.9], [14, 1, 0.8]],
    hit: [[0, 6, 1]],
    beat: [[0, 2, 1], [4, 2, 0.8], [8, 2, 0.9], [12, 2, 0.8]],
    charleston: [[0, 3, 1], [6, 2, 0.85], [10, 2, 0.8]],
    anthem: [[0, 6, 1], [6, 2, 0.8], [8, 6, 0.95], [14, 2, 0.8]],
    strum: [[0, 4, 1], [4, 2, 0.8], [6, 4, 0.65], [10, 2, 0.65], [12, 2, 0.85], [14, 2, 0.6]],
    strum2: [[0, 6, 1], [6, 2, 0.7], [8, 6, 0.9], [14, 2, 0.6]],
    keys: [[0, 6, 0.95], [6, 4, 0.7], [10, 6, 0.75]]
  };
  const ARP = {
    up: (t) => t,
    down: (t) => t.slice().reverse(),
    updown: (t) => t.concat(t.slice(1, -1).reverse()),
    alb: (t) => [t[0], t[2] || t[1], t[1], t[2] || t[1]],
    bounce: (t) => [t[0], t[t.length - 1], t[1], t[t.length - 1], t[2] || t[1], t[t.length - 1]]
  };

  // =====================================================================================================
  // Drums: grooves (16 chars per bar, longer = multi-bar) and fills. x .75  X 1  o .4  1-9 = .1-.9
  // =====================================================================================================
  const GROOVE = {
    march: { kick: 'x.......x.......', snare: 'x.oxx.oxx.oxX.xx', timp: 'x.......x.......' },
    anthem: { kick: 'x.....x.x.......', snare: '....x.......x...', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    rock: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'xoxoxoxoxoxoxoxo' },
    half: { kick: 'x.........x.....', snare: '........x.......', hat: 'x...x...x...x...' },
    chill: { kick: 'x......x..x.....', rim: '....x.......x...', shaker: 'xoxoxoxoxoxoxoxo' },
    chill2: { kick: 'x......x..x.....', clap: '....x.......x...', shaker: 'xoxoxoxoxoxoxoxo', ohat: '..............x.' },
    chillLite: { shaker: 'xoxoxoxoxoxoxoxo', rim: '....x.......x...' },
    lofi: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'x.o.x.o.x.o.x.oo' },
    lofiLite: { hat: 'x.o.x.o.x.o.x.o.', rim: '....x.......x...' },
    lofi2: { kick: 'x......x.xx.....', snare: '....x.......x..o', hat: 'xoxoxoxoxoxoxoxo' },
    stomp: { kick: 'x.x.....x.x.....', clap: '....X.......X...', hat: '..x...x...x...x.', snare: 'o..o..o.o..o.ooo' },
    stompHi: { kick: 'x.x...x.x.x...x.', clap: '....X.......X...', hat: 'x.xxx.xxx.xxx.xx', snare: 'o.oxo.o.o.oxoxoo' },
    tick: { block: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......' },
    suspense: { kick: 'x.......x..x....', snare: '............x...', hat: 'xoxoxoxoxoxoxoxo', block: 'x...x...x...x...' },
    show: { kick: 'x...x...x...x...', clap: '....x.......x...', ohat: '..x...x...x...x.', hat: 'xo.oxo.oxo.oxo.o' },
    toms: { tomL: 'x..x..x.x..x..x.', timp: 'x.......x.......', kick: 'x.......x.......' },
    epic: { kick: 'x.x...x.x.x...x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    epicHalf: { kick: 'x.........x.....', snare: '........X.......', hat: 'x...x...x...x...', timp: 'x.......x.......' },
    disco: { kick: 'x...x...x...x...', snare: '....x.......x...', ohat: '..x...x...x...x.', hat: 'xo.oxo.oxo.oxo.o' },
    bowl: { kick: 'x.......x.x.....', snare: '........X.......', clap: '........X.......', hat: 'x.x.x.x.x.x.x.x.', timp: 'x...............' },
    fanfare: {
      timp: 'x.......x.......' + 'x...x...x...x...' + 'X...............',
      snare: '..x...x...x.x.x.' + 'x.x.x.x.xxxxXXXX' + '................',
      kick: 'x.......x.......' + 'x...x...x...x...' + 'X...............',
      crash: '................' + '................' + 'X...............'
    },
    bowlIntro: {
      timp: 'X.......x.......' + 'x.......x.......' + 'x.......x.......' + 'x.x.x.x.xxxxXXXX',
      crash: 'X...............' + '................' + '................' + '................',
      kick: 'x...............' + 'x...............' + 'x...............' + 'x...x...x...x...',
      snare: '................' + '................' + '................' + '....x.x.xxxxXXXX'
    },
    sad: { timp: '................' + '................' + 'x...............' },
    tdHit: {
      snare: '3.4.5.6.7889XXXX' + '................', kick: '................' + 'X...............',
      crash: '................' + 'X...............', timp: '........x...x...' + 'X...............'
    },
    season: {
      kick: 'x.....x.x.......' + 'x.....x.x...x.x.' + 'X...............',
      snare: '....x.......x...' + '....x...x.x.xxxx' + '................',
      hat: 'x.x.x.x.x.x.x.x.' + 'x.x.x.x.........' + '................',
      crash: '................' + '................' + 'X...............'
    }
  };
  const FILL = {
    snare: { from: 8, snare: '........x.xxx.XX', kick: '........x.......' },
    toms: { from: 8, tomH: '........xx......', tomM: '..........xx....', tomL: '............xx..', snare: '..............xX', kick: '........x.......' },
    roll: { from: 8, snare: '........45678899', kick: '........x...x...' },
    flam: { from: 8, snare: '........X..X..X.', tomL: '..........x..x..', kick: '........x.....x.' },
    soft: { from: 8, tomH: '........x..x....', tomM: '..........x..x..', rim: '..............x.' },
    build: { from: 0, snare: '2.3.4.5.66778899', kick: 'x...x...x...x...' }
  };
  const FILL_ROT = ['snare', 'toms', 'roll', 'flam'];
  /** drum instrument → channel bus */
  const DBUS = { kick: 'kick', snare: 'snare', rim: 'snare', clap: 'clap', hat: 'hat', ohat: 'hat', shaker: 'hat',
    tomH: 'tom', tomM: 'tom', tomL: 'tom', crash: 'cym', timp: 'perc', block: 'perc' };
  const vel = (ch) => (ch === 'X' ? 1 : ch === 'x' ? 0.75 : ch === 'o' ? 0.4 : (ch >= '1' && ch <= '9') ? (+ch) / 10 : 0);

  // =====================================================================================================
  // The soundtrack. Melodies are composed in C (or A minor); `tr` transposes the whole song.
  // =====================================================================================================
  const MEL = {
    // the Pixel Touchdown anthem hook (title + Pixel Bowl)
    anthemA: 'g4 c5 e5 g5:6 e5 g5 | a5:4 g5 d5:6 b4 d5 | c5 e5 a5:4 g5 e5 c5:4 | d5 c5 a4:4 c5:8 | ' +
      'g4 c5 e5 g5:6 e5 g5 | b5:4 a5 g5:6 d5 g5 | a5 g5 f5 a5 g5 f5 d5 b4 | c5:12 r:4',
    anthemB: 'a4:4 c5:4 f5:4 e5:4 | d5:6 b4 d5:4 g5:4 | g5:4 e5:4 b4:4 e5:4 | c5:6 b4 a4:8 | ' +
      'f5:4 e5 d5 a5:4 f5:4 | g5:6 f5 d5:4 b4:4 | e5:4 g5:4 a5:4 c6:4 | b5:4 a5 b5 d6:8'
  };
  const ANTHEM_A = 'C | G | Am | F | C | G | F G | C', ANTHEM_B = 'F | G | Em | Am | Dm | G | C/E F | G';

  const SONGS = {
    // (a) Title: big stadium anthem, D major, 138 BPM
    title: {
      bpm: 138, tr: 2, echo: 3, gain: 0.95,
      patch: { lead: 'lead', lead2: 'counter', arp: 'arp', bass: 'chipBass', pad: 'brassPad', stab: 'stab' },
      mel: { C: 'e5:8 d5:4 c5:4 | c5:8 a4:8 | g4:4 c5:4 e5:4 g5:4 | f5:8 d5:8 | e5:8 a5:4 g5:4 | f5:4 e5:4 c5:4 a4:4 | d5:4 f5:4 a5:4 d6:4 | b5:8 d6:8' },
      sec: {
        I: { ch: 'C | F | Am | G', pad: 'hold', bass: 'whole', drums: 'march', fillName: 'build', dyn: 0.85 },
        A: { ch: ANTHEM_A, lead: 'anthemA', bass: 'oct8', pad: 'anthem', drums: 'anthem' },
        A2: { from: 'A', lead2: 'harm', arp: 'up16' },
        B: { ch: ANTHEM_B, lead: 'anthemB', bass: 'root8', pad: 'hold', stab: 'stab', arp: 'updown16', drums: 'rock' },
        B2: { from: 'B', lead2: 'harm', drums: 'anthem' },
        A3: { from: 'A', leadOct: 12, lead2: 'oct', arp: 'updown16', stab: 'charleston' },
        C: { ch: 'Am | F | C | G | Am | F | Dm | G', lead: 'C', bass: 'whole', pad: 'hold', arp: 'alb8', drums: 'half', fillName: 'build' }
      },
      form: ['I', 'A', 'A2', 'B', 'A3', 'C', 'B2', 'A3'], loop: 1
    },
    // (b) HQ overworld 1: sunny ukulele + marimba, F major, 104 BPM swung; chains into hq2
    hq: {
      bpm: 104, tr: 5, swing: 0.16, echo: 3, gain: 1.05, fill: 'soft', crash: false, chain: 'hq2',
      patch: { lead: 'marimba', lead2: 'marimba', arp: 'bellArp', bass: 'pluckBass', pad: 'uke', stab: 'epiano' },
      mel: {
        A: 'e5 g5 r:1 e5:1 d5 c5 d5 e5:4 | r c5 e5 a5:3 g5:3 e5:4 | f5 a5 r:1 f5:1 e5 d5 e5 f5:4 | g5:3 f5:3 d5 b4:4 r:4 | ' +
          'e5 g5 r:1 e5:1 d5 c5 d5 e5:4 | r c5 e5 a5:3 b5:3 c6:4 | a5 g5 f5 e5 d5 c5 a4 c5 | d5:6 b4 g4:4 r:4',
        B: 'a5:4 g5 e5 c5:4 a4:4 | g4 b4 d5 g5:6 e5:4 | f5:4 e5 d5 c5:4 a4:4 | b4:6 d5 g5:8 | ' +
          'a5 c6 a5 g5 a5:4 e5:4 | g5:4 e5:4 c#5:4 e5:4 | f5:3 e5:3 d5 a5:8 | g5:4 f5:4 d5:4 b4:4',
        C: 'c6:8 a5:8 | ab5:8 f5:8 | g5:8 e5:4 d5:4 | c#5:8 e5:8 | f5:8 a5:4 f5:4 | ab5:8 g5:4 f5:4 | e5:4 d5:4 c#5:4 a4:4 | a4:8 b4:4 d5:4'
      },
      sec: {
        I: { ch: 'Cmaj7 | G7', pad: 'strum', bass: 'half', drums: 'chillLite' },
        A: { ch: 'Cmaj7 | Am7 | Dm7 | G7 | Cmaj7 | Am7 | Dm7 | G7', lead: 'A', pad: 'strum', bass: 'bounce', drums: 'chill' },
        A2: { from: 'A', lead2: 'harm', arp: 'up8', drums: 'chill2' },
        B: { ch: 'Fmaj7 | Em7 | Dm7 | G7 | Fmaj7 | Em7 A7 | Dm7 | G7sus G7', lead: 'B', patch: { lead: 'whistle' }, pad: 'strum2', bass: 'walk', drums: 'chill2' },
        C: { ch: 'Fmaj7 | Fm6 | Em7 | A7 | Dm7 | Fm6 | Em7 A7 | Dm7 G7', lead: 'C', patch: { lead: 'bell' }, stab: 'hold', bass: 'half', arp: 'up8', drums: 'chillLite' }
      },
      form: ['I', 'A', 'A2', 'B', 'C', 'A2'], loop: 1
    },
    // (b) HQ overworld 2: lazy lo-fi shuffle, G major, 94 BPM; chains back into hq
    hq2: {
      bpm: 94, tr: -5, swing: 0.2, echo: 3, gain: 0.8, fill: 'soft', crash: false, chain: 'hq',
      patch: { lead: 'softLead', lead2: 'counter', arp: 'pizz', bass: 'bassTri', pad: 'epiano' },
      mel: {
        A: 'g4 c5 e5 g5:4 e5 c5:4 | b4 d5 g#5:4 b5:4 g#5:4 | a5:6 e5 c5:4 a4:4 | bb4:4 c5 e5 g5:4 bb5:4 | ' +
          'a5:3 g5:3 f5 c5:4 a4:4 | ab4:4 c5:4 f5:4 ab5:4 | g5:6 e5 c5:8 | d5:4 f5:4 b4:4 g4:4',
        B: 'f5 e5 d5 c5 a4:4 d5:4 | b4:4 d5:4 f5:4 g5:4 | g5 f5 e5 d5 b4:4 e5:4 | c5:4 e5:4 g5:4 a5:4 | ' +
          'a5 g5 f5 e5 d5:4 f5:4 | g5:6 b4 d5:4 f5:4 | e5:4 g5:4 c6:8 | r:16'
      },
      sec: {
        I: { ch: 'C | G7', pad: 'keys', bass: 'half', drums: 'lofiLite' },
        A: { ch: 'C | E7 | Am | C7 | F | Fm | C/G | G7', lead: 'A', pad: 'keys', bass: 'walk', drums: 'lofi' },
        B: { ch: 'Dm7 | G7 | Em7 | Am7 | Dm7 | G7 | C | G7sus G7', lead: 'B', lead2: 'harm', pad: 'keys', bass: 'walk', drums: 'lofi' },
        A2: { from: 'A', lead2: 'harm', patch: { lead: 'whistle' }, arp: 'alb16' },
        B2: { from: 'B', patch: { lead: 'bell', lead2: 'bell' }, arp: 'up16', drums: 'lofi2' }
      },
      form: ['I', 'A', 'B', 'A2', 'B2'], loop: 1
    },
    // (c) In-game bed: stadium stomp-clap, A minor, 116 BPM; layers rise with intensity
    game: {
      bpm: 116, tr: 0, echo: 3, gain: 0.9,
      patch: { lead: 'brass', lead2: 'counter', arp: 'arp', bass: 'chipBass', pad: 'strings', stab: 'stab' },
      layers: { kick: 0.08, clap: 0.08, perc: 0.08, hat: 0.3, tom: 0.3, cym: 0.3, arp: 0.42, stab: 0.5, snare: 0.55, lead: 0.7, lead2: 0.85 },
      mel: {
        A: 'a4:3 a4:3 c5 e5:4 d5 c5 | c5:3 c5:3 a4 f4:4 a4:4 | g4:3 g4:3 c5 e5:4 g5:4 | f5:4 e5 d5 b4:8 | ' +
          'a4:3 a4:3 c5 e5:4 d5 c5 | c5:3 c5:3 a4 f4:4 a4:4 | g4:3 g4:3 c5 e5:4 g5:4 | d5:4 e5:4 g5:4 b5:4',
        B: 'd5:4 f5:4 a5:6 g5 | e5:8 c5:4 a4:4 | f5:4 e5 d5 c5:4 a4:4 | g#4:4 b4:4 e5:8 | ' +
          'd5:4 f5:4 a5:4 d6:4 | c6:6 b5 a5:8 | a5:4 g5 f5 e5:4 d5:4 | e5:4 g#5:4 b5:4 e6:4',
        C: 'a4:8 b4:8 | c5:12 e5:4 | a4:8 b4:8 | c5:16 | a4:8 b4:8 | c5:8 d5:8 | b4:8 g#4:8 | e5:16'
      },
      sec: {
        A: { ch: 'Am | F | C | G | Am | F | C | G', lead: 'A', pad: 'hold', bass: 'pump', arp: 'alb16', drums: 'stomp', drumsHi: 'stompHi', hiAt: 0.6 },
        A2: { from: 'A', lead2: 'harm', stab: 'stab', arp: 'up16' },
        B: { ch: 'Dm | Am | F | E | Dm | Am | F | E', lead: 'B', pad: 'hold', bass: 'root8', arp: 'updown16', drums: 'stomp', drumsHi: 'stompHi', hiAt: 0.6 },
        B2: { from: 'B', lead2: 'harm', stab: 'stab' },
        C: { ch: 'F | G | Am | Am | F | G | E | E', lead2: 'C', pad: 'hold', bass: 'pump', arp: 'up16', drums: 'stomp', drumsHi: 'stompHi', hiAt: 0.6, fillName: 'build' }
      },
      form: ['A', 'B', 'A2', 'C', 'B2', 'A2'], loop: 0
    },
    // (d) Draft Day / Market: ticking-clock suspense → game-show reveal, D minor, 112 BPM
    draft: {
      bpm: 112, tr: 0, echo: 3, gain: 1,
      patch: { lead: 'lead', lead2: 'counter', arp: 'pizz', bass: 'pluckBass', pad: 'pad', stab: 'organ' },
      mel: {
        A: 'd5 r a4 d5 e5 f5:4 e5 | d5:4 c5 a4 r:4 a4 c5 | d5 r f5 d5 bb5:4 a5 g5 | a5:6 c#5 e5:4 a4:4 | ' +
          'd5 r a4 d5 e5 f5:4 e5 | f5:4 g5 a5 r:4 c6:4 | d6:4 c6 bb5 a5:4 g5:4 | a5:4 g5 f5 e5:4 c#5:4',
        B: 'c5 f5 a5:4 g5 f5 c5:4 | e5 g5 c6:4 bb5 g5 e5:4 | bb5:4 a5 g5 f5:4 d5:4 | e5:4 g5:4 c#6:8 | ' +
          'd6:4 bb5:4 f5:4 d5:4 | c6:4 a5:4 f5:4 c5:4 | d5 f5 bb5:4 a5 g5 f5:4 | e5:6 d5 c#5:8',
        C: 'r:16 | r:16 | r:16 | r:16 | g5:8 bb5:8 | eb6:16 | c#6:8 e6:8 | a5:16'
      },
      sec: {
        I: { ch: 'Dm | Dm/C | Bb | A', pad: 'hold', bass: 'ostinato', drums: 'tick', fillName: 'build' },
        A: { ch: 'Dm | Dm/C | Bb | A | Dm | Dm/C | Bb | A7', lead: 'A', pad: 'hold', bass: 'ostinato', arp: 'alb8', drums: 'suspense' },
        B: { ch: 'F | C7 | Gm7 | A7 | Bb | F/A | Gm7 | A7sus A7', lead: 'B', stab: 'stab', bass: 'oct8', arp: 'up16', drums: 'show' },
        A2: { from: 'A', lead2: 'harm', arp: 'up16', drums: 'show' },
        C: { ch: 'Gm | Gm | Dm | Dm | Eb | Eb | A | A', lead: 'C', pad: 'hold', bass: 'ostinato', arp: 'updown16', drums: 'suspense', fillName: 'build' },
        B2: { from: 'B', lead2: 'harm' }
      },
      form: ['I', 'A', 'B', 'A2', 'C', 'B2'], loop: 1
    },
    // (e) Playoffs: driving and dramatic, G minor, 148 BPM
    playoffs: {
      bpm: 148, tr: -2, echo: 3, gain: 0.78,
      patch: { lead: 'brass', lead2: 'lead', arp: 'arp', bass: 'chipBass', pad: 'strings', stab: 'stab' },
      mel: {
        A: 'e5:6 a5:6 b5 c6 | c6:4 b5:4 a5:4 f5:4 | g5:6 c6:6 d6 e6 | d6:8 b5:4 g5:4 | ' +
          'a5:6 e5:6 a5 b5 | c6:6 a5:6 c6 d6 | f6:4 e6:4 d6:4 c6:4 | b5:8 g#5:8',
        B: 'a5 a5 c6:4 a5 a5 f5:4 | g5 g5 b5:4 g5 g5 d5:4 | e5 a5 c6 e6:6 d6 c6 | b5:8 a5:8 | ' +
          'a5 a5 c6:4 a5 a5 f5:4 | b5 b5 d6:4 b5 b5 g5:4 | a5:8 b5:8 | g#5:4 b5:4 e6:8',
        C: 'd5:8 f5:8 | e5:12 c5:4 | d5:8 a5:8 | g#5:16 | a5:8 c6:8 | g5:8 e5:8 | f5:8 a5:4 d6:4 | b5:8 g#5:8'
      },
      sec: {
        I: { ch: 'Am | Am | F | E', pad: 'hold', bass: 'gallop', drums: 'toms', fillName: 'build' },
        A: { ch: 'Am | F | C | G | Am | F | Dm | E', lead: 'A', pad: 'hold', bass: 'gallop', stab: 'anthem', drums: 'epic' },
        B: { ch: 'F | G | Am | Am | F | G | Esus4 | E', lead: 'B', pad: 'hold', bass: 'root8', arp: 'up16', stab: 'stab', drums: 'epic' },
        A2: { from: 'A', lead2: 'oct', arp: 'updown16' },
        C: { ch: 'Dm | Am | Dm | E | F | C | Dm | E', lead: 'C', patch: { lead: 'lead' }, pad: 'hold', bass: 'whole', arp: 'alb8', drums: 'epicHalf', fillName: 'build' },
        B2: { from: 'B', lead2: 'harm' }
      },
      form: ['I', 'A', 'B', 'A2', 'C', 'B2', 'A2'], loop: 1
    },
    // (f) Victory: brass fanfare sting, then a disco party loop, Eb major, 128 BPM
    victory: {
      bpm: 128, tr: 3, echo: 3, gain: 0.9,
      patch: { lead: 'lead', lead2: 'counter', arp: 'arp', bass: 'chipBass', pad: 'brassPad', stab: 'stab' },
      mel: {
        F: 'g4 g4:1 g4:1 c5:4 e5 e5:1 e5:1 g5:4 | a5:4 f5:4 b5:4 g5:4 | c6:16',
        A: 'a5 r a5 g5 a5 c6:4 a5 | g5 r g5 f5 g5 b5:4 g5 | e5 g5 b5 e6:4 d6 b5:4 | c6:6 b5 a5:8 | ' +
          'f5 a5 d6:4 c6 a5 f5:4 | g5 b5 d6:4 f6:4 d6:4 | e6:6 d6 c6:4 g5:4 | c6:4 r:4 g5 a5 b5:4',
        B: 'c6:4 b5 a5 e5:8 | g5:4 f5 e5 b4:8 | a5:4 g5 f5 c5:4 f5:4 | e5:4 g5:4 c6:8 | ' +
          'd6:4 c6 a5 f5:8 | e5:4 g5:4 b5:8 | a5 b5 c6 d6 c6:4 a5:4 | b5:8 d6:8'
      },
      sec: {
        F: { ch: 'C | F G | C', lead: 'F', patch: { lead: 'brass', lead2: 'brass' }, lead2: 'harm', pad: 'hold', bass: 'whole', drums: 'fanfare', fill: false, crash: false },
        A: { ch: 'F | G | Em | Am | Dm | G | C | C', lead: 'A', bass: 'oct8', stab: 'stab', drums: 'disco' },
        B: { ch: 'Am | Em | F | C | Dm | Em | F | G', lead: 'B', bass: 'funk', pad: 'hold', arp: 'up16', drums: 'disco' },
        A2: { from: 'A', lead2: 'harm', arp: 'updown16' },
        B2: { from: 'B', lead2: 'harm', stab: 'stab' }
      },
      form: ['F', 'A', 'B', 'A2', 'B2'], loop: 1
    },
    // (f) Pixel Bowl champions: the title anthem as a majestic Bb-major victory lap + a new trio, 112 BPM
    champion: {
      bpm: 112, tr: -2, echo: 3, gain: 0.9,
      patch: { lead: 'brass', lead2: 'lead', arp: 'bellArp', bass: 'chipBass', pad: 'strings', stab: 'brassPad' },
      mel: {
        F: 'c5:4 e5:4 g5:4 c6:4 | a5:6 f5 c6:8 | b5:4 d6:4 g5:4 b5:4 | c6:16',
        D: 'c6:8 a5:4 f5:4 | g5:8 e5:4 c5:4 | f5:4 e5:4 d5:4 a5:4 | g5:16 | a5:4 c6:4 f6:8 | d6:6 c6 b5:8 | c6:16 | r:16'
      },
      sec: {
        F: { ch: 'C | F | G | C', lead: 'F', lead2: 'harm', pad: 'hold', bass: 'whole', drums: 'bowlIntro', fill: false, crash: false },
        A: { ch: ANTHEM_A, lead: 'anthemA', pad: 'hold', stab: 'anthem', bass: 'anthem', drums: 'bowl' },
        B: { ch: ANTHEM_B, lead: 'anthemB', pad: 'hold', bass: 'root8', arp: 'up8', drums: 'bowl' },
        D: { ch: 'F | C/E | Dm | C | F | G | C | C', lead: 'D', lead2: 'harm', pad: 'hold', stab: 'stab', bass: 'oct8', arp: 'up16', drums: 'anthem' },
        A3: { from: 'A', leadOct: 12, lead2: 'oct', arp: 'up16', drums: 'anthem' }
      },
      form: ['F', 'A', 'B', 'D', 'A3'], loop: 1
    },
    // (g) Defeat: a short, gentle sad sting; then a bar of air and the chill HQ2 loop
    defeat: {
      bpm: 72, tr: 0, echo: 2, gain: 1.2, chain: 'hq2',
      patch: { lead: 'softLead', lead2: 'counter', bass: 'bassTri', pad: 'padSoft' },
      mel: { S: 'e5:4 d5:4 c5:4 b4:4 | a4:4 c5:4 b4:2 a4:2 g#4:4 | a4:16' },
      sec: {
        S: { ch: 'Am | F E | Am', lead: 'S', lead2: 'harm', pad: 'hold', bass: 'whole', drums: 'sad', fill: false, crash: false },
        R: { ch: 'Am' }
      },
      form: ['S', 'R'], loop: null
    }
  };
  // Short jingles (no loop). follow: transpose to the playing song's key so they sit on top of it.
  const STINGS = {
    td: { bpm: 150, follow: true, gain: 0.9, patch: { lead: 'brass', lead2: 'brass', bass: 'chipBass', stab: 'stab' },
      sec: { S: { ch: 'C | C', lead: 'g4:1 c5:1 e5:1 g5:1 c6:4 b5:2 c6:2 d6:4 | e6:12 r:4', lead2: 'harm', stab: 'hit', bass: 'whole', drums: 'tdHit', fill: false, crash: false } }, form: ['S'] },
    levelUp: { bpm: 160, follow: true, gain: 2, patch: { lead: 'lead', lead2: 'counter' },
      sec: { S: { ch: 'C', lead: 'c5:1 e5:1 g5:1 c6:1 e5:1 g5:1 c6:1 e6:1 g6:8', lead2: 'oct' } }, form: ['S'] },
    achievement: { bpm: 120, follow: true, gain: 1.8, patch: { lead: 'bell', lead2: 'bell', pad: 'padSoft' },
      sec: { S: { ch: 'C', lead: 'g5:2 c6:2 e6:2 g6:10', lead2: 'harm', pad: 'hold' } }, form: ['S'] },
    coin: { bpm: 150, follow: true, gain: 3, patch: { lead: 'coin' }, sec: { S: { ch: 'C', lead: 'b5:1 e6:6 r:9' } }, form: ['S'] },
    newSeason: { bpm: 132, follow: false, tr: 2, patch: { lead: 'lead', lead2: 'counter', bass: 'chipBass', pad: 'brassPad' },
      sec: { S: { ch: 'F | G | C', lead: 'c5 d5 e5 g5 a5 g5 e5 g5 | b4 d5 g5 b5 a5 g5 d5 b4 | c6:16', lead2: 'harm', bass: 'oct8', pad: 'hold', drums: 'season', fill: false, crash: false } }, form: ['S'] },
    win: Object.assign({}, SONGS.victory, { form: ['F'], loop: null, follow: false }),
    lose: Object.assign({}, SONGS.defeat, { form: ['S'], loop: null, chain: null, follow: false })
  };

  // =====================================================================================================
  // Compiler: song data → per-step event lists
  // =====================================================================================================
  const compiled = {};
  function resolveSec(def, key, seen) {
    const s = def.sec[key];
    if (!s) { warn(key + ': missing section'); return { ch: 'C' }; }
    if (!s.from || (seen && seen[key])) return s;
    const base = resolveSec(def, s.from, Object.assign({}, seen, { [key]: 1 }));
    const out = Object.assign({}, base, s);
    out.patch = Object.assign({}, base.patch, s.patch);
    return out;
  }
  function get(name) {
    if (compiled[name]) return compiled[name];
    const def = SONGS[name] || STINGS[name];
    if (!def) return null;
    const song = compiled[name] = { name: name, bpm: def.bpm, stepDur: 60 / def.bpm / 4, tr: def.tr || 0, swing: def.swing || 0,
      gain: def.gain || 1, echo: def.echo || 3, layers: def.layers || null, chain: def.chain || null, follow: !!def.follow,
      ev: [], len: 0, loop: null, bars: 0, chans: {}, secs: [] };
    const st = {};                                   // voicing memory per channel
    let base = 0;
    def.form.forEach((key, fi) => {
      if (def.loop === fi) song.loop = base;
      const sec = resolveSec(def, key);
      const nb = compileSection(song, def, sec, key, base, st, def.form[fi + 1] ? resolveSec(def, def.form[fi + 1]) : null);
      song.secs.push({ key: key, at: base, bars: nb });
      base += nb * 16;
    });
    song.len = base; song.bars = base / 16;
    return song;
  }
  function compileSection(song, def, sec, key, base, st, nextSec) {
    const tag = song.name + '.' + key;
    const bars = parseChords(sec.ch);
    const nb = bars.length;
    const total = nb * 16;
    const nextChord = nextSec ? parseChords(nextSec.ch)[0][0].c : bars[0][0].c;
    const P = (ch) => {
      const n = (sec.patch && sec.patch[ch]) || def.patch[ch];
      if (!PATCH[n]) warn(tag + ': no patch for ' + ch);
      return PATCH[n] || PATCH.lead;
    };
    const dyn = sec.dyn || 1;
    const add = (s, e) => {
      if (s < 0 || s >= total) return;
      const g = base + s;
      (song.ev[g] || (song.ev[g] = [])).push(e);
      song.chans[e.c] = 1;
    };
    const segAt = (s) => { const b = bars[Math.min(nb - 1, s >> 4)], r = s & 15; for (let i = 0; i < b.length; i++) if (r >= b[i].s0 && r < b[i].s1) return b[i]; return b[0]; };
    const melody = (ref, sub) => parseMel((def.mel && def.mel[ref]) || MEL[ref] || ref, tag + '.' + sub).filter((n) => n.s < total);
    const accent = (s) => 0.82 + (s % 16 === 0 ? 0.18 : s % 4 === 0 ? 0.1 : 0);

    // ---- lead + counter line ----
    let lead = [];
    if (sec.lead) {
      lead = melody(sec.lead, 'lead').map((n) => ({ s: n.s, d: n.d, n: n.n + (sec.leadOct || 0), sl: n.sl }));
      const p = P('lead');
      let prev = 0;
      lead.forEach((n) => { add(n.s, { c: 'lead', p: p, n: n.n, d: n.d, v: accent(n.s) * dyn, sl: n.sl ? prev : 0 }); prev = n.n; });
    }
    if (sec.lead2) {
      const p = P('lead2');
      let notes;
      if (sec.lead2 === 'harm') {
        notes = lead.map((n) => {
          const pcs = segAt(n.s).c.pcs;
          let h = n.n - 12;
          for (let m = n.n - 3; m >= n.n - 9; m--) if (pcs.indexOf(((m % 12) + 12) % 12) >= 0) { h = m; break; }
          return { s: n.s, d: n.d, n: h };
        });
      } else if (sec.lead2 === 'oct') notes = lead.map((n) => ({ s: n.s, d: n.d, n: n.n - 12 }));
      else notes = melody(sec.lead2, 'lead2');
      notes.forEach((n) => add(n.s, { c: 'lead2', p: p, n: n.n, d: n.d, v: accent(n.s) * 0.85 * dyn, sl: 0 }));
    }
    // ---- pad / stab ----
    ['pad', 'stab'].forEach((ch) => {
      if (!sec[ch]) return;
      const p = P(ch), sty = PADS[sec[ch]];
      if (!sty) { warn(tag + ': no pad style ' + sec[ch]); return; }
      bars.forEach((b, bi) => b.forEach((seg) => {
        const v = voicing(seg.c.pcs, p.lo || 55, p.hi || 76, st[ch]);
        st[ch] = v;
        const hits = sty === 'hold' ? [[seg.s0, seg.s1 - seg.s0, 1]] : sty.filter((h) => h[0] >= seg.s0 && h[0] < seg.s1);
        hits.forEach((h) => v.forEach((n, k) => add(bi * 16 + h[0], { c: ch, p: p, n: n, d: Math.min(h[1], seg.s1 - h[0]), v: h[2] * dyn, o: p.strum ? k * p.strum : 0 })));
      }));
    });
    // ---- bass ----
    if (sec.bass) {
      const p = P('bass'), sty = BASS[sec.bass], lo = p.lo || 36;
      if (!sty) warn(tag + ': no bass style ' + sec.bass);
      else bars.forEach((b, bi) => b.forEach((seg, si) => {
        const nx = si + 1 < b.length ? b[si + 1].c : bi + 1 < nb ? bars[bi + 1][0].c : nextChord;
        const c = seg.c, root = fit(c.bass, lo), r0 = fit(c.root, lo);
        const deg = (dg) => {
          const iv = (k, dflt) => (c.ints[k] != null ? c.ints[k] : dflt);
          if (dg === 'R') return root;
          if (dg === '8') return root + 12;
          if (dg === '5') return r0 + iv(2, 7);
          if (dg === '3') return r0 + iv(1, 4);
          if (dg === '7') return r0 + (c.ints[3] != null ? c.ints[3] : 12);
          if (dg === 'A') {
            const tgt = fit(nx.bass, lo);
            if (tgt % 12 === root % 12) return r0 + iv(2, 7);
            return tgt > root ? tgt - 1 : tgt + 1;
          }
          return root;
        };
        let any = false;
        sty.forEach((h) => {
          if (h[0] < seg.s0 || h[0] >= seg.s1) return;
          any = true;
          add(bi * 16 + h[0], { c: 'bass', p: p, n: h[0] === seg.s0 ? root : deg(h[1]), d: Math.min(h[2], seg.s1 - h[0]), v: (h[0] % 4 === 0 ? 1 : 0.82) * dyn });
        });
        if (!any || !sty.some((h) => h[0] === seg.s0)) add(bi * 16 + seg.s0, { c: 'bass', p: p, n: root, d: Math.min(2, seg.s1 - seg.s0), v: dyn });
      }));
    }
    // ---- arp ----
    if (sec.arp) {
      const m = /^([a-z]+)(8|16)$/.exec(sec.arp), p = P('arp');
      if (!m || !ARP[m[1]]) warn(tag + ': bad arp ' + sec.arp);
      else {
        const rate = m[2] === '8' ? 2 : 1;
        bars.forEach((b, bi) => b.forEach((seg) => {
          const v = voicing(seg.c.pcs, p.lo || 64, p.hi || 86, st.arp);
          st.arp = v;
          const seq = ARP[m[1]](v.concat([v[0] + 12]));
          for (let s = seg.s0, k = 0; s < seg.s1; s += rate, k++) add(bi * 16 + s, { c: 'arp', p: p, n: seq[k % seq.length], d: rate, v: (s % 4 === 0 ? 1 : 0.78) * dyn });
        }));
      }
    }
    // ---- drums ----
    if (sec.drums) {
      const gv = GROOVE[sec.drums];
      if (!gv) warn(tag + ': no groove ' + sec.drums);
      const fillOn = sec.fill !== false;
      const crashOn = sec.crash !== false && def.crash !== false;
      const drumBar = (pat, bi, from, to, gate) => {
        Object.keys(pat).forEach((inst) => {
          if (inst === 'from') return;
          const str = pat[inst], nbar = Math.max(1, str.length >> 4), sl = str.substr((bi % nbar) * 16, 16);
          for (let i = from; i < to; i++) {
            const v = vel(sl[i]);
            if (!v) continue;
            const e = { c: DBUS[inst] || 'perc', k: inst, v: v * dyn };
            if (inst === 'timp') { e.n = fit(segAt(bi * 16 + i).c.root, 41); e.tn = 1; }
            if (inst === 'block') e.n = i % 8 === 0 ? 84 : 79;
            if (gate) Object.assign(e, gate);
            add(bi * 16 + i, e);
          }
        });
      };
      for (let bi = 0; bi < nb; bi++) {
        const isFill = fillOn && ((bi + 1) % 8 === 0 || (bi === nb - 1 && nb >= 4));
        const fill = isFill ? FILL[sec.fillName || def.fill || FILL_ROT[hash(song.name, base + bi * 16) % FILL_ROT.length]] : null;
        const cut = fill ? fill.from : 16;
        if (gv) drumBar(gv, bi, 0, cut, sec.drumsHi ? { hi: sec.hiAt } : null);
        if (sec.drumsHi && GROOVE[sec.drumsHi]) drumBar(GROOVE[sec.drumsHi], bi, 0, cut, { lo: sec.hiAt });
        if (fill) drumBar(fill, bi, fill.from, 16, null);
        if (crashOn && bi % 8 === 0) add(bi * 16, { c: 'cym', k: 'crash', v: 0.85 * dyn });
      }
    }
    return nb;
  }

  // =====================================================================================================
  // Synthesis
  // =====================================================================================================
  function noiseBuf(c) {
    const n = c.sampleRate * 2, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function impulse(c, secs) {
    const sr = c.sampleRate, n = Math.floor(sr * secs), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n, k = 0.8 - 0.65 * x;           // the tail gets darker
        y += k * ((Math.random() * 2 - 1) - y);
        d[i] = i < sr * 0.012 ? 0 : y * Math.pow(1 - x, 2.4);
      }
    }
    return b;
  }
  function mkPulse(c, duty) {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return c.createPeriodicWave(re, im);
  }
  function setWave(R, o, w) {
    if (w === 'p12' || w === 'p25') o.setPeriodicWave(R.pw[w] || (R.pw[w] = mkPulse(R.ctx, w === 'p12' ? 0.125 : 0.25)));
    else o.type = w === 'p50' ? 'square' : (w || 'square');
  }
  /** One melodic note. p = patch, f = Hz, dur = seconds held, slideF = glide start (Hz) */
  function voice(R, out, p, t, f, dur, vel, slideF) {
    const c = R.ctx;
    const nU = p.uni || 1;
    const peak = (p.gain || 0.1) * vel / (nU > 1 ? Math.sqrt(nU) : 1);
    const a = Math.min(p.a || 0.005, Math.max(0.002, dur * 0.6));
    const tau = (p.d || 0.2) / 3, sus = p.s == null ? 0.7 : p.s, rel = p.r || 0.08;
    const tOff = t + Math.max(a + 0.004, dur * (p.leg || 0.9));
    const end = tOff + rel;
    const g = c.createGain(), G = g.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(peak, t + a);
    G.setTargetAtTime(peak * sus, t + a, tau);
    G.setValueAtTime(peak * sus + (peak - peak * sus) * Math.exp(-(tOff - t - a) / tau), tOff);
    G.linearRampToValueAtTime(0, end);
    g.connect(out);
    let head = g;
    if (p.lp) {
      const bq = c.createBiquadFilter();
      bq.type = 'lowpass'; bq.Q.value = p.q || 0.7;
      if (p.lpEnv) { bq.frequency.setValueAtTime(Math.min(p.lp + p.lpEnv, 18000), t); bq.frequency.setTargetAtTime(p.lp, t, p.lpT || 0.08); }
      else bq.frequency.value = p.lp;
      bq.connect(g); head = bq;
    }
    const srcs = [];
    let vg = null, mg = null;
    if (p.vib) {
      const l = c.createOscillator(); vg = c.createGain();
      l.frequency.value = p.vib.r;
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(0, t + (p.vib.dl || 0));
      vg.gain.linearRampToValueAtTime(p.vib.d, t + (p.vib.dl || 0) + 0.15);
      l.connect(vg); srcs.push(l);
    }
    if (p.fm) {
      const m = c.createOscillator(); mg = c.createGain();
      m.frequency.value = f * p.fm.ratio;
      const depth = f * p.fm.ratio * p.fm.idx;
      mg.gain.setValueAtTime(depth, t);
      mg.gain.setTargetAtTime(depth * (p.fm.min || 0), t, p.fm.t);
      m.connect(mg); srcs.push(m);
    }
    const osc = (w, det, gainK) => {
      const o = c.createOscillator();
      setWave(R, o, w);
      o.frequency.setValueAtTime(slideF || f, t);
      if (slideF) o.frequency.exponentialRampToValueAtTime(f, t + (p.glide || 0.06));
      if (det) o.detune.value = det;
      if (vg) vg.connect(o.detune);
      if (mg) mg.connect(o.frequency);
      if (gainK != null) { const sg = c.createGain(); sg.gain.value = gainK; o.connect(sg); sg.connect(head); } else o.connect(head);
      srcs.push(o);
    };
    for (let u = 0; u < nU; u++) osc(p.w, nU > 1 ? ((u / (nU - 1)) * 2 - 1) * (p.det || 8) : 0);
    if (p.sub) osc(p.sub.w, 0, p.sub.g);
    srcs.forEach((s) => { s.start(t); s.stop(end + 0.03); });
  }
  function nz(R, out, t, o) {
    const c = R.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = R.white;
    let node = src;
    if (o.f) { const bq = c.createBiquadFilter(); bq.type = o.type || 'highpass'; bq.frequency.value = o.f; bq.Q.value = o.q || 0.7; src.connect(bq); node = bq; }
    node.connect(g); g.connect(out);
    const a = o.a || 0.001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.d);
    src.start(t, Math.random() * 1.5); src.stop(t + a + o.d + 0.02);
  }
  function osc1(R, out, t, o) {
    const c = R.ctx, ox = c.createOscillator(), g = c.createGain(), a = o.a || 0.002;
    ox.type = o.w || 'sine';
    ox.frequency.setValueAtTime(o.f, t);
    if (o.f1) ox.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.d));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.v), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.d);
    ox.connect(g); g.connect(out); ox.start(t); ox.stop(t + a + o.d + 0.02);
  }
  function tom(f, pan) {
    return (R, out, t, v) => {
      let o = out;
      if (R.ctx.createStereoPanner) { const p = R.ctx.createStereoPanner(); p.pan.value = pan; p.connect(out); o = p; }
      osc1(R, o, t, { f: f, f1: f * 0.62, ft: 0.2, d: 0.3, v: v * 0.5 });
      nz(R, o, t, { type: 'lowpass', f: 1200, d: 0.04, v: v * 0.12 });
    };
  }
  const DRUM = {
    kick: (R, b, t, v) => { osc1(R, b, t, { f: 160, f1: 45, ft: 0.11, d: 0.32, v: v * 0.9 }); nz(R, b, t, { f: 2500, d: 0.012, v: v * 0.18 }); },
    snare: (R, b, t, v) => { nz(R, b, t, { f: 1400, d: 0.15, v: v * 0.42 }); osc1(R, b, t, { w: 'triangle', f: 220, f1: 160, d: 0.08, v: v * 0.38 }); },
    rim: (R, b, t, v) => { osc1(R, b, t, { w: 'triangle', f: 1700, d: 0.025, v: v * 0.22 }); nz(R, b, t, { type: 'bandpass', f: 2600, q: 2, d: 0.02, v: v * 0.2 }); },
    clap: (R, b, t, v) => {
      const c = R.ctx, src = c.createBufferSource(), bq = c.createBiquadFilter(), g = c.createGain(), G = g.gain, pk = v * 0.5;
      src.buffer = R.white; bq.type = 'bandpass'; bq.frequency.value = 1300; bq.Q.value = 1.1;
      src.connect(bq); bq.connect(g); g.connect(b);
      G.setValueAtTime(0.0001, t);
      [0, 0.011, 0.022].forEach((dt) => { G.setValueAtTime(pk, t + dt); G.exponentialRampToValueAtTime(pk * 0.15, t + dt + 0.009); });
      G.setValueAtTime(pk * 0.9, t + 0.032);
      G.exponentialRampToValueAtTime(0.0001, t + 0.2);
      src.start(t, Math.random()); src.stop(t + 0.22);
    },
    hat: (R, b, t, v) => nz(R, b, t, { f: 7500, d: 0.04, v: v * 0.26 }),
    ohat: (R, b, t, v) => nz(R, b, t, { f: 7000, d: 0.26, v: v * 0.13 }),
    shaker: (R, b, t, v) => nz(R, b, t, { type: 'bandpass', f: 6500, q: 1.2, a: 0.012, d: 0.05, v: v * 0.16 }),
    tomH: tom(220, 0.35), tomM: tom(160, 0), tomL: tom(115, -0.35),
    crash: (R, b, t, v) => { nz(R, b, t, { f: 4500, d: 1.6, v: v * 0.15 }); nz(R, b, t, { type: 'bandpass', f: 9500, q: 0.8, d: 0.5, v: v * 0.08 }); },
    timp: (R, b, t, v, n) => {
      const f = mtof(n);
      osc1(R, b, t, { f: f * 1.03, f1: f, ft: 0.08, a: 0.004, d: 1.1, v: v * 0.55 });
      osc1(R, b, t, { f: f * 1.5, d: 0.35, v: v * 0.12 });
      nz(R, b, t, { type: 'lowpass', f: 400, d: 0.08, v: v * 0.25 });
    },
    block: (R, b, t, v, n) => osc1(R, b, t, { f: mtof(n), d: 0.05, v: v * 0.25 })
  };

  // =====================================================================================================
  // Rig (per AudioContext): shared reverb + echo. Instances: one per playing song / stinger.
  // =====================================================================================================
  /** channel: [pan, reverb send, echo send] */
  const CHAN = { lead: [0, 0.18, 0.16], lead2: [0.28, 0.16, 0.1], arp: [-0.3, 0.12, 0.22], bass: [0, 0, 0], pad: [0, 0.3, 0],
    stab: [0.15, 0.18, 0], kick: [0, 0, 0], snare: [0.04, 0.16, 0], clap: [-0.06, 0.22, 0], hat: [0.22, 0.04, 0],
    tom: [0, 0.14, 0], cym: [-0.15, 0.12, 0], perc: [0, 0.2, 0.05] };
  function mkRig(c, dest) {
    const R = { ctx: c, out: c.createGain(), pw: {}, white: noiseBuf(c) };
    R.out.connect(dest);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
    const cv = c.createConvolver(); cv.buffer = impulse(c, 1.7);
    const rg = c.createGain(); rg.gain.value = 0.55;
    hp.connect(cv); cv.connect(rg); rg.connect(R.out);
    R.rev = hp;
    const dl = c.createDelay(1.5), fb = c.createGain(), lp = c.createBiquadFilter(), eg = c.createGain();
    dl.delayTime.value = 0.33; fb.gain.value = 0.3; lp.type = 'lowpass'; lp.frequency.value = 2600; eg.gain.value = 0.45;
    R.echo = c.createGain();
    R.echo.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eg); eg.connect(R.out);
    R.delay = dl;
    return R;
  }
  function mkInst(R, name, o) {
    const c = R.ctx, song = get(name);
    const I = { R: R, name: name, song: song, step: o.step || 0, nextT: 0, tr: o.tr || 0, ch: {}, sting: !!o.sting,
      fixInt: o.intensity, solo: o.solo || null, dieAt: 0, done: false };
    I.mix = c.createGain(); I.duck = c.createGain(); I.out = c.createGain();
    I.rv = c.createGain(); I.ec = c.createGain(); I.wr = c.createGain(); I.we = c.createGain();
    I.mix.gain.value = song.gain; I.rv.gain.value = song.gain; I.ec.gain.value = song.gain;
    I.mix.connect(I.duck); I.duck.connect(I.out); I.out.connect(R.out);
    I.rv.connect(I.wr); I.wr.connect(R.rev); I.ec.connect(I.we); I.we.connect(R.echo);
    return I;
  }
  const fadeParams = (I) => [I.out.gain, I.wr.gain, I.we.gain];
  function fadeIn(I, t, secs) {
    fadeParams(I).forEach((p) => { p.cancelScheduledValues(t); if (secs > 0.03) { p.setValueAtTime(0.0001, t); p.linearRampToValueAtTime(1, t + secs); } else p.setValueAtTime(1, t); });
  }
  function fadeOut(I, t, secs) {
    fadeParams(I).forEach((p) => { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + secs); });
    I.dieAt = t + secs + 0.05;
  }
  function intensityOf(I) { return I.fixInt != null ? I.fixInt : intensity; }
  function chan(I, name) {
    let b = I.ch[name];
    if (b) return b;
    const c = I.R.ctx, cf = CHAN[name] || [0, 0.1, 0];
    const g = c.createGain();
    const L = I.song.layers, on = !L || L[name] == null || intensityOf(I) >= L[name];
    g.gain.value = on ? 1 : 0;
    let tail = g;
    if (cf[0] && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = cf[0]; g.connect(p); tail = p; }
    tail.connect(I.mix);
    if (cf[1]) { const s = c.createGain(); s.gain.value = cf[1]; tail.connect(s); s.connect(I.rv); }
    if (cf[2]) { const s = c.createGain(); s.gain.value = cf[2]; tail.connect(s); s.connect(I.ec); }
    b = I.ch[name] = { g: g, on: on, offAt: on ? 0 : -99 };
    return b;
  }
  /** layer gate: fade a channel in/out when the intensity crosses its threshold; false = skip scheduling */
  function gate(I, b, name, x) {
    const L = I.song.layers;
    if (!L || L[name] == null) return true;
    const on = x >= L[name];
    if (on !== b.on) {
      b.on = on;
      const t = I.R.ctx.currentTime, p = b.g.gain;
      p.cancelScheduledValues(t); p.setTargetAtTime(on ? 1 : 0, t, on ? 0.2 : 0.5);
      if (!on) b.offAt = I.nextT;
    }
    return on || I.nextT - b.offAt < 2.5;
  }
  function setEcho(I) {
    const p = I.R.delay.delayTime, t = I.R.ctx.currentTime;
    p.cancelScheduledValues(t); p.setTargetAtTime(Math.min(1.4, I.song.echo * I.song.stepDur), t, 0.05);
  }
  function switchSong(I, name) {
    const s = get(name);
    if (!s) return false;
    I.song = s; I.step = 0;
    const t = Math.max(I.R.ctx.currentTime, I.nextT - 0.01);
    [I.mix.gain, I.rv.gain, I.ec.gain].forEach((p) => p.setValueAtTime(s.gain, t));
    Object.keys(I.ch).forEach((k) => { const b = I.ch[k], L = s.layers, on = !L || L[k] == null || intensityOf(I) >= L[k]; b.on = on; b.g.gain.setValueAtTime(on ? 1 : 0, t); });
    if (I === main) setEcho(I);
    return true;
  }
  function playEv(I, e, t) {
    const tr = I.song.tr + I.tr;
    const b = chan(I, e.c);
    if (e.k) DRUM[e.k](I.R, b.g, t, e.v, e.n ? e.n + (e.tn ? tr : 0) : 0);
    else voice(I.R, b.g, e.p, t + (e.o || 0), mtof(e.n + tr), e.d * I.song.stepDur, e.v, e.sl ? mtof(e.sl + tr) : 0);
  }
  /** schedule I's events until `until` (AudioContext seconds) */
  function pump(I, until, silent) {
    while (I.nextT < until && !I.done) {
      let s = I.song;
      if (I.step >= s.len) {
        if (I.sting) { I.done = true; break; }
        if (s.loop != null) I.step = s.loop;
        else if (!(s.chain && switchSong(I, s.chain))) { I.done = true; break; }
        s = I.song;
      }
      const i = I.step, list = s.ev[i];
      if (list && !silent) {
        const t = I.nextT + (s.swing && (i & 1) ? s.swing * s.stepDur : 0), x = intensityOf(I);
        for (let k = 0; k < list.length; k++) {
          const e = list[k];
          if ((e.lo != null && x < e.lo) || (e.hi != null && x >= e.hi)) continue;
          if (I.solo && e.c !== I.solo) continue;
          if (!gate(I, chan(I, e.c), e.c, x)) continue;
          playEv(I, e, t);
        }
      }
      I.nextT += s.stepDur;
      I.step++;
    }
  }

  // =====================================================================================================
  // Live player
  // =====================================================================================================
  let live = null, main = null, timer = null, intensity = 0;
  const insts = [];
  function liveRig() {
    const h = Audio._h, c = h && h.ctx;
    if (!c) return null;
    if (!live || live.ctx !== c) { live = mkRig(c, h.musicOut); insts.length = 0; main = null; }
    return live;
  }
  function silentNow() { const a = Audio._a; return !!(a && (a.muted || a.vol.music <= 0.001)); }
  function retire(I) {
    setTimeout(() => { [I.out, I.wr, I.we].forEach((n) => { try { n.disconnect(); } catch (e) { /* gone */ } }); }, 3000);
  }
  function tick() {
    const R = live;
    if (!R || !insts.length) { stopTimer(); return; }
    const c = R.ctx;
    if (c.state !== 'running') return;
    const now = c.currentTime, silent = silentNow();
    for (let i = insts.length - 1; i >= 0; i--) {
      const I = insts[i];
      if (I.dieAt && now > I.dieAt) { insts.splice(i, 1); retire(I); if (main === I) main = null; continue; }
      if (I.nextT < now - 0.25) I.nextT = now + 0.03;      // stalled (tab hidden / long frame): resync
      try { pump(I, now + LOOK, silent); } catch (e) { I.done = true; warn('pump ' + (e && e.message)); }
      if (I.done) { insts.splice(i, 1); retire(I); if (main === I) main = null; }
    }
  }
  function startTimer() { if (!timer) timer = setInterval(tick, TICK); }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }
  function keyOf(I) { if (!I) return 0; const k = ((I.song.tr % 12) + 12) % 12; return k > 6 ? k - 12 : k; }

  Audio.Music = {
    /**
     * Play a song, crossfading from the current one. @param {string} name @param {{fade?:number, fadeIn?:number}} [o]
     * @returns {boolean}
     */
    play: function (name, o) {
      o = o || {};
      if (!SONGS[name]) return false;
      const R = liveRig();
      if (!R) return false;
      if (main && main.name === name && !main.dieAt) return true;
      const now = R.ctx.currentTime;
      const fade = Math.min(1, o.fade == null ? XFADE : o.fade);
      const had = !!main;
      if (main) fadeOut(main, now, fade);
      const I = mkInst(R, name, {});
      I.nextT = now + 0.05;
      fadeIn(I, now, o.fadeIn != null ? o.fadeIn : had ? fade * 0.6 : 0.3);
      main = I;
      setEcho(I);
      insts.push(I);
      startTimer();
      tick();
      return true;
    },
    /** fade the current song out (≤ 1 s) */
    stop: function (o) {
      if (main && live) fadeOut(main, live.ctx.currentTime, Math.min(1, (o && o.fade) || 0.6));
      main = null;
    },
    /** requested song name (what play() was called with) */
    current: function () { return main && !main.dieAt ? main.name : null; },
    /** song actually sounding (after chains, e.g. defeat → hq2) */
    playing: function () { return main && !main.dieAt ? main.song.name : null; },
    /** 0..1 — game bed layers + hot grooves */
    setIntensity: function (x) { intensity = Math.max(0, Math.min(1, +x || 0)); },
    intensity: function () { return intensity; },
    /**
     * One-shot jingle over the music (ducks the song). @param {string} name td|levelUp|achievement|coin|newSeason|win|lose
     * @returns {number} length in seconds (0 if it did not play)
     */
    sting: function (name, o) {
      o = o || {};
      if (!STINGS[name]) return 0;
      const R = liveRig();
      if (!R || silentNow()) return 0;
      const s = get(name);
      const I = mkInst(R, name, { sting: true, tr: o.tr != null ? o.tr : s.follow ? keyOf(main) : 0 });
      const now = R.ctx.currentTime;
      I.nextT = now + 0.02;
      fadeIn(I, now, 0);
      insts.push(I);
      startTimer();
      tick();
      const len = s.len * s.stepDur;
      Audio.Music.duckFor(o.duck == null ? 0.3 : o.duck, len + 0.2);
      return len;
    },
    /** duck the songs (not stingers) to `depth` for `secs`, then recover */
    duckFor: function (depth, secs) {
      if (!live) return;
      const now = live.ctx.currentTime;
      insts.forEach((I) => {
        if (I.sting || I.dieAt) return;
        const p = I.duck.gain;
        p.cancelScheduledValues(now); p.setTargetAtTime(depth, now, 0.03); p.setTargetAtTime(1, now + secs, 0.3);
      });
    },
    list: function () { return Object.keys(SONGS); },
    stings: function () { return Object.keys(STINGS); },
    /** full song length in seconds (intro + body, before it loops/chains) */
    length: function (name) { const s = get(name); return s ? s.len * s.stepDur : 0; },
    info: function (name) {
      const s = get(name);
      return s ? { bpm: s.bpm, bars: s.bars, secs: s.len * s.stepDur, loopAt: s.loop == null ? null : s.loop * s.stepDur,
        chain: s.chain, chans: Object.keys(s.chans), secs_: s.secs.map((x) => x.key + ':' + x.bars) } : null;
    },
    /**
     * Offline render for tests/dev. o: {from (step), intensity, solo (channel), gain, raw (skip master chain), sr}
     * @returns {Promise<AudioBuffer>}
     */
    render: function (name, secs, o) {
      o = o || {};
      const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      const s = get(name);
      if (!OAC || !s) return Promise.reject(new Error('cannot render ' + name));
      const sr = o.sr || 44100, c = new OAC(2, Math.ceil(sr * secs), sr);
      const head = c.createGain();
      head.gain.value = o.gain == null ? 1 : o.gain;
      if (o.raw || !Audio._mkMaster) head.connect(c.destination);
      else { const m = Audio._mkMaster(c); head.connect(m.input); m.output.connect(c.destination); }
      const R = mkRig(c, head);
      const I = mkInst(R, name, { intensity: o.intensity == null ? 0.5 : o.intensity, step: o.from || 0, solo: o.solo, sting: !!STINGS[name] && !SONGS[name], tr: o.tr || 0 });
      I.nextT = 0.02;
      R.delay.delayTime.value = Math.min(1.4, s.echo * s.stepDur);
      // schedule just in time (suspend/resume every 0.5 s) like the live player: pre-scheduling a whole song
      // keeps every future node in the graph from t = 0 and makes long renders quadratic
      const CH = 0.5;
      pump(I, CH + LOOK, false);
      if (c.suspend) {
        for (let t = CH; t < secs; t += CH) {
          const tt = t;
          c.suspend(tt).then(() => { pump(I, tt + CH + LOOK, false); c.resume(); });
        }
      } else pump(I, secs, false);
      return c.startRendering();
    },
    _warns: warns,
    _get: get
  };
})(globalThis.PT = globalThis.PT || {});
