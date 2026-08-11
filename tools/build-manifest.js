// Assemble game/assets from extracted assets + manifest.json
const fs = require('fs');
const path = require('path');
const S = path.resolve(__dirname, '..');
const A = path.join(S, 'assets');
const G = path.join(S, 'game', 'assets');
fs.mkdirSync(G, { recursive: true });
for (const d of ['textures', 'sounds', 'models3d', 'models3d/tex']) fs.mkdirSync(path.join(G, d), { recursive: true });

const report = JSON.parse(fs.readFileSync(path.join(A, 'report.json')));
const meta = {};
for (const r of report) if (r.kind === 'bitmap' && !r.error) meta[r.name] = { w: r.w, h: r.h, regX: r.regX, regY: r.regY };

const cp = (src, dst) => fs.copyFileSync(src, dst);
const textures = [];
for (const f of fs.readdirSync(path.join(A, 'textures'))) {
  if (!f.endsWith('.png')) continue;
  textures.push(f.replace('.png', ''));
  cp(path.join(A, 'textures', f), path.join(G, 'textures', f));
}
const sounds = [];
for (const f of fs.readdirSync(path.join(A, 'sounds'))) {
  if (!f.endsWith('.wav')) continue;
  sounds.push(f.replace('.wav', ''));
  cp(path.join(A, 'sounds', f), path.join(G, 'sounds', f));
}
const models = [], modelTextures = [];
const M3 = path.join(A, 'models3d');
if (fs.existsSync(M3)) {
  for (const f of fs.readdirSync(M3)) {
    if (f.endsWith('.json')) {
      models.push(f.replace('.json', ''));
      cp(path.join(M3, f), path.join(G, 'models3d', f));
    }
  }
  const T3 = path.join(M3, 'tex');
  if (fs.existsSync(T3)) for (const f of fs.readdirSync(T3)) {
    modelTextures.push(f);
    cp(path.join(T3, f), path.join(G, 'models3d', 'tex', f));
  }
}
const trackdata = JSON.parse(fs.readFileSync(path.join(A, 'trackdata.json')));
fs.writeFileSync(path.join(G, 'manifest.json'), JSON.stringify({ textures, sounds, models, modelTextures, meta, trackdata }));
console.log('manifest:', textures.length, 'textures,', sounds.length, 'sounds,', models.length, 'models,', modelTextures.length, 'model textures');
