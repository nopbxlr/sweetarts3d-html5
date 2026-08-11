// Faithful port of the SweeTarts 3D Lingo movie scripts (MovieScript 44-49 + behaviors).
import * as THREE from 'three';
import { V3, vector, rgb, transform, Transform, random, randomVector, DEG } from './dirshim.js';
import { DirImage, rect } from './members.js';

const EMPTY = '';

// HUD planes ride the camera; draw them last without depth so world geometry never stomps them
function hudTopmost(node) {
  node.o.traverse((c) => {
    if (c.isMesh) {
      c.renderOrder = 1000;
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) { m.depthTest = false; m.depthWrite = false; }
    }
  });
}

// Lingo linear-property-list helpers (duplicate keys allowed, 1-indexed)
class PropList {
  constructor() { this.entries = []; }
  addProp(k, v) { this.entries.push([String(k), v]); }
  get count() { return this.entries.length; }
  getPropAt(i) { return this.entries[i - 1][0]; }
  getAt(i) { return this.entries[i - 1][1]; }
  deleteAt(i) { this.entries.splice(i - 1, 1); }
  getaProp(k) { const e = this.entries.find(e => e[0] === String(k)); return e ? e[1] : undefined; }
}

export class Game {
  constructor(env) {
    // env: {w: World, members: Members, sounds: SoundSystem, input, stage:{w,h}, goto(label), assets}
    Object.assign(this, env);
    const g = this;
    // globals
    g.tracknum = 1; g.trackname = 'track1';
    g.editing = 0; g.gamescore = 0; g.levelscore = 0; g.deathcount = 0;
    g.happyword = EMPTY; g.happywordreset = EMPTY; g.happywordList = [[], [], [], [], [], []];
    g.MCnum = 1; g.mrseasick = 0; g.shownscore = -100; g.lastscorechange = 0;
    g.sndchan = 1; g.norepeat = [1, 2, 3];
    g.playedGameonce = 0; g.LowEndVersion = 0;
    g.hatrecordinglist = []; g.recordinglist = [];
    g.startyet = 0; g.logosinited = 0;
  }

  milliSeconds() { return performance.now(); }

  // ======================= scoring / sound =======================
  addscore(avalue) {
    this.shownscore = -100;
    this.gamescore = Math.max(0, this.gamescore + avalue);
  }
  playsnd(asndname, pitchshift = 0) {
    this.sndchan = (this.sndchan ?? 1) + 1;
    if (this.sndchan > 8) this.sndchan = 2;
    const ch = this.sounds.channel(this.sndchan);
    ch.stop();
    ch.play({ member: asndname, rateShift: pitchshift });
  }
  playgulpsnd() {
    if (!this.norepeat || this.norepeat.length === 0) this.norepeat = [1, 2, 3];
    const gitone = random(this.norepeat.length);
    const itis = this.norepeat[gitone - 1];
    this.playsnd('gulp' + itis);
    this.norepeat.splice(gitone - 1, 1);
  }

  // ======================= init =======================
  initgame() {
    const g = this;
    g.gamescore = 0; g.levelscore = 0; g.deathcount = 0;
    g.hatrecording = 0; g.hatrecordinglist = [];
    g.lasthatrecord = vector(-10000, -10000, -10000);
    g.happywordList = [[], [], [], [], [], []];
    g.happyword = EMPTY; g.happywordreset = EMPTY;
    let availletters = 'sweetaryd'.split('');
    const tdistribution = [1, 1, 2, 2, 3, 3, 4, 5, 5];
    let tdistcount = 1;
    while (availletters.length) {
      const tindex = random(availletters.length);
      const thischar = availletters[tindex - 1];
      availletters.splice(tindex - 1, 1);
      g.happywordList[tdistribution[tdistcount - 1] - 1].push(thischar);
      tdistcount++;
    }
  }

  member(name) { return this.members.member(name); }
  value(t) { return this.members.value(t); }

