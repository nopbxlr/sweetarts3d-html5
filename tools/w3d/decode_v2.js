// W3D 0xFFFFFF49 decoder v2 — mirrors the grammar disassembled from
// SW3D_Exp.dle CIFXWriterModel progressive writer at 0x1063e490.
// Record = cu32(1,A) cu32(3,C) cu32(2,B) cu32(4,D)
//          [D face refs: first cu32(0x400+faceCnt, f0), then deltas]
//          [pos: cu8(6,pred) [pred!=4: cu32(5,idx)] cu8(7,signs) cu32(8,m)x3]
//          [... normals/texcoords/faces sections — added incrementally]
'use strict';
const { BitStreamRead, ACStaticFull } = require('./bitstream');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function blocks49(f) {
  const buf = fs.readFileSync(S + '/assets/models/' + f);
  let off = 16, out = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    out.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  return out.filter(b => b.t === 0xFFFFFF49);
}

const file = process.argv[2] || 'door.w3d';
const maxU = parseInt(process.argv[3] || '6');
const b = blocks49(file)[0];
const bs = new BitStreamRead(b.data);
const name = bs.readString();
const numUpd = bs.readU32();
console.log(`${file} name=${name} numUpd=${numUpd} totalbits=${b.data.length * 8} @${bs.getBitCount()}`);

let faceCount = 0; // running face count (per group? start global)
for (let i = 0; i < Math.min(numUpd, maxU); i++) {
  const at0 = bs.getBitCount();
  const A = bs.readCompressedU32(1);
  const C = bs.readCompressedU32(3);
  const B = bs.readCompressedU32(2);
  const D = bs.readCompressedU32(4);
  if (A > 1000 || C > 1000 || B > 1000 || D > 1000) {
    console.log(`u${i} @${at0}: A=${A} C=${C} B=${B} D=${D}  INSANE header, stop`);
    break;
  }
  const faces = [];
  if (D > 0) {
    let f = bs.readCompressedU32(ACStaticFull + faceCount);
    faces.push(f);
    for (let k = 1; k < D; k++) {
      const d = bs.readCompressedU32(ACStaticFull + faceCount - f);
      f += d; faces.push(f);
    }
  }
  const p = bs.readCompressedU8(6);
  let pi = -1;
  if (p !== 4) pi = bs.readCompressedU32(5);
  const s = bs.readCompressedU8(7);
  const m = [bs.readCompressedU32(8), bs.readCompressedU32(8), bs.readCompressedU32(8)];
  console.log(`u${i} @${at0}: A=${A} C=${C} B=${B} D=${D} faces=[${faces}] pred=${p}${pi >= 0 ? ' pi=' + pi : ''} signs=${s} m=${m} end@${bs.getBitCount()}`);
  if (A > 1000 || C > 1000 || B > 1000 || D > 1000 || s > 7) { console.log('INSANE, stop'); break; }
}
