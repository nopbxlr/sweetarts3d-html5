// Full W3D progressive mesh decoder (IFX v2), reverse-engineered from
// SW3D_Exp.dle (grammar) + empirical validation.
//
// Blocks per mesh resource:
//   0xFFFFFF45 declaration: groups, IQ factors, bounding sphere, finalRes
//   0xFFFFFF47 schedule: per-group delta-coded record resolutions (flat cu32(1) stream)
//   0xFFFFFF49 record stream(s): one bitstream per block, fresh contexts each
//
// Record (per (resolution, group) firing, ordered by (res, group)):
//   cu32(1,A=numBundles) cu32(3,C=numFaceUpdates) cu32(2,B=numNewFaces) cu32(4,D=numDistinctFaces)
//   D distinct face refs: first cuS(faceCount(g)), then k: delta=cuS(faceCount(g)-prev), f += delta (+1?)
//   A bundles (new corner-vertices):
//     pos: cu8(6,pc) [pc!=4: cu32(5,fli)] cu8(7,signs) cu32(8,mx) cu32(8,my) cu32(8,mz)
//     nrm: cu8(0xa,nc) [nc!=4: cu32(9,fli)] cu8(0xb,signs) cu32(0xc,qz) phi=cuS(N+1)
//          N=trunc(acos(0)/qN*sqrt((1-z)(1+z))+0.5), z=fround(qz*qN) clamped
//     tex xLayers: cu8(0xe,tc) [tc!=4: cu32(0xf,fli)] cu8(0x10,signs2) cu32(0x11,mu) cu32(0x11,mv)
//     bones: cu32(0x12,cnt) then per k: cu32(0x13,boneId) [k>0: cu32(0x14,weight)]
//   C face updates: [D>0: cu32(0x15,fli)] cu8(0x16,corner) cu32(0x17,rel)
//     [rel==0: rawU32(oldGlobalIdx)] cu8(0x18,oldCode) [oldCode==3: cu32(0x19???,...)]
//   B new faces:
//     3 corners: cu8(0x19,code): 0: rawU32(idx); 1: cu32(0x1a, idx-vc+A);
//                2/3/4: cu32(0x1b,fli)+cu32(0x1c,diff) => idx = face[fli].corner[code-2]+diff
//     cu8(0x1d, shadingByte)
//     cu8(0x1e, b0) cu8(0x1e, b1) cu8(0x1e, b2)
//     3 corner-attrs: cu8(0x1f,code):
//        0/1/2: cu32(0x22,i)+cu32(0x23,j)
//        4:     cu32(0x20,mag)+cuS(faceCount(g))
//        5:     cu32(0x20,mag)+cu32(0x21,d)     (idx = faceCount + d)
//        3,>=6: cu32(0x20,mag)+cu32(0x24,d)
'use strict';
const { BitStreamRead, ACStaticFull, ACMaxRange } = require('./bitstream');
const fs = require('fs');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function blocks(buf) {
  let off = 16, out = [];
  while (off + 8 <= buf.length) {
    const t = buf.readUInt32LE(off), s = buf.readUInt32LE(off + 4);
    out.push({ t, data: buf.slice(off + 8, off + 8 + s) });
    off += 8 + s; off = (off + 3) & ~3;
  }
  return out;
}

function parseDecl(data) {
  const bs = new BitStreamRead(data);
  const name = bs.readString();
  bs.readU32();
  const n = bs.readU32();
  const groups = [];
  for (let i = 0; i < n; i++) {
    const g = {};
    g.maxPositions = bs.readU32(); g.maxFaces = bs.readU32();
    g.maxNormals = bs.readU32(); g.maxTexCoords = bs.readU32();
    bs.readU32(); bs.readU32();
    groups.push(g);
  }
  const numLists = bs.readU32();
  const lists = [];
  for (let i = 0; i < numLists; i++) {
    const lname = bs.readString(); const items = [];
    for (let j = 0; j < n; j++) items.push(bs.readString());
    lists.push({ name: lname, items });
  }
  const fl = []; for (let i = 0; i < 10; i++) fl.push(bs.readF32());
  const finalRes = bs.readU32();
  return { name, groups, lists, center: fl.slice(0, 3), radius: fl[3],
           iq: fl.slice(5, 10), finalRes };
}

