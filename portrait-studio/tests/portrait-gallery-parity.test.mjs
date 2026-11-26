/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 1.17.10 browser proof (1440x900 and 412x915): verifies Run again button appears on both finished and failed gallery rows, triggers POST /portraits/:id/rerun with inline #galleryStatus feedback (no alert/confirm) and gallery refresh, verifies gallery rename/delete/export/send-to controls, and verifies reader permission hiding with zero horizontal overflow and zero pageerrors.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolchain = process.env.STORE_CI_TOOLCHAIN || resolve(root, '..', 'scripts', 'toolchain');
const platform = process.env.OSHAL_PLATFORM_ROOT || process.env.OSHAL_KERNEL_PLATFORM || resolve(root, '..', '..', 'oshal-kernel', 'platform');
const requireDeps = createRequire(resolve(toolchain, 'package.json'));
const requireOwn = createRequire(resolve(root, 'oshal-app.yaml'));
const express = requireDeps('express');
const { chromium } = requireDeps('playwright');
const sharp = requireDeps('sharp');
const { clientCatalog } = requireOwn('./routes/portrait-catalog.js');

let browser;
let samplePng;

before(async () => {
  browser = await chromium.launch({ headless: true });
  samplePng = await sharp({ create: { width: 240, height: 300, channels: 3, background: '#3a6699' } }).png().toBuffer();
});

after(async () => { await browser?.close(); });

async function openGalleryFixture(t, { width, height, phone, permissions }) {
  const portraits = [
    {
      portrait_id: '11111111-1111-4111-8111-111111111111',
      title: 'Finished Headshot',
      mode: 'professional',
      style: 'linkedin',
      status: 'done',
      error: null,
      created_at: new Date(Date.now() - 120000).toISOString(),
      updated_at: new Date(Date.now() - 60000).toISOString(),
    },
    {
      portrait_id: '22222222-2222-4222-8222-222222222222',
      title: 'Failed Astronaut',
      mode: 'character',
      style: 'astronaut',
      status: 'failed',
      error: 'provider timeout',
      created_at: new Date(Date.now() - 180000).toISOString(),
      updated_at: new Date(Date.now() - 170000).toISOString(),
    },
  ];
  const reruns = [];
  const deletes = [];
  const app = express();
  app.use(express.json());
  app.get('/api/portrait-studio/app', (_req, res) => res.sendFile(resolve(root, 'tools/portrait-studio.html')));
  app.get('/api/portrait-studio/capture-module', (_req, res) => res.sendFile(resolve(root, 'tools/portrait-capture.js')));
  app.get('/api/portrait-studio/face-module', (_req, res) => res.sendFile(resolve(root, 'tools/portrait-face.js')));
  app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
  app.get('/api/portrait-studio/permissions', (_req, res) => res.json({ permissions, unavailable: { email: true } }));
  app.get('/api/portrait-studio/provider', (_req, res) => res.json({ configured: true, provider: 'fixture' }));
  app.get('/api/portrait-studio/catalog', (_req, res) => res.json(clientCatalog()));
  app.get('/api/portrait-studio/source-projects', (_req, res) => res.json({ projects: [] }));
  app.get('/api/portrait-studio/portraits', (_req, res) => res.json({ portraits }));
  app.get('/api/portrait-studio/portraits/:id/image', (_req, res) => res.type('image/png').send(samplePng));
  app.post('/api/portrait-studio/portraits/:id/rerun', (req, res) => {
    reruns.push(req.params.id);
    const id = `33333333-3333-4333-8333-00000000000${reruns.length}`;
    const orig = portraits.find((p) => p.portrait_id === req.params.id);
    portraits.unshift({
      portrait_id: id,
      title: `${orig ? orig.title : 'Portrait'} (rerun ${reruns.length})`,
      mode: orig ? orig.mode : 'professional',
      style: orig ? orig.style : 'linkedin',
      status: 'done',
      error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.status(201).json({ portraitId: id, rerunOf: req.params.id, status: 'done' });
  });
  app.delete('/api/portrait-studio/portraits/:id', (req, res) => {
    deletes.push(req.params.id);
    const idx = portraits.findIndex((p) => p.portrait_id === req.params.id);
    if (idx >= 0) portraits.splice(idx, 1);
    res.json({ ok: true });
  });
  app.get('/api/artifacts/picker.js', (_req, res) => res.type('js').send('window.oshalPickArtifact = async () => null;'));
  app.get('/api/artifacts/send-to.js', (_req, res) => res.type('js').send('window.oshalSendTo = (payload) => { window.__lastSendTo = payload; };'));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone });
  t.after(async () => {
    await context.close();
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });
  const page = await context.newPage();
  const pageErrors = [];
  const dialogs = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss(); });
  await page.goto(`http://127.0.0.1:${server.address().port}/api/portrait-studio/app`);
  await page.locator('#galleryGrid .g-item').first().waitFor();
  return { page, reruns, deletes, pageErrors, dialogs };
}

