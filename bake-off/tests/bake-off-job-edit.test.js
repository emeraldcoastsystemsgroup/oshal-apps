/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A job is edited, not duplicated. Drives the COMPILED router's PATCH /jobs/:id over an owner-scoped in-memory job table (the owner's edit keeps the id and lane choice, another person's id and an unknown id are 404 and change nothing), and runs the shipped Save and Delete handlers cut out of tools/bake-off.html: Save PATCHes the selected job and POSTs only with none selected; Delete asks first and does nothing when the person declines.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A run stays a measurement of the spec it graded. PATCH on a job that has a run refuses (409 spec-has-runs) a changed prompt, rubric or reference and leaves the row alone, so GET /jobs/:id/report still pairs that run with the prompt it raced; name, quality bar and volume still edit in place, and a job with no run takes any edit. The page's Save, on that refusal, asks and saves the changes as a new job, or sends nothing more when declined.
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

/** Framework modules the compiled routes import; the PATCH path uses only callerSub and the logger. */
function frameworkStub(request) {
  if (request === '@/shared/logger') return { createChildLogger: () => quiet };
  if (request === '@/app/routes/caller-sub') return { callerSub: (req) => req.sub || null };
  if (request === '@/shared/services/database') {
    return { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => undefined };
  }
  if (request === '@/features/agent-management') {
    return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  }
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

/** An owner-scoped bake_off_jobs table (plus its runs) answering the store's own statements. */
function jobTable(rows, runs = []) {
  const stamp = '2026-10-11T00:00:00.000Z';
  return {
    rows,
    async query(text, values = []) {
      if (/^SELECT \* FROM bake_off_runs WHERE job_id = \$1 AND owner_sub = \$2 ORDER BY started_at DESC LIMIT 1/.test(text)) {
        return { rows: runs.filter((r) => r.job_id === values[0] && r.owner_sub === values[1]).slice(0, 1) };
      }
      if (/^SELECT \* FROM bake_off_results WHERE run_id = \$1 AND owner_sub = \$2/.test(text)) return { rows: [] };
      if (/^SELECT \* FROM bake_off_jobs WHERE id = \$1 AND owner_sub = \$2/.test(text)) {
        return { rows: rows.filter((r) => r.id === values[0] && r.owner_sub === values[1]) };
      }
      if (/^UPDATE bake_off_jobs SET/.test(text)) {
        const row = rows.find((r) => r.id === values[0] && r.owner_sub === values[1]);
        if (!row) return { rows: [], rowCount: 0 };
        Object.assign(row, { name: values[2], prompt: values[3], rubric: JSON.parse(values[4]), reference: values[5],
          quality_bar: values[6], monthly_volume: values[7], lane_agent_ids: JSON.parse(values[8]), updated_at: stamp });
        return { rows: [row], rowCount: 1 };
      }
      if (/^INSERT INTO bake_off_jobs/.test(text)) throw new Error('an edit must never insert a job');
      throw new Error(`unexpected statement: ${text.slice(0, 60)}`);
    },
  };
}

function job(id, owner, extra = {}) {
  return { id, owner_sub: owner, name: 'Email triage', prompt: 'Sort this inbox into urgent, later and spam.',
    rubric: ['correct buckets'], reference: null, quality_bar: 70, monthly_volume: 100,
    lane_agent_ids: ['lane-a', 'lane-b'], created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...extra };
}

function finishedRun(jobId, owner) {
  return { id: 'run-1', job_id: jobId, owner_sub: owner, status: 'complete', lanes_requested: 2, lanes_completed: 2,
    error: null, started_at: '2026-10-02T00:00:00.000Z', finished_at: '2026-10-02T00:05:00.000Z' };
}

async function call(handler, req) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: {}, body: {}, query: {}, ...req }, res);
  return res;
}

const EDIT = { name: 'Email triage v2', prompt: 'Sort this inbox into urgent, later, spam and receipts.',
  rubric: ['correct buckets', 'receipts kept'], qualityBar: 80, monthlyVolume: 250 };

