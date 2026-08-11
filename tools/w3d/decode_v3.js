// W3D 0xFFFFFF49 decoder v3 — full record structure from SW3D_Exp.dle writer.
// Record: cu32(1,A=numBundles) cu32(3,C=numFaceUpdates) cu32(2,B=numNewFaces)
//         cu32(4,D=numDistinctFaces)
//         D face refs: first cu32Static(faceCount(grp)), then deltas cu32Static(faceCount-prev)
//         A bundles: [pos: cu8(6,code)[cu32(5,idx)] cu8(7,signs) cu32(8,m)x3]
//                    [nrm: cu8(0xa,code)[cu32(9,idx)] cu8(0xb,signs) cu32(0xc,q1)
//                          phi=cu32Static(N+1), N=trunc(acos(0)/qN*sqrt(1-(q1*qN)^2)+0.5)]
//                    [tex xL: cu8(0xe,code)[cu32(0xf,idx)] cu8(0x10,signs) cu32(0x11,mu) cu32(0x11,mv)]
//                    [bones: cu32(0x12,cnt) {cu32(0x13,id) k>0:cu32(0x14,w)}]
//         C faceUpdates: [cu32(0x15,listIdx) only-if-D>0] cu8(0x16,corner) cu32(0x17,newRel)
//                        [newRel==0: rawU32(oldIdx)] cu8(0x18,cornerCode) [==3: cu32(?,old)]
//         B newFaces: ... (0x19/0x1a-0x1c raw + 0x1d + 0x1e x3 + per-corner 0x1f + cases)
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
function declIQ(f) {
  const d = blocks(f).find(b => b.t === 0xFFFFFF45).data;
  const bs = new BitStreamRead(d);
  bs.readString(); bs.readU32();
  const n = bs.readU32();
  const groups = [];
  for (let i = 0; i < n; i++) {
    const g = []; for (let j = 0; j < 6; j++) g.push(bs.readU32());
    groups.push(g);
  }
  const numLists = bs.readU32();
  for (let i = 0; i < numLists; i++) { bs.readString(); for (let j = 0; j < n; j++) bs.readString(); }
  const fl = []; for (let i = 0; i < 10; i++) fl.push(bs.readF32());
  return { center: fl.slice(0, 3), radius: fl[3], iq: fl.slice(5, 10), finalRes: bs.readU32(), groups };
}

