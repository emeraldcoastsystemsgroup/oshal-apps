/** Genuine composed source HTTP/SQL and current CreateV4 persisted review validation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { ReviewStore } from './review-store.mjs';
import { applyOperation } from '../../create/tools/editor/model.mjs';
import { startSourceReviewHub } from './source-review-hub.mjs';
test('CreateV4 appearance survives an atomic review save and a fresh store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'create-v4-review-'));
    try {
        const file = join(dir, 'source.json'), s = new ReviewStore(file), id = s.list()[0].id, first = s.read(id);
        const document = applyOperation(first.document, { type: 'update', id: 'review-shape', patch: { shape: 'diamond', dash: [12, 6], shadow: { color: '#112233', opacity: .5, blur: 8, offsetX: 20, offsetY: 10 } } });
        assert.equal(document.version, 4);
        s.save(id, { baseRevision: 1, document });
        const restored = new ReviewStore(file).read(id);
        assert.equal(restored.document.layers[0].shape, 'diamond');
        assert.deepEqual(restored.document.layers[0].shadow, document.layers[0].shadow);
        assert.throws(() => s.save(id, { baseRevision: 1, document }), { status: 409 });
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('composed source hub serves actual editors and saves/reopens typed SQL revisions without providers', { timeout: 120000 }, async (t) => {
    const hub = await startSourceReviewHub();
    t.after(() => hub.close());
    const { chromium } = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN, 'package.json'))('playwright'), browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 915 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    for (const entry of hub.entries) {
        await page.goto(hub.origin + entry.url);
        await page.locator('.ef-shell').waitFor();
        await page.getByRole('button', { name: entry.selectionLabel, exact: true }).click();
        if (entry.key === 'portrait-studio') {
            await page.locator('[data-editor-property="crop-w"]').waitFor();
            assert.equal(await page.locator('[data-editor-property="crop-w"]').inputValue(), '480');
            const read = await fetch(hub.origin + '/api/portrait-studio/source-projects/' + entry.recordId), { project } = await read.json();
            const image = await fetch(hub.origin + '/api/portrait-studio/source-assets/' + project.model.photos[0].assetId + '/content');
            assert.equal(image.status, 200);
            assert.equal(Buffer.from(await image.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        }
        else {
            await page.getByRole('button', { name: '1. Opening · 5s', exact: true }).click();
            await page.locator('[data-editor-property="sceneText"]').fill('Edited through the composed review hub');
            await page.getByRole('button', { name: 'Save source', exact: true }).click();
            await page.locator('#status').filter({ hasText: 'Saved source revision 2' }).waitFor();
            await page.reload();
            await page.getByRole('button', { name: entry.selectionLabel.replace('revision 1', 'revision 2'), exact: true }).click();
            await page.getByRole('button', { name: '1. Opening · 5s', exact: true }).click();
            assert.equal(await page.locator('[data-editor-property="sceneText"]').inputValue(), 'Edited through the composed review hub');
        }
    }
    const denied = await fetch(hub.origin + '/api/brand-graphics/source-projects', { headers: { Origin: 'https://foreign.invalid' } });
    assert.equal(denied.status, 403);
    const ai = await fetch(hub.origin + '/api/swarm/bots/brand-graphics/ask', { method: 'POST' });
    assert.equal(ai.status, 503);
    assert.deepEqual(errors, []);
});
