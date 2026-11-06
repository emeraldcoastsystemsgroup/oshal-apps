/** Genuine frame identity/readiness, source saves, native exports, preserved old data and complete primary assets. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { startFullReview, jsonCall } from './full-review-server.mjs';
import { ReviewStore } from './review-store.mjs';
async function actualFrame(page, entry, origin) {
    const expected = new URL(entry.url, origin);
    await page.waitForFunction(({ path, query }) => { try {
        const actual = new URL(document.getElementById('review-editor').contentWindow.location.href);
        return actual.pathname.replace(/\/$/, '') === path.replace(/\/$/, '') && query.every(([key, value]) => actual.searchParams.get(key) === value);
    }
    catch {
        return false;
    } }, { path: expected.pathname, query: [...expected.searchParams] });
    const frame = page.frames().find(frame => { try {
        const url = new URL(frame.url());
        return url.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
    }
    catch {
        return false;
    } });
    assert.ok(frame, 'Actual requested frame exists: ' + entry.key);
    await frame.locator('.ef-shell').waitFor();
    if (entry.key === 'create')
        await frame.locator('#saveStatus').filter({ hasText: 'Saved · revision 1' }).waitFor();
    else if (['pptx', 'docx', 'xlsx'].includes(entry.key)) {
        await frame.locator('html[data-office-ready=true]').waitFor();
        await frame.waitForFunction(async (id) => { const { state } = await import('/api/presentations/editor/assets/state.mjs'); return state.id === id && !state.busy; }, entry.recordId);
    }
    else if (entry.key === 'publishing' || entry.key === 'pdf') {
        await frame.locator('#document-title').filter({ hasText: entry.expectedTitle }).waitFor();
        if (entry.key === 'pdf')
            await frame.locator('.pdf-object').first().waitFor();
    }
    else if (entry.key === 'portrait-studio')
        await frame.locator('[data-editor-property="crop-w"]:enabled').waitFor();
    else if (['brand-graphics', 'creative-studio'].includes(entry.key))
        await frame.waitForFunction(title => document.getElementById('title')?.value === title, entry.selectionLabel.split(' · revision ')[0]);
    else if (entry.key === 'motion') {
        await frame.waitForFunction(id => document.getElementById('projects')?.value === id, entry.recordId);
        await frame.locator('[data-editor-property="text"]:enabled').waitFor();
    }
    else if (entry.key === 'cad')
        await frame.locator('[data-editor-property="base:sizeX"]:enabled').waitFor();
    else if (entry.key === 'scene')
        await frame.locator('[data-editor-property="location:0"]:enabled').waitFor();
    else if (entry.key === 'video') {
        await frame.locator('html[data-editor-ready=true]').waitFor();
        await frame.waitForFunction(id => document.getElementById('projectList')?.value === id, entry.recordId);
    }
    else if (entry.key === 'lora') {
        await frame.locator('[data-editor-property="display_name"]:enabled').waitFor();
        await frame.waitForFunction(() => typeof identitySource !== 'undefined' && identitySource && !sourceBusy && !sourceDirty() && document.getElementById('editIdentityName').value === identitySource.displayName);
    }
    else if (entry.key === 'vids')
        await frame.locator('#vidsStatus').filter({ hasText: 'Opened saved brief revision 1' }).waitFor();
    else if (entry.key === 'scan')
        await frame.locator('[data-editor-property="dim-x"]:enabled').waitFor();
    const bg = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim());
    assert.ok(bg && !bg.includes('var('), entry.key + ' has a resolved background theme token');
    if (entry.recordId) {
        const context = await frame.evaluate(async () => { if (!window.__oshalDocumentSession)
            throw Error('The editor has no actual source session.'); return window.__oshalDocumentSession.prepare(); });
        assert.equal(context.recordId, entry.recordId, entry.key + ' prepares the actual requested saved source');
    }
    return frame;
}
test('the full loopback launcher opens16 genuine editors, retains real identities and exports native saved source', { timeout: 300000 }, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'full-editor-review-')), source = join(directory, 'old-create.json');
    new ReviewStore(source);
    const original = await readFile(source);
    let review, browser;
    const errors = [], outside = [], failedAssets = [];
    t.after(async () => { await browser?.close(); await review?.close(); await rm(directory, { recursive: true, force: true }); });
    const earlier = await jsonCall('http://127.0.0.1:38820', '/review/status');
    review = await startFullReview({ port: 0, stateDir: join(directory, 'new-copy'), sourceCreateFile: source, onProgress: message => console.log(message) });
    assert.notEqual(review.stateFile, source);
    assert.equal(review.entries.filter(entry => entry.url).length, 16);
    const status = await jsonCall(review.origin, '/review/status');
    assert.equal(status.publishingPreserved, true);
    assert.ok(status.publishingBackupReceipt);
    assert.ok(status.publishingClones.length);
    const { chromium } = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN, 'package.json'))('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== review.origin) {
        outside.push(route.request().url());
        return route.abort();
    } return route.continue(); });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && ['script', 'stylesheet'].includes(response.request().resourceType()))
        failedAssets.push(response.status() + ' ' + new URL(response.url()).pathname); });
    await page.goto(review.origin);
    const image = await actualFrame(page, review.entries.find(entry => entry.key === 'create'), review.origin);
    await image.locator('.layer-select').filter({ hasText: 'Select this shape' }).click();
    await image.locator('[data-editor-property="shape"]').selectOption('diamond');
    await image.locator('[data-editor-property="shadowEnabled"]').check();
    await image.locator('#saveProject').click();
    await image.locator('#saveStatus').filter({ hasText: 'revision 2' }).waitFor();
    const saved = review.store.read(review.store.list()[0].id);
    assert.equal(saved.document.version, 4);
    assert.equal(saved.document.layers[0].shape, 'diamond');
    assert.deepEqual(await readFile(source), original);
    for (const entry of review.entries.filter(value => value.key !== 'create')) {
        console.log('Opening ' + entry.title);
        await page.locator('#editor').selectOption(entry.key);
        await actualFrame(page, entry, review.origin);
    }
    await page.locator('#editor').selectOption('lora');
    const lora = await actualFrame(page, review.entries.find(entry => entry.key === 'lora'), review.origin);
    await lora.locator('[data-dataset-id]').first().click();
    await lora.locator('[data-editor-property="savedCaption"]').fill('Desired source saved while the worker is unavailable');
    await lora.locator('#saveSavedCaption').click();
    await lora.locator('#captionReceipt').filter({ hasText: /Source revision 1 · applied 0 · failed/ }).waitFor();
    assert.equal(await lora.locator('#appliedCaption').textContent(), 'Original caption');
    const video = review.entries.find(entry => entry.key === 'video'), queued = await jsonCall(review.origin, '/api/video/editor/projects/' + video.recordId + '/exports', { method: 'POST', body: { revision: 1 } });
    let job;
    for (let i = 0; i < 200; i++) {
        job = (await jsonCall(review.origin, '/api/video/editor/exports/' + queued.export.id)).export;
        if (!['queued', 'running'].includes(job.status))
            break;
        await new Promise(done => setTimeout(done, 100));
    }
    assert.equal(job.status, 'succeeded', job.error);
    assert.equal(job.outputFrames, 60);
    const mp4 = await fetch(review.origin + '/api/video/editor/exports/' + job.id + '/download');
    assert.equal(mp4.status, 200);
    assert.equal(Buffer.from(await mp4.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');
    for (const kind of ['pptx', 'docx', 'xlsx']) {
        const entry = review.entries.find(entry => entry.key === kind), response = await fetch(review.origin + '/api/presentations/editor/documents/' + entry.recordId + '/revisions/1/content?format=' + kind);
        assert.equal(response.status, 200, kind + ' export: ' + (response.ok ? 'ready' : await response.clone().text()));
        assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    }
    const foreign = await fetch(review.origin + '/api/create/projects', { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(foreign.status, 403);
    assert.equal((await fetch(review.origin + '/api/swarm/bots/create-editor/ask', { method: 'POST' })).status, 503);
    assert.equal((await jsonCall('http://127.0.0.1:38820', '/review/status')).publishingId, earlier.publishingId);
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
    assert.deepEqual(failedAssets, []);
});