  initworld() {
    const g = this, w = g.w;
    g.happyword = g.happywordreset;
    g.logosinited = 0;
    g.ghatdestination = undefined;
    g.gothat = 0;
    g.exitavailable = 0;
    g.startyet = 0;
    if (g.trackname == null) g.trackname = 'track1';
    g.trackdef = g.value(g.member(g.trackname + 'def').text);
    w.resetWorld();
    g.c = w.camera[1];
    const c = g.c;
    c.fog.enabled = 1;
    c.fog.decayMode = '#linear';
    c.fog.far = 3500;
    c.fog.near = 3000;
    c.fog.color = rgb(0, 0, 0);
    g.collectedletters = [];
    g.initnumbers();
    w.light[1].color = rgb(64, 64, 64);
    w.light[2].color = rgb(255, 255, 255);
    let nmr = w.newModelResource('skybox', '#cylinder', '#back');
    nmr.topRadius = 6000; nmr.bottomRadius = 6000;
    nmr.topCap = 0; nmr.bottomCap = 0;
    nmr.height = 6000; nmr.numSegments = 1;
    g.tartcount = 0;
    let nm = w.newModel('skybox', nmr);
    nm.translate(0, -1000, 0);
    g.skybox = nm;
    const skywall = w.newShader('skybox');
    skywall.emissive = rgb(255, 255, 255);
    skywall.shininess = 0;
    const skyimg = g.member(g.trackname + 'bkg');
    let ntx = w.newTexture('skywall', '#fromCastMember', skyimg);
    skywall.texture = ntx;
    skywall.textureTransform.scale = vector(8, 1, 1); // 0.125 shader-space = 8 repeats
    nm.shaderList[1] = skywall;
    nm.shaderList = skywall;
    nmr = w.newModelResource('planepanel', '#plane', '#front');
    nmr.width = 12000; nmr.length = 12000;
    nmr.lengthVertices = 6; nmr.widthVertices = 6;
    nm = w.newModel('skytop', nmr);
    nm.translate(0, 1990, 0);
    nm.rotate(-90, 0, 0);
    const skytop = w.newShader('skytop');
    if (g.tracknum === 3) {
      ntx = w.newTexture('skytop', '#fromCastMember', g.member('watersurface'));
    } else {
      const ntximg = DirImage.create(16, 16);
      ntximg.copyPixels(skyimg.image, rect(0, 0, 16, 16), rect(1, 1, 2, 2));
      ntx = w.newTexture('skytop', '#fromImageObject', ntximg);
    }
    skytop.texture = ntx;
    skytop.shininess = 0;
    skytop.emissive = rgb(255, 255, 255);
    nm.shader = skytop;
    g.skybox.addChild(nm, '#preserveWorld');
    nm = w.newModel('skybottom', nmr);
    nm.translate(0, -3990, 0);
    nm.rotate(90, 0, 0);
    const skybottom = w.newShader('skybottom');
    switch (g.tracknum) {
      case 1: case 5:
        ntx = w.newTexture('skybottom', '#fromCastMember', g.member('junglegrass')); break;
      case 2:
        ntx = w.newTexture('skybottom', '#fromCastMember', g.member('beachsand')); break;
      case 4: {
        const ntximg2 = g.member('junglegrass').image.duplicate();
        const ntximg3 = ntximg2.duplicate();
        ntximg3.fill(ntximg3.rect, skyimg.image.getPixel(510, 510));
        ntximg2.copyPixels(ntximg3, ntximg2.rect, ntximg2.rect, { ink: '#lightest' });
        ntx = w.newTexture('skybottom', '#fromImageObject', ntximg2); break;
      }
      case 6:
        ntx = w.newTexture('skybottom', '#fromCastMember', g.member('desertground')); break;
      case 3:
        ntx = w.newTexture('skybottom', '#fromCastMember', g.member('oceanbottom')); break;
      default: {
        const ntximg2 = DirImage.create(16, 16);
        ntximg2.copyPixels(skyimg.image, rect(0, 0, 16, 16), rect(510, 510, 511, 511));
        ntx = w.newTexture('skybottom', '#fromImageObject', ntximg2);
      }
    }
    c.colorBuffer.clearValue = skyimg.image.getPixel(511, 511);
    skybottom.texture = ntx;
    skybottom.shininess = 0;
    skybottom.emissive = rgb(255, 255, 255);
    nm.shader = skybottom;
    g.skybox.addChild(nm, '#preserveWorld');
    // ground textures repeat: Director texture on 12000-unit plane tiles by default? plane UV 0..1; keep 16x repeat for detail
    skybottom.mat && 0;
    g.raycastlist = [];
    w.newTexture('crome', '#fromCastMember', g.member('crome'));
    const trackMember = g.member(g.trackname);
    trackMember.resetWorld();
    const tname = trackMember.model[1].name;
    nm = w.cloneModelFromCastmember('plat001', tname, trackMember);
    const nsh = w.newShader('plattext');
    nsh.textureTransform.scale = vector(0.5, 0.5, 1);
    nsh.shininess = 0;
    g.trackmodelID = nm;
    switch (g.tracknum) {
      case 4: {
        ntx = w.newTexture('plattext', '#fromCastMember', g.member('sandstone'));
        nsh.useDiffuseWithTexture = 1;
        nsh.emissive = rgb(60, 60, 60);
        nsh.diffuse = rgb(255, 255, 128);
        nsh.texture = ntx;
        nm.shaderList = nsh;
        const basemodel = g.maketree();
        for (let xxx = 1; xxx <= 20; xxx++) {
          const tm = basemodel.clone('tree' + xxx);
          tm.addToWorld();
          const randvect = vector(random(12000) - 6000, -3500, random(12000) - 6000);
          tm.transform.position = randvect;
          tm.pointAt(vector(0, 0, 0));
          tm.scale(Math.min(25, 25.0 / (randvect.add(vector(0, 4000, 0)).length / 2000.0)));
        }
        break;
      }
      case 6: {
        ntx = w.newTexture('plattext', '#fromCastMember', g.member('sandstone'));
        nsh.useDiffuseWithTexture = 1;
        nsh.emissive = rgb(0, 0, 140);
        nsh.diffuse = rgb(255, 0, 0);
        nsh.texture = ntx;
        nm.shaderList = nsh;
        let basemod;
        for (let xxx = 1; xxx <= 20; xxx++) {
          let tm;
          if (xxx === 1) {
            const cactiMember = g.member('cacti');
            const basemodname = cactiMember.model[1];
            basemod = w.cloneModelFromCastmember('cacti1', basemodname.name, cactiMember);
            tm = basemod;
            basemod.shader.diffuse = rgb(255, 0, 0);
          } else tm = basemod.clone('cacti' + xxx);
          tm.rotate(0, random(360), 0);
          const randvect = vector(random(12000) - 6000, -4000, random(12000) - 6000);
          tm.scale(Math.min(6, 6.0 / (randvect.add(vector(0, 4000, 0)).length / 3200.0)));
          tm.transform.position = randvect;
        }
        break;
      }
      case 3: {
        g.turnonbubblemachine();
        ntx = w.newTexture('plattext', '#fromCastMember', g.member('rustediron'));
        nsh.useDiffuseWithTexture = 1;
        nsh.emissive = rgb(0, 90, 120);
        nsh.diffuse = rgb(255, 255, 255);
        nsh.textureTransform.scale = vector(2, 2, 1);
        nsh.texture = ntx;
        nm.shaderList = nsh;
        break;
      }
      case 5: {
        ntx = w.newTexture('plattext', '#fromCastMember', g.member('sandstone'));
        nsh.useDiffuseWithTexture = 1;
        nsh.emissive = rgb(90, 90, 90);
        nsh.diffuse = rgb(255, 255, 255);
        nsh.texture = ntx;
        nm.shaderList = nsh;
        break;
      }
    }
    if ([4, 3].includes(g.tracknum)) {
      let basemod;
      for (let xxx = 1; xxx <= 10; xxx++) {
        let tm;
        if (xxx === 1) {
          const rockyMember = g.member('rocky');
          const basemodname = rockyMember.model[1];
          basemod = w.cloneModelFromCastmember('rocky1', basemodname.name, rockyMember);
          tm = basemod;
          for (const yyy of basemod.shaderList) {
            if (g.tracknum === 3) yyy.emissive = rgb(0, 80, 80);
            else yyy.emissive = rgb(64, 64, 64);
            yyy.diffuse = rgb(255, 0, 0);
            yyy.flat = 1;
          }
        } else tm = basemod.clone('rocky' + xxx);
        tm.rotate(0, random(360), 0);
        const randvect = vector(random(12000) - 6000, -4000, random(12000) - 6000);
        tm.scale(Math.min(20, 20.0 / (randvect.add(vector(0, 4000, 0)).length / 2000.0)));
        tm.transform.position = randvect;
      }
    }
    nm.scale(12, 12, 12);
    nm.translate(0, -50, 0);
    g.raycastlist.push(nm);
    nmr = w.newModelResource('mc', '#sphere', '#front');
    nmr.resolution = 8;
    nmr.radius = 15;
    g.mc = w.newModel('mc', nmr);
    const mc = g.mc;
    g.c2 = w.newCamera('dummycam');
    g.c2.transform.position = vector(0, 100, -100);
    g.c2.pointAt(mc);
    g.c2.rotate(10, 0, 0);
    c.transform = g.c2.getWorldTransform();
    c.fieldOfView = 55;
    mc.addChild(g.c2, '#preserveWorld');
    nmr = w.newModelResource('lookbox', '#box', '#front');
    nmr.height = 3; nmr.width = 3; nmr.length = 3;
    g.lookbox = w.newModel('lookbox', nmr);
    g.lookbox.visibility = '#none';
    if (this.input.shiftDown) g.lookbox.translate(0, 0, 25);
    else g.lookbox.translate(0, 0, 50);
    mc.addChild(g.lookbox, '#preserveWorld');
    g.lookleftbox = w.newModel('lookleftbox', nmr);
    g.lookleftbox.visibility = '#none';
    g.lookleftbox.translate(-15, 10, 5);
    mc.addChild(g.lookleftbox, '#preserveWorld');
    g.lookrightbox = w.newModel('lookrightbox', nmr);
    g.lookrightbox.visibility = '#none';
    g.lookrightbox.translate(15, 10, 5);
    mc.addChild(g.lookrightbox, '#preserveWorld');
    g.lookbackbox = w.newModel('lookbackbox', nmr);
    g.lookbackbox.translate(0, 0, -25);
    mc.addChild(g.lookbackbox, '#preserveWorld');
    g.lookbackbox.visibility = '#none';
    g.tracker = w.newModel('tracker', nmr);
    g.tracker.translate(0, 4, 15);
    mc.addChild(g.tracker, '#preserveWorld');
    g.tracker.visibility = '#none';
    g.lookJumpBox = w.newModel('lookJumpBox', nmr);
    g.lookJumpBox.translate(0, 0, 100);
    mc.addChild(g.lookJumpBox, '#preserveWorld');
    g.lookJumpBox.visibility = '#none';
    g.gOptionsList = { maxNumberOfModels: 1, levelOfDetail: '#detailed', modelList: g.raycastlist, maxDistance: 100 };
    g.angchange = 0;
    g.lastgoodtrans = mc.getWorldTransform();
    g.liveobjects = new PropList();
    g.createobjects();
    g.constructMC();
    g.placeobjects();
    g.cameramoving = 1;
    g.cameratiming = g.milliSeconds();
    let btext;
    if ([3, 5].includes(g.tracknum)) btext = w.newTexture('btext', '#fromCastMember', g.member('basictext4'));
    else if (g.tracknum === 6) btext = w.newTexture('btext', '#fromCastMember', g.member('basictext3'));
    else btext = w.newTexture('btext', '#fromCastMember', g.member('basictext'));
    const ttt = { x: this.stage.w / 2 - 128, y: this.stage.h / 2 - 128 };
    c.addOverlay(btext, ttt, 0);
    g.ploppy = 0;
    g.amjumping = 0;
    g.pointmovingtowards = 0;
    g.loadrecording();
    g.lastnormal = vector(0, 1, 0);
  }

  maketree() {
    const g = this, w = g.w;
    const nmr = w.newModelResource('bush', '#plane', '#both');
    nmr.length = 80; nmr.width = 80;
    const ntx = w.newTexture('bush', '#fromCastMember', g.member('bush'));
    const nsh = w.newShader('bush');
    nsh.texture = ntx;
    nsh.emissive = rgb(255, 255, 255);
    nsh.ambient = rgb(255, 255, 255);
    nsh.diffuse = rgb(255, 255, 255);
    const tree = w.newModel('bush1', nmr);
    tree.shaderList = nsh;
    tree.removeFromWorld();
    return tree;
  }

