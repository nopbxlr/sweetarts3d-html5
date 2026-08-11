// Roundtrip test: JS port of CIFXBitStreamX write path + compare with reader.
'use strict';
const { BitStreamRead, HistogramDynamic, ACStaticFull, ACMaxRange } = require('./bitstream');

const SWAP8 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const HALF = 0x00008000, QUARTER = 0x00004000;

class BitStreamWrite {
  constructor() {
    this.data = new Uint32Array(1024);
    this.pos = 0; this.off = 0;
    this.high = 0xFFFF; this.low = 0; this.underflow = 0;
    this.contexts = new Map();
    this.compressed = false;
  }
  ensure() { if (this.pos + 2 >= this.data.length) { const d = new Uint32Array(this.data.length * 2); d.set(this.data); this.data = d; } }
  getContext(ctx) {
    let h = this.contexts.get(ctx);
    if (!h) { h = new HistogramDynamic(0x1FFF); this.contexts.set(ctx, h); }
    return h;
  }
  writeBit(v) {
    this.ensure();
    v &= 1;
    this.data[this.pos] = (this.data[this.pos] & ~(1 << this.off)) >>> 0;
    this.data[this.pos] = (this.data[this.pos] | (v << this.off)) >>> 0;
    this.off += 1;
    if (this.off >= 32) { this.off -= 32; this.pos++; }
  }
  swap8(v) { return ((SWAP8[v & 0xf] << 4) | SWAP8[v >> 4]); }
  writeSymbolStatic(ctx, value) {
    const total = ctx - ACStaticFull;
    const valueCumFreq = value - 1, valueFreq = 1;
    const range = this.high + 1 - this.low;
    this.high = (this.low - 1 + Math.floor(range * (valueCumFreq + valueFreq) / total)) >>> 0;
    this.low = (this.low + Math.floor(range * valueCumFreq / total)) >>> 0;
    this._emit();
  }
  _emit() {
    let bit = this.low >>> 15;
    while (((this.high & HALF) === (this.low & HALF))) {
      this.high = (this.high & ~HALF) >>> 0;
      this.high = (this.high + this.high + 1) >>> 0;
      this.writeBit(bit);
      while (this.underflow > 0) { this.underflow--; this.writeBit((~bit) & 1); }
      this.low = (this.low & ~HALF) >>> 0;
      this.low = (this.low + this.low) >>> 0;
      bit = this.low >>> 15;
    }
    while ((0 === (this.high & QUARTER)) && (QUARTER === (this.low & QUARTER))) {
      this.high = (this.high & ~HALF) >>> 0;
      this.high = (this.high << 1) >>> 0;
      this.low = (this.low << 1) >>> 0;
      this.high = (this.high | HALF | 1) >>> 0;
      this.low = (this.low & ~HALF) >>> 0;
      this.underflow++;
    }
    this.high &= 0xFFFF; this.low &= 0xFFFF;
  }
  writeSymbolDynamic(ctx, value) { // returns escape bool
    const h = this.getContext(ctx);
    let total = h.getTotalSymbolFreq();
    let valueCumFreq = h.getCumSymbolFreq(value);
    let valueFreq = h.getSymbolFreq(value);
    let escape = false;
    let v = value;
    if (0 === valueFreq) {
      v = 0;
      valueCumFreq = h.getCumSymbolFreq(0);
      valueFreq = h.getSymbolFreq(0);
    }
    if (0 === v) escape = true;
    const range = this.high + 1 - this.low;
    this.high = (this.low - 1 + Math.floor(range * (valueCumFreq + valueFreq) / total)) >>> 0;
    this.low = (this.low + Math.floor(range * valueCumFreq / total)) >>> 0;
    h.addSymbol(v);
    this._emit();
    return escape;
  }
  writeSymbolContext8(value) {
    if (0xFFFF === this.high && 0 === this.low && 0 === this.underflow) {
      let bits = value & 0xFF; // C writes the double-swapped (= original) byte here
      this.ensure();
      this.data[this.pos] = (this.data[this.pos] | (bits << this.off)) >>> 0;
      this.off += 8;
      if (this.off >= 32) {
        this.off -= 32;
        this.pos++;
        if (this.off > 0) this.data[this.pos] = (bits >>> (8 - this.off));
      }
      return false;
    }
    this.writeSymbolStatic(ACStaticFull + 256, this.swap8(value & 0xFF) + 1);
    return false;
  }
  writeU8(v) { this.writeSymbolContext8(v & 0xFF); }
  writeU16(v) { this.writeU8(v & 0xFF); this.writeU8((v >> 8) & 0xFF); }
  writeU32(v) { this.writeU16(v & 0xFFFF); this.writeU16((v >>> 16) & 0xFFFF); }
  writeCompressedU32(ctx, v) {
    this.compressed = true;
    if (ctx !== 0 && ctx < ACMaxRange) {
      let escape;
      if (ctx > ACStaticFull) { this.writeSymbolStatic(ctx, v + 1); escape = false; }
      else escape = this.writeSymbolDynamic(ctx, v + 1);
      if (escape) {
        this.writeU32(v);
        this.getContext(ctx).addSymbol(v + 1);
      }
    } else this.writeU32(v);
  }
  writeCompressedU16(ctx, v) {
    this.compressed = true;
    if (ctx !== 0 && ctx < ACMaxRange) {
      const escape = (ctx > ACStaticFull) ? (this.writeSymbolStatic(ctx, v + 1), false) : this.writeSymbolDynamic(ctx, v + 1);
      if (escape) { this.writeU16(v); this.getContext(ctx).addSymbol(v + 1); }
    } else this.writeU16(v);
  }
  writeCompressedU8(ctx, v) {
    this.compressed = true;
    if (ctx !== 0 && ctx < ACMaxRange) {
      const escape = (ctx > ACStaticFull) ? (this.writeSymbolStatic(ctx, v + 1), false) : this.writeSymbolDynamic(ctx, v + 1);
      if (escape) { this.writeU8(v); this.getContext(ctx).addSymbol(v + 1); }
    } else this.writeU8(v);
  }
  getBytes() {
    if (this.compressed) this.writeU32(0);
    // align to byte
    const bitCount = this.pos * 32 + this.off;
    const nBytes = (bitCount + 7) >> 3;
    const out = Buffer.alloc(nBytes + 4);
    for (let i = 0; i < nBytes; i++) out[i] = (this.data[i >> 2] >>> ((i & 3) << 3)) & 0xFF;
    return out;
  }
}

