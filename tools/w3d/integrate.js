// Decode geometry for every model and merge into its models3d/<name>.json.
'use strict';
const fs = require('fs');
const { decodeMesh } = require('./mesh.js');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

const files = fs.readdirSync(S + '/assets/models').filter(x => x.endsWith('.w3d'));
let ok = 0;
const report = [];
for (const f of files) {
  const base = f.replace(/\.w3d$/, '');
  const jsonPath = S + '/assets/models3d/' + base + '.json';
  if (!fs.existsSync(jsonPath)) { report.push([base, 'no-json']); continue; }
  let r;
  try { r = decodeMesh(fs.readFileSync(S + '/assets/models/' + f)); }
  catch (e) { report.push([base, 'EXC ' + e.message]); continue; }
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  // build per-group geometry
  const groupsGeo = r.G.map((g, gi) => {
    const positions = [];
    for (const v of g.verts) { positions.push(v.p[0], v.p[1], v.p[2]); }
    const faces = g.faces.map(fc => [fc[0], fc[1], fc[2]]);
    const faceShading = g.faces.map(fc => (fc.shading !== undefined ? fc.shading : 0));
    const geo = { positionCount: g.verts.length, faceCount: g.faces.length,
                  positions, faces, faceShading };
    if (g.verts.some(v => v.uv)) geo.uvs = g.verts.map(v => v.uv || null);
    if (g.verts.some(v => v.n)) geo.normals = g.verts.map(v => v.n);
    if (g.verts.some(v => v.bw && v.bw.length)) geo.boneWeights = g.verts.map(v => v.bw || []);
    return geo;
  });
  const status = (r.declMatch || r.complete) ? 'exact' : ('partial@rec' + (r.result.at || 0));
  // attach to the single mesh entry
  if (json.meshes && json.meshes.length) {
    json.meshes[0].geometry = {
      status,
      groups: groupsGeo,
    };
  }
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 1));
  if (r.declMatch || r.complete) ok++;
  report.push([base, status,
    'verts=' + r.G.map(x => x.verts.length).join('/'),
    'faces=' + r.G.map(x => x.faces.length).join('/')]);
}
report.sort((a, b) => (a[1] === 'exact' ? 0 : 1) - (b[1] === 'exact' ? 0 : 1));
for (const row of report) console.log(row.join('  '));
console.log(`\n${ok}/${files.length} exact; geometry written to all models3d/*.json`);
