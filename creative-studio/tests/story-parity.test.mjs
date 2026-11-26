/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Creative Studio 1.5.2 tool-parity verification suite covering CREATE-TOOL-CREATIVE-STUDIO-01..05: route-backed API tool contracts, persona tool-reference audit across every creative-studio/personas/*.yaml file, owner-scoped PostgreSQL 16 forced-RLS story library/jobs/next/produce API proof, and real Chromium desktop (1440x900) and mobile (412x915) UI verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, dependencies } from './fixtures/editor-source-postgres.fixture.mjs';

const pkgRoot = fileURLToPath(new URL('../', import.meta.url));
const reqDeps = dependencies();
const { createSourceProjectRoutes } = await import('../routes/source-projects.mjs');
const yaml = reqDeps('js-yaml');
const manifest = yaml.load(readFileSync(resolve(pkgRoot, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(readFileSync(resolve(pkgRoot, 'authorization.yaml'), 'utf8'));

function actors() {
  return {
    alice: { issuer: 'https://crs-parity.fixture', sub: 'alice', principalId: 'p-alice', tenantIds: ['t-alice'], isActive: true },
    bob: { issuer: 'https://crs-parity.fixture', sub: 'bob', principalId: 'p-bob', tenantIds: ['t-bob'], isActive: true },
  };
}

async function startParityServer(t, pool, { platform = null } = {}) {
  const express = reqDeps('express');
  await pool.query(await readFile(resolve(pkgRoot, 'migrations/007-creative-studio-rp-enhancements.sql'), 'utf8'));
  await pool.query(await readFile(resolve(pkgRoot, 'migrations/008-creative-studio-story-runs.sql'), 'utf8'));
  const people = actors();
  let current = people.alice;
  let workerOnline = false;
  const enqueued = [];
  const ctx = {
    appPackageDir: pkgRoot,
    pool,
    vidsWorkerRegistry: {
      listClients: () => (workerOnline ? [{ clientId: 'vids-worker-1', status: 'online', healthy: true, capabilities: ['content.next', 'content.produce'] }] : []),
      enqueueTask: async (clientId, task) => { enqueued.push({ clientId, task }); return { taskId: task.taskId }; },
    },
    intent: async () => ({ app: 'creative-studio', principal: { id: current.principalId, issuer: current.issuer, subject: current.sub, tenant: current.tenantIds[0], state: 'active' } }),
    authorization: {
      registerResource() {},
      currentActor: () => current,
      authorize: async () => ({ allowed: true }),
    },
  };
  const app = express();
  app.use((reqObj, _res, next) => {
    current = reqObj.headers['x-test-actor'] === 'bob' ? people.bob : people.alice;
    next();
  });
  app.use('/api/creative-studio', createSourceProjectRoutes(ctx));
  app.get('/api/creative-studio/review', (_q, res) => res.sendFile(resolve(pkgRoot, 'tools/review.html')));
  app.get('/api/creative-studio/home-summary', (_q, res) => res.json({ metrics: [], items: [] }));
  app.get('/api/swarm/apps/home-plan', (_q, res) => res.json({ apps: [] }));
  if (platform) {
    app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
    app.use('/cockpit', express.static(resolve(platform, 'src/pages/cockpit')));
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    setWorkerOnline: val => { workerOnline = val; },
    enqueued,
  };
}

async function apiJson(origin, path, { method = 'GET', body, actor = 'alice', headers = {} } = {}) {
  const res = await fetch(`${origin}/api/creative-studio${path}`, {
    method,
    headers: { 'x-test-actor': actor, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('CREATE-TOOL-CREATIVE-STUDIO-02: every declared tool is a route-backed API tool under /api/creative-studio with matching catalog binding', () => {
  assert.ok(Array.isArray(manifest.tools) && manifest.tools.length >= 8);
  const byName = new Map(manifest.tools.map(t => [t.name, t]));
  for (const name of ['creative-studio-library', 'creative_list', 'creative_produce_next', 'creative_produce']) {
    assert.ok(byName.has(name), `${name} is declared in oshal-app.yaml`);
  }
  for (const tool of manifest.tools) {
    assert.equal(tool.executor?.executorType, 'api', `${tool.name} uses api executor (never cli)`);
    const [method, rawPath] = String(tool.executor.apiEndpoint || '').split(' ');
    const routePath = rawPath.split('?')[0];
    assert.ok(routePath.startsWith('/api/creative-studio/'), `${tool.name} stays inside /api/creative-studio mount`);
    const toolBind = catalog.bindings.tools.find(b => b.id === tool.name);
    assert.ok(toolBind, `${tool.name} has a bindings.tools entry`);
    const rel = routePath.slice('/api/creative-studio'.length).replaceAll('{input.id}', 'owned-id');
    const relParts = rel.split('/');
    const httpBind = catalog.bindings.http.find(b => {
      if (b.method !== method) return false;
      const bParts = b.path.split('/');
      return bParts.length === relParts.length && bParts.every((seg, idx) => seg === relParts[idx] || (seg.startsWith(':') && relParts[idx]));
    });
    assert.ok(httpBind, `${tool.name} has a matching bindings.http entry (${method} ${rel})`);
    assert.deepEqual(toolBind.allOf, httpBind.allOf, `${tool.name} tool and HTTP permissions match exactly`);
  }
  for (const writeTool of ['creative_produce_next', 'creative_produce']) {
    const t = byName.get(writeTool);
    assert.equal(t.defaultAuthMode, 'ask');
    assert.equal(t.requiresApproval, true);
    assert.ok(typeof t.cardText === 'string' && t.cardText.length >= 12, `${writeTool} declares clear cardText`);
  }
  for (const readTool of ['creative-studio-library', 'creative_list']) {
    const t = byName.get(readTool);
    assert.equal(t.defaultAuthMode, 'auto');
    assert.equal(t.requiresApproval, false);
  }
});

test('CREATE-TOOL-CREATIVE-STUDIO-03: every persona in creative-studio/personas/ names only real API tools in oshal-app.yaml and authorization.yaml', () => {
  const apiTools = new Map(manifest.tools.filter(t => t.executor?.executorType === 'api').map(t => [t.name, t]));
  const boundToolIds = new Set(catalog.bindings.tools.map(b => b.id));
  const files = readdirSync(resolve(pkgRoot, 'personas')).filter(f => f.endsWith('.yaml')).sort();
  assert.deepEqual(files, ['creative-producer.yaml', 'story-editor.yaml', 'vids-operator.yaml']);
  const forbidden = ['trade_recap_pipeline', 'vids-jobs', 'vids-generate-clip', 'vids-brand-graphic', 'vids_generate', 'oshal-vids.js', '/app/scripts/', 'veo-prompt-craft', 'read_file', 'write_file'];
  for (const file of files) {
    const persona = yaml.load(readFileSync(resolve(pkgRoot, 'personas', file), 'utf8'));
    const auths = persona.authorizations || {};
    assert.ok(Object.keys(auths).length > 0, `${file} declares authorizations`);
    for (const toolName of Object.keys(auths)) {
      assert.ok(apiTools.has(toolName), `${file} authorization ${toolName} exists in oshal-app.yaml with executorType: api`);
      assert.ok(boundToolIds.has(toolName), `${file} authorization ${toolName} is bound in authorization.yaml`);
    }
    const text = String(persona.perspective || '');
    for (const bad of forbidden) {
      assert.equal(text.includes(bad), false, `${file} must not reference retired/unavailable tool or script "${bad}"`);
    }
    assert.match(text, /plain prose/i, `${file} carries plain-prose rule`);
    assert.ok(text.includes('```tool_call'), `${file} teaches tool_call fence`);
  }
});

test('CREATE-TOOL-CREATIVE-STUDIO-01, -04, -05: owner-scoped API routes validate bounds, handle no-worker honestly, queue with worker, and enforce RLS', async t => {
  const db = await fixture(t, 'story_source');
  const srv = await startParityServer(t, db.pool);

  // Browse library initially (nothing made yet, no worker online)
  const lib0 = await apiJson(srv.origin, '/stories/library');
  assert.equal(lib0.status, 200);
  assert.ok(lib0.body.stories.length >= 6);
  assert.equal(lib0.body.workerOnline, false);
  assert.equal(lib0.body.stories.every(s => s.made === false), true);
  assert.equal(lib0.body.nextStory.slug, 'tortoise-and-hare');

  // Make next story with no worker online -> honest 503 worker_unavailable
  const noWorker = await apiJson(srv.origin, '/stories/next', { method: 'POST', body: {} });
  assert.equal(noWorker.status, 503);
  assert.equal(noWorker.body.error, 'worker_unavailable');
  assert.match(noWorker.body.message, /No Vids worker is online/i);

  // Turn worker online -> Make next story queues tortoise-and-hare and flips it to Made
  srv.setWorkerOnline(true);
  const nextQueued = await apiJson(srv.origin, '/stories/next', { method: 'POST', body: { sceneCount: 5, shape: '16:9' } });
  assert.equal(nextQueued.status, 201);
  assert.equal(nextQueued.body.status, 'queued');
  assert.equal(nextQueued.body.job.storySlug, 'tortoise-and-hare');
  assert.equal(nextQueued.body.job.sceneCount, 5);
  assert.equal(nextQueued.body.project.revision, 1);
  assert.equal(srv.enqueued.length, 1);

  const lib1 = await apiJson(srv.origin, '/stories/library');
  assert.equal(lib1.body.stories.find(s => s.slug === 'tortoise-and-hare').made, true);
  assert.equal(lib1.body.nextStory.slug, 'raining-cats-and-dogs');

  // Produce specific library story by title with worker offline -> awaiting_worker + persisted source project
  srv.setWorkerOnline(false);
  const byTitle = await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { story: 'The Fox and the Grapes', sceneCount: 4, shape: '1:1' } });
  assert.equal(byTitle.status, 201);
  assert.equal(byTitle.body.status, 'awaiting_worker');
  assert.equal(byTitle.body.job.storySlug, 'fox-and-grapes');
  assert.equal(byTitle.body.job.shape, '1:1');

  // Produce custom story with title, script, sceneCount, shape -> persisted on both job and source project
  const custom = await apiJson(srv.origin, '/stories/produce', {
    method: 'POST',
    body: {
      title: 'Moonlit Harbor',
      script: 'Lanterns glowed along the quiet pier. A paper boat drifted past the lighthouse. Dolphins leaped under silver clouds. Morning bells greeted the little fleet.',
      sceneCount: 6,
      shape: '9:16',
    },
  });
  assert.equal(custom.status, 201);
  assert.equal(custom.body.job.title, 'Moonlit Harbor');
  assert.equal(custom.body.job.sceneCount, 6);
  assert.equal(custom.body.job.shape, '9:16');
  assert.ok(custom.body.project?.id);

  const projRead = await apiJson(srv.origin, `/source-projects/${custom.body.project.id}`);
  assert.equal(projRead.status, 200);
  assert.equal(projRead.body.project.model.aspectRatio, '9:16');
  assert.equal(projRead.body.project.model.scenes.length, 6);

  // Strict 400 validation checks + scope spoof rejection
  assert.equal((await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { title: 'Only title' } })).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { script: 'Only script' } })).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { title: 'Bad scenes', script: 'Hello world.', sceneCount: 13, shape: '16:9' } })).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { title: 'Bad shape', script: 'Hello world.', sceneCount: 4, shape: '4:3' } })).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/produce', { method: 'POST', body: { story: 'no-such-story' } })).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/jobs?tenantId=other')).status, 400);
  assert.equal((await apiJson(srv.origin, '/stories/jobs', { headers: { 'x-oshal-tenant-id': 'other' } })).status, 400);

  // Owner isolation (Bob sees zero of Alice's jobs and cannot delete them)
  const aliceJobs = await apiJson(srv.origin, '/stories/jobs');
  assert.equal(aliceJobs.status, 200);
  assert.equal(aliceJobs.body.jobs.length, 3);
  const bobJobs = await apiJson(srv.origin, '/stories/jobs', { actor: 'bob' });
  assert.equal(bobJobs.status, 200);
  assert.deepEqual(bobJobs.body.jobs, []);
  const bobDel = await apiJson(srv.origin, `/stories/jobs/${custom.body.job.id}`, { method: 'DELETE', actor: 'bob' });
  assert.equal(bobDel.status, 404);

  // Alice deletes her custom job cleanly
  const aliceDel = await apiJson(srv.origin, `/stories/jobs/${custom.body.job.id}`, { method: 'DELETE' });
  assert.equal(aliceDel.status, 200);
  assert.equal(aliceDel.body.deleted, true);
});

test('Chromium 1440x900 and 412x915: Make the next story, Story library Made badges, Custom story form, and Recorded work', async t => {
  const platform = process.env.OSHAL_PLATFORM_ROOT;
  assert.ok(platform, 'OSHAL_PLATFORM_ROOT required for Chromium proof');
  const db = await fixture(t, 'story_source');
  const srv = await startParityServer(t, db.pool, { platform });
  const { chromium } = reqDeps('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto(`${srv.origin}/api/creative-studio/review`);
  await page.locator('#makeNextStoryBtn').waitFor();
  await page.locator('[data-story-slug="tortoise-and-hare"]').waitFor();

  // Desktop zero horizontal overflow
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'zero horizontal overflow at 1440x900');

  // 1. Click Make the next story with no worker -> plain-English inline feedback
  await page.locator('#makeNextStoryBtn').click();
  await page.locator('#storyProductionStatus').filter({ hasText: /No Vids worker is online/i }).waitFor();

  // 2. Worker online -> Make the next story queues tortoise-and-hare, shows in Recorded work & flips Made badge
  srv.setWorkerOnline(true);
  await page.locator('#makeNextStoryBtn').click();
  await page.locator('#storyJobsRecords').filter({ hasText: 'The Tortoise and the Hare' }).waitFor();
  await page.locator('[data-story-slug="tortoise-and-hare"] [data-story-status="made"]').waitFor();

  // 3. Choose / Produce from Story library
  await page.locator('[data-choose-story="raining-cats-and-dogs"]').click();
  await page.locator('#storyJobsRecords').filter({ hasText: 'Raining Cats and Dogs' }).waitFor();
  await page.locator('[data-story-slug="raining-cats-and-dogs"] [data-story-status="made"]').waitFor();

  // 4. Custom story form (title, script, sceneCount, shape)
  srv.setWorkerOnline(false);
  await page.locator('#customStoryTitle').fill('Starlight Train');
  await page.locator('#customStoryScript').fill('A brass locomotive crossed the midnight bridge. Fireflies danced beside the windows. Every passenger smiled at the quiet valley.');
  await page.locator('#customStoryScenes').fill('5');
  await page.locator('#customStoryShape').selectOption('9:16');
  await page.locator('#produceCustomStoryBtn').click();
  await page.locator('#storyJobsRecords').filter({ hasText: /Starlight Train.*5 scenes · 9:16/ }).waitFor();

  // 5. Verify mobile viewport 412x915 has zero horizontal overflow and visible controls
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'zero horizontal overflow at 412x915');
  assert.equal(await page.locator('#makeNextStoryBtn').isVisible(), true);
  assert.equal(await page.locator('#customStoryTitle').isVisible(), true);
  assert.deepEqual(dialogs, [], 'no native alert/confirm dialogs');
  assert.deepEqual(errors, [], 'zero page errors');
});
