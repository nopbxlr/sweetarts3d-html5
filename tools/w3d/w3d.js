#!/usr/bin/env node
// W3D (Shockwave 3D / Intel IFX v2) file parser.
// Usage: node tools/w3d/w3d.js <file.w3d> <outdir>
// Parses scene blocks (nodes, materials, shaders, textures, mesh declarations),
// extracts embedded JPEG textures, and writes <name>.json to <outdir>.
// See NOTES.md for the discovered block layouts. The CLOD progressive mesh
// bitstream (0xFFFFFF49) is only partially decoded — see NOTES.md "Progressive
// mesh stream" for exactly what is and is not known.
'use strict';

const fs = require('fs');
const path = require('path');
const { BitStreamRead, ACStaticFull } = require('./bitstream');

const BT = {
  BOOK1: 0xFFFFFF01,
  BOOK2: 0xFFFFFF02,
  MATERIAL: 0xFFFFFF10,
  TEXTURE_DECL: 0xFFFFFF20,
  TEXTURE_DATA: 0xFFFFFF21,
  SHADER: 0xFFFFFF36,
  CLOD_DECL: 0xFFFFFF45,
  MESH_AUX: 0xFFFFFF47,
  MESH_SUMMARY: 0xFFFFFF48,
  MESH_PROGRESSIVE: 0xFFFFFF49,
  BONES: 0xFFFFFF4B,
  LIGHT_RES: 0xFFFFFF50,
  LIGHT_NODE: 0xFFFFFF71,
  MODEL_NODE: 0xFFFFFF72,
  VIEW_NODE: 0xFFFFFF74,
};

function walkBlocks(buf) {
  const magic = buf.toString('latin1', 0, 4);
  if (magic !== 'IFX\0') throw new Error('bad magic ' + JSON.stringify(magic));
  const fileSize = buf.readUInt32LE(12);
  const blocks = [];
  let off = 16;
  while (off + 8 <= buf.length) {
    const type = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (off + 8 + size > buf.length) break;
    blocks.push({ type, size, data: buf.slice(off + 8, off + 8 + size) });
    off += 8 + size;
    off = (off + 3) & ~3;
  }
  return { fileSize, blocks };
}

// simple little-endian cursor for the plain (non-arithmetic-coded) blocks
class Cur {
  constructor(buf) { this.b = buf; this.o = 0; }
  u8() { return this.b.readUInt8(this.o++); }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  str() { const n = this.u16(); const s = this.b.toString('latin1', this.o, this.o + n); this.o += n; return s; }
  f32s(n) { const a = []; for (let i = 0; i < n; i++) a.push(this.f32()); return a; }
  remaining() { return this.b.length - this.o; }
}

function parseNode(data) {
  const c = new Cur(data);
  const name = c.str();
  const parent = c.str();
  const userData = c.str(); // " " normally; bones models carry "ss3D_bone_count=9;ss3D_bone_1=..." here
  const transform = c.f32s(16).map(v => +v.toPrecision(7));
  const node = { name, parent, transform };
  if (userData.trim()) node.userData = userData;
  return { c, node };
}

function parseModelNode(data) {
  const { c, node } = parseNode(data);
  node.resourceName = c.str();
  node.styleName = c.str();       // "StyleResource"
  const nShaders = c.u32();
  node.shaders = [];
  for (let i = 0; i < nShaders && c.remaining() > 1; i++) node.shaders.push(c.str());
  return node;
}

function parseLightNode(data) {
  const { c, node } = parseNode(data);
  node.resourceName = c.str();
  return node;
}

function parseViewNode(data) {
  const { c, node } = parseNode(data);
  // [u32][f32 x7]... camera params (fov etc), then second target section. Kept raw.
  node.rest = [];
  try {
    node.viewFlags = c.u32();
    node.viewParams = c.f32s(8).map(v => +v.toPrecision(7));
  } catch (e) {}
  return node;
}

function parseLightResource(data) {
  const c = new Cur(data);
  const name = c.str();
  const a = c.u8(), b = c.u8();
  const color = c.f32s(4).map(v => +v.toPrecision(7));
  const rest = [];
  while (c.remaining() >= 4) rest.push(+c.f32().toPrecision(7));
  return { name, type: a, _unk: b, color, params: rest };
}

function parseMaterial(data) {
  const c = new Cur(data);
  const name = c.str();
  const attributes = c.u32(); // 0x3F observed
  const ambient = c.f32s(4).map(v => +v.toPrecision(7));
  const diffuse = c.f32s(4).map(v => +v.toPrecision(7));
  const specular = c.f32s(4).map(v => +v.toPrecision(7));
  const emissive = c.f32s(4).map(v => +v.toPrecision(7));
  const shininess = +c.f32().toPrecision(7);
  const transparency = +(1 - c.f32()).toPrecision(7); // stored value is opacity
  return { name, attributes, ambient, diffuse, specular, emissive, shininess, transparency };
}

