// Faithful JS port of the read path of Intel IFX / U3D CIFXBitStreamX (arithmetic
// context codec) + IFXHistogramDynamic. See:
//   u3d/RTL/Component/BitStream/CIFXBitStreamX.cpp
//   u3d/RTL/Component/BitStream/IFXHistogramDynamic.cpp
// Exact bit-level behavior is required; do not "optimize".
'use strict';

const ACStaticFull = 0x00000400;
const ACMaxRange = ACStaticFull + 0x00003FFF;
const ACContext8 = 0;

const SWAP8 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const READ_COUNT = [4, 3, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
const FAST_NOT_MASK = [0xFFFFFFFF, 0x7FFF7FFF, 0x3FFF3FFF, 0x1FFF1FFF, 0x0FFF0FFF];

const HALF_MASK = 0x80008000;
const NOT_HALF_MASK = 0x7FFF7FFF;
const QUARTER_MASK = 0x40004000;
const NOT_THREE_QUARTER_MASK = 0x3FFF3FFF;

const MAX_SYMBOL_IN_HISTOGRAM = 0x0000FFFF;

class HistogramDynamic {
  constructor(elephant) {
    this.elephant = elephant;
    this.numSymbols = 100;
    this.counts = new Uint16Array(this.numSymbols);
    this.cum4 = new Uint16Array((this.numSymbols >> 2) + 1);
    this.counts[0] = 1;
    this.cum4[0] = 1;
  }

  getSymbolFreq(symbol) {
    if (symbol < this.numSymbols) return this.counts[symbol];
    return 0;
  }

  // Sum of freqs of all symbols less than `symbol`
  getCumSymbolFreq(symbol) {
    if (symbol <= this.numSymbols) {
      const count4 = this.cum4[symbol >> 2];
      let cum = this.cum4[0] - count4;
      for (let i = (symbol & ~3); i < symbol; i++) cum += this.counts[i];
      return cum;
    }
    return this.cum4[0];
  }

  getTotalSymbolFreq() {
    return this.cum4[0];
  }

  getSymbolFromFreq(cumFreq) {
    let symbol = 0;
    const total = this.cum4[0];
    if (cumFreq < total) {
      let low = 0;
      let high = this.numSymbols >> 2;
      // coarse binary search over cum4 (cum4[k] = sum of counts for symbols >= 4k)
      while ((high - low) > 4) {
        const mid = (low + low + low + high) >> 2;
        if (cumFreq >= (total - this.cum4[mid])) low = mid; else high = mid;
      }
      low <<= 2; high <<= 2; high += 3;
      while ((high - low) > 4) {
        const mid = (low + high) >> 1;
        if (cumFreq >= this.getCumSymbolFreq(mid)) low = mid; else high = mid;
      }
      for (let i = low; i <= high; i++) {
        if (cumFreq >= this.getCumSymbolFreq(i)) symbol = i; else break;
      }
    }
    return symbol;
  }

  addSymbol(symbol) {
    if (symbol > MAX_SYMBOL_IN_HISTOGRAM) return;

    // if necessary, scale down the counts
    if (this.cum4[0] >= this.elephant) {
      this.cum4.fill(0);
      for (let i = this.numSymbols; i > 0; i--) {
        this.counts[i - 1] >>= 1;
        this.cum4[(i - 1) >> 2] += this.counts[i - 1];
      }
      for (let i = (this.numSymbols >> 2); i > 0; i--) {
        this.cum4[i - 1] += this.cum4[i];
      }
      // but don't lose the escape
      this.counts[0] += 1;
      this.cum4[0] += 1;
    }

    // if necessary, reallocate the arrays
    if (symbol >= this.numSymbols) {
      const oldCounts = this.counts;
      const oldCum4 = this.cum4;
      const oldNum = this.numSymbols;
      this.numSymbols = symbol + 100;
      this.counts = new Uint16Array(this.numSymbols);
      this.cum4 = new Uint16Array((this.numSymbols >> 2) + 1);
      this.counts.set(oldCounts.subarray(0, oldNum));
      this.cum4.set(oldCum4.subarray(0, (oldNum >> 2) + 1));
    }

    this.counts[symbol] += 1;
    const top = symbol >> 2;
    for (let i = 0; i <= top; i++) this.cum4[i] += 1;
  }
}

class BitStreamRead {
  // data: Buffer/Uint8Array with the raw block payload
  constructor(data, elephant) {
    const nWords = ((data.length + 3) >> 2) + 5;
    this.data = new Uint32Array(nWords);
    // little endian packing
    for (let i = 0; i < data.length; i++) {
      this.data[i >> 2] |= data[i] << ((i & 3) << 3);
    }
    // ensure unsigned
    for (let i = 0; i < nWords; i++) this.data[i] = this.data[i] >>> 0;

    this.dataPosition = 0;
    this.dataBitOffset = 0;
    this.dataLocal = this.data[0];
    this.dataLocalNext = this.data[1];

    this.high = 0x0000FFFF;
    this.code = 0;
    this.low = 0;
    this.underflow = 0;
    this.elephant = (elephant === undefined) ? 0x00001FFF : elephant;
    this.contexts = new Map();
  }

  getContext(ctx) {
    let h = this.contexts.get(ctx);
    if (!h) {
      h = new HistogramDynamic(this.elephant);
      this.contexts.set(ctx, h);
    }
    return h;
  }

  getBitCount() {
    return this.dataPosition * 32 + this.dataBitOffset;
  }

  seekToBitReadOnly(position) {
    this.dataPosition = position >>> 5;
    this.dataBitOffset = position & 0x1f;
    this.dataLocal = this.data[this.dataPosition] >>> 0;
    this.dataLocalNext = this.data[this.dataPosition + 1] >>> 0;
  }

  incrementPosition() {
    this.dataPosition++;
    this.dataLocal = this.dataLocalNext;
    this.dataLocalNext = this.data[this.dataPosition + 1] >>> 0;
  }

  readBit() {
    let v = (this.dataLocal >>> this.dataBitOffset) & 1;
    this.dataBitOffset++;
    if (this.dataBitOffset >= 32) {
      this.dataBitOffset -= 32;
      this.incrementPosition();
    }
    return v;
  }

  read15Bits() {
    let v = this.dataLocal >>> this.dataBitOffset;
    if (this.dataBitOffset > 17) {
      v = (v | (this.dataLocalNext << (32 - this.dataBitOffset))) >>> 0;
    }
    v = (v + v) >>> 0;
    v = (SWAP8[(v >>> 12) & 0xf])
      | ((SWAP8[(v >>> 8) & 0xf]) << 4)
      | ((SWAP8[(v >>> 4) & 0xf]) << 8)
      | ((SWAP8[v & 0xf]) << 12);
    this.dataBitOffset += 15;
    if (this.dataBitOffset >= 32) {
      this.dataBitOffset -= 32;
      this.incrementPosition();
    }
    return v;
  }

  // --- symbol readers ---

  readSymbol(ctx) {
    if (ctx === ACContext8) {
      return this.readSymbolContextStatic(ACStaticFull + 256);
    } else if (ctx > ACStaticFull) {
      return this.readSymbolContextStatic(ctx);
    } else {
      return this.readSymbolContextDynamic(ctx);
    }
  }

  _fillCode() {
    const position = this.getBitCount();
    this.code = this.readBit();
    this.dataBitOffset += this.underflow;
    while (this.dataBitOffset >= 32) {
      this.dataBitOffset -= 32;
      this.incrementPosition();
    }
    const temp = this.read15Bits();
    this.code = (((this.code << 15) | temp) >>> 0);
    this.seekToBitReadOnly(position);
  }

  _updateStateAndAdvance(uLow, uHigh, twoFastSteps) {
    let state = ((uLow << 16) | uHigh) >>> 0;
    let bitCount;
    let masked;

    bitCount = READ_COUNT[(((uLow >>> 12) ^ (uHigh >>> 12)) & 0xF)];
    state = (state & FAST_NOT_MASK[bitCount]) >>> 0;
    state = (state << bitCount) >>> 0;
    state = (state | ((1 << bitCount) - 1)) >>> 0;

    if (twoFastSteps) {
      const bitCount2 = READ_COUNT[(((state >>> 12) ^ (state >>> 28)) & 0xF)];
      state = (state & FAST_NOT_MASK[bitCount2]) >>> 0;
      state = (state << bitCount2) >>> 0;
      bitCount += bitCount2;
      state = (state | ((1 << bitCount2) - 1)) >>> 0;
    }

    masked = (HALF_MASK & state) >>> 0;
    while (0 === masked || HALF_MASK === masked) {
      state = ((((NOT_HALF_MASK & state) << 1) | 1) >>> 0);
      masked = (HALF_MASK & state) >>> 0;
      bitCount++;
    }

    const savedBits = masked;

    if (bitCount > 0) {
      bitCount += this.underflow;
      this.underflow = 0;
    }

    masked = (QUARTER_MASK & state) >>> 0;
    let uf = 0;
    while (0x40000000 === masked) {
      state = (state & NOT_THREE_QUARTER_MASK) >>> 0;
      state = (state + state) >>> 0;
      state = (state | 1) >>> 0;
      masked = (QUARTER_MASK & state) >>> 0;
      uf++;
    }

    this.underflow += uf;
    state = (state | savedBits) >>> 0;
    this.low = state >>> 16;
    this.high = state & 0x0000FFFF;

    this.dataBitOffset += bitCount;
    while (this.dataBitOffset >= 32) {
      this.dataBitOffset -= 32;
      this.incrementPosition();
    }
  }

  readSymbolContextStatic(ctx) {
    this._fillCode();

    const numSymbols = ctx - ACStaticFull;
    const total = numSymbols;
    const range = this.high + 1 - this.low;
    const codeCumFreq = Math.floor((total * (1 + this.code - this.low) - 1) / range);
    const value = codeCumFreq + 1;
    const valueFreq = 1;
    const valueCumFreq = value - 1;

    const uLow0 = this.low;
    const uHigh = uLow0 - 1 + Math.floor(range * (valueCumFreq + valueFreq) / total);
    const uLow = uLow0 + Math.floor(range * valueCumFreq / total);

    this._updateStateAndAdvance(uLow, uHigh, true);
    return value;
  }

  readSymbolContextDynamic(ctx) {
    this._fillCode();

    const h = this.getContext(ctx);
    const total = h.getTotalSymbolFreq();
    const range = this.high + 1 - this.low;
    const codeCumFreq = Math.floor((total * (1 + this.code - this.low) - 1) / range);
    const value = h.getSymbolFromFreq(codeCumFreq);
    const valueCumFreq = h.getCumSymbolFreq(value);
    const valueFreq = h.getSymbolFreq(value);

    const uLow0 = this.low;
    const uHigh = uLow0 - 1 + Math.floor(range * (valueCumFreq + valueFreq) / total);
    const uLow = uLow0 + Math.floor(range * valueCumFreq / total);
    h.addSymbol(value);

    this._updateStateAndAdvance(uLow, uHigh, false);
    return value;
  }

  readSymbolContext8() {
    // no-compression fast path
    if (0x0000FFFF === this.high && 0 === this.low && 0 === this.underflow) {
      let v = this.dataLocal >>> this.dataBitOffset;
      if (this.dataBitOffset > 24) {
        v = (v | (this.dataLocalNext << (32 - this.dataBitOffset))) >>> 0;
      }
      v &= 0x000000FF;
      this.dataBitOffset += 8;
      if (this.dataBitOffset >= 32) {
        this.dataBitOffset -= 32;
        this.incrementPosition();
      }
      return v;
    }
    let v = this.readSymbolContextStatic(ACStaticFull + 256);
    v--;
    // SwapBits8
    return (SWAP8[v & 0xf] << 4) | (SWAP8[v >> 4]);
  }

  // --- uncompressed typed reads ---

  readU8() { return this.readSymbolContext8(); }

  readU16() {
    const lo = this.readU8();
    const hi = this.readU8();
    return lo | (hi << 8);
  }

  readU32() {
    const lo = this.readU16();
    const hi = this.readU16();
    return (lo | (hi << 16)) >>> 0;
  }

  readU64() {
    const lo = this.readU32();
    const hi = this.readU32();
    return hi * 0x100000000 + lo;
  }

  readI32() {
    return this.readU32() | 0;
  }

  readF32() {
    const u = this.readU32();
    const b = new ArrayBuffer(4);
    new Uint32Array(b)[0] = u;
    return new Float32Array(b)[0];
  }

  readString() {
    const len = this.readU16();
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.readU8());
    return s;
  }

  // --- compressed typed reads ---

  readCompressedU32(ctx) {
    if (ctx !== 0 && ctx < ACMaxRange) {
      const sym = this.readSymbol(ctx);
      if (sym !== 0) return sym - 1;
      const v = this.readU32();
      // C semantics: AddSymbol(uValue+1) on a u32 — 0xFFFFFFFF wraps to 0 and
      // increments the ESCAPE count. Reproduce the wrap for bit-exactness.
      if (!(ctx > ACStaticFull)) this.getContext(ctx).addSymbol((v + 1) >>> 0);
      return v;
    }
    return this.readU32();
  }

  readCompressedU16(ctx) {
    if (ctx !== 0 && ctx < ACMaxRange) {
      const sym = this.readSymbol(ctx);
      if (sym !== 0) return sym - 1;
      const v = this.readU16();
      if (!(ctx > ACStaticFull)) this.getContext(ctx).addSymbol(v + 1);
      return v;
    }
    return this.readU16();
  }

  readCompressedU8(ctx) {
    if (ctx !== 0 && ctx < ACMaxRange) {
      const sym = this.readSymbol(ctx);
      if (sym !== 0) return (sym - 1) & 0xFF;
      const v = this.readU8();
      if (!(ctx > ACStaticFull)) this.getContext(ctx).addSymbol(v + 1);
      return v;
    }
    return this.readU8();
  }
}

module.exports = { BitStreamRead, HistogramDynamic, ACStaticFull, ACMaxRange };