  turnonbubblemachine() {
    const g = this, w = g.w;
    const bubbleblobtext = w.newTexture('bubble', '#fromCastMember', g.member('bubble'));
    const nmr = w.newModelResource('particality', '#particle');
    nmr.lifeTime = 7000;
    nmr.colorRange.end = rgb(255, 255, 255);
    nmr.colorRange.start = rgb(255, 255, 255);
    nmr.tweenMode = '#age';
    nmr.sizeRange.start = 100; nmr.sizeRange.end = 50;
    nmr.blendRange.start = 50; nmr.blendRange.end = 50;
    nmr.emitter.numParticles = 100;
    nmr.texture = bubbleblobtext;
    nmr.emitter.mode = '#stream';
    nmr.emitter.loop = 1;
    nmr.emitter.drag = 1;
    nmr.emitter.minSpeed = 50; nmr.emitter.maxSpeed = 50;
    nmr.emitter.direction = vector(0, 1, 0);
    nmr.wind = vector(0, 50, 0);
    nmr.gravity = vector(0, 20, 0);
    nmr.emitter.region = [vector(-4000, -3000, -4000), vector(4000, -3000, -4000), vector(4000, -3000, 4000), vector(-4000, -3000, 4000)];
    const nm = w.newModel('bubblemachine', nmr);
    g.bubblemachine = nm;
  }

  cycleupdate() {
    const g = this;
    if (g.tracknum === 3 && g.bubblemachine) {
      let dtime = g.milliSeconds() / 1000.0;
      dtime = Math.sin(dtime) * Math.PI * 4;
      g.bubblemachine.resource.gravity = vector(50 * Math.sin(dtime), 10, 50 * Math.cos(dtime));
    }
    if (g.tracknum === 3 && g.__bubbleFilm && g.__bubbleFilm.map) {
      const t = g.milliSeconds() / 1000;
      g.__bubbleFilm.map.offset.set(t * 0.07, Math.sin(t * 0.6) * 0.1);
      g.__bubbleFilm.map.rotation = t * 0.35;
      g.__bubbleFilm.map.center.set(0.5, 0.5);
    }
  }

  // ======================= MC (player model) =======================
  constructMC() {
    const g = this, w = g.w, mc = g.mc;
    switch (g.MCnum) {
      case 1: {
        const m = g.member('snake');
        const nm = w.cloneModelFromCastmember('MCModel', m.model[1].name, m);
        nm.scale(4);
        nm.translate(0, -8, 0);
        mc.addChild(nm, '#preserveWorld');
        mc.visibility = '#none';
        g.initbones(nm);
        g.MCAnimStep = 1;
        g.animateMC();
        break;
      }
      case 2: {
        const m = g.member('beachball');
        const nm = w.cloneModelFromCastmember('MCModel', m.model[1].name, m);
        nm.scale(4);
        nm.rotate(0, 90, 0);
        nm.translate(0, -5, 0);
        nm.translate(0, 10, 0);
        g.m_Model = nm;
        mc.addChild(nm, '#preserveWorld');
        mc.visibility = '#none';
        g.MCAnimStep = 1;
        g.animateMC();
        break;
      }
      case 4: case 6: {
        const m = g.member('atv');
        const nm = w.cloneModelFromCastmember('MCModel', m.model[1].name, m);
        nm.scale(4);
        nm.translate(0, -10, 0);
        g.m_Model = nm;
        mc.addChild(nm, '#preserveWorld');
        mc.visibility = '#none';
        g.MCAnimStep = 1;
        break;
      }
      case 3: {
        const nmr = w.newModelResource('bubblemc', '#sphere', '#both');
        nmr.radius = 25;
        const nm = w.newModel('bubble', nmr);
        nm.translate(0, 20, 0);
        const nsh = w.newShader('bubble');
        const ntx = w.newTexture('transcrome', '#fromCastMember', g.member('transcrome'));
        nsh.reflectionMap = ntx;
        nsh.mat.reflectivity = 0.45;
        nsh.diffuse = rgb(0, 90, 100);
        nsh.emissive = rgb(35, 70, 80);
        nsh.blend = 30; // glassy bubble
        nm.shaderList = nsh;
        // animated soap-film: additive swirl shell just above the glass
        {
          const base = nm.o.children.find(c => c.isMesh);
          if (base) {
            const filmMat = new THREE.MeshBasicMaterial({
              map: ntx.t.clone(), transparent: true, blending: THREE.AdditiveBlending,
              depthWrite: false, opacity: 0.32
            });
            filmMat.map.needsUpdate = true;
            filmMat.map.wrapS = filmMat.map.wrapT = THREE.RepeatWrapping;
            const film = new THREE.Mesh(base.geometry, filmMat);
            film.scale.setScalar(1.015);
            nm.o.add(film);
            g.__bubbleFilm = filmMat;
          }
        }
        g.m_Model = nm;
        g.addinker(nm);
        mc.addChild(nm, '#preserveWorld');
        mc.visibility = '#none';
        g.MCAnimStep = 1;
        break;
      }
      case 5: {
        const m = g.member('skate');
        const nm = w.cloneModelFromCastmember('MCModel', m.model[1].name, m);
        nm.scale(4);
        nm.rotate(0, 180, 0);
        nm.translate(0, -10, 0);
        const nsh = nm.shaderList[1];
        if (nsh) nsh.reflectionMap = w.texture('crome');
        g.m_Model = nm;
        mc.addChild(nm, '#preserveWorld');
        mc.visibility = '#none';
        g.MCAnimStep = 1;
        break;
      }
    }
  }

  addinker(amodel) {
    // Director inker modifier: white silhouette outline. Backface-expanded shell.
    for (const c of [...amodel.o.children]) {
      if (!c.isMesh) continue;
      const outline = new THREE.Mesh(c.geometry, new THREE.MeshBasicMaterial({
        color: 0xffffff, side: THREE.BackSide
      }));
      outline.scale.setScalar(1.07);
      outline.renderOrder = (c.renderOrder || 0) - 1;
      amodel.o.add(outline);
    }
  }

  initbones(amodel) {
    this.m_Model = amodel;
    this.m_BoneNamesList = [];
    // bones player: procedural rotation applied in animateMC via model API (if skeleton available)
  }
  updateBoneRotation(bonenum, newrotation) {
    const m = this.m_Model;
    if (m && m.setBoneRotation) m.setBoneRotation(bonenum, newrotation);
  }

  animateMC(atype) {
    const g = this, w = g.w;
    switch (g.MCnum) {
      case 1: {
        g.updateBoneRotation(2, vector(0, 90 + (Math.sin(g.MCAnimStep - 2) * 40), 0));
        for (let xxx = 3; xxx <= 7; xxx++) {
          g.updateBoneRotation(xxx, vector(0, Math.sin(g.MCAnimStep + ((xxx - 3) * 0.9)) * 40, 0));
        }
        g.MCAnimStep -= 0.5;
        if (g.m_Model && g.m_Model.updateSkin) g.m_Model.updateSkin();
        break;
      }
      case 2: {
        if (atype === 1) g.m_Model.rotate(0, 0, 22, '#self');
        break;
      }
      case 4: case 6: {
        const s1 = w.shader('Material01') || (g.m_Model && g.m_Model.shaderList[1]);
        const s2 = w.shader('Material02') || (g.m_Model && g.m_Model.shaderList[2]);
        if (s1) s1.textureTransform.position = vector(g.milliSeconds() / 1000.0, 0, 0);
        if (s2) s2.textureTransform.rotation = vector(0, 0, g.milliSeconds() / 2.0);
        break;
      }
    }
  }

