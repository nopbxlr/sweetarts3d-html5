// Meet-in-the-middle: from a known decoder state, forward-ENCODE candidate
// (census-variant, value) pairs and compare emitted bits against the file.
'use strict';
const { BitStreamRead, HistogramDynamic, ACStaticFull } = require('./bitstream');
const { BitStreamWrite } = require('./encoder_test');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function mkbs(f) {
  const buf = fs.readFileSync(S + '/assets/models/' + f);
  let off = 16, blocks = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    blocks.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  const bs = new BitStreamRead(blocks.filter(b => b.t === 0xFFFFFF49)[0].data);
  bs.readString(); bs.readU32(); for (let k = 0; k < 4; k++) bs.readU32();
  return bs;
}

// file bit at absolute position p
function fileBit(bs, p) { return (bs.data[p >>> 5] >>> (p & 31)) & 1; }

// clone histogram
function cloneHist(h) {
  const n = new HistogramDynamic(h.elephant);
  n.numSymbols = h.numSymbols;
  n.counts = h.counts.slice();
  n.cum4 = h.cum4.slice();
  return n;
}

// Writer that starts from a given AC state and captures emitted bits
class StateWriter extends BitStreamWrite {
  constructor(low, high, underflow) {
    super();
    this.low = low; this.high = high; this.underflow = underflow;
  }
  emittedBits() {
    const n = this.pos * 32 + this.off;
    const out = [];
    for (let i = 0; i < n; i++) out.push((this.data[i >>> 5] >>> (i & 31)) & 1);
    return out;
  }
}

// Try: encode a sequence of ops from state; return #matching leading bits vs file at pos
function tryEncode(bs, pos, hists, ops) {
  const w = new StateWriter(bs.low, bs.high, bs.underflow);
  w.contexts = new Map();
  for (const [k, h] of Object.entries(hists)) w.contexts.set(parseInt(k), cloneHist(h));
  try { for (const op of ops) op(w); } catch (e) { return -1; }
  const bits = w.emittedBits();
  let match = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === fileBit(bs, pos + i)) match++; else break;
  }
  return { match, total: bits.length };
}

module.exports = { mkbs, fileBit, cloneHist, StateWriter, tryEncode };

if (require.main === module) {
  // Scenario: tacks u1 after mx hit. Decode up to my-start, then MITM the next field.
  const file = process.argv[2] || 'tacks.w3d';
  const bs = mkbs(file);
  bs.readU8(); bs.readU8();
  bs.readCompressedU32(21); bs.readCompressedU32(21); bs.readCompressedU32(21);
  bs.readU8(); bs.readU8();
  const mx = bs.readCompressedU32(21);
  const pos = bs.getBitCount();
  console.log(file, 'u1 mx =', mx, 'my-start @', pos, 'state', bs.low.toString(16), bs.high.toString(16), bs.underflow);
  const h21 = bs.getContext(21);

  const results = [];
  // Hypothesis family 1: my = compressed u32 on ctx21 with census VARIANTS
  const censusVariants = {
    exact: () => cloneHist(h21),
    noEscCount: () => { const h = cloneHist(h21); const d = h.counts[0] - 1; h.counts[0] = 1; for (let i = 0; i <= 0; i++) h.cum4[i] -= d; // fix cum4[0]
      // rebuild cum4 fully
      h.cum4.fill(0); for (let s = h.numSymbols - 1; s >= 0; s--) { h.cum4[s >> 2] += h.counts[s]; } for (let i = (h.numSymbols >> 2); i > 0; i--) h.cum4[i - 1] += h.cum4[i];
      return h; },
    fresh: () => new HistogramDynamic(0x1FFF),
  };
  for (const [cn, mk] of Object.entries(censusVariants)) {
    for (let v = 0; v <= 2048; v++) {
      const h = mk();
      const r = tryEncode(bs, pos, { 21: h }, [w => {
        // writeCompressedU32 against ctx21-variant
        const esc = w.writeSymbolDynamic(21, v + 1);
        if (esc) { w.writeU32(v); w.getContext(21).addSymbol(v + 1); }
      }]);
      if (r !== -1 && r.match >= Math.min(r.total, 30) && r.total > 4) {
        results.push({ hyp: `c32ctx21-${cn}`, v, ...r });
      }
    }
  }
  // Hypothesis family 2: my as compressed u16 on ctx21-exact
  for (let v = 0; v <= 2048; v++) {
    const r = tryEncode(bs, pos, { 21: h21 }, [w => {
      const esc = w.writeSymbolDynamic(21, v + 1);
      if (esc) { w.writeU16(v); w.getContext(21).addSymbol(v + 1); }
    }]);
    if (r !== -1 && r.match >= Math.min(r.total, 25) && r.total > 4) results.push({ hyp: 'c16ctx21', v, ...r });
  }
  // Hypothesis family 3: my raw u32 uncompressed / u16 / u8
  for (let v = 0; v <= 2048; v++) {
    for (const [hn, fn] of [['u32', w => w.writeU32(v)], ['u16', w => w.writeU16(v)], ['u8', v <= 255 ? w => w.writeU8(v) : null]]) {
      if (!fn) continue;
      const r = tryEncode(bs, pos, {}, [fn]);
      if (r !== -1 && r.match === r.total && r.total >= 14) results.push({ hyp: hn, v, ...r });
    }
  }
  results.sort((a, b) => (b.match) - (a.match));
  console.log('matches:', results.length);
  for (const r of results.slice(0, 20)) console.log(JSON.stringify(r));
}
