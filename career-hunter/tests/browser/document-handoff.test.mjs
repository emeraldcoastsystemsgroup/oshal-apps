/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the shared document handoff on the shipped Resume Studio and Profile Studio pages in Chromium with the real shared module: unsaved edits are saved through the compiled routes before an assistant reads (the master resume through the real engine dispatch, runner, launcher and engine on a fixture store; the profile plan through the PostgreSQL ProfilePlanStore compiled in the core checkout, on a disposable database), the context carries the record id and revision, an edit saved through the same routes is shown after refresh, the next manual edit reaches the next handoff, and unsaved edits survive a refresh. Scoped doubles: the kernel leaves in tests/helpers/career-route-harness.mjs, the Firecrawl pool query (no row), and the Career bot turn (executeBotOrInline), which answers the studios' embedded editor and AI draft with fixed JSON and records the prompt it was given.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, isolateRunnerEnv, loadCompiledModules, startServer } from '../helpers/career-route-harness.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreRoot = path.resolve(process.env.OSHAL_CORE_ROOT || path.resolve(packageRoot, '../../oshal'));
const platform = process.env.OSHAL_PLATFORM_ROOT ? path.resolve(process.env.OSHAL_PLATFORM_ROOT) : '';
const adminUrl = process.env.OSHAL_TEST_POSTGRES || '';
const requireCore = createRequire(path.join(coreRoot, 'package.json'));
const PLAN_STORE = './dist/features/profile-studio/services/profile-plan-store.js';
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'career-document-handoff-'));
const SEED = {
  profile: { name: 'Handoff Candidate', credential: 'PMP', experience_summary: 'Seasoned platform lead.' },
  roles: [{ title: 'Platform Lead', org: 'Acme', start: '2019-01', end: null, deliverables: ['Shipped the platform'] }],
  skills: { Cloud: { items: ['AWS'] } },
};
const resumeEdits = [];
const draftPrompts = [];
let server, baseUrl, routes, restoreEnv, browser, pg, pool, database;

/** The Career bot turn, doubled: the embedded editor's next summary, or a fixed profile draft. */
async function careerBot(_ctx, _client, _agent, request) {
  if (String(request.taskId).startsWith('liprofile-')) {
    draftPrompts.push(request.text);
    return { response: JSON.stringify({ reply: 'Drafted from your saved plan.', headline: 'Drafted headline' }) };
  }
  const text = resumeEdits.shift();
  assert.ok(text, 'an unexpected resume editor turn');
  return { response: JSON.stringify({ reply: 'Updated the summary.', actions: [{ op: 'set_summary', text }] }) };
}

/** The core's PostgreSQL plan store; only its logger is a kernel leaf, doubled as the harness does. */
function loadPlanStore() {
  const original = Module._load;
  Module._load = function withLogger(request, ...rest) {
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
    return original.call(this, request, ...rest);
  };
  try { return requireCore(PLAN_STORE); } finally { Module._load = original; }
}

async function createDatabase() {
  pg = requireCore('pg');
  database = `career_handoff_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${database}`); } finally { await admin.end(); }
  const url = new URL(adminUrl); url.pathname = '/' + database;
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
}

async function dropDatabase() {
  if (pool) await pool.end();
  if (!database) return;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } finally { await admin.end(); }
}