  // ======================= objects =======================
  createobjects() {
    const g = this, w = g.w;
    g.objectList = new PropList();
    for (let xxx = 1; xxx <= 6; xxx++) {
      const m = g.member('candy' + xxx);
      m.resetWorld();
      const nm = w.cloneModelFromCastmember('candy' + xxx, m.model[1].name, m);
      nm.scale(9);
      nm.removeFromWorld();
      nm.visibility = '#none';
      const sl = nm.shaderList;
      if (sl[1]) { sl[1].emissive = sl[1].emissive.add(rgb(100, 100, 100)); sl[1].diffuse = sl[1].emissive; }
      if (sl[2]) { sl[2].emissive = sl[2].emissive.add(rgb(100, 100, 100)); sl[2].diffuse = sl[2].emissive; }
      g.objectList.addProp(xxx, nm);
    }
    g.fxlist = [];
    let nmr = w.newModelResource('fxres', '#plane', '#both');
    nmr.width = 80; nmr.length = 80;
    let ntx = w.newTexture('fxtex', '#fromCastMember', g.member('sparklepony'));
    let nsh = w.newShader('txshd');
    nsh.texture = ntx;
    nsh.emissive = rgb(255, 255, 255);
    let nm = w.newModel('fx', nmr);
    nm.shaderList = nsh.clone('fx0');
    nm.removeFromWorld();
    g.fxlist.push([nm, vector(0, 0, 0)]);
    for (let xxx = 1; xxx <= 19; xxx++) {
      const tm = nm.clone('fx' + xxx);
      tm.shaderList = nsh.clone('fx' + xxx);
      tm.removeFromWorld();
      g.fxlist.push([tm, vector(0, 0, 0)]);
    }
    switch (g.tracknum) {
      case 6: {
        const m = g.member('cactiobstacle');
        m.resetWorld();
        const o = w.cloneModelFromCastmember('cactiObstacle', m.model[1].name, m);
        o.scale(3);
        o.visibility = '#none';
        o.removeFromWorld();
        const t2 = w.newTexture('cactimap', '#fromCastMember', g.member('cactimap'));
        const s2 = w.newShader('cactimap');
        s2.texture = t2;
        s2.emissive = rgb(128, 128, 128);
        o.shaderList = s2;
        g.objectList.addProp('o', o);
        break;
      }
      case 3: {
        const m = g.member('urchin');
        m.resetWorld();
        const o = w.cloneModelFromCastmember('urchin', m.model[1].name, m);
        o.scale(4);
        o.visibility = '#none';
        o.removeFromWorld();
        g.objectList.addProp('o', o);
        break;
      }
      case 5: {
        const m = g.member('tacks');
        m.resetWorld();
        const o = w.cloneModelFromCastmember('tacks', m.model[1].name, m);
        o.scale(3);
        o.visibility = '#none';
        o.removeFromWorld();
        const sl = o.shaderList;
        if (sl[1]) sl[1].reflectionMap = w.texture('crome');
        g.objectList.addProp('o', o);
        break;
      }
    }
    for (const xxx of ['s', 'w', 'e', 't', 'a', 'r', 'd', 'y']) {
      const tname = 'Letter_' + xxx.toUpperCase();
      const m = g.member(tname);
      m.resetWorld();
      m.shader('Material01').diffuse = rgb(207 * 0.8, 36 * 0.8, 119 * 0.8);
      m.shader('Material02').diffuse = rgb(0, 166 * 0.8, 223 * 0.8);
      const nm2 = w.cloneModelFromCastmember(tname, m.model[1].name, m);
      nm2.scale(8);
      nm2.rotate(90, 0, 0, '#self');
      nm2.visibility = '#none';
      nm2.removeFromWorld();
      for (const yyy of nm2.shaderList) yyy.emissive = yyy.diffuse.mul(0.75);
      g.objectList.addProp(xxx, nm2);
    }
    {
      const m = g.member('hat');
      m.resetWorld();
      const nm3 = w.cloneModelFromCastmember('hat', m.model[1].name, m);
      nm3.scale(3);
      nm3.rotate(0, 0, 90, '#self');
      nm3.visibility = '#none';
      nm3.removeFromWorld();
      g.objectList.addProp('h', nm3);
    }
    nmr = w.newModelResource('goldenticket', '#plane', '#both');
    nmr.length = 50; nmr.width = 50;
    const nm4 = w.newModel('goldenticket', nmr);
    ntx = w.newTexture('goldenticket', '#fromCastMember', g.member('goldenticket'));
    nsh = w.newShader('goldenticket');
    nsh.emissive = rgb(255, 255, 255);
    nsh.texture = ntx;
    nsh.reflectionMap = w.texture('crome');
    nm4.shaderList = nsh;
    nm4.rotate(-90, 0, 0, '#self');
    nm4.visibility = '#none';
    nm4.removeFromWorld();
    g.objectList.addProp('g', nm4);
  }

  emitsparkles(sourcemod) {
    const g = this;
    g.sparklestart = sourcemod.getWorldTransform().position;
    const srcShader = sourcemod.shaderList[1];
    const col = srcShader ? srcShader.diffuse : rgb(255, 255, 255);
    for (const xxx of g.fxlist) {
      const tm = xxx[0];
      tm.addToWorld();
      for (const s of tm.shaderList) { s.emissive = col; s.diffuse = col; }
      tm.transform.scale = vector(1, 1, 1);
      tm.transform.rotation = randomVector().mul(180);
      tm.transform.position = g.sparklestart.add(randomVector().mul(15));
      xxx[1] = randomVector().mul(5).add(vector(0, 15, 0));
    }
  }

  updatesparkles() {
    const g = this;
    for (const xxx of g.fxlist) {
      const tm = xxx[0];
      if (tm.o.parent) {
        tm.transform.rotation = randomVector().mul(180);
        xxx[1] = xxx[1].mul(0.95).add(vector(0, -1, 0));
        tm.translate(xxx[1], '#world');
        if (tm.getWorldTransform().scale.x > 0.05) tm.scale(0.92);
        if (random(10) === 1) {
          switch (random(3)) {
            case 1:
              tm.transform.scale = vector(0.5, 0.5, 0.5);
              tm.pointAt(g.c.getWorldTransform().position);
              tm.rotate(randomVector().mul(20).sub(vector(10, 10, 10)));
              tm.transform.position = g.mc.getWorldTransform().position.add(randomVector().mul(15));
              xxx[1] = randomVector().mul(5).add(vector(0, 5, 0));
              break;
            case 2:
              tm.removeFromWorld();
              break;
            case 3:
              xxx[1] = randomVector().mul(5).add(vector(0, 5, 0));
              break;
          }
        }
      }
    }
  }

  placeobjects() {
    const g = this, w = g.w;
    if (!g.trackdef || !g.trackdef.length) return;
    g.liveobjects = new PropList();
    g.thappywordList = [...g.happywordList[g.tracknum - 1]];
    g.tartcount = 0;
    for (let xxx = 1; xxx <= g.trackdef.length; xxx++) {
      const def = g.trackdef[xxx - 1];
      let makeit = 1;
      if ('swetardyg'.includes(def.objtype)) {
        const pos = g.thappywordList.indexOf(def.objtype);
        if (pos >= 0) g.thappywordList.splice(pos, 1);
        else makeit = 0;
      }
      if (g.editing) makeit = 1;
      if (makeit) {
        const nmname = 'object' + xxx;
        if (w.model(nmname)) w.deleteModel(nmname);
        let nm;
        const proto = g.objectList.getaProp(def.objtype);
        if (proto) nm = proto.clone(nmname);
        else nm = g.objectList.getAt(1).clone(nmname);
        nm.addToWorld();
        nm.transform.position = vector(...def.pos);
        nm.transform.rotation = vector(...def.rot);
        nm.visibility = '#front';
        nm.rotate(90, 0, 0, '#self');
        if (parseInt(def.objtype) > 0) {
          g.liveobjects.addProp(def.objtype, nm);
          g.tartcount++;
          nm.translate(0, 0, -30, '#self');
          continue;
        }
        nm.translate(20, 0, 0, '#self');
        if (def.objtype === 'h') {
          g.hatrecordinglist = g.value(g.member('track' + g.tracknum + 'pointshat').text) || [];
        }
        if (def.objtype === 'g') nm.rotate(90, 0, 0, '#self');
        if ('swetardyg'.includes(def.objtype)) g.tartcount++;
        g.liveobjects.addProp(def.objtype, nm);
        if (def.objtype === 'h') nm.translate(-10, 0, -30, '#self');
      }
    }
  }

