// Build cast member inventory: slot -> name, type, linked chunks
const fs = require('fs');
const path = require('path');
const CH = process.argv[2]; // chunks dir

// KEY_ json contains raw \x escapes — parse the binary instead.
// KEY_ bin: entrySize u16, entrySize2 u16, entryCount u32, usedCount u32, then entries {sectionID u32, castID u32, fourCC}
const kb = fs.readFileSync(path.join(CH, 'KEY_-3.bin'));
const km = { entries: [] };
{
  // big-endian? file is RIFX big-endian but many control chunks are BE. Detect via plausible values.
  const be = kb.readUInt16BE(0) === 12;
  const rd16 = be ? (o)=>kb.readUInt16BE(o) : (o)=>kb.readUInt16LE(o);
  const rd32 = be ? (o)=>kb.readUInt32BE(o) : (o)=>kb.readUInt32LE(o);
  const used = rd32(8);
  for (let i = 0; i < used; i++) {
    const o = 12 + i * 12;
    const sectionID = rd32(o), castID = rd32(o + 4);
    const fourCC = be ? kb.toString('latin1', o + 8, o + 12) : kb.toString('latin1', o + 8, o + 12).split('').reverse().join('');
    km.entries.push({ sectionID, castID, fourCC });
  }
}
const key = km;
// CAS_ = array of CASt chunk ids in cast slot order (big-endian u32s)
const casBin = fs.readFileSync(path.join(CH, 'CAS_-3829.bin'));
const slots = [];
for (let i = 0; i + 4 <= casBin.length; i += 4) slots.push(casBin.readUInt32BE(i));

const TYPE = {1:'bitmap',2:'filmloop',3:'field',4:'palette',5:'picture',6:'sound',7:'button',8:'shape',9:'movie',10:'digitalvideo',11:'script',12:'text',13:'obj',14:'transition',15:'xtra'};

// KEY_: sectionID chunk belongs to castID. castID for internal cast = 1024 + slot? Let's just print raw.
const byCast = {};
for (const e of key.entries) {
  if (!byCast[e.castID]) byCast[e.castID] = [];
  byCast[e.castID].push(e.fourCC.trim() + '-' + e.sectionID);
}

const out = [];
slots.forEach((castChunkId, idx) => {
  if (!castChunkId) return;
  const slot = idx + 1;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(CH, `CASt-${castChunkId}.json`))); }
  catch (e) { out.push({slot, castChunkId, error: 'no json'}); return; }
  // possible castID keys used in KEY_ table
  const links = byCast[castChunkId] || [];
  out.push({slot, castChunkId, type: TYPE[j.type] || j.type, name: j.info ? j.info.name : '', links});
});
console.log(JSON.stringify(out, null, 1));