before(async () => {
  assert.ok(existsSync(path.join(coreRoot, 'node_modules', 'playwright')), 'OSHAL_CORE_ROOT must name a core checkout with playwright, express and pg (refusing rather than skipping)');
  assert.ok(platform && existsSync(path.join(platform, 'src/shared/ui/js/document-handoff.js')), 'OSHAL_PLATFORM_ROOT must name the kernel platform with the shared document handoff');
  assert.ok(existsSync(path.join(coreRoot, PLAN_STORE)), 'the core checkout must hold the compiled PostgreSQL ProfilePlanStore');
  assert.ok(adminUrl, 'OSHAL_TEST_POSTGRES must name the disposable PostgreSQL server (refusing rather than skipping)');
  await createDatabase();
  restoreEnv = isolateRunnerEnv(path.join(fixtureRoot, 'store'));
  ({ modules: routes } = loadCompiledModules({
    studio: 'routes/career-resume-studio-routes.js', profile: 'routes/career-profile-studio-routes.js',
    userStore: 'routes/career-user-store.js',
  }, {
    express: requireCore('express'), '@/features/profile-studio': loadPlanStore(),
    '@/app/routes/inline-bot-execution': { executeBotOrInline: careerBot },
    '@/app/profile-studio-dispatch': { dispatchProfileUpdate: () => { throw new Error('tripwire: no dispatch'); }, cleanupProfileDispatchWorkspace: async () => {} },
  }));
  // Asset uploads take raw bodies this loopback server does not parse; no case here uploads one.
  const router = { ...createRouter(), put() {} };
  routes.studio.registerCareerResumeStudio(router, { pool: { async query() { return { rows: [] }; } } });
  routes.profile.registerCareerProfileStudio(router, { pool });
  ({ server, baseUrl } = await startServer(router, (headers) => /fixture-session=([a-z-]+)/.exec(String(headers.cookie || ''))?.[1]));
  browser = await requireCore('playwright').chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreEnv) restoreEnv();
  await dropDatabase();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Seed one subject's durable career profile, the store the master resume reads and writes. */
function seedProfile(sub) {
  const dir = routes.userStore.userPaths(sub).userDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'career_db.json'), JSON.stringify(SEED, null, 2));
}

