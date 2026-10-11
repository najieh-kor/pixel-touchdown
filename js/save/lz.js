/* Pixel Touchdown: js/save/lz.js
 * Owner: WP6. Responsibility: LZ compression to UTF-16 (port of lz-string, MIT header).
 *
 * Port of lz-string 1.4.4 (compressToUTF16 / decompressFromUTF16 / compressToBase64 / decompressFromBase64).
 * Copyright (c) 2013 Pieroxy <pieroxy@pieroxy.net>
 * This work is free. You can redistribute it and/or modify it under the terms of the WTFPL, Version 2.
 * MIT License: Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
 * conditions: The above copyright notice and this permission notice shall be included in all copies or substantial
 * portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 * Changes: Map-based dictionaries, shared bit writer/reader helpers. Output is bit-identical to lz-string.
 */
(function (PT) {
  'use strict';
  const LZ = PT.LZ = PT.LZ || {};
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let b64rev = null;

  function compress(input, bitsPerChar, charOf) {
    if (input == null) return '';
    const dict = new Map();
    const toCreate = new Set();
    const out = [];
    let w = '', c = '', wc = '';
    let enlargeIn = 2, dictSize = 3, numBits = 2;
    let val = 0, pos = 0;

    function bits(n, v) {
      for (let i = 0; i < n; i++) {
        val = (val << 1) | (v & 1);
        v >>= 1;
        if (pos === bitsPerChar - 1) { pos = 0; out.push(charOf(val)); val = 0; } else pos++;
      }
    }
    function enlarge() {
      enlargeIn--;
      if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
    }
    function emitW() {
      if (toCreate.has(w)) {
        const code = w.charCodeAt(0);
        if (code < 256) { bits(numBits, 0); bits(8, code); }
        else { bits(numBits, 1); bits(16, code); }
        enlarge();
        toCreate.delete(w);
      } else {
        bits(numBits, dict.get(w));
      }
      enlarge();
    }

    for (let i = 0; i < input.length; i++) {
      c = input.charAt(i);
      if (!dict.has(c)) { dict.set(c, dictSize++); toCreate.add(c); }
      wc = w + c;
      if (dict.has(wc)) w = wc;
      else {
        emitW();
        dict.set(wc, dictSize++);
        w = c;
      }
    }
    if (w !== '') emitW();
    bits(numBits, 2);                       // end of stream
    for (;;) {                              // flush
      val = val << 1;
      if (pos === bitsPerChar - 1) { out.push(charOf(val)); break; } else pos++;
    }
    return out.join('');
  }

  function decompress(length, resetValue, next) {
    const dict = [0, 1, 2];
    const result = [];
    let enlargeIn = 4, dictSize = 4, numBits = 3, w, entry, c;
    const data = { val: next(0), position: resetValue, index: 1 };

    function read(n) {
      let b = 0, power = 1;
      const max = Math.pow(2, n);
      while (power !== max) {
        const resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) { data.position = resetValue; data.val = next(data.index++); }
        b |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      return b;
    }

    switch (read(2)) {
      case 0: c = String.fromCharCode(read(8)); break;
      case 1: c = String.fromCharCode(read(16)); break;
      case 2: return '';
    }
    dict[3] = c; w = c; result.push(c);
    for (;;) {
      if (data.index > length) return '';
      c = read(numBits);
      switch (c) {
        case 0: dict[dictSize++] = String.fromCharCode(read(8)); c = dictSize - 1; enlargeIn--; break;
        case 1: dict[dictSize++] = String.fromCharCode(read(16)); c = dictSize - 1; enlargeIn--; break;
        case 2: return result.join('');
      }
      if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
      if (dict[c]) entry = dict[c];
      else if (c === dictSize) entry = w + w.charAt(0);
      else return null;
      result.push(entry);
      dict[dictSize++] = w + entry.charAt(0);
      enlargeIn--;
      w = entry;
      if (enlargeIn === 0) { enlargeIn = Math.pow(2, numBits); numBits++; }
    }
  }

  /** @param {string} s @returns {string} UTF-16-safe compressed string (valid in localStorage) */
  LZ.compressToUTF16 = function (s) {
    if (s == null) return '';
    return compress(s, 15, (a) => String.fromCharCode(a + 32)) + ' ';
  };
  /** @param {string} s @returns {string|null} null when the data is damaged */
  LZ.decompressFromUTF16 = function (s) {
    if (s == null) return '';
    if (s === '') return null;
    return decompress(s.length, 16384, (i) => s.charCodeAt(i) - 32);
  };
  /** @param {string} s @returns {string} base64 (copy/paste-safe, for save export) */
  LZ.compressToBase64 = function (s) {
    if (s == null) return '';
    const r = compress(s, 6, (a) => B64.charAt(a));
    switch (r.length % 4) {
      case 1: return r + '===';
      case 2: return r + '==';
      case 3: return r + '=';
      default: return r;
    }
  };
  /** @param {string} s @returns {string|null} */
  LZ.decompressFromBase64 = function (s) {
    if (s == null) return '';
    if (s === '') return null;
    if (!b64rev) { b64rev = {}; for (let i = 0; i < B64.length; i++) b64rev[B64.charAt(i)] = i; }
    return decompress(s.length, 32, (i) => b64rev[s.charAt(i)]);
  };
})(globalThis.PT = globalThis.PT || {});
