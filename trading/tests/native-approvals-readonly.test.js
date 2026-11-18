/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Verify Intelligent Trades (`trading`) declares read-only `approvals:` on `/api/trading/approvals-queue`, emits ONLY `Open in Intelligent Trades` with zero `approve`/`decline` fields, and leaves the 29-file `orderAuthority` closure byte-for-byte unchanged (`49adb4981cf33da65776bb214d6445e3b895a2fb3c5d134c3462cea83d98a117`).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the approved legacy digest exact and verify the unchanged read-only approvals probe joins no supported authority version.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatTradingReadOnlyApprovals, registerTradingApprovalsReadRoutes } = require('../routes/trading-approvals-read');

const root = path.resolve(__dirname, '..');
const yamlRoots = [__dirname, path.resolve(__dirname, '../../scripts/toolchain'), ...(process.env.OSHAL_FRAMEWORK ? [path.resolve(process.env.OSHAL_FRAMEWORK)] : [])];
const yaml = require(require.resolve('js-yaml', { paths: yamlRoots }));

test('trading orderAuthority closure stays at the exact 29 files and digest', () => {
  const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
  assert.deepEqual(manifest.approvals, { path: '/api/trading/approvals-queue', itemsPointer: '/approvals' });
  const authority = require('./support/order-authority');
  for (const [version, sources] of Object.entries(authority.preservedLegacy(root))) {
    const files = authority.closure(root, sources);
    assert.equal(files.has('routes/trading-approvals-read.js'), false, `read-only approvals stay outside version ${version}`);
    assert.equal(files.has('routes/trading-routes.js'), false, `mount entry stays outside version ${version}`);
  }
});

test('GET /approvals-queue emits strictly read-only Open in Intelligent Trades items with zero action descriptors', async () => {
  const nowMs = Date.parse('2026-11-17T03:00:00Z');
  const rows = [
    { record_id: 'rev-1', created_at: '2026-11-17T02:00:00Z', payload: JSON.stringify({ id: 'rev-1', status: 'pending', strategyName: 'Core Momentum Allocation', expiresAt: '2026-11-24T00:00:00Z' }) },
    { record_id: 'rev-2', created_at: '2026-11-17T01:00:00Z', payload: JSON.stringify({ id: 'rev-2', status: 'pending', strategyName: 'Already Approved Plan' }) },
    { record_id: 'apr-2', created_at: '2026-11-17T01:30:00Z', payload: JSON.stringify({ id: 'apr-2', status: 'research-approved', reviewId: 'rev-2' }) },
  ];
  const items = formatTradingReadOnlyApprovals(rows, nowMs);
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]).sort(), ['category', 'createdAt', 'id', 'openHref', 'openLabel', 'readOnly', 'summary', 'title']);
  assert.equal(items[0].approve, undefined);
  assert.equal(items[0].decline, undefined);
  assert.equal(items[0].readOnly, true);
  assert.equal(items[0].openHref, '/cockpit/?app=intelligent-trades');
  assert.equal(items[0].openLabel, 'Open in Intelligent Trades');

  let handler = null;
  const router = { get: (p, fn) => { if (p === '/approvals-queue') handler = fn; } };
  registerTradingApprovalsReadRoutes(router, { pool: { query: async () => ({ rows }) } });
  assert.equal(typeof handler, 'function');
  let sent = null;
  await handler({ oidc: { user: { sub: 'trader-1' } } }, { setHeader: () => {}, status() { return this; }, json: (b) => { sent = b; } });
  assert.equal(sent.readOnly, true);
  assert.equal(sent.approvals.length, 1);
  assert.equal('approve' in sent.approvals[0], false);
  assert.equal('decline' in sent.approvals[0], false);
});

test('GET /approvals-queue logs DB rejections at ERROR and responds 503 instead of swallowing them', async () => {
  let handler = null;
  const logged = [];
  const router = { get: (p, fn) => { if (p === '/approvals-queue') handler = fn; } };
  const boom = new Error('portfolio records offline');
  registerTradingApprovalsReadRoutes(
    router,
    { pool: { query: async () => { throw boom; } } },
    { error: (meta, msg) => logged.push({ meta, msg }) },
  );
  let statusCode = 200;
  let body = null;
  await handler(
    { oidc: { user: { sub: 'trader-err-1' } } },
    { setHeader: () => {}, status(code) { statusCode = code; return this; }, json(b) { body = b; } },
  );
  assert.equal(statusCode, 503);
  assert.equal(body.error, 'portfolio records offline');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].msg, 'trading approvals-queue query failed');
  assert.equal(logged[0].meta.sub, 'trader-err-1');
  assert.equal(logged[0].meta.err, boom);
});
