// Shockwave 3D "world" (the member("w") 3D cast member) emulation.
import * as THREE from 'three';
import { Node, Tex, Shader, Transform, V3, vector, rgb, DEG } from './dirshim.js';

class ModelResource {
  constructor(world, name, type, facing) {
    this.world = world; this.name = name; this.type = type; this.facing = facing || '#front';
    // primitive params (Director defaults)
    this.topRadius = 25; this.bottomRadius = 25; this.height = 50; this.numSegments = 2;
    this.topCap = 1; this.bottomCap = 1; this.resolution = 20; this.radius = 25;
    this.width = 50; this.length = 50; this.lengthVertices = 2; this.widthVertices = 2;
    // particle params
    if (type === '#particle') {
      this.lifeTime = 5000;
      this.colorRange = { start: rgb(255, 255, 255), end: rgb(255, 255, 255) };
      this.tweenMode = '#velocity';
      this.sizeRange = { start: 1, end: 1 };
      this.blendRange = { start: 100, end: 100 };
      this.texture = null;
      this.emitter = {
        numParticles: 100, mode: '#stream', loop: 1, minSpeed: 10, maxSpeed: 20,
        drag: 0, path: [], direction: vector(0, 1, 0), region: [], angle: 0
      };
      this.wind = vector(0, 0, 0);
      this.gravity = vector(0, 0, 0);
    }
  }
  buildGeometry() {
    let g;
    switch (this.type) {
      case '#cylinder':
        g = new THREE.CylinderGeometry(this.topRadius, this.bottomRadius, this.height,
          Math.max(12, 32), Math.max(1, this.numSegments), !(this.topCap || this.bottomCap));
        break;
      case '#sphere':
        g = new THREE.SphereGeometry(this.radius, Math.max(8, this.resolution * 2), Math.max(6, this.resolution));
        break;
      case '#box':
        g = new THREE.BoxGeometry(this.width, this.height, this.length);
        break;
      case '#plane':
        g = new THREE.PlaneGeometry(this.width, this.length, this.widthVertices - 1 || 1, this.lengthVertices - 1 || 1);
        // Director plane front face is -Z
        g.rotateY(Math.PI);
        break;
      default:
        g = new THREE.BoxGeometry(1, 1, 1);
    }
    return g;
  }
}

