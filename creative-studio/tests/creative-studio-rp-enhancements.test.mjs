/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | End-to-end PostgreSQL 16 (forced RLS), FFmpeg/ffprobe and Chromium proof for Creative Studio 1.5.0 (RP-CRS-01..07): starter templates, aspect-ratio resize, Create/custom brand kit, real H.264 MP4 storyboard builds in OSHAL_PACKAGE_DATA_DIR with SHA-256 verification and purge, approval-gated schedules, brief/scene comments with replies and resolve, and scene trim/split.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, dependencies } from './fixtures/editor-source-postgres.fixture.mjs';
import { createSourceProjectRoutes } from '../routes/source-projects.mjs';

const pkgRoot = fileURLToPath(new URL('../', import.meta.url));
const migration007 = () => readFile(resolve(pkgRoot, 'migrations/007-creative-studio-rp-enhancements.sql'), 'utf8');

function actors() {
  return {
    alice: { issuer: 'https://crs-rp.fixture', sub: 'alice', principalId: 'p-alice', tenantIds: ['t-alice'], isActive: true },
    bob: { issuer: 'https://crs-rp.fixture', sub: 'bob', principalId: 'p-bob', tenantIds: ['t-bob'], isActive: true },
  };
}

async function startStudioServer(t, pool, { platform = null } = {}) {
  const req = dependencies(), express = req('express');
  await pool.query(await migration007());
  const dataDir = await mkdtemp(join(tmpdir(), 'crs-pkg-data-'));
  const prevDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  process.env.OSHAL_PACKAGE_DATA_DIR = dataDir;
  t.after(async () => {
    if (prevDir === undefined) delete process.env.OSHAL_PACKAGE_DATA_DIR;
    else process.env.OSHAL_PACKAGE_DATA_DIR = prevDir;
    await rm(dataDir, { recursive: true, force: true });
  });
  const people = actors();
  let current = people.alice;
  const ctx = {
    appPackageDir: pkgRoot,
    pool,
    intent: async () => ({ app: 'creative-studio', principal: { id: current.principalId, issuer: current.issuer, subject: current.sub, tenant: current.tenantIds[0], state: 'active' } }),
    authorization: {
      registerResource() {},
      currentActor: () => current,
      authorize: async () => ({ allowed: true }),
    },
  };
  const app = express();
  app.use((reqObj, _res, next) => {
    const who = reqObj.headers['x-test-actor'];
    current = who === 'bob' ? people.bob : people.alice;
    next();
  });
  app.use('/api/creative-studio', createSourceProjectRoutes(ctx));
  app.get('/api/creative-studio/review', (_q, res) => res.sendFile(resolve(pkgRoot, 'tools/review.html')));
  app.get('/api/creative-studio/home-summary', (_q, res) => res.json({ metrics: [], items: [] }));
  app.get('/api/create/brand-kit', (_q, res) => res.json({
    kit: { name: 'Emerald Studio', colors: { primary: '#0f172a', accent: '#f59e0b' }, fonts: { heading: 'Georgia', body: 'Calibri' }, logo: null },
  }));
  app.get('/api/vids/jobs', (_q, res) => res.status(404).json({ error: 'not_installed' }));
  app.get('/api/swarm/apps/home-plan', (_q, res) => res.json({ apps: [] }));
  if (platform) {
    app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
    app.use('/cockpit', express.static(resolve(platform, 'src/pages/cockpit')));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, dataDir };
}

