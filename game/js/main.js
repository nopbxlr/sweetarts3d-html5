// Movie frame-flow: menu → restartlevel → gameplay → gameover/winner + instructions pages.
import * as THREE from 'three';
import { World } from './world.js';
import { Members, SoundSystem, DirImage } from './members.js';
import { Game } from './game.js';
import { vector, rgb, V3 } from './dirshim.js';

const STAGE_W = 600, STAGE_H = 500;

// ---------------- asset loading ----------------
async function loadAssets() {
  const manifest = await (await fetch('assets/manifest.json')).json();
  const assets = { textures: {}, meta: manifest.meta, models: {}, modelTextures: {}, sounds: {}, trackdata: manifest.trackdata };
  const jobs = [];
  for (const name of manifest.textures) {
    jobs.push(new Promise((res) => {
      const img = new Image();
      img.onload = () => { assets.textures[name] = img; res(); };
      img.onerror = () => { console.warn('tex fail', name); res(); };
      img.src = 'assets/textures/' + name + '.png';
    }));
  }
  for (const name of manifest.models) {
    jobs.push(fetch('assets/models3d/' + name + '.json').then(r => r.ok ? r.json() : null).then(j => { if (j) assets.models[name] = j; }).catch(() => {}));
  }
  for (const t of manifest.modelTextures || []) {
    jobs.push(new Promise((res) => {
      const img = new Image();
      img.onload = () => { assets.modelTextures[t] = img; res(); };
      img.onerror = () => res();
      img.src = 'assets/models3d/tex/' + t;
    }));
  }
  await Promise.all(jobs);
  // sounds decoded lazily on first user gesture (autoplay policy): fetch now, decode later
  assets._soundData = {};
  await Promise.all(manifest.sounds.map(async (name) => {
    try { assets._soundData[name] = await (await fetch('assets/sounds/' + name + '.wav')).arrayBuffer(); } catch (e) {}
  }));
  return assets;
}

// ---------------- input ----------------
class Input {
  constructor(el) {
    this.keys = new Set();
    this.shiftDown = false;
    this.mouseDown = false;
    this.mouseLoc = { x: 0, y: 0 };
    this.overInstructions = false;
    this.keyUpQueue = [];
    this.clickQueue = [];
    const codeMap = { ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126, Space: ' ' };
    window.addEventListener('keydown', (e) => {
      this.shiftDown = e.shiftKey;
      const c = codeMap[e.code] ?? e.key;
      this.keys.add(c);
      if (Object.keys(codeMap).includes(e.code) || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.shiftDown = e.shiftKey;
      const c = codeMap[e.code] ?? e.key;
      this.keys.delete(c);
      this.keyUpQueue.push(e.key.length === 1 ? e.key : (e.code === 'Space' ? ' ' : e.key));
    });
    el.addEventListener('mousedown', () => { this.mouseDown = true; });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    const toStage = (e) => {
      const r = el.getBoundingClientRect();
      const sc = window.__stageScale || 1;
      return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc };
    };
    el.addEventListener('mousemove', (e) => { this.mouseLoc = toStage(e); });
    el.addEventListener('click', (e) => { this.clickQueue.push(toStage(e)); });
  }
  keyPressed(k) { return this.keys.has(k); }
}

