/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify Ambient Recall (person-model) unhidden tile contract, canonical readiness probe, empty-state rendering across projection/recall/asks/people/trends, and pre-promotion 404 grace.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify Ambient Recall 1.2.1 Continuous Profile Learning & Eavesdrop Business Cards routes (GET/POST /api/person-model/profile-cards, POST /api/person-model/recall), concierge tools, and Profile & Cards UI tab.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.2.2: the manifest pin follows the version (Ambient Recall's routing words 'say', 'said' and 'meeting', backlog P4-16h).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.2.3: the owner's address is the test's own OSHAL_OWNER_ADDRESS (an example address), never a default in the package; the manifest pin follows the version.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PKG_ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(PKG_ROOT, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN
  ? (fs.existsSync(path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'))
    ? path.join(path.resolve(process.env.STORE_CI_TOOLCHAIN), 'node_modules')
    : path.resolve(process.env.STORE_CI_TOOLCHAIN))
  : path.join(STORE_ROOT, 'scripts/toolchain/node_modules');

const express = require(path.join(TOOLCHAIN, 'express'));
const yaml = require(path.join(TOOLCHAIN, 'js-yaml'));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'express') return express;
  return originalLoad.call(this, request, parent, isMain);
};
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));
const { createPersonModelSurfaceRoutes } = require('../routes/person-model-routes.mjs');

function createAmbientTestApp() {
  process.env.OSHAL_OWNER_ADDRESS = '1 Example Way, Springfield';
  const app = express();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'person-model-test-'));
  const state = { mode: 'empty', requests: [], dataDir };

  app.get('/shared/ui/css/surface-themes.css', (_req, res) => res.type('text/css').send(':root{}'));
  app.get('/shared/ui/css/surface-glass.css', (_req, res) => res.type('text/css').send(''));
  app.get('/shared/ui/js/surface-theme.js', (_req, res) => res.type('text/javascript').send(''));
  app.use('/api/person-model', createPersonModelSurfaceRoutes({ appPackageDir: PKG_ROOT, dataDir }));

  app.get('/api/jarvis/ambient/person/:endpoint', (req, res) => {
    const ep = req.params.endpoint;
    state.requests.push(ep);
    if (state.mode === 'pre-promotion-404') {
      return res.status(404).json({ error: 'not_found' });
    }
    if (ep === 'projection') return res.json({ semanticAvailable: false, ledger: null });
    if (ep === 'recall') return res.json({ resolved: true, personLabel: 'Ella', terms: 'volleyball', range: 'today', count: 0, receipts: [] });
    if (ep === 'asks') return res.json({ asks: [] });
    if (ep === 'people') return res.json({ people: [] });
    if (ep === 'trends') return res.json({ weeks: 2, rows: [] });
    if (ep === 'business-cards') return res.json({ cards: [] });
    return res.status(404).json({ error: 'unknown' });
  });

  return { app, state };
}

test('person-model manifest unhides Ambient Recall tile, declares lastingStorage and profile/card tools, and binds inline concierge', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(PKG_ROOT, 'oshal-app.yaml'), 'utf8'));
  assert.equal(manifest.name, 'person-model');
  assert.equal(manifest.displayName, 'Ambient Recall');
  assert.equal(manifest.status, 'active');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.lastingStorage, true);
  assert.equal(manifest.ui?.static?.[0]?.toolName, 'ambient-recall');
  assert.equal(manifest.ui?.static?.[0]?.iframeUrl, '/api/person-model/app');
  assert.equal(manifest.chatBot, 'ambient-recall-concierge');

  const toolNames = (manifest.tools || []).map((t) => t.name);
  assert.deepEqual(toolNames, [
    'person-model-profile-cards',
    'person-model-upsert-card',
    'person-model-recall',
  ]);

  const keywords = manifest.bots?.[0]?.routingKeywords || [];
  for (const kw of ['business cards', 'my profile', 'my address', 'who am i', 'continuous learning', 'eavesdropping']) {
    assert.ok(keywords.includes(kw), `expected routingKeywords to include "${kw}"`);
  }

  for (const rel of ['routes/package-smoke.js', 'src-routes/package-smoke.ts']) {
    assert.equal(
      fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8'),
      fs.readFileSync(path.join(STORE_ROOT, 'brand-graphics', rel), 'utf8'),
      `${rel} matches canonical reviewed smoke module`
    );
  }
});

test('Ambient Recall UI fetches projection/recall/asks/people/trends, supports Continuous Profile Learning & Business Cards, and handles pre-promotion 404 grace', async (t) => {
  const { app, state } = createAmbientTestApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`${baseUrl}/api/person-model/app`, { waitUntil: 'networkidle' });
  assert.match(await page.locator('[data-testid="projection-status"]').innerText(), /Semantic recall: off/);

  await page.fill('#q', 'How many times has Ella mentioned volleyball today?');
  await page.click('#go');
  await page.locator('[data-testid="recall-empty"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-testid="recall-headline"]').innerText(), /Ella has not been heard/);

  // Recall owner's continuously learned profile & address directly from the Recall bar
  await page.fill('#q', 'What is my address and learned profile?');
  await page.click('#go');
  assert.match(await page.locator('[data-testid="recall-headline"]').innerText(), /1 Example Way, Springfield/);

  // Navigate to Profile & Cards tab and verify Continuous Profile Learning + Business Cards
  await page.click('[data-tab="cards"]');
  await page.locator('[data-testid="self-profile-card"]').waitFor({ state: 'visible' });
  const heroText = await page.locator('[data-testid="self-profile-card"]').innerText();
  assert.match(heroText, /Workspace Owner/);
  assert.match(heroText, /1 Example Way, Springfield/);

  // Teach a new continuous-learning fact
  await page.fill('#teach-fact-input', 'Preferred departure airport is VPS (Destin-Fort Walton Beach)');
  await page.click('#teach-fact-btn');
  await page.waitForFunction(() => {
    const list = document.querySelector('[data-testid="self-facts-list"]');
    return list && list.innerText.includes('Preferred departure airport is VPS');
  });

  // Add a new Eavesdrop Business Card
  await page.click('#new-card-toggle');
  await page.fill('#card-name-input', 'Alex Rivera');
  await page.fill('#card-role-input', 'Program Director');
  await page.fill('#card-org-input', 'Agentic Federal');
  await page.fill('#card-topics-input', 'radar integration, schedule review');
  await page.fill('#card-quote-input', 'Let us lock the integration milestone for Thursday.');
  await page.click('#card-save-btn');
  await page.waitForFunction(() => {
    const grid = document.querySelector('[data-testid="business-cards-grid"]');
    return grid && grid.innerText.includes('Alex Rivera') && grid.innerText.includes('Program Director');
  });

  await page.click('[data-tab="asks"]');
  await page.locator('[data-testid="asks-empty"]').waitFor({ state: 'visible' });

  await page.click('[data-tab="people"]');
  await page.locator('[data-testid="people-empty"]').waitFor({ state: 'visible' });

  await page.click('[data-tab="trends"]');
  await page.locator('[data-testid="trends-empty"]').waitFor({ state: 'visible' });

  for (const ep of ['projection', 'recall', 'asks', 'people', 'trends']) {
    assert.ok(state.requests.includes(ep), `expected UI to fetch /api/jarvis/ambient/person/${ep}`);
  }

  state.mode = 'pre-promotion-404';
  await page.goto(`${baseUrl}/api/person-model/app?tab=people`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="pre-promotion-note"]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-testid="projection-status"]').innerText(), /awaiting kernel promotion/);
  assert.deepEqual(pageErrors, []);
});
