/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The automation opt-in records the owner's verified issuer (1.25.1) so the nightly chain can mint callback grants the kernel's signed rail admits: against the COMPILED career-automation route, saving under a kernel request identity stores that identity's issuer (never a body field), saving with no verified issuer stores none, reading returns the recorded issuer or null for a row saved before 1.25.1, and migration 107 is the column's home and is listed by the manifest. Scoped doubles: the logger, the kernel request-identity module (an AsyncLocalStorage mirror), the caller-sub leaf, a recording pool and a recording Router; the real migration runs on the box's PostgreSQL at activation.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestIdentity } from './helpers/request-identity-stub.mjs';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ISSUER = 'https://issuer.oshal.example.com';
const originalLoad = Module._load;

Module._load = function loadAutomationStubs(request, ...rest) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
  if (request === '@/shared/services/database/request-identity') return requestIdentity;
  if (request === './career-user-store') return { callerSub: (req) => req?.userSub || null };
  return originalLoad.call(this, request, ...rest);
};
const automation = require('../routes/career-automation.js');
after(() => { Module._load = originalLoad; });

/** A pool that records every query and answers with the rows a case scripts. */
function recordingPool(rows = []) {
  const queries = [];
  return { queries, query: async (text, params) => { queries.push({ text, params }); return { rows }; } };
}

/** Capture the two handlers the route registers. */
function handlers(pool) {
  const captured = new Map();
  const router = {
    get: (path, handler) => captured.set(`GET ${path}`, handler),
    post: (path, handler) => captured.set(`POST ${path}`, handler),
  };
  automation.registerCareerAutomationRoutes(router, { pool });
  return captured;
}

/** A minimal Express response recorder. */
function response() {
  return { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test("saving the opt-in records the kernel identity's issuer, never a body field", async () => {
  const pool = recordingPool();
  const save = handlers(pool).get('POST /settings/automation');
  const res = response();
  await requestIdentity.runWithRequestIdentity({ sub: 'user-1', principalIssuer: ISSUER, isOperator: false }, () =>
    save({ userSub: 'user-1', body: { autoGenerate: true, autoSubmit: false, ownerIssuer: 'https://attacker.example.test' } }, res));
  assert.deepEqual(res.body, { ok: true, autoGenerate: true, autoSubmit: false, issuerRecorded: true });
  assert.equal(pool.queries.length, 1);
  assert.match(pool.queries[0].text, /owner_issuer/);
  assert.deepEqual(pool.queries[0].params, ['user-1', true, false, ISSUER]);
});

test('saving with no verified issuer records none, and reports so', async () => {
  const pool = recordingPool();
  const save = handlers(pool).get('POST /settings/automation');
  const res = response();
  await requestIdentity.runWithRequestIdentity({ sub: 'user-1', principalIssuer: null, isOperator: false }, () =>
    save({ userSub: 'user-1', body: { autoGenerate: true } }, res));
  assert.deepEqual(pool.queries[0].params, ['user-1', true, false, null]);
  assert.equal(res.body.issuerRecorded, false);
  const anonymous = response();
  await save({ body: { autoGenerate: true } }, anonymous);
  assert.equal(anonymous.statusCode, 401, 'an unauthenticated save is refused before any write');
  assert.equal(pool.queries.length, 1);
});

test('reading returns the recorded issuer, or null for a row saved before 1.25.1 or no row at all', async () => {
  const recorded = await automation.readAutomationSettings({ pool: recordingPool([{ auto_generate: true, auto_submit: false, owner_issuer: ISSUER }]) }, 'user-1');
  assert.deepEqual(recorded, { autoGenerate: true, autoSubmit: false, ownerIssuer: ISSUER });
  const legacy = await automation.readAutomationSettings({ pool: recordingPool([{ auto_generate: true, auto_submit: false, owner_issuer: null }]) }, 'user-1');
  assert.deepEqual(legacy, { autoGenerate: true, autoSubmit: false, ownerIssuer: null });
  const absent = await automation.readAutomationSettingsSystem({ pool: recordingPool([]) }, 'user-2');
  assert.deepEqual(absent, { autoGenerate: false, autoSubmit: false, ownerIssuer: null });
});

test('migration 107 adds the nullable, bounded column and the manifest applies it', () => {
  const migration = readFileSync(join(packageRoot, 'migrations', '107-career-automation-owner-issuer.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE career_automation_settings\s+ADD COLUMN IF NOT EXISTS owner_issuer TEXT/);
  assert.match(migration, /length\(owner_issuer\) BETWEEN 1 AND 2048/);
  const manifest = readFileSync(join(packageRoot, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /^  - migrations\/107-career-automation-owner-issuer\.sql$/m);
});