function parseSchedule47(data, maxVals) {
  const bs = new BitStreamRead(data);
  const name = bs.readString();
  const vals = [], bits = [];
  const total = data.length * 8;
  while (vals.length < maxVals + 8) {
    const before = bs.getBitCount();
    let v;
    try { v = bs.readCompressedU32(1); } catch (e) { break; }
    if (bs.getBitCount() > total) break;
    vals.push(v); bits.push(before);
  }
  return { name, vals, bits };
}

class MeshDecoder {
  constructor(decl, sched) {
    this.decl = decl;
    this.sched = sched;
    this.qPos = decl.iq[0]; this.qN = decl.iq[1]; this.qT = decl.iq[2];
  }
  cuS(bs, n, width) {
    if (n < 1) n = 1;
    // WriteCompressedU32 falls back to a RAW write when the static context
    // exceeds the codec range (ctx >= ACMaxRange = 0x400+0x3FFF).
    if (ACStaticFull + n >= ACMaxRange) {
      return width === 8 ? bs.readU8() : width === 16 ? bs.readU16() : bs.readU32();
    }
    const symOur = bs.readSymbol(ACStaticFull + n);
    const s0 = symOur - 1;
    if (s0 === 0) return width === 8 ? bs.readU8() : width === 16 ? bs.readU16() : bs.readU32();
    return s0 - 1;
  }

  // schedule: array per group of cumulative resolutions
  // returns firing order list of {g, res} (group index + resolution step)
  static firingOrder(resLists) {
    const idx = resLists.map(() => 0);
    const order = [];
    // simulate: for res = 1.. : for g in 0..n-1: (single fire per res per group)
    let guard = 0;
    for (let res = 1; guard < 100000; res++, guard++) {
      let done = true;
      for (let g = 0; g < resLists.length; g++) {
        if (idx[g] < resLists[g].length) {
          done = false;
          if (resLists[g][idx[g]] <= res) { order.push({ g, res }); idx[g]++; }
        }
      }
      if (done) break;
    }
    return order;
  }

  decode(b49datas, order, opts) {
    opts = opts || {};
    const nG = this.decl.groups.length;
    const G = [];
    for (let g = 0; g < nG; g++) G.push({ verts: [], faces: [], uvs: [], normals: [], boneWeights: [] });
    this.G = G;
    // Encoder-mirror state: the writer scrubs its mirror mesh to (res-1)
    // vertices before writing the record at res; the C-updates of the record
    // that created the last vertex are then NOT yet applied. So predictor
    // resolution (bundle pc/tc and new-face corner codes 2..4) must see a
    // topology in which the previous record's C-updates are still pending
    // whenever that record sits at res-1. New faces enter the mirror with
    // their creation corner values immediately (scrub-down leaves exactly
    // those values beyond the horizon).
    this.mirror = G.map(() => ({ faces: [] }));
    this.pending = null; // { res, items: [ [g, fi, corner, nv], ... ] }
    let oi = 0;
    let resBase = 0; // resolution steps consumed by previous blocks
    for (const data of b49datas) {
      const bs = new BitStreamRead(data);
      this.bs = bs;
      bs.readString();
      const numUpdates = bs.readU32(); // resolution steps in this block (writer arg [esp+0x29c])
      const totalBits = data.length * 8;
      const resLimit = resBase + numUpdates;
      // exactly the firings whose resolution step falls inside this block
      while (oi < order.length && order[oi].res <= resLimit) {
        const g = order[oi].g;
        if (this.pending && this.pending.res <= order[oi].res - 2) this.flushPending();
        this.curRes = order[oi].res;
        const st = this.record(G[g], g);
        if (st === 'overrun' || this.bad) return { ok: false, err: this.bad || 'overrun', at: oi, G };
        oi++;
        if (bs.getBitCount() > totalBits) return { ok: false, err: 'blockoverrun', at: oi, G };
      }
      resBase = resLimit;
      // trailing raw u32 0 + flush pad follow; next block restarts a fresh bitstream
    }
    return { ok: oi === order.length, parsed: oi, total: order.length, G };
  }

