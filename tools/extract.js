// Extract all 2D assets from dumped Director chunks
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const CH = process.argv[2];
const OUT = process.argv[3];
const inv = JSON.parse(fs.readFileSync(process.argv[4]));
for (const d of ['textures', 'sounds', 'text', 'models']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const read = (n) => {
  for (const v of [n, n.replace('-', ' -')]) {
    const p = path.join(CH, v + '.bin');
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  throw new Error('missing chunk ' + n);
};
const exists = (n) => fs.existsSync(path.join(CH, n + '.bin'));

// ---------- PackBits (Director RLE) ----------
function unpack(buf, expected) {
  const out = Buffer.alloc(expected);
  let i = 0, o = 0;
  while (i < buf.length && o < expected) {
    const n = buf[i++];
    if (n >= 128) {
      const cnt = 257 - n, v = buf[i++];
      for (let k = 0; k < cnt && o < expected; k++) out[o++] = v;
    } else {
      for (let k = 0; k <= n && o < expected; k++) out[o++] = buf[i++];
    }
  }
  return { out, consumed: i, produced: o };
}

// ---------- CASt bitmap specific data ----------
function bitmapInfo(castChunkId) {
  const b = read('CASt-' + castChunkId);
  const specificLen = b.readUInt32BE(8);
  const s = b.subarray(b.length - specificLen);
  const pitch = s.readUInt16BE(0) & 0x7fff;
  const top = s.readInt16BE(2), left = s.readInt16BE(4), bottom = s.readInt16BE(6), right = s.readInt16BE(8);
  const regY = s.readInt16BE(18), regX = s.readInt16BE(20);
  let depth = 1, palette = 0;
  if (specificLen > 22) { depth = s.readUInt8(23); palette = s.readInt16BE(24); }
  return { pitch, w: right - left, h: bottom - top, regX: regX - left, regY: regY - top, depth, palette };
}

function savePNG(name, w, h, rgba, meta) {
  const png = new PNG({ width: w, height: h });
  rgba.copy(png.data);
  fs.writeFileSync(path.join(OUT, 'textures', name + '.png'), PNG.sync.write(png));
  return meta;
}

// grayscale system palette fallback for low-depth bitmaps
function decodeBITD(m, info) {
  const raw = read(m);
  const { pitch, w, h, depth } = info;
  const rgba = Buffer.alloc(w * h * 4);
  if (depth === 32) {
    // rows RLE-packed; each row = pitch bytes = 4 planes of w bytes
    let src = raw, off = 0;
    for (let y = 0; y < h; y++) {
      const { out, consumed } = unpack(src.subarray(off), pitch);
      off += consumed;
      for (let x = 0; x < w; x++) {
        const a = out[x], r = out[w + x], g = out[2 * w + x], bl = out[3 * w + x];
        const o = (y * w + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = a;
      }
    }
  } else if (depth === 8) {
    // classic Mac 8-bit system palette
    const pal = [];
    for (let i = 0; i < 215; i++) pal.push([255 - 51 * Math.floor(i / 36), 255 - 51 * (Math.floor(i / 6) % 6), 255 - 51 * (i % 6)]);
    const ks = [14, 13, 11, 10, 8, 7, 5, 4, 2, 1];
    for (const c of [0, 1, 2]) for (const k of ks) { const v = [0, 0, 0]; v[c] = 17 * k; pal.push(v); }
    for (const k of ks) pal.push([17 * k, 17 * k, 17 * k]);
    pal.push([0, 0, 0]);
    let off = 0;
    for (let y = 0; y < h; y++) {
      const { out, consumed } = unpack(raw.subarray(off), pitch);
      off += consumed;
      for (let x = 0; x < w; x++) {
        const idx = out[x];
        const [r, g, bch] = pal[idx];
        const o = (y * w + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bch;
        rgba[o + 3] = idx === 0 ? 0 : 255; // index 0 (white) knocked out like Director matte ink
      }
    }
  } else if (depth === 1) {
    let off = 0;
    for (let y = 0; y < h; y++) {
      const { out, consumed } = unpack(raw.subarray(off), pitch);
      off += consumed;
      for (let x = 0; x < w; x++) {
        const bit = (out[x >> 3] >> (7 - (x & 7))) & 1;
        const v = bit ? 0 : 255;
        const o = (y * w + x) * 4;
        rgba[o] = v; rgba[o + 1] = v; rgba[o + 2] = v; rgba[o + 3] = 255;
      }
    }
  } else throw new Error('depth ' + depth);
  return rgba;
}

function decodeALFA(m, w, h) {
  const raw = read(m);
  // unpack the whole stream, then infer row pitch (rows are padded for odd widths)
  const { out, produced } = unpack(raw, w * h * 2 + 1024);
  if (produced === w * h) return out.subarray(0, w * h);
  const pitch = Math.floor(produced / h);
  if (pitch >= w && pitch * h <= produced + pitch) {
    const res = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) out.copy(res, y * w, y * pitch, y * pitch + w);
    return res;
  }
  console.log('  ALFA mismatch', m, produced, w * h);
  return null;
}

// members Director draws opaque (their file alpha is stale authoring data)
const OPAQUE_MEMBERS = new Set(['instpage1', 'instpage2', 'instpage3', 'gameoverscreen', 'basictext2']);

const report = [];
for (const mem of inv) {
  const links = {};
  for (const l of mem.links || []) { const [fcc, id] = l.split('-'); links[fcc] = l; }
  const safe = (mem.name || ('member' + mem.slot)).replace(/[^a-zA-Z0-9_-]/g, '_');
  try {
    if (mem.type === 'bitmap') {
      const info = bitmapInfo(mem.castChunkId);
      let rgba = null;
      if (links.ediM && fs.existsSync(path.join(CH, links.ediM + '.bin'))) {
        const jp = read(links.ediM);
        if (jp[0] === 0xff && jp[1] === 0xd8) {
          const img = jpeg.decode(jp, { useTArray: true, maxMemoryUsageInMB: 1024 });
          rgba = Buffer.from(img.data);
          info.w = img.width; info.h = img.height;
          if (links.ALFA && !OPAQUE_MEMBERS.has(safe)) {
            const alpha = decodeALFA(links.ALFA, img.width, img.height);
            if (alpha) for (let i = 0; i < img.width * img.height; i++) rgba[i * 4 + 3] = alpha[i];
          }
        }
      }
      if (!rgba && links.BITD) rgba = decodeBITD(links.BITD, info);
      if (rgba) {
        savePNG(safe, info.w, info.h, rgba);
        report.push({ name: safe, kind: 'bitmap', w: info.w, h: info.h, regX: info.regX, regY: info.regY, depth: info.depth });
      } else report.push({ name: safe, kind: 'bitmap', error: 'no data', links: mem.links });
    } else if (mem.type === 'field' || mem.type === 'button') {
      if (links.STXT) {
        const b = read(links.STXT);
        const off = b.readUInt32BE(0), len = b.readUInt32BE(4);
        fs.writeFileSync(path.join(OUT, 'text', safe + '.txt'), b.subarray(off, off + len));
        report.push({ name: safe, kind: 'text', len });
      }
    } else if (mem.type === 'sound') {
      if (links['snd']) {
        const b = read(links['snd']);
        // Mac 'snd ' resource
        const format = b.readUInt16BE(0);
        let o;
        if (format === 1) { const nt = b.readUInt16BE(2); o = 4 + nt * 6; }
        else o = 4; // format 2: refCount(2) already at 2.. commands at 4
        const nCmds = b.readUInt16BE(o); o += 2;
        let hdrOff = -1;
        for (let i = 0; i < nCmds; i++) {
          const cmd = b.readUInt16BE(o), p2 = b.readUInt32BE(o + 4);
          if ((cmd & 0x7fff) === 0x51 || (cmd & 0x7fff) === 0x50) hdrOff = p2;
          o += 8;
        }
        if (hdrOff < 0) hdrOff = o;
        const numChannels0 = b.readUInt32BE(hdrOff + 4);
        const rate = b.readUInt32BE(hdrOff + 8) / 65536;
        const encode = b.readUInt8(hdrOff + 20);
        let channels = 1, bits = 8, frames, dataOff;
        if (encode === 0xff) { // extended
          frames = b.readUInt32BE(hdrOff + 22);
          channels = numChannels0;
          bits = b.readUInt16BE(hdrOff + 48);
          dataOff = hdrOff + 64;
        } else if (encode === 0xfe) { // compressed - not expected
          throw new Error('compressed snd');
        } else {
          frames = numChannels0; // std header: length in bytes
          dataOff = hdrOff + 22;
          bits = 8; channels = 1;
        }
        const bytes = frames * channels * (bits / 8);
        const pcm = b.subarray(dataOff, dataOff + bytes);
        // write WAV (convert BE->LE for 16-bit)
        const data = Buffer.from(pcm);
        if (bits === 16) data.swap16();
        else if (bits === 8) for (let i = 0; i < data.length; i++) data[i] = data[i]; // 8-bit Mac snd is unsigned already
        const wav = Buffer.alloc(44 + data.length);
        wav.write('RIFF', 0); wav.writeUInt32LE(36 + data.length, 4); wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(channels, 22);
        wav.writeUInt32LE(Math.round(rate), 24); wav.writeUInt32LE(Math.round(rate) * channels * bits / 8, 28);
        wav.writeUInt16LE(channels * bits / 8, 32); wav.writeUInt16LE(bits, 34);
        wav.write('data', 36); wav.writeUInt32LE(data.length, 40);
        data.copy(wav, 44);
        fs.writeFileSync(path.join(OUT, 'sounds', safe + '.wav'), wav);
        report.push({ name: safe, kind: 'sound', rate, channels, bits, seconds: +(frames / rate).toFixed(2) });
      }
    } else if (mem.type === 'xtra' && links.XMED) {
      const b = read(links.XMED);
      if (b.toString('latin1', 0, 4) === '3DEM') {
        const ix = b.indexOf('IFX\0');
        if (ix < 0) throw new Error('no IFX magic');
        fs.writeFileSync(path.join(OUT, 'models', safe + '.w3d'), b.subarray(ix));
        report.push({ name: safe, kind: 'w3d', bytes: b.length - ix });
      }
    }
  } catch (e) {
    report.push({ name: safe, kind: mem.type, error: e.message });
  }
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(report.map(r => `${r.kind.padEnd(7)} ${r.name.padEnd(22)} ${r.error ? 'ERROR: ' + r.error : JSON.stringify(r).slice(0, 100)}`).join('\n'));