  // ======================= collection =======================
  collectobjects() {
    const g = this, w = g.w;
    const tp = g.mc.getWorldTransform().position;
    for (let xxx = g.liveobjects.count; xxx >= 1; xxx--) {
      const atype = g.liveobjects.getPropAt(xxx);
      const amod = g.liveobjects.getAt(xxx);
      if (atype === 'o') {
        if (amod.o.parent) {
          if (amod.getWorldTransform().position.distanceTo(tp) < (45 + (30 * (g.amjumping > 0 ? 1 : 0))) && g.amjumping === 0) {
            g.emitsparkles(amod);
            g.amjumping = 1;
            g.jumpinc = vector(0, 100, -60);
          }
        }
        continue;
      }
      if (amod.o.parent) {
        if (amod.getWorldTransform().position.distanceTo(tp) < 65) {
          if ('sweetaryd'.includes(String(atype))) {
            g.playsnd('snd' + random(6), 0);
            g.tartcount--;
            if (g.tartcount < 1) g.showexit();
            g.happyword = g.happyword + atype;
            if (g.happyword.length === 9) g.addscore(500);
            else g.addscore(25);
            {
              let letterindex = 'sweetaryd'.indexOf(atype) + 1;
              if (letterindex === 3) {
                if (g.ploppy === 0) g.ploppy = 1;
                else letterindex = 4;
              }
              g.c.addChild(amod, '#preserveWorld');
              const ttrans = transform();
              const letterpositions = [vector(-53.5, 45, -75), vector(-39, 45.5, -76), vector(-22.5, 45, -75), vector(-10.5, 45, -75), vector(-4, 45, -75), vector(6, 45, -75), vector(12, 45, -75), vector(18, 45, -75), vector(24.5, 45, -75)];
              ttrans.position = letterpositions[letterindex - 1].mul(0.5).add(vector(5, 30, -40));
              ttrans.rotation = vector(60, 0, 0);
              g.collectedletters.push([amod, ttrans, g.milliSeconds()]);
              g.liveobjects.deleteAt(xxx);
            }
          } else {
            switch (atype) {
              case 'h':
                if (g.gothat === 0) {
                  g.gothat = 1;
                  g.addscore(100);
                  g.playsnd('Oh_Yeah');
                }
                break;
              case 'g':
                g.playsnd('Hey');
                g.addscore(300);
                break;
              default:
                g.playgulpsnd();
                g.addscore(50);
                g.tartcount--;
                if (g.tartcount < 1) g.showexit();
            }
            amod.removeFromWorld();
          }
          if (!'123456'.includes(String(atype))) g.emitsparkles(amod);
        }
      }
    }
  }

  showexit() {
    const g = this, w = g.w;
    const m = g.member('door');
    m.resetWorld();
    const exitloc = [vector(0.0, -92.3042, 0.0), vector(-0.0001, -74.4396, 0.0), vector(0.0, -94.3841, 6.9247), vector(-0.0001, -101.6332, 1.7521), vector(0.0, -128.1631, 0.0), vector(0.0, -109.3747, 4.5969)][g.tracknum - 1];
    const nm = w.cloneModelFromCastmember('door', m.model[1].name, m);
    nm.transform.position = g.mc.transform.position;
    nm.pointAt(exitloc);
    nm.translate(0, 150, -nm.transform.position.distanceTo(exitloc) - 150, '#self');
    nm.pointAt(exitloc);
    g.CameraTargetTrans = nm.transform.duplicate();
    nm.transform = transform();
    nm.scale(8);
    nm.rotate(0, 180, 0);
    nm.transform.position = exitloc;
    g.exitavailable = nm;
    g.cameramoving = 3;
    if (g.tracknum === 1) g.cameratiming = g.milliSeconds() + 4000;
    else g.cameratiming = g.milliSeconds() + 2000;
    if (g.tracknum === 3 && g.bubblemachine) {
      g.bubblemachine.resource.emitter.region = [exitloc.add(vector(-30, 0, 0)), exitloc.add(vector(30, 0, 0))];
      g.bubblemachine.resource.sizeRange.start = 8;
      g.bubblemachine.resource.blendRange.start = 100;
    }
  }

  // ======================= candies / hat animation =======================
  animatecandies() {
    const g = this;
    for (let xxx = 1; xxx <= g.liveobjects.count; xxx++) {
      const atype = g.liveobjects.getPropAt(xxx);
      const amod = g.liveobjects.getAt(xxx);
      switch (atype) {
        case 'o': break;
        case 'h': {
          if (g.cameramoving === 0 || g.cameramoving > 2) {
            const mpos = amod.transform.position;
            if (g.ghatdestination === undefined) {
              if (!g.hatrecordinglist.length) break;
              g.ghatdestination = g.hatrecordinglist[0];
              g.ghatindex = 1;
              g.ghatdir = 1;
            }
            const dest = g.ghatdestination;
            const destPos = vector(...dest[0]);
            const tdist = Math.max(5, mpos.distanceTo(destPos));
            if (tdist < 20) {
              g.ghatindex += g.ghatdir;
              if (g.ghatindex > g.hatrecordinglist.length) g.ghatindex = 1;
              if (g.ghatindex < 1) g.ghatindex = g.hatrecordinglist.length;
              g.ghatdestination = g.hatrecordinglist[g.ghatindex - 1];
              const mcpos = g.mc.getWorldTransform().position;
              if (mcpos.distanceTo(mpos) < 300) {
                if (mcpos.distanceTo(mpos) > mcpos.distanceTo(vector(...g.ghatdestination[0]))) g.ghatdir = -g.ghatdir;
              }
              amod.transform.rotation = vector(...g.ghatdestination[1]).add(vector(90, 0, 0));
            } else {
              const ttrans = amod.getWorldTransform().duplicate();
              const ttrans2 = ttrans.duplicate();
              ttrans.position = destPos;
              ttrans2.interpolateTo(ttrans, 900.0 / tdist);
              amod.transform.position = ttrans2.position;
            }
          } else if (g.cameramoving > 1) {
            if (g.ghatdestination === undefined && g.hatrecordinglist.length) {
              g.ghatdestination = g.hatrecordinglist[0];
              g.ghatindex = 1; g.ghatdir = 1;
            }
            if (g.ghatdestination) {
              const ttrans = amod.getWorldTransform().duplicate();
              const ttrans2 = ttrans.duplicate();
              ttrans.position = vector(...g.ghatdestination[0]);
              ttrans2.interpolateTo(ttrans, 5);
              amod.transform.position = ttrans2.position;
              amod.rotate(10, 10, 0, '#self');
            }
          } else {
            const ttran = amod.getWorldTransform();
            ttran.position = g.c.getWorldTransform().position;
            ttran.interpolateTo(g.trackmodelID.getWorldTransform(), 10);
            const tm = g.milliSeconds() / 1000.0;
            ttran.rotation = vector(tm * 5, tm * 10, 0);
            ttran.position = ttran.position.add(vector(Math.cos(tm) * 30, Math.sin(tm) * 30, 0));
            amod.transform.position = ttran.position;
            amod.rotate(10, 10, 0, '#self');
          }
          break;
        }
        case 'g':
          amod.rotate(0, 10, 0, '#self');
          break;
        default:
          amod.rotate(0, 0, 10, '#self');
      }
    }
    if (g.exitavailable && g.exitavailable.shaderList) {
      // Director rotates texture UVs about the uv origin — do exactly that on the
      // swirl quad's uv attribute (the vortex texel sits at uv 0,0 = quad center)
      const swirl = g.exitavailable.o.children.find(c => c.isMesh);
      if (swirl) {
        const uv = swirl.geometry.attributes.uv;
        if (uv) {
          if (!swirl.__uv0) swirl.__uv0 = uv.array.slice();
          // Rotate about the uv window's own lattice corner. Geometry v is flipped (1-v)
          // at build time, so the window sits around (0,1) — pivot there, where the
          // texture's vortex eye lives (measured ~0.03 off the corner).
          const CX = 0, CY = 1;
          const ang = -(g.milliSeconds() / 4) * DEG;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const u0 = swirl.__uv0;
          for (let i = 0; i < uv.count; i++) {
            const u = u0[i * 2] - CX, v = u0[i * 2 + 1] - CY;
            uv.setXY(i, CX + ca * u - sa * v, CY + sa * u + ca * v);
          }
          uv.needsUpdate = true;
        }
      }
      if (g.exitavailable.getWorldTransform().position.distanceTo(g.mc.getWorldTransform().position) < 45) {
        g.exitlevel();
        return;
      }
    }
    if (g.editing === 0) {
      for (let xxx = g.collectedletters.length; xxx >= 1; xxx--) {
        const entry = g.collectedletters[xxx - 1];
        const dtime = (g.milliSeconds() - entry[2]) / 1000.0;
        if (dtime < 1) {
          for (const zzz of entry[0].shaderList) zzz.blend = 100 - (dtime * 100);
          entry[0].transform = entry[0].transform.duplicate().interpolateTo(entry[1], 30);
          continue;
        }
        entry[0].transform.position = vector(-10000, -10000, -10000);
        for (const zzz of entry[0].shaderList) zzz.blend = 100;
        g.collectedletters.splice(xxx - 1, 1);
        g.makequickmask();
      }
    }
  }

