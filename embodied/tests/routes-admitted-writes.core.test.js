/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | K4 regression: on the native kernel the package pool is bound to the admitted request (crates/host-process/bridge/pg_pool.js) and only a writer admission may mutate (crates/packages/src/sql_transaction.rs "SQL mutation requires original writer admission", seen live on GET /api/embodied/state). A write from the execution timer, one left running after the response, or one issued in a GET was refused, so a finished task stayed `executing` at step 0 and Home counted 0 completed. This suite mounts the compiled routes and the Home summary over a pool double with the same rules, carried per request with AsyncLocalStorage (a timer inherits the context of the request that started it, as a closed one): GET reads overlay the queued outcome, POST /writes/settle stores it with its final step and every step logged, Home counts it, e-stop stores aborted, and no write is ever attempted where the kernel would refuse it.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | K4 review: POST /tasks/:id/abort left the task `executing` at step 0 for good. The executor flips to `aborted` inside abort(), so the advance that followed never saw running->aborted and nothing queued the final status; Home counted 0 stopped and the next execute left the row behind. The abort case asserts the stored row is `aborted` with failure "aborted by a human" inside the abort request, the control has no task, every read agrees, Home counts it stopped, and a later task does not resurrect it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');

const { loadRoutes, fakePool, PKG } = require('./routes.harness');
const { express, createEmbodiedRoutes, restore } = loadRoutes();
const { createHomeSummaryRoutes } = require(path.join(PKG, 'routes', 'home-summary.js'));

const MUTATION = /^\s*(INSERT|UPDATE|DELETE)\b/i;

/**
 * The native pool's admission rules over the in-memory store: a query must start and finish inside
 * the open request that admitted it, and only a non-GET (writer) request may mutate.
 */
function admittedPool() {
  const inner = fakePool();
  const admission = new AsyncLocalStorage();
  const refused = [];
  const admit = (req, res, next) => {
    const ctx = { open: true, writer: req.method !== 'GET' && req.method !== 'HEAD' };
    const close = () => { ctx.open = false; };
    res.on('finish', close); res.on('close', close);
    admission.run(ctx, next);
  };
  const refuse = (text, why) => { refused.push(`${why}: ${text.slice(0, 40)}`); throw new Error(why); };
  const answer = async (sql, params) => {
    const text = typeof sql === 'string' ? sql : sql.text;
    const p = typeof sql === 'string' ? params : sql.values;
    const mine = inner.tasks.filter((t) => t.owner_sub === p[0]);
    const n = (f) => String(mine.filter(f).length);
    if (/^SELECT count\(\*\)::text AS total/.test(text)) return { rows: [{ total: String(mine.length), done: n((t) => t.status === 'done'), stopped: n((t) => t.status === 'failed' || t.status === 'aborted'), executing: n((t) => t.status === 'executing') }], rowCount: 1 };
    if (/^SELECT task_id, title, status, current_step/.test(text)) return { rows: mine.slice(-3).reverse().map((t) => ({ ...t })), rowCount: 3 };
    if (/^SELECT count\(\*\)::text AS refused/.test(text)) return { rows: [{ refused: '0' }], rowCount: 1 };
    if (/^SELECT task_id FROM embodied_task .* status = 'executing'/.test(text)) { const r = mine.filter((t) => t.status === 'executing').map((t) => ({ task_id: t.task_id })); return { rows: r, rowCount: r.length }; }
    return inner.query(sql, params);
  };
  const pool = {
    storageModel: 'kernel-scoped-documents',
    async query(sql, params = []) {
      const text = typeof sql === 'string' ? sql : sql.text;
      const ctx = admission.getStore();
      if (!ctx || !ctx.open) refuse(text, 'SQL requires an admitted request');
      if (MUTATION.test(text) && !ctx.writer) refuse(text, 'SQL mutation requires original writer admission');
      await new Promise((r) => setImmediate(r));
      if (!ctx.open) refuse(text, 'context dropped without finish');
      return answer(sql, params);
    },
  };
  return { pool, inner, admit, refused };
}

const store = admittedPool();
let wall = 1_000_000;
const app = express();
app.use(express.json());
app.use(store.admit);
app.use((req, _res, next) => { req.oidc = { user: { sub: 'alice' }, isAuthenticated: () => true }; next(); });
app.use('/api/embodied/home-summary', createHomeSummaryRoutes({ pool: store.pool }));
app.use('/api/embodied', createEmbodiedRoutes({ pool: store.pool, appPackageDir: PKG }, { now: () => wall }));
let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); }); base = `http://127.0.0.1:${server.address().port}/api/embodied`; });
test.after(async () => { await new Promise((r) => server.close(r)); restore(); });

