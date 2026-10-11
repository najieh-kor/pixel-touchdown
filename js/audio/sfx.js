/* Pixel Touchdown: js/audio/sfx.js
 * Owner: WP6. Responsibility: synthesized sfx recipes.
 *
 * PT.Audio.Sfx[name] = function (h, t, o) — h = PT.Audio._h synth helpers (tone, noise, formant), t = start time
 * (AudioContext seconds), o = { vol, pitch, pan, … }. Everything is cartoon-y and short (design 19.1).
 * Names: ARCHITECTURE 3.8 list + design extras (sack, spin, dive, fumble, ooh, aww, gasp, cheer, roar, groan,
 * scratch, flag, doink, starRing, super, whiff, bell, buzzer, levelUp, trophy, fireworks, trainHorn, carHorn,
 * foghorn, pop) + species voices 'v_*'.
 */
(function (PT) {
  'use strict';
  const Audio = PT.Audio = PT.Audio || {};
  const S = Audio.Sfx = Audio.Sfx || {};
  const P = (o) => o.pitch || 1;
  const V = (o, v) => (o.vol == null ? 1 : o.vol) * v;
  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);       // midi → Hz
  const rnd = (a, b) => a + Math.random() * (b - a);

  function seq(h, t, notes, o, voice) {                           // notes: [midi, startOffset, dur]
    notes.forEach((n) => voice(t + n[1], NOTE(n[0]) * P(o), n[2]));
  }

  // ---------------- UI ----------------
  S.click = (h, t, o) => h.tone(t, { type: 'square', f: 1800 * P(o), f1: 1100 * P(o), dur: 0.03, vol: V(o, 0.08), filt: { f: 4500 } });
  S.pop = (h, t, o) => h.tone(t, { type: 'sine', f: 420 * P(o), f1: 950 * P(o), dur: 0.09, vol: V(o, 0.3) });
  S.back = (h, t, o) => h.tone(t, { type: 'triangle', f: 700 * P(o), f1: 360 * P(o), dur: 0.09, vol: V(o, 0.25) });
  S.error = (h, t, o) => { h.tone(t, { type: 'square', f: 220, dur: 0.12, vol: V(o, 0.12), filt: { f: 1500 } }); h.tone(t + 0.15, { type: 'square', f: 175, dur: 0.18, vol: V(o, 0.12), filt: { f: 1500 } }); };
  S.coin = (h, t, o) => { h.tone(t, { type: 'square', f: 988 * P(o), dur: 0.06, hold: 0.04, vol: V(o, 0.1) }); h.tone(t + 0.08, { type: 'square', f: 1319 * P(o), dur: 0.35, vol: V(o, 0.1) }); };
  S.levelUp = (h, t, o) => seq(h, t, [[72, 0, 0.08], [76, 0.08, 0.08], [79, 0.16, 0.08], [84, 0.24, 0.3]], o,
    (tt, f, d) => h.tone(tt, { type: 'square', f: f, dur: d, vol: V(o, 0.1), filt: { f: 5000 } }));
  S.trophy = (h, t, o) => seq(h, t, [[79, 0, 0.6], [83, 0.12, 0.6], [86, 0.24, 0.6], [91, 0.36, 1.1]], o,
    (tt, f, d) => { h.tone(tt, { type: 'triangle', f: f, dur: d, vol: V(o, 0.18) }); h.tone(tt, { type: 'sine', f: f * 2.01, dur: d * 0.5, vol: V(o, 0.05) }); });
  S.draftPick = (h, t, o) => { S.bell(h, t, o); seq(h, t + 0.25, [[67, 0, 0.12], [72, 0.12, 0.12], [76, 0.24, 0.4]], o, (tt, f, d) => brass(h, tt, f, d, V(o, 0.12))); };
  /** soft positive blip ('good' toasts): two quick rising sine notes */
  S.blip = (h, t, o) => { h.tone(t, { type: 'sine', f: 784 * P(o), dur: 0.07, vol: V(o, 0.1) }); h.tone(t + 0.06, { type: 'sine', f: 1175 * P(o), dur: 0.14, vol: V(o, 0.09) }); };
  S.signed = (h, t, o) => { h.noise(t, { type: 'bandpass', f: 3000, q: 2, dur: 0.05, vol: V(o, 0.2) }); S.coin(h, t + 0.06, o); };

  // ---------------- whistles / refs ----------------
  S.whistle = (h, t, o) => {
    const d = o.long ? 0.85 : o.short ? 0.25 : 0.45;
    // pea whistle: scooped-up tone with a fast pea trill, a soft upper partial and breath noise
    h.tone(t, { type: 'sine', f: 2500 * P(o), f1: 2850 * P(o), gt: 0.04, a: 0.012, hold: d * 0.7, rel: 0.07, vol: V(o, 0.12), vib: { f: 34, d: 150 } });
    h.tone(t, { type: 'sine', f: 5000 * P(o), f1: 5700 * P(o), gt: 0.04, a: 0.012, hold: d * 0.7, rel: 0.07, vol: V(o, 0.025), vib: { f: 34, d: 300 } });
    h.noise(t, { type: 'bandpass', f: 2900, q: 6, a: 0.008, hold: d * 0.7, rel: 0.08, vol: V(o, 0.05) });
    h.noise(t, { type: 'highpass', f: 5500, a: 0.004, dur: 0.05, vol: V(o, 0.04) });
  };
  S.hike = (h, t, o) => {
    [0, 0.2].forEach((dt, i) => {
      h.formant(t + dt, { formants: [650, 1150, 2500], dur: 0.09, a: 0.005, vol: V(o, i ? 0.22 : 0.16), q: 5, k: P(o) });
      h.tone(t + dt, { type: 'square', f: 170 * P(o), f1: 125 * P(o), dur: 0.09, vol: V(o, 0.05), filt: { f: 900 } });
    });
  };
  S.flag = (h, t, o) => { for (let i = 0; i < 9; i++) h.noise(t + i * 0.045, { type: 'bandpass', f: rnd(600, 1100), q: 1.5, dur: 0.03, vol: V(o, 0.08) }); };

  // ---------------- ball ----------------
  S.throw = (h, t, o) => {
    const lob = !!o.lob, pw = o.power == null ? 0.7 : o.power;
    h.noise(t, { type: 'bandpass', f: lob ? 400 : 700, f1: lob ? 1500 : 2600, ft: lob ? 0.45 : 0.22, q: 1.2, a: 0.03, dur: lob ? 0.45 : 0.24, vol: V(o, (lob ? 0.12 : 0.16) + pw * 0.12) });
  };
  S.catch = (h, t, o) => {
    // "thwump": chest thump with a pitch drop + leather slap
    h.tone(t, { type: 'sine', f: 170 * P(o), f1: 58, gt: 0.09, dur: 0.14, vol: V(o, 0.5) });
    h.noise(t, { type: 'lowpass', f: 500, q: 0.7, dur: 0.06, vol: V(o, 0.25) });
    h.noise(t, { type: 'bandpass', f: 1300, q: 1.4, a: 0.001, dur: 0.035, vol: V(o, 0.18) });
  };
  S.drop = (h, t, o) => h.tone(t, { type: 'triangle', f: 320 * P(o), f1: 170 * P(o), dur: 0.38, vol: V(o, 0.25), vib: { f: 13, d: 55 } });
  S.kick = (h, t, o) => { h.tone(t, { type: 'sine', f: 190, f1: 60, dur: 0.11, vol: V(o, 0.55) }); h.noise(t, { type: 'lowpass', f: 1800, dur: 0.05, vol: V(o, 0.3) }); };
  S.pat_ball = (h, t, o) => h.noise(t, { type: 'lowpass', f: 700, dur: 0.04, vol: V(o, 0.2) });
  S.fumble = (h, t, o) => {
    [0, 0.2, 0.34].forEach((dt, i) => h.tone(t + dt, { type: 'sine', f: (420 - i * 60) * P(o), f1: (220 - i * 30) * P(o), dur: 0.16, vol: V(o, 0.28 - i * 0.07), vib: { f: 15, d: 40 } }));
  };
  S.doink = (h, t, o) => [1250, 1870, 2640, 3410].forEach((f, i) => h.tone(t, { type: 'sine', f: f * P(o), dur: 0.9 - i * 0.15, vol: V(o, 0.16 / (i + 1)) }));
  S.fgGood = (h, t, o) => { h.tone(t, { type: 'triangle', f: 880 * P(o), dur: 0.15, vol: V(o, 0.18) }); h.tone(t + 0.12, { type: 'triangle', f: 1320 * P(o), dur: 0.4, vol: V(o, 0.18) }); };
  S.fgMiss = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 330 * P(o), f1: 150 * P(o), dur: 0.55, vol: V(o, 0.12), filt: { f: 1200 } });

  // ---------------- contact / moves ----------------
  S.tackle = (h, t, o) => {
    h.tone(t, { type: 'square', f: 520 * P(o), f1: 170 * P(o), dur: 0.08, vol: V(o, 0.14), filt: { f: 2200 } });   // cartoon bonk
    h.noise(t, { type: 'lowpass', f: 1100, f1: 300, ft: 0.08, dur: 0.09, vol: V(o, 0.3) });                          // pads
    h.noise(t, { type: 'bandpass', f: 2400, q: 1.2, a: 0.001, dur: 0.025, vol: V(o, 0.12) });                         // crack
    h.tone(t, { type: 'sine', f: 140, f1: 46, gt: 0.1, dur: 0.15, vol: V(o, 0.38) });                                 // thud
  };
  S.bigHit = (h, t, o) => {
    S.tackle(h, t, o);
    h.tone(t, { type: 'sine', f: 90, f1: 30, gt: 0.3, dur: 0.42, vol: V(o, 0.7) });                                  // sub drop
    h.tone(t + 0.012, { type: 'triangle', f: 240, f1: 80, gt: 0.12, dur: 0.16, vol: V(o, 0.18) });                   // body
    h.noise(t, { type: 'lowpass', f: 600, f1: 140, ft: 0.25, dur: 0.28, vol: V(o, 0.42) });
    chirps(h, t + 0.2, 3, 0.5, o);
  };
  S.sack = (h, t, o) => {
    h.noise(t, { type: 'lowpass', f: 1600, f1: 90, ft: 0.6, dur: 0.65, vol: V(o, 0.55) });
    h.tone(t, { type: 'sine', f: 95, f1: 30, dur: 0.55, vol: V(o, 0.7) });
    h.tone(t, { type: 'square', f: 210, f1: 55, dur: 0.25, vol: V(o, 0.12), filt: { f: 900 } });
  };
  S.juke = (h, t, o) => h.tone(t, { type: 'square', f: 300 * P(o), f1: 1500 * P(o), glide: 'lin', dur: 0.09, vol: V(o, 0.09), filt: { f: 3200 } });
  S.spin = (h, t, o) => h.tone(t, { type: 'triangle', f: 380 * P(o), f1: 950 * P(o), dur: 0.32, vol: V(o, 0.2), vib: { f: 18, d: 180 } });
  S.dive = (h, t, o) => {
    h.noise(t, { type: 'bandpass', f: 1600, f1: 380, ft: 0.35, q: 1, a: 0.02, dur: 0.35, vol: V(o, 0.25) });
    h.noise(t + 0.25, { type: 'highpass', f: 2500, dur: 0.14, vol: V(o, 0.12) });
  };

  // ---------------- crowd ----------------
  const chirps = (h, t, n, spread, o) => {
    for (let i = 0; i < n; i++) {
      const f = rnd(1500, 2900);
      h.tone(t + rnd(0, spread), { type: 'sine', f: f, f1: f * rnd(1.1, 1.5), dur: rnd(0.15, 0.4), vol: V(o, 0.025) });
    }
  };
  /** applause: many tiny band-passed noise claps */
  const applause = (h, t, n, spread, o) => {
    for (let i = 0; i < n; i++) h.noise(t + rnd(0, spread) * Math.sqrt(Math.random()), { type: 'bandpass', f: rnd(1100, 2600), q: 1.4, a: 0.001, dur: rnd(0.015, 0.03), vol: V(o, rnd(0.03, 0.06)) });
  };
  S.cheer = (h, t, o) => {
    h.formant(t, { formants: [800, 1200, 2800], a: 0.15, hold: 0.35, rel: 0.9, vol: V(o, 0.28), q: 2 });
    h.noise(t, { type: 'lowpass', f: 420, a: 0.2, hold: 0.3, rel: 0.8, vol: V(o, 0.08) });
    chirps(h, t + 0.1, 5, 0.8, o); applause(h, t + 0.15, 14, 1.2, o);
  };
  S.applause = (h, t, o) => applause(h, t, 26, 2, o);
  S.crowd = S.cheer;
  S.roar = (h, t, o) => {
    // layered swell: low rumble arrives first, vowel bands bloom ("ohh" → "aah"), presence band last
    h.noise(t, { type: 'lowpass', f: 260, a: 0.18, hold: 1.2, rel: 1.6, vol: V(o, 0.16) });
    h.formant(t + 0.05, { formants: [500, 950, 2400], a: 0.3, hold: 1.0, rel: 1.6, vol: V(o, 0.4), q: 1.6, k: 0.85, k1: 1.15 });
    h.noise(t + 0.2, { type: 'bandpass', f: 3200, q: 0.9, a: 0.35, hold: 0.8, rel: 1.3, vol: V(o, 0.07) });
    chirps(h, t + 0.15, 12, 2, o); applause(h, t + 0.3, 24, 2.2, o);
  };
  S.boo = (h, t, o) => {
    h.formant(t, { formants: [320, 650], a: 0.35, hold: 0.8, rel: 0.8, vol: V(o, 0.4), q: 4, k: 1, k1: 0.9 });
    h.tone(t, { type: 'sawtooth', f: 118, dur: 1.5, a: 0.3, hold: 0.7, rel: 0.6, vol: V(o, 0.04), vib: { f: 3, d: 6 }, filt: { f: 500 } });
  };
  S.groan = (h, t, o) => h.formant(t, { formants: [520, 900], a: 0.12, hold: 0.3, rel: 0.7, vol: V(o, 0.3), q: 4, k: 1.05, k1: 0.7 });
  S.ooh = (h, t, o) => h.formant(t, { formants: [450, 850], a: 0.12, hold: 0.25, rel: 0.45, vol: V(o, 0.25), q: 5, k: 0.85, k1: 1.2 });
  S.aww = (h, t, o) => h.formant(t, { formants: [700, 1150], a: 0.1, hold: 0.25, rel: 0.6, vol: V(o, 0.25), q: 5, k: 1.1, k1: 0.72 });
  S.gasp = (h, t, o) => h.noise(t, { type: 'highpass', f: 1700, f1: 2600, a: 0.04, dur: 0.28, vol: V(o, 0.22) });
  S.scratch = (h, t, o) => {
    h.tone(t, { type: 'sawtooth', f: 260, f1: 1100, glide: 'lin', gt: 0.09, dur: 0.1, vol: V(o, 0.12), filt: { type: 'bandpass', f: 1200, q: 2 } });
    h.tone(t + 0.1, { type: 'sawtooth', f: 1100, f1: 180, glide: 'lin', gt: 0.16, dur: 0.18, vol: V(o, 0.12), filt: { type: 'bandpass', f: 900, q: 2 } });
    h.noise(t, { type: 'bandpass', f: 1500, q: 3, dur: 0.28, vol: V(o, 0.08) });
  };

  // ---------------- big moments ----------------
  function brass(h, t, f, d, vol) {
    h.tone(t, { type: 'sawtooth', f: f, a: 0.03, hold: Math.max(0, d - 0.08), rel: 0.12, vol: vol, filt: { f: 700, f1: 2600, t: 0.08 } });
    h.tone(t, { type: 'sawtooth', f: f * 1.003, a: 0.03, hold: Math.max(0, d - 0.08), rel: 0.12, vol: vol * 0.6, filt: { f: 1800 } });
  }
  S.td = (h, t, o) => {
    for (let i = 0; i < 14; i++) h.noise(t + i * 0.032, { type: 'bandpass', f: 1900, q: 0.8, dur: 0.03, vol: V(o, 0.05 + i * 0.012) });
    const hit = t + 0.46;
    h.tone(hit, { type: 'sine', f: 110, f1: 45, dur: 0.35, vol: V(o, 0.6) });
    h.noise(hit, { type: 'highpass', f: 4500, a: 0.005, dur: 1.3, vol: V(o, 0.2) });
    [67, 71, 74, 79].forEach((n) => brass(h, hit, NOTE(n), 0.75, V(o, 0.06)));
  };
  /** opponent touchdown (HUNT3 #2): two low brass notes falling, a soft low thud */
  S.theyScore = (h, t, o) => {
    brass(h, t, NOTE(55), 0.22, V(o, 0.08)); brass(h, t, NOTE(50), 0.22, V(o, 0.05));
    h.tone(t + 0.26, { type: 'sawtooth', f: NOTE(51), f1: NOTE(46), gt: 0.5, a: 0.03, hold: 0.35, rel: 0.25, vol: V(o, 0.08), filt: { f: 900 } });
    h.tone(t + 0.26, { type: 'sawtooth', f: NOTE(46), f1: NOTE(41), gt: 0.5, a: 0.03, hold: 0.35, rel: 0.25, vol: V(o, 0.05), filt: { f: 700 } });
    h.tone(t + 0.26, { type: 'sine', f: 70, f1: 45, dur: 0.4, vol: V(o, 0.3) });
  };
  S.fanfare = (h, t, o) => {
    seq(h, t, [[67, 0, 0.14], [72, 0.15, 0.14], [76, 0.3, 0.14], [79, 0.45, 0.32], [76, 0.8, 0.14], [79, 0.95, 0.9]], o, (tt, f, d) => brass(h, tt, f, d, V(o, 0.1)));
    h.tone(t + 0.95, { type: 'sine', f: 98, f1: 70, dur: 0.6, vol: V(o, 0.45) });
  };
  S.fireworks = (h, t, o) => {
    for (let i = 0; i < 6; i++) {
      const tt = t + 0.3 + rnd(0, 1.4);
      h.noise(tt, { type: 'bandpass', f: rnd(700, 2500), q: 0.8, dur: 0.12, vol: V(o, 0.25) });
      for (let j = 0; j < 5; j++) h.noise(tt + 0.1 + rnd(0, 0.5), { type: 'highpass', f: 4000, dur: 0.02, vol: V(o, 0.05) });
    }
  };
  S.firstDown = (h, t, o) => [2400, 3100, 2750].forEach((f, i) => h.tone(t + i * 0.07, { type: 'square', f: f, dur: 0.09, vol: V(o, 0.05), filt: { type: 'bandpass', f: f, q: 4 } }));
  S.starRing = (h, t, o) => [880, 1175, 1568, 2093].forEach((f, i) => h.tone(t + i * 0.05, { type: 'sine', f: f * P(o), dur: 0.28, vol: V(o, 0.14) }));
  S.super = (h, t, o) => {
    for (let i = 0; i < 8; i++) h.tone(t + i * 0.035, { type: 'sine', f: rnd(2000, 4200), dur: 0.12, vol: V(o, 0.07) });
    [72, 76, 79, 84].forEach((n) => h.tone(t, { type: 'square', f: NOTE(n), dur: 0.35, vol: V(o, 0.04), filt: { f: 4000 } }));
  };
  /** Star ability used: power-up sweep + sparkle (perfect adds a bell) */
  S.ability = (h, t, o) => {
    h.tone(t, { type: 'square', f: 330 * P(o), f1: 1320 * P(o), dur: 0.22, vol: V(o, 0.08), filt: { f: 3500 } });
    h.tone(t + 0.05, { type: 'sawtooth', f: 165 * P(o), f1: 660 * P(o), dur: 0.25, vol: V(o, 0.05), filt: { f: 2000 } });
    S.super(h, t + 0.18, o);
    if (o.perfect) S.bell(h, t + 0.3, o);
  };
  /** enemy Star ready (red star): low pulsing alarm */
  S.warn = (h, t, o) => [0, 0.16].forEach((dt) => h.tone(t + dt, { type: 'square', f: 196 * P(o), f1: 147 * P(o), dur: 0.12, vol: V(o, 0.07), filt: { f: 1200 } }));
  S.whiff = (h, t, o) => h.tone(t, { type: 'triangle', f: 230, f1: 105, dur: 0.32, vol: V(o, 0.25) });
  S.buzzer = (h, t, o) => { h.tone(t, { type: 'square', f: 110, hold: 0.3, rel: 0.08, vol: V(o, 0.09), filt: { f: 800 } }); h.tone(t, { type: 'square', f: 116.5, hold: 0.3, rel: 0.08, vol: V(o, 0.09), filt: { f: 800 } }); };
  S.bell = (h, t, o) => [1568, 2349, 3136, 4186].forEach((f, i) => h.tone(t, { type: 'sine', f: f * P(o), dur: 0.9 - i * 0.18, vol: V(o, 0.12 / (i + 1)) }));
  S.trainHorn = (h, t, o) => [220, 277, 330].forEach((f) => h.tone(t, { type: 'sawtooth', f: f, a: 0.08, hold: 1.0, rel: 0.3, vol: V(o, 0.05), vib: { f: 5, d: 2 }, filt: { f: 1400 } }));
  S.carHorn = (h, t, o) => [0, 0.28].forEach((dt) => [415, 523].forEach((f) => h.tone(t + dt, { type: 'square', f: f, hold: 0.16, rel: 0.04, vol: V(o, 0.05), filt: { f: 2000 } })));
  S.foghorn = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 72, a: 0.2, hold: 1.4, rel: 0.5, vol: V(o, 0.18), filt: { f: 320 } });

  // ---------------- species voices (design 19.1) ----------------
  S.v_trumpet = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 480 * P(o), f1: 720 * P(o), glide: 'lin', gt: 0.15, a: 0.03, hold: 0.25, rel: 0.2, vol: V(o, 0.12), vib: { f: 9, d: 18 }, filt: { type: 'bandpass', f: 1300, q: 1.5 } });
  S.v_quack = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 620 * P(o), f1: 420 * P(o), dur: 0.13, vol: V(o, 0.16), filt: { type: 'bandpass', f: 1100, q: 4 } });
  S.v_cluck = (h, t, o) => [0, 0.09].forEach((dt, i) => h.tone(t + dt, { type: 'square', f: (900 - i * 180) * P(o), f1: 600 * P(o), dur: 0.05, vol: V(o, 0.1), filt: { type: 'bandpass', f: 1400, q: 3 } }));
  S.v_ribbit = (h, t, o) => [0, 0.16].forEach((dt) => h.tone(t + dt, { type: 'square', f: 190 * P(o), dur: 0.1, vol: V(o, 0.12), vib: { f: 40, d: 60 }, filt: { f: 1400 } }));
  S.v_woof = (h, t, o) => { h.tone(t, { type: 'sawtooth', f: 330 * P(o), f1: 150 * P(o), dur: 0.13, vol: V(o, 0.18), filt: { f: 900 } }); h.noise(t, { type: 'bandpass', f: 700, dur: 0.08, vol: V(o, 0.1) }); };
  S.v_meow = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 520 * P(o), f1: 880 * P(o), glide: 'lin', gt: 0.18, a: 0.02, hold: 0.12, rel: 0.25, vol: V(o, 0.1), filt: { type: 'bandpass', f: 900, f1: 1800, t: 0.2, q: 3 } });
  S.v_roar = (h, t, o) => { h.noise(t, { type: 'lowpass', f: 700, a: 0.05, hold: 0.25, rel: 0.25, vol: V(o, 0.18) }); h.tone(t, { type: 'sawtooth', f: 130 * P(o), f1: 95 * P(o), a: 0.05, hold: 0.25, rel: 0.25, vol: V(o, 0.08), vib: { f: 22, d: 14 }, filt: { f: 700 } }); };
  S.v_oink = (h, t, o) => [0, 0.14].forEach((dt) => h.tone(t + dt, { type: 'square', f: 260 * P(o), f1: 200 * P(o), dur: 0.09, vol: V(o, 0.12), filt: { type: 'bandpass', f: 650, q: 5 } }));
  S.v_bleat = (h, t, o) => h.tone(t, { type: 'sawtooth', f: 620 * P(o), a: 0.02, hold: 0.25, rel: 0.15, vol: V(o, 0.1), vib: { f: 14, d: 70 }, filt: { type: 'bandpass', f: 1300, q: 2 } });
  S.v_hoot = (h, t, o) => [0, 0.3].forEach((dt) => h.tone(t + dt, { type: 'sine', f: 420 * P(o), f1: 380 * P(o), a: 0.04, dur: 0.22, vol: V(o, 0.2) }));
  S.v_squawk = (h, t, o) => { h.tone(t, { type: 'sawtooth', f: 900 * P(o), f1: 1300 * P(o), dur: 0.16, vol: V(o, 0.1), filt: { type: 'bandpass', f: 1800, q: 2 } }); h.noise(t, { type: 'bandpass', f: 2500, dur: 0.12, vol: V(o, 0.06) }); };
  S.v_howl = (h, t, o) => h.tone(t, { type: 'sine', f: 400 * P(o), f1: 780 * P(o), glide: 'lin', gt: 0.4, a: 0.08, hold: 0.5, rel: 0.4, vol: V(o, 0.15), vib: { f: 6, d: 12 } });
  S.v_oohooh = (h, t, o) => [0, 0.17].forEach((dt) => h.tone(t + dt, { type: 'sine', f: 480 * P(o), f1: 820 * P(o), dur: 0.13, vol: V(o, 0.17) }));
  S.v_snort = (h, t, o) => { h.noise(t, { type: 'lowpass', f: 520, dur: 0.2, vol: V(o, 0.3) }); h.tone(t, { type: 'sawtooth', f: 85 * P(o), dur: 0.18, vol: V(o, 0.08), filt: { f: 400 } }); };
  /** big-animal grunt (size L, unknown species) and medium huff */
  S.v_grunt = (h, t, o) => {
    h.tone(t, { type: 'sawtooth', f: 105 * P(o), f1: 78 * P(o), a: 0.02, hold: 0.08, rel: 0.12, vol: V(o, 0.12), vib: { f: 28, d: 10 }, filt: { type: 'bandpass', f: 520, q: 2 } });
    h.noise(t, { type: 'lowpass', f: 600, a: 0.02, dur: 0.16, vol: V(o, 0.16) });
  };
  S.v_huff = (h, t, o) => h.formant(t, { formants: [600, 1100], a: 0.01, dur: 0.12, vol: V(o, 0.2), q: 3, k: P(o), k1: P(o) * 0.8 });
  S.v_squeak = (h, t, o) => h.tone(t, { type: 'sine', f: 1700 * P(o), f1: 2400 * P(o), dur: 0.08, vol: V(o, 0.12) });
})(globalThis.PT = globalThis.PT || {});
