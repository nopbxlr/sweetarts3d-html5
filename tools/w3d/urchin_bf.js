// Brute-force structural variants at urchin record 134.
'use strict';
const fs = require('fs');
const { blocks, parseDecl, parseSchedule47, MeshDecoder } = require('./mesh.js');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function snapBS(bs) {
  const ctxs = [];
  for (const [k, h] of bs.contexts) {
    ctxs.push([k, h.numSymbols, Uint16Array.from(h.counts), Uint16Array.from(h.cum4)]);
  }
  return { dataPosition: bs.dataPosition, dataBitOffset: bs.dataBitOffset,
           dataLocal: bs.dataLocal, dataLocalNext: bs.dataLocalNext,
           high: bs.high, code: bs.code, low: bs.low, underflow: bs.underflow, ctxs };
}
function restoreBS(bs, s) {
  bs.dataPosition = s.dataPosition; bs.dataBitOffset = s.dataBitOffset;
  bs.dataLocal = s.dataLocal; bs.dataLocalNext = s.dataLocalNext;
  bs.high = s.high; bs.code = s.code; bs.low = s.low; bs.underflow = s.underflow;
  bs.contexts.clear();
  for (const [k, n, counts, cum4] of s.ctxs) {
    const h = new (Object.getPrototypeOf(bs.getContext(9999)).constructor)(bs.elephant);
    h.numSymbols = n; h.counts = Uint16Array.from(counts); h.cum4 = Uint16Array.from(cum4);
    bs.contexts.set(k, h);
  }
  bs.contexts.delete(9999);
}
function snapDec(dec) {
  return {
    G: dec.G.map(g => ({
      verts: g.verts.map(v => ({ ...v, p: v.p.slice() })),
      faces: g.faces.map(f => { const c = f.slice(); c.shading = f.shading; return c; }),
    })),
    mirror: dec.mirror.map(m => ({ faces: m.faces.map(f => f.slice()) })),
    pending: dec.pending ? { res: dec.pending.res, items: dec.pending.items.map(i => i.slice()) } : null,
  };
}
function restoreDec(dec, s) {
  for (let g = 0; g < dec.G.length; g++) {
    dec.G[g].verts = s.G[g].verts.map(v => ({ ...v, p: v.p.slice() }));
    dec.G[g].faces = s.G[g].faces.map(f => { const c = f.slice(); c.shading = f.shading; return c; });
    dec.mirror[g].faces = s.mirror[g].faces.map(f => f.slice());
  }
  dec.pending = s.pending ? { res: s.pending.res, items: s.pending.items.map(i => i.slice()) } : null;
}

const buf = fs.readFileSync(S + '/assets/models/urchin.w3d');
const bl = blocks(buf);
const decl = parseDecl(bl.find(b => b.t === 0xFFFFFF45).data);
const counts = decl.groups.map(g => g.maxTexCoords);
const R = counts.reduce((a, b) => a + b, 0);
const sched = parseSchedule47(bl.find(b => b.t === 0xFFFFFF47).data, R + 4);
const vals = sched.vals; const resLists = []; let p = 0;
for (const c of counts) { let cum = 0; const l = []; for (let i = 0; i < c; i++) { cum += vals[p++]; l.push(cum); } resLists.push(l); }
const order = MeshDecoder.firingOrder(resLists);
const b49 = bl.filter(b => b.t === 0xFFFFFF49)[0].data;
const totalBits = b49.length * 8;

function freshTo(n) {
  // decode records [0, n) and return {dec, bs}
  const dec = new MeshDecoder(decl, resLists);
  const { BitStreamRead } = require('./bitstream');
  const bs = new BitStreamRead(b49);
  dec.bs = bs;
  bs.readString(); bs.readU32();
  dec.G = decl.groups.map(() => ({ verts: [], faces: [], uvs: [], normals: [], boneWeights: [] }));
  dec.mirror = dec.G.map(() => ({ faces: [] }));
  dec.pending = null;
  for (let i = 0; i < n; i++) {
    if (dec.pending && dec.pending.res <= order[i].res - 2) dec.flushPending();
    dec.curRes = order[i].res;
    dec.record(dec.G[order[i].g], order[i].g);
    if (dec.bad) { console.log('pre-decode bad at', i, dec.bad); process.exit(1); }
  }
  return { dec, bs };
}