const call = async (p, init = {}) => {
  const res = await fetch(base + p, init);
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { status: res.status, body };
};
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const row = (id) => store.inner.tasks.find((t) => t.task_id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doneCount = async () => (await call('/home-summary')).body.metrics.find((m) => m.id === 'tasks-done').value;

async function draftAndExecute() {
  const d = await call('/tasks/draft', post({ task: 'explore', maxScans: 3 }));
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const go = await call(`/tasks/${d.body.task_id}/execute`, post({ confirm: true }));
  assert.equal(go.status, 200, JSON.stringify(go.body));
  assert.equal(row(d.body.task_id).status, 'executing');
  return d.body.task_id;
}

/** Every plan step's completion is in the stored log for the task. */
function assertStepsLogged(id) {
  for (const step of row(id).plan.steps) {
    assert.ok(store.inner.log.some((l) => l.task_id === id && l.actor === `plan:${step.id}` && l.outcome === 'completed'), `${step.id} completed in the log`);
  }
}

test('a task finished during a state read is reported done by every read, and the settle POST stores it with its final step and every step logged', async () => {
  const id = await draftAndExecute();
  let final = null;
  for (let i = 0; i < 300; i += 1) {
    wall += 2000;
    final = (await call('/state')).body;
    if (final.control.executor !== 'running') break;
  }
  assert.equal(final.control.executor, 'done', JSON.stringify(final.control));
  assert.ok(final.control.pendingWrites > 0, 'the read reports what it could not store');
  assert.equal(row(id).status, 'executing', 'a GET stores nothing (the native rule)');
  const read = await call(`/tasks/${id}`);
  assert.equal(read.body.status, 'done', 'the task read overlays the queued outcome');
  assert.equal(read.body.current_step, final.control.stepIndex);
  assert.equal((await call('/tasks')).body.find((t) => t.task_id === id).status, 'done');
  assert.equal(await doneCount(), '1', 'Home counts the finished task before it is stored');

  const settled = await call('/writes/settle', post({}));
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.ok, true);
  assert.equal(settled.body.pending, 0);
  assert.equal(settled.body.control.pendingWrites, 0);
  assert.equal(row(id).status, 'done', 'the settle POST stored the completion');
  assert.equal(row(id).current_step, final.control.stepIndex, 'the stored step is where the executor stopped, not step 0');
  assertStepsLogged(id);
  assert.equal(await doneCount(), '1', 'stored and overlaid are not double counted');
  assert.deepEqual(store.refused, [], 'no write was attempted where the kernel refuses it');
});

test('a task finished on the timer between requests is reported by the next read and stored by the next POST', async () => {
  const id = await draftAndExecute();
  for (let i = 0; i < 60; i += 1) { wall += 2000; await sleep(260); }
  assert.equal(row(id).status, 'executing', 'between requests nothing reached the store');
  const read = await call(`/tasks/${id}`);
  assert.equal(read.body.status, 'done', 'the next task read overlays the outcome');
  assert.ok(read.body.current_step > 0, `reported step ${read.body.current_step} is the executor's, not 0`);
  assert.equal(await doneCount(), '2', 'Home counts both finished tasks');
  const d = await call('/tasks/draft', post({ task: 'explore', maxScans: 2 }));
  assert.equal(d.status, 201, 'any POST settles the queue');
  assert.equal(row(id).status, 'done');
  assert.ok(row(id).current_step > 0);
  assertStepsLogged(id);
  assert.deepEqual(store.refused, [], 'no write was attempted where the kernel refuses it');
});

test('e-stop stores the running task as aborted inside the request', async () => {
  const id = await draftAndExecute();
  const stop = await call('/control/estop', post({}));
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.equal(row(id).status, 'aborted');
  assert.equal(row(id).failure, 'e-stop');
  assert.equal((await call('/control/reset', post({}))).status, 200);
  assert.deepEqual(store.refused, []);
});

const stoppedCount = async () => (await call('/home-summary')).body.metrics.find((m) => m.id === 'tasks-stopped').value;

test('abort stores the running task as aborted inside the request, and nothing later reopens it', async () => {
  const stoppedBefore = Number(await stoppedCount());
  const id = await draftAndExecute();
  wall += 2000;
  const abort = await call(`/tasks/${id}/abort`, post({}));
  assert.equal(abort.status, 200, JSON.stringify(abort.body));
  assert.equal(abort.body.control.executor, 'aborted');
  assert.equal(abort.body.control.taskId, null, 'the control no longer drives the aborted task');
  assert.equal(abort.body.control.pendingWrites, 0, 'the abort request stored what it produced');
  assert.equal(row(id).status, 'aborted', 'the stored row is aborted, not executing');
  assert.equal(row(id).failure, 'aborted by a human');
  assert.equal((await call(`/tasks/${id}`)).body.status, 'aborted');
  assert.equal((await call('/tasks')).body.find((t) => t.task_id === id).status, 'aborted');
  assert.equal(await stoppedCount(), String(stoppedBefore + 1), 'Home counts the aborted task as stopped');
  assert.equal((await call(`/tasks/${id}/abort`, post({}))).status, 409, 'a second abort finds no running task');

  const next = await draftAndExecute();
  assert.notEqual(next, id);
  assert.equal(row(id).status, 'aborted', 'a later task leaves the aborted row alone');
  assert.equal((await call(`/tasks/${next}/abort`, post({}))).status, 200);
  assert.equal(row(next).status, 'aborted');
  assert.deepEqual(store.refused, [], 'no write was attempted where the kernel refuses it');
});
