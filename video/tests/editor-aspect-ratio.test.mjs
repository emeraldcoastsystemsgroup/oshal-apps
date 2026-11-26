/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.5 (CREATE-TOOL-VIDEO-02): prove vertical (9:16), square (1:1) and landscape (16:9) projects across timeline validation/model/migration, FFmpeg compiler, concierge routes, real /usr/bin/ffmpeg + /usr/bin/ffprobe MP4 exports (v1 and v2), and real Chromium Playwright UI at 1440x900 and 412x915.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.14.6: update contract sourceVersion assertion to 1.14.6.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { startPostgres, resetPostgres } from './video-editor-postgres.fixture.mjs';
import { clipProbe, loadCompiled, mediaBytes, mediaForm, startApi, timeline } from './video-editor.fixture.mjs';
import { chromium, openEditor } from './video-editor-browser.fixture.mjs';
import {
  ASPECT_RATIOS, DEFAULT_ASPECT_RATIO, aspectDimensions, resolveAspectRatio, validateTimeline,
} from '../tools/editor/timeline-validation.mjs';
import { createTimeline, patchProject, setAspectRatio } from '../tools/editor/timeline-model.mjs';
import { createTimelineHistory } from '../tools/editor/timeline-history.mjs';
import { validateMultitrack } from '../tools/editor/multitrack-validation.mjs';
import { migrateMultitrack } from '../tools/editor/multitrack-model.mjs';
import { applyAgentOperations, blankProject, editingContract } from '../tools/editor/agent-tools.mjs';
import { resolveExportSpec } from '../tools/editor/editor-effects.mjs';

const execFileAsync = promisify(execFile);
const { probeWithFfprobe } = loadCompiled('video-editor-media.js');
const { compileTimeline, TimelineCompileError } = loadCompiled('video-edit-compiler.js');
const FONT_FILE = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const PHONE = { viewport: { width: 412, height: 915 }, device: { isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 } };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

let database, cleanup, browser, workDir, sampleClipBytes;

async function makeSampleClip(dir) {
  const file = join(dir, 'sample-1s.mp4');
  await execFileAsync('/usr/bin/ffmpeg', [
    '-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-frames:v', '30',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', file,
  ]);
  return readFile(file);
}