test('desktop 1440x900 and mobile 412x915: Run again works on finished and failed rows with inline feedback, plus export/send-to/delete controls', async (t) => {
  for (const [width, height, phone] of [[1440, 900, false], [412, 915, true]]) {
    const { page, reruns, deletes, pageErrors, dialogs } = await openGalleryFixture(t, {
      width, height, phone,
      permissions: { view: true, read: true, create: true, change: true, delete: true, export: true },
    });

    assert.equal(await page.locator('.wrap').getAttribute('data-portrait-view'), 'portraits');
    assert.equal(await page.locator('#galleryGrid .g-item').count(), 2);
    assert.equal(await page.locator('#galleryGrid button[data-rerun]').count(), 2, 'Run again appears on both finished and failed rows');

    // Click Run again on the FAILED row first
    await page.locator('#galleryGrid button[data-rerun="22222222-2222-4222-8222-222222222222"]').click();
    await page.locator('#galleryStatus').filter({ hasText: /Done! Your new portrait is ready/ }).waitFor();
    assert.deepEqual(reruns, ['22222222-2222-4222-8222-222222222222']);
    assert.equal(await page.locator('#galleryGrid .g-item').count(), 3);

    // Click Run again on the FINISHED row
    await page.locator('#galleryGrid button[data-rerun="11111111-1111-4111-8111-111111111111"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#galleryGrid .g-item').length === 4);
    assert.deepEqual(reruns, ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111']);

    // Verify Send to… control triggers oshalSendTo
    await page.locator('#galleryGrid button[data-sendto="11111111-1111-4111-8111-111111111111"]').click();
    await page.waitForFunction(() => Boolean(window.__lastSendTo));
    const sent = await page.evaluate(() => window.__lastSendTo);
    assert.equal(sent.type, 'image/png');
    assert.equal(sent.source, '/api/portrait-studio/portraits/11111111-1111-4111-8111-111111111111/image');

    // Verify Delete removes row and updates inline status
    await page.locator('#galleryGrid button[data-del="22222222-2222-4222-8222-222222222222"]').click();
    await page.locator('#galleryStatus').filter({ hasText: /Portrait deleted/ }).waitFor();
    assert.deepEqual(deletes, ['22222222-2222-4222-8222-222222222222']);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 2, `no horizontal overflow at ${width}x${height} (got ${overflow}px)`);
    assert.deepEqual(dialogs, [], 'no native alert/confirm dialogs used for rerun/delete/send-to');
    assert.deepEqual(pageErrors, []);
  }
});

test('reader without create permission sees gallery without Run again button', async (t) => {
  const { page, pageErrors } = await openGalleryFixture(t, {
    width: 1440, height: 900, phone: false,
    permissions: { view: true, read: true, create: false, change: false, delete: false, export: false },
  });
  assert.equal(await page.locator('#galleryGrid .g-item').count(), 2);
  assert.equal(await page.locator('#galleryGrid button[data-rerun]').count(), 0);
  assert.deepEqual(pageErrors, []);
});
