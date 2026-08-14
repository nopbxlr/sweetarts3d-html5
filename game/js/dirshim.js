// Director Shockwave 3D compatibility layer on top of Three.js.
// Mirrors the Lingo APIs used by SweeTarts 3D so the game logic ports ~line-for-line.
import * as THREE from 'three';

export const DEG = Math.PI / 180;

// ---------------- Lingo vector ----------------
export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  duplicate() { return new V3(this.x, this.y, this.z); }
  add(v) { return new V3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new V3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(s) { return new V3(this.x * s, this.y * s, this.z * s); }
  get length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  angleBetween(v) {
    const d = (this.x * v.x + this.y * v.y + this.z * v.z) / (this.length * v.length || 1);
    return Math.acos(Math.min(1, Math.max(-1, d))) / DEG;
  }
  toThree() { return new THREE.Vector3(this.x, this.y, this.z); }
  static from(t) { return new V3(t.x, t.y, t.z); }
  // lingo-style component access [1]/[2]/[3]
  getAt(i) { return i === 1 ? this.x : i === 2 ? this.y : this.z; }
  setAt(i, v) { if (i === 1) this.x = v; else if (i === 2) this.y = v; else this.z = v; }
}
export const vector = (x, y, z) => new V3(x, y, z);
export const randomVector = () => { // Director: random unit vector
  let v;
  do { v = new V3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (v.length > 1 || v.length === 0);
  return v.mul(1 / v.length);
};
export const random = (n) => 1 + Math.floor(Math.random() * n); // lingo random(n): 1..n

// ---------------- rgb ----------------
export class RGB {
  constructor(r, g, b) { this.r = r; this.g = g; this.b = b; }
  add(o) { return new RGB(Math.min(255, this.r + o.r), Math.min(255, this.g + o.g), Math.min(255, this.b + o.b)); }
  mul(s) { return new RGB(this.r * s, this.g * s, this.b * s); }
  toThree() { return new THREE.Color(this.r / 255, this.g / 255, this.b / 255); }
}
export const rgb = (r, g, b) => new RGB(r, g, b);

// ---------------- transform ----------------
// Wraps a THREE.Matrix4 with Director transform semantics.
export class Transform {
  constructor(m) { this.m = m ? m.clone() : new THREE.Matrix4(); }
  duplicate() { return new Transform(this.m); }
  identity() { this.m.identity(); return this; }
  get position() {
    const t = this; const e = this.m.elements;
    return new Proxy(new V3(e[12], e[13], e[14]), {
      set(o, k, v) { o[k] = v; const e2 = t.m.elements; e2[12] = o.x; e2[13] = o.y; e2[14] = o.z; return true; }
    });
  }
  set position(v) { const e = this.m.elements; e[12] = v.x; e[13] = v.y; e[14] = v.z; }
  _decompose() {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.m.decompose(p, q, s);
    return { p, q, s };
  }
  get rotation() {
    const { q } = this._decompose();
    const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
    return new V3(e.x / DEG, e.y / DEG, e.z / DEG);
  }
  set rotation(v) {
    const { p, s } = this._decompose();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.x * DEG, v.y * DEG, v.z * DEG, 'ZYX'));
    this.m.compose(p, q, s);
  }
  get scale() { const { s } = this._decompose(); return new V3(s.x, s.y, s.z); }
  set scale(v) { const { p, q } = this._decompose(); this.m.compose(p, q, new THREE.Vector3(v.x, v.y, v.z)); }
  rotate(x, y, z) {
    // Lingo transform().rotate(): rotates the whole transform about the origin (premultiply)
    // — the game relies on this to rotate direction vectors (rotateV, ray directions).
    if (x instanceof V3) { z = x.z; y = x.y; x = x.x; }
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'ZYX'));
    this.m.premultiply(r);
  }
  preRotate(x, y, z) {
    if (x instanceof V3) { z = x.z; y = x.y; x = x.x; }
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'ZYX'));
    const t = new THREE.Vector3(this.m.elements[12], this.m.elements[13], this.m.elements[14]);
    this.m.elements[12] = 0; this.m.elements[13] = 0; this.m.elements[14] = 0;
    this.m.premultiply(r);
    this.m.elements[12] = t.x; this.m.elements[13] = t.y; this.m.elements[14] = t.z;
  }
  translate(x, y, z) {
    if (x instanceof V3) { z = x.z; y = x.y; x = x.x; }
    this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z));
  }
  interpolateTo(t2, pct) {
    const a = this._decompose(), b = t2._decompose();
    const f = pct / 100;
    a.p.lerp(b.p, f); a.q.slerp(b.q, f); a.s.lerp(b.s, f);
    this.m.compose(a.p, a.q, a.s);
    return this;
  }
}
export const transform = () => new Transform();