// ---------------- movie ----------------
class Movie {
  constructor(assets) {
    this.assets = assets;
    const canvas = document.getElementById('stage');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setSize(STAGE_W, STAGE_H, false);
    this.renderer.setPixelRatio(1);
    this.overlayDiv = document.getElementById('overlay');
    this.uiDiv = document.getElementById('ui');
    this.w = new World(assets, this.renderer, this.overlayDiv);
    this.members = new Members(assets);
    this.sounds = new SoundSystem({ sounds: {} });
    this.input = new Input(document.getElementById('stagewrap'));
    this.state = 'boot';
    this.game = new Game({
      w: this.w, members: this.members, sounds: this.sounds, input: this.input,
      stage: { w: STAGE_W, h: STAGE_H }, goto: (l) => this.goto(l), assets
    });
    this.soundsReady = false;
    this.frameAccum = 0;
    this.lastT = performance.now();
    this.instpage = 1;
    // browsers unlock audio on the first real user gesture — decode everything then
    const unlock = () => {
      this.ensureSounds().then(() => {
        this.musicWanted = false;
        this.playMusic();
      });
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  }

  async ensureSounds() {
    if (this.soundsReady) return;
    this.soundsReady = true;
    this.sounds.ensure();
    const decoded = {};
    for (const [name, buf] of Object.entries(this.assets._soundData)) {
      try { decoded[name] = await this.sounds.ctx.decodeAudioData(buf.slice(0)); } catch (e) {}
    }
    this.sounds.assets = { sounds: decoded };
  }

  goto(label) {
    this.pendingState = label;
  }

  applyState(label) {
    const g = this.game;
    this.uiDiv.innerHTML = '';
    this.overlayDiv.innerHTML = '';
    this.w.overlays = [];
    switch (label) {
      case 'menu': {
        g.editing = 0;
        g.tracknum = 1;
        g.trackname = 'track1';
        g.initgame();
        g.initMenu();
        // menu music (score sound channel)
        this.playMusic();
        break;
      }
      case 'restartlevel': {
        this.playMusic();
        g.MCnum = [1, 2, 3, 4, 5, 6][g.tracknum - 1];
        g.initworld();
        break;
      }
      case 'levelexit': {
        this.exitAnim = { xxx: 75, slewinc: 0.5 };
        g.c.fog.enabled = 1;
        break;
      }
      case 'gameover': {
        // black stage + GAME OVER overlay, then click → menu
        this.w.resetWorld();
        this.w.scene.background = new THREE.Color(0, 0, 0);
        const btx = this.w.newTexture('btext', '#fromCastMember', this.members.member('GameOvertext'));
        const cam = this.w.camera[1];
        cam.addOverlay(btx, { x: STAGE_W / 2 - 128, y: STAGE_H / 2 - 128 }, 0);
        this.gameoverTime = performance.now();
        break;
      }
      case 'winner': {
        g.initwinmenu();
        this.playMusic();
        g.playsnd('Short_Applause');
        break;
      }
      case 'instructions': case 'inst1': case 'inst2': case 'inst3': {
        this.showInstructions(label);
        this.playMusic();
        break;
      }
    }
    this.state = label;
  }

  playMusic() {
    if (!this.soundsReady || !this.sounds.assets.sounds || !this.sounds.assets.sounds.music) { this.musicWanted = true; return; }
    if (this._musicPlaying) return;
    this._musicPlaying = true;
    this.sounds.channel(1).play({ member: 'music', loop: true });
  }
  stopMusic() { this._musicPlaying = false; this.musicWanted = false; this.sounds.channel(1).stop(); }

  showInstructions(label) {
    const pageNum = label === 'instructions' ? 1 : parseInt(label.slice(4));
    this.instpage = pageNum;
    const bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;left:0;top:0;width:600px;height:500px;background:#fff;';
    this.uiDiv.appendChild(bg);
    const img = document.createElement('img');
    img.src = 'assets/textures/instpage' + pageNum + '.png';
    img.style.left = '0px'; img.style.top = '0px';
    img.style.width = STAGE_W + 'px'; img.style.height = STAGE_H + 'px';
    this.uiDiv.appendChild(img);
    const mk = (src, x, y, cb) => {
      const b = document.createElement('img');
      b.src = 'assets/textures/' + src + '.png';
      b.style.left = x + 'px'; b.style.top = y + 'px';
      b.className = 'clickable';
      b.style.pointerEvents = 'auto';
      b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
      this.uiDiv.appendChild(b);
    };
    // prev / next / back (positions from member reg points anchored at stage center)
    if (pageNum > 1) mk('member227', 300 - 273, 250 - 19, () => this.goto('inst' + (this.instpage - 1)));
    if (pageNum < 3) mk('member229', 300 + 230 - 44 + 44, 250 - 20, () => this.goto(pageNum === 1 ? 'inst2' : 'inst3'));
    mk('member228', 300 - 43, 460, () => this.goto('menu'));
  }

  // per-frame tick at 30fps
  tick() {
    const g = this.game;
    const inp = this.input;
    if (this.pendingState) {
      const s = this.pendingState;
      this.pendingState = null;
      this.applyState(s);
    }
    // consume clicks / keyups
    const clicks = inp.clickQueue.splice(0);
    inp.clickPulse = clicks.length > 0;
    const keyups = inp.keyUpQueue.splice(0);

    switch (this.state) {
      case 'menu': {
        // hit-test 3D instructions button by projecting its quad
        inp.overInstructions = this.projectContains(g.instbutton, inp.mouseLoc, 128, 32);
        document.getElementById('stagewrap').style.cursor = inp.overInstructions ? 'pointer' : 'default';
        g.menuupkeep();
        if (this.pendingState) break; // menuupkeep may goto instructions
        // BehaviorScript 41 keyUp: digit selects start track, other keys reset to 1
        for (const k of keyups) {
          if (k === 'e') continue; // editing toggle in the original authoring build
          const gk = parseInt(k);
          g.tracknum = gk > 0 ? Math.min(gk, 6) : 1;
          g.trackname = 'track' + g.tracknum;
        }
        for (const clk of clicks) {
          if (this.projectContains(g.instbutton, clk, 128, 32)) {
            this.goto('instructions');
            break;
          }
          // BehaviorScript 41/27 mouseUp: "the keyPressed" at click time picks the track (the winner-screen secret)
          for (const held of ['1', '2', '3', '4', '5', '6']) {
            if (inp.keyPressed(held)) { g.tracknum = parseInt(held); }
          }
          g.initgame();
          if (!(g.tracknum >= 1 && g.tracknum <= 6)) g.tracknum = 1;
          g.trackname = 'track' + g.tracknum;
          this.goto('restartlevel');
          break;
        }
        this.w.render(g.c);
        break;
      }
      case 'restartlevel': {
        // BehaviorScript 42 frame loop
        g.GameLoop();
        if (this.pendingState) break;
        g.animatecandies();
        if (this.pendingState) break;
        if (!g.editing) g.collectobjects();
        g.updatesparkles();
        g.cycleupdate();
        g.setscore();
        // keyUp during intro camera: cancel intro
        if (keyups.length && g.cameramoving && g.cameramoving !== 3) {
          g.c.removeOverlay(1);
          g.cameramoving = 0;
          g.c.fog.enabled = 0;
          if (keyups.includes(' ')) {
            g.amjumping = 1;
            g.jumpinc = vector(0, 15, 0);
          }
        }
        this.w.tickParticles(33.3);
        this.w.render(g.c);
        break;
      }
      case 'levelexit': {
        const a = this.exitAnim;
        // original pacing: one step per ~50ms busy-wait
        a.skip = !a.skip;
        if (a.skip) break;
        if (a.xxx > 15) {
          g.c.fieldOfView = a.xxx;
          g.c.fog.near = g.c.fog.near - (a.slewinc * 20);
          g.c.fog.far = g.c.fog.far - (a.slewinc * 20);
          g.c.translate(0, 0, a.slewinc * 45, '#self');
          a.xxx -= a.slewinc;
          a.slewinc += 0.15;
          this.w.render(g.c);
        } else {
          g.tracknum = Math.min(g.tracknum + 1, 7);
          g.trackname = 'track' + g.tracknum;
          if (g.tracknum === 7) {
            g.tracknum = 6;
            this.goto('winner');
          } else {
            this.goto('restartlevel');
          }
        }
        break;
      }
      case 'gameover': {
        if (clicks.length && performance.now() - this.gameoverTime > 800) this.goto('menu');
        this.renderer.clear();
        this.w.render(this.w.camera[1]);
        break;
      }
      case 'winner': {
        g.menuupkeep();
        g.setscore();
        if (!this.pendingState && clicks.length) this.goto('menu');
        this.w.render(g.c);
        break;
      }
      case 'instructions': case 'inst1': case 'inst2': case 'inst3':
        break;
    }
  }

  projectContains(node, loc, w, h) {
    if (!node) return false;
    // project the plane's corners to screen space
    const cam = this.game.c.three;
    cam.updateMatrixWorld(true);
    node.o.updateWorldMatrix(true, false);
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [cx, cy] of corners) {
      const p = new THREE.Vector3(cx, cy, 0).applyMatrix4(node.o.matrixWorld).project(cam);
      const sx = (p.x + 1) / 2 * STAGE_W, sy = (1 - p.y) / 2 * STAGE_H;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    return loc.x >= minX && loc.x <= maxX && loc.y >= minY && loc.y <= maxY;
  }

  start() {
    this.applyState('menu');
    const loop = (t) => {
      requestAnimationFrame(loop);
      const dt = t - this.lastT;
      this.lastT = t;
      this.frameAccum += dt;
      // Director tempo: 30fps
      if (this.frameAccum >= 33.3) {
        this.frameAccum = Math.min(this.frameAccum - 33.3, 100);
        try { this.tick(); } catch (e) { console.error(e); }
      }
    };
    requestAnimationFrame(loop);
  }
}

// ---------------- display size ----------------
function setupScale(movie) {
  const wrap = document.getElementById('stagewrap');
  const canvas = document.getElementById('stage');
  const layers = [document.getElementById('overlay'), document.getElementById('ui')];
  let mode = localStorage.getItem('st3d-scale') || 'fit';
  const apply = () => {
    let s;
    if (mode === 'fit') s = Math.min((window.innerWidth - 24) / STAGE_W, (window.innerHeight - 60) / STAGE_H);
    else s = parseFloat(mode);
    if (!(s > 0)) s = 1;
    s = Math.min(s, 3);
    window.__stageScale = s;
    wrap.style.width = (STAGE_W * s) + 'px';
    wrap.style.height = (STAGE_H * s) + 'px';
    canvas.style.width = (STAGE_W * s) + 'px';
    canvas.style.height = (STAGE_H * s) + 'px';
    movie.renderer.setSize(Math.round(STAGE_W * s), Math.round(STAGE_H * s), false);
    for (const l of layers) {
      l.style.transform = 'scale(' + s + ')';
      l.style.transformOrigin = '0 0';
    }
    const ld2 = document.getElementById('loading');
    if (ld2) { ld2.style.transform = 'scale(' + s + ')'; ld2.style.transformOrigin = '0 0'; }
  };
  window.addEventListener('resize', () => { if (mode === 'fit') apply(); });
  // control bar
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:8px;right:12px;z-index:50;color:#5a6a6e;font:11px Verdana,sans-serif;letter-spacing:0.05em;user-select:none;';
  bar.appendChild(document.createTextNode('SIZE '));
  const opts = [['1x', '1'], ['1.5x', '1.5'], ['2x', '2'], ['FIT', 'fit']];
  const btns = [];
  for (const [label, val] of opts) {
    const a = document.createElement('span');
    a.textContent = label;
    a.style.cssText = 'cursor:pointer;margin-left:8px;padding:2px 5px;border-radius:3px;';
    a.addEventListener('click', () => {
      mode = val;
      localStorage.setItem('st3d-scale', val);
      apply(); paint();
    });
    bar.appendChild(a);
    btns.push([a, val]);
  }
  const paint = () => {
    for (const [a, val] of btns) {
      a.style.background = (val === mode) ? '#3ec6dc' : 'transparent';
      a.style.color = (val === mode) ? '#000' : '#5a6a6e';
    }
  };
  document.body.appendChild(bar);
  apply(); paint();
}

// ---------------- touch controls ----------------
function setupTouch(movie) {
  if (!('ontouchstart' in window)) return;
  const inp = movie.input;
  const mk = (label, keys, css) => {
    const b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'position:fixed;z-index:60;width:64px;height:64px;border-radius:50%;' +
      'background:rgba(62,198,220,0.25);border:2px solid rgba(62,198,220,0.6);color:#eafcff;' +
      'display:flex;align-items:center;justify-content:center;font:bold 22px Verdana;' +
      'user-select:none;-webkit-user-select:none;touch-action:none;' + css;
    const down = (e) => { e.preventDefault(); for (const k of keys) inp.keys.add(k); b.style.background = 'rgba(62,198,220,0.55)'; };
    const up = (e) => {
      e.preventDefault();
      for (const k of keys) { inp.keys.delete(k); inp.keyUpQueue.push(k); }
      b.style.background = 'rgba(62,198,220,0.25)';
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    document.body.appendChild(b);
  };
  mk('\u25c0', [123], 'left:14px;bottom:52px;');
  mk('\u25b6', [124], 'left:96px;bottom:52px;');
  mk('GO', [126], 'right:96px;bottom:52px;font-size:16px;');
  mk('\u2191', [' '], 'right:14px;bottom:118px;');
  mk('\u25bc', [125], 'right:14px;bottom:8px;width:52px;height:38px;border-radius:10px;font-size:14px;');
}

loadAssets().then((assets) => {
  const ld = document.getElementById('loading');
  if (ld) ld.remove();
  const movie = new Movie(assets);
  window.movie = movie;
  setupScale(movie);
  setupTouch(movie);
  movie.start();
});