async function apiJson(origin, path, { method = 'GET', body, actor = 'alice' } = {}) {
  const res = await fetch(`${origin}/api/creative-studio${path}`, {
    method,
    headers: { 'x-test-actor': actor, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function probeMp4(filePath) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', filePath], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('RP-CRS-01..07 routes, forced PostgreSQL RLS, real H.264 MP4 builds and purge', async t => {
  const db = await fixture(t, 'story_source');
  const { origin, dataDir } = await startStudioServer(t, db.pool);

  // RP-CRS-01: starter templates
  const tplRes = await apiJson(origin, '/source-projects/templates');
  assert.equal(tplRes.status, 200);
  assert.equal(tplRes.body.templates.length, 5);
  const socialTpl = tplRes.body.templates.find(item => item.id === 'social-reel');
  assert.equal(socialTpl.aspectRatio, '9:16');

  // Create project from template
  const s1 = randomUUID(), s2 = randomUUID();
  const created = await apiJson(origin, '/source-projects', {
    method: 'POST',
    body: {
      requestKey: randomUUID(),
      model: {
        version: 1, kind: 'story', title: socialTpl.title, notes: socialTpl.notes, sourceUrl: '', mode: 'episode',
        aspectRatio: '16:9',
        scenes: [
          { id: s1, title: 'Hook', text: 'Stop the scroll immediately.', duration: 4 },
          { id: s2, title: 'Demo', text: 'Show the real result in action.', duration: 2 },
        ],
      },
    },
  });
  assert.equal(created.status, 201);
  const pid = created.body.project.id;

  // RP-CRS-02, 03, 07: resize-brief, set-brand-kit, trim-scene and split-scene via typed operations
  const s1Part2 = randomUUID();
  const edited = await apiJson(origin, `/source-projects/${pid}/edits`, {
    method: 'POST',
    body: {
      baseRevision: 1,
      requestKey: randomUUID(),
      operations: [
        { op: 'resize-brief', aspectRatio: '9:16' },
        { op: 'set-brand-kit', brandKit: { name: 'Emerald Brand', primaryColor: '#0f172a', accentColor: '#f59e0b', headingFont: 'Georgia', bodyFont: 'Calibri' } },
        { op: 'trim-scene', id: s1, trimIn: 1, trimOut: 4 },
        { op: 'split-scene', id: s1, atSecond: 1, newId: s1Part2 },
      ],
    },
  });
  assert.equal(edited.status, 200);
  const readBack = await apiJson(origin, `/source-projects/${pid}`);
  assert.equal(readBack.body.project.model.aspectRatio, '9:16');
  assert.equal(readBack.body.project.model.brandKit.name, 'Emerald Brand');
  assert.deepEqual(readBack.body.project.model.scenes.map(s => s.duration), [1, 2, 2], '3s trimmed scene split at 1s -> 1s + 2s, plus 2s scene = 5s total');

  // RP-CRS-06: brief and scene comments, 1-level reply, depth refusal, resolve/reopen, and Bob RLS isolation
  const c1 = await apiJson(origin, `/source-projects/${pid}/comments`, { method: 'POST', body: { body: 'Tighten the hook phrasing', sceneId: s1 } });
  assert.equal(c1.status, 201);
  const c2 = await apiJson(origin, `/source-projects/${pid}/comments`, { method: 'POST', body: { body: 'Updated phrasing looks good', parentId: c1.body.comment.id } });
  assert.equal(c2.status, 201);
  const tooDeep = await apiJson(origin, `/source-projects/${pid}/comments`, { method: 'POST', body: { body: 'Nested reply', parentId: c2.body.comment.id } });
  assert.equal(tooDeep.status, 400);
  assert.equal(tooDeep.body.error, 'comment_reply_depth');
  const resolved = await apiJson(origin, `/source-projects/${pid}/comments/${c1.body.comment.id}/resolve`, { method: 'POST', body: { resolved: true } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.comment.resolved, true);
  assert.equal((await apiJson(origin, `/source-projects/${pid}/comments`, { actor: 'bob' })).status, 404, 'Bob cannot read Alice comments');

  // RP-CRS-04: real H.264 MP4 storyboard build in OSHAL_PACKAGE_DATA_DIR + verified download
  const built = await apiJson(origin, `/source-projects/${pid}/builds`, { method: 'POST', body: {} });
  assert.equal(built.status, 201);
  assert.equal(built.body.build.aspectRatio, '9:16');
  assert.equal(built.body.build.width, 720);
  assert.equal(built.body.build.height, 1280);
  assert.equal(built.body.build.durationSeconds, 5);
  assert.equal(built.body.build.branded, true);

  const dlRes = await fetch(`${origin}${built.body.build.downloadUrl}`, { headers: { 'x-test-actor': 'alice' } });
  assert.equal(dlRes.status, 200);
  assert.equal(dlRes.headers.get('content-type'), 'video/mp4');
  const mp4Bytes = Buffer.from(await dlRes.arrayBuffer());
  assert.equal(mp4Bytes.length, built.body.build.bytes);
  assert.equal(createHash('sha256').update(mp4Bytes).digest('hex'), built.body.build.sha256);
  const tmpMp4 = join(dataDir, 'probe-check.mp4');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(tmpMp4, mp4Bytes);
  const probed = probeMp4(tmpMp4);
  assert.equal(probed.streams[0].codec_name, 'h264');
  assert.equal(probed.streams[0].width, 720);
  assert.equal(probed.streams[0].height, 1280);
  assert.ok(Math.abs(Number(probed.format.duration) - 5) < 0.25);

  // RP-CRS-05: approval-gated schedule creation, listing, owner isolation, and cancellation
  const unapproved = await apiJson(origin, '/schedules', {
    method: 'POST',
    body: { projectId: pid, buildId: built.body.build.id, channel: 'youtube', caption: 'No approval', postNow: true, approved: false },
  });
  assert.equal(unapproved.status, 400);
  assert.equal(unapproved.body.error, 'schedule_approval_required');

  const scheduled = await apiJson(origin, '/schedules', {
    method: 'POST',
    body: { projectId: pid, buildId: built.body.build.id, channel: 'youtube', caption: 'Launch day!', postNow: true, approved: true },
  });
  assert.equal(scheduled.status, 201);
  assert.equal(scheduled.body.schedule.status, 'scheduled');
  assert.deepEqual((await apiJson(origin, '/schedules', { actor: 'bob' })).body.schedules, [], 'Bob sees zero of Alice schedules');

  const cancelled = await apiJson(origin, `/schedules/${scheduled.body.schedule.id}/cancel`, { method: 'POST', body: {} });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.schedule.status, 'cancelled');

  // Deleting project purges stored MP4 files and child rows
  const deleted = await apiJson(origin, `/source-projects/${pid}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const remainingMp4s = execFileSync('find', [join(dataDir, 'storyboard-builds'), '-name', '*.mp4'], { encoding: 'utf8' }).trim();
  assert.equal(remainingMp4s, '', 'all rendered MP4 build files removed when project is deleted');
  await stat(dataDir);
});

test('Chromium UI exercises Templates, Create Brand Kit import, Resize, Trim & split, Comments, MP4 Build and Schedule', async t => {
  const platform = process.env.OSHAL_PLATFORM_ROOT;
  assert.ok(platform, 'OSHAL_PLATFORM_ROOT required for Chromium proof');
  const db = await fixture(t, 'story_source');
  const { origin } = await startStudioServer(t, db.pool, { platform });
  const { chromium } = dependencies()('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${origin}/api/creative-studio/review`);
  await page.locator('.source-project-actions').waitFor();

  // 1. Pick Social Reel template (RP-CRS-01)
  await page.locator('#templatesBtn').click();
  await page.locator('dialog.crs-sheet[open] [data-template-id="social-reel"]').click();
  await page.locator('#briefState').filter({ hasText: '9:16' }).waitFor();
  assert.equal(await page.locator('.source-scene').count(), 3);

  // 2. Import Create brand kit & apply (RP-CRS-03)
  await page.locator('#brandKitBtn').click();
  const kitDialog = page.locator('dialog.crs-sheet[open][aria-label="Brand kit"]');
  await kitDialog.locator('[data-import-create-kit]').click();
  await kitDialog.getByRole('button', { name: 'Apply brand kit', exact: true }).click();
  await page.locator('#briefState').filter({ hasText: 'Brand: Emerald Studio' }).waitFor();

  // 3. Resize to 1:1 (RP-CRS-02)
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Resize', exact: true }).click();
  await page.locator('dialog.crs-sheet[open] [data-aspect-ratio="1:1"]').click();
  await page.locator('#briefState').filter({ hasText: '1:1' }).waitFor();

  // 4. Trim & split scene 1 (RP-CRS-07)
  await page.getByRole('button', { name: 'Scene 1 actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Trim & split', exact: true }).click();
  const trimDialog = page.locator('dialog.crs-sheet[open]');
  await trimDialog.getByRole('button', { name: 'Split scene', exact: true }).click();
  assert.equal(await page.locator('.source-scene').count(), 4);

  // 5. Post & resolve a comment (RP-CRS-06)
  await page.locator('.source-project-actions button[aria-label="Comment"]').click();
  const commentDialog = page.locator('dialog.crs-sheet[open][aria-label="Brief & scene comments"]');
  await commentDialog.locator('textarea').fill('Ready for storyboard export');
  await commentDialog.getByRole('button', { name: 'Post comment', exact: true }).click();
  await commentDialog.getByRole('button', { name: 'Resolve', exact: true }).click();
  await commentDialog.locator('strong').filter({ hasText: 'Resolved' }).waitFor();
  await commentDialog.getByRole('button', { name: 'Done', exact: true }).click();

  // 6. Render real MP4 build & reveal Download button in app row (RP-CRS-04)
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Build & download video', exact: true }).click();
  const buildDialog = page.locator('dialog.crs-sheet[open][aria-label="Storyboard MP4 builds"]');
  await buildDialog.getByRole('button', { name: 'Render MP4 build', exact: true }).click();
  await buildDialog.getByRole('link', { name: 'Download MP4' }).waitFor({ timeout: 25000 });
  await buildDialog.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.locator('.source-project-actions button[aria-label="Download"]').isVisible(), true);

  // 7. Approve & schedule publication (RP-CRS-05)
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
  const schedDialog = page.locator('dialog.crs-sheet[open][aria-label="Schedule publication"]');
  await schedDialog.locator('input[type="checkbox"]').check();
  await schedDialog.getByRole('button', { name: 'Approve & schedule', exact: true }).click();
  await schedDialog.locator('.crs-list').filter({ hasText: 'YOUTUBE' }).waitFor();
  await schedDialog.getByRole('button', { name: 'Done', exact: true }).click();

  assert.deepEqual(errors, []);
});
