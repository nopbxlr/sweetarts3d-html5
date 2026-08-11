// DFS/beam search for the W3D 0xFFFFFF49 per-update record structure.
// An "op" reads one field with a context policy; sequences are validated by
// requiring subsequent update boundaries ([lead 4|6][signs<=7] after a
// zero/low-bit split read) to parse, recursively, several updates deep.
'use strict';
const { BitStreamRead, HistogramDynamic, ACStaticFull } = require('./bitstream');
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

let freshCounter = 100;
// op = { name, run(bs, env) -> value or throw }
function makeOps(env) {
  return [
    { n: 'P0.32', run: b => b.readCompressedU32(21) , max: 500000 },
    { n: 'F.32', run: b => b.readCompressedU32(++freshCounter % 800 + 100), max: 500000 },
    { n: 'P0.16', run: b => b.readCompressedU16(21), max: 65535 },
    { n: 'F.16', run: b => b.readCompressedU16(++freshCounter % 800 + 100), max: 65535 },
    { n: 'F.8', run: b => b.readCompressedU8(++freshCounter % 800 + 100), max: 255 },
    { n: 'u8', run: b => b.readU8(), max: 255 },
    { n: 'u16', run: b => b.readU16(), max: 65535 },
    { n: 'u32', run: b => b.readU32(), max: 4294967295 },
    { n: 's2', run: b => b.readSymbol(ACStaticFull + 2), max: 2 },
    { n: 's3', run: b => b.readSymbol(ACStaticFull + 3), max: 3 },
    { n: 'sG', run: b => b.readSymbol(ACStaticFull + env.numGroups), max: 64 },
    { n: 'sR', run: b => b.readSymbol(ACStaticFull + env.finalRes), max: 100000 },
  ];
}

// Check whether an update boundary parses at current state for update index i.
// Returns cloned stream positioned after [split][lead][signs], or null.
function tryBoundary(bs, i) {
  const c = clone(bs);
  try {
    let split = 0;
    if (i > 1) {
      split = c.readCompressedU32(ACStaticFull + i);
      if (split >= i) return null;
    }
    const lead = c.readU8();
    if (lead !== 4 && lead !== 6) return null;
    const signs = c.readU8();
    if (signs > 7) return null;
    return { c, split, lead, signs };
  } catch (e) { return null; }
}

// Search: from state after [lead][signs] of update i, find op-sequences (maxDepth)
// such that boundaries of updates i+1 .. i+lookahead all parse (each with its own
// recursive gap search up to maxDepth).
function search(bs, i, maxDepth, lookahead, env, prefix, results, budget) {
  if (results.length >= 40 || budget.n <= 0) return;
  const b = tryBoundary(bs, i + 1);
  if (b) {
    if (lookahead <= 1) {
      results.push({ seq: prefix.slice(), nexti: i + 1, boundary: { split: b.split, lead: b.lead, signs: b.signs } });
      return;
    }
    // recurse into next update's gap
    const sub = [];
    search(b.c, i + 1, maxDepth, lookahead - 1, env, [], sub, budget);
    if (sub.length > 0) {
      results.push({ seq: prefix.slice(), nexti: i + 1, boundary: { split: b.split, lead: b.lead, signs: b.signs }, next: sub[0].seq });
      return;
    }
  }
  if (prefix.length >= maxDepth) return;
  for (const op of makeOps(env)) {
    const c = clone(bs);
    let v;
    budget.n--;
    try { v = op.run(c); } catch (e) { continue; }
    if (typeof v === 'number' && v > op.max) continue;
    prefix.push(op.n + '=' + v);
    search(c, i, maxDepth, lookahead, env, prefix, results, budget);
    prefix.pop();
    if (results.length >= 40 || budget.n <= 0) return;
  }
}

if (require.main === module) {
  const file = process.argv[2] || 'door.w3d';
  const numGroups = parseInt(process.argv[3] || '2');
  const finalRes = parseInt(process.argv[4] || '48');
  const maxDepth = parseInt(process.argv[5] || '6');
  const lookahead = parseInt(process.argv[6] || '3');
  const bs = mkbs(file);
  // u0
  bs.readU8(); bs.readU8();
  bs.readCompressedU32(21); bs.readCompressedU32(21); bs.readCompressedU32(21);
  // u1 boundary
  const b1 = tryBoundary(bs, 1);
  if (!b1) { console.log('u1 boundary failed'); process.exit(1); }
  console.log('u1: lead', b1.lead, 'signs', b1.signs, '@', b1.c.getBitCount());
  const env = { numGroups, finalRes };
  const results = [];
  search(b1.c, 1, maxDepth, lookahead, env, [], results, { n: 3000000 });
  console.log('solutions:', results.length);
  for (const r of results.slice(0, 30)) console.log(JSON.stringify(r));
}
