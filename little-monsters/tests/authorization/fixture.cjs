/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the real core policy and package adapters with synthetic in-memory assignments and a read-only roster fixture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bind the actual tsx environment option so catalog-driven runs resolve core aliases from the package working directory.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');

const PKG = path.resolve(__dirname, '../..');
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || path.join(PKG, '../../oshal'));
const coreRequire = createRequire(path.join(CORE, 'package.json'));
const previousTsconfig = process.env.TSX_TSCONFIG_PATH;
process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
const unregister = coreRequire('tsx/cjs/api').register();
process.once('exit', () => {
  unregister();
  if (previousTsconfig === undefined) delete process.env.TSX_TSCONFIG_PATH;
  else process.env.TSX_TSCONFIG_PATH = previousTsconfig;
});
const yaml = coreRequire('js-yaml');
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
const { loadApplicationAuthorization } = coreRequire('./scripts/oshal-authorization-contract.js');
const { ApplicationAuthorizationService } = coreRequire('./src/features/application-authorization/service.ts');
const { MemoryAuthorizationStore } = coreRequire('./src/features/application-authorization/store.ts');
const { ApplicationAuthorizationRuntime } = coreRequire('./src/app/composition/application-authorization-runtime.ts');
const { registerEducationAuthorization } = require('../../src-routes/education-authorization.ts');
const access = require('../../src-routes/education-access.ts');
const express = coreRequire('express');

/** Synthetic exact identities; a grant never infers a role from display name or email. */
function actors() {
  const user = (sub, extra = {}) => ({ sub, issuer: 'https://school.example.test', isActive: true, isSwarmAdmin: false, ...extra });
  return { operator: user('operator', { isSwarmAdmin: true }), student: user('student'), teacher: user('teacher'),
    admin: user('admin'), unbound: user('unbound'), otherIssuer: user('teacher', { issuer: 'https://other.example.test' }) };
}

/** Only the adapter's exact, parameterized read is accepted; writes or broadened identity queries fail. */
function rosterPool(rows) {
  const reads = [];
  return { reads, rows, async query(text, values) {
    if (text.replace(/\s+/g, ' ').trim() !== 'SELECT role, tenant_id FROM lm_students WHERE external_issuer = $1 AND external_id = $2 LIMIT 2') {
      throw new Error('Unexpected SQL at structural boundary');
    }
    reads.push([...values]);
    return { rows: rows.filter(row => row.external_issuer === values[0] && row.external_id === values[1]).slice(0, 2) };
  } };
}

/** Real preview/apply and real runtime guard; all authority and storage remain disposable in memory. */
async function fixture({ catalogless = false } = {}) {
  const people = actors();
  const rows = ['student', 'teacher', 'admin'].map(role => ({ external_issuer: people[role].issuer,
    external_id: people[role].sub, role, tenant_id: 'school-a' }));
  const pool = rosterPool(rows), store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) =>
    Object.values(people).find(actor => actor.sub === sub && actor.issuer === issuer) ?? null });
  const runtime = new ApplicationAuthorizationRuntime(policy, async req => people[req.headers['x-fixture-user']] || people.unbound, {});
  const loadedManifest = { ...manifest };
  if (catalogless) delete loadedManifest.authorization;
  const record = { name: manifest.name, displayName: manifest.displayName, manifest: loadedManifest,
    manifestPath: path.join(PKG, 'oshal-app.yaml') };
  await runtime.start(record);
  if (!catalogless) registerEducationAuthorization({ pool, authorization: runtime.forPackage(manifest.name) });
  runtime.complete(record);
  const change = async (role, who, action = 'grant', extra = {}) => {
    const actor = people[who];
    const preview = await policy.previewChange(people.operator, { app: manifest.name, action,
      targetSub: actor.sub, targetIssuer: actor.issuer, role, reason: 'Synthetic Little Monsters role-boundary proof',
      expectedRevision: (await store.read()).revision, ...extra });
    return policy.applyChange(people.operator, { previewId: preview.previewId, idempotencyKey: randomUUID() });
  };
  const authorize = (who, operation) => policy.authorize(people[who], { app: manifest.name, ...operation });
  return { people, rows, pool, policy, store, runtime, record, change, authorize };
}

/** Loopback HTTP reaches the actual core guard. No provider, browser, disk mutation or deployment data. */
async function httpFixture() {
  const state = await fixture(), app = express();
  app.use('/api/education', (req, res, next) => state.runtime.guard(manifest.name, req, res, next));
  app.use('/api/education', (_req, res) => res.json({ admitted: true }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  return { ...state, call: (url, who, method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}/api/education${url}`,
    { method, headers: { 'x-fixture-user': who }, redirect: 'manual' }),
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

module.exports = { PKG, CORE, coreRequire, yaml, manifest, loadApplicationAuthorization, fixture, httpFixture, access,
  registerEducationAuthorization };