  // ======================= game loop =======================
  keyPressed(k) { return this.input.keyPressed(k); }
  get shiftDown() { return this.input.shiftDown; }

  isplat(aList) {
    if (aList.length) return aList[0];
    return 0;
  }

  findpointnear(apt, excludept) {
    const g = this;
    let nearpt = 0, neardist = 10000;
    if (excludept === undefined) excludept = vector(-10000, -10000, -10000);
    // NOTE: the original's exclude comparison (vector <> float) is always true, so no exclusion happens
    for (let xxx = 1; xxx <= g.recordinglist.length; xxx++) {
      const p = g.recordinglist[xxx - 1];
      const pv = Array.isArray(p[0]) ? vector(...p[0]) : vector(...p);
      const td = pv.distanceTo(apt);
      if (td < neardist) {
        nearpt = pv; neardist = td;
      }
    }
    if (nearpt) return nearpt.duplicate();
    return 0;
  }

  loadrecording() {
    const g = this;
    g.recordinglist = g.value(g.member('track' + g.tracknum + 'points').text) || [];
  }

  GameLoop() {
    const g = this, w = g.w, mc = g.mc;
    let ttrans = mc.getWorldTransform().duplicate();
    let trot = ttrans.rotation.duplicate();
    let ttrans2 = transform();
    ttrans2.position = vector(0, -15, 0);
    ttrans2.rotate(trot);
    if (g.startyet && g.keyPressed(' ')) {
      if (g.amjumping === 0) {
        g.playsnd('snd8', 0);
        g.amjumping = 1;
        g.jumpinc = vector(0, 30, 12);
      } else if (g.shiftDown) {
        g.amjumping = 1;
        g.jumpinc.y = Math.max(4, g.jumpinc.y + 1);
        if (g.keyPressed(123)) { g.animateMC(2); mc.rotate(0, 6, 0, '#self'); }
        if (g.keyPressed(124)) { g.animateMC(2); mc.rotate(0, -6, 0, '#self'); }
      }
    }
    if (g.amjumping === 0) {
      if (g.keyPressed(126) && g.startyet) {
        g.animateMC(1);
        let moved = 0;
        if (g.editing === 0) {
          const nosept = g.lookbox.getWorldTransform().position;
          const mcpt = mc.getWorldTransform().position;
          const tpt2 = g.findpointnear(mcpt);
          const tpt = g.findpointnear(nosept, tpt2);
          if (tpt && (mcpt.sub(tpt).angleBetween(mcpt.sub(nosept)) < 35) && (mcpt.sub(nosept).length > 15)) {
            const oroto = mc.getWorldTransform().duplicate();
            mc.pointAt(tpt, g.lastnormal);
            mc.rotate(0, 180, 0, '#self');
            mc.translate(0, 0, 15 + (8 * (g.shiftDown ? 1 : 0)), '#self');
            const tttrans = mc.transform.duplicate();
            mc.transform.rotation = oroto.rotation.duplicate();
            const mcrot = mc.transform.rotation;
            const ttrot = tttrans.rotation.sub(mcrot);
            if (Math.abs(ttrot.x) < 180 && Math.abs(ttrot.y) < 180 && Math.abs(ttrot.z) < 180) {
              mc.transform = mc.transform.duplicate().interpolateTo(tttrans, 50);
            }
            trot = mc.getWorldTransform().rotation.duplicate();
            moved = 1;
          }
        }
        if (moved === 0) {
          const fordy = g.isplat(w.modelsUnderRay(g.lookbox.getWorldTransform().position, ttrans2.position, g.gOptionsList));
          if (fordy !== 0) {
            if (fordy.distance < 30) {
              if (g.shiftDown) mc.translate(0, 0, 1);
              else mc.translate(0, 0, 10);
              moved = 1;
            }
          }
          let lefty = g.isplat(w.modelsUnderRay(g.lookleftbox.getWorldTransform().position, ttrans2.position, g.gOptionsList));
          let righty = g.isplat(w.modelsUnderRay(g.lookrightbox.getWorldTransform().position, ttrans2.position, g.gOptionsList));
          if (typeof lefty === 'object') lefty = lefty.distance < 40 ? 1 : 0;
          if (typeof righty === 'object') righty = righty.distance < 40 ? 1 : 0;
          if (lefty === 0 || righty === 0) {
            if (lefty !== 0) {
              const slide = transform();
              slide.position = vector(-3, 0, 0);
              slide.rotate(trot);
              g.lastgoodtrans.position = g.lastgoodtrans.position.add(slide.position);
              mc.translate(-5, 0, 0, '#self');
              mc.rotate(0, -20, 0, '#self');
            } else if (righty !== 0) {
              const slide = transform();
              slide.position = vector(3, 0, 0);
              slide.rotate(trot);
              g.lastgoodtrans.position = g.lastgoodtrans.position.add(slide.position);
              mc.translate(5, 0, 0, '#self');
              mc.rotate(0, 20, 0, '#self');
            } else {
              let backy = g.isplat(w.modelsUnderRay(g.lookrightbox.getWorldTransform().position, ttrans2.position, g.gOptionsList));
              if (typeof backy === 'object') backy = backy.distance < 40 ? 1 : 0;
              if (backy) {
                const slide = transform();
                slide.position = vector(0, 0, -3);
                slide.rotate(trot);
                g.lastgoodtrans.position = g.lastgoodtrans.position.add(slide.position);
                mc.translate(0, 0, -3);
              }
            }
          }
        }
      }
      if (!g.keyPressed(125) || g.startyet === 0) {
        g.c2.transform.position = vector(0, 100, -100);
        g.c.fieldOfView = 75;
      } else {
        g.c2.transform.position = vector(0, 400, -400);
        g.c.fieldOfView = 75;
      }
      if (g.keyPressed(123) && g.startyet) { g.animateMC(2); mc.rotate(0, 6, 0, '#self'); }
      if (g.keyPressed(124) && g.startyet) { g.animateMC(2); mc.rotate(0, -6, 0, '#self'); }
    }
    let foundwall = 0, tmod = 0, frontmod = 0;
    if (g.amjumping === 0) {
      ttrans = mc.getWorldTransform().duplicate();
      ttrans2 = transform();
      ttrans2.position = vector(0, 0, 25);
      ttrans2.rotate(trot);
      frontmod = g.isplat(w.modelsUnderRay(g.tracker.getWorldTransform().position, ttrans2.position, g.gOptionsList));
      tmod = g.isplat(w.modelsUnderRay(mc.getWorldTransform().position, ttrans2.position, g.gOptionsList));
      if (frontmod !== 0) {
        if (frontmod.distance < 40) foundwall = 1;
      }
    }
    ttrans = mc.getWorldTransform().duplicate();
    ttrans2 = transform();
    ttrans2.position = vector(0, -15, 0);
    ttrans2.rotate(trot);
    if (!foundwall) {
      tmod = g.isplat(w.modelsUnderRay(mc.getWorldTransform().position, ttrans2.position, g.gOptionsList));
      frontmod = g.isplat(w.modelsUnderRay(g.tracker.getWorldTransform().position, ttrans2.position, g.gOptionsList));
      if (typeof tmod === 'object' && typeof frontmod === 'object') {
        if (tmod.isectNormal.angleBetween(frontmod.isectNormal) > 45) frontmod = 0;
      }
    }
    let jumpoverchecking = 0;
    if (g.amjumping > 0 && tmod !== 0 && frontmod !== 0) {
      if (g.jumpinc.y < 0) {
        if (tmod.distance < Math.abs(g.jumpinc.y + 50)) jumpoverchecking = 1;
        if (frontmod.distance < Math.abs(g.jumpinc.y + 50)) jumpoverchecking = 1;
      }
    } else jumpoverchecking = 1;
    if (tmod !== 0 && frontmod !== 0 && jumpoverchecking) {
      g.amjumping = 0;
      const newtrans = transform();
      newtrans.rotation = trot;
      const ptp = tmod.isectPosition;
      newtrans.position = ptp.add(tmod.isectNormal.mul(7)).add(frontmod.isectNormal.mul(8));
      mc.transform = newtrans;
      const tvect = tmod.isectPosition.sub(frontmod.isectPosition);
      g.lastnormal = tmod.isectNormal.mul(7).add(frontmod.isectNormal.mul(8)).mul(1 / 15);
      mc.pointAt(mc.transform.position.add(tvect), g.lastnormal);
      g.lastgoodtrans = mc.getWorldTransform().duplicate();
    } else {
      if (g.amjumping) {
        g.amjumping++;
        g.jumpinc = g.jumpinc.add(vector(0, -2.5, 0));
        if (g.amjumping > 20) g.jumpinc.z = g.jumpinc.z * 0.9;
        if (g.jumpinc.y < -20) g.jumpinc.y = -20;
        mc.translate(g.jumpinc, '#self');
        if (g.amjumping > 75) {
          g.addscore(-100);
          g.deathcount++;
          g.playsnd('death');
          if (g.deathcount === 3) this.goto('gameover');
          else this.goto('restartlevel');
          return;
        }
      } else {
        const newang = mc.getWorldTransform().rotation.duplicate();
        mc.transform = g.lastgoodtrans.duplicate();
        mc.transform.rotation = newang;
      }
    }
    g.smoothcamera();
  }

