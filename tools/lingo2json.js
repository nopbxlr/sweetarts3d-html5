// Convert Lingo list literals (track defs, points, logotrans) to JSON
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

function parseLingo(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /[\s,]/.test(src[i])) i++; };
  function value() {
    ws();
    if (src[i] === '[') {
      i++;
      ws();
      // property list?
      if (src[i] === '#') {
        const obj = {};
        while (i < src.length && src[i] !== ']') {
          ws();
          if (src[i] === ']') break;
          if (src[i] !== '#') throw new Error('proplist key @' + i + ' ' + src.slice(i, i + 30));
          i++;
          let key = '';
          while (/[\w]/.test(src[i])) key += src[i++];
          ws();
          if (src[i] === ':') i++;
          obj[key] = value();
          ws();
        }
        i++;
        return obj;
      }
      const arr = [];
      while (i < src.length && src[i] !== ']') { arr.push(value()); ws(); }
      i++;
      return arr;
    }
    if (src.startsWith('vector(', i)) {
      i += 7;
      const v = [value(), value(), value()];
      ws(); if (src[i] === ')') i++;
      return v;
    }
    if (src[i] === '"') {
      i++; let s = '';
      while (src[i] !== '"') s += src[i++];
      i++;
      return s;
    }
    // number
    let s = '';
    while (i < src.length && /[-\d.eE+]/.test(src[i])) s += src[i++];
    if (!s.length) throw new Error('parse error @' + i + ': ' + src.slice(i, i + 30));
    return parseFloat(s);
  }
  return value();
}

const out = {};
for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith('.txt')) continue;
  const name = f.replace('.txt', '');
  const src = fs.readFileSync(path.join(DIR, f), 'latin1').trim();
  if (!src.startsWith('[')) { out[name] = src; continue; }
  try { out[name] = parseLingo(src); }
  catch (e) { console.error('FAIL', name, e.message); }
}
fs.writeFileSync(path.join(OUT, 'trackdata.json'), JSON.stringify(out));
for (const k of Object.keys(out)) {
  const v = out[k];
  console.log(k, Array.isArray(v) ? 'items:' + v.length : typeof v);
}