function parseShader(data) {
  const c = new Cur(data);
  const name = c.str();
  const flagsA = c.u32();
  const flagsB = c.u32();
  const materialName = c.str();
  let textureName = null;
  const hasTexture = (flagsA & 0xFFFF0000) !== 0 || (flagsA & 0x2) !== 0;
  // empirically: untextured shaders are 32 bytes total; textured ones continue
  if (c.remaining() > 2) {
    try {
      textureName = c.str();
      // remaining: f32 (texture transform scale?), u8, u32, u32, 2 * 16 f32 matrices, u8
    } catch (e) { textureName = null; }
  }
  return { name, materialName, textureName, flagsA, flagsB };
}

function parseTextureDecl(data) {
  const c = new Cur(data);
  const name = c.str();
  const fmt = c.u8();
  const width = c.u32();
  const height = c.u32();
  const channels = c.u8();
  return { name, fmt, width, height, channels };
}

function parseTextureData(data) {
  const c = new Cur(data);
  const name = c.str();
  const seq = c.u8();
  return { name, seq, bytes: data.slice(c.o) };
}

// 0xFFFFFF45: CLOD mesh generator declaration
function parseCLODDecl(data) {
  const c = new Cur(data);
  const name = c.str();
  const fieldCount = c.u32();       // observed 6
  const numShadingGroups = c.u32();
  const groups = [];
  for (let i = 0; i < numShadingGroups; i++) {
    groups.push({
      maxPositions: c.u32(),
      maxFaces: c.u32(),
      maxNormals: c.u32(),
      maxTexCoords: c.u32(),
      unk4: c.u32(),                // always 0 in the corpus
      unk5: c.u32(),                // always 19 (0x13) in the corpus
    });
  }
  const numLists = c.u32();         // always 3
  const lists = [];
  for (let i = 0; i < numLists; i++) {
    const listName = c.str();
    const items = [];
    for (let j = 0; j < numShadingGroups; j++) items.push(c.str());
    lists.push({ name: listName, items });
  }
  const boundingSphere = { center: c.f32s(3).map(v => +v.toPrecision(7)), radius: +c.f32().toPrecision(7) };
  const unkFloat = c.f32();         // always 1.0
  const inverseQuant = {
    position: c.f32(),
    normal: c.f32(),
    texCoord: c.f32(),
    diffuse: c.f32(),
    specular: c.f32(),
  };
  const finalMaxResolution = c.u32();
  return { name, fieldCount, groups, lists, boundingSphere, inverseQuant, finalMaxResolution };
}

function parseMeshSummary(data) {
  const c = new Cur(data);
  const name = c.str();
  const finalResolution = c.u32();
  const minResolution = c.u32();
  return { name, finalResolution, minResolution, tail: data.slice(c.o).toString('hex') };
}

function parseProgressiveHeader(data) {
  const bs = new BitStreamRead(data);
  const name = bs.readString();
  const numUpdates = bs.readU32();
  const header = [bs.readU32(), bs.readU32(), bs.readU32(), bs.readU32()];
  return { name, numUpdates, header, payloadBits: data.length * 8 - bs.getBitCount() };
}

// 0xFFFFFF4B bones (snake only) — best-effort structural parse
function parseBones(data) {
  const c = new Cur(data);
  const name = c.str();
  const out = { name, raw: null, bones: [] };
  try {
    const count = c.u32();
    out.count = count;
    for (let i = 0; i < count && c.remaining() > 8; i++) {
      const bname = c.str();
      const parentIndex = c.u32() | 0;          // -1 for root
      const length = +c.f32().toPrecision(7);
      const displacement = c.f32s(3).map(v => +v.toPrecision(7));
      const rotation = c.f32s(4).map(v => +v.toPrecision(7)); // (w,x,y,z) unit quat
      const trailing = c.u32(); // always 0 in snake.w3d
      out.bones.push({ name: bname, parentIndex, length, displacement, rotation, _trailing: trailing });
    }
    // trailing u32s: per-shading-group position counts (matches declaration)
    out.trailing = [];
    while (c.remaining() >= 4) out.trailing.push(c.u32());
  } catch (e) {
    out.error = e.message;
    out.raw = data.toString('hex');
  }
  return out;
}

