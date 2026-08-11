// Sweep bitstream semantic variants; oracle = door's magnitude alphabet and
// per-file sanity across as many consecutive lead=4 records as possible.
'use strict';
const { BitStreamRead, ACStaticFull } = require('./bitstream2');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function mkbs(f, opts) {
  const buf = fs.readFileSync(S + '/assets/models/' + f);
  let off = 16, blocks = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    blocks.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  const bs = new BitStreamRead(blocks.filter(b => b.t === 0xFFFFFF49)[0].data, undefined, opts);
  bs.readString(); bs.readU32(); for (let k = 0; k < 4; k++) bs.readU32();
  return bs;
}

const DOOR_SET = new Set([0, 184, 798, 1024]);

// Parse records assuming: [split(static 0x400+i, i>=1)] [lead u8] [signs u8 if lead==4]
// [mx][my][mz] c32 ctx21. Stop at lead==6 (score 0.5 bonus) or failure.
// checkMag: function(i, m) -> bool
function run(file, opts, checkMag, maxUpd) {
  const bs = mkbs(file, opts);
  let score = 0;
  const log = [];
  try {
    for (let i = 0; i < maxUpd; i++) {
      let split = 0;
      if (i >= 1) {
        split = bs.readCompressedU32(ACStaticFull + i);
        if (split >= Math.max(i, 1)) { log.push(`i${i} badsplit ${split}`); break; }
      }
      const lead = bs.readU8();
      if (lead === 6) { log.push(`i${i} sp${split} LEAD6`); score += 0.5; break; }
      if (lead !== 4) { log.push(`i${i} badlead ${lead}`); break; }
      const signs = bs.readU8();
      if (signs > 7) { log.push(`i${i} badsigns ${signs}`); break; }
      const m = [bs.readCompressedU32(21), bs.readCompressedU32(21), bs.readCompressedU32(21)];
      if (!checkMag(i, m)) { log.push(`i${i} badmag ${m}`); break; }
      log.push(`i${i} sp${split} s${signs} m=${m}`);
      score++;
    }
  } catch (e) { log.push('EXC ' + e.message); }
  return { score, log };
}

const doorCheck = (i, m) => i === 0 ? (m[0] === 399 && m[1] === 512 && m[2] === 92) : m.every(x => DOOR_SET.has(x));
const genericCheck = (i, m) => m.every(x => x <= 1100);

const variants = [];
for (const ufFirst of [false, true])
  for (const flushUfAlways of [false, true])
    for (const noEscCount of [false, true])
      for (const noLearn of [false])
        for (const oneFastStatic of [false, true])
          variants.push({ ufFirst, flushUfAlways, noEscCount, noLearn, oneFastStatic });

const rows = [];
for (const v of variants) {
  const door = run('door.w3d', v, doorCheck, 48);
  const candy = run('candy1.w3d', v, genericCheck, 68);
  const hat = run('hat.w3d', v, genericCheck, 109);
  const tacks = run('tacks.w3d', v, genericCheck, 200);
  const track = run('track1.w3d', v, genericCheck, 400);
  rows.push({ v, door: door.score, candy: candy.score, hat: hat.score, tacks: tacks.score, track: track.score,
    total: door.score + candy.score + hat.score + tacks.score + track.score, doorLog: door.log, hatLog: hat.log });
}
rows.sort((a, b) => b.total - a.total);
for (const r of rows.slice(0, 8)) {
  console.log(JSON.stringify(r.v), `door=${r.door} candy=${r.candy} hat=${r.hat} tacks=${r.tacks} track=${r.track} total=${r.total}`);
}
console.log('\nbest door log:', rows[0].doorLog.slice(0, 10).join(' | '));
console.log('best hat log:', rows[0].hatLog.slice(0, 6).join(' | '));
