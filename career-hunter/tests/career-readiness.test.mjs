/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-141 readiness guards against the COMPILED routes: `stories` counts roles that carry a story from the real career profile file (0 of N with none, N of N when every role has one, "index a resume" with no profile) and `materials` counts regular files under uploads/artifacts (dot-files ignored, no directory = 0); GET /readiness answers 401 without a caller and the two blocks with one; the resume-state route gains the one-line `summary` the dashboard shows.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Module from 'node:module';
import { deploymentModeStub } from './helpers/deployment-mode-stub.mjs';

const require = createRequire(import.meta.url);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'career-readiness-'));
const originalLoad = Module._load;

Module._load = function loadWithReadinessStubs(request, ...rest) {
  if (request === '@/shared/deployment-mode') return deploymentModeStub();
  if (request === '@/shared/logger') {
    return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  }
  if (request === './career-user-store') {
    return {
      callerSub: (req) => req.userSub || null,
      careerTenant: () => 'career-hunter',
      userPaths: (userSub) => ({ userDir: join(fixtureRoot, userSub) }),
      openUserDb: () => null,
    };
  }
  return originalLoad.call(this, request, ...rest);
};

const readiness = require('../routes/career-readiness.js');

after(() => {
  Module._load = originalLoad;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function userDir(sub, profile) {
  const dir = join(fixtureRoot, sub);
  mkdirSync(dir, { recursive: true });
  if (profile) writeFileSync(join(dir, 'career_db.json'), JSON.stringify(profile));
  return dir;
}

/** Capture the terminal handler of one registered GET route. */
function captureHandler(register, routePath) {
  let handler;
  register({ get(path, ...callbacks) { if (path === routePath) handler = callbacks.at(-1); } });
  assert.ok(handler, `route ${routePath} registered`);
  return handler;
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('stories: no profile → not ready with the "index a resume" hint', async () => {
  const dir = userDir('u-none', null);
  const out = await readiness.readStoriesReadiness(dir);
  assert.equal(out.ready, false);
  assert.equal(out.roles, 0);
  assert.match(out.detail, /Index a resume first/);
});

test('stories: counts roles that carry a story, honestly 0 of N until the review writes them', async () => {
  const dir = userDir('u-partial', { roles: [{ title: 'A', stories: [] }, { title: 'B' }, { title: 'C', stories: [{ bullet: 'x', story: 'y' }] }] });
  const out = await readiness.readStoriesReadiness(dir);
  assert.deepEqual({ ready: out.ready, roles: out.roles, withStory: out.withStory }, { ready: false, roles: 3, withStory: 1 });
  assert.equal(out.detail, '1 of 3 roles have a story.');
});

test('stories: every role with a story → ready', async () => {
  const dir = userDir('u-all', { roles: [{ title: 'A', stories: [{ story: 's' }] }, { title: 'B', stories: [{ story: 't' }] }] });
  const out = await readiness.readStoriesReadiness(dir);
  assert.equal(out.ready, true);
  assert.equal(out.detail, '2 of 2 roles have a story.');
});

test('materials: no directory → 0; regular files count, dot-files do not', async () => {
  const empty = userDir('u-empty', null);
  assert.deepEqual(await readiness.readMaterialsReadiness(empty), { ready: false, count: 0, detail: 'Nothing added yet — performance reports, project write-ups, anything that shows your work.' });
  const dir = userDir('u-docs', null);
  mkdirSync(join(dir, 'uploads', 'artifacts'), { recursive: true });
  writeFileSync(join(dir, 'uploads', 'artifacts', '1-review.pdf'), 'x');
  writeFileSync(join(dir, 'uploads', 'artifacts', '2-notes.txt'), 'y');
  writeFileSync(join(dir, 'uploads', 'artifacts', '.keep'), '');
  const out = await readiness.readMaterialsReadiness(dir);
  assert.deepEqual({ ready: out.ready, count: out.count }, { ready: true, count: 2 });
  assert.equal(out.detail, '2 documents added to your profile.');
});

test('GET /readiness: 401 without a caller; both blocks with one', async () => {
  const handler = captureHandler(readiness.registerCareerReadinessRoutes, '/readiness');
  const anon = fakeRes();
  await handler({}, anon);
  assert.equal(anon.statusCode, 401);

  userDir('u-route', { roles: [{ title: 'A', stories: [{ story: 's' }] }] });
  const res = fakeRes();
  await handler({ userSub: 'u-route' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stories.ready, true);
  assert.equal(res.body.materials.ready, false);
});

test('resume state carries the one-line summary the dashboard shows', async () => {
  const onboardingSource = require('node:fs').readFileSync(require.resolve('../routes/career-onboarding-routes.js'), 'utf8');
  assert.match(onboardingSource, /summary: resume\.hasResume/);
  assert.match(onboardingSource, /No resume indexed yet\./);
});