class Decoder {
  constructor(file, opts) {
    this.file = file;
    this.opts = opts || {};
    this.decl = declIQ(file);
    this.qPos = this.decl.iq[0];
    this.qN = this.decl.iq[1];
    this.qT = this.decl.iq[2];
    this.b49s = blocks(file).filter(b => b.t === 0xFFFFFF49);
    this.log = [];
    this.trace = this.opts.trace || 0;
  }
  cuS(bs, n, width) { // IFX static-compressed (numSymbols n>=1)
    if (n < 1) n = 1;
    const symOur = bs.readSymbol(ACStaticFull + n);
    const s0 = symOur - 1;
    if (s0 === 0) return width === 8 ? bs.readU8() : width === 16 ? bs.readU16() : bs.readU32();
    return s0 - 1;
  }
  run(maxRecords) {
    const bs = new BitStreamRead(this.b49s[0].data);
    this.bs = bs;
    const name = bs.readString();
    const numUpd = bs.readU32();
    this.out = { name, numUpd, records: [] };
    this.faceCount = 0;   // per-group in reality; single-group approx first
    this.vertCount = 0;
    for (let r = 0; r < Math.min(numUpd, maxRecords); r++) {
      const rec = this.record(r);
      this.out.records.push(rec);
      if (rec.bad) break;
    }
    return this.out;
  }
  record(r) {
    this.vertCountAtRec = this.vertCount;
    const bs = this.bs, rec = { i: r, at: bs.getBitCount() };
    const A = bs.readCompressedU32(1);
    const C = bs.readCompressedU32(3);
    const B = bs.readCompressedU32(2);
    const D = bs.readCompressedU32(4);
    Object.assign(rec, { A, C, B, D });
    if (A > 300 || B > 300 || C > 300 || D > 300) { rec.bad = 'hdr'; return rec; }
    // distinct face refs
    const faces = [];
    if (D > 0) {
      let f = this.cuS(bs, this.faceCount, 32);
      faces.push(f);
      for (let k = 1; k < D; k++) {
        const d = this.cuS(bs, this.faceCount - f, 32);
        f += d + 1; // guess: delta-1? adjust empirically
        faces.push(f);
      }
      rec.faces = faces;
    }
    // A bundles
    rec.bundles = [];
    for (let j = 0; j < A; j++) {
      const b = {};
      // position
      b.pc = bs.readCompressedU8(6);
      if (b.pc !== 4) b.pi = bs.readCompressedU32(5);
      b.ps = bs.readCompressedU8(7);
      b.pm = [bs.readCompressedU32(8), bs.readCompressedU32(8), bs.readCompressedU32(8)];
      if (b.ps > 7 || b.pm.some(x => x > 3000)) { rec.bad = `bundle${j}pos`; rec.bundles.push(b); return rec; }
      // normal
      b.nc = bs.readCompressedU8(0xa);
      if (b.nc !== 4) b.ni = bs.readCompressedU32(9);
      b.ns = bs.readCompressedU8(0xb);
      b.q1 = bs.readCompressedU32(0xc);
      if (b.ns > 7 || b.q1 > 3000) { rec.bad = `bundle${j}nrm`; rec.bundles.push(b); return rec; }
      let zrec = Math.fround(b.q1 * this.qN);
      if (zrec > 1) zrec = 1;
      const srec = Math.sqrt((1 - zrec) * (1 + zrec));
      const N = Math.trunc(Math.acos(0.0) * (1 / this.qN) * srec + 0.5);
      b.phi = this.cuS(bs, N + 1, 32);
      if (b.phi > N + 2) { rec.bad = `bundle${j}phi`; rec.bundles.push(b); return rec; }
      // texcoords (assume 1 layer)
      b.tc = bs.readCompressedU8(0xe);
      if (b.tc !== 4) b.ti = bs.readCompressedU32(0xf);
      b.tsg = bs.readCompressedU8(0x10);
      b.uv = [bs.readCompressedU32(0x11), bs.readCompressedU32(0x11)];
      if (b.tsg > 3 || b.uv.some(x => x > 5000)) { rec.bad = `bundle${j}tex`; rec.bundles.push(b); return rec; }
      // bones
      b.bones = bs.readCompressedU32(0x12);
      if (b.bones > 8) { rec.bad = `bundle${j}bones`; rec.bundles.push(b); return rec; }
      for (let k = 0; k < b.bones; k++) {
        const id = bs.readCompressedU32(0x13);
        if (k > 0) bs.readCompressedU32(0x14);
      }
      rec.bundles.push(b);
      this.vertCount++;
    }
    // C face updates
    rec.fups = [];
    for (let j = 0; j < C; j++) {
      const fu = {};
      if (D > 0) fu.li = bs.readCompressedU32(0x15);
      fu.corner = bs.readCompressedU8(0x16);
      fu.newRel = bs.readCompressedU32(0x17);
      if (fu.newRel === 0) fu.oldRaw = bs.readU32();
      fu.oldCode = bs.readCompressedU8(0x18);
      if (fu.oldCode === 3) fu.oldVal = bs.readCompressedU32(0x19); // ctx guess
      rec.fups.push(fu);
      if (fu.corner > 2 || fu.newRel > 500) { rec.bad = `fup${j}`; return rec; }
    }
    // B new faces — structure TBD; try: cu8(0x19,shading?) rawU32? cu32(0x1a..0x1c)? cu8(0x1d) cu8(0x1e)x3 + corners
    rec.nfaces = [];
    for (let j = 0; j < B; j++) {
      const nf = { verts: [], attrs: [] };
      for (let c = 0; c < 3; c++) {
        const code = bs.readCompressedU8(0x19);
        const v = { code };
        if (code === 0) v.raw = bs.readU32();
        else if (code === 1) v.rel = bs.readCompressedU32(0x1a);
        else if (code >= 2 && code <= 4) { v.fli = bs.readCompressedU32(0x1b); v.d = bs.readCompressedU32(0x1c); }
        else { rec.bad = `nf${j}corner${c}code${code}`; rec.nfaces.push(nf); return rec; }
        nf.verts.push(v);
      }
      nf.f1d = bs.readCompressedU8(0x1d);
      nf.e = [bs.readCompressedU8(0x1e), bs.readCompressedU8(0x1e), bs.readCompressedU8(0x1e)];
      for (let c = 0; c < 3; c++) {
        const code = bs.readCompressedU8(0x1f);
        const co = { code };
        if (code <= 2) { co.i = bs.readCompressedU32(0x22); co.j = bs.readCompressedU32(0x23); }
        else if (code === 4) {
          co.mag = bs.readCompressedU32(0x20);
          const m = /^face([+-]\d+)?$/.exec(this.opts.c4 || '');
          const cnt = m ? this.faceCount + (parseInt(m[1] || '0'))
            : this.opts.c4 === 'recStart' ? this.vertCountAtRec
            : this.opts.c4 === 'vc1' ? this.vertCount + 1
            : this.opts.c4 === 'vcm1' ? this.vertCount - 1
            : this.vertCount;
          co.idx = this.cuS(bs, cnt, 32);
        }
        else if (code === 5) { co.mag = bs.readCompressedU32(0x20); co.d = bs.readCompressedU32(0x21); }
        else { co.mag = bs.readCompressedU32(0x20); co.d = bs.readCompressedU32(0x24); }
        nf.attrs.push(co);
      }
      rec.nfaces.push(nf);
      this.faceCount++;
    }
    rec.end = bs.getBitCount();
    return rec;
  }
}

if (require.main === module) {
  const file = process.argv[2] || 'candy1.w3d';
  const n = parseInt(process.argv[3] || '4');
  const dec = new Decoder(file, { c4: process.argv[4] });
  const out = dec.run(n);
  console.log(file, out.name, 'numUpd', out.numUpd, 'IQ', dec.decl.iq.map(x => +x.toFixed(6)).join(','));
  for (const r of out.records) console.log(JSON.stringify(r));
}