  flushPending() {
    for (const [g, fi, corner, nv] of this.pending.items) this.mirror[g].faces[fi][corner] = nv;
    this.pending = null;
  }

  record(st, g) {
    const bs = this.bs;
    this.bad = null;
    const T = this.trace ? (...a) => console.log(`  [${bs.getBitCount()}]`, ...a) : null;
    const A = bs.readCompressedU32(1);
    const C = bs.readCompressedU32(3);
    const B = bs.readCompressedU32(2);
    const D = bs.readCompressedU32(4);
    if (T) T(`g=${g} A=${A} C=${C} B=${B} D=${D} vc=${st.verts.length} fc=${st.faces.length}`);
    if (A > 1000 || B > 1000 || C > 1000 || D > 1000) { this.bad = `hdr A=${A} C=${C} B=${B} D=${D}`; return; }
    const mirror0 = this.mirror[g];
    const faceCount0 = st.faces.length;
    const dfaces = [];
    if (D > 0) {
      let f = this.cuS(bs, faceCount0, 32);
      dfaces.push(f);
      for (let k = 1; k < D; k++) {
        const d = this.cuS(bs, faceCount0 - f, 32);
        f += d;
        dfaces.push(f);
      }
      if (dfaces.some(x => x >= faceCount0)) { this.bad = `dface ${dfaces} >= ${faceCount0}`; return; }
      if (T) T('dfaces', dfaces.join(','), 'corners', dfaces.map(f=>mirror0.faces[f].join(':')).join(' '));
    }
    const mirror = mirror0;
    const V = this.variant || {};
    // bundles
    const vc0 = st.verts.length;
    for (let j = 0; j < A; j++) {
      if (V.preBundle) V.preBundle(bs, j);
      // position
      if (V.noPos) { st.verts.push({ p: [0,0,0], n: [0,0,1], uv: null, bw: [] }); continue; }
      const pc = bs.readCompressedU8(6);
      if (T) T(`bundle${j} pc=${pc}`);
      let pfli = -1;
      if (pc !== 4) pfli = bs.readCompressedU32(5);
      if (T && pc !== 4) T(`  pfli=${pfli}`);
      const ps = bs.readCompressedU8(7);
      if (T) T(`  signs=${ps}`);
      const pm = [bs.readCompressedU32(8), bs.readCompressedU32(8), bs.readCompressedU32(8)];
      const magCap = Math.max(60000, 8 * this.decl.radius / this.qPos);
      if (ps > 7 || pm.some(x => x > magCap)) { this.bad = `pos j${j} s=${ps} m=${pm}`; return; }
      let pred;
      if (pc === 4) pred = [0, 0, 0];
      else {
        if (pfli >= dfaces.length) { this.bad = `pos fli ${pfli}`; return; }
        const fc = mirror.faces[dfaces[pfli]];
        pred = st.verts[fc[pc]].p.slice();
      }
      const p = [0, 1, 2].map(k => pred[k] + ((ps >> k) & 1 ? -1 : 1) * pm[k] * this.qPos);
      if (T) T(`bundle${j} pc=${pc} pfli=${pfli} signs=${ps} m=${pm}`);
      if (V.noNrm) {
        let uv0 = null;
        if (!V.noTex && this.decl.groups[g].maxTexCoords > 0) {
          const tc = bs.readCompressedU8(0xe);
          if (tc !== 4) bs.readCompressedU32(0xf);
          const tsg = bs.readCompressedU8(0x10);
          const mu = bs.readCompressedU32(0x11), mv = bs.readCompressedU32(0x11);
          if (tsg > 3 || mu > 60000 || mv > 60000) { this.bad = `tex j${j} s=${tsg} uv=${mu},${mv}`; return; }
        }
        if (!V.noBones) {
          const nb = bs.readCompressedU32(0x12);
          if (nb > 8) { this.bad = `bones ${nb}`; return; }
          for (let k = 0; k < nb; k++) { bs.readCompressedU32(0x13); if (k > 0) bs.readCompressedU32(0x14); }
        }
        st.verts.push({ p, n: [0,0,1], uv: uv0, bw: [] });
        continue;
      }
      // normal
      const nc = bs.readCompressedU8(0xa);
      let nfli = -1;
      if (nc !== 4) nfli = bs.readCompressedU32(9);
      const ns = bs.readCompressedU8(0xb);
      const qz = bs.readCompressedU32(0xc);
      if (T) T(`  nrmraw nc=${nc} nfli=${nfli} ns=${ns} qz=${qz}`);
      // qz can legitimately be huge/-1 (encoder ftol on degenerate normals);
      // the z clamp below then yields z=1, s=0, N=0 exactly as the writer.
      if (ns > 7) { this.bad = `nrm j${j} s=${ns} q=${qz}`; return; }
      let z = Math.fround(qz * this.qN);
      if (z > 1) z = 1;
      const s = Math.sqrt((1 - z) * (1 + z));
      const N = Math.trunc(Math.acos(0.0) * (1 / this.qN) * s + 0.5);
      if (T) T(`  nrm nc=${nc} nfli=${nfli} ns=${ns} qz=${qz} z=${z} N=${N}`);
      const phi = this.cuS(bs, N + 1, 32);
      if (T) T(`  phi=${phi}`);
      if (phi > N + 1) { this.bad = `phi ${phi} N=${N}`; return; }
      // reconstruct normal (identity frame approx for nc==4)
      const ang = phi * this.qN / (s || 1);
      let nx = Math.cos(ang) * s, ny = Math.sin(ang) * s, nz = z;
      if (ns & 1) nx = -nx; if (ns & 2) ny = -ny; if (ns & 4) nz = -nz;
      // texcoords (layers=1 assumed when maxTexCoords>0)
      let uv = null;
      if (!V.noTex && this.decl.groups[g].maxTexCoords > 0) {
        const tc = bs.readCompressedU8(0xe);
        let tfli = -1;
        if (tc !== 4) tfli = bs.readCompressedU32(0xf);
        const tsg = bs.readCompressedU8(0x10);
        const mu = bs.readCompressedU32(0x11), mv = bs.readCompressedU32(0x11);
        if (T) T(`  tex tc=${tc} tfli=${tfli} ts=${tsg} m=${mu},${mv}`);
        if (tsg > 3 || mu > 60000 || mv > 60000) { this.bad = `tex j${j} s=${tsg} uv=${mu},${mv}`; return; }
        let tpred = [0.5, 0.5];
        if (tc !== 4) {
          if (tfli >= dfaces.length) { this.bad = `tex fli`; return; }
          const fc = mirror.faces[dfaces[tfli]];
          tpred = st.verts[fc[tc]].uv ? st.verts[fc[tc]].uv.slice() : [0.5, 0.5];
        }
        uv = [tpred[0] + (tsg & 1 ? -1 : 1) * mu * this.qT,
              tpred[1] + (tsg & 2 ? -1 : 1) * mv * this.qT];
      }
      // bones
      if (V.noBones) { st.verts.push({ p, n: [nx, ny, nz], uv, bw: [] }); continue; }
      const nb = bs.readCompressedU32(0x12);
      if (T) T(`  bones nb=${nb}`);
      if (nb > 8) { this.bad = `bones ${nb}`; return; }
      const bw = [];
      for (let k = 0; k < nb; k++) {
        const id = bs.readCompressedU32(0x13);
        let w = 0;
        if (k > 0) w = bs.readCompressedU32(0x14);
        bw.push([id, w]);
      }
      st.verts.push({ p, n: [nx, ny, nz], uv, bw });
    }
    // face updates: PARSE ONLY here. The encoder's mirror mesh stays at the
    // PRE-record state while the whole record is written (SW3D_Exp.dle scrubs
    // via SetResolution before the record and never mutates mid-record), so
    // the B-new-face corner predictors (codes 2..4) must resolve against the
    // face corner values BEFORE these updates are applied. Apply after B loop.
    const pendingUpdates = [];
    for (let j = 0; j < C; j++) {
      let fi;
      if (D > 0) {
        const li = bs.readCompressedU32(0x15);
        if (li >= dfaces.length) { this.bad = `fup li ${li}`; return; }
        fi = dfaces[li];
      } else fi = -1;
      const corner = bs.readCompressedU8(0x16);
      const rel = bs.readCompressedU32(0x17);
      let nv;
      if (rel === 0) nv = bs.readU32();
      else nv = st.verts.length - A + (rel - 1);
      const oldCode = bs.readCompressedU8(0x18);
      if (corner > 2 || nv >= st.verts.length) { this.bad = `fup c=${corner} nv=${nv}`; return; }
      if (T) T(`fup fi=${fi} corner=${corner} rel=${rel} nv=${nv} old=${oldCode}`);
      if (oldCode === 3) bs.readU32(); // explicit old vertex value: RAW u32 (writer 0x1063fcf9 vtbl+0x1c)
      if (fi >= 0) pendingUpdates.push([fi, corner, nv]);
    }
    // new faces
    for (let j = 0; j < B; j++) {
      const cs = [];
      for (let c = 0; c < 3; c++) {
        const code = bs.readCompressedU8(0x19);
        let idx;
        if (code === 0) idx = bs.readU32();
        else if (code === 1) idx = st.verts.length - A + bs.readCompressedU32(0x1a);
        else if (code >= 2 && code <= 4) {
          const fli = bs.readCompressedU32(0x1b);
          const d = bs.readCompressedU32(0x1c);
          if (fli >= dfaces.length) { this.bad = `nf fli ${fli}`; return; }
          idx = mirror.faces[dfaces[fli]][code - 2] + d;
        } else { this.bad = `nf code ${code}`; return; }
        if (T) T(`nf${j} c${c} code=${code} idx=${idx}`);
        if (idx >= st.verts.length) { this.bad = `nf idx ${idx}/${st.verts.length} code=${code}`; return; }
        cs.push(idx);
      }
      const shading = bs.readCompressedU8(0x1d);
      if (T) T(`nf${j} shading=${shading}`);
      const e = [bs.readCompressedU8(0x1e), bs.readCompressedU8(0x1e), bs.readCompressedU8(0x1e)];
      for (let c = 0; c < 3; c++) {
        const code = bs.readCompressedU8(0x1f);
        if (T) T(`attr c${c} code=${code}`);
        if (code <= 2) { bs.readCompressedU32(0x22); bs.readCompressedU32(0x23); }
        else if (code === 4) { bs.readCompressedU32(0x20); this.cuS(bs, st.faces.length, 32); }
        else if (code === 5) { bs.readCompressedU32(0x20); bs.readCompressedU32(0x21); }
        else { bs.readCompressedU32(0x20); bs.readCompressedU32(0x24); }
      }
      st.faces.push(cs);
      st.faces[st.faces.length - 1].shading = shading;
      mirror.faces.push(cs.slice(0, 3)); // creation values
    }
    // Output topology: apply the C face-corner repointings now.
    for (const [fi, corner, nv] of pendingUpdates) st.faces[fi][corner] = nv;
    // Mirror topology: defer them until the writer would have scrubbed past
    // this record (handled by flushPending in decode()).
    if (this.pending) this.flushPending();
    this.pending = { res: this.curRes,
                     items: pendingUpdates.map(([fi, corner, nv]) => [g, fi, corner, nv]) };
  }
}

