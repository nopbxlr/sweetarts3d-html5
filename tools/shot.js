// Screenshot/interact harness: node tools/shot.js <outprefix> [script]
// script: semicolon-separated ops: wait:ms, click:x,y, key:ArrowUp:down|up, shot:name, eval:expr
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

const GAME = path.resolve(__dirname, '..', 'game');
const OUT = path.resolve(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(GAME, decodeURIComponent(p));
  if (!f.startsWith(GAME) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 620, height: 520 } });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));
  await page.goto(`http://localhost:${port}/`);
  const script = (process.argv[3] || 'wait:2000;shot:menu').split(';');
  for (const op of script) {
    const [cmd, ...rest] = op.split(':');
    const arg = rest.join(':');
    if (cmd === 'wait') await page.waitForTimeout(parseInt(arg));
    else if (cmd === 'click') { const [x, y] = arg.split(',').map(Number); await page.mouse.click(x + 10, y + 10); }
    else if (cmd === 'key') { const [k, dir] = arg.split('@'); if (dir === 'down') await page.keyboard.down(k); else if (dir === 'up') await page.keyboard.up(k); else await page.keyboard.press(k); }
    else if (cmd === 'shot') await page.screenshot({ path: path.join(OUT, process.argv[2] + '-' + arg + '.png') });
    else if (cmd === 'eval') {
      try { logs.push('EVAL(' + arg + '): ' + JSON.stringify(await page.evaluate(arg))); }
      catch (e) { logs.push('EVALFAIL(' + arg + '): ' + e.message.split('\n')[0]); }
    }
  }
  console.log(logs.slice(-60).join('\n'));
  await browser.close();
  server.close();
})();