const { dec, bs } = freshTo(134);
const S0 = snapBS(bs), D0 = snapDec(dec);
console.log('snapshot at record 134, bit', bs.getBitCount(), '/', totalBits);

function tryRest(label, pre) {
  restoreBS(bs, S0); restoreDec(dec, D0);
  try {
    if (pre) { const r = pre(); if (r === false) { return; } }
    for (let i = 134; i < order.length; i++) {
      if (dec.pending && dec.pending.res <= order[i].res - 2) dec.flushPending();
      dec.curRes = order[i].res;
      dec.record(dec.G[order[i].g], order[i].g);
      if (dec.bad) { console.log(label, 'bad at rec', i, dec.bad); return; }
    }
    const endBit = bs.getBitCount();
    const v = dec.G.map(x => x.verts.length), f = dec.G.map(x => x.faces.length);
    const match = v[0] === decl.groups[0].maxPositions && v[1] === decl.groups[1].maxPositions &&
                  f[0] === decl.groups[0].maxFaces && f[1] === decl.groups[1].maxFaces;
    console.log(label, 'PARSED to end. endBit', endBit, '/', totalBits, 'v', v.join('/'), 'f', f.join('/'), match ? 'DECL-MATCH' : '');
  } catch (e) { console.log(label, 'EXC', e.message); }
}

// V0 baseline
tryRest('V0 baseline', null);
// V1: extra empty header (4 cu32 on ctx 1,3,2,4)
tryRest('V1 extra-hdr', () => {
  const a = bs.readCompressedU32(1), c = bs.readCompressedU32(3), b = bs.readCompressedU32(2), d = bs.readCompressedU32(4);
  console.log('  V1 extra hdr:', a, c, b, d);
});
// V2: extra full record for g0
tryRest('V2 extra-rec-g0', () => { dec.curRes = 188; dec.record(dec.G[0], 0); if (dec.bad) { console.log('  V2 bad', dec.bad); return false; } });
// V3: extra full record for g1
tryRest('V3 extra-rec-g1', () => { dec.curRes = 188; dec.record(dec.G[1], 1); if (dec.bad) { console.log('  V3 bad', dec.bad); return false; } });
// V4: skip one raw u32 before rec134
tryRest('V4 skip-u32', () => { bs.readU32(); });
// V5: skip one raw u8
tryRest('V5 skip-u8', () => { bs.readU8(); });

// V6..: bundle-section variants for rec 134 only
function tryVariant(label, V) {
  restoreBS(bs, S0); restoreDec(dec, D0);
  try {
    dec.variant = V;
    dec.curRes = order[134].res;
    dec.record(dec.G[order[134].g], order[134].g);
    dec.variant = null;
    if (dec.bad) { console.log(label, 'bad in rec134:', dec.bad); return; }
    for (let i = 135; i < order.length; i++) {
      if (dec.pending && dec.pending.res <= order[i].res - 2) dec.flushPending();
      dec.curRes = order[i].res;
      dec.record(dec.G[order[i].g], order[i].g);
      if (dec.bad) { console.log(label, 'bad at rec', i, dec.bad); return; }
    }
    const endBit = bs.getBitCount();
    const v = dec.G.map(x => x.verts.length), f = dec.G.map(x => x.faces.length);
    console.log(label, 'PARSED. endBit', endBit, '/', totalBits, 'v', v.join('/'), 'f', f.join('/'));
  } catch (e) { console.log(label, 'EXC', e.message); } finally { dec.variant = null; }
}
tryVariant('V6 noNrm', { noNrm: true });
tryVariant('V7 noTex', { noTex: true });
tryVariant('V8 noNrm+noTex', { noNrm: true, noTex: true });
tryVariant('V9 noBones', { noBones: true });
tryVariant('V10 noPos', { noPos: true });
tryVariant('V11 noNrm+noTex+noBones', { noNrm: true, noTex: true, noBones: true });
