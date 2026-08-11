// Decode all models; report declMatch + topology metrics per group:
//  - boundary edges (edges used by exactly 1 face)  - nonmanifold edges (>2)
//  - degenerate faces (repeated corner)             - valence stats
//  - positions inside declared bounding sphere
'use strict';
const fs = require('fs');
const { decodeMesh } = require('./mesh.js');
const S = '/private/tmp/claude-501/-Users-bxlr-Downloads-SweetTarts-3D/227986fb-3ef3-47fa-8218-9579e05cc4ad/scratchpad';

function topo(g) {
  const edges = new Map();
  let degen = 0;
  for (const f of g.faces) {
    if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2]) { degen++; continue; }
    for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k + 1) % 3];
      const key = a < b ? a + '_' + b : b + '_' + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let boundary = 0, nonmanifold = 0;
  for (const c of edges.values()) { if (c === 1) boundary++; else if (c > 2) nonmanifold++; }
  const val = new Array(g.verts.length).fill(0);
  for (const f of g.faces) for (const v of f) if (v < val.length) val[v]++;
  const used = val.filter(x => x > 0);
  const meanVal = used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
  const unused = val.filter(x => x === 0).length;
  return { edges: edges.size, boundary, nonmanifold, degen, meanVal: +meanVal.toFixed(2), unused };
}

const files = process.argv[2] ? [process.argv[2] + '.w3d']
  : fs.readdirSync(S + '/assets/models').filter(x => x.endsWith('.w3d'));
let exact = 0;
for (const f of files) {
  const base = f.replace(/\.w3d$/, '');
  let r;
  try { r = decodeMesh(fs.readFileSync(S + '/assets/models/' + f)); }
  catch (e) { console.log(base.padEnd(14), 'EXC', e.message); continue; }
  if (!r.G) { console.log(base.padEnd(14), 'ERR', r.err); continue; }
  const st = r.declMatch ? 'exact' : ('partial(' + (r.result.err || '') + '@' + r.result.at + ')');
  if (r.declMatch) exact++;
  // bounding sphere check
  const [cx, cy, cz] = r.decl.center, R = r.decl.radius * 1.02 + 1e-4;
  let outOfSphere = 0, badIdx = 0;
  for (let gi = 0; gi < r.G.length; gi++) {
    const g = r.G[gi];
    for (const v of g.verts) {
      const dx = v.p[0] - cx, dy = v.p[1] - cy, dz = v.p[2] - cz;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > R) outOfSphere++;
    }
    for (const fc of g.faces) for (const v of fc) if (v >= g.verts.length) badIdx++;
  }
  const t = r.G.map(topo);
  console.log(base.padEnd(14), st.padEnd(28),
    'v=' + r.G.map(x => x.verts.length).join('/'),
    'f=' + r.G.map(x => x.faces.length).join('/'),
    'bnd=' + t.map(x => x.boundary).join('/'),
    'nonm=' + t.map(x => x.nonmanifold).join('/'),
    'degen=' + t.map(x => x.degen).join('/'),
    'val=' + t.map(x => x.meanVal).join('/'),
    'unused=' + t.map(x => x.unused).join('/'),
    'oob=' + outOfSphere, 'badIdx=' + badIdx);
}
console.log('exact:', exact, '/', files.length);
