// Headless self-play: the host and one phone join over the same-browser channel, the
// game's own bot AI plays every hero, and the run has to finish without a single page error.
//   node tests/selfplay.mjs            Practice Solo, a campaign (Easy, Short) and 3 Survival waves
//   node tests/selfplay.mjs campaign   just one of them
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(browser, mode) {
  const started = Date.now();
  const log = (...m) => console.log(`[${mode} ${((Date.now() - started) / 1000).toFixed(0)}s]`, ...m);
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // Phones join over BroadcastChannel; nothing goes to the real relay or PeerJS
  await ctx.addInitScript(() => { try { localStorage.setItem('pq-dev', JSON.stringify({ transports: ['local'] })); } catch (e) { } });
  const watch = (page, who) => {
    page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who} console.error: ${m.text()}`); });
  };

  const host = await ctx.newPage();
  watch(host, 'host');
  await host.goto(`${BASE}/host.html`);
  await host.waitForFunction(() => document.getElementById('lobby-room')?.dataset.code, null, { timeout: 20000 });
  const room = await host.evaluate(() => document.getElementById('lobby-room').dataset.code);

  // The "human" heroes count as bots only while a tick resolves, so the bot AI plays them.
  // window.__pq is the game's test handle (js/init.js).
  await host.evaluate((mode) => {
    const pq = window.__pq;
    window.__pup = new Set();
    let flipped = [];
    pq.on('beforeTick', () => {
      flipped = pq.state.players.filter((p) => window.__pup.has(p.name) && !p.isBot && !p._dc);
      flipped.forEach((p) => { p.isBot = true; });
    });
    pq.on('afterTick', () => { flipped.forEach((p) => { p.isBot = false; }); flipped = []; });
    setInterval(() => {
      const us = window._upgradeState;
      if (!us || us.done) return;
      pq.state.players.forEach((p, i) => {
        if (!window.__pup.has(p.name) || us.picks[p.name]) return;
        const ch = us.choices[p.name] || [];
        if (!ch.length) return;
        if (i === 0 && mode !== 'survival') pq.pickUpgrade(0, 0); else pq.applyUpgradePick(p, ch[0]);
      });
    }, 400);
  }, mode);

  if (mode === 'practice') {
    await host.click('text=Practice Solo');
    await host.waitForFunction(() => __pq.state.running && __pq.state.gamePhase === 'game', null, { timeout: 20000 });
    log('started');
    await sleep(10000);
    await ctx.close();
    return { mode, result: errors.length ? null : 'ran 10s', errors, seconds: Math.round((Date.now() - started) / 1000) };
  }

  await host.selectOption('#mode-sel', mode);
  await host.selectOption('#diff-sel', '0');
  await host.fill('#host-name', 'KAI');
  await host.evaluate(() => { document.getElementById('speed-sel').value = '1000'; });

  const phone = await ctx.newPage();
  watch(phone, 'phone');
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(`${BASE}/controller.html?room=${room}`);
  await phone.waitForSelector('#player-name', { state: 'visible', timeout: 20000 });
  await phone.fill('#player-name', 'MIRA');
  await phone.locator('#class-grid > *').nth(1).click();
  await phone.click('#ready-btn');
  await host.evaluate(() => { window.__pup.add('KAI'); window.__pup.add('MIRA'); });

  await host.waitForFunction(() => __pq.lobbyReady().ok, null, { timeout: 15000 });
  await host.click('#start-btn');
  await host.waitForFunction(() => __pq.state.running && __pq.state.gamePhase === 'game', null, { timeout: 20000 });
  log('started, room', room);

  // the phone's board view: a watch-only host.html?viewer=1 rebuilt from the host's snapshots
  if (mode === 'campaign') {
    await phone.setViewportSize({ width: 1280, height: 800 }); // the toggle only shows on a computer
    await phone.click('#board-toggle');
    const frame = phone.frameLocator('#board-frame');
    await frame.locator('#c').waitFor({ timeout: 15000 });
    const viewer = phone.frames().find((f) => f.url().includes('viewer=1'));
    await viewer.waitForFunction(() => window.__pq?.state.players.length > 0 && window.__pq.state.enemies.length > 0, null, { timeout: 15000 });
    log('board view mirrors', await viewer.evaluate(() => `${__pq.state.players.length} heroes, ${__pq.state.enemies.length} enemies`));
  }

  const limit = mode === 'campaign' ? 240_000 : 150_000;
  let last = '';
  let result = null;
  while (Date.now() - started < limit) {
    await sleep(1000);
    const st = await host.evaluate(() => ({
      phase: __pq.state.gamePhase,
      stats: document.getElementById('stats-overlay')?.classList.contains('show') || false,
      node: __pq.state.campaignNode,
      wave: __pq.survivalWave(),
      heroesUp: __pq.state.players.filter((p) => p.hp > 0).length,
    }));
    const now = mode === 'campaign' ? `encounter ${st.node + 1}` : `wave ${st.wave}`;
    if (now !== last) { log(now, `· ${st.heroesUp} heroes up`); last = now; }
    if (errors.length) break;
    if (mode === 'campaign' && (st.stats || st.phase === 'results')) { result = 'campaign finished'; break; }
    if (mode === 'survival' && st.wave >= 3) { result = 'reached wave 3'; break; }
  }
  await ctx.close();
  return { mode, result, errors, seconds: Math.round((Date.now() - started) / 1000) };
}

const modes = process.argv[2] ? [process.argv[2]] : ['practice', 'campaign', 'survival'];
const browser = await chromium.launch();
let failed = false;
for (const mode of modes) {
  const r = await play(browser, mode);
  if (r.errors.length || !r.result) {
    failed = true;
    console.error(`✖ ${mode}: ${r.result || 'did not finish in time'} after ${r.seconds}s`);
    for (const e of r.errors) console.error('  ' + e);
  } else {
    console.log(`✔ ${mode}: ${r.result} in ${r.seconds}s with no page errors`);
  }
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
