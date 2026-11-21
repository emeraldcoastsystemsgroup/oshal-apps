/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.20.3: CREATE-TOOL-CREATE-03 real Chromium browser proof — flip an asymmetric 4-quadrant photo with on-screen Format buttons, verify autosave/reload/undo/redo and exported PNG pixels, flip it back via concierge POST /projects/:id/operations and verify exported PNG pixels match the unflipped original on desktop 1440x900 and phone 412x915.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, startEditorFixture } from './create-editor-fixture.mjs';
import { applyAgentOperations, editingContract } from '../../tools/editor/agent-tools.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const sharp = createRequire(resolve(coreRoot, 'package.json'))('sharp');

const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], YELLOW = [255, 255, 0, 255];
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

/** Build an asymmetric 40x40 PNG: Red TL, Green TR, Blue BL, Yellow BR. */
async function quadrantPhoto() {
  const bytes = Buffer.alloc(40 * 40 * 4);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      const color = y < 20 ? (x < 20 ? RED : GREEN) : (x < 20 ? BLUE : YELLOW);
      bytes.set(color, (y * 40 + x) * 4);
    }
  }
  return sharp(bytes, { raw: { width: 40, height: 40, channels: 4 } }).png().toBuffer();
}

/** Extend the synthetic HTTP fixture with real concierge operations and editing-contract routes. */
function withConciergeRoutes(app, state) {
  app.get('/api/create/editing-contract', (_req, res) => res.json(editingContract()));
  app.post('/api/create/projects/:id/operations', (req, res) => {
    const record = state.projects.get(req.params.id);
    if (!record) return res.status(404).json({ error: 'project_not_found' });
    if (record.revision !== req.body.baseRevision) return res.status(409).json({ error: 'project_revision_conflict' });
    try {
      const document = applyAgentOperations(record.document, req.body.operations);
      const next = { ...record, title: document.name, revision: record.revision + 1, updatedAt: new Date().toISOString(), document };
      state.projects.set(record.id, next);
      state.revisions.get(record.id).push(structuredClone(next));
      state.successfulWrites++;
      res.status(201).json({ project: structuredClone(next) });
    } catch (failure) {
      res.status(400).json({ error: 'invalid_project_operations', detail: failure.message });
    }
  });
}

/** Export PNG via the real editor Export menu and decode quadrant pixels at layer box (20,20,40,40). */
async function exportQuadrants(page) {
  await page.locator('#exportMenu > summary').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportPng').click()]);
  const bytes = await readFile(await download.path());
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const o = (y * info.width + x) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; };
  return { width: info.width, height: info.height, tl: at(25, 25), tr: at(55, 25), bl: at(25, 55), br: at(55, 55) };
}

async function seedPhotoProject(fixture) {
  const bytes = await quadrantPhoto();
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), 'quad.png');
  const uploaded = await fetch(`${fixture.origin}/api/create/project-assets`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);
  const { asset } = await uploaded.json();
  return fixture.seed({
    version: 1, name: 'Flip proof', width: 80, height: 80, background: 'transparent',
    images: { photoAsset: { src: asset.src, width: 40, height: 40 } },
    layers: [{ id: 'photo', type: 'image', name: 'Asymmetric photo', assetId: 'photoAsset', x: 20, y: 20, w: 40, h: 40 }],
  });
}