// Decode a whole mesh from its raw file buffer. Returns { decl, G } or { err }.
function decodeMesh(buf) {
  const bl = blocks(buf);
  const d45 = bl.find(b => b.t === 0xFFFFFF45);
  if (!d45) return { err: 'no decl' };
  const decl = parseDecl(d45.data);
  const counts = decl.groups.map(g => g.maxTexCoords);
  const R = counts.reduce((a, b) => a + b, 0);
  const sched = parseSchedule47(bl.find(b => b.t === 0xFFFFFF47).data, R + 4);
  const vals = sched.vals;
  const resLists = []; let p = 0;
  for (const c of counts) { let cum = 0; const l = []; for (let i = 0; i < c; i++) { cum += vals[p++]; l.push(cum); } resLists.push(l); }
  const order = MeshDecoder.firingOrder(resLists);
  const b49s = bl.filter(b => b.t === 0xFFFFFF49).map(b => b.data);
  const dec = new MeshDecoder(decl, resLists);
  const r = dec.decode(b49s, order);
  const facesMatch = r.G && r.G.every((x, g) => x.faces.length === decl.groups[g].maxFaces);
  const vertsMatch = r.G && r.G.every((x, g) => x.verts.length === decl.groups[g].maxPositions);
  const declMatch = !!(r.ok && facesMatch && vertsMatch);
  // "complete": whole record stream parsed and every declared face present, but
  // the declaration counts a few positions the encoder scrubbed (never written,
  // never referenced by faces) — e.g. urchin (234/238). Treat as exact-grade.
  const complete = !!(r.ok && facesMatch && r.G.every((x, g) => x.verts.length <= decl.groups[g].maxPositions));
  return { decl, order, result: r, declMatch, complete, G: r.G };
}

