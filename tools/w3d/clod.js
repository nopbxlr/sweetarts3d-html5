// Progressive CLOD mesh decoder for W3D (IFX v2), ported from
// u3d/RTL/Component/Importing/CIFXAuthorCLODDecoder_P.cpp with W3D-specific
// deviations determined empirically (see NOTES.md).
'use strict';

const { BitStreamRead, ACStaticFull } = require('./bitstream');

// ---- CIFXSetX: set of U32 kept sorted in DESCENDING order ----
class SetX {
  constructor() { this.a = []; }
  _find(v) {
    let lo = 0, hi = this.a.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const m = this.a[mid];
      if (m === v) return mid;
      if (m > v) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
  add(v) {
    if (this._find(v) >= 0) return;
    let lo = 0, hi = this.a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.a[mid] > v) lo = mid + 1; else hi = mid;
    }
    this.a.splice(lo, 0, v);
  }
  remove(v) {
    const i = this._find(v);
    if (i >= 0) this.a.splice(i, 1);
  }
  get size() { return this.a.length; }
  member(i) { return this.a[i]; }
  has(v) { return this._find(v) >= 0; }
  [Symbol.iterator]() { return this.a[Symbol.iterator](); }
}

// ---- contexts (IDs are internal; only identity matters, not exact values) ----
const CTX = {
  T: 200,
  NumNewFaces: 1,
  Orientation: 2,
  ThirdIndexType: 3,
  Local3rdPosition: 4,
  StayMove: 15,
  PosSigns: 20,
  PosMagX: 21,
  PosMagY: 22,
  PosMagZ: 23,
  ShadingID: 65,
  NumLocalNormals: 40,
  NormalSigns: 41,
  NormalMagX: 42,
  NormalMagY: 43,
  NormalMagZ: 44,
  NormalLocalIndex: 45,
  NumNewTexCoords: 123,
  TexCoordSigns: 103,
  TexMagU: 33,
  TexMagV: 34,
  TexMagS: 35,
  TexMagT: 36,
  TexKeepChange: 114,
  TexChangeType: 115,
  TexChangeIndexNew: 116,
  TexChangeIndexLocal: 117,
  TexChangeIndexGlobal: 118,
  TexDupType: 39,
  TexSplitType: 29,
  TexSplitIndexLocal: 121,
  TexSplitIndexGlobal: 122,
};

const AMP = {
  OrientationLeft: 1, OrientationRight: 2,
  ThirdIndexLocal: 1, ThirdIndexGlobal: 2,
  PredictStay2: 4, PredictMove2: 3, PredictStay: 2, PredictMove: 1, PredictNoGuess: 0,
  Stay: 0, Move: 1,
  UpdateChange: 1, UpdateKeep: 2,
  UpdateNew: 1, UpdateLocal: 2, UpdateGlobal: 3,
  SplitTexCoordDup: 1, UpdateTexCoordDup: 2, ThirdTexCoordDup: 4,
};

function quatMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] + a[2] * b[0] + a[3] * b[1] - a[1] * b[3],
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
  ];
}
function quatInterpolate(t, q1, q2) {
  let cosom = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  let to1;
  if (cosom < 0) { cosom = -cosom; to1 = [-q2[1], -q2[2], -q2[3], -q2[0]]; }
  else { to1 = [q2[1], q2[2], q2[3], q2[0]]; }
  let scale0, scale1;
  if ((1.0 - cosom) > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1.0 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  } else {
    scale0 = 1.0 - t; scale1 = t;
  }
  return [
    scale0 * q1[0] + scale1 * to1[3],
    scale0 * q1[1] + scale1 * to1[0],
    scale0 * q1[2] + scale1 * to1[1],
    scale0 * q1[3] + scale1 * to1[2],
  ];
}

const LEN_EPSILON = 1e-7;

