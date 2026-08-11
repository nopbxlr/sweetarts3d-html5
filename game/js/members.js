// Cast member emulation: bitmaps (with Director image ops), sounds, 3D members.
import * as THREE from 'three';
import { Node, Shader, rgb, V3 } from './dirshim.js';

// ---------------- images ----------------
export class DirImage {
  constructor(canvas) { this.cv = canvas; this.ctx = canvas.getContext('2d', { willReadFrequently: true }); }
  static create(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return new DirImage(c);
  }
  static fromImage(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return new DirImage(c);
  }
  get width() { return this.cv.width; }
  get height() { return this.cv.height; }
  get rect() { return { left: 0, top: 0, right: this.cv.width, bottom: this.cv.height, width: this.cv.width, height: this.cv.height }; }
  duplicate() {
    const c = DirImage.create(this.cv.width, this.cv.height);
    c.ctx.drawImage(this.cv, 0, 0);
    return c;
  }
  getPixel(x, y) {
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    return rgb(d[0], d[1], d[2]);
  }
  fill(rect, color) {
    this.ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
    this.ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  }
  copyPixels(src, dstRect, srcRect, opts) {
    const dw = dstRect.right - dstRect.left, dh = dstRect.bottom - dstRect.top;
    const sw = srcRect.right - srcRect.left, sh = srcRect.bottom - srcRect.top;
    if (opts && opts.ink === '#lightest') {
      this.ctx.save();
      this.ctx.globalCompositeOperation = 'lighten';
      this.ctx.drawImage(src.cv, srcRect.left, srcRect.top, sw, sh, dstRect.left, dstRect.top, dw, dh);
      this.ctx.restore();
    } else {
      this.ctx.drawImage(src.cv, srcRect.left, srcRect.top, sw, sh, dstRect.left, dstRect.top, dw, dh);
    }
  }
  canvas() { return this.cv; }
}
export const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t });

// ---------------- placeholder 3D models (until W3D decode lands) ----------------
const MODEL_NAMES = ['track1', 'track2', 'track3', 'track4', 'track5', 'track6', 'snake', 'beachball', 'atv', 'skate',
  'candy1', 'candy2', 'candy3', 'candy4', 'candy5', 'candy6', 'hat', 'door', 'cacti', 'rocky', 'cactiobstacle',
  'urchin', 'tacks', 'Letter_S', 'Letter_W', 'Letter_E', 'Letter_T', 'Letter_A', 'Letter_R', 'Letter_D', 'Letter_Y',
  'coconut', 'greenChewy', 'fishie', 'fountain', 'sweettarts4', 'candy'];
function placeholderModel(name) {
  // crude stand-ins: flat ring track / small boxes
  const positions = [], faces = [];
  if (name.startsWith('track')) {
    // flat ring + center pad in member coords (world = ×12, -50y): surface lands at y≈-75 like the real tracks
    const R1 = 18, R2 = 38, N = 24, Y = -2.1;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      positions.push(Math.cos(a) * R1, Y, Math.sin(a) * R1);
      positions.push(Math.cos(a) * R2, Y, Math.sin(a) * R2);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = i * 2 + 1, c2 = ((i + 1) % N) * 2, d = ((i + 1) % N) * 2 + 1;
      faces.push([a, c2, b], [b, c2, d]);
    }
    // center pad (spawn + exit area) with a bridge to the ring
    const ci = positions.length / 3;
    positions.push(0, Y - 1.5, 0);
    const M = 12, ri = positions.length / 3;
    for (let i = 0; i < M; i++) {
      const a = i / M * Math.PI * 2;
      positions.push(Math.cos(a) * 8, Y - 1.5, Math.sin(a) * 8);
    }
    for (let i = 0; i < M; i++) faces.push([ci, ri + ((i + 1) % M), ri + i]);
    const bi = positions.length / 3;
    positions.push(-2, Y - 1.5, 6, 2, Y - 1.5, 6, -2, Y, R1 + 2, 2, Y, R1 + 2);
    faces.push([bi, bi + 3, bi + 1], [bi, bi + 2, bi + 3]);
  } else {
    const s = 1.5;
    const v = [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]];
    for (const p of v) positions.push(...p);
    faces.push([0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7]);
  }
  return {
    placeholder: true,
    meshes: [{ name: name + 'Mesh', positions, faces, faceShading: faces.map(() => 0), shaders: [{ name: 'Material01', materialName: 'Material01' }, { name: 'Material02', materialName: 'Material02' }] }],
    materials: [{ name: 'Material01', diffuse: [0.8, 0.5, 0.8] }, { name: 'Material02', diffuse: [0.5, 0.8, 0.8] }],
    nodes: [{ name: name + 'Mesh', resourceName: name + 'Mesh' }]
  };
}