// ---------------- node (models, cameras, lights, groups) ----------------
export function worldMatrixOf(o) {
  const m = o.matrix.clone();
  let p = o.parent;
  while (p) { m.premultiply(p.matrix); p = p.parent; }
  return m;
}
let nodeSeq = 0;
export class Node {
  constructor(world, name, obj3d) {
    this.world = world;
    this.name = name || ('node' + (++nodeSeq));
    this.o = obj3d || new THREE.Group();
    this.o.matrixAutoUpdate = false;
    this.o.__node = this;
    this._visibility = '#front';
    this.userData = { count: 0, getProp: () => undefined };
  }
  get transform() {
    const self = this;
    // Live view over the object's local matrix
    const t = new Transform(this.o.matrix);
    return new Proxy(t, {
      get(target, k) {
        target.m.copy(self.o.matrix);
        const v = target[k];
        if (k === 'position' || k === 'rotation' || k === 'scale') {
          // wrap position proxy writes back
          if (k === 'position') {
            const e = self.o.matrix.elements;
            return new Proxy(new V3(e[12], e[13], e[14]), {
              get(o2, k2) {
                const val = o2[k2];
                return typeof val === 'function' ? val.bind(o2) : val;
              },
              set(o2, k2, v2) { o2[k2] = v2; const e2 = self.o.matrix.elements; e2[12] = o2.x; e2[13] = o2.y; e2[14] = o2.z; self._sync(); return true; }
            });
          }
          return v;
        }
        if (typeof v === 'function') {
          return (...args) => {
            target.m.copy(self.o.matrix);
            const r = v.apply(target, args);
            self.o.matrix.copy(target.m);
            self._sync();
            return r;
          };
        }
        return v;
      },
      set(target, k, v) {
        target.m.copy(self.o.matrix);
        target[k] = v;
        self.o.matrix.copy(target.m);
        self._sync();
        return true;
      }
    });
  }
  set transform(t) { this.o.matrix.copy(t.m); this._sync(); }
  _sync() { this.o.matrixWorldNeedsUpdate = true; }
  getWorldTransform() {
    // three's updateWorldMatrix caches via matrixWorldNeedsUpdate and misses parent moves —
    // walk the chain manually so world transforms are always current.
    return new Transform(worldMatrixOf(this.o));
  }
  translate(x, y, z, mode) {
    if (x instanceof V3) { mode = y; z = x.z; y = x.y; x = x.x; }
    const e = this.o.matrix.elements;
    if (mode === '#world') {
      e[12] += x; e[13] += y; e[14] += z;
    } else {
      // #self: move along own (rotated) axes in unscaled units — Director semantics
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      this.o.matrix.decompose(p, q, s);
      const v = new THREE.Vector3(x, y, z).applyQuaternion(q);
      e[12] += v.x; e[13] += v.y; e[14] += v.z;
    }
    this._sync();
  }
  rotate(x, y, z, mode) {
    if (x instanceof V3) { mode = y; z = x.z; y = x.y; x = x.x; }
    const r = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'ZYX'));
    this.o.matrix.multiply(r); // #self
    this._sync();
  }
  pointAt(target, up) {
    // Director: aims the node's -Z axis at target (its +Y toward up); models' "front" convention in this game is +Z after a 180 flip.
    if (target instanceof Node) target = target.getWorldTransform().position;
    const wt = this.getWorldTransform();
    const pos = wt.position;
    const upv = up ? new THREE.Vector3(up.x, up.y, up.z) : new THREE.Vector3(0, 1, 0);
    const mLook = new THREE.Matrix4().lookAt(pos.toThree(), new THREE.Vector3(target.x, target.y, target.z), upv);
    // preserve world position + scale, set world rotation, then convert back to local
    const { s } = wt._decompose();
    const q = new THREE.Quaternion().setFromRotationMatrix(mLook);
    // three lookAt: +Z points from target to eye => -Z toward target. That matches Director.
    const world = new THREE.Matrix4().compose(pos.toThree(), q, s);
    const parentInv = new THREE.Matrix4();
    if (this.o.parent) parentInv.copy(worldMatrixOf(this.o.parent)).invert();
    this.o.matrix.multiplyMatrices(parentInv, world);
    this._sync();
  }
  scale(x, y, z) {
    if (y === undefined) { y = x; z = x; }
    this.o.matrix.multiply(new THREE.Matrix4().makeScale(x, y, z));
    this._sync();
  }
  addChild(child, mode) {
    if (child.transformNode) child = child.transformNode; // camera wrapper
    // Director default #preserveWorld
    const world = worldMatrixOf(child.o);
    this.o.add(child.o);
    const inv = worldMatrixOf(this.o).invert();
    child.o.matrix.multiplyMatrices(inv, world);
    child._sync();
  }
  get parent() {
    const p = this.o.parent;
    if (!p || p === this.world.scene) return p ? this.world.groupNode : undefined;
    return p.__node;
  }
  set parent(v) {
    if (v === undefined || v === null) {
      // parent = VOID: detach keeping local transform (used before re-addToWorld)
      const world = worldMatrixOf(this.o);
      this.o.removeFromParent();
      this.o.matrix.copy(world);
      this._sync();
    }
  }
  addToWorld() {
    const world = this.o.parent ? worldMatrixOf(this.o) : this.o.matrix.clone();
    this.world.scene.add(this.o);
    this.o.matrix.copy(world);
    this._sync();
  }
  removeFromWorld() { this.o.removeFromParent(); }
  get visibility() { return this._visibility; }
  set visibility(v) {
    // Director: affects only this model's own geometry, not child models
    this._visibility = v;
    const vis = v !== '#none';
    const walk = (o) => {
      for (const c of o.children) {
        if (c.__node && c.__node !== this) continue; // another model parented under us
        if (c.isMesh || c.isPoints) c.visible = vis && !c.__hiddenMesh;
        walk(c);
      }
    };
    walk(this.o);
  }
  get shaderList() { return this._shaderProxy(); }
  set shaderList(v) {
    const shs = Array.isArray(v) ? v : [v];
    const meshes = this._meshes();
    for (const m of meshes) {
      m.__shaders = m.__shaders.map((_, i) => shs[Math.min(i, shs.length - 1)]);
      m.material = m.__shaders.map(s => s.mat);
      if (m.material.length === 1) m.material = m.material[0];
    }
    this._applyFacing();
  }
  _applyFacing() {
    const f = this.resource && this.resource.facing;
    if (!f || f === '#front') return;
    for (const m of this._meshes()) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.side = f === '#back' ? THREE.BackSide : THREE.DoubleSide;
    }
  }
  _meshes() {
    const out = [];
    this.o.traverse(c => { if (c.isMesh && c.__shaders) out.push(c); });
    return out;
  }
  _shaderProxy() {
    // Aggregated shader list across meshes, 1-indexed like Lingo
    const meshes = this._meshes();
    const flat = [];
    for (const m of meshes) for (const s of m.__shaders) flat.push(s);
    const self = this;
    return new Proxy(flat, {
      get(t, k) {
        if (k === 'count' || k === 'length') return flat.length;
        if (k === Symbol.iterator) return function* () { yield* flat; };
        const i = Number(k);
        if (Number.isInteger(i)) return flat[i - 1];
        return t[k];
      },
      set(t, k, v) {
        const i = Number(k);
        if (Number.isInteger(i)) {
          // replace i-th shader slot
          let n = 0;
          for (const m of meshes) {
            for (let j = 0; j < m.__shaders.length; j++) {
              n++;
              if (n === i) {
                m.__shaders[j] = v;
                m.material = m.__shaders.map(s => s.mat);
                if (m.material.length === 1) m.material = m.material[0];
                self._applyFacing();
                return true;
              }
            }
          }
        }
        t[k] = v;
        return true;
      }
    });
  }
  get shader() { return this.shaderList[1]; }
  set shader(v) { this.shaderList = v; }
  clone(name) {
    const copy = new Node(this.world, name, this.o.clone(true));
    copy.o.matrixAutoUpdate = false;
    copy.o.userData = { node: copy };
    copy.o.traverse(c => { if (c !== copy.o && c.userData) c.userData = { ...c.userData, node: undefined, shaders: c.__shaders ? [...c.__shaders] : undefined }; });
    copy._visibility = this._visibility;
    this.world.models.set(name, copy);
    // clones appear in the world like Director
    this.world.scene.add(copy.o);
    return copy;
  }
}