function parseFile(file) {
  const buf = fs.readFileSync(file);
  const { blocks } = walkBlocks(buf);
  const out = {
    source: path.basename(file),
    nodes: [],
    materials: [],
    shaders: [],
    lights: [],
    textures: [],
    meshes: [],
    bones: null,
    _blockSummary: blocks.map(b => ({ type: '0x' + (b.type >>> 0).toString(16), size: b.size })),
  };
  const textureData = new Map();
  for (const b of blocks) {
    try {
      switch (b.type) {
        case BT.MODEL_NODE: out.nodes.push(Object.assign({ kind: 'model' }, parseModelNode(b.data))); break;
        case BT.LIGHT_NODE: out.nodes.push(Object.assign({ kind: 'light' }, parseLightNode(b.data))); break;
        case BT.VIEW_NODE: out.nodes.push(Object.assign({ kind: 'view' }, parseViewNode(b.data))); break;
        case BT.LIGHT_RES: out.lights.push(parseLightResource(b.data)); break;
        case BT.MATERIAL: out.materials.push(parseMaterial(b.data)); break;
        case BT.SHADER: out.shaders.push(parseShader(b.data)); break;
        case BT.TEXTURE_DECL: out.textures.push(parseTextureDecl(b.data)); break;
        case BT.TEXTURE_DATA: {
          const t = parseTextureData(b.data);
          if (!textureData.has(t.name)) textureData.set(t.name, []);
          textureData.get(t.name).push(t.bytes);
          break;
        }
        case BT.CLOD_DECL: {
          const d = parseCLODDecl(b.data);
          out.meshes.push({
            name: d.name,
            declaration: d,
            progressiveBlocks: [],
            // geometry decode status: see NOTES.md
            positions: null, normals: null, uvs: null, faces: null, faceShading: null,
            geometryDecoded: false,
          });
          break;
        }
        case BT.MESH_SUMMARY: {
          const s = parseMeshSummary(b.data);
          const m = out.meshes.find(m => m.name === s.name);
          if (m) m.summary = s;
          break;
        }
        case BT.MESH_PROGRESSIVE: {
          const h = parseProgressiveHeader(b.data);
          const m = out.meshes.find(m => m.name === h.name);
          if (m) m.progressiveBlocks.push({ numUpdates: h.numUpdates, header: h.header, bytes: b.data.length });
          break;
        }
        case BT.BONES: out.bones = parseBones(b.data); break;
        default: break;
      }
    } catch (e) {
      (out._errors = out._errors || []).push({ type: '0x' + (b.type >>> 0).toString(16), error: e.message });
    }
  }
  // attach shader/material linkage per mesh from the declaration string lists
  for (const m of out.meshes) {
    const d = m.declaration;
    const shaderList = d.lists.find(l => l.name !== 'StyleResource' && l.name !== 'default');
    const matList = d.lists.find(l => l.name === 'StyleResource');
    m.shading = d.groups.map((g, i) => ({
      group: i,
      shaderName: shaderList ? shaderList.items[i] : null,
      materialName: matList ? matList.items[i] : null,
      maxPositions: g.maxPositions, maxFaces: g.maxFaces,
      maxNormals: g.maxNormals, maxTexCoords: g.maxTexCoords,
    }));
  }
  return { out, textureData };
}

function main() {
  const file = process.argv[2];
  const outdir = process.argv[3];
  if (!file || !outdir) {
    console.error('usage: node tools/w3d/w3d.js <file.w3d> <outdir>');
    process.exit(2);
  }
  fs.mkdirSync(outdir, { recursive: true });
  const { out, textureData } = parseFile(file);
  const base = path.basename(file).replace(/\.w3d$/i, '');

  // write textures
  out.textureFiles = [];
  for (const [name, parts] of textureData) {
    const bytes = Buffer.concat(parts);
    const soi = bytes[0] === 0xFF && bytes[1] === 0xD8;
    let eoi = false;
    for (let i = bytes.length - 2; i >= Math.max(0, bytes.length - 64); i--) {
      if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) { eoi = true; break; }
    }
    fs.mkdirSync(path.join(outdir, 'tex'), { recursive: true });
    const fname = path.join('tex', `${base}_${name.replace(/[^A-Za-z0-9._-]/g, '_')}`);
    fs.writeFileSync(path.join(outdir, fname), bytes);
    out.textureFiles.push({ name, file: fname, bytes: bytes.length, validJpeg: soi && eoi });
    const t = out.textures.find(t => t.name === name);
    if (t) t.file = fname;
  }

  fs.writeFileSync(path.join(outdir, base + '.json'), JSON.stringify(out, null, 1));
  console.log(`${base}: nodes=${out.nodes.length} materials=${out.materials.length} shaders=${out.shaders.length} meshes=${out.meshes.length} textures=${out.textureFiles.map(t => t.name + (t.validJpeg ? '(ok)' : '(BAD)')).join(',') || '-'}`);
}

if (require.main === module) main();
module.exports = { walkBlocks, parseFile, parseCLODDecl };
