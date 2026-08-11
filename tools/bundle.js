// Bundle the game into a single self-contained HTML file.
// All assets are inlined as data: URIs / JSON; fetch/Image loads are intercepted.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const S = path.resolve(__dirname, '..');
const G = path.join(S, 'game');
const OUT = process.argv[2] || path.join(S, 'dist', 'SweeTarts3D.html');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

(async () => {
  // 1. bundle JS
  const result = await esbuild.build({
    entryPoints: [path.join(G, 'js', 'main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    write: false,
    alias: { three: path.join(S, 'node_modules', 'three', 'build', 'three.module.js') },
  });
  const js = result.outputFiles[0].text;

  // 2. inline assets
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const manifest = JSON.parse(fs.readFileSync(path.join(G, 'assets', 'manifest.json')));
  const files = {};
  files['assets/manifest.json'] = 'data:application/json;base64,' + Buffer.from(JSON.stringify(manifest)).toString('base64');
  for (const t of manifest.textures) files[`assets/textures/${t}.png`] = 'data:image/png;base64,' + b64(path.join(G, 'assets', 'textures', t + '.png'));
  for (const s of manifest.sounds) {
    // music as plain WAV for maximum decode compatibility; short SFX as AAC to save space
    const m4a = path.join(S, 'assets', 'sounds-m4a', s + '.m4a');
    if (s !== 'music' && fs.existsSync(m4a)) files[`assets/sounds/${s}.wav`] = 'data:audio/mp4;base64,' + b64(m4a);
    else files[`assets/sounds/${s}.wav`] = 'data:audio/wav;base64,' + b64(path.join(G, 'assets', 'sounds', s + '.wav'));
  }
  for (const m of manifest.models) {
    // compact: strip decoder metadata, round floats
    const j = JSON.parse(fs.readFileSync(path.join(G, 'assets', 'models3d', m + '.json')));
    const round = (v) => typeof v === 'number' ? Math.round(v * 10000) / 10000 : v;
    const compact = {
      nodes: (j.nodes || []).filter(n => n.kind === 'model').map(n => ({ kind: n.kind, name: n.name, transform: (n.transform || []).map(round), resourceName: n.resourceName })),
      materials: (j.materials || []).map(x => ({ name: x.name, diffuse: (x.diffuse || []).map(round), emissive: (x.emissive || []).map(round) })),
      shaders: (j.shaders || []).map(x => ({ name: x.name, materialName: x.materialName, textureName: x.textureName })),
      bones: j.bones,
      meshes: (j.meshes || []).map(me => ({
        name: me.name,
        shading: me.shading,
        geometry: me.geometry && me.geometry.groups ? {
          status: me.geometry.status,
          groups: me.geometry.groups.map(gr => ({
            positionCount: gr.positionCount,
            positions: (gr.positions || []).map(round),
            faces: gr.faces,
            uvs: (gr.uvs || []).map(p => p.map(round)),
            normals: (gr.normals || []).map(p => p.map(round)),
            boneWeights: gr.boneWeights
          }))
        } : undefined
      }))
    };
    files[`assets/models3d/${m}.json`] = 'data:application/json;base64,' + Buffer.from(JSON.stringify(compact)).toString('base64');
  }
  for (const t of manifest.modelTextures || []) files[`assets/models3d/tex/${t}`] = 'data:image/jpeg;base64,' + b64(path.join(G, 'assets', 'models3d', 'tex', t));

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Wonka SweeTarts 3D Game</title>
<style>
  html,body { margin:0; padding:0; background:#1a1a1a; height:100%; }
  #stagewrap { position:relative; width:600px; height:500px; margin:0 auto; top:50%; transform:translateY(-50%); background:#000; overflow:hidden; }
  #stage { position:absolute; left:0; top:0; }
  #overlay { position:absolute; left:0; top:0; width:600px; height:500px; pointer-events:none; }
  #ui { position:absolute; left:0; top:0; width:600px; height:500px; }
  #ui img { position:absolute; }
  .clickable { cursor:pointer; }
</style>
</head>
<body>
<div id="stagewrap">
  <canvas id="stage" width="600" height="500"></canvas>
  <div id="overlay"></div>
  <div id="ui"></div>
  <div id="loading" style="position:absolute;left:0;top:0;width:600px;height:500px;display:flex;align-items:center;justify-content:center;color:#3ec6dc;font:bold 24px Verdana,sans-serif;">LOADING...</div>
</div>
<p id="caption" style="position:fixed;left:0;right:0;bottom:10px;margin:0;text-align:center;color:#5a6a6e;font:11px/1.6 Verdana,sans-serif;letter-spacing:0.04em;">WONKA SWEETARTS 3D GAME (2004) &middot; HTML5 PORT &middot; ARROWS move &middot; SPACE jump &middot; DOWN pull back view &middot; click for sound</p>
<style>@media (max-height: 580px) { #caption { display:none; } }</style>
<script>
// virtual filesystem: intercept fetch + Image/img.src for bundled assets
const __VFS = ${JSON.stringify(files)};
{
  const origFetch = window.fetch.bind(window);
  window.fetch = (url, ...rest) => {
    const key = String(url).replace(/^\\.\\//, '');
    if (__VFS[key]) return origFetch(__VFS[key]);
    return origFetch(url, ...rest);
  };
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    set(v) { const key = String(v).replace(/^\\.\\//, ''); desc.set.call(this, __VFS[key] || v); },
    get() { return desc.get.call(this); }
  });
}
</script>
<script>${js.replace(/<\/script>/g, '<\\/script>')}</script>
</body>
</html>`;
  fs.writeFileSync(OUT, html);
  console.log('bundled:', OUT, (fs.statSync(OUT).size / 1024 / 1024).toFixed(1) + 'MB');
  // artifact variant: same content without the document skeleton (host wraps it)
  const bodyStart = html.indexOf('<body>') + 6;
  const bodyEnd = html.indexOf('</body>');
  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>') + 8;
  const artifact = '<title>Wonka SweeTarts 3D Game</title>\n' + html.slice(styleStart, styleEnd) + '\n' + html.slice(bodyStart, bodyEnd);
  const artOut = OUT.replace(/\.html$/, '-artifact.html');
  fs.writeFileSync(artOut, artifact);
  console.log('artifact:', artOut, (fs.statSync(artOut).size / 1024 / 1024).toFixed(1) + 'MB');
})();
