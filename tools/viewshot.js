// node tools/viewshot.js model1 model2 ... — screenshot each model in the viewer
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const GAME = path.resolve(__dirname, '..', 'game');
const OUT = path.resolve(__dirname, '..', 'shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/viewer.html';
  const f = path.join(GAME, decodeURIComponent(p));
  if (!f.startsWith(GAME) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, r));
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 610, height: 510 } });
  page.on('pageerror', e => console.log('ERR:', e.message.slice(0, 150)));
  for (const m of process.argv.slice(2)) {
    await page.goto(`http://localhost:${server.address().port}/viewer.html?model=${m}`);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, 'view-' + m + '.png') });
    const st = await page.evaluate('window.__stats').catch(() => null);
    console.log(m, JSON.stringify(st));
  }
  await b.close();
  server.close();
})();
