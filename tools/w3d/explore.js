// Greedy section explorer for the v2 grammar.
// Usage: node explore.js <file> <sectionspec>
// spec: comma list of: h(header) p(pos) n(normal) t(tex) f?(faces...)
'use strict';
const { BitStreamRead, ACStaticFull } = require('./bitstream');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function blocks(f) {
  const buf = fs.readFileSync(S + '/assets/models/' + f);
  let off = 16, out = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    out.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  return out;
}
function b49(f) { return blocks(f).filter(b => b.t === 0xFFFFFF49); }
function declIQ(f) {
  const d = blocks(f).find(b => b.t === 0xFFFFFF45).data;
  const bs = new BitStreamRead(d);
  bs.readString(); bs.readU32();
  const n = bs.readU32();
  for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) bs.readU32();
  const numLists = bs.readU32();
  for (let i = 0; i < numLists; i++) { bs.readString(); for (let j = 0; j < n; j++) bs.readString(); }
  const fl = []; for (let i = 0; i < 10; i++) fl.push(bs.readF32());
  return { center: fl.slice(0, 3), radius: fl[3], iq: fl.slice(5, 10), finalRes: bs.readU32(), groups: n };
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

// IFX static-compressed value read (0-based symbols, escape at slot 0)
function cuStatic32(bs, n) {
  if (n < 1) n = 1;
  const symOur = bs.readSymbol(ACStaticFull + n);
  const s0 = symOur - 1;
  if (s0 === 0) return { esc: true, v: bs.readU32() };
  return { esc: false, v: s0 - 1 };
}

const SEC = {
  h(bs) {
    const A = bs.readCompressedU32(1), C = bs.readCompressedU32(3), B = bs.readCompressedU32(2), D = bs.readCompressedU32(4);
    const faces = [];
    if (D > 0 && D < 300) {
      // face refs with running face count — pass via env
      let f = cuStatic32(bs, SEC.env.faceCount + 1).v; // ??? sizing TBD
      faces.push(f);
    }
    return { desc: `A=${A} C=${C} B=${B} D=${D}${faces.length ? ' F' + faces : ''}`, sane: A <= 300 && C <= 300 && B <= 300 && D <= 300 };
  },
  p(bs) {
    const p = bs.readCompressedU8(6);
    let pi = -1; if (p !== 4) pi = bs.readCompressedU32(5);
    const s = bs.readCompressedU8(7);
    const m = [bs.readCompressedU32(8), bs.readCompressedU32(8), bs.readCompressedU32(8)];
    return { desc: `p=${p}${pi >= 0 ? '/' + pi : ''} s=${s} m=${m}`, sane: (p <= 4 || p===5||p===6) && (pi<0||pi<100) && s <= 7 && m.every(x => x <= 1200) };
  },
  n(bs) {
    const qN = SEC.env.qNormal;
    const p = bs.readCompressedU8(0xa);
    let pi = -1; if (p !== 4) pi = bs.readCompressedU32(9);
    const s = bs.readCompressedU8(0xb);
    const q1 = bs.readCompressedU32(0xc);
    let phi = null, N = -1;
    if (q1 <= 3000) {
      let zrec = Math.fround(q1 * qN);
      if (zrec > 1) zrec = 1;
      const srec = Math.sqrt((1 - zrec) * (1 + zrec));
      N = Math.trunc(Math.acos(0.0) * (1 / qN) * srec + 0.5);
      phi = cuStatic32(bs, N + 1);
    }
    return { desc: `p=${p}${pi >= 0 ? '/' + pi : ''} s=${s} q1=${q1} N=${N} phi=${phi ? (phi.esc ? 'esc:' : '') + phi.v : '?'}`,
             sane: (p <= 4||p===5||p===6) && (pi<0||pi<100) && s <= 7 && q1 <= 3000 && phi !== null && !phi.esc && phi.v <= N + 1 };
  },
  t(bs) {
    const p = bs.readCompressedU8(0xe);
    let pi = -1; if (p !== 4) pi = bs.readCompressedU32(0xf);
    const s = bs.readCompressedU8(0x10);
    const mu = bs.readCompressedU32(0x11), mv = bs.readCompressedU32(0x11);
    return { desc: `p=${p}${pi >= 0 ? '/' + pi : ''} s=${s} uv=${mu},${mv}`, sane: (p <= 4||p===5||p===6) && (pi<0||pi<100) && s <= 3 && mu <= 2000 && mv <= 2000 };
  },
};
SEC.env = { faceCount: 0, qNormal: 0.006801400240510702 };

module.exports = { blocks, b49, declIQ, clone, cuStatic32, SEC };

if (require.main === module) {
  const file = process.argv[2];
  const spec = process.argv[3].split(',');
  const iq = declIQ(file);
  SEC.env.qNormal = iq.iq[1];
  console.log('decl IQ:', iq.iq.map(x => x.toPrecision(9)).join(','));
  const bs = new BitStreamRead(b49(file)[0].data);
  bs.readString(); const numUpd = bs.readU32();
  console.log(file, 'numUpd', numUpd, 'totalbits', b49(file)[0].data.length * 8);
  for (const sec of spec) {
    if (sec === '?') {
      // probe all section types from here without consuming
      for (const k of ['h', 'p', 'n', 't']) {
        const c = clone(bs);
        let r;
        try { r = SEC[k](c); } catch (e) { r = { desc: 'EXC', sane: false }; }
        console.log(`   probe ${k}: ${r.desc} ${r.sane ? 'SANE' : ''} -> @${c.getBitCount()}`);
      }
      break;
    }
    const at = bs.getBitCount();
    const r = SEC[sec](bs);
    console.log(`${sec} @${at}: ${r.desc} ${r.sane ? '' : ' [INSANE]'} end@${bs.getBitCount()}`);
  }
}
