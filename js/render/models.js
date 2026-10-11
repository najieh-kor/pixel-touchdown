/* Pixel Touchdown: js/render/models.js
 * Owner: WP4. Responsibility: per-species voxel model defs (parts, pivots, palette slots).
 *
 *   R.Models.def(sp, { num, acc, numbers }) → model def { sp, piv, parts[], hand, h, headTop }
 *   R.Models.palette(sp, cs, team)          → slot → hex resolver (fur A/B, team pri/sec/acc)
 *   R.Models.SPECIES[sp]                    → { size, A:[main,acc], B:[main,acc] } (design 3.3)
 *
 * Authoring space (voxel units, 1 v = 1/8 yd before size scale): feet at y = 0, face toward +z,
 * x = the animal's side. Parts are boxes { b:bone, c:[x,y,z] bone-relative center, s:[w,h,d], k:slot }.
 * Bone pivots: legs at the hips, body at the hips, head at the neck, arms at the shoulders, tail at the back.
 * Every species = the standard chunky biped (big cube head ≈ 45%, small jersey body, stubby legs)
 * + signature parts (trunk, horn, neck, shell, comb…). Team identity = jersey (pri), headband / number /
 * sleeve stripe (sec), pants (acc), so a mixed-species team still reads as one team (design 3.5).
 */