// --- roundtrip fuzz ---
let failures = 0;
for (let trial = 0; trial < 200; trial++) {
  const seed = trial;
  let s = seed + 12345;
  const rnd = (n) => { s = (s * 1103515245 + 12345) & 0x7FFFFFFF; return s % n; };
  const ops = [];
  const w = new BitStreamWrite();
  const N = 200 + rnd(300);
  for (let i = 0; i < N; i++) {
    const kind = rnd(7);
    if (kind === 0) { const v = rnd(256); ops.push(['u8', 0, v]); w.writeU8(v); }
    else if (kind === 1) { const v = rnd(65536); ops.push(['u16', 0, v]); w.writeU16(v); }
    else if (kind === 2) { const v = rnd(1 << 30); ops.push(['u32', 0, v]); w.writeU32(v); }
    else if (kind === 3) { const ctx = 1 + rnd(60); const v = rnd(1000); ops.push(['c32', ctx, v]); w.writeCompressedU32(ctx, v); }
    else if (kind === 4) { const ctx = 1 + rnd(60); const v = rnd(500); ops.push(['c16', ctx, v]); w.writeCompressedU16(ctx, v); }
    else if (kind === 5) { const ctx = 1 + rnd(60); const v = rnd(250); ops.push(['c8', ctx, v]); w.writeCompressedU8(ctx, v); }
    else { const n = 2 + rnd(500); const v = rnd(n); ops.push(['s32', ACStaticFull + n, v + 1]); w.writeSymbolStatic(ACStaticFull + n, v + 1); }
  }
  const bytes = w.getBytes();
  const r = new BitStreamRead(bytes);
  let ok = true;
  for (const [kind, ctx, v] of ops) {
    let got;
    if (kind === 'u8') got = r.readU8();
    else if (kind === 'u16') got = r.readU16();
    else if (kind === 'u32') got = r.readU32();
    else if (kind === 'c32') got = r.readCompressedU32(ctx);
    else if (kind === 'c16') got = r.readCompressedU16(ctx);
    else if (kind === 'c8') got = r.readCompressedU8(ctx);
    else if (kind === 's32') got = r.readSymbol(ctx);
    if (got !== v) { console.log(`trial ${trial}: mismatch ${kind} ctx=${ctx} want=${v} got=${got}`); ok = false; failures++; break; }
  }
  if (!ok && failures > 5) break;
}
console.log(failures === 0 ? 'ALL ROUNDTRIPS OK' : failures + ' FAILURES');
module.exports = { BitStreamWrite };