async function probeDimensions(file) {
  const { stdout } = await execFileAsync('/usr/bin/ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file]);
  const video = JSON.parse(stdout).streams.find(stream => stream.codec_type === 'video');
  return { width: Number(video.width), height: Number(video.height), codec: video.codec_name };
}

async function waitForExport(api, id) {
  let row = (await api.call(`/editor/exports/${id}`)).body.export;
  for (let i = 0; i < 80 && ['queued', 'running'].includes(row.status); i += 1) {
    await new Promise(resolve => setTimeout(resolve, 200));
    row = (await api.call(`/editor/exports/${id}`)).body.export;
  }
  return row;
}

before(async () => {
  database = await startPostgres(cb => { cleanup = cb; });
  browser = await chromium.launch({ headless: true });
  workDir = await mkdtemp(join(tmpdir(), 'video-aspect-ratio-'));
  sampleClipBytes = await makeSampleClip(workDir);
});

after(async () => {
  await browser?.close();
  await cleanup?.();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => { await resetPostgres(database.admin); });

test('model, validation, migration, history and dimension table enforce 16:9, 9:16 and 1:1', () => {
  assert.deepEqual([...ASPECT_RATIOS], ['16:9', '9:16', '1:1']);
  assert.equal(DEFAULT_ASPECT_RATIO, '16:9');
  const legacy = createTimeline('Legacy');
  assert.equal('aspectRatio' in legacy, false, 'omitted aspectRatio preserves backward-compatible shape');
  assert.equal(resolveAspectRatio(legacy), '16:9');

  for (const ratio of ['16:9', '9:16', '1:1']) {
    const v1 = createTimeline(`Doc ${ratio}`, { aspectRatio: ratio });
    assert.equal(v1.aspectRatio, ratio);
    assert.equal(validateTimeline(v1).aspectRatio, ratio);
    const v2 = migrateMultitrack(v1);
    assert.equal(v2.version, 2);
    assert.equal(v2.aspectRatio, ratio, 'upgrade to multitrack preserves aspectRatio');
    assert.equal(validateMultitrack(v2).aspectRatio, ratio);
  }

  for (const bad of ['4:3', '21:9', '', 123, null, {}]) {
    assert.throws(() => validateTimeline({ ...legacy, aspectRatio: bad }), /aspectRatio/, `v1 rejects ${JSON.stringify(bad)}`);
    assert.throws(() => validateMultitrack({ ...migrateMultitrack(legacy), aspectRatio: bad }), /aspectRatio/, `v2 rejects ${JSON.stringify(bad)}`);
  }

  const history = createTimelineHistory(createTimeline('Undo test', { aspectRatio: '16:9' }));
  history.commit(setAspectRatio(history.current(), '9:16'));
  history.commit(patchProject(history.current(), { aspectRatio: '1:1', name: 'Square cut' }));
  assert.equal(history.current().aspectRatio, '1:1');
  assert.equal(history.current().name, 'Square cut');
  assert.equal(history.undo().aspectRatio, '9:16');
  assert.equal(history.undo().aspectRatio, '16:9');
  assert.equal(history.redo().aspectRatio, '9:16');

  const expected = {
    preview: { '16:9': [640, 360], '9:16': [360, 640], '1:1': [360, 360] },
    '720p': { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720] },
    '1080p': { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] },
    '4k': { '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2160, 2160] },
  };
  for (const [res, table] of Object.entries(expected)) {
    for (const [ratio, [w, h]] of Object.entries(table)) {
      const dims = aspectDimensions(res, ratio);
      assert.deepEqual([dims.width, dims.height], [w, h], `${res} ${ratio}`);
      const spec = resolveExportSpec(res === 'preview' ? { variant: 'preview', aspectRatio: ratio } : { variant: 'export', resolution: res, fps: 30, aspectRatio: ratio });
      assert.deepEqual([spec.width, spec.height], [w, h], `resolveExportSpec ${res} ${ratio}`);
    }
  }
});

test('compiler and concierge contract derive exact canvas sizes and accept project aspectRatio patches', () => {
  const contract = editingContract();
  assert.deepEqual(contract.aspectRatios, ['16:9', '9:16', '1:1']);
  assert.equal(contract.sourceVersion, '1.14.6');
  assert.deepEqual(contract.operations.project, ['patch']);

  const blank = blankProject({ title: 'Vertical Short', aspectRatio: '9:16' });
  assert.equal(blank.version, 2);
  assert.equal(blank.aspectRatio, '9:16');
  const patched = applyAgentOperations(blank, [{ type: 'project', patch: { aspectRatio: '1:1' } }]);
  assert.equal(patched.aspectRatio, '1:1');
  assert.throws(() => blankProject({ title: 'Bad', aspectRatio: '4:3' }), /aspectRatio/);
  assert.throws(() => applyAgentOperations(blank, [{ type: 'project', patch: { aspectRatio: '4:3' } }]), /aspectRatio/);

  const source = { kind: 'video', asset: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Clip', frames: 30, width: 320, height: 180, audio: true };
  for (const [ratio, [pw, ph], [w720, h720], [w1080, h1080], [w4k, h4k]] of [
    ['16:9', [640, 360], [1280, 720], [1920, 1080], [3840, 2160]],
    ['9:16', [360, 640], [720, 1280], [1080, 1920], [2160, 3840]],
    ['1:1', [360, 360], [720, 720], [1080, 1080], [2160, 2160]],
  ]) {
    const docV1 = timeline('Shape', { v1: source }, [{ id: 's1', source: 'v1', in: 0, out: 30, volume: 100 }], { aspectRatio: ratio });
    const prev = compileTimeline({ document: docV1, media: { v1: '/tmp/a.mp4' }, variant: 'preview', fontFile: FONT_FILE });
    const c720 = compileTimeline({ document: docV1, media: { v1: '/tmp/a.mp4' }, variant: 'export', resolution: '720p', fps: 30, fontFile: FONT_FILE });
    const c1080 = compileTimeline({ document: docV1, media: { v1: '/tmp/a.mp4' }, variant: 'export', resolution: '1080p', fps: 30, fontFile: FONT_FILE });
    const c4k = compileTimeline({ document: migrateMultitrack(docV1), media: { v1: '/tmp/a.mp4' }, variant: 'export', resolution: '4k', fps: 30, fontFile: FONT_FILE });
    assert.deepEqual([prev.width, prev.height], [pw, ph]);
    assert.deepEqual([c720.width, c720.height], [w720, h720]);
    assert.deepEqual([c1080.width, c1080.height], [w1080, h1080]);
    assert.deepEqual([c4k.width, c4k.height], [w4k, h4k]);
  }
  const badDoc = timeline('Tampered', { v1: source }, [{ id: 's1', source: 'v1', in: 0, out: 30, volume: 100 }], { aspectRatio: '4:3' });
  assert.throws(() => compileTimeline({ document: badDoc, media: { v1: '/tmp/a.mp4' }, variant: 'export', fontFile: FONT_FILE }), TimelineCompileError);
});

test('concierge routes persist 9:16, 1:1 and 16:9, refuse 4:3, and capabilities advertise aspectRatios', async t => {
  const api = await startApi(t, database.pool);
  const caps = await api.call('/editor/capabilities');
  assert.equal(caps.status, 200);
  assert.deepEqual(caps.body.aspectRatios, ['16:9', '9:16', '1:1']);

  for (const ratio of ['9:16', '1:1', '16:9']) {
    const res = await api.call('/editor/agent-projects', 'POST', { title: `Concierge ${ratio}`, aspectRatio: ratio });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.project.document.aspectRatio, ratio);
    const readBack = await api.call(`/editor/projects/${res.body.project.id}`);
    assert.equal(readBack.body.project.document.aspectRatio, ratio);
  }
  const invalid = await api.call('/editor/agent-projects', 'POST', { title: 'Invalid', aspectRatio: '4:3' });
  assert.equal(invalid.status, 400);
  const invalidType = await api.call('/editor/agent-projects', 'POST', { title: 'Invalid', aspectRatio: 123 });
  assert.equal(invalidType.status, 400);

  const created = await api.call('/editor/agent-projects', 'POST', { title: 'Switchable', aspectRatio: '16:9' });
  const patched = await api.call(`/editor/projects/${created.body.project.id}/operations`, 'POST', {
    baseRevision: 1, operations: [{ type: 'project', patch: { aspectRatio: '9:16' } }],
  });
  assert.equal(patched.status, 201, JSON.stringify(patched.body));
  assert.equal(patched.body.project.document.aspectRatio, '9:16');
  const badPatch = await api.call(`/editor/projects/${created.body.project.id}/operations`, 'POST', {
    baseRevision: 2, operations: [{ type: 'project', patch: { aspectRatio: '4:3' } }],
  });
  assert.equal(badPatch.status, 400);
});

test('real FFmpeg + ffprobe MP4 export measures 720x1280 (9:16), 720x720 (1:1), 1280x720 (16:9) and v2 multitrack 720x1280', async t => {
  const api = await startApi(t, database.pool, { prober: probeWithFfprobe, exports: { fontFile: FONT_FILE } });
  const uploaded = await api.call('/editor/media?kind=video', 'POST', mediaForm(sampleClipBytes, 'sample-1s.mp4'));
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const media = uploaded.body.media;
  const source = { kind: 'video', asset: media.id, name: 'Sample', frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio };

  for (const [ratio, expectedWidth, expectedHeight] of [['9:16', 720, 1280], ['1:1', 720, 720], ['16:9', 1280, 720]]) {
    const doc = timeline(`Export ${ratio}`, { v1: source }, [{ id: 's1', source: 'v1', in: 0, out: media.frames, volume: 100 }], { aspectRatio: ratio });
    const created = await api.call('/editor/projects', 'POST', { title: doc.name, document: doc });
    assert.equal(created.status, 201);
    const started = await api.call(`/editor/projects/${created.body.project.id}/exports`, 'POST', { revision: 1, variant: 'export', resolution: '720p', fps: 30 });
    assert.equal(started.status, 202);
    const done = await waitForExport(api, started.body.export.id);
    assert.equal(done.status, 'succeeded', `v1 ${ratio} export failed: ${done.error}`);
    const dl = await api.call(`/editor/exports/${done.id}/download`);
    assert.equal(dl.status, 200);
    const outPath = join(workDir, `v1-${ratio.replace(':', 'x')}.mp4`);
    await writeFile(outPath, dl.body);
    const measured = await probeDimensions(outPath);
    assert.equal(measured.width, expectedWidth, `v1 ${ratio} width`);
    assert.equal(measured.height, expectedHeight, `v1 ${ratio} height`);
    assert.equal(measured.codec, 'h264');
  }

  const agentCreated = await api.call('/editor/agent-projects', 'POST', { title: 'Concierge Vertical', aspectRatio: '9:16' });
  assert.equal(agentCreated.status, 201);
  const edited = await api.call(`/editor/projects/${agentCreated.body.project.id}/operations`, 'POST', {
    baseRevision: 1,
    operations: [
      { type: 'addSource', sourceMetadata: source },
      { type: 'addClip', track: 'video1', sourceKey: 'v1', start: 0, in: 0, out: media.frames },
      { type: 'text', track: 'titles', entry: { text: 'Vertical', start: 0, end: media.frames, position: 'top', size: 'medium' } },
    ],
  });
  assert.equal(edited.status, 201, JSON.stringify(edited.body));
  const startedV2 = await api.call(`/editor/projects/${agentCreated.body.project.id}/exports`, 'POST', { revision: 2, variant: 'export', resolution: '720p', fps: 30 });
  assert.equal(startedV2.status, 202);
  const doneV2 = await waitForExport(api, startedV2.body.export.id);
  assert.equal(doneV2.status, 'succeeded', `v2 9:16 export failed: ${doneV2.error}`);
  const dlV2 = await api.call(`/editor/exports/${doneV2.id}/download`);
  const outV2 = join(workDir, 'v2-9x16.mp4');
  await writeFile(outV2, dlV2.body);
  const measuredV2 = await probeDimensions(outV2);
  assert.equal(measuredV2.width, 720, 'v2 9:16 width');
  assert.equal(measuredV2.height, 1280, 'v2 9:16 height');
});

test('Chromium UI picks 9:16, 1:1 and 16:9 on screen, persists save/reopen/concierge update, and has zero overflow at 412x915', async t => {
  const { page, api, errors } = await openEditor(t, browser, database, { ...DESKTOP, theme: 'graphite' });
  const screenRatio = async targetPage => targetPage.locator('#previewScreen').evaluate(el => {
    const box = el.getBoundingClientRect();
    return { attr: el.getAttribute('data-aspect-ratio'), width: box.width, height: box.height, ratio: box.width / box.height };
  });

  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New project' }).click();
  const newSheet = page.locator('dialog.ds-layer[open][aria-label="New project"]');
  await newSheet.waitFor();
  await newSheet.locator('[data-new-project-title]').fill('Vertical Launch');
  await newSheet.locator('[data-new-aspect-ratio="9:16"]').click();
  await newSheet.locator('[data-new-project-create]').click();
  await newSheet.waitFor({ state: 'detached' });

  assert.equal(await page.locator('#projectAspectRatio').inputValue(), '9:16');
  const vertBox = await screenRatio(page);
  assert.equal(vertBox.attr, '9:16');
  assert.ok(Math.abs(vertBox.ratio - 9 / 16) < 0.04, `expected 9:16 preview, got ${vertBox.width}x${vertBox.height}`);

  await page.locator('#projectAspectRatio').selectOption('1:1');
  const sqBox = await screenRatio(page);
  assert.equal(sqBox.attr, '1:1');
  assert.ok(Math.abs(sqBox.ratio - 1) < 0.04, `expected 1:1 preview, got ${sqBox.width}x${sqBox.height}`);

  await page.locator('#addClip').setInputFiles({ name: 'Square.mp4', mimeType: 'video/mp4', buffer: mediaBytes('video', clipProbe({ seconds: 2 })) });
  await page.locator('#status').filter({ hasText: 'Square.mp4 added.' }).waitFor();
  await page.locator('#saveProject').click();
  await page.locator('#status').filter({ hasText: 'Saved · revision 1' }).waitFor();

  const projectId = new URL(page.url()).searchParams.get('project');
  await page.reload();
  await page.locator('html[data-editor-ready="true"]').waitFor();
  assert.equal(await page.locator('#projectAspectRatio').inputValue(), '1:1');
  assert.equal((await screenRatio(page)).attr, '1:1');

  await page.locator('button.video-export').click();
  const expSheet = page.locator('dialog.ds-layer[open][aria-label="Export"]');
  await expSheet.waitFor();
  assert.match(await expSheet.locator('[data-export-summary-row]').innerText(), /720×720/);
  await page.goBack();
  await expSheet.waitFor({ state: 'detached' });

  const patched = await api.call(`/editor/projects/${projectId}/operations`, 'POST', {
    baseRevision: 1, operations: [{ type: 'project', patch: { aspectRatio: '9:16' } }],
  });
  assert.equal(patched.status, 201);
  await page.reload();
  await page.locator('html[data-editor-ready="true"]').waitFor();
  assert.equal(await page.locator('#projectAspectRatio').inputValue(), '9:16');
  assert.equal((await screenRatio(page)).attr, '9:16');

  await page.locator('#projectAspectRatio').selectOption('16:9');
  const wideBox = await screenRatio(page);
  assert.equal(wideBox.attr, '16:9');
  assert.ok(Math.abs(wideBox.ratio - 16 / 9) < 0.05, `expected 16:9 preview, got ${wideBox.width}x${wideBox.height}`);
  assert.deepEqual(errors, []);

  const phone = await openEditor(t, browser, database, { ...PHONE, theme: 'graphite' });
  for (const [ratio, expectedRatio] of [['9:16', 9 / 16], ['1:1', 1], ['16:9', 16 / 9]]) {
    await phone.page.locator('#projectAspectRatio').selectOption(ratio);
    const box = await screenRatio(phone.page);
    assert.equal(box.attr, ratio);
    assert.ok(Math.abs(box.ratio - expectedRatio) < 0.05, `phone ${ratio}: ${box.width}x${box.height}`);
    const overflow = await phone.page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    assert.ok(overflow <= 1, `phone 412x915 overflow for ${ratio}: ${overflow}px`);
  }
  assert.deepEqual(phone.errors, []);
});
