// Step-by-step manual read tool: node step.js <file.w3d> <spec>
// spec: comma list of reads: u8,u16,u32 (raw) or c8:CTX,c16:CTX,c32:CTX (compressed)
// CTX may be a number (dynamic ctx id) or sN (static with N symbols).
'use strict';
const fs = require('fs');
const { BitStreamRead, ACStaticFull } = require('./bitstream');

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

const file = process.argv[2];
const spec = process.argv[3].split(',');
const blockIdx = process.argv[4] ? parseInt(process.argv[4]) : 0;
const blocks = walk(file).filter(b => b.type === 0xFFFFFF49);
const data = blocks[blockIdx].data;
const bs = new BitStreamRead(data);
const name = bs.readString();
const numUpd = bs.readU32();
const hdr = [bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32()];
console.log(`name=${name} numUpd=${numUpd} hdr=${hdr} startbit=${bs.getBitCount()}`);
for (const s of spec) {
  const [kind, ctxS] = s.split(':');
  let ctx = 0;
  if (ctxS !== undefined) {
    ctx = ctxS.startsWith('s') ? ACStaticFull + parseInt(ctxS.slice(1)) : parseInt(ctxS);
  }
  let v;
  const before = bs.getBitCount();
  if (kind === 'u8') v = bs.readU8();
  else if (kind === 'u16') v = bs.readU16();
  else if (kind === 'u32') v = bs.readU32();
  else if (kind === 'f32') v = bs.readF32();
  else if (kind === 'c8') v = bs.readCompressedU8(ctx);
  else if (kind === 'c16') v = bs.readCompressedU16(ctx);
  else if (kind === 'c32') v = bs.readCompressedU32(ctx);
  console.log(`${s} = ${v}  bits ${before}->${bs.getBitCount()}`);
}