test('PATCH /jobs/:id edits the owner\'s job in place and keeps its lane choice', async () => {
  const table = jobTable([job('job-1', 'owner-1')]);
  const patch = mount(table)['PATCH /jobs/:id'];
  assert.equal(typeof patch, 'function', 'the router declares PATCH /jobs/:id');
  const res = await call(patch, { sub: 'owner-1', params: { id: 'job-1' }, body: EDIT });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.job.id, 'job-1');
  assert.equal(res.body.job.name, 'Email triage v2');
  assert.equal(res.body.job.qualityBar, 80);
  assert.deepEqual(res.body.job.laneAgentIds, ['lane-a', 'lane-b']);
  assert.equal(table.rows.length, 1, 'no second job');
});

test('another person\'s job and an unknown id are 404 and change nothing', async () => {
  const table = jobTable([job('job-1', 'owner-1')]);
  const patch = mount(table)['PATCH /jobs/:id'];
  const other = await call(patch, { sub: 'owner-2', params: { id: 'job-1' }, body: EDIT });
  assert.equal(other.statusCode, 404);
  const unknown = await call(patch, { sub: 'owner-1', params: { id: 'job-9' }, body: EDIT });
  assert.equal(unknown.statusCode, 404);
  assert.equal(table.rows[0].name, 'Email triage');
  const anonymous = await call(patch, { params: { id: 'job-1' }, body: EDIT });
  assert.equal(anonymous.statusCode, 401);
});

test('an invalid edit is refused with the validator\'s reason', async () => {
  const table = jobTable([job('job-1', 'owner-1')]);
  const res = await call(mount(table)['PATCH /jobs/:id'], { sub: 'owner-1', params: { id: 'job-1' }, body: { ...EDIT, name: '' } });
  assert.equal(res.statusCode, 400);
  assert.equal(table.rows[0].name, 'Email triage');
});

test('a job with a run keeps the prompt, rubric and reference that run was graded on', async () => {
  const original = job('job-1', 'owner-1');
  const keep = { name: original.name, prompt: original.prompt, rubric: original.rubric, qualityBar: 70, monthlyVolume: 100 };
  for (const change of [{ prompt: EDIT.prompt }, { rubric: EDIT.rubric }, { reference: 'urgent: the outage mail' }]) {
    const table = jobTable([job('job-1', 'owner-1')], [finishedRun('job-1', 'owner-1')]);
    const routes = mount(table);
    const res = await call(routes['PATCH /jobs/:id'], { sub: 'owner-1', params: { id: 'job-1' }, body: { ...keep, ...change } });
    assert.equal(res.statusCode, 409, `refused: ${Object.keys(change)[0]}`);
    assert.equal(res.body.code, 'spec-has-runs');
    assert.deepEqual(table.rows[0], original, 'the job row is unchanged');
    const report = await call(routes['GET /jobs/:id/report'], { sub: 'owner-1', params: { id: 'job-1' } });
    assert.equal(report.body.run.id, 'run-1');
    assert.equal(report.body.job.prompt, original.prompt, 'the report pairs the run with the prompt it raced');
    assert.deepEqual(report.body.job.rubric, original.rubric);
    assert.equal(report.body.job.reference, null);
  }
});