class CLODDecoder {
  // decl: { shadingDescs: [{numTexLayers}], iqPos, iqNormal, iqTex, finalRes, excludeNormals }
  constructor(decl, opts) {
    this.decl = decl;
    this.opts = Object.assign({
      texCoordDims: 4,
      updateTag: true,
      texCounts: true,
      posEarly: true,       // position diff read before faces (unlike U3D)
      normals: true,
      splitMode: 'static',  // 'static': ctx 0x400+i (skip at i=0)
      sharedPosMagCtx: false,
      sharedNormalMagCtx: false,
      sharedTexMagCtx: false,
      trace: 0,
    }, opts);
    this.positions = [];
    this.normals = [];
    this.texCoords = [];
    this.faces = [];
    this.numFacesCur = 0;
    this.numPositionsCur = 0;
    this.numNormalsCur = 0;
    this.numTexCoordsCur = 0;
    this.adj = [];
    this.prevSplitTexCoord = 0;
    this.prevUpdateTexCoord = 0;
    this.prevThirdTexCoord = 0;
  }

  adjOf(p) {
    let s = this.adj[p];
    if (!s) { s = new SetX(); this.adj[p] = s; }
    return s;
  }

  faceSetOf(p) { return this.adjOf(p); }

  positionSetOf(faceSet) {
    const out = new SetX();
    for (const fi of faceSet) {
      const f = this.faces[fi];
      out.add(f.a); out.add(f.b); out.add(f.c);
    }
    return out;
  }

  texCoordSetOf(layer, p) {
    const out = new SetX();
    for (const fi of this.adjOf(p)) {
      const f = this.faces[fi];
      const sd = this.decl.shadingDescs[f.shading];
      if (!sd || sd.numTexLayers <= layer) continue;
      if (p === f.a) out.add(f.ta);
      else if (p === f.b) out.add(f.tb);
      else if (p === f.c) out.add(f.tc);
    }
    return out;
  }