test('button flip -> save/reload -> undo/redo -> concierge flip-back matches exported PNG pixels at every state', async t => {
  const fixture = await startEditorFixture({ extend: withConciergeRoutes });
  const record = await seedPhotoProject(fixture);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(async () => { await context.close(); await fixture.close(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();

  // Disabled when nothing is selected.
  assert.equal(await page.locator('#flipHorizontal').isDisabled(), true);
  assert.equal(await page.locator('#flipVertical').isDisabled(), true);

  // Select the photo layer and verify initial unflipped PNG export.
  await page.getByRole('button', { name: 'Select Asymmetric photo', exact: true }).click();
  assert.equal(await page.locator('#flipHorizontal').isDisabled(), false);
  assert.equal(await page.locator('#flipHorizontal').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'false');
  const initialPng = await exportQuadrants(page);
  assert.deepEqual(initialPng, { width: 80, height: 80, tl: RED, tr: GREEN, bl: BLUE, br: YELLOW });

  // Flip horizontal by on-screen button -> verify pressed state, autosave, reload retention and exported PNG.
  await page.locator('#flipHorizontal').click();
  assert.equal(await page.locator('#flipHorizontal').getAttribute('aria-pressed'), 'true');
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor({ timeout: 6000 });
  const ctxSnap = await page.evaluate(async () => (await import('/api/create/editor/editor-context.mjs')).editorSnapshot().fields);
  assert.equal(ctxSnap.flipX, true); assert.equal(ctxSnap.flipY, false);

  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 2' }).waitFor();
  await page.getByRole('button', { name: 'Select Asymmetric photo', exact: true }).click();
  assert.equal(await page.locator('#flipHorizontal').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'false');
  const flippedXPng = await exportQuadrants(page);
  assert.deepEqual(flippedXPng, { width: 80, height: 80, tl: GREEN, tr: RED, bl: YELLOW, br: BLUE });

  // Flip vertical by on-screen button -> verify Undo/Redo and exported PNG.
  await page.locator('#flipVertical').click();
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'true');
  await page.locator('#undo').click();
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'false');
  await page.locator('#redo').click();
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'true');
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 3' }).waitFor({ timeout: 6000 });
  const flippedBothPng = await exportQuadrants(page);
  assert.deepEqual(flippedBothPng, { width: 80, height: 80, tl: YELLOW, tr: BLUE, bl: GREEN, br: RED });

  // Concierge rejects invalid flip value cleanly, then flips photo back via POST /projects/:id/operations.
  const badRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 3, operations: [{ type: 'update', id: 'photo', patch: { flipX: 'yes' } }] }),
  });
  assert.equal(badRes.status, 400);

  const flipBackRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 3, operations: [{ type: 'update', id: 'photo', patch: { flipX: false, flipY: false } }] }),
  });
  assert.equal(flipBackRes.status, 201);
  const flipBackBody = await flipBackRes.json();
  assert.equal(flipBackBody.project.revision, 4);
  assert.equal('flipX' in flipBackBody.project.document.layers[0], false);
  assert.equal('flipY' in flipBackBody.project.document.layers[0], false);

  // Reopen in editor and verify exported PNG matches the unflipped original pixel-for-pixel.
  await page.reload();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 4' }).waitFor();
  await page.getByRole('button', { name: 'Select Asymmetric photo', exact: true }).click();
  assert.equal(await page.locator('#flipHorizontal').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#flipVertical').getAttribute('aria-pressed'), 'false');
  const restoredPng = await exportQuadrants(page);
  assert.deepEqual(restoredPng, initialPng);

  // Locking the photo disables both buttons and rejects concierge flip.
  await page.getByRole('button', { name: 'Lock Asymmetric photo', exact: true }).click();
  assert.equal(await page.locator('#flipHorizontal').isDisabled(), true);
  assert.equal(await page.locator('#flipVertical').isDisabled(), true);
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 5' }).waitFor({ timeout: 6000 });
  const lockedRes = await fetch(`${fixture.origin}/api/create/projects/${record.id}/operations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, baseRevision: 5, operations: [{ type: 'update', id: 'photo', patch: { flipX: true } }] }),
  });
  assert.equal(lockedRes.status, 400);

  // Desktop viewport cleanliness (1440x900).
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test('flip controls meet touch-target sizing and zero horizontal overflow on phone 412x915', async t => {
  const fixture = await startEditorFixture({ extend: withConciergeRoutes });
  const record = await seedPhotoProject(fixture);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  t.after(async () => { await context.close(); await fixture.close(); });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${fixture.origin}/api/create/editor?project=${record.id}`);
  await page.locator('.ef-shell').waitFor();
  await page.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();

  await page.locator('.ef-tools').getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByRole('button', { name: 'Select Asymmetric photo', exact: true }).click();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.locator('.ef-tools').getByRole('button', { name: 'Properties', exact: true }).click();

  for (const id of ['flipHorizontal', 'flipVertical']) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert.ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 412, `${id} box=${JSON.stringify(box)}`);
  }
  await page.locator('#flipHorizontal').click();
  assert.equal(await page.locator('#flipHorizontal').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
