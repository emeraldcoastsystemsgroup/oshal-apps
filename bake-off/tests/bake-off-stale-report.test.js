/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard: a report never shows a run graded on an earlier prompt as current. Jobs edited in place before the 409 spec-has-runs guard kept showing the old run's scores and recommendation as the measurement of the new prompt, and after an edit (or a declined save-as-new) the console's report still read as current. Drives the COMPILED GET /jobs/:id/report and PATCH /jobs/:id over a jobs/runs table that applies the store's own UPDATE (updated_at moves only when the statement says so), and runs the page's renderReport and edit marker cut out of tools/bake-off.html. Red on 4c7524f0, which answered no `stale` marker.
 *
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The edit marker shows only while the report shows a run: on a job with no run it said "the results below" above "No run yet" (seen live at 412x915).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const ROUTES = path.resolve(__dirname, '..', 'routes');
const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };

/** Framework modules the compiled routes import, as inert stand-ins. */
function frameworkStub(request) {
  if (request === '@/shared/logger') return { createChildLogger: () => quiet };
  if (request === '@/app/routes/caller-sub') return { callerSub: (req) => req.sub || null };
  if (request === '@/shared/services/database') {
    return { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => undefined };
  }
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  return {};
}

/** Load the compiled router with an express stub that records each handler by "METHOD path". */
function mount(pool) {
  const handlers = {};
  const router = {};
  for (const method of ['get', 'post', 'patch', 'delete', 'put']) {
    router[method] = (paths, fn) => { for (const p of [].concat(paths)) handlers[`${method.toUpperCase()} ${p}`] = fn; };
  }
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'express') return { Router: () => router };
    if (request.startsWith('@/')) return frameworkStub(request);
    return original.call(this, request, ...rest);
  };
  try {
    for (const key of Object.keys(require.cache)) if (key.startsWith(ROUTES)) delete require.cache[key];
    require(path.join(ROUTES, 'bake-off-routes.js')).createBakeOffRoutes({ pool, appPackageDir: path.resolve(__dirname, '..') });
  } finally { Module._load = original; }
  return handlers;
}

const NOW = '2026-10-12T09:00:00.000Z';

/** A jobs + runs table answering the store's statements; UPDATE moves updated_at only when the SQL sets it. */
function tables(jobs, runs) {
  return {
    jobs,
    async query(text, values = []) {
      if (/^SELECT \* FROM bake_off_runs WHERE job_id = \$1 AND owner_sub = \$2 ORDER BY started_at DESC LIMIT 1/.test(text)) {
        return { rows: runs.filter((r) => r.job_id === values[0] && r.owner_sub === values[1]).slice(0, 1) };
      }
      if (/^SELECT \* FROM bake_off_results WHERE run_id = \$1 AND owner_sub = \$2/.test(text)) return { rows: [] };
      if (/^SELECT \* FROM bake_off_jobs WHERE id = \$1 AND owner_sub = \$2/.test(text)) {
        return { rows: jobs.filter((r) => r.id === values[0] && r.owner_sub === values[1]) };
      }
      if (/^UPDATE bake_off_jobs SET/.test(text)) {
        const row = jobs.find((r) => r.id === values[0] && r.owner_sub === values[1]);
        if (!row) return { rows: [] };
        Object.assign(row, { name: values[2], prompt: values[3], rubric: JSON.parse(values[4]), reference: values[5],
          quality_bar: values[6], monthly_volume: values[7], lane_agent_ids: JSON.parse(values[8]) });
        if (/updated_at = NOW\(\)/.test(text)) row.updated_at = NOW;
        return { rows: [row] };
      }
      throw new Error(`unexpected statement: ${text.slice(0, 60)}`);
    },
  };
}

function job(id, extra = {}) {
  return { id, owner_sub: 'owner-1', name: 'Email triage', prompt: 'Sort this inbox into urgent, later and spam.',
    rubric: ['correct buckets'], reference: null, quality_bar: 70, monthly_volume: 100, lane_agent_ids: ['lane-a', 'lane-b'],
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...extra };
}

function run(jobId) {
  return { id: `run-${jobId}`, job_id: jobId, owner_sub: 'owner-1', status: 'complete', lanes_requested: 2, lanes_completed: 2,
    error: null, started_at: '2026-10-02T00:00:00.000Z', finished_at: '2026-10-02T00:05:00.000Z' };
}

async function call(handler, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return res;
}

const report = (routes, id) => call(routes['GET /jobs/:id/report'], { sub: 'owner-1', params: { id } });

test('a run graded before the job\'s prompt was edited is marked stale; a run of the current prompt is not', async () => {
  const db = tables([job('edited', { updated_at: '2026-10-03T00:00:00.000Z' }), job('current')], [run('edited'), run('current')]);
  const routes = mount(db);
  const stale = await report(routes, 'edited');
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body.run.id, 'run-edited');
  assert.ok(stale.body.stale, 'the report carries a stale marker');
  assert.equal(stale.body.stale.editedAt, '2026-10-03T00:00:00.000Z');
  assert.equal(stale.body.stale.runStartedAt, '2026-10-02T00:00:00.000Z');
  assert.match(stale.body.stale.message, /Run it again/);
  const current = await report(routes, 'current');
  assert.equal(current.body.stale, null, 'a run started after the last spec change is current');
});