class ParticleSystem {
  constructor(world, res) {
    this.world = world; this.res = res;
    const n = res.emitter.numParticles;
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.alphas = new Float32Array(n).fill(1);
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.sizes = new Float32Array(n).fill(res.sizeRange.start);
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: res.texture ? res.texture.t : null }, color: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `attribute float aAlpha; attribute float aSize; varying float vA;
        void main(){ vA=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
        gl_PointSize = aSize * (300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA;
        void main(){ vec4 c=texture2D(map,gl_PointCoord); gl_FragColor=vec4(c.rgb, c.a*vA); if(gl_FragColor.a<0.01) discard; }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < n; i++) this.spawn(i, Math.random() * res.lifeTime);
    world.particleSystems.push(this);
  }
  spawn(i, age = 0) {
    const r = this.res, reg = r.emitter.region;
    let p = new THREE.Vector3(0, 0, 0);
    if (reg.length === 1) p.set(reg[0].x, reg[0].y, reg[0].z);
    else if (reg.length === 2) {
      const t = Math.random();
      p.set(reg[0].x + (reg[1].x - reg[0].x) * t, reg[0].y + (reg[1].y - reg[0].y) * t, reg[0].z + (reg[1].z - reg[0].z) * t);
    } else if (reg.length === 4) {
      const u = Math.random(), v = Math.random();
      const a = reg[0], b = reg[1], d = reg[3];
      p.set(a.x + (b.x - a.x) * u + (d.x - a.x) * v, a.y + (b.y - a.y) * u + (d.y - a.y) * v, a.z + (b.z - a.z) * u + (d.z - a.z) * v);
    }
    const speed = r.emitter.minSpeed + Math.random() * (r.emitter.maxSpeed - r.emitter.minSpeed);
    const dir = r.emitter.direction, dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    let dv = new THREE.Vector3(dir.x / dl, dir.y / dl, dir.z / dl);
    if (r.emitter.angle > 0) {
      const spread = r.emitter.angle * DEG;
      const rndAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      dv.applyAxisAngle(rndAxis, Math.random() * spread);
    }
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = dv.x * speed / 30; this.vel[i * 3 + 1] = dv.y * speed / 30; this.vel[i * 3 + 2] = dv.z * speed / 30;
    this.age[i] = age;
  }
  tick(dt) {
    const r = this.res;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] > r.lifeTime) { this.spawn(i); continue; }
      const drag = r.emitter.drag ? Math.max(0, 1 - r.emitter.drag * dt / 5000) : 1;
      this.vel[i * 3] = this.vel[i * 3] * drag + (r.wind.x + r.gravity.x) * dt / 1000 / 30;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + (r.wind.y + r.gravity.y) * dt / 1000 / 30;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2] * drag + (r.wind.z + r.gravity.z) * dt / 1000 / 30;
      this.pos[i * 3] += this.vel[i * 3] * dt / 33;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt / 33;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt / 33;
      const t = this.age[i] / r.lifeTime;
      this.alphas[i] = ((r.blendRange.start * (1 - t)) + (r.blendRange.end * t)) / 100;
      this.sizes[i] = (r.sizeRange.start * (1 - t)) + (r.sizeRange.end * t);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

export class World {
  constructor(assets, renderer, overlayDiv) {
    this.assets = assets;
    this.renderer = renderer;
    this.overlayDiv = overlayDiv;
    this.resetWorld();
  }
  resetWorld() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0, 0, 0);
    this.models = new Map();
    this.modelResources = new Map();
    this.textures = new Map();
    this.shaders = new Map();
    this.particleSystems = [];
    this.overlays = [];
    if (this.overlayDiv) this.overlayDiv.innerHTML = '';
    this.groupNode = new Node(this, 'World Group', new THREE.Group());
    // default lights (Director: light[1] ambient-ish, light[2] directional)
    // three r155+ physical lighting units: PI-scale so diffuse×light matches Director 1:1.
    // Director's ambient light multiplies the shader's ambient property (~0.25 gray), not
    // diffuse — scale it down accordingly or everything overexposes.
    this.ambient = new THREE.AmbientLight(0xffffff, Math.PI * 0.25);
    this.directional = new THREE.DirectionalLight(0xffffff, Math.PI * 0.92);
    this.directional.position.set(0, 1000, 1000);
    this.scene.add(this.ambient, this.directional);
    const self = this;
    this._lightWrappers = [null,
      { set color(c) { self.ambient.color = c.toThree(); }, get color() { return rgb(self.ambient.color.r * 255, self.ambient.color.g * 255, self.ambient.color.b * 255); }, set specular(v) { }, transform: { set position(v) { } }, set type(v) { } },
      {
        set color(c) { self.directional.color = c.toThree(); }, get color() { return rgb(255, 255, 255); }, set specular(v) { },
        transform: { set position(v) { self.directional.position.set(v.x, v.y, v.z); } },
        set type(v) { }
      }];
    // default camera at (0,0,250) like Director
    this._camera = this._makeCamera('DefaultView');
    this._camera.transformNode.transform.position = vector(0, 0, 250);
    this.cameraList = [this._camera];
  }
  get light() { return { 1: this._lightWrappers[1], 2: this._lightWrappers[2] }; }
  get camera() { const self = this; return new Proxy({}, { get(t, k) { return self.cameraList[Number(k) - 1]; } }); }

  _makeCamera(name) {
    const three = new THREE.PerspectiveCamera(30, 600 / 500, 1, 15000);
    three.matrixAutoUpdate = false;
    const node = new Node(this, name, three);
    this.scene.add(three);
    const world = this;
    const cam = {
      name, three, transformNode: node,
      get transform() { return node.transform; },
      set transform(t) { node.transform = t; },
      getWorldTransform() { return node.getWorldTransform(); },
      translate(...a) { node.translate(...a); },
      rotate(...a) { node.rotate(...a); },
      pointAt(...a) { node.pointAt(...a); },
      addChild(c, m) { node.addChild(c, m); },
      get fieldOfView() { return three.fov; },
      set fieldOfView(v) { three.fov = v; three.updateProjectionMatrix(); },
      fog: {
        _enabled: 0, _near: 0, _far: 1000, _color: rgb(0, 0, 0), decayMode: '#linear',
        get enabled() { return this._enabled; },
        set enabled(v) { this._enabled = v; world._applyFog(this); },
        get near() { return this._near; },
        set near(v) { this._near = v; world._applyFog(this); },
        get far() { return this._far; },
        set far(v) { this._far = v; world._applyFog(this); },
        get color() { return this._color; },
        set color(v) { this._color = v; world._applyFog(this); }
      },
      colorBuffer: {
        get clearValue() { return world._clear; },
        set clearValue(c) { world._clear = c; world.scene.background = c.toThree ? c.toThree() : new THREE.Color(c); }
      },
      addOverlay(tex, point, rot) {
        // Director scales textures to powers of two; overlays draw at texture size
        const p2 = (n) => Math.pow(2, Math.round(Math.log2(n)));
        const img = document.createElement('canvas');
        img.width = p2(tex.t.image.width); img.height = p2(tex.t.image.height);
        img.getContext('2d').drawImage(tex.t.image, 0, 0, img.width, img.height);
        img.style.position = 'absolute';
        img.style.left = point.x + 'px';
        img.style.top = point.y + 'px';
        world.overlayDiv.appendChild(img);
        world.overlays.push(img);
      },
      removeOverlay(i) {
        const img = world.overlays[i - 1];
        if (img) { img.remove(); world.overlays.splice(i - 1, 1); }
      },
      modelUnderLoc() { return undefined; }
    };
    return cam;
  }
  newCamera(name) {
    const cam = this._makeCamera(name);
    this.cameraList.push(cam);
    return cam;
  }
  _applyFog(f) {
    if (f._enabled) this.scene.fog = new THREE.Fog(f._color.toThree(), f._near, f._far);
    else this.scene.fog = null;
  }

  newModelResource(name, type, facing) {
    const r = new ModelResource(this, name, type, facing);
    this.modelResources.set(name, r);
    return r;
  }
  modelResource(name) { return this.modelResources.get(name); }

  newModel(name, res) {
    let node;
    if (res && res.type === '#particle') {
      const ps = new ParticleSystem(this, res);
      node = new Node(this, name, new THREE.Group());
      node.o.add(ps.points);
      node.resource = res;
      res._system = ps;
    } else {
      const geo = res.buildGeometry();
      const sh = new Shader(this, name + 'Shader');
      sh.emissive = rgb(0, 0, 0);
      const mesh = new THREE.Mesh(geo, sh.mat);
      mesh.__shaders = [sh];
      if (res.facing === '#back') sh.mat.side = THREE.BackSide;
      else if (res.facing === '#both') sh.mat.side = THREE.DoubleSide;
      node = new Node(this, name, new THREE.Group());
      node.o.add(mesh);
      node.resource = res;
      // multi-shader primitives (cylinder side/top/bottom) share the mesh; keep simple: shaderList index 1..3 → same
      if (res.type === '#cylinder') {
        mesh.__shaders = [sh, sh, sh];
      }
    }
    this.models.set(name, node);
    this.scene.add(node.o);
    return node;
  }
  model(name) { return this.models.get(name); }
  deleteModel(name) {
    const m = this.models.get(name);
    if (m) { m.removeFromWorld(); this.models.delete(name); }
  }
  deleteTexture(name) { this.textures.delete(name); }
  texture(name) { return this.textures.get(name); }
  newTexture(name, kind, source) {
    // kind: #fromCastMember (source = member) or #fromImageObject (source = DirImage)
    const image = (kind === '#fromCastMember') ? source.image.canvas() : source.canvas();
    const tex = new Tex(this, name, image);
    this.textures.set(name, tex);
    return tex;
  }
  newShader(name) {
    const s = new Shader(this, name);
    this.shaders.set(name, s);
    return s;
  }
  shader(name) { return this.shaders.get(name); }

  cloneModelFromCastmember(name, srcModelName, member) {
    // member = a Member3D with parsed W3D scene
    const node = member.instantiate(this, name, srcModelName);
    this.models.set(name, node);
    this.scene.add(node.o);
    return node;
  }

  modelsUnderRay(origin, dir, opts) {
    const list = (opts && opts.modelList) || [];
    const maxDist = (opts && opts.maxDistance) || Infinity;
    const o = origin.toThree ? origin.toThree() : new THREE.Vector3(origin.x, origin.y, origin.z);
    const dv = new THREE.Vector3(dir.x, dir.y, dir.z);
    const dlen = dv.length() || 1;
    const d = dv.clone().normalize();
    this._ray = this._ray || new THREE.Raycaster();
    this._ray.set(o, d);
    // Director: maxDistance is in units of the direction vector's length; hit distances are world units
    this._ray.far = maxDist * dlen;
    const objs = list.map(n => n.o);
    for (const obj of objs) obj.updateMatrixWorld(true);
    const hits = this._ray.intersectObjects(objs, true);
    return hits.map(h => {
      let n = new V3(0, 1, 0);
      if (h.face) {
        const nm = h.face.normal.clone();
        const normalMat = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
        nm.applyMatrix3(normalMat).normalize();
        n = V3.from(nm);
      }
      return { distance: h.distance, isectPosition: V3.from(h.point), isectNormal: n, model: h.object.__node };
    });
  }

  tickParticles(dt) { for (const ps of this.particleSystems) ps.tick(dt); }

  render(camera) {
    // headlight: keep the directional light shining from the camera so player-facing
    // surfaces are lit (matches how the original reads on screen)
    camera.three.updateMatrixWorld(true);
    const cp = new THREE.Vector3().setFromMatrixPosition(camera.three.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camera.three.matrixWorld);
    this.directional.position.copy(cp);
    this.directional.target.position.copy(cp.clone().add(fwd.multiplyScalar(100)));
    if (!this.directional.target.parent) this.scene.add(this.directional.target);
    this.renderer.render(this.scene, camera.three);
  }
}
