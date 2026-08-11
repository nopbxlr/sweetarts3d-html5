// Sweep schema variants for the 0xFFFFFF49 progressive decode.
'use strict';
const fs = require('fs');
const { BitStreamRead } = require('./bitstream');
const { CLODDecoder } = require('./clod');

function walk(file) {
  const buf = fs.readFileSync(file);
  let off = 16;
  const blocks = [];
  while (off + 8 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (off + 8 + size > buf.length) break;
    blocks.push({ type, size, data: buf.slice(off + 8, off + 8 + size) });
    off += 8 + size;
    off = (off + 3) & ~3;
  }
  return blocks;
}

function parseDecl(data) {
  const bs = new BitStreamRead(data);
  const name = bs.readString();
  const a = bs.readU32();
  const n = bs.readU32();
  const groups = [];
  for (let i = 0; i < n; i++) {
    groups.push([bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32()]);
  }
  const numLists = bs.readU32();
  const lists = [];
  for (let i = 0; i < numLists; i++) {
    const lname = bs.readString();
    const items = [];
    for (let j = 0; j < n; j++) items.push(bs.readString());
    lists.push({ name: lname, items });
  }
  const floats = [];
  for (let i = 0; i < 10; i++) floats.push(bs.readF32());
  const finalRes = bs.readU32();
  return { name, a, n, groups, lists, floats, finalRes };
}

function run(file, opts, trace) {
  const blocks = walk(file);
  const d = parseDecl(blocks.find(b => b.type === 0xFFFFFF45).data);
  const decl = {
    shadingDescs: d.groups.map(g => ({ numTexLayers: g[3] > 0 ? 1 : 0 })),
    iqPos: d.floats[5],
    iqNormal: d.floats[6],
    iqTex: d.floats[7],
    finalRes: d.finalRes,
    excludeNormals: false,
  };
  const dec = new CLODDecoder(decl, Object.assign({ trace }, opts));
  const b49s = blocks.filter(b => b.type === 0xFFFFFF49);
  let res = 0;
  let err = null;
  for (const b of b49s) {
    const bs = new BitStreamRead(b.data);
    const name = bs.readString();
    const numUpd = bs.readU32();
    const hdr = [bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32()];
    try {
      dec.decodeBlock(bs, numUpd, res);
    } catch (e) {
      err = `block@res${res}: ${e.message}`;
      break;
    }
    res += numUpd;
    // check bit consumption
    const used = bs.getBitCount(), avail = b.data.length * 8;
    if (used > avail) { err = (err || '') + ` OVERRUN ${used}>${avail}`; break; }
  }
  // stats
  const P = dec.positions.filter(Boolean);
  let bbox = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
  for (const p of P) for (let k = 0; k < 3; k++) {
    if (p[k] < bbox[0][k]) bbox[0][k] = p[k];
    if (p[k] > bbox[1][k]) bbox[1][k] = p[k];
  }
  const badFace = dec.faces.slice(0, dec.numFacesCur).filter(f => f.a >= dec.numPositionsCur || f.b >= dec.numPositionsCur || f.c >= dec.numPositionsCur).length;
  return {
    err, res, positions: dec.numPositionsCur, faces: dec.numFacesCur,
    normals: dec.numNormalsCur, texCoords: dec.numTexCoordsCur, badFace,
    bbox: bbox[0][0] === Infinity ? null : bbox.map(v => v.map(x => +x.toFixed(2))),
    decl: { groups: d.groups, finalRes: d.finalRes, center: d.floats.slice(0, 3).map(x => +x.toFixed(2)), radius: +d.floats[3].toFixed(2) },
  };
}

const file = process.argv[2];
const optJson = process.argv[3] ? JSON.parse(process.argv[3]) : null;
const trace = process.argv[4] ? parseInt(process.argv[4]) : 0;

if (optJson) {
  console.log(JSON.stringify(run(file, optJson, trace), null, 1));
} else {
  // sweep
  const combos = [];
  for (const updateTag of [true, false])
    for (const texCounts of [true, false])
      for (const texCoordDims of texCounts ? [2, 4] : [2])
        for (const sharedPosMagCtx of [true, false])
          for (const normals of [true, false])
            combos.push({ updateTag, texCounts, texCoordDims, sharedPosMagCtx, sharedNormalMagCtx: sharedPosMagCtx, sharedTexMagCtx: sharedPosMagCtx, normals });
  for (const c of combos) {
    const r = run(file, c, 0);
    console.log(JSON.stringify(c), '=>', r.err ? `ERR ${r.err} @res${r.res}+${r.positions}` : `OK pos=${r.positions} faces=${r.faces} norm=${r.normals} tex=${r.texCoords} bad=${r.badFace} bbox=${JSON.stringify(r.bbox)}`);
  }
}
