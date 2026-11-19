/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: verify the dynamically-loaded career-resume-reviewer Swarm bot declaration (oshal-app.yaml, personas/career-resume-reviewer.yaml, authorization.yaml), worker-rail bot routing & fail-closed rejection (routes/career-worker-rail.js), Python resume quality contract (career-resume-reviewer-contract.py), and UI/draft surfacing (lib/career-resume-review.js, lib/career-application-draft.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FIXTURE_ISSUER, loadRailHarness, postCompletion } from './helpers/worker-rail-harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..');
const require = createRequire(import.meta.url);
const yaml = require(require.resolve('js-yaml', { paths: [here, join(repoRoot, 'scripts', 'toolchain')] }));
const resumeReview = require('../lib/career-resume-review');
const draft = require('../lib/career-application-draft');
const PYTHON = process.env.CAREER_PYTHON || 'python3';
const REVIEWER_ID = 'cb000000-0000-0000-0000-000000000006';
const WORKER_ID = 'cb000000-0000-0000-0000-000000000001';

test('career-resume-reviewer is declared as a dynamic inline Swarm bot with canonical persona and authz binding', () => {
  const manifest = yaml.load(readFileSync(join(pkgRoot, 'oshal-app.yaml'), 'utf8'));
  const bot = (manifest.bots || []).find((item) => item.name === 'career-resume-reviewer');
  assert.ok(bot, 'career-resume-reviewer declared under bots:');
  assert.equal(bot.agentId, REVIEWER_ID);
  assert.equal(bot.posture, 'inline');
  assert.equal(bot.conversation, false);
  assert.equal(bot.persona, 'personas/career-resume-reviewer.yaml');
  assert.deepEqual(bot.capabilities, ['resume-review', 'resume-quality-audit']);

  const persona = yaml.load(readFileSync(join(pkgRoot, 'personas', 'career-resume-reviewer.yaml'), 'utf8'));
  assert.equal(persona.name, 'career-resume-reviewer');
  assert.equal(persona.agent_id, REVIEWER_ID);
  assert.match(persona.perspective, /Rubric Version:\s*1\.0\.0/);
  assert.match(persona.perspective, /ATS & Typography Cleanliness/);
  assert.match(persona.perspective, /Verified Experience Tenure Table/);
  assert.match(persona.perspective, /C\+\+/);

  const catalog = yaml.load(readFileSync(join(pkgRoot, 'authorization.yaml'), 'utf8'));
  const binding = (catalog.bindings?.bots || []).find((item) => item.id === REVIEWER_ID);
  assert.ok(binding, 'career-resume-reviewer bound in authorization.yaml');
  assert.deepEqual(binding.allOf, ['app.open', 'career.execute']);
});

test('worker rail routes bot=career-resume-reviewer to inline agentId and fails closed on unknown bot', async () => {
  const harness = loadRailHarness();
  const server = await harness.startServer();
  const { state, runs } = harness;
  state.calls.length = 0;
  state.hasEndpoint = false; // inline reviewer bot must succeed even without a dedicated node
  state.behavior = async () => ({ success: true, response: '{"passed":true,"issues":[],"revised_resume":null,"reviewer_notes":"ok"}', model: 'm', provider: 'p' });
  const run = runs.registerEngineRun('owner-rev', 'prepare', { ownerIssuer: FIXTURE_ISSUER });
  const auth = { grant: run.token, owner: 'owner-rev' };
  try {
    const ok = await postCompletion(server.url, {
      ...auth,
      body: { system: '', prompt: 'Review resume', bot: 'career-resume-reviewer', maxTokens: 2000, jsonMode: true },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok));
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].agentId, REVIEWER_ID);
    assert.equal(state.calls[0].request.agentId, REVIEWER_ID);

    const bad = await postCompletion(server.url, {
      ...auth,
      body: { system: '', prompt: 'Review resume', bot: 'unknown-bot', maxTokens: 2000, jsonMode: true },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid-completion');
    assert.equal(state.calls.length, 1, 'unknown bot never reaches execution');

    const badGuard = await postCompletion(server.url, {
      ...auth,
      body: { system: '', prompt: 'Review resume', bot: 'career-resume-reviewer', expectedModelIdentity: 'a'.repeat(64) },
    });
    assert.equal(badGuard.status, 400);
    assert.equal(state.calls.length, 1, 'reviewer bot rejects career scoring model identity guard');
    assert.notEqual(WORKER_ID, REVIEWER_ID);
  } finally {
    try { runs.settleEngineRun(run.runId, { code: 0 }); } finally { await server.close(); }
  }
});

test('Python resume quality & reviewer contract passes all checks', () => {
  const run = spawnSync(PYTHON, [fileURLToPath(new URL('./career-resume-reviewer-contract.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(summary.failed, [], JSON.stringify(summary));
  assert.ok(summary.checks >= 35, `expected >= 35 checks, got ${summary.checks}`);
});

test('lib/career-resume-review.js and career-application-draft.js surface passed and needs_review receipts cleanly', (t) => {
  assert.equal(resumeReview.state({ generated: {} }), null);
  const passed = resumeReview.state({
    resume_review: {
      version: 1, bot: 'career-resume-reviewer', rubric_version: '1.0.0', status: 'passed', attempts: 1,
      llm_reviewed: true, issues_found: ['Removed + suffix'], issues_fixed: ['Removed + suffix'], remaining_issues: [],
    },
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.needsReview, false);
  assert.match(passed.summary, /1 issue fixed automatically/);

  const dir = mkdtempSync(join(tmpdir(), 'career-rev-draft-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'career_db.json'), JSON.stringify({ profile: { name: 'Morgan' }, roles: [] }));
  const folder = join(dir, 'applications', 'Lockheed__42');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'Resume_ATS.pdf'), '%PDF-sample');
  writeFileSync(join(folder, 'CoverLetter.pdf'), '%PDF-sample');
  writeFileSync(join(folder, 'application.json'), JSON.stringify({
    posting_id: 42,
    generated: { resume: { experience: [] }, cover: { paragraphs: ['Ok.'] } },
    resume_review: {
      version: 1, bot: 'career-resume-reviewer', rubric_version: '1.0.0', status: 'needs_review', attempts: 2,
      llm_reviewed: true, issues_found: ['Conflicting year claims.'], issues_fixed: [], remaining_issues: ['Conflicting year claims.'],
    },
  }));
  const job = { status: 'generated', has_resume: 1, has_cover: 1, resume_path: join(folder, 'Resume_ATS.pdf'), cover_path: join(folder, 'CoverLetter.pdf'), url: 'https://example.invalid/42', active: 1 };
  const view = draft.view(dir, 42, job);
  assert.equal(view.resumeReview.needsReview, true);
  assert.match(view.resumeReview.notice, /Conflicting year claims/);
  const applied = draft.view(dir, 42, { ...job, status: 'applied' });
  assert.equal(applied.resumeReview, null, 'submitted application keeps its documents as record');
});