// ---------------- members registry ----------------
export class Members {
  constructor(assets) {
    this.assets = assets; // {textures: {name: HTMLImageElement}, meta: {name:{w,h,regX,regY}}, models: {name: parsedJSON}, sounds: {...}, trackdata: {...}}
    this.imageCache = new Map();
    this.textOverrides = new Map();
  }
  member(name) {
    const a = this.assets;
    const self = this;
    // use decoded model only when it has exact geometry; else placeholder
    const hasGeom = (d) => (d.meshes || []).some(m =>
      (m.geometry && m.geometry.status === 'exact' && m.geometry.groups && m.geometry.groups.length) ||
      (m.positions && m.positions.length));
    if (a.models[name] && hasGeom(a.models[name])) {
      return new Member3D(name, a.models[name], a);
    }
    if (MODEL_NAMES.includes(name)) return new Member3D(name, placeholderModel(name), a);
    if (a.textures[name]) {
      if (!this.imageCache.has(name)) this.imageCache.set(name, DirImage.fromImage(a.textures[name]));
      const meta = a.meta[name] || {};
      const img = this.imageCache.get(name);
      return {
        name, type: '#bitmap',
        get image() { return img; },
        set image(v) { self.imageCache.set(name, v); },
        rect: { left: 0, top: 0, right: img.width, bottom: img.height, width: img.width, height: img.height },
        regPoint: { 1: meta.regX ?? img.width / 2, 2: meta.regY ?? img.height / 2 },
        crop() {}
      };
    }
    if (a.trackdata[name] !== undefined) {
      return {
        name, type: '#field',
        get text() { return JSON.stringify(self.textOverrides.get(name) ?? a.trackdata[name]); },
        set text(v) { self.textOverrides.set(name, JSON.parse(v)); }
      };
    }
    return { name, type: '#unknown' };
  }
  // lingo value(member(x).text) → our text members return JSON
  value(text) {
    try { return JSON.parse(text); } catch (e) { return undefined; }
  }
}