test('renaming a job or moving its bar keeps its run current; a spec change on a job with no run moves updated_at', async () => {
  const db = tables([job('job-1'), job('job-2')], [run('job-1')]);
  const routes = mount(db);
  const patch = routes['PATCH /jobs/:id'];
  const renamed = await call(patch, { sub: 'owner-1', params: { id: 'job-1' },
    body: { name: 'Email triage, weekly', prompt: 'Sort this inbox into urgent, later and spam.', rubric: ['correct buckets'], qualityBar: 85, monthlyVolume: 400 } });
  assert.equal(renamed.statusCode, 200);
  assert.equal(db.jobs[0].updated_at, '2026-10-01T00:00:00.000Z', 'a name, bar or volume edit leaves updated_at');
  assert.equal((await report(routes, 'job-1')).body.stale, null, 'the run still measured this prompt');
  const reprompted = await call(patch, { sub: 'owner-1', params: { id: 'job-2' },
    body: { name: 'Email triage', prompt: 'Sort this inbox into urgent, later, spam and receipts.', rubric: ['correct buckets'] } });
  assert.equal(reprompted.statusCode, 200);
  assert.equal(db.jobs[1].updated_at, NOW, 'a prompt change moves updated_at');
  const refused = await call(patch, { sub: 'owner-1', params: { id: 'job-1' },
    body: { name: 'Email triage', prompt: 'Sort this inbox into urgent, later, spam and receipts.', rubric: ['correct buckets'] } });
  assert.equal(refused.statusCode, 409, 'a job with a run still refuses an in-place prompt change');
});

/** Cut one top-level function out of the page's script. */
function pageFunction(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `the page declares ${name}`);
  return html.slice(start, html.indexOf('\n}\n', start) + 2);
}

/** The page's report renderer and edit marker over fake elements. */
function page(selectedJob) {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'bake-off.html'), 'utf8');
  const elements = {};
  const el = (id) => (elements[id] = elements[id] || { id, value: '', hidden: true, innerHTML: '', addEventListener() {},
    querySelectorAll: () => [] });
  const sandbox = { $: el, JOBS: [selectedJob], SEL: selectedJob.id, DEFAULT_RUBRIC: ['accuracy'], POLL: null, SHOWN_RUN: { id: 'run-1' },
    verdictReady() {}, showOutput() {}, setTimeout() {} };
  vm.createContext(sandbox);
  const code = ['esc', 'usd', 'laneRow', 'headline', 'renderReport', 'specEdited', 'markEdited']
    .map((n) => pageFunction(html, n)).join('\n');
  vm.runInContext(code, sandbox);
  return { el, sandbox, html };
}

const REPORT = { report: { recommendation: { winner: null, blocked: 'fewer than two lanes cleared the bar', caveats: [] },
  qualifying: [], rejected: [], lanes: [] }, run: { id: 'run-1', status: 'complete' } };

test('the console marks a stale report out of date and leaves a current one unmarked', () => {
  const { el, sandbox } = page({ id: 'job-1', prompt: 'p', rubric: ['accuracy'], reference: null });
  sandbox.renderReport({ ...REPORT, stale: { message: 'This job was edited after this run started. Run it again for current results.' } });
  assert.match(el('report').innerHTML, /data-stale="1"[^>]*><strong>Out of date\.<\/strong> This job was edited after this run started/);
  assert.match(el('report').innerHTML, /class="scroll stale"/);
  sandbox.renderReport({ ...REPORT, stale: null });
  assert.doesNotMatch(el('report').innerHTML, /Out of date|scroll stale/);
});

test('editing the prompt, rubric or reference marks the report as not run with the edits', () => {
  const saved = { id: 'job-1', prompt: 'Sort this inbox into urgent, later and spam.', rubric: ['accuracy'], reference: null };
  const { el, sandbox, html } = page(saved);
  const fill = () => { el('f-prompt').value = saved.prompt; el('f-rubric').value = ''; el('f-ref').value = ''; };
  fill(); sandbox.markEdited();
  assert.equal(el('edited').hidden, true, 'the saved job (blank rubric = the default) is not an edit');
  for (const [id, value] of [['f-prompt', 'Sort this inbox into urgent, later, spam and receipts.'], ['f-rubric', 'receipts kept'], ['f-ref', 'urgent: the outage mail']]) {
    fill(); el(id).value = value; sandbox.markEdited();
    assert.equal(el('edited').hidden, false, `an edit of ${id} is marked`);
  }
  fill(); el('f-prompt').value = `  ${saved.prompt}  `; sandbox.markEdited();
  assert.equal(el('edited').hidden, true, 'whitespace the server trims is not an edit');
  sandbox.renderReport({ job: saved, run: null, stale: null, report: null });
  fill(); el('f-prompt').value = 'Sort this inbox into urgent, later, spam and receipts.'; sandbox.markEdited();
  assert.equal(el('edited').hidden, true, 'a job with no run has no results to mark');
  sandbox.renderReport({ ...REPORT, stale: null });
  assert.equal(el('edited').hidden, false, 'a report with a run marks the pending edit as soon as it renders');
  sandbox.SEL = null; fill(); el('f-prompt').value = 'a brand new job'; sandbox.markEdited();
  assert.equal(el('edited').hidden, true, 'a new, unsaved job has no report to mark');
  assert.match(html, /<p class="msg warn" id="edited" role="status" hidden><strong>Not run with your edits\.<\/strong>/);
  assert.match(html, /\['f-prompt', 'f-rubric', 'f-ref'\]\.forEach\(\(id\) => \{ \$\(id\)\.addEventListener\('input', markEdited\); \}\);/);
  assert.match(pageFunction(html, 'fillEditor'), /markEdited\(\);/, 'selecting a job resets the marker');
});
