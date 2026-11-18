/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guard test for Kalshi's read-only cross-application approvals probe (`/api/kalshi/approvals-queue`): verifies `oshal-app.yaml` declares no `approve`/`decline` templates, `formatKalshiReadOnlyApprovals` emits ONLY `blocked` `kalshi_orders` rows (`resting`/`pending`/`open` live orders excluded), and `GET /approvals-queue` logs DB rejections at ERROR and answers 503 instead of returning a silent empty list.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatKalshiReadOnlyApprovals, registerKalshiApprovalsReadRoutes } = require('../routes/kalshi-approvals-read');

const pkgDir = path.resolve(__dirname, '..');

test('kalshi oshal-app.yaml declares read-only approvals probe with zero action templates', () => {
  const yaml = fs.readFileSync(path.join(pkgDir, 'oshal-app.yaml'), 'utf8');
  const match = /^approvals:\s*\n((?:\s+.*\n)+)/m.exec(yaml);
  assert.ok(match, 'kalshi oshal-app.yaml must declare approvals:');
  assert.match(match[1], /^\s+path:\s*\/api\/kalshi\/approvals-queue\s*$/m);
  assert.match(match[1], /^\s+itemsPointer:\s*\/approvals\s*$/m);
  assert.doesNotMatch(match[1], /\b(approve|decline)\s*:/);
});

test('formatKalshiReadOnlyApprovals emits only blocked orders and excludes resting, pending, open, executed, and canceled rows', () => {
  const rows = [
    { id: 101, env: 'demo', ticker: 'KXBTC-26NOV', side: 'yes', action: 'buy', count: 10, limit_price_cents: 54, kalshi_order_id: 'ord-rest-1', kalshi_status: 'resting', created_at: '2026-11-17T04:00:00Z' },
    { id: 102, env: 'demo', ticker: 'KXBTC-26DEC', side: 'yes', action: 'buy', count: 6, limit_price_cents: 49, kalshi_order_id: 'ord-pend-1', kalshi_status: 'pending', created_at: '2026-11-17T04:01:00Z' },
    { id: 103, env: 'demo', ticker: 'KXINX-26NOV', side: 'no', action: 'buy', count: 8, limit_price_cents: 35, kalshi_order_id: 'ord-open-1', kalshi_status: 'open', created_at: '2026-11-17T04:02:00Z' },
    { id: 104, env: 'live', ticker: 'KXCPI-26NOV', side: 'no', action: 'buy', count: 5, limit_price_cents: 41, client_order_id: 'cli-block-1', kalshi_status: 'blocked', error: 'live-exchange orders are disabled', created_at: '2026-11-17T04:05:00Z' },
    { id: 105, env: 'demo', ticker: 'KXETH-26NOV', side: 'yes', action: 'buy', count: 3, limit_price_cents: 60, kalshi_order_id: 'ord-exec-1', kalshi_status: 'executed', created_at: '2026-11-17T03:00:00Z' },
    { id: 106, env: 'demo', ticker: 'KXFED-26DEC', side: 'no', action: 'buy', count: 2, limit_price_cents: 30, kalshi_order_id: 'ord-canc-1', kalshi_status: 'canceled', created_at: '2026-11-17T03:10:00Z' },
  ];
  const items = formatKalshiReadOnlyApprovals(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'cli-block-1');
  assert.equal(items[0].title, 'KXCPI-26NOV · BUY NO x5 @ 41c');
  assert.equal(items[0].readOnly, true);
  assert.equal(items[0].openHref, '/cockpit/?app=kalshi');
  assert.equal(items[0].openLabel, 'Open in Kalshi');
  assert.match(items[0].summary, /live-exchange orders are disabled/);
  assert.equal('approve' in items[0], false, 'Kalshi items must never carry approve');
  assert.equal('decline' in items[0], false, 'Kalshi items must never carry decline');
});

test('GET /approvals-queue scopes to blocked orders and logs DB rejections at ERROR instead of swallowing them', async () => {
  let handler = null;
  const router = { get: (routePath, fn) => { if (routePath === '/approvals-queue') handler = fn; } };
  const queries = [];
  const loggedErrors = [];
  let shouldReject = false;
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (shouldReject) throw new Error('connection terminated unexpectedly');
      return {
        rows: [
          { id: 7, env: 'live', ticker: 'KXFED-26DEC', side: 'yes', action: 'buy', count: 4, limit_price_cents: 48, client_order_id: 'cli-7', kalshi_status: 'blocked', error: 'live-exchange orders are disabled', created_at: '2026-11-17T05:00:00Z' },
        ],
      };
    },
  };
  const logger = { error: (meta, msg) => loggedErrors.push({ meta, msg }) };
  registerKalshiApprovalsReadRoutes(router, pool, logger);
  assert.equal(typeof handler, 'function');

  const mkRes = () => ({ statusCode: 200, payload: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; } });

  const unauthRes = mkRes();
  await handler({}, unauthRes);
  assert.equal(unauthRes.statusCode, 401);
  assert.equal(queries.length, 0);

  const authRes = mkRes();
  await handler({ oidc: { user: { sub: 'alice-sub' } } }, authRes);
  assert.equal(authRes.statusCode, 200);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /kalshi_status\s*=\s*'blocked'/);
  assert.doesNotMatch(queries[0].sql, /'resting'|'pending'|'open'/);
  assert.deepEqual(queries[0].params, ['alice-sub']);
  assert.equal(authRes.payload.readOnly, true);
  assert.equal(authRes.payload.approvals.length, 1);
  assert.equal(authRes.payload.approvals[0].openLabel, 'Open in Kalshi');
  assert.equal(loggedErrors.length, 0);

  shouldReject = true;
  const errRes = mkRes();
  await handler({ oidc: { user: { sub: 'alice-sub' } } }, errRes);
  assert.equal(errRes.statusCode, 503);
  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].msg, 'kalshi approvals-queue query failed');
  assert.equal(loggedErrors[0].meta.sub, 'alice-sub');
  assert.match(String(loggedErrors[0].meta.err?.message), /connection terminated unexpectedly/);
});