  smoothcamera() {
    const g = this, c = g.c;
    if (g.cameramoving) {
      c.fieldOfView = 35;
      const dtime = (g.milliSeconds() - g.cameratiming) / 8000.0;
      switch (g.cameramoving) {
        case 1: {
          const trad = 3000;
          const pos = vector(Math.sin(dtime * 2 * Math.PI) * trad, 700 + (Math.cos(dtime * 2 * Math.PI) * trad), 0);
          c.transform.position = pos;
          c.pointAt(vector(0, 0, 0), vector(0, 0, 1));
          c.rotate(0, 0, -90);
          if (dtime > 0.25) {
            g.cameramoving = 2;
            g.cameratiming += 8000;
          }
          c.fog.near = c.fog.near + 100;
          c.fog.far = c.fog.far + 200;
          break;
        }
        case 2: {
          c.fog.enabled = 0;
          const trad = 3000;
          const pos = vector(Math.sin(dtime * 2 * Math.PI) * trad, 700, Math.cos(dtime * 2 * Math.PI) * trad);
          c.transform.position = pos;
          c.pointAt(vector(0, 0, 0), vector(0, 1, 0));
          break;
        }
        case 3: {
          c.fieldOfView = 75;
          c.transform = c.transform.duplicate().interpolateTo(g.CameraTargetTrans, 8000.0 / Math.max(1000, g.cameratiming - g.milliSeconds()));
          if (g.milliSeconds() > g.cameratiming) g.cameramoving = 0;
          break;
        }
      }
      if (this.input.mouseDown || this.input.clickPulse) {
        c.removeOverlay(1);
        g.cameramoving = 0;
      }
    } else {
      c.fog.enabled = 0;
      c.transform = c.transform.duplicate().interpolateTo(g.c2.getWorldTransform(), 20);
      if (c.getWorldTransform().position.distanceTo(g.c2.getWorldTransform().position) < 2) {
        c.transform.position = g.c2.getWorldTransform().position;
        g.createLogoModels();
        g.makequickmask();
        g.startyet = 1;
      }
    }
    if (g.mrseasick) {
      const ttran = g.skybox.getWorldTransform().duplicate();
      g.skybox.transform = g.skybox.transform.duplicate().interpolateTo(c.getWorldTransform(), 3);
      g.skybox.transform.position = ttran.position;
    }
  }

  // ======================= level exit =======================
  exitlevel() {
    // original: blocking loop shrinking FOV; we run it as an async state
    const g = this;
    g.levelscore = g.gamescore;
    g.happywordreset = g.happyword;
    this.goto('levelexit');
  }

  // ======================= HUD: numbers, logos =======================
  initnumbers() {
    const g = this, w = g.w, c = g.c;
    g.texturenums = [];
    for (let xxx = 0; xxx <= 9; xxx++) {
      const ntx = w.newTexture('number' + xxx, '#fromCastMember', g.member('num' + xxx));
      g.texturenums.push(ntx);
    }
    g.scorebox = [];
    const nmr = w.newModelResource('scorebox', '#plane', '#front');
    nmr.length = 6; nmr.width = 6;
    for (let xxx = 6; xxx >= 1; xxx--) {
      const nm = w.newModel('scorenum' + xxx, nmr);
      const nsh = w.newShader('scorenum' + xxx);
      nsh.texture = g.texturenums[0];
      nsh.emissive = rgb(255, 255, 255);
      nsh.blend = 0;
      nm.shaderList = nsh;
      g.scorebox.push(nsh);
      nm.transform.position = vector(23 + (5 * xxx), 42, 188);
      c.addChild(nm);
      nm.pointAt(c.getWorldTransform().position, vector(0, 1, 0));
      hudTopmost(nm);
    }
    let nm = w.newModel('levelTitle', nmr);
    let nsh = w.newShader('levelTitleSh');
    let ntx = w.newTexture('LevelTitle', '#fromCastMember', g.member('LevelTitle'));
    nsh.texture = ntx;
    nsh.emissive = rgb(255, 255, 255);
    nsh.blend = 100;
    nm.shaderList = nsh;
    nm.transform.position = vector(-48, 42, 188);
    nm.transform.scale = vector(3.5, 2, 2);
    nm.rotate(180, 0, 180, '#self');
    c.addChild(nm);
    hudTopmost(nm);
    nm = w.newModel('levelnum', nmr);
    nsh = w.newShader('levelnum');
    nsh.texture = g.texturenums[g.tracknum];
    nsh.emissive = rgb(255, 255, 255);
    nsh.blend = 100;
    nm.shaderList = nsh;
    nm.transform.position = vector(-35, 42, 188);
    nm.transform.scale = vector(1.8, 1.8, 1.8);
    c.addChild(nm);
    nm.rotate(180, 0, 180, '#self');
    hudTopmost(nm);
  }

  setscore() {
    const g = this, w = g.w;
    if (!g.scorebox) return;
    if (g.gamescore !== g.shownscore) {
      g.shownscore = g.gamescore;
      let chnum = 1;
      let tval = g.shownscore;
      while (tval > 0) {
        const tshval = tval % 10;
        g.scorebox[chnum - 1].blend = 100;
        g.scorebox[chnum - 1].texture = g.texturenums[tshval];
        tval = Math.floor(tval / 10);
        chnum++;
      }
      while (chnum < 7) {
        g.scorebox[chnum - 1].blend = 0;
        chnum++;
      }
      g.lastscorechange = g.milliSeconds() + 500;
      for (let xxx = 1; xxx <= 6; xxx++) {
        const m = w.model('scorenum' + xxx);
        if (m) m.transform.scale = vector(0.1, 0.1, 0.1);
      }
    } else if (g.lastscorechange !== 0) {
      if (g.milliSeconds() > g.lastscorechange) {
        g.lastscorechange = 0;
        for (let xxx = 1; xxx <= 6; xxx++) {
          const m = w.model('scorenum' + xxx);
          if (m) m.transform.scale = vector(1, 1, 1);
        }
      } else {
        for (let xxx = 1; xxx <= 6; xxx++) {
          const m = w.model('scorenum' + xxx);
          if (m) { const s = m.transform.scale; m.transform.scale = vector(s.x * 1.3, s.y * 1.3, s.z * 1.3); }
        }
      }
    }
  }