(function (PT) {
  'use strict';
  const R = PT.ns('Render');
  const M = R.Models = R.Models || {};
  const B = { root: 0, body: 1, head: 2, armL: 3, armR: 4, legL: 5, legR: 6, tail: 7 };

  // ---------------------------------------------------------------------------------------------
  // Species table (design 3.3): size class + fur color schemes A / B (main, accent)
  // ---------------------------------------------------------------------------------------------
  const SP = {
    elephant: ['L', 0x9AA3AD, 0xD9DDE2, 0xE7A6B9, 0xF7D9E2],
    rhino: ['L', 0x8C8F94, 0xC4C1B8, 0xB9A089, 0xE3D3C2],
    hippo: ['L', 0xA68BA8, 0xE8B7C8, 0x7D8CA3, 0xC7D2E0],
    bear: ['L', 0x7A4E2D, 0xC79A6B, 0xEDEDED, 0xBFD7E6],
    gorilla: ['L', 0x3B3B3F, 0x7E7A80, 0x5A4632, 0x9C8770],
    walrus: ['L', 0x9C6B4E, 0xEAD7C3, 0x6E5A4B, 0xF2EEE6],
    moose: ['L', 0x5B3A24, 0xD9C3A0, 0x3E2F25, 0xA68A64],
    bull: ['L', 0x6B3A2A, 0xF2E6D8, 0x2B2B2B, 0xE0E0E0],
    panda: ['L', 0xF4F4F4, 0x222222, 0xC0583C, 0x2C1B14],
    lion: ['L', 0xD9A441, 0x8C4A1E, 0xF1E3C5, 0xC9A25E],
    croc: ['L', 0x4F7942, 0xC9D88B, 0x7E8C54, 0xE8E2B8],
    giraffe: ['L', 0xE8B04A, 0x8A5A2B, 0xF2D7A1, 0xB5651D],
    ostrich: ['L', 0x2E2E2E, 0xF2D5D5, 0x8A7F72, 0xF5E8E0],
    penguin: ['M', 0x1F2A36, 0xF7F7F2, 0x3B4A5A, 0xFFE8A3],
    owl: ['M', 0x8B6B4A, 0xE9D8B4, 0xF5F5F5, 0xB8B8B8],
    fox: ['M', 0xE07A2F, 0xFFFFFF, 0xE8ECEF, 0x9FB3C8],
    wolf: ['M', 0x7D8590, 0xDADFE4, 0x3A3A3A, 0xA0A0A0],
    cheetah: ['M', 0xE9B949, 0x3A2A1A, 0xF3E2B3, 0x5A4632],
    kangaroo: ['M', 0xB5783F, 0xE8C9A0, 0x8E8E8E, 0xD6D2CC],
    turtle: ['M', 0x5E9E4B, 0xC9A86B, 0x3F7F7F, 0x8FB8A0],
    dog: ['M', 0xC88A4A, 0xF5E6D0, 0xFFFFFF, 0x333333],
    pig: ['M', 0xF4A9B8, 0xFAD4DC, 0x6B4A3A, 0xC9A890],
    goat: ['M', 0xEDEDE8, 0xA89F91, 0x6E5A46, 0xD8CBB8],
    eagle: ['M', 0x5A3E2B, 0xFFFFFF, 0x8A6B3E, 0xE6C88A],
    beaver: ['M', 0x7B4B2A, 0xD9A066, 0x5C3B23, 0xE8D2B0],
    raccoon: ['M', 0x8D8F96, 0x2C2C2C, 0xA88F7A, 0x3A2E26],
    monkey: ['M', 0x8A5A3B, 0xF0C9A0, 0xC9B79C, 0xF6E9D8],
    rabbit: ['S', 0xFFFFFF, 0xF7B6C8, 0xB58B63, 0xEFDCC5],
    frog: ['S', 0x6CC24A, 0xF0F5A0, 0x3FA7D6, 0xF7D046],
    chicken: ['S', 0xFFFFFF, 0xE63B2E, 0xD9A066, 0xE63B2E],
    duck: ['S', 0xFFD84D, 0xF28C28, 0xFFFFFF, 0xF28C28],
    cat: ['S', 0xF2A65A, 0xFFFFFF, 0x404040, 0xF2F2F2],
    hamster: ['S', 0xE9C08A, 0xFFFFFF, 0xC7C7C7, 0xFFFFFF],
    crab: ['S', 0xE8513A, 0xF7B79E, 0x4A90C2, 0xCBE4F2],
    squirrel: ['S', 0xB5652B, 0xF2D3B0, 0x6D6D6D, 0xD9D9D9]
  };
  M.SPECIES = {};
  Object.keys(SP).forEach((k) => { const v = SP[k]; M.SPECIES[k] = { size: v[0], A: [v[1], v[2]], B: [v[3], v[4]] }; });
  M.IDS = Object.keys(SP);

  // fixed palette slots
  const FIX = {
    k: 0x232327, e: 0x1B1B20, w: 0xFFFFFF, n: 0x3E2A22, pk: 0xF59AB0, pkd: 0xD9708A, o: 0xF7931E, y: 0xFFCF33,
    h: 0xF3EBD5, g: 0xFFC933, bow: 0xFF5FA2, red: 0xE63B2E, shell: 0xC9A86B, tooth: 0xFFFFFF, lens: 0x2B3A55,
    tongue: 0xF26D7D, dk: 0x4A3424
  };

  /**
   * Color resolver for one player.
   * @param {string} sp
   * @param {number} cs   0 = scheme A, 1 = scheme B
   * @param {{pri:number,sec:number,acc?:number,helm?:number,hstripe?:number}} team  kit: jersey, trim, pants, helmet, helmet stripe
   * @returns {function(string|number):number}
   */
  M.palette = function (sp, cs, team) {
    const s = M.SPECIES[sp] || M.SPECIES.dog;
    const fur = cs ? s.B : s.A;
    const V = R.Voxel;
    const pri = team ? team.pri : 0x3a6fd8, sec = team ? team.sec : 0xffffff;
    let acc = team && team.acc != null ? team.acc : (V.lum(pri) < 110 ? 0xffffff : 0x1b1f3a);
    // pants: team accent, but never identical to the jersey
    if (Math.abs(V.lum(acc) - V.lum(pri)) < 25) acc = V.shade(pri, 0.7);
    const helm = team && team.helm != null ? team.helm : pri;
    const map = {
      f: fur[0], a: fur[1], f2: V.shade(fur[0], 0.78), a2: V.shade(fur[1], 0.8), fl: V.mix(fur[0], 0xffffff, 0.3),
      j: pri, j2: V.shade(pri, V.lum(pri) > 200 ? 0.88 : 0.8), s: sec, p: acc,
      hm: helm, hm2: V.shade(helm, 0.82), hs: team && team.hstripe != null ? team.hstripe : sec
    };
    return function (k) {
      if (typeof k === 'number') return k;
      if (map[k] != null) return map[k];
      if (FIX[k] != null) return FIX[k];
      return 0xff00ff;
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Builder
  // ---------------------------------------------------------------------------------------------
  const DEF = {
    M: { legW: 2.4, legH: 3.4, legD: 2.8, legX: 1.7, footL: 0.6,
      bodyW: 7, bodyH: 5.6, bodyD: 5, headW: 8, headH: 7, headD: 7, headZ: 0.3,
      armW: 1.9, armH: 4.6, armD: 2.1 },
    L: { legW: 2.9, legH: 3.6, legD: 3.2, legX: 2.1, footL: 0.6,
      bodyW: 8.6, bodyH: 6.2, bodyD: 6, headW: 8.6, headH: 7.4, headD: 7.6, headZ: 0.4,
      armW: 2.3, armH: 5, armD: 2.5 },
    S: { legW: 2.1, legH: 2.8, legD: 2.4, legX: 1.4, footL: 0.6,
      bodyW: 6, bodyH: 4.8, bodyD: 4.4, headW: 7.6, headH: 6.8, headD: 6.8, headZ: 0.3,
      armW: 1.7, armH: 4, armD: 1.9 }
  };

  function mk(size, over) {
    const o = Object.assign({}, DEF[size], over || {});
    const parts = [];
    const b = {
      o: o, parts: parts,
      add(bone, x, y, z, w, h, d, k, r, m) { parts.push({ b: bone, c: [x, y, z], s: [w, h, d], k: k, r: r || null, m: m || 0, t: b.tag }); return b; },
      H(x, y, z, w, h, d, k, r, m) { return b.add(B.head, x, y, z, w, h, d, k, r, m); },
      HM(x, y, z, w, h, d, k, r, m) {
        b.add(B.head, x, y, z, w, h, d, k, r, m);
        return b.add(B.head, -x, y, z, w, h, d, k, r ? [r[0], -r[1], -r[2]] : null, m);
      },
      Bd(x, y, z, w, h, d, k, r, m) { return b.add(B.body, x, y, z, w, h, d, k, r, m); },
      BdM(x, y, z, w, h, d, k, r, m) {
        b.add(B.body, x, y, z, w, h, d, k, r, m);
        return b.add(B.body, -x, y, z, w, h, d, k, r ? [r[0], -r[1], -r[2]] : null, m);
      },
      Tl(x, y, z, w, h, d, k, r, m) { return b.add(B.tail, x, y, z, w, h, d, k, r, m); },
      /** both arms; x is outward-positive */
      A(x, y, z, w, h, d, k, r, m) {
        b.add(B.armL, x, y, z, w, h, d, k, r, m);
        return b.add(B.armR, -x, y, z, w, h, d, k, r ? [r[0], -r[1], -r[2]] : null, m);
      },
      /** both legs; x is outward-positive */
      Lg(x, y, z, w, h, d, k, r, m) {
        b.add(B.legL, x, y, z, w, h, d, k, r, m);
        return b.add(B.legR, -x, y, z, w, h, d, k, r ? [r[0], -r[1], -r[2]] : null, m);
      },
      drop(tag) { for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t === tag) parts.splice(i, 1); return b; },
      tag: ''
    };
    return b;
  }

  /** Standard skeleton + jersey. Options on b.o: furArms/legC/footC/handC/eyes/band/neck… */
  function std(b) {
    const o = b.o;
    const legH = o.legH, bodyH = o.bodyH;
    o.piv = {
      body: [0, legH, 0],
      head: [0, legH + bodyH + (o.neckY || 0), o.headZ],
      armL: [o.bodyW / 2 + o.armW / 2 - 0.15, legH + bodyH - 0.9, 0],
      armR: [-(o.bodyW / 2 + o.armW / 2 - 0.15), legH + bodyH - 0.9, 0],
      legL: [o.legX, legH, 0],
      legR: [-o.legX, legH, 0],
      tail: [0, legH + 1.2, -o.bodyD / 2 + 0.2]
    };
    const legC = o.legC || 'f', footC = o.footC || (o.legC || 'f2');
    // legs: fur, pants on the upper part, feet
    b.tag = 'leg';
    b.Lg(0, -legH / 2, 0, o.legW, legH, o.legD, legC);
    if (!o.noPants) {
      b.Lg(0, -legH * 0.36, 0, o.legW + 0.3, legH * 0.72, o.legD + 0.3, 'p');
      b.Lg(0, -legH * 0.62, 0, o.legW + 0.34, 0.36, o.legD + 0.34, 's');           // pants trim
    }
    b.tag = 'foot';
    b.Lg(0, -legH + 0.45, (o.footL || 0) / 2 + 0.15, o.legW + 0.25, 0.9, o.legD + (o.footL || 0) + 0.2, footC);
    // body = jersey
    b.tag = 'body';
    b.Bd(0, bodyH / 2, 0, o.bodyW, bodyH, o.bodyD, 'j');
    b.Bd(0, 0.35, 0, o.bodyW + 0.12, 0.7, o.bodyD + 0.12, 'j2');                        // belt line
    b.Bd(0, bodyH - 0.2, 0.3, Math.min(3.2, o.bodyW * 0.45), 0.5, o.bodyD - 0.2, 's');   // collar
    // arms: sleeve (jersey) + stripe (sec) + fur + paw
    b.tag = 'arm';
    const ah = o.armH, armC = o.armC || 'f', handC = o.handC || armC;
    b.A(0, -0.7, 0, o.armW + 0.35, 1.9, o.armD + 0.35, 'j');
    b.A(0, -1.75, 0, o.armW + 0.4, 0.45, o.armD + 0.4, 's');
    b.A(0, -ah / 2 - 0.4, 0, o.armW, ah - 0.8, o.armD, armC);
    b.A(0, -ah + 0.2, 0.05, o.armW + 0.15, 1.1, o.armD + 0.15, handC);
    // head
    b.tag = 'head';
    if (o.headBox !== false) {
      o.hb = { x: 0, y: o.headH / 2, z: 0, w: o.headW, h: o.headH, d: o.headD };
      b.H(0, o.headH / 2, 0, o.headW, o.headH, o.headD, o.headC || 'f');
    }
    o.hand = [0, -ah + 0.1, 0.6];
    return b;
  }

  /** standard eyes + headband on the head box b.o.hb */
  function face(b, opt) {
    opt = opt || {};
    const o = b.o, hb = o.hb;
    const fz = hb.z + hb.d / 2;
    const ey = opt.eyeY != null ? opt.eyeY : hb.y + hb.h * 0.08;
    const ex = opt.eyeX != null ? opt.eyeX : hb.w * 0.27;
    o.eye = { x: ex, y: ey, z: fz };
    b.tag = 'eye';
    if (opt.eyes !== false) {
      const ew = opt.eyeW || 1.1, eh = opt.eyeH || 1.4;
      b.HM(ex, ey, fz + 0.12, ew, eh, 0.3, 'e');
      b.HM(ex + ew * 0.18, ey + eh * 0.22, fz + 0.2, ew * 0.38, eh * 0.3, 0.2, 'w');
    }
    b.tag = 'band';
    if (opt.band !== false) {
      const by = opt.bandY != null ? opt.bandY : hb.y + hb.h * 0.36;
      o.band = by;
      b.H(hb.x, by, hb.z, hb.w + 0.4, 1, hb.d + 0.4, 's');
    }
    b.tag = '';
  }

  // ---------------------------------------------------------------------------------------------
  // Species
  // ---------------------------------------------------------------------------------------------
  const S = {};

  S.elephant = function () {
    const b = std(mk('L', { headW: 9, headH: 8, headD: 8, legW: 3.2, legX: 2.2, bodyW: 9.2, armW: 2.6, footC: 'a' }));
    const hw = 4.5, hh = 8, hd = 4;
    face(b, { eyeY: 4.6, eyeX: 2.5 });
    b.HM(hw + 1.6, 4.4, -1.4, 3.4, 6.8, 1.2, 'f');                 // big ears
    b.HM(hw + 1.7, 4.3, -0.72, 2.4, 5.2, 0.2, 'a');
    b.HM(hw + 3.2, 4.4, -1.4, 0.4, 5.2, 1.2, 'f2');
    b.H(0, 2.6, hd + 0.7, 2.8, 2.8, 1.6, 'f');                     // trunk
    b.H(0, 0.9, hd + 1.3, 2.4, 2.4, 1.7, 'f');
    b.H(0, -0.6, hd + 2.0, 2.0, 2.0, 1.8, 'f');
    b.H(0, -1.4, hd + 3.0, 1.8, 1.4, 1.6, 'f');
    b.H(0, -1.4, hd + 3.85, 1.4, 1.2, 0.3, 'f2');
    b.HM(1.9, 1.1, hd + 0.9, 0.8, 0.8, 2.2, 'h');                  // tusks
    b.Tl(0, -0.8, -0.4, 0.7, 2.8, 0.7, 'f');
    b.Tl(0, -2.5, -0.4, 1.1, 1, 1.1, 'f2');
    void hh;
    return b;
  };

  S.rhino = function () {
    const b = std(mk('L', { headW: 8, headH: 7, headD: 8.6, bodyW: 9, legW: 3, footC: 'f2' }));
    const hd = 4.3, hh = 7;
    face(b, { eyeY: 4.1, eyeX: 3.2, eyeW: 0.9, eyeH: 1.1 });
    b.H(0, 2.2, hd + 1.4, 6, 4.2, 2.8, 'f');                       // snout
    b.H(0, 0.6, hd + 1.4, 5.2, 1, 2.6, 'f2');
    b.HM(1.2, 2.6, hd + 2.85, 0.8, 0.8, 0.2, 'n');
    b.H(0, 5, hd + 2.0, 2, 2.6, 2, 'a');                          // horn
    b.H(0, 6.8, hd + 2.2, 1.3, 1.6, 1.3, 'a');
    b.H(0, 7.9, hd + 2.4, 0.7, 1, 0.7, 'a');
    b.H(0, 4.2, hd + 0.4, 1.5, 1.8, 1.5, 'a');                     // small horn
    b.HM(2.9, hh + 0.9, -2.4, 1.4, 2.2, 1, 'f');                   // ears
    b.HM(2.9, hh + 0.8, -1.85, 0.8, 1.4, 0.2, 'a');
    b.Tl(0, -0.8, -0.3, 0.6, 2.4, 0.6, 'f');
    return b;
  };

  S.hippo = function () {
    const b = std(mk('L', { headW: 9.6, headH: 6.6, headD: 8, bodyW: 9.4, bodyD: 6.4, legW: 3.1 }));
    const hd = 4, hh = 6.6;
    face(b, { eyes: false, bandY: 4.6 });
    b.H(0, 1.9, hd + 1.5, 9.2, 3.8, 3.2, 'a');                    // big muzzle
    b.H(0, 0.3, hd + 1.4, 8.4, 0.6, 3.0, 'f2');                   // mouth line
    b.HM(1.8, 3.6, hd + 3.12, 1.1, 0.7, 0.2, 'n');                 // nostrils
    b.HM(3, -0.2, hd + 2.7, 1, 1.2, 0.6, 'w');                     // teeth
    b.HM(2.6, hh + 0.4, 1.0, 2.2, 1.6, 2.2, 'f');                  // eye bumps
    b.HM(2.6, hh + 0.45, 2.15, 1.1, 1.1, 0.2, 'e');
    b.HM(2.85, hh + 0.75, 2.27, 0.4, 0.4, 0.1, 'w');
    b.HM(3.6, hh + 0.6, -2, 1.5, 1.3, 1, 'f');                     // ears
    b.HM(3.6, hh + 0.55, -1.45, 0.8, 0.8, 0.2, 'a');
    b.Tl(0, -0.5, -0.3, 0.8, 1.8, 0.8, 'f');
    return b;
  };

  S.bear = function () {
    const b = std(mk('L', { headW: 8.6, headH: 7.4, headD: 7.4, handC: 'f2' }));
    const hd = 3.7, hh = 7.4;
    face(b, { eyeY: 4.4, eyeX: 2.3 });
    b.H(0, 2.4, hd + 0.9, 3.8, 2.8, 1.8, 'a');                     // snout
    b.H(0, 3.3, hd + 1.9, 1.8, 1.1, 0.5, 'n');
    b.H(0, 1.6, hd + 1.85, 1.6, 0.3, 0.2, 'n');
    b.HM(3.2, hh + 0.9, -0.8, 2.4, 2.2, 1.4, 'f');                 // round ears
    b.HM(3.2, hh + 0.8, -0.05, 1.3, 1.2, 0.2, 'a');
    b.Tl(0, -0.2, -0.4, 1.6, 1.6, 1.2, 'f');
    return b;
  };

  S.gorilla = function () {
    const b = std(mk('L', { headW: 7.8, headH: 7, headD: 7, armW: 3, armH: 6.4, armD: 3, legH: 3.2, legW: 2.8, handC: 'a', footC: 'a' }));
    const hd = 3.5, hh = 7;
    face(b, { eyeY: 4.2, eyeX: 1.6, eyeW: 1, eyeH: 1 });
    b.H(0, 3.2, hd + 0.15, 6, 5, 0.4, 'a');                        // face plate
    b.H(0, 1.6, hd + 0.8, 4.6, 2.4, 1.4, 'a');                     // muzzle
    b.HM(0.8, 2.3, hd + 1.55, 0.7, 0.5, 0.2, 'k');
    b.H(0, 5.1, hd + 0.6, 6.6, 1.2, 1.4, 'f');                     // brow
    b.H(0, hh + 0.35, -0.9, 1.8, 0.7, 4.6, 'f');                    // crest
    b.HM(4.1, 3.8, 0, 0.6, 1.6, 1.4, 'a');                          // ears
    return b;
  };

  S.walrus = function () {
    const b = std(mk('L', { headW: 8.4, headH: 7, headD: 7.6, bodyW: 9.4, bodyD: 6.4, handC: 'f2', armW: 2.6 }));
    const hd = 3.8;
    face(b, { eyeY: 4.8, eyeX: 2.4, eyeW: 1, eyeH: 1.1 });
    b.H(0, 2.4, hd + 0.9, 6.4, 3.2, 1.8, 'a');                     // whisker muzzle
    b.HM(1.6, 2.6, hd + 1.85, 0.4, 0.4, 0.1, 'f2');
    b.HM(2.6, 2.0, hd + 1.85, 0.4, 0.4, 0.1, 'f2');
    b.HM(0.8, 1.6, hd + 1.85, 0.4, 0.4, 0.1, 'f2');
    b.H(0, 3.9, hd + 1.6, 1.8, 0.9, 0.5, 'n');
    b.HM(1.5, -0.4, hd + 1.4, 0.9, 4, 0.9, 'h');                   // tusks
    b.Tl(0, -2.4, -0.6, 3.6, 0.8, 2, 'f2');                         // flipper tail
    return b;
  };

  S.moose = function () {
    const b = std(mk('L', { headW: 7.6, headH: 7.2, headD: 7.4, footC: 'n' }));
    const hd = 3.7, hh = 7.2;
    face(b, { eyeY: 4.8, eyeX: 2.4 });
    b.H(0, 2.3, hd + 1.6, 5, 3.8, 3.2, 'f');                       // long muzzle
    b.H(0, 3.3, hd + 3.25, 3.8, 1.6, 0.2, 'f2');
    b.HM(1.0, 2.8, hd + 3.25, 0.8, 0.7, 0.2, 'n');
    b.H(0, -0.6, hd - 0.4, 1.6, 2.2, 1.2, 'f');                     // dewlap
    b.HM(2.4, hh + 0.7, -0.6, 1.1, 1.6, 1.1, 'a');                 // antler stems
    b.HM(5.0, hh + 1.6, -0.6, 4.4, 1, 3.4, 'a');                   // palms
    b.HM(6.8, hh + 2.6, 0.6, 0.9, 1.8, 0.9, 'a');
    b.HM(5.2, hh + 2.6, -1.6, 0.9, 1.6, 0.9, 'a');
    b.HM(3.6, hh + 2.5, 0.6, 0.9, 1.4, 0.9, 'a');
    b.HM(4.4, hh - 1.4, -1.6, 2, 1, 1.2, 'f');                      // ears
    b.Tl(0, -0.2, -0.4, 1.2, 1.4, 0.8, 'f');
    return b;
  };

  S.bull = function () {
    const b = std(mk('L', { headW: 8.4, headH: 7.4, headD: 7.4, footC: 'k' }));
    const hd = 3.7, hh = 7.4;
    face(b, { eyeY: 4.6, eyeX: 2.5 });
    b.H(0, 2.0, hd + 0.9, 6.2, 3.4, 1.8, 'a');                     // muzzle
    b.HM(1.4, 2.6, hd + 1.85, 1.1, 1, 0.2, 'n');
    b.H(0, 0.9, hd + 1.95, 2, 1.6, 0.3, 'g');                       // nose ring
    b.H(0, 1.3, hd + 1.98, 1, 0.8, 0.3, 'a');
    b.HM(5.4, hh - 1.4, 0, 2.6, 1.5, 1.5, 'h');                    // horns
    b.HM(6.5, hh + 0.2, 0, 1.3, 2.4, 1.3, 'h');
    b.HM(6.5, hh + 1.8, 0.2, 0.9, 1.0, 0.9, 'a2');
    b.HM(4.6, hh - 3.0, -1.4, 1.6, 1, 1.6, 'f');                    // ears
    b.H(0, hh + 0.4, 0.2, 3.4, 0.8, 3, 'f2');                       // tuft
    b.Tl(0, -1, -0.3, 0.6, 3, 0.6, 'f');
    b.Tl(0, -2.8, -0.3, 1, 1, 1, 'f2');
    return b;
  };

  S.panda = function () {
    const b = std(mk('L', { headW: 8.8, headH: 7.6, headD: 7.4, armC: 'a', legC: 'a', footC: 'a', bodyW: 9 }));
    const hd = 3.7, hh = 7.6;
    face(b, { eyes: false });
    b.HM(2.3, 3.9, hd + 0.12, 2.6, 2.6, 0.3, 'a');                 // eye patches
    b.HM(2.3, 4.2, hd + 0.3, 1, 1.1, 0.2, 'w');
    b.HM(2.4, 4.2, hd + 0.4, 0.55, 0.6, 0.1, 'e');
    b.H(0, 1.9, hd + 0.5, 3.6, 2.2, 1, 'f');                       // snout
    b.H(0, 2.6, hd + 1.05, 1.6, 0.9, 0.3, 'a');
    b.HM(3.3, hh + 0.8, -0.6, 2.4, 2.2, 1.4, 'a');                 // ears
    b.Tl(0, -0.2, -0.4, 1.4, 1.4, 1, 'f');
    return b;
  };

  S.lion = function () {
    const b = std(mk('L', { headW: 8, headH: 7.2, headD: 7.2, handC: 'f' }));
    const hd = 3.6, hh = 7.2;
    face(b, { eyeY: 4.2, eyeX: 2.2, band: false });
    b.H(0, hh / 2 + 0.3, -0.9, 10.8, 9.8, 5.4, 'a');                // mane (shaggy, layered)
    b.H(0, hh / 2 + 0.3, -3.8, 8.2, 7.4, 1.0, 'a2');
    b.H(0, hh + 1.9, -1.0, 3.2, 1.2, 3.8, 'a');                      // top tufts
    b.HM(3.7, hh + 1.6, -1.1, 2.4, 1.0, 3.2, 'a');
    b.HM(5.8, 3.0, -1.0, 1.2, 4.2, 3.6, 'a');                         // side tufts
    b.HM(5.8, 6.4, -1.4, 1.0, 2.2, 2.8, 'a2');
    b.H(0, -1.0, -0.4, 6.4, 1.4, 4.2, 'a');                          // chin ruff
    b.H(-0.6, 6.6, -4.4, 6.4, 1.3, 0.8, 'a');                         // back tufts (rows)
    b.H(0.5, 3.9, -4.4, 7.0, 1.3, 0.8, 'a');
    b.H(-0.3, 1.3, -4.4, 5.6, 1.3, 0.8, 'a');
    b.tag = 'band';
    b.H(0, 5.6, 0.2, 8.4, 1, 7.6, 's');                              // headband over the mane line
    b.tag = '';
    b.H(0, 2.0, hd + 0.7, 3.8, 2.4, 1.4, 'fl');                     // snout
    b.H(0, 2.9, hd + 1.45, 1.6, 0.9, 0.3, 'n');
    b.HM(2.9, hh + 2.0, 0.4, 1.8, 1.6, 1.2, 'f');                   // ears
    b.Tl(0, -0.6, -0.8, 0.7, 0.7, 2.6, 'f');                        // tail + tuft
    b.Tl(0, -1.6, -2.4, 0.7, 2, 0.7, 'f');
    b.Tl(0, -3.0, -2.4, 1.4, 1.4, 1.4, 'a');
    b.o.band = 5.6;
    return b;
  };

  S.croc = function () {
    const b = std(mk('L', { headW: 7.4, headH: 4.8, headD: 7, neckY: 0.4, handC: 'f2' }));
    const hd = 3.5, hh = 4.8;
    face(b, { eyes: false, bandY: 3.3 });
    b.H(0, 1.7, hd + 3.0, 6.2, 2.6, 6, 'f');                        // upper jaw
    b.H(0, 0.2, hd + 2.4, 5.6, 1.0, 4.8, 'a');                       // lower jaw
    for (let i = 0; i < 3; i++) b.HM(2.75, 0.5, hd + 1.2 + i * 1.6, 0.5, 0.7, 0.5, 'w');
    b.HM(1.1, 3.1, hd + 5.4, 0.8, 0.5, 0.8, 'f2');                   // nostrils
    b.HM(2.2, hh + 0.6, 1.2, 2.2, 1.6, 2.2, 'f');                   // eye bumps
    b.HM(2.2, hh + 0.7, 2.35, 1.2, 1.1, 0.2, 'y');
    b.HM(2.2, hh + 0.7, 2.45, 0.5, 1.0, 0.1, 'e');
    // tail resting on the ground with ridges
    b.Tl(0, -1.4, -1.6, 3.4, 2.6, 3.2, 'f');
    b.Tl(0, -2.6, -4.2, 2.6, 1.8, 3, 'f');
    b.Tl(0, -3.3, -6.4, 1.8, 1.2, 2.4, 'f');
    b.Tl(0, 0.2, -1.6, 1, 0.8, 2.4, 'f2');
    b.Tl(0, -1.4, -4.2, 0.8, 0.8, 2.2, 'f2');
    b.Bd(0, b.o.bodyH * 0.6, -b.o.bodyD / 2 - 0.25, 1, 3.4, 0.5, 'f2');
    return b;
  };

  S.giraffe = function () {
    const b = std(mk('L', { headBox: false, bodyW: 7.6, bodyD: 5.6, legH: 4.2, legW: 2.4, legX: 1.8, armW: 2, footC: 'n', neckY: -0.6 }));
    const o = b.o;
    // long neck + small head, all on the head bone (the whole neck sways)
    b.tag = 'head';
    b.H(0, 4.2, 0, 3.2, 9, 3.2, 'f');
    b.H(0, 5, -1.75, 0.8, 8.4, 0.6, 'a');                           // mane
    b.H(1.65, 2.6, 0.4, 0.2, 1.4, 1.4, 'a'); b.H(-1.65, 4.6, -0.3, 0.2, 1.6, 1.2, 'a');
    b.H(1.65, 6.6, -0.4, 0.2, 1.2, 1.4, 'a'); b.H(-1.65, 1.4, 0.6, 0.2, 1.2, 1.2, 'a');
    b.H(0.6, 3.4, 1.65, 1.2, 1.4, 0.2, 'a'); b.H(-0.5, 6.2, 1.65, 1.4, 1.2, 0.2, 'a');
    o.hb = { x: 0, y: 10.6, z: 0.8, w: 5.6, h: 4.8, d: 6 };
    b.H(0, 10.6, 0.8, 5.6, 4.8, 6, 'f');
    b.H(0, 9.4, 4.4, 4.2, 2.6, 1.8, 'fl');                            // snout
    b.HM(1, 9.8, 5.35, 0.6, 0.6, 0.2, 'n');
    face(b, { eyeY: 11.2, eyeX: 1.7, bandY: 12.3 });
    b.HM(1.4, 14.0, 0.2, 0.8, 1.6, 0.8, 'a');                       // ossicones
    b.HM(1.4, 15.0, 0.2, 1.1, 0.8, 1.1, 'a2');
    b.HM(3.4, 12.0, -0.4, 1.8, 0.9, 1.1, 'f');                       // ears
    b.Bd(1.8, 3.2, -o.bodyD / 2 - 0.1, 1.6, 1.4, 0.2, 'a');
    b.Tl(0, -1.2, -0.3, 0.5, 3, 0.5, 'f');
    b.Tl(0, -3, -0.3, 0.9, 1, 0.9, 'a');
    o.headTop = o.legH + o.bodyH + 15.4;
    return b;
  };

  S.ostrich = function () {
    const b = std(mk('L', { headBox: false, legH: 6.6, legW: 1.3, legD: 1.3, legX: 1.7, legC: 'a', footC: 'a', footL: 1.4, noPants: true,
      bodyW: 8, bodyH: 5.6, bodyD: 6.4, armW: 1.4, armD: 4, armH: 4.2 }));
    const o = b.o;
    b.Lg(0, -0.6, 0, 2.6, 1.6, 2.6, 'p');                            // thigh pants
    b.Bd(0, 0.2, 0, o.bodyW + 0.8, 1.4, o.bodyD + 0.8, 'f');         // feather skirt
    b.tag = 'head';
    b.H(0, 0.6, 0, 4.4, 1.6, 4, 'f');                                 // feather collar
    b.H(0, 3.6, 0, 1.6, 6, 1.6, 'a');                                  // neck
    o.hb = { x: 0, y: 8.0, z: 0.4, w: 4.6, h: 4.4, d: 4.6 };
    b.H(0, 8.0, 0.4, 4.6, 4.4, 4.6, 'a');
    b.H(0, 7.0, 3.4, 2.4, 1.1, 2.4, 'o');                              // beak
    b.H(0, 6.55, 3.3, 2.0, 0.3, 2.0, 0xD9771A);
    b.H(0, 10.5, -0.2, 1.2, 1.0, 1.6, 'f');                            // little head tuft
    face(b, { eyeY: 8.2, eyeX: 1.3, eyeW: 1.1, eyeH: 1.4, bandY: 9.55 });
    b.Tl(0, -0.3, -1.4, 4.6, 2.6, 2.4, 'w');                           // plume (low, below the number)
    b.Tl(0, 0.9, -2.6, 3.2, 1.8, 1.4, 'w');
    b.Tl(0, -0.6, -2.8, 2.2, 1.4, 1.0, 0xE8E8E8);
    o.headTop = o.legH + o.bodyH + 10.6;
    return b;
  };

  S.penguin = function () {
    const b = std(mk('M', { legH: 2.2, legW: 2.2, footC: 'o', footL: 1.6, armW: 1.2, armD: 2.8, armH: 4.6, noPants: true, headD: 7.2 }));
    const hd = 3.6;
    face(b, { eyeY: 4.2, eyeX: 1.9, eyeW: 1, eyeH: 1.2 });
    b.H(0, 3.0, hd + 0.08, 6.2, 5, 0.3, 'a');                        // white face mask
    b.H(0, 2.7, hd + 0.9, 2.4, 1.2, 1.8, 'o');                       // beak
    b.H(0, 2.2, hd + 0.9, 2.0, 0.4, 1.6, 0xD9771A);
    b.Bd(0, -0.4, 0, b.o.bodyW - 0.6, 1.2, b.o.bodyD - 0.6, 'a');      // belly bottom
    b.Lg(0, -0.4, 0, 2.6, 1, 2.8, 'p');
    b.Tl(0, -1.4, -0.4, 2.4, 0.6, 1.4, 'f');
    return b;
  };

  S.owl = function () {
    const b = std(mk('M', { headW: 8.6, headH: 7.4, headD: 7, footC: 'o', armW: 1.5, armD: 3, armH: 5 }));
    const hd = 3.5, hh = 7.4;
    face(b, { eyes: false, bandY: 6.3 });
    b.H(0, 3.4, hd + 0.08, 7.2, 4.8, 0.3, 'a');                       // facial disc
    b.HM(1.9, 3.8, hd + 0.3, 2.8, 2.8, 0.3, 'y');                     // big eyes
    b.HM(1.9, 3.8, hd + 0.5, 1.4, 1.5, 0.2, 'e');
    b.HM(2.3, 4.3, hd + 0.62, 0.5, 0.5, 0.1, 'w');
    b.H(0, 2.2, hd + 0.6, 1.2, 1.8, 1.2, 0xE0962F);                   // beak
    b.HM(3.4, hh + 1.0, -0.4, 1.8, 2.2, 1.6, 'f');                    // ear tufts
    b.HM(3.9, hh + 2.4, -0.6, 1, 1.4, 1, 'f2');
    b.Tl(0, -1.6, -0.4, 3, 1.6, 1.4, 'f2');
    return b;
  };

  S.fox = function () {
    const b = std(mk('M', { headW: 7.8, headH: 6.6, headD: 7, footC: 'k', handC: 'k' }));
    const hd = 3.5, hh = 6.6;
    face(b, { eyeY: 3.8, eyeX: 2.0, eyeW: 1, eyeH: 1.2 });
    b.H(0, 1.6, hd + 1.2, 3.2, 2.2, 2.4, 'a');                        // snout
    b.H(0, 2.4, hd + 2.5, 1.2, 0.9, 0.5, 'k');
    b.HM(2.7, 1.6, hd - 0.3, 2.4, 2.4, 1, 'a');                       // cheeks
    b.HM(2.6, hh + 1.4, -0.8, 2.4, 2.8, 1.2, 'f');                     // ears
    b.HM(2.6, hh + 3.2, -0.8, 1.4, 1, 1, 'k');
    b.HM(2.6, hh + 1.2, -0.15, 1.2, 1.8, 0.2, 'a');
    b.Tl(0, 0.4, -1.4, 2.8, 2.8, 3.0, 'f');                            // big bushy tail, swept up
    b.Tl(0, 2.0, -3.6, 3.6, 3.6, 2.6, 'f');
    b.Tl(0, 3.8, -5.0, 3.0, 3.0, 1.8, 'a');
    return b;
  };

  S.wolf = function () {
    const b = std(mk('M', { headW: 7.8, headH: 6.8, headD: 7.2, footC: 'f2' }));
    const hd = 3.6, hh = 6.8;
    face(b, { eyeY: 4.0, eyeX: 2.0, eyeW: 1, eyeH: 1.1 });
    b.H(0, 4.9, hd + 0.2, 5.4, 0.7, 0.4, 'f2');                       // brow
    b.H(0, 1.8, hd + 1.4, 3.4, 2.6, 2.8, 'a');                        // long snout
    b.H(0, 2.8, hd + 2.9, 1.4, 1, 0.5, 'k');
    b.H(0, 0.9, hd + 1.2, 2.6, 0.4, 2.4, 'f2');
    b.HM(3.9, 1.6, hd - 1.6, 1.2, 2.6, 2.4, 'a');                     // cheek fluff
    b.HM(2.6, hh + 1.5, -1.0, 2.2, 3, 1.2, 'f');                       // ears
    b.HM(2.6, hh + 1.3, -0.35, 1.0, 1.8, 0.2, 'a');
    b.Tl(0, 0.0, -1.4, 2.6, 2.6, 3.2, 'f');
    b.Tl(0, -0.6, -3.8, 2.6, 2.6, 2.4, 'f');
    b.Tl(0, -1.2, -5.4, 1.8, 1.8, 1.4, 'a');
    return b;
  };

  S.cheetah = function () {
    const b = std(mk('M', { headW: 7.4, headH: 6.6, headD: 6.8, legW: 2.1, legH: 3.8 }));
    const hd = 3.4, hh = 6.6;
    face(b, { eyeY: 3.9, eyeX: 1.9, eyeW: 1, eyeH: 1.2 });
    b.HM(1.9, 2.4, hd + 0.12, 0.5, 2.4, 0.3, 'a');                    // tear marks
    b.H(0, 1.7, hd + 0.6, 3.2, 2, 1.2, 'fl');
    b.H(0, 2.4, hd + 1.25, 1.2, 0.8, 0.3, 'k');
    b.HM(3.0, hh + 0.6, -1.2, 1.8, 1.4, 1, 'f');                       // small round ears
    b.H(2.4, hh + 0.05, 1.2, 1, 0.2, 1, 'a'); b.H(-1.4, hh + 0.05, -1.6, 1, 0.2, 1, 'a');
    b.H(3.75, 3.2, -1, 0.2, 1, 1, 'a'); b.H(-3.75, 3.6, 0.6, 0.2, 1, 1, 'a');
    b.A(1.0, -3.4, 0, 0.2, 0.8, 0.8, 'a');
    b.Lg(1.1, -2.6, 0.4, 0.2, 0.8, 0.8, 'a');
    b.Tl(0, -0.6, -1.6, 0.9, 0.9, 3.2, 'f');                           // long thin tail with rings
    b.Tl(0, -0.6, -2.4, 1.0, 1.0, 0.5, 'a');
    b.Tl(0, -0.2, -3.6, 0.9, 1.6, 0.9, 'f');
    b.Tl(0, 0.6, -3.6, 1.0, 0.5, 1.0, 'a');
    return b;
  };

  S.kangaroo = function () {
    const b = std(mk('M', { headW: 7, headH: 6.6, headD: 7, footL: 3, legW: 2.6, legH: 3.6, footC: 'f2', armH: 4, armW: 1.6 }));
    const hd = 3.5, hh = 6.6;
    face(b, { eyeY: 3.9, eyeX: 1.9, eyeW: 1, eyeH: 1.2 });
    b.H(0, 1.9, hd + 1.0, 3.4, 2.6, 2, 'f');
    b.H(0, 2.8, hd + 2.05, 1.4, 0.8, 0.3, 'k');
    b.HM(2.3, hh + 1.9, -1.0, 2.1, 4, 1.2, 'f', [0, 0, -0.12]);         // tall ears
    b.HM(2.4, hh + 1.9, -0.36, 1.1, 3, 0.2, 'a', [0, 0, -0.12]);
    b.Tl(0, -1.6, -1.6, 2.8, 2.8, 3.4, 'f');                            // thick tail on the ground
    b.Tl(0, -3.6, -4.2, 2.2, 1.6, 3, 'f');
    b.Bd(0, 1.8, b.o.bodyD / 2 + 0.1, 3.4, 1.8, 0.3, 'a');              // pouch peeking under the jersey
    return b;
  };

  S.turtle = function () {
    const b = std(mk('M', { headW: 6.6, headH: 6, headD: 6.6, legH: 2.8, legW: 2.6, bodyW: 7.2, bodyD: 5, footC: 'f2', neckY: 0.3 }));
    const o = b.o, hd = 3.3, hh = 6;
    face(b, { eyeY: 3.5, eyeX: 1.8, eyeW: 1, eyeH: 1.2 });
    b.H(0, 1.6, hd + 0.08, 2.6, 0.4, 0.3, 'f2');                         // smile
    b.H(0, hh + 0.3, 0, 4, 0.6, 4, 'f');                                  // round top
    // shell on the back (body bone)
    const sz = -o.bodyD / 2 - 1.3;
    b.Bd(0, o.bodyH * 0.55, sz, o.bodyW + 1.6, o.bodyH + 1.8, 2.6, 'a');
    b.Bd(0, o.bodyH * 0.55, sz - 1.4, o.bodyW - 0.6, o.bodyH - 0.6, 0.6, 'a');
    b.Bd(0, o.bodyH * 0.55, sz - 1.75, 2.4, 2.4, 0.2, 'a2');
    b.BdM(2.4, o.bodyH * 0.55 + 1.6, sz - 1.65, 1.6, 1.6, 0.2, 'a2');
    b.BdM(2.4, o.bodyH * 0.55 - 1.6, sz - 1.65, 1.6, 1.6, 0.2, 'a2');
    b.Bd(0, -0.2, sz + 0.2, o.bodyW + 2, 0.8, 3, 'a2');                     // shell rim
    o.numBackZ = sz - 2.1;
    b.Tl(0, -0.6, -2.6, 1, 0.8, 1.4, 'f');
    return b;
  };

  S.dog = function () {
    const b = std(mk('M', { headW: 7.6, headH: 6.8, headD: 7 }));
    const hd = 3.5, hh = 6.8;
    face(b, { eyeY: 4.0, eyeX: 2.0, eyeW: 1.1, eyeH: 1.3 });
    b.H(-2.0, 4.1, hd + 0.08, 2.6, 2.8, 0.2, 'a');                       // eye patch
    b.H(0, 1.8, hd + 1.1, 3.6, 2.6, 2.2, 'a');                           // snout
    b.H(0, 2.9, hd + 2.3, 1.6, 1.1, 0.6, 'k');
    b.H(0, 0.6, hd + 1.6, 1.2, 0.6, 1.2, 'tongue');
    b.HM(4.3, 3.6, -0.6, 1.2, 4.4, 3, 'f2');                              // floppy ears
    b.Tl(0, 1.2, -0.6, 1.1, 3, 1.1, 'f');
    b.Tl(0, 2.9, -0.4, 1.2, 0.8, 1.2, 'a');
    return b;
  };

  S.pig = function () {
    const b = std(mk('M', { headW: 8, headH: 6.8, headD: 7, footC: 'n' }));
    const hd = 3.5, hh = 6.8;
    face(b, { eyeY: 4.1, eyeX: 2.4, eyeW: 1, eyeH: 1.2 });
    b.H(0, 2.3, hd + 0.7, 3.8, 2.8, 1.4, 'a');                           // snout disc
    b.HM(0.8, 2.3, hd + 1.45, 0.7, 1.1, 0.2, 'pkd');
    b.HM(2.9, hh + 0.3, 0.6, 2.4, 1.4, 2, 'f2', [0.5, 0, 0]);              // ears flop forward
    b.Tl(0, 0.3, -0.6, 0.8, 0.8, 1.2, 'f');                               // curly tail
    b.Tl(0, 0.9, -1.3, 0.8, 1.2, 0.8, 'f');
    b.Tl(0, 1.5, -0.9, 0.8, 0.8, 0.8, 'f');
    return b;
  };

  S.goat = function () {
    const b = std(mk('M', { headW: 7, headH: 7, headD: 6.8, footC: 'n' }));
    const hd = 3.4, hh = 7;
    face(b, { eyeY: 4.3, eyeX: 2.0, eyeW: 1.1, eyeH: 0.9 });
    b.H(0, 1.7, hd + 0.8, 3.6, 3, 1.6, 'f');
    b.HM(0.8, 2.6, hd + 1.65, 0.6, 0.6, 0.2, 'n');
    b.H(0, -0.9, hd + 0.4, 1.4, 2.6, 1, 'a');                             // beard
    b.HM(1.8, hh + 0.9, -0.6, 1.2, 2, 1.2, 'a');                          // horns curl back
    b.HM(2.0, hh + 1.6, -1.8, 1.1, 1.0, 1.8, 'a');
    b.HM(2.0, hh + 1.1, -2.9, 1, 1.2, 0.8, 'a2');
    b.HM(4.6, hh - 2.6, -0.8, 2.4, 1, 1.4, 'f');                          // sideways ears
    b.Tl(0, 0.6, -0.4, 1.2, 1.6, 1, 'f');
    return b;
  };

  S.eagle = function () {
    const b = std(mk('M', { headW: 7.4, headH: 6.8, headD: 7, headC: 'a', footC: 'y', armW: 1.6, armD: 3.4, armH: 5.2 }));
    const hd = 3.5;
    face(b, { eyeY: 4.0, eyeX: 2.1, eyeW: 1.1, eyeH: 1.1 });
    b.HM(2.0, 4.8, hd + 0.15, 2.2, 0.6, 0.3, 'f2');                      // fierce brows
    b.H(0, 2.8, hd + 1.0, 2.2, 1.6, 2, 'y');                              // hooked beak
    b.H(0, 1.9, hd + 1.7, 1.6, 1.2, 0.9, 'y');
    b.H(0, 2.0, hd + 0.3, 2.6, 0.8, 0.8, 0xE0A800);
    b.Tl(0, -0.6, -1.3, 4.2, 1, 3, 'a');                                   // white tail fan
    b.A(0, -b.o.armH + 0.2, -1.2, 1.4, 1.4, 1, 'f2');                    // wing tips
    return b;
  };

  S.beaver = function () {
    const b = std(mk('M', { headW: 7.6, headH: 6.6, headD: 7, footC: 'dk' }));
    const hd = 3.5, hh = 6.6;
    face(b, { eyeY: 4.1, eyeX: 2.2, eyeW: 1, eyeH: 1.1 });
    b.H(0, 2.1, hd + 0.6, 3.8, 2.2, 1.2, 'a');
    b.H(0, 2.9, hd + 1.25, 1.4, 0.8, 0.3, 'k');
    b.H(0, 0.6, hd + 0.75, 1.9, 1.8, 0.6, 'w');                            // buck teeth
    b.H(0, 0.6, hd + 1.06, 0.2, 1.8, 0.1, 0xCCCCCC);
    b.HM(3.1, hh + 0.4, -1, 1.5, 1.2, 1, 'f');
    b.Tl(0, -1.6, -2.6, 4.2, 0.9, 5.4, 'dk', [-0.35, 0, 0]);                 // paddle tail, tilted up
    b.Tl(0, -1.05, -2.75, 2.8, 0.1, 4, 0x6A4E38, [-0.35, 0, 0]);
    b.Tl(0, -0.2, -0.6, 1.6, 1.2, 1.6, 'dk');
    return b;
  };

  S.raccoon = function () {
    const b = std(mk('M', { headW: 7.8, headH: 6.6, headD: 7, handC: 'a', footC: 'a' }));
    const hd = 3.5, hh = 6.6;
    face(b, { eyes: false });
    b.H(0, 3.8, hd + 0.12, 8.0, 2.2, 0.3, 'a');                            // mask
    b.HM(2.0, 3.9, hd + 0.3, 0.9, 1, 0.2, 'w');
    b.HM(2.1, 3.9, hd + 0.4, 0.5, 0.6, 0.1, 'e');
    b.HM(2.0, 5.3, hd + 0.1, 2.2, 0.6, 0.2, 'w');                          // white brows
    b.H(0, 1.9, hd + 0.8, 3.2, 2, 1.6, 'w');
    b.H(0, 2.6, hd + 1.65, 1.2, 0.8, 0.3, 'k');
    b.HM(2.8, hh + 1.0, -1, 2.2, 2.2, 1, 'f');
    b.HM(2.8, hh + 1.8, -0.4, 1.2, 1, 0.2, 'w');
    for (let i = 0; i < 4; i++) b.Tl(0, 0.4 + i * 0.4, -1.4 - i * 1.3, 2.4 - i * 0.15, 2.4 - i * 0.15, 1.3, i % 2 ? 'a' : 'f');
    return b;
  };

  S.monkey = function () {
    const b = std(mk('M', { headW: 7.4, headH: 6.6, headD: 6.8, handC: 'a', footC: 'a', armH: 5.4 }));
    const hd = 3.4, hh = 6.6;
    face(b, { eyeY: 4.0, eyeX: 1.6, eyeW: 1, eyeH: 1.2 });
    b.H(0, 3.0, hd + 0.08, 5.6, 5, 0.3, 'a');                             // face
    b.H(0, 1.6, hd + 0.6, 4.2, 2.2, 1, 'a');                              // muzzle
    b.HM(0.6, 2.2, hd + 1.15, 0.5, 0.4, 0.1, 'n');
    b.H(0, 1.1, hd + 1.15, 2, 0.3, 0.1, 'n');
    b.HM(4.3, 3.8, 0, 1.2, 2.6, 2, 'a');                                  // round side ears
    b.H(0, hh + 0.2, 0.6, 2.4, 0.8, 2.4, 'f');
    b.Tl(0, 0.0, -1.6, 0.9, 0.9, 3, 'f');                                 // curly tail
    b.Tl(0, 1.6, -2.8, 0.9, 3.2, 0.9, 'f');
    b.Tl(0, 3.4, -2.2, 0.9, 0.9, 2, 'f');
    return b;
  };

  S.rabbit = function () {
    const b = std(mk('S', { headW: 7, headH: 6.6, headD: 6.6, footL: 1.6 }));
    const hd = 3.3, hh = 6.6;
    face(b, { eyeY: 3.8, eyeX: 1.9, eyeW: 1, eyeH: 1.3 });
    b.H(0, 2.5, hd + 0.3, 1.3, 0.9, 0.5, 'a');                             // nose
    b.H(0, 1.3, hd + 0.2, 1.4, 1.1, 0.4, 'w');                             // teeth
    b.HM(1.6, hh + 3.0, -1, 1.8, 6.2, 1.2, 'f', [0, 0, 0.12]);              // long ears
    b.HM(1.75, hh + 2.8, -0.35, 1.0, 4.8, 0.2, 'a', [0, 0, 0.12]);
    b.Tl(0, 0.2, -0.6, 2.2, 2.2, 1.6, 'w');
    return b;
  };

  S.frog = function () {
    const b = std(mk('S', { headW: 8.6, headH: 5, headD: 6.8, legW: 2.3, legX: 1.8, footL: 1.4, footC: 'f2', handC: 'f' }));
    const hd = 3.4, hh = 5;
    face(b, { eyes: false, bandY: 3.4 });
    b.HM(2.6, hh + 1.0, 1.0, 2.8, 2.6, 2.8, 'f');                          // bulging eyes on top
    b.HM(2.6, hh + 1.1, 2.45, 2.0, 1.8, 0.2, 'w');
    b.HM(2.6, hh + 1.0, 2.6, 1.0, 1.2, 0.15, 'e');
    b.H(0, 1.4, hd + 0.08, 6.4, 0.45, 0.3, 'f2');                          // wide grin
    b.HM(3.3, 1.7, hd + 0.08, 0.5, 0.7, 0.3, 'f2');
    b.HM(3.3, 2.2, hd + 0.05, 1.2, 0.8, 0.2, 'pk');                        // blush
    b.H(0, 0.4, hd - 2.0, 7.6, 0.8, 4.2, 'a');                             // throat
    return b;
  };

  S.chicken = function () {
    const b = std(mk('S', { headW: 6.4, headH: 7.4, headD: 6.4, legW: 1.2, legD: 1.2, legH: 3.0, legC: 'o', footC: 'o', footL: 1.6,
      noPants: true, bodyW: 6, bodyD: 4.6, armW: 1.4, armD: 3, armH: 4 }));
    const hd = 3.2, hh = 7.4;
    b.Lg(0, -0.4, 0, 2.2, 1.0, 2.4, 'p');
    face(b, { eyeY: 4.6, eyeX: 2.0, eyeW: 0.9, eyeH: 1.1 });
    b.H(0, hh + 0.8, 0.5, 1.4, 1.6, 3.6, 'a');                             // comb
    b.H(0, hh + 1.9, -0.5, 1.4, 1.2, 1.4, 'a');
    b.H(0, hh + 2.0, 1.4, 1.4, 1.0, 1.2, 'a');
    b.H(0, 3.5, hd + 0.8, 1.9, 1.3, 1.6, 'o');                             // beak
    b.H(0, 2.2, hd + 0.4, 1.1, 1.5, 0.8, 'a');                             // wattle
    b.Tl(0, 1.0, -0.8, 3, 3, 1.8, 'f');                                     // tail feathers
    b.Tl(0, 2.4, -1.2, 2, 1.6, 1.2, 'f');
    return b;
  };

  S.duck = function () {
    const b = std(mk('S', { headW: 6.8, headH: 6.8, headD: 6.6, legW: 1.4, legD: 1.4, legC: 'a', footC: 'a', footL: 1.8, noPants: true, armW: 1.4, armD: 3 }));
    const hd = 3.3, hh = 6.8;
    b.Lg(0, -0.4, 0, 2.3, 1.0, 2.4, 'p');
    face(b, { eyeY: 4.3, eyeX: 1.9, eyeW: 1, eyeH: 1.2 });
    b.H(0, 2.5, hd + 1.3, 4.2, 1.2, 2.8, 'a');                              // flat bill
    b.H(0, 1.8, hd + 1.1, 3.6, 0.5, 2.2, 'a2');
    b.HM(0.8, 3.15, hd + 2.0, 0.5, 0.15, 0.6, 'a2');
    b.H(0, hh + 0.6, -0.4, 0.9, 1.2, 1.6, 'f');                              // tuft
    b.Tl(0, 1.0, -0.6, 2.6, 1.6, 1.8, 'f');
    return b;
  };

  S.cat = function () {
    const b = std(mk('S', { headW: 7.4, headH: 6.4, headD: 6.6 }));
    const hd = 3.3, hh = 6.4;
    face(b, { eyeY: 3.6, eyeX: 2.0, eyeW: 1.1, eyeH: 1.3 });
    b.H(0, 1.8, hd + 0.4, 3.2, 2, 0.8, 'a');                                // muzzle
    b.H(0, 2.6, hd + 0.85, 1.1, 0.6, 0.3, 'pk');
    b.HM(2.6, 2.0, hd + 0.9, 2.4, 0.2, 0.2, 'k');                           // whiskers
    b.HM(2.6, 1.5, hd + 0.9, 2.4, 0.2, 0.2, 'k');
    b.HM(2.6, hh + 1.0, -0.6, 2.2, 2.0, 1.2, 'f');                           // pointy ears
    b.HM(2.6, hh + 0.9, 0.05, 1.1, 1.2, 0.2, 'pk');
    b.H(0, hh + 0.02, 0.4, 1, 0.1, 2, 'f2'); b.HM(1.6, hh + 0.02, 0.6, 0.6, 0.1, 1.6, 'f2');
    b.Tl(0, 1.4, -0.6, 1.0, 3.4, 1.0, 'f');                                  // tail up
    b.Tl(0, 3.4, -0.1, 1.0, 1.0, 1.8, 'f');
    return b;
  };

  S.hamster = function () {
    const b = std(mk('S', { headW: 8, headH: 6.4, headD: 7, bodyW: 6.8, bodyD: 5, legH: 2.2, footC: 'pk', handC: 'pk', armH: 3.4 }));
    const hd = 3.5, hh = 6.4;
    face(b, { eyeY: 3.8, eyeX: 2.0, eyeW: 1, eyeH: 1.2 });
    b.HM(3.9, 1.9, 1.4, 1.4, 2.8, 3.4, 'a');                                 // puffy cheeks
    b.H(0, 1.8, hd + 0.3, 3.2, 2.2, 0.6, 'a');
    b.H(0, 2.6, hd + 0.65, 0.9, 0.6, 0.3, 'pk');
    b.H(0, 1.0, hd + 0.62, 1.0, 0.8, 0.3, 'w');
    b.HM(2.7, hh + 0.5, -0.6, 1.6, 1.2, 1, 'f');                             // tiny ears
    b.HM(2.7, hh + 0.45, -0.05, 1.0, 0.7, 0.2, 'pk');
    return b;
  };

  S.crab = function () {
    const b = std(mk('S', { headW: 9.4, headH: 4.6, headD: 6.4, legW: 1.4, legD: 1.4, legX: 1.8, legC: 'f', footC: 'f2', noPants: true,
      bodyW: 6.6, bodyH: 4.4, armW: 1.4, armD: 1.4, armH: 3.2, neckY: -0.2 }));
    const hd = 3.2, hh = 4.6;
    b.Lg(0, -0.4, 0, 2.1, 1.0, 2.0, 'p');
    face(b, { eyes: false, bandY: 2.6 });
    b.HM(1.6, hh + 1.2, 1.4, 0.6, 2.4, 0.6, 'f');                            // eye stalks
    b.HM(1.6, hh + 2.8, 1.4, 1.6, 1.6, 1.6, 'w');
    b.HM(1.6, hh + 2.8, 2.25, 0.8, 0.9, 0.15, 'e');
    b.H(0, 1.2, hd + 0.08, 3, 0.4, 0.3, 'f2');
    b.HM(5.2, 1.2, 0.4, 1.4, 0.7, 0.8, 'f', [0, 0, -0.5]);                   // little side legs
    b.HM(5.2, 1.2, -1.4, 1.4, 0.7, 0.8, 'f', [0, 0, -0.5]);
    b.HM(4.8, 2.4, -0.3, 0.6, 0.3, 4, 'a');
    // big claws at the end of the arms
    b.A(0.3, -b.o.armH - 0.6, 0.6, 3.2, 2.8, 3.4, 'f');
    b.A(0.3, -b.o.armH + 0.3, 1.2, 2.4, 0.6, 1.6, 'a');
    b.A(1.0, -b.o.armH - 2.4, 1.4, 1.2, 1.6, 1.4, 'f');
    b.A(-0.4, -b.o.armH - 2.6, 1.4, 1.2, 2.0, 1.4, 'f2');
    b.o.hand = [0, -b.o.armH - 1, 1.6];
    return b;
  };

  S.squirrel = function () {
    const b = std(mk('S', { headW: 7.2, headH: 6.4, headD: 6.6 }));
    const hd = 3.3, hh = 6.4;
    face(b, { eyeY: 3.8, eyeX: 2.0, eyeW: 1.1, eyeH: 1.3 });
    b.H(0, 1.8, hd + 0.4, 3, 2, 0.8, 'a');
    b.H(0, 2.5, hd + 0.85, 1, 0.6, 0.3, 'k');
    b.H(0, 1.0, hd + 0.85, 1.1, 0.7, 0.3, 'w');
    b.HM(2.4, hh + 1.0, -0.8, 1.6, 2, 1, 'f');                               // tufted ears
    b.HM(2.4, hh + 2.3, -1.0, 0.8, 1.0, 0.8, 'f2');
    b.Tl(0, -0.2, -1.6, 2.2, 2.2, 2.6, 'f');                                  // giant bushy tail (curls over)
    b.Tl(0, 2.2, -3.4, 3.2, 3.6, 2.8, 'f');
    b.Tl(0, 5.6, -3.8, 3.8, 3.8, 3.2, 'f');
    b.Tl(0, 8.6, -3.0, 3.6, 2.8, 3.4, 'f');
    b.Tl(0, 9.4, -1.0, 3.0, 2.0, 2.4, 'f');
    b.Tl(0, 8.9, 0.4, 2.4, 1.6, 1.6, 'a');
    b.Tl(0, 5.6, -5.5, 2.6, 2.6, 0.4, 'f2');
    return b;
  };

  // ---------------------------------------------------------------------------------------------
  // Numbers (3×5 pixel font, run-merged into few boxes) and accessories
  // ---------------------------------------------------------------------------------------------
  const FONT = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111']
  };
  M.FONT = FONT;

  function numberParts(b, num, z, front) {
    const o = b.o;
    const s = String(Math.max(0, Math.min(99, num | 0)));
    const px = Math.min(0.62, (o.bodyW - 1.4) / (s.length * 4 - 1)) * (front ? 0.75 : 1);
    const totalW = (s.length * 4 - 1) * px;
    const cy = o.bodyH * (front ? 0.52 : 0.55);
    for (let d = 0; d < s.length; d++) {
      const g = FONT[s[d]];
      for (let row = 0; row < 5; row++) {
        const line = g[row];
        let c = 0;
        while (c < 3) {
          if (line[c] !== '1') { c++; continue; }
          let e = c;
          while (e < 3 && line[e] === '1') e++;
          const run = e - c;
          // x: viewer-left → right. Back is seen from behind (−z), so mirror x on the back.
          const lx = -totalW / 2 + (d * 4 + c + run / 2) * px;
          const x = front ? -lx : lx;
          const y = cy + (2 - row) * px;
          b.Bd(x, y, z, run * px, px, 0.16, 's');
          c = e;
        }
      }
    }
  }

  /** football helmet shell in the team kit (replaces the headband): shell + center stripe + ear dots */
  function helmetParts(b) {
    const o = b.o, hb = o.hb;
    const top = hb.y + hb.h / 2;
    const hh = Math.max(1.6, hb.h * 0.36) + 0.3;
    const cy = top + 0.3 - hh / 2;
    b.tag = 'helmet';
    b.H(hb.x, cy, hb.z - 0.1, hb.w + 0.55, hh, hb.d + 0.6, 'hm');
    b.H(hb.x, cy - hh / 2 + 0.12, hb.z - 0.1, hb.w + 0.62, 0.26, hb.d + 0.66, 'hm2');            // rim
    b.H(hb.x, top + 0.33, hb.z - 0.1, Math.min(1.3, hb.w * 0.17), 0.12, hb.d + 0.64, 'hs');     // stripe over the top
    b.H(hb.x, cy, hb.z - 0.1 - (hb.d + 0.6) / 2 - 0.04, Math.min(1.3, hb.w * 0.17), hh - 0.1, 0.1, 'hs');
    b.HM(hb.w / 2 + 0.3, cy - hh * 0.05, hb.z + 0.4, 0.1, 0.7, 0.7, 'hs');                     // ear dots
    o.band = cy;
    b.tag = '';
  }

  function accessory(b, acc) {
    const o = b.o, hb = o.hb;
    if (!acc || !hb) return;
    const top = hb.y + hb.h / 2, fz = hb.z + hb.d / 2;
    b.tag = 'acc';
    if (acc === 'band') {
      b.A(0, -o.armH + 1.4, 0.05, o.armW + 0.45, 0.8, o.armD + 0.45, 'w');
    } else if (acc === 'shades') {
      const ey = o.eye ? o.eye.y : hb.y + hb.h * 0.1;
      b.H(hb.x, ey, fz + 0.32, Math.min(hb.w - 0.4, (o.eye ? o.eye.x * 2 + 2.2 : hb.w - 1)), 1.4, 0.3, 'k');
      b.H(hb.x, ey + 0.35, fz + 0.5, 0.6, 0.3, 0.1, 0x6E7B94);
      b.HM((o.eye ? o.eye.x : 2) + 0.3, ey + 0.3, fz + 0.5, 0.5, 0.3, 0.1, 0x8FA3C7);
    } else if (acc === 'bow') {
      b.H(hb.x + hb.w * 0.25, top + 0.5, hb.z + 0.6, 1.6, 1.3, 0.8, 'bow');
      b.H(hb.x + hb.w * 0.25 - 1.5, top + 0.5, hb.z + 0.6, 1.6, 1.3, 0.8, 'bow');
      b.H(hb.x + hb.w * 0.25 - 0.75, top + 0.5, hb.z + 0.6, 0.8, 0.9, 1.0, 0xE0418A);
    } else if (acc === 'cap') {
      b.H(hb.x, top + 0.55, hb.z, hb.w + 0.3, 1.3, hb.d + 0.3, 'j');
      b.H(hb.x, top + 0.15, hb.z - hb.d / 2 - 1.1, hb.w - 2.4, 0.4, 2.2, 'j2');
      b.H(hb.x, top + 1.3, hb.z, 0.9, 0.4, 0.9, 's');
    } else if (acc === 'chain') {
      b.Bd(0, o.bodyH - 0.6, o.bodyD / 2 + 0.1, 3.2, 0.5, 0.3, 'g');
      b.Bd(0, o.bodyH - 1.4, o.bodyD / 2 + 0.15, 1, 1, 0.3, 'g');
    } else if (acc === 'headset') {
      b.H(hb.x, top + 0.25, hb.z, 0.5, 0.5, hb.d * 0.5, 'k');                                   // band over the top
      b.HM(hb.w / 2 + 0.25, hb.y + hb.h * 0.1, hb.z, 0.5, 1.6, 1.6, 'k');                       // ear cups
      b.H(hb.x + hb.w / 2 + 0.3, hb.y - hb.h * 0.15, hb.z + hb.d * 0.3, 0.25, 0.25, hb.d * 0.55, 0x444444);   // mic boom
      b.H(hb.x + hb.w / 2 - 0.2, hb.y - hb.h * 0.15, fz + 0.15, 0.5, 0.5, 0.4, 'k');
    } else if (acc === 'pompom') {
      // fluffy pom-poms in both hands (team colours)
      b.A(0, -o.armH - 0.2, 0.3, 1.9, 1.9, 1.9, 's');
      b.A(0.5, -o.armH - 0.7, 0.6, 1.1, 1.1, 1.1, 'j');
    } else if (acc === 'camera') {
      // big press camera held in front (right hand) + lens
      b.add(B.armR, 0.2, -o.armH + 0.2, 1.8, 2.2, 2.0, 2.6, 'k');
      b.add(B.armR, 0.2, -o.armH + 0.2, 3.6, 1.2, 1.2, 1.4, 0x3a3a44);
      b.add(B.armR, 0.2, -o.armH + 1.5, 1.4, 0.8, 0.6, 0.8, 0x666677);
    } else if (acc === 'crown') {
      b.H(hb.x, top + 0.6, hb.z, hb.w * 0.6, 1, hb.d * 0.6, 'g');
      b.HM(hb.w * 0.22, top + 1.4, hb.z, 0.7, 0.8, 0.7, 'g');
    }
    b.tag = '';
  }

  // ---------------------------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------------------------
  const baseCache = new Map();
  function base(sp) {
    if (!S[sp]) sp = 'dog';
    let d = baseCache.get(sp);
    if (!d) {
      const b = S[sp]();
      const o = b.o;
      // headband / face helpers need hb; species that skipped face() still get eyes+band
      if (o.hb && !o.eye) face(b);
      d = {
        sp: sp, parts: b.parts.slice(), o: o,
        h: o.headTop || (o.legH + o.bodyH + (o.neckY || 0) + o.headH)
      };
      baseCache.set(sp, d);
    }
    return d;
  }

  /**
   * Model def for one player.
   * @param {string} sp
   * @param {{num?:number, acc?:string|null, numbers?:boolean, front?:boolean, helmet?:boolean}} [opts]  helmet default on
   */
  M.def = function (sp, opts) {
    opts = opts || {};
    const bs = base(sp);
    const o = bs.o;
    const b = mk('M');
    b.o = o;
    const parts = b.parts;
    const helmet = opts.helmet !== false && o.hb;
    for (let i = 0; i < bs.parts.length; i++) if (!(helmet && bs.parts[i].t === 'band')) parts.push(bs.parts[i]);
    if (helmet) helmetParts(b);
    if (opts.numbers !== false && opts.num != null && opts.num >= 0) {
      numberParts(b, opts.num, o.numBackZ != null ? o.numBackZ : -o.bodyD / 2 - 0.06, false);
      if (opts.front !== false) numberParts(b, opts.num, o.bodyD / 2 + 0.06, true);
    }
    if (opts.acc && !(helmet && (opts.acc === 'cap' || opts.acc === 'bow' || opts.acc === 'crown'))) accessory(b, opts.acc);
    // convert part centers to bone-relative where the species authored head/arm/leg/tail parts:
    // all builders already author bone-relative coordinates, so only body parts need the body pivot (0).
    return {
      sp: bs.sp, parts: parts, piv: o.piv, hand: o.hand, h: bs.h,
      headTop: bs.h, band: o.band, size: (M.SPECIES[bs.sp] || {}).size || 'M'
    };
  };

  /** size class for a species (S/M/L) */
  M.size = function (sp) { return (M.SPECIES[sp] || M.SPECIES.dog).size; };
  /** whether a species id has a model */
  M.has = function (sp) { return !!S[sp]; };
  /** dance style per species (design 19.4) */
  M.dance = function (sp) {
    if (sp === 'rabbit' || sp === 'frog' || sp === 'kangaroo') return 'hop';
    if (sp === 'chicken' || sp === 'duck' || sp === 'eagle' || sp === 'owl' || sp === 'penguin' || sp === 'ostrich') return 'flap';
    if (sp === 'cat' || sp === 'fox') return 'spin';
    if (sp === 'dog') return 'wag';
    if (sp === 'monkey' || sp === 'squirrel') return 'flip';
    return M.size(sp) === 'L' ? 'stomp' : 'hop';
  };
})(globalThis.PT = globalThis.PT || {});