// ---------------- bones (snake): rigid per-vertex binding, procedural rotations ----------------
function setupBones(node, d) {
  // bind chain: M_i = M_parent × T(len_parent,0,0) × T(disp_i) × R(quat_i)
  const bones = Array.isArray(d.bones) ? d.bones : (d.bones.bones || []);
  if (!bones.length) return;
  const bind = [];
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    const local = new THREE.Matrix4();
    const q = new THREE.Quaternion(b.rotation[1], b.rotation[2], b.rotation[3], b.rotation[0]); // stored w,x,y,z
    local.makeRotationFromQuaternion(q);
    local.setPosition(b.displacement[0], b.displacement[1], b.displacement[2]);
    if (b.parentIndex >= 0) {
      const adv = new THREE.Matrix4().makeTranslation(bones[b.parentIndex].length, 0, 0);
      local.premultiply(adv);
      local.premultiply(bind[b.parentIndex]);
    }
    bind.push(local);
  }
  const bindInv = bind.map(m => m.clone().invert());
  const skinMeshes = [];
  let gi = 0;
  for (const mesh of d.meshes) {
    const g = mesh.geometry;
    if (!g || !g.groups) continue;
    let mi = 0;
    for (const c of node.o.children) {
      if (!c.isMesh) continue;
      const gr = g.groups[mi++];
      if (gr && gr.boneWeights && gr.boneWeights.length === gr.positionCount) {
        skinMeshes.push({ mesh: c, bindPos: c.geometry.attributes.position.array.slice(), boneIds: gr.boneWeights });
      }
    }
  }
  if (!skinMeshes.length) return;
  const animRot = bones.map(() => new THREE.Matrix4());
  const animSet = bones.map(() => false);
  node.setBoneRotation = (lingoIdx, rotV3) => {
    const i = lingoIdx - 1;
    if (i < 0 || i >= bones.length) return;
    animRot[i].makeRotationFromEuler(new THREE.Euler(rotV3.x * Math.PI / 180, rotV3.y * Math.PI / 180, rotV3.z * Math.PI / 180, 'XYZ'));
    animSet[i] = true;
    node._skinDirty = true;
  };
  node.updateSkin = () => {
    if (!node._skinDirty) return;
    node._skinDirty = false;
    // runtime chain with anim rotations appended after each bone's bind rotation
    const run = [];
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      let local;
      if (animSet[i]) {
        // Director: bone transform REPLACES the local rotation (game supplies bind angles itself)
        local = animRot[i].clone();
      } else {
        const q = new THREE.Quaternion(b.rotation[1], b.rotation[2], b.rotation[3], b.rotation[0]);
        local = new THREE.Matrix4().makeRotationFromQuaternion(q);
      }
      local.setPosition(b.displacement[0], b.displacement[1], b.displacement[2]);
      if (b.parentIndex >= 0) {
        const adv = new THREE.Matrix4().makeTranslation(bones[b.parentIndex].length, 0, 0);
        local.premultiply(adv);
        local.premultiply(run[b.parentIndex]);
      }
      run.push(local);
    }
    const mats = run.map((m, i) => m.clone().multiply(bindInv[i]));
    const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (const sm of skinMeshes) {
      const attr = sm.mesh.geometry.attributes.position;
      for (let i = 0; i < sm.boneIds.length; i++) {
        // influences: [[boneId, weight], ...]; single influence with weight 0 means weight 1
        let infl = sm.boneIds[i];
        if (!Array.isArray(infl)) infl = [[infl, 1]];
        v.set(sm.bindPos[i * 3], sm.bindPos[i * 3 + 1], sm.bindPos[i * 3 + 2]);
        let wsum = 0;
        for (const e of infl) wsum += (Array.isArray(e) ? (e[1] || 0) : 0);
        acc.set(0, 0, 0);
        for (let k = 0; k < infl.length; k++) {
          const e = infl[k];
          const bid = Array.isArray(e) ? e[0] : e;
          let w = Array.isArray(e) ? (e[1] || 0) : 1;
          if (wsum === 0) w = (k === 0 ? 1 : 0);
          else w = w / wsum;
          if (w === 0) continue;
          const m = mats[Math.max(0, Math.min(bid, mats.length - 1))];
          tmp.copy(v).applyMatrix4(m);
          acc.addScaledVector(tmp, w);
        }
        attr.setXYZ(i, acc.x, acc.y, acc.z);
      }
      attr.needsUpdate = true;
      sm.mesh.geometry.computeVertexNormals();
    }
  };
}

// ---------------- 3D cast member ----------------
export class Member3D {
  constructor(name, data, assets) {
    this.name = name; this.data = data; this.assets = assets;
    this.type = '#shockwave3d';
  }
  resetWorld() {}
  get model() {
    const d = this.data;
    const modelNode = (d.nodes || []).find(n => n.kind === 'model') || (d.nodes || []).find(n => n.resourceName);
    return { 1: { name: modelNode ? modelNode.name : (d.meshes[0] ? d.meshes[0].name : 'model') } };
  }
  shader(shaderName) {
    // pre-instantiation shader tweaks (Letter_x Material01/02 diffuse): store overrides
    this._shaderOverrides = this._shaderOverrides || {};
    const o = this._shaderOverrides;
    if (!o[shaderName]) o[shaderName] = {};
    return {
      set diffuse(v) { o[shaderName].diffuse = v; },
      get diffuse() { return o[shaderName].diffuse; },
      set textureTransform(v) { },
      get textureTransform() {
        if (!o[shaderName].tt) o[shaderName].tt = {};
        return o[shaderName].tt;
      }
    };
  }
  _makeShader(world, shInfo, matInfo) {
    const sh = new Shader(world, (shInfo && shInfo.name) || (matInfo && matInfo.name) || 'sh');
    const dif = (matInfo && matInfo.diffuse) || [1, 1, 1];
    sh.diffuse = rgb(dif[0] * 255, dif[1] * 255, dif[2] * 255);
    if (matInfo && matInfo.emissive) sh.emissive = rgb(matInfo.emissive[0] * 255, matInfo.emissive[1] * 255, matInfo.emissive[2] * 255);
    if (shInfo && shInfo.textureName) {
      const texImg = this.assets.modelTextures[this.name + '_' + shInfo.textureName] ||
        this.assets.modelTextures[shInfo.textureName];
      if (texImg) {
        const t = new THREE.Texture(texImg);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        sh.texture = { t };
      }
    }
    const ov = this._shaderOverrides && shInfo && (this._shaderOverrides[shInfo.materialName] || this._shaderOverrides[shInfo.name]);
    if (ov && ov.diffuse) sh.diffuse = ov.diffuse;
    return sh;
  }

