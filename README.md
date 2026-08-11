# SweeTarts 3D — HTML5 port

A faithful HTML5/WebGL port of **Wonka SweeTarts 3D Game** (Left Brain Games, 2004), the
Macromedia Shockwave 3D game originally distributed as `SweeTarts3DGame.dcr` and playable
on sites like Candystand.

Every asset comes from the original game file: the compressed W3D (Intel IFX v2) 3D models
were reverse-engineered and decode **bit-exact** (the encoder grammar was recovered by
disassembling the 2001 Macromedia 3ds Max Shockwave-3D exporter), and the complete Lingo
game logic was decompiled and ported line-for-line to JavaScript on top of a small
Director-semantics compatibility layer over Three.js.

## Play

- **`dist/SweeTarts3D.html`** — fully self-contained single file (textures, models, sounds,
  music inlined). Double-click, works offline.
- **`docs/index.html`** — same file, served via GitHub Pages.

Controls: **arrows** move (up = go, left/right = steer), **space** jump
(shift+space = hover-steer), **down** pull the camera back. Click for sound.
Menu secret: hold **1–6** while clicking Play to pick a starting level.

## Structure

- `game/` — the port source: `js/dirshim.js` (Director/Lingo semantics on Three.js:
  transforms, pointAt, shaders as texture×(emissive+lit diffuse)), `js/world.js`
  (Shockwave 3D world: primitives, raycasts with Director's direction-length maxDistance,
  particles), `js/members.js` (cast members, W3D model instantiation, bone skinning),
  `js/game.js` (the ported Lingo movie scripts), `js/main.js` (frame flow / score
  emulation), `assets/` (extracted game assets).
- `tools/` — the extraction/porting pipeline: Director chunk extraction (`extract.js`,
  `inventory.js`, `lingo2json.js`), the **W3D decoder** (`w3d/` — bitstream codec,
  progressive-mesh decoder, format documentation in `w3d/NOTES.md`), Playwright test
  harness (`shot.js`, `viewshot.js`), and the single-file bundler (`bundle.js`).
- `dist/`, `docs/` — built single-file game.

## Building

```
npm install                      # three, esbuild, playwright, jpeg-js, pngjs
node tools/build-manifest.js     # sync game/assets from extracted assets
node tools/bundle.js             # emit dist/SweeTarts3D.html
```

Decoding the game data from scratch requires the original `SweeTarts3DGame.dcr`
(not included) plus ProjectorRays; see `tools/` and `tools/w3d/NOTES.md`.

## Legal

Personal preservation project. SweeTarts and Wonka are trademarks of their respective
owners; original game © 2004 its publishers. Original game content is included here solely
to keep a defunct, otherwise-unplayable game playable; this repository is private and
non-commercial.
