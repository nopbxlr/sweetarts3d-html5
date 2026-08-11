// Search ctx assignment for the u1 body given v2-parsed u0.
'use strict';
const { BitStreamRead, ACStaticFull } = require('./bitstream');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function b49(f) {
  const buf = fs.readFileSync(S + '/assets/models/' + f);
  let off = 16, out = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    out.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  return out.filter(b => b.t === 0xFFFFFF49);
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

function stateAfterU0(f) {
  const bs = new BitStreamRead(b49(f)[0].data);
  bs.readString(); bs.readU32();
  bs.readCompressedU32(1); bs.readCompressedU32(3); bs.readCompressedU32(2); bs.readCompressedU32(4);
  bs.readCompressedU8(6); bs.readCompressedU8(7);
  bs.readCompressedU32(8); bs.readCompressedU32(8); bs.readCompressedU32(8);
  return bs;
}

const DOOR = new Set([0, 184, 798, 1024, 399, 512, 92]);
const files = ['door.w3d', 'candy1.w3d', 'hat.w3d', 'tacks.w3d', 'track1.w3d'];
const states = {};
for (const f of files) states[f] = stateAfterU0(f);

const results = [];
for (let a = 1; a <= 0x40; a++) {
  for (let b = 1; b <= 0x40; b++) {
    for (const M of [8]) {
      let ok = 0, det = [];
      for (const f of files) {
        const c = clone(states[f]);
        try {
          const code = c.readCompressedU8(a);
          if (code > 8) { det.push(`${f}:code${code}`); continue; }
          const sg = c.readCompressedU8(b);
          if (sg > 7) { det.push(`${f}:sg${sg}`); continue; }
          const m = [c.readCompressedU32(M), c.readCompressedU32(M), c.readCompressedU32(M)];
          if (m.some(x => x > 1100)) { det.push(`${f}:mag`); continue; }
          if (f === 'door.w3d' && !m.every(x => DOOR.has(x))) { det.push('door:set'); continue; }
          ok++; det.push(`${f}:OK c=${code} s=${sg} m=${m}`);
        } catch (e) { det.push(`${f}:exc`); }
      }
      if (ok >= 4) results.push({ a, b, M, ok, det });
    }
  }
}
results.sort((x, y) => y.ok - x.ok);
for (const r of results.slice(0, 15)) {
  console.log(`a=${r.a.toString(16)} b=${r.b.toString(16)} M=${r.M} ok=${r.ok}`);
  for (const d of r.det) console.log('   ', d);
}
console.log('total candidates:', results.length);