  faceNormal(fi) {
    const f = this.faces[fi];
    const A = this.positions[f.a], B = this.positions[f.b], C = this.positions[f.c];
    const d1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const d2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const approx0 = v => Math.abs(v[0]) < LEN_EPSILON && Math.abs(v[1]) < LEN_EPSILON && Math.abs(v[2]) < LEN_EPSILON;
    if (approx0(d1) || approx0(d2)) return [-20, 0, 0];
    const n1 = Math.hypot(d1[0], d1[1], d1[2]), n2 = Math.hypot(d2[0], d2[1], d2[2]);
    d1[0] /= n1; d1[1] /= n1; d1[2] /= n1;
    d2[0] /= n2; d2[1] /= n2; d2[2] /= n2;
    const cx = d1[1] * d2[2] - d1[2] * d2[1];
    const cy = d1[2] * d2[0] - d1[0] * d2[2];
    const cz = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cx) < LEN_EPSILON && Math.abs(cy) < LEN_EPSILON && Math.abs(cz) < LEN_EPSILON) return [-20, 0, 0];
    const n = Math.hypot(cx, cy, cz);
    return [cx / n, cy / n, cz / n];
  }

  decodeBlock(bs, numUpdates, startRes) {
    const o = this.opts;
    const decl = this.decl;
    const trace = o.trace;
    const availBits = bs.data.length * 32 - 96;

    for (let i = startRes; i < startRes + numUpdates; i++) {
      if (bs.getBitCount() > availBits) throw new Error(`update ${i}: bit overrun ${bs.getBitCount()}/${availBits}`);

      // --- split position index ---
      let splitPos = 0;
      if (i > 0) {
        if (o.splitMode === 'static') splitPos = bs.readCompressedU32(ACStaticFull + i);
        else if (o.splitMode === 'static1') splitPos = bs.readCompressedU32(ACStaticFull + i + 1);
        else splitPos = bs.readCompressedU32(CTX.T + 50);
        if (splitPos >= i) throw new Error(`update ${i}: splitPos ${splitPos} out of range`);
      } else if (o.splitMode === 'static1') {
        splitPos = bs.readCompressedU32(ACStaticFull + 1); // forced 0, consumes 0 bits
      }

      const splitFaceSet = this.faceSetOf(splitPos);
      const positionSet = this.positionSetOf(splitFaceSet);
      positionSet.remove(splitPos);

      // --- tag byte ---
      let tag = 0;
      if (o.updateTag) tag = bs.readCompressedU8(CTX.T);

      // --- position diff (optionally early) ---
      let posInfo = null;
      const readPos = () => {
        const signs = bs.readCompressedU8(CTX.PosSigns);
        const magCtxs = o.sharedPosMagCtx
          ? [CTX.PosMagX, CTX.PosMagX, CTX.PosMagX]
          : [CTX.PosMagX, CTX.PosMagY, CTX.PosMagZ];
        const dx = bs.readCompressedU32(magCtxs[0]);
        const dy = bs.readCompressedU32(magCtxs[1]);
        const dz = bs.readCompressedU32(magCtxs[2]);
        const pred = (i > 0) ? this.positions[splitPos] : [0, 0, 0];
        const p = [
          pred[0] + ((signs & 1) ? -decl.iqPos * dx : decl.iqPos * dx),
          pred[1] + ((signs & 2) ? -decl.iqPos * dy : decl.iqPos * dy),
          pred[2] + ((signs & 4) ? -decl.iqPos * dz : decl.iqPos * dz),
        ];
        this.positions[i] = p;
        posInfo = { signs, dx, dy, dz, p };
      };
      if (o.posEarly) readPos();

      // --- new texcoords ---
      let numNewTex = 0;
      const newTexStart = this.numTexCoordsCur;
      if (o.texCounts) {
        numNewTex = o.texCountU8 ? bs.readCompressedU8(CTX.NumNewTexCoords) : bs.readCompressedU16(CTX.NumNewTexCoords);
        if (numNewTex > 1000) throw new Error(`update ${i}: numNewTex ${numNewTex}`);
        if (numNewTex > 0) {
          const pred = [0, 0, 0, 0];
          const set = this.texCoordSetOf(0, splitPos);
          if (set.size > 0) {
            for (const ti of set) {
              const t = this.texCoords[ti];
              for (let k = 0; k < 4; k++) pred[k] += (t[k] || 0);
            }
            for (let k = 0; k < 4; k++) pred[k] /= set.size;
          }
          for (let j = 0; j < numNewTex; j++) {
            const signs = bs.readCompressedU8(CTX.TexCoordSigns);
            const magCtxs = o.sharedTexMagCtx
              ? [CTX.TexMagU, CTX.TexMagU, CTX.TexMagU, CTX.TexMagU]
              : [CTX.TexMagU, CTX.TexMagV, CTX.TexMagS, CTX.TexMagT];
            const mags = [];
            for (let k = 0; k < o.texCoordDims; k++) mags.push(bs.readCompressedU32(magCtxs[k]));
            const t = [0, 0, 0, 0];
            for (let k = 0; k < o.texCoordDims; k++) {
              const d = (signs & (1 << k)) ? -decl.iqTex * mags[k] : decl.iqTex * mags[k];
              t[k] = pred[k] + d;
            }
            this.texCoords[this.numTexCoordsCur + j] = t;
          }
        }
      }

      // --- new faces ---
      const numNewFaces = bs.readCompressedU32(CTX.NumNewFaces);
      if (numNewFaces > 4096) throw new Error(`update ${i}: numNewFaces ${numNewFaces}`);
      const leftThird = new SetX(), rightThird = new SetX();
      const numFaces0 = this.numFacesCur;
      for (let j = 0; j < numNewFaces; j++) {
        const shading = bs.readCompressedU32(CTX.ShadingID);
        if (shading >= decl.shadingDescs.length) throw new Error(`update ${i}: shading ${shading}`);
        const orient = bs.readCompressedU8(CTX.Orientation);
        const thirdType = bs.readCompressedU8(CTX.ThirdIndexType);
        let third;
        if (thirdType === AMP.ThirdIndexLocal) {
          const li = bs.readCompressedU32(CTX.Local3rdPosition);
          if (li >= positionSet.size) throw new Error(`update ${i}: local third ${li}/${positionSet.size}`);
          third = positionSet.member(li);
        } else if (thirdType === AMP.ThirdIndexGlobal) {
          third = bs.readCompressedU32(ACStaticFull + i);
          if (third >= i && i > 0) throw new Error(`update ${i}: global third ${third}`);
          positionSet.add(third);
        } else {
          throw new Error(`update ${i}: thirdType ${thirdType}`);
        }
        if (orient === AMP.OrientationLeft) leftThird.add(third);
        else if (orient === AMP.OrientationRight) rightThird.add(third);
        else throw new Error(`update ${i}: orientation ${orient}`);
        const face = { shading, na: 0, nb: 0, nc: 0, ta: 0, tb: 0, tc: 0 };
        if (orient === AMP.OrientationLeft) { face.a = splitPos; face.b = i; face.c = third; }
        else { face.b = splitPos; face.a = i; face.c = third; }
        this.faces[numFaces0 + j] = face;
      }

      // --- stay/move ---
      const moveFaces = new SetX();
      {
        const movePos = new SetX(), stayPos = new SetX();
        for (let j = 0; j < splitFaceSet.size; j++) {
          const fi = splitFaceSet.member(j);
          const f = this.faces[fi];
          let pred = AMP.PredictNoGuess;
          const check = (v1, v2) => {
            if (rightThird.has(v1)) return AMP.PredictMove;
            if (rightThird.has(v2)) return AMP.PredictStay;
            if (leftThird.has(v1)) return AMP.PredictStay;
            if (leftThird.has(v2)) return AMP.PredictMove;
            return AMP.PredictNoGuess;
          };
          if (splitPos === f.a) pred = check(f.b, f.c);
          else if (splitPos === f.b) pred = check(f.c, f.a);
          else if (splitPos === f.c) pred = check(f.a, f.b);
          else throw new Error(`update ${i}: split face inconsistent`);
          if (pred === AMP.PredictNoGuess) {
            if (movePos.has(f.a) || movePos.has(f.b) || movePos.has(f.c)) pred = AMP.PredictMove2;
            else if (stayPos.has(f.a) || stayPos.has(f.b) || stayPos.has(f.c)) pred = AMP.PredictStay2;
          }
          const stayMove = bs.readCompressedU8(CTX.StayMove + pred);
          if (stayMove === AMP.Move) {
            moveFaces.add(fi);
            movePos.add(f.a); movePos.add(f.b); movePos.add(f.c);
            movePos.remove(splitPos);
          } else {
            stayPos.add(f.a); stayPos.add(f.b); stayPos.add(f.c);
            stayPos.remove(splitPos);
          }
        }
      }

      // --- move face attribute updates ---
      const cornerMoves = [];
      for (let j = 0; j < moveFaces.size; j++) {
        const fi = moveFaces.member(j);
        const f = this.faces[fi];
        let corner;
        if (f.a === splitPos) corner = 0;
        else if (f.b === splitPos) corner = 1;
        else if (f.c === splitPos) corner = 2;
        else throw new Error(`update ${i}: move face inconsistent`);
        cornerMoves.push({ fi, corner });

        const sd = decl.shadingDescs[f.shading];
        const numLayers = (o.texCounts && sd) ? sd.numTexLayers : 0;
        for (let layer = 0; layer < numLayers; layer++) {
          const keepChange = bs.readCompressedU8(CTX.TexKeepChange);
          if (keepChange === AMP.UpdateChange) {
            const type = bs.readCompressedU8(CTX.TexChangeType);
            let idx;
            if (type === AMP.UpdateNew) {
              idx = bs.readCompressedU32(CTX.TexChangeIndexNew) + newTexStart;
            } else if (type === AMP.UpdateLocal) {
              const li = bs.readCompressedU32(CTX.TexChangeIndexLocal);
              const set = this.texCoordSetOf(layer, splitPos);
              if (li >= set.size) throw new Error(`update ${i}: tex local change ${li}/${set.size}`);
              idx = set.member(li);
            } else {
              idx = bs.readCompressedU32(CTX.TexChangeIndexGlobal);
            }
            if (corner === 0) f.ta = idx; else if (corner === 1) f.tb = idx; else f.tc = idx;
          }
        }
      }

      // --- new face texcoord corners ---
      for (let j = 0; j < numNewFaces && o.texCounts; j++) {
        const fi = numFaces0 + j;
        const f = this.faces[fi];
        let splitCorner, newCorner, thirdCorner;
        if (f.a === i) { newCorner = 0; splitCorner = (f.b === splitPos) ? 1 : 2; thirdCorner = (f.b === splitPos) ? 2 : 1; }
        else if (f.b === i) { newCorner = 1; splitCorner = (f.a === splitPos) ? 0 : 2; thirdCorner = (f.a === splitPos) ? 2 : 0; }
        else { newCorner = 2; splitCorner = (f.a === splitPos) ? 0 : 1; thirdCorner = (f.a === splitPos) ? 1 : 0; }
        const thirdPos = [f.a, f.b, f.c][thirdCorner];

        const sd = decl.shadingDescs[f.shading];
        const numLayers = sd ? sd.numTexLayers : 0;
        for (let layer = 0; layer < numLayers; layer++) {
          const dup = bs.readCompressedU8(CTX.TexDupType);
          const readIdx = (set) => {
            const type = bs.readCompressedU8(CTX.TexSplitType);
            if (type === AMP.UpdateLocal) {
              const li = bs.readCompressedU32(CTX.TexSplitIndexLocal);
              if (li >= set.size) throw new Error(`update ${i}: tex split local ${li}/${set.size}`);
              return set.member(li);
            }
            return bs.readCompressedU32(CTX.TexSplitIndexGlobal);
          };
          const splitSet = this.texCoordSetOf(layer, splitPos);
          const splitTex = (dup & AMP.SplitTexCoordDup) ? this.prevSplitTexCoord : readIdx(splitSet);
          const updateTex = (dup & AMP.UpdateTexCoordDup) ? this.prevUpdateTexCoord : readIdx(splitSet);
          const thirdSet = this.texCoordSetOf(layer, thirdPos);
          const thirdTex = (dup & AMP.ThirdTexCoordDup) ? this.prevThirdTexCoord : readIdx(thirdSet);
          const corners = [0, 0, 0];
          corners[splitCorner] = splitTex;
          corners[newCorner] = updateTex;
          corners[thirdCorner] = thirdTex;
          f.ta = corners[0]; f.tb = corners[1]; f.tc = corners[2];
          this.prevSplitTexCoord = splitTex;
          this.prevUpdateTexCoord = updateTex;
          this.prevThirdTexCoord = thirdTex;
        }
      }

      // --- adjacency updates ---
      for (let j = 0; j < moveFaces.size; j++) {
        const fi = moveFaces.member(j);
        this.adjOf(splitPos).remove(fi);
        this.adjOf(i).add(fi);
      }
      for (let j = 0; j < numNewFaces; j++) {
        const fi = numFaces0 + j;
        const f = this.faces[fi];
        this.adjOf(f.a).add(fi);
        this.adjOf(f.b).add(fi);
        this.adjOf(f.c).add(fi);
      }

      // --- position set around new vertex (before corner moves applied) ---
      const newFaceSet = this.faceSetOf(i);
      const newPositionSet = this.positionSetOf(newFaceSet);

      // --- position diff (U3D position) ---
      if (!o.posEarly) readPos();

      if (trace && i - startRes < trace) {
        console.log(`upd ${i}: split=${splitPos} tag=${tag} newTex=${numNewTex} newFaces=${numNewFaces} moves=${moveFaces.size} signs=${posInfo.signs} d=(${posInfo.dx},${posInfo.dy},${posInfo.dz}) p=(${posInfo.p.map(v => v.toFixed(3))}) @${bs.getBitCount()}`);
      }

      // --- apply face corner moves + counts ---
      const numOldNormals = this.numNormalsCur;
      for (const { fi, corner } of cornerMoves) {
        const f = this.faces[fi];
        if (corner === 0) f.a = i; else if (corner === 1) f.b = i; else f.c = i;
      }
      this.numFacesCur += numNewFaces;
      this.numPositionsCur = i + 1;
      this.numTexCoordsCur += numNewTex;

      // --- normals ---
      if (o.normals && !decl.excludeNormals) {
        let numNewNormals = 0;
        const newNormals = [];
        for (let jj = 0; jj < newPositionSet.size; jj++) {
          const pIdx = newPositionSet.member(jj);
          const normalFaceSet = this.faceSetOf(pIdx);
          const numLocalNormals = bs.readCompressedU32(CTX.NumLocalNormals);
          if (numLocalNormals > normalFaceSet.size + 64) throw new Error(`update ${i}: numLocalNormals ${numLocalNormals} vs faces ${normalFaceSet.size}`);

          const faceLocalNormals = [];
          for (let k = 0; k < normalFaceSet.size; k++) {
            const fn = this.faceNormal(normalFaceSet.member(k));
            if (fn[0] > -2.0) faceLocalNormals.push(fn);
          }
          const predicted = [];
          const contribution = [];
          if (faceLocalNormals.length > 0) predicted.push(faceLocalNormals[0].slice());
          while (predicted.length < numLocalNormals) {
            if (faceLocalNormals.length === 0) { predicted.push([0, 0, 0]); continue; }
            let farthestDist = 1.0, farthestIdx = 0;
            for (let k = 0; k < faceLocalNormals.length; k++) {
              let minDist = -2.0;
              const t = faceLocalNormals[k];
              for (let l = 0; l < predicted.length; l++) {
                const d = t[0] * predicted[l][0] + t[1] * predicted[l][1] + t[2] * predicted[l][2];
                if (d > minDist) minDist = d;
              }
              if (minDist < farthestDist) { farthestDist = minDist; farthestIdx = k; }
            }
            predicted.push(faceLocalNormals[farthestIdx].slice());
          }
          for (let k = 0; k < predicted.length; k++) contribution.push(0);
          for (let k = 0; k < faceLocalNormals.length; k++) {
            let minDist = -2.0, closest = 0;
            const fn = faceLocalNormals[k];
            for (let l = 0; l < predicted.length; l++) {
              const d = fn[0] * predicted[l][0] + fn[1] * predicted[l][1] + fn[2] * predicted[l][2];
              if (d > minDist) { minDist = d; closest = l; }
            }
            const qf = [0, fn[0], fn[1], fn[2]];
            const qp = [0, predicted[closest][0], predicted[closest][1], predicted[closest][2]];
            const w = 1.0 / (contribution[closest] + 1);
            const qu = quatInterpolate(w, qp, qf);
            predicted[closest] = [qu[1], qu[2], qu[3]];
            contribution[closest]++;
          }

          const localNormals = [];
          for (let k = 0; k < numLocalNormals; k++) {
            const pk = predicted[k] || [0, 0, 0];
            const qp = [0, pk[0], pk[1], pk[2]];
            const signs = bs.readCompressedU8(CTX.NormalSigns);
            const magCtxs = o.sharedNormalMagCtx
              ? [CTX.NormalMagX, CTX.NormalMagX, CTX.NormalMagX]
              : [CTX.NormalMagX, CTX.NormalMagY, CTX.NormalMagZ];
            const mx = bs.readCompressedU32(magCtxs[0]);
            const my = bs.readCompressedU32(magCtxs[1]);
            const mz = bs.readCompressedU32(magCtxs[2]);
            const fdX = (signs & 2) ? -decl.iqNormal * mx : decl.iqNormal * mx;
            const fdY = (signs & 4) ? -decl.iqNormal * my : decl.iqNormal * my;
            const fdZ = (signs & 8) ? -decl.iqNormal * mz : decl.iqNormal * mz;
            let t = fdX * fdX + fdY * fdY + fdZ * fdZ;
            if (t > 1) t = 1;
            const fdW = (signs & 1) ? -Math.sqrt(1 - t) : Math.sqrt(1 - t);
            const q = quatMul(qp, [fdW, fdX, fdY, fdZ]);
            localNormals.push([q[1], q[2], q[3]]);
          }

          for (let k = 0; k < normalFaceSet.size; k++) {
            const fi = normalFaceSet.member(k);
            const li = bs.readCompressedU32(CTX.NormalLocalIndex);
            const nIdx = numOldNormals + numNewNormals + li;
            const f = this.faces[fi];
            if (f.a === pIdx) f.na = nIdx;
            else if (f.b === pIdx) f.nb = nIdx;
            else if (f.c === pIdx) f.nc = nIdx;
            else throw new Error(`update ${i}: normal face corner not found`);
          }

          for (let k = 0; k < numLocalNormals; k++) newNormals.push(localNormals[k]);
          numNewNormals += numLocalNormals;
        }
        for (let k = 0; k < numNewNormals; k++) this.normals[numOldNormals + k] = newNormals[k];
        this.numNormalsCur += numNewNormals;
      }
    }
  }
}

module.exports = { CLODDecoder, SetX, CTX };