// ---------------- shader / texture wrappers ----------------
export class Tex {
  constructor(world, name, source) {
    this.world = world; this.name = name;
    const t = source instanceof THREE.Texture ? source : new THREE.Texture(source);
    this.t = t;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = true;
    t.needsUpdate = true;
    this.quality = '#med';
    this.renderFormat = '#rgba8888';
    this.nearFiltering = 1;
    this.hasAlpha = detectAlpha(t.image);
  }
}

function detectAlpha(img) {
  try {
    if (!img) return false;
    let cv = img;
    if (!cv.getContext) {
      cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
    }
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 64) if (d[i] < 250) return true;
    return false;
  } catch (e) { return true; }
}

export class Shader {
  constructor(world, name) {
    this.world = world; this.name = name;
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mat.side = THREE.FrontSide;
    this.mat.transparent = false;
    this.mat.__shader = this;
    this._emissive = rgb(0, 0, 0);
    this._diffuse = rgb(255, 255, 255);
    this._blend = 100;
    this.shininess = 30;
    this.blendConstantList = new Proxy({}, { get: () => 0, set: () => true });
    this.blendFunctionList = new Proxy({}, { get: () => '#multiply', set: () => true });
    this.textureModeList = new Proxy({}, { get: () => '#none', set: () => true });
    this._texTransform = null;
    this.flat = 0;
    this.ambient = rgb(63, 63, 63);
    this.useDiffuseWithTexture = 0;
  }
  get texture() { return this._texture; }
  set texture(tx) {
    this._texture = tx;
    this.mat.map = tx ? tx.t : null;
    // Director standard shader: final = texture * (emissive + lit diffuse); emissiveMap makes emissive texture-modulated
    this.mat.emissiveMap = tx ? tx.t : null;
    this._applyTransparency();
    this.mat.needsUpdate = true;
    this._applyColors();
  }
  _applyTransparency() {
    const texAlpha = !!(this._texture && this._texture.hasAlpha);
    this.mat.transparent = texAlpha || this._blend < 100;
    this.mat.needsUpdate = true;
  }
  get textureList() {
    const self = this;
    return new Proxy({}, {
      get(t, k) { return Number(k) === 1 ? self._texture : undefined; },
      set(t, k, v) { if (Number(k) === 1) self.texture = v; return true; }
    });
  }
  set textureList(v) { this.texture = Array.isArray(v) ? v[0] : v; }
  get reflectionMap() { return this._refl; }
  set reflectionMap(tx) {
    this._refl = tx;
    if (tx) {
      const t = tx.t;
      // three removed sphere mapping; equirectangular is the closest live approximation
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.needsUpdate = true;
      this.mat.envMap = t;
      this.mat.combine = THREE.AddOperation;
      this.mat.reflectivity = 0.35;
      this.mat.needsUpdate = true;
    } else { this.mat.envMap = null; this.mat.needsUpdate = true; }
  }
  get emissive() { return this._emissive; }
  set emissive(c) { this._emissive = c; this._applyColors(); }
  get diffuse() { return this._diffuse; }
  set diffuse(c) { this._diffuse = c; this._applyColors(); }
  _applyColors() {
    // Director standard shader: color = emissive + lighting(diffuse); textured: texture replaces diffuse unless useDiffuseWithTexture
    this.mat.emissive = this._emissive.toThree();
    if (this.mat.map && !this.useDiffuseWithTexture) this.mat.color = new THREE.Color(1, 1, 1);
    else this.mat.color = this._diffuse.toThree();
  }
  get blend() { return this._blend; }
  set blend(v) { this._blend = v; this.mat.opacity = v / 100; this._applyTransparency(); }
  get textureTransform() {
    if (!this._texTransform) {
      const self = this;
      this._texTransform = {
        get scale() { return this._s || new V3(1, 1, 1); },
        set scale(v) {
          this._s = v;
          if (self.mat.map) { self.mat.map.repeat.set(v.x, v.y); self.mat.map.needsUpdate = true; }
        },
        get position() { return this._p || new V3(0, 0, 0); },
        set position(v) {
          this._p = v;
          if (self.mat.map) { self.mat.map.offset.set(v.x, v.y); }
        },
        get rotation() { return this._r || new V3(0, 0, 0); },
        set rotation(v) {
          this._r = v;
          // Director rotates texture UVs about the UV origin, not the texture middle
          if (self.mat.map) { self.mat.map.center.set(0, 0); self.mat.map.rotation = -v.z * DEG; }
        }
      };
    }
    return this._texTransform;
  }
  clone(name) {
    const s = new Shader(this.world, name);
    s.mat = this.mat.clone();
    s.mat.__shader = s;
    s._emissive = this._emissive; s._diffuse = this._diffuse; s._blend = this._blend;
    s._texture = this._texture; s._refl = this._refl;
    s.useDiffuseWithTexture = this.useDiffuseWithTexture;
    return s;
  }
}