module.exports = { blocks, parseDecl, parseSchedule47, MeshDecoder, decodeMesh };

// ---------- CLI ----------
if (require.main === module) {
  const file = process.argv[2];
  const buf = fs.readFileSync(S + '/assets/models/' + file);
  const bl = blocks(buf);
  const decl = parseDecl(bl.find(b => b.t === 0xFFFFFF45).data);
  const nG = decl.groups.length;
  const schedRaw = parseSchedule47(bl.find(b => b.t === 0xFFFFFF47).data, 500);
  const b49s = bl.filter(b => b.t === 0xFFFFFF49).map(b => b.data);
  console.log(decl.name, 'groups', JSON.stringify(decl.groups), 'finalRes', decl.finalRes);
  console.log('sched vals:', schedRaw.vals.length, schedRaw.vals.join(','));

  // search split of schedRaw.vals into nG runs (+ trailer junk allowed at end)
  const vals = schedRaw.vals;
  const results = [];
  const maxK = vals.length;
  // enumerate total count K (trailer zeros excluded) and split points
  function trySplit(counts) {
    const resLists = [];
    let p = 0;
    for (const c of counts) {
      let cum = 0;
      const list = [];
      for (let i = 0; i < c; i++) { cum += vals[p++]; list.push(cum); }
      resLists.push(list);
    }
    const order = MeshDecoder.firingOrder(resLists);
    const dec = new MeshDecoder(decl, resLists);
    let r;
    try { r = dec.decode(b49s, order, {}); } catch (e) { return { ok: false, err: 'EXC ' + e.message }; }
    if (!r.ok) return r;
    // validate against decl
    let good = true;
    for (let g = 0; g < nG; g++) {
      if (r.G[g].verts.length !== decl.groups[g].maxPositions) good = false;
      if (r.G[g].faces.length !== decl.groups[g].maxFaces) good = false;
    }
    r.declMatch = good;
    return r;
  }
  // recursive enumeration of counts
  const found = [];
  function rec(counts, used, g) {
    if (found.length >= 3) return;
    if (g === nG - 1) {
      for (let last = 1; last <= maxK - used; last++) {
        const counts2 = counts.concat([last]);
        const r = trySplit(counts2);
        if (r.ok && r.declMatch) {
          found.push({ counts: counts2, declMatch: r.declMatch, verts: r.G.map(x => x.verts.length), faces: r.G.map(x => x.faces.length) });
          if (r.declMatch) { console.log('FOUND declMatch', JSON.stringify(found[found.length - 1])); }
        }
      }
      return;
    }
    for (let c = 1; c <= maxK - used - (nG - 1 - g); c++) {
      rec(counts.concat([c]), used + c, g + 1);
      if (found.length >= 3) return;
    }
  }
  rec([], 0, 0);
  console.log('candidates:', JSON.stringify(found.slice(0, 5)));
}