test('a job with a run still edits its name, quality bar and volume in place; a job with no run takes any edit', async () => {
  const table = jobTable([job('job-1', 'owner-1')], [finishedRun('job-1', 'owner-1')]);
  const res = await call(mount(table)['PATCH /jobs/:id'], { sub: 'owner-1', params: { id: 'job-1' },
    body: { name: 'Email triage, weekly', prompt: '  Sort this inbox into urgent, later and spam.  ', rubric: ['correct buckets'], qualityBar: 85, monthlyVolume: 400 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.job.name, 'Email triage, weekly');
  assert.equal(res.body.job.qualityBar, 85);
  assert.equal(res.body.job.monthlyVolume, 400);
  const fresh = jobTable([job('job-2', 'owner-1')], [finishedRun('job-1', 'owner-1')]);
  const edited = await call(mount(fresh)['PATCH /jobs/:id'], { sub: 'owner-1', params: { id: 'job-2' }, body: EDIT });
  assert.equal(edited.statusCode, 200, 'another job\'s run does not lock this one');
  assert.equal(fresh.rows[0].prompt, EDIT.prompt);
});

/** Run the page's Save and Delete handlers with a recording api() and a scripted confirm(). */
function page(selected, confirmAnswer, patchError) {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'bake-off.html'), 'utf8');
  const start = html.indexOf('async function saveAsNewIfAsked');
  const end = html.indexOf("$('run').onclick");
  const delStart = html.indexOf("$('del').onclick");
  const delEnd = html.indexOf('\n};\n', delStart) + 3;
  assert.ok(start > 0 && end > start && delStart > 0, 'the page declares Save and Delete handlers');
  const calls = [];
  const asked = [];
  const said = [];
  const elements = {};
  const sandbox = {
    SEL: selected, JOBS: [{ id: 'job-1', name: 'Email triage' }],
    $: (id) => (elements[id] = elements[id] || {}),
    body: () => EDIT,
    api: async (p, init) => {
      calls.push([init ? init.method : 'GET', p]);
      if (patchError && init && init.method === 'PATCH') throw Object.assign(new Error(patchError.message), { code: patchError.code });
      return { job: { id: init && init.method === 'POST' ? 'job-new' : selected } };
    },
    loadJobs: async () => undefined, loadReport: () => undefined, fillEditor: () => undefined,
    select: (id) => { calls.push(['SELECT', id]); }, say: (text, isErr) => { said.push([text, Boolean(isErr)]); },
    confirm: (text) => { asked.push(text); return confirmAnswer; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${html.slice(start, end)}\n${html.slice(delStart, delEnd)}`, sandbox);
  return { calls, asked, said, save: () => elements.save.onclick(), del: () => elements.del.onclick() };
}

test('Save updates the selected job and creates one only when none is selected', async () => {
  const editing = page('job-1', true);
  await editing.save();
  assert.deepEqual(editing.calls, [['PATCH', '/jobs/job-1'], ['SELECT', 'job-1']]);
  const fresh = page(null, true);
  await fresh.save();
  assert.deepEqual(fresh.calls, [['POST', '/jobs'], ['SELECT', 'job-new']]);
});

test('Save on a job whose run measured its prompt offers to save the changes as a new job', async () => {
  const refusal = { code: 'spec-has-runs', message: 'This job already has a run graded on its current prompt.' };
  const accepted = page('job-1', true, refusal);
  await accepted.save();
  assert.equal(accepted.asked.length, 1);
  assert.match(accepted.asked[0], /new job/);
  assert.deepEqual(accepted.calls, [['PATCH', '/jobs/job-1'], ['POST', '/jobs'], ['SELECT', 'job-new']]);
  const declined = page('job-1', false, refusal);
  await declined.save();
  assert.deepEqual(declined.calls, [['PATCH', '/jobs/job-1']], 'declining sends nothing more and keeps the job selected');
  assert.match(declined.said.at(-1)[0], /Not saved/);
  const other = page('job-1', true, { code: undefined, message: 'name is required' });
  await other.save();
  assert.equal(other.asked.length, 0, 'any other refusal is shown, not turned into a new job');
  assert.deepEqual(other.said.at(-1), ['name is required', true]);
});

test('Delete asks first and deletes nothing when the person declines', async () => {
  const declined = page('job-1', false);
  await declined.del();
  assert.equal(declined.asked.length, 1);
  assert.match(declined.asked[0], /Email triage/);
  assert.deepEqual(declined.calls, []);
  const accepted = page('job-1', true);
  await accepted.del();
  assert.deepEqual(accepted.calls, [['DELETE', '/jobs/job-1']]);
});
