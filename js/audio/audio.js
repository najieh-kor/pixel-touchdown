/* Pixel Touchdown: js/audio/audio.js
 * Owner: WP6. Responsibility: PT.Audio: context, unlock, master/sfx/music gains, mute, bus wiring.
 *
 * Everything is synthesized with WebAudio (no files). Graph:
 *   sfx ─┐
 *   amb ─┼─► master ─► shelf (snow muffle) ─► glue compressor ─► limiter ─► soft clip ─► destination
 *   music (songs + stingers + reverb/echo, see music.js) ─► duck (modals/pause) ─┘
 * Songs: title | hq <-> hq2 | game (intensity layers) | draft | playoffs | victory | champion | defeat, picked from
 * ui:navigate / game:* / league:phase. Stingers (Audio.sting): td, levelUp, achievement, coin, newSeason, win, lose.
 * Big sfx (td, roar, sack, …) duck the music briefly (DUCK table). Audio.setIntensity(0..1) drives the game bed.
 * The context is created lazily and unlocked on the first pointerdown/touchend/keydown (iOS needs a sound
 * started inside a user gesture). With ?test=1 audio is disabled; play() still records names in PT.Audio._log.
 * Audio listens to the bus (game:*, ui:*, league:*, app:*) — nobody calls play() for game events directly.
 */
