// Block walker / hexdumper for W3D (IFX v2) files — analysis tool.
'use strict';
const fs = require('fs');

function walk(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.toString('latin1', 0, 4);
  const w1 = buf.readUInt32LE(4), w2 = buf.readUInt32LE(8), fsize = buf.readUInt32LE(12);
  console.log(`file=${file} magic=${JSON.stringify(magic)} w1=${w1} w2=0x${w2.toString(16)} fileSize=${fsize} actual=${buf.length}`);
  let off = 16;
  const blocks = [];
  while (off + 8 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (off + 8 + size > buf.length) { console.log(`  TRUNC block at ${off} type=0x${type.toString(16)} size=${size}`); break; }
    blocks.push({ type, size, off: off + 8 });
    off += 8 + size;
    off = (off + 3) & ~3;
  }
  return { buf, blocks };
}

function hex(buf, start, len) {
  const end = Math.min(start + len, buf.length);
  let out = '';
  for (let o = start; o < end; o += 16) {
    const slice = buf.slice(o, Math.min(o + 16, end));
    const hx = [...slice].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = [...slice].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    out += `${(o - start).toString(16).padStart(6, '0')}  ${hx.padEnd(48)}  ${asc}\n`;
  }
  return out;
}

const file = process.argv[2];
const filter = process.argv[3] ? parseInt(process.argv[3], 16) : null;
const maxDump = process.argv[4] ? parseInt(process.argv[4]) : 256;
const { buf, blocks } = walk(file);
for (const b of blocks) {
  console.log(`block type=0x${b.type.toString(16)} size=${b.size} dataOff=${b.off}`);
  if (filter === null || b.type === filter) {
    console.log(hex(buf, b.off, Math.min(b.size, maxDump)));
  }
}