  createLogoModels() {
    const g = this, w = g.w, c = g.c;
    if (g.logosinited) return;
    g.logosinited = 1;
    const trans = g.value(g.member('logotrans').text);
    for (let xxx = 1; xxx <= 19; xxx++) {
      const tm = g.member('logo' + xxx);
      let nmr = w.modelResource('logo' + xxx);
      if (!nmr) nmr = w.newModelResource('logo' + xxx, '#plane', '#both');
      nmr.width = tm.rect.width / 6.0;
      nmr.length = tm.rect.height / 6.0;
      let nm = w.model('logo' + xxx);
      if (!nm) {
        nm = w.newModel('logo' + xxx, nmr);
        const ntx = w.newTexture('logo' + xxx, '#fromCastMember', tm);
        const nsh = w.newShader('logo' + xxx);
        nsh.texture = ntx;
        nsh.emissive = rgb(255, 255, 255);
        nsh.diffuse = rgb(255, 255, 255);
        nsh.ambient = rgb(255, 255, 255);
        nm.shader = nsh;
      }
      nm.shader.blend = 30;
      c.addChild(nm, '#preserveWorld');
      hudTopmost(nm);
      const nt = transform();
      nt.position = vector(...trans[xxx - 1][0]).add(vector(5, 30, -40));
      nt.rotation = vector(...trans[xxx - 1][1]);
      nt.scale = vector(...trans[xxx - 1][2]);
      nm.transform = nt;
    }
    g.addscore(0);
  }

  makequickmask() {
    const g = this, w = g.w;
    g.createLogoModels();
    if (g.gothat) w.model('logo1').shader.blend = 100;
    let eone = 0;
    g.happyword = String(g.happyword);
    const letteron = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let xxx = 1; xxx <= g.happyword.length; xxx++) {
      const tchar = g.happyword[xxx - 1];
      let toff = 'sweetaryd'.indexOf(tchar) + 1;
      if (toff > 0) {
        if (tchar === 'e') {
          if (eone) toff = 4;
          else { toff = 3; eone = 1; }
        }
        letteron[toff - 1] = 1;
      }
    }
    for (let xxx = 1; xxx <= 9; xxx++) {
      if (letteron[xxx - 1]) {
        w.model('logo' + (xxx * 2)).shader.blend = 100;
        w.model('logo' + ((xxx * 2) + 1)).shader.blend = 100;
      } else {
        w.model('logo' + (xxx * 2)).shader.blend = 30;
        w.model('logo' + ((xxx * 2) + 1)).shader.blend = 30;
      }
    }
  }

  // ======================= menus =======================
  initMenu() {
    const g = this, w = g.w;
    g.menumode = 0;
    w.resetWorld();
    g.c = w.camera[1];
    const c = g.c;
    c.fieldOfView = 40;
    c.transform.position = vector(0, 0, -400);
    w.light[1].color = rgb(0, 0, 0);
    w.light[2].color = rgb(0, 0, 0);
    w.light[2].transform.position = vector(0, 200, -200);
    let nmr = w.newModelResource('background', '#plane', '#front');
    nmr.width = 512; nmr.length = 512;
    const nimg = g.member('basictext2').image.duplicate();
    const timg = g.member('clicktoplay').image;
    nimg.copyPixels(timg, rect(161 - 44, 398, 161 - 44 + timg.width, 398 + timg.height), timg.rect);
    g.playedGameonce = 1;
    let nm = w.newModel('background', nmr);
    let ntx = w.newTexture('background', '#fromImageObject', nimg);
    let nsh = w.newShader('background');
    nsh.texture = ntx;
    nsh.emissive = rgb(0, 0, 0);
    nsh.diffuse = rgb(0, 0, 0);
    nm.shader = nsh;
    nm.transform.position = vector(0, 0, 110);
    nm.pointAt(V3.from(c.transform.position));
    c.pointAt(V3.from(nm.transform.position));
    g.menubackground = nm;
    nm.translate(0, 0, 75, '#world');
    ntx = w.newTexture('instructbutton', '#fromCastMember', g.member('instructbutton'));
    nmr = w.newModelResource('instructbutton', '#plane', '#front');
    nmr.width = 128; nmr.length = 32;
    nm = w.newModel('instructbutton', nmr);
    nsh = w.newShader('instructbutton');
    nsh.texture = ntx;
    nsh.emissive = rgb(0, 0, 0);
    nsh.diffuse = rgb(0, 0, 0);
    nm.shader = nsh;
    nm.transform.position = vector(0, -140, 0);
    g.instbutton = nm;
    g.makeRoll();
    g.gtimer = 0;
  }

  initwinmenu() {
    const g = this, w = g.w;
    g.menumode = 0;
    w.resetWorld();
    g.c = w.camera[1];
    const c = g.c;
    c.fieldOfView = 40;
    c.transform.position = vector(0, 0, -400);
    w.light[1].color = rgb(0, 0, 0);
    w.light[2].color = rgb(0, 0, 0);
    w.light[2].transform.position = vector(0, 200, -200);
    const nmr = w.newModelResource('background', '#plane', '#front');
    nmr.width = 512; nmr.length = 512;
    const nimg = g.member('gameoverscreen').image.duplicate();
    g.playedGameonce = 1;
    const nm = w.newModel('background', nmr);
    const ntx = w.newTexture('background', '#fromImageObject', nimg);
    const nsh = w.newShader('background');
    nsh.texture = ntx;
    nsh.emissive = rgb(0, 0, 0);
    nsh.diffuse = rgb(0, 0, 0);
    nm.shader = nsh;
    nm.transform.position = vector(0, 0, 110);
    nm.pointAt(V3.from(c.transform.position));
    c.pointAt(V3.from(nm.transform.position));
    g.menubackground = nm;
    nm.translate(0, 0, 75, '#world');
    g.initnumbers();
    g.shownscore = -100;
    g.setscore();
    const scorelen = String(g.gamescore).length;
    const leftset = 2.5 + (5 * scorelen / 2.0);
    for (let xxx = 1; xxx <= scorelen; xxx++) {
      const nm2 = this.w.model('scorenum' + xxx);
      nm2.parent = undefined;
      nm2.addToWorld();
      nm2.shader.blend = 100;
      nm2.shader.texture = g.texturenums[parseInt(String(g.gamescore)[xxx - 1])];
      nm2.transform.position = vector(leftset - (5 * xxx), -6, -291);
      nm2.pointAt(c.getWorldTransform().position, vector(0, 1, 0));
    }
    g.instbutton = nm;
    g.makeRoll();
    g.gtimer = 0;
  }

  makeRoll() {
    const g = this, w = g.w;
    const nmr = w.newModelResource('TartsRoll', '#cylinder', '#front');
    nmr.height = 200;
    nmr.topRadius = 11; nmr.bottomRadius = 11;
    const ntx = w.newTexture('sweetartspackage', '#fromCastMember', g.member('sweetartspackage'));
    const nsh = w.newShader('sweetartspackage');
    nsh.emissive = rgb(255, 255, 255);
    nsh.texture = ntx;
    const nm = w.newModel('sweetartspackage', nmr);
    const ntx2 = w.newTexture('wrapper', '#fromCastMember', g.member('wrapper'));
    const nsh2 = w.newShader('wrapper');
    nsh2.emissive = rgb(255, 255, 255);
    nsh2.texture = ntx2;
    nm.shaderList = [nsh, nsh2, nsh2];
    g.sampleroll = nm;
    nm.translate(0, -65, 0);
    nm.rotate(0, 0, 90, '#self');
    g.sampleroll.scale(0.05, 0.05, 0.05);
  }

  menuupkeep() {
    const g = this;
    switch (g.menumode) {
      case 0: {
        g.gtimer += 5;
        g.w.light[1].color = rgb(g.gtimer, g.gtimer, g.gtimer);
        g.w.light[2].color = rgb(g.gtimer, g.gtimer, g.gtimer);
        g.sampleroll.transform.scale = vector(g.gtimer / 255, g.gtimer / 255, g.gtimer / 255);
        if (g.gtimer >= 255) { g.gtimer = 0; g.menumode = 1; }
        break;
      }
      case 1: {
        g.gtimer += 5;
        g.menubackground.shader.emissive = rgb(g.gtimer, g.gtimer, g.gtimer);
        if (g.gtimer > 255) g.menumode = 2;
        break;
      }
    }
    // instructions button rollover
    const over = this.input.overInstructions;
    if (over) {
      g.instbutton.transform.scale = vector(0.9, 0.9, 0.9);
      if (this.input.mouseDown) {
        this.goto('instructions');
        return;
      }
    } else {
      g.instbutton.transform.scale = vector(1, 1, 1);
    }
    g.sampleroll.rotate(5, 0, 0, '#self');
  }
}
