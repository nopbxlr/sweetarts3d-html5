// Schema archaeology tool for W3D 0xFFFFFF49 progressive mesh blocks.
'use strict';
const fs = require('fs');
const { BitStreamRead } = require('./bitstream');

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

class TracedReader {
  constructor(data) {
    this.bs = new BitStreamRead(data);
    this.log = [];
    this.enabled = true;
  }
  trace(kind, ctx, v) {
    if (this.enabled && this.log.length < 400) {
      this.log.push(`${kind}(${ctx}) = ${v} @${this.bs.getBitCount()}`);
    }
    return v;
  }
  u8() { return this.trace('u8', '-', this.bs.readU8()); }
  u16() { return this.trace('u16', '-', this.bs.readU16()); }
  u32() { return this.trace('u32', '-', this.bs.readU32()); }
  f32() { return this.trace('f32', '-', this.bs.readF32()); }
  str() { return this.trace('str', '-', this.bs.readString()); }
  cu8(ctx) { return this.trace('cu8', ctx, this.bs.readCompressedU8(ctx)); }
  cu16(ctx) { return this.trace('cu16', ctx, this.bs.readCompressedU16(ctx)); }
  cu32(ctx) { return this.trace('cu32', ctx, this.bs.readCompressedU32(ctx)); }
}

const file = process.argv[2];
const blocks = walk(file);
const b49s = blocks.filter(b => b.type === 0xFFFFFF49);
const b45 = blocks.find(b => b.type === 0xFFFFFF45);

// parse declaration (tentative layout)
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
  return { name, a, n, groups, lists, floats, finalRes, tailBits: data.length * 8 - bs.bs?.getBitCount?.() };
}

const decl = parseDecl(b45.data);
console.log(JSON.stringify(decl, (k, v) => typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(5) : v));

// Now probe the first 0x49 block
const mode = process.argv[3] || 'trace1';
const data = b49s[0].data;
const r = new TracedReader(data);
const name = r.str();
const numUpd = r.u32();
const h = [r.u32(), r.u32(), r.u32(), r.u32()];
console.log(`\n49-block: name=${name} numUpd=${numUpd} hdr=${h} bitpos=${r.bs.getBitCount()} totalbits=${data.length * 8}`);

if (mode === 'raw') {
  // Just read a bunch of typed values per a spec string like "8,8,32,32,32"
  const spec = (process.argv[4] || '8,8,32,32,32,8,32,32,32').split(',');
  for (const s of spec) {
    if (s === '8') r.cu8(1000 + Math.random() * 0 | 0);
    else if (s === '16') r.cu16(1001);
    else if (s === '32') r.cu32(1002);
  }
  console.log(r.log.join('\n'));
}