  instantiate(world, name, srcModelName) {
    const d = this.data;
    const node = new Node(world, name, new THREE.Group());

    // ---- real decoded schema: meshes[].geometry.groups + meshes[].shading ----
    if (!d.placeholder) {
      for (const mesh of d.meshes) {
        const g = mesh.geometry;
        if (!g || !g.groups || !g.groups.length) continue;
        g.groups.forEach((gr, gi) => {
          if (!gr.positions || !gr.positions.length) return;
          const shad = (mesh.shading || [])[gi] || {};
          const shInfo = (d.shaders || []).find(s => s.materialName === shad.materialName || s.name === shad.shaderName) ||
            (d.shaders || [])[Math.min(gi, (d.shaders || []).length - 1)];
          const matInfo = (d.materials || []).find(m => m.name === shad.materialName) ||
            (shInfo && (d.materials || []).find(m => m.name === shInfo.materialName));
          const sh = this._makeShader(world, shInfo, matInfo);
          const geo = new THREE.BufferGeometry();
          const idx = [];
          for (const f of gr.faces) idx.push(f[0], f[1], f[2]);
          geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.positions, 3));
          geo.setIndex(idx);
          if (gr.normals && gr.normals.length === gr.positionCount) {
            const nn = [];
            for (const n of gr.normals) nn.push(n[0], n[1], n[2]);
            geo.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
          } else geo.computeVertexNormals();
          if (gr.uvs && gr.uvs.length === gr.positionCount) {
            const uu = [];
            for (const t of gr.uvs) uu.push(t[0], 1 - t[1]);
            geo.setAttribute('uv', new THREE.Float32BufferAttribute(uu, 2));
          }
          const m3 = new THREE.Mesh(geo, sh.mat);
          m3.__shaders = [sh];
          node.o.add(m3);
          if (shInfo && shInfo.name) world.shaders.set(shInfo.name, sh);
          if (shad.materialName) world.shaders.set(shad.materialName, sh);
        });
      }
      const src = (d.nodes || []).find(n => n.kind === 'model' && n.name === srcModelName) ||
        (d.nodes || []).find(n => n.kind === 'model');
      if (src && src.transform) {
        node.o.matrix.fromArray(src.transform);
        node._sync();
      }
      node.memberName = this.name;
      node.modelData = d;
      if (d.bones) setupBones(node, d);
      return node;
    }

    // ---- placeholder path ----
    const shaderWrappers = [];
    for (const mesh of d.meshes) {
      if (!mesh.positions || !mesh.positions.length) continue;
      // group faces by shading id
      const groups = new Map();
      (mesh.faceShading || mesh.faces.map(() => 0)).forEach((sid, fi) => {
        if (!groups.has(sid)) groups.set(sid, []);
        groups.get(sid).push(fi);
      });
      const sortedIds = [...groups.keys()].sort((x, y) => x - y);
      for (const sid of sortedIds) {
        const faceIdxs = groups.get(sid);
        const geo = new THREE.BufferGeometry();
        const pos = [], norm = [], uv = [];
        for (const fi of faceIdxs) {
          const f = mesh.faces[fi];
          for (let k = 0; k < 3; k++) {
            const vi = f[k];
            pos.push(mesh.positions[vi * 3], mesh.positions[vi * 3 + 1], mesh.positions[vi * 3 + 2]);
            if (mesh.faceNormals && mesh.faceNormals[fi]) {
              const ni = mesh.faceNormals[fi][k];
              norm.push(mesh.normals[ni * 3], mesh.normals[ni * 3 + 1], mesh.normals[ni * 3 + 2]);
            }
            if (mesh.faceUVs && mesh.faceUVs[fi] && mesh.uvs) {
              const ti = mesh.faceUVs[fi][k];
              uv.push(mesh.uvs[ti * 2], 1 - mesh.uvs[ti * 2 + 1]);
            }
          }
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        if (norm.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
        else geo.computeVertexNormals();
        if (uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        // shading id → shader: per-mesh list if present, else document-level shader list
        let shInfo = (mesh.shaders && mesh.shaders[sid]) || {};
        if (!shInfo.name && d.shaders && d.shaders.length) {
          shInfo = d.shaders[Math.min(sid, d.shaders.length - 1)] || {};
        }
        const matInfo = (d.materials || []).find(m => m.name === shInfo.materialName) || {};
        const sh = new Shader(world, shInfo.name || ('sh' + sid));
        const dif = matInfo.diffuse || [1, 1, 1];
        sh.diffuse = rgb(dif[0] * 255, dif[1] * 255, dif[2] * 255);
        if (matInfo.emissive) sh.emissive = rgb(matInfo.emissive[0] * 255, matInfo.emissive[1] * 255, matInfo.emissive[2] * 255);
        if (shInfo.textureName) {
          const texImg = this.assets.modelTextures[this.name + '_' + shInfo.textureName] ||
            this.assets.modelTextures[this.name + '/' + shInfo.textureName] ||
            this.assets.modelTextures[shInfo.textureName];
          if (texImg) {
            const t = new THREE.Texture(texImg);
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.colorSpace = THREE.SRGBColorSpace;
            t.needsUpdate = true;
            sh.texture = { t };
          }
        }
        // apply member-level shader overrides (by material/shader name)
        const ov = this._shaderOverrides && (this._shaderOverrides[shInfo.materialName] || this._shaderOverrides[shInfo.name]);
        if (ov && ov.diffuse) sh.diffuse = ov.diffuse;
        const m3 = new THREE.Mesh(geo, sh.mat);
        m3.__shaders = [sh];
        node.o.add(m3);
        shaderWrappers.push(sh);
        // make shaders addressable via w.shader(name) like Director (last instance wins)
        if (shInfo.name) world.shaders.set(shInfo.name, sh);
        if (shInfo.materialName) world.shaders.set(shInfo.materialName, sh);
      }
    }
    // apply source node transform if present
    const src = (d.nodes || []).find(n => n.name === srcModelName) || (d.nodes || []).find(n => n.resourceName);
    if (src && src.transform) {
      node.o.matrix.fromArray(src.transform);
      node._sync();
    }
    node.memberName = this.name;
    return node;
  }
}

// ---------------- sound ----------------
export class SoundSystem {
  constructor(assets) {
    this.assets = assets;
    this.ctx = null;
    this.channels = {};
  }
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  channel(n) {
    if (!this.channels[n]) this.channels[n] = { src: null };
    const ch = this.channels[n];
    const self = this;
    return {
      stop() { if (ch.src) { try { ch.src.stop(); } catch (e) {} ch.src = null; } },
      play(opts) {
        self.ensure();
        const buf = self.assets.sounds[opts.member.name || opts.member];
        if (!buf) return;
        if (ch.src) { try { ch.src.stop(); } catch (e) {} }
        const s = self.ctx.createBufferSource();
        s.buffer = buf;
        if (opts.rateShift) s.playbackRate.value = Math.pow(2, opts.rateShift / 12);
        if (opts.loop) s.loop = true;
        s.connect(self.ctx.destination);
        s.start();
        ch.src = s;
      }
    };
  }
}
