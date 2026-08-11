// Targeted search for the lead=4 record body grammar at update >=1.
// Model: record = [split (i>=2, c32 static 0x400+i)] [lead u8] [signs u8]
//                 [PRE ops] [mx][my][mz] [POST ops]
// where mags are read via MAGKIND on shared persistent ctx 21.
// Validate by recursively parsing subsequent lead=4 records (skip on lead=6).
'use strict';
const { BitStreamRead, ACStaticFull } = require('./bitstream');
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

function clone(bs) {
  const c = Object.create(Object.getPrototypeOf(bs));
  Object.assign(c, bs);
  c.contexts = new Map();
  for (const [k, v] of bs.contexts) {
    const h = Object.create(Object.getPrototypeOf(v));
    Object.assign(h, v);
    h.counts = v.counts.slice(); h.cum4 = v.cum4.slice();
    c.contexts.set(k, h);
  }
  return c;
}

// op vocabulary for PRE/POST slots
const OPS = {
  '': () => 0,
  's2': b => b.readSymbol(ACStaticFull + 2),
  's3': b => b.readSymbol(ACStaticFull + 3),
  's4': b => b.readSymbol(ACStaticFull + 4),
  'c8d': b => b.readCompressedU8(40),
  'c16d': b => b.readCompressedU16(40),
  'c32d': b => b.readCompressedU32(40),
  'u8': b => b.readU8(),
  's2,s2': b => [b.readSymbol(ACStaticFull + 2), b.readSymbol(ACStaticFull + 2)],
  'c8d,c8e': b => [b.readCompressedU8(40), b.readCompressedU8(41)],
};
const MAG = {
  'c32': (b) => b.readCompressedU32(21),
  'c16': (b) => b.readCompressedU16(21),
  'c8': (b) => b.readCompressedU8(21),
};

const MAXMAG = 1100;

// parse one record body (after lead+signs) with the candidate grammar; throw on insanity
function body(bs, g) {
  OPS[g.pre](bs);
  const mx = MAG[g.mag](bs); if (mx > MAXMAG) throw 0;
  const my = MAG[g.mag](bs); if (my > MAXMAG) throw 0;
  const mz = MAG[g.mag](bs); if (mz > MAXMAG) throw 0;
  OPS[g.post](bs);
  return [mx, my, mz];
}

// try to keep parsing records i, i+1, ... until a lead=6 or badness; return count of good lead-4 records
function run(bs0, startI, g) {
  const bs = clone(bs0);
  let good = 0;
  const log = [];
  for (let i = startI; i < 2000; i++) {
    let split = 0;
    if (i >= 2) {
      split = bs.readCompressedU32(ACStaticFull + i);
      if (split >= i) { log.push(`i${i} badsplit ${split}`); break; }
    }
    let lead;
    try { lead = bs.readU8(); } catch (e) { break; }
    if (lead === 6) { log.push(`i${i} split=${split} LEAD6 @${bs.getBitCount()}`); good += 0.5; break; }
    if (lead !== 4) { log.push(`i${i} badlead ${lead}`); break; }
    const signs = bs.readU8();
    if (signs > 7) { log.push(`i${i} badsigns ${signs}`); break; }
    let m;
    try { m = body(bs, g); } catch (e) { log.push(`i${i} badbody`); break; }
    log.push(`i${i} split=${split} s=${signs} m=${m}`);
    good++;
  }
  return { good, log };
}

if (require.main === module) {
  const file = process.argv[2] || 'hat.w3d';
  const bs = mkbs(file);
  // u0: lead, signs, 3x c32 ctx21 (established)
  const l0 = bs.readU8(), s0 = bs.readU8();
  const m0 = [bs.readCompressedU32(21), bs.readCompressedU32(21), bs.readCompressedU32(21)];
  console.log(`u0: lead=${l0} signs=${s0} m=${m0} @${bs.getBitCount()}`);
  const results = [];
  for (const pre of Object.keys(OPS)) for (const mag of Object.keys(MAG)) for (const post of Object.keys(OPS)) {
    const g = { pre, mag, post };
    const r = run(bs, 1, g);
    results.push({ g, ...r });
  }
  results.sort((a, b) => b.good - a.good);
  for (const r of results.slice(0, 12)) {
    console.log(`good=${r.good} pre='${r.g.pre}' mag=${r.g.mag} post='${r.g.post}'`);
    console.log('   ' + r.log.slice(0, 8).join(' | '));
  }
}
