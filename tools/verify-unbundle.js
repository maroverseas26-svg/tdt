// Usage: NODE_PATH=<playwright node_modules> node tools/verify-unbundle.js <abs path legacy/index.bundle.html> <abs path public> <screenshot dir>
// Log in as the BOD seed user on both builds, click every nav tab, compare rendered DOM per tab.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [, , bundle, pub, outDir] = process.argv;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/plain', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(pub, p);
  if (!f.startsWith(pub) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(8789);
const norm = s => s.replace(/blob:[^"')]+|\/assets\/logo-(mini|full)\.png/g, 'IMG');
(async () => {
  const b = await chromium.launch();
  async function run(url, tag) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route(/supabase\.co/, r => r.abort());
    await ctx.addInitScript(() => { try { if (!localStorage.getItem('ttcrm_session_v1')) localStorage.setItem('ttcrm_session_v1', JSON.stringify('u-hoang')); } catch (e) {} });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|supabase|\[SB\]/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
    await pg.goto(url);
    await pg.waitForSelector('.nav-item', { timeout: 60000 });
    await pg.waitForTimeout(2000);
    const out = {};
    const n = await pg.locator('.nav-item').count();
    for (let i = 0; i < n; i++) {
      const it = pg.locator('.nav-item').nth(i);
      const label = (await it.innerText()).trim();
      await it.click(); await pg.waitForTimeout(1200);
      out[label] = norm(await pg.evaluate(() => document.querySelector('#root').innerHTML));
      await pg.screenshot({ path: `${outDir}/${tag}-${i}.png` });
    }
    await ctx.close();
    return { out, errs };
  }
  const a = await run('file://' + bundle, 'orig');
  const c = await run('http://localhost:8789/', 'new');
  for (const k of Object.keys(a.out)) {
    const x = a.out[k], y = c.out[k] || '';
    let msg = x === y ? 'SAME' : 'DIFF';
    if (x !== y) { let i = 0; while (x[i] === y[i]) i++; msg += ` @${i}\n   A: ${x.slice(i - 60, i + 100)}\n   C: ${y.slice(i - 60, i + 100)}`; }
    console.log(k.padEnd(20), x.length, msg);
  }
  console.log('tabs', Object.keys(a.out).length, Object.keys(c.out).length);
  console.log('errors original', a.errs, '\nerrors unpacked', c.errs);
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
