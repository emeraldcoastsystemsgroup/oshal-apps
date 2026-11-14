/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify bounded master route ownership, input checks, conflict reporting and confirmed engine completion against the shipped route output.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.0: Undo (POST /resume/master-undo) runs as the signed-in owner with exactly the two revisions, refuses anything else before the engine, and reports a later change (master_changed) as a conflict, never a success.
 */
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
let calls, result;
Module._load = function (request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, warn() {}, info() {} }) };
  if (request === '@/features/agent-management') return { BotNodeClient: class {}, createRegistryEndpointResolver: () => null };
  if (request === '@/app/routes/inline-bot-execution') return {};
  if (request === './career-engine-runner') return {};
  if (request === './career-user-store') return { callerSub: req => req.userSub };
  if (request === './career-engine-dispatch') return { runCareerCliAwait: async (...args) => { calls.push(args); return result; } };
  return originalLoad.call(this, request, ...rest);
};
const studio = require('../routes/career-resume-studio-routes.js');
after(() => { Module._load = originalLoad; });
beforeEach(() => { calls = []; result = { ok: true, out: JSON.stringify({ ok: true, revision: 'a'.repeat(64), items: [], complete: true }) }; });
const handlers = new Map();
studio.registerCareerResumeStudio({ get: (p, h) => handlers.set('GET ' + p, h), post: (p, h) => handlers.set('POST ' + p, h) }, { pool: 'fixture-pool' });
async function call(method, request = {}) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handlers.get(method)({ userSub: 'owner-a', query: {}, ...request }, res);
  return res;
}
const patch = () => ({ revision: 'a'.repeat(64), edits: [{ field: 'summary', op: 'set', before: 'Recorded', value: 'Clarified' }] });

test('section reads and edits always execute as the signed-in owner', async () => {
  await call('GET /resume/master-section', { query: { field: 'education', index: '0', offset: '20', userSub: 'owner-b' } });
  assert.equal(calls[0][1], 'owner-a'); assert.deepEqual(calls[0][2], ['resume', 'base-section']);
  assert.deepEqual(JSON.parse(calls[0][3].CH_RESUME_DOC), { field: 'education', index: 0, offset: 20, limit: 20 });
  const res = await call('POST /resume/master-edit', { body: patch() });
  assert.equal(res.code, 200); assert.equal(calls[1][1], 'owner-a'); assert.deepEqual(calls[1][2], ['resume', 'base-patch']);
  for (const method of ['GET /resume/master-section', 'POST /resume/master-edit'])
    assert.equal((await call(method, { userSub: undefined, body: patch() })).code, 401);
  assert.equal(calls.length, 2);
});

test('invalid pages, unsupported target selectors and oversized patches stop before the engine', async () => {
  for (const query of [{ field: 'unknown' }, { offset: '-1' }, { offset: '1.2' }, { offset: '01' }, { index: '10000' }, { offset: ['0', '20'] }])
    assert.equal((await call('GET /resume/master-section', { query })).code, 400);
  for (const body of [{ ...patch(), userSub: 'owner-b' }, { ...patch(), revision: 'old' }, { ...patch(), edits: [] }, { ...patch(), edits: Array(21).fill({}) }])
    assert.equal((await call('POST /resume/master-edit', { body })).code, 400);
  const big = patch(); big.edits[0].value = 'x'.repeat(13000);
  assert.equal((await call('POST /resume/master-edit', { body: big })).code, 413);
  assert.equal(calls.length, 0);
});

test('conflicts and incomplete native runs never report a saved edit', async () => {
  result = { ok: false, out: JSON.stringify({ ok: false, error: 'master_changed', message: 'Read it again.' }) };
  let res = await call('POST /resume/master-edit', { body: patch() });
  assert.deepEqual([res.code, res.body], [409, { ok: false, error: 'Read it again.' }]);
  result = { ok: false, out: JSON.stringify({ ok: true, changed: true }) };
  res = await call('POST /resume/master-edit', { body: patch() });
  assert.equal(res.code, 502); assert.equal(res.body.ok, false);
  result = { ok: false, out: '' };
  assert.equal((await call('POST /resume/master-edit', { body: patch() })).code, 502);
  result = { ok: false, limitReason: 'inflight', out: '' };
  assert.equal((await call('POST /resume/master-edit', { body: patch() })).code, 409);
});

test('Undo runs as the signed-in owner with exactly two revisions, and a later change is a conflict', async () => {
  const body = { revision: 'b'.repeat(64), restore: 'a'.repeat(64) };
  const res = await call('POST /resume/master-undo', { body: { ...body } });
  assert.equal(res.code, 200); assert.equal(calls[0][1], 'owner-a'); assert.deepEqual(calls[0][2], ['resume', 'base-undo']);
  assert.deepEqual(JSON.parse(calls[0][3].CH_RESUME_DOC), body);
  for (const bad of [{ revision: body.revision }, { ...body, userSub: 'owner-b' }, { ...body, restore: 'old' }, { ...body, revision: 'B'.repeat(64) }, [], null])
    assert.equal((await call('POST /resume/master-undo', { body: bad })).code, 400);
  assert.equal((await call('POST /resume/master-undo', { userSub: undefined, body })).code, 401);
  assert.equal(calls.length, 1);
  result = { ok: false, out: JSON.stringify({ ok: false, error: 'master_changed', message: 'Your main résumé changed after that change, so Undo is no longer available.' }) };
  const later = await call('POST /resume/master-undo', { body });
  assert.deepEqual([later.code, later.body.ok], [409, false]);
});
