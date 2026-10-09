/**
 * Guide-to-artifact browser acceptance. The package route and renderer already have isolated
 * tests; this guard walks the shipped AI Office page itself so the Guide's bounded actions must
 * reach the visible editor before the user clicks Generate and receives a local receipt.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Walk the real AI Office DOM through Guide actions and a same-origin owner-scoped receipt without providers or outward delivery.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Resolve the same explicit framework fixture as the renderer contracts on every supported host.
 */

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameworkFixture } from './framework-fixture.mjs';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const frameworkRoot = frameworkFixture();
const { chromium } = require(path.join(frameworkRoot, 'node_modules', 'playwright'));
const OWNER = 'auth0|guide-browser-owner';

const THEME = {
  id: 'executive', name: 'Executive', blurb: 'Clear and focused', mood: 'clear', cover: 'wash', decor: 'bar', darkCanvas: true,
  fonts: { heading: 'Aptos Display', body: 'Aptos' },
  colors: { deep: '17202b', deepInk: 'ffffff', deepInkSoft: 'c7d2df', accent: '4cc9f0', accent2: 'f72585', canvas: 'ffffff', canvasAlt: 'eef4f8', ink: '17202b', inkSoft: '52606d', line: 'cbd5e1' },
};

const GUIDE_REPLY = {
  reply: 'I built the quarterly review outline in the editor.',
  actions: [
    { op: 'set_title', title: 'Quarterly Review' },
    { op: 'set_outline', slides: [
      { title: 'What changed', bullets: ['Three bounded improvements', 'Owner review'] },
      { title: 'Next steps', bullets: ['Confirm owner', 'Schedule review'] },
    ] },
    { op: 'set_theme', theme: 'executive' },
  ],
};

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function serveStatic(res, file, contentType) {
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

async function fixture() {
  const html = path.join(packageRoot, 'tools', 'presentations.html');
  const core = path.join(frameworkRoot, 'src', 'shared', 'ui');
  const receipts = [];
  const guideBodies = [];
  let emailCalls = 0;
  let deleteCalls = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/ui') return serveStatic(res, html, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/themes') return json(res, 200, { themes: [THEME], layouts: [], defaultTheme: THEME.id });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/starters') return json(res, 200, { kinds: [{ id: 'pptx', groups: [] }], starters: [] });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/destination') return json(res, 200, { provider: 'oshal-local', folder: 'files', subfolder: 'oshal', isDefault: true });
    if (req.method === 'GET' && url.pathname === '/api/presentations/sections/list') return json(res, 200, { decks: [] });
    if (req.method === 'GET' && url.pathname === '/api/create/brand-kit') return json(res, 404, { error: 'not_available' });
    if (req.method === 'POST' && url.pathname === '/api/presentations/sections/guide') {
      const body = await readBody(req); guideBodies.push(body);
      return json(res, 200, GUIDE_REPLY);
    }
    if (req.method === 'POST' && url.pathname === '/api/presentations/sections/pptx') {
      const body = await readBody(req);
      receipts.push({ owner: OWNER, body, provider: 'oshal-local', location: `oshal/${body.title}.pptx` });
      return json(res, 200, { ok: true, provider: 'oshal-local', location: `oshal/${body.title}.pptx`, downloadUrl: '/local/Quarterly-Review.pptx', format: 'pptx', slides: 2, theme: 'executive' });
    }
    if (req.method === 'POST' && url.pathname === '/api/presentations/sections/email') { emailCalls += 1; return json(res, 500, { error: 'unexpected_email' }); }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/presentations/sections/file')) { deleteCalls += 1; return json(res, 500, { error: 'unexpected_delete' }); }
    if (url.pathname === '/shared/ui/css/surface-themes.css') return serveStatic(res, path.join(core, 'css', 'surface-themes.css'), 'text/css');
    if (url.pathname === '/shared/ui/css/surface-glass.css') return serveStatic(res, path.join(core, 'css', 'surface-glass.css'), 'text/css');
    if (url.pathname === '/shared/ui/js/surface-theme.js') return serveStatic(res, path.join(core, 'js', 'surface-theme.js'), 'text/javascript');
    if (url.pathname === '/shared/ui/js/surface-bridge-client.js') return serveStatic(res, path.join(core, 'js', 'surface-bridge-client.js'), 'text/javascript');
    if (url.pathname.endsWith('.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(''); return; }
    if (url.pathname.endsWith('.css')) { res.writeHead(200, { 'content-type': 'text/css' }); res.end(''); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture did not bind');
  return { server, origin: `http://127.0.0.1:${address.port}`, receipts, guideBodies, get emailCalls() { return emailCalls; }, get deleteCalls() { return deleteCalls; } };
}

test('Guide drives the shipped AI Office page into a visible owner-scoped receipt', async () => {
  const app = await fixture();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const external = [];
  await context.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== app.origin) { external.push(requestUrl.href); return route.abort('blockedbyclient'); }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  try {
    await page.goto(`${app.origin}/api/presentations/sections/ui`, { waitUntil: 'domcontentloaded' });
    await page.locator('#wzTalk').click();
    await page.locator('#chatIn').fill('Build a quarterly review for the team');
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/presentations/sections/guide') && response.status() === 200),
      page.locator('#chatSend').click(),
    ]);
    await page.locator('#title').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#title')?.value === 'Quarterly Review');
    assert.match(await page.locator('#outline').inputValue(), /What changed/);
    assert.match(await page.locator('#outline').inputValue(), /Next steps/);
    assert.match(await page.locator('#chat').innerText(), /I built the quarterly review outline/);
    assert.equal(app.guideBodies[0].message, 'Build a quarterly review for the team');
    assert.deepEqual(app.guideBodies[0].slides, []);

    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/api/presentations/sections/pptx') && response.status() === 200),
      page.locator('#genBtn').click(),
    ]);
    await page.waitForFunction(() => document.querySelector('#result')?.textContent?.includes('saved to OSHAL local'));
    assert.match(await page.locator('#result').innerText(), /saved to OSHAL local/);
    assert.equal(app.receipts.length, 1);
    assert.equal(app.receipts[0].owner, OWNER);
    assert.equal(app.receipts[0].body.title, 'Quarterly Review');
    assert.equal(app.receipts[0].body.sections.length, 2);
    assert.equal(app.emailCalls, 0);
    assert.equal(app.deleteCalls, 0);
    assert.deepEqual(external, []);
  } finally {
    await context.close();
    await browser.close();
    await serverClose(app.server);
  }
});

function serverClose(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}