/** Call the package routes as `sub`, the way a concierge's tool call reaches them. */
async function api(sub, method, route, body) {
  const response = await fetch(baseUrl + '/api/career-hunter' + route, {
    method, headers: { cookie: `fixture-session=${sub}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.equal(response.status, 200, JSON.stringify(json));
  return json;
}

/** Open a shipped studio page as `sub`: the page and shared UI from disk, its API on the real routes. */
async function openStudio(t, sub, file, pathname) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => context.close());
  await context.addCookies([{ name: 'fixture-session', value: sub, url: baseUrl }]);
  const page = await context.newPage();
  await page.route(baseUrl + pathname, (route) => route.fulfill({ contentType: 'text/html', body: readFileSync(path.join(packageRoot, 'tools', file), 'utf8') }));
  await page.route(baseUrl + '/shared/ui/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/shared\/ui\//, '');
    route.fulfill({ path: path.join(platform, 'src/shared/ui', rel) });
  });
  await page.route(baseUrl + '/api/career-hunter/static/**', (route) => route.fulfill({ path: path.join(packageRoot, 'tools', path.basename(new URL(route.request().url()).pathname)) }));
  await page.goto(baseUrl + pathname);
  await page.waitForFunction(() => window.__oshalDocumentSession);
  return page;
}

async function begin(page) {
  return page.evaluate(async () => {
    const handoff = await import('/shared/ui/js/document-handoff.js');
    window.documentHandoff = await handoff.beginDocumentHandoff();
    return window.documentHandoff.context;
  });
}

/** The person asks the studio's own editor for a change; it lands in the page, unsaved. */
async function editSummary(page, text) {
  resumeEdits.push(text);
  await page.locator('#msg').fill('Rewrite the summary');
  await page.locator('#send').click();
  await page.locator('#sheet .summary', { hasText: text }).waitFor();
}

const masterSummary = async (sub) => (await api(sub, 'GET', '/resume/doc?id=master')).resume.summary;

async function conciergeSummary(sub, text) {
  const doc = await api(sub, 'GET', '/resume/doc?id=master');
  await api(sub, 'POST', '/resume/save', { postingId: 'master', resume: { ...doc.resume, summary: text } });
}

test('resume: an unsaved edit is saved before the assistant reads, its saved change is shown, and the next edit is handed on', { timeout: 300_000 }, async (t) => {
  seedProfile('alice');
  const page = await openStudio(t, 'alice', 'career-resume-studio.html', '/api/career-hunter/resume-studio');
  await page.locator('#sheet .summary', { hasText: 'Seasoned platform lead.' }).waitFor();
  await editSummary(page, 'My manual summary');
  assert.equal(await masterSummary('alice'), 'Seasoned platform lead.', 'the edit is not saved until a handoff or Save');
  const first = await begin(page);
  assert.equal(first.recordId, 'master');
  assert.equal(first.surface, 'resume-studio');
  assert.equal(await masterSummary('alice'), 'My manual summary');
  assert.match(first.fields.revision, /^[0-9a-f]{16}$/);
  assert.equal(first.fields.revision, await page.evaluate(async () => revisionOf(await fetchDoc('master'))), 'the revision names the saved document');
  await conciergeSummary('alice', 'The concierge summary');
  await page.evaluate(() => window.documentHandoff.refresh());
  await page.locator('#sheet .summary', { hasText: 'The concierge summary' }).waitFor();
  assert.equal(await page.locator('#status').textContent(), 'updated from the assistant');
  await editSummary(page, 'My next manual summary');
  const second = await begin(page);
  assert.equal(second.recordId, 'master');
  assert.notEqual(second.fields.revision, first.fields.revision);
  assert.equal(await masterSummary('alice'), 'My next manual summary');
});

test('resume: edits the person has not saved survive a refresh that finds the assistant\'s saved change', { timeout: 300_000 }, async (t) => {
  seedProfile('bob');
  const page = await openStudio(t, 'bob', 'career-resume-studio.html', '/api/career-hunter/resume-studio');
  await page.locator('#sheet .summary', { hasText: 'Seasoned platform lead.' }).waitFor();
  await begin(page);
  await editSummary(page, 'Still my draft');
  await page.locator('#msg').fill('half-typed request');
  await conciergeSummary('bob', 'Saved by the concierge');
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /unsaved edits are still here/);
  assert.match(await page.locator('#sheet .summary').textContent(), /Still my draft/);
  assert.equal(await page.locator('#msg').inputValue(), 'half-typed request');
  assert.match(await page.locator('#status').textContent(), /unsaved edits are still here/);
  assert.equal(await masterSummary('bob'), 'Saved by the concierge');
});

const readPlan = async (sub) => (await api(sub, 'GET', '/profile-studio/plan')).plan;

async function openProfile(t, sub) {
  const page = await openStudio(t, sub, 'career-profile-studio.html', '/api/career-hunter/profile-studio');
  await page.waitForFunction(() => document.querySelector('#state').textContent === 'draft');
  return page;
}

test('profile: unsaved fields and a typed skill are saved before the assistant reads, and the saved change comes back', { timeout: 180_000 }, async (t) => {
  const page = await openProfile(t, 'carol');
  await page.locator('#headline').fill('My manual headline');
  await page.locator('#skillIn').fill('Kubernetes');
  assert.equal(await readPlan('carol'), null, 'nothing is saved before the handoff');
  const first = await begin(page);
  const saved = await readPlan('carol');
  assert.equal(first.recordId, String(saved.id));
  assert.equal(first.surface, 'profile-studio');
  assert.equal(first.fields.revision, saved.updatedAt);
  assert.deepEqual([saved.headline, saved.skills], ['My manual headline', ['Kubernetes']]);
  await api('carol', 'POST', '/profile-studio/plan', { about: 'Written by the concierge.' });
  await page.evaluate(() => window.documentHandoff.refresh());
  assert.equal(await page.locator('#about').inputValue(), 'Written by the concierge.');
  assert.equal(await page.locator('#headline').inputValue(), 'My manual headline');
  assert.equal(await page.locator('#sync').textContent(), 'Updated with the change the assistant saved.');
  await page.locator('#headline').fill('My next headline');
  const second = await begin(page);
  const next = await readPlan('carol');
  assert.equal(second.recordId, first.recordId);
  assert.equal(second.fields.revision, next.updatedAt);
  assert.ok(Date.parse(next.updatedAt) > Date.parse(first.fields.revision));
  assert.deepEqual([next.headline, next.about], ['My next headline', 'Written by the concierge.']);
});

test('profile: a field still being edited survives a refresh, and AI draft reads the saved plan', { timeout: 180_000 }, async (t) => {
  const page = await openProfile(t, 'dave');
  await page.locator('#headline').fill('First headline');
  await begin(page);
  await page.locator('#headline').fill('Still typing this');
  await api('dave', 'POST', '/profile-studio/plan', { about: 'Concierge about' });
  await assert.rejects(page.evaluate(() => window.documentHandoff.refresh()), /unsaved edits are still here/);
  assert.equal(await page.locator('#headline').inputValue(), 'Still typing this');
  assert.equal(await page.locator('#about').inputValue(), '');
  assert.match(await page.locator('#sync').textContent(), /unsaved edits are still here/);
  await page.locator('#btnDraftAi').click();
  await page.waitForFunction(() => document.querySelector('#headline').value === 'Drafted headline');
  assert.match(draftPrompts.at(-1), /Still typing this/, 'the drafter read the plan with the on-screen edit saved');
  assert.equal((await readPlan('dave')).headline, 'Still typing this');
});