(function (PT) {
  'use strict';
  const Audio = PT.Audio = PT.Audio || {};
  const A = Audio._a = {
    ctx: null, master: null, shelf: null, comp: null, sfx: null, music: null, duck: null, amb: null,
    vol: { sfx: 0.8, music: 0.5 }, muted: false, disabled: false, unlocked: false, wired: false,
    white: null, wantMusic: null, crowd: null, ambience: null, ambKind: null, game: null, duckN: 0
  };
  const log = Audio._log = [];
  let warned = {};

  function Ctor() { return globalThis.AudioContext || globalThis.webkitAudioContext || null; }
  const MUSIC_K = 0.75;                            // music bus gain = music volume × MUSIC_K

  /**
   * Master chain (also used by Music.render offline): highshelf (snow muffle) → glue compressor → brickwall-ish
   * limiter → soft clipper (linear below 0.9, tanh knee to ±1) so nothing ever hard-clips.
   * @returns {{input:AudioNode, output:AudioNode, shelf:BiquadFilterNode, comp:DynamicsCompressorNode, lim:DynamicsCompressorNode}}
   */
  function mkMaster(c) {
    const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 4000; shelf.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    const clip = c.createWaveShaper(), n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      curve[i] = ax <= 0.9 ? x : Math.sign(x) * (0.9 + 0.1 * Math.tanh((ax - 0.9) / 0.1));
    }
    clip.curve = curve;
    shelf.connect(comp); comp.connect(lim); lim.connect(clip);
    return { input: shelf, output: clip, shelf: shelf, comp: comp, lim: lim };
  }
  Audio._mkMaster = mkMaster;

  function ensureCtx() {
    if (A.ctx || A.disabled) return A.ctx;
    const C = Ctor();
    if (!C) { A.disabled = true; return null; }
    try { A.ctx = new C(); } catch (e) { A.disabled = true; return null; }
    const c = A.ctx;
    const m = mkMaster(c);
    A.comp = m.comp; A.shelf = m.shelf; A.lim = m.lim;
    A.master = c.createGain(); A.master.gain.value = A.muted ? 0 : 0.9;
    A.sfx = c.createGain(); A.sfx.gain.value = A.vol.sfx;
    A.music = c.createGain(); A.music.gain.value = A.vol.music * MUSIC_K;
    A.duck = c.createGain(); A.duck.gain.value = 1;
    A.amb = c.createGain(); A.amb.gain.value = A.vol.sfx;
    A.sfx.connect(A.master); A.amb.connect(A.master); A.music.connect(A.duck); A.duck.connect(A.master);
    A.master.connect(m.input); m.output.connect(c.destination);
    const len = c.sampleRate * 2;
    A.white = c.createBuffer(1, len, c.sampleRate);
    const d = A.white.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return c;
  }
  function running() { return !!(A.ctx && A.ctx.state === 'running' && !A.disabled); }

  // ---------------- synth helpers (used by sfx.js and music.js) ----------------
  function pan(node, p) {
    if (!p || !A.ctx.createStereoPanner) return node;
    const s = A.ctx.createStereoPanner(); s.pan.value = Math.max(-1, Math.min(1, p));
    node.connect(s); return s;
  }
  function envGain(t, o) {
    const g = A.ctx.createGain(), v = o.vol == null ? 0.3 : o.vol, a = o.a == null ? 0.005 : o.a, dur = o.dur || 0.2;
    const rel = o.rel == null ? dur : o.rel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a);
    if (o.hold) g.gain.setValueAtTime(Math.max(0.0002, v), t + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + (o.hold || 0) + rel);
    return g;
  }
  /**
   * Oscillator voice. o: { type, f, f1 (glide target), dur, vol, a, rel, hold, glide:'exp'|'lin', dest, pan, vib:{f,d}, filt:{type,f,q,f1} }
   * @returns {number} end time
   */
  function tone(t, o) {
    const c = A.ctx;
    const osc = c.createOscillator();
    osc.type = o.type || 'square';
    const f = Math.max(1, o.f);
    osc.frequency.setValueAtTime(f, t);
    const end = t + (o.a || 0.005) + (o.hold || 0) + (o.rel == null ? (o.dur || 0.2) : o.rel);
    if (o.f1) {
      if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(1, o.f1), t + (o.gt || o.dur || 0.2));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.gt || o.dur || 0.2));
    }
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib.f; lg.gain.value = o.vib.d;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end + 0.05);
    }
    let node = osc;
    if (o.filt) {
      const bq = c.createBiquadFilter(); bq.type = o.filt.type || 'lowpass'; bq.frequency.setValueAtTime(o.filt.f, t);
      if (o.filt.f1) bq.frequency.exponentialRampToValueAtTime(o.filt.f1, t + (o.filt.t || o.dur || 0.2));
      if (o.filt.q) bq.Q.value = o.filt.q;
      node.connect(bq); node = bq;
    }
    const g = envGain(t, o);
    node.connect(g);
    pan(g, o.pan).connect(o.dest || A.sfx);
    osc.start(t); osc.stop(end + 0.05);
    return end;
  }
  /**
   * Filtered white noise. o: { dur, vol, a, rel, hold, type:'bandpass'|'lowpass'|'highpass', f, f1, q, dest, pan, rate }
   */
  function noise(t, o) {
    const c = A.ctx;
    const src = c.createBufferSource();
    src.buffer = A.white; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const end = t + (o.a || 0.005) + (o.hold || 0) + (o.rel == null ? (o.dur || 0.2) : o.rel);
    let node = src;
    if (o.type) {
      const bq = c.createBiquadFilter(); bq.type = o.type; bq.frequency.setValueAtTime(o.f || 1000, t);
      if (o.f1) bq.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.dur || 0.2));
      bq.Q.value = o.q == null ? 1 : o.q;
      node.connect(bq); node = bq;
    }
    const g = envGain(t, o);
    node.connect(g);
    pan(g, o.pan).connect(o.dest || A.sfx);
    src.start(t, Math.random() * 1.5); src.stop(end + 0.05);
    return end;
  }
  /** Formant "voice" noise (crowd ooh/aah/boo): noise through parallel band-passes. */
  function formant(t, o) {
    const fs = o.formants || [700, 1200];
    fs.forEach((f, i) => noise(t, Object.assign({}, o, { type: 'bandpass', f: f * (o.k || 1), f1: o.k1 ? f * o.k1 : undefined, q: o.q || 6, vol: (o.vol || 0.2) / (i + 1) })));
  }
  Audio._h = { tone: tone, noise: noise, formant: formant, get ctx() { return A.ctx; }, get out() { return A.sfx; }, get musicOut() { return A.music; } };

  // ---------------- crowd + weather ambience ----------------
  function loopNoise(type, f, q, vol, dest) {
    const c = A.ctx, src = c.createBufferSource();
    src.buffer = A.white; src.loop = true;
    const bq = c.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(bq); bq.connect(g); g.connect(dest || A.amb);
    src.start();
    return { src: src, bq: bq, g: g, stop: () => { try { src.stop(); } catch (e) { /* stopped */ } g.disconnect(); } };
  }
  function startCrowd() {
    if (A.crowd || !running()) return;
    const c = A.ctx;
    const a = loopNoise('bandpass', 850, 0.7, 0.0001);
    const b = loopNoise('bandpass', 2100, 1.2, 0.0001);
    // murmur: slow LFO on the low band
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.23; lg.gain.value = 260;
    lfo.connect(lg); lg.connect(a.bq.frequency); lfo.start();
    A.crowd = { a: a, b: b, lfo: lfo, base: 0, level: 0 };
    setCrowd(A.crowdLevel || 0);
  }
  function setCrowd(level) {
    A.crowdLevel = level;
    if (!A.crowd) { if (level > 0 && running()) startCrowd(); return; }
    const t = A.ctx.currentTime;
    A.crowd.base = level;
    A.crowd.a.g.gain.setTargetAtTime(Math.max(0.0001, level * 0.16), t, 0.4);
    A.crowd.b.g.gain.setTargetAtTime(Math.max(0.0001, level * 0.05), t, 0.4);
  }
  /** Temporary crowd swell (cheer/roar/groan bed). amt 0..1, dur s. */
  function swell(amt, dur) {
    if (!A.crowd || !running()) return;
    const t = A.ctx.currentTime, base = A.crowd.base;
    const peak = Math.min(1.4, base + amt);
    [[A.crowd.a.g.gain, 0.16], [A.crowd.b.g.gain, 0.09]].forEach(([p, k]) => {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(Math.max(0.0001, peak * k), t, 0.12);
      p.setTargetAtTime(Math.max(0.0001, base * (k === 0.16 ? 0.16 : 0.05)), t + (dur || 1.5), 0.6);
    });
  }
  Audio.swell = swell;

  function stopAmbience() {
    if (A.ambience) { A.ambience.forEach((n) => n.stop()); A.ambience = null; }
    if (A.shelf) A.shelf.gain.setTargetAtTime(0, A.ctx.currentTime, 0.3);
  }
  function startAmbience(kind) {
    stopAmbience();
    A.ambKind = kind;
    if (!kind || !running()) return;
    const c = A.ctx, list = [];
    if (kind === 'rain') {
      list.push(loopNoise('highpass', 3500, 0.5, 0.05));
      list.push(loopNoise('bandpass', 1200, 0.8, 0.02));
    } else if (kind === 'wind' || kind === 'snow' || kind === 'fog') {
      const w = loopNoise('lowpass', 420, 2.5, kind === 'wind' ? 0.12 : 0.05);
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.13; lg.gain.value = 220;
      lfo.connect(lg); lg.connect(w.bq.frequency); lfo.start();
      list.push(w, { stop: () => { try { lfo.stop(); } catch (e) { /* ok */ } } });
      if (kind === 'snow') A.shelf.gain.setTargetAtTime(-3, c.currentTime, 0.5);   // snow muffle: −3 dB highs
    }
    A.ambience = list;
  }

  // ---------------- public API ----------------
  /**
   * @param {{disabled?:boolean, sfx?:number, music?:number, muted?:boolean}} [o]
   * Lazily creates the AudioContext on the first user gesture (iOS unlock).
   */
  Audio.init = function (o) {
    o = o || {};
    if (o.disabled) A.disabled = true;
    if (o.sfx != null) A.vol.sfx = o.sfx;
    if (o.music != null) A.vol.music = o.music;
    if (o.muted != null) A.muted = !!o.muted;
    wire();
    if (A.disabled || !globalThis.addEventListener) return;
    const unlock = () => {
      Audio.unlock();
      if (running()) ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach((n) => globalThis.removeEventListener(n, unlock, true));
    };
    ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach((n) => globalThis.addEventListener(n, unlock, true));
  };

  /** Create/resume the context inside a user gesture and play a silent buffer (iOS). */
  Audio.unlock = function () {
    if (A.disabled) return;
    const c = ensureCtx();
    if (!c) return;
    try {
      if (c.state !== 'running') c.resume();
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) { /* ignore */ }
    if (!A.unlocked) {
      A.unlocked = true;
      const after = () => {
        if (A.wantMusic && Audio.Music) Audio.Music.play(A.wantMusic);
        if (A.crowdLevel) startCrowd();
        if (A.ambKind) startAmbience(A.ambKind);
      };
      if (c.state === 'running') after(); else if (c.resume) c.resume().then(after, () => {});
    }
  };

  /**
   * Play a synthesized sfx. @param {string} name @param {{vol?:number, pitch?:number, pan?:number}} [o]
   * @returns {boolean} true if it sounded
   */
  Audio.play = function (name, o) {
    log.push(name); if (log.length > 50) log.shift();
    if (A.muted || !running()) return false;
    const fn = Audio.Sfx && Audio.Sfx[name];
    if (!fn) { if (!warned[name] && PT.Log) { warned[name] = 1; PT.Log.warn('audio', 'no sfx', name); } return false; }
    try {
      fn(Audio._h, A.ctx.currentTime + 0.005, o || {});
      const dk = DUCK[name];
      if (dk && Audio.Music && Audio.Music.duckFor) Audio.Music.duckFor(dk[0], dk[1]);
      return true;
    } catch (e) { if (PT.Log) PT.Log.warn('audio', 'sfx failed', name, e && e.message); return false; }
  };
  /** big sfx duck the music: [depth, seconds] */
  const DUCK = { td: [0.45, 1.6], roar: [0.55, 2.2], fanfare: [0.45, 1.6], bigHit: [0.7, 0.35], sack: [0.6, 0.7],
    scratch: [0.55, 0.45], buzzer: [0.65, 0.4], boo: [0.6, 1.5], trainHorn: [0.6, 1.3], foghorn: [0.6, 1.8], super: [0.6, 0.5] };

  const FAMILY = { hq: 'hq', hq2: 'hq' };
  /**
   * Song request. Names: title | hq | hq2 | game | draft | playoffs | victory | champion | defeat | null.
   * 'menu' is the old name: title on title screens, HQ elsewhere. hq/hq2 are one family (they chain into each other).
   * @param {string|null} name
   */
  Audio.music = function (name) {
    if (name === 'menu') name = TITLE_SCREENS[A.screen] ? 'title' : 'hq';
    const M = Audio.Music;
    if (M && name && M.current() && (M.current() === name || (FAMILY[name] && FAMILY[name] === FAMILY[M.playing()]))) { A.wantMusic = name; return; }
    A.wantMusic = name;
    if (!M) return;
    if (!name) { M.stop(); return; }
    if (running()) {
      M.play(name, { fadeIn: STING_SONGS[name] ? 0.02 : undefined, fade: STING_SONGS[name] ? 0.5 : undefined });
      const inf = STING_SONGS[name] && M.info && M.info(name);
      if (inf) stHold(A.ctx.currentTime + (inf.intro || 0));
    }
  };
  Audio.musicName = function () { return A.wantMusic; };
  const STING_SONGS = { victory: 1, champion: 1, defeat: 1 };
  /** Musical jingle over the music: td | levelUp | achievement | coin | newSeason | win | lose. @returns {number} secs */
  // HUNT3 #3: stingers never pile up. One at a time, ≥ 0.9 s apart, held while a result fanfare plays.
  // The same name requested again within 2 s is dropped (counted in SQ.dup).
  const SQ = { q: [], busy: 0, timer: null, last: {}, dup: 0 };
  function stFire(name, o) {
    const len = Audio.Music.sting(name, o);
    if (len > 0) SQ.busy = A.ctx.currentTime + Math.max(0.9, len - 0.15);
    return len;
  }
  function stPump() {
    SQ.timer = null;
    if (!SQ.q.length) return;
    if (A.muted || !running()) { SQ.q.length = 0; return; }
    const wait = SQ.busy - A.ctx.currentTime;
    if (wait > 0.02) { SQ.timer = setTimeout(stPump, Math.ceil(wait * 1000)); return; }
    const it = SQ.q.shift();
    stFire(it[0], it[1]);
    if (SQ.q.length) SQ.timer = setTimeout(stPump, Math.ceil(Math.max(0.05, SQ.busy - A.ctx.currentTime) * 1000));
  }
  /** hold queued stingers until t (AudioContext seconds), e.g. while the victory fanfare plays */
  function stHold(t) { SQ.busy = Math.max(SQ.busy, t); }
  /**
   * Musical jingle over the music: td | levelUp | achievement | coin | newSeason | win | lose (queued, see SQ).
   * @returns {number} secs (estimated when queued; 0 = could not play, caller may fall back to an sfx)
   */
  Audio.sting = function (name, o) {
    log.push('sting:' + name); if (log.length > 50) log.shift();
    if (A.muted || !running() || !Audio.Music) return 0;
    const now = A.ctx.currentTime, len = Audio.Music.length(name);
    if (!(len > 0)) return 0;
    if (SQ.last[name] != null && now - SQ.last[name] < 2) { SQ.dup++; return len; }
    SQ.last[name] = now;
    if (now < SQ.busy || SQ.q.length) {
      SQ.q.push([name, o]);
      if (!SQ.timer) stPump();
      return len;
    }
    return stFire(name, o);
  };
  /** Music intensity 0..1 (game bed layers: red zone, two-minute drill, close score…) */
  Audio.setIntensity = function (x) { A.intensity = Math.max(0, Math.min(1, +x || 0)); if (Audio.Music) Audio.Music.setIntensity(A.intensity); };
  Audio.intensity = function () { return A.intensity || 0; };

  /** @param {{sfx?:number, music?:number}} v 0..1 */
  Audio.setVolumes = function (v) {
    if (v.sfx != null) A.vol.sfx = v.sfx;
    if (v.music != null) A.vol.music = v.music;
    if (A.ctx) {
      const t = A.ctx.currentTime;
      A.sfx.gain.setTargetAtTime(A.vol.sfx, t, 0.05);
      A.amb.gain.setTargetAtTime(A.vol.sfx, t, 0.05);
      A.music.gain.setTargetAtTime(A.vol.music * MUSIC_K, t, 0.05);
    }
  };
  Audio.mute = function (on) {
    A.muted = !!on;
    if (A.ctx) A.master.gain.setTargetAtTime(A.muted ? 0 : 0.9, A.ctx.currentTime, 0.03);
  };
  Audio.isMuted = function () { return A.muted; };
  Audio.suspend = function () { if (A.ctx && A.ctx.state === 'running') A.ctx.suspend(); };
  Audio.resume = function () { if (A.ctx && A.ctx.state === 'suspended' && A.unlocked) A.ctx.resume(); };
  /** Duck music to 40% (modals, pause). Nested calls are counted. */
  Audio.duck = function (on) {
    A.duckN = Math.max(0, A.duckN + (on ? 1 : -1));
    if (A.ctx) A.duck.gain.setTargetAtTime(A.duckN ? 0.4 : 1, A.ctx.currentTime, 0.12);
  };
  /** Crowd ambience level 0..1 (0 = off). */
  Audio.crowd = function (level) { setCrowd(Math.max(0, level || 0)); };
  /** Weather bed: 'rain' | 'wind' | 'snow' | 'fog' | null */
  Audio.ambience = function (kind) { A.ambKind = kind || null; startAmbience(A.ambKind); };
  Audio.state = function () {
    return { ctx: A.ctx ? A.ctx.state : 'none', disabled: A.disabled, muted: A.muted, music: A.wantMusic, crowd: A.crowdLevel || 0, amb: A.ambKind, vol: Object.assign({}, A.vol),
      playing: Audio.Music && Audio.Music.playing ? Audio.Music.playing() : null, intensity: A.intensity || 0, screen: A.screen || null };
  };

  // ---------------- bus wiring ----------------
  const VOICE = { elephant: 'trumpet', duck: 'quack', chicken: 'cluck', frog: 'ribbit', dog: 'woof', cat: 'meow', lion: 'roar',
    pig: 'oink', goat: 'bleat', owl: 'hoot', penguin: 'squawk', wolf: 'howl', monkey: 'oohooh', bull: 'snort', hamster: 'squeak' };
  /** play the species voice (generic squeak pitched by size otherwise) */
  Audio.voice = function (sp, sz, o) {
    const v = VOICE[sp];
    if (v) return Audio.play('v_' + v, o);
    if (sz === 'L') return Audio.play('v_grunt', Object.assign({ pitch: 0.9 + Math.random() * 0.2 }, o || {}));
    if (sz === 'M' && Math.random() < 0.4) return Audio.play('v_huff', Object.assign({ pitch: 0.9 + Math.random() * 0.25 }, o || {}));
    return Audio.play('v_squeak', Object.assign({ pitch: (sz === 'S' ? 1.5 : 1) * (0.92 + Math.random() * 0.16) }, o || {}));
  };
  let lastVoice = 0;
  function voiceMaybe(sp, sz, chance) {
    const now = A.ctx ? A.ctx.currentTime : 0;
    if (!sp || now - lastVoice < 0.6 || Math.random() > (chance == null ? 0.5 : chance)) return;
    lastVoice = now;
    Audio.voice(sp, sz, { vol: 0.7 });
  }
  /** crowd reaction from the HOME crowd's point of view */
  function react(good, big) {
    if (good) { Audio.play(big ? 'roar' : 'cheer'); swell(big ? 0.9 : 0.45, big ? 3 : 1.6); }
    else { Audio.play(big ? 'boo' : 'groan', { vol: 0.8 }); swell(0.2, 1.2); }
  }
  function homeGood(p) {                           // true if this event favors the home team
    if (!A.game) return true;
    if (p.home != null) return !!p.home;
    if (p.tid != null) return p.tid === A.game.home;
    return true;
  }

  // ---------------- song selection ----------------
  const TITLE_SCREENS = { title: 1, slots: 1, newgame: 1, howto: 1 };
  const MARKET_SCREENS = { draft: 1, market: 1, resign: 1, swaps: 1 };
  const KEEP_SCREENS = { settings: 1, game: 1 };
  const RESULT_SCREENS = { postgame: 1, quickpost: 1, results: 1 };
  function league() { return PT.App && PT.App.L; }
  function userCoins() { const L = league(), t = L && L.teams && L.teams[L.userTid]; return t && t.fin ? t.fin.coins : null; }
  function userChamp() {
    const L = league();
    if (!L) return false;
    const ss = L.hist && L.hist.seasons, last = ss && ss[ss.length - 1];
    return (L.po && L.po.champ != null && L.po.champ === L.userTid) || !!(last && last.champ != null && last.champ === L.userTid && last.season === L.season);
  }
  /** which song a (non-game) screen wants */
  function screenSong(n) {
    if (TITLE_SCREENS[n]) return 'title';
    if (MARKET_SCREENS[n]) return 'draft';
    if (n === 'fired') return 'defeat';
    if (n === 'awards' || n === 'season-end') return userChamp() ? 'champion' : 'hq2';
    const L = league();
    if (n === 'playoffs' || (L && L.phase === 'PLAYOFFS' && (n === 'hub' || n === 'pregame' || n === 'schedule'))) return 'playoffs';
    return 'hq';
  }
  /** game bed intensity from the engine situation (design: red zone, two-minute drill, close score, playoffs) */
  function sitIntensity(st) {
    if (!st) return A.intensity || 0;
    const diff = Math.abs((st.hs || 0) - (st.as || 0)), q = st.q || 1;
    let x = 0.15;
    if (st.toGoal != null && st.toGoal <= 20) x += 0.25;
    if (st.goal) x += 0.08;
    if (st.down >= 3) x += 0.07;
    if ((q === 2 || q >= 4) && st.clk != null && st.clk <= 120) x += 0.2;
    if (q >= 3 && diff <= 8) x += 0.1;
    if (q >= 4 && diff <= 8) x += 0.12;
    if (st.ot) x += 0.2;
    if (A.game && A.game.po) x += 0.15;
    return Math.min(1, x);
  }
  Audio._sitIntensity = sitIntensity;

  function wire() {
    if (A.wired || !PT.Events) return;
    A.wired = true;
    const on = PT.Events.on;
    on('game:start', (p) => {
      A.game = { home: p.home, away: p.away, user: p.userTid, horn: p.horn || null, po: p.po || 0 };
      A.coins0 = userCoins();
      Audio.crowd(p.crowd == null ? 0.6 : p.crowd);
      const wx = p.weather && p.weather.k;
      Audio.ambience(wx === 'rain' || wx === 'snow' || wx === 'wind' || wx === 'fog' ? wx : null);
      Audio.setIntensity(p.po ? 0.3 : 0.15);
      Audio.music('game');
      if (wx === 'fog') setTimeout(() => Audio.play('foghorn'), 1200);
      Audio.play('whistle');
    });
    on('game:exit', (p) => {
      Audio.crowd(0); Audio.ambience(null);
      A.game = null;
      if (!STING_SONGS[A.wantMusic]) Audio.music(screenSong(A.screen === 'game' ? 'hub' : A.screen));
    });
    on('game:snap', (p) => { Audio.play('hike'); voiceMaybe(p.sp, p.sz, 0.35); });
    on('game:handoff', () => Audio.play('pat_ball'));
    on('game:throw', (p) => Audio.play('throw', { lob: !!p.lob, power: p.power }));
    on('game:catch', (p) => { Audio.play('catch'); Audio.play('ooh', { vol: p.contested ? 0.9 : 0.5 }); });
    on('game:incomplete', (p) => { Audio.play('drop'); Audio.play('aww', { vol: 0.6 }); });
    on('game:tackle', (p) => {
      Audio.play(p.big ? 'bigHit' : 'tackle');
      voiceMaybe(p.csp || p.sp, p.csz || p.sz, p.big ? 0.8 : 0.35);
    });
    on('game:sack', () => { Audio.play('sack'); swell(0.5, 1.4); });
    on('game:juke', () => Audio.play('juke'));
    on('game:spin', () => Audio.play('spin'));
    on('game:dive', () => Audio.play('dive'));
    on('game:brokenTackle', () => { Audio.play('juke', { pitch: 0.8 }); swell(0.35, 1); });
    on('game:firstDown', (p) => { Audio.play('firstDown'); react(homeGood(p), false); });
    on('game:touchdown', (p) => {
      const good = homeGood(p);
      const mine = p.user != null ? !!p.user : !!(A.game && p.tid != null && p.tid === A.game.user);
      if (mine) {                                     // HUNT3 #2: only the user's TD celebrates
        Audio.setIntensity(1);                        // everything in until the next whistle
        if (!(Audio.sting('td') > 0)) Audio.play('td');
        Audio.play('fireworks');
        if (good && A.game && A.game.horn) setTimeout(() => Audio.play(A.game.horn === 'train' ? 'trainHorn' : 'carHorn'), 700);
      } else Audio.play('theyScore');
      react(good, true);                              // the home crowd still reacts
    });
    on('game:fieldGoal', (p) => { Audio.play('whistle'); Audio.play(p.good ? 'fgGood' : 'fgMiss'); react(homeGood(p) === !!p.good, false); });
    on('game:doink', () => Audio.play('doink'));
    on('game:pat', (p) => { if (p.good) Audio.play('fgGood', { vol: 0.6 }); else Audio.play('fgMiss', { vol: 0.6 }); });
    on('game:safety', (p) => { Audio.play('whistle'); react(homeGood(p), false); });
    on('game:turnover', (p) => {
      if (p.kind === 'int') { Audio.play('scratch'); Audio.play('gasp'); }
      else if (p.kind === 'fumble') { Audio.play('fumble'); Audio.play('gasp', { vol: 0.6 }); }
      else Audio.play('buzzer');
      react(homeGood(p), true);
    });
    on('game:fumble', () => Audio.play('fumble'));
    on('game:penalty', () => { Audio.play('flag'); Audio.play('whistle', { vol: 0.6 }); });
    on('game:playEnd', (p) => {
      Audio.play('whistle', { short: true, vol: 0.5 });
      if (p && p.sit) Audio.setIntensity(sitIntensity(p.sit));   // red zone / two-minute / close score → layers
    });
    on('game:quarterEnd', (p) => {                  // HUNT3 #4: at Q4+ a gameEnd may follow in the same tick (one whistle)
      if (p && p.q >= 4) { const t0 = A.endAt || 0; setTimeout(() => { if ((A.endAt || 0) === t0) Audio.play('whistle', { long: true }); }, 60); }
      else Audio.play('whistle', { long: true });
    });
    on('game:injury', () => Audio.play('groan', { vol: 0.5 }));
    on('game:timeout', () => Audio.play('whistle', { short: true, vol: 0.7 }));
    on('game:halftime', () => Audio.play('whistle', { long: true }));
    on('game:twoMinute', () => { Audio.play('whistle', { long: true }); Audio.setIntensity(Math.max(Audio.intensity(), 0.55)); });
    on('game:onside', () => Audio.play('gasp'));
    on('game:starRing', (p) => { if (p.on || p.ring === 'green') Audio.play('starRing'); });
    on('game:starPlay', (p) => Audio.play(p.result === 'whiff' || p.ok === false ? 'whiff' : 'super'));
    on('game:kick', () => Audio.play('kick'));
    on('game:ability', (p) => { Audio.play('ability', { perfect: !!p.perfect, pitch: p.user === false ? 0.8 : 1 }); swell(0.4, 1.2); });
    on('game:abilityWarn', () => Audio.play('warn'));
    on('game:abilityArmed', (p) => { if (p.user !== false) Audio.play('starRing'); });
    on('game:audibleCall', () => Audio.play('pop'));
    on('game:batted', () => Audio.play('drop', { pitch: 1.4 }));
    on('game:recover', (p) => react(homeGood(p), false));
    on('game:overtime', () => Audio.play('whistle', { long: true }));
    on('game:edge', (p) => {                         // good:true "Great call!" → bell + sparkle, false → buzzer
      const good = p && (p.good != null ? !!p.good : p.edge > 0);
      if (good) { Audio.play('bell'); Audio.play('starRing', { vol: 0.5, pitch: 1.5 }); } else Audio.play('buzzer');
    });
    on('game:pause', (p) => Audio.duck(!!p.on));
    on('game:gameEnd', (p) => {
      A.endAt = (A.endAt || 0) + 1;
      Audio.play('whistle', { long: true });
      const won = A.game && p && p.box ? (A.game.user === p.box.h ? p.box.hs > p.box.as : A.game.user === p.box.a ? p.box.as > p.box.hs : false) : false;
      const tie = p && p.box && p.box.hs === p.box.as;
      if (won) { Audio.play('roar', { vol: 0.8 }); swell(0.8, 3); Audio.music(A.game && A.game.po >= 4 ? 'champion' : 'victory'); }   // songs open with their own fanfare
      else { Audio.play(tie ? 'groan' : 'aww', { vol: 0.7 }); swell(0.2, 2); Audio.music(tie ? 'hq2' : 'defeat'); }
    });
    on('ui:click', (p) => {
      const k = p && p.kind;
      if (k === 'level' && Audio.sting('levelUp', { duck: 0.5 }) > 0) return;
      if (k === 'trophy' && Audio.sting('achievement', { duck: 0.5 }) > 0) return;
      if (k === 'coin' && Audio.sting('coin', { duck: 0.7 }) > 0) return;
      Audio.play(k === 'back' ? 'back' : k === 'coin' ? 'coin' : k === 'next' ? 'pop' : k === 'error' ? 'error' : k === 'level' ? 'levelUp' : k === 'trophy' ? 'trophy' : 'click');
    });
    on('ui:modal', (p) => Audio.duck(!!(p && p.open)));
    on('ui:navigate', (p) => {
      const n = p && p.name;
      if (!n) return;
      A.screen = n;
      if (A.game || KEEP_SCREENS[n]) return;
      if (n === 'postgame' || n === 'quickpost') {    // '+N Coins' → coin stinger (queued after the fanfare)
        const c = userCoins();
        if (A.coins0 != null && c != null && c > A.coins0) Audio.sting('coin', { duck: 0.7 });
        A.coins0 = null;
      }
      if (RESULT_SCREENS[n] && STING_SONGS[A.wantMusic]) return;   // keep the victory / champion / defeat music
      Audio.music(screenSong(n));
    });
    on('league:phase', (p) => {
      const to = p && p.to;
      if (to === 'PRESEASON') Audio.sting('newSeason', { duck: 0.35 });
      if (!A.game && A.screen && !KEEP_SCREENS[A.screen] && !RESULT_SCREENS[A.screen]) Audio.music(screenSong(A.screen));
    });
    let lastPick = -9;
    on('league:draftPick', (p) => {                  // HUNT3 #3: auto draft batches → one fanfare
      if (!(PT.App && PT.App.L && p && p.tid === PT.App.L.userTid)) return;
      const now = A.ctx ? A.ctx.currentTime : 0;
      if (now - lastPick > 1) Audio.play('draftPick');
      lastPick = now;
    });
    on('league:signed', (p) => { if (PT.App && PT.App.L && p && p.tid === PT.App.L.userTid) Audio.play('signed'); });
    let lastToast = { bad: -9, good: -9 };
    on('ui:toast', (p) => {                          // HUNT3 #4: 'bad' → error, 'good' → soft blip (never on top of a jingle)
      const k = p && p.kind, now = A.ctx ? A.ctx.currentTime : 0;
      if (k === 'bad' && now - lastToast.bad > 0.4) { lastToast.bad = now; Audio.play('error', { vol: 0.8 }); }
      else if (k === 'good' && now - lastToast.good > 0.6 && now >= SQ.busy) { lastToast.good = now; Audio.play('blip'); }
    });
    on('league:levelUp', () => { if (!(Audio.sting('levelUp', { duck: 0.5 }) > 0)) Audio.play('levelUp'); });   // HUNT3 #1
    on('league:changed', (p) => {
      const w = p && p.what;
      if (A.game) return;
      if (w === 'facility') { if (!(Audio.sting('coin', { duck: 0.7 }) > 0)) Audio.play('coin'); }
      else if (w === 'staff' || w === 'trade') Audio.play('signed');
    });
    on('league:achievement', () => { if (!(Audio.sting('achievement', { duck: 0.5 }) > 0)) Audio.play('trophy'); });
    on('app:saveFailed', () => Audio.play('error'));
    on('app:visibility', (p) => { if (p.hidden) Audio.suspend(); else Audio.resume(); });
    on('app:prefs', (p) => { Audio.setVolumes({ sfx: p.sfx, music: p.music }); Audio.mute(!!p.muted); });
  }
})(globalThis.PT = globalThis.PT || {});
